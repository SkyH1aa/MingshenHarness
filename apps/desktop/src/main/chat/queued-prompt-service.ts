import { randomUUID } from "node:crypto";
import { validateChatAttachmentBatch } from "../../shared/attachments";
import { MAX_COMPOSER_ATTACHMENT_BYTES } from "../../shared/composer-draft";
import type {
  AgentMode,
  ApprovalMode,
  ChatAttachmentInput,
  ChatSendInput,
  PermissionMode,
  SessionExecutionMode,
  SessionView,
} from "../../shared/domain";
import { normalizeTemporaryInstruction } from "../../shared/draft-assist";
import {
  MAX_QUEUED_PROMPT_ATTACHMENT_BYTES,
  MAX_QUEUED_PROMPTS,
  QUEUED_PROMPT_CONFIGURATION_CHANGED,
  QUEUED_PROMPT_CONTINUING,
  QUEUED_PROMPT_DISPATCH_PENDING,
  QUEUED_PROMPT_NOT_FOUND,
  QUEUED_PROMPT_REQUIRES_ACTIVE_RUN,
  QUEUED_PROMPT_STORAGE_CORRUPT,
  QUEUED_PROMPT_STORAGE_VERSION,
  QUEUED_PROMPT_UNSUPPORTED_SUBAGENT,
  type QueuedPromptAddInput,
  type QueuedPromptConfigurationField,
  type QueuedPromptConfigurationSnapshot,
  type QueuedPromptContinueResult,
  type QueuedPromptDispatchState,
  type QueuedPromptPauseReason,
  type QueuedPromptReorderInput,
  type QueuedPromptUpdateInput,
  type QueuedPromptView,
  queuedPromptSettingKey,
} from "../../shared/queued-prompt";
import type { Repository } from "../storage/repository";
import { validateChatAttachments } from "./attachment-validation";

interface StoredQueuedPromptItem {
  id: string;
  text: string;
  temporaryInstruction?: string;
  attachments: ChatAttachmentInput[];
  snapshot: QueuedPromptConfigurationSnapshot;
  dispatch?: {
    requestId: string;
    state: QueuedPromptDispatchState;
    startedAt: string;
    acceptedAt?: string;
    runId?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface StoredQueuedPromptQueue {
  version: typeof QUEUED_PROMPT_STORAGE_VERSION;
  items: StoredQueuedPromptItem[];
}

export interface QueuedPromptRuntime {
  isSessionBusy(sessionId: string): boolean;
  send(input: ChatSendInput): Promise<{ runId: string }>;
  changed?(sessionId: string): void;
}

interface AutomaticQueueState {
  ready: boolean;
  pauseReason: QueuedPromptPauseReason | null;
  error: string | null;
  generation: number;
  runId?: string;
  settledRunId?: string;
}

interface QueueEditHold {
  sessionId: string;
  itemId: string;
  ownerId: number;
}

const AGENT_MODES = new Set<AgentMode>(["code", "work", "chat"]);
const PERMISSION_MODES = new Set<PermissionMode>(["request_approval", "full_access"]);
const APPROVAL_MODES = new Set<ApprovalMode>(["manual", "automatic"]);
const EXECUTION_MODES = new Set<SessionExecutionMode>(["host", "worktree", "docker"]);

function invalidStorage(): Error {
  return new Error(`${QUEUED_PROMPT_STORAGE_CORRUPT}: 队列记录损坏，未读取或覆盖原数据。`);
}

function requiredString(value: unknown, maxLength = 10_000): string {
  if (typeof value !== "string" || !value || value.length > maxLength) throw invalidStorage();
  return value;
}

function nullableString(value: unknown, maxLength = 32_768): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) throw invalidStorage();
  return value;
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") throw new Error("队列消息文本格式无效。");
  return value;
}

function storedTemporaryInstruction(value: unknown): string | undefined {
  try {
    return normalizeTemporaryInstruction(value);
  } catch {
    throw invalidStorage();
  }
}

function normalizeAttachments(value: ChatAttachmentInput[] | undefined): ChatAttachmentInput[] {
  return validateChatAttachments(value).map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: attachment.kind,
    dataUrl: attachment.dataUrl,
  }));
}

