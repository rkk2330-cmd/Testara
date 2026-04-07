import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";

// POST /api/ai/mainframe-intelligence — AI-powered mainframe testing functions
export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "access_mainframe" });
  if (!auth) return NextResponse.json({ error }, { status });

  const body = await request.json().catch(() => ({}));
  const { action } = body;

  const {
    analyzeScreen, generateMainframeFlow, mapScreenFields,
    detectScreenChanges, suggestRecovery, generateMainframeTestData,
  } = await import("@/lib/ai/mainframe-intelligence");

  switch (action) {
    case "analyze_screen": {
      const analysis = await analyzeScreen(body.screenText, body.dimensions);
      return NextResponse.json({ data: analysis });
    }
    case "generate_flow": {
      const flow = await generateMainframeFlow(body.goal, body.startScreen, body.knownScreens, body.credentials);
      return NextResponse.json({ data: { flow, stepCount: flow.length } });
    }
    case "map_fields": {
      const fields = await mapScreenFields(body.screenText, body.existingMappings);
      return NextResponse.json({ data: { fields } });
    }
    case "detect_changes": {
      const result = detectScreenChanges(body.expectedScreen, body.actualScreenText);
      return NextResponse.json({ data: result });
    }
    case "suggest_recovery": {
      const recovery = await suggestRecovery(body.currentScreen, body.expectedScreen, body.lastAction, body.errorMessage);
      return NextResponse.json({ data: recovery });
    }
    case "generate_test_data": {
      const testData = await generateMainframeTestData(body.screenFields, body.domain, body.count);
      return NextResponse.json({ data: testData });
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${action}. Valid: analyze_screen, generate_flow, map_fields, detect_changes, suggest_recovery, generate_test_data` }, { status: 400 });
  }
});
