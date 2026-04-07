// ===========================================
// TESTARA — AI Intelligence Service
// The "brain" that connects AI to every feature
// Not a generator — an observer, learner, predictor
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/core/logger";

const MODEL = "claude-sonnet-4-6";

async function callAI(systemPrompt: string, userPrompt: string, maxTokens = 1000): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content[0].type === "text" ? response.content[0].text : "";
}

// ===== 1. SMART STEP SUGGESTIONS (for test editor) =====
export async function suggestNextStep(
  currentSteps: Array<{ action_type: string; target: { description: string }; input_data?: string }>,
  pageUrl: string
): Promise<Array<{ action_type: string; target_description: string; input_data?: string; reason: string }>> {
  const stepsStr = currentSteps.map((s, i) => `${i + 1}. ${s.action_type}: ${s.target.description} ${s.input_data ? `(${s.input_data})` : ""}`).join("\n");

  const result = await callAI(
    "You are a QA expert. Given a partial test case, suggest the next 2-3 logical steps. Return ONLY valid JSON array.",
    `Page: ${pageUrl}\nCurrent steps:\n${stepsStr}\n\nSuggest next steps as JSON: [{"action_type":"...","target_description":"...","input_data":"...","reason":"..."}]`,
    500
  );

  try { return JSON.parse(result.replace(/```json|```/g, "").trim()); } catch { return []; }
}

// ===== 2. STEP VALIDATION (for test editor) =====
export async function validateTestLogic(
  steps: Array<{ action_type: string; target: { description: string }; input_data?: string; expected_result?: string }>
): Promise<Array<{ stepIndex: number; issue: string; severity: "error" | "warning" | "info"; suggestion: string }>> {
  const stepsStr = steps.map((s, i) => `${i + 1}. ${s.action_type}: ${s.target.description}`).join("\n");

  const result = await callAI(
    "You are a QA expert reviewing test steps for logical issues. Find problems like: submitting without filling required fields, asserting before navigation completes, missing assertions after actions, redundant steps. Return ONLY valid JSON array.",
    `Review these test steps for logic issues:\n${stepsStr}\n\nReturn: [{"stepIndex":N,"issue":"...","severity":"error|warning|info","suggestion":"..."}]`,
    500
  );

  try { return JSON.parse(result.replace(/```json|```/g, "").trim()); } catch { return []; }
}

// ===== 3. FAILURE ANALYSIS (for run detail) =====
export async function analyzeFailure(
  testTitle: string,
  failedStep: { action_type: string; target: string; error_message: string },
  recentHistory: Array<{ date: string; status: string; error?: string }>,
  domContext?: string
): Promise<{ root_cause: string; category: string; suggestion: string; is_flaky: boolean; bug_report?: string }> {
  const historyStr = recentHistory.slice(-10).map(h => `${h.date}: ${h.status}${h.error ? ` (${h.error})` : ""}`).join("\n");

  const result = await callAI(
    "You are a senior QA engineer analyzing a test failure. Determine root cause, categorize it (regression/flaky/environment/data/element_change), suggest a fix, and determine if it's flaky. Return ONLY valid JSON.",
    `Test: ${testTitle}\nFailed step: ${failedStep.action_type} on "${failedStep.target}"\nError: ${failedStep.error_message}\n\nLast 10 runs:\n${historyStr}\n\n${domContext ? `DOM context: ${domContext.slice(0, 1000)}` : ""}\n\nReturn: {"root_cause":"...","category":"regression|flaky|environment|data|element_change","suggestion":"...","is_flaky":bool,"bug_report":"# Bug Report\\n..."}`,
    800
  );

  try { return JSON.parse(result.replace(/```json|```/g, "").trim()); } catch {
    return { root_cause: "Analysis failed", category: "unknown", suggestion: "Review manually", is_flaky: false };
  }
}

