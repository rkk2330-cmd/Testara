import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { runTest } from "@/lib/execution/runner";

// POST /api/suites/[id]/run — execute all tests in a suite (ACTUALLY runs them)
export const POST = withHandler(async (request: NextRequest) =>
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const { data: suite, error } = await supabase
    .from("test_suites").select("*, projects(base_url)").eq("id", id).single();

  if (error || !suite) return NextResponse.json({ error: "Suite not found" }, { status: 404 });
  if (!suite.test_case_ids || suite.test_case_ids.length === 0) {
    return NextResponse.json({ error: "Suite has no tests" }, { status: 400 });
  }

  const allResults: Array<{ test_id: string; run_id: string; status: string; duration_ms: number }> = [];

  for (const testCaseId of suite.test_case_ids) {
    const { data: testCase } = await supabase
      .from("test_cases").select("*, test_steps(*)").eq("id", testCaseId).single();

    if (!testCase || !testCase.test_steps?.length) continue;

    const env = {
      browser: body.browser || "chromium",
      viewport: { width: 1280, height: 720 },
      base_url: suite.projects?.base_url || "",
    };

    const { data: run } = await supabase
      .from("test_runs").insert({
        test_case_id: testCaseId, test_suite_id: id,
        status: "running", environment: env, triggered_by: "suite",
      }).select().single();

    if (!run) continue;

    try {
      const steps = testCase.test_steps.map((s: Record<string, unknown>) => ({
        id: s.id, order_index: s.order_index, action_type: s.action_type,
        target: s.target || { selector: "", fallback_selectors: {}, description: "" },
        input_data: s.input_data, expected_result: s.expected_result,
      }));

      const { results } = await runTest(steps, env, supabase, run.id);

      for (const result of results) {
        await supabase.from("test_run_results").insert({
          test_run_id: run.id, step_id: result.step_id, status: result.status,
          screenshot_url: result.screenshot_url, error_message: result.error_message,
          heal_action: result.heal_action, duration_ms: result.duration_ms,
        });
      }

      const hasFailures = results.some(r => r.status === "failed");
      const hasHealed = results.some(r => r.status === "healed");
      const totalDuration = results.reduce((sum, r) => sum + r.duration_ms, 0);
      const finalStatus = hasFailures ? "failed" : hasHealed ? "healed" : "passed";

      await supabase.from("test_runs").update({
        status: finalStatus, completed_at: new Date().toISOString(), duration_ms: totalDuration,
      }).eq("id", run.id);

      allResults.push({ test_id: testCaseId, run_id: run.id, status: finalStatus, duration_ms: totalDuration });
    } catch {
      await supabase.from("test_runs").update({
        status: "failed", completed_at: new Date().toISOString(),
      }).eq("id", run.id);
      allResults.push({ test_id: testCaseId, run_id: run.id, status: "failed", duration_ms: 0 });
    }
  }

  const passed = allResults.filter(r => r.status === "passed" || r.status === "healed").length;

  return NextResponse.json({
    data: {
      suite_id: id, total_tests: allResults.length, passed, failed: allResults.length - passed,
      pass_rate: allResults.length > 0 ? Math.round((passed / allResults.length) * 100) : 0,
      results: allResults,
    },
  }, { status: 201 });
}
