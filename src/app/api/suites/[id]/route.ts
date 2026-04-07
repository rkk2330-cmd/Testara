import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withErrorHandler, validate, SuiteService } from "@/lib/core";
import { UpdateSuiteSchema } from "@/lib/core/validation";

export const GET = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const data = await new SuiteService(supabase, auth).getById(id);
  return NextResponse.json({ data });
});

export const PUT = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_suites" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const input = validate(UpdateSuiteSchema, await request.json());
  const result = await new SuiteService(supabase, auth).update(id, input);
  return NextResponse.json({ data: result });
});

export const DELETE = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "delete_tests" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const result = await new SuiteService(supabase, auth).delete(id);
  return NextResponse.json({ data: result });
});
