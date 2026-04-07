import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedTest } from "@/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = "claude-sonnet-4-6";

// ===== TOKEN TRACKING =====
// Tracks every AI call for billing, cost analysis, and limit enforcement
export interface AIUsageRecord {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  feature: string;    // "generate_from_url", "generate_from_story", etc.
  duration_ms: number;
}

// Claude Sonnet 4 pricing (as of 2026)
const COST_PER_1K_INPUT = 0.003;  // $3 per 1M input tokens
const COST_PER_1K_OUTPUT = 0.015; // $15 per 1M output tokens

let sessionUsage: AIUsageRecord[] = [];

function trackUsage(response: Record<string, unknown>, feature: string, startTime: number): AIUsageRecord {
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const costUsd = (inputTokens / 1000) * COST_PER_1K_INPUT + (outputTokens / 1000) * COST_PER_1K_OUTPUT;

  const record: AIUsageRecord = {
    model: MODEL,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cost_usd: Math.round(costUsd * 10000) / 10000, // 4 decimal places
    feature,
    duration_ms: Date.now() - startTime,
  };

  sessionUsage.push(record);
  console.log(`[Testara AI] ${feature}: ${record.total_tokens} tokens, $${record.cost_usd}, ${record.duration_ms}ms`);
  return record;
}

export function getSessionUsage(): AIUsageRecord[] { return sessionUsage; }
export function getTotalCost(): number { return sessionUsage.reduce((sum, r) => sum + r.cost_usd, 0); }

