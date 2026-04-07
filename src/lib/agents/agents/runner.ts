import type { AgentConfig, AgentContext, AgentTask } from "../types";
import { detectProjectDomain, resetTaskCounter, createTask, logDomainRouting, planRunnerApi, planRunnerMainframe } from "../domain-router";

export async function planRunner(config: AgentConfig, context: AgentContext): Promise<AgentTask[]> {
  resetTaskCounter();
  const domain = await detectProjectDomain(context.supabase, config.projectId);
  logDomainRouting("runner", domain);

  switch (domain) {
    case "api": return planRunnerApi(config.projectId);
    case "mainframe": return planRunnerMainframe(config.projectId);
    case "hybrid": return [...planRunnerApi(config.projectId), ...planRunnerMainframe(config.projectId)];
    default: {
      // Web runner (original)
      return [
        createTask("Load test cases", "db_get_tests", { projectId: config.projectId }),
        createTask("Load run history for prioritization", "db_get_failures", { projectId: config.projectId }),
        createTask("AI: Determine optimal execution order", "ai_analyze", {
          prompt: "Prioritize: 1) previously failed, 2) high-priority, 3) not run recently. Return JSON: { executionOrder: [{testId, reason}] }",
        }),
        createTask("Execute test suite", "runner_execute_test", { testId: "batch" }, true, "medium"),
        createTask("AI: Analyze failures — classify as regression/flaky/env/element_change", "ai_analyze", {
          prompt: "For each failure: root cause, category, suggested fix, create bug? Return JSON analysis.",
        }),
        createTask("Create bug reports", "jira_create_bug", { summary: "", description: "" }, true, "high"),
        createTask("Send summary to Slack", "slack_notify", { message: "Test suite complete." }),
      ];
    }
  }
}
