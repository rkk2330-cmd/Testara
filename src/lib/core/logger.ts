// ===========================================
// TESTARA — Structured Logger
// JSON logs → ready for Datadog/Grafana/ELK
// ===========================================

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

import { maskForLogs } from "@/lib/security/masking";

function formatEntry(level: LogLevel, event: string, data?: Record<string, unknown>): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    service: "testara",
    ...(data ? maskForLogs(data) : {}),
  };
}

function emit(entry: LogEntry): void {
  const json = JSON.stringify(entry);
  switch (entry.level) {
    case "error": console.error(json); break;
    case "warn": console.warn(json); break;
    case "debug": console.debug(json); break;
    default: console.log(json);
  }
}

export const logger = {
  debug(event: string, data?: Record<string, unknown>): void {
    if (shouldLog("debug")) emit(formatEntry("debug", event, data));
  },

  info(event: string, data?: Record<string, unknown>): void {
    if (shouldLog("info")) emit(formatEntry("info", event, data));
  },

  warn(event: string, data?: Record<string, unknown>): void {
    if (shouldLog("warn")) emit(formatEntry("warn", event, data));
  },

  error(event: string, data?: Record<string, unknown>): void {
    if (shouldLog("error")) emit(formatEntry("error", event, data));
  },
};
