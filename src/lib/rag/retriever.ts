// ===========================================
// TESTARA — RAG Context Retriever
// Fetches relevant context from your data before
// every AI call. Makes AI aware of YOUR project.
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/core/logger";

// ===== CONTEXT TYPES =====
export interface RAGContext {
  // What was retrieved
  sources: string[];
  // Formatted context string (injected into prompt)
  contextText: string;
  // Token estimate (for context window management)
  estimatedTokens: number;
  // Individual pieces (for debugging)
  pieces: ContextPiece[];
}

export interface ContextPiece {
  source: string;
  content: string;
  relevance: number; // 0-1
  tokens: number;
}

// Rough token estimate: 1 token ≈ 4 chars
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ===== MAIN RETRIEVER =====
export class ContextRetriever {
  constructor(private supabase: SupabaseClient, private orgId: string) {}

  // ===== RETRIEVE FOR TEST GENERATION =====
  // Fetches: existing tests, failure history, domain profile, object repo, heal patterns
  async forTestGeneration(projectId: string, pageUrl?: string): Promise<RAGContext> {
    const pieces: ContextPiece[] = [];

    // 1. Existing test cases in this project (avoid duplicates)
    const existingTests = await this.getExistingTests(projectId);
    if (existingTests) {
      pieces.push({ source: "existing_tests", content: existingTests, relevance: 0.9, tokens: estimateTokens(existingTests) });
    }

    // 2. Recent failure patterns (what breaks often)
    const failures = await this.getRecentFailures(projectId);
    if (failures) {
      pieces.push({ source: "failure_history", content: failures, relevance: 0.8, tokens: estimateTokens(failures) });
    }

    // 3. Object Repository elements for this page
    if (pageUrl) {
      const elements = await this.getPageElements(projectId, pageUrl);
      if (elements) {
        pieces.push({ source: "object_repository", content: elements, relevance: 0.95, tokens: estimateTokens(elements) });
      }
    }

    // 4. Heal patterns (which locator strategies work best)
    const healPatterns = await this.getHealPatterns(projectId);
    if (healPatterns) {
      pieces.push({ source: "heal_patterns", content: healPatterns, relevance: 0.7, tokens: estimateTokens(healPatterns) });
    }

    // 5. Project domain profile
    const domain = await this.getProjectDomain(projectId);
    if (domain) {
      pieces.push({ source: "domain_profile", content: domain, relevance: 0.6, tokens: estimateTokens(domain) });
    }

    return this.buildContext(pieces);
  }

  // ===== RETRIEVE FOR FAILURE ANALYSIS =====
  async forFailureAnalysis(testCaseId: string, projectId: string): Promise<RAGContext> {
    const pieces: ContextPiece[] = [];

    // 1. This test's run history (last 20 runs)
    const history = await this.getTestRunHistory(testCaseId);
    if (history) {
      pieces.push({ source: "run_history", content: history, relevance: 1.0, tokens: estimateTokens(history) });
    }

    // 2. Similar failures across the project
    const similar = await this.getSimilarFailures(projectId, testCaseId);
    if (similar) {
      pieces.push({ source: "similar_failures", content: similar, relevance: 0.8, tokens: estimateTokens(similar) });
    }

    // 3. Recent heals on same elements
    const heals = await this.getRecentHeals(projectId);
    if (heals) {
      pieces.push({ source: "recent_heals", content: heals, relevance: 0.7, tokens: estimateTokens(heals) });
    }

    return this.buildContext(pieces);
  }

  // ===== RETRIEVE FOR STEP SUGGESTIONS =====
  async forStepSuggestions(projectId: string, pageUrl: string): Promise<RAGContext> {
    const pieces: ContextPiece[] = [];

    // 1. Other tests on the same page (what steps do they use)
    const samePageTests = await this.getTestsForPage(projectId, pageUrl);
    if (samePageTests) {
      pieces.push({ source: "same_page_tests", content: samePageTests, relevance: 0.95, tokens: estimateTokens(samePageTests) });
    }

    // 2. Object Repository elements for this page
    const elements = await this.getPageElements(projectId, pageUrl);
    if (elements) {
      pieces.push({ source: "page_elements", content: elements, relevance: 0.9, tokens: estimateTokens(elements) });
    }

    return this.buildContext(pieces);
  }

