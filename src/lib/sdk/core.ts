// ===========================================
// TESTARA SDK — Core Developer API
// ===========================================
//
// Usage:
//   import { Testara } from "@testara/sdk";
//   const testara = new Testara({ browser: "chromium" });
//   await testara.launch();
//   await testara.navigate("https://example.com");
//   await testara.click({ text: "Sign In" });
//   await testara.type({ placeholder: "Email" }, "user@test.com");
//   await testara.assertText({ role: "heading" }, "Dashboard");
//   const report = await testara.close();

import { TestDriver, type DriverConfig, type StepLog } from "@/lib/execution/driver";
import { resolveVariables, type VariableContext } from "@/lib/data/engine";
import type { FallbackSelectors } from "@/types";

// ===== SDK TARGET: Simplified element specifier =====
// Developers don't write CSS selectors. They describe elements.
export interface ElementSpec {
  role?: string;              // "button", "textbox", "link", "heading"
  name?: string;              // Accessible name: "Sign In", "Email"
  text?: string;              // Visible text content
  placeholder?: string;       // Input placeholder
  label?: string;             // Associated label text
  testId?: string;            // data-testid value
  selector?: string;          // CSS/XPath fallback (discouraged)
}

// Convert developer-friendly ElementSpec → internal FallbackSelectors
function specToTarget(spec: ElementSpec | string): { selector: string; fallback_selectors: FallbackSelectors; description: string } {
  if (typeof spec === "string") {
    return { selector: spec, fallback_selectors: {}, description: spec };
  }

  const fb: FallbackSelectors = {};
  if (spec.role) fb.accessibility_role = spec.role;
  if (spec.name) fb.aria_label = spec.name;
  if (spec.text) fb.text = spec.text;
  if (spec.placeholder) fb.placeholder = spec.placeholder;
  if (spec.label) fb.label = spec.label;
  if (spec.testId) fb.data_testid = spec.testId;

  const selector = spec.selector || spec.testId || spec.name || spec.text || spec.placeholder || spec.label || "";
  const description = spec.name || spec.text || spec.placeholder || spec.label || spec.role || selector;

  return { selector, fallback_selectors: fb, description };
}

// ===== LIFECYCLE HOOKS =====
export type HookFn = (context: { step?: string; error?: Error; driver: Testara }) => Promise<void> | void;

export interface TestHooks {
  beforeAll?: HookFn;
  afterAll?: HookFn;
  beforeEach?: HookFn;       // Before each step
  afterEach?: HookFn;        // After each step
  onFailure?: HookFn;        // When a step fails
  onHeal?: HookFn;           // When self-healing activates
}

// ===== PLUGIN SYSTEM =====
export interface TestPlugin {
  name: string;
  version: string;
  setup?: (sdk: Testara) => void;
  teardown?: (sdk: Testara) => void;
  // Plugins can register custom keywords
  keywords?: Record<string, (...args: unknown[]) => Promise<void>>;
}

// ===== EVENT EMITTER =====
type EventName = "step:start" | "step:pass" | "step:fail" | "step:retry" | "test:start" | "test:end" | "heal" | "screenshot";
type EventCallback = (data: Record<string, unknown>) => void;

// ===== MAIN SDK CLASS =====
export class Testara {
  private driver: TestDriver;
  private hooks: TestHooks = {};
  private plugins: TestPlugin[] = [];
  private events: Map<EventName, EventCallback[]> = new Map();
  private variables: Record<string, string> = {};
  private customKeywords: Map<string, (...args: unknown[]) => Promise<void>> = new Map();

  constructor(config: Partial<DriverConfig> = {}) {
    this.driver = new TestDriver({
      headless: true,
      retryAttempts: 2,
      screenshotOnFailure: true,
      logLevel: "info",
      ...config,
    });
  }

  // ===== LIFECYCLE =====
  async launch(): Promise<void> {
    await this.driver.launch();
    this.emit("test:start", {});
    if (this.hooks.beforeAll) await this.hooks.beforeAll({ driver: this });
  }

  async close(): Promise<{ logs: StepLog[]; passed: boolean; duration_ms: number }> {
    if (this.hooks.afterAll) await this.hooks.afterAll({ driver: this });
    const result = await this.driver.close();
    const duration = result.logs.reduce((sum, l) => sum + l.duration_ms, 0);
    this.emit("test:end", { passed: !result.hasFailures, duration_ms: duration });
    return { logs: result.logs, passed: !result.hasFailures, duration_ms: duration };
  }

  // ===== CONFIGURATION =====
  use(plugin: TestPlugin): Testara {
    this.plugins.push(plugin);
    if (plugin.setup) plugin.setup(this);
    if (plugin.keywords) {
      for (const [name, fn] of Object.entries(plugin.keywords)) {
        this.customKeywords.set(name, fn);
      }
    }
    return this;
  }

