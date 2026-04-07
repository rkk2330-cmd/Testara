// ===========================================
// TESTARA — Sensitive Data Masking
// Detects + masks passwords, tokens, keys,
// PII across UI, logs, AI prompts, exports
// ===========================================

// ===== SENSITIVE FIELD PATTERNS =====
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  // Passwords
  { pattern: /password/i, type: "password" },
  { pattern: /passwd/i, type: "password" },
  { pattern: /pass_?word/i, type: "password" },
  { pattern: /^pwd$/i, type: "password" },
  { pattern: /secret/i, type: "secret" },
  // Tokens & Keys
  { pattern: /token/i, type: "token" },
  { pattern: /api_?key/i, type: "api_key" },
  { pattern: /auth_?key/i, type: "api_key" },
  { pattern: /access_?key/i, type: "api_key" },
  { pattern: /secret_?key/i, type: "secret" },
  { pattern: /private_?key/i, type: "secret" },
  { pattern: /bearer/i, type: "token" },
  { pattern: /authorization/i, type: "token" },
  // Financial
  { pattern: /cvv/i, type: "financial" },
  { pattern: /cvc/i, type: "financial" },
  { pattern: /card_?number/i, type: "financial" },
  { pattern: /credit_?card/i, type: "financial" },
  { pattern: /account_?number/i, type: "financial" },
  { pattern: /^pin$/i, type: "financial" },
  { pattern: /routing_?number/i, type: "financial" },
  // Indian PII
  { pattern: /aadhaar/i, type: "pii" },
  { pattern: /aadhar/i, type: "pii" },
  { pattern: /pan_?number/i, type: "pii" },
  { pattern: /^pan$/i, type: "pii" },
  // General PII
  { pattern: /ssn/i, type: "pii" },
  { pattern: /social_?security/i, type: "pii" },
  { pattern: /^otp$/i, type: "secret" },
  { pattern: /mfa_?code/i, type: "secret" },
  { pattern: /2fa/i, type: "secret" },
];

// ===== SENSITIVE VALUE PATTERNS (detect in values, not just field names) =====
const SENSITIVE_VALUE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  // Bearer tokens
  { pattern: /^Bearer\s+[A-Za-z0-9\-._~+/]+=*$/i, type: "token" },
  // JWT tokens
  { pattern: /^eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+$/, type: "token" },
  // API keys (common formats)
  { pattern: /^sk[-_][a-zA-Z0-9]{20,}$/, type: "api_key" },
  { pattern: /^pk[-_][a-zA-Z0-9]{20,}$/, type: "api_key" },
  { pattern: /^rzp_[a-zA-Z0-9]{14,}$/, type: "api_key" },
  // Aadhaar (12 digits)
  { pattern: /^\d{4}\s?\d{4}\s?\d{4}$/, type: "pii" },
  // PAN (ABCDE1234F)
  { pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/, type: "pii" },
];

// ===== MASK DISPLAY STRING =====
const MASK_CHAR = "•";

export function maskValue(value: string, type?: string): string {
  if (!value || value.length === 0) return value;

  const len = value.length;

  switch (type) {
    case "password":
    case "secret":
    case "otp":
      return MASK_CHAR.repeat(Math.min(len, 8));
    case "token":
    case "api_key":
      if (len > 8) return value.slice(0, 4) + MASK_CHAR.repeat(len - 8) + value.slice(-4);
      return MASK_CHAR.repeat(len);
    case "financial":
      if (len > 4) return MASK_CHAR.repeat(len - 4) + value.slice(-4);
      return MASK_CHAR.repeat(len);
    case "pii":
      if (len > 4) return MASK_CHAR.repeat(len - 4) + value.slice(-4);
      return MASK_CHAR.repeat(len);
    default:
      return MASK_CHAR.repeat(Math.min(len, 8));
  }
}

// ===== CHECK IF FIELD NAME IS SENSITIVE =====
export function isSensitiveField(fieldName: string): { sensitive: boolean; type: string } {
  for (const { pattern, type } of SENSITIVE_PATTERNS) {
    if (pattern.test(fieldName)) return { sensitive: true, type };
  }
  return { sensitive: false, type: "" };
}

// ===== CHECK IF VALUE IS SENSITIVE =====
export function isSensitiveValue(value: string): { sensitive: boolean; type: string } {
  for (const { pattern, type } of SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(value)) return { sensitive: true, type };
  }
  return { sensitive: false, type: "" };
}

