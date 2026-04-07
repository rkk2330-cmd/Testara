// ===========================================
// TESTARA — Global Error Handler & Request Context
// Wraps API route handlers for consistent error handling,
// request tracing, and response formatting
// ===========================================

import { NextRequest, NextResponse } from "next/server";
import { AppError, InternalError } from "./errors";
import { logger } from "./logger";

// ===== REQUEST CONTEXT =====
export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  startTime: number;
  userId?: string;
}

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ===== API HANDLER WRAPPER =====
// Wraps any API route handler with error handling, logging, and tracing
type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<NextResponse>;

export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (request: NextRequest, routeContext: { params: Promise<Record<string, string>> }) => {
    const reqCtx: RequestContext = {
      requestId: generateRequestId(),
      method: request.method,
      path: request.nextUrl.pathname,
      startTime: Date.now(),
    };

    try {
      const response = await handler(request, routeContext);
      const duration = Date.now() - reqCtx.startTime;

      // Log successful requests
      logger.info("api.request", {
        requestId: reqCtx.requestId,
        method: reqCtx.method,
        path: reqCtx.path,
        status: response.status,
        duration_ms: duration,
      });

      // Add request ID to response headers
      response.headers.set("X-Request-Id", reqCtx.requestId);
      return response;

    } catch (error) {
      const duration = Date.now() - reqCtx.startTime;

      if (error instanceof AppError) {
        // Known error — log at appropriate level and return structured response
        const logLevel = error.statusCode >= 500 ? "error" : "warn";
        logger[logLevel]("api.error", {
          requestId: reqCtx.requestId,
          method: reqCtx.method,
          path: reqCtx.path,
          status: error.statusCode,
          code: error.code,
          message: error.message,
          context: error.context,
          duration_ms: duration,
        });

        return NextResponse.json(
          {
            error: error.message,
            code: error.code,
            ...(error.context || {}),
            requestId: reqCtx.requestId,
          },
          {
            status: error.statusCode,
            headers: { "X-Request-Id": reqCtx.requestId },
          }
        );
      }

      // Unknown error — log full stack trace, return generic 500
      const internal = new InternalError();
      logger.error("api.unhandled_error", {
        requestId: reqCtx.requestId,
        method: reqCtx.method,
        path: reqCtx.path,
        error: (error as Error).message,
        stack: (error as Error).stack?.split("\n").slice(0, 5),
        duration_ms: duration,
      });

      return NextResponse.json(
        {
          error: internal.message,
          code: internal.code,
          requestId: reqCtx.requestId,
        },
        {
          status: 500,
          headers: { "X-Request-Id": reqCtx.requestId },
        }
      );
    }
  };
}

// ===== SIMPLE WRAPPER for routes without params =====
type SimpleHandler = (request: NextRequest) => Promise<NextResponse>;

export function withHandler(handler: SimpleHandler): SimpleHandler {
  return async (request: NextRequest) => {
    const reqCtx: RequestContext = {
      requestId: generateRequestId(),
      method: request.method,
      path: request.nextUrl.pathname,
      startTime: Date.now(),
    };

    try {
      const response = await handler(request);
      const duration = Date.now() - reqCtx.startTime;

      logger.info("api.request", {
        requestId: reqCtx.requestId, method: reqCtx.method,
        path: reqCtx.path, status: response.status, duration_ms: duration,
      });

      response.headers.set("X-Request-Id", reqCtx.requestId);
      return response;
    } catch (error) {
      const duration = Date.now() - reqCtx.startTime;

      if (error instanceof AppError) {
        logger[error.statusCode >= 500 ? "error" : "warn"]("api.error", {
          requestId: reqCtx.requestId, method: reqCtx.method, path: reqCtx.path,
          status: error.statusCode, code: error.code, message: error.message, duration_ms: duration,
        });
        return NextResponse.json(
          { error: error.message, code: error.code, ...(error.context || {}), requestId: reqCtx.requestId },
          { status: error.statusCode, headers: { "X-Request-Id": reqCtx.requestId } }
        );
      }

      logger.error("api.unhandled_error", {
        requestId: reqCtx.requestId, method: reqCtx.method, path: reqCtx.path,
        error: (error as Error).message, duration_ms: duration,
      });
      return NextResponse.json(
        { error: "An unexpected error occurred.", code: "INTERNAL_ERROR", requestId: reqCtx.requestId },
        { status: 500, headers: { "X-Request-Id": reqCtx.requestId } }
      );
    }
  };
}
