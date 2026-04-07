// ===========================================
// TESTARA — Error Classes
// Every failure has a typed error with:
// - HTTP status code
// - Machine-readable error code
// - Human-readable message
// - Optional context for debugging
// ===========================================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, statusCode: number, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.context = context;
  }
}

// ===== 401 — Authentication =====
export class UnauthorizedError extends AppError {
  constructor(message = "Not authenticated. Please log in.") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

// ===== 403 — Permission / Plan =====
export class ForbiddenError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 403, "FORBIDDEN", context);
    this.name = "ForbiddenError";
  }
}

export class InsufficientPermissionError extends ForbiddenError {
  constructor(role: string, permission: string) {
    super(
      `Your role (${role}) doesn't have permission: ${permission}. Contact your admin.`,
      { role, permission }
    );
    this.name = "InsufficientPermissionError";
  }
}

export class PlanRequiredError extends ForbiddenError {
  constructor(feature: string, currentPlan: string, requiredPlan: string) {
    super(
      `${feature} requires ${requiredPlan} plan. You're on ${currentPlan}. Upgrade at /settings?tab=billing`,
      { feature, currentPlan, requiredPlan, upgradeUrl: "/settings?tab=billing" }
    );
    this.name = "PlanRequiredError";
  }
}

export class UsageLimitError extends ForbiddenError {
  constructor(resource: string, used: number, limit: number, plan: string) {
    super(
      `${resource} limit reached (${used}/${limit} this month). Upgrade your plan.`,
      { resource, used, limit, plan, upgradeUrl: "/settings?tab=billing" }
    );
    this.name = "UsageLimitError";
  }
}

// ===== 404 — Not Found =====
export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(
      id ? `${entity} not found: ${id}` : `${entity} not found`,
      404,
      "NOT_FOUND",
      { entity, id }
    );
    this.name = "NotFoundError";
  }
}

// ===== 400 — Validation =====
export class ValidationError extends AppError {
  public readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message, 400, "VALIDATION_ERROR", { fieldErrors });
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

// ===== 409 — Conflict =====
export class ConflictError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 409, "CONFLICT", context);
    this.name = "ConflictError";
  }
}

// ===== 429 — Rate Limit =====
export class RateLimitError extends AppError {
  constructor(remaining: number, resetInSeconds: number) {
    super(
      `Rate limit exceeded. Try again in ${resetInSeconds} seconds.`,
      429,
      "RATE_LIMITED",
      { remaining, resetInSeconds }
    );
    this.name = "RateLimitError";
  }
}

// ===== 500 — Internal =====
export class InternalError extends AppError {
  constructor(message = "An unexpected error occurred. Please try again.", context?: Record<string, unknown>) {
    super(message, 500, "INTERNAL_ERROR", context);
    this.name = "InternalError";
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, originalError?: string) {
    super(
      `External service error: ${service}. Please try again.`,
      502,
      "EXTERNAL_SERVICE_ERROR",
      { service, originalError }
    );
    this.name = "ExternalServiceError";
  }
}
