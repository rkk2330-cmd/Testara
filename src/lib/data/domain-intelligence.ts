// ===========================================
// TESTARA — Domain Intelligence Engine
// Auto-detects domain from project signals
// and enriches AI prompts with domain knowledge
// ===========================================

import { DOMAIN_PROFILES, type DomainProfile } from "@/lib/data/engine";

// ===== DOMAIN DETECTION SIGNALS =====
// We analyze multiple signals to detect the domain automatically

interface ProjectSignals {
  project_name: string;
  base_url: string;
  existing_test_titles: string[];
  existing_field_labels: string[];
  page_content?: string;      // From crawled URL
  tags?: string[];
}

interface DomainDetectionResult {
  detected_domain: string;       // e.g. "healthcare_in"
  confidence: number;            // 0-100
  profile: DomainProfile | null;
  signals_used: string[];
  field_suggestions: Array<{
    name: string;
    reason: string;
    format: string;
    example: string;
  }>;
  data_rules: string[];          // Domain-specific data generation rules
}

// Keywords that indicate specific domains
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  healthcare_in: [
    "patient", "hospital", "doctor", "nurse", "medical", "health", "clinic",
    "diagnosis", "prescription", "aadhaar", "abha", "abdm", "hl7", "fhir",
    "ward", "icu", "opd", "ipd", "discharge", "admission", "lab", "pathology",
    "pharmacy", "appointment", "vital", "blood", "surgery", "ehr", "emr",
    "hipaa", "claim", "insurance", "uhid", "mrn",
  ],
  banking_in: [
    "bank", "account", "transaction", "transfer", "neft", "rtgs", "imps",
    "upi", "ifsc", "pan", "cheque", "deposit", "withdrawal", "loan",
    "emi", "interest", "savings", "current", "fd", "rd", "kyc",
    "credit", "debit", "statement", "balance", "passbook", "branch",
    "rbi", "nbfc", "mutual fund", "sip", "nominee",
  ],
  ecommerce: [
    "product", "cart", "checkout", "order", "shipping", "delivery",
    "catalog", "inventory", "price", "discount", "coupon", "payment",
    "return", "refund", "wishlist", "review", "rating", "seller",
    "buyer", "sku", "cod", "tracking", "invoice", "marketplace",
    "category", "brand", "stock", "warehouse",
  ],
  insurance: [
    "policy", "premium", "claim", "insured", "underwriting", "actuary",
    "coverage", "deductible", "endowment", "term", "life", "health",
    "motor", "fire", "marine", "reinsurance", "surrender", "maturity",
    "rider", "nominee", "beneficiary", "irda", "irdai", "sum assured",
    "proposal", "renewal",
  ],
  hrms: [
    "employee", "payroll", "salary", "attendance", "leave", "hr",
    "department", "designation", "joining", "resignation", "appraisal",
    "performance", "kra", "kpi", "onboarding", "offboarding", "pf",
    "esi", "gratuity", "ctc", "gross", "net", "deduction", "payslip",
    "shift", "overtime", "holiday", "timesheet", "recruitment",
  ],
};

// URL patterns that indicate domains
const URL_DOMAIN_PATTERNS: Record<string, RegExp[]> = {
  healthcare_in: [
    /hospital/i, /health/i, /patient/i, /medical/i, /clinic/i,
    /pharma/i, /care/i, /nha\.gov/i, /abdm/i, /ehr/i,
  ],
  banking_in: [
    /bank/i, /finance/i, /loan/i, /pay/i, /wallet/i,
    /trading/i, /invest/i, /insurance/i, /nbfc/i,
  ],
  ecommerce: [
    /shop/i, /store/i, /cart/i, /buy/i, /sell/i,
    /market/i, /commerce/i, /retail/i, /order/i,
  ],
  insurance: [
    /insur/i, /policy/i, /claim/i, /underw/i,
  ],
  hrms: [
    /hr/i, /payroll/i, /employee/i, /talent/i, /recruit/i,
    /workforce/i, /people/i,
  ],
};

