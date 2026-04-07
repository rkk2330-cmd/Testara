import { GenerateFromUrlSchema } from "@/lib/core/validation";
import { withHandler } from "@/lib/core";
import { authorize, checkUsage } from "@/lib/security/auth";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { generateTestsFromUrl } from "@/lib/ai/claude";
import { chromium } from "playwright";
import { detectDomain } from "@/lib/data/domain-intelligence";
import { checkRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { postProcessTests } from "@/lib/ai/post-processor";

export const POST = withHandler(async (request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Auth + role + plan check
    const { auth, error: authErr, status: authStatus } = await authorize(supabase, {
      requiredPermission: "use_ai_generator",
      requiredFeature: "ai_generation",
    });
    if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

    // Rate limit: 20 AI generations per hour per user
    const limit = checkRateLimit(auth.user_id, "ai_generation");
    if (!limit.allowed) return NextResponse.json(rateLimitResponse(limit.remaining, limit.resetIn), { status: 429 });

    // Monthly usage limit check
    const usage = await checkUsage(supabase, auth, "ai_generations");
    if (!usage.allowed) {
      return NextResponse.json({
        error: `AI generation limit reached (${usage.used}/${usage.limit} this month). Upgrade your plan.`,
        upgrade_url: "/settings?tab=billing",
        used: usage.used,
        limit: usage.limit,
      }, { status: 403 });
    }

    const { url, project_id, depth } = await request.json();
    if (!url || !project_id) {
      return NextResponse.json({ error: "URL and project_id are required" }, { status: 400 });
    }

    const aiDepth = depth || "quick"; // "quick" = 2-4 tests, "thorough" = 6-10 tests

    // Create AI generation record
    const { data: generation, error: genError } = await supabase
      .from("ai_generations")
      .insert({
        project_id,
        input_type: "url",
        input_data: url,
        status: "generating",
        created_by: user.id,
      })
      .select()
      .single();

    if (genError) throw genError;

    // Launch headless browser to crawl the page
    let pageContent = "";
    let accessibilityTree = "";

    try {
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Get simplified page content
      pageContent = await page.evaluate(() => {
        const body = document.body;
        const elements: string[] = [];

        body.querySelectorAll("input, button, a, select, textarea, [role='button'], form, h1, h2, h3, label").forEach((el) => {
          const tag = el.tagName.toLowerCase();
          const type = (el as HTMLInputElement).type || "";
          const text = el.textContent?.trim().slice(0, 50) || "";
          const ariaLabel = el.getAttribute("aria-label") || "";
          const placeholder = (el as HTMLInputElement).placeholder || "";
          const id = el.id || "";
          const name = (el as HTMLInputElement).name || "";
          const href = (el as HTMLAnchorElement).href || "";

          elements.push(
            `<${tag}${id ? ` id="${id}"` : ""}${name ? ` name="${name}"` : ""}${type ? ` type="${type}"` : ""}${ariaLabel ? ` aria-label="${ariaLabel}"` : ""}${placeholder ? ` placeholder="${placeholder}"` : ""}${href ? ` href="${href}"` : ""}>${text}</${tag}>`
          );
        });

        return elements.join("\n");
      });

      // Get accessibility tree
      const a11ySnapshot = await page.accessibility.snapshot();
      accessibilityTree = JSON.stringify(a11ySnapshot, null, 2);

      await browser.close();
    } catch (crawlError) {
      console.error("Page crawl error:", crawlError);
      // Continue with limited content if crawl fails
      pageContent = `Failed to crawl ${url}. Generate tests based on common patterns for this URL type.`;
    }

    // Detect domain from project signals
    const { data: project } = await supabase.from("projects").select("name, base_url").eq("id", project_id).single();
    const { data: existingTests } = await supabase.from("test_cases").select("title").eq("project_id", project_id).limit(10);

    const domainDetection = detectDomain({
      project_name: project?.name || "",
      base_url: url,
      existing_test_titles: (existingTests || []).map((t: Record<string, unknown>) => t.title),
      existing_field_labels: [],
      page_content: pageContent.slice(0, 2000),
    });

    // Append domain context to page content so AI knows the industry
    let domainContext = "";
    if (domainDetection.confidence >= 30 && domainDetection.profile) {
      domainContext = `\n\nDOMAIN: ${domainDetection.profile.name} (${domainDetection.confidence}% confidence)\n`;
      domainContext += `Context: ${domainDetection.profile.description}\n`;
      domainContext += `Typical fields: ${domainDetection.profile.fields.map(f => f.name).join(", ")}\n`;
      domainContext += `Data rules: ${domainDetection.data_rules.slice(0, 3).join("; ")}`;
    }

    // Generate tests with Claude AI (with domain context)
    // === RAG: Retrieve project context for AI ===
    let ragContextText = "";
    try {
      const { ContextRetriever } = await import("@/lib/rag/retriever");
      const retriever = new ContextRetriever(supabase, auth.org_id);
      const ragContext = await retriever.forTestGeneration(project_id, url);
      ragContextText = ragContext.contextText;
    } catch { /* RAG failure is non-blocking */ }

    const rawTests = await generateTestsFromUrl(url, pageContent + domainContext + ragContextText, accessibilityTree, aiDepth);

    // Post-process: auto-assign TC IDs, validate types, fill missing priorities
    const { tests: generatedTests, mix } = postProcessTests(rawTests, "TC");

    // Update generation record
    await supabase
      .from("ai_generations")
      .update({
        generated_tests: generatedTests,
        status: "completed",
        tokens_used: response?.usage?.output_tokens || 0,
      })
      .eq("id", generation.id);

    return NextResponse.json({
      data: {
        generation_id: generation.id,
        tests: generatedTests,
        test_count: generatedTests.length,
        domain_detected: domainDetection.profile?.name || "unknown",
        domain_confidence: domainDetection.confidence,
        test_mix: mix,
      },
    });
  } catch (error) {
    console.error("AI generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate tests. Please try again." },
      { status: 500 }
    );
  }
}
