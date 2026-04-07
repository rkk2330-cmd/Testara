import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import type { DBTestCase } from "@/types";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// GET /api/tests/export?project_id=xxx&format=excel|playwright|gherkin|csv
export const GET = withHandler(async (request: NextRequest) => {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const projectId = request.nextUrl.searchParams.get("project_id");
  const testId = request.nextUrl.searchParams.get("test_id"); // Single test export
  const format = request.nextUrl.searchParams.get("format") || "excel";

  // Fetch test cases
  let query = supabase.from("test_cases").select("*, test_steps(*), projects(name, base_url)");
  if (testId) {
    query = query.eq("id", testId);
  } else if (projectId) {
    query = query.eq("project_id", projectId);
  }
  query = query.order("created_at", { ascending: true });

  const { data: tests, error } = await query;
  if (error || !tests || tests.length === 0) {
    return NextResponse.json({ error: "No test cases found" }, { status: 404 });
  }

  const projectName = (tests[0] as unknown).projects?.name || "Testara";

  // Post-process all tests for export (auto-assign IDs, priorities, categories)
  const { postProcessTests } = await import("@/lib/ai/post-processor");
  const { tests: processedTests, mix } = postProcessTests(tests, "TC");

  switch (format) {
    case "excel":
      return generateXlsx(processedTests, projectName, mix);
    case "playwright":
      return generatePlaywrightScript(processedTests, projectName);
    case "gherkin":
      return generateGherkin(processedTests, projectName);
    case "csv":
      return generateExcelCSV(processedTests, projectName);
    default:
      return NextResponse.json({ error: "Invalid format. Use: excel, playwright, gherkin, csv" }, { status: 400 });
  }
}

// ===== REAL .XLSX WITH COLOR CODING (pure TypeScript + ExcelJS) =====
async function generateXlsx(tests: DBTestCase[], projectName: string, mix: Record<string, unknown>): Promise<NextResponse> {
  try {
    const { generateTestReport } = await import("@/lib/export/excel-generator");
    const timestamp = new Date().toISOString().split("T")[0];

    const xlsxBuffer = await generateTestReport(tests, projectName, mix);

    return new NextResponse(xlsxBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${projectName.replace(/\s+/g, "_")}_Test_Report_${timestamp}.xlsx"`,
      },
    });
  } catch (error) {
    // Fallback to CSV if ExcelJS fails
    console.error("[Testara Export] xlsx generation failed, falling back to CSV:", error);
    return generateExcelCSV(tests, projectName);
  }
}

// ===== EXCEL-COMPATIBLE CSV (opens perfectly in Excel with formatting hints) =====
function generateExcelCSV(tests: DBTestCase[], projectName: string): NextResponse {
  const timestamp = new Date().toISOString().split("T")[0];
  const rows: string[] = [];

  // Header section
  rows.push(`"TESTARA — Test Case Report"`);
  rows.push(`"Project:","${projectName}"`);
  rows.push(`"Generated:","${new Date().toLocaleString('en-IN')}"`);
  rows.push(`"Total Test Cases:","${tests.length}"`);
  rows.push(`"Total Steps:","${tests.reduce((sum: number, t: Record<string, unknown>) => sum + (t.test_steps?.length || 0), 0)}"`);
  rows.push(``);

  // Summary table
  rows.push(`"TC ID","Title","Type","Priority","Status","Steps","AI Generated","Confidence","Description"`);
  tests.forEach((t: Record<string, unknown>, idx: number) => {
    rows.push([
      `"TC-${String(idx + 1).padStart(3, '0')}"`,
      `"${escape(t.title)}"`,
      `"${t.tags?.[0] || 'functional'}"`,
      `"${t.priority || 'medium'}"`,
      `"${t.status}"`,
      `"${t.test_steps?.length || 0}"`,
      `"${t.ai_generated ? 'Yes' : 'No'}"`,
      `"${t.confidence || 'N/A'}"`,
      `"${escape(t.description || '')}"`,
    ].join(","));
  });
  rows.push(``);

  // Detailed steps for each test
  tests.forEach((t: Record<string, unknown>, idx: number) => {
    rows.push(``);
    rows.push(`"TEST CASE: TC-${String(idx + 1).padStart(3, '0')} — ${escape(t.title)}"`);
    rows.push(`"Description:","${escape(t.description || 'N/A')}"`);
    rows.push(`"Preconditions:","${escape(t.preconditions || 'Application accessible, user has valid credentials')}"`);
    rows.push(``);
    rows.push(`"Step #","Action","Smart Locator","Fallback Selector","Input Data","Expected Result","Locator Strategy","Description"`);

    const steps = (t.test_steps || []).sort((a: Record<string, unknown>, b: Record<string, unknown>) => a.order_index - b.order_index);
    steps.forEach((s: Record<string, unknown>) => {
      const fb = s.target?.fallback_selectors || {};
      // Determine which smart locator strategy applies
      let strategy = "css_fallback";
      let smartLocator = s.target?.selector || "";
      if (fb.accessibility_role && fb.accessibility_role !== "generic" && (fb.aria_label || fb.text)) {
        strategy = "getByRole";
        smartLocator = `getByRole('${fb.accessibility_role}', { name: '${fb.aria_label || fb.text}' })`;
      } else if (fb.label || fb.nearest_label) {
        strategy = "getByLabel";
        smartLocator = `getByLabel('${fb.label || fb.nearest_label}')`;
      } else if (fb.placeholder) {
        strategy = "getByPlaceholder";
        smartLocator = `getByPlaceholder('${fb.placeholder}')`;
      } else if (fb.text) {
        strategy = "getByText";
        smartLocator = `getByText('${fb.text}')`;
      } else if (fb.data_testid) {
        strategy = "getByTestId";
        smartLocator = `getByTestId('${fb.data_testid}')`;
      }

      rows.push([
        `"${s.order_index}"`,
        `"${s.action_type}"`,
        `"${escape(smartLocator)}"`,
        `"${escape(s.target?.selector || '')}"`,
        `"${escape(s.input_data || '')}"`,
        `"${escape(s.expected_result || '')}"`,
        `"${strategy}"`,
        `"${escape(s.target?.description || '')}"`,
      ].join(","));
    });
  });

  // BOM for Excel UTF-8 compatibility
  const bom = "\uFEFF";
  return new NextResponse(bom + rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${projectName.replace(/\s+/g, '_')}_Test_Cases_${timestamp}.csv"`,
    },
  });
}

