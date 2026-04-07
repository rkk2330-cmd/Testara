// ===========================================
// TESTARA — Keyword Library
// Reusable business-level actions built on SDK
// ===========================================
//
// Usage (in test):
//   await keywords.login("admin@test.com", "Pass@123");
//   await keywords.fillForm({ email: "user@test.com", name: "John" });
//   await keywords.addToCart("SKU-001", 2);
//   await keywords.verifyTableRow("Orders", 1, { status: "Completed" });
//
// Usage (in GUI):
//   Step 1: [Login] email={{username}} password={{password}}
//   Step 2: [Navigate To] /dashboard
//   Step 3: [Verify Text] "Welcome" on [heading]

import { Testara, type ElementSpec } from "./core";

// ===== KEYWORD DEFINITION =====
export interface KeywordDef {
  name: string;                                    // "Login", "Fill Form"
  description: string;                             // Human-readable for GUI
  category: "auth" | "navigation" | "form" | "table" | "assertion" | "data" | "custom";
  parameters: Array<{
    name: string;
    type: "string" | "number" | "boolean" | "element" | "object";
    required: boolean;
    description: string;
    default?: string;
  }>;
  execute: (sdk: Testara, params: Record<string, unknown>) => Promise<void>;
}

// ===== KEYWORD REGISTRY =====
class KeywordRegistry {
  private keywords: Map<string, KeywordDef> = new Map();

  register(keyword: KeywordDef): void {
    this.keywords.set(keyword.name.toLowerCase(), keyword);
  }

  get(name: string): KeywordDef | undefined {
    return this.keywords.get(name.toLowerCase());
  }

  getAll(): KeywordDef[] {
    return Array.from(this.keywords.values());
  }

  getByCategory(category: string): KeywordDef[] {
    return this.getAll().filter(k => k.category === category);
  }

  async execute(name: string, sdk: Testara, params: Record<string, unknown>): Promise<void> {
    const keyword = this.get(name);
    if (!keyword) throw new Error(`Unknown keyword: "${name}". Available: ${this.getAll().map(k => k.name).join(", ")}`);
    await keyword.execute(sdk, params);
  }

  // Export keyword catalog for GUI dropdown
  getCatalog(): Array<{ name: string; description: string; category: string; parameters: KeywordDef["parameters"] }> {
    return this.getAll().map(k => ({
      name: k.name,
      description: k.description,
      category: k.category,
      parameters: k.parameters,
    }));
  }
}

export const keywords = new KeywordRegistry();

// ===========================================
// PRE-BUILT KEYWORDS
// ===========================================

// ===== AUTH KEYWORDS =====
keywords.register({
  name: "Login",
  description: "Login with email/username and password",
  category: "auth",
  parameters: [
    { name: "email", type: "string", required: true, description: "Email or username" },
    { name: "password", type: "string", required: true, description: "Password" },
    { name: "submitButton", type: "string", required: false, description: "Submit button text", default: "Sign In" },
  ],
  execute: async (sdk, params) => {
    const email = params.email as string;
    const password = params.password as string;
    const submitText = (params.submitButton as string) || "Sign In";

    // Try multiple common login field patterns
    try {
      await sdk.type({ role: "textbox", name: "email" }, email);
    } catch {
      try { await sdk.type({ placeholder: "Email" }, email); } catch {
        try { await sdk.type({ placeholder: "Username" }, email); } catch {
          await sdk.type({ label: "Email" }, email);
        }
      }
    }

    try {
      await sdk.type({ role: "textbox", name: "password" }, password);
    } catch {
      try { await sdk.type({ placeholder: "Password" }, password); } catch {
        await sdk.type({ label: "Password" }, password);
      }
    }

    await sdk.click({ role: "button", name: submitText });
  },
});

