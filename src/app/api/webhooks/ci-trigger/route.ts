import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { runTest } from "@/lib/execution/runner";

// POST /api/webhooks/ci-trigger — trigger test execution from CI/CD pipeline
export const POST = withHandler(async (request: NextRequest) => {
  const authHeader = request.headers.get("authorization");
  const apiKey = authHeader?.replace("Bearer ", "");

  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key in Authorization header" }, { status: 401 });
  }

  const supabase = await createServerSupabase();

  // Validate API key against integrations table
  const { data: integration } = await supabase
    .from("integrations")
    .select("*")
    .eq("status", "active")
    .single();

  if (!integration) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { suite_id, test_ids, browser } = body;

  if (!suite_id && !test_ids) {
    return NextResponse.json({ error: "Provide suite_id or test_ids" }, { status: 400 });
  }

  let testCaseIds: string[] = test_ids || [];
  if (suite_id) {
    const { data: suite } = await supabase.from("test_suites").select("test_case_ids").eq("id", suite_id).single();
    if (suite) testCaseIds = suite.test_case_ids;
  }

  const allResults: Array<{ test_id: string; run_id: string; status: string; duration_ms: number }> = [];

  for (const testId of testCaseIds) {
    const { data: testCase } = await supabase
      .from("test_cases")
      .select("*, test_steps(*), projects(base_url)")
      .eq("id", testId).single();

    if (!testCase?.test_steps?.length) continue;

    const env = {
      browser: browser || "chromium",
      viewport: { width: 1280, height: 720 },
      base_url: testCase.projects?.base_url || "",
    };

    const { data: run } = await supabase.from("test_runs").insert({
      test_case_id: testId, test_suite_id: suite_id || null,
      status: "running", environment: env, triggered_by: "ci",
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

      allResults.push({ test_id: testId, run_id: run.id, status: finalStatus, duration_ms: totalDuration });
    } catch {
      await supabase.from("test_runs").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", run.id);
      allResults.push({ test_id: testId, run_id: run.id, status: "failed", duration_ms: 0 });
    }
  }

  const passed = allResults.filter(r => r.status === "passed" || r.status === "healed").length;

  return NextResponse.json({
    data: {
      total: allResults.length, passed, failed: allResults.length - passed,
      pass_rate: allResults.length > 0 ? Math.round((passed / allResults.length) * 100) : 0,
      results: allResults,
    },
  }, { status: 201 });
}
