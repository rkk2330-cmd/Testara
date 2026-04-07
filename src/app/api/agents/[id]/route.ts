import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withErrorHandler, validate } from "@/lib/core";
import { executeApprovedProposals } from "@/lib/agents/runtime";
import { z } from "zod";

// GET /api/agents/[id] — get session details
export const GET = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const { data } = await supabase.from("agent_sessions").select("*").eq("id", id).eq("org_id", auth.org_id).single();
  if (!data) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  return NextResponse.json({ data });
});

const ApproveSchema = z.object({
  action: z.enum(["approve", "reject", "approve_all", "reject_all"]),
  proposalIds: z.array(z.string()).optional(),
});

// PUT /api/agents/[id] — approve or reject proposals
export const PUT = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "use_ai_generator" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const input = validate(ApproveSchema, await request.json());

  // Load session
  const { data: session } = await supabase.from("agent_sessions").select("*").eq("id", id).eq("org_id", auth.org_id).single();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const pending = (session.pending_proposals as Array<Record<string, string>>) || [];

  if (input.action === "approve" || input.action === "approve_all") {
    const ids = input.action === "approve_all"
      ? pending.map(p => p.id)
      : (input.proposalIds || []);

    const results = await executeApprovedProposals(supabase, id, auth.user_id, auth.org_id, ids);
    return NextResponse.json({ data: { action: "approved", results } });
  }

  if (input.action === "reject" || input.action === "reject_all") {
    const ids = input.action === "reject_all"
      ? pending.map(p => p.id)
      : (input.proposalIds || []);

    // Move proposals from pending to resolved with rejected status
    const updatedPending = pending.filter(p => !ids.includes(p.id));
    const rejected = pending.filter(p => ids.includes(p.id)).map(p => ({
      ...p, status: "rejected", reviewedBy: auth.user_id, reviewedAt: new Date().toISOString(),
    }));
    const resolved = [...((session.resolved_proposals as Array<Record<string, unknown>>) || []), ...rejected];

    await supabase.from("agent_sessions").update({
      pending_proposals: updatedPending,
      resolved_proposals: resolved,
      status: updatedPending.length === 0 ? "completed" : "waiting_approval",
      completed_at: updatedPending.length === 0 ? new Date().toISOString() : null,
    }).eq("id", id);

    return NextResponse.json({ data: { action: "rejected", count: ids.length } });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
});

// DELETE /api/agents/[id] — cancel a running agent session
export const DELETE = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "use_ai_generator" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  await supabase.from("agent_sessions").update({
    status: "cancelled", completed_at: new Date().toISOString(),
  }).eq("id", id).eq("org_id", auth.org_id);

  return NextResponse.json({ data: { cancelled: true } });
});