  setHooks(hooks: TestHooks): Testara {
    this.hooks = { ...this.hooks, ...hooks };
    return this;
  }

  on(event: EventName, callback: EventCallback): Testara {
    if (!this.events.has(event)) this.events.set(event, []);
    this.events.get(event)!.push(callback);
    return this;
  }

  setVariables(vars: Record<string, string>): Testara {
    this.variables = { ...this.variables, ...vars };
    return this;
  }

  // ===== NAVIGATION =====
  async navigate(url: string): Promise<void> {
    const resolved = this.resolveVars(url);
    await this.withHooks("navigate: " + resolved, () => this.driver.navigate(resolved));
  }

  async waitForNetworkIdle(): Promise<void> {
    await this.driver.waitForNetworkIdle();
  }

  // ===== ELEMENT INTERACTION =====
  async click(spec: ElementSpec | string): Promise<void> {
    const target = specToTarget(spec);
    await this.withHooks("click: " + target.description, () => this.driver.click(target));
  }

  async type(spec: ElementSpec | string, value: string): Promise<void> {
    const target = specToTarget(spec);
    const resolved = this.resolveVars(value);
    await this.withHooks("type: " + target.description, () => this.driver.fill(target, resolved));
  }

  async select(spec: ElementSpec | string, value: string): Promise<void> {
    const target = specToTarget(spec);
    await this.withHooks("select: " + target.description, () => this.driver.selectOption(target, value));
  }

  async hover(spec: ElementSpec | string): Promise<void> {
    const target = specToTarget(spec);
    await this.withHooks("hover: " + target.description, () => this.driver.hover(target));
  }

  async scrollTo(spec: ElementSpec | string): Promise<void> {
    const target = specToTarget(spec);
    await this.withHooks("scroll: " + target.description, () => this.driver.scrollTo(target));
  }

  // ===== ASSERTIONS =====
  async assertText(spec: ElementSpec | string, expected: string): Promise<void> {
    const target = specToTarget(spec);
    await this.withHooks("assertText: " + expected, () => this.driver.assertText(target, expected));
  }

  async assertVisible(spec: ElementSpec | string): Promise<void> {
    const target = specToTarget(spec);
    await this.withHooks("assertVisible: " + target.description, () => this.driver.assertVisible(target));
  }

  async assertUrl(pattern: string): Promise<void> {
    await this.withHooks("assertUrl: " + pattern, () => this.driver.assertUrl(pattern));
  }

  async assertValue(spec: ElementSpec | string, expected: string): Promise<void> {
    const target = specToTarget(spec);
    await this.withHooks("assertValue: " + expected, () => this.driver.assertValue(target, expected));
  }

  // ===== UTILITIES =====
  async screenshot(name?: string): Promise<Buffer> {
    return this.driver.screenshot(name);
  }

  async wait(ms: number): Promise<void> {
    await this.driver.wait(ms);
  }

  // Execute a custom keyword by name
  async keyword(name: string, ...args: unknown[]): Promise<void> {
    const fn = this.customKeywords.get(name);
    if (!fn) throw new Error(`Unknown keyword: "${name}". Register it via plugin or registerKeyword().`);
    await this.withHooks(`keyword: ${name}`, () => fn(...args));
  }

  // Register a custom keyword
  registerKeyword(name: string, fn: (...args: unknown[]) => Promise<void>): void {
    this.customKeywords.set(name, fn);
  }

  // Get raw Playwright page for advanced usage
  getPage(): unknown {
    return this.driver.getPage();
  }

  // ===== INTERNAL =====
  private resolveVars(text: string): string {
    if (!text.includes("{{")) return text;
    const varContext: VariableContext = { environment: this.variables };
    return resolveVariables(text, varContext) || text;
  }

  private async withHooks(step: string, fn: () => Promise<void>): Promise<void> {
    this.emit("step:start", { step });
    if (this.hooks.beforeEach) await this.hooks.beforeEach({ step, driver: this });

    try {
      await fn();
      this.emit("step:pass", { step });
    } catch (error) {
      this.emit("step:fail", { step, error });
      if (this.hooks.onFailure) await this.hooks.onFailure({ step, error: error as Error, driver: this });
      throw error;
    } finally {
      if (this.hooks.afterEach) await this.hooks.afterEach({ step, driver: this });
    }
  }

  private emit(event: EventName, data: Record<string, unknown>): void {
    const callbacks = this.events.get(event) || [];
    for (const cb of callbacks) {
      try { cb(data); } catch {}
    }
  }
}
