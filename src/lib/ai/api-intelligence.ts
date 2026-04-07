// ===========================================
// TESTARA — AI-Powered API Testing Intelligence
// Makes API testing as smart as web testing
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

// ===== 1. GENERATE API TESTS FROM OPENAPI/SWAGGER SPEC =====
export async function generateApiTestsFromSpec(
  spec: string, // OpenAPI JSON or YAML string
  options?: { baseUrl?: string; authType?: string; focusEndpoints?: string[] }
): Promise<Array<{
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  assertions: Array<{ type: string; expected: string }>;
  category: "happy_path" | "negative" | "edge_case" | "security" | "performance";
  chained_from?: string;
}>> {
  const result = await callAI(
    `You are an expert API test engineer. Given an OpenAPI/Swagger specification, generate comprehensive API test cases. For EACH endpoint, generate:
1. Happy path test (valid request → expected response)
2. Negative test (invalid/missing fields → proper error response)
3. Auth test (missing/invalid auth → 401/403)
4. Edge case (boundary values, empty strings, max length, special characters)
5. If endpoints are related, create CHAINED tests (POST creates → GET retrieves → PUT updates → DELETE removes)

Return ONLY valid JSON array. Each test: {
  "name": "descriptive name",
  "method": "GET|POST|PUT|DELETE|PATCH",
  "url": "full URL with path params replaced",
  "headers": {"Content-Type": "application/json", ...},
  "body": "JSON string or null",
  "assertions": [{"type": "status_code|body_contains|json_path|response_time|header_exists", "expected": "value", "operator": "equals|contains|less_than|exists"}],
  "category": "happy_path|negative|edge_case|security|performance",
  "chained_from": "name of previous test if this depends on it, or null",
  "extract": [{"variable": "var_name", "source": "body", "path": "$.id"}]
}`,
    `OpenAPI Spec:\n${spec.slice(0, 8000)}\n\n${options?.baseUrl ? `Base URL: ${options.baseUrl}` : ""}\n${options?.authType ? `Auth type: ${options.authType}` : ""}\n${options?.focusEndpoints ? `Focus on: ${options.focusEndpoints.join(", ")}` : "Generate for ALL endpoints"}`,
    3000
  );

  const parsed = parseJSON(result);
  logger.info("ai.api_tests_generated", { count: Array.isArray(parsed) ? parsed.length : 0 });
  return (Array.isArray(parsed) ? parsed : []) as ReturnType<typeof generateApiTestsFromSpec> extends Promise<infer T> ? T : never;
}

// ===== 2. SUGGEST ASSERTIONS FROM API RESPONSE =====
export async function suggestAssertions(
  method: string,
  url: string,
  statusCode: number,
  responseBody: string,
  responseHeaders: Record<string, string>,
  responseTime: number
): Promise<Array<{ type: string; target?: string; expected: string; operator: string; reason: string }>> {
  const result = await callAI(
    `You are an API testing expert. Given an API response, suggest the MOST IMPORTANT assertions to add. Focus on:
1. Status code verification
2. Response time thresholds
3. Required fields in response body (don't assert on dynamic values like timestamps/UUIDs unless checking format)
4. Data type verification (is "age" a number? is "email" a string with @?)
5. Business logic validation (if status is "active", certain fields should exist)
6. Security checks (no sensitive data leaked, proper headers)
Return ONLY valid JSON array of assertions.`,
    `Method: ${method}\nURL: ${url}\nStatus: ${statusCode}\nResponse time: ${responseTime}ms\nHeaders: ${JSON.stringify(responseHeaders)}\nBody (first 2000 chars): ${responseBody.slice(0, 2000)}`,
    800
  );

  return (parseJSON(result) as Array<Record<string, string>>) || [];
}

// ===== 3. GENERATE REQUEST CHAIN FROM DESCRIPTION =====
export async function generateRequestChain(
  description: string,
  baseUrl: string,
  knownEndpoints?: string[]
): Promise<Array<{
  order: number;
  name: string;
  method: string;
  url: string;
  body?: string;
  headers: Record<string, string>;
  extract?: Array<{ variable: string; source: string; path: string }>;
  assertions: Array<{ type: string; expected: string }>;
  depends_on?: string;
}>> {
  const result = await callAI(
    `You are an API test engineer designing a chained API test flow. Create an ordered sequence of API calls where each call may use data extracted from previous calls.
Use {{variable_name}} syntax for extracted values. Return ONLY valid JSON array.`,
    `Goal: ${description}\nBase URL: ${baseUrl}\n${knownEndpoints ? `Known endpoints:\n${knownEndpoints.join("\n")}` : ""}\n\nGenerate a complete request chain as JSON array: [{order, name, method, url, body, headers, extract: [{variable, source:"body|header", path:"$.field"}], assertions, depends_on}]`,
    1500
  );

  return (parseJSON(result) as Array<Record<string, unknown>>) as ReturnType<typeof generateRequestChain> extends Promise<infer T> ? T : never || [];
}