// ===== PLAYWRIGHT SCRIPT WITH PAGE OBJECT MODEL =====
function generatePlaywrightScript(tests: DBTestCase[], projectName: string): NextResponse {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  // ===== STEP 1: Detect unique pages from test steps =====
  const pageMap = new Map<string, { selectors: Map<string, { selector: string; description: string; action: string; fallbacks: Record<string, string>; tag: string }> }>();

  tests.forEach((t: Record<string, unknown>) => {
    const steps = (t.test_steps || []).sort((a: Record<string, unknown>, b: Record<string, unknown>) => a.order_index - b.order_index);
    let currentPage = "BasePage";

    steps.forEach((s: Record<string, unknown>) => {
      // Detect page from navigate action
      if (s.action_type === "navigate") {
        const url = s.input_data || s.target?.selector || "";
        const pageName = inferPageName(url);
        currentPage = pageName;
      }

      if (!pageMap.has(currentPage)) {
        pageMap.set(currentPage, { selectors: new Map() });
      }

      // Store unique selectors per page WITH fallback data
      const selector = s.target?.selector || "";
      const description = s.target?.description || s.action_type;
      const fallbacks = s.target?.fallback_selectors || {};
      if (selector && !["navigate", "wait", "screenshot"].includes(s.action_type)) {
        const propName = toCamelCase(description);
        pageMap.get(currentPage)!.selectors.set(propName, {
          selector,
          description,
          action: s.action_type,
          fallbacks,
          tag: fallbacks.tag_name || "",
        });
      }
    });
  });

  // ===== FILE HEADER =====
  lines.push(`// ===========================================`);
  lines.push(`// TESTARA — Auto-Generated Playwright Tests`);
  lines.push(`// Pattern: Page Object Model (POM)`);
  lines.push(`// Project: ${projectName}`);
  lines.push(`// Generated: ${timestamp}`);
  lines.push(`// ===========================================`);
  lines.push(``);

  // ===== STEP 2: Generate Page Object Classes =====
  lines.push(`// ═══════════════════════════════════════════`);
  lines.push(`// PAGE OBJECTS`);
  lines.push(`// ═══════════════════════════════════════════`);
  lines.push(``);
  lines.push(`import { type Page, type Locator, expect } from '@playwright/test';`);
  lines.push(``);

  for (const [pageName, pageData] of pageMap.entries()) {
    const className = pageName + "Page";

    lines.push(`export class ${className} {`);
    lines.push(`  readonly page: Page;`);
    lines.push(``);

    // Element locators as readonly properties
    for (const [propName, info] of pageData.selectors.entries()) {
      lines.push(`  /** ${info.description} */`);
      lines.push(`  readonly ${propName}: Locator;`);
    }
    lines.push(``);

    // Constructor with SMART LOCATORS (not fragile CSS/XPath)
    lines.push(`  constructor(page: Page) {`);
    lines.push(`    this.page = page;`);
    for (const [propName, info] of pageData.selectors.entries()) {
      const fb = info.fallbacks;
      const role = fb.accessibility_role;
      const ariaLabel = fb.aria_label;
      const text = fb.text;
      const placeholder = fb.placeholder;
      const testId = fb.data_testid;
      const nameAttr = fb.name;

      // Pick best smart locator strategy
      if (role && role !== "generic" && (ariaLabel || text)) {
        const name = ariaLabel || text;
        lines.push(`    this.${propName} = page.getByRole('${role}', { name: '${escapeTS(name || "")}' });`);
      } else if (fb.label || fb.nearest_label) {
        lines.push(`    this.${propName} = page.getByLabel('${escapeTS(fb.label || fb.nearest_label || "")}');`);
      } else if (placeholder) {
        lines.push(`    this.${propName} = page.getByPlaceholder('${escapeTS(placeholder)}');`);
      } else if (text && ["button", "a", "span", "label"].includes(info.tag)) {
        lines.push(`    this.${propName} = page.getByText('${escapeTS(text)}');`);
      } else if (testId) {
        const match = testId.match(/data-testid="([^"]+)"/);
        lines.push(`    this.${propName} = page.getByTestId('${escapeTS(match ? match[1] : testId)}');`);
      } else if (nameAttr) {
        lines.push(`    this.${propName} = page.locator('[name="${escapeTS(nameAttr)}"]');`);
      } else {
        // Last resort — raw selector
        lines.push(`    this.${propName} = page.locator('${escapeTS(info.selector)}');`);
      }
    }
    lines.push(`  }`);
    lines.push(``);

    // Action methods grouped by common patterns
    const inputFields = [...pageData.selectors.entries()].filter(([, v]) => v.action === "type");
    const buttons = [...pageData.selectors.entries()].filter(([, v]) => v.action === "click");

    // Generate fill method for forms
    if (inputFields.length > 0) {
      const params = inputFields.map(([name]) => `${name}Value: string`).join(", ");
      lines.push(`  async fillForm(${params}) {`);
      for (const [name] of inputFields) {
        lines.push(`    await this.${name}.fill(${name}Value);`);
      }
      lines.push(`  }`);
      lines.push(``);
    }

    // Generate click methods
    for (const [name, info] of buttons) {
      lines.push(`  async click${capitalize(name)}() {`);
      lines.push(`    await this.${name}.click();`);
      lines.push(`  }`);
      lines.push(``);
    }

    // Navigate method
    lines.push(`  async navigate(url: string) {`);
    lines.push(`    await this.page.goto(url);`);
    lines.push(`  }`);
    lines.push(``);

    lines.push(`}`);
    lines.push(``);
  }

  // ===== STEP 3: Generate Test Specs using Page Objects =====
  lines.push(`// ═══════════════════════════════════════════`);
  lines.push(`// TEST SPECIFICATIONS`);
  lines.push(`// ═══════════════════════════════════════════`);
  lines.push(``);
  lines.push(`import { test } from '@playwright/test';`);
  lines.push(``);

  tests.forEach((t: Record<string, unknown>, idx: number) => {
    const steps = (t.test_steps || []).sort((a: Record<string, unknown>, b: Record<string, unknown>) => a.order_index - b.order_index);
    const tcId = `TC-${String(idx + 1).padStart(3, '0')}`;

    lines.push(`test('${tcId}: ${escapeTS(t.title)}', async ({ page }) => {`);
    if (t.description) lines.push(`  // ${t.description}`);
    lines.push(``);

    // Instantiate page objects used in this test
    const usedPages = new Set<string>();
    let currentPageName = "BasePage";

    steps.forEach((s: Record<string, unknown>) => {
      if (s.action_type === "navigate") {
        currentPageName = inferPageName(s.input_data || s.target?.selector || "");
      }
      usedPages.add(currentPageName);
    });

    for (const pName of usedPages) {
      const varName = pName.charAt(0).toLowerCase() + pName.slice(1);
      lines.push(`  const ${varName} = new ${pName}Page(page);`);
    }
    lines.push(``);

    // Generate test steps using page objects + smart locators
    currentPageName = "BasePage";
    steps.forEach((s: Record<string, unknown>) => {
      const selector = s.target?.selector || "";
      const input = s.input_data || "";
      const expected = s.expected_result || "";
      const description = s.target?.description || "";
      const fb = s.target?.fallback_selectors || {};

      // Helper: generate inline smart locator code when element isn't in page object
      function smartLoc(): string {
        const role = fb.accessibility_role;
        const ariaLabel = fb.aria_label;
        const text = fb.text;
        if (role && role !== "generic" && (ariaLabel || text)) return `page.getByRole('${role}', { name: '${escapeTS(ariaLabel || text || "")}' })`;
        if (fb.label || fb.nearest_label) return `page.getByLabel('${escapeTS(fb.label || fb.nearest_label || "")}')`;
        if (fb.placeholder) return `page.getByPlaceholder('${escapeTS(fb.placeholder)}')`;
        if (text) return `page.getByText('${escapeTS(text)}')`;
        if (fb.data_testid) { const m = fb.data_testid.match(/data-testid="([^"]+)"/); return `page.getByTestId('${escapeTS(m ? m[1] : fb.data_testid)}')`; }
        if (fb.name) return `page.locator('[name="${escapeTS(fb.name)}"]')`;
        return `page.locator('${escapeTS(selector)}')`;
      }

      lines.push(`  // Step ${s.order_index}: ${description || s.action_type}`);

      if (s.action_type === "navigate") {
        currentPageName = inferPageName(input || selector);
        const varName = currentPageName.charAt(0).toLowerCase() + currentPageName.slice(1);
        lines.push(`  await ${varName}.navigate('${escapeTS(input || selector)}');`);
      } else if (s.action_type === "click") {
        const varName = currentPageName.charAt(0).toLowerCase() + currentPageName.slice(1);
        const propName = toCamelCase(description);
        if (pageMap.get(currentPageName)?.selectors.has(propName)) {
          lines.push(`  await ${varName}.${propName}.click();`);
        } else {
          lines.push(`  await ${smartLoc()}.click();`);
        }
      } else if (s.action_type === "type") {
        const varName = currentPageName.charAt(0).toLowerCase() + currentPageName.slice(1);
        const propName = toCamelCase(description);
        if (pageMap.get(currentPageName)?.selectors.has(propName)) {
          lines.push(`  await ${varName}.${propName}.fill('${escapeTS(input)}');`);
        } else {
          lines.push(`  await ${smartLoc()}.fill('${escapeTS(input)}');`);
        }
      } else if (s.action_type === "assert_text") {
        lines.push(`  await expect(${smartLoc()}).toContainText('${escapeTS(expected)}');`);
      } else if (s.action_type === "assert_visible") {
        lines.push(`  await expect(${smartLoc()}).toBeVisible();`);
      } else if (s.action_type === "assert_url") {
        lines.push(`  await expect(page).toHaveURL(/${escapeRegex(expected)}/);`);
      } else if (s.action_type === "wait") {
        lines.push(`  await page.waitForTimeout(${parseInt(input) || 1000});`);
      } else if (s.action_type === "select") {
        lines.push(`  await ${smartLoc()}.selectOption('${escapeTS(input)}');`);
      } else if (s.action_type === "hover") {
        lines.push(`  await ${smartLoc()}.hover();`);
      } else if (s.action_type === "screenshot") {
        lines.push(`  await page.screenshot({ path: 'screenshots/${tcId}-step${s.order_index}.png' });`);
      } else if (s.action_type.startsWith("mainframe_")) {
        lines.push(`  // Mainframe step: ${s.action_type} — use Testara CLI agent`);
        lines.push(`  // ${s.action_type}('${escapeTS(selector)}', '${escapeTS(input)}');`);
      } else {
        lines.push(`  // ${s.action_type}: ${escapeTS(selector)}`);
      }
      lines.push(``);
    });

    lines.push(`});`);
    lines.push(``);
  });

  // ===== STEP 4: Generate playwright.config.ts =====
  lines.push(`// ═══════════════════════════════════════════`);
  lines.push(`// PLAYWRIGHT CONFIG (save as playwright.config.ts)`);
  lines.push(`// ═══════════════════════════════════════════`);
  lines.push(`/*`);
  lines.push(`import { defineConfig } from '@playwright/test';`);
  lines.push(`export default defineConfig({`);
  lines.push(`  testDir: './tests',`);
  lines.push(`  timeout: 30000,`);
  lines.push(`  retries: 2,`);
  lines.push(`  use: {`);
  lines.push(`    baseURL: process.env.BASE_URL || 'http://localhost:3000',`);
  lines.push(`    screenshot: 'on',`);
  lines.push(`    video: 'retain-on-failure',`);
  lines.push(`    trace: 'retain-on-failure',`);
  lines.push(`  },`);
  lines.push(`  projects: [`);
  lines.push(`    { name: 'chromium', use: { browserName: 'chromium' } },`);
  lines.push(`    { name: 'firefox', use: { browserName: 'firefox' } },`);
  lines.push(`    { name: 'webkit', use: { browserName: 'webkit' } },`);
  lines.push(`  ],`);
  lines.push(`});`);
  lines.push(`*/`);

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/typescript",
      "Content-Disposition": `attachment; filename="${projectName.replace(/\s+/g, '_')}_tests.spec.ts"`,
    },
  });
}

