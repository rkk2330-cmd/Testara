// ===========================================
// TESTARA — Event Bus
// Typed events, in-memory bus, worker dispatch
// In-memory works on Vercel serverless
// BullMQ adapter for dedicated worker infra
// ===========================================

import { logger } from "@/lib/core/logger";

// ===== EVENT DEFINITIONS =====
export type EventType =
  // AI events
  | "ai.generation.queued"
  | "ai.generation.started"
  | "ai.generation.completed"
  | "ai.generation.failed"
  // Test execution events
  | "test.run.queued"
  | "test.run.started"
  | "test.step.completed"
  | "test.run.passed"
  | "test.run.failed"
  | "test.run.healed"
  // Suite events
  | "suite.run.queued"
  | "suite.run.completed"
  // Healing events
  | "heal.attempted"
  | "heal.succeeded"
  | "heal.approved"
  // Team events
  | "team.member.invited"
  | "team.member.joined"
  | "team.member.removed"
  // Billing events
  | "billing.plan.upgraded"
  | "billing.payment.received"
  | "billing.usage.limit_warning"
  // CRUD events (audit trail)
  | "test.created"
  | "test.updated"
  | "test.deleted"
  | "test.archived"
  | "project.created"
  | "project.deleted"
  | "suite.created"
  | "suite.deleted";

export interface EventPayload {
  eventType: EventType;
  timestamp: string;
  userId: string;
  orgId: string;
  data: Record<string, unknown>;
}

// ===== EVENT HANDLER =====
type EventHandler = (event: EventPayload) => Promise<void> | void;

// ===== IN-MEMORY EVENT BUS =====
class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();
  private allHandlers: EventHandler[] = [];
  private eventLog: EventPayload[] = [];
  private maxLogSize = 1000;

  // Subscribe to specific event type
  on(eventType: EventType | EventType[], handler: EventHandler): void {
    const types = Array.isArray(eventType) ? eventType : [eventType];
    for (const type of types) {
      if (!this.handlers.has(type)) this.handlers.set(type, []);
      this.handlers.get(type)!.push(handler);
    }
  }

  // Subscribe to ALL events
  onAll(handler: EventHandler): void {
    this.allHandlers.push(handler);
  }

  // Emit event — fires all matching handlers asynchronously (non-blocking)
  async emit(event: EventPayload): Promise<void> {
    // Add to event log
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    // Log the event
    logger.info("event.emitted", {
      eventType: event.eventType,
      userId: event.userId,
      orgId: event.orgId,
    });

    // Fire specific handlers (non-blocking — don't await)
    const specificHandlers = this.handlers.get(event.eventType) || [];
    const allCombined = [...specificHandlers, ...this.allHandlers];

    for (const handler of allCombined) {
      // Fire-and-forget: don't let handler errors block the main flow
      Promise.resolve(handler(event)).catch(err => {
        logger.error("event.handler_error", {
          eventType: event.eventType,
          error: (err as Error).message,
        });
      });
    }
  }

  // Get recent events (for debugging / SSE replay)
  getRecentEvents(limit = 50, filter?: { orgId?: string; eventType?: string }): EventPayload[] {
    let events = this.eventLog;
    if (filter?.orgId) events = events.filter(e => e.orgId === filter.orgId);
    if (filter?.eventType) events = events.filter(e => e.eventType === filter.eventType);
    return events.slice(-limit);
  }

  // Clear all handlers (for testing)
  clear(): void {
    this.handlers.clear();
    this.allHandlers = [];
  }
}

// ===== SINGLETON =====
export const eventBus = new EventBus();

// ===== HELPER: Create typed event payload =====
export function createEvent(
  eventType: EventType,
  userId: string,
  orgId: string,
  data: Record<string, unknown>
): EventPayload {
  return {
    eventType,
    timestamp: new Date().toISOString(),
    userId,
    orgId,
    data,
  };
}