// ===========================================
// TEST GENERATION FROM URL
// ===========================================
export async function generateTestsFromUrl(
  url: string,
  pageContent: string,
  accessibilityTree: string,
  depth: string = "quick"
): Promise<GeneratedTest[]> {
  const startTime = Date.now();
  const isQuick = depth === "quick";
  const testCount = isQuick ? "2-4" : "6-10";
  const coverage = isQuick
    ? "Focus on the primary happy path and 1 critical negative case. Be fast and practical."
    : "Cover comprehensively: all happy paths, negative cases, edge cases, boundary values, accessibility checks, and security basics (XSS in inputs, SQL injection patterns).";

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: isQuick ? 2048 : 4096,
    system: `You are Testara AI, an expert QA engineer that generates comprehensive test cases for web applications.
You analyze the page structure, interactive elements, and user flows to create thorough test coverage.

DEPTH MODE: ${depth.toUpperCase()}
Generate ${testCount} test cases. ${coverage}

RULES:
- Each test case should have clear, actionable steps
- For element identification, ALWAYS capture multiple locator strategies in fallback_selectors:
  * accessibility_role: the ARIA role (button, textbox, link, combobox, checkbox, heading)
  * aria_label: the element's aria-label attribute
  * text: the visible text content
  * placeholder: the placeholder attribute (for inputs)
  * data_testid: the data-testid attribute if present
  * name: the name attribute (for form elements)
  * label: the associated label text (for form fields)
- The primary "selector" should be the MOST RELIABLE: prefer data-testid > aria-label > role+name > placeholder > text > CSS ID > CSS class (LAST RESORT)
- NEVER use fragile CSS paths like 'div > form > button:nth-child(3)' or absolute XPaths
- Always include assertions to verify expected outcomes
- Consider accessibility, responsive design, and error states
- Output ONLY valid JSON, no markdown or explanation`,

    messages: [
      {
        role: "user",
        content: `Analyze this web page and generate comprehensive test cases.

URL: ${url}

Page Content (simplified):
${pageContent.slice(0, 8000)}

Accessibility Tree:
${accessibilityTree.slice(0, 4000)}

Generate test cases as a JSON array with this structure:
[{
  "title": "Test case title",
  "description": "What this test verifies",
  "type": "happy_path|negative|edge_case|boundary|security|accessibility",
  "priority": "critical|high|medium|low",
  "steps": [
    {
      "order_index": 1,
      "action_type": "navigate|click|type|assert_text|assert_visible|assert_url|select|hover|wait|screenshot",
      "target": {
        "selector": "most reliable selector (prefer data-testid or aria-label over CSS)",
        "fallback_selectors": {
          "accessibility_role": "button|textbox|link|combobox|checkbox|heading",
          "aria_label": "element's aria-label",
          "text": "visible text content",
          "placeholder": "placeholder text (inputs only)",
          "data_testid": "data-testid value",
          "name": "name attribute",
          "label": "associated label text",
          "css_id": "#element-id",
          "css": "tag.class (LAST RESORT only)"
        },
        "description": "Human-readable: 'Sign In button' or 'Email input field'"
      },
      "input_data": "value to type (if applicable)",
      "expected_result": "what should happen (if assertion)"
    }
  ],
  "confidence": 85
}]`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  trackUsage(response, "generate_from_url", startTime);
  return JSON.parse(cleaned) as GeneratedTest[];
}

// ===========================================
// TEST GENERATION FROM USER STORY
// ===========================================
export async function generateTestsFromStory(
  userStory: string,
  projectContext?: string,
  depth: string = "quick"
): Promise<GeneratedTest[]> {
  const startTime = Date.now();
  const isQuick = depth === "quick";
  const testCount = isQuick ? "2-4" : "6-10";
  const coverage = isQuick
    ? "Focus on the primary happy path and 1 critical negative case."
    : "Cover comprehensively: all happy paths, negative cases, edge cases, boundary values, accessibility, and security.";

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: isQuick ? 2048 : 4096,
    system: `You are Testara AI, an expert QA engineer that converts user stories into comprehensive test cases.

DEPTH MODE: ${depth.toUpperCase()}
Generate ${testCount} test cases. ${coverage}

RULES:
- Include positive, negative, and edge case scenarios as appropriate for the depth mode
- For element identification, generate fallback_selectors with: accessibility_role, aria_label, text, placeholder, data_testid, name, label
- Use descriptive selectors: prefer role+name, aria-label, placeholder over CSS classes/IDs
- Steps should be specific and actionable
- Output ONLY valid JSON, no markdown`,

    messages: [
      {
        role: "user",
        content: `Convert this user story into test cases:

"${userStory}"

${projectContext ? `Project context: ${projectContext}` : ""}

Generate as JSON array: [{ "title", "description", "type", "steps": [{ "order_index", "action_type", "target": { "selector", "fallback_selectors", "description" }, "input_data", "expected_result" }], "confidence" }]`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  trackUsage(response, "generate_from_story", startTime2);
  return JSON.parse(cleaned) as GeneratedTest[];
}

// ===========================================
// SELF-HEALING: LLM-POWERED ELEMENT MATCHING
// ===========================================
export async function healBrokenSelector(
  originalSelector: string,
  originalDescription: string,
  currentPageHtml: string,
  accessibilityTree: string
): Promise<{
  newSelector: string;
  confidence: number;
  explanation: string;
  method: string;
}> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: `You are Testara AI's self-healing engine. A test element's selector broke because the UI changed.
Your job: find the element on the current page that matches the INTENT of the original selector.
Think semantically: "this was a login button" not "this was #btn-login".

Output ONLY valid JSON.`,

    messages: [
      {
        role: "user",
        content: `The following selector no longer works:
Original selector: ${originalSelector}
Element description: ${originalDescription}

Current page accessibility tree:
${accessibilityTree.slice(0, 6000)}

Find the matching element and respond with:
{
  "newSelector": "new CSS selector that works",
  "confidence": 0-100,
  "explanation": "Why this is the correct element",
  "method": "accessibility_tree|text_match|visual_match|llm_semantic"
}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ===========================================
// AI TEST ENRICHMENT (during recording)
// ===========================================
export async function suggestAssertions(
  steps: Array<{ action: string; element: string; page_url: string }>
): Promise<Array<{ assertion_type: string; target: string; expected: string; reason: string }>> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: `You are Testara AI. Given a sequence of recorded user actions, suggest assertions that should be added to make a robust test. Think about: page load verification, element visibility, text content, URL changes, success messages, error states. Output ONLY valid JSON array.`,
    messages: [
      {
        role: "user",
        content: `Recorded actions:\n${JSON.stringify(steps, null, 2)}\n\nSuggest assertions as: [{ "assertion_type": "assert_text|assert_visible|assert_url|assert_value", "target": { "selector": "...", "description": "..." }, "expected": "expected value", "reason": "why this assertion matters" }]`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}
