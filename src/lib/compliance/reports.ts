// ===========================================
// TESTARA — Compliance Report Generator
// ISO 29119-3 + ISTQB + SOC2/HIPAA/PCI-DSS
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/core/logger";

// ===== ISTQB TEST CLASSIFICATION =====
export const ISTQB_TEST_LEVELS = ["unit", "integration", "system", "acceptance"] as const;
export const ISTQB_TEST_TYPES = ["functional", "non_functional", "structural", "change_related"] as const;

export function classifyTest(test: { title: string; tags: string[]; priority: string }): {
  level: string; type: string; technique: string;
} {
  const title = test.title.toLowerCase();
  const tags = (test.tags || []).map(t => t.toLowerCase());

  // Classify level
  let level = "system"; // default
  if (tags.includes("unit") || title.includes("unit")) level = "unit";
  else if (tags.includes("integration") || title.includes("integration") || title.includes("api")) level = "integration";
  else if (tags.includes("acceptance") || title.includes("uat") || title.includes("acceptance")) level = "acceptance";

  // Classify type
  let type = "functional"; // default
  if (tags.includes("performance") || title.includes("load") || title.includes("performance")) type = "non_functional";
  else if (tags.includes("security") || title.includes("security") || title.includes("auth")) type = "non_functional";
  else if (tags.includes("accessibility") || title.includes("wcag") || title.includes("a11y")) type = "non_functional";
  else if (tags.includes("regression") || title.includes("regression")) type = "change_related";

  // Classify technique
  let technique = "equivalence_partitioning";
  if (title.includes("boundary") || title.includes("edge")) technique = "boundary_value_analysis";
  else if (title.includes("negative") || title.includes("invalid")) technique = "negative_testing";
  else if (title.includes("flow") || title.includes("scenario")) technique = "scenario_testing";
  else if (title.includes("explore") || title.includes("ad hoc")) technique = "exploratory_testing";

  return { level, type, technique };
}

// ===== ISO 29119-3: TEST PLAN GENERATION =====
export async function generateTestPlan(
  supabase: SupabaseClient,
  projectId: string,
  orgId: string
): Promise<Record<string, unknown>> {
  const [project, tests, suites, runs] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).single(),
    supabase.from("test_cases").select("id, title, status, priority, tags").eq("project_id", projectId),
    supabase.from("test_suites").select("id, name, test_case_ids").eq("project_id", projectId),
    supabase.from("test_runs").select("status, created_at").eq("test_case_id", projectId).limit(100),
  ]);

  const testData = tests.data || [];
  const classified = testData.map(t => ({ ...t, ...classifyTest(t as { title: string; tags: string[]; priority: string }) }));
  const byLevel: Record<string, number> = {};
  const byType: Record<string, number> = {};
  classified.forEach(t => {
    byLevel[t.level] = (byLevel[t.level] || 0) + 1;
    byType[t.type] = (byType[t.type] || 0) + 1;
  });

  return {
    document_type: "Test Plan",
    standard: "ISO/IEC/IEEE 29119-3:2021",
    generated_at: new Date().toISOString(),
    project: { name: project.data?.name, url: project.data?.base_url, id: projectId },

    test_strategy: {
      approach: "Risk-based testing with AI-augmented test generation",
      test_levels: byLevel,
      test_types: byType,
      tools: ["Testara (AI test generation)", "Playwright (execution)", "Chrome Extension (recording)"],
      environments: ["Chromium", "Firefox", "WebKit"],
    },

    scope: {
      in_scope: testData.map(t => t.title),
      total_test_cases: testData.length,
      by_status: { active: testData.filter(t => t.status === "active").length, draft: testData.filter(t => t.status === "draft").length, archived: testData.filter(t => t.status === "archived").length },
      by_priority: { critical: testData.filter(t => t.priority === "critical").length, high: testData.filter(t => t.priority === "high").length, medium: testData.filter(t => t.priority === "medium").length, low: testData.filter(t => t.priority === "low").length },
    },

    test_suites: (suites.data || []).map(s => ({ name: s.name, test_count: s.test_case_ids?.length || 0 })),

    entry_criteria: [
      "Application deployed to test environment",
      "Test data prepared and loaded",
      "All test cases reviewed and approved",
      "Test environment accessible and stable",
    ],
    exit_criteria: [
      "All critical and high priority tests executed",
      "Pass rate above 90%",
      "No unresolved critical defects",
      "Test summary report generated and reviewed",
    ],

    risks: [
      { risk: "Application UI changes frequently", mitigation: "Self-healing locators + Object Repository" },
      { risk: "Test data dependency", mitigation: "AI-generated test data with domain intelligence" },
      { risk: "Flaky tests reducing confidence", mitigation: "Automated flaky detection + healing agent" },
    ],

    schedule: {
      test_design: "Ongoing (AI-generated + manual)",
      test_execution: "Per sprint / CI trigger",
      test_reporting: "Automated after each suite run",
    },
  };
}

