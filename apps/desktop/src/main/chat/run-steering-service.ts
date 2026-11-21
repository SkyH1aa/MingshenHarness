import { randomUUID } from "node:crypto";
import {
  COMPOSER_DRAFT_CONFLICT_MESSAGE,
  validateComposerDraftId,
} from "../../shared/composer-draft";
import type { ChatStreamEvent, SessionMessage } from "../../shared/domain";
import {
  MAX_PENDING_RUN_STEERING,
  MAX_RUN_STEERING_TEXT_CHARS,
  MAX_RUN_STEERING_TOTAL_CHARS,
  type RunSteeringInput,
  type RunSteeringMessage,
  type RunSteeringReceipt,
  type RunSteeringState,
} from "../../shared/run-steering";
import type { Repository } from "../storage/repository";

interface StoredMessage extends RunSteeringMessage {
  requestId: string;
  draftRevision: string | null;
}

interface StoredRun {
  runId: string;
  messages: StoredMessage[];
}

interface StoredSteering {
  version: 1;
  runs: StoredRun[];
}

interface ActiveRun {
  runId: string;
  signal: AbortSignal;
}

const interruptedReason = "运行已结束或中断，引导未接入模型请求。";

function invalidStorage(): Error {
  return new Error("运行中引导记录损坏，原数据未覆盖。");
}

function validId(value: unknown): value is string {
  try {
    validateComposerDraftId(value);
    return true;
  } catch {
    return false;
  }
}

function readStorage(value: unknown): StoredSteering {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidStorage();
  const stored = value as Record<string, unknown>;
  if (stored.version !== 1 || !Array.isArray(stored.runs)) throw invalidStorage();
  const runIds = new Set<string>();
  const messageIds = new Set<string>();
  const requestIds = new Set<string>();
  const runs = stored.runs.map((raw): StoredRun => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidStorage();
    const run = raw as Record<string, unknown>;
    if (!validId(run.runId) || runIds.has(run.runId) || !Array.isArray(run.messages))
      throw invalidStorage();
    runIds.add(run.runId);
    let total = 0;
    let pending = 0;
    const messages = run.messages.map((entry): StoredMessage => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidStorage();
      const message = entry as Record<string, unknown>;
      if (
        !validId(message.id) ||
        !validId(message.requestId) ||
        messageIds.has(message.id) ||
        requestIds.has(message.requestId) ||
        (message.draftRevision !== null && !validId(message.draftRevision)) ||
        typeof message.text !== "string" ||
        !message.text.trim() ||
        message.text.length > MAX_RUN_STEERING_TEXT_CHARS ||
        (message.status !== "pending" &&
          message.status !== "delivered" &&
          message.status !== "unapplied") ||
        typeof message.createdAt !== "string" ||
        !message.createdAt ||
        message.createdAt.length > 100 ||
        (message.deliveredAt !== null &&
          (typeof message.deliveredAt !== "string" || message.deliveredAt.length > 100)) ||
        (message.reason !== null &&
          (typeof message.reason !== "string" || message.reason.length > 1000)) ||
        (message.status === "delivered") !== (message.deliveredAt !== null) ||
        (message.status === "unapplied") !== (message.reason !== null)
      )
        throw invalidStorage();
      messageIds.add(message.id);
      requestIds.add(message.requestId);
      total += message.text.length;
      if (message.status === "pending") pending++;
      return {
        id: message.id,
        requestId: message.requestId,
        draftRevision: message.draftRevision as string | null,
        text: message.text,
        status: message.status,
        createdAt: message.createdAt,
        deliveredAt: message.deliveredAt as string | null,
        reason: message.reason as string | null,
      };
    });
    if (total > MAX_RUN_STEERING_TOTAL_CHARS || pending > MAX_PENDING_RUN_STEERING)
      throw invalidStorage();
    return { runId: run.runId, messages };
  });
  return { version: 1, runs };
}

function publicMessage(message: StoredMessage): RunSteeringMessage {
  const { requestId: _requestId, draftRevision: _draftRevision, ...result } = message;
  return result;
}