  // ===== RETRIEVE FOR AI ASSISTANT =====
  async forAssistant(projectId?: string): Promise<RAGContext> {
    const pieces: ContextPiece[] = [];

    if (projectId) {
      // Project-specific context
      const projectInfo = await this.getProjectInfo(projectId);
      if (projectInfo) {
        pieces.push({ source: "project_info", content: projectInfo, relevance: 0.9, tokens: estimateTokens(projectInfo) });
      }

      const testSummary = await this.getTestSummary(projectId);
      if (testSummary) {
        pieces.push({ source: "test_summary", content: testSummary, relevance: 0.8, tokens: estimateTokens(testSummary) });
      }

      const recentActivity = await this.getRecentActivity(projectId);
      if (recentActivity) {
        pieces.push({ source: "recent_activity", content: recentActivity, relevance: 0.7, tokens: estimateTokens(recentActivity) });
      }
    }

    // Org-level stats
    const orgStats = await this.getOrgStats();
    if (orgStats) {
      pieces.push({ source: "org_stats", content: orgStats, relevance: 0.5, tokens: estimateTokens(orgStats) });
    }

    return this.buildContext(pieces);
  }

  // ===== RETRIEVE FOR COVERAGE ANALYSIS =====
  async forCoverageAnalysis(projectId: string): Promise<RAGContext> {
    const pieces: ContextPiece[] = [];

    const existingTests = await this.getExistingTests(projectId);
    if (existingTests) {
      pieces.push({ source: "existing_tests", content: existingTests, relevance: 1.0, tokens: estimateTokens(existingTests) });
    }

    const failures = await this.getRecentFailures(projectId);
    if (failures) {
      pieces.push({ source: "failure_areas", content: failures, relevance: 0.8, tokens: estimateTokens(failures) });
    }

    return this.buildContext(pieces);
  }

  // ===== DATA FETCHERS =====

  private async getExistingTests(projectId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("test_cases")
      .select("title, description, status, priority, tags")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (!data || data.length === 0) return null;

    return `EXISTING TESTS IN THIS PROJECT (${data.length}):\n` +
      data.map((t: Record<string, unknown>) =>
        `- "${t.title}" [${t.status}] [${t.priority || "medium"}] ${(t.tags as string[] || []).join(", ")}`
      ).join("\n");
  }

