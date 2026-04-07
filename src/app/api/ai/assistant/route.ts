import { AssistantMessageSchema } from "@/lib/core/validation";
import { authorize } from "@/lib/security/auth";
import { assistWithContext } from "@/lib/rag/enricher";
import { withHandler } from "@/lib/core";
import { checkRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export const POST = withHandler(async (request: NextRequest) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

    // Rate limit
    const limit = checkRateLimit(auth.user_id, "ai_assistant");
    if (!limit.allowed) return NextResponse.json(rateLimitResponse(limit.remaining, limit.resetIn), { status: 429 });

  const { message, context } = validate(AssistantMessageSchema, await request.json());
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

  // Fetch user's context: projects, recent tests, recent runs
  const { data: projects } = await supabase.from("projects").select("id, name").limit(5);
  const { data: recentTests } = await supabase.from("test_cases").select("id, title, status").order("created_at", { ascending: false }).limit(5);
  const { data: recentRuns } = await supabase.from("test_runs").select("id, status, created_at, test_cases(title)").order("created_at", { ascending: false }).limit(5);

  const systemContext = `You are Testara AI Assistant, embedded in a test automation platform. 
You help QA professionals create tests, debug failures, generate data, and improve their testing.

Current user context:
- Current page: ${context?.page || "unknown"}
- Projects: ${projects?.map(p => p.name).join(", ") || "none"}
- Recent tests: ${recentTests?.map(t => `${t.title} (${t.status})`).join(", ") || "none"}
- Recent runs: ${recentRuns?.map((r: Record<string, unknown>) => `${r.test_cases?.title}: ${r.status}`).join(", ") || "none"}

Be helpful, concise, and specific. If the user asks to create or generate something, explain what you'd do and suggest they use the relevant feature (AI Generator for tests, Test Data page for data). For debugging questions, ask which test failed and offer root cause analysis. Keep responses under 150 words unless the user asks for detail.`;

  try {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...(history || []),
      { role: "user" as const, content: message },
    ];

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: systemContext,
      messages,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    return NextResponse.json({ data: { response: text } });
  } catch (error) {
    return NextResponse.json({ error: "AI error: " + (error as Error).message }, { status: 500 });
  }
}
