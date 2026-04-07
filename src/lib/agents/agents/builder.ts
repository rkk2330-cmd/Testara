import type { AgentConfig, AgentContext, AgentTask } from "../types";
import { detectProjectDomain, planBuilderWeb, planBuilderApi, planBuilderMainframe, resetTaskCounter, logDomainRouting } from "../domain-router";

export async function planBuilder(config: AgentConfig, context: AgentContext): Promise<AgentTask[]> {
  resetTaskCounter();
  const domain = await detectProjectDomain(context.supabase, config.projectId);
  logDomainRouting("builder", domain);

  switch (domain) {
    case "api": return planBuilderApi(config.goal, config.projectId);
    case "mainframe": return planBuilderMainframe(config.goal, config.projectId);
    case "hybrid": return [...planBuilderWeb(config.goal, config.projectId), ...planBuilderApi(config.goal, config.projectId)];
    default: return planBuilderWeb(config.goal, config.projectId);
  }
}
