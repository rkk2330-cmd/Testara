"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

// ===== GENERIC FETCH HOOK =====
function useApi<T>(url: string, options?: { autoLoad?: boolean }) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(options?.autoLoad !== false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) { setError(json.error); toast.error(json.error); }
      else setData(json.data);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }, [url]);

  useEffect(() => { if (options?.autoLoad !== false) load(); }, [load, options?.autoLoad]);

  return { data, loading, error, reload: load, setData };
}

// ===== TESTS HOOK =====
export function useTests(projectId?: string) {
  const url = projectId ? `/api/tests?project_id=${projectId}` : "/api/tests";
  const { data: tests, loading, reload } = useApi<Array<Record<string, unknown>>>(url);

  const deleteTest = async (id: string) => {
    if (!confirm("Delete this test case? This cannot be undone.")) return false;
    const res = await fetch(`/api/tests/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    toast.success("Test case deleted");
    reload();
    return true;
  };

  const archiveTest = async (id: string) => {
    const res = await fetch(`/api/tests/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "archived" }) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    toast.success("Test case archived");
    reload();
    return true;
  };

  const updateTest = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/tests/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    toast.success("Test case updated");
    reload();
    return true;
  };

  const runTest = async (id: string, browser = "chromium") => {
    const res = await fetch(`/api/tests/${id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ browser }) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return null; }
    return json.data;
  };

  return { tests: tests || [], loading, reload, deleteTest, archiveTest, updateTest, runTest };
}

// ===== PROJECTS HOOK =====
export function useProjects() {
  const { data: projects, loading, reload } = useApi<Array<Record<string, unknown>>>("/api/projects");

  const createProject = async (input: { name: string; base_url?: string; description?: string }) => {
    const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return null; }
    toast.success("Project created");
    reload();
    return json.data;
  };

  const updateProject = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/projects/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    toast.success("Project updated");
    reload();
    return true;
  };

  const deleteProject = async (id: string) => {
    if (!confirm("Delete this project and ALL its tests? This cannot be undone.")) return false;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    toast.success(`Project deleted (${json.data.tests_deleted} tests removed)`);
    reload();
    return true;
  };

  return { projects: projects || [], loading, reload, createProject, updateProject, deleteProject };
}

// ===== SUITES HOOK =====
export function useSuites() {
  const { data: suites, loading, reload } = useApi<Array<Record<string, unknown>>>("/api/suites");

  const createSuite = async (input: Record<string, unknown>) => {
    const res = await fetch("/api/suites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return null; }
    toast.success("Suite created");
    reload();
    return json.data;
  };

  const updateSuite = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/suites/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    toast.success("Suite updated");
    reload();
    return true;
  };

  const deleteSuite = async (id: string) => {
    if (!confirm("Delete this suite?")) return false;
    const res = await fetch(`/api/suites/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    toast.success("Suite deleted");
    reload();
    return true;
  };

  const runSuite = async (id: string) => {
    const res = await fetch(`/api/suites/${id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return null; }
    toast.success(`${json.data?.total || 0} tests executed`);
    return json.data;
  };

  return { suites: suites || [], loading, reload, createSuite, updateSuite, deleteSuite, runSuite };
}

// ===== RUNS HOOK =====
export function useRuns(limit = 50) {
  const { data: runs, loading, reload } = useApi<Array<Record<string, unknown>>>(`/api/runs?limit=${limit}`);
  return { runs: runs || [], loading, reload };
}

// ===== DATASETS HOOK =====
export function useDatasets(projectId?: string) {
  const url = projectId ? `/api/data?project_id=${projectId}` : "/api/data";
  const { data: datasets, loading, reload } = useApi<Array<Record<string, unknown>>>(url);

  const createDataset = async (input: Record<string, unknown>) => {
    const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return null; }
    toast.success("Dataset created");
    reload();
    return json.data;
  };

  const updateDataset = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...updates }) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    return true;
  };

  const deleteDataset = async (id: string) => {
    if (!confirm("Delete this dataset?")) return false;
    const res = await fetch(`/api/data?id=${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    toast.success("Dataset deleted");
    reload();
    return true;
  };

  return { datasets: datasets || [], loading, reload, createDataset, updateDataset, deleteDataset };
}

// ===== BILLING HOOK =====
export function useBilling() {
  const { data: billing, loading, reload } = useApi<Record<string, unknown>>("/api/billing");

  const upgrade = async (plan: string) => {
    const res = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) });
    return res.json();
  };

  const verifyPayment = async (paymentData: Record<string, unknown>) => {
    const res = await fetch("/api/billing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paymentData) });
    return res.json();
  };

  return { billing, loading, reload, upgrade, verifyPayment };
}

// ===== TEAM HOOK =====
export function useTeam() {
  const { data: team, loading, reload } = useApi<Record<string, unknown>>("/api/team");

  const invite = async (email: string, role: string) => {
    const res = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return null; }
    toast.success(`Invite sent to ${email}`);
    reload();
    return json.data;
  };

  const updateRole = async (userId: string, role: string) => {
    const res = await fetch("/api/team", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, role }) });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    toast.success("Role updated");
    reload();
    return true;
  };

  const remove = async (userId: string) => {
    if (!confirm("Remove this member?")) return false;
    const res = await fetch(`/api/team?user_id=${userId}`, { method: "DELETE" });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return false; }
    toast.success("Member removed");
    reload();
    return true;
  };

  return { members: (team as Record<string, unknown>)?.members as Array<Record<string, string>> || [], pendingInvites: (team as Record<string, unknown>)?.pending_invites as Array<Record<string, string>> || [], loading, reload, invite, updateRole, remove };
}
