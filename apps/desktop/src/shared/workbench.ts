import type { SessionTodo } from "./domain";

export interface SessionPlan {
  revision: number;
  generation: number;
  paused: boolean;
  reviewRequired?: boolean;
  updatedAt: string;
  steps: SessionTodo[];
  breakpoints: string[];
  activeClaims?: PlanStepClaimView[];
}

export type PlanClaimStatus = "active" | "stale" | "cancel_requested" | "completed" | "released";

export interface PlanStepClaimView {
  id: string;
  sessionId: string;
  generation: number;
  stepId: string;
  ownerSessionId: string;
  ownerRunId: string;
  agentProfileId: string | null;
  status: PlanClaimStatus;
  leaseUntil: string;
  heartbeatAt: string;
  attempt: number;
  revision: number;
  claimVersion: number;
  summary: string;
  evidence: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BeginPlanStepInput {
  sessionId: string;
  runId: string;
  ownerSessionId: string;
  agentProfileId?: string | null;
  stepId: string;
  revision: number;
}

export interface SettlePlanStepInput {
  claimId: string;
  ownerRunId: string;
  status: "completed" | "released" | "stale" | "cancel_requested";
  summary?: string;
  evidence?: string[];
}

export interface ExecutionCheckpoint {
  runId: string;
  state: "running" | "interrupted" | "failed" | "completed";
  updatedAt: string;
  lastSafeTool: string | null;
  lastSafeCallId: string | null;
  completedTools: number;
  uncertainTools: Array<{ callId: string; name: string; state: "pending" | "executing" }>;
  verifiedToolCalls?: Array<{ callId: string; fingerprint: string; mutating: boolean }>;
  recoveryRequired?: boolean;
}

export interface SavedProjectPlan {
  id: string;
  name: string;
  workspacePath: string | null;
  sourceSessionId: string;
  savedAt: string;
  revision: number;
  plan: SessionPlan;
}

export interface WorkbenchState {
  plan: SessionPlan;
  checkpoint: ExecutionCheckpoint | null;
  queued?: boolean;
}
export interface SubagentOutputPreview {
  sessionId: string;
  truncated: boolean;
  parts: Array<{
    id: string;
    kind: "text" | "reasoning" | "tool" | "error";
    text: string;
    toolName: string | null;
    isError: boolean;
  }>;
}
export interface PlanUpdateInput {
  sessionId: string;
  revision: number;
  paused?: boolean;
  steps?: SessionTodo[];
  breakpoints?: string[];
}
