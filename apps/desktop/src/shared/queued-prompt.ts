import { MAX_CHAT_ATTACHMENT_TOTAL_BYTES } from "./attachments";
import type {
  AgentMode,
  ApprovalMode,
  AttachmentKind,
  ChatAttachmentInput,
  ChatTurnOptions,
  PermissionMode,
  SessionExecutionMode,
} from "./domain";

export const QUEUED_PROMPT_STORAGE_VERSION = 2;
export const MAX_QUEUED_PROMPTS = 10;
export const MAX_QUEUED_PROMPT_ATTACHMENT_BYTES = MAX_CHAT_ATTACHMENT_TOTAL_BYTES;

export const QUEUED_PROMPT_REQUIRES_ACTIVE_RUN = "QUEUED_PROMPT_REQUIRES_ACTIVE_RUN";
export const QUEUED_PROMPT_UNSUPPORTED_SUBAGENT = "QUEUED_PROMPT_UNSUPPORTED_SUBAGENT";
export const QUEUED_PROMPT_NOT_FOUND = "QUEUED_PROMPT_NOT_FOUND";
export const QUEUED_PROMPT_CONFIGURATION_CHANGED = "QUEUED_PROMPT_CONFIGURATION_CHANGED";
export const QUEUED_PROMPT_CONTINUING = "QUEUED_PROMPT_CONTINUING";
export const QUEUED_PROMPT_DISPATCH_PENDING = "QUEUED_PROMPT_DISPATCH_PENDING";
export const QUEUED_PROMPT_STORAGE_CORRUPT = "QUEUED_PROMPT_STORAGE_CORRUPT";

export interface QueuedPromptAttachmentView {
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
}

export interface QueuedPromptConfigurationSnapshot {
  agentMode: AgentMode;
  workspacePath: string | null;
  agentProfileId: string;
  providerId: string | null;
  modelId: string | null;
  permissionMode: PermissionMode;
  approvalMode: ApprovalMode;
  executionMode: SessionExecutionMode;
}

export type QueuedPromptConfigurationField =
  | "agentMode"
  | "workspacePath"
  | "agentProfileId"
  | "providerId"
  | "modelId"
  | "permissionMode"
  | "approvalMode"
  | "executionMode";

export type QueuedPromptContinuationBlocker =
  | "session_missing"
  | "session_archived"
  | "session_busy"
  | "dispatch_pending"
  | "configuration_changed"
  | "editing"
  | "waiting_turn";

export type QueuedPromptPauseReason =
  | "stopped"
  | "failed"
  | "restarted"
  | "editing"
  | "send_failed";

export type QueuedPromptDispatchState = "sending" | "accepted";

export interface QueuedPromptView {
  id: string;
  sessionId: string;
  text: string;
  temporaryInstruction?: string;
  attachments: QueuedPromptAttachmentView[];
  snapshot: QueuedPromptConfigurationSnapshot;
  changedConfigurationFields: QueuedPromptConfigurationField[];
  dispatchState: QueuedPromptDispatchState | null;
  canContinue: boolean;
  continuationBlocker: QueuedPromptContinuationBlocker | null;
  automaticPauseReason: QueuedPromptPauseReason | null;
  automaticError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueuedPromptAddInput extends ChatTurnOptions {
  sessionId: string;
  text: string;
  attachments?: ChatAttachmentInput[];
}

export interface QueuedPromptUpdateInput {
  sessionId: string;
  itemId: string;
  text: string;
  /** Omit to preserve the saved attachment snapshot; provide a list to replace it. */
  attachments?: ChatAttachmentInput[];
  /** Omit to preserve the current instruction; an empty value removes it. */
  temporaryInstruction?: string | null;
}

export interface QueuedPromptReorderInput {
  sessionId: string;
  itemId: string;
  targetIndex: number;
}

export interface QueuedPromptContinueResult {
  itemId: string;
  runId: string;
  dispatchId: string;
  cleanupWarning?: string;
}

export function queuedPromptSettingKey(sessionId: string): string {
  return `chat.queue.${sessionId}`;
}
