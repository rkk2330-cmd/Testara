// ===========================================
// TESTARA — Agent Memory System
// Short-term: within a session (in-memory)
// Long-term: across sessions (database)
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentMemory } from "./types";
import { logger } from "@/lib/core/logger";

// ===== CREATE EMPTY MEMORY =====
export function createEmptyMemory(): AgentMemory {
  return {
    visitedPages: [],
    discoveredElements: [],
    generatedTests: [],
    errors: [],
    decisions: [],
    approvedPatterns: [],
    projectInsights: [],
    preferredStrategies: {},
  };
}

// ===== LOAD LONG-TERM MEMORY FROM DB =====
export async function loadLongTermMemory(
  supabase: SupabaseClient,
  orgId: string,
  projectId: string
): Promise<Partial<AgentMemory>> {
  try {
    const { data } = await supabase
      .from("agent_memory")
      .select("memory_type, key, value")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (!data || data.length === 0) return {};

    const approvedPatterns: AgentMemory["approvedPatterns"] = [];
    const projectInsights: AgentMemory["projectInsights"] = [];
    const preferredStrategies: Record<string, string> = {};

    for (const row of data) {
      const val = row.value as Record<string, unknown>;
      switch (row.memory_type) {
        case "approval_pattern":
          approvedPatterns.push({ action: row.key, approved: val.approved as boolean, context: val.context as string });
          break;
        case "insight":
          projectInsights.push({ insight: val.insight as string, source: val.source as string });
          break;
        case "strategy":
          preferredStrategies[row.key] = val.strategy as string;
          break;
      }
    }

    return { approvedPatterns, projectInsights, preferredStrategies };
  } catch {
    logger.warn("agent.memory_load_failed", { orgId, projectId });
    return {};
  }
}

// ===== SAVE LONG-TERM MEMORY TO DB =====
export async function saveLongTermMemory(
  supabase: SupabaseClient,
  orgId: string,
  projectId: string,
  memory: AgentMemory
): Promise<void> {
  try {
    const rows: Array<Record<string, unknown>> = [];

    // Save approved/rejected patterns (learn from human decisions)
    for (const pattern of memory.approvedPatterns) {
      rows.push({
        org_id: orgId, project_id: projectId,
        memory_type: "approval_pattern", key: pattern.action,
        value: { approved: pattern.approved, context: pattern.context },
        updated_at: new Date().toISOString(),
      });
    }

    // Save decisions as insights
    for (const decision of memory.decisions) {
      if (decision.outcome === "success") {
        rows.push({
          org_id: orgId, project_id: projectId,
          memory_type: "insight", key: `decision_${Date.now()}`,
          value: { insight: decision.decision, source: "agent_decision" },
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (rows.length > 0) {
      await supabase.from("agent_memory").upsert(rows, { onConflict: "org_id,project_id,memory_type,key" });
      logger.info("agent.memory_saved", { orgId, projectId, entries: rows.length });
    }
  } catch (err) {
    logger.error("agent.memory_save_failed", { error: (err as Error).message });
  }
}

// ===== SAVE SESSION TO DB (for audit) =====
export async function saveSession(
  supabase: SupabaseClient,
  session: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("agent_sessions").upsert({
      id: session.id,
      org_id: session.orgId,
      user_id: session.userId,
      project_id: session.projectId,
      agent_type: session.agentType,
      goal: session.goal,
      status: session.status,
      plan: session.plan,
      completed_tasks: session.completedTasks,
      budget: session.budget,
      spent: session.spent,
      pending_proposals: session.pendingProposals,
      resolved_proposals: session.resolvedProposals,
      observations: session.observations,
      started_at: session.startedAt,
      completed_at: session.completedAt,
      error: session.error,
    });
  } catch (err) {
    logger.error("agent.session_save_failed", { error: (err as Error).message });
  }
}
