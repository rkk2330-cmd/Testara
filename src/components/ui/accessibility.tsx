"use client";

import { useEffect, useRef } from "react";

// ===== SKIP TO CONTENT LINK =====
// Visible only on keyboard focus — lets screen reader users skip navigation
export function SkipToContent() {
  return (
    <a href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-indigo-500 focus:text-white focus:rounded-lg focus:text-sm focus:font-medium focus:outline-none"
    >
      Skip to main content
    </a>
  );
}

// ===== SCREEN READER ANNOUNCER =====
// Announces dynamic content changes to screen readers
export function ScreenReaderAnnouncer({ message, assertive }: { message: string; assertive?: boolean }) {
  return (
    <div aria-live={assertive ? "assertive" : "polite"} aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}

// ===== FOCUS TRAP (for modals) =====
export function useFocusTrap(active: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;
    const focusable = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }

    container.addEventListener("keydown", handleKeyDown);
    first?.focus();
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  return containerRef;
}
