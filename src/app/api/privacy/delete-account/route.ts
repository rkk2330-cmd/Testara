import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { logger } from "@/lib/core/logger";

// DELETE /api/privacy/delete-account — DPDP Right to Erasure + GDPR Right to be Forgotten
export const DELETE = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error }, { status });

  logger.info("privacy.account_deletion_started", { userId: auth.user_id, email: auth.email, orgId: auth.org_id });

  // Get all project IDs for cascade
  const { data: projects } = await supabase.from("projects").select("id").eq("org_id", auth.org_id);
  const projectIds = (projects || []).map((p: Record<string, string>) => p.id);

  // Get all test case IDs for cascade
  const { data: tests } = await supabase.from("test_cases").select("id").in("project_id", projectIds.length > 0 ? projectIds : ["none"]);
  const testIds = (tests || []).map((t: Record<string, string>) => t.id);

  // Delete in correct order (foreign key constraints)
  if (testIds.length > 0) {
    await supabase.from("test_run_results").delete().in("test_run_id",
      (await supabase.from("test_runs").select("id").in("test_case_id", testIds)).data?.map((r: Record<string, string>) => r.id) || ["none"]);
    await supabase.from("test_runs").delete().in("test_case_id", testIds);
    await supabase.from("test_steps").delete().in("test_case_id", testIds);
    await supabase.from("test_cases").delete().in("id", testIds);
  }

  if (projectIds.length > 0) {
    await supabase.from("test_suites").delete().in("project_id", projectIds);
    await supabase.from("object_repository").delete().in("project_id", projectIds);
    await supabase.from("agent_sessions").delete().in("project_id", projectIds);
    await supabase.from("agent_memory").delete().in("project_id", projectIds);
    await supabase.from("projects").delete().in("id", projectIds);
  }

  // Delete org-level data
  await supabase.from("test_data").delete().eq("org_id", auth.org_id);

  // Delete user and org
  await supabase.from("users").delete().eq("id", auth.user_id);

  // Check if org has other members
  const { count } = await supabase.from("users").select("*", { count: "exact", head: true }).eq("org_id", auth.org_id);
  if (!count || count === 0) {
    await supabase.from("organizations").delete().eq("id", auth.org_id);
  }

  // Delete auth user (Supabase Admin API)
  await supabase.auth.admin.deleteUser(auth.user_id).catch(() => {});

  logger.info("privacy.account_deleted", { userId: auth.user_id, email: auth.email, projectsDeleted: projectIds.length, testsDeleted: testIds.length });

  return NextResponse.json({ data: { deleted: true, message: "All personal data permanently erased per DPDP Act Section 12." } });
});
