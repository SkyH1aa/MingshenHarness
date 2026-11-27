import type { ChatStreamEvent, SessionMessage, SessionTodo, SessionView } from "./domain";
import type { ManagedPolicySource } from "./managed-policy";

export type RuntimeRunStatus =
  | "accepted"
  | "preparing"
  | "running"
  | "waiting_approval"
  | "waiting_user"
  | "completed"
  | "failed"
  | "interrupted"
  | "blocked_policy";

export const RUNTIME_TERMINAL_STATUSES: ReadonlySet<RuntimeRunStatus> = new Set([
  "completed",
  "failed",
  "interrupted",
  "blocked_policy",
]);

export interface RuntimeRunView {
  runId: string;
  sessionId: string;
  status: RuntimeRunStatus;
  source: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  terminalReason: string | null;
  policyRevision: string;
  lastPolicyDenial?: RuntimePolicyDenial;
  delegatedRunId: string | null;
  lastEventId: number;
}

export interface RuntimePolicyDenialInput {
  revision: string;
  code: string;
  reason: string;
  scope: string;
  sources?: readonly ManagedPolicySource[];
}

export interface RuntimePolicyDenial {
  revision: string;
  code: string;
  reason: string;
  sources: ManagedPolicySource[];
  scope: string;
  at: string;
}

export interface RuntimeTurnAcceptance {
  turnId: string;
  runId: string;
  sessionId: string;
  idempotencyKey: string;
  requestHash: string;
  source: string;
  createdAt: string;
  duplicate: boolean;
}

export interface RuntimeEventEnvelope {
  eventId: number | null;
  seq: number;
  sessionId: string | null;
  runId: string | null;
  type: string;
  event: ChatStreamEvent | RuntimeControlEvent;
  createdAt: string;
}

export interface RuntimeStatusControlEvent {
  type: "runtime.status" | "runtime.recovered";
  sessionId: string;
  runId: string;
  status: RuntimeRunStatus;
  reason: string | null;
}

export interface RuntimePolicyDeniedControlEvent {
  type: "runtime.policy_denied";
  sessionId: string;
  runId: string;
  denial: RuntimePolicyDenial;
}

export type RuntimeControlEvent = RuntimeStatusControlEvent | RuntimePolicyDeniedControlEvent;

export interface RuntimeSessionSnapshot {
  session: SessionView;
  messages: SessionMessage[];
  todos: SessionTodo[];
  runs: RuntimeRunView[];
  acceptances: Array<Omit<RuntimeTurnAcceptance, "duplicate">>;
  eventCursor: number;
  cursorExpired: boolean;
  capabilities: RuntimeCapabilities;
}

export interface RuntimeCapabilities {
  apiVersion: "v1";
  runtimeEvents: boolean;
  eventReplay: boolean;
  idempotentTurns: boolean;
  exactRunCancellation: boolean;
  policy: boolean;
  taskClaims: boolean;
  officeReceipts: boolean;
  eventRetentionDays: number;
  eventRetentionBytes: number;
}

export interface RuntimeEventPage {
  events: RuntimeEventEnvelope[];
  cursor: number;
  hasMore: boolean;
}

export interface RuntimeAdmitTurnInput {
  sessionId: string;
  idempotencyKey: string;
  requestHash: string;
  source: string;
  policyRevision?: string;
}
