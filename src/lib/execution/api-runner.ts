// ===========================================
// TESTARA — API Test Execution Engine
// The Node.js equivalent of Rest Assured
// Handles: HTTP methods, auth, assertions,
// response chaining, schema validation
// ===========================================

export interface ApiTestStep {
  id: string;
  order_index: number;
  name: string;

  // Request
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  url: string;                             // Supports {{variables}}
  headers: Record<string, string>;
  body?: string;                           // JSON string, supports {{variables}}
  query_params?: Record<string, string>;

  // Auth
  auth?: {
    type: "bearer" | "basic" | "api_key" | "none";
    token?: string;                        // For bearer
    username?: string;                     // For basic
    password?: string;                     // For basic
    key_name?: string;                     // For api_key (header name)
    key_value?: string;                    // For api_key (header value)
  };

  // Assertions
  assertions: ApiAssertion[];

  // Extraction (for chaining — pull values from response for next step)
  extract?: Array<{
    variable: string;                      // Name to store as: {{extracted_user_id}}
    source: "body" | "header" | "status" | "response_time";
    path?: string;                         // JSONPath for body: "data.user.id"
  }>;

  // Config
  timeout_ms?: number;
  retry_count?: number;
  delay_before_ms?: number;
}

export interface ApiAssertion {
  type: "status_code" | "body_contains" | "body_equals" | "body_json_path" |
        "header_exists" | "header_equals" | "response_time" | "body_schema" |
        "body_not_contains" | "body_array_length" | "body_type";
  target?: string;       // JSONPath for body, header name for headers
  expected: string;      // Expected value
  operator?: "equals" | "not_equals" | "contains" | "not_contains" |
             "greater_than" | "less_than" | "matches_regex";
}

export interface ApiStepResult {
  step_id: string;
  step_name: string;
  status: "passed" | "failed";
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response: {
    status_code: number;
    status_text: string;
    headers: Record<string, string>;
    body: string;
    body_json?: Record<string, unknown>;
    response_time_ms: number;
    size_bytes: number;
  };
  assertions: Array<{
    type: string;
    expected: string;
    actual: string;
    passed: boolean;
    message: string;
  }>;
  extracted_variables: Record<string, string>;
  error?: string;
  duration_ms: number;
}

