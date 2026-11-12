import { randomBytes } from "node:crypto";
import { type BrowserWindow, Notification } from "electron";
import type { ApprovalDecision, ApprovalRequest, ChatStreamEvent } from "../../shared/domain";
import { recordRuntimeError, sanitizeRuntimeText } from "../diagnostics/runtime-log";
import type { ApprovalBroker } from "../permissions/approval-broker";
import type { Repository } from "../storage/repository";

interface ApprovalRoute {
  request: ApprovalRequest;
  toast: Notification;
}

export class ApprovalNotifications {
  private readonly routes = new Map<string, ApprovalRoute>();
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
    private readonly broker: ApprovalBroker,
    private readonly decide: (input: ApprovalDecision) => void,
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
    if (event.type === "approval_state" || event.type === "approval_required") this.sync();
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
    for (const [tag, route] of this.routes) {
      const request = this.broker.get(route.request.id);
      if (
        !request ||
        request.runId !== route.request.runId ||
        request.sessionId !== route.request.sessionId ||
        request.toolCallId !== route.request.toolCallId ||
        request.review?.state === "reviewing" ||
        this.foreground(request.sessionId)
      )
        this.remove(tag);
    }
    const raw = this.repository.getSetting("desktop.notificationSettings");
    const settings = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    if (
      settings.nativeEnabled === false ||
      settings.approvalEnabled === false ||
      !Notification.isSupported()
    )
      return;
    for (const request of pending) {
      if (request.review?.state === "reviewing") {
        this.notified.delete(request.id);
        continue;
      }
      if (this.notified.has(request.id) || this.foreground(request.sessionId)) continue;
      const session = this.repository.getSession(request.sessionId);
      if (!session) continue;
      const english = this.repository.getSetting("desktop.locale") === "en";
      const preview = settings.showPreview !== false;
      const headline = english ? "Approval required" : "等待批准";
      const scope = english ? "Approve allows this operation once." : "批准仅允许本次操作。";
      const body = preview
        ? `${headline} · ${sanitizeRuntimeText(request.toolName).slice(0, 60)}\n${sanitizeRuntimeText(request.summary).replace(/\s+/g, " ").slice(0, 160)}\n${scope}`
        : `${headline}\n${scope}`;
      const tag = randomBytes(8).toString("hex");
      this.notified.add(request.id);
      try {
        const toast = new Notification({
          id: tag,
          groupId: "mingshen-approvals",
          title: preview ? sanitizeRuntimeText(session.title).slice(0, 120) : "Mingshen Harness",
          body,
          icon: this.iconPath,
          silent: settings.sound === false,
          actions: [
            { type: "button", text: english ? "Approve once" : "批准" },
            { type: "button", text: english ? "Reject" : "拒绝" },
          ],
        });
        this.routes.set(tag, { request, toast });
        toast.on("click", () => this.open(tag));
        toast.on("action", (event, index) => this.act(tag, event.actionIndex ?? index));
        toast.on("failed", (_event, error) => this.failure(error));
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
    if (details.type === "action") this.act(tag, details.actionIndex);
    else if (details.type === "click") this.open(tag);
    return true;
  }

  private current(tag: string): ApprovalRequest | null {
    const route = this.routes.get(tag);
    if (!route) return null;
    const request = this.broker.get(route.request.id);
    return request &&
      request.sessionId === route.request.sessionId &&
      request.runId === route.request.runId &&
      request.toolCallId === route.request.toolCallId &&
      request.review?.state !== "reviewing" &&
      this.repository.getSession(request.sessionId)
      ? request
      : null;
  }

  private open(tag: string): void {
    const request = this.current(tag);
    if (request) this.openSession(request.sessionId);
  }

  private act(tag: string, index: number | undefined): void {
    if (this.disposed || (index !== 0 && index !== 1)) return;
    const request = this.current(tag);
    if (!request) {
      this.remove(tag);
      return;
    }
    // Consume the exact route before deciding: Windows can emit both activation and instance events.
    this.remove(tag);
    try {
      this.decide({
        approvalId: request.id,
        decision: index === 0 ? "allow_once" : "deny",
        ...(index === 1
          ? {
              feedback:
                this.repository.getSetting("desktop.locale") === "en"
                  ? "User rejected this operation from the Windows notification."
                  : "用户通过 Windows 通知拒绝了此操作。",
            }
          : {}),
      });
    } catch (cause) {
      this.failure(cause);
      this.openSession(request.sessionId);
    }
  }

  private failure(cause: unknown): void {
    const message = sanitizeRuntimeText(cause instanceof Error ? cause.message : String(cause));
    recordRuntimeError("notifications.approval", cause);
    this.onError(message);
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
