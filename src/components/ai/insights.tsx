"use client";

import { useState, useEffect } from "react";
import { useAI } from "@/hooks/use-ai";
import { Sparkles, AlertTriangle, CheckCircle, Info, ArrowRight, Loader2, Brain } from "lucide-react";
import Link from "next/link";

interface Insight {
  type: "warning" | "success" | "info" | "action";
  message: string;
  priority: number;
}

const ICONS = {
  warning: AlertTriangle,
  success: CheckCircle,
  info: Info,
  action: ArrowRight,
};

const COLORS = {
  warning: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  success: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  info: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  action: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
};

export function AIInsightsPanel({ stats }: { stats: { totalTests: number; passRate: number; failedTests: number; healedTests: number; flakyCount: number; lastRunDaysAgo: number; testsWithoutAssertions: number } }) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const ai = useAI();

  useEffect(() => {
    async function load() {
      const result = await ai.getInsights(stats);
      if (result?.insights) setInsights(result.insights);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-indigo-400 animate-pulse" />
        <span className="text-sm font-medium text-white">AI analyzing your test health...</span>
      </div>
      <div className="animate-pulse space-y-2">
        <div className="h-3 bg-gray-800 rounded w-3/4" />
        <div className="h-3 bg-gray-800 rounded w-1/2" />
      </div>
    </div>
  );

  if (insights.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-indigo-400" />
        <span className="text-sm font-medium text-white">AI Insights</span>
        <span className="text-[10px] text-gray-500">Based on your test data</span>
      </div>
      <div className="space-y-2">
        {insights.map((insight, i) => {
          const Icon = ICONS[insight.type];
          return (
            <div key={i} className={`flex items-start gap-3 px-3.5 py-2.5 rounded-lg border ${COLORS[insight.type]}`}>
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">{insight.message}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== COVERAGE GAPS PANEL =====
export function CoverageGapsPanel({ projectUrl, existingTests }: {
  projectUrl: string;
  existingTests: Array<{ title: string; type: string }>;
}) {
  const [gaps, setGaps] = useState<Array<{ area: string; reason: string; priority: string; suggested_test: string }>>([]);
  const [loading, setLoading] = useState(false);
  const ai = useAI();

  async function analyze() {
    setLoading(true);
    const result = await ai.detectCoverageGaps(projectUrl, existingTests);
    if (result?.gaps) setGaps(result.gaps);
    setLoading(false);
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-medium text-white">Coverage Gap Analysis</span>
        </div>
        <button onClick={analyze} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 text-indigo-400 text-xs rounded-lg hover:bg-indigo-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Analyze
        </button>
      </div>
      {gaps.length > 0 && (
        <div className="space-y-2">
          {gaps.map((gap, i) => (
            <div key={i} className="bg-gray-800/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${
                  gap.priority === "high" ? "bg-red-500/10 text-red-400" :
                  gap.priority === "medium" ? "bg-amber-500/10 text-amber-400" :
                  "bg-blue-500/10 text-blue-400"
                }`}>{gap.priority}</span>
                <span className="text-xs font-medium text-white">{gap.area}</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-1">{gap.reason}</p>
              <p className="text-[11px] text-indigo-400">Suggested: {gap.suggested_test}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== FLAKY TESTS PANEL =====
export function FlakyTestsPanel() {
  const [flaky, setFlaky] = useState<Array<{ testId: string; title: string; flakyRate: number; pattern: string }>>([]);
  const [loading, setLoading] = useState(true);
  const ai = useAI();

  useEffect(() => {
    async function load() {
      const result = await ai.detectFlaky();
      if (result?.flaky) setFlaky(result.flaky);
      setLoading(false);
    }
    load();
  }, []);

  if (loading || flaky.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-amber-500/20 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-medium text-white">Flaky Tests Detected</span>
        <span className="text-[10px] text-amber-400">{flaky.length} found</span>
      </div>
      <div className="space-y-2">
        {flaky.slice(0, 5).map((test, i) => (
          <Link key={i} href={`/tests/${test.testId}`} className="flex items-center justify-between py-2 px-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors">
            <div>
              <p className="text-xs text-white">{test.title}</p>
              <p className="text-[10px] text-gray-500 font-mono mt-0.5">{test.pattern}</p>
            </div>
            <span className="text-xs text-amber-400 font-medium">{test.flakyRate}% flaky</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
