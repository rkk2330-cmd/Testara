import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler, validate, DatasetService } from "@/lib/core";
import { CreateDatasetSchema, UpdateDatasetSchema } from "@/lib/core/validation";

export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_test_data" });
  if (!auth) return NextResponse.json({ error }, { status });

  const projectId = request.nextUrl.searchParams.get("project_id") || undefined;
  const data = await new DatasetService(supabase, auth).list(projectId);
  return NextResponse.json({ data });
});

export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_test_data" });
  if (!auth) return NextResponse.json({ error }, { status });

  const input = validate(CreateDatasetSchema, await request.json());
  const data = await new DatasetService(supabase, auth).create(input);
  return NextResponse.json({ data }, { status: 201 });
});

export const PUT = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_test_data" });
  if (!auth) return NextResponse.json({ error }, { status });

  const input = validate(UpdateDatasetSchema, await request.json());
  const { id, ...updates } = input;
  const data = await new DatasetService(supabase, auth).update(id, updates);
  return NextResponse.json({ data });
});

export const DELETE = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_test_data" });
  if (!auth) return NextResponse.json({ error }, { status });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Dataset ID required" }, { status: 400 });
  const data = await new DatasetService(supabase, auth).delete(id);
  return NextResponse.json({ data });
});
