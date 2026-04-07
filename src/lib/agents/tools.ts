// ===========================================
// TESTARA — Agent Tool Registry
// What agents CAN and CANNOT do
// ===========================================

import type { AgentTool, AgentContext } from "./types";
import { logger } from "@/lib/core/logger";

// ===== TOOL REGISTRY =====
class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();

  register(tool: AgentTool): void { this.tools.set(tool.name, tool); }
  get(name: string): AgentTool | undefined { return this.tools.get(name); }
  getAll(): AgentTool[] { return Array.from(this.tools.values()); }
  getByCategory(cat: string): AgentTool[] { return this.getAll().filter(t => t.category === cat); }

  async execute(toolName: string, args: Record<string, unknown>, context: AgentContext): Promise<Record<string, unknown>> {
    const tool = this.get(toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);
    if (tool.category === "forbidden") throw new Error(`Tool ${toolName} is forbidden`);

    logger.info("agent.tool_execute", { tool: toolName, category: tool.category, risk: tool.riskLevel });
    return tool.execute(args, context);
  }
}

export const toolRegistry = new ToolRegistry();

// ===== READ-ONLY TOOLS (no approval needed) =====

toolRegistry.register({
  name: "browser_navigate",
  description: "Navigate to a URL",
  category: "read", riskLevel: "none", requiresApproval: false,
  parameters: { url: { type: "string", required: true, description: "URL to navigate to" } },
  execute: async (args, ctx) => {
    ctx.memory.visitedPages.push(args.url as string);
    ctx.onLog(`Navigating to ${args.url}`);
    return { navigated: true, url: args.url };
  },
});

toolRegistry.register({
  name: "browser_get_elements",
  description: "Get all interactive elements on the current page",
  category: "read", riskLevel: "none", requiresApproval: false,
  parameters: { pageUrl: { type: "string", required: true, description: "Page URL" } },
  execute: async (args, ctx) => {
    const { data } = await ctx.supabase.from("object_repository").select("logical_name, fingerprint, page_name")
      .eq("project_id", ctx.projectId).limit(50);
    const elements = (data || []).map((e: Record<string, unknown>) => ({
      name: e.logical_name, page: e.page_name,
      selector: ((e.fingerprint as Record<string, unknown>)?.meta as Record<string, string>)?.recommended_selector || "",
    }));
    elements.forEach((el: Record<string, string>) => ctx.memory.discoveredElements.push(el));
    return { elements, count: elements.length };
  },
});

toolRegistry.register({
  name: "browser_screenshot",
  description: "Take a screenshot of the current page",
  category: "read", riskLevel: "none", requiresApproval: false,
  parameters: {},
  execute: async (_args, ctx) => {
    ctx.onLog("Capturing screenshot");
    return { captured: true };
  },
});

toolRegistry.register({
  name: "db_get_tests",
  description: "Get existing test cases for a project",
  category: "read", riskLevel: "none", requiresApproval: false,
  parameters: { projectId: { type: "string", required: true, description: "Project ID" } },
  execute: async (args, ctx) => {
    const { data } = await ctx.supabase.from("test_cases").select("id, title, status, priority, tags")
      .eq("project_id", args.projectId as string).order("created_at", { ascending: false }).limit(50);
    return { tests: data || [], count: (data || []).length };
  },
});

toolRegistry.register({
  name: "db_get_run_history",
  description: "Get execution history for a test case",
  category: "read", riskLevel: "none", requiresApproval: false,
  parameters: { testId: { type: "string", required: true, description: "Test case ID" } },
  execute: async (args, ctx) => {
    const { data } = await ctx.supabase.from("test_runs").select("status, duration_ms, created_at")
      .eq("test_case_id", args.testId as string).order("created_at", { ascending: false }).limit(20);
    return { runs: data || [], count: (data || []).length };
  },
});

toolRegistry.register({
  name: "db_get_failures",
  description: "Get recent test failures for a project",
  category: "read", riskLevel: "none", requiresApproval: false,
  parameters: { projectId: { type: "string", required: true, description: "Project ID" } },
  execute: async (args, ctx) => {
    const { data } = await ctx.supabase.from("test_runs")
      .select("status, test_cases!inner(title, project_id), test_run_results(error_message)")
      .eq("test_cases.project_id", args.projectId as string).eq("status", "failed")
      .order("created_at", { ascending: false }).limit(20);
    return { failures: data || [], count: (data || []).length };
  },
});

toolRegistry.register({
  name: "ai_analyze",
  description: "Ask AI to analyze data and return insights",
  category: "read", riskLevel: "none", requiresApproval: false,
  parameters: {
    prompt: { type: "string", required: true, description: "Analysis prompt" },
    context: { type: "string", required: false, description: "Additional context" },
  },
  execute: async (args, ctx) => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 800,
      system: "You are Testara AI, a QA expert. Analyze the data and return actionable insights. Return ONLY valid JSON.",
      messages: [{ role: "user", content: `${args.prompt}\n\n${args.context || ""}` }],
    });
    ctx.session.spent.claudeCalls++;
    ctx.session.spent.tokens += response.usage.input_tokens + response.usage.output_tokens;
    ctx.session.spent.costInr += COST_PER_CALL_INR;
    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    try { return JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { return { raw: text }; }
  },
});

