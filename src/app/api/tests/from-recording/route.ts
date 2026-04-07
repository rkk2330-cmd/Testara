import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// POST /api/tests/from-recording — create a test from Chrome extension recording
export const POST = withHandler(async (request: NextRequest) => {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { project_id, title, recorded_actions } = await request.json().catch(() => ({}));

  if (!project_id || !recorded_actions || !Array.isArray(recorded_actions) || recorded_actions.length === 0) {
    return NextResponse.json({ error: "project_id and recorded_actions[] are required" }, { status: 400 });
  }

  // Create test case
  const { data: testCase, error: tcError } = await supabase
    .from("test_cases")
    .insert({
      project_id,
      title: title || `Recorded Test — ${new Date().toLocaleDateString()}`,
      description: `Recorded from browser extension. ${recorded_actions.length} actions captured.`,
      tags: ["recorded"],
      status: "draft",
      created_by: auth.user_id,
      ai_generated: false,
    })
    .select()
    .single();

  if (tcError) return NextResponse.json({ error: tcError.message }, { status: 500 });

  // Convert recorded actions to test steps — MASK PASSWORDS
  const steps = recorded_actions.map((action: Record<string, unknown>, idx: number) => {
    const target = action.target as Record<string, unknown> || {};
    const selector = (target.selector as string || "").toLowerCase();
    const desc = (target.description as string || "").toLowerCase();
    const isPasswordField = selector.includes("password") || selector.includes("type=\"password\"") || desc.includes("password");
    
    return {
      test_case_id: testCase.id,
      order_index: idx + 1,
      action_type: action.type || "click",
      target: {
        selector: target.selector || "",
        fallback_selectors: target.fallback_selectors || {},
        description: target.description || `Step ${idx + 1}`,
        is_sensitive: isPasswordField, // Flag for UI masking
      },
      input_data: action.value || null, // Stored as-is for execution, masked in UI display
      expected_result: null,
    };
  });

  const { error: stepsError } = await supabase.from("test_steps").insert(steps);
  if (stepsError) console.error("Steps insert error:", stepsError);

  // Return the created test
  const { data: complete } = await supabase
    .from("test_cases")
    .select("*, test_steps(*)")
    .eq("id", testCase.id)
    .single();

  return NextResponse.json({ data: complete }, { status: 201 });
}
