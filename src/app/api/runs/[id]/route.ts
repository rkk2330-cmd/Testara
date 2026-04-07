import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withErrorHandler } from "@/lib/core";

export const GET = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const { data } = await supabase.from("test_runs").select("*, test_cases(title, projects(name)), test_run_results(*, test_steps(*))").eq("id", id).single();
  if (!data) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ data });
});
