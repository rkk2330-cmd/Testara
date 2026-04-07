// ===========================================
// TESTARA — Service Layer
// Business logic lives here, not in API routes
// Routes call services → services call repositories
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/security/auth";
import { TestRepository, ProjectRepository, SuiteRepository, DatasetRepository } from "./repositories";
import { logger } from "./logger";

// Event emitter interface — injected, not imported (avoids circular dep)
export interface EventEmitter {
  emit(event: { eventType: string; timestamp: string; userId: string; orgId: string; data: Record<string, unknown> }): Promise<void> | void;
}

// Default no-op emitter (used when events module not loaded)
const noopEmitter: EventEmitter = { emit: () => {} };

function createEventPayload(type: string, userId: string, orgId: string, data: Record<string, unknown>) {
  return { eventType: type, timestamp: new Date().toISOString(), userId, orgId, data };
}

// ===== TEST SERVICE =====
export class TestService {
  private repo: TestRepository;
  private events: EventEmitter;

  constructor(private supabase: SupabaseClient, private auth: AuthContext, events?: EventEmitter) {
    this.repo = new TestRepository(supabase, auth.org_id);
    this.events = events || noopEmitter;
  }

  async getById(id: string) {
    return this.repo.findById(id);
  }

  async list() {
    return this.repo.findAll();
  }

  async listByProject(projectId: string) {
    return this.repo.findByProject(projectId);
  }

  async create(input: { title: string; description?: string; project_id: string; tags?: string[]; priority?: string; steps?: Array<Record<string, unknown>>; ai_generated?: boolean; confidence?: number }) {
    const test = await this.repo.create({
      ...input,
      created_by: this.auth.user_id,
    });

    if (input.steps && input.steps.length > 0) {
      await this.repo.replaceSteps(test.id, input.steps);
    }

    logger.info("test.created", { testId: test.id, title: input.title, userId: this.auth.user_id, orgId: this.auth.org_id, steps: input.steps?.length || 0 });
    this.events.emit(createEventPayload("test.created", this.auth.user_id, this.auth.org_id, { testId: test.id, title: input.title }));
    return test;
  }

  async update(id: string, input: { title?: string; description?: string; tags?: string[]; status?: string; priority?: string; steps?: Array<Record<string, unknown>> }) {
    const { steps, ...updates } = input;
    await this.repo.update(id, updates);

    if (steps) {
      await this.repo.replaceSteps(id, steps);
    }

    logger.info("test.updated", { testId: id, updates: Object.keys(input), userId: this.auth.user_id });
    return { id, updated: true };
  }

  async delete(id: string) {
    const test = await this.repo.delete(id);
    logger.info("test.deleted", { testId: id, title: (test as Record<string, string>).title, userId: this.auth.user_id, orgId: this.auth.org_id });
    this.events.emit(createEventPayload("test.deleted", this.auth.user_id, this.auth.org_id, { testId: id, title: (test as Record<string, string>).title }));
    return { id, deleted: true };
  }

  async archive(id: string) {
    await this.repo.update(id, { status: "archived" });
    logger.info("test.archived", { testId: id, userId: this.auth.user_id });
    return { id, archived: true };
  }

  async activate(id: string) {
    await this.repo.update(id, { status: "active" });
    logger.info("test.activated", { testId: id, userId: this.auth.user_id });
    return { id, activated: true };
  }

  async duplicate(id: string) {
    const original = await this.repo.findById(id);
    const newTest = await this.repo.create({
      title: `${(original as Record<string, string>).title} (Copy)`,
      description: (original as Record<string, string>).description,
      project_id: (original as Record<string, string>).project_id,
      tags: (original as Record<string, string[]>).tags || [],
      created_by: this.auth.user_id,
    });

    // Copy steps
    const steps = ((original as Record<string, unknown>).test_steps as Array<Record<string, unknown>> || []).map(s => ({
      order_index: s.order_index,
      action_type: s.action_type,
      target: s.target,
      input_data: s.input_data,
      expected_result: s.expected_result,
    }));
    if (steps.length > 0) await this.repo.replaceSteps(newTest.id, steps);

    logger.info("test.duplicated", { originalId: id, newId: newTest.id, userId: this.auth.user_id });
    return newTest;
  }
}

