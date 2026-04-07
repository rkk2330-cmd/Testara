import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler, validate, SuiteService } from "@/lib/core";
import { CreateSuiteSchema } from "@/lib/core/validation";

export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const data = await new SuiteService(supabase, auth).list();
  return NextResponse.json({ data });
});

export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_suites" });
  if (!auth) return NextResponse.json({ error }, { status });

  const input = validate(CreateSuiteSchema, await request.json());
  const data = await new SuiteService(supabase, auth).create(input);
  return NextResponse.json({ data }, { status: 201 });
});
