"use client";

import { useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

// ===== PAGINATION HOOK =====
export function usePagination(initialPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(initialPageSize);
  const [total, setTotal] = useState(0);

  const totalPages = Math.ceil(total / pageSize);

  return {
    page, pageSize, total, totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    setTotal,
    nextPage: () => setPage(p => Math.min(p + 1, totalPages)),
    prevPage: () => setPage(p => Math.max(p - 1, 1)),
    goToPage: (p: number) => setPage(Math.max(1, Math.min(p, totalPages))),
    reset: () => setPage(1),
    queryString: `page=${page}&page_size=${pageSize}`,
  };
}

// ===== PAGINATION BAR COMPONENT =====
export function PaginationBar({ page, totalPages, total, hasNext, hasPrev, onNext, onPrev, onGoTo }: {
  page: number; totalPages: number; total: number;
  hasNext: boolean; hasPrev: boolean;
  onNext: () => void; onPrev: () => void; onGoTo: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-1 py-3">
      <span className="text-xs text-gray-500">{total} total • Page {page} of {totalPages}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onGoTo(1)} disabled={!hasPrev} className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 rounded hover:bg-gray-800"><ChevronsLeft className="w-3.5 h-3.5" /></button>
        <button onClick={onPrev} disabled={!hasPrev} className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 rounded hover:bg-gray-800"><ChevronLeft className="w-3.5 h-3.5" /></button>

        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          let pageNum: number;
          if (totalPages <= 5) pageNum = i + 1;
          else if (page <= 3) pageNum = i + 1;
          else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
          else pageNum = page - 2 + i;

          return (
            <button key={pageNum} onClick={() => onGoTo(pageNum)}
              className={`w-8 h-8 text-xs rounded ${pageNum === page ? "bg-indigo-500 text-white" : "text-gray-500 hover:text-white hover:bg-gray-800"}`}>
              {pageNum}
            </button>
          );
        })}

        <button onClick={onNext} disabled={!hasNext} className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 rounded hover:bg-gray-800"><ChevronRight className="w-3.5 h-3.5" /></button>
        <button onClick={() => onGoTo(totalPages)} disabled={!hasNext} className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 rounded hover:bg-gray-800"><ChevronsRight className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}