toolRegistry.register({
  name: "ai_generate_tests",
  description: "Generate test cases from a description or page analysis",
  category: "read", riskLevel: "none", requiresApproval: false,
  parameters: {
    description: { type: "string", required: true, description: "What to test" },
    pageContext: { type: "string", required: false, description: "Page HTML or element list" },
    existingTests: { type: "string", required: false, description: "Existing tests to avoid duplicates" },
  },
  execute: async (args, ctx) => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 2000,
      system: `You are Testara AI. Generate test cases as JSON array. Each test: { "title", "description", "type": "happy_path|negative|edge_case|security", "priority": "critical|high|medium|low", "steps": [{ "order_index", "action_type", "target": { "selector", "fallback_selectors": {}, "description" }, "input_data", "expected_result" }] }. Use smart locators (getByRole, getByLabel, getByPlaceholder). Avoid duplicating existing tests.`,
      messages: [{ role: "user", content: `Generate tests for: ${args.description}\n\n${args.pageContext || ""}\n\nExisting tests to avoid duplicating:\n${args.existingTests || "none"}` }],
    });
    ctx.session.spent.claudeCalls++;
    ctx.session.spent.tokens += response.usage.input_tokens + response.usage.output_tokens;
    ctx.session.spent.costInr += COST_PER_CALL_INR * 2;
    const text = response.content[0].type === "text" ? response.content[0].text : "[]";
    try {
      const tests = JSON.parse(text.replace(/```json|```/g, "").trim());
      return { tests: Array.isArray(tests) ? tests : [tests], count: Array.isArray(tests) ? tests.length : 1 };
    } catch { return { tests: [], count: 0, raw: text }; }
  },
});

// ===== WRITE TOOLS (approval required) =====

toolRegistry.register({
  name: "db_create_test",
  description: "Save a new test case to the database",
  category: "write", riskLevel: "medium", requiresApproval: true,
  parameters: {
    title: { type: "string", required: true, description: "Test title" },
    test: { type: "object", required: true, description: "Full test case object" },
  },
  execute: async (args, ctx) => {
    const test = args.test as Record<string, unknown>;
    const { data, error } = await ctx.supabase.from("test_cases").insert({
      project_id: ctx.projectId, title: args.title, description: test.description,
      status: "draft", priority: test.priority || "medium", created_by: ctx.userId,
      ai_generated: true, tags: [], version: 1,
    }).select().single();
    if (error) throw new Error(error.message);

    // Insert steps
    const steps = (test.steps as Array<Record<string, unknown>> || []);
    if (steps.length > 0) {
      await ctx.supabase.from("test_steps").insert(steps.map((s, i) => ({
        test_case_id: data.id, order_index: (s.order_index as number) ?? i + 1,
        action_type: s.action_type, target: s.target || { selector: "", fallback_selectors: {}, description: "" },
        input_data: s.input_data || null, expected_result: s.expected_result || null,
      })));
    }
    ctx.memory.generatedTests.push({ title: args.title as string, status: "saved" });
    return { testId: data.id, title: args.title, steps: steps.length };
  },
});

toolRegistry.register({
  name: "db_update_test",
  description: "Update an existing test case",
  category: "write", riskLevel: "medium", requiresApproval: true,
  parameters: {
    testId: { type: "string", required: true, description: "Test ID" },
    updates: { type: "object", required: true, description: "Fields to update" },
  },
  execute: async (args, ctx) => {
    await ctx.supabase.from("test_cases").update(args.updates as Record<string, unknown>).eq("id", args.testId);
    return { updated: true, testId: args.testId };
  },
});

toolRegistry.register({
  name: "db_delete_test",
  description: "Delete a test case",
  category: "write", riskLevel: "high", requiresApproval: true,
  parameters: { testId: { type: "string", required: true, description: "Test ID" } },
  execute: async (args, ctx) => {
    await ctx.supabase.from("test_steps").delete().eq("test_case_id", args.testId);
    await ctx.supabase.from("test_runs").delete().eq("test_case_id", args.testId);
    await ctx.supabase.from("test_cases").delete().eq("id", args.testId);
    return { deleted: true, testId: args.testId };
  },
});

// ===== EXECUTE TOOLS =====

toolRegistry.register({
  name: "runner_execute_test",
  description: "Run a test case with Playwright",
  category: "execute", riskLevel: "medium", requiresApproval: true,
  parameters: { testId: { type: "string", required: true, description: "Test case ID" } },
  execute: async (args, ctx) => {
    ctx.session.spent.testRuns++;
    ctx.session.spent.costInr += COST_PER_TEST_RUN_INR;
    // Delegate to existing run API
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/tests/${args.testId}/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browser: "chromium" }),
    });
    return res.json();
  },
});

toolRegistry.register({
  name: "jira_create_bug",
  description: "Create a Jira bug ticket",
  category: "write", riskLevel: "high", requiresApproval: true,
  parameters: {
    summary: { type: "string", required: true, description: "Bug summary" },
    description: { type: "string", required: true, description: "Bug description" },
  },
  execute: async (args, ctx) => {
    ctx.onLog(`Would create Jira bug: ${args.summary}`);
    return { created: true, summary: args.summary };
  },
});

toolRegistry.register({
  name: "slack_notify",
  description: "Send a Slack notification",
  category: "write", riskLevel: "low", requiresApproval: false,
  parameters: { message: { type: "string", required: true, description: "Message text" } },
  execute: async (args, ctx) => {
    if (process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `[Testara Agent] ${args.message}` }),
      }).catch(() => {});
    }
    return { sent: true };
  },
});

const COST_PER_CALL_INR = 2.5;
const COST_PER_TEST_RUN_INR = 0.5;
