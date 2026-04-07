// ===========================================
// TESTARA — Plugin Execution Engine
// Core engine delegates to plugins for:
// - Custom action types (email, DB, gRPC, etc.)
// - Custom locator strategies
// - Custom assertions
// - Custom data generators
// - Lifecycle hooks (before/after test, on failure)
// ===========================================

import type { Page } from "playwright";
import { logger } from "@/lib/core/logger";

// ===== PLUGIN INTERFACE =====
export interface TestPlugin {
  name: string;
  version: string;
  description?: string;
  author?: string;

  // Custom action handlers — extend the switch(action_type) in the runner
  actions?: Record<string, ActionHandler>;

  // Custom locator strategies — tried before CSS fallback
  locators?: Record<string, LocatorStrategy>;

  // Custom assertion types — extend assert_* capability
  assertions?: Record<string, AssertionHandler>;

  // Custom data generators — for AI data generation
  dataGenerators?: Record<string, DataGenerator>;

  // Custom reporters — produce output after test run
  reporters?: Record<string, ReportGenerator>;

  // Lifecycle hooks
  onLoad?: (engine: PluginEngine) => void | Promise<void>;
  onUnload?: (engine: PluginEngine) => void | Promise<void>;
  beforeTest?: (context: PluginContext) => void | Promise<void>;
  afterTest?: (context: PluginContext, passed: boolean) => void | Promise<void>;
  beforeStep?: (context: PluginContext, step: PluginStep) => void | Promise<void>;
  afterStep?: (context: PluginContext, step: PluginStep, passed: boolean) => void | Promise<void>;
  onFailure?: (context: PluginContext, step: PluginStep, error: Error) => void | Promise<void>;
  onHeal?: (context: PluginContext, oldSelector: string, newSelector: string) => void | Promise<void>;
}

// ===== HANDLER TYPES =====
export interface PluginContext {
  page: Page;
  variables: Record<string, string>;
  setVariable: (name: string, value: string) => void;
  screenshot: () => Promise<Buffer>;
  log: (message: string) => void;
  orgId: string;
  userId: string;
  testId: string;
  runId: string;
}

export interface PluginStep {
  action_type: string;
  target: {
    selector: string;
    fallback_selectors: Record<string, string | null>;
    description: string;
  };
  input_data: string | null;
  expected_result: string | null;
  order_index: number;
}

export type ActionHandler = (step: PluginStep, context: PluginContext) => Promise<void>;
export type LocatorStrategy = (target: PluginStep["target"], page: Page) => Promise<string | null>;
export type AssertionHandler = (step: PluginStep, context: PluginContext) => Promise<{ passed: boolean; message: string }>;
export type DataGenerator = (config: Record<string, unknown>) => Promise<Record<string, string>[]>;
export type ReportGenerator = (results: Record<string, unknown>[]) => Promise<string | Buffer>;

// ===== PLUGIN ENGINE =====
export class PluginEngine {
  private plugins: Map<string, TestPlugin> = new Map();
  private actions: Map<string, { handler: ActionHandler; pluginName: string }> = new Map();
  private locators: Map<string, { handler: LocatorStrategy; pluginName: string }> = new Map();
  private assertions: Map<string, { handler: AssertionHandler; pluginName: string }> = new Map();
  private dataGens: Map<string, { handler: DataGenerator; pluginName: string }> = new Map();
  private reporters: Map<string, { handler: ReportGenerator; pluginName: string }> = new Map();

  // ===== REGISTER PLUGIN =====
  async register(plugin: TestPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      logger.warn("plugin.already_registered", { name: plugin.name });
      return;
    }

    // Register action handlers
    if (plugin.actions) {
      for (const [actionType, handler] of Object.entries(plugin.actions)) {
        if (this.actions.has(actionType)) {
          logger.warn("plugin.action_conflict", { actionType, existingPlugin: this.actions.get(actionType)!.pluginName, newPlugin: plugin.name });
        }
        this.actions.set(actionType, { handler, pluginName: plugin.name });
      }
    }

    // Register locator strategies
    if (plugin.locators) {
      for (const [name, handler] of Object.entries(plugin.locators)) {
        this.locators.set(name, { handler, pluginName: plugin.name });
      }
    }

    // Register assertion handlers
    if (plugin.assertions) {
      for (const [name, handler] of Object.entries(plugin.assertions)) {
        this.assertions.set(name, { handler, pluginName: plugin.name });
      }
    }

