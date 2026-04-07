"use client";

import { Lock, ArrowRight, Crown, Sparkles } from "lucide-react";
import Link from "next/link";
import { useAuth, useFeature, usePermission } from "@/components/auth/auth-provider";

// ===== FEATURE GATE =====
// Wraps a feature — shows content if allowed, upgrade prompt if not
export function FeatureGate({
  feature,
  requiredPlan,
  children,
  fallback,
}: {
  feature: string;
  requiredPlan?: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const hasAccess = useFeature(feature);

  if (hasAccess) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return <LockedFeature feature={feature} requiredPlan={requiredPlan || "pro"} />;
}

// ===== PERMISSION GATE =====
// Wraps content that requires a specific role permission
export function PermissionGate({
  permission,
  children,
  fallback,
}: {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const hasAccess = usePermission(permission);

  if (hasAccess) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  return null; // Hide completely if no fallback
}

// ===== LOCKED FEATURE CARD =====
export function LockedFeature({
  feature,
  requiredPlan,
}: {
  feature: string;
  requiredPlan: string;
}) {
  const PLAN_PRICES: Record<string, string> = {
    pro: "₹3,999/month",
    business: "₹7,999/month",
    enterprise: "Custom pricing",
  };

  const featureNames: Record<string, string> = {
    api_testing: "API Testing",
    mainframe_testing: "Mainframe Testing",
    excel_export: "Excel Export",
    playwright_export: "Playwright Export",
    gherkin_export: "Gherkin Export",
    scheduled_runs: "Scheduled Runs",
    compliance_reports: "Compliance Reports",
    ai_data_gen: "AI Test Data Generation",
    team_members: "Team Members",
    sso_saml: "SSO / SAML",
    custom_domain: "Custom Domain",
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
      <div className="w-12 h-12 bg-gray-800 rounded-xl flex items-center justify-center mx-auto mb-4">
        <Lock className="w-6 h-6 text-gray-500" />
      </div>
      <h3 className="text-lg font-medium text-white mb-2">
        {featureNames[feature] || feature} is locked
      </h3>
      <p className="text-sm text-gray-400 mb-5">
        This feature requires the <span className="text-indigo-400 font-medium capitalize">{requiredPlan}</span> plan
      </p>
      <Link
        href="/settings?tab=billing"
        className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-500 text-white rounded-xl text-sm font-medium hover:bg-indigo-400 transition-colors"
      >
        <Crown className="w-4 h-4" />
        Upgrade to {requiredPlan} — {PLAN_PRICES[requiredPlan] || ""}
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

// ===== INLINE LOCK (for buttons/links) =====
export function LockedButton({
  feature,
  requiredPlan,
  children,
  className,
}: {
  feature: string;
  requiredPlan?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const hasAccess = useFeature(feature);

  if (hasAccess) return <>{children}</>;

  return (
    <Link
      href="/settings?tab=billing"
      className={`relative ${className || ""}`}
      title={`Requires ${requiredPlan || "pro"} plan`}
    >
      <div className="opacity-50 pointer-events-none">{children}</div>
      <Lock className="absolute -top-1 -right-1 w-3.5 h-3.5 text-gray-400 bg-gray-900 rounded-full p-0.5" />
    </Link>
  );
}

// ===== PLAN BADGE =====
export function PlanBadge() {
  const { plan } = useAuth();

  const colors: Record<string, string> = {
    free: "bg-gray-500/10 text-gray-400 border-gray-500/20",
    pro: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    business: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    enterprise: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  };

  return (
    <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border uppercase ${colors[plan] || colors.free}`}>
      {plan}
    </span>
  );
}

// ===== USAGE INDICATOR =====
export function UsageIndicator({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const percentage = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  return (
    <div className="text-xs">
      <div className="flex justify-between mb-1">
        <span className="text-gray-400">{label}</span>
        <span className={isAtLimit ? "text-red-400" : isNearLimit ? "text-amber-400" : "text-gray-300"}>
          {used}/{limit === 9999 ? "∞" : limit}
        </span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isAtLimit ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-indigo-500"
          }`}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
    </div>
  );
}
