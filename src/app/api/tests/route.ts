import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize, checkUsage } from "@/lib/security/auth";
import { withHandler, validate, TestService } from "@/lib/core";
import { CreateTestSchema } from "@/lib/core/validation";

export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const projectId = request.nextUrl.searchParams.get("project_id");
  const service = new TestService(supabase, auth);
  const data = projectId ? await service.listByProject(projectId) : await service.list();
  return NextResponse.json({ data });
});

export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "create_tests" });
  if (!auth) return NextResponse.json({ error }, { status });

  const usage = await checkUsage(supabase, auth, "test_cases");
  if (!usage.allowed) return NextResponse.json({ error: `Test case limit reached (${usage.used}/${usage.limit})`, upgrade_url: "/settings?tab=billing" }, { status: 403 });

  const input = validate(CreateTestSchema, await request.json());
  const service = new TestService(supabase, auth);
  const data = await service.create(input);
  return NextResponse.json({ data }, { status: 201 });
});
