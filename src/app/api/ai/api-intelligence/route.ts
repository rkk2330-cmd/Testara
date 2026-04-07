import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";

// POST /api/ai/api-intelligence — AI-powered API testing functions
export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "use_ai_generator" });
  if (!auth) return NextResponse.json({ error }, { status });

  const body = await request.json().catch(() => ({}));
  const { action } = body;

  const {
    generateApiTestsFromSpec, suggestAssertions, generateRequestChain,
    generateApiTestData, detectApiAnomalies, validateApiContract,
  } = await import("@/lib/ai/api-intelligence");

  switch (action) {
    case "generate_from_spec": {
      const tests = await generateApiTestsFromSpec(body.spec, body.options);
      return NextResponse.json({ data: { tests, count: tests.length } });
    }
    case "suggest_assertions": {
      const assertions = await suggestAssertions(body.method, body.url, body.statusCode, body.responseBody, body.responseHeaders || {}, body.responseTime || 0);
      return NextResponse.json({ data: { assertions } });
    }
    case "generate_chain": {
      const chain = await generateRequestChain(body.description, body.baseUrl, body.knownEndpoints);
      return NextResponse.json({ data: { chain } });
    }
    case "generate_test_data": {
      const testData = await generateApiTestData(body.method, body.url, body.schema, body.count);
      return NextResponse.json({ data: testData });
    }
    case "detect_anomalies": {
      const anomalies = detectApiAnomalies(body.history || []);
      return NextResponse.json({ data: { anomalies } });
    }
    case "validate_contract": {
      const result = await validateApiContract(body.method, body.url, body.expectedSchema, body.actualResponse, body.actualStatus);
      return NextResponse.json({ data: result });
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${action}. Valid: generate_from_spec, suggest_assertions, generate_chain, generate_test_data, detect_anomalies, validate_contract` }, { status: 400 });
  }
});
