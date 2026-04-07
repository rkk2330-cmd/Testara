// ===========================================
// TESTARA — Rate Limiting
// In-memory rate limiter for MVP
// Replace with Upstash Redis in production
// ===========================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  windowMs: number;    // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

// Default limits by route type
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  ai_generation: { windowMs: 60 * 60 * 1000, maxRequests: 20 },     // 20 AI calls/hour
  ai_assistant: { windowMs: 60 * 1000, maxRequests: 15 },           // 15 assistant msgs/min
  test_execution: { windowMs: 60 * 1000, maxRequests: 10 },         // 10 test runs/min
  api_general: { windowMs: 60 * 1000, maxRequests: 100 },           // 100 API calls/min
  webhook: { windowMs: 60 * 1000, maxRequests: 30 },                // 30 webhooks/min
};

export function checkRateLimit(
  identifier: string, // user ID or IP
  limitType: keyof typeof RATE_LIMITS
): { allowed: boolean; remaining: number; resetIn: number } {
  const config = RATE_LIMITS[limitType] || RATE_LIMITS.api_general;
  const key = `${limitType}:${identifier}`;
  const now = Date.now();

  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.maxRequests - 1, resetIn: config.windowMs };
  }

  if (entry.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, remaining: config.maxRequests - entry.count, resetIn: entry.resetAt - now };
}

// Helper for API routes
export function rateLimitResponse(remaining: number, resetIn: number) {
  return {
    error: "Rate limit exceeded. Please wait before trying again.",
    retry_after_seconds: Math.ceil(resetIn / 1000),
    remaining,
  };
}
