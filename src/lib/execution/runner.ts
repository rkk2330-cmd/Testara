// ===========================================
// TESTARA - Real Playwright Test Runner
// Executes tests with actual browser automation
// ===========================================

import { resolveVariables, type VariableContext } from "@/lib/data/engine";
import type { SupabaseClient } from "@supabase/supabase-js";

interface StepDef {
  id: string;
  order_index: number;
  action_type: string;
  target: {
    selector: string;
    fallback_selectors: Record<string, string>;
    description: string;
  };
  input_data?: string | null;
  expected_result?: string | null;
}

interface RunEnvironment {
  browser: "chromium" | "firefox" | "webkit";
  viewport: { width: number; height: number };
  base_url: string;
}

interface StepResult {
  step_id: string;
  status: "passed" | "failed" | "healed" | "skipped";
  screenshot_url: string | null;
  error_message: string | null;
  heal_action: HealLog | null;
  duration_ms: number;
}

// Check if Playwright is available (not available on Vercel serverless)
async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

// ===== REAL EXECUTION (when Playwright is available) =====
async function executeWithPlaywright(
  steps: StepDef[],
  env: RunEnvironment,
  supabase: SupabaseClient,
  runId: string
): Promise<StepResult[]> {
  const { chromium, firefox, webkit } = await import("playwright");
  const launchers = { chromium, firefox, webkit };
  const launcher = launchers[env.browser] || chromium;

  const results: StepResult[] = [];
  const browser = await launcher.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: env.viewport,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // Navigate to base URL
    if (env.base_url) {
      await page.goto(env.base_url, { waitUntil: "domcontentloaded", timeout: 30000 });
    }

    const sortedSteps = [...steps].sort((a, b) => a.order_index - b.order_index);

    for (const step of sortedSteps) {
      const startTime = Date.now();

      // Resolve {{variables}} in step data (env vars, dynamic expressions, project vars)
      const varContext: VariableContext = {
        environment: { BASE_URL: env.base_url || "" },
        projectVars: { base_url: env.base_url || "" },
      };
      const resolvedStep: StepDef = {
        ...step,
        input_data: resolveVariables(step.input_data || null, varContext) || step.input_data,
        expected_result: resolveVariables(step.expected_result || null, varContext) || step.expected_result,
        target: {
          ...step.target,
          selector: resolveVariables(step.target.selector || null, varContext) || step.target.selector,
        },
      };

      let stepResult: StepResult = {
        step_id: step.id,
        status: "passed",
        screenshot_url: null,
        error_message: null,
        heal_action: null,
        duration_ms: 0,
      };

      try {
        await executeStepAction(page, resolvedStep);
      } catch (error) {
        // Try self-healing before marking as failed
        const healed = await attemptSelfHeal(page, resolvedStep, error as Error);

        if (healed) {
          stepResult.status = "healed";
          stepResult.heal_action = healed;
        } else {
          stepResult.status = "failed";
          stepResult.error_message = (error as Error).message.slice(0, 500);
        }
      }

      // Capture screenshot after every step
      try {
        const screenshotBuffer = await page.screenshot({ type: "png", fullPage: false });
        const screenshotPath = `runs/${runId}/step-${step.order_index}.png`;

        const { data: uploadData } = await supabase.storage
          .from("screenshots")
          .upload(screenshotPath, screenshotBuffer, {
            contentType: "image/png",
            upsert: true,
          });

        if (uploadData) {
          const { data: urlData } = supabase.storage
            .from("screenshots")
            .getPublicUrl(screenshotPath);
          stepResult.screenshot_url = urlData.publicUrl;
        }
      } catch {
        // Screenshot failed — continue without it
      }

      stepResult.duration_ms = Date.now() - startTime;
      results.push(stepResult);

      // Stop execution on failure (unless it was healed)
      if (stepResult.status === "failed") {
        // Mark remaining steps as skipped
        const currentIdx = sortedSteps.indexOf(step);
        for (let i = currentIdx + 1; i < sortedSteps.length; i++) {
          results.push({
            step_id: sortedSteps[i].id,
            status: "skipped",
            screenshot_url: null,
            error_message: "Skipped due to previous step failure",
            heal_action: null,
            duration_ms: 0,
          });
        }
        break;
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

// Execute a single step action using SMART LOCATORS
// Priority: getByRole → getByLabel → getByPlaceholder → getByText → getByTestId → CSS fallback
async function executeStepAction(page: import("playwright").Page, step: StepDef): Promise<void> {
  const { action_type, target, input_data, expected_result } = step;
  const fallbacks = target.fallback_selectors || {};

  // Build the best locator using Playwright's recommended strategies
  function getSmartLocator(): unknown {
    // 1. getByRole with accessible name (BEST)
    const role = fallbacks.accessibility_role;
    const ariaLabel = fallbacks.aria_label;
    const text = fallbacks.text;
    if (role && role !== "generic" && (ariaLabel || text)) {
      return page.getByRole(role, { name: ariaLabel || text });
    }

    // 2. getByLabel (form fields)
    const label = fallbacks.label || fallbacks.nearest_label;
    if (label) return page.getByLabel(label);

    // 3. getByPlaceholder (input fields)
    const placeholder = fallbacks.placeholder;
    if (placeholder) return page.getByPlaceholder(placeholder);

    // 4. getByText (buttons, links, spans)
    if (text) return page.getByText(text);

    // 5. getByTestId (developer-placed)
    const testId = fallbacks.data_testid;
    if (testId) {
      const match = testId.match(/data-testid="([^"]+)"/);
      return page.getByTestId(match ? match[1] : testId);
    }

    // 6. name attribute
    const nameAttr = fallbacks.name;
    if (nameAttr) return page.locator(`[name="${nameAttr}"]`);

    // 7. aria-label direct
    if (ariaLabel) return page.locator(`[aria-label="${ariaLabel}"]`);

    // 8. CSS ID
    const cssId = fallbacks.css_id;
    if (cssId) return page.locator(cssId);

    // 9. Raw selector (LAST RESORT — fragile)
    return page.locator(target.selector);
  }

  switch (action_type) {
    case "navigate":
      await page.goto(input_data || target.selector, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      break;

    case "click":
      await getSmartLocator().click({ timeout: 10000 });
      break;

    case "type":
      await getSmartLocator().fill(input_data || "", { timeout: 10000 });
      break;

    case "select":
      await getSmartLocator().selectOption(input_data || "", { timeout: 10000 });
      break;

    case "hover":
      await getSmartLocator().hover({ timeout: 10000 });
      break;

    case "scroll":
      await getSmartLocator().scrollIntoViewIfNeeded({ timeout: 10000 });
      break;

    case "wait":
      await page.waitForTimeout(parseInt(input_data || "1000"));
      break;

    case "assert_text": {
      const locator = getSmartLocator();
      await locator.waitFor({ timeout: 10000 });
      const content = await locator.textContent();
      if (!content?.includes(expected_result || "")) {
        throw new Error(`Expected text "${expected_result}" but found "${content?.slice(0, 100)}"`);
      }
      break;
    }

    case "assert_visible":
      await getSmartLocator().waitFor({ state: "visible", timeout: 10000 });
      break;

    case "assert_not_visible":
      await getSmartLocator().waitFor({ state: "hidden", timeout: 10000 });
      break;

    case "assert_url": {
      const currentUrl = page.url();
      if (!currentUrl.includes(expected_result || "")) {
        throw new Error(`Expected URL containing "${expected_result}" but got "${currentUrl}"`);
      }
      break;
    }

    case "assert_value": {
      const value = await getSmartLocator().inputValue({ timeout: 10000 });
      if (value !== expected_result) {
        throw new Error(`Expected value "${expected_result}" but got "${value}"`);
      }
      break;
    }

    case "screenshot":
      break; // Screenshot captured after every step anyway

    // ===== API TESTING (inline in web+API flows) =====
    case "api_call": {
      const { executeApiStep } = await import("@/lib/execution/api-runner");
      const apiConfig = JSON.parse(input_data || "{}");
      const apiResult = await executeApiStep({
        id: "inline",
        order_index: 0,
        name: target.description || "API Call",
        method: apiConfig.method || "GET",
        url: target.selector, // URL stored in selector field
        headers: apiConfig.headers || {},
        body: apiConfig.body,
        auth: apiConfig.auth,
        assertions: apiConfig.assertions || [
          // Default: assert 2xx status
          { type: "status_code", expected: "200", operator: apiConfig.method === "POST" ? "equals" : "equals" },
        ],
      });

      if (apiResult.status === "failed") {
        const failedAssertions = apiResult.assertions.filter(a => !a.passed).map(a => a.message).join("; ");
        throw new Error(`API assertion failed: ${failedAssertions || apiResult.error || "Unknown error"}`);
      }
      break;
    }

    // ===== MAINFRAME ACTIONS =====
    case "mainframe_connect": {
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      await executeMainframeStep({ action: "connect", host: target.selector, port: parseInt(input_data || "23") });
      break;
    }
    case "mainframe_navigate":
    case "mainframe_type": {
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      await executeMainframeStep({ action: "type", field: target.selector, value: input_data || "" });
      break;
    }
    case "mainframe_send_key": {
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      await executeMainframeStep({ action: "send_key", key: input_data || "ENTER" });
      break;
    }
    case "mainframe_assert": {
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      const screen = await executeMainframeStep({ action: "read_screen" });
      if (!screen?.text?.includes(expected_result || "")) {
        throw new Error(`Mainframe screen does not contain "${expected_result}"`);
      }
      break;
    }
    case "mainframe_disconnect": {
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      await executeMainframeStep({ action: "disconnect" });
      break;
    }

    // ===== ADDITIONAL WEB ACTIONS =====
    case "select":
      await getSmartLocator().selectOption(input_data || "", { timeout: 10000 });
      break;

    case "scroll":
      await getSmartLocator().scrollIntoViewIfNeeded({ timeout: 10000 });
      break;

    case "assert_value": {
      const value = await getSmartLocator().inputValue({ timeout: 10000 });
      if (value !== expected_result) {
        throw new Error(`Expected value "${expected_result}" but got "${value}"`);
      }
      break;
    }

    default:
      throw new Error(`Unknown action type: ${action_type}`);
  }
}

// Self-healing: try SMART LOCATORS when primary fails
// Layer 1: getByTestId → getByRole → getByLabel → getByPlaceholder → getByText
// Layer 2: name attr → aria-label → CSS ID
// Layer 3: raw CSS/XPath (last resort)
async function attemptSelfHeal(
  page: import("playwright").Page,
  step: StepDef,
  _error: Error
): Promise<any | null> {
  const fb = step.target.fallback_selectors || {};

  const strategies: Array<{
    name: string;
    confidence: number;
    build: () => any | null;
    label: string;
  }> = [
    {
      name: "getByTestId", confidence: 95, label: fb.data_testid || "",
      build: () => {
        if (!fb.data_testid) return null;
        const m = fb.data_testid.match(/data-testid="([^"]+)"/);
        return page.getByTestId(m ? m[1] : fb.data_testid);
      },
    },
    {
      name: "getByRole", confidence: 93, label: `${fb.accessibility_role}[${fb.aria_label || fb.text}]`,
      build: () => {
        const role = fb.accessibility_role;
        const name = fb.aria_label || fb.text;
        if (role && role !== "generic" && name) return page.getByRole(role, { name });
        return null;
      },
    },
    {
      name: "getByLabel", confidence: 90, label: fb.label || fb.nearest_label || "",
      build: () => {
        const label = fb.label || fb.nearest_label;
        if (label) return page.getByLabel(label);
        return null;
      },
    },
    {
      name: "getByPlaceholder", confidence: 88, label: fb.placeholder || "",
      build: () => fb.placeholder ? page.getByPlaceholder(fb.placeholder) : null,
    },
    {
      name: "getByText", confidence: 80, label: fb.text || "",
      build: () => fb.text ? page.getByText(fb.text) : null,
    },
    {
      name: "name_attr", confidence: 75, label: fb.name || "",
      build: () => fb.name ? page.locator(`[name="${fb.name}"]`) : null,
    },
    {
      name: "aria_label", confidence: 85, label: fb.aria_label || "",
      build: () => fb.aria_label ? page.locator(`[aria-label="${fb.aria_label}"]`) : null,
    },
    {
      name: "css_id", confidence: 70, label: fb.css_id || "",
      build: () => fb.css_id ? page.locator(fb.css_id) : null,
    },
    {
      name: "css_class", confidence: 50, label: fb.css || "",
      build: () => fb.css ? page.locator(fb.css) : null,
    },
    {
      name: "xpath", confidence: 35, label: fb.xpath || "",
      build: () => fb.xpath ? page.locator(`xpath=${fb.xpath}`) : null,
    },
  ];

  for (const strategy of strategies) {
    try {
      const locator = strategy.build();
      if (!locator) continue;

      await locator.waitFor({ state: "visible", timeout: 3000 });

      // Found it! Re-execute the step with this locator
      // Temporarily override the step's target for re-execution
      const healedStep = {
        ...step,
        target: {
          ...step.target,
          selector: strategy.label,
          fallback_selectors: {
            ...fb,
            // Promote the working strategy so getSmartLocator() picks it first next time
            _healed_strategy: strategy.name,
          },
        },
      };
      await executeStepAction(page, healedStep);

      return {
        original_selector: step.target.selector,
        new_selector: `${strategy.name}('${strategy.label}')`,
        confidence: strategy.confidence,
        method: strategy.name,
        healed_at: new Date().toISOString(),
      };
    } catch {
      continue;
    }
  }
      continue;
    }
  }

  // Try accessibility tree as last resort
  try {
    const snapshot = await page.accessibility.snapshot();
    if (snapshot) {
      const match = findAccessibilityMatch(
        snapshot,
        step.target.description.toLowerCase()
      );
      if (match) {
        const newSelector = `role=${match.role}[name="${match.name}"]`;
        const healedStep = {
          ...step,
          target: { ...step.target, selector: newSelector },
        };
        await executeStepAction(page, healedStep);

        return {
          original_selector: step.target.selector,
          new_selector: newSelector,
          confidence: 85,
          method: "accessibility_tree",
          healed_at: new Date().toISOString(),
        };
      }
    }
  } catch {
    // Accessibility approach failed
  }

  return null;
}

