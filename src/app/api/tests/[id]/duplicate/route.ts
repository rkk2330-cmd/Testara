import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// POST /api/tests/[id]/duplicate — clone a test case with all steps
export const POST = withHandler(async (request: NextRequest) =>
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { id } = await params;

  // Fetch original test + steps
  const { data: original, error } = await supabase
    .from("test_cases")
    .select("*, test_steps(*)")
    .eq("id", id)
    .single();

  if (error || !original) return NextResponse.json({ error: "Test not found" }, { status: 404 });

  // Create duplicate
  const { data: duplicate } = await supabase
    .from("test_cases")
    .insert({
      project_id: original.project_id,
      title: `${original.title} (Copy)`,
      description: original.description,
      tags: original.tags,
      status: "draft",
      created_by: auth.user_id,
      ai_generated: original.ai_generated,
    })
    .select()
    .single();

  if (!duplicate) return NextResponse.json({ error: "Failed to duplicate" }, { status: 500 });

  // Copy steps
  if (original.test_steps && original.test_steps.length > 0) {
    const steps = original.test_steps.map((step: Record<string, unknown>) => ({
      test_case_id: duplicate.id,
      order_index: step.order_index,
      action_type: step.action_type,
      target: step.target,
      input_data: step.input_data,
      expected_result: step.expected_result,
    }));
    await supabase.from("test_steps").insert(steps);
  }

  // Fetch complete duplicate
  const { data: complete } = await supabase
    .from("test_cases")
    .select("*, test_steps(*)")
    .eq("id", duplicate.id)
    .single();

  return NextResponse.json({ data: complete }, { status: 201 });
}
