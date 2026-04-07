import type { AgentConfig, AgentContext, AgentTask } from "../types";
import { detectProjectDomain, resetTaskCounter, createTask, logDomainRouting, planHealerApi, planHealerMainframe } from "../domain-router";

export async function planHealer(config: AgentConfig, context: AgentContext): Promise<AgentTask[]> {
  resetTaskCounter();
  const domain = await detectProjectDomain(context.supabase, config.projectId);
  logDomainRouting("healer", domain);

  switch (domain) {
    case "api": return planHealerApi(config.projectId);
    case "mainframe": return planHealerMainframe(config.projectId);
    default: {
      // Web healer (original)
      return [
        createTask("Find failed tests", "db_get_failures", { projectId: config.projectId }),
        createTask("Load Object Repository", "browser_get_elements", { pageUrl: config.goal }),
        createTask("AI: Diagnose failures and create healing plan", "ai_analyze", {
          prompt: "For each failure: selector changed? timing? data? app change? flaky? Return JSON healing plan with fixes.",
        }),
        createTask("Apply healing fixes", "db_update_test", { testId: "", updates: {} }, true, "medium"),
        createTask("Re-run healed tests", "runner_execute_test", { testId: "healed" }, true, "medium"),
        createTask("AI: Generate healing summary", "ai_analyze", {
          prompt: "Summarize: how many broken, how many fixed, which need manual attention.",
        }),
      ];
    }
  }
}
