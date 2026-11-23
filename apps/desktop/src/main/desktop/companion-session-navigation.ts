import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const MAX_PENDING_REQUESTS = 16;
const REQUEST_TIMEOUT_MS = 10_000;

export type CompanionSessionNavigationErrorCode =
  | "busy"
  | "unsaved_plan"
  | "unsaved_edits"
  | "unavailable"
  | "failed"
  | "timeout";

type RejectionReason = Exclude<CompanionSessionNavigationErrorCode, "timeout">;

export class CompanionSessionNavigationError extends Error {
  constructor(readonly code: CompanionSessionNavigationErrorCode) {
    super(`Companion session navigation was not completed: ${code}`);
    this.name = "CompanionSessionNavigationError";
  }
}

interface PendingRequest {
  senderId: number;
  sessionId: string;
  deadline: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

type NavigationReceipt = { requestId: string; accepted: false; reason: RejectionReason };

export class CompanionSessionNavigationRequests {
  private readonly pending = new Map<string, PendingRequest>();
  private disposed = false;

  constructor(private readonly now: () => number = () => performance.now()) {}

  request(senderId: number, sessionId: string, send: (requestId: string) => void): Promise<void> {
    if (
      this.disposed ||
      this.pending.size >= MAX_PENDING_REQUESTS ||
      !validSenderId(senderId) ||
      typeof sessionId !== "string" ||
      !sessionId
    ) {
      return Promise.reject(new CompanionSessionNavigationError("unavailable"));
    }

    let requestId: string;
    do {
      requestId = randomUUID();
    } while (this.pending.has(requestId));

    return new Promise<void>((resolve, reject) => {
      const deadline = this.now() + REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.reject(new CompanionSessionNavigationError("timeout"));
      }, REQUEST_TIMEOUT_MS);
      const pending: PendingRequest = {
        senderId,
        sessionId,
        deadline,
        resolve,
        reject,
        timer,
      };
      this.pending.set(requestId, pending);
      try {
        send(requestId);
      } catch (error) {
        if (this.pending.get(requestId) === pending) {
          this.pending.delete(requestId);
          clearTimeout(timer);
          reject(error);
        }
      }
    });
  }

  preflight(
    senderId: number,
    requestId: unknown,
    sessionId: unknown,
    validate: () => boolean,
  ): boolean {
    if (
      !validSenderId(senderId) ||
      typeof requestId !== "string" ||
      !requestId ||
      typeof sessionId !== "string" ||
      !sessionId
    )
      return false;
    const pending = this.pending.get(requestId);
    if (!pending || pending.senderId !== senderId || pending.sessionId !== sessionId) return false;
    if (this.now() >= pending.deadline) {
      this.rejectPending(requestId, pending, "timeout");
      return false;
    }

    let valid = false;
    try {
      valid = validate() === true;
    } catch {
      // A failed session check must never authorize a delayed selection.
    }
    if (this.pending.get(requestId) !== pending) return false;
    if (this.now() >= pending.deadline) {
      this.rejectPending(requestId, pending, "timeout");
      return false;
    }
    if (!valid) {
      this.rejectPending(requestId, pending, "unavailable");
      return false;
    }
    return true;
  }

  claim(
    senderId: number,
    requestId: unknown,
    sessionId: unknown,
    validate: () => boolean,
  ): boolean {
    if (!this.preflight(senderId, requestId, sessionId, validate) || typeof requestId !== "string")
      return false;
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve();
    return true;
  }

  settle(senderId: number, input: unknown): void {
    const receipt = normalizeReceipt(input);
    if (!validSenderId(senderId)) throw new Error("Invalid companion navigation receipt.");
    const pending = this.pending.get(receipt.requestId);
    if (!pending || pending.senderId !== senderId)
      throw new Error("Unknown companion navigation request.");
    this.rejectPending(
      receipt.requestId,
      pending,
      this.now() >= pending.deadline ? "timeout" : receipt.reason,
    );
  }

  cancelSender(senderId: number): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.senderId !== senderId) continue;
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(new CompanionSessionNavigationError("unavailable"));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CompanionSessionNavigationError("unavailable"));
    }
    this.pending.clear();
  }

  private rejectPending(
    requestId: string,
    pending: PendingRequest,
    reason: CompanionSessionNavigationErrorCode,
  ): void {
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.reject(new CompanionSessionNavigationError(reason));
  }
}

function validSenderId(senderId: number): boolean {
  return Number.isSafeInteger(senderId) && senderId > 0;
}

function normalizeReceipt(value: unknown): NavigationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid companion navigation receipt.");
  const input = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(input).some(
      (key) => key !== "requestId" && key !== "accepted" && key !== "reason",
    ) ||
    !Object.hasOwn(input, "requestId") ||
    !Object.hasOwn(input, "accepted") ||
    typeof input.requestId !== "string" ||
    !input.requestId ||
    input.accepted !== false
  )
    throw new Error("Invalid companion navigation receipt.");

  if (
    !Object.hasOwn(input, "reason") ||
    (input.reason !== "busy" &&
      input.reason !== "unsaved_plan" &&
      input.reason !== "unsaved_edits" &&
      input.reason !== "unavailable" &&
      input.reason !== "failed")
  )
    throw new Error("Invalid companion navigation receipt.");
  return { requestId: input.requestId, accepted: false, reason: input.reason };
}
