import { RunTestSchema } from "@/lib/core/validation";
import { withHandler } from "@/lib/core";
import { authorize } from "@/lib/security/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { runTest } from "@/lib/execution/runner";

// POST /api/tests/[id]/run — execute a test case with real Playwright
export const POST = withHandler(async (request: NextRequest) =>
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { id } = await params;
  const body = validate(RunTestSchema, await request.json());

  // Fetch test case + steps + project base URL
  const { data: testCase, error: tcError } = await supabase
    .from("test_cases")
    .select("*, test_steps(*), projects(base_url)")
    .eq("id", id)
    .single();

  if (tcError || !testCase) {
    return NextResponse.json({ error: "Test case not found" }, { status: 404 });
  }

  if (!testCase.test_steps || testCase.test_steps.length === 0) {
    return NextResponse.json({ error: "Test has no steps to execute" }, { status: 400 });
  }

  const environment = {
    browser: (body.browser || "chromium") as "chromium" | "firefox" | "webkit",
    viewport: body.viewport || { width: 1280, height: 720 },
    base_url: testCase.projects?.base_url || "",
  };

  // Create test run record
  const { data: run, error: runError } = await supabase
    .from("test_runs")
    .insert({
      test_case_id: id,
      status: "running",
      started_at: new Date().toISOString(),
      environment,
      triggered_by: body.triggered_by || "manual",
    })
    .select()
    .single();

  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 });

  try {
    // Execute test — real Playwright if available, simulated fallback
    const { results, real } = await runTest(
      testCase.test_steps,
      environment,
      supabase,
      run.id
    );

    // Insert step results
    const resultsToInsert = results.map((r) => ({
      test_run_id: run.id,
      step_id: r.step_id,
      status: r.status,
      screenshot_url: r.screenshot_url,
      error_message: r.error_message,
      heal_action: r.heal_action,
      duration_ms: r.duration_ms,
    }));

    await supabase.from("test_run_results").insert(resultsToInsert);

    // Calculate final status
    const hasFailures = results.some((r) => r.status === "failed");
    const hasHealed = results.some((r) => r.status === "healed");
    const totalDuration = results.reduce((sum, r) => sum + r.duration_ms, 0);
    const finalStatus = hasFailures ? "failed" : hasHealed ? "healed" : "passed";

    await supabase
      .from("test_runs")
      .update({ status: finalStatus, completed_at: new Date().toISOString(), duration_ms: totalDuration })
      .eq("id", run.id);

    // Trigger notification on failure or healed (async, non-blocking)
    if (finalStatus === "failed" || finalStatus === "healed") {
      fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cookie": request.headers.get("cookie") || "" },
        body: JSON.stringify({
          event: "test_run_completed",
          data: {
            run_id: run.id,
            test_name: testCase.title,
            status: finalStatus,
            duration_ms: totalDuration,
            error_message: results.find(r => r.status === "failed")?.error_message || null,
            triggered_by: body.triggered_by || "manual",
          },
        }),
      }).catch(() => {}); // Non-blocking — don't fail the run if notification fails
    }

    // Fetch complete run
    const { data: completeRun } = await supabase
      .from("test_runs")
      .select("*, test_run_results(*)")
      .eq("id", run.id)
      .single();

    return NextResponse.json({
      data: completeRun,
      meta: { execution_mode: real ? "playwright" : "simulated", steps_executed: results.length },
    }, { status: 201 });

  } catch (error) {
    await supabase.from("test_runs").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", run.id);
    return NextResponse.json({ error: "Execution failed: " + (error as Error).message, run_id: run.id }, { status: 500 });
  }
}
