// ===========================================
// TESTARA — Element Identification Engine
// Multi-strategy fingerprinting, scoring,
// storage, and smart resolution
// ===========================================

// ===== ELEMENT FINGERPRINT =====
// This is what we capture for EVERY element we interact with.
// Not just one selector — a complete identity profile.

export interface ElementFingerprint {
  // === Primary Selectors (ranked by reliability) ===
  selectors: {
    data_testid: string | null;    // [data-testid="login-btn"] — MOST reliable, dev-placed
    aria_label: string | null;     // [aria-label="Sign In"] — accessible, semantic
    role_name: string | null;      // role=button[name="Sign In"] — Playwright-native
    css_id: string | null;         // #login-btn — fast but fragile
    css_class: string | null;      // .btn-primary.login — medium reliability
    css_path: string | null;       // body > div > form > button:nth-child(3) — full CSS path
    xpath_full: string | null;     // /html/body/div/form/button[3] — absolute XPath
    xpath_relative: string | null; // //button[contains(text(),'Sign In')] — relative XPath
    text_content: string | null;   // text="Sign In" — human-readable, locale-dependent
    link_text: string | null;      // a:has-text("Sign In") — for links specifically
    name_attr: string | null;      // [name="submit-login"] — form elements
    placeholder: string | null;    // [placeholder="Enter email"] — input fields
    title_attr: string | null;     // [title="Submit form"] — tooltips
    custom: string | null;         // User-defined selector override
  };

  // === Visual Properties (for position-based identification) ===
  visual: {
    bounding_box: { x: number; y: number; width: number; height: number } | null;
    relative_position: string | null;  // "below #email-input", "right of .label-password"
    screenshot_base64: string | null;  // Cropped screenshot of just this element
    parent_screenshot: string | null;  // Screenshot of parent container for context
    background_color: string | null;
    text_color: string | null;
    font_size: string | null;
    is_visible: boolean;
    z_index: number | null;
  };

  // === Structural Properties ===
  structure: {
    tag_name: string;              // "button", "input", "a", "div"
    element_type: string | null;   // input type: "text", "password", "submit", "checkbox"
    parent_tag: string | null;     // "form", "div", "nav"
    parent_id: string | null;      // Parent element's ID if available
    sibling_index: number;         // 0-based index among same-tag siblings
    depth: number;                 // DOM depth from body
    form_context: string | null;   // Which form does this belong to (form ID or form action)
    closest_heading: string | null; // Nearest h1-h6 text (gives semantic context)
    closest_label: string | null;  // Associated <label> text
  };

  // === Content Properties ===
  content: {
    inner_text: string | null;     // Visible text content
    value: string | null;          // Current input value
    alt_text: string | null;       // img alt text
    href: string | null;           // Link destination
    is_enabled: boolean;
    is_required: boolean;
    has_validation: boolean;       // Has pattern/min/max/required attributes
  };

  // === Metadata ===
  meta: {
    captured_at: string;           // ISO timestamp
    captured_from_url: string;     // Which URL this was captured on
    page_title: string;            // Document title at capture time
    confidence_scores: Record<string, number>;  // Per-selector confidence 0-100
    recommended_selector: string;  // The one we think is most reliable
    recommended_strategy: string;  // Which selector type to use first
  };
}

// ===== SELECTOR CONFIDENCE SCORING =====
// Each selector strategy has a base reliability score.
// We adjust based on specificity and uniqueness.

const BASE_SCORES: Record<string, number> = {
  data_testid: 98,     // Developer-placed, won't change accidentally
  aria_label: 90,      // Accessibility requirement, relatively stable
  role_name: 88,       // Semantic, Playwright-optimized
  name_attr: 85,       // Form-standard, stable for form elements
  css_id: 82,          // Fast but IDs change in frameworks (React, Angular)
  placeholder: 78,     // Stable for inputs, but locale-dependent
  text_content: 75,    // Human-readable but changes with copy updates
  link_text: 73,       // Good for links, but text changes
  xpath_relative: 70,  // Flexible but can be fragile
  css_class: 60,       // Classes change with CSS refactoring
  css_path: 40,        // Very fragile — any DOM restructuring breaks it
  xpath_full: 35,      // Most fragile — any DOM change breaks it
  title_attr: 65,      // Rarely used, but stable when present
  custom: 95,          // User explicitly chose this — trust it
};

