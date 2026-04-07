// ===========================================
// TESTARA — AI-Powered Mainframe Testing Intelligence
// Makes mainframe testing accessible to non-mainframe experts
// ===========================================

import { logger } from "@/lib/core/logger";

const MODEL = "claude-sonnet-4-6";

async function callAI(system: string, prompt: string, maxTokens = 1500): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const res = await client.messages.create({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] });
  return res.content[0].type === "text" ? res.content[0].text : "";
}

function parseJSON(text: string): unknown {
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { return null; }
}

// ===== 1. UNDERSTAND MAINFRAME SCREEN =====
// Given raw screen text, AI identifies what screen this is, what fields exist, and what actions are available
export async function analyzeScreen(
  screenText: string,
  screenDimensions?: { rows: number; cols: number }
): Promise<{
  screenType: string;
  screenTitle: string;
  fields: Array<{ name: string; row: number; col: number; length: number; type: "input" | "output" | "label"; currentValue?: string }>;
  availableActions: Array<{ key: string; label: string; description: string }>;
  navigation: { canGoBack: boolean; backKey: string; menuOptions?: Array<{ option: string; description: string }> };
}> {
  const result = await callAI(
    `You are a mainframe terminal expert (TN3270/TN5250). Given raw screen output, analyze the screen completely.

Identify:
1. Screen type (login, menu, data entry, inquiry, report, error, confirmation)
2. Screen title/header
3. ALL input fields with their row/column positions and current values
4. ALL function key options shown (e.g., F1=Help, F3=Exit, F12=Cancel)
5. Menu options if this is a menu screen
6. Whether user can navigate back and which key

Screen dimensions: ${screenDimensions?.rows || 24} rows x ${screenDimensions?.cols || 80} columns.
Row/column counting starts at 1.

Return ONLY valid JSON matching the specified structure.`,
    `Mainframe screen output:\n${screenText}`,
    1000
  );

  const parsed = parseJSON(result);
  logger.info("ai.mainframe_screen_analyzed", { screenType: (parsed as Record<string, string>)?.screenType || "unknown" });
  return parsed as ReturnType<typeof analyzeScreen> extends Promise<infer T> ? T : never;
}

// ===== 2. GENERATE MAINFRAME TEST FLOW FROM GOAL =====
// User says "test balance inquiry" → AI generates complete navigation flow
export async function generateMainframeFlow(
  goal: string,
  startScreen: string, // Text of current screen
  knownScreens?: Array<{ name: string; description: string }>,
  credentials?: { userId?: string; password?: string }
): Promise<Array<{
  step: number;
  action: "type" | "send_key" | "wait" | "assert" | "navigate";
  description: string;
  target?: { row: number; col: number; field_name: string };
  value?: string;
  key?: string;
  expected?: string;
  waitCondition?: string;
}>> {
  const result = await callAI(
    `You are a mainframe test automation expert. Generate a complete step-by-step test flow for a mainframe application.

For each step, specify:
- action: "type" (enter text in field), "send_key" (press function key), "wait" (wait for screen), "assert" (verify text), "navigate" (menu selection)
- For "type": specify target row/col/field_name and value
- For "send_key": specify key (ENTER, F1-F24, PF1-PF24, PA1-PA3, TAB, CLEAR)
- For "wait": specify what screen/text to wait for
- For "assert": specify expected text and location
- For "navigate": specify menu option to select

Include:
1. Login steps if needed
2. Navigation to target screen
3. Data entry
4. Verification/assertion steps
5. Cleanup/logout

Return ONLY valid JSON array.`,
    `Goal: ${goal}\n\nCurrent screen:\n${startScreen}\n\n${knownScreens ? `Known screens: ${JSON.stringify(knownScreens)}` : ""}\n${credentials?.userId ? `Test credentials: User=${credentials.userId}` : ""}`,
    2000
  );

  const parsed = parseJSON(result);
  return (Array.isArray(parsed) ? parsed : []) as ReturnType<typeof generateMainframeFlow> extends Promise<infer T> ? T : never;
}