  private async getRecentFailures(projectId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("test_runs")
      .select("status, test_cases!inner(title, project_id), test_run_results(error_message, status)")
      .eq("test_cases.project_id", projectId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(15);

    if (!data || data.length === 0) return null;

    return `RECENT FAILURES (${data.length}):\n` +
      data.map((r: Record<string, unknown>) => {
        const title = (r.test_cases as Record<string, string>)?.title || "Unknown";
        const errors = (r.test_run_results as Array<Record<string, string>> || [])
          .filter(rr => rr.error_message).map(rr => rr.error_message).slice(0, 2);
        return `- "${title}": ${errors.join("; ") || "unknown error"}`;
      }).join("\n");
  }

  private async getPageElements(projectId: string, pageUrl: string): Promise<string | null> {
    // Extract page path from URL
    const pagePath = new URL(pageUrl).pathname;

    const { data } = await this.supabase
      .from("object_repository")
      .select("logical_name, page_name, fingerprint")
      .eq("project_id", projectId)
      .ilike("page_url_pattern", `%${pagePath}%`)
      .limit(20);

    if (!data || data.length === 0) return null;

    return `KNOWN ELEMENTS ON THIS PAGE (${data.length}):\n` +
      data.map((e: Record<string, unknown>) => {
        const fp = e.fingerprint as Record<string, unknown>;
        const meta = fp?.meta as Record<string, string>;
        return `- "${e.logical_name}" → ${meta?.recommended_selector || "no selector"} (${meta?.recommended_strategy || "unknown"})`;
      }).join("\n");
  }

  private async getHealPatterns(projectId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("object_repository")
      .select("heal_history")
      .eq("project_id", projectId)
      .not("heal_history", "is", null)
      .limit(50);

    if (!data) return null;

    const methods: Record<string, number> = {};
    for (const entry of data) {
      for (const heal of (entry.heal_history as Array<Record<string, string>> || [])) {
        methods[heal.method] = (methods[heal.method] || 0) + 1;
      }
    }

    const sorted = Object.entries(methods).sort(([, a], [, b]) => b - a);
    if (sorted.length === 0) return null;

    return `LOCATOR HEAL PATTERNS (which strategies break most):\n` +
      sorted.map(([method, count]) => `- ${method}: healed ${count} time(s)`).join("\n") +
      `\nRECOMMENDATION: Prefer strategies that DON'T appear in this list. They're more stable.`;
  }

  private async getProjectDomain(projectId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("projects")
      .select("name, base_url, description")
      .eq("id", projectId)
      .single();

    if (!data) return null;
    return `PROJECT: "${data.name}" at ${data.base_url}\n${data.description || ""}`;
  }

  private async getTestRunHistory(testCaseId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("test_runs")
      .select("status, duration_ms, created_at, test_run_results(status, error_message)")
      .eq("test_case_id", testCaseId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!data || data.length === 0) return null;

    return `LAST ${data.length} RUNS:\n` +
      data.map((r: Record<string, unknown>) => {
        const date = new Date(r.created_at as string).toLocaleDateString();
        const errors = (r.test_run_results as Array<Record<string, string>> || [])
          .filter(rr => rr.error_message).map(rr => rr.error_message.slice(0, 80));
        return `- ${date}: ${r.status} (${r.duration_ms}ms)${errors.length ? " — " + errors[0] : ""}`;
      }).join("\n");
  }

  private async getSimilarFailures(projectId: string, testCaseId: string): Promise<string | null> {
    const { data: currentRun } = await this.supabase
      .from("test_runs")
      .select("test_run_results(error_message)")
      .eq("test_case_id", testCaseId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!currentRun) return null;
    const currentError = ((currentRun.test_run_results as Array<Record<string, string>> || [])[0])?.error_message;
    if (!currentError) return null;

    // Find other tests with similar error messages
    const errorKeyword = currentError.split(" ").slice(0, 3).join(" ");
    const { data } = await this.supabase
      .from("test_run_results")
      .select("error_message, test_runs!inner(test_case_id, test_cases!inner(title, project_id))")
      .not("error_message", "is", null)
      .ilike("error_message", `%${errorKeyword}%`)
      .limit(5);

    if (!data || data.length === 0) return null;

    return `SIMILAR FAILURES IN PROJECT:\n` +
      data.map((r: Record<string, unknown>) => {
        const run = r.test_runs as Record<string, unknown>;
        const test = run?.test_cases as Record<string, string>;
        return `- "${test?.title}": ${(r.error_message as string).slice(0, 100)}`;
      }).join("\n");
  }

  private async getRecentHeals(projectId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("test_run_results")
      .select("heal_action, test_runs!inner(test_cases!inner(title, project_id))")
      .not("heal_action", "is", null)
      .eq("test_runs.test_cases.project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!data || data.length === 0) return null;

    return `RECENT SELF-HEALS:\n` +
      data.map((r: Record<string, unknown>) => {
        const heal = r.heal_action as Record<string, string>;
        return `- ${heal?.original_selector} → ${heal?.new_selector} (${heal?.method})`;
      }).join("\n");
  }

  private async getTestsForPage(projectId: string, pageUrl: string): Promise<string | null> {
    const pagePath = new URL(pageUrl).pathname;
    const { data } = await this.supabase
      .from("test_cases")
      .select("title, test_steps(action_type, target, input_data)")
      .eq("project_id", projectId)
      .limit(5);

    if (!data || data.length === 0) return null;

    // Find tests that navigate to similar URLs
    const relevant = data.filter((t: Record<string, unknown>) =>
      (t.test_steps as Array<Record<string, unknown>> || []).some(s =>
        s.action_type === "navigate" && JSON.stringify(s.target || s.input_data || "").includes(pagePath)
      )
    );

    if (relevant.length === 0) return null;

    return `EXISTING TESTS FOR THIS PAGE:\n` +
      relevant.map((t: Record<string, unknown>) => {
        const steps = (t.test_steps as Array<Record<string, unknown>> || [])
          .map(s => `${s.action_type}: ${(s.target as Record<string, string>)?.description || ""}`).join(" → ");
        return `- "${t.title}": ${steps}`;
      }).join("\n");
  }

  private async getProjectInfo(projectId: string): Promise<string | null> {
    const { data } = await this.supabase.from("projects").select("*").eq("id", projectId).single();
    if (!data) return null;
    return `PROJECT: ${data.name}\nURL: ${data.base_url}\nDescription: ${data.description || "N/A"}`;
  }

  private async getTestSummary(projectId: string): Promise<string | null> {
    const { data: tests } = await this.supabase
      .from("test_cases")
      .select("status, priority")
      .eq("project_id", projectId);

    if (!tests || tests.length === 0) return null;

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    tests.forEach((t: Record<string, string>) => {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byPriority[t.priority || "medium"] = (byPriority[t.priority || "medium"] || 0) + 1;
    });

    return `TEST SUMMARY: ${tests.length} total\nBy status: ${JSON.stringify(byStatus)}\nBy priority: ${JSON.stringify(byPriority)}`;
  }

  private async getRecentActivity(projectId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("test_runs")
      .select("status, created_at, test_cases!inner(title, project_id)")
      .eq("test_cases.project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!data || data.length === 0) return null;

    return `RECENT ACTIVITY:\n` +
      data.map((r: Record<string, unknown>) =>
        `- ${new Date(r.created_at as string).toLocaleDateString()}: ${(r.test_cases as Record<string, string>)?.title} → ${r.status}`
      ).join("\n");
  }

  private async getOrgStats(): Promise<string | null> {
    const [tests, runs, projects] = await Promise.all([
      this.supabase.from("test_cases").select("*", { count: "exact", head: true }),
      this.supabase.from("test_runs").select("*", { count: "exact", head: true }),
      this.supabase.from("projects").select("*", { count: "exact", head: true }).eq("org_id", this.orgId),
    ]);

    return `ORG STATS: ${projects.count || 0} projects, ${tests.count || 0} tests, ${runs.count || 0} runs`;
  }

  // ===== BUILD FINAL CONTEXT =====
  private buildContext(pieces: ContextPiece[]): RAGContext {
    // Sort by relevance (most relevant first)
    const sorted = pieces.sort((a, b) => b.relevance - a.relevance);

    // Fit within token budget (leave room for system prompt + user prompt + output)
    const TOKEN_BUDGET = 4000; // Max context tokens for RAG
    let totalTokens = 0;
    const included: ContextPiece[] = [];

    for (const piece of sorted) {
      if (totalTokens + piece.tokens > TOKEN_BUDGET) {
        // Truncate this piece to fit
        const remaining = TOKEN_BUDGET - totalTokens;
        if (remaining > 100) {
          const truncated = piece.content.slice(0, remaining * 4);
          included.push({ ...piece, content: truncated + "\n...(truncated)", tokens: remaining });
          totalTokens += remaining;
        }
        break;
      }
      included.push(piece);
      totalTokens += piece.tokens;
    }

    const contextText = included.length > 0
      ? `\n\n=== CONTEXT FROM YOUR PROJECT (retrieved automatically) ===\n${included.map(p => p.content).join("\n\n")}\n=== END CONTEXT ===\n`
      : "";

    logger.info("rag.context_built", {
      sources: included.map(p => p.source),
      pieces: included.length,
      totalTokens,
      budget: TOKEN_BUDGET,
    });

    return {
      sources: included.map(p => p.source),
      contextText,
      estimatedTokens: totalTokens,
      pieces: included,
    };
  }
}