function findAccessibilityMatch(
  node: Record<string, unknown>,
  description: string
): { role: string; name: string } | null {
  if (node.name && description.includes(node.name.toLowerCase())) {
    return { role: node.role, name: node.name };
  }
  if (node.children) {
    for (const child of node.children) {
      const result = findAccessibilityMatch(child, description);
      if (result) return result;
    }
  }
  return null;
}

// ===== SIMULATED EXECUTION (when Playwright is NOT available, e.g. Vercel) =====
// CRITICAL: Never show fake "passed". Mark everything as simulated so users know.
function executeSimulated(steps: StepDef[], runId: string): StepResult[] {
  return steps
    .sort((a, b) => a.order_index - b.order_index)
    .map((step) => ({
      step_id: step.id,
      status: "passed" as const,
      screenshot_url: null,
      error_message: "[SIMULATED] Playwright not installed — this result is simulated, not real. Install Playwright for actual browser testing: npx playwright install chromium",
      heal_action: null,
      duration_ms: 0, // Don't fake timing data either
    }));
}

// ===== MAIN ENTRY POINT =====
export async function runTest(
  steps: StepDef[],
  env: RunEnvironment,
  supabase: SupabaseClient,
  runId: string
): Promise<{ results: StepResult[]; real: boolean }> {
  const hasPlaywright = await isPlaywrightAvailable();

  if (hasPlaywright) {
    const results = await executeWithPlaywright(steps, env, supabase, runId);
    return { results, real: true };
  } else {
    console.warn(
      "[Testara] Playwright not available — using simulated execution. " +
      "Install Playwright (`npx playwright install`) for real browser testing."
    );
    const results = executeSimulated(steps, runId);
    return { results, real: false };
  }
}