export function scoreSelectors(
  fingerprint: ElementFingerprint
): Record<string, number> {
  const scores: Record<string, number> = {};

  for (const [strategy, selector] of Object.entries(fingerprint.selectors)) {
    if (!selector) continue;

    let score = BASE_SCORES[strategy] || 50;

    // Bonus: short selectors are more specific and reliable
    if (selector.length < 30) score += 3;
    if (selector.length < 15) score += 5;

    // Penalty: selectors with indices/nth-child are fragile
    if (selector.includes("nth-child") || selector.includes("[") && selector.includes("]")) {
      score -= 5;
    }

    // Penalty: selectors with generated IDs (React, Angular)
    if (/[a-f0-9]{8,}/.test(selector) || /:r[0-9]+:/.test(selector)) {
      score -= 15; // Looks like auto-generated ID
    }

    // Bonus: data-testid is always reliable
    if (strategy === "data_testid") score = Math.max(score, 95);

    // Penalty: very long XPath
    if (strategy === "xpath_full" && selector.split("/").length > 8) {
      score -= 10;
    }

    scores[strategy] = Math.max(0, Math.min(100, score));
  }

  return scores;
}

export function getRecommendedSelector(
  fingerprint: ElementFingerprint
): { selector: string; strategy: string; confidence: number } {
  const scores = scoreSelectors(fingerprint);

  // Sort by confidence score descending
  const ranked = Object.entries(scores)
    .filter(([strategy]) => fingerprint.selectors[strategy as keyof typeof fingerprint.selectors])
    .sort(([, a], [, b]) => b - a);

  if (ranked.length === 0) {
    return { selector: "", strategy: "none", confidence: 0 };
  }

  const [bestStrategy, bestScore] = ranked[0];
  const bestSelector = fingerprint.selectors[bestStrategy as keyof typeof fingerprint.selectors]!;

  return {
    selector: bestSelector,
    strategy: bestStrategy,
    confidence: bestScore,
  };
}

// ===== OBJECT REPOSITORY =====
// Centralized element storage — change once, update everywhere

export interface ObjectRepositoryEntry {
  id: string;
  project_id: string;
  logical_name: string;       // Human-readable: "Login button", "Email field"
  page_name: string;          // Which page: "Login Page", "Dashboard"
  page_url_pattern: string;   // URL pattern: "/login", "/dashboard/*"
  fingerprint: ElementFingerprint;
  used_in_tests: string[];    // Test case IDs that reference this element
  last_verified: string;      // Last time this selector was confirmed working
  heal_history: Array<{       // Track every time this selector was healed
    date: string;
    old_selector: string;
    new_selector: string;
    method: string;
    confidence: number;
  }>;
  created_at: string;
  updated_at: string;
}

// ===== ELEMENT CAPTURE (from browser) =====
// This is what the Chrome extension sends when recording

export interface CapturedElement {
  selectors: {
    css: string;
    xpath: string;
    aria_label: string | null;
    text: string | null;
    data_testid: string | null;
    name: string | null;
    placeholder: string | null;
    id: string | null;
  };
  tag_name: string;
  element_type: string | null;
  inner_text: string | null;
  bounding_rect: { x: number; y: number; width: number; height: number };
  parent_info: {
    tag: string;
    id: string | null;
    class: string | null;
  };
  form_info: {
    form_id: string | null;
    form_action: string | null;
  } | null;
  nearest_label: string | null;
  nearest_heading: string | null;
  is_visible: boolean;
  is_enabled: boolean;
  page_url: string;
  page_title: string;
  timestamp: number;
}

// Convert raw browser capture to full fingerprint
export function capturedToFingerprint(captured: CapturedElement): ElementFingerprint {
  const fingerprint: ElementFingerprint = {
    selectors: {
      data_testid: captured.selectors.data_testid,
      aria_label: captured.selectors.aria_label,
      role_name: null, // Set from accessibility snapshot
      css_id: captured.selectors.id ? `#${captured.selectors.id}` : null,
      css_class: null, // Will be generated from element classes
      css_path: captured.selectors.css,
      xpath_full: captured.selectors.xpath,
      xpath_relative: buildRelativeXpath(captured),
      text_content: captured.selectors.text ? `text="${captured.selectors.text}"` : null,
      link_text: captured.tag_name === "a" && captured.inner_text ? `a:has-text("${captured.inner_text}")` : null,
      name_attr: captured.selectors.name ? `[name="${captured.selectors.name}"]` : null,
      placeholder: captured.selectors.placeholder ? `[placeholder="${captured.selectors.placeholder}"]` : null,
      title_attr: null,
      custom: null,
    },
    visual: {
      bounding_box: captured.bounding_rect,
      relative_position: null,
      screenshot_base64: null,
      parent_screenshot: null,
      background_color: null,
      text_color: null,
      font_size: null,
      is_visible: captured.is_visible,
      z_index: null,
    },
    structure: {
      tag_name: captured.tag_name,
      element_type: captured.element_type,
      parent_tag: captured.parent_info.tag,
      parent_id: captured.parent_info.id,
      sibling_index: 0,
      depth: captured.selectors.xpath.split("/").length,
      form_context: captured.form_info?.form_id || captured.form_info?.form_action || null,
      closest_heading: captured.nearest_heading,
      closest_label: captured.nearest_label,
    },
    content: {
      inner_text: captured.inner_text,
      value: null,
      alt_text: null,
      href: null,
      is_enabled: captured.is_enabled,
      is_required: false,
      has_validation: false,
    },
    meta: {
      captured_at: new Date(captured.timestamp).toISOString(),
      captured_from_url: captured.page_url,
      page_title: captured.page_title,
      confidence_scores: {},
      recommended_selector: "",
      recommended_strategy: "",
    },
  };

  // Score and set recommendation
  fingerprint.meta.confidence_scores = scoreSelectors(fingerprint);
  const recommended = getRecommendedSelector(fingerprint);
  fingerprint.meta.recommended_selector = recommended.selector;
  fingerprint.meta.recommended_strategy = recommended.strategy;

  return fingerprint;
}