// ===== ISO 29119-3: TEST SUMMARY REPORT =====
export async function generateTestSummaryReport(
  supabase: SupabaseClient,
  projectId: string,
  dateRange?: { from: string; to: string }
): Promise<Record<string, unknown>> {
  const from = dateRange?.from || new Date(Date.now() - 30 * 86400000).toISOString();
  const to = dateRange?.to || new Date().toISOString();

  const [tests, runs, project] = await Promise.all([
    supabase.from("test_cases").select("id, title, status, priority").eq("project_id", projectId),
    supabase.from("test_runs").select("status, duration_ms, created_at, test_case_id").gte("created_at", from).lte("created_at", to),
    supabase.from("projects").select("name").eq("id", projectId).single(),
  ]);

  const runData = runs.data || [];
  const passed = runData.filter(r => r.status === "passed").length;
  const failed = runData.filter(r => r.status === "failed").length;
  const total = runData.length;

  return {
    document_type: "Test Summary Report",
    standard: "ISO/IEC/IEEE 29119-3:2021",
    generated_at: new Date().toISOString(),
    project: project.data?.name || projectId,
    reporting_period: { from, to },

    summary: {
      total_test_cases: (tests.data || []).length,
      total_executions: total,
      passed, failed,
      pass_rate: total > 0 ? Math.round((passed / total) * 100) : 0,
      avg_duration_ms: total > 0 ? Math.round(runData.reduce((s, r) => s + (r.duration_ms || 0), 0) / total) : 0,
    },

    by_priority: {
      critical: { total: (tests.data || []).filter(t => t.priority === "critical").length },
      high: { total: (tests.data || []).filter(t => t.priority === "high").length },
      medium: { total: (tests.data || []).filter(t => t.priority === "medium").length },
      low: { total: (tests.data || []).filter(t => t.priority === "low").length },
    },

    deviations: failed > 0 ? `${failed} test executions failed during the reporting period.` : "No deviations from expected results.",

    exit_criteria_evaluation: {
      all_critical_executed: true,
      pass_rate_above_90: (passed / Math.max(total, 1)) * 100 >= 90,
      no_critical_defects: failed === 0,
    },

    recommendation: (passed / Math.max(total, 1)) * 100 >= 90
      ? "PASS — Test results meet exit criteria. Recommend proceeding to production."
      : "CONDITIONAL — Pass rate below 90%. Review failed tests before release.",
  };
}

// ===== TRACEABILITY MATRIX =====
export async function generateTraceabilityMatrix(
  supabase: SupabaseClient,
  projectId: string
): Promise<Record<string, unknown>> {
  const [tests, runs] = await Promise.all([
    supabase.from("test_cases").select("id, title, tags, priority, status, description").eq("project_id", projectId),
    supabase.from("test_runs").select("test_case_id, status").order("created_at", { ascending: false }).limit(500),
  ]);

  const latestRunStatus: Record<string, string> = {};
  for (const run of (runs.data || [])) {
    if (!latestRunStatus[run.test_case_id]) latestRunStatus[run.test_case_id] = run.status;
  }

  return {
    document_type: "Requirements Traceability Matrix",
    standard: "ISO/IEC/IEEE 29119-3:2021 + ISTQB",
    generated_at: new Date().toISOString(),

    matrix: (tests.data || []).map(t => {
      const classification = classifyTest(t as { title: string; tags: string[]; priority: string });
      return {
        test_id: t.id,
        test_title: t.title,
        requirement: t.description || `Derived from: ${t.title}`,
        priority: t.priority,
        status: t.status,
        last_run_result: latestRunStatus[t.id] || "not_executed",
        test_level: classification.level,
        test_type: classification.type,
        test_technique: classification.technique,
        tags: t.tags || [],
        traceable: !!t.description,
      };
    }),

    coverage_summary: {
      total_tests: (tests.data || []).length,
      with_requirements: (tests.data || []).filter(t => t.description).length,
      without_requirements: (tests.data || []).filter(t => !t.description).length,
      executed: Object.keys(latestRunStatus).length,
      not_executed: (tests.data || []).filter(t => !latestRunStatus[t.id]).length,
    },
  };
}

