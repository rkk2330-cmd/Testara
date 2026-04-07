import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import {
  suggestNextStep, validateTestLogic, analyzeFailure,
  generateInsights, generateExecutiveSummary, detectCoverageGaps,
  detectFlakyTests, prioritizeTests, analyzeProjectUrl, getHealPatterns,
} from "@/lib/ai/intelligence";

// POST /api/ai/intelligence — dispatch to different AI functions
export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "use_ai_generator" });
  if (!auth) return NextResponse.json({ error }, { status });

  const body = await request.json().catch(() => ({}));
  const { action } = body;

  switch (action) {
    // Editor: suggest next step
    case "suggest_step": {
      const suggestions = await suggestNextStep(body.steps || [], body.pageUrl || "");
      return NextResponse.json({ data: { suggestions } });
    }

    // Editor: validate test logic
    case "validate_logic": {
      const issues = await validateTestLogic(body.steps || []);
      return NextResponse.json({ data: { issues } });
    }

    // Run detail: analyze failure
    case "analyze_failure": {
      const analysis = await analyzeFailure(
        body.testTitle || "", body.failedStep || {},
        body.recentHistory || [], body.domContext
      );
      return NextResponse.json({ data: analysis });
    }

    // Dashboard: get AI insights
    case "insights": {
      const insights = await generateInsights(body.stats || {});
      return NextResponse.json({ data: { insights } });
    }

    // Reports: executive summary
    case "executive_summary": {
      const summary = await generateExecutiveSummary(body.stats || {}, body.topFailures || []);
      return NextResponse.json({ data: { summary } });
    }

    // Coverage: detect gaps
    case "coverage_gaps": {
      const gaps = await detectCoverageGaps(body.projectUrl || "", body.existingTests || []);
      return NextResponse.json({ data: { gaps } });
    }

    // Flaky: detect flaky tests
    case "detect_flaky": {
      const flaky = await detectFlakyTests(supabase);
      return NextResponse.json({ data: { flaky } });
    }

    // CI/CD: prioritize tests
    case "prioritize": {
      const prioritized = prioritizeTests(body.tests || [], body.changedFiles);
      return NextResponse.json({ data: { prioritized } });
    }

    // Onboarding: analyze project URL
    case "analyze_url": {
      const analysis = await analyzeProjectUrl(body.url || "");
      return NextResponse.json({ data: analysis });
    }

    // Object Repo: heal patterns
    case "heal_patterns": {
      const patterns = await getHealPatterns(supabase, body.projectId || "");
      return NextResponse.json({ data: { patterns } });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
});
