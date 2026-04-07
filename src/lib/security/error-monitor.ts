// ===========================================
// TESTARA — Error Monitoring (Sentry)
// Install: npm install @sentry/nextjs
// Then run: npx @sentry/wizard@latest -i nextjs
// ===========================================

// This file is a placeholder until Sentry is installed.
// After installing @sentry/nextjs, it auto-configures.
// For now, we use a lightweight error logger.

interface ErrorLog {
  timestamp: string;
  error: string;
  stack?: string;
  route?: string;
  user_id?: string;
  context?: Record<string, unknown>;
}

const errorBuffer: ErrorLog[] = [];
const MAX_BUFFER = 500;

export function captureError(
  error: Error | string,
  context?: { route?: string; user_id?: string; extra?: Record<string, unknown> }
) {
  const entry: ErrorLog = {
    timestamp: new Date().toISOString(),
    error: typeof error === "string" ? error : error.message,
    stack: typeof error === "string" ? undefined : error.stack?.slice(0, 500),
    route: context?.route,
    user_id: context?.user_id,
    context: context?.extra,
  };

  errorBuffer.push(entry);
  if (errorBuffer.length > MAX_BUFFER) errorBuffer.shift();

  // Always log to console in development
  console.error(`[Testara Error] ${entry.route || "unknown"}: ${entry.error}`);

  // In production with Sentry installed, this would call Sentry.captureException()
  // Sentry.captureException(error, { extra: context });
}

export function getRecentErrors(limit: number = 50): ErrorLog[] {
  return errorBuffer.slice(-limit);
}

// Global unhandled error catcher for API routes
export function withErrorHandling(handler: Function) {
  return async (...args: Array<Record<string, unknown>>) => {
    try {
      return await handler(...args);
    } catch (error) {
      captureError(error as Error, { route: "api" });
      throw error; // Re-throw so Next.js handles it
    }
  };
}
