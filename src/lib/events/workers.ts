// ===========================================
// TESTARA — Event Workers
// Side effects triggered by events
// Each worker is independent — one failing
// doesn't affect others
// ===========================================

import { eventBus, type EventPayload } from "./bus";
import { logger } from "@/lib/core/logger";

// ===== SSE CLIENT REGISTRY =====
// Stores active SSE connections for real-time push
type SSEClient = { orgId: string; controller: ReadableStreamDefaultController };
const sseClients: SSEClient[] = [];

export function addSSEClient(orgId: string, controller: ReadableStreamDefaultController): void {
  sseClients.push({ orgId, controller });
}

export function removeSSEClient(controller: ReadableStreamDefaultController): void {
  const idx = sseClients.findIndex(c => c.controller === controller);
  if (idx !== -1) sseClients.splice(idx, 1);
}

function pushToClients(orgId: string, event: EventPayload): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const encoder = new TextEncoder();
  for (const client of sseClients) {
    if (client.orgId === orgId) {
      try { client.controller.enqueue(encoder.encode(data)); } catch {
        removeSSEClient(client.controller);
      }
    }
  }
}

// ===== NOTIFICATION WORKER =====
// Pushes real-time notifications to connected clients via SSE
function notificationWorker(event: EventPayload): void {
  pushToClients(event.orgId, event);
}

// ===== AUDIT TRAIL WORKER =====
// Logs every event as structured audit entry
function auditWorker(event: EventPayload): void {
  logger.info("audit.trail", {
    eventType: event.eventType,
    userId: event.userId,
    orgId: event.orgId,
    data: event.data,
    timestamp: event.timestamp,
  });
}

// ===== SLACK WORKER =====
// Posts to Slack on test failures and suite completions
async function slackWorker(event: EventPayload): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  let message = "";

  switch (event.eventType) {
    case "test.run.failed":
      message = `🔴 Test failed: *${event.data.testTitle}*\nError: ${event.data.errorMessage}\n<${process.env.NEXT_PUBLIC_APP_URL}/runs/${event.data.runId}|View Run>`;
      break;
    case "test.run.healed":
      message = `🟡 Test self-healed: *${event.data.testTitle}*\nSelector: \`${event.data.oldSelector}\` → \`${event.data.newSelector}\``;
      break;
    case "suite.run.completed":
      message = `📊 Suite completed: *${event.data.suiteName}*\nPassed: ${event.data.passed}/${event.data.total} (${event.data.passRate}%)`;
      break;
    case "billing.plan.upgraded":
      message = `🎉 Plan upgraded to *${event.data.plan}* by ${event.data.email}`;
      break;
    default:
      return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
  } catch (err) {
    logger.error("slack.webhook_failed", { error: (err as Error).message });
  }
}

// ===== ANALYTICS WORKER =====
// Tracks usage metrics for billing and reporting
function analyticsWorker(event: EventPayload): void {
  // Track key events for billing usage
  const trackable: Record<string, string> = {
    "ai.generation.completed": "ai_generation",
    "test.run.passed": "test_run",
    "test.run.failed": "test_run",
    "test.run.healed": "test_run",
    "test.created": "test_created",
  };

  const metric = trackable[event.eventType];
  if (metric) {
    logger.info("analytics.track", {
      metric,
      userId: event.userId,
      orgId: event.orgId,
      timestamp: event.timestamp,
    });
  }
}

// ===== USAGE LIMIT WARNING WORKER =====
// Checks if user is approaching plan limits
async function usageLimitWorker(event: EventPayload): Promise<void> {
  if (!["ai.generation.completed", "test.run.passed", "test.run.failed"].includes(event.eventType)) return;

  const usage = event.data.currentUsage as number;
  const limit = event.data.limit as number;
  if (!usage || !limit) return;

  const percentage = (usage / limit) * 100;

  if (percentage >= 90 && percentage < 100) {
    eventBus.emit({
      eventType: "billing.usage.limit_warning",
      timestamp: new Date().toISOString(),
      userId: event.userId,
      orgId: event.orgId,
      data: { resource: event.data.resource, usage, limit, percentage: Math.round(percentage) },
    });
  }
}

// ===== REGISTER ALL WORKERS =====
export function initializeWorkers(): void {
  // Real-time notifications — ALL events push to SSE clients
  eventBus.onAll(notificationWorker);

  // Audit trail — ALL events logged
  eventBus.onAll(auditWorker);

  // Slack — specific failure/completion events
  eventBus.on([
    "test.run.failed", "test.run.healed",
    "suite.run.completed", "billing.plan.upgraded",
  ], slackWorker);

  // Analytics — trackable events
  eventBus.on([
    "ai.generation.completed", "test.run.passed",
    "test.run.failed", "test.run.healed", "test.created",
  ], analyticsWorker);

  // Usage limit warnings
  eventBus.on([
    "ai.generation.completed", "test.run.passed", "test.run.failed",
  ], usageLimitWorker);

  logger.info("events.workers_initialized", { workers: 5 });
}
