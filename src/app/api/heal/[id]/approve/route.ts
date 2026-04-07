import { HealApproveSchema } from "@/lib/core/validation";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// POST /api/heal/[id]/approve — approve a self-healing fix
export const POST = withHandler(async (request: NextRequest) =>
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { id } = await params;
  const { approved } = validate(HealApproveSchema, await request.json());

  // Get the test run result with heal action
  const { data: result, error } = await supabase
    .from("test_run_results")
    .select("*, test_steps(*)")
    .eq("id", id)
    .single();

  if (error || !result) return NextResponse.json({ error: "Result not found" }, { status: 404 });
  if (!result.heal_action) return NextResponse.json({ error: "No healing action on this result" }, { status: 400 });

  if (approved) {
    // Update the original test step with the healed selector
    const healAction = result.heal_action as unknown;
    const currentTarget = result.test_steps?.target as unknown || {};

    await supabase
      .from("test_steps")
      .update({
        target: {
          ...currentTarget,
          selector: healAction.new_selector,
        },
        is_healed: true,
        heal_log: {
          ...healAction,
          approved: true,
          approved_by: auth.user_id,
          approved_at: new Date().toISOString(),
        },
      })
      .eq("id", result.step_id);

    // === PROPAGATE FIX TO OBJECT REPOSITORY ===
    // Find the Object Repository entry for this element and update it
    const oldSelector = healAction.original_selector;
    const newSelector = healAction.new_selector;

    // Get the test case to find the project_id
    const { data: step } = await supabase
      .from("test_steps")
      .select("test_case_id, test_cases(project_id)")
      .eq("id", result.step_id)
      .single();

    const projectId = (step as unknown)?.test_cases?.project_id;

    if (projectId) {
      // Find matching Object Repository entry by old selector
      const { data: repoEntries } = await supabase
        .from("object_repository")
        .select("*")
        .eq("project_id", projectId)
        .filter("fingerprint->meta->>recommended_selector", "eq", oldSelector);

      for (const entry of (repoEntries || [])) {
        const fingerprint = entry.fingerprint as unknown;
        const healHistory = entry.heal_history || [];

        // Add heal event to history
        healHistory.push({
          date: new Date().toISOString(),
          old_selector: oldSelector,
          new_selector: newSelector,
          method: healAction.method,
          confidence: healAction.confidence,
          approved_by: auth.user_id,
        });

        // Update fingerprint with new recommended selector
        await supabase
          .from("object_repository")
          .update({
            fingerprint: {
              ...fingerprint,
              meta: {
                ...fingerprint.meta,
                recommended_selector: newSelector,
                recommended_strategy: healAction.method,
              },
            },
            heal_history: healHistory,
            last_verified: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", entry.id);
      }

      // === PROPAGATE TO ALL TEST STEPS USING THE SAME OLD SELECTOR ===
      // Find all steps in this project with the same old selector
      const { data: allSteps } = await supabase
        .from("test_steps")
        .select("id, target, test_cases!inner(project_id)")
        .filter("test_cases.project_id", "eq", projectId)
        .neq("id", result.step_id); // Skip the step we already updated

      let propagatedCount = 0;
      for (const otherStep of (allSteps || [])) {
        const otherTarget = otherStep.target as unknown;
        if (otherTarget?.selector === oldSelector) {
          await supabase
            .from("test_steps")
            .update({
              target: { ...otherTarget, selector: newSelector },
              is_healed: true,
              heal_log: {
                ...healAction,
                propagated_from: result.step_id,
                propagated_at: new Date().toISOString(),
              },
            })
            .eq("id", otherStep.id);
          propagatedCount++;
        }
      }

      console.log(`[Testara Heal] Approved: ${oldSelector} → ${newSelector}. Propagated to ${propagatedCount} other steps.`);
    }
  }

  // Mark the heal action as reviewed
  await supabase
    .from("test_run_results")
    .update({
      heal_action: {
        ...result.heal_action as HealLog,
        reviewed: true,
        approved,
        reviewed_by: auth.user_id,
      },
    })
    .eq("id", id);

  return NextResponse.json({ data: { approved, result_id: id } });
}
