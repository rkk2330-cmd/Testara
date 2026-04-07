"use client";
import { useEvents } from "@/hooks/use-events";

export function EventListener() {
  useEvents();
  return null; // Invisible — just connects SSE and shows toasts
}
