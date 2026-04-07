"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, FolderKanban, FlaskConical, Play,
  Sparkles, FileBarChart, Settings, Plug, Layers, Monitor,
  Database, Archive, ChevronDown, ChevronRight, PanelLeftClose, PanelLeft,
  Lock, User, Bot
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { PlanBadge } from "@/components/auth/feature-gate";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  feature?: string;
  requiredPlan?: string;
}

const NAV_GROUPS: Array<{ label: string; defaultOpen: boolean; items: NavItem[] }> = [
  {
    label: "Core",
    defaultOpen: true,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "view_dashboard" },
      { href: "/projects", label: "Projects", icon: FolderKanban, permission: "view_dashboard" },
      { href: "/tests", label: "Test Cases", icon: FlaskConical, permission: "view_dashboard" },
      { href: "/runs", label: "Test Runs", icon: Play, permission: "view_dashboard" },
      { href: "/suites", label: "Test Suites", icon: Layers, permission: "manage_suites" },
    ],
  },
  {
    label: "Create",
    defaultOpen: true,
    items: [
      { href: "/ai-generator", label: "AI Generator", icon: Sparkles, permission: "use_ai_generator" },
      { href: "/agents", label: "AI Agents", icon: Bot, permission: "use_ai_generator", feature: "ai_agents", requiredPlan: "pro" },
      { href: "/api-builder", label: "API Testing", icon: Plug, permission: "access_api_builder", feature: "api_testing", requiredPlan: "pro" },
      { href: "/mainframe", label: "Mainframe", icon: Monitor, permission: "access_mainframe", feature: "mainframe_testing", requiredPlan: "business" },
      { href: "/test-data", label: "Test Data", icon: Database, permission: "manage_test_data" },
      { href: "/objects", label: "Object Repo", icon: Archive, permission: "access_object_repo" },
    ],
  },
  {
    label: "Manage",
    defaultOpen: false,
    items: [
      { href: "/reports", label: "Reports", icon: FileBarChart, permission: "view_reports" },
      { href: "/profile", label: "Profile", icon: User, permission: "view_dashboard" },
      { href: "/settings", label: "Settings", icon: Settings, permission: "manage_settings" },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { permissions, features, plan, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(NAV_GROUPS.map(g => [g.label, g.defaultOpen]))
  );

  const canSee = (item: NavItem) => loading || !item.permission || permissions.includes(item.permission);
  const isLocked = (item: NavItem) => item.feature ? !features.includes(item.feature) : false;

  return (
    <nav className={`flex-1 py-3 overflow-y-auto transition-all duration-200 ${collapsed ? "px-1.5" : "px-2"}`}>
      <button onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 px-3 py-2 mb-2 w-full rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800/40 transition-colors">
        {collapsed ? <PanelLeft className="w-4 h-4 mx-auto" /> : <><PanelLeftClose className="w-4 h-4" /><span>Collapse</span></>}
      </button>

      {!collapsed && (
        <div className="flex items-center justify-between px-3 mb-3">
          <PlanBadge />
          {plan === "free" && <Link href="/settings?tab=billing" className="text-[10px] text-indigo-400 hover:text-indigo-300">Upgrade</Link>}
        </div>
      )}

      {NAV_GROUPS.map((group) => {
        const visible = group.items.filter(canSee);
        if (visible.length === 0) return null;
        return (
          <div key={group.label} className="mb-2">
            {!collapsed && (
              <button onClick={() => setOpenGroups(prev => ({ ...prev, [group.label]: !prev[group.label] }))}
                className="flex items-center justify-between w-full px-3 py-1.5 text-[10px] uppercase tracking-wider font-medium text-gray-500 hover:text-gray-400 transition-colors">
                {group.label}
                {openGroups[group.label] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
            )}
            {(collapsed || openGroups[group.label]) && (
              <div className={`space-y-0.5 ${collapsed ? "" : "mt-0.5"}`}>
                {visible.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  const locked = isLocked(item);
                  return (
                    <Link key={item.href} href={locked ? "/settings?tab=billing" : item.href}
                      title={collapsed ? item.label : locked ? `Requires ${item.requiredPlan} plan` : undefined}
                      className={`flex items-center gap-3 rounded-lg text-sm transition-colors ${collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2"} ${
                        locked ? "text-gray-600 hover:text-gray-500 hover:bg-gray-800/30 border border-transparent"
                        : isActive ? "bg-indigo-500/10 text-white border border-indigo-500/20"
                        : "text-gray-400 hover:text-white hover:bg-gray-800/60 border border-transparent"
                      }`}>
                      <item.icon className={`w-[18px] h-[18px] shrink-0 ${locked ? "text-gray-700" : isActive ? "text-indigo-400" : "text-gray-500"}`} />
                      {!collapsed && <><span className={locked ? "text-gray-600" : ""}>{item.label}</span>{locked && <Lock className="w-3 h-3 text-gray-700 ml-auto" />}</>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