// ===== EXECUTE SINGLE API STEP =====
export async function executeApiStep(
  step: ApiTestStep,
  variables: Record<string, string> = {}
): Promise<ApiStepResult> {
  const startTime = Date.now();
  const resolvedUrl = resolveVars(step.url, variables);
  const resolvedHeaders = resolveHeaderVars(step.headers, variables);
  const resolvedBody = step.body ? resolveVars(step.body, variables) : undefined;

  // Apply auth
  if (step.auth) {
    switch (step.auth.type) {
      case "bearer":
        resolvedHeaders["Authorization"] = `Bearer ${resolveVars(step.auth.token || "", variables)}`;
        break;
      case "basic": {
        const creds = Buffer.from(`${step.auth.username}:${step.auth.password}`).toString("base64");
        resolvedHeaders["Authorization"] = `Basic ${creds}`;
        break;
      }
      case "api_key":
        resolvedHeaders[step.auth.key_name || "X-API-Key"] = resolveVars(step.auth.key_value || "", variables);
        break;
    }
  }

  // Apply query params
  let finalUrl = resolvedUrl;
  if (step.query_params) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(step.query_params)) {
      params.append(k, resolveVars(v, variables));
    }
    finalUrl += (finalUrl.includes("?") ? "&" : "?") + params.toString();
  }

  // Add delay if configured
  if (step.delay_before_ms) {
    await new Promise(r => setTimeout(r, step.delay_before_ms));
  }

  try {
    const fetchStart = Date.now();
    const fetchOptions: RequestInit = {
      method: step.method,
      headers: resolvedHeaders,
      signal: AbortSignal.timeout(step.timeout_ms || 30000),
    };
    if (resolvedBody && ["POST", "PUT", "PATCH"].includes(step.method)) {
      fetchOptions.body = resolvedBody;
      if (!resolvedHeaders["Content-Type"]) {
        resolvedHeaders["Content-Type"] = "application/json";
      }
    }

    const res = await fetch(finalUrl, fetchOptions);
    const responseTime = Date.now() - fetchStart;
    const bodyText = await res.text();

    let bodyJson: Record<string, unknown> = null;
    try { bodyJson = JSON.parse(bodyText); } catch {}

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { responseHeaders[k] = v; });

    // Run assertions
    const assertionResults = step.assertions.map(assertion =>
      runAssertion(assertion, res.status, bodyText, bodyJson, responseHeaders, responseTime)
    );

    const allPassed = assertionResults.every(a => a.passed);

    // Extract variables for chaining
    const extracted: Record<string, string> = {};
    if (step.extract) {
      for (const ext of step.extract) {
        if (ext.source === "body" && ext.path && bodyJson) {
          extracted[ext.variable] = getJsonPath(bodyJson, ext.path);
        } else if (ext.source === "header" && ext.path) {
          extracted[ext.variable] = responseHeaders[ext.path.toLowerCase()] || "";
        } else if (ext.source === "status") {
          extracted[ext.variable] = String(res.status);
        } else if (ext.source === "response_time") {
          extracted[ext.variable] = String(responseTime);
        }
      }
    }

    return {
      step_id: step.id,
      step_name: step.name,
      status: allPassed ? "passed" : "failed",
      request: { method: step.method, url: finalUrl, headers: resolvedHeaders, body: resolvedBody },
      response: {
        status_code: res.status,
        status_text: res.statusText,
        headers: responseHeaders,
        body: bodyText.slice(0, 10000),
        body_json: bodyJson,
        response_time_ms: responseTime,
        size_bytes: bodyText.length,
      },
      assertions: assertionResults,
      extracted_variables: extracted,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    return {
      step_id: step.id,
      step_name: step.name,
      status: "failed",
      request: { method: step.method, url: finalUrl, headers: resolvedHeaders, body: resolvedBody },
      response: {
        status_code: 0, status_text: "Error", headers: {},
        body: (error as Error).message, response_time_ms: Date.now() - startTime,
        size_bytes: 0,
      },
      assertions: [],
      extracted_variables: {},
      error: (error as Error).message,
      duration_ms: Date.now() - startTime,
    };
  }
}

// ===== EXECUTE API TEST CHAIN (multiple steps) =====
export async function executeApiChain(
  steps: ApiTestStep[],
  initialVariables: Record<string, string> = {}
): Promise<{ results: ApiStepResult[]; variables: Record<string, string>; passed: boolean }> {
  const variables = { ...initialVariables };
  const results: ApiStepResult[] = [];
  let chainPassed = true;

  const sorted = [...steps].sort((a, b) => a.order_index - b.order_index);

  for (const step of sorted) {
    const result = await executeApiStep(step, variables);
    results.push(result);

    // Merge extracted variables for next step
    Object.assign(variables, result.extracted_variables);

    if (result.status === "failed") {
      chainPassed = false;
      // Stop chain on failure (configurable later)
      break;
    }
  }

  return { results, variables, passed: chainPassed };
}

