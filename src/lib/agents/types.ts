// ===========================================
// TESTARA — Agent Types
// ===========================================

export type AgentType = "scout" | "builder" | "runner" | "healer" | "analyst" | "guardian";
export type AgentStatus = "idle" | "planning" | "executing" | "waiting_approval" | "completed" | "failed" | "paused" | "cancelled";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "auto_approved" | "expired";
export type RiskLevel = "none" | "low" | "medium" | "high" | "blocked";
export type ToolCategory = "read" | "write" | "execute" | "forbidden";

// ===== AGENT SESSION =====
export interface AgentSession {
  id: string;
  agentType: AgentType;
  status: AgentStatus;
  goal: string;
  userId: string;
  orgId: string;
  projectId: string;

  // Execution tracking
  plan: AgentTask[];
  currentTaskIndex: number;
  completedTasks: AgentTaskResult[];

  // Budget
  budget: AgentBudget;
  spent: AgentSpend;

  // Proposals awaiting approval
  pendingProposals: AgentProposal[];
  resolvedProposals: AgentProposal[];

  // Memory
  shortTermMemory: Record<string, unknown>;
  observations: string[];

  // Timestamps
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// ===== TASK =====
export interface AgentTask {
  id: string;
  description: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_approval";
}

export interface AgentTaskResult {
  taskId: string;
  status: "completed" | "failed" | "skipped";
  output: Record<string, unknown>;
  duration_ms: number;
  tokensUsed: number;
  error?: string;
}

// ===== BUDGET =====
export interface AgentBudget {
  maxClaudeCalls: number;
  maxTokens: number;
  maxDurationMs: number;
  maxTestRuns: number;
  maxCostInr: number;
}

export interface AgentSpend {
  claudeCalls: number;
  tokens: number;
  durationMs: number;
  testRuns: number;
  costInr: number;
}

// ===== PROPOSALS (human-in-the-loop) =====
export interface AgentProposal {
  id: string;
  sessionId: string;
  action: string;          // "create_test", "delete_test", "create_jira_bug", "fix_test"
  description: string;     // Human-readable: "Create 8 test cases for patient registration"
  riskLevel: RiskLevel;
  confidence: number;      // 0-1
  data: Record<string, unknown>; // The actual payload to execute if approved
  reason: string;          // Why the agent wants to do this
  status: ApprovalStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

// ===== TOOL DEFINITION =====
export interface AgentTool {
  name: string;
  description: string;
  category: ToolCategory;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  parameters: Record<string, { type: string; required: boolean; description: string }>;
  execute: (args: Record<string, unknown>, context: AgentContext) => Promise<Record<string, unknown>>;
}

// ===== EXECUTION CONTEXT =====
export interface AgentContext {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  orgId: string;
  userId: string;
  projectId: string;
  session: AgentSession;
  memory: AgentMemory;
  budget: AgentBudget;
  spend: AgentSpend;
  // Callbacks
  onProposal: (proposal: Omit<AgentProposal, "id" | "sessionId" | "status" | "createdAt">) => Promise<AgentProposal>;
  onLog: (message: string) => void;
  onBudgetWarning: (resource: string, percentage: number) => void;
}

// ===== MEMORY =====
export interface AgentMemory {
  // Short-term (this session)
  visitedPages: string[];
  discoveredElements: Array<{ page: string; name: string; selector: string }>;
  generatedTests: Array<{ title: string; status: string }>;
  errors: Array<{ task: string; error: string }>;
  decisions: Array<{ decision: string; reason: string; outcome: string }>;

  // Long-term (from DB, across sessions)
  approvedPatterns: Array<{ action: string; approved: boolean; context: string }>;
  projectInsights: Array<{ insight: string; source: string }>;
  preferredStrategies: Record<string, string>;
}

// ===== CONFIG =====
export interface AgentConfig {
  agentType: AgentType;
  goal: string;
  projectId: string;
  budget?: Partial<AgentBudget>;
  approvalMode: "all" | "high_only" | "none"; // Which risk levels need approval
  autoApproveConfidenceThreshold: number;      // Auto-approve if confidence > this (0-1)
}

export const DEFAULT_BUDGET: AgentBudget = {
  maxClaudeCalls: 20,
  maxTokens: 50000,
  maxDurationMs: 30 * 60 * 1000, // 30 minutes
  maxTestRuns: 10,
  maxCostInr: 50,
};

// Cost per Claude call (rough estimate for budgeting)
export const COST_PER_CALL_INR = 2.5;
export const COST_PER_1K_TOKENS_INR = 0.25;
export const COST_PER_TEST_RUN_INR = 0.5;
