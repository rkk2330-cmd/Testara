import type { AgentConfig, AgentContext, AgentTask } from "../types";

// Guardian Agent: Monitors app → detects changes → alerts before tests break
export async function planGuardian(config: AgentConfig, context: AgentContext): Promise<AgentTask[]> {
  const tasks: AgentTask[] = [];
  let taskIndex = 0;

  const task = (desc: string, tool: string, args: Record<string, unknown>, approval = false, risk: "none" | "low" | "medium" = "none"): AgentTask => ({
    id: `task_${taskIndex++}`, description: desc, toolName: tool,
    toolArgs: args, riskLevel: risk, requiresApproval: approval, status: "pending",
  });

  const { data: project } = await context.supabase
    .from("projects").select("base_url").eq("id", config.projectId).single();
  const baseUrl = project?.base_url || config.goal;

  // 1. Navigate to app and capture current state
  tasks.push(task(`Navigate to ${baseUrl}`, "browser_navigate", { url: baseUrl }));

  // 2. Get current elements
  tasks.push(task("Scan current page elements", "browser_get_elements", { pageUrl: baseUrl }));

  // 3. Take current screenshot (for visual comparison)
  tasks.push(task("Capture current state screenshot", "browser_screenshot", {}));

  // 4. Load Object Repository (last known good state)
  tasks.push(task("Load Object Repository baseline", "db_get_tests", { projectId: config.projectId }));

  // 5. AI: Compare current state vs baseline — detect drift
  tasks.push(task(
    "AI: Detect application drift from baseline",
    "ai_analyze",
    {
      prompt: `Compare the current application state against the known baseline from the Object Repository.

Detect:
1. Elements that exist in tests but are missing from the page (broken selectors)
2. New elements that aren't tested (coverage gap)
3. Elements that moved or changed attributes (need locator update)
4. New pages or flows detected (need new tests)
5. Removed pages or flows (tests should be archived)

Return JSON: {
  "drift": {
    "missingElements": [{"name":"...","lastKnownSelector":"...","testsThatUseIt":["..."]}],
    "newElements": [{"name":"...","type":"...","suggestedTest":"..."}],
    "changedElements": [{"name":"...","oldSelector":"...","suggestedNewSelector":"..."}],
    "newPages": ["..."],
    "removedPages": ["..."]
  },
  "riskLevel": "none|low|medium|high|critical",
  "impactedTests": N,
  "recommendations": ["..."]
}`,
      context: "Current elements and Object Repo will be injected",
    }
  ));

  // 6. AI: Generate proactive fix proposals
  tasks.push(task(
    "AI: Generate proactive fix proposals for detected drift",
    "ai_analyze",
    {
      prompt: `Based on the detected drift, create specific fix proposals:
1. For missing elements: suggest updated selectors
2. For new elements: suggest new test cases
3. For changed elements: suggest locator updates
4. For new pages: suggest test coverage plan

Return JSON: { "proposals": [{
  "type": "update_selector|create_test|archive_test|update_step",
  "target": "test_id or element_name",
  "description": "What to change",
  "details": {...},
  "priority": "critical|high|medium|low",
  "confidence": 0.0-1.0
}]}`,
      context: "Drift analysis will be injected",
    }
  ));

  // 7. Apply critical fixes (requires approval)
  tasks.push(task(
    "Apply proactive element updates",
    "db_update_test",
    { testId: "from_proposals", updates: {} },
    true, "medium"
  ));

  // 8. Notify team of drift detected
  tasks.push(task(
    "Notify team about detected application changes",
    "slack_notify",
    { message: "Guardian detected application changes. Review proposals in Agent Dashboard." }
  ));

  return tasks;
}