// ===== 4. DASHBOARD INSIGHTS (for dashboard) =====
export async function generateInsights(
  stats: { totalTests: number; passRate: number; failedTests: number; healedTests: number; flakyCount: number; lastRunDaysAgo: number; testsWithoutAssertions: number }
): Promise<Array<{ type: "warning" | "success" | "info" | "action"; message: string; priority: number }>> {
  // Rule-based insights (no AI call needed — instant, free)
  const insights: Array<{ type: "warning" | "success" | "info" | "action"; message: string; priority: number }> = [];

  if (stats.passRate < 70) insights.push({ type: "warning", message: `Pass rate is ${stats.passRate}% — below healthy threshold (80%). Focus on fixing the ${stats.failedTests} failing tests.`, priority: 1 });
  else if (stats.passRate >= 95) insights.push({ type: "success", message: `Excellent pass rate: ${stats.passRate}%. Your test suite is healthy.`, priority: 5 });

  if (stats.flakyCount > 0) insights.push({ type: "warning", message: `${stats.flakyCount} flaky test(s) detected. Flaky tests erode team trust — fix them first.`, priority: 2 });

  if (stats.lastRunDaysAgo > 3) insights.push({ type: "action", message: `Last test run was ${stats.lastRunDaysAgo} days ago. Run your regression suite to ensure nothing is broken.`, priority: 3 });

  if (stats.healedTests > 0) insights.push({ type: "info", message: `${stats.healedTests} test(s) self-healed this week. Review and approve the fixes.`, priority: 4 });

  if (stats.testsWithoutAssertions > 0) insights.push({ type: "warning", message: `${stats.testsWithoutAssertions} test(s) have no assertions — they run but verify nothing. Add assertions.`, priority: 3 });

  if (stats.totalTests < 5) insights.push({ type: "action", message: "You have fewer than 5 tests. Use AI Generator to quickly build coverage for your critical flows.", priority: 2 });

  return insights.sort((a, b) => a.priority - b.priority);
}

// ===== 5. EXECUTIVE SUMMARY (for reports) =====
export async function generateExecutiveSummary(
  stats: { totalRuns: number; passed: number; failed: number; healed: number; passRate: number; avgDuration: number; period: string },
  topFailures: Array<{ title: string; failCount: number }>
): Promise<string> {
  const failList = topFailures.slice(0, 5).map(f => `"${f.title}" (${f.failCount} failures)`).join(", ");

  const result = await callAI(
    "You are a QA manager writing a brief executive summary for stakeholders. Be concise — 3-4 sentences max. No jargon. Focus on quality trend, risk, and recommended actions.",
    `Period: ${stats.period}\nTotal runs: ${stats.totalRuns}\nPassed: ${stats.passed} | Failed: ${stats.failed} | Self-healed: ${stats.healed}\nPass rate: ${stats.passRate}%\nAvg duration: ${stats.avgDuration}ms\nTop failures: ${failList || "none"}\n\nWrite a 3-4 sentence executive summary.`,
    300
  );

  return result;
}

// ===== 6. TEST COVERAGE GAP DETECTION =====
export async function detectCoverageGaps(
  projectUrl: string,
  existingTests: Array<{ title: string; type: string }>
): Promise<Array<{ area: string; reason: string; priority: "high" | "medium" | "low"; suggested_test: string }>> {
  const testList = existingTests.map(t => `${t.title} (${t.type})`).join("\n");

  const result = await callAI(
    "You are a QA coverage analyst. Given a web application URL and existing test list, identify what's NOT tested but should be. Focus on: critical user flows, error handling, edge cases, accessibility, and security basics. Return ONLY valid JSON array.",
    `Application: ${projectUrl}\n\nExisting tests (${existingTests.length}):\n${testList}\n\nIdentify coverage gaps as JSON: [{"area":"...","reason":"...","priority":"high|medium|low","suggested_test":"..."}]`,
    600
  );

  try { return JSON.parse(result.replace(/```json|```/g, "").trim()); } catch { return []; }
}

// ===== 7. FLAKY TEST DETECTION (rule-based, no AI cost) =====
export async function detectFlakyTests(
  supabase: SupabaseClient
): Promise<Array<{ testId: string; title: string; flakyRate: number; pattern: string }>> {
  // Get all tests with their last 20 runs
  const { data: runs } = await supabase
    .from("test_runs")
    .select("test_case_id, status, test_cases(title)")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (!runs) return [];

  // Group by test case and calculate flaky rate
  const testRuns: Record<string, { title: string; statuses: string[] }> = {};
  for (const run of runs) {
    const id = run.test_case_id;
    if (!testRuns[id]) testRuns[id] = { title: (run as Record<string, unknown>).test_cases ? ((run as Record<string, unknown>).test_cases as Record<string, string>).title : "", statuses: [] };
    testRuns[id].statuses.push(run.status);
  }

  const flaky: Array<{ testId: string; title: string; flakyRate: number; pattern: string }> = [];
  for (const [testId, data] of Object.entries(testRuns)) {
    if (data.statuses.length < 5) continue; // Need at least 5 runs to detect

    const recent = data.statuses.slice(0, 20);
    let flips = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] !== recent[i - 1]) flips++;
    }
    const flakyRate = Math.round((flips / (recent.length - 1)) * 100);

    if (flakyRate > 30) { // More than 30% status changes = flaky
      const pattern = recent.slice(0, 10).map(s => s === "passed" ? "✓" : s === "failed" ? "✗" : "~").join("");
      flaky.push({ testId, title: data.title, flakyRate, pattern });
    }
  }

  return flaky.sort((a, b) => b.flakyRate - a.flakyRate);
}