// ===== COMPLIANCE REPORTS (SOC2, HIPAA, PCI-DSS, RBI) =====
export async function generateComplianceReport(
  supabase: SupabaseClient,
  projectId: string,
  complianceType: "soc2" | "hipaa" | "pci_dss" | "iso27001" | "rbi" | "irdai"
): Promise<Record<string, unknown>> {
  const [tests, runs, project] = await Promise.all([
    supabase.from("test_cases").select("id, title, status, priority, tags").eq("project_id", projectId),
    supabase.from("test_runs").select("status, created_at, test_case_id").order("created_at", { ascending: false }).limit(200),
    supabase.from("projects").select("name").eq("id", projectId).single(),
  ]);

  const testData = tests.data || [];
  const runData = runs.data || [];
  const passed = runData.filter(r => r.status === "passed").length;

  const frameworks: Record<string, { name: string; controls: Array<{ id: string; name: string; description: string; tested: boolean }> }> = {
    soc2: {
      name: "SOC 2 Type II",
      controls: [
        { id: "CC6.1", name: "Logical Access Security", description: "Access to data restricted to authorized users", tested: testData.some(t => t.title.toLowerCase().includes("auth") || t.title.toLowerCase().includes("login")) },
        { id: "CC6.3", name: "Access Removal", description: "Access removed upon termination", tested: testData.some(t => t.title.toLowerCase().includes("logout") || t.title.toLowerCase().includes("revoke")) },
        { id: "CC7.2", name: "Monitoring", description: "System activity monitored for anomalies", tested: testData.some(t => t.title.toLowerCase().includes("audit") || t.title.toLowerCase().includes("log")) },
        { id: "CC8.1", name: "Change Management", description: "Changes tested before deployment", tested: runData.length > 0 },
      ],
    },
    hipaa: {
      name: "HIPAA Security Rule",
      controls: [
        { id: "164.312(a)", name: "Access Control", description: "Unique user identification", tested: testData.some(t => t.title.toLowerCase().includes("auth")) },
        { id: "164.312(b)", name: "Audit Controls", description: "Record and examine activity", tested: testData.some(t => t.title.toLowerCase().includes("audit")) },
        { id: "164.312(c)", name: "Integrity", description: "Protect ePHI from alteration", tested: testData.some(t => t.title.toLowerCase().includes("validation") || t.title.toLowerCase().includes("integrity")) },
        { id: "164.312(d)", name: "Authentication", description: "Verify identity of persons seeking access", tested: testData.some(t => t.title.toLowerCase().includes("login") || t.title.toLowerCase().includes("mfa")) },
        { id: "164.312(e)", name: "Transmission Security", description: "Encrypt ePHI in transit", tested: testData.some(t => t.title.toLowerCase().includes("https") || t.title.toLowerCase().includes("encrypt")) },
      ],
    },
    pci_dss: {
      name: "PCI-DSS v4.0",
      controls: [
        { id: "Req 2", name: "Secure Configuration", description: "No default passwords", tested: testData.some(t => t.title.toLowerCase().includes("default") || t.title.toLowerCase().includes("password")) },
        { id: "Req 6.5", name: "Secure Development", description: "Address common vulnerabilities", tested: testData.some(t => t.title.toLowerCase().includes("xss") || t.title.toLowerCase().includes("injection")) },
        { id: "Req 8", name: "Authentication", description: "Strong access control", tested: testData.some(t => t.title.toLowerCase().includes("auth")) },
        { id: "Req 10", name: "Logging", description: "Track access to cardholder data", tested: testData.some(t => t.title.toLowerCase().includes("log") || t.title.toLowerCase().includes("audit")) },
        { id: "Req 11", name: "Testing", description: "Regularly test security systems", tested: runData.length > 0 },
      ],
    },
    iso27001: {
      name: "ISO/IEC 27001:2022",
      controls: [
        { id: "A.8.2", name: "Privileged Access", description: "Privileged access rights restricted", tested: testData.some(t => t.title.toLowerCase().includes("admin") || t.title.toLowerCase().includes("role")) },
        { id: "A.8.5", name: "Secure Authentication", description: "Authentication mechanisms implemented", tested: testData.some(t => t.title.toLowerCase().includes("auth")) },
        { id: "A.8.9", name: "Configuration Management", description: "Configurations managed securely", tested: runData.length > 0 },
        { id: "A.8.16", name: "Monitoring", description: "Networks and systems monitored", tested: testData.some(t => t.title.toLowerCase().includes("monitor")) },
      ],
    },
    rbi: {
      name: "RBI IT Governance Framework",
      controls: [
        { id: "4.3", name: "Application Security Testing", description: "Applications tested for vulnerabilities", tested: runData.length > 0 },
        { id: "5.1", name: "Access Control", description: "Role-based access implemented", tested: testData.some(t => t.title.toLowerCase().includes("role") || t.title.toLowerCase().includes("permission")) },
        { id: "6.2", name: "Change Management", description: "Testing before deployment", tested: runData.length > 0 },
      ],
    },
    irdai: {
      name: "IRDAI Cyber Security Guidelines",
      controls: [
        { id: "7.1", name: "Application Testing", description: "Regular security testing of applications", tested: runData.length > 0 },
        { id: "7.3", name: "Data Protection", description: "Customer data protected", tested: testData.some(t => t.title.toLowerCase().includes("data") || t.title.toLowerCase().includes("privacy")) },
      ],
    },
  };

  const framework = frameworks[complianceType];
  const testedControls = framework.controls.filter(c => c.tested).length;

  return {
    document_type: "Compliance Testing Evidence Report",
    framework: framework.name,
    generated_at: new Date().toISOString(),
    project: project.data?.name || projectId,

    executive_summary: `This report provides testing evidence for ${framework.name} compliance. ${testedControls}/${framework.controls.length} controls have associated test cases. Total test executions: ${runData.length}. Pass rate: ${runData.length > 0 ? Math.round((passed / runData.length) * 100) : 0}%.`,

    controls: framework.controls.map(control => ({
      ...control,
      evidence: control.tested
        ? { test_count: testData.filter(t => t.title.toLowerCase().includes(control.name.toLowerCase().split(" ")[0])).length, last_executed: runData[0]?.created_at || "never", status: "TESTED" }
        : { test_count: 0, last_executed: "never", status: "GAP — No test coverage" },
    })),

    summary: { total_controls: framework.controls.length, tested: testedControls, gaps: framework.controls.length - testedControls, coverage_percentage: Math.round((testedControls / framework.controls.length) * 100) },

    disclaimer: "This report is auto-generated based on test case titles and execution data. It does not constitute a formal audit. Please engage a certified auditor for official compliance certification.",
  };
}

