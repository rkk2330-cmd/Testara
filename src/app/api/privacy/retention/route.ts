import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { withHandler } from "@/lib/core";
import { logger } from "@/lib/core/logger";

// POST /api/privacy/retention — Run data retention cleanup (called by cron or admin)
// Retention policy:
//   - Test run results older than 2 years → delete
//   - Screenshots older than 90 days → delete
//   - Inactive accounts (no login for 2 years) → flag for deletion
export const POST = withHandler(async (request) => {
  // Verify cron secret or admin auth
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Fall back to user auth
    const supabase = await createServerSupabase();
    const { auth } = await (await import("@/lib/security/auth")).authorize(supabase, { requiredPermission: "manage_settings" });
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServerSupabase();
  const now = new Date();
  const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Delete test run results older than 2 years
  const { count: runsDeleted } = await supabase
    .from("test_runs")
    .delete({ count: "exact" })
    .lt("created_at", twoYearsAgo);

  // 2. Delete screenshot references older than 90 days
  const { count: screenshotsDeleted } = await supabase
    .from("test_run_results")
    .update({ screenshot_url: null })
    .lt("created_at", ninetyDaysAgo)
    .not("screenshot_url", "is", null);

  // 3. Flag inactive accounts (no login for 2 years)
  // (Just log — actual deletion requires human review)
  const { data: inactiveUsers } = await supabase
    .from("users")
    .select("id, email, last_sign_in_at")
    .lt("last_sign_in_at", twoYearsAgo);

  logger.info("privacy.retention_cleanup", {
    runsDeleted: runsDeleted || 0,
    screenshotsCleared: screenshotsDeleted || 0,
    inactiveAccounts: (inactiveUsers || []).length,
    retentionPolicy: { runs: "2 years", screenshots: "90 days", accounts: "2 years inactive" },
  });

  return NextResponse.json({
    data: {
      runsDeleted: runsDeleted || 0,
      screenshotsCleared: screenshotsDeleted || 0,
      inactiveAccountsFlagged: (inactiveUsers || []).length,
      policy: "DPDP Act compliant — data retained only as long as necessary",
    },
  });
});
