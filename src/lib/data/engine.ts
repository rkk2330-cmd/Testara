// ===========================================
// TESTARA — Smart Test Data Engine
// Handles domain-specific data, environment scoping,
// dynamic expressions, and AI-aware generation
// ===========================================

// ===== 1. DYNAMIC EXPRESSIONS =====
// Use these in any test step input: {{$expression}}
// Unlike {{column}} which comes from CSV, these generate at runtime

const DYNAMIC_EXPRESSIONS: Record<string, () => string> = {
  // Timestamps & dates
  "$timestamp": () => Date.now().toString(),
  "$iso_date": () => new Date().toISOString(),
  "$today": () => new Date().toISOString().split("T")[0],
  "$yesterday": () => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  },
  "$tomorrow": () => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  },
  "$time_now": () => new Date().toLocaleTimeString("en-IN", { hour12: false }),

  // Unique IDs
  "$uuid": () => crypto.randomUUID(),
  "$short_id": () => Math.random().toString(36).substring(2, 10),
  "$sequence": (() => { let seq = 0; return () => (++seq).toString(); })(),

  // Random data
  "$random_email": () => `test.${Math.random().toString(36).slice(2, 8)}@testmail.com`,
  "$random_phone_in": () => `+91${Math.floor(7000000000 + Math.random() * 2999999999)}`,
  "$random_phone_us": () => `+1${Math.floor(2000000000 + Math.random() * 7999999999)}`,
  "$random_number": () => Math.floor(Math.random() * 10000).toString(),
  "$random_string": () => Math.random().toString(36).substring(2, 14),
  "$random_boolean": () => Math.random() > 0.5 ? "true" : "false",

  // India-specific
  "$random_aadhaar": () => {
    const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
    digits[0] = Math.floor(Math.random() * 9) + 1; // Can't start with 0
    return digits.join("").replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
  },
  "$random_pan": () => {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const r = (n: number) => Array.from({ length: n }, () => letters[Math.floor(Math.random() * 26)]).join("");
    return `${r(3)}P${r(1)}${Math.floor(1000 + Math.random() * 8999)}${r(1)}`;
  },
  "$random_pincode": () => Math.floor(100000 + Math.random() * 899999).toString(),
  "$random_ifsc": () => {
    const banks = ["SBIN", "HDFC", "ICIC", "UTIB", "PUNB", "BARB", "KKBK"];
    return `${banks[Math.floor(Math.random() * banks.length)]}0${Math.floor(100000 + Math.random() * 899999)}`;
  },

  // Global test patterns
  "$xss_payload": () => '<script>alert("XSS")</script>',
  "$sql_injection": () => "' OR 1=1 --",
  "$long_string": () => "A".repeat(256),
  "$empty": () => "",
  "$whitespace": () => "   ",
  "$special_chars": () => '!@#$%^&*()_+-=[]{}|;:,.<>?',
  "$unicode": () => "你好世界 مرحبا العالم",
  "$max_int": () => "2147483647",
  "$negative": () => "-1",
  "$zero": () => "0",
  "$null_string": () => "null",
};

// ===== 2. DOMAIN PROFILES =====
// Pre-built data patterns for specific industries

export interface DomainProfile {
  id: string;
  name: string;
  description: string;
  fields: Array<{
    name: string;
    type: "text" | "email" | "phone" | "date" | "number" | "select" | "id";
    pattern?: string;
    options?: string[];
    locale?: string;
    example: string;
  }>;
}

