import type { AgentConfig, AgentContext, AgentTask } from "../types";
import { detectProjectDomain, planScoutWeb, planScoutApi, planScoutMainframe, resetTaskCounter, logDomainRouting } from "../domain-router";

export async function planScout(config: AgentConfig, context: AgentContext): Promise<AgentTask[]> {
  resetTaskCounter();
  const domain = await detectProjectDomain(context.supabase, config.projectId);
  logDomainRouting("scout", domain);

  const { data: project } = await context.supabase
    .from("projects").select("base_url, name").eq("id", config.projectId).single();
  const baseUrl = project?.base_url || config.goal;
  const name = project?.name || "Unknown";

  switch (domain) {
    case "api": return planScoutApi(baseUrl, name);
    case "mainframe": return planScoutMainframe(baseUrl, name);
    case "hybrid": return [...planScoutWeb(baseUrl, name), ...planScoutApi(baseUrl, name)];
    default: return planScoutWeb(baseUrl, name);
  }
}