// Helper: infer page name from URL
function inferPageName(url: string): string {
  try {
    const path = new URL(url, "http://localhost").pathname;
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return "Home";
    const last = segments[segments.length - 1];
    return capitalize(last.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/\s/g, ""));
  } catch {
    return "Base";
  }
}

// Helper: convert description to camelCase property name
function toCamelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .map((word, i) => i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join("")
    .slice(0, 30) || "element";
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ===== GHERKIN / BDD FORMAT =====
function generateGherkin(tests: DBTestCase[], projectName: string): NextResponse {
  const lines: string[] = [];

  lines.push(`# Testara — Auto-Generated Gherkin Feature File`);
  lines.push(`# Project: ${projectName}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`Feature: ${projectName} Test Automation`);
  lines.push(`  As a QA engineer`);
  lines.push(`  I want to verify the application works correctly`);
  lines.push(`  So that users have a reliable experience`);
  lines.push(``);

  tests.forEach((t: Record<string, unknown>, idx: number) => {
    const steps = (t.test_steps || []).sort((a: Record<string, unknown>, b: Record<string, unknown>) => a.order_index - b.order_index);
    const tag = t.tags?.[0] || 'functional';

    lines.push(`  @${tag} @TC-${String(idx + 1).padStart(3, '0')}`);
    lines.push(`  Scenario: ${t.title}`);
    if (t.description) lines.push(`    # ${t.description}`);
    lines.push(``);

    steps.forEach((s: Record<string, unknown>, si: number) => {
      const keyword = si === 0 ? "Given" : s.action_type.startsWith("assert") ? "Then" : "And";
      const desc = s.target?.description || s.action_type;

      switch (s.action_type) {
        case "navigate":
          lines.push(`    ${keyword} I navigate to "${s.input_data || s.target?.selector || 'the page'}"`);
          break;
        case "click":
          lines.push(`    ${keyword} I click on "${desc}"`);
          break;
        case "type":
          lines.push(`    ${keyword} I enter "${s.input_data}" in the "${desc}" field`);
          break;
        case "select":
          lines.push(`    ${keyword} I select "${s.input_data}" from "${desc}"`);
          break;
        case "assert_text":
          lines.push(`    Then I should see "${s.expected_result}" in "${desc}"`);
          break;
        case "assert_visible":
          lines.push(`    Then the "${desc}" should be visible`);
          break;
        case "assert_url":
          lines.push(`    Then the URL should contain "${s.expected_result}"`);
          break;
        case "wait":
          lines.push(`    And I wait for ${s.input_data || '1000'} milliseconds`);
          break;
        default:
          lines.push(`    ${keyword} I perform "${s.action_type}" on "${desc}"`);
      }
    });
    lines.push(``);
  });

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain",
      "Content-Disposition": `attachment; filename="${projectName.replace(/\s+/g, '_')}.feature"`,
    },
  });
}

// ===== SIMPLE CSV =====
function generateCSV(tests: DBTestCase[], projectName: string): NextResponse {
  const rows: string[] = [];
  rows.push("Test ID,Title,Description,Type,Status,Step Count,AI Generated");

  tests.forEach((t: Record<string, unknown>, idx: number) => {
    rows.push([
      `TC-${String(idx + 1).padStart(3, '0')}`,
      `"${escape(t.title)}"`,
      `"${escape(t.description || '')}"`,
      t.tags?.[0] || "functional",
      t.status,
      t.test_steps?.length || 0,
      t.ai_generated ? "Yes" : "No",
    ].join(","));
  });

  return new NextResponse(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${projectName.replace(/\s+/g, '_')}_tests.csv"`,
    },
  });
}

// Helpers
function escape(str: string): string {
  return str.replace(/"/g, '""').replace(/\n/g, ' ');
}
function escapeTS(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
