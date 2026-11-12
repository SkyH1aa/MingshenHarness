import { randomBytes } from "node:crypto";
import { type BrowserWindow, Notification } from "electron";
import type { ChatStreamEvent, QuestionRequest } from "../../shared/domain";
import { recordRuntimeError, sanitizeRuntimeText } from "../diagnostics/runtime-log";
import type { QuestionBroker } from "../permissions/question-broker";
import type { Repository } from "../storage/repository";

interface QuestionRoute {
  request: QuestionRequest;
  toast: Notification;
}

export class QuestionNotifications {
  private readonly routes = new Map<string, QuestionRoute>();
  private readonly notified = new Set<string>();
  private selectedSessionId: string | null = null;
  private disposed = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onWindowState = () => {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.sync();
    }, 50);
  };

  constructor(
    private readonly repository: Repository,
    private readonly window: BrowserWindow,
    private readonly iconPath: string,
    private readonly broker: QuestionBroker,
    private readonly openSession: (sessionId: string) => void,
    private readonly onError: (message: string) => void,
  ) {
    this.window.on("focus", this.onWindowState);
    this.window.on("blur", this.onWindowState);
    this.window.on("show", this.onWindowState);
    this.window.on("hide", this.onWindowState);
    this.window.on("minimize", this.onWindowState);
    this.window.on("restore", this.onWindowState);
  }

  setActiveSession(sessionId: string | null): void {
    this.selectedSessionId = sessionId;
    this.sync();
  }

  refreshSettings(): void {
    for (const tag of this.routes.keys()) this.remove(tag);
    this.notified.clear();
    this.sync();
  }

  handle(event: ChatStreamEvent): void {
    if (this.disposed) return;
    if (
      event.type === "session_removed" ||
      event.type === "run_completed" ||
      event.type === "run_failed" ||
      event.type === "run_interrupted"
    ) {
      for (const [tag, route] of this.routes)
        if (
          route.request.sessionId === event.sessionId &&
          (event.type === "session_removed" || route.request.runId === event.runId)
        )
          this.remove(tag);
      return;
    }
    if (event.type === "question_state" || event.type === "question_required") this.sync();
  }

  private foreground(sessionId: string): boolean {
    return (
      this.selectedSessionId === sessionId &&
      this.window.isFocused() &&
      this.window.isVisible() &&
      !this.window.isMinimized()
    );
  }

  private sync(): void {
    if (this.disposed || this.window.isDestroyed()) return;
    const pending = this.broker.state().requests;
    const ids = new Set(pending.map((request) => request.id));
    for (const id of this.notified) if (!ids.has(id)) this.notified.delete(id);
    for (const tag of this.routes.keys()) {
      const request = this.current(tag);
      if (!request || this.foreground(request.sessionId)) this.remove(tag);
    }
    const raw = this.repository.getSetting("desktop.notificationSettings");
    const settings = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    if (
      settings.nativeEnabled === false ||
      settings.questionEnabled === false ||
      !Notification.isSupported()
    )
      return;
    for (const request of pending) {
      if (this.notified.has(request.id) || this.foreground(request.sessionId)) continue;
      const session = this.repository.getSession(request.sessionId);
      if (!session) continue;
      const english = this.repository.getSetting("desktop.locale") === "en";
      const conflict = request.kind === "file_conflict";
      const headline = conflict
        ? english
          ? "File conflict needs your decision"
          : "需要处理修改冲突"
        : english
          ? "Agent is waiting for your answer"
          : "Agent 等待你的回答";
      const action = conflict
        ? english
          ? "Resolve conflict"
          : "处理冲突"
        : english
          ? "View question"
          : "查看问题";
      const scope = english ? "Open the conversation to respond." : "请在会话中查看并处理。";
      const preview = settings.showPreview !== false;
      const text = (value: string, limit: number) =>
        sanitizeRuntimeText(value).replace(/\s+/g, " ").slice(0, limit);
      const body = preview
        ? `${headline}\n${text(request.header, 80)} · ${text(request.question, 200)}\n${scope}`
        : `${headline}\n${scope}`;
      const tag = randomBytes(8).toString("hex");
      this.notified.add(request.id);
      try {
        const toast = new Notification({
          id: tag,
          groupId: "mingshen-questions",
          title: preview ? text(session.title, 120) : "Mingshen Harness",
          body,
          icon: this.iconPath,
          silent: settings.sound === false,
          actions: [{ type: "button", text: action }],
        });
        this.routes.set(tag, { request, toast });
        toast.on("click", () => this.open(tag));
        toast.on("action", (event, index) => {
          if ((event.actionIndex ?? index) === 0) this.open(tag);
        });
        toast.on("failed", (_event, error) => {
          this.remove(tag);
          this.failure(error);
        });
        toast.show();
      } catch (cause) {
        this.remove(tag);
        this.failure(cause);
      }
    }
  }

  activate(details: Electron.ActivationArguments): boolean {
    if (this.disposed) return false;
    const tag = new URLSearchParams(details.arguments).get("tag");
    if (!tag || !this.routes.has(tag)) return false;
    if (details.type === "click" || (details.type === "action" && details.actionIndex === 0))
      this.open(tag);
    return true;
  }

  private current(tag: string): QuestionRequest | null {
    const route = this.routes.get(tag);
    if (!route) return null;
    const request = this.broker.get(route.request.id);
    return request &&
      request.sessionId === route.request.sessionId &&
      request.runId === route.request.runId &&
      this.repository.getSession(request.sessionId)
      ? request
      : null;
  }

  private open(tag: string): void {
    if (this.disposed) return;
    const request = this.current(tag);
    // Consume before opening: Windows may emit activation and instance events for one click.
    this.remove(tag);
    if (!request) return;
    try {
      this.openSession(request.sessionId);
    } catch (cause) {
      this.failure(cause);
    }
  }

  private failure(cause: unknown): void {
    recordRuntimeError("notifications.question", cause);
    this.onError(sanitizeRuntimeText(cause instanceof Error ? cause.message : String(cause)));
  }

  private remove(tag: string): void {
    const route = this.routes.get(tag);
    this.routes.delete(tag);
    try {
      route?.toast.close();
    } catch (cause) {
      this.failure(cause);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.window.removeListener("focus", this.onWindowState);
    this.window.removeListener("blur", this.onWindowState);
    this.window.removeListener("show", this.onWindowState);
    this.window.removeListener("hide", this.onWindowState);
    this.window.removeListener("minimize", this.onWindowState);
    this.window.removeListener("restore", this.onWindowState);
    for (const tag of this.routes.keys()) this.remove(tag);
    this.notified.clear();
  }
}
