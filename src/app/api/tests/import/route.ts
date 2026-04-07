import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// POST /api/tests/import — import test cases from CSV/Excel
export const POST = withHandler(async (request: NextRequest) => {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const projectId = formData.get("project_id") as string;
  const format = formData.get("format") as string; // "csv" | "json"

  if (!file || !projectId) {
    return NextResponse.json({ error: "file and project_id required" }, { status: 400 });
  }

  const text = await file.text();
  let importedTests: Array<{ title: string; description?: string; tags?: string[]; steps?: Array<Record<string, unknown>> }> = [];

  try {
    if (file.name.endsWith(".json") || format === "json") {
      // JSON import: [{ title, description, steps: [...] }]
      importedTests = JSON.parse(text);
    } else {
      // CSV import: title, description, tags, step1_action, step1_target, step1_input, step2_action, ...
      const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error("CSV must have header row + at least 1 data row");

      const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
      const titleIdx = headers.findIndex(h => h.includes("title") || h.includes("test case") || h.includes("name"));
      const descIdx = headers.findIndex(h => h.includes("description") || h.includes("desc"));
      const tagsIdx = headers.findIndex(h => h.includes("tag") || h.includes("label") || h.includes("category"));

      // Detect step columns: step1_action, step1_description, step2_action, etc.
      const stepActionCols: number[] = [];
      const stepTargetCols: number[] = [];
      const stepInputCols: number[] = [];
      const stepExpectedCols: number[] = [];

      headers.forEach((h, i) => {
        if (h.match(/step\d+.*action|action\d+/)) stepActionCols.push(i);
        else if (h.match(/step\d+.*(target|element|selector)/)) stepTargetCols.push(i);
        else if (h.match(/step\d+.*(input|data|value)/)) stepInputCols.push(i);
        else if (h.match(/step\d+.*(expected|assert|verify)/)) stepExpectedCols.push(i);
      });

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const title = cols[titleIdx] || `Imported Test ${i}`;
        if (!title.trim()) continue;

        const steps: Array<Record<string, unknown>> = [];
        for (let s = 0; s < stepActionCols.length; s++) {
          const action = cols[stepActionCols[s]]?.trim();
          if (!action) continue;
          steps.push({
            order_index: s + 1,
            action_type: mapActionType(action),
            target: {
              selector: cols[stepTargetCols[s]]?.trim() || "",
              fallback_selectors: {},
              description: cols[stepTargetCols[s]]?.trim() || action,
            },
            input_data: cols[stepInputCols[s]]?.trim() || null,
            expected_result: cols[stepExpectedCols[s]]?.trim() || null,
          });
        }

        importedTests.push({
          title,
          description: cols[descIdx] || undefined,
          tags: cols[tagsIdx] ? cols[tagsIdx].split(";").map((t: string) => t.trim()) : ["imported"],
          steps: steps.length > 0 ? steps : undefined,
        });
      }
    }
  } catch (err) {
    return NextResponse.json({ error: "Failed to parse file: " + (err as Error).message }, { status: 400 });
  }

  if (importedTests.length === 0) {
    return NextResponse.json({ error: "No test cases found in file" }, { status: 400 });
  }

  // Insert all tests
  let created = 0;
  for (const test of importedTests) {
    const { data: testCase } = await supabase
      .from("test_cases")
      .insert({
        project_id: projectId,
        title: test.title,
        description: test.description || null,
        tags: test.tags || ["imported"],
        status: "draft",
        created_by: auth.user_id,
        ai_generated: false,
      })
      .select()
      .single();

    if (testCase && test.steps && test.steps.length > 0) {
      const stepsToInsert = test.steps.map((s: Record<string, unknown>) => ({
        test_case_id: testCase.id,
        order_index: s.order_index,
        action_type: s.action_type,
        target: s.target || {},
        input_data: s.input_data || null,
        expected_result: s.expected_result || null,
      }));
      await supabase.from("test_steps").insert(stepsToInsert);
    }
    if (testCase) created++;
  }

  return NextResponse.json({
    data: {
      imported: created,
      total_in_file: importedTests.length,
      skipped: importedTests.length - created,
    },
  }, { status: 201 });
}

// Parse CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (char === "," && !inQuotes) { result.push(current.trim()); current = ""; continue; }
    current += char;
  }
  result.push(current.trim());
  return result;
}

// Map common QA terminology to our action types
function mapActionType(input: string): string {
  const lower = input.toLowerCase();
  if (lower.includes("navigate") || lower.includes("open") || lower.includes("go to") || lower.includes("url")) return "navigate";
  if (lower.includes("click") || lower.includes("press") || lower.includes("tap")) return "click";
  if (lower.includes("type") || lower.includes("enter") || lower.includes("input") || lower.includes("fill")) return "type";
  if (lower.includes("select") || lower.includes("choose") || lower.includes("dropdown")) return "select";
  if (lower.includes("verify text") || lower.includes("assert text") || lower.includes("check text")) return "assert_text";
  if (lower.includes("verify visible") || lower.includes("assert visible") || lower.includes("should see")) return "assert_visible";
  if (lower.includes("verify url") || lower.includes("assert url")) return "assert_url";
  if (lower.includes("wait") || lower.includes("pause") || lower.includes("delay")) return "wait";
  if (lower.includes("hover") || lower.includes("mouse over")) return "hover";
  if (lower.includes("scroll")) return "scroll";
  if (lower.includes("screenshot") || lower.includes("capture")) return "screenshot";
  return "click"; // Default fallback
}
