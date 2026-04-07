import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";

export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");
  const { data } = await supabase.from("test_runs").select("*, test_cases(title, projects(name))").order("created_at", { ascending: false }).limit(limit);
  return NextResponse.json({ data: data || [] });
});
