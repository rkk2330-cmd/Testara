"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

interface AuthState {
  user_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: string;
  org_id: string;
  org_name: string;
  plan: string;
  permissions: string[];
  features: string[];
  limits: Record<string, number>;
  loading: boolean;
}

const DEFAULT_STATE: AuthState = {
  user_id: "", email: "", name: "", avatar_url: null,
  role: "viewer", org_id: "", org_name: "", plan: "free",
  permissions: [], features: [], limits: {},
  loading: true,
};

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ["view_dashboard", "view_reports", "run_tests", "create_tests", "edit_tests", "delete_tests", "use_ai_generator", "use_ai_assistant", "manage_test_data", "export_tests", "manage_suites", "manage_projects", "delete_projects", "manage_team", "manage_billing", "manage_settings", "manage_integrations", "approve_heals", "access_api_builder", "access_mainframe", "access_object_repo", "access_api_keys", "view_audit_log"],
  qa_lead: ["view_dashboard", "view_reports", "run_tests", "create_tests", "edit_tests", "delete_tests", "use_ai_generator", "use_ai_assistant", "manage_test_data", "export_tests", "manage_suites", "manage_projects", "approve_heals", "access_api_builder", "access_mainframe", "access_object_repo", "manage_settings"],
  tester: ["view_dashboard", "view_reports", "run_tests", "use_ai_generator", "use_ai_assistant", "manage_test_data", "export_tests", "access_object_repo"],
  viewer: ["view_dashboard", "view_reports"],
};

const PLAN_FEATURES: Record<string, string[]> = {
  free: ["ai_generation", "ai_assistant", "object_repository"],
  pro: ["ai_generation", "ai_assistant", "ai_data_gen", "api_testing", "excel_export", "playwright_export", "gherkin_export", "team_members", "object_repository"],
  business: ["ai_generation", "ai_assistant", "ai_data_gen", "api_testing", "mainframe_testing", "excel_export", "playwright_export", "gherkin_export", "scheduled_runs", "compliance_reports", "team_members", "custom_domain", "object_repository"],
  enterprise: ["ai_generation", "ai_assistant", "ai_data_gen", "api_testing", "mainframe_testing", "excel_export", "playwright_export", "gherkin_export", "scheduled_runs", "compliance_reports", "team_members", "custom_domain", "sso_saml", "data_isolation", "object_repository"],
};

const PLAN_LIMITS_MAP: Record<string, Record<string, number>> = {
  free: { projects: 1, test_cases: 5, ai_generations: 10, test_runs: 50, team_members: 1 },
  pro: { projects: 10, test_cases: 9999, ai_generations: 100, test_runs: 500, team_members: 10 },
  business: { projects: 50, test_cases: 9999, ai_generations: 500, test_runs: 2000, team_members: 50 },
  enterprise: { projects: 9999, test_cases: 9999, ai_generations: 9999, test_runs: 9999, team_members: 9999 },
};

const AuthContext = createContext<AuthState>(DEFAULT_STATE);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(DEFAULT_STATE);
  const supabase = createClient();

  useEffect(() => {
    async function loadAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setState({ ...DEFAULT_STATE, loading: false }); return; }

      const { data: profile } = await supabase
        .from("users")
        .select("name, role, org_id, avatar_url, organizations(name, plan)")
        .eq("id", user.id)
        .single();

      const role = profile?.role || "viewer";
      const org = (profile as Record<string, unknown>)?.organizations as Record<string, string> | null;
      const plan = org?.plan || "free";

      setState({
        user_id: user.id,
        email: user.email || "",
        name: profile?.name || user.email?.split("@")[0] || "",
        avatar_url: profile?.avatar_url || null,
        role,
        org_id: profile?.org_id || "",
        org_name: org?.name || "",
        plan,
        permissions: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer,
        features: PLAN_FEATURES[plan] || PLAN_FEATURES.free,
        limits: PLAN_LIMITS_MAP[plan] || PLAN_LIMITS_MAP.free,
        loading: false,
      });
    }
    loadAuth();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function usePermission(permission: string): boolean {
  const { permissions } = useAuth();
  return permissions.includes(permission);
}

export function useFeature(feature: string): boolean {
  const { features } = useAuth();
  return features.includes(feature);
}

export function usePlan(): string {
  return useAuth().plan;
}
