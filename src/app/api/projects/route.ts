import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize, checkUsage } from "@/lib/security/auth";
import { withHandler, validate, ProjectService } from "@/lib/core";
import { CreateProjectSchema } from "@/lib/core/validation";

export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const data = await new ProjectService(supabase, auth).list();
  return NextResponse.json({ data });
});

export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_projects" });
  if (!auth) return NextResponse.json({ error }, { status });

  const usage = await checkUsage(supabase, auth, "projects");
  if (!usage.allowed) return NextResponse.json({ error: `Project limit reached (${usage.used}/${usage.limit})`, upgrade_url: "/settings?tab=billing" }, { status: 403 });

  const input = validate(CreateProjectSchema, await request.json());
  const data = await new ProjectService(supabase, auth).create(input);
  return NextResponse.json({ data }, { status: 201 });
});
