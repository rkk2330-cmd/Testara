import type { AgentConfig, AgentContext, AgentTask } from "../types";

// Analyst Agent: Analyzes history → finds trends → detects flaky → reports
export async function planAnalyst(config: AgentConfig, context: AgentContext): Promise<AgentTask[]> {
  const tasks: AgentTask[] = [];
  let taskIndex = 0;

  const task = (desc: string, tool: string, args: Record<string, unknown>): AgentTask => ({
    id: `task_${taskIndex++}`, description: desc, toolName: tool,
    toolArgs: args, riskLevel: "none", requiresApproval: false, status: "pending",
  });

  // 1. Load all tests
  tasks.push(task("Load all test cases", "db_get_tests", { projectId: config.projectId }));

  // 2. Load failure history
  tasks.push(task("Load failure history", "db_get_failures", { projectId: config.projectId }));

  // 3. AI: Detect flaky tests from run patterns
  tasks.push(task(
    "AI: Detect flaky tests from execution patterns",
    "ai_analyze",
    {
      prompt: `Analyze the test execution history to detect flaky tests. A test is flaky if it alternates between pass/fail without code changes. For each test with enough history (5+ runs), calculate:
- Flaky rate (% of status flips between consecutive runs)
- Pattern (e.g., ✓✗✓✓✗✓✗ = flaky)
- Likely cause (timing, data dependency, race condition, external service)

Return JSON: { "flakyTests": [{"testId":"...","title":"...","flakyRate":N,"pattern":"...","likelyCause":"...","recommendation":"..."}], "stableTests": N, "totalAnalyzed": N }`,
      context: "Run history will be injected",
    }
  ));

  // 4. AI: Coverage gap analysis
  tasks.push(task(
    "AI: Analyze test coverage gaps",
    "ai_analyze",
    {
      prompt: `Analyze the existing test suite for coverage gaps. Consider:
1. Are there tests for error/negative scenarios?
2. Are there edge case tests?
3. Are authentication/authorization flows tested?
4. Are there accessibility tests?
5. What user flows have no tests at all?
6. Which areas have the most failures (indicating insufficient testing)?

Return JSON: { "gaps": [{"area":"...","severity":"critical|high|medium|low","reason":"...","suggestedTests":N}], "coverageScore": 0-100, "strengths": ["..."], "weaknesses": ["..."] }`,
      context: "Existing tests and failures will be injected",
    }
  ));

  // 5. AI: Trend analysis (week-over-week)
  tasks.push(task(
    "AI: Analyze quality trends",
    "ai_analyze",
    {
      prompt: `Analyze the quality trends based on test execution data. Identify:
1. Is the pass rate improving or declining?
2. Are new failures appearing or old ones being fixed?
3. Is test suite maintenance keeping up with app changes?
4. Average time to fix broken tests

Return JSON: { "trends": { "passRateTrend": "improving|stable|declining", "newFailureRate": "low|medium|high", "maintenanceHealth": "good|needs_attention|critical", "avgTimeToFixDays": N }, "insights": ["..."], "recommendations": ["..."] }`,
      context: "Historical run data will be injected",
    }
  ));

  // 6. AI: Generate executive summary
  tasks.push(task(
    "AI: Generate quality report with executive summary",
    "ai_analyze",
    {
      prompt: `Based on all the analysis done, write a comprehensive quality report. Include:
1. Executive Summary (3-4 sentences for stakeholders)
2. Key Metrics (pass rate, flaky rate, coverage score)
3. Top Risks (things that need immediate attention)
4. Recommendations (prioritized action items)
5. Positive Highlights (what's going well)

Return JSON: { "executiveSummary": "...", "metrics": {...}, "topRisks": ["..."], "recommendations": ["..."], "highlights": ["..."] }`,
      context: "All previous analysis results will be injected",
    }
  ));

  return tasks;
}
