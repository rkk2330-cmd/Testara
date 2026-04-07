// ===========================================
// TESTARA — Browser Driver Wrapper
// Built on top of Playwright with:
// - Auto-wait with configurable strategies
// - Retry/backoff for flaky interactions
// - Screenshot on failure with DOM context
// - Structured logging per step
// - Smart locator resolution
// - Proper browser lifecycle
// ===========================================

import type { Browser, BrowserContext, Page, Locator } from "playwright";
import type { FallbackSelectors } from "@/types";

// ===== CONFIGURATION =====
export interface DriverConfig {
  browser: "chromium" | "firefox" | "webkit";
  headless: boolean;
  viewport: { width: number; height: number };
  timeout: number;           // Global timeout (ms)
  retryAttempts: number;     // Retry flaky actions N times
  retryDelayMs: number;      // Wait between retries
  screenshotOnFailure: boolean;
  screenshotOnEveryStep: boolean;
  videoOnFailure: boolean;
  traceOnFailure: boolean;
  slowMotion: number;        // Slow down actions by N ms (for debugging)
  logLevel: "silent" | "error" | "info" | "debug";
}

const DEFAULT_CONFIG: DriverConfig = {
  browser: "chromium",
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 10000,
  retryAttempts: 2,
  retryDelayMs: 500,
  screenshotOnFailure: true,
  screenshotOnEveryStep: false,
  videoOnFailure: false,
  traceOnFailure: false,
  slowMotion: 0,
  logLevel: "info",
};

// ===== STEP LOG =====
export interface StepLog {
  stepIndex: number;
  action: string;
  target: string;
  status: "passed" | "failed" | "retried" | "healed";
  duration_ms: number;
  locatorStrategy: string;
  attempt: number;
  screenshot?: Buffer;
  error?: string;
  domContext?: string;        // Surrounding HTML on failure
  pageUrl: string;
  timestamp: string;
}

// ===== MAIN DRIVER CLASS =====
export class TestDriver {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: DriverConfig;
  private logs: StepLog[] = [];
  private stepCounter = 0;

