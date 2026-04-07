import { GenerateDataSchema } from "@/lib/core/validation";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { checkUsageLimit, usageLimitResponse } from "@/lib/security/usage-meter";
import { checkRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { enrichAIPrompt } from "@/lib/data/domain-intelligence";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// POST /api/ai/generate-data — AI generates synthetic test data with domain intelligence
export const POST = withHandler(async (request: NextRequest) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

    // Rate limit
    const limit = checkRateLimit(auth.user_id, "ai_generation");
    if (!limit.allowed) return NextResponse.json(rateLimitResponse(limit.remaining, limit.resetIn), { status: 429 });

    // Usage limit check
    const { data: profile } = await supabase.from("users").select("org_id").eq("id", auth.user_id).single();
    if (profile?.org_id) {
      const usage = await checkUsageLimit(supabase, profile.org_id, "ai_generations");
      if (!usage.allowed) return NextResponse.json(usageLimitResponse(usage.used, usage.limit, usage.plan, "AI generation"), { status: 403 });
    }

  const { description, columns, row_count, format, locale, project_id } = await request.json();

  if (!description) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const numRows = Math.min(row_count || 10, 100); // Cap at 100 rows
  const outputFormat = format || "json"; // "json" | "csv"
  const dataLocale = locale || "en-IN"; // Default India

  // Auto-detect domain and enrich the AI prompt
  let enrichedDescription = description;
  let detectedDomain = "unknown";
  if (project_id) {
    try {
      const { data: project } = await supabase.from("projects").select("name, base_url").eq("id", project_id).single();
      const { data: tests } = await supabase.from("test_cases").select("title").eq("project_id", project_id).limit(10);

      if (project) {
        enrichedDescription = enrichAIPrompt(description, {
          project_name: project.name || "",
          base_url: project.base_url || "",
          existing_test_titles: (tests || []).map((t: Record<string, unknown>) => t.title),
          existing_field_labels: [],
        });
        // Extract domain name for response metadata
        const domainMatch = enrichedDescription.match(/auto-detected: ([^,]+)/);
        if (domainMatch) detectedDomain = domainMatch[1];
      }
    } catch { /* proceed without enrichment */ }
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: `You are Testara AI, a test data generation expert. Generate realistic, varied synthetic test data for software testing.

RULES:
- Generate exactly ${numRows} rows of data
- Data must be realistic and varied (no duplicates, no obvious patterns)
- Use locale "${dataLocale}" for names, phone numbers, addresses, currencies
- For emails, use domains like @testmail.com, @example.org (never real domains)
- For sensitive fields (SSN, credit cards, passwords), generate realistic-format FAKE data
- For Indian locale: use Indian names, +91 phone numbers, Indian cities, PIN codes
- Output ONLY valid JSON array, no markdown, no explanation`,
      messages: [{
        role: "user",
        content: `Generate ${numRows} rows of test data for this scenario:

"${enrichedDescription}"

${columns ? `Required columns: ${columns.join(", ")}` : "Infer the appropriate columns from the description and domain context."}

Output as JSON array: [{ column1: value1, column2: value2, ... }, ...]
Each row must have the same set of keys. Values must be realistic and diverse.
Include a healthy mix: 70% valid data, 20% boundary/invalid, 10% edge cases.`,
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const generatedData = JSON.parse(cleaned);

    // Convert to CSV if requested
    let csvOutput: string | null = null;
    if (outputFormat === "csv" && Array.isArray(generatedData) && generatedData.length > 0) {
      const headers = Object.keys(generatedData[0]);
      const csvRows = [
        headers.join(","),
        ...generatedData.map((row: Record<string, unknown>) =>
          headers.map((h) => {
            const val = String(row[h] ?? "");
            return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
          }).join(",")
        ),
      ];
      csvOutput = csvRows.join("\n");
    }

    return NextResponse.json({
      data: {
        rows: generatedData,
        row_count: generatedData.length,
        columns: Array.isArray(generatedData) && generatedData.length > 0 ? Object.keys(generatedData[0]) : [],
        csv: csvOutput,
        format: outputFormat,
        domain_detected: detectedDomain,
      },
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to generate data: " + (error as Error).message }, { status: 500 });
  }
}
