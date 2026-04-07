// ===========================================
// TESTARA — Vector Search (pgvector)
// Semantic similarity across test cases
// Uses Supabase pgvector for embedding storage
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/core/logger";

// ===== EMBEDDING GENERATION =====
// Uses Claude's prompt to create a text representation, then stores as embedding
// For V1: we use text-based similarity (no external embedding API needed)
// For V2: switch to Voyage AI or OpenAI embeddings for true vector search

export async function generateTextFingerprint(
  title: string,
  description?: string,
  steps?: Array<{ action_type: string; target?: { description?: string } }>
): string {
  // Create a searchable text representation of the test
  const stepText = (steps || [])
    .map(s => `${s.action_type} ${s.target?.description || ""}`)
    .join(" ");

  return `${title} ${description || ""} ${stepText}`.toLowerCase().trim();
}

// ===== TEXT-BASED SIMILARITY (V1 — no embedding API needed) =====
export async function findSimilarTests(
  supabase: SupabaseClient,
  projectId: string,
  searchText: string,
  limit = 5
): Promise<Array<{ id: string; title: string; similarity: number }>> {
  // Use Supabase full-text search
  const keywords = searchText.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 10);

  if (keywords.length === 0) return [];

  // Search by title and description matching
  const { data } = await supabase
    .from("test_cases")
    .select("id, title, description")
    .eq("project_id", projectId)
    .or(keywords.map(k => `title.ilike.%${k}%`).join(","))
    .limit(limit);

  if (!data) return [];

  // Calculate simple similarity score
  return data.map((test: Record<string, string>) => {
    const testText = `${test.title} ${test.description || ""}`.toLowerCase();
    const matchCount = keywords.filter(k => testText.includes(k)).length;
    return {
      id: test.id,
      title: test.title,
      similarity: Math.round((matchCount / keywords.length) * 100) / 100,
    };
  }).sort((a, b) => b.similarity - a.similarity);
}

// ===== FIND TESTS BY ACTION PATTERN =====
// Finds tests that use similar step sequences
export async function findTestsByPattern(
  supabase: SupabaseClient,
  projectId: string,
  actionSequence: string[] // ["navigate", "type", "type", "click"]
): Promise<Array<{ id: string; title: string; matchScore: number }>> {
  const { data: tests } = await supabase
    .from("test_cases")
    .select("id, title, test_steps(action_type)")
    .eq("project_id", projectId)
    .limit(50);

  if (!tests) return [];

  return tests.map((test: Record<string, unknown>) => {
    const steps = (test.test_steps as Array<Record<string, string>> || [])
      .map(s => s.action_type);

    // Calculate sequence similarity
    let matches = 0;
    const minLen = Math.min(actionSequence.length, steps.length);
    for (let i = 0; i < minLen; i++) {
      if (actionSequence[i] === steps[i]) matches++;
    }
    const matchScore = minLen > 0 ? Math.round((matches / Math.max(actionSequence.length, steps.length)) * 100) / 100 : 0;

    return { id: test.id as string, title: test.title as string, matchScore };
  })
  .filter(t => t.matchScore > 0.3)
  .sort((a, b) => b.matchScore - a.matchScore)
  .slice(0, 5);
}

// ===== FIND ELEMENTS BY DESCRIPTION =====
export async function findSimilarElements(
  supabase: SupabaseClient,
  projectId: string,
  description: string,
  limit = 5
): Promise<Array<{ id: string; logicalName: string; selector: string; similarity: number }>> {
  const keywords = description.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  const { data } = await supabase
    .from("object_repository")
    .select("id, logical_name, fingerprint")
    .eq("project_id", projectId)
    .limit(100);

  if (!data) return [];

  return data.map((el: Record<string, unknown>) => {
    const name = (el.logical_name as string || "").toLowerCase();
    const fp = el.fingerprint as Record<string, unknown>;
    const meta = fp?.meta as Record<string, string>;
    const matchCount = keywords.filter(k => name.includes(k)).length;

    return {
      id: el.id as string,
      logicalName: el.logical_name as string,
      selector: meta?.recommended_selector || "",
      similarity: keywords.length > 0 ? matchCount / keywords.length : 0,
    };
  })
  .filter(e => e.similarity > 0)
  .sort((a, b) => b.similarity - a.similarity)
  .slice(0, limit);
}
