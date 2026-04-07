// ===========================================
// TESTARA — Test Case Post-Processor
// Auto-assigns IDs, validates types, fills
// missing priorities, ensures test mix
// ===========================================

export interface RawGeneratedTest {
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  preconditions?: string;
  postconditions?: string;
  steps: Array<{
    order_index: number;
    action_type: string;
    target: Record<string, unknown>;
    input_data?: string;
    expected_result?: string;
  }>;
  test_data?: Array<{ variable: string; sample_value: string; data_type: string }>;
  confidence?: number;
}

export interface ProcessedTest extends RawGeneratedTest {
  tc_id: string;           // Auto-assigned: TC-001, TC-002
  type: string;            // Validated: happy_path | negative | edge_case | boundary | security | accessibility
  priority: string;        // Auto-assigned: critical | high | medium | low
  category: string;        // Positive | Negative | Edge Case
  step_count: number;
  has_assertions: boolean;
  has_data_driven: boolean;
}

// ===== AUTO-ASSIGN TEST CASE IDs =====
function assignIds(tests: RawGeneratedTest[], prefix: string = "TC"): string[] {
  return tests.map((_, idx) => `${prefix}-${String(idx + 1).padStart(3, "0")}`);
}

// ===== VALIDATE & NORMALIZE TEST TYPE =====
const VALID_TYPES = ["happy_path", "negative", "edge_case", "boundary", "security", "accessibility"];
const TYPE_ALIASES: Record<string, string> = {
  positive: "happy_path", happy: "happy_path", normal: "happy_path", success: "happy_path",
  error: "negative", failure: "negative", invalid: "negative", fail: "negative",
  edge: "edge_case", corner: "edge_case", extreme: "edge_case",
  limit: "boundary", range: "boundary", min_max: "boundary",
  xss: "security", injection: "security", auth: "security",
  a11y: "accessibility", screen_reader: "accessibility", wcag: "accessibility",
};

function normalizeType(type?: string): string {
  if (!type) return "happy_path";
  const lower = type.toLowerCase().replace(/\s+/g, "_");
  if (VALID_TYPES.includes(lower)) return lower;
  return TYPE_ALIASES[lower] || "happy_path";
}

// ===== CATEGORIZE: Positive / Negative / Edge Case =====
function categorize(type: string): string {
  if (["happy_path"].includes(type)) return "Positive";
  if (["negative", "security"].includes(type)) return "Negative";
  return "Edge Case";
}

// ===== AUTO-ASSIGN PRIORITY =====
// If AI didn't assign priority, infer it from test type and content
function assignPriority(test: RawGeneratedTest): string {
  if (test.priority && ["critical", "high", "medium", "low"].includes(test.priority.toLowerCase())) {
    return test.priority.toLowerCase();
  }

  const type = normalizeType(test.type);
  const title = (test.title || "").toLowerCase();
  const steps = test.steps?.length || 0;

  // Critical: login, auth, payment, data loss scenarios
  if (title.match(/login|auth|payment|checkout|delete|security|password|crash/)) return "critical";
  
  // High: core happy paths and negative tests
  if (type === "happy_path" && steps >= 3) return "high";
  if (type === "negative") return "high";
  if (type === "security") return "critical";
  
  // Medium: edge cases, boundary tests
  if (type === "edge_case" || type === "boundary") return "medium";
  
  // Low: accessibility, cosmetic
  if (type === "accessibility") return "low";
  
  return "medium";
}

// ===== ENSURE TEST MIX =====
// Validates that the generated set has a good distribution
export function analyzeTestMix(tests: ProcessedTest[]): {
  distribution: Record<string, number>;
  priority_dist: Record<string, number>;
  warnings: string[];
  score: number; // 0-100 coverage quality score
} {
  const distribution: Record<string, number> = {};
  const priority_dist: Record<string, number> = {};
  const warnings: string[] = [];

  for (const test of tests) {
    distribution[test.category] = (distribution[test.category] || 0) + 1;
    priority_dist[test.priority] = (priority_dist[test.priority] || 0) + 1;
  }

  // Check for missing categories
  if (!distribution["Positive"]) warnings.push("No positive/happy path tests — add at least one");
  if (!distribution["Negative"]) warnings.push("No negative tests — add error handling scenarios");
  if (!distribution["Edge Case"]) warnings.push("No edge case tests — add boundary and extreme scenarios");

  // Check for priority imbalance
  if (!priority_dist["critical"]) warnings.push("No critical priority tests — login/auth should be critical");
  if (priority_dist["low"] && priority_dist["low"] > tests.length * 0.5) {
    warnings.push("Too many low priority tests — review priority assignments");
  }

  // Check for assertion coverage
  const noAssertions = tests.filter(t => !t.has_assertions).length;
  if (noAssertions > 0) warnings.push(`${noAssertions} test(s) have no assertions — tests without assertions don't verify anything`);

  // Calculate coverage score
  let score = 50; // Base
  if (distribution["Positive"]) score += 15;
  if (distribution["Negative"]) score += 15;
  if (distribution["Edge Case"]) score += 10;
  if (priority_dist["critical"]) score += 5;
  if (noAssertions === 0) score += 5;
  score = Math.min(100, score);

  return { distribution, priority_dist, warnings, score };
}

// ===== MAIN POST-PROCESSOR =====
export function postProcessTests(
  rawTests: RawGeneratedTest[],
  projectPrefix: string = "TC"
): { tests: ProcessedTest[]; mix: ReturnType<typeof analyzeTestMix> } {
  const ids = assignIds(rawTests, projectPrefix);

  const processed: ProcessedTest[] = rawTests.map((test, idx) => {
    const type = normalizeType(test.type);
    const hasAssertions = (test.steps || []).some(s =>
      s.action_type?.startsWith("assert") || s.expected_result
    );
    const hasDataDriven = (test.steps || []).some(s =>
      s.input_data?.includes("{{") || s.target?.selector?.includes("{{")
    );

    return {
      ...test,
      tc_id: ids[idx],
      type,
      priority: assignPriority(test),
      category: categorize(type),
      step_count: test.steps?.length || 0,
      has_assertions: hasAssertions,
      has_data_driven: hasDataDriven,
    };
  });

  const mix = analyzeTestMix(processed);

  return { tests: processed, mix };
}
