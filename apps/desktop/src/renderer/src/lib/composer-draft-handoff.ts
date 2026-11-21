import type { ComposerDraftStore } from "./composer-drafts";

export class ComposerDraftHandoff {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failed = new Map<string, Set<string>>();

  constructor(private readonly drafts: ComposerDraftStore) {}

  append(sessionId: string, text: string): Promise<void> {
    const previous = this.pending.get(sessionId) ?? Promise.resolve();
    const attempt = previous
      .catch(() => undefined)
      .then(async () => {
        await this.drafts.load(sessionId);
        const current = this.drafts.state(sessionId);
        if (current.conflict) throw new Error("请先处理输入区的草稿冲突，再添加内容。");
        const retry = this.failed.get(sessionId)?.has(text) && current.value.text.includes(text);
        if (!retry)
          this.drafts.update(sessionId, (value) => ({
            ...value,
            text: value.text ? `${value.text}\n\n${text}` : text,
            formatted: false,
          }));
        try {
          await this.drafts.flush(sessionId);
          this.failed.get(sessionId)?.delete(text);
          if (!this.failed.get(sessionId)?.size) this.failed.delete(sessionId);
        } catch (cause) {
          this.rememberUnconfirmed(sessionId, text);
          throw cause;
        }
      });
    this.pending.set(sessionId, attempt);
    void attempt
      .finally(() => {
        if (this.pending.get(sessionId) === attempt) this.pending.delete(sessionId);
      })
      .catch(() => undefined);
    return attempt;
  }

  rememberUnconfirmed(sessionId: string, text: string): void {
    const entries = this.failed.get(sessionId) ?? new Set<string>();
    entries.add(text);
    this.failed.set(sessionId, entries);
  }

  forget(sessionIds: string[]): void {
    for (const id of sessionIds) this.failed.delete(id);
  }
}