// ===== 4. GENERATE TEST DATA FOR API REQUEST =====
export async function generateApiTestData(
  method: string,
  url: string,
  schema?: string, // JSON Schema of request body
  count?: number
): Promise<{ valid: Array<Record<string, unknown>>; invalid: Array<{ data: Record<string, unknown>; reason: string }> }> {
  const result = await callAI(
    `You are a test data engineer. Generate valid AND invalid request bodies for an API endpoint.
Valid data: realistic, diverse values that should be accepted.
Invalid data: each with a specific reason why it should be rejected (missing required field, wrong type, too long, etc.)
Return JSON: { "valid": [{},...], "invalid": [{"data":{}, "reason":"missing email field"}, ...] }`,
    `${method} ${url}\n${schema ? `Request body schema:\n${schema}` : "No schema provided — infer from endpoint URL and method."}\nGenerate ${count || 5} valid and ${count || 5} invalid payloads.`,
    1500
  );

  return (parseJSON(result) as { valid: Array<Record<string, unknown>>; invalid: Array<{ data: Record<string, unknown>; reason: string }> }) || { valid: [], invalid: [] };
}

// ===== 5. DETECT API ANOMALIES ACROSS RUNS =====
export function detectApiAnomalies(
  history: Array<{ url: string; status: number; responseTime: number; timestamp: string; bodySize: number }>
): Array<{ endpoint: string; anomaly: string; severity: "critical" | "warning" | "info"; detail: string }> {
  // Rule-based (instant, $0) — no AI call needed
  const anomalies: Array<{ endpoint: string; anomaly: string; severity: "critical" | "warning" | "info"; detail: string }> = [];

  // Group by endpoint
  const byEndpoint: Record<string, typeof history> = {};
  for (const h of history) {
    if (!byEndpoint[h.url]) byEndpoint[h.url] = [];
    byEndpoint[h.url].push(h);
  }

  for (const [endpoint, runs] of Object.entries(byEndpoint)) {
    if (runs.length < 3) continue;

    const times = runs.map(r => r.responseTime);
    const avg = times.reduce((s, t) => s + t, 0) / times.length;
    const latest = times[0];

    // Response time degradation
    if (latest > avg * 2 && latest > 500) {
      anomalies.push({ endpoint, anomaly: "response_time_spike", severity: "warning",
        detail: `Latest: ${latest}ms vs average ${Math.round(avg)}ms (${Math.round((latest / avg - 1) * 100)}% slower)` });
    }

    // Increasing response times trend
    if (times.length >= 5) {
      const recentAvg = times.slice(0, 3).reduce((s, t) => s + t, 0) / 3;
      const olderAvg = times.slice(-3).reduce((s, t) => s + t, 0) / 3;
      if (recentAvg > olderAvg * 1.5 && recentAvg > 300) {
        anomalies.push({ endpoint, anomaly: "performance_degradation", severity: "warning",
          detail: `Response time trending up: ${Math.round(olderAvg)}ms → ${Math.round(recentAvg)}ms` });
      }
    }

    // Status code changes
    const statuses = runs.map(r => r.status);
    const latestStatus = statuses[0];
    const previousStatus = statuses[1];
    if (latestStatus !== previousStatus && latestStatus >= 400) {
      anomalies.push({ endpoint, anomaly: "status_change", severity: latestStatus >= 500 ? "critical" : "warning",
        detail: `Status changed from ${previousStatus} to ${latestStatus}` });
    }

    // Response size anomaly
    const sizes = runs.map(r => r.bodySize);
    const avgSize = sizes.reduce((s, t) => s + t, 0) / sizes.length;
    const latestSize = sizes[0];
    if (latestSize > 0 && Math.abs(latestSize - avgSize) > avgSize * 0.5 && avgSize > 100) {
      anomalies.push({ endpoint, anomaly: "response_size_change", severity: "info",
        detail: `Body size: ${latestSize} bytes vs average ${Math.round(avgSize)} bytes` });
    }
  }

  return anomalies.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });
}

// ===== 6. CONTRACT TESTING — COMPARE RESPONSE VS SCHEMA =====
export async function validateApiContract(
  method: string,
  url: string,
  expectedSchema: string, // JSON Schema or example response
  actualResponse: string,
  actualStatus: number
): Promise<{ valid: boolean; violations: Array<{ field: string; expected: string; actual: string; severity: string }> }> {
  const result = await callAI(
    `You are an API contract testing expert. Compare the actual API response against the expected schema/contract. Identify every violation: missing fields, wrong types, unexpected fields, changed formats.
Return JSON: { "valid": bool, "violations": [{"field":"path.to.field", "expected":"string", "actual":"number or missing", "severity":"breaking|warning|info"}] }`,
    `${method} ${url} → Status: ${actualStatus}\n\nExpected schema/contract:\n${expectedSchema.slice(0, 2000)}\n\nActual response:\n${actualResponse.slice(0, 2000)}`,
    600
  );

  return (parseJSON(result) as { valid: boolean; violations: Array<{ field: string; expected: string; actual: string; severity: string }> }) || { valid: true, violations: [] };
}