export const DOMAIN_PROFILES: DomainProfile[] = [
  {
    id: "healthcare_in",
    name: "Healthcare (India)",
    description: "Patient records, hospital systems, ABDM/Aadhaar integration",
    fields: [
      { name: "patient_id", type: "id", pattern: "PAT-{{$sequence}}", example: "PAT-001" },
      { name: "full_name", type: "text", locale: "en-IN", example: "Rahul Sharma" },
      { name: "aadhaar", type: "id", pattern: "{{$random_aadhaar}}", example: "1234 5678 9012" },
      { name: "abha_id", type: "id", pattern: "{{$short_id}}@abdm", example: "a7b2x9k1@abdm" },
      { name: "phone", type: "phone", pattern: "{{$random_phone_in}}", example: "+919876543210" },
      { name: "blood_group", type: "select", options: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"], example: "O+" },
      { name: "dob", type: "date", example: "1990-05-15" },
      { name: "gender", type: "select", options: ["Male", "Female", "Other"], example: "Male" },
      { name: "admission_date", type: "date", pattern: "{{$today}}", example: "2026-04-03" },
      { name: "ward", type: "select", options: ["General", "ICU", "Emergency", "Pediatric", "Maternity"], example: "General" },
      { name: "diagnosis", type: "text", example: "Type 2 Diabetes Mellitus" },
    ],
  },
  {
    id: "banking_in",
    name: "Banking & Finance (India)",
    description: "Account management, UPI, NEFT/RTGS, loan processing",
    fields: [
      { name: "account_number", type: "id", pattern: "{{$random_number}}{{$random_number}}{{$random_number}}", example: "918200345612" },
      { name: "ifsc_code", type: "id", pattern: "{{$random_ifsc}}", example: "SBIN0001234" },
      { name: "pan_number", type: "id", pattern: "{{$random_pan}}", example: "ABCPD1234E" },
      { name: "full_name", type: "text", locale: "en-IN", example: "Priya Patel" },
      { name: "upi_id", type: "text", pattern: "{{$short_id}}@upi", example: "priya.p@upi" },
      { name: "phone", type: "phone", pattern: "{{$random_phone_in}}", example: "+919876543210" },
      { name: "email", type: "email", pattern: "{{$random_email}}", example: "test.user@testmail.com" },
      { name: "loan_amount", type: "number", example: "500000" },
      { name: "account_type", type: "select", options: ["Savings", "Current", "FD", "RD", "NRI"], example: "Savings" },
      { name: "branch", type: "text", locale: "en-IN", example: "Koramangala, Bengaluru" },
    ],
  },
  {
    id: "ecommerce",
    name: "E-Commerce",
    description: "Product catalog, cart, checkout, shipping, returns",
    fields: [
      { name: "customer_email", type: "email", pattern: "{{$random_email}}", example: "shopper@testmail.com" },
      { name: "customer_name", type: "text", example: "Amit Kumar" },
      { name: "phone", type: "phone", pattern: "{{$random_phone_in}}", example: "+919876543210" },
      { name: "product_id", type: "id", pattern: "SKU-{{$short_id}}", example: "SKU-a7b2x9k1" },
      { name: "product_name", type: "text", example: "Wireless Bluetooth Headphones" },
      { name: "price", type: "number", example: "1499" },
      { name: "quantity", type: "number", example: "2" },
      { name: "coupon_code", type: "text", example: "SAVE20" },
      { name: "shipping_address", type: "text", example: "42, MG Road, Bangalore 560001" },
      { name: "pincode", type: "id", pattern: "{{$random_pincode}}", example: "560001" },
      { name: "payment_method", type: "select", options: ["UPI", "Credit Card", "Debit Card", "COD", "Net Banking", "Wallet"], example: "UPI" },
    ],
  },
  {
    id: "insurance",
    name: "Insurance",
    description: "Policy management, claims processing, underwriting",
    fields: [
      { name: "policy_number", type: "id", pattern: "POL-{{$timestamp}}", example: "POL-1711929600000" },
      { name: "policyholder_name", type: "text", locale: "en-IN", example: "Sunita Reddy" },
      { name: "aadhaar", type: "id", pattern: "{{$random_aadhaar}}", example: "1234 5678 9012" },
      { name: "pan", type: "id", pattern: "{{$random_pan}}", example: "ABCPD1234E" },
      { name: "dob", type: "date", example: "1985-03-22" },
      { name: "phone", type: "phone", pattern: "{{$random_phone_in}}", example: "+919876543210" },
      { name: "policy_type", type: "select", options: ["Life", "Health", "Motor", "Home", "Travel"], example: "Health" },
      { name: "sum_assured", type: "number", example: "1000000" },
      { name: "premium", type: "number", example: "12000" },
      { name: "nominee_name", type: "text", example: "Rajesh Reddy" },
      { name: "claim_reason", type: "text", example: "Hospitalization for surgery" },
    ],
  },
  {
    id: "hrms",
    name: "HR & Payroll",
    description: "Employee management, attendance, payroll, leave",
    fields: [
      { name: "employee_id", type: "id", pattern: "EMP-{{$sequence}}", example: "EMP-001" },
      { name: "full_name", type: "text", locale: "en-IN", example: "Deepak Verma" },
      { name: "email", type: "email", pattern: "{{$random_email}}", example: "deepak.v@testmail.com" },
      { name: "phone", type: "phone", pattern: "{{$random_phone_in}}", example: "+919876543210" },
      { name: "department", type: "select", options: ["Engineering", "QA", "Product", "HR", "Finance", "Sales", "Support"], example: "QA" },
      { name: "designation", type: "text", example: "Senior QA Engineer" },
      { name: "joining_date", type: "date", example: "2022-06-15" },
      { name: "pan", type: "id", pattern: "{{$random_pan}}", example: "ABCPD1234E" },
      { name: "salary", type: "number", example: "85000" },
      { name: "leave_type", type: "select", options: ["Casual", "Sick", "Earned", "Maternity", "Paternity", "Compensatory"], example: "Casual" },
    ],
  },
];

// ===== 3. VARIABLE RESOLUTION ENGINE =====
// Resolves all variable types in order of precedence:
// 1. Data row (CSV) → {{column_name}}
// 2. Environment variables → {{env.BASE_URL}}
// 3. Dynamic expressions → {{$timestamp}}
// 4. Project-level variables → {{project.name}}
// 5. Global defaults → leaves {{unknown}} as-is

export interface VariableContext {
  dataRow?: Record<string, string>;          // From CSV iteration
  environment?: Record<string, string>;      // From project environment
  projectVars?: Record<string, string>;      // Project-level variables
  globalVars?: Record<string, string>;       // Organization-level variables
}

export function resolveVariables(text: string | null, context: VariableContext): string | null {
  if (!text) return text;

  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();

    // 1. Dynamic expressions: {{$timestamp}}, {{$random_email}}, etc.
    if (trimmed.startsWith("$")) {
      const expr = DYNAMIC_EXPRESSIONS[trimmed];
      if (expr) return expr();
    }

    // 2. Environment variables: {{env.BASE_URL}}, {{env.API_KEY}}
    if (trimmed.startsWith("env.")) {
      const envKey = trimmed.substring(4);
      if (context.environment?.[envKey]) return context.environment[envKey];
    }

    // 3. Project variables: {{project.name}}, {{project.base_url}}
    if (trimmed.startsWith("project.")) {
      const projKey = trimmed.substring(8);
      if (context.projectVars?.[projKey]) return context.projectVars[projKey];
    }

    // 4. Data row (CSV column): {{username}}, {{password}}
    if (context.dataRow?.[trimmed] !== undefined) {
      return context.dataRow[trimmed];
    }

    // 5. Global/org variables
    if (context.globalVars?.[trimmed] !== undefined) {
      return context.globalVars[trimmed];
    }

    // 6. Not resolved — leave as-is (will show in logs as unresolved)
    return match;
  });
}

