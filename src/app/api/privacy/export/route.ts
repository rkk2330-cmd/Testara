import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { logger } from "@/lib/core/logger";

// GET /api/privacy/export — DPDP Right to Access + GDPR Right to Portability
export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error }, { status });

  // Collect ALL user data
  const [profile, projects, tests, runs, suites, datasets] = await Promise.all([
    supabase.from("users").select("*").eq("id", auth.user_id).single(),
    supabase.from("projects").select("*").eq("org_id", auth.org_id),
    supabase.from("test_cases").select("*, test_steps(*)"),
    supabase.from("test_runs").select("*, test_run_results(*)"),
    supabase.from("test_suites").select("*"),
    supabase.from("test_data").select("*").eq("org_id", auth.org_id),
  ]);

  const exportData = {
    exported_at: new Date().toISOString(),
    exported_for: auth.email,
    legal_basis: "DPDP Act 2023 Section 11 — Right to Access | GDPR Article 15/20 — Right to Access/Portability",
    profile: profile.data,
    projects: projects.data || [],
    test_cases: tests.data || [],
    test_runs: runs.data || [],
    test_suites: suites.data || [],
    test_data: datasets.data || [],
  };

  logger.info("privacy.data_exported", { userId: auth.user_id, orgId: auth.org_id });

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="testara-data-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});