// ===== ASSERTION ENGINE =====
function runAssertion(
  assertion: ApiAssertion,
  statusCode: number,
  bodyText: string,
  bodyJson: Record<string, unknown>,
  headers: Record<string, string>,
  responseTimeMs: number
): { type: string; expected: string; actual: string; passed: boolean; message: string } {
  let actual = "";
  let passed = false;

  switch (assertion.type) {
    case "status_code":
      actual = String(statusCode);
      passed = compare(actual, assertion.expected, assertion.operator || "equals");
      return { type: assertion.type, expected: assertion.expected, actual, passed,
        message: passed ? `Status ${statusCode} matches` : `Expected status ${assertion.expected}, got ${statusCode}` };

    case "body_contains":
      actual = bodyText.slice(0, 200);
      passed = bodyText.includes(assertion.expected);
      return { type: assertion.type, expected: assertion.expected, actual, passed,
        message: passed ? "Body contains expected text" : `Body does not contain "${assertion.expected}"` };

    case "body_not_contains":
      actual = bodyText.slice(0, 200);
      passed = !bodyText.includes(assertion.expected);
      return { type: assertion.type, expected: assertion.expected, actual, passed,
        message: passed ? "Body correctly excludes text" : `Body unexpectedly contains "${assertion.expected}"` };

    case "body_equals":
      actual = bodyText.trim().slice(0, 200);
      passed = bodyText.trim() === assertion.expected;
      return { type: assertion.type, expected: assertion.expected, actual, passed,
        message: passed ? "Body matches exactly" : "Body does not match expected value" };

    case "body_json_path":
      if (!bodyJson) {
        return { type: assertion.type, expected: assertion.expected, actual: "(not JSON)", passed: false,
          message: "Response body is not valid JSON" };
      }
      actual = String(getJsonPath(bodyJson, assertion.target || ""));
      passed = compare(actual, assertion.expected, assertion.operator || "equals");
      return { type: assertion.type, expected: assertion.expected, actual, passed,
        message: passed ? `${assertion.target} = ${actual}` : `Expected ${assertion.target} to be ${assertion.expected}, got ${actual}` };

    case "body_array_length":
      if (!bodyJson) {
        return { type: assertion.type, expected: assertion.expected, actual: "(not JSON)", passed: false,
          message: "Response body is not valid JSON" };
      }
      const arr = assertion.target ? getJsonPath(bodyJson, assertion.target) : bodyJson;
      actual = String(Array.isArray(arr) ? arr.length : 0);
      passed = compare(actual, assertion.expected, assertion.operator || "equals");
      return { type: assertion.type, expected: assertion.expected, actual, passed,
        message: passed ? `Array length ${actual} matches` : `Expected length ${assertion.expected}, got ${actual}` };

    case "body_type":
      if (!bodyJson) {
        return { type: assertion.type, expected: assertion.expected, actual: "string", passed: false,
          message: "Response body is not valid JSON" };
      }
      const val = assertion.target ? getJsonPath(bodyJson, assertion.target) : bodyJson;
      actual = typeof val;
      passed = actual === assertion.expected;
      return { type: assertion.type, expected: assertion.expected, actual, passed,
        message: passed ? `Type is ${actual}` : `Expected type ${assertion.expected}, got ${actual}` };

    case "header_exists":
      actual = headers[assertion.target?.toLowerCase() || ""] ? "exists" : "missing";
      passed = actual === "exists";
      return { type: assertion.type, expected: "exists", actual, passed,
        message: passed ? `Header "${assertion.target}" exists` : `Header "${assertion.target}" not found` };

    case "header_equals":
      actual = headers[assertion.target?.toLowerCase() || ""] || "";
      passed = compare(actual, assertion.expected, assertion.operator || "equals");
      return { type: assertion.type, expected: assertion.expected, actual, passed,
        message: passed ? `Header "${assertion.target}" matches` : `Expected header "${assertion.target}" = "${assertion.expected}", got "${actual}"` };

    case "response_time":
      actual = String(responseTimeMs);
      passed = compare(actual, assertion.expected, assertion.operator || "less_than");
      return { type: assertion.type, expected: `< ${assertion.expected}ms`, actual: `${actual}ms`, passed,
        message: passed ? `Response time ${actual}ms within limit` : `Response time ${actual}ms exceeds ${assertion.expected}ms` };

    default:
      return { type: assertion.type, expected: assertion.expected, actual: "unknown", passed: false,
        message: `Unknown assertion type: ${assertion.type}` };
  }
}

// ===== HELPERS =====
function resolveVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] || match);
}

function resolveHeaderVars(headers: Record<string, string>, vars: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    resolved[k] = resolveVars(v, vars);
  }
  return resolved;
}

function getJsonPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    // Handle array notation: items[0]
    const arrayMatch = key.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
    } else {
      current = current[key];
    }
  }
  return current;
}

function compare(actual: string, expected: string, operator: string): boolean {
  switch (operator) {
    case "equals": return actual === expected;
    case "not_equals": return actual !== expected;
    case "contains": return actual.includes(expected);
    case "not_contains": return !actual.includes(expected);
    case "greater_than": return parseFloat(actual) > parseFloat(expected);
    case "less_than": return parseFloat(actual) < parseFloat(expected);
    case "matches_regex": return new RegExp(expected).test(actual);
    default: return actual === expected;
  }
}
