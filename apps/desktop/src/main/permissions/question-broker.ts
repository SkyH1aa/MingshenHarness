import type { QuestionAnswer, QuestionRequest, QuestionState } from "../../shared/domain";
import { normalizeQuestionAnswer } from "../../shared/questions";

interface PendingQuestion {
  request: QuestionRequest;
  resolve: (answer: QuestionAnswer) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  abortHandler: () => void;
}

export class QuestionBroker {
  private readonly pending = new Map<string, PendingQuestion>();
  private readonly answered = new Map<string, number>();
  private revision = 0;

  constructor(
    private readonly onResolved?: (request: QuestionRequest) => void,
    private readonly onChange?: (state: QuestionState) => void,
  ) {}

  state(): QuestionState {
    return { revision: this.revision, requests: this.list() };
  }

  private changed(): void {
    this.revision++;
    this.onChange?.(this.state());
  }

  list(): QuestionRequest[] {
    return [...this.pending.values()].map(({ request }) => request);
  }

  get(id: string): QuestionRequest | null {
    return this.pending.get(id)?.request ?? null;
  }

  ask(request: QuestionRequest, signal: AbortSignal): Promise<QuestionAnswer> {
    if (signal.aborted) {
      return Promise.reject(new Error("问题已取消。"));
    }
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        this.pending.delete(request.id);
        this.changed();
        this.onResolved?.(request);
        reject(new Error("问题已取消。"));
      };
      this.pending.set(request.id, { request, resolve, reject, signal, abortHandler });
      signal.addEventListener("abort", abortHandler, { once: true });
      this.changed();
    });
  }

  answer(answer: QuestionAnswer): void {
    if (!answer || typeof answer.questionId !== "string") throw new Error("Invalid question id.");
    const pending = this.pending.get(answer.questionId);
    if (!pending) {
      if ((this.answered.get(answer.questionId) ?? 0) > Date.now()) return;
      throw new Error("问题不存在或已经回答。");
    }
    const normalized = normalizeQuestionAnswer(pending.request, answer);
    this.pending.delete(answer.questionId);
    pending.signal.removeEventListener("abort", pending.abortHandler);
    for (const [id, expiresAt] of this.answered)
      if (expiresAt <= Date.now()) this.answered.delete(id);
    this.answered.set(answer.questionId, Date.now() + 60_000);
    pending.resolve(normalized);
    this.changed();
    this.onResolved?.(pending.request);
  }

  cancelSession(sessionId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.request.sessionId !== sessionId) {
        continue;
      }
      this.pending.delete(id);
      pending.signal.removeEventListener("abort", pending.abortHandler);
      pending.reject(new Error("问题已取消。"));
      this.changed();
      this.onResolved?.(pending.request);
    }
  }
}