// ===== PROJECT SERVICE =====
export class ProjectService {
  private events: EventEmitter;
  private repo: ProjectRepository;

  constructor(private supabase: SupabaseClient, private auth: AuthContext) {
    this.events = noopEmitter;
    this.repo = new ProjectRepository(supabase, auth.org_id);
  }

  async getById(id: string) { return this.repo.findById(id); }
  async list() { return this.repo.findAll(); }

  async create(input: { name: string; base_url?: string; description?: string }) {
    const project = await this.repo.create(input);
    logger.info("project.created", { projectId: project.id, name: input.name, userId: this.auth.user_id });
    return project;
  }

  async update(id: string, input: { name?: string; base_url?: string; description?: string }) {
    await this.repo.update(id, input);
    logger.info("project.updated", { projectId: id, updates: Object.keys(input), userId: this.auth.user_id });
    return { id, updated: true };
  }

  async delete(id: string) {
    const result = await this.repo.delete(id);
    logger.info("project.deleted", { projectId: id, name: (result.project as Record<string, string>).name, testsDeleted: result.testsDeleted, userId: this.auth.user_id });
    return { id, deleted: true, tests_deleted: result.testsDeleted };
  }
}

// ===== SUITE SERVICE =====
export class SuiteService {
  private repo: SuiteRepository;

  constructor(private supabase: SupabaseClient, private auth: AuthContext) {
    this.events = noopEmitter;
    this.repo = new SuiteRepository(supabase, auth.org_id);
  }

  async getById(id: string) { return this.repo.findById(id); }
  async list() { return this.repo.findAll(); }

  async create(input: { name: string; description?: string; project_id: string; test_case_ids: string[]; schedule_cron?: string }) {
    const suite = await this.repo.create({ ...input, created_by: this.auth.user_id });
    logger.info("suite.created", { suiteId: suite.id, name: input.name, testCount: input.test_case_ids.length, userId: this.auth.user_id });
    return suite;
  }

  async update(id: string, input: { name?: string; description?: string; test_case_ids?: string[]; schedule_cron?: string | null }) {
    await this.repo.update(id, input);
    logger.info("suite.updated", { suiteId: id, updates: Object.keys(input), userId: this.auth.user_id });
    return { id, updated: true };
  }

  async delete(id: string) {
    const suite = await this.repo.delete(id);
    logger.info("suite.deleted", { suiteId: id, name: (suite as Record<string, string>).name, userId: this.auth.user_id });
    return { id, deleted: true };
  }
}

// ===== DATASET SERVICE =====
export class DatasetService {
  private repo: DatasetRepository;

  constructor(private supabase: SupabaseClient, private auth: AuthContext) {
    this.events = noopEmitter;
    this.repo = new DatasetRepository(supabase, auth.org_id);
  }

  async list(projectId?: string) { return this.repo.findAll(projectId); }

  async create(input: { name: string; columns: string[]; rows?: Record<string, string>[]; project_id?: string }) {
    const dataset = await this.repo.create({ ...input, rows: input.rows || [], created_by: this.auth.user_id });
    logger.info("dataset.created", { datasetId: dataset.id, name: input.name, columns: input.columns.length, rows: input.rows?.length || 0 });
    return dataset;
  }

  async update(id: string, input: { name?: string; columns?: string[]; rows?: Record<string, string>[] }) {
    await this.repo.update(id, input);
    logger.info("dataset.updated", { datasetId: id, updates: Object.keys(input) });
    return { id, updated: true };
  }

  async delete(id: string) {
    await this.repo.delete(id);
    logger.info("dataset.deleted", { datasetId: id, userId: this.auth.user_id });
    return { id, deleted: true };
  }
}
