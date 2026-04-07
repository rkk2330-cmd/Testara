// ===========================================
// TESTARA — Analytics Events
// Uses Plausible (privacy-first, no cookies)
// Add <Script> to root layout after setting up Plausible account
// ===========================================

// Track custom events for product analytics
export function trackEvent(name: string, props?: Record<string, string | number>) {
  if (typeof window !== "undefined" && (window as unknown).plausible) {
    (window as unknown).plausible(name, { props });
  }
}

// Key events to track
export const EVENTS = {
  SIGNUP: "signup",
  FIRST_PROJECT: "first_project_created",
  FIRST_TEST: "first_test_created",
  AI_GENERATION: "ai_test_generated",
  TEST_RUN: "test_run_executed",
  SELF_HEAL: "test_self_healed",
  IMPORT: "tests_imported",
  EXTENSION_INSTALL: "extension_recording_saved",
  UPGRADE_CLICK: "upgrade_button_clicked",
  INVITE_TEAM: "team_member_invited",
} as const;

// Usage: trackEvent(EVENTS.AI_GENERATION, { mode: "url", depth: "thorough", tests_count: 5 });
