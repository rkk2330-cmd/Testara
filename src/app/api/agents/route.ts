import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler, validate } from "@/lib/core";
import { runAgent } from "@/lib/agents/runtime";
import type { AgentConfig } from "@/lib/agents/types";
import { z } from "zod";

const StartAgentSchema = z.object({
  agentType: z.enum(["scout", "builder", "runner", "healer", "analyst", "guardian"]),
  goal: z.string().min(1).max(2000),
  projectId: z.string().uuid(),
  approvalMode: z.enum(["all", "high_only", "none"]).optional().default("high_only"),
  autoApproveConfidenceThreshold: z.number().min(0).max(1).optional().default(0.9),
  budget: z.object({
    maxClaudeCalls: z.number().int().min(1).max(50).optional(),
    maxTokens: z.number().int().min(1000).max(200000).optional(),
    maxDurationMs: z.number().int().min(10000).max(3600000).optional(),
    maxTestRuns: z.number().int().min(1).max(50).optional(),
    maxCostInr: z.number().min(1).max(500).optional(),
  }).optional(),
});

// POST /api/agents — start a new agent session
export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "use_ai_generator" });
  if (!auth) return NextResponse.json({ error }, { status });

  const input = validate(StartAgentSchema, await request.json());

  const config: AgentConfig = {
    agentType: input.agentType,
    goal: input.goal,
    projectId: input.projectId,
    approvalMode: input.approvalMode,
    autoApproveConfidenceThreshold: input.autoApproveConfidenceThreshold,
    budget: input.budget,
  };

  const session = await runAgent(supabase, auth.user_id, auth.org_id, config);

  return NextResponse.json({
    data: {
      sessionId: session.id,
      status: session.status,
      agentType: session.agentType,
      tasksCompleted: session.completedTasks.length,
      totalTasks: session.plan.length,
      pendingApprovals: session.pendingProposals.length,
      spent: session.spent,
      observations: session.observations.slice(-10),
    },
  }, { status: 201 });
});

// GET /api/agents — list agent sessions
export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "20");
  const statusFilter = request.nextUrl.searchParams.get("status");

  let query = supabase.from("agent_sessions").select("id, agent_type, goal, status, spent, started_at, completed_at, pending_proposals")
    .eq("org_id", auth.org_id).order("started_at", { ascending: false }).limit(limit);

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data } = await query;

  return NextResponse.json({
    data: (data || []).map((s: Record<string, unknown>) => ({
      id: s.id,
      agentType: s.agent_type,
      goal: s.goal,
      status: s.status,
      spent: s.spent,
      startedAt: s.started_at,
      completedAt: s.completed_at,
      pendingApprovals: ((s.pending_proposals as unknown[]) || []).length,
    })),
  });
});
