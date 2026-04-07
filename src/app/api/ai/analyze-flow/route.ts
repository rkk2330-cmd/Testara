import { withHandler } from "@/lib/core";
import { postProcessTests } from "@/lib/ai/post-processor";
import { checkUsageLimit, usageLimitResponse } from "@/lib/security/usage-meter";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { checkRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { detectDomain } from "@/lib/data/domain-intelligence";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// POST /api/ai/analyze-flow — analyze multiple screenshots as a user flow
export const POST = withHandler(async (request: NextRequest) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase, { requiredPermission: "use_ai_generator" });
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const limit = checkRateLimit(user.id, "ai_generation");
  if (!limit.allowed) return NextResponse.json(rateLimitResponse(limit.remaining, limit.resetIn), { status: 429 });

    // Usage limit check
    const { data: profile } = await supabase.from("users").select("org_id").eq("id", user.id).single();
    if (profile?.org_id) {
      const usage = await checkUsageLimit(supabase, profile.org_id, "ai_generations");
      if (!usage.allowed) return NextResponse.json(usageLimitResponse(usage.used, usage.limit, usage.plan, "AI generation"), { status: 403 });
    }

  const formData = await request.formData();
  const projectId = formData.get("project_id") as string;
  const platform = (formData.get("platform") as string) || "web"; // "web" | "mobile" | "mainframe"
  const flowDescription = (formData.get("flow_description") as string) || "";
  const depth = (formData.get("depth") as string) || "thorough";

  // Collect all uploaded screenshots
  const screenshots: Array<{ name: string; base64: string; mediaType: string }> = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("screenshot") && value instanceof File) {
      const bytes = await value.arrayBuffer();
      screenshots.push({
        name: value.name,
        base64: Buffer.from(bytes).toString("base64"),
        mediaType: value.type as string,
      });
    }
  }

  if (screenshots.length === 0) {
    return NextResponse.json({ error: "At least 1 screenshot is required" }, { status: 400 });
  }

  // Detect domain from project context
  let domainContext = "";
  if (projectId) {
    const { data: project } = await supabase.from("projects").select("name, base_url").eq("id", projectId).single();
    const { data: tests } = await supabase.from("test_cases").select("title").eq("project_id", projectId).limit(10);
    if (project) {
      const detection = detectDomain({
        project_name: project.name || "",
        base_url: project.base_url || "",
        existing_test_titles: (tests || []).map((t: Record<string, unknown>) => t.title),
        existing_field_labels: [],
      });
      if (detection.confidence >= 30 && detection.profile) {
        domainContext = `\nDomain: ${detection.profile.name} (${detection.confidence}% confidence). ${detection.profile.description}`;
        domainContext += `\nCommon fields: ${detection.profile.fields.map(f => `${f.name} (${f.example})`).slice(0, 6).join(", ")}`;
      }
    }
  }

  // Platform-specific instructions
  const platformInstructions: Record<string, string> = {
    web: `These are screenshots of a web application. Identify: URLs, form fields, buttons, navigation elements, links, tables, modals. Generate CSS selectors and XPath for each interactive element.`,
    mobile: `These are screenshots of a mobile application (iOS or Android). Identify: touch targets, swipe areas, navigation bars, tab bars, input fields, toggles, lists. Use accessibility IDs and content-desc for element identification. Consider: screen transitions, gesture-based interactions, keyboard handling, orientation changes.`,
    mainframe: `These are screenshots of a mainframe terminal (3270/5250 green screen). Identify: field positions by row:col, function key prompts (PF1-PF24), protected vs unprotected fields, screen names/IDs, cursor positions. Generate test steps using mainframe_type, mainframe_send_key, and mainframe_assert actions.`,
  };

  // Build multi-image message content
  const imageContent: Array<Record<string, unknown>> = screenshots.map((s, idx) => ([
    {
      type: "image",
      source: { type: "base64", media_type: s.mediaType, data: s.base64 },
    },
    {
      type: "text",
      text: `[Screen ${idx + 1} of ${screenshots.length}: ${s.name}]`,
    },
  ])).flat();

  imageContent.push({
    type: "text",
    text: `Analyze these ${screenshots.length} screenshots as a sequential user flow.
${flowDescription ? `Flow description: "${flowDescription}"` : "Infer the user flow from the screen sequence."}
${domainContext}

Platform: ${platform.toUpperCase()}
${platformInstructions[platform] || platformInstructions.web}

Generate comprehensive test cases covering this entire flow. Output ONLY valid JSON:
[{
  "title": "Test case title",
  "description": "What this test verifies",
  "type": "happy_path|negative|edge_case|security|accessibility",
  "priority": "critical|high|medium|low",
  "preconditions": "What must be true before this test runs",
  "postconditions": "Expected state after test completes",
  "screen_range": "Screen 1-3",
  "steps": [{
    "order_index": 1,
    "action_type": "${platform === 'mainframe' ? 'mainframe_connect|mainframe_type|mainframe_send_key|mainframe_assert' : 'navigate|click|type|assert_text|assert_visible|scroll|wait|swipe'}",
    "target": {
      "selector": "${platform === 'mainframe' ? 'row:col or field_label' : 'CSS selector or accessibility ID'}",
      "fallback_selectors": {},
      "description": "Human-readable element description"
    },
    "input_data": "value if applicable",
    "expected_result": "what should happen",
    "screen_reference": "Screen N"
  }],
  "test_data": [{"variable": "{{username}}", "sample_value": "test@example.com", "data_type": "email"}],
  "confidence": 85
}]

Generate ${depth === "quick" ? "3-5" : "8-15"} test cases. Include happy paths, negative cases, edge cases${depth === "thorough" ? ", security checks (XSS/SQL injection in inputs), and accessibility assertions" : ""}.`,
  });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: depth === "quick" ? 3000 : 6000,
      system: `You are Testara AI, a world-class QA engineer who analyzes application screenshots to generate comprehensive, executable test cases. You understand web, mobile, and mainframe interfaces. You identify every interactive element, infer user flows, and generate tests with proper selectors and assertions. Output ONLY valid JSON.`,
      messages: [{ role: "user", content: imageContent }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const rawTests = JSON.parse(cleaned);
    const { tests: generatedTests, mix } = postProcessTests(rawTests, "TC");

    // Store generation record
    await supabase.from("ai_generations").insert({
      project_id: projectId || null,
      input_type: "flow_screenshots",
      input_data: JSON.stringify({ screenshot_count: screenshots.length, platform, flow_description: flowDescription }),
      generated_tests: generatedTests,
      status: "completed",
      tokens_used: response.usage?.output_tokens || 0,
      created_by: user.id,
    });

    return NextResponse.json({
      data: {
        tests: generatedTests,
        test_count: generatedTests.length,
        screenshots_analyzed: screenshots.length,
        platform,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Flow analysis failed: " + (error as Error).message }, { status: 500 });
  }
}