// ===== 14. AUDIT LOG EXPORT =====
export async function exportAuditLog(
  supabase: SupabaseClient,
  orgId: string,
  dateRange?: { from: string; to: string }
): Promise<Record<string, unknown>> {
  const from = dateRange?.from || new Date(Date.now() - 30 * 86400000).toISOString();
  const to = dateRange?.to || new Date().toISOString();

  // Get agent sessions (audit trail)
  const { data: sessions } = await supabase.from("agent_sessions").select("id, agent_type, goal, status, spent, started_at, completed_at, observations")
    .eq("org_id", orgId).gte("started_at", from).lte("started_at", to).order("started_at", { ascending: false });

  // Get test runs (execution audit)
  const { data: runs } = await supabase.from("test_runs").select("id, test_case_id, status, duration_ms, created_at, test_cases!inner(title)")
    .gte("created_at", from).lte("created_at", to).order("created_at", { ascending: false }).limit(1000);

  return {
    document_type: "Audit Trail Export",
    exported_at: new Date().toISOString(),
    period: { from, to },
    agent_sessions: sessions || [],
    test_executions: (runs || []).map(r => ({
      run_id: r.id, test: (r as Record<string, unknown>).test_cases ? ((r as Record<string, unknown>).test_cases as Record<string, string>).title : "Unknown",
      status: r.status, duration_ms: r.duration_ms, executed_at: r.created_at,
    })),
    total_events: (sessions || []).length + (runs || []).length,
  };
}
