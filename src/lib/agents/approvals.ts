// ===========================================
// TESTARA — Agent Approval System
// Agents PROPOSE. Humans APPROVE. System EXECUTES.
// ===========================================

import type { AgentProposal, RiskLevel, AgentContext } from "./types";
import { toolRegistry } from "./tools";
import { logger } from "@/lib/core/logger";

// ===== APPROVAL MANAGER =====
export class ApprovalManager {
  private pending: Map<string, AgentProposal> = new Map();
  private resolved: AgentProposal[] = [];
  private approvalMode: "all" | "high_only" | "none";
  private autoApproveThreshold: number;

  constructor(approvalMode: "all" | "high_only" | "none" = "high_only", autoApproveThreshold = 0.9) {
    this.approvalMode = approvalMode;
    this.autoApproveThreshold = autoApproveThreshold;
  }

  // Create a proposal and decide if it needs human review
  async createProposal(
    sessionId: string,
    action: string,
    description: string,
    riskLevel: RiskLevel,
    confidence: number,
    data: Record<string, unknown>,
    reason: string
  ): Promise<AgentProposal> {
    const proposal: AgentProposal = {
      id: `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      action,
      description,
      riskLevel,
      confidence,
      data,
      reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    // Decide: auto-approve or queue for human review
    if (this.shouldAutoApprove(proposal)) {
      proposal.status = "auto_approved";
      this.resolved.push(proposal);
      logger.info("agent.proposal_auto_approved", { id: proposal.id, action, confidence });
    } else {
      this.pending.set(proposal.id, proposal);
      logger.info("agent.proposal_queued", { id: proposal.id, action, riskLevel, confidence });
    }

    return proposal;
  }

  // Human approves a proposal
  approve(proposalId: string, reviewerId: string): AgentProposal | null {
    const proposal = this.pending.get(proposalId);
    if (!proposal) return null;

    proposal.status = "approved";
    proposal.reviewedBy = reviewerId;
    proposal.reviewedAt = new Date().toISOString();
    this.pending.delete(proposalId);
    this.resolved.push(proposal);

    logger.info("agent.proposal_approved", { id: proposalId, action: proposal.action, reviewedBy: reviewerId });
    return proposal;
  }

  // Human rejects a proposal
  reject(proposalId: string, reviewerId: string): AgentProposal | null {
    const proposal = this.pending.get(proposalId);
    if (!proposal) return null;

    proposal.status = "rejected";
    proposal.reviewedBy = reviewerId;
    proposal.reviewedAt = new Date().toISOString();
    this.pending.delete(proposalId);
    this.resolved.push(proposal);

    logger.info("agent.proposal_rejected", { id: proposalId, action: proposal.action, reviewedBy: reviewerId });
    return proposal;
  }

  // Get all pending proposals
  getPending(): AgentProposal[] { return Array.from(this.pending.values()); }
  getResolved(): AgentProposal[] { return [...this.resolved]; }

  // Is a proposal approved (either auto or human)?
  isApproved(proposalId: string): boolean {
    const resolved = this.resolved.find(p => p.id === proposalId);
    return resolved?.status === "approved" || resolved?.status === "auto_approved";
  }

  // Check if proposal needs human review
  private shouldAutoApprove(proposal: AgentProposal): boolean {
    // "none" mode = auto-approve everything (dangerous, for power users only)
    if (this.approvalMode === "none") return true;

    // "all" mode = nothing auto-approved
    if (this.approvalMode === "all") return false;

    // "high_only" mode = auto-approve low/none risk with high confidence
    if (proposal.riskLevel === "none") return true;
    if (proposal.riskLevel === "blocked") return false;
    if (proposal.riskLevel === "high") return false;
    if (proposal.riskLevel === "low" && proposal.confidence >= this.autoApproveThreshold) return true;
    if (proposal.riskLevel === "medium" && proposal.confidence >= 0.95) return true;

    return false;
  }
}

// ===== DETERMINE RISK LEVEL FOR AN ACTION =====
export function assessRisk(toolName: string): RiskLevel {
  const tool = toolRegistry.get(toolName);
  if (!tool) return "blocked";
  return tool.riskLevel;
}

// ===== CHECK IF ACTION NEEDS APPROVAL =====
export function needsApproval(toolName: string, approvalMode: "all" | "high_only" | "none"): boolean {
  if (approvalMode === "none") return false;
  if (approvalMode === "all") return true;

  const tool = toolRegistry.get(toolName);
  if (!tool) return true;
  return tool.requiresApproval;
}
