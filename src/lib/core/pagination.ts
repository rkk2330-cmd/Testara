// ===========================================
// TESTARA — Pagination
// Server: parse params, apply to Supabase query
// Client: usePagination hook, PaginationBar component
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";

// ===== SERVER: Parse pagination params from URL =====
export interface PaginationParams {
  page: number;
  pageSize: number;
  offset: number;
}

export function parsePagination(searchParams: URLSearchParams, defaultSize = 25): PaginationParams {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") || String(defaultSize))));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// ===== SERVER: Apply pagination to query result =====
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export function paginatedResponse<T>(data: T[], total: number, params: PaginationParams): PaginatedResult<T> {
  const totalPages = Math.ceil(total / params.pageSize);
  return {
    data,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages,
      hasNext: params.page < totalPages,
      hasPrev: params.page > 1,
    },
  };
}
