import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// GET /api/export — export all user data (GDPR compliant)
export const GET = withHandler(async (request: NextRequest) => {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { data: profile } = await supabase.from("users").select("*, organizations(*)").eq("id", auth.user_id).single();
  const orgId = (profile as unknown)?.org_id;

  // Fetch all user data
  const { data: projects } = await supabase.from("projects").select("*").eq("org_id", orgId);
  const projectIds = (projects || []).map(p => p.id);

  const { data: testCases } = await supabase
    .from("test_cases")
    .select("*, test_steps(*)")
    .in("project_id", projectIds.length > 0 ? projectIds : ["none"]);

  const testIds = (testCases || []).map(t => t.id);

  const { data: testRuns } = await supabase
    .from("test_runs")
    .select("*, test_run_results(*)")
    .in("test_case_id", testIds.length > 0 ? testIds : ["none"]);

  const { data: suites } = await supabase.from("test_suites").select("*").in("project_id", projectIds.length > 0 ? projectIds : ["none"]);

  const { data: aiGenerations } = await supabase.from("ai_generations").select("*").eq("created_by", auth.user_id);

  const { data: integrations } = await supabase.from("integrations").select("id, type, status, created_at").eq("org_id", orgId);

  const { data: objectRepo } = await supabase.from("object_repository").select("*").in("project_id", projectIds.length > 0 ? projectIds : ["none"]);

  const exportData = {
    exported_at: new Date().toISOString(),
    user: {
      id: auth.user_id,
      email: auth.email,
      created_at: user.created_at,
    },
    organization: (profile as unknown)?.organizations || null,
    projects: projects || [],
    test_cases: testCases || [],
    test_runs: testRuns || [],
    test_suites: suites || [],
    ai_generations: aiGenerations || [],
    integrations: integrations || [],
    object_repository: objectRepo || [],
    stats: {
      total_projects: projects?.length || 0,
      total_tests: testCases?.length || 0,
      total_runs: testRuns?.length || 0,
      total_ai_generations: aiGenerations?.length || 0,
    },
  };

  const format = request.nextUrl.searchParams.get("format");

  if (format === "download") {
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename=testara-export-${new Date().toISOString().split("T")[0]}.json`,
      },
    });
  }

  return NextResponse.json({ data: exportData });
}
