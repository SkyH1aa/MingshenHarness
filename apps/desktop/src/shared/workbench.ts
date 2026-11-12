import type { SessionTodo } from "./domain";

export interface SessionPlan {
  revision: number;
  paused: boolean;
  reviewRequired?: boolean;
  updatedAt: string;
  steps: SessionTodo[];
  breakpoints: string[];
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
