import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withErrorHandler, validate, ProjectService } from "@/lib/core";
import { UpdateProjectSchema } from "@/lib/core/validation";

export const GET = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const data = await new ProjectService(supabase, auth).getById(id);
  return NextResponse.json({ data });
});

export const PUT = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_projects" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const input = validate(UpdateProjectSchema, await request.json());
  const result = await new ProjectService(supabase, auth).update(id, input);
  return NextResponse.json({ data: result });
});

export const DELETE = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "delete_projects" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const result = await new ProjectService(supabase, auth).delete(id);
  return NextResponse.json({ data: result });
});
