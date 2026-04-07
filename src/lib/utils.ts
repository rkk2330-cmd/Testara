import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function getPassRate(passed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((passed / total) * 100);
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    passed: "text-emerald-500",
    failed: "text-red-500",
    healed: "text-amber-500",
    running: "text-blue-500",
    queued: "text-gray-400",
    cancelled: "text-gray-500",
    draft: "text-gray-400",
    active: "text-emerald-500",
    archived: "text-gray-500",
  };
  return colors[status] || "text-gray-500";
}

export function getStatusBg(status: string): string {
  const colors: Record<string, string> = {
    passed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    failed: "bg-red-500/10 text-red-600 border-red-500/20",
    healed: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    running: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    queued: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  };
  return colors[status] || "bg-gray-500/10 text-gray-600";
}