// ===== 8. SMART TEST PRIORITIZATION (for CI/CD) =====
export function prioritizeTests(
  tests: Array<{ id: string; title: string; lastRunStatus: string; lastRunDate: string; failRate: number; avgDuration: number }>,
  changedFiles?: string[]
): Array<{ id: string; title: string; priority: number; reason: string }> {
  // Rule-based prioritization (instant, no AI cost)
  return tests.map(test => {
    let priority = 50; // Base priority
    const reasons: string[] = [];

    // Recently failed → run first
    if (test.lastRunStatus === "failed") { priority += 30; reasons.push("previously failed"); }

    // High fail rate → run first
    if (test.failRate > 20) { priority += 20; reasons.push(`${test.failRate}% fail rate`); }

    // Not run recently → run sooner
    const daysSinceRun = Math.round((Date.now() - new Date(test.lastRunDate).getTime()) / 86400000);
    if (daysSinceRun > 7) { priority += 10; reasons.push(`not run in ${daysSinceRun} days`); }

    // Fast tests first (for quick feedback)
    if (test.avgDuration < 5000) { priority += 5; reasons.push("fast execution"); }

    // If changed files provided, boost tests that match
    if (changedFiles?.length) {
      const titleLower = test.title.toLowerCase();
      const matchesChange = changedFiles.some(f => {
        const name = f.split("/").pop()?.replace(/\.\w+$/, "").toLowerCase() || "";
        return titleLower.includes(name);
      });
      if (matchesChange) { priority += 25; reasons.push("matches changed files"); }
    }

    return { id: test.id, title: test.title, priority, reason: reasons.join(", ") || "standard" };
  }).sort((a, b) => b.priority - a.priority);
}

// ===== 9. ONBOARDING INTELLIGENCE =====
export async function analyzeProjectUrl(url: string): Promise<{
  detectedPages: string[];
  suggestedFlows: Array<{ name: string; description: string; priority: string }>;
  testStrategy: string;
}> {
  const result = await callAI(
    "You are a QA strategist analyzing a web application. Identify the critical pages and user flows that need testing. Return ONLY valid JSON.",
    `Analyze this application URL and suggest a testing strategy: ${url}\n\nReturn: {"detectedPages":["login","dashboard","settings",...],"suggestedFlows":[{"name":"Login Flow","description":"...","priority":"critical|high|medium"}],"testStrategy":"2-3 sentence strategy"}`,
    500
  );

  try { return JSON.parse(result.replace(/```json|```/g, "").trim()); } catch {
    return { detectedPages: [], suggestedFlows: [], testStrategy: "Start with your most critical user flows." };
  }
}

// ===== 10. HEAL LEARNING (pattern tracking, no AI cost) =====
export async function getHealPatterns(
  supabase: SupabaseClient,
  projectId: string
): Promise<Array<{ pattern: string; frequency: number; recommendation: string }>> {
  const { data: heals } = await supabase
    .from("object_repository")
    .select("heal_history, fingerprint")
    .eq("project_id", projectId)
    .not("heal_history", "is", null);

  if (!heals) return [];

  const patterns: Record<string, number> = {};
  for (const entry of heals) {
    const history = entry.heal_history as Array<Record<string, string>> || [];
    for (const heal of history) {
      const pattern = `${heal.method}`;
      patterns[pattern] = (patterns[pattern] || 0) + 1;
    }
  }

  return Object.entries(patterns)
    .sort(([, a], [, b]) => b - a)
    .map(([pattern, frequency]) => ({
      pattern,
      frequency,
      recommendation: frequency > 5
        ? `"${pattern}" heals frequently — the application likely changes this element type often. Consider using a more stable locator strategy.`
        : `Occasional heals via "${pattern}" — normal maintenance.`,
    }));
}
