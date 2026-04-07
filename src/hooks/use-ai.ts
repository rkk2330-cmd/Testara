"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";

export function useAI() {
  const [loading, setLoading] = useState(false);

  const call = useCallback(async (action: string, data: Record<string, unknown>) => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...data }),
      });
      const json = await res.json();
      if (json.error) { toast.error(json.error); return null; }
      return json.data;
    } catch (err) {
      toast.error("AI analysis failed");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const callEndpoint = useCallback(async (endpoint: string, action: string, data: Record<string, unknown>) => {
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...data }),
      });
      const json = await res.json();
      if (json.error) { toast.error(json.error); return null; }
      return json.data;
    } catch (err) {
      toast.error("AI analysis failed");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    // General intelligence
    suggestNextStep: (steps: unknown[], pageUrl: string) => call("suggest_step", { steps, pageUrl }),
    validateLogic: (steps: unknown[]) => call("validate_logic", { steps }),
    analyzeFailure: (testTitle: string, failedStep: unknown, recentHistory: unknown[]) => call("analyze_failure", { testTitle, failedStep, recentHistory }),
    getInsights: (stats: Record<string, number>) => call("insights", { stats }),
    getExecutiveSummary: (stats: unknown, topFailures: unknown[]) => call("executive_summary", { stats, topFailures }),
    detectCoverageGaps: (projectUrl: string, existingTests: unknown[]) => call("coverage_gaps", { projectUrl, existingTests }),
    detectFlaky: () => call("detect_flaky", {}),
    prioritizeTests: (tests: unknown[], changedFiles?: string[]) => call("prioritize", { tests, changedFiles }),
    analyzeProjectUrl: (url: string) => call("analyze_url", { url }),
    getHealPatterns: (projectId: string) => call("heal_patterns", { projectId }),

    // API testing intelligence
    generateApiTests: (spec: string, options?: Record<string, unknown>) => callEndpoint("/api/ai/api-intelligence", "generate_from_spec", { spec, options }),
    suggestApiAssertions: (method: string, url: string, statusCode: number, responseBody: string, responseHeaders: Record<string, string>, responseTime: number) => callEndpoint("/api/ai/api-intelligence", "suggest_assertions", { method, url, statusCode, responseBody, responseHeaders, responseTime }),
    generateApiChain: (description: string, baseUrl: string, knownEndpoints?: string[]) => callEndpoint("/api/ai/api-intelligence", "generate_chain", { description, baseUrl, knownEndpoints }),
    generateApiTestData: (method: string, url: string, schema?: string) => callEndpoint("/api/ai/api-intelligence", "generate_test_data", { method, url, schema }),
    detectApiAnomalies: (history: unknown[]) => callEndpoint("/api/ai/api-intelligence", "detect_anomalies", { history }),
    validateApiContract: (method: string, url: string, expectedSchema: string, actualResponse: string, actualStatus: number) => callEndpoint("/api/ai/api-intelligence", "validate_contract", { method, url, expectedSchema, actualResponse, actualStatus }),

    // Mainframe intelligence
    analyzeMainframeScreen: (screenText: string) => callEndpoint("/api/ai/mainframe-intelligence", "analyze_screen", { screenText }),
    generateMainframeFlow: (goal: string, startScreen: string) => callEndpoint("/api/ai/mainframe-intelligence", "generate_flow", { goal, startScreen }),
    mapMainframeFields: (screenText: string) => callEndpoint("/api/ai/mainframe-intelligence", "map_fields", { screenText }),
    suggestMainframeRecovery: (currentScreen: string, expectedScreen: string, lastAction: string) => callEndpoint("/api/ai/mainframe-intelligence", "suggest_recovery", { currentScreen, expectedScreen, lastAction }),
    generateMainframeTestData: (screenFields: unknown[], domain?: string) => callEndpoint("/api/ai/mainframe-intelligence", "generate_test_data", { screenFields, domain }),
  };
}
