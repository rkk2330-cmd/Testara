// ===========================================
// TESTARA — Smart Locator Builder
// Converts element data into Playwright's
// recommended user-facing locators
// ===========================================
//
// Playwright's locator priority (official docs):
// 1. getByRole()        — BEST. ARIA role + accessible name
// 2. getByLabel()       — Form fields by label association
// 3. getByPlaceholder() — Inputs by placeholder text
// 4. getByText()        — Any element by visible text
// 5. getByAltText()     — Images by alt attribute
// 6. getByTitle()       — Elements by title attribute
// 7. getByTestId()      — By data-testid (developer-placed)
// 8. page.locator()     — LAST RESORT. CSS/XPath (fragile)

export interface ElementData {
  selector?: string;        // Raw CSS selector (fallback)
  fallback_selectors?: Record<string, string>;
  description?: string;
  tag_name?: string;
}

export interface SmartLocator {
  code: string;             // e.g. "page.getByRole('button', { name: 'Sign In' })"
  strategy: string;         // e.g. "getByRole"
  confidence: number;       // 0-100
  human_readable: string;   // e.g. "button named 'Sign In'"
}

// ===== BUILD SMART LOCATOR FROM ELEMENT DATA =====
export function buildSmartLocator(
  element: ElementData,
  pageVar: string = "page"
): SmartLocator {
  const fallbacks = element.fallback_selectors || {};
  const selector = element.selector || "";
  const tag = element.tag_name?.toLowerCase() || "";

  // Strategy 1: getByRole — best for buttons, links, headings, form elements
  const role = fallbacks.accessibility_role || inferRole(tag, selector);
  const ariaLabel = fallbacks.aria_label;
  const text = fallbacks.text;

  if (role && role !== "generic" && (ariaLabel || text)) {
    const name = ariaLabel || text;
    const exactMatch = name && name.length < 30;
    return {
      code: `${pageVar}.getByRole('${role}', { name: '${esc(name || "")}' ${exactMatch ? "" : ", exact: false"} })`,
      strategy: "getByRole",
      confidence: 95,
      human_readable: `${role} named '${name}'`,
    };
  }

  // Strategy 2: getByLabel — form inputs with associated labels
  const label = fallbacks.label || fallbacks.nearest_label;
  if (label && ["input", "select", "textarea"].includes(tag)) {
    return {
      code: `${pageVar}.getByLabel('${esc(label)}')`,
      strategy: "getByLabel",
      confidence: 92,
      human_readable: `field labeled '${label}'`,
    };
  }

  // Strategy 3: getByPlaceholder — input fields with placeholder
  const placeholder = fallbacks.placeholder;
  if (placeholder) {
    return {
      code: `${pageVar}.getByPlaceholder('${esc(placeholder)}')`,
      strategy: "getByPlaceholder",
      confidence: 88,
      human_readable: `input with placeholder '${placeholder}'`,
    };
  }

  // Strategy 4: getByText — elements with visible text
  if (text && ["button", "a", "span", "label", "h1", "h2", "h3", "h4", "li", "p", "td"].includes(tag)) {
    return {
      code: `${pageVar}.getByText('${esc(text)}')`,
      strategy: "getByText",
      confidence: 80,
      human_readable: `element with text '${text}'`,
    };
  }

  // Strategy 5: getByTestId — developer-placed data-testid
  const testId = fallbacks.data_testid;
  if (testId) {
    // Extract value from [data-testid="xxx"]
    const match = testId.match(/data-testid="([^"]+)"/);
    const id = match ? match[1] : testId;
    return {
      code: `${pageVar}.getByTestId('${esc(id)}')`,
      strategy: "getByTestId",
      confidence: 85,
      human_readable: `test id '${id}'`,
    };
  }

  // Strategy 6: getByRole without name (less specific but still semantic)
  if (role && role !== "generic") {
    return {
      code: `${pageVar}.getByRole('${role}')`,
      strategy: "getByRole",
      confidence: 60,
      human_readable: `${role} element`,
    };
  }

  // Strategy 7: name attribute — form elements
  const nameAttr = fallbacks.name;
  if (nameAttr) {
    return {
      code: `${pageVar}.locator('[name="${esc(nameAttr)}"]')`,
      strategy: "name_attribute",
      confidence: 75,
      human_readable: `element named '${nameAttr}'`,
    };
  }

  // Strategy 8: CSS ID — still better than class/xpath
  const cssId = fallbacks.css_id;
  if (cssId) {
    return {
      code: `${pageVar}.locator('${esc(cssId)}')`,
      strategy: "css_id",
      confidence: 70,
      human_readable: `element with id '${cssId.replace("#", "")}'`,
    };
  }

  // LAST RESORT: raw selector (fragile)
  return {
    code: `${pageVar}.locator('${esc(selector)}')`,
    strategy: "css_fallback",
    confidence: 40,
    human_readable: `element matching '${selector}'`,
  };
}

