// ===========================================
// TESTARA - Core Type Definitions
// ===========================================

// --- Auth & Users ---
export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "qa_lead" | "tester" | "viewer";
  org_id: string;
  avatar_url?: string;
  created_at: string;
  last_login?: string;
}

export interface Organization {
  id: string;
  name: string;
  plan: "free" | "pro" | "business" | "enterprise";
  billing_email?: string;
  stripe_customer_id?: string;
  settings: OrgSettings;
  created_at: string;
}

export interface OrgSettings {
  default_browser: "chromium" | "firefox" | "webkit";
  screenshot_on_every_step: boolean;
  self_healing_enabled: boolean;
  self_healing_confidence_threshold: number; // 0-100
  ai_model: "claude-sonnet-4-6" | "claude-haiku-4-5-20251001";
}

// --- Projects ---
export interface Project {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  base_url: string;
  mainframe_config?: MainframeConfig;
  created_at: string;
}

export interface MainframeConfig {
  host: string;
  port: number;
  terminal_type: "TN3270" | "TN5250";
  use_ssl: boolean;
}

// --- Test Cases ---
export interface TestCase {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  tags: string[];
  status: "draft" | "active" | "archived";
  created_by: string;
  ai_generated: boolean;
  version: number;
  steps: TestStep[];
  created_at: string;
  updated_at: string;
}

export interface TestStep {
  id: string;
  test_case_id: string;
  order_index: number;
  action_type: ActionType;
  target: ElementTarget;
  input_data?: string;
  expected_result?: string;
  screenshot_url?: string;
  is_healed: boolean;
  heal_log?: HealLog;
}

export type ActionType =
  | "navigate"
  | "click"
  | "type"
  | "select"
  | "hover"
  | "scroll"
  | "wait"
  | "assert_text"
  | "assert_visible"
  | "assert_not_visible"
  | "assert_value"
  | "assert_url"
  | "screenshot"
  | "api_call"
  | "mainframe_connect"
  | "mainframe_navigate"
  | "mainframe_type"
  | "mainframe_send_key"
  | "mainframe_assert"
  | "mainframe_disconnect";

export interface FallbackSelectors {
  css?: string;
  css_id?: string;
  xpath?: string;
  xpath_relative?: string;
  text?: string;
  aria_label?: string;
  data_testid?: string;
  accessibility_role?: string;
  name?: string;
  placeholder?: string;
  label?: string;
  nearest_label?: string;
  title?: string;
  tag_name?: string;
}

export interface ElementTarget {
  selector: string;
  fallback_selectors: FallbackSelectors;
  description: string;
  element_screenshot_url?: string;
}

export interface HealLog {
  original_selector: string;
  new_selector: string;
  confidence: number;
  method: "getByTestId" | "getByRole" | "getByLabel" | "getByPlaceholder" | "getByText" | "accessibility_tree" | "text_match" | "visual_match" | "llm_semantic" | "name_attr" | "aria_label" | "css_id" | "css_class" | "xpath" | "css_fallback";
  healed_at: string;
  approved: boolean;
  approved_by?: string;
  propagated_from?: string;
  propagated_at?: string;
}

// --- Post-processed test (from AI + post-processor) ---
export interface ProcessedTestCase {
  tc_id: string;
  title: string;
  description?: string;
  type: "happy_path" | "negative" | "edge_case" | "boundary" | "security" | "accessibility";
  priority: "critical" | "high" | "medium" | "low";
  category: "Positive" | "Negative" | "Edge Case";
  preconditions?: string;
  postconditions?: string;
  steps: GeneratedTestStep[];
  test_data?: Array<{ variable: string; sample_value: string; data_type: string }>;
  confidence: number;
  step_count: number;
  has_assertions: boolean;
  has_data_driven: boolean;
  status?: string;
  ai_generated?: boolean;
}

export interface GeneratedTestStep {
  order_index: number;
  action_type: ActionType;
  target: ElementTarget;
  input_data?: string;
  expected_result?: string;
  screen_reference?: string;
}

// --- Supabase row types (from DB queries) ---
export interface DBTestCase {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  tags: string[];
  status: "draft" | "active" | "archived";
  priority: string | null;
  created_by: string;
  ai_generated: boolean;
  confidence: number | null;
  version: number;
  created_at: string;
  updated_at: string;
  projects?: { name: string; base_url: string } | null;
  test_steps?: DBTestStep[];
}

export interface DBTestStep {
  id: string;
  test_case_id: string;
  order_index: number;
  action_type: string;
  target: ElementTarget | null;
  input_data: string | null;
  expected_result: string | null;
  is_healed: boolean;
  heal_log: HealLog | null;
}

export interface DBTestRun {
  id: string;
  test_case_id: string;
  test_suite_id: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  environment: RunEnvironment;
  triggered_by: string;
  test_cases?: { title: string; description: string | null; projects: { name: string; base_url: string } | null } | null;
  test_run_results?: DBTestRunResult[];
}

export interface DBTestRunResult {
  id: string;
  test_run_id: string;
  step_id: string;
  status: "passed" | "failed" | "skipped" | "healed";
  screenshot_url: string | null;
  error_message: string | null;
  heal_action: HealLog | null;
  duration_ms: number;
  test_steps?: DBTestStep;
}

// --- Test Suites ---
export interface TestSuite {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  test_case_ids: string[];
  schedule_cron?: string;
  created_by: string;
}

// --- Test Runs ---
export interface TestRun {
  id: string;
  test_suite_id?: string;
  test_case_id: string;
  status: RunStatus;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  environment: RunEnvironment;
  triggered_by: "manual" | "ci" | "schedule";
  results: TestRunResult[];
}

export type RunStatus = "queued" | "running" | "passed" | "failed" | "healed" | "cancelled";

export interface RunEnvironment {
  browser: "chromium" | "firefox" | "webkit";
  viewport: { width: number; height: number };
  base_url: string;
  variables?: Record<string, string>;
}

export interface TestRunResult {
  id: string;
  test_run_id: string;
  step_id: string;
  status: "passed" | "failed" | "skipped" | "healed";
  screenshot_url?: string;
  error_message?: string;
  heal_action?: HealLog;
  duration_ms: number;
}

// --- AI Generation ---
export interface AIGeneration {
  id: string;
  project_id: string;
  input_type: "url" | "user_story" | "screenshot";
  input_data: string;
  generated_tests: GeneratedTest[];
  status: "pending" | "generating" | "completed" | "approved" | "rejected";
  created_by: string;
  tokens_used: number;
  created_at: string;
}

export interface GeneratedTest {
  title: string;
  description: string;
  type: "happy_path" | "negative" | "edge_case" | "boundary";
  steps: Omit<TestStep, "id" | "test_case_id" | "is_healed" | "heal_log">[];
  confidence: number; // 0-100
}

// --- Dashboard ---
export interface DashboardMetrics {
  total_tests: number;
  tests_passed: number;
  tests_failed: number;
  tests_healed: number;
  pass_rate: number;
  avg_duration_ms: number;
  self_heal_count_7d: number;
  flaky_tests: string[];
  recent_runs: TestRun[];
}

// --- API Response Types ---
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

// --- Chrome Extension Messages ---
export interface RecordedAction {
  type: ActionType;
  target: ElementTarget;
  value?: string;
  timestamp: number;
  page_url: string;
  screenshot_data_url?: string;
}

export interface ExtensionMessage {
  action: "START_RECORDING" | "STOP_RECORDING" | "ACTION_RECORDED" | "RECORDING_STATUS";
  payload?: RecordedAction | RecordedAction[] | { isRecording: boolean };
}
