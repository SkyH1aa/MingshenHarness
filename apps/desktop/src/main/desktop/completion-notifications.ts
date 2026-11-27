import { randomBytes } from "node:crypto";
import { app, type BrowserWindow, Notification, nativeImage } from "electron";
import type {
  CompletionNotice,
  CompletionNotificationSettings,
  CompletionNotificationState,
} from "../../shared/desktop";
import type { ChatStreamEvent } from "../../shared/domain";
import { IPC_CHANNELS } from "../../shared/ipc";
import { localizeError } from "../../shared/localized-errors";
import { recordRuntimeError } from "../diagnostics/runtime-log";
import { redactSecrets } from "../security/redact";
import type { Repository } from "../storage/repository";
import type { ApprovalNotifications } from "./approval-notifications";
import type { QuestionNotifications } from "./question-notifications";

const UNREAD_KEY = "desktop.completions";
const ROUTES_KEY = "desktop.notificationRoutes";
const SETTINGS_KEY = "desktop.notificationSettings";
const DRAFT_KEY = "desktop.notificationReplyDraft";
const DEFAULT_SETTINGS: CompletionNotificationSettings = {
  nativeEnabled: true,
  approvalEnabled: true,
  questionEnabled: true,
  taskbarEnabled: true,
  showPreview: true,
  sound: true,
};
interface NotificationRoute {
  id: string;
  sessionId: string;
  runId: string;
  createdAt: number;
  consumed: boolean;
}

const DIGITS = [
  "111101101101111",
  "010110010010111",
  "111001111100111",
  "111001111001111",
  "101101111001001",
  "111100111001111",
  "111100111101111",
  "111001001001001",
  "111101111101111",
  "111101111001111",
];
export function badgeBitmap(count: number): Buffer {
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const alpha = Math.max(0, Math.min(1, 15.5 - Math.hypot(x - 15.5, y - 15.5)));
      const i = (y * 32 + x) * 4;
      pixels[i] = 77;
      pixels[i + 1] = 91;
      pixels[i + 2] = 226;
      pixels[i + 3] = Math.round(alpha * 255);
    }
  const text = String(Math.min(99, Math.max(1, count)));
  const scale = text.length === 1 ? 4 : 3;
  const width = text.length * 3 * scale + (text.length - 1) * scale;
  for (let index = 0; index < text.length; index++) {
    const glyph = DIGITS[Number(text[index])] || DIGITS[0] || "";
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 3; col++)
        if (glyph[row * 3 + col] === "1")
          for (let yy = 0; yy < scale; yy++)
            for (let xx = 0; xx < scale; xx++) {
              const x = Math.floor((32 - width) / 2) + index * 4 * scale + col * scale + xx;
              const y = Math.floor((32 - 5 * scale) / 2) + row * scale + yy;
              const i = (y * 32 + x) * 4;
              pixels[i] = 255;
              pixels[i + 1] = 255;
              pixels[i + 2] = 255;
              pixels[i + 3] = 255;
            }
  }
  return pixels;
}