    // Register data generators
    if (plugin.dataGenerators) {
      for (const [name, handler] of Object.entries(plugin.dataGenerators)) {
        this.dataGens.set(name, { handler, pluginName: plugin.name });
      }
    }

    // Register reporters
    if (plugin.reporters) {
      for (const [name, handler] of Object.entries(plugin.reporters)) {
        this.reporters.set(name, { handler, pluginName: plugin.name });
      }
    }

    this.plugins.set(plugin.name, plugin);

    // Call onLoad lifecycle
    if (plugin.onLoad) await plugin.onLoad(this);

    logger.info("plugin.registered", {
      name: plugin.name,
      version: plugin.version,
      actions: Object.keys(plugin.actions || {}).length,
      locators: Object.keys(plugin.locators || {}).length,
      assertions: Object.keys(plugin.assertions || {}).length,
    });
  }

  // ===== UNREGISTER PLUGIN =====
  async unregister(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return;

    // Remove all registrations for this plugin
    for (const [key, val] of this.actions) if (val.pluginName === pluginName) this.actions.delete(key);
    for (const [key, val] of this.locators) if (val.pluginName === pluginName) this.locators.delete(key);
    for (const [key, val] of this.assertions) if (val.pluginName === pluginName) this.assertions.delete(key);
    for (const [key, val] of this.dataGens) if (val.pluginName === pluginName) this.dataGens.delete(key);
    for (const [key, val] of this.reporters) if (val.pluginName === pluginName) this.reporters.delete(key);

    if (plugin.onUnload) await plugin.onUnload(this);
    this.plugins.delete(pluginName);
    logger.info("plugin.unregistered", { name: pluginName });
  }

  // ===== EXECUTE ACTION =====
  // Called by the runner — checks plugin registry before built-in actions
  canHandleAction(actionType: string): boolean {
    return this.actions.has(actionType);
  }

  async executeAction(actionType: string, step: PluginStep, context: PluginContext): Promise<void> {
    const entry = this.actions.get(actionType);
    if (!entry) throw new Error(`No plugin handler for action: ${actionType}`);

    logger.debug("plugin.action_execute", { actionType, plugin: entry.pluginName });
    await entry.handler(step, context);
  }

  // ===== TRY CUSTOM LOCATORS =====
  async tryCustomLocators(target: PluginStep["target"], page: Page): Promise<string | null> {
    for (const [name, entry] of this.locators) {
      try {
        const result = await entry.handler(target, page);
        if (result) {
          logger.debug("plugin.locator_hit", { strategy: name, plugin: entry.pluginName });
          return result;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  // ===== EXECUTE ASSERTION =====
  canHandleAssertion(assertionType: string): boolean {
    return this.assertions.has(assertionType);
  }

  async executeAssertion(assertionType: string, step: PluginStep, context: PluginContext): Promise<{ passed: boolean; message: string }> {
    const entry = this.assertions.get(assertionType);
    if (!entry) return { passed: false, message: `No handler for assertion: ${assertionType}` };
    return entry.handler(step, context);
  }

  // ===== LIFECYCLE HOOKS =====
  async fireBeforeTest(context: PluginContext): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.beforeTest) await plugin.beforeTest(context);
    }
  }

  async fireAfterTest(context: PluginContext, passed: boolean): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.afterTest) await plugin.afterTest(context, passed);
    }
  }

  async fireBeforeStep(context: PluginContext, step: PluginStep): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.beforeStep) await plugin.beforeStep(context, step);
    }
  }

  async fireAfterStep(context: PluginContext, step: PluginStep, passed: boolean): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.afterStep) await plugin.afterStep(context, step, passed);
    }
  }

  async fireOnFailure(context: PluginContext, step: PluginStep, error: Error): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onFailure) await plugin.onFailure(context, step, error);
    }
  }

  // ===== INFO =====
  getRegisteredPlugins(): Array<{ name: string; version: string; actions: string[]; locators: string[] }> {
    return Array.from(this.plugins.values()).map(p => ({
      name: p.name,
      version: p.version,
      actions: Object.keys(p.actions || {}),
      locators: Object.keys(p.locators || {}),
    }));
  }

  getRegisteredActions(): string[] {
    return Array.from(this.actions.keys());
  }
}

// ===== SINGLETON =====
export const pluginEngine = new PluginEngine();