// ===== 4. AI-AWARE DATA GENERATION PROMPT BUILDER =====
// Reads test steps + domain profile to build the perfect AI prompt

export function buildDataGenPrompt(
  testSteps: Array<{ action_type: string; target: Record<string, unknown>; input_data?: string }>,
  domainProfile?: DomainProfile,
  rowCount: number = 10,
  locale: string = "en-IN"
): string {
  // Extract all {{variable}} placeholders from test steps
  const variables = new Set<string>();
  for (const step of testSteps) {
    const matches = [
      ...(step.input_data?.matchAll(/\{\{(\w+)\}\}/g) || []),
      ...(step.target?.selector?.matchAll(/\{\{(\w+)\}\}/g) || []),
    ];
    for (const m of matches) {
      if (!m[1].startsWith("$") && !m[1].startsWith("env.") && !m[1].startsWith("project.")) {
        variables.add(m[1]);
      }
    }
  }

  if (variables.size === 0) {
    return "No {{variables}} found in test steps. Add placeholders like {{username}}, {{password}} in your test inputs first.";
  }

  // Build prompt with context
  let prompt = `Generate ${rowCount} rows of realistic test data for these variables: ${Array.from(variables).join(", ")}.\n\n`;

  // Add domain context if available
  if (domainProfile) {
    prompt += `Domain: ${domainProfile.name}\n`;
    prompt += `Context: ${domainProfile.description}\n`;
    const matchedFields = domainProfile.fields.filter(f => variables.has(f.name));
    if (matchedFields.length > 0) {
      prompt += `Known field patterns:\n`;
      for (const f of matchedFields) {
        prompt += `  - ${f.name}: ${f.type}${f.options ? `, options: ${f.options.join("/")}` : ""}${f.pattern ? `, pattern: ${f.pattern}` : ""} (e.g., ${f.example})\n`;
      }
    }
  }

  prompt += `\nLocale: ${locale}\n`;
  prompt += `Include a mix of: valid data (70%), invalid/boundary data (20%), and edge cases (10%).\n`;
  prompt += `For edge cases, include: empty strings, very long strings, special characters, boundary numbers.\n`;

  return prompt;
}

// ===== 5. EXPORT ALL DYNAMIC EXPRESSION KEYS (for UI autocomplete) =====
export function getAvailableExpressions(): Array<{ key: string; description: string; example: string }> {
  return [
    { key: "$timestamp", description: "Current Unix timestamp", example: "1711929600000" },
    { key: "$uuid", description: "Unique UUID v4", example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
    { key: "$short_id", description: "8-char random ID", example: "a7b2x9k1" },
    { key: "$random_email", description: "Random test email", example: "test.x7k2@testmail.com" },
    { key: "$random_phone_in", description: "Indian mobile number", example: "+919876543210" },
    { key: "$random_aadhaar", description: "Fake Aadhaar number", example: "1234 5678 9012" },
    { key: "$random_pan", description: "Fake PAN number", example: "ABCPD1234E" },
    { key: "$random_ifsc", description: "Fake IFSC code", example: "SBIN0001234" },
    { key: "$random_pincode", description: "Indian PIN code", example: "560001" },
    { key: "$today", description: "Today's date (YYYY-MM-DD)", example: "2026-04-03" },
    { key: "$iso_date", description: "Current ISO datetime", example: "2026-04-03T14:30:00Z" },
    { key: "$sequence", description: "Auto-incrementing number", example: "1, 2, 3..." },
    { key: "$xss_payload", description: "XSS test string", example: '<script>alert("XSS")</script>' },
    { key: "$sql_injection", description: "SQL injection test", example: "' OR 1=1 --" },
    { key: "$long_string", description: "256-char string", example: "AAAA...256 chars" },
    { key: "$empty", description: "Empty string", example: "(empty)" },
    { key: "$special_chars", description: "Special characters", example: "!@#$%^&*()" },
  ];
}
