// ===========================================
// TESTARA — Authorization Engine
// RBAC (role-based) + Plan gating (feature-based)
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";

// ===== PERMISSIONS PER ROLE =====
export type Permission =
  | "view_dashboard"
  | "view_reports"
  | "run_tests"
  | "create_tests"
  | "edit_tests"
  | "delete_tests"
  | "use_ai_generator"
  | "use_ai_assistant"
  | "manage_test_data"
  | "export_tests"
  | "manage_suites"
  | "manage_projects"
  | "delete_projects"
  | "manage_team"
  | "manage_billing"
  | "manage_settings"
  | "manage_integrations"
  | "approve_heals"
  | "access_api_builder"
  | "access_mainframe"
  | "access_object_repo"
  | "access_api_keys"
  | "view_audit_log";

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [
    "view_dashboard", "view_reports", "run_tests", "create_tests", "edit_tests",
    "delete_tests", "use_ai_generator", "use_ai_assistant", "manage_test_data",
    "export_tests", "manage_suites", "manage_projects", "delete_projects",
    "manage_team", "manage_billing", "manage_settings", "manage_integrations",
    "approve_heals", "access_api_builder", "access_mainframe", "access_object_repo",
    "access_api_keys", "view_audit_log",
  ],
  qa_lead: [
    "view_dashboard", "view_reports", "run_tests", "create_tests", "edit_tests",
    "delete_tests", "use_ai_generator", "use_ai_assistant", "manage_test_data",
    "export_tests", "manage_suites", "manage_projects", "approve_heals",
    "access_api_builder", "access_mainframe", "access_object_repo", "manage_settings",
  ],
  tester: [
    "view_dashboard", "view_reports", "run_tests", "use_ai_generator",
    "use_ai_assistant", "manage_test_data", "export_tests", "access_object_repo",
  ],
  viewer: [
    "view_dashboard", "view_reports",
  ],
};

// ===== FEATURES PER PLAN =====
export type PlanFeature =
  | "ai_generation"
  | "ai_assistant"
  | "ai_data_gen"
  | "ai_agents"
  | "api_testing"
  | "mainframe_testing"
  | "excel_export"
  | "playwright_export"
  | "gherkin_export"
  | "scheduled_runs"
  | "compliance_reports"
  | "team_members"
  | "custom_domain"
  | "sso_saml"
  | "data_isolation"
  | "object_repository";

const PLAN_FEATURES: Record<string, PlanFeature[]> = {
  free: [
    "ai_generation", "ai_assistant", "object_repository",
  ],
  pro: [
    "ai_generation", "ai_assistant", "ai_data_gen", "ai_agents", "api_testing",
    "excel_export", "playwright_export", "gherkin_export",
    "team_members", "object_repository",
  ],
  business: [
    "ai_generation", "ai_assistant", "ai_data_gen", "ai_agents", "api_testing",
    "mainframe_testing", "excel_export", "playwright_export", "gherkin_export",
    "scheduled_runs", "compliance_reports", "team_members", "custom_domain",
    "object_repository",
  ],
  enterprise: [
    "ai_generation", "ai_assistant", "ai_data_gen", "ai_agents", "api_testing",
    "mainframe_testing", "excel_export", "playwright_export", "gherkin_export",
    "scheduled_runs", "compliance_reports", "team_members", "custom_domain",
    "sso_saml", "data_isolation", "object_repository",
  ],
};

// ===== PLAN LIMITS =====
export const PLAN_LIMITS: Record<string, Record<string, number>> = {
  free: { projects: 1, test_cases: 5, ai_generations: 10, test_runs: 50, team_members: 1, assistant_messages: 20 },
  pro: { projects: 10, test_cases: 9999, ai_generations: 100, test_runs: 500, team_members: 10, assistant_messages: 999 },
  business: { projects: 50, test_cases: 9999, ai_generations: 500, test_runs: 2000, team_members: 50, assistant_messages: 999 },
  enterprise: { projects: 9999, test_cases: 9999, ai_generations: 9999, test_runs: 9999, team_members: 9999, assistant_messages: 9999 },
};

// ===== AUTH CONTEXT (fetched once per request) =====
export interface AuthContext {
  user_id: string;
  email: string;
  role: string;
  org_id: string;
  plan: string;
  permissions: Permission[];
  features: PlanFeature[];
  limits: Record<string, number>;
}

