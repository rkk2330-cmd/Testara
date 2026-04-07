// ===========================================
// TESTARA — Usage Metering
// Tracks usage per org/month for billing and limit enforcement
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface UsageLimits {
  ai_generations_per_month: number;
  test_runs_per_month: number;
  projects_max: number;
  users_max: number;
  storage_mb: number;
}

export const PLAN_LIMITS: Record<string, UsageLimits> = {
  free: {
    ai_generations_per_month: 10,
    test_runs_per_month: 50,
    projects_max: 1,
    users_max: 1,
    storage_mb: 100,
  },
  pro: {
    ai_generations_per_month: 100,
    test_runs_per_month: 500,
    projects_max: 10,
    users_max: 10,
    storage_mb: 1000,
  },
  business: {
    ai_generations_per_month: 500,
    test_runs_per_month: 2000,
    projects_max: 50,
    users_max: 50,
    storage_mb: 5000,
  },
  enterprise: {
    ai_generations_per_month: 999999,
    test_runs_per_month: 999999,
    projects_max: 999999,
    users_max: 999999,
    storage_mb: 999999,
  },
};

export async function checkUsageLimit(
  supabase: SupabaseClient,
  orgId: string,
  limitType: "ai_generations" | "test_runs" | "projects"
): Promise<{ allowed: boolean; used: number; limit: number; plan: string }> {
  // Get org plan
  const { data: org } = await supabase.from("organizations").select("plan").eq("id", orgId).single();
  const plan = org?.plan || "free";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  // Get current month usage
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  let used = 0;

  if (limitType === "ai_generations") {
    const { count } = await supabase
      .from("ai_generations")
      .select("*", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString())
      .in("project_id", (
        await supabase.from("projects").select("id").eq("org_id", orgId)
      ).data?.map((p: Record<string, unknown>) => p.id) || []);

    used = count || 0;
    return { allowed: used < limits.ai_generations_per_month, used, limit: limits.ai_generations_per_month, plan };
  }

  if (limitType === "test_runs") {
    const { count } = await supabase
      .from("test_runs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString());

    used = count || 0;
    return { allowed: used < limits.test_runs_per_month, used, limit: limits.test_runs_per_month, plan };
  }

  if (limitType === "projects") {
    const { count } = await supabase
      .from("projects")
      .select("*", { count: "exact", head: true })
      .eq("org_id", orgId);

    used = count || 0;
    return { allowed: used < limits.projects_max, used, limit: limits.projects_max, plan };
  }

  return { allowed: true, used: 0, limit: 0, plan };
}

export function usageLimitResponse(used: number, limit: number, plan: string, type: string) {
  return {
    error: `${type} limit reached for your ${plan} plan (${used}/${limit} this month). Upgrade to increase your limit.`,
    used,
    limit,
    plan,
    upgrade_url: "/settings?tab=billing",
  };
}
