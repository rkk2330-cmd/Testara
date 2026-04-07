// ===========================================
// TESTARA — Repository Layer
// Single source of truth for all DB queries
// Change a query here → updates everywhere
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { NotFoundError } from "@/lib/core/errors";

// ===== BASE REPOSITORY =====
export class BaseRepository {
  constructor(protected supabase: SupabaseClient, protected orgId: string) {}
}

// ===== TEST CASE REPOSITORY =====
export class TestRepository extends BaseRepository {
  async findById(id: string) {
    const { data, error } = await this.supabase
      .from("test_cases")
      .select("*, test_steps(*), projects(name, base_url, org_id)")
      .eq("id", id)
      .single();

    if (error || !data) throw new NotFoundError("TestCase", id);
    if ((data as Record<string, unknown>).projects && ((data as Record<string, unknown>).projects as Record<string, string>).org_id !== this.orgId) {
      throw new NotFoundError("TestCase", id); // Don't reveal existence to other orgs
    }
    return data;
  }

  async findByProject(projectId: string) {
    const { data } = await this.supabase
      .from("test_cases")
      .select("*, test_steps(id)")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    return data || [];
  }

  async findAll() {
    const { data } = await this.supabase
      .from("test_cases")
      .select("*, projects(name), test_steps(id)")
      .order("updated_at", { ascending: false });
    return data || [];
  }

  async create(input: { title: string; description?: string; project_id: string; tags?: string[]; priority?: string; created_by: string; ai_generated?: boolean; confidence?: number }) {
    const { data, error } = await this.supabase
      .from("test_cases")
      .insert({ ...input, status: "draft", version: 1 })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, updates: Record<string, unknown>) {
    await this.findById(id); // Verify ownership
    const { error } = await this.supabase
      .from("test_cases")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  async delete(id: string) {
    const test = await this.findById(id); // Verify ownership
    await this.supabase.from("test_steps").delete().eq("test_case_id", id);
    await this.supabase.from("test_runs").delete().eq("test_case_id", id);
    await this.supabase.from("test_cases").delete().eq("id", id);
    return test;
  }

  async replaceSteps(testCaseId: string, steps: Array<Record<string, unknown>>) {
    await this.supabase.from("test_steps").delete().eq("test_case_id", testCaseId);
    if (steps.length > 0) {
      const rows = steps.map((s, idx) => ({
        test_case_id: testCaseId,
        order_index: (s.order_index as number) ?? idx + 1,
        action_type: s.action_type,
        target: s.target || { selector: "", fallback_selectors: {}, description: "" },
        input_data: s.input_data || null,
        expected_result: s.expected_result || null,
      }));
      const { error } = await this.supabase.from("test_steps").insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  async countByOrg() {
    const { count } = await this.supabase
      .from("test_cases")
      .select("*", { count: "exact", head: true });
    return count || 0;
  }
}

// ===== PROJECT REPOSITORY =====
export class ProjectRepository extends BaseRepository {
  async findById(id: string) {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("org_id", this.orgId)
      .single();
    if (error || !data) throw new NotFoundError("Project", id);
    return data;
  }

  async findAll() {
    const { data } = await this.supabase
      .from("projects")
      .select("*")
      .eq("org_id", this.orgId)
      .order("created_at", { ascending: false });
    return data || [];
  }

  async create(input: { name: string; base_url?: string; description?: string }) {
    const { data, error } = await this.supabase
      .from("projects")
      .insert({ ...input, org_id: this.orgId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, updates: Record<string, unknown>) {
    await this.findById(id); // Verify ownership
    const { error } = await this.supabase
      .from("projects")
      .update(updates)
      .eq("id", id)
      .eq("org_id", this.orgId);
    if (error) throw new Error(error.message);
  }

  async delete(id: string) {
    const project = await this.findById(id);
    // Cascade: get all tests → delete steps, runs, tests, suites, repo entries
    const { data: tests } = await this.supabase.from("test_cases").select("id").eq("project_id", id);
    const testIds = (tests || []).map((t: Record<string, string>) => t.id);

    if (testIds.length > 0) {
      await this.supabase.from("test_steps").delete().in("test_case_id", testIds);
      await this.supabase.from("test_runs").delete().in("test_case_id", testIds);
      await this.supabase.from("test_cases").delete().eq("project_id", id);
    }
    await this.supabase.from("test_suites").delete().eq("project_id", id);
    await this.supabase.from("object_repository").delete().eq("project_id", id);
    await this.supabase.from("projects").delete().eq("id", id);

    return { project, testsDeleted: testIds.length };
  }

  async countByOrg() {
    const { count } = await this.supabase
      .from("projects")
      .select("*", { count: "exact", head: true })
      .eq("org_id", this.orgId);
    return count || 0;
  }
}

// ===== SUITE REPOSITORY =====
export class SuiteRepository extends BaseRepository {
  async findById(id: string) {
    const { data, error } = await this.supabase
      .from("test_suites")
      .select("*, projects(name, org_id)")
      .eq("id", id)
      .single();
    if (error || !data) throw new NotFoundError("TestSuite", id);
    if ((data as Record<string, unknown>).projects && ((data as Record<string, unknown>).projects as Record<string, string>).org_id !== this.orgId) {
      throw new NotFoundError("TestSuite", id);
    }
    return data;
  }

  async findAll() {
    const { data } = await this.supabase
      .from("test_suites")
      .select("*")
      .order("created_at", { ascending: false });
    return data || [];
  }

  async create(input: { name: string; description?: string; project_id: string; test_case_ids: string[]; created_by: string; schedule_cron?: string }) {
    const { data, error } = await this.supabase
      .from("test_suites")
      .insert(input)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, updates: Record<string, unknown>) {
    await this.findById(id);
    const { error } = await this.supabase.from("test_suites").update(updates).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async delete(id: string) {
    const suite = await this.findById(id);
    await this.supabase.from("test_suites").delete().eq("id", id);
    return suite;
  }
}

// ===== DATASET REPOSITORY =====
export class DatasetRepository extends BaseRepository {
  async findAll(projectId?: string) {
    let query = this.supabase.from("test_data").select("*").eq("org_id", this.orgId).order("updated_at", { ascending: false });
    if (projectId) query = query.eq("project_id", projectId);
    const { data } = await query;
    return data || [];
  }

  async create(input: { name: string; columns: string[]; rows: Record<string, string>[]; project_id?: string; created_by: string }) {
    const { data, error } = await this.supabase
      .from("test_data")
      .insert({ ...input, org_id: this.orgId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, updates: Record<string, unknown>) {
    const { error } = await this.supabase
      .from("test_data")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", this.orgId);
    if (error) throw new Error(error.message);
  }

  async delete(id: string) {
    const { error } = await this.supabase.from("test_data").delete().eq("id", id).eq("org_id", this.orgId);
    if (error) throw new Error(error.message);
  }
}
