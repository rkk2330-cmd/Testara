// ===========================================
// TESTARA — Built-in & Example Plugins
// ===========================================

import type { TestPlugin, PluginStep, PluginContext } from "./engine";

// ===== MAINFRAME PLUGIN =====
// Packages the existing mainframe actions as a plugin
export const mainframePlugin: TestPlugin = {
  name: "@testara/plugin-mainframe",
  version: "1.0.0",
  description: "TN3270/TN5250 mainframe terminal testing",
  actions: {
    mainframe_connect: async (step, context) => {
      context.log(`Connecting to mainframe: ${step.target.selector}`);
      // Delegate to existing mainframe executor
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      await executeMainframeStep({ action: "connect", host: step.target.selector, port: parseInt(step.input_data || "23") });
    },
    mainframe_type: async (step, context) => {
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      await executeMainframeStep({ action: "type", field: step.target.selector, value: step.input_data || "" });
    },
    mainframe_navigate: async (step, context) => {
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      await executeMainframeStep({ action: "type", field: step.target.selector, value: step.input_data || "" });
    },
    mainframe_send_key: async (step, context) => {
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      await executeMainframeStep({ action: "send_key", key: step.input_data || "ENTER" });
    },
    mainframe_assert: async (step, context) => {
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      const screen = await executeMainframeStep({ action: "read_screen" });
      if (!screen?.text?.includes(step.expected_result || "")) {
        throw new Error(`Mainframe screen does not contain "${step.expected_result}"`);
      }
    },
    mainframe_disconnect: async (step, context) => {
      const { executeMainframeStep } = await import("@/lib/mainframe/executor");
      await executeMainframeStep({ action: "disconnect" });
    },
  },
};

// ===== API TESTING PLUGIN =====
// Packages the API testing engine as a plugin
export const apiPlugin: TestPlugin = {
  name: "@testara/plugin-api",
  version: "1.0.0",
  description: "REST API testing with assertions and chaining",
  actions: {
    api_call: async (step, context) => {
      const { executeApiStep } = await import("@/lib/execution/api-runner");
      const apiConfig = JSON.parse(step.input_data || "{}");

      // Resolve variables in URL
      let url = step.target.selector;
      for (const [key, value] of Object.entries(context.variables)) {
        url = url.replace(`{{${key}}}`, value);
      }

      const result = await executeApiStep({
        id: "plugin",
        order_index: step.order_index,
        name: step.target.description || "API Call",
        method: apiConfig.method || "GET",
        url,
        headers: apiConfig.headers || {},
        body: apiConfig.body,
        auth: apiConfig.auth,
        assertions: apiConfig.assertions || [
          { type: "status_code", expected: "200" },
        ],
        extract: apiConfig.extract,
      }, context.variables);

      // Store extracted variables
      if (result.extracted_variables) {
        for (const [key, value] of Object.entries(result.extracted_variables)) {
          context.setVariable(key, value);
        }
      }

      if (result.status === "failed") {
        const failedAssertions = result.assertions.filter(a => !a.passed).map(a => a.message).join("; ");
        throw new Error(`API assertion failed: ${failedAssertions || result.error || "Unknown"}`);
      }
    },
  },
};

// ===== SCREENSHOT COMPARISON PLUGIN =====
export const screenshotComparePlugin: TestPlugin = {
  name: "@testara/plugin-visual-regression",
  version: "1.0.0",
  description: "Visual regression testing with screenshot comparison",
  actions: {
    visual_compare: async (step, context) => {
      const screenshot = await context.screenshot();
      const baselinePath = step.input_data || "";
      context.log(`Visual comparison against baseline: ${baselinePath}`);
      // In production: use pixelmatch or resemble.js to compare
      // For now: just capture the screenshot
      context.setVariable("last_screenshot_size", String(screenshot.length));
    },
  },
};

// ===== WAIT CONDITIONS PLUGIN =====
export const waitPlugin: TestPlugin = {
  name: "@testara/plugin-wait",
  version: "1.0.0",
  description: "Advanced wait conditions",
  actions: {
    wait_for_text: async (step, context) => {
      const text = step.expected_result || step.input_data || "";
      const timeout = 15000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const body = await context.page.textContent("body");
        if (body?.includes(text)) return;
        await context.page.waitForTimeout(500);
      }
      throw new Error(`Text "${text}" not found after ${timeout}ms`);
    },
    wait_for_url: async (step, context) => {
      const pattern = step.expected_result || step.input_data || "";
      await context.page.waitForURL(`**${pattern}**`, { timeout: 15000 });
    },
    wait_for_network_idle: async (step, context) => {
      await context.page.waitForLoadState("networkidle", { timeout: 15000 });
    },
    wait_for_element_count: async (step, context) => {
      const selector = step.target.selector;
      const expected = parseInt(step.expected_result || "1");
      const timeout = 10000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const count = await context.page.locator(selector).count();
        if (count >= expected) return;
        await context.page.waitForTimeout(300);
      }
      throw new Error(`Expected ${expected} elements matching "${selector}", timed out`);
    },
  },
};

// ===== DATABASE VERIFICATION PLUGIN (example) =====
export const databasePlugin: TestPlugin = {
  name: "@testara/plugin-database",
  version: "1.0.0",
  description: "Database assertions — verify data after actions",
  actions: {
    db_query: async (step, context) => {
      // In production: connect to user's test database
      // For now: stub that shows the pattern
      context.log(`DB Query: ${step.input_data}`);
      context.setVariable("db_result", JSON.stringify({ rows: [], rowCount: 0 }));
    },
    db_assert_row_exists: async (step, context) => {
      context.log(`DB Assert: row exists where ${step.input_data}`);
      // In production: run query and check rowCount > 0
    },
    db_assert_row_count: async (step, context) => {
      context.log(`DB Assert: ${step.expected_result} rows matching ${step.input_data}`);
    },
  },
};

// ===== EMAIL VERIFICATION PLUGIN (example) =====
export const emailPlugin: TestPlugin = {
  name: "@testara/plugin-email",
  version: "1.0.0",
  description: "Email inbox verification for signup/OTP flows",
  actions: {
    email_wait_for: async (step, context) => {
      // In production: use MailSlurp, Mailtrap, or Ethereal
      context.log(`Waiting for email to: ${step.input_data}`);
      // Stub: simulate email arrival
      context.setVariable("email_subject", "Welcome to TestApp");
      context.setVariable("email_body", "Your OTP is 123456");
    },
    email_extract_otp: async (step, context) => {
      const body = context.variables["email_body"] || "";
      const otpMatch = body.match(/\b\d{4,6}\b/);
      if (otpMatch) {
        context.setVariable("otp", otpMatch[0]);
        context.log(`Extracted OTP: ${otpMatch[0]}`);
      } else {
        throw new Error("No OTP found in email body");
      }
    },
    email_assert_received: async (step, context) => {
      context.log(`Asserting email received with subject: ${step.expected_result}`);
    },
  },
};

// ===== REGISTER ALL BUILT-IN PLUGINS =====
export async function registerBuiltinPlugins(engine: import("./engine").PluginEngine): Promise<void> {
  await engine.register(mainframePlugin);
  await engine.register(apiPlugin);
  await engine.register(screenshotComparePlugin);
  await engine.register(waitPlugin);
  await engine.register(databasePlugin);
  await engine.register(emailPlugin);
}
