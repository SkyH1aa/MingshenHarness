import type { ApprovalDecision, ApprovalRequest, ApprovalState } from "../../shared/domain";

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  abortHandler: () => void;
}

export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly handled = new Map<string, { decision: ApprovalDecision; expiresAt: number }>();
  private revision = 0;

  constructor(private readonly onChange?: (state: ApprovalState) => void) {}

  state(): ApprovalState {
    return {
      revision: this.revision,
      requests: [...this.pending.values()].map(({ request }) => request),
    };
  }

  get(id: string): ApprovalRequest | null {
    return this.pending.get(id)?.request ?? null;
  }

  update(id: string, review: NonNullable<ApprovalRequest["review"]>): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    pending.request = { ...pending.request, review };
    this.changed();
  }

  private changed(): void {
    this.revision++;
    this.onChange?.(this.state());
  }

  request(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    if (signal.aborted) {
      return Promise.reject(new Error("操作已取消。"));
    }

    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        this.pending.delete(request.id);
        this.changed();
        reject(new Error("操作已取消。"));
      };

      this.pending.set(request.id, {
        request,
        resolve,
        reject,
        signal,
        abortHandler,
      });
      signal.addEventListener("abort", abortHandler, { once: true });
      this.changed();
    });
  }

  decide(input: ApprovalDecision): void {
    if (!["allow_once", "allow_session", "deny"].includes(input.decision))
      throw new Error("Invalid approval decision.");
    const pending = this.pending.get(input.approvalId);
    if (!pending) {
      const handled = this.handled.get(input.approvalId);
      if (handled && handled.expiresAt > Date.now()) {
        return;
      }
      throw new Error("审批请求不存在或已经处理。");
    }

    this.pending.delete(input.approvalId);
    pending.signal.removeEventListener("abort", pending.abortHandler);
    for (const [id, handled] of this.handled) {
      if (handled.expiresAt <= Date.now()) {
        this.handled.delete(id);
      }
    }
    this.handled.set(input.approvalId, {
      decision: input,
      expiresAt: Date.now() + 60_000,
    });
    pending.resolve(input);
    this.changed();
  }

  cancelSession(sessionId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.request.sessionId !== sessionId) {
        continue;
      }
      this.pending.delete(id);
      pending.signal.removeEventListener("abort", pending.abortHandler);
      pending.reject(new Error("审批已取消。"));
      this.changed();
    }
  }
}