function buildRelativeXpath(captured: CapturedElement): string {
  const tag = captured.tag_name.toLowerCase();

  // Try text-based XPath first
  if (captured.inner_text && captured.inner_text.length < 50) {
    return `//${tag}[contains(text(),'${captured.inner_text.slice(0, 30)}')]`;
  }

  // Try attribute-based
  if (captured.selectors.data_testid) {
    return `//${tag}[@data-testid='${captured.selectors.data_testid}']`;
  }
  if (captured.selectors.name) {
    return `//${tag}[@name='${captured.selectors.name}']`;
  }
  if (captured.selectors.placeholder) {
    return `//${tag}[@placeholder='${captured.selectors.placeholder}']`;
  }
  if (captured.selectors.id) {
    return `//${tag}[@id='${captured.selectors.id}']`;
  }

  // Fallback to aria
  if (captured.selectors.aria_label) {
    return `//${tag}[@aria-label='${captured.selectors.aria_label}']`;
  }

  return captured.selectors.xpath; // Fall back to absolute
}

// ===== SELECTOR RESOLUTION AT RUNTIME =====
// During test execution, this resolves the best selector to use

export async function resolveElement(
  page: Record<string, unknown>, // Playwright Page
  fingerprint: ElementFingerprint,
  timeoutMs: number = 10000
): Promise<{ locator: Record<string, unknown>; strategy_used: string; confidence: number }> {
  const scores = scoreSelectors(fingerprint);

  // Sort strategies by confidence
  const strategies = Object.entries(scores)
    .filter(([strategy]) => fingerprint.selectors[strategy as keyof typeof fingerprint.selectors])
    .sort(([, a], [, b]) => b - a);

  for (const [strategy, confidence] of strategies) {
    const selector = fingerprint.selectors[strategy as keyof typeof fingerprint.selectors];
    if (!selector) continue;

    try {
      // Build Playwright locator based on strategy
      let locator;
      switch (strategy) {
        case "role_name": {
          const match = selector.match(/role=(\w+)\[name="([^"]+)"\]/);
          if (match) locator = page.getByRole(match[1], { name: match[2] });
          break;
        }
        case "text_content":
          locator = page.getByText(selector.replace(/^text="/, "").replace(/"$/, ""));
          break;
        case "aria_label":
          locator = page.getByLabel(selector.replace(/^\[aria-label="/, "").replace(/"\]$/, ""));
          break;
        case "placeholder":
          locator = page.getByPlaceholder(selector.replace(/^\[placeholder="/, "").replace(/"\]$/, ""));
          break;
        default:
          locator = page.locator(selector);
      }

      if (locator) {
        // Quick check: does this element exist and is visible?
        await locator.waitFor({ state: "visible", timeout: Math.min(timeoutMs, 3000) });
        return { locator, strategy_used: strategy, confidence };
      }
    } catch {
      // This strategy failed — try next one
      continue;
    }
  }

  // All strategies failed — try visual/position-based as last resort
  if (fingerprint.visual.bounding_box) {
    const { x, y, width, height } = fingerprint.visual.bounding_box;
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    // Use position-based click as absolute last resort (very fragile)
    return {
      locator: { click: async () => page.mouse.click(centerX, centerY) },
      strategy_used: "position_fallback",
      confidence: 15,
    };
  }

  throw new Error(
    `Element not found with any strategy. Tried: ${strategies.map(([s]) => s).join(", ")}. ` +
    `Element: ${fingerprint.structure.tag_name} "${fingerprint.content.inner_text || fingerprint.structure.closest_label || "unknown"}"`
  );
}
