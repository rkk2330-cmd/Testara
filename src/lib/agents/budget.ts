// ===========================================
// TESTARA — Agent Budget Tracker
// Every agent session has a cost ceiling.
// No runaway $500 bills. Ever.
// ===========================================

import type { AgentBudget, AgentSpend } from "./types";
import { DEFAULT_BUDGET, COST_PER_CALL_INR, COST_PER_1K_TOKENS_INR, COST_PER_TEST_RUN_INR } from "./types";
import { logger } from "@/lib/core/logger";

export class BudgetTracker {
  private budget: AgentBudget;
  private spend: AgentSpend;
  private warnings: Set<string> = new Set();
  private onWarning: (resource: string, pct: number) => void;

  constructor(budget?: Partial<AgentBudget>, onWarning?: (resource: string, pct: number) => void) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.spend = { claudeCalls: 0, tokens: 0, durationMs: 0, testRuns: 0, costInr: 0 };
    this.onWarning = onWarning || (() => {});
  }

  getBudget(): AgentBudget { return this.budget; }
  getSpend(): AgentSpend { return { ...this.spend }; }

  // Track a Claude API call
  trackClaudeCall(inputTokens: number, outputTokens: number): void {
    this.spend.claudeCalls++;
    this.spend.tokens += inputTokens + outputTokens;
    this.spend.costInr += COST_PER_CALL_INR + ((inputTokens + outputTokens) / 1000) * COST_PER_1K_TOKENS_INR;
    this.checkLimits();
  }

  // Track a test execution
  trackTestRun(): void {
    this.spend.testRuns++;
    this.spend.costInr += COST_PER_TEST_RUN_INR;
    this.checkLimits();
  }

  // Track elapsed time
  trackDuration(ms: number): void {
    this.spend.durationMs += ms;
    this.checkLimits();
  }

  // Can we make another Claude call?
  canCallClaude(): boolean {
    return this.spend.claudeCalls < this.budget.maxClaudeCalls &&
           this.spend.tokens < this.budget.maxTokens &&
           this.spend.costInr < this.budget.maxCostInr;
  }

  // Can we run another test?
  canRunTest(): boolean {
    return this.spend.testRuns < this.budget.maxTestRuns &&
           this.spend.costInr < this.budget.maxCostInr;
  }

  // Is session within time limit?
  withinTimeLimit(): boolean {
    return this.spend.durationMs < this.budget.maxDurationMs;
  }

  // Is ANY limit exceeded?
  isExceeded(): boolean {
    return !this.canCallClaude() || !this.withinTimeLimit();
  }

  // Get reason for budget exhaustion
  getExhaustedReason(): string | null {
    if (this.spend.claudeCalls >= this.budget.maxClaudeCalls) return `Claude call limit reached (${this.spend.claudeCalls}/${this.budget.maxClaudeCalls})`;
    if (this.spend.tokens >= this.budget.maxTokens) return `Token limit reached (${this.spend.tokens}/${this.budget.maxTokens})`;
    if (this.spend.costInr >= this.budget.maxCostInr) return `Cost limit reached (₹${this.spend.costInr.toFixed(2)}/₹${this.budget.maxCostInr})`;
    if (this.spend.durationMs >= this.budget.maxDurationMs) return `Time limit reached (${Math.round(this.spend.durationMs / 1000)}s/${Math.round(this.budget.maxDurationMs / 1000)}s)`;
    if (this.spend.testRuns >= this.budget.maxTestRuns) return `Test run limit reached (${this.spend.testRuns}/${this.budget.maxTestRuns})`;
    return null;
  }

  // Summary for reporting
  getSummary(): Record<string, string> {
    return {
      claudeCalls: `${this.spend.claudeCalls}/${this.budget.maxClaudeCalls}`,
      tokens: `${this.spend.tokens}/${this.budget.maxTokens}`,
      testRuns: `${this.spend.testRuns}/${this.budget.maxTestRuns}`,
      cost: `₹${this.spend.costInr.toFixed(2)}/₹${this.budget.maxCostInr}`,
      duration: `${Math.round(this.spend.durationMs / 1000)}s/${Math.round(this.budget.maxDurationMs / 1000)}s`,
    };
  }

  private checkLimits(): void {
    const checks: Array<[string, number, number]> = [
      ["claude_calls", this.spend.claudeCalls, this.budget.maxClaudeCalls],
      ["tokens", this.spend.tokens, this.budget.maxTokens],
      ["cost", this.spend.costInr, this.budget.maxCostInr],
      ["test_runs", this.spend.testRuns, this.budget.maxTestRuns],
      ["duration", this.spend.durationMs, this.budget.maxDurationMs],
    ];

    for (const [resource, spent, limit] of checks) {
      const pct = Math.round((spent / limit) * 100);
      if (pct >= 80 && !this.warnings.has(`${resource}_80`)) {
        this.warnings.add(`${resource}_80`);
        this.onWarning(resource, pct);
        logger.warn("agent.budget_warning", { resource, percentage: pct, spent, limit });
      }
    }
  }
}