function attachmentBytes(attachments: ChatAttachmentInput[]): number {
  return attachments.reduce((total, attachment) => total + attachment.size, 0);
}

function queueAttachmentBytes(items: StoredQueuedPromptItem[]): number {
  return items.reduce((total, item) => total + attachmentBytes(item.attachments), 0);
}

function attachmentViews(attachments: ChatAttachmentInput[]) {
  return attachments.map(({ name, mimeType, size, kind }) => ({
    name,
    mimeType,
    size,
    kind,
  }));
}

function normalizedWorkspacePath(path: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  return trimmed.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

function sameWorkspace(left: string | null, right: string | null): boolean {
  return normalizedWorkspacePath(left) === normalizedWorkspacePath(right);
}

function snapshotForSession(session: SessionView): QueuedPromptConfigurationSnapshot {
  return {
    agentMode: session.agentMode ?? "code",
    workspacePath: session.workspacePath?.trim() || null,
    agentProfileId: session.agentProfileId,
    providerId: session.providerId,
    modelId: session.modelId,
    permissionMode: session.permissionMode,
    approvalMode: session.approvalMode ?? "manual",
    executionMode: session.executionMode,
  };
}

function changedConfigurationFields(
  snapshot: QueuedPromptConfigurationSnapshot,
  session: SessionView,
): QueuedPromptConfigurationField[] {
  const current = snapshotForSession(session);
  const changed: QueuedPromptConfigurationField[] = [];
  if (snapshot.agentMode !== current.agentMode) changed.push("agentMode");
  if (!sameWorkspace(snapshot.workspacePath, current.workspacePath)) changed.push("workspacePath");
  if (snapshot.agentProfileId !== current.agentProfileId) changed.push("agentProfileId");
  if (snapshot.providerId !== current.providerId) changed.push("providerId");
  if (snapshot.modelId !== current.modelId) changed.push("modelId");
  if (snapshot.permissionMode !== current.permissionMode) changed.push("permissionMode");
  if (snapshot.approvalMode !== current.approvalMode) changed.push("approvalMode");
  if (snapshot.executionMode !== current.executionMode) changed.push("executionMode");
  return changed;
}

function validateSessionId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 200 ||
    /\s/.test(value) ||
    value.includes("\u0000")
  )
    throw new Error("会话 ID 格式无效。");
}

function validateItemId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 200 ||
    /\s/.test(value) ||
    value.includes("\u0000")
  )
    throw new Error("队列消息 ID 格式无效。");
}

function assertQueueEligibleSession(session: SessionView): void {
  if (session.parentSessionId)
    throw new Error(`${QUEUED_PROMPT_UNSUPPORTED_SUBAGENT}: SubAgent 不支持运行队列。`);
}

function storedSnapshot(value: unknown): QueuedPromptConfigurationSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidStorage();
  const record = value as Record<string, unknown>;
  if (typeof record.agentMode !== "string" || !AGENT_MODES.has(record.agentMode as AgentMode))
    throw invalidStorage();
  if (
    typeof record.permissionMode !== "string" ||
    !PERMISSION_MODES.has(record.permissionMode as PermissionMode)
  )
    throw invalidStorage();
  if (
    typeof record.approvalMode !== "string" ||
    !APPROVAL_MODES.has(record.approvalMode as ApprovalMode)
  )
    throw invalidStorage();
  if (
    typeof record.executionMode !== "string" ||
    !EXECUTION_MODES.has(record.executionMode as SessionExecutionMode)
  )
    throw invalidStorage();
  return {
    agentMode: record.agentMode as AgentMode,
    workspacePath: nullableString(record.workspacePath),
    agentProfileId: requiredString(record.agentProfileId, 200),
    providerId: nullableString(record.providerId, 200),
    modelId: nullableString(record.modelId, 200),
    permissionMode: record.permissionMode as PermissionMode,
    approvalMode: record.approvalMode as ApprovalMode,
    executionMode: record.executionMode as SessionExecutionMode,
  };
}