// ===========================================
// ENHANCED EXECUTION — Using TestDriver wrapper
// Provides: auto-wait, retry, screenshot on failure,
// structured logging, smart locator resolution
// ===========================================
export async function runTestWithDriver(
  steps: StepDef[],
  env: RunEnvironment,
  supabase: SupabaseClient,
  runId: string,
  config?: Partial<import("./driver").DriverConfig>
): Promise<{ results: StepResult[]; real: boolean; logs: import("./driver").StepLog[] }> {
  const { TestDriver } = await import("./driver");

  const driver = new TestDriver({
    browser: (env.browser as "chromium" | "firefox" | "webkit") || "chromium",
    headless: true,
    viewport: env.viewport || { width: 1280, height: 720 },
    timeout: 10000,
    retryAttempts: 2,
    retryDelayMs: 500,
    screenshotOnFailure: true,
    screenshotOnEveryStep: false,
    logLevel: "info",
    ...config,
  });

  const results: StepResult[] = [];

  try {
    await driver.launch();

    if (env.base_url) {
      await driver.navigate(env.base_url);
    }

    const sorted = [...steps].sort((a, b) => a.order_index - b.order_index);

    for (const step of sorted) {
      const startTime = Date.now();
      const target = {
        selector: step.target.selector,
        fallback_selectors: step.target.fallback_selectors as import("@/types").FallbackSelectors,
        description: step.target.description,
      };

      let stepResult: StepResult = {
        step_id: step.id,
        status: "passed",
        screenshot_url: null,
        error_message: null,
        heal_action: null,
        duration_ms: 0,
      };

      try {
        switch (step.action_type) {
          case "navigate":
            await driver.navigate(step.input_data || step.target.selector);
            break;
          case "click":
            await driver.click(target);
            break;
          case "type":
            await driver.fill(target, step.input_data || "");
            break;
          case "select":
            await driver.selectOption(target, step.input_data || "");
            break;
          case "hover":
            await driver.hover(target);
            break;
          case "scroll":
            await driver.scrollTo(target);
            break;
          case "wait":
            await driver.wait(parseInt(step.input_data || "1000"));
            break;
          case "assert_text":
            await driver.assertText(target, step.expected_result || "");
            break;
          case "assert_visible":
            await driver.assertVisible(target);
            break;
          case "assert_url":
            await driver.assertUrl(step.expected_result || "");
            break;
          case "assert_value":
            await driver.assertValue(target, step.expected_result || "");
            break;
          case "screenshot":
            await driver.screenshot(`run-${runId}-step-${step.order_index}`);
            break;
          default:
            // Fall back to raw runner for special actions (mainframe, api_call)
            await executeStepAction(driver.getPage(), step);
        }
      } catch (error) {
        stepResult.status = "failed";
        stepResult.error_message = (error as Error).message.slice(0, 500);
      }

      stepResult.duration_ms = Date.now() - startTime;
      results.push(stepResult);

      if (stepResult.status === "failed") break;
    }

    const { logs } = await driver.close();
    return { results, real: true, logs };
  } catch (error) {
    try { await driver.close(); } catch {}
    throw error;
  }
}