// ===== DOMAIN DETECTION =====
export function detectDomain(signals: ProjectSignals): DomainDetectionResult {
  const scores: Record<string, { score: number; reasons: string[] }> = {};

  // Initialize scores
  for (const domainId of Object.keys(DOMAIN_KEYWORDS)) {
    scores[domainId] = { score: 0, reasons: [] };
  }

  // Signal 1: Project name analysis (weight: 3x)
  const nameLower = signals.project_name.toLowerCase();
  for (const [domainId, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const keyword of keywords) {
      if (nameLower.includes(keyword)) {
        scores[domainId].score += 3;
        scores[domainId].reasons.push(`Project name contains "${keyword}"`);
      }
    }
  }

  // Signal 2: URL analysis (weight: 2x)
  const urlLower = signals.base_url.toLowerCase();
  for (const [domainId, patterns] of Object.entries(URL_DOMAIN_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(urlLower)) {
        scores[domainId].score += 2;
        scores[domainId].reasons.push(`URL matches pattern: ${pattern.source}`);
      }
    }
  }

  // Signal 3: Existing test titles (weight: 2x per match)
  for (const title of signals.existing_test_titles) {
    const titleLower = title.toLowerCase();
    for (const [domainId, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      for (const keyword of keywords) {
        if (titleLower.includes(keyword)) {
          scores[domainId].score += 2;
          if (!scores[domainId].reasons.includes(`Test titles reference "${keyword}"`)) {
            scores[domainId].reasons.push(`Test titles reference "${keyword}"`);
          }
        }
      }
    }
  }

  // Signal 4: Field labels from existing tests/page (weight: 1x)
  for (const label of signals.existing_field_labels) {
    const labelLower = label.toLowerCase();
    for (const [domainId, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      for (const keyword of keywords) {
        if (labelLower.includes(keyword)) {
          scores[domainId].score += 1;
          if (!scores[domainId].reasons.includes(`Field label matches "${keyword}"`)) {
            scores[domainId].reasons.push(`Field label matches "${keyword}"`);
          }
        }
      }
    }
  }

  // Signal 5: Page content keywords (weight: 1x, capped at 10)
  if (signals.page_content) {
    const contentLower = signals.page_content.toLowerCase();
    for (const [domainId, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      let contentHits = 0;
      for (const keyword of keywords) {
        if (contentLower.includes(keyword) && contentHits < 10) {
          scores[domainId].score += 1;
          contentHits++;
        }
      }
      if (contentHits > 0) {
        scores[domainId].reasons.push(`Page content has ${contentHits} domain keywords`);
      }
    }
  }

  // Find the winner
  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b.score - a.score);

  const topDomain = sorted[0];
  const secondDomain = sorted[1];

  // Calculate confidence
  let confidence = 0;
  if (topDomain[1].score > 0) {
    // Confidence based on absolute score and gap to second place
    const gap = topDomain[1].score - (secondDomain?.[1].score || 0);
    confidence = Math.min(
      Math.round((topDomain[1].score / 15) * 60 + (gap / topDomain[1].score) * 40),
      98
    );
  }

  const detectedId = topDomain[1].score > 0 ? topDomain[0] : "unknown";
  const profile = DOMAIN_PROFILES.find(p => p.id === detectedId) || null;

  // Build field suggestions based on detected domain
  const fieldSuggestions = profile?.fields.map(f => ({
    name: f.name,
    reason: `Standard ${profile.name} field`,
    format: f.pattern || f.type,
    example: f.example,
  })) || [];

  // Build domain-specific data rules
  const dataRules = buildDataRules(detectedId);

  return {
    detected_domain: detectedId,
    confidence,
    profile,
    signals_used: topDomain[1].reasons,
    field_suggestions: fieldSuggestions,
    data_rules: dataRules,
  };
}

function buildDataRules(domainId: string): string[] {
  const rules: Record<string, string[]> = {
    healthcare_in: [
      "Aadhaar numbers must be 12 digits, cannot start with 0 or 1",
      "ABHA IDs are 14 digits or username@abdm format",
      "Blood groups must be one of: A+, A-, B+, B-, O+, O-, AB+, AB-",
      "Patient IDs typically follow format: UHID-XXXX or PAT-XXXX",
      "Phone numbers must be Indian format: +91 followed by 10 digits starting with 6-9",
      "Dates should be in DD/MM/YYYY format (Indian standard) or ISO",
      "Include mix of OPD and IPD patients for realistic data",
      "Sensitive fields (Aadhaar, medical records) must use fake but valid-format data",
    ],
    banking_in: [
      "Account numbers are 11-16 digits depending on bank",
      "IFSC codes follow format: 4 letters + 0 + 6 digits (e.g., SBIN0001234)",
      "PAN follows format: 5 letters + 4 digits + 1 letter (e.g., ABCPD1234E)",
      "UPI IDs follow format: username@bankcode (e.g., user@upi)",
      "Transaction amounts should include edge cases: 0, 0.01, very large amounts",
      "Include both savings and current account scenarios",
      "KYC status variations: verified, pending, rejected, expired",
      "Phone numbers must be Indian mobile format linked to accounts",
    ],
    ecommerce: [
      "Product prices should include: round numbers, decimals, very low (₹1), very high",
      "Coupon codes: valid, expired, already-used, minimum-not-met scenarios",
      "Shipping addresses should include: urban, rural, remote PIN codes",
      "Payment methods: UPI, credit card, debit card, COD, net banking, wallet",
      "Quantity edge cases: 0, 1, max allowed, negative numbers",
      "Include both registered and guest checkout scenarios",
      "Product names should be realistic with varying lengths",
      "PIN codes must be valid 6-digit Indian format",
    ],
    insurance: [
      "Policy numbers follow insurer-specific formats",
      "Sum assured ranges: ₹1 lakh to ₹5 crore for life, varies by type",
      "Premium amounts must be realistic for the policy type and sum",
      "Nominee relationships: spouse, child, parent, sibling, other",
      "Claim reasons should match the policy type (health: hospitalization, motor: accident)",
      "Include policies in various states: active, lapsed, surrendered, matured",
      "Ages must be within policy eligibility limits",
      "Include both individual and family floater scenarios",
    ],
    hrms: [
      "Employee IDs follow org-specific format (EMP-001, HR-2024-001, etc.)",
      "Salary ranges should be realistic for the designation level",
      "PF numbers follow format: XX/XXX/XXXXXXX/XXX/XXXXXXX",
      "Leave balances must not exceed policy limits",
      "Department and designation combinations must be logical",
      "Include employees at various stages: probation, confirmed, notice period",
      "Joining dates should not be future dates for active employees",
      "Include both salaried and contractual employee scenarios",
    ],
  };
  return rules[domainId] || [
    "Generate realistic data appropriate for the application context",
    "Include positive, negative, and edge case values",
    "Use locale-appropriate formats for names, phones, and addresses",
  ];
}

// ===== BUILD ENRICHED AI PROMPT =====
// This is the key function — it takes a basic user request
// and enriches it with domain intelligence for much better AI output

export function enrichAIPrompt(
  userPrompt: string,
  signals: ProjectSignals
): string {
  const detection = detectDomain(signals);

  let enriched = userPrompt;

  // Add domain context if detected with reasonable confidence
  if (detection.confidence >= 30 && detection.profile) {
    enriched += `\n\n--- DOMAIN CONTEXT (auto-detected: ${detection.profile.name}, ${detection.confidence}% confidence) ---`;
    enriched += `\nThis is a ${detection.profile.name} application (${detection.profile.description}).`;

    // Add relevant field patterns
    enriched += `\nDomain-specific data patterns:`;
    for (const field of detection.profile.fields.slice(0, 8)) {
      enriched += `\n  - ${field.name}: ${field.type}${field.options ? ` [${field.options.join(", ")}]` : ""}${field.pattern ? ` format: ${field.pattern}` : ""} (e.g., ${field.example})`;
    }

    // Add data rules
    enriched += `\n\nData quality rules for ${detection.profile.name}:`;
    for (const rule of detection.data_rules.slice(0, 5)) {
      enriched += `\n  - ${rule}`;
    }
  }

  // Add environment context
  if (signals.base_url) {
    enriched += `\n\nTarget URL: ${signals.base_url}`;
  }

  // Add existing test context for continuity
  if (signals.existing_test_titles.length > 0) {
    enriched += `\n\nExisting tests in this project: ${signals.existing_test_titles.slice(0, 5).join(", ")}`;
    enriched += `\n(Generate data that complements, not duplicates, existing coverage)`;
  }

  return enriched;
}
