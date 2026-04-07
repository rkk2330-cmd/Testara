import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";

export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const q = request.nextUrl.searchParams.get("q") || "";
  if (!q || q.length < 2) return NextResponse.json({ data: { tests: [], projects: [], suites: [] } });

  const [tests, projects, suites] = await Promise.all([
    supabase.from("test_cases").select("id, title, status").ilike("title", `%${q}%`).limit(10),
    supabase.from("projects").select("id, name").eq("org_id", auth.org_id).ilike("name", `%${q}%`).limit(5),
    supabase.from("test_suites").select("id, name").ilike("name", `%${q}%`).limit(5),
  ]);

  return NextResponse.json({ data: { tests: tests.data || [], projects: projects.data || [], suites: suites.data || [] } });
});