// ===== MAIN AUTH FUNCTION =====
// Call this at the top of every API route
export async function authorize(
  supabase: SupabaseClient,
  options?: {
    requiredPermission?: Permission;
    requiredFeature?: PlanFeature;
    requiredPlan?: string[];
  }
): Promise<{ auth: AuthContext | null; error: string | null; status: number }> {
  // 1. Check authentication
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { auth: null, error: "Not authenticated. Please log in.", status: 401 };
  }

  // 2. Get user profile with org
  const { data: profile } = await supabase
    .from("users")
    .select("role, org_id, organizations(plan)")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.org_id) {
    return { auth: null, error: "User profile not found. Complete onboarding first.", status: 403 };
  }

  const role = profile.role || "viewer";
  const plan = (profile as Record<string, unknown>).organizations
    ? ((profile as Record<string, unknown>).organizations as Record<string, string>).plan || "free"
    : "free";

  const auth: AuthContext = {
    user_id: user.id,
    email: user.email || "",
    role,
    org_id: profile.org_id,
    plan,
    permissions: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer,
    features: PLAN_FEATURES[plan] || PLAN_FEATURES.free,
    limits: PLAN_LIMITS[plan] || PLAN_LIMITS.free,
  };

  // 3. Check role permission
  if (options?.requiredPermission) {
    if (!auth.permissions.includes(options.requiredPermission)) {
      return {
        auth,
        error: `Your role (${role}) doesn't have permission: ${options.requiredPermission}. Contact your admin.`,
        status: 403,
      };
    }
  }

  // 4. Check plan feature
  if (options?.requiredFeature) {
    if (!auth.features.includes(options.requiredFeature)) {
      const requiredPlan = Object.entries(PLAN_FEATURES)
        .find(([, features]) => features.includes(options.requiredFeature!))?.[0] || "pro";
      return {
        auth,
        error: `${options.requiredFeature} requires ${requiredPlan} plan. You're on ${plan}. Upgrade at /settings?tab=billing`,
        status: 403,
      };
    }
  }

  // 5. Check specific plan requirement
  if (options?.requiredPlan) {
    if (!options.requiredPlan.includes(plan)) {
      return {
        auth,
        error: `This feature requires ${options.requiredPlan.join(" or ")} plan. You're on ${plan}.`,
        status: 403,
      };
    }
  }

  return { auth, error: null, status: 200 };
}

// ===== USAGE CHECK (counts against monthly limits) =====
export async function checkUsage(
  supabase: SupabaseClient,
  auth: AuthContext,
  resource: "ai_generations" | "test_runs" | "projects" | "test_cases" | "team_members"
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = auth.limits[resource] || 0;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  let used = 0;

  switch (resource) {
    case "ai_generations": {
      const { count } = await supabase
        .from("ai_generations")
        .select("*", { count: "exact", head: true })
        .eq("created_by", auth.user_id)
        .gte("created_at", monthStart.toISOString());
      used = count || 0;
      break;
    }
    case "test_runs": {
      const { count } = await supabase
        .from("test_runs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", monthStart.toISOString());
      used = count || 0;
      break;
    }
    case "projects": {
      const { count } = await supabase
        .from("projects")
        .select("*", { count: "exact", head: true })
        .eq("org_id", auth.org_id);
      used = count || 0;
      break;
    }
    case "test_cases": {
      const { count } = await supabase
        .from("test_cases")
        .select("*", { count: "exact", head: true });
      used = count || 0;
      break;
    }
    case "team_members": {
      const { count } = await supabase
        .from("users")
        .select("*", { count: "exact", head: true })
        .eq("org_id", auth.org_id);
      used = count || 0;
      break;
    }
  }

  return { allowed: used < limit, used, limit };
}

// ===== HELPER: Quick permission check =====
export function hasPermission(auth: AuthContext, permission: Permission): boolean {
  return auth.permissions.includes(permission);
}

export function hasFeature(auth: AuthContext, feature: PlanFeature): boolean {
  return auth.features.includes(feature);
}

// ===== SERIALIZABLE AUTH (safe to send to client) =====
export function serializeAuth(auth: AuthContext): Record<string, unknown> {
  return {
    user_id: auth.user_id,
    email: auth.email,
    role: auth.role,
    plan: auth.plan,
    permissions: auth.permissions,
    features: auth.features,
    limits: auth.limits,
  };
}