// ===== 3. MAP SCREEN FIELDS TO LOGICAL NAMES =====
// Converts raw row/col positions to meaningful field names
export async function mapScreenFields(
  screenText: string,
  existingMappings?: Array<{ logicalName: string; row: number; col: number }>
): Promise<Array<{
  logicalName: string;
  row: number;
  col: number;
  length: number;
  dataType: "text" | "numeric" | "date" | "amount" | "code";
  sampleValue?: string;
  validation?: string;
}>> {
  const result = await callAI(
    `You are a mainframe field mapping expert. Given a mainframe screen, identify every input/output field and assign a logical name.

For each field, determine:
- A clear logical name (e.g., "account_number", "transaction_date", "customer_name")
- Exact row/column position
- Expected length
- Data type (text, numeric, date, amount, code)
- Current value if populated
- Validation rules (e.g., "exactly 10 digits for Aadhaar", "DD/MM/YYYY format")

${existingMappings ? `These mappings already exist — don't duplicate them:\n${JSON.stringify(existingMappings)}` : ""}

Return ONLY valid JSON array.`,
    `Screen:\n${screenText}`
  );

  return (parseJSON(result) as Array<Record<string, unknown>>) as ReturnType<typeof mapScreenFields> extends Promise<infer T> ? T : never || [];
}

// ===== 4. DETECT SCREEN CHANGES (for self-healing) =====
export function detectScreenChanges(
  expectedScreen: { title: string; fields: Array<{ name: string; row: number; col: number }> },
  actualScreenText: string
): { matched: boolean; changes: Array<{ type: string; detail: string }> } {
  // Rule-based (instant, $0)
  const changes: Array<{ type: string; detail: string }> = [];

  // Check if title is present
  if (expectedScreen.title && !actualScreenText.includes(expectedScreen.title)) {
    changes.push({ type: "title_missing", detail: `Expected title "${expectedScreen.title}" not found on screen` });
  }

  // Check field positions (look for labels near expected positions)
  for (const field of expectedScreen.fields) {
    const lines = actualScreenText.split("\n");
    if (field.row <= lines.length) {
      const line = lines[field.row - 1] || "";
      // Check if there's content near the expected column
      const nearby = line.slice(Math.max(0, field.col - 5), field.col + 20).trim();
      if (!nearby) {
        changes.push({ type: "field_empty", detail: `Field "${field.name}" at row ${field.row}, col ${field.col} appears empty or moved` });
      }
    }
  }

  return { matched: changes.length === 0, changes };
}

// ===== 5. ERROR RECOVERY SUGGESTIONS =====
export async function suggestRecovery(
  currentScreen: string,
  expectedScreen: string,
  lastAction: string,
  errorMessage?: string
): Promise<{
  diagnosis: string;
  recoverySteps: Array<{ action: string; key?: string; value?: string; description: string }>;
  preventionAdvice: string;
}> {
  const result = await callAI(
    `You are a mainframe troubleshooting expert. A test encountered an unexpected screen. Diagnose the problem and suggest recovery steps.

Common mainframe issues:
- Session timeout → need to re-login
- Wrong screen → press F3 to go back, retry navigation
- Locked terminal → press RESET key
- Data validation error → check field values
- Authorization error → wrong user profile
- Record locked → another user has the record open

Return JSON: { "diagnosis": "...", "recoverySteps": [{"action":"send_key|type|wait","key":"...","value":"...","description":"..."}], "preventionAdvice": "..." }`,
    `Current screen:\n${currentScreen.slice(0, 1000)}\n\nExpected screen: ${expectedScreen}\nLast action: ${lastAction}\n${errorMessage ? `Error: ${errorMessage}` : ""}`,
    600
  );

  return (parseJSON(result) as ReturnType<typeof suggestRecovery> extends Promise<infer T> ? T : never) || {
    diagnosis: "Unable to diagnose",
    recoverySteps: [{ action: "send_key", key: "F3", description: "Try pressing F3 to go back" }],
    preventionAdvice: "Add wait conditions between navigation steps",
  };
}

// ===== 6. GENERATE MAINFRAME TEST DATA =====
export async function generateMainframeTestData(
  screenFields: Array<{ name: string; dataType: string; length: number; validation?: string }>,
  domain?: string, // "banking", "insurance", "healthcare"
  count?: number
): Promise<{ valid: Array<Record<string, string>>; invalid: Array<{ data: Record<string, string>; reason: string }> }> {
  const result = await callAI(
    `You are a mainframe test data expert. Generate test data for mainframe screen fields.

Rules:
- Respect field lengths STRICTLY (mainframe fields are fixed-width)
- Use uppercase for text fields (mainframe convention)
- Use correct date formats (typically MM/DD/YYYY or YYYYMMDD)
- Generate both VALID and INVALID data with reasons
${domain ? `- Domain: ${domain} — use domain-specific values (e.g., banking: account numbers, IFSC codes; healthcare: patient IDs, Aadhaar)` : ""}

Return JSON: { "valid": [{field_name: "value", ...}], "invalid": [{"data": {field_name: "value"}, "reason": "why invalid"}] }`,
    `Screen fields:\n${JSON.stringify(screenFields, null, 2)}\nGenerate ${count || 5} valid and ${count || 3} invalid datasets.`,
    1000
  );

  return (parseJSON(result) as { valid: Array<Record<string, string>>; invalid: Array<{ data: Record<string, string>; reason: string }> }) || { valid: [], invalid: [] };
}