export class CompletionNotifications {
  private readonly unread = new Map<string, CompletionNotice>();
  private readonly routes = new Map<string, NotificationRoute>();
  private readonly toasts = new Map<string, Notification>();
  private readonly repliesInFlight = new Set<string>();
  private selectedSessionId: string | null = null;
  private settings: CompletionNotificationSettings;
  private lastError: string | null = null;
  private lastDelivery: CompletionNotificationState["lastDelivery"] = "idle";
  private readonly replyDrafts = new Map<
    string,
    NonNullable<CompletionNotificationState["replyDraft"]>
  >();
  private disposed = false;
  private readonly onFocus = () => {
    if (this.selectedSessionId) this.markRead(this.selectedSessionId);
  };
  private readonly onShow = () => this.syncBadge();
  constructor(
    private readonly repository: Repository,
    private readonly window: BrowserWindow,
    private readonly iconPath: string,
    private readonly emit: (state: CompletionNotificationState) => void,
    private readonly openSession: (sessionId: string) => void,
    private readonly sendReply: (sessionId: string, text: string) => Promise<unknown>,
    private readonly approvals?: ApprovalNotifications,
    private readonly questions?: QuestionNotifications,
  ) {
    this.settings = this.readSettings();
    const drafts = repository.getSetting(DRAFT_KEY);
    for (const draft of Array.isArray(drafts) ? drafts : [drafts]) {
      if (
        draft &&
        typeof draft.id === "string" &&
        typeof draft.text === "string" &&
        typeof draft.sessionId === "string" &&
        typeof draft.error === "string" &&
        repository.getSession(draft.sessionId)
      )
        this.replyDrafts.set(draft.id, draft);
    }
    const stored = repository.getSetting(UNREAD_KEY);
    if (Array.isArray(stored))
      for (const entry of stored) {
        if (
          entry &&
          typeof entry.sessionId === "string" &&
          typeof entry.runId === "string" &&
          typeof entry.completedAt === "string" &&
          repository.getSession(entry.sessionId)
        )
          this.unread.set(entry.sessionId, entry);
      }
    const routes = repository.getSetting(ROUTES_KEY);
    if (Array.isArray(routes))
      for (const entry of routes)
        if (
          entry &&
          typeof entry.id === "string" &&
          /^[a-f0-9]{16}$/.test(entry.id) &&
          typeof entry.sessionId === "string" &&
          typeof entry.runId === "string" &&
          typeof entry.consumed === "boolean" &&
          typeof entry.createdAt === "number" &&
          entry.createdAt <= Date.now() &&
          Date.now() - entry.createdAt < 7 * 86400000 &&
          repository.getSession(entry.sessionId)
        )
          this.routes.set(entry.id, entry);
    Notification.handleActivation((details) => {
      if (
        this.disposed ||
        this.approvals?.activate(details) ||
        this.questions?.activate(details) ||
        details.type !== "reply"
      )
        return;
      const id = new URLSearchParams(details.arguments).get("tag");
      if (id)
        void this.reply(id, details.reply || details.userInputs?.reply || "").catch((cause) => {
          this.lastError = String(cause);
          this.emit(this.state());
        });
    });
    window.on("focus", this.onFocus);
    window.on("show", this.onShow);
    window.on("restore", this.onShow);
    this.syncBadge();
  }
  private readSettings(): CompletionNotificationSettings {
    const stored = this.repository.getSetting(SETTINGS_KEY);
    const record = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
    return Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [
        key,
        typeof record[key] === "boolean" ? record[key] : fallback,
      ]),
    ) as unknown as CompletionNotificationSettings;
  }
  state(): CompletionNotificationState {
    const pending = [...this.replyDrafts.values()];
    const replyDraft =
      pending.find((draft) => draft.sessionId === this.selectedSessionId) ?? pending[0];
    return {
      unread: [...this.unread.values()],
      settings: { ...this.settings },
      supported: Notification.isSupported(),
      badgeCount: this.settings.taskbarEnabled ? this.unread.size : 0,
      lastError: this.lastError,
      lastDelivery: this.lastDelivery,
      replyDraft: replyDraft ? { ...replyDraft } : null,
    };
  }
  configure(input: CompletionNotificationSettings): CompletionNotificationState {
    if (
      !input ||
      Object.keys(DEFAULT_SETTINGS).some((key) =>
        (key === "approvalEnabled" || key === "questionEnabled") && input[key] === undefined
          ? false
          : typeof input[key as keyof CompletionNotificationSettings] !== "boolean",
      )
    )
      throw new Error("Invalid notification settings.");
    this.settings = {
      nativeEnabled: input.nativeEnabled,
      approvalEnabled: input.approvalEnabled ?? this.settings.approvalEnabled ?? true,
      questionEnabled: input.questionEnabled ?? this.settings.questionEnabled ?? true,
      taskbarEnabled: input.taskbarEnabled,
      showPreview: input.showPreview,
      sound: input.sound,
    };
    this.repository.setSetting(SETTINGS_KEY, this.settings);
    this.approvals?.refreshSettings();
    this.questions?.refreshSettings();
    if (!input.nativeEnabled) {
      for (const toast of this.toasts.values()) toast.close();
      this.toasts.clear();
    }
    this.publish();
    return this.state();
  }
  setActiveSession(id: string | null): void {
    if (id !== null && !this.repository.getSession(id)) throw new Error("Conversation not found.");
    this.selectedSessionId = id;
    this.approvals?.setActiveSession(id);
    this.questions?.setActiveSession(id);
    if (id && this.window.isFocused() && this.window.isVisible() && !this.window.isMinimized())
      this.markRead(id);
    else this.publish();
  }
  acknowledgeDraft(id: string): void {
    if (!this.replyDrafts.delete(id)) return;
    this.saveReplyDrafts();
    this.publish();
  }
  private saveReplyDrafts(): void {
    if (this.replyDrafts.size)
      this.repository.setSetting(DRAFT_KEY, [...this.replyDrafts.values()]);
    else this.repository.removeSetting(DRAFT_KEY);
  }
  handle(event: ChatStreamEvent): void {
    if (this.disposed) return;
    this.approvals?.handle(event);
    this.questions?.handle(event);
    if (
      (event.type === "run_started" || event.type === "run_completed") &&
      event.kind === "compaction"
    )
      return;
    if (event.type === "session_removed") {
      for (const [id, draft] of this.replyDrafts)
        if (draft.sessionId === event.sessionId) this.replyDrafts.delete(id);
      this.saveReplyDrafts();
      this.markRead(event.sessionId);
      return;
    }
    if (event.type === "run_started") {
      this.markRead(event.sessionId);
      return;
    }
    if (event.type !== "run_completed") return;
    const session = this.repository.getSession(event.sessionId);
    if (!session || session.parentSessionId) return;
    if ([...this.routes.values()].some((route) => route.runId === event.runId)) return;
    const route: NotificationRoute = {
      id: randomBytes(8).toString("hex"),
      sessionId: session.id,
      runId: event.runId,
      createdAt: Date.now(),
      consumed: false,
    };
    this.routes.set(route.id, route);
    while (this.routes.size > 300) {
      const oldest = this.routes.keys().next().value;
      if (oldest) {
        this.routes.delete(oldest);
        this.toasts.get(oldest)?.close();
        this.toasts.delete(oldest);
      }
    }
    this.repository.setSetting(ROUTES_KEY, [...this.routes.values()]);
    const viewed =
      session.id === this.selectedSessionId &&
      this.window.isFocused() &&
      this.window.isVisible() &&
      !this.window.isMinimized();
    if (!viewed)
      this.unread.set(session.id, {
        sessionId: session.id,
        runId: event.runId,
        completedAt: new Date().toISOString(),
      });
    this.lastError = null;
    this.publish();
    if (!this.settings.nativeEnabled || !Notification.isSupported()) return;
    const english = this.repository.getSetting("desktop.locale") === "en";
    const completion = english ? "Task completed" : "任务已完成";
    const last = this.repository
      .getMessages(session.id)
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.parts.filter((part) => part.type === "text").map((part) => part.text),
      )
      .at(-1);
    const body =
      this.settings.showPreview && last
        ? `${completion} · ${last.replace(/\s+/g, " ").slice(0, 200)}`
        : completion;
    try {
      const toast = new Notification({
        id: route.id,
        groupId: "mingshen-tasks",
        title: this.settings.showPreview
          ? redactSecrets(session.title).slice(0, 120)
          : "Mingshen Harness",
        body: redactSecrets(body),
        icon: this.iconPath,
        hasReply: true,
        replyPlaceholder: english ? "Reply to Mingshen Harness" : "回复 Mingshen Harness",
        silent: !this.settings.sound,
      });
      this.toasts.set(route.id, toast);
      toast.on("click", () => {
        if (!this.repository.getSession(session.id)) return;
        this.openSession(session.id);
        this.markRead(session.id);
      });
      toast.on("show", () => {
        this.lastDelivery = "shown";
        this.publish();
      });
      toast.on("failed", (_event, error) => {
        this.lastDelivery = "failed";
        this.lastError = String(error);
        recordRuntimeError("notifications.delivery", String(error));
        this.publish();
      });
      this.lastDelivery = "pending";
      toast.show();
      this.publish();
    } catch (cause) {
      this.lastDelivery = "failed";
      recordRuntimeError("notifications.delivery", cause);
      this.lastError = String(cause);
      this.publish();
    }
  }
  reportError(message: string): void {
    this.lastError = message;
    this.emit(this.state());
  }
  private async reply(id: string, input: string): Promise<void> {
    const route = this.routes.get(id);
    const text = input.trim();
    if (
      !route ||
      route.consumed ||
      Date.now() - route.createdAt > 7 * 86400000 ||
      this.repliesInFlight.has(id) ||
      !text ||
      text.length > 100000 ||
      !this.repository.getSession(route.sessionId)
    )
      return;
    this.repliesInFlight.add(id);
    route.consumed = true;
    this.repository.setSetting(ROUTES_KEY, [...this.routes.values()]);
    try {
      this.openSession(route.sessionId);
      await this.sendReply(route.sessionId, text);
      this.markRead(route.sessionId);
    } catch (cause) {
      if (!this.repository.getSession(route.sessionId)) return;
      recordRuntimeError("notifications.reply", cause, { sessionId: route.sessionId });
      const error = localizeError(
        redactSecrets(cause instanceof Error ? cause.message : String(cause)),
        this.repository.getSetting("desktop.locale"),
      );
      this.lastError = error;
      this.replyDrafts.set(id, { sessionId: route.sessionId, text, error, id });
      this.saveReplyDrafts();
      this.publish();
      this.window.webContents.send(IPC_CHANNELS.desktopEvent, {
        type: "notification-reply-failed",
        sessionId: route.sessionId,
        text,
        error,
        draftId: id,
      });
    } finally {
      this.repliesInFlight.delete(id);
    }
  }
  markRead(id: string): void {
    this.unread.delete(id);
    for (const [tag, route] of this.routes)
      if (route.sessionId === id) {
        this.toasts.get(tag)?.close();
        this.toasts.delete(tag);
      }
    this.publish();
  }
  markAllRead(): CompletionNotificationState {
    this.unread.clear();
    for (const toast of this.toasts.values()) toast.close();
    this.toasts.clear();
    this.publish();
    return this.state();
  }
  private publish(): void {
    this.repository.setSetting(UNREAD_KEY, [...this.unread.values()]);
    this.syncBadge();
    this.emit(this.state());
  }
  private syncBadge(): void {
    if (this.window.isDestroyed()) return;
    const count = this.settings.taskbarEnabled ? this.unread.size : 0;
    try {
      app.setBadgeCount(count);
      if (process.platform === "win32")
        this.window.setOverlayIcon(
          count
            ? nativeImage.createFromBitmap(badgeBitmap(count), { width: 32, height: 32 })
            : null,
          count ? `${count} unread completed tasks` : "",
        );
    } catch (cause) {
      this.lastError = String(cause);
      recordRuntimeError("notifications.badge", cause);
    }
  }
  dispose(): void {
    this.disposed = true;
    this.approvals?.dispose();
    this.questions?.dispose();
    this.window.removeListener("focus", this.onFocus);
    this.window.removeListener("show", this.onShow);
    this.window.removeListener("restore", this.onShow);
    for (const toast of this.toasts.values()) toast.close();
    this.toasts.clear();
    if (!this.window.isDestroyed()) this.window.setOverlayIcon(null, "");
  }
}
