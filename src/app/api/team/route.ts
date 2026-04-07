import { InviteTeamMemberSchema, UpdateMemberRoleSchema } from "@/lib/core/validation";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize, checkUsage } from "@/lib/security/auth";

// GET /api/team — list team members
export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { data: members } = await supabase
    .from("users")
    .select("id, email, name, role, avatar_url, last_login, created_at")
    .eq("org_id", auth.org_id)
    .order("created_at");

  const { data: pendingInvites } = await supabase
    .from("team_invites")
    .select("*")
    .eq("org_id", auth.org_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return NextResponse.json({
    data: {
      members: members || [],
      pending_invites: pendingInvites || [],
      total: (members?.length || 0),
      limit: auth.limits.team_members,
    },
  });
}

// POST /api/team — invite a new team member
export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_team" });
  if (!auth) return NextResponse.json({ error }, { status });

  const body = await request.json().catch(() => ({}));
  const { email, role } = validate(InviteTeamMemberSchema, body);

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  const validRoles = ["qa_lead", "tester", "viewer"];
  const assignedRole = validRoles.includes(role || "") ? role! : "tester";

  // Check team member limit
  const usage = await checkUsage(supabase, auth, "team_members");
  if (!usage.allowed) {
    return NextResponse.json({
      error: `Team member limit reached (${usage.used}/${usage.limit}). Upgrade your plan.`,
      upgrade_url: "/settings?tab=billing",
    }, { status: 403 });
  }

  // Check if already a member
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .eq("org_id", auth.org_id)
    .single();

  if (existing) {
    return NextResponse.json({ error: "This user is already in your organization" }, { status: 409 });
  }

  // Check if already invited
  const { data: existingInvite } = await supabase
    .from("team_invites")
    .select("id")
    .eq("email", email)
    .eq("org_id", auth.org_id)
    .eq("status", "pending")
    .single();

  if (existingInvite) {
    return NextResponse.json({ error: "An invitation is already pending for this email" }, { status: 409 });
  }

  // Create invite
  const inviteToken = crypto.randomUUID();
  const { data: invite, error: inviteErr } = await supabase
    .from("team_invites")
    .insert({
      org_id: auth.org_id,
      email,
      role: assignedRole,
      invited_by: auth.user_id,
      token: inviteToken,
      status: "pending",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    })
    .select()
    .single();

  if (inviteErr) return NextResponse.json({ error: inviteErr.message }, { status: 500 });

  // In production: send invite email via Resend/SendGrid
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://testara.vercel.app"}/invite/${inviteToken}`;
  console.log(`[Testara Team] Invite sent to ${email} (role: ${assignedRole}): ${inviteUrl}`);

  return NextResponse.json({
    data: {
      invite_id: invite.id,
      email,
      role: assignedRole,
      invite_url: inviteUrl,
      expires_at: invite.expires_at,
    },
  }, { status: 201 });
}

// PUT /api/team — update member role
export const PUT = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_team" });
  if (!auth) return NextResponse.json({ error }, { status });

  const body = await request.json().catch(() => ({}));
  const { user_id, role } = body as { user_id?: string; role?: string };

  if (!user_id || !role) {
    return NextResponse.json({ error: "user_id and role are required" }, { status: 400 });
  }

  // Can't change own role
  if (user_id === auth.user_id) {
    return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
  }

  // Can't promote to admin (only one admin per org for now)
  if (role === "admin") {
    return NextResponse.json({ error: "Cannot promote to admin. Transfer ownership instead." }, { status: 400 });
  }

  const validRoles = ["qa_lead", "tester", "viewer"];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: `Invalid role. Use: ${validRoles.join(", ")}` }, { status: 400 });
  }

  const { error: updateErr } = await supabase
    .from("users")
    .update({ role })
    .eq("id", user_id)
    .eq("org_id", auth.org_id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ data: { user_id, role, updated: true } });
}

// DELETE /api/team — remove member
export const DELETE = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_team" });
  if (!auth) return NextResponse.json({ error }, { status });

  const userId = request.nextUrl.searchParams.get("user_id");
  const inviteId = request.nextUrl.searchParams.get("invite_id");

  if (inviteId) {
    // Cancel pending invite
    await supabase.from("team_invites").update({ status: "cancelled" }).eq("id", inviteId).eq("org_id", auth.org_id);
    return NextResponse.json({ data: { cancelled: true } });
  }

  if (!userId) return NextResponse.json({ error: "user_id or invite_id required" }, { status: 400 });

  // Can't remove yourself
  if (userId === auth.user_id) {
    return NextResponse.json({ error: "You cannot remove yourself. Transfer ownership first." }, { status: 400 });
  }

  // Remove from org (set org_id to null — don't delete the user)
  await supabase.from("users").update({ org_id: null, role: "viewer" }).eq("id", userId).eq("org_id", auth.org_id);

  return NextResponse.json({ data: { removed: true, user_id: userId } });
}