keywords.register({
  name: "Logout",
  description: "Log out of the application",
  category: "auth",
  parameters: [],
  execute: async (sdk) => {
    try { await sdk.click({ text: "Logout" }); } catch {
      try { await sdk.click({ text: "Sign Out" }); } catch {
        try { await sdk.click({ text: "Log out" }); } catch {
          await sdk.click({ role: "button", name: "logout" });
        }
      }
    }
  },
});

// ===== NAVIGATION KEYWORDS =====
keywords.register({
  name: "Navigate To",
  description: "Navigate to a URL or path",
  category: "navigation",
  parameters: [
    { name: "url", type: "string", required: true, description: "Full URL or relative path" },
  ],
  execute: async (sdk, params) => {
    await sdk.navigate(params.url as string);
  },
});

keywords.register({
  name: "Wait For Page Load",
  description: "Wait for page to finish loading (network idle)",
  category: "navigation",
  parameters: [],
  execute: async (sdk) => {
    await sdk.waitForNetworkIdle();
  },
});

keywords.register({
  name: "Go Back",
  description: "Navigate browser back",
  category: "navigation",
  parameters: [],
  execute: async (sdk) => {
    const page = sdk.getPage() as import("playwright").Page;
    await page.goBack();
  },
});

// ===== FORM KEYWORDS =====
keywords.register({
  name: "Fill Form",
  description: "Fill multiple form fields at once",
  category: "form",
  parameters: [
    { name: "fields", type: "object", required: true, description: "Object mapping field labels/names to values" },
  ],
  execute: async (sdk, params) => {
    const fields = params.fields as Record<string, string>;
    for (const [fieldName, value] of Object.entries(fields)) {
      try {
        await sdk.type({ label: fieldName }, value);
      } catch {
        try { await sdk.type({ placeholder: fieldName }, value); } catch {
          try { await sdk.type({ name: fieldName }, value); } catch {
            await sdk.type({ text: fieldName }, value);
          }
        }
      }
    }
  },
});

keywords.register({
  name: "Select Dropdown",
  description: "Select a value from a dropdown",
  category: "form",
  parameters: [
    { name: "field", type: "string", required: true, description: "Dropdown label or name" },
    { name: "value", type: "string", required: true, description: "Option to select" },
  ],
  execute: async (sdk, params) => {
    await sdk.select({ label: params.field as string }, params.value as string);
  },
});

keywords.register({
  name: "Upload File",
  description: "Upload a file to a file input",
  category: "form",
  parameters: [
    { name: "field", type: "element", required: true, description: "File input element" },
    { name: "filePath", type: "string", required: true, description: "Path to the file" },
  ],
  execute: async (sdk, params) => {
    const page = sdk.getPage() as import("playwright").Page;
    const input = page.locator((params.field as ElementSpec).selector || "input[type='file']");
    await input.setInputFiles(params.filePath as string);
  },
});

keywords.register({
  name: "Check Checkbox",
  description: "Check or uncheck a checkbox",
  category: "form",
  parameters: [
    { name: "label", type: "string", required: true, description: "Checkbox label text" },
    { name: "checked", type: "boolean", required: false, description: "Check (true) or uncheck (false)", default: "true" },
  ],
  execute: async (sdk, params) => {
    const page = sdk.getPage() as import("playwright").Page;
    const checkbox = page.getByLabel(params.label as string);
    if (params.checked !== false) {
      await checkbox.check();
    } else {
      await checkbox.uncheck();
    }
  },
});

// ===== TABLE KEYWORDS =====
keywords.register({
  name: "Verify Table Row",
  description: "Verify a table row contains expected values",
  category: "table",
  parameters: [
    { name: "tableLabel", type: "string", required: false, description: "Table name/aria-label" },
    { name: "rowIndex", type: "number", required: true, description: "Row index (0-based)" },
    { name: "expectedValues", type: "object", required: true, description: "Column values to verify" },
  ],
  execute: async (sdk, params) => {
    const page = sdk.getPage() as import("playwright").Page;
    const row = page.locator("table tbody tr").nth(params.rowIndex as number);
    const cells = await row.locator("td").allTextContents();

    const expected = params.expectedValues as Record<string, string>;
    for (const [, value] of Object.entries(expected)) {
      const found = cells.some(cell => cell.includes(value));
      if (!found) {
        throw new Error(`Table row ${params.rowIndex} does not contain "${value}". Found: ${cells.join(", ")}`);
      }
    }
  },
});

