"use client";

// ===========================================
// TESTARA — API Client
// Pages call this instead of raw Supabase
// Ensures all data flows through API layer
// ===========================================

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function apiCall<T = Record<string, unknown>>(path: string, method: Method = "GET", body?: unknown): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(path, {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (json.error) return { data: null, error: json.error };
    return { data: json.data as T, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

// ===== TYPED API METHODS =====
export const api = {
  // Projects
  projects: {
    list: () => apiCall<Array<Record<string, unknown>>>("/api/projects"),
    get: (id: string) => apiCall<Record<string, unknown>>(`/api/projects/${id}`),
    create: (data: Record<string, unknown>) => apiCall("/api/projects", "POST", data),
    update: (id: string, data: Record<string, unknown>) => apiCall(`/api/projects/${id}`, "PUT", data),
    delete: (id: string) => apiCall(`/api/projects/${id}`, "DELETE"),
  },

  // Tests
  tests: {
    list: (projectId?: string) => apiCall<Array<Record<string, unknown>>>(projectId ? `/api/tests?project_id=${projectId}` : "/api/tests"),
    get: (id: string) => apiCall<Record<string, unknown>>(`/api/tests/${id}`),
    create: (data: Record<string, unknown>) => apiCall("/api/tests", "POST", data),
    update: (id: string, data: Record<string, unknown>) => apiCall(`/api/tests/${id}`, "PUT", data),
    delete: (id: string) => apiCall(`/api/tests/${id}`, "DELETE"),
    run: (id: string, browser = "chromium") => apiCall(`/api/tests/${id}/run`, "POST", { browser }),
    duplicate: (id: string) => apiCall(`/api/tests/${id}/duplicate`, "POST"),
  },

  // Suites
  suites: {
    list: () => apiCall<Array<Record<string, unknown>>>("/api/suites"),
    get: (id: string) => apiCall<Record<string, unknown>>(`/api/suites/${id}`),
    create: (data: Record<string, unknown>) => apiCall("/api/suites", "POST", data),
    update: (id: string, data: Record<string, unknown>) => apiCall(`/api/suites/${id}`, "PUT", data),
    delete: (id: string) => apiCall(`/api/suites/${id}`, "DELETE"),
    run: (id: string) => apiCall(`/api/suites/${id}/run`, "POST"),
  },

  // Runs
  runs: {
    list: (limit = 50) => apiCall<Array<Record<string, unknown>>>(`/api/runs?limit=${limit}`),
    get: (id: string) => apiCall<Record<string, unknown>>(`/api/runs/${id}`),
  },

  // Data
  data: {
    list: (projectId?: string) => apiCall<Array<Record<string, unknown>>>(projectId ? `/api/data?project_id=${projectId}` : "/api/data"),
    create: (data: Record<string, unknown>) => apiCall("/api/data", "POST", data),
    update: (data: Record<string, unknown>) => apiCall("/api/data", "PUT", data),
    delete: (id: string) => apiCall(`/api/data?id=${id}`, "DELETE"),
  },

  // Objects
  objects: {
    list: (projectId?: string) => apiCall<Array<Record<string, unknown>>>(projectId ? `/api/objects?project_id=${projectId}` : "/api/objects"),
  },

  // Search
  search: (q: string) => apiCall<{ tests: unknown[]; projects: unknown[]; suites: unknown[] }>(`/api/search?q=${encodeURIComponent(q)}`),

  // Reports
  reports: {
    compliance: (type: string, projectId: string) => apiCall(`/api/reports/compliance/${type}?project_id=${projectId}`),
  },

  // Agents
  agents: {
    list: () => apiCall<Array<Record<string, unknown>>>("/api/agents"),
    get: (id: string) => apiCall<Record<string, unknown>>(`/api/agents/${id}`),
    start: (data: Record<string, unknown>) => apiCall("/api/agents", "POST", data),
    approve: (id: string, action: string, proposalIds?: string[]) => apiCall(`/api/agents/${id}`, "PUT", { action, proposalIds }),
  },
};
