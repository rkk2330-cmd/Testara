// ===========================================
// TESTARA — RAG Prompt Enricher
// Wraps every AI call:
// 1. Retrieves relevant context
// 2. Injects into prompt
// 3. Calls Claude with enriched prompt
// 4. Tracks token usage (context + generation)
// ===========================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { ContextRetriever, type RAGContext } from "./retriever";
import { logger } from "@/lib/core/logger";

const MODEL = "claude-sonnet-4-6";

interface EnrichedCallOptions {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
  // What type of context to retrieve
  contextType: "test_generation" | "failure_analysis" | "step_suggestions" | "assistant" | "coverage";
  // Additional retrieval params
  pageUrl?: string;
  testCaseId?: string;
  // The actual prompt
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

interface EnrichedCallResult {
  response: string;
  ragContext: RAGContext;
  tokensUsed: { input: number; output: number; ragContext: number };
}

export async function callWithRAG(options: EnrichedCallOptions): Promise<EnrichedCallResult> {
  const retriever = new ContextRetriever(options.supabase, options.orgId);
  const startTime = Date.now();

  // Step 1: Retrieve relevant context
  let ragContext: RAGContext;
  switch (options.contextType) {
    case "test_generation":
      ragContext = await retriever.forTestGeneration(options.projectId, options.pageUrl);
      break;
    case "failure_analysis":
      ragContext = await retriever.forFailureAnalysis(options.testCaseId || "", options.projectId);
      break;
    case "step_suggestions":
      ragContext = await retriever.forStepSuggestions(options.projectId, options.pageUrl || "");
      break;
    case "assistant":
      ragContext = await retriever.forAssistant(options.projectId);
      break;
    case "coverage":
      ragContext = await retriever.forCoverageAnalysis(options.projectId);
      break;
    default:
      ragContext = { sources: [], contextText: "", estimatedTokens: 0, pieces: [] };
  }

  // Step 2: Enrich the user prompt with context — MASK SENSITIVE DATA
  const { maskForAI } = await import("@/lib/security/masking");
  const sanitizedContext = maskForAI(ragContext.contextText);
  const sanitizedUserPrompt = maskForAI(options.userPrompt);

  const enrichedUserPrompt = sanitizedContext
    ? `${sanitizedUserPrompt}\n${sanitizedContext}\nIMPORTANT: Use the above context from this project to make your response specific and accurate. Avoid generating duplicate test cases. Use known working selectors from the Object Repository.`
    : sanitizedUserPrompt;

  // Step 3: Call Claude with enriched prompt
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: options.maxTokens || 1000,
    system: options.systemPrompt,
    messages: [{ role: "user", content: enrichedUserPrompt }],
  });

  const responseText = response.content[0].type === "text" ? response.content[0].text : "";

  // Step 4: Track usage
  const result: EnrichedCallResult = {
    response: responseText,
    ragContext,
    tokensUsed: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      ragContext: ragContext.estimatedTokens,
    },
  };

  logger.info("rag.call_complete", {
    contextType: options.contextType,
    sources: ragContext.sources,
    ragTokens: ragContext.estimatedTokens,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    duration_ms: Date.now() - startTime,
  });

  return result;
}

// ===== CONVENIENCE WRAPPERS =====

// For test generation: retrieves existing tests + failures + elements
export async function generateWithContext(
  supabase: SupabaseClient,
  orgId: string,
  projectId: string,
  pageUrl: string,
  pageContent: string,
  systemPrompt: string,
  maxTokens?: number
): Promise<{ response: string; context: RAGContext }> {
  const result = await callWithRAG({
    supabase, orgId, projectId,
    contextType: "test_generation",
    pageUrl,
    systemPrompt,
    userPrompt: pageContent,
    maxTokens,
  });
  return { response: result.response, context: result.ragContext };
}

// For failure analysis: retrieves run history + similar failures
export async function analyzeWithContext(
  supabase: SupabaseClient,
  orgId: string,
  projectId: string,
  testCaseId: string,
  failureDetails: string,
  systemPrompt: string
): Promise<{ response: string; context: RAGContext }> {
  const result = await callWithRAG({
    supabase, orgId, projectId,
    contextType: "failure_analysis",
    testCaseId,
    systemPrompt,
    userPrompt: failureDetails,
    maxTokens: 800,
  });
  return { response: result.response, context: result.ragContext };
}

// For AI assistant: retrieves project info + test summary + recent activity
export async function assistWithContext(
  supabase: SupabaseClient,
  orgId: string,
  projectId: string,
  userMessage: string,
  systemPrompt: string
): Promise<{ response: string; context: RAGContext }> {
  const result = await callWithRAG({
    supabase, orgId, projectId,
    contextType: "assistant",
    systemPrompt,
    userPrompt: userMessage,
    maxTokens: 500,
  });
  return { response: result.response, context: result.ragContext };
}