keywords.register({
  name: "Verify Table Row Count",
  description: "Assert the number of rows in a table",
  category: "table",
  parameters: [
    { name: "expectedCount", type: "number", required: true, description: "Expected number of rows" },
  ],
  execute: async (sdk, params) => {
    const page = sdk.getPage() as import("playwright").Page;
    const rows = await page.locator("table tbody tr").count();
    if (rows !== params.expectedCount) {
      throw new Error(`Expected ${params.expectedCount} table rows, found ${rows}`);
    }
  },
});

// ===== ASSERTION KEYWORDS =====
keywords.register({
  name: "Verify Text",
  description: "Verify an element contains expected text",
  category: "assertion",
  parameters: [
    { name: "text", type: "string", required: true, description: "Expected text" },
    { name: "element", type: "element", required: false, description: "Target element (optional, searches full page)" },
  ],
  execute: async (sdk, params) => {
    if (params.element) {
      await sdk.assertText(params.element as ElementSpec, params.text as string);
    } else {
      const page = sdk.getPage() as import("playwright").Page;
      const body = await page.textContent("body");
      if (!body?.includes(params.text as string)) {
        throw new Error(`Page does not contain text: "${params.text}"`);
      }
    }
  },
});

keywords.register({
  name: "Verify Element Visible",
  description: "Verify an element is visible on the page",
  category: "assertion",
  parameters: [
    { name: "element", type: "element", required: true, description: "Target element" },
  ],
  execute: async (sdk, params) => {
    await sdk.assertVisible(params.element as ElementSpec);
  },
});

keywords.register({
  name: "Verify URL",
  description: "Verify the current URL contains a pattern",
  category: "assertion",
  parameters: [
    { name: "pattern", type: "string", required: true, description: "URL pattern to match" },
  ],
  execute: async (sdk, params) => {
    await sdk.assertUrl(params.pattern as string);
  },
});

keywords.register({
  name: "Take Screenshot",
  description: "Capture a screenshot of the current page",
  category: "assertion",
  parameters: [
    { name: "name", type: "string", required: false, description: "Screenshot file name" },
  ],
  execute: async (sdk, params) => {
    await sdk.screenshot(params.name as string);
  },
});

// ===== DATA KEYWORDS =====
keywords.register({
  name: "Wait",
  description: "Wait for a specified duration",
  category: "data",
  parameters: [
    { name: "milliseconds", type: "number", required: true, description: "Wait time in ms" },
  ],
  execute: async (sdk, params) => {
    await sdk.wait(params.milliseconds as number);
  },
});

keywords.register({
  name: "Set Variable",
  description: "Store a value for use in later steps",
  category: "data",
  parameters: [
    { name: "name", type: "string", required: true, description: "Variable name" },
    { name: "value", type: "string", required: true, description: "Variable value" },
  ],
  execute: async (sdk, params) => {
    sdk.setVariables({ [params.name as string]: params.value as string });
  },
});

// ===== KEYWORD CATALOG API =====
// Returns all keywords for the GUI editor's keyword picker
export function getKeywordCatalog(): ReturnType<KeywordRegistry["getCatalog"]> {
  return keywords.getCatalog();
}

// Execute a keyword by name
export async function executeKeyword(
  name: string,
  sdk: Testara,
  params: Record<string, unknown>
): Promise<void> {
  return keywords.execute(name, sdk, params);
}

// Register a custom keyword
export function registerKeyword(keyword: KeywordDef): void {
  keywords.register(keyword);
}