export class RunSteeringService {
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    private readonly repository: Repository,
    private readonly emit: (event: ChatStreamEvent) => void,
  ) {}

  register(sessionId: string, runId: string, signal: AbortSignal): void {
    validateComposerDraftId(sessionId);
    validateComposerDraftId(runId);
    const session = this.repository.getSession(sessionId);
    if (!session || session.parentSessionId) throw new Error("该会话不支持运行中引导。");
    if (this.active.has(sessionId)) throw new Error("该会话已有运行中引导状态。");
    this.active.set(sessionId, { runId, signal });
    try {
      const storage = this.read(sessionId);
      this.recoverOrphans(sessionId, storage);
      if (storage.runs.some((run) => run.runId === runId)) throw new Error("运行标识已存在。");
      storage.runs.push({ runId, messages: [] });
      this.write(sessionId, storage);
      this.notify(sessionId, storage);
    } catch (error) {
      this.active.delete(sessionId);
      throw error;
    }
  }

  get(sessionId: string): RunSteeringState | null {
    validateComposerDraftId(sessionId);
    if (!this.repository.getSession(sessionId)) return null;
    const storage = this.read(sessionId);
    this.recoverOrphans(sessionId, storage);
    return this.view(sessionId, storage);
  }

  enqueue(input: RunSteeringInput): RunSteeringReceipt {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("运行中引导格式无效。");
    validateComposerDraftId(input.sessionId);
    validateComposerDraftId(input.runId);
    validateComposerDraftId(input.requestId);
    if (input.draftRevision !== undefined) validateComposerDraftId(input.draftRevision);
    const raw = input as unknown as Record<string, unknown>;
    if (raw.attachments !== undefined || raw.temporaryInstruction !== undefined)
      throw new Error("运行中引导仅支持文字，不支持附件或临时指令。");
    if (typeof input.text !== "string" || input.text.length > MAX_RUN_STEERING_TEXT_CHARS)
      throw new Error("运行中引导文本格式无效或过长。");
    const text = input.text.trim();
    if (!text || text.length > MAX_RUN_STEERING_TEXT_CHARS)
      throw new Error(`引导文本须为 1 至 ${MAX_RUN_STEERING_TEXT_CHARS} 个字符。`);
    const session = this.repository.getSession(input.sessionId);
    if (!session || session.parentSessionId || session.archived)
      throw new Error("该会话不支持运行中引导。");

    const result = this.repository.runInSavepoint(() => {
      const storage = this.read(input.sessionId);
      const existing = storage.runs.flatMap((run) =>
        run.messages
          .filter((message) => message.requestId === input.requestId)
          .map((message) => ({ runId: run.runId, message })),
      )[0];
      if (existing) {
        if (
          existing.runId !== input.runId ||
          existing.message.text !== text ||
          existing.message.draftRevision !== (input.draftRevision ?? null)
        )
          throw new Error("引导请求标识已用于不同内容。");
        return {
          receipt: { runId: existing.runId, messageId: existing.message.id },
          storage,
          duplicate: true,
        };
      }
      this.assertActive(input.sessionId, input.runId);
      const run = storage.runs.find((entry) => entry.runId === input.runId);
      if (!run) throw new Error("运行中引导状态不存在。");
      if (
        run.messages.filter((message) => message.status === "pending").length >=
        MAX_PENDING_RUN_STEERING
      )
        throw new Error(`最多等待 ${MAX_PENDING_RUN_STEERING} 条引导。`);
      if (
        run.messages.reduce((total, message) => total + message.text.length, 0) + text.length >
        MAX_RUN_STEERING_TOTAL_CHARS
      )
        throw new Error(`本次运行的引导总长度不能超过 ${MAX_RUN_STEERING_TOTAL_CHARS} 个字符。`);
      if (input.draftRevision !== undefined) {
        const draft = this.repository.getComposerDraft(input.sessionId);
        if (
          !draft ||
          draft.revision !== input.draftRevision ||
          draft.text.trim() !== text ||
          draft.attachments.length > 0
        )
          throw new Error(COMPOSER_DRAFT_CONFLICT_MESSAGE);
      }
      const message: StoredMessage = {
        id: randomUUID(),
        requestId: input.requestId,
        draftRevision: input.draftRevision ?? null,
        text,
        status: "pending",
        createdAt: new Date().toISOString(),
        deliveredAt: null,
        reason: null,
      };
      run.messages.push(message);
      this.write(input.sessionId, storage);
      if (
        input.draftRevision !== undefined &&
        !this.repository.clearComposerDraft(input.sessionId, input.draftRevision)
      )
        throw new Error(COMPOSER_DRAFT_CONFLICT_MESSAGE);
      return {
        receipt: { runId: input.runId, messageId: message.id },
        storage,
        duplicate: false,
      };
    });
    if (!result.duplicate) {
      if (input.draftRevision !== undefined)
        this.safeEmit({
          type: "composer_draft_consumed",
          sessionId: input.sessionId,
          revision: input.draftRevision,
        });
      this.notify(input.sessionId, result.storage);
    }
    return result.receipt;
  }

  pending(sessionId: string, runId: string): RunSteeringMessage[] {
    this.assertActive(sessionId, runId);
    const run = this.read(sessionId).runs.find((entry) => entry.runId === runId);
    return run?.messages.filter((message) => message.status === "pending").map(publicMessage) ?? [];
  }

  deliver(sessionId: string, runId: string, ids: string[]): SessionMessage[] {
    this.assertActive(sessionId, runId);
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || !ids.every(validId))
      throw new Error("运行中引导投递标识无效。");
    if (!ids.length) return [];
    const result = this.repository.runInSavepoint(() => {
      const storage = this.read(sessionId);
      const run = storage.runs.find((entry) => entry.runId === runId);
      if (!run) throw new Error("运行中引导状态不存在。");
      const selected = ids.map((id) => run.messages.find((message) => message.id === id));
      if (selected.every((message) => message?.status === "delivered"))
        return { messages: [], storage };
      const waiting = run.messages.filter((message) => message.status === "pending");
      if (selected.some((message, index) => !message || message !== waiting[index]))
        throw new Error("运行中引导投递顺序已变化。");
      const now = new Date().toISOString();
      const messages = selected.map((message) => {
        if (!message) throw new Error("运行中引导不存在。");
        const result = this.repository.appendMessage({
          sessionId,
          role: "user",
          parts: [{ type: "text", text: message.text }],
        });
        message.status = "delivered";
        message.deliveredAt = now;
        return result;
      });
      this.write(sessionId, storage);
      return { messages, storage };
    });
    if (result.messages.length) {
      this.notify(sessionId, result.storage);
      for (const message of result.messages)
        this.safeEmit({ type: "user_message", sessionId, runId, message });
    }
    return result.messages;
  }

  close(sessionId: string, runId: string, reason: string): void {
    const active = this.active.get(sessionId);
    if (!active || active.runId !== runId) return;
    this.active.delete(sessionId);
    const storage = this.read(sessionId);
    const run = storage.runs.find((entry) => entry.runId === runId);
    if (run) {
      for (const message of run.messages) {
        if (message.status === "pending") {
          message.status = "unapplied";
          message.reason = reason.trim().slice(0, 1000) || interruptedReason;
        }
      }
      this.write(sessionId, storage);
    }
    this.notify(sessionId, storage);
  }

  private assertActive(sessionId: string, runId: string): void {
    validateComposerDraftId(sessionId);
    validateComposerDraftId(runId);
    const active = this.active.get(sessionId);
    if (!active || active.runId !== runId || active.signal.aborted)
      throw new Error("当前运行已结束，不能接收引导。");
  }

  private read(sessionId: string): StoredSteering {
    const key = `runSteering.v1.${sessionId}`;
    const value = this.repository.getSetting(key);
    if (value === null) {
      if (this.repository.hasSetting(key)) throw invalidStorage();
      return { version: 1, runs: [] };
    }
    return readStorage(value);
  }

  private write(sessionId: string, storage: StoredSteering): void {
    this.repository.setSetting(`runSteering.v1.${sessionId}`, storage);
  }

  private recoverOrphans(sessionId: string, storage: StoredSteering): void {
    const active = this.active.get(sessionId);
    let changed = false;
    for (const run of storage.runs) {
      if (active?.runId === run.runId && !active.signal.aborted) continue;
      for (const message of run.messages) {
        if (message.status === "pending") {
          message.status = "unapplied";
          message.reason = interruptedReason;
          changed = true;
        }
      }
    }
    if (changed) this.write(sessionId, storage);
  }

  private view(sessionId: string, storage: StoredSteering): RunSteeringState | null {
    const active = this.active.get(sessionId);
    const current = active
      ? storage.runs.find((run) => run.runId === active.runId)
      : storage.runs.at(-1);
    if (!current) return null;
    return {
      sessionId,
      runId: current.runId,
      accepting: Boolean(active?.runId === current.runId && !active.signal.aborted),
      messages: storage.runs.flatMap((run) =>
        run.messages
          .filter((message) => run === current || message.status === "unapplied")
          .map(publicMessage),
      ),
    };
  }

  private notify(sessionId: string, storage: StoredSteering): void {
    this.safeEmit({
      type: "run_steering_updated",
      sessionId,
      state: this.view(sessionId, storage),
    });
  }

  private safeEmit(event: ChatStreamEvent): void {
    try {
      this.emit(event);
    } catch {
      // Persistence has already committed; listeners can reload the authoritative state.
    }
  }
}