// ===== MASK AN OBJECT (for display, logs, AI prompts) =====
export function maskObject(
  obj: Record<string, unknown>,
  options?: { maskFields?: boolean; maskValues?: boolean }
): Record<string, unknown> {
  const { maskFields = true, maskValues = true } = options || {};
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      // Check field name
      if (maskFields) {
        const fieldCheck = isSensitiveField(key);
        if (fieldCheck.sensitive) { masked[key] = maskValue(value, fieldCheck.type); continue; }
      }
      // Check value pattern
      if (maskValues) {
        const valueCheck = isSensitiveValue(value);
        if (valueCheck.sensitive) { masked[key] = maskValue(value, valueCheck.type); continue; }
      }
      masked[key] = value;
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      masked[key] = maskObject(value as Record<string, unknown>, options);
    } else if (Array.isArray(value)) {
      masked[key] = value.map(item =>
        typeof item === "object" && item !== null ? maskObject(item as Record<string, unknown>, options) : item
      );
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

// ===== MASK TEST STEP FOR DISPLAY =====
export function maskTestStep(step: {
  action_type: string;
  target: { selector: string; description: string };
  input_data: string | null;
}): { input_data: string | null; isMasked: boolean } {
  if (!step.input_data) return { input_data: null, isMasked: false };

  // Check if this step types into a password field
  const desc = (step.target.description || "").toLowerCase();
  const selector = (step.target.selector || "").toLowerCase();
  const isPasswordField =
    desc.includes("password") || desc.includes("pin") || desc.includes("secret") ||
    selector.includes("password") || selector.includes("type=\"password\"") ||
    selector.includes("[type=password]") || selector.includes("pin");

  if (isPasswordField && step.action_type === "type") {
    return { input_data: maskValue(step.input_data, "password"), isMasked: true };
  }

  // Check if the value itself looks sensitive
  const valueCheck = isSensitiveValue(step.input_data);
  if (valueCheck.sensitive) {
    return { input_data: maskValue(step.input_data, valueCheck.type), isMasked: true };
  }

  return { input_data: step.input_data, isMasked: false };
}

// ===== MASK DATASET ROW FOR DISPLAY =====
export function maskDatasetRow(
  row: Record<string, string>,
  columns: string[]
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const col of columns) {
    const check = isSensitiveField(col);
    if (check.sensitive) {
      masked[col] = maskValue(row[col] || "", check.type);
    } else {
      const valueCheck = isSensitiveValue(row[col] || "");
      masked[col] = valueCheck.sensitive ? maskValue(row[col] || "", valueCheck.type) : (row[col] || "");
    }
  }
  return masked;
}

// ===== MASK HEADERS FOR DISPLAY =====
export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const fieldCheck = isSensitiveField(key);
    if (fieldCheck.sensitive) { masked[key] = maskValue(value, fieldCheck.type); continue; }
    const valueCheck = isSensitiveValue(value);
    masked[key] = valueCheck.sensitive ? maskValue(value, valueCheck.type) : value;
  }
  return masked;
}

// ===== MASK FOR AI PROMPTS (don't send real passwords to Claude) =====
export function maskForAI(text: string): string {
  let masked = text;
  // Mask bearer tokens
  masked = masked.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [MASKED_TOKEN]");
  // Mask JWT tokens
  masked = masked.replace(/eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+/g, "[MASKED_JWT]");
  // Mask API keys
  masked = masked.replace(/sk[-_][a-zA-Z0-9]{20,}/g, "sk-[MASKED_KEY]");
  masked = masked.replace(/rzp_[a-zA-Z0-9]{14,}/g, "rzp_[MASKED_KEY]");
  // Mask passwords in common formats
  masked = masked.replace(/"password"\s*:\s*"[^"]+"/gi, '"password": "[MASKED]"');
  masked = masked.replace(/"passwd"\s*:\s*"[^"]+"/gi, '"passwd": "[MASKED]"');
  masked = masked.replace(/"secret"\s*:\s*"[^"]+"/gi, '"secret": "[MASKED]"');
  masked = masked.replace(/"token"\s*:\s*"[^"]+"/gi, '"token": "[MASKED]"');
  masked = masked.replace(/"api_key"\s*:\s*"[^"]+"/gi, '"api_key": "[MASKED]"');
  // Mask Aadhaar
  masked = masked.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "XXXX XXXX [MASKED]");
  // Mask PAN
  masked = masked.replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, "XXXXX[MASKED]");
  return masked;
}

// ===== MASK FOR LOGS (never log sensitive values) =====
export function maskForLogs(data: Record<string, unknown>): Record<string, unknown> {
  return maskObject(data, { maskFields: true, maskValues: true });
}

// ===== SHOULD FIELD BE HIDDEN IN EXPORT? =====
export function shouldMaskInExport(fieldName: string): boolean {
  return isSensitiveField(fieldName).sensitive;
}
