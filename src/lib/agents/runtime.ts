// ===========================================
// TESTARA — Agent Runtime
// PLAN → EXECUTE → OBSERVE → REASON → REPEAT
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentSession, AgentConfig, AgentContext, AgentTask, AgentTaskResult, AgentProposal, AgentMemory } from "./types";
import { DEFAULT_BUDGET, COST_PER_CALL_INR, COST_PER_1K_TOKENS_INR } from "./types";
import { toolRegistry } from "./tools";
import { BudgetTracker } from "./budget";
import { ApprovalManager } from "./approvals";
import { createEmptyMemory, loadLongTermMemory, saveLongTermMemory, saveSession } from "./memory";
import { logger } from "@/lib/core/logger";
import { eventBus, createEvent } from "@/lib/events/bus";

// Import agent planners
import { planScout } from "./agents/scout";
import { planBuilder } from "./agents/builder";
import { planRunner } from "./agents/runner";
import { planHealer } from "./agents/healer";
import { planAnalyst } from "./agents/analyst";
import { planGuardian } from "./agents/guardian";

// ===== CREATE SESSION =====
function createSession(config: AgentConfig, userId: string, orgId: string): AgentSession {
  return {
    id: `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    agentType: config.agentType,
    status: "planning",
    goal: config.goal,
    userId,
    orgId,
    projectId: config.projectId,
    plan: [],
    currentTaskIndex: 0,
    completedTasks: [],
    budget: { ...DEFAULT_BUDGET, ...config.budget },
    spent: { claudeCalls: 0, tokens: 0, durationMs: 0, testRuns: 0, costInr: 0 },
    pendingProposals: [],
    resolvedProposals: [],
    shortTermMemory: {},
    observations: [],
    startedAt: new Date().toISOString(),
  };
}

// ===== RUN AGENT =====
export async function runAgent(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  config: AgentConfig
): Promise<AgentSession> {
  const session = createSession(config, userId, orgId);
  const startTime = Date.now();

  const budgetTracker = new BudgetTracker(config.budget, (resource, pct) => {
    session.observations.push(`Budget warning: ${resource} at ${pct}%`);
  });

  const approvalManager = new ApprovalManager(
    config.approvalMode,
    config.autoApproveConfidenceThreshold
  );

  // Load long-term memory
  const memory: AgentMemory = {
    ...createEmptyMemory(),
    ...(await loadLongTermMemory(supabase, orgId, config.projectId)),
  };

  const logs: string[] = [];

  // Build execution context
  const context: AgentContext = {
    supabase,
    orgId,
    userId,
    projectId: config.projectId,
    session,
    memory,
    budget: session.budget,
    spend: session.spent,
    onProposal: async (partial) => {
      const proposal = await approvalManager.createProposal(
        session.id, partial.action, partial.description,
        partial.riskLevel, partial.confidence, partial.data, partial.reason
      );
      if (proposal.status === "pending") session.pendingProposals.push(proposal);
      else session.resolvedProposals.push(proposal);
      return proposal;
    },
    onLog: (msg) => {
      logs.push(`[${new Date().toISOString()}] ${msg}`);
      session.observations.push(msg);
    },
    onBudgetWarning: (resource, pct) => {
      session.observations.push(`Budget: ${resource} at ${pct}%`);
    },
  };

  logger.info("agent.session_started", {
    sessionId: session.id, agentType: config.agentType,
    goal: config.goal, projectId: config.projectId,
  });

  try {
    // ===== STEP 1: PLAN =====
    session.status = "planning";
    context.onLog(`Planning: ${config.goal}`);

    const plan = await createPlan(config, context);
    session.plan = plan;
    context.onLog(`Plan created: ${plan.length} tasks`);

    // ===== STEP 2: EXECUTE PLAN =====
    session.status = "executing";

    for (let i = 0; i < plan.length; i++) {
      session.currentTaskIndex = i;
      const task = plan[i];

      // Check budget before each task
      if (budgetTracker.isExceeded()) {
        const reason = budgetTracker.getExhaustedReason();
        context.onLog(`Budget exhausted: ${reason}. Stopping.`);
        session.observations.push(`Stopped at task ${i + 1}/${plan.length}: ${reason}`);
        break;
      }

      // Check if task needs approval
      if (task.requiresApproval) {
        const proposal = await context.onProposal({
          action: task.toolName,
          description: task.description,
          riskLevel: task.riskLevel,
          confidence: 0.85,
          data: task.toolArgs,
          reason: `Part of plan: ${config.goal}`,
        });

        if (proposal.status === "pending") {
          task.status = "awaiting_approval";
          context.onLog(`Awaiting approval: ${task.description}`);
          continue; // Skip this task — will be executed after approval
        } else if (proposal.status === "auto_approved") {
          task.status = "running";
        }
      } else {
        task.status = "running";
      }

      // Execute the task
      const taskStart = Date.now();
      try {
        const result = await toolRegistry.execute(task.toolName, task.toolArgs, context);
        const duration = Date.now() - taskStart;
        budgetTracker.trackDuration(duration);

        const taskResult: AgentTaskResult = {
          taskId: task.id, status: "completed",
          output: result, duration_ms: duration, tokensUsed: 0,
        };
        session.completedTasks.push(taskResult);
        task.status = "completed";
        context.onLog(`✓ ${task.description} (${duration}ms)`);

        // ===== STEP 3: OBSERVE =====
        await observe(result, task, context);

      } catch (err) {
        const duration = Date.now() - taskStart;
        const taskResult: AgentTaskResult = {
          taskId: task.id, status: "failed",
          output: {}, duration_ms: duration, tokensUsed: 0,
          error: (err as Error).message,
        };
        session.completedTasks.push(taskResult);
        task.status = "failed";
        memory.errors.push({ task: task.description, error: (err as Error).message });
        context.onLog(`✗ ${task.description}: ${(err as Error).message}`);

        // ===== STEP 4: REASON about failure =====
        const shouldContinue = await reasonAboutFailure(task, err as Error, context);
        if (!shouldContinue) {
          context.onLog("Agent decided to stop after failure");
          break;
        }
      }
    }

    // ===== STEP 5: FINALIZE =====
    session.spent = budgetTracker.getSpend();
    session.spent.durationMs = Date.now() - startTime;

    if (session.pendingProposals.length > 0) {
      session.status = "waiting_approval";
    } else {
      session.status = "completed";
      session.completedAt = new Date().toISOString();
    }

  } catch (err) {
    session.status = "failed";
    session.error = (err as Error).message;
    session.completedAt = new Date().toISOString();
    logger.error("agent.session_failed", { sessionId: session.id, error: session.error });
  }

  // Save memory and session
  await saveLongTermMemory(supabase, orgId, config.projectId, memory);
  await saveSession(supabase, session as unknown as Record<string, unknown>);

  // Emit event
  eventBus.emit(createEvent(
    session.status === "completed" ? "suite.run.completed" : "test.run.failed",
    userId, orgId,
    { sessionId: session.id, agentType: config.agentType, status: session.status, tasksCompleted: session.completedTasks.length, pendingApprovals: session.pendingProposals.length }
  ));

  logger.info("agent.session_completed", {
    sessionId: session.id, status: session.status,
    tasks: `${session.completedTasks.length}/${session.plan.length}`,
    budget: budgetTracker.getSummary(),
    pendingApprovals: session.pendingProposals.length,
  });

  return session;
}

// ===== PLAN DISPATCHER =====
async function createPlan(config: AgentConfig, context: AgentContext): Promise<AgentTask[]> {
  switch (config.agentType) {
    case "scout": return planScout(config, context);
    case "builder": return planBuilder(config, context);
    case "runner": return planRunner(config, context);
    case "healer": return planHealer(config, context);
    case "analyst": return planAnalyst(config, context);
    case "guardian": return planGuardian(config, context);
    default: throw new Error(`Unknown agent type: ${config.agentType}`);
  }
}

// ===== OBSERVE RESULTS =====
async function observe(result: Record<string, unknown>, task: AgentTask, context: AgentContext): Promise<void> {
  // Record observations for reasoning
  if (result.tests) {
    const count = (result.tests as unknown[]).length;
    context.memory.decisions.push({ decision: `Generated ${count} tests`, reason: task.description, outcome: "success" });
  }
  if (result.elements) {
    const count = (result.elements as unknown[]).length;
    context.onLog(`Discovered ${count} elements`);
  }
  if (result.failures) {
    const count = (result.failures as unknown[]).length;
    context.onLog(`Found ${count} failures to analyze`);
  }
}

// ===== REASON ABOUT FAILURE =====
async function reasonAboutFailure(task: AgentTask, error: Error, context: AgentContext): Promise<boolean> {
  // Simple reasoning: should we continue after a failure?
  const errorMsg = error.message.toLowerCase();

  // Fatal errors — stop
  if (errorMsg.includes("unauthorized") || errorMsg.includes("forbidden")) return false;
  if (errorMsg.includes("budget") || errorMsg.includes("limit")) return false;

  // Recoverable errors — continue
  if (errorMsg.includes("not found") || errorMsg.includes("timeout")) {
    context.memory.decisions.push({
      decision: "Continue despite failure",
      reason: `Task "${task.description}" failed with recoverable error: ${error.message}`,
      outcome: "skipped",
    });
    return true;
  }

  // Default: continue for first 2 failures, stop after 3
  return context.memory.errors.length < 3;
}

// ===== EXECUTE APPROVED PROPOSALS =====
export async function executeApprovedProposals(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  orgId: string,
  proposalIds: string[]
): Promise<Array<{ proposalId: string; status: string; result?: Record<string, unknown>; error?: string }>> {
  const { data: sessionData } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (!sessionData) throw new Error("Session not found");

  const results: Array<{ proposalId: string; status: string; result?: Record<string, unknown>; error?: string }> = [];

  const memory = createEmptyMemory();
  const context: AgentContext = {
    supabase, orgId, userId,
    projectId: sessionData.project_id,
    session: sessionData as unknown as AgentSession,
    memory,
    budget: sessionData.budget as unknown as import("./types").AgentBudget,
    spend: sessionData.spent as unknown as import("./types").AgentSpend,
    onProposal: async () => ({ id: "", sessionId: "", action: "", description: "", riskLevel: "none" as const, confidence: 1, data: {}, reason: "", status: "auto_approved" as const, createdAt: new Date().toISOString() }),
    onLog: () => {},
    onBudgetWarning: () => {},
  };

  const proposals = (sessionData.pending_proposals as AgentProposal[]) || [];

  for (const propId of proposalIds) {
    const proposal = proposals.find(p => p.id === propId);
    if (!proposal) { results.push({ proposalId: propId, status: "not_found" }); continue; }

    try {
      const result = await toolRegistry.execute(proposal.action, proposal.data, context);
      proposal.status = "approved";
      proposal.reviewedBy = userId;
      proposal.reviewedAt = new Date().toISOString();

      // Learn from approval
      memory.approvedPatterns.push({ action: proposal.action, approved: true, context: proposal.reason });

      results.push({ proposalId: propId, status: "executed", result });
    } catch (err) {
      results.push({ proposalId: propId, status: "failed", error: (err as Error).message });
    }
  }

  // Update session in DB
  const updatedPending = proposals.filter(p => !proposalIds.includes(p.id));
  const updatedResolved = [...(sessionData.resolved_proposals as AgentProposal[] || []), ...proposals.filter(p => proposalIds.includes(p.id))];

  await supabase.from("agent_sessions").update({
    pending_proposals: updatedPending,
    resolved_proposals: updatedResolved,
    status: updatedPending.length === 0 ? "completed" : "waiting_approval",
    completed_at: updatedPending.length === 0 ? new Date().toISOString() : null,
  }).eq("id", sessionId);

  await saveLongTermMemory(supabase, orgId, sessionData.project_id, memory);

  return results;
}