  constructor(config: Partial<DriverConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===== LIFECYCLE =====
  async launch(): Promise<void> {
    const { chromium, firefox, webkit } = await import("playwright");
    const browserType = { chromium, firefox, webkit }[this.config.browser];

    this.browser = await browserType.launch({
      headless: this.config.headless,
      slowMo: this.config.slowMotion,
    });

    this.context = await this.browser.newContext({
      viewport: this.config.viewport,
      ignoreHTTPSErrors: true,
      ...(this.config.videoOnFailure ? { recordVideo: { dir: "/tmp/testara-videos" } } : {}),
    });

    if (this.config.traceOnFailure) {
      await this.context.tracing.start({ screenshots: true, snapshots: true });
    }

    this.page = await this.context.newPage();
    this.log("info", "Browser launched", { browser: this.config.browser });
  }

  async close(): Promise<{ logs: StepLog[]; hasFailures: boolean }> {
    const hasFailures = this.logs.some(l => l.status === "failed");

    if (this.config.traceOnFailure && hasFailures && this.context) {
      await this.context.tracing.stop({ path: `/tmp/testara-trace-${Date.now()}.zip` });
    }

    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();

    this.log("info", "Browser closed", { steps: this.logs.length, failures: this.logs.filter(l => l.status === "failed").length });

    return { logs: this.logs, hasFailures };
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched. Call launch() first.");
    return this.page;
  }

  getLogs(): StepLog[] {
    return this.logs;
  }

  // ===== NAVIGATION =====
  async navigate(url: string): Promise<void> {
    await this.executeStep("navigate", url, async () => {
      await this.getPage().goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.config.timeout * 3, // 3x timeout for navigation
      });
    });
  }

  // ===== SMART ELEMENT INTERACTION =====
  // These wrapper functions use smart locators with auto-wait and retry

  async click(target: { selector: string; fallback_selectors?: FallbackSelectors; description?: string }): Promise<void> {
    await this.executeStep("click", target.description || target.selector, async () => {
      const locator = await this.resolveLocator(target);
      await this.autoWait(locator);
      await locator.click({ timeout: this.config.timeout });
    });
  }

  async fill(target: { selector: string; fallback_selectors?: FallbackSelectors; description?: string }, value: string): Promise<void> {
    await this.executeStep("type", target.description || target.selector, async () => {
      const locator = await this.resolveLocator(target);
      await this.autoWait(locator);
      await locator.fill(value, { timeout: this.config.timeout });
    });
  }

  async selectOption(target: { selector: string; fallback_selectors?: FallbackSelectors; description?: string }, value: string): Promise<void> {
    await this.executeStep("select", target.description || target.selector, async () => {
      const locator = await this.resolveLocator(target);
      await this.autoWait(locator);
      await locator.selectOption(value, { timeout: this.config.timeout });
    });
  }

  async hover(target: { selector: string; fallback_selectors?: FallbackSelectors; description?: string }): Promise<void> {
    await this.executeStep("hover", target.description || target.selector, async () => {
      const locator = await this.resolveLocator(target);
      await this.autoWait(locator);
      await locator.hover({ timeout: this.config.timeout });
    });
  }

  async scrollTo(target: { selector: string; fallback_selectors?: FallbackSelectors; description?: string }): Promise<void> {
    await this.executeStep("scroll", target.description || target.selector, async () => {
      const locator = await this.resolveLocator(target);
      await locator.scrollIntoViewIfNeeded({ timeout: this.config.timeout });
    });
  }

  // ===== ASSERTIONS =====
  async assertText(target: { selector: string; fallback_selectors?: FallbackSelectors; description?: string }, expected: string): Promise<void> {
    await this.executeStep("assert_text", target.description || target.selector, async () => {
      const locator = await this.resolveLocator(target);
      await this.autoWait(locator);
      const text = await locator.textContent({ timeout: this.config.timeout });
      if (!text?.includes(expected)) {
        throw new Error(`Expected text "${expected}" but found "${text?.slice(0, 100)}"`);
      }
    });
  }

  async assertVisible(target: { selector: string; fallback_selectors?: FallbackSelectors; description?: string }): Promise<void> {
    await this.executeStep("assert_visible", target.description || target.selector, async () => {
      const locator = await this.resolveLocator(target);
      await locator.waitFor({ state: "visible", timeout: this.config.timeout });
    });
  }

  async assertUrl(pattern: string): Promise<void> {
    await this.executeStep("assert_url", pattern, async () => {
      const url = this.getPage().url();
      if (!url.includes(pattern)) {
        throw new Error(`Expected URL containing "${pattern}" but got "${url}"`);
      }
    });
  }

  async assertValue(target: { selector: string; fallback_selectors?: FallbackSelectors; description?: string }, expected: string): Promise<void> {
    await this.executeStep("assert_value", target.description || target.selector, async () => {
      const locator = await this.resolveLocator(target);
      const value = await locator.inputValue({ timeout: this.config.timeout });
      if (value !== expected) {
        throw new Error(`Expected value "${expected}" but got "${value}"`);
      }
    });
  }

  // ===== UTILITIES =====
  async screenshot(name?: string): Promise<Buffer> {
    const page = this.getPage();
    return page.screenshot({
      type: "png",
      fullPage: false,
      path: name ? `/tmp/testara-screenshots/${name}.png` : undefined,
    });
  }

  async wait(ms: number): Promise<void> {
    await this.getPage().waitForTimeout(ms);
  }

  async waitForNetworkIdle(timeout?: number): Promise<void> {
    await this.getPage().waitForLoadState("networkidle", { timeout: timeout || this.config.timeout });
  }

  // ===== SMART LOCATOR RESOLUTION =====
  // Tries smart locators in priority order before falling back to CSS
  private async resolveLocator(target: { selector: string; fallback_selectors?: FallbackSelectors }): Promise<Locator> {
    const page = this.getPage();
    const fb = target.fallback_selectors || {};

    // Strategy order: getByRole → getByLabel → getByPlaceholder → getByText → getByTestId → CSS
    const strategies: Array<{ name: string; build: () => Locator | null }> = [
      {
        name: "getByRole",
        build: () => {
          const role = fb.accessibility_role;
          const name = fb.aria_label || fb.text;
          if (role && role !== "generic" && name) return page.getByRole(role as Parameters<Page["getByRole"]>[0], { name });
          return null;
        },
      },
      {
        name: "getByLabel",
        build: () => (fb.label || fb.nearest_label) ? page.getByLabel(fb.label || fb.nearest_label || "") : null,
      },
      {
        name: "getByPlaceholder",
        build: () => fb.placeholder ? page.getByPlaceholder(fb.placeholder) : null,
      },
      {
        name: "getByText",
        build: () => fb.text ? page.getByText(fb.text) : null,
      },
      {
        name: "getByTestId",
        build: () => {
          if (!fb.data_testid) return null;
          const match = fb.data_testid.match(/data-testid="([^"]+)"/);
          return page.getByTestId(match ? match[1] : fb.data_testid);
        },
      },
      {
        name: "name_attr",
        build: () => fb.name ? page.locator(`[name="${fb.name}"]`) : null,
      },
      {
        name: "css_id",
        build: () => fb.css_id ? page.locator(fb.css_id) : null,
      },
      {
        name: "css_fallback",
        build: () => target.selector ? page.locator(target.selector) : null,
      },
    ];

    for (const strategy of strategies) {
      try {
        const locator = strategy.build();
        if (!locator) continue;

        // Quick check: is this element present?
        const count = await locator.count();
        if (count > 0) {
          this.log("debug", `Resolved via ${strategy.name}`, { target: target.selector });
          return locator;
        }
      } catch {
        continue;
      }
    }

    // Absolute fallback
    this.log("debug", "All smart locators failed, using raw selector", { selector: target.selector });
    return page.locator(target.selector);
  }

  // ===== AUTO-WAIT =====
  // Waits for element to be visible and stable before interaction
  private async autoWait(locator: Locator): Promise<void> {
    try {
      await locator.waitFor({ state: "visible", timeout: this.config.timeout });

      // Additional stability check — wait for no DOM mutations around this element
      await this.getPage().waitForTimeout(50); // Brief pause for animations
    } catch (error) {
      throw new Error(`Element not visible after ${this.config.timeout}ms: ${(error as Error).message}`);
    }
  }

  // ===== RETRY ENGINE =====
  // Wraps every action with configurable retry + backoff
  private async executeStep(action: string, target: string, fn: () => Promise<void>): Promise<void> {
    this.stepCounter++;
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts + 1; attempt++) {
      try {
        await fn();

        // Step passed
        const log: StepLog = {
          stepIndex: this.stepCounter,
          action,
          target,
          status: attempt > 1 ? "retried" : "passed",
          duration_ms: Date.now() - startTime,
          locatorStrategy: "smart",
          attempt,
          pageUrl: this.page?.url() || "",
          timestamp: new Date().toISOString(),
        };

        // Screenshot on every step (if configured)
        if (this.config.screenshotOnEveryStep && this.page) {
          log.screenshot = await this.page.screenshot({ type: "png" });
        }

        this.logs.push(log);
        this.log("info", `Step ${this.stepCounter}: ${action} → ${target} [${attempt > 1 ? `RETRIED x${attempt}` : "PASSED"}] (${log.duration_ms}ms)`);
        return;

      } catch (error) {
        lastError = error as Error;
        this.log("error", `Step ${this.stepCounter}: ${action} → ${target} FAILED (attempt ${attempt}/${this.config.retryAttempts + 1}): ${lastError.message}`);

        if (attempt <= this.config.retryAttempts) {
          // Wait before retry with exponential backoff
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          this.log("debug", `Retrying in ${delay}ms...`);
          await this.getPage().waitForTimeout(delay);
        }
      }
    }

    // All attempts failed
    const failLog: StepLog = {
      stepIndex: this.stepCounter,
      action,
      target,
      status: "failed",
      duration_ms: Date.now() - startTime,
      locatorStrategy: "smart",
      attempt: this.config.retryAttempts + 1,
      error: lastError?.message?.slice(0, 500),
      pageUrl: this.page?.url() || "",
      timestamp: new Date().toISOString(),
    };

    // Screenshot on failure
    if (this.config.screenshotOnFailure && this.page) {
      try {
        failLog.screenshot = await this.page.screenshot({ type: "png", fullPage: true });
      } catch {}
    }

    // Capture DOM context around the failed element
    if (this.page) {
      try {
        failLog.domContext = await this.page.evaluate(() => {
          return document.body.innerHTML.slice(0, 2000);
        });
      } catch {}
    }

    this.logs.push(failLog);
    throw lastError!;
  }

  // ===== STRUCTURED LOGGING =====
  private log(level: "debug" | "info" | "error", message: string, data?: Record<string, unknown>): void {
    const levels = { silent: 0, error: 1, info: 2, debug: 3 };
    const configLevel = levels[this.config.logLevel];
    const messageLevel = levels[level];

    if (messageLevel > configLevel) return;

    const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
    const prefix = `[Testara ${timestamp}]`;

    if (level === "error") {
      console.error(`${prefix} ${message}`, data || "");
    } else if (level === "info") {
      console.log(`${prefix} ${message}`, data || "");
    } else {
      console.debug(`${prefix} ${message}`, data || "");
    }
  }
}
