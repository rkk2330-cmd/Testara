// ===========================================
// TEST CASE CRUD — FAANG-grade API route
// Pattern: validate → authorize → service → respond
// All business logic in TestService
// All data access in TestRepository
// All errors caught by withErrorHandler
// ===========================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withErrorHandler, validate, TestService } from "@/lib/core";
import { UpdateTestSchema } from "@/lib/core/validation";

// GET /api/tests/[id]
export const GET = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const service = new TestService(supabase, auth);
  const data = await service.getById(id);

  return NextResponse.json({ data });
});

// PUT /api/tests/[id]
export const PUT = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "edit_tests" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const body = await request.json();
  const input = validate(UpdateTestSchema, body);

  const service = new TestService(supabase, auth);
  const result = await service.update(id, input);

  return NextResponse.json({ data: result });
});

// DELETE /api/tests/[id]
export const DELETE = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "delete_tests" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const service = new TestService(supabase, auth);
  const result = await service.delete(id);

  return NextResponse.json({ data: result });
});
