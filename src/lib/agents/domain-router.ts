// ===========================================
// TESTARA — Agent Domain Router
// Detects project type → routes agents to
// domain-specific planning
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentConfig, AgentContext, AgentTask } from "./types";
import { logger } from "@/lib/core/logger";

export type ProjectDomain = "web" | "api" | "mainframe" | "hybrid";

// ===== DETECT PROJECT DOMAIN =====
export async function detectProjectDomain(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectDomain> {
  const { data: project } = await supabase
    .from("projects").select("base_url, name, description").eq("id", projectId).single();

  if (!project) return "web"; // default

  const url = (project.base_url || "").toLowerCase();
  const name = (project.name || "").toLowerCase();
  const desc = (project.description || "").toLowerCase();
  const combined = `${url} ${name} ${desc}`;

  // Mainframe signals
  if (combined.match(/mainframe|tn3270|tn5250|cics|ims|as400|iseries|cobol|jcl|vtam/)) return "mainframe";

  // API signals
  if (combined.match(/swagger|openapi|api\.|\/api\/|graphql|grpc|rest\s*api|postman|endpoint/)) return "api";
  if (url.match(/\/api\/|\/v[0-9]+\/|swagger|openapi/)) return "api";

  // Hybrid signals (has both web UI and API)
  if (combined.match(/full.?stack|web.*api|api.*web|backend.*frontend/)) return "hybrid";

  return "web"; // default
}

// ===== TASK FACTORY =====
let taskCounter = 0;

export function createTask(
  desc: string, tool: string, args: Record<string, unknown>,
  approval = false, risk: "none" | "low" | "medium" | "high" = "none"
): AgentTask {
  return {
    id: `task_${taskCounter++}`, description: desc, toolName: tool,
    toolArgs: args, riskLevel: risk, requiresApproval: approval, status: "pending",
  };
}

export function resetTaskCounter(): void { taskCounter = 0; }

// ===== DOMAIN-SPECIFIC SCOUT PLANS =====

export function planScoutWeb(baseUrl: string, projectName: string): AgentTask[] {
  return [
    createTask(`Navigate to ${baseUrl}`, "browser_navigate", { url: baseUrl }),
    createTask("Scan page elements", "browser_get_elements", { pageUrl: baseUrl }),
    createTask("Screenshot landing page", "browser_screenshot", {}),
    createTask("AI: Analyze pages and suggest exploration paths", "ai_analyze", {
      prompt: `Analyze web application at ${baseUrl}. Project: "${projectName}". Suggest top 5-8 pages to explore and critical user flows. Return JSON: { "pages": [], "flows": [{"name","steps","priority"}], "appType": "" }`,
    }),
    createTask("Load existing tests for gap analysis", "db_get_tests", { projectId: "" }),
    createTask("AI: Generate application map", "ai_analyze", {
      prompt: `Create application map. Return JSON: { "applicationMap": {"totalPages":N,"pages":[{"url","purpose","elements"}]}, "recommendedFlows": [{"name","priority","estimatedTests","description"}], "testStrategy": "" }`,
    }),
  ];
}

export function planScoutApi(baseUrl: string, projectName: string): AgentTask[] {
  return [
    createTask("AI: Discover API endpoints from base URL", "ai_analyze", {
      prompt: `Analyze API at ${baseUrl}. Project: "${projectName}". Try to find OpenAPI/Swagger spec at common paths (/swagger.json, /openapi.json, /api-docs, /v1/docs). List all discoverable endpoints. Return JSON: { "specUrl": "url or null", "discoveredEndpoints": [{"method","path","description"}], "authType": "bearer|basic|apikey|none", "apiType": "REST|GraphQL|gRPC" }`,
    }),
    createTask("Load existing API tests", "db_get_tests", { projectId: "" }),
    createTask("AI: Map API relationships and suggest test chains", "ai_analyze", {
      prompt: `Based on discovered endpoints, identify: 1) CRUD groups (users, orders, etc.), 2) Auth flow, 3) Dependency chains (POST creates → GET retrieves), 4) Rate limits/pagination. Return JSON: { "resourceGroups": [{"name","endpoints":[]}], "chains": [{"name","steps":[]}], "authFlow": [], "coverage_gaps": [] }`,
    }),
    createTask("AI: Generate API test strategy", "ai_analyze", {
      prompt: `Create API testing strategy. Return JSON: { "totalEndpoints": N, "testableEndpoints": N, "estimatedTests": N, "priority": [{"endpoint","reason","testCount"}], "strategy": "2-3 sentences" }`,
    }),
  ];
}

export function planScoutMainframe(host: string, projectName: string): AgentTask[] {
  return [
    createTask(`AI: Analyze mainframe application at ${host}`, "ai_analyze", {
      prompt: `Mainframe application: "${projectName}" at ${host}. This is a TN3270/TN5250 terminal application. Suggest: 1) Common screen flow (login → menu → transactions), 2) Key transactions to test, 3) Data entry screens, 4) Report screens. Return JSON: { "applicationFlow": [{"screen","purpose","fields"}], "criticalTransactions": [{"name","priority","screens"}], "testStrategy": "" }`,
    }),
    createTask("Load existing mainframe tests", "db_get_tests", { projectId: "" }),
    createTask("AI: Generate mainframe test plan", "ai_analyze", {
      prompt: `Create mainframe testing strategy. Identify: 1) Login/auth flow, 2) Critical business transactions, 3) Navigation paths, 4) Error recovery scenarios, 5) Data validation screens. Return JSON: { "flows": [{"name","screens","priority"}], "estimatedTests": N, "strategy": "" }`,
    }),
  ];
}

// ===== DOMAIN-SPECIFIC BUILDER PLANS =====

export function planBuilderWeb(goal: string, projectId: string): AgentTask[] {
  return [
    createTask("Load existing tests to avoid duplicates", "db_get_tests", { projectId }),
    createTask("Load known elements and selectors", "browser_get_elements", { pageUrl: goal }),
    createTask("Load failure history", "db_get_failures", { projectId }),
    createTask(`AI: Generate web test cases for "${goal}"`, "ai_generate_tests", {
      description: goal, pageContext: "", existingTests: "",
    }),
    createTask("AI: Validate test logic", "ai_analyze", {
      prompt: "Review generated tests for logic issues. Return JSON: { 'issues': [], 'quality_score': 0-100 }",
    }),
    createTask("Save generated tests", "db_create_test", { title: "Generated by Builder", test: {} }, true, "medium"),
  ];
}

export function planBuilderApi(goal: string, projectId: string): AgentTask[] {
  return [
    createTask("Load existing API tests", "db_get_tests", { projectId }),
    createTask(`AI: Generate API test suite for "${goal}"`, "ai_analyze", {
      prompt: `Generate comprehensive API tests for: ${goal}. Include: 1) Happy path with valid data, 2) Negative tests (400/422), 3) Auth tests (401/403), 4) Edge cases (empty body, max length, special chars), 5) Chained flows. Return JSON array of tests with: name, method, url, headers, body, assertions, category, extract variables.`,
    }),
    createTask("AI: Generate test data for API requests", "ai_analyze", {
      prompt: "Generate valid and invalid request bodies for each endpoint. Return JSON: { valid: [], invalid: [{data, reason}] }",
    }),
    createTask("AI: Validate API test coverage", "ai_analyze", {
      prompt: "Check: all HTTP methods tested? All status codes covered? Auth flow tested? Rate limits? Pagination? Contract tests? Return JSON: { coverage_score: 0-100, gaps: [] }",
    }),
    createTask("Save API tests", "db_create_test", { title: "API tests by Builder", test: {} }, true, "medium"),
  ];
}

export function planBuilderMainframe(goal: string, projectId: string): AgentTask[] {
  return [
    createTask("Load existing mainframe tests", "db_get_tests", { projectId }),
    createTask(`AI: Generate mainframe test flow for "${goal}"`, "ai_analyze", {
      prompt: `Generate a complete mainframe test flow for: ${goal}. Each step: { action: "type|send_key|wait|assert", target: {row, col, field_name}, value, key, expected }. Include: 1) Login, 2) Navigation to target screen, 3) Data entry, 4) Verification, 5) Error scenarios (wrong input, locked record), 6) Cleanup/logout. Return JSON array.`,
    }),
    createTask("AI: Generate mainframe test data", "ai_analyze", {
      prompt: "Generate valid and invalid test data for mainframe fields. Respect fixed-width fields, uppercase convention, and domain-specific formats (dates, amounts, codes). Return JSON: { valid: [], invalid: [{data, reason}] }",
    }),
    createTask("AI: Map field positions to logical names", "ai_analyze", {
      prompt: "Map row/col positions to logical field names. Return JSON: [{logicalName, row, col, length, dataType, validation}]",
    }),
    createTask("Save mainframe tests", "db_create_test", { title: "Mainframe tests by Builder", test: {} }, true, "medium"),
  ];
}

// ===== DOMAIN-SPECIFIC RUNNER PLANS =====

export function planRunnerApi(projectId: string): AgentTask[] {
  return [
    createTask("Load API tests", "db_get_tests", { projectId }),
    createTask("AI: Prioritize API tests (failed first, auth tests early)", "ai_analyze", {
      prompt: "Prioritize API test execution: 1) auth tests first (if auth fails, nothing works), 2) previously failed, 3) high priority, 4) CRUD order (create before read). Return JSON: { executionOrder: [{testId, reason}] }",
    }),
    createTask("Execute API test suite", "runner_execute_test", { testId: "batch" }, true, "medium"),
    createTask("AI: Analyze API failures — classify as bug/contract-break/data/auth/rate-limit", "ai_analyze", {
      prompt: "For each API failure, determine: root cause, category (bug/contract_break/auth/data/rate_limit/timeout), suggested fix, whether response schema changed (contract test). Return JSON analysis.",
    }),
    createTask("AI: Detect API anomalies (performance, schema drift)", "ai_analyze", {
      prompt: "Analyze response times, status codes, body sizes across runs. Detect: performance degradation, new error codes, schema changes, missing fields. Return JSON: { anomalies: [{endpoint, type, severity, detail}] }",
    }),
    createTask("Create bug reports for API issues", "jira_create_bug", { summary: "API bug", description: "" }, true, "high"),
  ];
}

export function planRunnerMainframe(projectId: string): AgentTask[] {
  return [
    createTask("Load mainframe tests", "db_get_tests", { projectId }),
    createTask("AI: Prioritize mainframe test execution", "ai_analyze", {
      prompt: "Prioritize mainframe test execution: 1) Login/auth first, 2) Critical transactions, 3) Data entry, 4) Reports, 5) Error scenarios. Return JSON: { executionOrder: [{testId, reason}] }",
    }),
    createTask("Execute mainframe tests", "runner_execute_test", { testId: "batch" }, true, "medium"),
    createTask("AI: Analyze mainframe failures — screen mismatch/field error/timeout/lock", "ai_analyze", {
      prompt: "For each mainframe failure: was it wrong screen (navigation error), field validation (bad data), timeout (slow response), record lock (concurrent access), or session drop? Suggest recovery. Return JSON analysis.",
    }),
    createTask("AI: Suggest error recovery for failed mainframe steps", "ai_analyze", {
      prompt: "For each failure, suggest recovery: which keys to press, whether to re-login, whether to retry with different data. Return JSON: [{testId, recovery: [{action, key, description}]}]",
    }),
  ];
}

// ===== DOMAIN-SPECIFIC HEALER PLANS =====

export function planHealerApi(projectId: string): AgentTask[] {
  return [
    createTask("Find failed API tests", "db_get_failures", { projectId }),
    createTask("AI: Diagnose API test failures", "ai_analyze", {
      prompt: `For each failing API test, diagnose:
1. URL changed? → update endpoint path
2. Schema changed? → update assertions  
3. Auth mechanism changed? → update auth config
4. New required field? → update request body
5. Rate limited? → add retry/delay
Return JSON: { healingPlan: [{testId, diagnosis, fix: {type, details}, confidence}] }`,
    }),
    createTask("Apply API test fixes", "db_update_test", { testId: "", updates: {} }, true, "medium"),
    createTask("Re-run healed API tests", "runner_execute_test", { testId: "healed" }, true, "medium"),
  ];
}

export function planHealerMainframe(projectId: string): AgentTask[] {
  return [
    createTask("Find failed mainframe tests", "db_get_failures", { projectId }),
    createTask("AI: Diagnose mainframe test failures", "ai_analyze", {
      prompt: `For each failing mainframe test, diagnose:
1. Screen layout changed? → update field positions (row/col)
2. Menu option moved? → update navigation step
3. New mandatory field added? → add data entry step  
4. Error message changed? → update assertion text
5. Session handling changed? → update login/logout flow
Return JSON: { healingPlan: [{testId, diagnosis, fix: {type, details}, confidence}] }`,
    }),
    createTask("AI: Re-map changed field positions", "ai_analyze", {
      prompt: "For fields that moved, determine new row/col positions by analyzing current screen layout. Return JSON: [{field, oldPos: {row,col}, newPos: {row,col}}]",
    }),
    createTask("Apply mainframe test fixes", "db_update_test", { testId: "", updates: {} }, true, "medium"),
  ];
}

// ===== LOG DOMAIN DETECTION =====
export function logDomainRouting(agentType: string, domain: ProjectDomain): void {
  logger.info("agent.domain_routed", { agentType, domain });
}
