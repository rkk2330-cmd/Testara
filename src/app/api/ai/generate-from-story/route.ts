import { GenerateFromStorySchema } from "@/lib/core/validation";
import { withHandler } from "@/lib/core";
import { postProcessTests } from "@/lib/ai/post-processor";
import { ContextRetriever } from "@/lib/rag/retriever";
import { checkUsageLimit, usageLimitResponse } from "@/lib/security/usage-meter";
import { checkRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { generateTestsFromStory } from "@/lib/ai/claude";

export const POST = withHandler(async (request: NextRequest) {
  try {
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

    const { user_story, project_id, context, depth } = await request.json();
    if (!user_story || !project_id) {
      return NextResponse.json({ error: "user_story and project_id are required" }, { status: 400 });
    }

    const aiDepth = depth || "quick";

    // Create AI generation record
    const { data: generation, error: genError } = await supabase
      .from("ai_generations")
      .insert({
        project_id,
        input_type: "user_story",
        input_data: user_story,
        status: "generating",
        created_by: user.id,
      })
      .select()
      .single();

    if (genError) throw genError;

    // Generate tests with Claude
    const generatedTests = await generateTestsFromStory(user_story, context, aiDepth);

    // Update record
    await supabase
      .from("ai_generations")
      .update({ generated_tests: generatedTests, status: "completed", tokens_used: response?.usage?.output_tokens || 0 })
      .eq("id", generation.id);

    return NextResponse.json({
      data: {
        generation_id: generation.id,
        tests: generatedTests,
        test_count: generatedTests.length,
      },
    });
  } catch (error) {
    console.error("AI generation error:", error);
    return NextResponse.json({ error: "Failed to generate tests" }, { status: 500 });
  }
}