function storedAttachments(value: unknown): ChatAttachmentInput[] {
  if (!Array.isArray(value)) throw invalidStorage();
  try {
    validateChatAttachmentBatch(value);
  } catch {
    throw invalidStorage();
  }
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidStorage();
    const attachment = raw as Record<string, unknown>;
    if (
      typeof attachment.name !== "string" ||
      !attachment.name ||
      attachment.name.length > 255 ||
      typeof attachment.mimeType !== "string" ||
      !attachment.mimeType ||
      attachment.mimeType.length > 255 ||
      !Number.isSafeInteger(attachment.size) ||
      (attachment.size as number) <= 0 ||
      (attachment.size as number) > MAX_COMPOSER_ATTACHMENT_BYTES ||
      typeof attachment.dataUrl !== "string" ||
      !attachment.dataUrl.startsWith("data:") ||
      attachment.dataUrl.length > Math.ceil((MAX_COMPOSER_ATTACHMENT_BYTES * 4) / 3) + 1024 ||
      !["image", "audio", "video", "file"].includes(String(attachment.kind))
    )
      throw invalidStorage();
    return {
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size as number,
      kind: attachment.kind as ChatAttachmentInput["kind"],
      dataUrl: attachment.dataUrl,
    };
  });
}

function storedDispatch(value: unknown): StoredQueuedPromptItem["dispatch"] | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidStorage();
  const dispatch = value as Record<string, unknown>;
  const state = dispatch.state;
  if (state !== "sending" && state !== "accepted") throw invalidStorage();
  const requestId = requiredString(dispatch.requestId, 200);
  const startedAt = requiredString(dispatch.startedAt, 100);
  const acceptedAt =
    dispatch.acceptedAt === undefined ? undefined : requiredString(dispatch.acceptedAt, 100);
  const runId = dispatch.runId === undefined ? undefined : requiredString(dispatch.runId, 200);
  if (state === "sending" && (acceptedAt !== undefined || runId !== undefined))
    throw invalidStorage();
  if (state === "accepted" && (acceptedAt === undefined || runId === undefined))
    throw invalidStorage();
  return {
    requestId,
    state,
    startedAt,
    ...(acceptedAt !== undefined ? { acceptedAt } : {}),
    ...(runId !== undefined ? { runId } : {}),
  };
}

function readStoredQueue(value: unknown): StoredQueuedPromptQueue {
  if (value === null) return { version: QUEUED_PROMPT_STORAGE_VERSION, items: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidStorage();
  const queue = value as Record<string, unknown>;
  if (
    queue.version !== QUEUED_PROMPT_STORAGE_VERSION ||
    !Array.isArray(queue.items) ||
    queue.items.length > MAX_QUEUED_PROMPTS
  )
    throw invalidStorage();
  const ids = new Set<string>();
  const items = queue.items.map((raw): StoredQueuedPromptItem => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidStorage();
    const item = raw as Record<string, unknown>;
    const id = requiredString(item.id, 200);
    validateItemId(id);
    if (ids.has(id)) throw invalidStorage();
    ids.add(id);
    const attachments = storedAttachments(item.attachments);
    const text = normalizeText(item.text);
    const temporaryInstruction = storedTemporaryInstruction(item.temporaryInstruction);
    if (!text.trim() && attachments.length === 0) throw invalidStorage();
    const createdAt = requiredString(item.createdAt, 100);
    const updatedAt = requiredString(item.updatedAt, 100);
    const dispatch = storedDispatch(item.dispatch);
    return {
      id,
      text,
      ...(temporaryInstruction ? { temporaryInstruction } : {}),
      attachments,
      snapshot: storedSnapshot(item.snapshot),
      ...(dispatch ? { dispatch } : {}),
      createdAt,
      updatedAt,
    };
  });
  if (queueAttachmentBytes(items) > MAX_QUEUED_PROMPT_ATTACHMENT_BYTES) throw invalidStorage();
  return { version: QUEUED_PROMPT_STORAGE_VERSION, items };
}

export class QueuedPromptService {
  constructor(
    private readonly repository: Pick<
      Repository,
      "getSession" | "getSetting" | "setSetting" | "removeSetting"
    >,
    private readonly runtime: QueuedPromptRuntime,
  ) {}

