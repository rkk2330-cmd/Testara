// ===========================================
// TESTARA — Job Queue
// Decouples heavy work from HTTP request lifecycle
// In-memory for Vercel, BullMQ for dedicated workers
// ===========================================

import { eventBus, createEvent, type EventType } from "./bus";
import { logger } from "@/lib/core/logger";

// ===== JOB DEFINITION =====
export type JobType = "ai_generate" | "test_run" | "suite_run" | "export_report" | "send_email";

export interface Job {
  id: string;
  type: JobType;
  status: "queued" | "processing" | "completed" | "failed";
  userId: string;
  orgId: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

type JobProcessor = (job: Job) => Promise<Record<string, unknown>>;

// ===== IN-MEMORY JOB QUEUE =====
class JobQueue {
  private queue: Job[] = [];
  private processors: Map<JobType, JobProcessor> = new Map();
  private completedJobs: Map<string, Job> = new Map();
  private processing = false;
  private maxCompleted = 500;

  // Register a processor for a job type
  registerProcessor(type: JobType, processor: JobProcessor): void {
    this.processors.set(type, processor);
    logger.info("queue.processor_registered", { type });
  }

  // Enqueue a job — returns immediately
  async enqueue(type: JobType, userId: string, orgId: string, payload: Record<string, unknown>): Promise<Job> {
    const job: Job = {
      id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      status: "queued",
      userId,
      orgId,
      payload,
      createdAt: new Date().toISOString(),
    };

    this.queue.push(job);

    // Emit queued event
    await eventBus.emit(createEvent(
      `${type === "ai_generate" ? "ai.generation" : type === "test_run" ? "test.run" : "suite.run"}.queued` as EventType,
      userId, orgId, { jobId: job.id, type }
    ));

    logger.info("queue.job_enqueued", { jobId: job.id, type, queueLength: this.queue.length });

    // Process queue (non-blocking)
    this.processNext();

    return job;
  }

  // Process next job in queue
  private async processNext(): Promise<void> {
    if (this.processing) return;
    if (this.queue.length === 0) return;

    const job = this.queue.shift();
    if (!job) return;

    const processor = this.processors.get(job.type);
    if (!processor) {
      logger.error("queue.no_processor", { type: job.type, jobId: job.id });
      return;
    }

    this.processing = true;
    job.status = "processing";
    job.startedAt = new Date().toISOString();

    // Emit started event
    const startEvent = job.type === "ai_generate" ? "ai.generation.started" : job.type === "test_run" ? "test.run.started" : "suite.run.queued";
    await eventBus.emit(createEvent(startEvent as EventType, job.userId, job.orgId, { jobId: job.id }));

    try {
      const result = await processor(job);
      job.status = "completed";
      job.result = result;
      job.completedAt = new Date().toISOString();

      // Emit completed event
      const completedEvent = job.type === "ai_generate" ? "ai.generation.completed" : job.type === "test_run" ? "test.run.passed" : "suite.run.completed";
      await eventBus.emit(createEvent(completedEvent as EventType, job.userId, job.orgId, { jobId: job.id, ...result }));

      logger.info("queue.job_completed", { jobId: job.id, type: job.type, duration_ms: Date.now() - new Date(job.startedAt!).getTime() });
    } catch (error) {
      job.status = "failed";
      job.error = (error as Error).message;
      job.completedAt = new Date().toISOString();

      // Emit failed event
      const failedEvent = job.type === "ai_generate" ? "ai.generation.failed" : job.type === "test_run" ? "test.run.failed" : "suite.run.completed";
      await eventBus.emit(createEvent(failedEvent as EventType, job.userId, job.orgId, { jobId: job.id, error: job.error }));

      logger.error("queue.job_failed", { jobId: job.id, type: job.type, error: job.error });
    }

    // Store completed job
    this.completedJobs.set(job.id, job);
    if (this.completedJobs.size > this.maxCompleted) {
      const oldest = this.completedJobs.keys().next().value;
      if (oldest) this.completedJobs.delete(oldest);
    }

    this.processing = false;

    // Process next job
    if (this.queue.length > 0) {
      // Use setTimeout to avoid blocking the event loop
      setTimeout(() => this.processNext(), 10);
    }
  }

  // Get job status by ID
  getJob(id: string): Job | undefined {
    const queued = this.queue.find(j => j.id === id);
    if (queued) return queued;
    return this.completedJobs.get(id);
  }

  // Get queue stats
  getStats(): { queued: number; completed: number; failed: number } {
    const completed = Array.from(this.completedJobs.values());
    return {
      queued: this.queue.length,
      completed: completed.filter(j => j.status === "completed").length,
      failed: completed.filter(j => j.status === "failed").length,
    };
  }
}

// ===== SINGLETON =====
export const jobQueue = new JobQueue();
