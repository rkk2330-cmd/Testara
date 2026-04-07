"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Maps event types to user-friendly toast notifications
const EVENT_TOASTS: Record<string, { type: "success" | "error" | "info"; message: (data: Record<string, unknown>) => string }> = {
  "ai.generation.completed": {
    type: "success",
    message: (d) => `${d.testCount || ""} test cases generated!`,
  },
  "ai.generation.failed": {
    type: "error",
    message: (d) => `AI generation failed: ${d.error || "Unknown error"}`,
  },
  "test.run.passed": {
    type: "success",
    message: (d) => `Test passed: ${d.testTitle || ""}`,
  },
  "test.run.failed": {
    type: "error",
    message: (d) => `Test failed: ${d.testTitle || ""} — ${d.errorMessage || ""}`,
  },
  "test.run.healed": {
    type: "info",
    message: (d) => `Test self-healed: ${d.testTitle || ""}`,
  },
  "suite.run.completed": {
    type: "success",
    message: (d) => `Suite complete: ${d.passed}/${d.total} passed (${d.passRate}%)`,
  },
  "heal.approved": {
    type: "success",
    message: () => "Self-healing fix approved and propagated",
  },
  "team.member.joined": {
    type: "success",
    message: (d) => `${d.email || "New member"} joined the team`,
  },
  "billing.plan.upgraded": {
    type: "success",
    message: (d) => `Plan upgraded to ${d.plan}!`,
  },
  "billing.usage.limit_warning": {
    type: "info",
    message: (d) => `Usage alert: ${d.resource} at ${d.percentage}% of limit (${d.usage}/${d.limit})`,
  },
};

export function useEvents(): void {
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Connect to SSE stream
    const es = new EventSource("/api/events/stream");
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "connected") return; // Skip connection confirmation

        const eventType = payload.eventType as string;
        const toastConfig = EVENT_TOASTS[eventType];

        if (toastConfig) {
          const message = toastConfig.message(payload.data || {});
          toast[toastConfig.type](message);
        }
      } catch {
        // Skip unparseable events
      }
    };

    es.onerror = () => {
      // SSE will auto-reconnect. Don't spam the user with errors.
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);
}