  list(sessionId: string): QueuedPromptView[] {
    validateSessionId(sessionId);
    const queue = this.readQueue(sessionId);
    const session = this.repository.getSession(sessionId);
    return queue.items.map((item) => this.toView(sessionId, item, session, queue.items[0]?.id));
  }

  add(input: QueuedPromptAddInput): QueuedPromptView {
    if (!input || typeof input !== "object") throw new Error("队列消息格式无效。");
    validateSessionId(input.sessionId);
    const session = this.repository.getSession(input.sessionId);
    if (!session) throw new Error("会话不存在。");
    assertQueueEligibleSession(session);
    if (session.archived) throw new Error("请先从设置中恢复已归档会话，再添加队列消息。");
    if (!this.runtime.isSessionBusy(input.sessionId))
      throw new Error(
        `${QUEUED_PROMPT_REQUIRES_ACTIVE_RUN}: 仅可在当前任务运行、等待审批或准备发送时添加下一轮消息。`,
      );
    const queue = this.readQueue(input.sessionId);
    if (queue.items.length >= MAX_QUEUED_PROMPTS)
      throw new Error(`每个会话最多保留 ${MAX_QUEUED_PROMPTS} 条队列消息。`);
    const text = normalizeText(input.text);
    const temporaryInstruction = normalizeTemporaryInstruction(input.temporaryInstruction);
    const attachments = normalizeAttachments(input.attachments);
    if (!text.trim() && attachments.length === 0) throw new Error("队列消息和附件不能同时为空。");
    if (
      queueAttachmentBytes(queue.items) + attachmentBytes(attachments) >
      MAX_QUEUED_PROMPT_ATTACHMENT_BYTES
    )
      throw new Error("该会话的队列附件总量超过 50 MiB 限制。");
    const now = new Date().toISOString();
    const item: StoredQueuedPromptItem = {
      id: randomUUID(),
      text,
      ...(temporaryInstruction ? { temporaryInstruction } : {}),
      attachments,
      snapshot: snapshotForSession(session),
      createdAt: now,
      updatedAt: now,
    };
    queue.items.push(item);
    this.writeQueue(input.sessionId, queue);
    return this.toView(input.sessionId, item, session, queue.items[0]?.id);
  }

