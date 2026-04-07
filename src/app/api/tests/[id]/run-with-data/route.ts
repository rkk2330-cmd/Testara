import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { runTest } from "@/lib/execution/runner";
import { resolveVariables, type VariableContext } from "@/lib/data/engine";

// POST /api/tests/[id]/run-with-data — execute test with parameterized data
export const POST = withHandler(async (request: NextRequest) =>
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { id } = await params;
  const formData = await request.formData();
  const dataFile = formData.get("data_file") as File | null;
  const browser = (formData.get("browser") as string) || "chromium";

  if (!dataFile) {
    return NextResponse.json({ error: "data_file (CSV) is required" }, { status: 400 });
  }

  // Parse CSV data
  const csvText = await dataFile.text();
  const lines = csvText.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV must have header row + at least 1 data row" }, { status: 400 });
  }

  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const dataRows = lines.slice(1).map(line => {
    const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ""; });
    return row;
  });

  // Fetch test case
  const { data: testCase } = await supabase
    .from("test_cases")
    .select("*, test_steps(*), projects(base_url)")
    .eq("id", id)
    .single();

  if (!testCase) return NextResponse.json({ error: "Test not found" }, { status: 404 });

  const allRuns = [];

  // Execute test once per data row
  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const dataRow = dataRows[rowIdx];

    // Replace {{variable}} placeholders in steps with data values + dynamic expressions
    const varContext: VariableContext = {
      dataRow: dataRow,
      environment: {
        BASE_URL: testCase.projects?.base_url || "",
      },
      projectVars: {
        name: testCase.projects?.name || "",
        base_url: testCase.projects?.base_url || "",
      },
    };

    const parameterizedSteps = testCase.test_steps.map((step: Record<string, unknown>) => ({
      ...step,
      input_data: resolveVariables(step.input_data, varContext),
      expected_result: resolveVariables(step.expected_result, varContext),
      target: {
        ...step.target,
        selector: resolveVariables(step.target?.selector, varContext),
      },
    }));

    // Create run
    const { data: run } = await supabase
      .from("test_runs")
      .insert({
        test_case_id: id,
        status: "running",
        started_at: new Date().toISOString(),
        environment: {
          browser,
          viewport: { width: 1280, height: 720 },
          base_url: testCase.projects?.base_url || "",
          variables: dataRow,
          data_row_index: rowIdx,
        },
        triggered_by: "manual",
      })
      .select()
      .single();

    if (!run) continue;

    // Execute
    const { results } = await runTest(parameterizedSteps, {
      browser: browser as unknown,
      viewport: { width: 1280, height: 720 },
      base_url: testCase.projects?.base_url || "",
    }, supabase, run.id);

    // Save results
    await supabase.from("test_run_results").insert(
      results.map(r => ({ test_run_id: run.id, step_id: r.step_id, status: r.status, screenshot_url: r.screenshot_url, error_message: r.error_message, heal_action: r.heal_action, duration_ms: r.duration_ms }))
    );

    const hasFailures = results.some(r => r.status === "failed");
    const hasHealed = results.some(r => r.status === "healed");
    const totalDuration = results.reduce((sum, r) => sum + r.duration_ms, 0);

    await supabase.from("test_runs").update({
      status: hasFailures ? "failed" : hasHealed ? "healed" : "passed",
      completed_at: new Date().toISOString(),
      duration_ms: totalDuration,
    }).eq("id", run.id);

    allRuns.push({ run_id: run.id, data_row: dataRow, status: hasFailures ? "failed" : "passed" });
  }

  return NextResponse.json({
    data: {
      total_rows: dataRows.length,
      runs: allRuns,
      passed: allRuns.filter(r => r.status === "passed").length,
      failed: allRuns.filter(r => r.status === "failed").length,
    },
  }, { status: 201 });
}

// Variable resolution handled by @/lib/data/engine.ts
