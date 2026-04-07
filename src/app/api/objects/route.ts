import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";

export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "access_object_repo" });
  if (!auth) return NextResponse.json({ error }, { status });

  const projectId = request.nextUrl.searchParams.get("project_id");
  let query = supabase.from("object_repository").select("*").order("page_name");
  if (projectId) query = query.eq("project_id", projectId);

  const { data } = await query;
  return NextResponse.json({ data: data || [] });
});