  update(input: QueuedPromptUpdateInput): QueuedPromptView {
    if (!input || typeof input !== "object") throw new Error("队列消息格式无效。");
    validateSessionId(input.sessionId);
    validateItemId(input.itemId);
    this.assertNotContinuing(input.sessionId, input.itemId);
    const queue = this.readQueue(input.sessionId);
    const index = queue.items.findIndex((item) => item.id === input.itemId);
    if (index < 0) throw new Error(`${QUEUED_PROMPT_NOT_FOUND}: 队列消息不存在。`);
    const current = queue.items[index];
    if (!current) throw new Error(`${QUEUED_PROMPT_NOT_FOUND}: 队列消息不存在。`);
    this.assertNotDispatched(input.sessionId, current);
    const text = normalizeText(input.text);
    const temporaryInstruction =
      input.temporaryInstruction === undefined
        ? current.temporaryInstruction
        : normalizeTemporaryInstruction(input.temporaryInstruction);
    const attachments =
      input.attachments === undefined
        ? current.attachments
        : normalizeAttachments(input.attachments);
    if (!text.trim() && attachments.length === 0) throw new Error("队列消息和附件不能同时为空。");
    const otherBytes = queueAttachmentBytes(queue.items.filter((item) => item.id !== current.id));
    if (otherBytes + attachmentBytes(attachments) > MAX_QUEUED_PROMPT_ATTACHMENT_BYTES)
      throw new Error("该会话的队列附件总量超过 50 MiB 限制。");
    const updated: StoredQueuedPromptItem = {
      id: current.id,
      text,
      ...(temporaryInstruction ? { temporaryInstruction } : {}),
      attachments,
      snapshot: current.snapshot,
      ...(current.dispatch ? { dispatch: current.dispatch } : {}),
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    queue.items[index] = updated;
    this.writeQueue(input.sessionId, queue);
    return this.toView(
      input.sessionId,
      updated,
      this.repository.getSession(input.sessionId),
      queue.items[0]?.id,
    );
  }

  reorder(input: QueuedPromptReorderInput): QueuedPromptView[] {
    if (!input || typeof input !== "object") throw new Error("队列排序参数格式无效。");
    validateSessionId(input.sessionId);
    validateItemId(input.itemId);
    if (
      !Number.isSafeInteger(input.targetIndex) ||
      input.targetIndex < 0 ||
      input.targetIndex >= MAX_QUEUED_PROMPTS
    )
      throw new Error("队列目标位置无效。");
    const queue = this.readQueue(input.sessionId);
    const index = queue.items.findIndex((item) => item.id === input.itemId);
    if (index < 0) throw new Error(`${QUEUED_PROMPT_NOT_FOUND}: 队列消息不存在。`);
    if (input.targetIndex >= queue.items.length) throw new Error("队列目标位置无效。");
    const item = queue.items[index];
    if (!item) throw new Error(`${QUEUED_PROMPT_NOT_FOUND}: 队列消息不存在。`);
    this.assertNotDispatched(input.sessionId, item);
    if (index !== input.targetIndex) throw new Error("队列按加入顺序自动发送，不支持调整顺序。");
    return this.list(input.sessionId);
  }

  remove(sessionId: string, itemId: string): void {
    validateSessionId(sessionId);
    validateItemId(itemId);
    this.assertNotContinuing(sessionId, itemId);
    const queue = this.readQueue(sessionId);
    const nextItems = queue.items.filter((item) => item.id !== itemId);
    if (nextItems.length === queue.items.length)
      throw new Error(`${QUEUED_PROMPT_NOT_FOUND}: 队列消息不存在。`);
    this.writeQueue(sessionId, { ...queue, items: nextItems });
    for (const [editId, hold] of this.editHolds)
      if (hold.sessionId === sessionId && hold.itemId === itemId) this.editHolds.delete(editId);
    this.schedule(sessionId);
  }

  async continue(sessionId: string, itemId: string): Promise<QueuedPromptContinueResult> {
    validateSessionId(sessionId);
    validateItemId(itemId);
    if (this.closed) throw new Error("Application is shutting down.");
    const key = this.continuingKey(sessionId, itemId);
    if (this.continuingSessions.has(sessionId))
      throw new Error(`${QUEUED_PROMPT_CONTINUING}: 该会话已有队列消息正在发送，请稍候。`);
    if (this.continuing.has(key))
      throw new Error(`${QUEUED_PROMPT_CONTINUING}: 该队列消息正在发送，请稍候。`);
    this.continuingSessions.add(sessionId);
    this.continuing.add(key);
    try {
      const queue = this.readQueue(sessionId);
      const item = queue.items.find((entry) => entry.id === itemId);
      if (!item) throw new Error(`${QUEUED_PROMPT_NOT_FOUND}: 队列消息不存在。`);
      if (queue.items[0]?.id !== itemId)
        throw new Error("队列按加入顺序发送，请先处理第一条消息。");
      const session = this.repository.getSession(sessionId);
      if (session) assertQueueEligibleSession(session);
      const view = this.toView(sessionId, item, session);
      this.assertContinuable(view);
      const requestId = randomUUID();
      const startedAt = new Date().toISOString();
      const dispatch = { requestId, state: "sending" as const, startedAt };
      this.replaceQueueItem(queue, { ...item, dispatch });
      // Claiming before send prevents an accepted run from being retried after a later
      // persistence failure or process exit.
      this.writeQueue(sessionId, queue);
      const automatic = this.automaticState(sessionId);
      automatic.ready = false;
      automatic.pauseReason = null;
      automatic.error = null;
      const generation = automatic.generation;
      let accepted: { runId: string };
      try {
        accepted = await this.runtime.send({
          sessionId,
          text: item.text,
          attachments: item.attachments,
          ...(item.temporaryInstruction ? { temporaryInstruction: item.temporaryInstruction } : {}),
        });
      } catch (sendError) {
        if (automatic.generation === generation) {
          automatic.pauseReason = "send_failed";
          automatic.error = sendError instanceof Error ? sendError.message : String(sendError);
        }
        try {
          const latest = this.readQueue(sessionId);
          const current = latest.items.find((entry) => entry.id === itemId);
          if (current?.dispatch?.requestId === requestId) {
            const { dispatch: _dispatch, ...restored } = current;
            this.replaceQueueItem(latest, restored);
            this.writeQueue(sessionId, latest);
          }
        } catch (resetError) {
          const sendMessage = sendError instanceof Error ? sendError.message : String(sendError);
          const resetMessage =
            resetError instanceof Error ? resetError.message : String(resetError);
          throw new Error(
            `${QUEUED_PROMPT_DISPATCH_PENDING}: ${sendMessage}；派发状态无法回退，为避免重复发送已禁止重试。${resetMessage}`,
          );
        }
        throw sendError;
      }
      this.dispatchedItems.add(key);
      const acceptedAt = new Date().toISOString();
      let cleanupWarning: string | undefined;
      try {
        const acceptedQueue = this.readQueue(sessionId);
        const current = acceptedQueue.items.find((entry) => entry.id === itemId);
        if (current?.dispatch?.requestId !== requestId) throw new Error("队列派发关联已变化。");
        this.replaceQueueItem(acceptedQueue, {
          ...current,
          dispatch: {
            ...current.dispatch,
            state: "accepted",
            acceptedAt,
            runId: accepted.runId,
          },
        });
        this.writeQueue(sessionId, acceptedQueue);
        const cleanupQueue = this.readQueue(sessionId);
        this.writeQueue(sessionId, {
          ...cleanupQueue,
          items: cleanupQueue.items.filter((entry) => entry.id !== itemId),
        });
        this.dispatchedItems.delete(key);
      } catch (cause) {
        cleanupWarning = `任务已启动（${accepted.runId}），但队列记录未能立即清理。该项已锁定，不能再次发送；可稍后删除。${cause instanceof Error ? cause.message : String(cause)}`;
        automatic.error = cleanupWarning;
      }
      return {
        itemId,
        runId: accepted.runId,
        dispatchId: requestId,
        ...(cleanupWarning ? { cleanupWarning } : {}),
      };
    } finally {
      this.continuing.delete(key);
      this.continuingSessions.delete(sessionId);
      this.notify(sessionId);
      this.schedule(sessionId);
    }
  }

  runStarted(sessionId: string, runId: string, kind?: "compaction"): void {
    if (this.closed) return;
    if (kind === "compaction" && !this.continuingSessions.has(sessionId)) return;
    const state = this.automaticState(sessionId);
    state.ready = false;
    state.pauseReason = null;
    state.error = null;
    state.generation += 1;
    state.runId = runId;
    this.notify(sessionId);
  }

  runSettled(input: {
    sessionId: string;
    runId: string;
    outcome: "completed" | "failed" | "interrupted";
  }): void {
    if (this.closed) return;
    const state = this.automaticState(input.sessionId);
    if (state.runId !== input.runId || state.settledRunId === input.runId) return;
    state.settledRunId = input.runId;
    state.generation += 1;
    if (input.outcome === "failed" && !state.error)
      state.error = "当前任务未能正常完成，请检查运行记录后恢复队列。";
    // Stop also closes the short interval between completion and automatic dispatch.
    if (state.pauseReason !== "stopped" && state.pauseReason !== "editing") {
      state.ready = input.outcome === "completed";
      state.pauseReason =
        input.outcome === "completed"
          ? null
          : input.outcome === "interrupted"
            ? "stopped"
            : "failed";
    }
    this.notify(input.sessionId);
    this.schedule(input.sessionId);
  }

  runFailed(sessionId: string, runId: string, error: string): void {
    if (this.closed) return;
    const state = this.automatic.get(sessionId);
    if (state?.runId === runId) state.error = error;
  }

  pause(sessionId: string, reason: QueuedPromptPauseReason = "stopped"): void {
    if (this.closed) return;
    const state = this.automaticState(sessionId);
    state.ready = false;
    state.pauseReason = reason;
    state.generation += 1;
    this.notify(sessionId);
  }

  sessionChanged(sessionId: string): void {
    this.notify(sessionId);
    this.schedule(sessionId);
  }

  beginEdit(sessionId: string, itemId: string, ownerId = 0): string {
    validateSessionId(sessionId);
    validateItemId(itemId);
    if (this.closed) throw new Error("Application is shutting down.");
    const session = this.repository.getSession(sessionId);
    if (!session) throw new Error("会话不存在。");
    assertQueueEligibleSession(session);
    this.assertNotContinuing(sessionId, itemId);
    const item = this.readQueue(sessionId).items.find((entry) => entry.id === itemId);
    if (!item) throw new Error(`${QUEUED_PROMPT_NOT_FOUND}: 队列消息不存在。`);
    this.assertNotDispatched(sessionId, item);
    const editId = randomUUID();
    this.editHolds.set(editId, { sessionId, itemId, ownerId });
    this.notify(sessionId);
    return editId;
  }

  endEdit(sessionId: string, editId: string, abandon = false, ownerId = 0): void {
    validateSessionId(sessionId);
    validateItemId(editId);
    if (typeof abandon !== "boolean") throw new Error("队列编辑状态无效。");
    const hold = this.editHolds.get(editId);
    if (!hold) return;
    if (hold.sessionId !== sessionId || hold.ownerId !== ownerId)
      throw new Error("队列编辑凭据不匹配。");
    this.editHolds.delete(editId);
    if (abandon) this.pause(sessionId, "editing");
    this.notify(sessionId);
    this.schedule(sessionId);
  }

  abandonEdits(ownerId: number): void {
    for (const [editId, hold] of this.editHolds) {
      if (hold.ownerId !== ownerId) continue;
      this.editHolds.delete(editId);
      this.pause(hold.sessionId, "editing");
    }
  }

  forgetSession(sessionId: string): void {
    this.automatic.delete(sessionId);
    for (const [editId, hold] of this.editHolds)
      if (hold.sessionId === sessionId) this.editHolds.delete(editId);
  }

  dispose(): void {
    this.closed = true;
    this.editHolds.clear();
    this.automatic.clear();
  }

  private readonly continuing = new Set<string>();
  private readonly continuingSessions = new Set<string>();
  private readonly dispatchedItems = new Set<string>();
  private readonly automatic = new Map<string, AutomaticQueueState>();
  private readonly editHolds = new Map<string, QueueEditHold>();
  private readonly scheduled = new Set<string>();
  private closed = false;

  private automaticState(sessionId: string): AutomaticQueueState {
    let state = this.automatic.get(sessionId);
    if (!state) {
      state = { ready: false, pauseReason: "restarted", error: null, generation: 0 };
      this.automatic.set(sessionId, state);
    }
    return state;
  }

  private hasEditHold(sessionId: string): boolean {
    return [...this.editHolds.values()].some((hold) => hold.sessionId === sessionId);
  }

  private notify(sessionId: string): void {
    if (!this.closed) this.runtime.changed?.(sessionId);
  }

  private schedule(sessionId: string): void {
    if (this.closed || this.scheduled.has(sessionId)) return;
    this.scheduled.add(sessionId);
    queueMicrotask(() => {
      this.scheduled.delete(sessionId);
      void this.dispatchNext(sessionId);
    });
  }

  private async dispatchNext(sessionId: string): Promise<void> {
    const state = this.automatic.get(sessionId);
    if (
      this.closed ||
      !state?.ready ||
      this.continuingSessions.has(sessionId) ||
      this.hasEditHold(sessionId) ||
      this.runtime.isSessionBusy(sessionId)
    )
      return;
    const generation = state.generation;
    try {
      const head = this.list(sessionId)[0];
      if (!head?.canContinue) return;
      await this.continue(sessionId, head.id);
    } catch (cause) {
      if (!this.closed && state.generation === generation) {
        state.ready = false;
        state.pauseReason = "send_failed";
        state.error = cause instanceof Error ? cause.message : String(cause);
        this.notify(sessionId);
      }
    }
  }

  private continuingKey(sessionId: string, itemId: string): string {
    return `${sessionId}\u0000${itemId}`;
  }

  private assertNotContinuing(sessionId: string, itemId: string): void {
    if (this.continuing.has(this.continuingKey(sessionId, itemId)))
      throw new Error(`${QUEUED_PROMPT_CONTINUING}: 该队列消息正在发送，请稍候。`);
  }

  private assertNotDispatched(sessionId: string, item: StoredQueuedPromptItem): void {
    if (item.dispatch || this.dispatchedItems.has(this.continuingKey(sessionId, item.id)))
      throw new Error(
        `${QUEUED_PROMPT_DISPATCH_PENDING}: 该队列项已开始派发或派发结果尚未确认，不能编辑或再次发送。`,
      );
  }

  private assertContinuable(view: QueuedPromptView): void {
    if (view.continuationBlocker === "session_missing") throw new Error("会话不存在。");
    if (view.continuationBlocker === "session_archived")
      throw new Error("请先从设置中恢复已归档会话，再继续队列消息。");
    if (view.continuationBlocker === "session_busy")
      throw new Error("请等待当前任务完成或手动停止后，再继续队列消息。");
    if (view.continuationBlocker === "dispatch_pending")
      throw new Error(
        `${QUEUED_PROMPT_DISPATCH_PENDING}: 该项目已派发或派发结果尚未确认，禁止重试。若确认任务未启动，可删除该队列项。`,
      );
    if (view.continuationBlocker === "configuration_changed")
      throw new Error(
        `${QUEUED_PROMPT_CONFIGURATION_CHANGED}: Agent 配置、供应商、模型、权限、模式或工作目录已变化。为避免用错误配置执行，请删除该队列消息并在下次运行中重新添加。`,
      );
    if (view.continuationBlocker === "editing") throw new Error("请先保存或取消队列编辑。");
    if (view.continuationBlocker === "waiting_turn")
      throw new Error("队列按加入顺序发送，请先处理第一条消息。");
  }

  private readQueue(sessionId: string): StoredQueuedPromptQueue {
    return readStoredQueue(this.repository.getSetting(queuedPromptSettingKey(sessionId)));
  }

  private writeQueue(sessionId: string, queue: StoredQueuedPromptQueue): void {
    if (!queue.items.length) {
      this.repository.removeSetting(queuedPromptSettingKey(sessionId));
      this.notify(sessionId);
      return;
    }
    this.repository.setSetting(queuedPromptSettingKey(sessionId), queue);
    this.notify(sessionId);
  }

  private replaceQueueItem(queue: StoredQueuedPromptQueue, next: StoredQueuedPromptItem): void {
    const index = queue.items.findIndex((item) => item.id === next.id);
    if (index < 0) throw new Error(`${QUEUED_PROMPT_NOT_FOUND}: 队列消息不存在。`);
    queue.items[index] = next;
  }

  private toView(
    sessionId: string,
    item: StoredQueuedPromptItem,
    session: SessionView | null,
    headId = item.id,
  ): QueuedPromptView {
    const changed = session ? changedConfigurationFields(item.snapshot, session) : [];
    const continuationBlocker =
      item.dispatch || this.dispatchedItems.has(this.continuingKey(sessionId, item.id))
        ? "dispatch_pending"
        : !session
          ? "session_missing"
          : session.archived
            ? "session_archived"
            : changed.length
              ? "configuration_changed"
              : this.hasEditHold(sessionId)
                ? "editing"
                : this.runtime.isSessionBusy(sessionId)
                  ? "session_busy"
                  : headId !== item.id
                    ? "waiting_turn"
                    : null;
    const automatic = this.automaticState(sessionId);
    return {
      id: item.id,
      sessionId,
      text: item.text,
      ...(item.temporaryInstruction ? { temporaryInstruction: item.temporaryInstruction } : {}),
      attachments: attachmentViews(item.attachments),
      snapshot: item.snapshot,
      changedConfigurationFields: changed,
      dispatchState: item.dispatch?.state ?? null,
      canContinue: continuationBlocker === null,
      continuationBlocker,
      automaticPauseReason: this.hasEditHold(sessionId)
        ? "editing"
        : this.runtime.isSessionBusy(sessionId) && automatic.pauseReason === "restarted"
          ? null
          : automatic.pauseReason,
      automaticError: automatic.error,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