// ===== BUILD SMART LOCATOR FOR EXECUTION =====
// Returns a Playwright Locator object, trying smart strategies first
export async function resolveSmartLocator(
  page: Record<string, unknown>,
  element: ElementData,
  timeoutMs: number = 10000
): Promise<{ locator: Record<string, unknown>; strategy: string; confidence: number }> {
  const fallbacks = element.fallback_selectors || {};
  const selector = element.selector || "";
  const tag = element.tag_name?.toLowerCase() || "";

  // Ordered strategies to try
  const strategies: Array<{
    name: string;
    build: () => any | null;
    confidence: number;
  }> = [
    // 1. getByRole with name
    {
      name: "getByRole",
      confidence: 95,
      build: () => {
        const role = fallbacks.accessibility_role || inferRole(tag, selector);
        const name = fallbacks.aria_label || fallbacks.text;
        if (role && role !== "generic" && name) {
          return page.getByRole(role, { name });
        }
        return null;
      },
    },
    // 2. getByLabel
    {
      name: "getByLabel",
      confidence: 92,
      build: () => {
        const label = fallbacks.label || fallbacks.nearest_label;
        if (label) return page.getByLabel(label);
        return null;
      },
    },
    // 3. getByPlaceholder
    {
      name: "getByPlaceholder",
      confidence: 88,
      build: () => {
        const ph = fallbacks.placeholder;
        if (ph) return page.getByPlaceholder(ph);
        return null;
      },
    },
    // 4. getByText
    {
      name: "getByText",
      confidence: 80,
      build: () => {
        const text = fallbacks.text;
        if (text) return page.getByText(text);
        return null;
      },
    },
    // 5. getByTestId
    {
      name: "getByTestId",
      confidence: 85,
      build: () => {
        const testId = fallbacks.data_testid;
        if (testId) {
          const match = testId.match(/data-testid="([^"]+)"/);
          return page.getByTestId(match ? match[1] : testId);
        }
        return null;
      },
    },
    // 6. name attribute
    {
      name: "name_attr",
      confidence: 75,
      build: () => {
        const name = fallbacks.name;
        if (name) return page.locator(`[name="${name}"]`);
        return null;
      },
    },
    // 7. CSS ID
    {
      name: "css_id",
      confidence: 70,
      build: () => {
        const id = fallbacks.css_id;
        if (id) return page.locator(id);
        return null;
      },
    },
    // 8. aria-label direct
    {
      name: "aria_label",
      confidence: 85,
      build: () => {
        const aria = fallbacks.aria_label;
        if (aria) return page.locator(`[aria-label="${aria}"]`);
        return null;
      },
    },
    // 9. Raw selector (last resort)
    {
      name: "css_fallback",
      confidence: 40,
      build: () => {
        if (selector) return page.locator(selector);
        return null;
      },
    },
    // 10. XPath (absolute last resort)
    {
      name: "xpath_fallback",
      confidence: 30,
      build: () => {
        const xpath = fallbacks.xpath;
        if (xpath) return page.locator(`xpath=${xpath}`);
        return null;
      },
    },
  ];

  for (const strategy of strategies) {
    try {
      const locator = strategy.build();
      if (!locator) continue;

      // Quick visibility check
      await locator.waitFor({ state: "visible", timeout: Math.min(timeoutMs / strategies.length, 3000) });
      return { locator, strategy: strategy.name, confidence: strategy.confidence };
    } catch {
      continue;
    }
  }

  throw new Error(
    `Element not found with any smart locator strategy. ` +
    `Tried: ${strategies.filter(s => s.build() !== null).map(s => s.name).join(", ")}. ` +
    `Description: ${element.description || selector}`
  );
}

// ===== BUILD EXPORT CODE =====
// Generates the code string for POM export
export function buildExportLocator(
  element: ElementData,
  pageVar: string = "page"
): string {
  return buildSmartLocator(element, pageVar).code;
}

// Infer ARIA role from HTML tag
function inferRole(tag: string, selector: string): string {
  const roleMap: Record<string, string> = {
    button: "button",
    a: "link",
    input: selector.includes("checkbox") ? "checkbox" :
           selector.includes("radio") ? "radio" :
           selector.includes("submit") ? "button" : "textbox",
    select: "combobox",
    textarea: "textbox",
    img: "img",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    table: "table",
    form: "form",
    h1: "heading", h2: "heading", h3: "heading", h4: "heading",
    dialog: "dialog",
    ul: "list",
    li: "listitem",
  };
  return roleMap[tag] || "generic";
}

function esc(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}
