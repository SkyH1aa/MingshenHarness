import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { app, type BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import type { PolicyConsent, PolicyDocument } from "../../shared/desktop";
import type { SessionView } from "../../shared/domain";
import { IPC_CHANNELS } from "../../shared/ipc";
import { POLICY_VERSION, RELEASE_LINKS } from "../../shared/release";
import type { Repository } from "../storage/repository";

export class DesktopController {
  private tray: Tray | null = null;
  private quitting = false;
  private closePending = false;
  private policyOpenedAt: number | null = null;
  private manualOpened = false;
  constructor(
    private readonly repository: Repository,
    private readonly window: BrowserWindow,
    private readonly documentsRoot: string,
    private readonly iconPath: string,
    private readonly activeConversations: () => number = () => 0,
    private readonly workspacePathForSession: (
      sessionId: string,
      session: SessionView,
    ) => string | null = (_sessionId, session) => session.workspacePath,
  ) {
    this.createTray();
    window.on("close", (event) => {
      if (this.quitting) return;
      event.preventDefault();
      const preference = this.repository.getSetting("desktop.closeAction");
      if (preference === "tray") {
        window.hide();
        return;
      }
      if (preference === "quit") {
        this.quit();
        return;
      }
      if (!this.closePending) {
        this.closePending = true;
        this.show();
        window.webContents.send(IPC_CHANNELS.desktopEvent, {
          type: "close-request",
          tasks: this.repository.listScheduledTasks().filter((task) => task.enabled).length,
          runningConversations: this.activeConversations(),
        });
      }
    });
    const windowState = () =>
      window.webContents.send(IPC_CHANNELS.desktopEvent, {
        type: "window-state",
        maximized: window.isMaximized(),
      });
    window.on("maximize", windowState);
    window.on("unmaximize", windowState);
    app.on("before-quit", () => {
      this.quitting = true;
      this.tray?.destroy();
      this.tray = null;
    });
  }
  show(): void {
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }
  private quit(): void {
    this.quitting = true;
    app.quit();
  }
  cancelQuit(): void {
    this.quitting = false;
    this.closePending = false;
    this.createTray();
    this.show();
  }
  async openSessionWorkspace(sessionId: string): Promise<void> {
    if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("会话不存在。");
    const session = this.repository.getSession(sessionId);
    if (!session) throw new Error("会话不存在。");
    const workspace = this.workspacePathForSession(sessionId, session);
    if (!workspace) throw new Error("此会话尚未设置工作目录。");
    if (!isAbsolute(workspace) || /^(?:\\\\|\/\/)/.test(workspace) || workspace.includes("\0"))
      throw new Error("工作目录无效。");
    const target = resolve(workspace);
    const info = await stat(target).catch(() => {
      throw new Error("工作目录不存在或无法访问，请检查会话的工作目录。");
    });
    if (!info.isDirectory()) throw new Error("工作目录不是文件夹，请重新选择工作目录。");
    const error = await shell.openPath(target);
    if (error) throw new Error(`无法打开工作目录：${error}`);
  }
  state() {
    const consent = this.repository.getSetting("legal.consent");
    const recorded =
      consent && typeof consent === "object" && !Array.isArray(consent)
        ? (consent as Record<string, unknown>)
        : null;
    const accepted =
      this.repository.getSetting("legal.acceptedVersion") === POLICY_VERSION &&
      recorded?.version === POLICY_VERSION &&
      recorded.terms === true &&
      recorded.privacy === true &&
      recorded.disclaimer === true;
    return {
      accepted,
      manualPending: accepted && this.repository.getSetting("legal.manualPending") === true,
      policyVersion: POLICY_VERSION,
      locale:
        this.repository.getSetting("desktop.locale") === "en"
          ? ("en" as const)
          : ("zh-CN" as const),
      closeAction: ["tray", "quit"].includes(
        String(this.repository.getSetting("desktop.closeAction")),
      )
        ? (this.repository.getSetting("desktop.closeAction") as "tray" | "quit")
        : ("ask" as const),
      githubClientId: RELEASE_LINKS.githubClientId,
      maximized: this.window.isMaximized(),
    };
  }
  async policy(document: PolicyDocument, locale?: "en" | "zh-CN"): Promise<string> {
    const files = {
      terms: "TERMS_OF_SERVICE.md",
      privacy: "PRIVACY_POLICY.md",
      manual: "USER_GUIDE.md",
      changelog: "CHANGELOG.md",
      disclaimer: "DISCLAIMER.md",
    };
    if (!Object.hasOwn(files, document)) throw new Error("Unknown document");
    const filename =
      (locale ?? this.repository.getSetting("desktop.locale")) === "en"
        ? files[document].replace(".md", ".en.md")
        : files[document];
    const content = await readFile(join(this.documentsRoot, filename), "utf8");
    if (document === "manual" && this.state().accepted) this.manualOpened = true;
    if (["terms", "privacy", "disclaimer"].includes(document) && this.policyOpenedAt === null)
      this.policyOpenedAt = Date.now();
    return content;
  }
  async accept(consent: PolicyConsent): Promise<void> {
    if (this.policyOpenedAt === null || Date.now() - this.policyOpenedAt < 5000)
      throw new Error("Please read the policies for at least five seconds.");
    if (consent?.terms !== true || consent.privacy !== true || consent.disclaimer !== true)
      throw new Error("Explicit acceptance of all three policies is required.");
    this.repository.setSetting("legal.acceptedAt", new Date().toISOString());
    this.repository.setSetting("legal.consent", {
      terms: true,
      privacy: true,
      disclaimer: true,
      version: POLICY_VERSION,
    });
    this.repository.setSetting("legal.manualPending", true);
    this.manualOpened = false;
    this.repository.setSetting("legal.acceptedVersion", POLICY_VERSION);
  }
  async action(action: string, value?: string, remember = false): Promise<void> {
    if (["tray", "quit"].includes(action) && remember)
      this.repository.setSetting("desktop.closeAction", action);
    switch (action) {
      case "show":
        this.show();
        break;
      case "minimize":
        this.window.minimize();
        break;
      case "maximize":
        if (this.window.isMaximized()) this.window.unmaximize();
        else this.window.maximize();
        break;
      case "close":
        this.window.close();
        break;
      case "tray":
        this.closePending = false;
        this.window.hide();
        break;
      case "quit":
        this.quit();
        break;
      case "cancel-close":
        this.closePending = false;
        break;
      case "locale":
        if (value !== "en" && value !== "zh-CN") throw new Error("Invalid locale");
        this.repository.setSetting("desktop.locale", value);
        this.updateTray();
        break;
      case "close-preference":
        if (!["ask", "tray", "quit"].includes(value ?? "")) throw new Error("Invalid preference");
        this.repository.setSetting("desktop.closeAction", value);
        break;
      case "manual":
        this.window.webContents.send(IPC_CHANNELS.desktopEvent, { type: "open-manual" });
        break;
      case "finish-onboarding":
        if (!this.state().accepted || !this.manualOpened) throw new Error("请先阅读使用手册。");
        this.repository.setSetting("legal.manualPending", false);
        break;
      default:
        throw new Error("Unknown desktop action");
    }
  }
  private updateTray(): void {
    const en = this.repository.getSetting("desktop.locale") === "en";
    const recent = this.repository
      .listSessions()
      .filter((session) => !session.archived)
      .slice(0, 5);
    this.tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: en ? "Open Mingshen Harness" : "打开 Mingshen Harness", click: () => this.show() },
        { type: "separator" },
        ...recent.map((session) => ({
          label: session.title.replaceAll("&", "&&").slice(0, 70),
          click: () => {
            this.show();
            this.window.webContents.send(IPC_CHANNELS.desktopEvent, {
              type: "select-session",
              sessionId: session.id,
            });
          },
        })),
        { type: "separator" },
        { label: en ? "Quit completely" : "彻底退出", click: () => this.quit() },
      ]),
    );
  }
  private createTray(): void {
    if (this.tray) return;
    this.tray = new Tray(
      nativeImage.createFromPath(this.iconPath).resize({ width: 20, height: 20 }),
    );
    this.tray.setToolTip("Mingshen Harness");
    this.tray.on("click", () => this.show());
    this.tray.on("right-click", () => {
      this.updateTray();
      this.tray?.popUpContextMenu();
    });
    this.updateTray();
  }
}
