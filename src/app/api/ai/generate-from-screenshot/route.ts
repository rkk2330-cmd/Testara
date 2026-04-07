import { withHandler } from "@/lib/core";
import { checkUsageLimit, usageLimitResponse } from "@/lib/security/usage-meter";
import { checkRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// POST /api/ai/generate-from-screenshot — analyze screenshot and generate tests
export const POST = withHandler(async (request: NextRequest) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase, { requiredPermission: "use_ai_generator" });
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

    // Rate limit
    const limit = checkRateLimit(user.id, "ai_generation");
    if (!limit.allowed) return NextResponse.json(rateLimitResponse(limit.remaining, limit.resetIn), { status: 429 });

    // Usage limit check
    const { data: profile } = await supabase.from("users").select("org_id").eq("id", user.id).single();
    if (profile?.org_id) {
      const usage = await checkUsageLimit(supabase, profile.org_id, "ai_generations");
      if (!usage.allowed) return NextResponse.json(usageLimitResponse(usage.used, usage.limit, usage.plan, "AI generation"), { status: 403 });
    }

  const formData = await request.formData();
  const file = formData.get("screenshot") as File | null;
  const projectId = formData.get("project_id") as string;

  if (!file || !projectId) {
    return NextResponse.json({ error: "screenshot file and project_id are required" }, { status: 400 });
  }

  // Convert file to base64
  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif";

  // Create generation record
  const { data: generation } = await supabase
    .from("ai_generations")
    .insert({
      project_id: projectId,
      input_type: "screenshot",
      input_data: `Screenshot: ${file.name} (${file.size} bytes)`,
      status: "generating",
      created_by: user.id,
    })
    .select()
    .single();

  try {
    // Send screenshot to Claude Vision
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: `You are Testara AI, an expert QA engineer. Analyze this screenshot of a web application and generate comprehensive test cases.
Identify all interactive elements, forms, buttons, navigation, and user flows visible in the screenshot.
Generate 3-8 test cases covering happy paths, negative cases, and edge cases.
Output ONLY valid JSON, no markdown.`,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: `Analyze this screenshot and generate test cases as JSON: [{ "title", "description", "type": "happy_path|negative|edge_case", "steps": [{ "order_index", "action_type", "target": { "selector": "likely CSS selector", "fallback_selectors": {}, "description": "what element" }, "input_data", "expected_result" }], "confidence": 0-100 }]`,
          },
        ],
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const generatedTests = JSON.parse(cleaned);

    // Update generation record
    await supabase
      .from("ai_generations")
      .update({ generated_tests: generatedTests, status: "completed", tokens_used: response.usage?.output_tokens || 0 })
      .eq("id", generation?.id);

    return NextResponse.json({
      data: {
        generation_id: generation?.id,
        tests: generatedTests,
        test_count: generatedTests.length,
      },
    });
  } catch (error) {
    await supabase.from("ai_generations").update({ status: "rejected" }).eq("id", generation?.id);
    return NextResponse.json({ error: "Failed to analyze screenshot: " + (error as Error).message }, { status: 500 });
  }
}
