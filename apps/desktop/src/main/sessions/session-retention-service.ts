import type { SessionRetentionSettings, SessionView } from "../../shared/domain";
import type { ChatService } from "../chat/chat-service";
import type { Repository } from "../storage/repository";

const DAY_MS = 24 * 60 * 60 * 1000;

export class SessionRetentionService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private first: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> | null = null;
  private disposed = false;
  private activeSessionId: string | null = null;

  constructor(
    private readonly repository: Repository,
    private readonly chat: ChatService,
  ) {}

  settings(): SessionRetentionSettings {
    const days = this.repository.getSetting("sessions.retentionDays");
    return {
      days:
        typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 36500
          ? days
          : null,
    };
  }

  configure(input: SessionRetentionSettings): SessionRetentionSettings {
    if (
      !input ||
      (input.days !== null &&
        (!Number.isInteger(input.days) || input.days < 1 || input.days > 36500))
    )
      throw new Error("自动清理天数必须为 1 到 36500 的整数，或选择永不删除。");
    this.repository.setSetting("sessions.retentionDays", input.days);
    return this.settings();
  }

  opened(sessionId: string | null): void {
    this.activeSessionId = sessionId;
    if (sessionId) this.repository.touchSession(sessionId);
  }

  start(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => void this.sweep().catch(console.error), 60 * 60 * 1000);
    this.timer.unref();
    // Allow the renderer to register its active conversation before the first sweep.
    this.first = setTimeout(() => void this.sweep().catch(console.error), 30_000);
    this.first.unref();
  }

  sweep(now = Date.now()): Promise<void> {
    if (this.pending) return this.pending;
    const pending = this.cleanup(now);
    this.pending = pending;
    void pending
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      })
      .catch(() => undefined);
    return pending;
  }

  private async cleanup(now: number): Promise<void> {
    const days = this.settings().days;
    if (days === null || this.disposed) return;
    const cutoff = now - days * DAY_MS;
    const sessions = this.repository.listSessions();
    const eligible = (previous: SessionView, duringRemoval = false): boolean => {
      const session = this.repository.getSession(previous.id);
      return Boolean(
        session &&
          this.settings().days === days &&
          !session.archived &&
          session.id !== this.activeSessionId &&
          !this.repository
            .listScheduledTasks()
            .some((task) => task.enabled && task.sessionId === session.id) &&
          !this.repository.hasComposerDraft(session.id) &&
          !this.chat.isSessionBusy(session.id, !duringRemoval) &&
          !["running", "waiting_approval"].includes(session.status) &&
          Date.parse(session.lastOpenedAt) < cutoff &&
          this.repository
            .listChildSessions(session.id)
            .every((child) => eligible(child, duringRemoval)),
      );
    };
    const ids = new Set(sessions.map((session) => session.id));
    const roots = sessions.filter(
      (session) => !session.parentSessionId || !ids.has(session.parentSessionId),
    );
    for (const root of roots) {
      if (this.disposed) break;
      if (!eligible(root)) continue;
      const remove = async (session: SessionView): Promise<void> => {
        if (this.disposed || !eligible(session)) return;
        for (const child of this.repository.listChildSessions(session.id)) await remove(child);
        if (eligible(session))
          await this.chat.removeSession(session.id, () => eligible(session, true));
      };
      await remove(root);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
    this.timer = null;
    await this.pending?.catch((cause) =>
      console.error("Session cleanup failed during shutdown:", cause),
    );
  }
}
