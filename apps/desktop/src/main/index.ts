import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  webContents,
} from "electron";
import { COMPANION_IPC_CHANNELS } from "../shared/desktop-companion";
import type { BootstrapData, ChatStreamEvent, SessionUpdateInput } from "../shared/domain";
import type { AppInfo } from "../shared/ipc";
import { IPC_CHANNELS } from "../shared/ipc";
import { localizeError } from "../shared/localized-errors";
import type { QuickChatAction, QuickChatState } from "../shared/quick-chat";
import type { SessionBatchTarget } from "../shared/session-catalog";
import {
  STARTUP_PRESENTATION_CHANNELS,
  STARTUP_PRESENTATION_SETTING_KEY,
  startupPresentationEnabled,
} from "../shared/startup-presentation";
import type { InteractiveTerminalCreateInput } from "../shared/terminal";
import { normalizeUiPreferences } from "../shared/ui-preferences";
import {
  canonicalProjectMemoryRoot,
  getProjectMemoryConfiguration,
  projectMemoryConfigurationRoot,
  setProjectMemoryConfiguration,
} from "./agents/project-memory-config";
import type { AppServices } from "./app-services";
import { createAppServices } from "./app-services";
import { ApprovalNotifications } from "./desktop/approval-notifications";
import { settleWithin } from "./desktop/bounded-cleanup";
import { type CompanionBounds, CompanionController } from "./desktop/companion-controller";
import { buildCompanionMenu } from "./desktop/companion-menu";
import {
  CompanionSessionNavigationError,
  type CompanionSessionNavigationErrorCode,
  CompanionSessionNavigationRequests,
} from "./desktop/companion-session-navigation";
import { CompletionNotifications } from "./desktop/completion-notifications";
import { flushComposerDrafts } from "./desktop/composer-draft-flush";
import { DesktopController } from "./desktop/desktop-controller";
import { DesktopShortcuts } from "./desktop/desktop-shortcuts";
import { reloadInterfaceWindow } from "./desktop/interface-reload";
import { QuestionNotifications } from "./desktop/question-notifications";
import { QuickChatController } from "./desktop/quick-chat-controller";
import { lockQuickChatTransition, withQuickChatTransition } from "./desktop/quick-chat-transition";
import { RuntimeDependencies } from "./desktop/runtime-dependencies";
import {
  StartupPresentationController,
  type StartupPresentationSurface,
} from "./desktop/startup-presentation";
import {
  readPolicyAfterReveal,
  StartupRevealGate,
  StartupVisibilityConfirmation,
} from "./desktop/startup-reveal-gate";
import { UpdateService } from "./desktop/update-service";
import { createUpdateFetcher } from "./desktop/update-transport";
import {
  installRuntimeLog,
  RuntimeLogService,
  recordRuntimeError,
} from "./diagnostics/runtime-log";
import { ModelCatalogService } from "./providers/model-catalog-service";
import { createSessionBatchGuard } from "./sessions/session-batch-guard";
import { completeSessionUpdate, prepareSessionArchive } from "./sessions/session-update-completion";
import { scheduleStartupIndexWarmup } from "./storage/startup-index-warmup";

const APP_ID = "com.mingshen.harness";
// The old experimental ID was also registered on Electron.lnk by native toasts.
const EXPERIMENTAL_APP_ID = "com.mingshen.harness.experimental.desktop";
const isExperimental =
  process.env.MSH_EXPERIMENTAL === "1" || process.argv.includes("--mingshen-experimental");
const isDevelopment =
  !app.isPackaged || (isExperimental && !existsSync(join(process.resourcesPath, "app.asar")));
const isPackagedBuild = !isDevelopment;
const isRawElectronDevelopment =
  isDevelopment && /^electron(?:\.exe)?$/i.test(basename(process.execPath));
const windowAppId = isRawElectronDevelopment
  ? "com.mingshen.harness.development.electron"
  : isExperimental
    ? EXPERIMENTAL_APP_ID
    : APP_ID;
const debugPort = process.env.MSH_DEBUG_PORT;
if (isDevelopment && debugPort && /^\d+$/.test(debugPort))
  app.commandLine.appendSwitch("remote-debugging-port", debugPort);
const commandDataDirectory = process.argv
  .find((value) => value.startsWith("--mingshen-user-data="))
  ?.slice("--mingshen-user-data=".length);

let mainWindow: BrowserWindow | null = null;
let quickChatWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let companion: CompanionController | null = null;
let startupPresentation: StartupPresentationController | null = null;
let startupRevealGate: StartupRevealGate | null = null;
let resumeMainWindowStartup: (() => void) | null = null;
let confirmMainWindowStartupVisibility: (() => void) | null = null;
let cancelMainWindowStartupVisibility: (() => void) | null = null;
let mainWindowDocumentRevision = 0;
let quickChat: QuickChatController | null = null;
let shortcuts: DesktopShortcuts | null = null;
let quickChatVisibilityOperation: Promise<unknown> = Promise.resolve();
let quickChatVisibilityRevision = 0;
let quickChatVisibilityRequested = false;
let services: AppServices | null = null;
let disposed = false;
let disposal: Promise<void> | null = null;
let desktop: DesktopController | null = null;
let updates: UpdateService | null = null;
let dependencies: RuntimeDependencies | null = null;
let backgroundStarted = false;
let companionRestored = false;
let completions: CompletionNotifications | null = null;
let runtimeLogs: RuntimeLogService | null = null;
let updateInstaller: string | null = null;
const guardedBrowserPartitions = new Set<string>();
const companionSessionNavigation = new CompanionSessionNavigationRequests();

function companionNavigationFailure(code: CompanionSessionNavigationErrorCode): Error {
  let english = false;
  try {
    english = services?.repository.getSetting("desktop.locale") === "en";
  } catch {
    // The database may already be closed during shutdown.
  }
  const messages: Record<CompanionSessionNavigationErrorCode, readonly [string, string]> = {
    busy: [
      "主界面正在处理操作，请完成后重试。",
      "The main window is busy. Try again after the current operation finishes.",
    ],
    unsaved_plan: [
      "请先保存或取消主界面正在编辑的计划。",
      "Save or cancel the plan being edited in the main window first.",
    ],
    unsaved_edits: [
      "请先保存或取消主界面尚未完成的编辑。",
      "Save or cancel the unfinished edits in the main window first.",
    ],
    unavailable: ["会话或主界面当前不可用。", "The conversation or main window is unavailable."],
    failed: [
      "无法打开会话，请检查主界面后重试。",
      "Could not open the conversation. Check the main window and try again.",
    ],
    timeout: [
      "未能确认是否打开，请检查主界面。",
      "Could not confirm whether the conversation opened. Check the main window.",
    ],
  };
  return new Error(messages[code][english ? 1 : 0]);
}

function isRendererFrame(
  event: { sender: Electron.WebContents; senderFrame: Electron.WebFrameMain | null },
  page: string,
): boolean {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    const source = new URL(frame.url);
    const expected = new URL(page, process.env.ELECTRON_RENDERER_URL);
    return (
      source.origin === expected.origin &&
      (source.pathname === expected.pathname || (page === "index.html" && source.pathname === "/"))
    );
  }
  return frame.url.split(/[?#]/)[0] === pathToFileURL(join(__dirname, "../renderer", page)).href;
}

function createStartupSurface(): StartupPresentationSurface {
  const bounds = screen.getPrimaryDisplay().bounds;
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: "Mingshen Harness",
    webPreferences: {
      preload: join(__dirname, "../preload/startup.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  window.setAlwaysOnTop(true, "screen-saver");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", () => startupPresentation?.fail());
  window.on("unresponsive", () => startupPresentation?.fail());
  return {
    senderId: window.webContents.id,
    load: () =>
      isDevelopment && process.env.ELECTRON_RENDERER_URL
        ? window.loadURL(new URL("startup.html", process.env.ELECTRON_RENDERER_URL).href)
        : window.loadFile(join(__dirname, "../renderer/startup.html")),
    show: () => {
      if (!window.isDestroyed()) {
        window.showInactive();
        window.moveTop();
      }
    },
    close: () => {
      if (!window.isDestroyed()) window.destroy();
    },
    sendStage: (stage, locale) => {
      if (!window.isDestroyed())
        window.webContents.send(STARTUP_PRESENTATION_CHANNELS.stage, stage, locale);
    },
    onClosed: (listener) => {
      window.on("closed", listener);
      return () => window.removeListener("closed", listener);
    },
  };
}

function createCompanionWindow(bounds: CompanionBounds): BrowserWindow {
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: "Mingshen Companion",
    webPreferences: {
      preload: join(__dirname, "../preload/companion.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  companionWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const failed = (cause: unknown) => {
    recordRuntimeError("companion.window", cause);
    if (!window.isDestroyed()) window.destroy();
  };
  window.webContents.on("render-process-gone", (_event, details) => failed(details.reason));
  window.webContents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) failed(`${description} (${code})`);
  });
  window.on("closed", () => {
    if (companionWindow === window) companionWindow = null;
  });
  const loading =
    isDevelopment && process.env.ELECTRON_RENDERER_URL
      ? window.loadURL(new URL("companion.html", process.env.ELECTRON_RENDERER_URL).href)
      : window.loadFile(join(__dirname, "../renderer/companion.html"));
  void loading.catch(failed);
  return window;
}

function applicationWindows(): BrowserWindow[] {
  return [mainWindow, quickChatWindow].filter((window): window is BrowserWindow =>
    Boolean(window && !window.isDestroyed()),
  );
}

function ensureBrowserFileRequestGuard(partition: string): void {
  if (guardedBrowserPartitions.has(partition)) return;
  const browserPartition = session.fromPartition(partition);
  browserPartition.webRequest.onBeforeRequest({ urls: ["file://*/*"] }, (details, callback) => {
    const browserService = services?.browserService;
    if (!browserService) {
      callback({ cancel: true });
      return;
    }
    void browserService
      .isApprovedLocalFileRequest(details.webContentsId, details.url, details.resourceType)
      .then(
        (approved) => callback({ cancel: !approved }),
        () => callback({ cancel: true }),
      );
  });
  guardedBrowserPartitions.add(partition);
}

async function flushApplicationDrafts(
  purpose: "save" | "shutdown" | "interface-reload",
): Promise<void> {
  const results = await Promise.allSettled(
    applicationWindows().map((window) => flushComposerDrafts(window, ipcMain, undefined, purpose)),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

function emitRuntimeEvent(event: ChatStreamEvent): void {
  try {
    companion?.handleChatEvent(event);
  } catch (cause) {
    recordRuntimeError("companion.task-state", cause);
  }
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(IPC_CHANNELS.runtimeEvent, event);
  if (
    quickChatWindow &&
    !quickChatWindow.isDestroyed() &&
    !quickChatWindow.webContents.isCrashed() &&
    quickChat?.permitsRuntimeEvent(event)
  )
    quickChatWindow.webContents.send(IPC_CHANNELS.runtimeEvent, event);
}

function emitComposerDraftChanged(
  senderId: number,
  sessionId: string,
  revision: string | null,
): void {
  for (const window of applicationWindows()) {
    if (window.webContents.id === senderId) continue;
    if (
      window === quickChatWindow &&
      (!quickChat?.acceptsDraftSession(sessionId) || window.webContents.isCrashed())
    )
      continue;
    window.webContents.send(IPC_CHANNELS.composerDraftChanged, sessionId, revision);
  }
}

function createQuickChatWindow(): BrowserWindow {
  const bounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(480, bounds.width);
  const height = Math.min(680, bounds.height);
  const window = new BrowserWindow({
    width,
    height,
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + (bounds.height - height) / 2),
    minWidth: Math.min(400, width),
    minHeight: Math.min(460, height),
    show: false,
    frame: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: "#09090b",
    title: "Mingshen Harness · ChatAgent",
    icon: isPackagedBuild
      ? join(process.resourcesPath, "icon.ico")
      : join(app.getAppPath(), "build", "icon.ico"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  window.setAlwaysOnTop(quickChat?.pinned ?? false, "floating");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const recoverWindow = (source: string, detail: string) => {
    recordRuntimeError(source, detail);
    if (quickChatWindow === window) quickChatWindow = null;
    if (!window.isDestroyed()) window.destroy();
  };
  window.webContents.on("render-process-gone", (_event, details) =>
    recoverWindow("quick-chat.process", `Renderer process exited: ${details.reason}`),
  );
  window.on("unresponsive", () =>
    recordRuntimeError("quick-chat.unresponsive", "Renderer process became unresponsive"),
  );
  window.webContents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) recoverWindow("quick-chat.load", `${description} (${code})`);
  });
  window.webContents.on("did-finish-load", () => {
    void quickChat
      ?.state()
      .then((state) => {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.quickChatEvent, state);
      })
      .catch((cause) => recordRuntimeError("quick-chat.state", cause));
  });
  window.on("close", (event) => {
    if (disposed || disposal) return;
    event.preventDefault();
    void hideQuickChat().catch((cause) => recordRuntimeError("quick-chat.hide", cause));
  });
  window.on("closed", () => {
    if (quickChatWindow === window) quickChatWindow = null;
  });
  window.on("focus", () => {
    if (quickChat?.currentSessionId) completions?.markRead(quickChat.currentSessionId);
  });
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set("surface", "quick-chat");
    void window.loadURL(url.href);
  } else
    void window.loadFile(join(__dirname, "../renderer/index.html"), {
      query: { surface: "quick-chat" },
    });
  return window;
}

function queueQuickChatVisibility<T>(operation: () => Promise<T>): Promise<T> {
  const pending = quickChatVisibilityOperation.then(operation, operation);
  quickChatVisibilityOperation = pending.catch(() => undefined);
  return pending;
}

function showQuickChat(forceNew = false): Promise<QuickChatState | null> {
  return queueQuickChatVisibility(() => showQuickChatNow(forceNew));
}

async function showQuickChatNow(forceNew = false): Promise<QuickChatState | null> {
  if (disposed || disposal || updateInstaller) return null;
  if (!desktop?.state().accepted || desktop.state().manualPending) {
    desktop?.show();
    return null;
  }
  const controller = quickChat;
  if (!controller) return null;
  quickChatVisibilityRequested = true;
  const visibilityRevision = ++quickChatVisibilityRevision;
  let releaseTransition: (() => void) | undefined;
  try {
    releaseTransition = await lockQuickChatTransition(quickChatWindow, ipcMain);
    const draftResults = await Promise.allSettled([
      flushComposerDrafts(mainWindow, ipcMain, 2_000, "save").catch((cause) =>
        recordRuntimeError("quick-chat.draft-flush", cause),
      ),
      flushComposerDrafts(quickChatWindow, ipcMain, undefined, "save"),
    ]);
    const draftFailure = draftResults.find((result) => result.status === "rejected");
    if (draftFailure?.status === "rejected") throw draftFailure.reason;
    const state = await controller.activate(forceNew);
    if (disposed || disposal) return null;
    if (
      !quickChatWindow ||
      quickChatWindow.isDestroyed() ||
      quickChatWindow.webContents.isCrashed()
    ) {
      if (quickChatWindow && !quickChatWindow.isDestroyed()) quickChatWindow.destroy();
      quickChatWindow = createQuickChatWindow();
    }
    const window = quickChatWindow;
    window.setAlwaysOnTop(state.pinned, "floating");
    if (window.isMinimized()) window.restore();
    if (window.webContents.isLoadingMainFrame())
      window.webContents.once("did-finish-load", () => {
        if (
          !window.isDestroyed() &&
          quickChatVisibilityRequested &&
          visibilityRevision === quickChatVisibilityRevision
        ) {
          window.show();
          window.focus();
        }
      });
    else if (quickChatVisibilityRequested && visibilityRevision === quickChatVisibilityRevision) {
      window.webContents.send(IPC_CHANNELS.quickChatEvent, state);
      window.show();
      window.focus();
    }
    if (state.session) completions?.markRead(state.session.id);
    return state;
  } catch (cause) {
    if (visibilityRevision === quickChatVisibilityRevision) quickChatVisibilityRequested = false;
    throw cause;
  } finally {
    releaseTransition?.();
  }
}

function hideQuickChat(): Promise<void> {
  return queueQuickChatVisibility(hideQuickChatNow);
}

async function hideQuickChatNow(): Promise<void> {
  const releaseTransition = await lockQuickChatTransition(quickChatWindow, ipcMain);
  try {
    await flushComposerDrafts(quickChatWindow, ipcMain, undefined, "save");
    quickChatVisibilityRequested = false;
    quickChatVisibilityRevision += 1;
    if (quickChatWindow && !quickChatWindow.isDestroyed()) quickChatWindow.hide();
  } finally {
    releaseTransition();
  }
}

function toggleQuickChat(): Promise<void> {
  return queueQuickChatVisibility(async () => {
    if (disposed || disposal || updateInstaller) return;
    const window = quickChatWindow;
    if (
      window &&
      !window.isDestroyed() &&
      !window.isMinimized() &&
      (window.isVisible() || quickChatVisibilityRequested)
    )
      await hideQuickChatNow();
    else await showQuickChatNow();
  });
}

function reportShortcutFailure(accelerator: string, cause?: unknown): void {
  runtimeLogs?.record(
    "desktop.shortcut",
    `Cannot register ${accelerator}: ${cause ? String(cause) : "already in use"}`,
    {},
    "warn",
  );
}

function localPluginArgument(value: unknown, label: string, maxLength = 160): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    value.includes("\0")
  )
    throw new Error(`Invalid local plugin ${label}.`);
  return value.trim();
}

function startBackgroundServices(): void {
  if (backgroundStarted || !desktop?.state().accepted) return;
  backgroundStarted = true;
  showEnabledCompanion();
  updates?.start();
  services?.sessionRetentionService.start();
  if (process.env.MSH_DISABLE_AUTO_DEPENDENCIES !== "1")
    void dependencies?.ensureInstalled().catch((cause) =>
      mainWindow?.webContents.send(IPC_CHANNELS.runtimeProgress, {
        name: "docker",
        stage: "error",
        received: 0,
        total: null,
        detail: String(cause),
      }),
    );
}

function showEnabledCompanion(): void {
  if (
    companionRestored ||
    !desktop?.state().accepted ||
    desktop.state().manualPending ||
    !companion
  )
    return;
  companionRestored = true;
  if (companion.getPreferences().enabled && !companion.getState().visible) {
    try {
      companion.show();
    } catch (cause) {
      recordRuntimeError("companion.show", cause);
    }
  }
}

function createMainWindow(): BrowserWindow {
  const iconPath = isPackagedBuild
    ? join(process.resourcesPath, "icon.ico")
    : join(app.getAppPath(), "build", "icon.ico");
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: "#09090b",
    autoHideMenuBar: true,
    title: "Mingshen Harness",
    frame: false,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  const revealGate = new StartupRevealGate();
  let presentationFinished = false;
  const canReveal = () =>
    presentationFinished &&
    !disposed &&
    !disposal &&
    mainWindow === window &&
    startupRevealGate === revealGate &&
    !window.isDestroyed();
  const visibilityConfirmation = new StartupVisibilityConfirmation({
    isCurrent: canReveal,
    isVisible: () => window.isVisible() && !window.isMinimized(),
    onVisible: () => revealGate.reveal(),
    onFailure: (cause) => {
      revealGate.cancelPending();
      recordRuntimeError("desktop.main-show", cause);
    },
  });
  const confirmMainWindowReveal = () => visibilityConfirmation.request();
  const cancelMainWindowReveal = () => {
    visibilityConfirmation.cancel();
    revealGate.cancelPending();
  };
  window.on("show", confirmMainWindowReveal);
  window.on("restore", confirmMainWindowReveal);
  const revealMainWindow = () => {
    if (!canReveal()) return;
    try {
      if (!window.isVisible()) window.showInactive();
      window.show();
      // Windows can return from show() before Electron reports the window visible.
      confirmMainWindowReveal();
    } catch (cause) {
      revealGate.cancelPending();
      recordRuntimeError("desktop.main-show", cause);
    }
  };
  startupRevealGate = revealGate;
  resumeMainWindowStartup = revealMainWindow;
  confirmMainWindowStartupVisibility = confirmMainWindowReveal;
  cancelMainWindowStartupVisibility = cancelMainWindowReveal;
  window.once("closed", () => {
    visibilityConfirmation.cancel();
    revealGate.close();
    if (startupRevealGate === revealGate) startupRevealGate = null;
    if (resumeMainWindowStartup === revealMainWindow) resumeMainWindowStartup = null;
    if (confirmMainWindowStartupVisibility === confirmMainWindowReveal)
      confirmMainWindowStartupVisibility = null;
    if (cancelMainWindowStartupVisibility === cancelMainWindowReveal)
      cancelMainWindowStartupVisibility = null;
  });

  if (process.platform === "win32")
    window.setAppDetails({
      appId: windowAppId,
      appIconPath: isRawElectronDevelopment ? iconPath : process.execPath,
      appIconIndex: 0,
      relaunchDisplayName: "Mingshen Harness",
      relaunchCommand: isPackagedBuild
        ? `"${process.execPath}"`
        : `"${process.execPath}" "${app.getAppPath()}"${isExperimental ? " --mingshen-experimental" : ""} "--mingshen-user-data=${app.getPath("userData")}"`,
    });

  window.once("ready-to-show", () => {
    window.setIcon(
      nativeImage.createFromPath(
        isPackagedBuild
          ? join(process.resourcesPath, "icon.png")
          : join(app.getAppPath(), "build", "icon.png"),
      ),
    );
    if (startupPresentation?.isPresenting()) window.showInactive();
    void (startupPresentation?.ready() ?? Promise.resolve()).then(() => {
      presentationFinished = true;
      revealMainWindow();
    });
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("blur", () => shortcuts?.setCallbacksSuppressed(false));
  window.webContents.on("did-start-loading", () => {
    mainWindowDocumentRevision++;
    cancelMainWindowReveal();
    shortcuts?.setCallbacksSuppressed(false);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    mainWindowDocumentRevision++;
    cancelMainWindowReveal();
    shortcuts?.setCallbacksSuppressed(false);
    recordRuntimeError("renderer.process", `Renderer process exited: ${details.reason}`, {
      code: String(details.exitCode),
    });
  });
  window.webContents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
    if (mainFrame) {
      mainWindowDocumentRevision++;
      cancelMainWindowReveal();
      recordRuntimeError("renderer.load", description, { code: String(code) });
    }
  });
  window.webContents.on("console-message", (_event, level, message) => {
    if (level === 3 || level === 2)
      runtimeLogs?.record("renderer.console", message, {}, level === 3 ? "error" : "warn");
  });
  window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    const partition = /^persist:mingshen-(chrome|edge)$/.exec(webPreferences.partition ?? "");
    if (!partition) {
      event.preventDefault();
      return;
    }
    try {
      ensureBrowserFileRequestGuard(`persist:mingshen-${partition[1]}`);
    } catch {
      event.preventDefault();
      return;
    }
    const source = params.src ?? "about:blank";
    if (
      source !== "about:blank" &&
      !/^https?:\/\//i.test(source) &&
      !services?.browserService.isApprovedLocalFileUrl(source, partition[1] as "chrome" | "edge")
    ) {
      event.preventDefault();
    }
  });
  window.webContents.on("did-attach-webview", (_event, guest) => {
    guest.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    guest.session.setPermissionCheckHandler(() => false);
    guest.session.on("will-download", (event) => event.preventDefault());
    guest.setWindowOpenHandler(() => ({ action: "deny" }));
    guest.on("will-navigate", (event, url) => {
      if (
        url !== "about:blank" &&
        !/^https?:\/\//i.test(url) &&
        !services?.browserService.isApprovedLocalFileUrl(url, undefined, guest.id)
      ) {
        event.preventDefault();
      }
    });
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
      const devOrigin = new URL(process.env.ELECTRON_RENDERER_URL).origin;
      if (new URL(url).origin === devOrigin) {
        return;
      }
    }

    event.preventDefault();
  });

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

function requireServices(): AppServices {
  if (!services) {
    throw new Error("Application services are not ready.");
  }
  return services;
}

function requireMainWindowSender(event: IpcMainInvokeEvent): number {
  const window = mainWindow;
  if (
    !window ||
    window.isDestroyed() ||
    event.sender.id !== window.webContents.id ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error("本地终端仅允许主窗口操作。");
  }
  return event.sender.id;
}

function registerIpcHandlers(): void {
  dependencies = new RuntimeDependencies(
    app.getPath("userData"),
    requireServices().mcpService,
    isPackagedBuild
      ? join(process.resourcesPath, "native", "codex-sandbox.exe")
      : join(app.getAppPath(), "resources", "native", "codex-sandbox.exe"),
    (progress) => {
      if (progress.stage === "error")
        recordRuntimeError("dependencies.install", progress.detail, { operation: progress.name });
      mainWindow?.webContents.send(IPC_CHANNELS.runtimeProgress, progress);
    },
  );
  updates = new UpdateService(
    (status, notify) => mainWindow?.webContents.send(IPC_CHANNELS.updateEvent, { status, notify }),
    fetch,
    {
      cacheDirectory: join(app.getPath("userData"), "updates"),
      fetchPackage: createUpdateFetcher(),
      activeTasks: () => services?.chatService.activeConversationCount() ?? 0,
      handoff: async (installer) => {
        await flushApplicationDrafts("save");
        if (disposal || !services?.chatService.prepareForUpdate()) return false;
        updateInstaller = installer;
        // app.relaunch below runs the installer only after services and SQLite close.
        setImmediate(() => app.quit());
        return true;
      },
    },
  );
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    originalHandle(channel, async (event, ...args) => {
      const quickSender = Boolean(
        quickChatWindow &&
          !quickChatWindow.isDestroyed() &&
          event.sender.id === quickChatWindow.webContents.id,
      );
      const companionSender = Boolean(
        companionWindow &&
          !companionWindow.isDestroyed() &&
          event.sender.id === companionWindow.webContents.id,
      );
      const companionChannels: string[] = [
        COMPANION_IPC_CHANNELS.getState,
        COMPANION_IPC_CHANNELS.getPreferences,
        COMPANION_IPC_CHANNELS.setPreferences,
        COMPANION_IPC_CHANNELS.action,
        COMPANION_IPC_CHANNELS.openMenu,
        COMPANION_IPC_CHANNELS.openQuickChat,
        COMPANION_IPC_CHANNELS.openSession,
        COMPANION_IPC_CHANNELS.setMotionAvailability,
        COMPANION_IPC_CHANNELS.ready,
      ];
      const trusted =
        (applicationWindows().some((window) => event.sender.id === window.webContents.id) &&
          isRendererFrame(event, "index.html")) ||
        (companionSender &&
          companionChannels.includes(channel) &&
          isRendererFrame(event, "companion.html"));
      if (!trusted) {
        recordRuntimeError("ipc.security", "Untrusted IPC sender", { operation: channel });
        throw new Error("Untrusted IPC sender");
      }
      if (quickSender && !quickChat?.permitsIpc(channel, args)) {
        recordRuntimeError(
          "ipc.security",
          "Quick Chat IPC is outside the current ChatAgent scope",
          { operation: channel },
        );
        throw new Error("ChatAgent 小窗口仅允许操作当前对话。");
      }
      const allowedBeforeConsent: string[] = [
        IPC_CHANNELS.appInfo,
        IPC_CHANNELS.desktopState,
        IPC_CHANNELS.desktopAction,
        IPC_CHANNELS.policyRead,
        IPC_CHANNELS.policyAccept,
        IPC_CHANNELS.runtimeLogReport,
      ];
      if (desktop && !desktop.state().accepted && !allowedBeforeConsent.includes(channel))
        throw new Error("Please accept the privacy policy and terms first.");
      try {
        const result = await listener(event, ...args);
        if (result && typeof result === "object") {
          const outcome = result as Record<string, unknown>;
          if (Array.isArray(outcome.warnings))
            for (const warning of outcome.warnings.slice(0, 100)) {
              if (typeof warning === "string" && warning.trim())
                runtimeLogs?.record("ipc.warning", warning, { operation: channel }, "warn");
            }
          if (outcome.ok === false || outcome.isError === true || outcome.state === "error") {
            const detail = [outcome.error, outcome.output, outcome.detail, outcome.responseBody]
              .filter((value): value is string => typeof value === "string" && Boolean(value))
              .join("\n");
            recordRuntimeError(
              "ipc.result",
              detail || "Operation returned an unsuccessful result",
              {
                operation: channel,
                status: typeof outcome.status === "number" ? outcome.status : null,
              },
            );
          }
        }
        return result;
      } catch (cause) {
        recordRuntimeError("ipc.request", cause, { operation: channel });
        throw new Error(
          localizeError(
            cause instanceof Error ? cause.message : String(cause),
            services?.repository.getSetting("desktop.locale"),
          ),
        );
      }
    });
  ipcMain.on(STARTUP_PRESENTATION_CHANNELS.skip, (event) => {
    if (isRendererFrame(event, "startup.html")) startupPresentation?.handleSkip(event.sender.id);
  });
  ipcMain.handle(IPC_CHANNELS.startupAnimationGet, () =>
    startupPresentationEnabled(
      requireServices().repository.getSetting(STARTUP_PRESENTATION_SETTING_KEY),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.startupAnimationSet, (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid startup animation preference.");
    requireServices().repository.setSetting(STARTUP_PRESENTATION_SETTING_KEY, enabled);
    return enabled;
  });
  const requireCompanion = () => {
    if (!companion) throw new Error("Desktop companion is not ready.");
    return companion;
  };
  ipcMain.handle(COMPANION_IPC_CHANNELS.getState, () => requireCompanion().getState());
  ipcMain.handle(COMPANION_IPC_CHANNELS.ready, () => requireCompanion().getState());
  ipcMain.handle(COMPANION_IPC_CHANNELS.getPreferences, () => requireCompanion().getPreferences());
  ipcMain.handle(COMPANION_IPC_CHANNELS.setPreferences, (_event, patch: unknown) =>
    requireCompanion().setPreferences(patch),
  );
  ipcMain.handle(COMPANION_IPC_CHANNELS.show, () => {
    requireCompanion().show();
  });
  ipcMain.handle(COMPANION_IPC_CHANNELS.hide, () => {
    requireCompanion().hide();
  });
  ipcMain.handle(COMPANION_IPC_CHANNELS.action, (event, action: unknown) => {
    if (!companion?.isTrustedSender(event.sender.id))
      throw new Error("Only the desktop companion can send companion actions.");
    return companion.action(action);
  });
  ipcMain.handle(COMPANION_IPC_CHANNELS.openQuickChat, async (event) => {
    if (!companion?.isTrustedSender(event.sender.id))
      throw new Error("Only the desktop companion can open Quick Chat.");
    try {
      await showQuickChat();
    } catch (cause) {
      companion.reportMenuFailure();
      throw cause;
    }
  });
  const openCompanionSession = async (sessionId: unknown) => {
    const controller = requireCompanion();
    if (!controller.canOpenSession(sessionId)) throw companionNavigationFailure("unavailable");
    if (!desktop || !mainWindow || mainWindow.isDestroyed())
      throw companionNavigationFailure("unavailable");
    const window = mainWindow;
    try {
      desktop.show();
      await companionSessionNavigation.request(window.webContents.id, sessionId, (requestId) => {
        if (window.isDestroyed()) throw new Error("Main window was closed.");
        window.webContents.send(IPC_CHANNELS.desktopEvent, {
          type: "select-session",
          sessionId,
          requestId,
        });
      });
    } catch (cause) {
      if (!(cause instanceof CompanionSessionNavigationError))
        recordRuntimeError("companion.session-navigation", cause);
      throw companionNavigationFailure(
        cause instanceof CompanionSessionNavigationError ? cause.code : "failed",
      );
    }
  };
  ipcMain.handle(COMPANION_IPC_CHANNELS.openSession, async (event, sessionId: unknown) => {
    if (!companion?.isTrustedSender(event.sender.id))
      throw new Error("Only the desktop companion can open an active session.");
    try {
      await openCompanionSession(sessionId);
    } catch (cause) {
      companion.reportMenuFailure();
      throw cause;
    }
  });
  ipcMain.on(
    IPC_CHANNELS.companionSessionNavigationPreflight,
    (event, requestId: unknown, sessionId: unknown) => {
      let accepted = false;
      try {
        if (
          mainWindow &&
          !mainWindow.isDestroyed() &&
          event.sender.id === mainWindow.webContents.id &&
          isRendererFrame(event, "index.html") &&
          typeof requestId === "string" &&
          typeof sessionId === "string"
        ) {
          accepted = companionSessionNavigation.preflight(
            event.sender.id,
            requestId,
            sessionId,
            () => Boolean(companion?.canOpenSession(sessionId)),
          );
        }
      } catch (cause) {
        recordRuntimeError("companion.session-navigation-preflight", cause);
      } finally {
        event.returnValue = accepted;
      }
    },
  );
  ipcMain.on(
    IPC_CHANNELS.companionSessionNavigationClaim,
    (event, requestId: unknown, sessionId: unknown) => {
      let accepted = false;
      try {
        if (
          mainWindow &&
          !mainWindow.isDestroyed() &&
          event.sender.id === mainWindow.webContents.id &&
          isRendererFrame(event, "index.html") &&
          typeof requestId === "string" &&
          typeof sessionId === "string"
        ) {
          accepted = companionSessionNavigation.claim(event.sender.id, requestId, sessionId, () =>
            Boolean(companion?.canOpenSession(sessionId)),
          );
        }
      } catch (cause) {
        recordRuntimeError("companion.session-navigation-claim", cause);
      } finally {
        event.returnValue = accepted;
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.companionSessionNavigationResult, (event, result: unknown) => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      event.sender.id !== mainWindow.webContents.id ||
      !isRendererFrame(event, "index.html")
    )
      throw new Error("Only the main window can report companion navigation.");
    companionSessionNavigation.settle(event.sender.id, result);
  });
  ipcMain.handle(COMPANION_IPC_CHANNELS.setMotionAvailability, (event, allowed: unknown) => {
    if (!companion?.isTrustedSender(event.sender.id))
      throw new Error("Only the desktop companion can report motion availability.");
    companion.setMotionAvailability(allowed);
  });
  ipcMain.handle(COMPANION_IPC_CHANNELS.openMenu, (event) => {
    const controller = requireCompanion();
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!controller.isTrustedSender(event.sender.id) || !window || window.isDestroyed())
      throw new Error("Only the desktop companion can open its menu.");
    const menu = Menu.buildFromTemplate(
      buildCompanionMenu(controller.getState(), {
        openMain: () => desktop?.show(),
        openQuickChat: () => showQuickChat().then(() => undefined),
        openSession: (sessionId) => openCompanionSession(sessionId),
        openSettings: () => {
          desktop?.show();
          mainWindow?.webContents.send(IPC_CHANNELS.desktopEvent, {
            type: "open-desktop-settings",
          });
        },
        setPreferences: (patch) => controller.setPreferences(patch).then(() => undefined),
        interact: (action) => controller.interact(action),
        hide: () => controller.hide(),
        disable: () => controller.setPreferences({ enabled: false }).then(() => undefined),
        onError: (cause) => {
          recordRuntimeError("companion.menu", cause);
          controller.reportMenuFailure();
        },
      }),
    );
    const releasePinnedRaise = () => controller.setNativeMenuOpen(false);
    menu.once("menu-will-close", releasePinnedRaise);
    controller.setNativeMenuOpen(true);
    try {
      menu.popup({ window });
    } catch (cause) {
      releasePinnedRaise();
      throw cause;
    }
  });
  ipcMain.handle(IPC_CHANNELS.editCommand, (event, command: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender)?.isFocused() || !event.sender.isFocused())
      throw new Error("The application must be focused to edit clipboard content.");
    switch (command) {
      case "copy":
        event.sender.copy();
        break;
      case "cut":
        event.sender.cut();
        break;
      case "paste":
        event.sender.paste();
        break;
      case "selectAll":
        event.sender.selectAll();
        break;
      default:
        throw new Error("Invalid edit command.");
    }
  });
  ipcMain.handle(IPC_CHANNELS.uiPreferencesGet, () =>
    normalizeUiPreferences(requireServices().repository.getSetting("ui.preferences")),
  );
  ipcMain.handle(IPC_CHANNELS.projectMemoryGet, (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string" || sessionId.length > 200)
      throw new Error("Invalid session ID.");
    return requireServices().chatService.getProjectMemory(sessionId);
  });
  ipcMain.handle(IPC_CHANNELS.projectMemorySelection, (_event, workspacePath: unknown) => {
    if (
      workspacePath !== null &&
      (typeof workspacePath !== "string" || workspacePath.length > 32_768)
    )
      throw new Error("Invalid project directory.");
    return requireServices().sessionService.projectMemorySelection(workspacePath as string | null);
  });
  ipcMain.handle(IPC_CHANNELS.projectMemoryConfigurationGet, (_event, workspacePath: unknown) => {
    if (typeof workspacePath !== "string") throw new Error("Invalid project directory.");
    return getProjectMemoryConfiguration(requireServices().repository, workspacePath);
  });
  ipcMain.handle(IPC_CHANNELS.projectMemoryConfigurationSet, (_event, input: unknown) => {
    const current = requireServices();
    if (
      input &&
      typeof input === "object" &&
      typeof (input as { workspacePath?: unknown }).workspacePath === "string"
    )
      current.chatService.assertProjectMemoryConfigurable(
        projectMemoryConfigurationRoot(
          current.repository,
          (input as { workspacePath: string }).workspacePath,
        ),
      );
    return setProjectMemoryConfiguration(current.repository, input, (sessionId) =>
      current.chatService.isSessionBusy(sessionId),
    );
  });
  ipcMain.handle(IPC_CHANNELS.projectMemoryEdit, (_event, input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid memory edit.");
    const value = input as Record<string, unknown>;
    if (
      typeof value.sessionId !== "string" ||
      typeof value.document !== "string" ||
      !["preferences", "memory"].includes(value.document) ||
      typeof value.content !== "string" ||
      value.content.length > 60_000 ||
      typeof value.revision !== "string" ||
      value.revision.length > 200
    )
      throw new Error("Invalid memory edit.");
    return requireServices().chatService.editProjectMemory({
      sessionId: value.sessionId,
      document: value.document as "preferences" | "memory",
      content: value.content,
      revision: value.revision,
    });
  });
  ipcMain.handle(
    IPC_CHANNELS.projectMemoryCommand,
    (_event, sessionId: unknown, command: unknown) => {
      if (
        typeof sessionId !== "string" ||
        sessionId.length > 200 ||
        typeof command !== "string" ||
        command.length > 2_000
      )
        throw new Error("Invalid memory command.");
      return requireServices().chatService.projectMemoryCommand(sessionId, command);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.projectMemoryEnabled,
    (_event, sessionId: unknown, enabled: unknown) => {
      if (typeof sessionId !== "string" || sessionId.length > 200 || typeof enabled !== "boolean")
        throw new Error("Invalid memory setting.");
      return requireServices().chatService.setProjectMemoryEnabled(sessionId, enabled);
    },
  );
  ipcMain.handle(IPC_CHANNELS.uiPreferencesSave, (_event, input: unknown) => {
    const repository = requireServices().repository;
    const current = normalizeUiPreferences(repository.getSetting("ui.preferences"));
    repository.setSetting(
      "ui.preferences",
      normalizeUiPreferences(input, current.interfaceStyle, current.composerRichPaste),
    );
  });
  ipcMain.handle(IPC_CHANNELS.uiReloadInterface, async () => {
    await flushApplicationDrafts("interface-reload");
    reloadInterfaceWindow({
      window: mainWindow,
      activeConversations: requireServices().chatService.activeConversationCount(),
      disposed,
      disposing: disposal !== null,
      installingUpdate: updateInstaller !== null,
    });
  });
  ipcMain.handle(IPC_CHANNELS.runtimeLogStatus, () => {
    if (!runtimeLogs) throw new Error("Runtime logs are not ready.");
    return runtimeLogs.status();
  });
  ipcMain.handle(IPC_CHANNELS.runtimeLogExport, async () => {
    if (!runtimeLogs || !mainWindow) throw new Error("Runtime logs are not ready.");
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `MingshenHarness-${app.getVersion()}-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await runtimeLogs.export(result.filePath);
    return result.filePath;
  });
  let rendererReportAt = 0;
  let rendererReports = 0;
  ipcMain.handle(IPC_CHANNELS.runtimeLogReport, (_event, report: unknown) => {
    if (!report || typeof report !== "object") throw new Error("Invalid error report.");
    const item = report as Record<string, unknown>;
    if (
      !["window", "promise", "react"].includes(String(item.source)) ||
      typeof item.message !== "string" ||
      item.message.length > 16000 ||
      (item.stack !== undefined && (typeof item.stack !== "string" || item.stack.length > 16000))
    )
      throw new Error("Invalid error report.");
    if (Date.now() - rendererReportAt > 60000) {
      rendererReportAt = Date.now();
      rendererReports = 0;
    }
    if (++rendererReports > 60) return;
    recordRuntimeError(`renderer.${item.source}`, `${item.message}\n${item.stack ?? ""}`);
  });
  ipcMain.handle(IPC_CHANNELS.desktopState, () => {
    if (!desktop) throw new Error("Application services are not ready.");
    return {
      ...desktop.state(),
      shortcuts: shortcuts?.status(),
      shortcutBindings: shortcuts?.state().settings,
    };
  });
  ipcMain.handle(IPC_CHANNELS.desktopShortcutsGet, () => {
    if (!shortcuts) throw new Error("Application services are not ready.");
    return shortcuts.state();
  });
  ipcMain.handle(IPC_CHANNELS.desktopShortcutsSet, (_event, settings: unknown) => {
    if (!shortcuts) throw new Error("Application services are not ready.");
    const result = shortcuts.update(settings);
    mainWindow?.webContents.send(IPC_CHANNELS.desktopEvent, { type: "shortcuts-changed" });
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.desktopShortcutRecording, (event, recording: unknown) => {
    if (typeof recording !== "boolean") throw new Error("Invalid shortcut recording state.");
    if (recording && (!mainWindow?.isFocused() || event.sender.id !== mainWindow.webContents.id))
      throw new Error("Focus the main window before recording a shortcut.");
    shortcuts?.setCallbacksSuppressed(recording);
    mainWindow?.webContents.send(IPC_CHANNELS.desktopEvent, { type: "shortcuts-changed" });
  });
  ipcMain.handle(IPC_CHANNELS.quickChatState, () => {
    if (!quickChat) throw new Error("Application services are not ready.");
    return quickChat.state();
  });
  ipcMain.handle(IPC_CHANNELS.quickChatAction, async (_event, action: QuickChatAction) => {
    if (!["show", "new", "hide", "open-main", "configure", "toggle-pin", "toggle"].includes(action))
      throw new Error("Invalid quick chat action.");
    if (action === "show" || action === "new") return showQuickChat(action === "new");
    if (action === "toggle") {
      await toggleQuickChat();
      return quickChat?.state() ?? null;
    }
    if (action === "toggle-pin") {
      if (!quickChat) throw new Error("Application services are not ready.");
      const state = await quickChat.togglePinned();
      if (quickChatWindow && !quickChatWindow.isDestroyed()) {
        quickChatWindow.setAlwaysOnTop(state.pinned, "floating");
        quickChatWindow.webContents.send(IPC_CHANNELS.quickChatEvent, state);
      }
      return state;
    }
    await hideQuickChat();
    if (action === "open-main" || action === "configure") {
      desktop?.show();
      mainWindow?.webContents.send(
        IPC_CHANNELS.desktopEvent,
        action === "configure"
          ? { type: "open-provider-settings" }
          : { type: "select-session", sessionId: quickChat?.currentSessionId },
      );
    }
    return null;
  });
  ipcMain.handle(IPC_CHANNELS.completionState, () => completions?.state());
  ipcMain.handle(IPC_CHANNELS.completionDraftAck, (_event, id) => {
    if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id))
      throw new Error("Invalid notification draft ID.");
    completions?.acknowledgeDraft(id);
  });
  ipcMain.handle(IPC_CHANNELS.completionConfigure, (_event, settings) =>
    completions?.configure(settings),
  );
  ipcMain.handle(IPC_CHANNELS.completionActiveSession, (_event, id) => {
    if (id !== null && typeof id !== "string") throw new Error("Invalid session ID.");
    completions?.setActiveSession(id);
  });
  ipcMain.handle(IPC_CHANNELS.desktopAction, async (event, action, value, remember) => {
    if (!desktop) throw new Error("Application services are not ready.");
    if (event.sender.id === quickChatWindow?.webContents.id) {
      if (action === "show") return showQuickChat();
      if (action === "minimize") return quickChatWindow?.minimize();
      if (action === "close" || action === "tray") return hideQuickChat();
      throw new Error("Invalid quick chat window action.");
    }
    await desktop.action(action, value, remember);
    if (action === "locale") companion?.refreshLocale();
    if (action === "finish-onboarding") showEnabledCompanion();
  });
  ipcMain.handle(IPC_CHANNELS.policyRead, (_event, document, locale) => {
    const currentDesktop = desktop;
    const currentWindow = mainWindow;
    const gate = startupRevealGate;
    const documentRevision = mainWindowDocumentRevision;
    if (!currentDesktop || !currentWindow || !gate || disposed || disposal)
      throw new Error("Application services are not ready.");
    const waitForReveal =
      !currentDesktop.state().accepted && ["terms", "privacy", "disclaimer"].includes(document);
    if (waitForReveal) confirmMainWindowStartupVisibility?.();
    const isCurrent = () =>
      !disposed &&
      !disposal &&
      desktop === currentDesktop &&
      mainWindow === currentWindow &&
      mainWindowDocumentRevision === documentRevision &&
      !currentWindow.isDestroyed() &&
      (!waitForReveal || (currentWindow.isVisible() && !currentWindow.isMinimized()));
    return readPolicyAfterReveal({
      waitForReveal,
      gate,
      isCurrent,
      read: () => currentDesktop.policy(document, locale, isCurrent),
    });
  });
  ipcMain.handle(IPC_CHANNELS.policyAccept, async (_event, consent) => {
    if (!desktop) throw new Error("Application services are not ready.");
    await desktop.accept(consent);
    startBackgroundServices();
  });
  ipcMain.handle(IPC_CHANNELS.updateStatus, () => updates?.status());
  ipcMain.handle(IPC_CHANNELS.updateCheck, () => updates?.check());
  ipcMain.handle(IPC_CHANNELS.updateDownload, () => updates?.download());
  ipcMain.handle(IPC_CHANNELS.updateCancel, () => updates?.cancel());
  ipcMain.handle(IPC_CHANNELS.updateInstall, () => updates?.install());
  ipcMain.handle(IPC_CHANNELS.runtimeDependencies, async () => {
    const status = await dependencies?.status();
    if (status)
      for (const [name, detail] of [
        ["native", "nativeDetail"],
        ["wsl", "wslDetail"],
        ["docker", "dockerDetail"],
        ["browserdo", "browserDetail"],
      ] as const) {
        if (!status[name])
          recordRuntimeError("dependencies.status", status[detail], { operation: name });
      }
    return status;
  });
  ipcMain.handle(IPC_CHANNELS.runtimeInstall, (_event, name) => {
    if (name === "docker") return dependencies?.install("docker");
    if (name === "embiody") return dependencies?.install("embiody");
    if (name === "wsl") return dependencies?.install("wsl");
    throw new Error("Unknown runtime");
  });
  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => {
    const platform: AppInfo["platform"] =
      process.platform === "win32" || process.platform === "darwin" ? process.platform : "linux";

    return {
      name: app.getName(),
      version: app.getVersion(),
      platform,
      isPackaged: isPackagedBuild,
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.bootstrap,
    async (
      _event,
      options?: { paged?: boolean; selectedId?: string | null },
    ): Promise<BootstrapData> => {
      startBackgroundServices();
      const current = requireServices();
      current.scheduledTaskService.start();
      const workspaces = options?.paged ? [] : current.repository.sessionWorkspacePaths();
      for (const workspace of workspaces) {
        await current.agentProfileService.syncWorkspace(workspace);
      }
      const page = options?.paged ? current.repository.sessionPage({ limit: 100 }) : null;
      const sessions = page ? page.sessions : current.repository.listWorkspaceSessions();
      if (options?.selectedId && !sessions.some((item) => item.id === options.selectedId)) {
        const selected = current.repository.getSession(options.selectedId);
        if (selected && selected.agentMode !== "chat") sessions.push(selected);
      }
      for (const item of [...sessions]) {
        let parentId = item.parentSessionId;
        const seen = new Set<string>();
        while (parentId && !seen.has(parentId)) {
          seen.add(parentId);
          const parent =
            sessions.find((value) => value.id === parentId) ??
            current.repository.getSession(parentId);
          if (!parent || parent.archived) break;
          if (!sessions.some((value) => value.id === parent.id)) sessions.push(parent);
          parentId = parent.parentSessionId;
        }
      }
      if (options?.paged) {
        const selected = sessions.find((item) => item.id === options.selectedId) ?? sessions[0];
        if (selected?.workspacePath)
          await current.agentProfileService.syncWorkspace(selected.workspacePath);
      }
      return {
        providers: current.repository.listProviders(),
        sessions,
        chatGroups: current.repository.listChatGroups(),
        ...(page
          ? {
              sessionCatalog: {
                revision: page.revision,
                total: page.total,
                groups: current.repository.sessionGroups(),
              },
            }
          : {}),
        sessionRuns: sessions.flatMap((session) => {
          const run = current.repository.latestSessionRun(session.id);
          return run ? [run] : [];
        }),
        agentProfiles: current.agentProfileService.list(),
        extensions: current.repository.listExtensions(),
        scheduledTasks: current.repository.listScheduledTasks(),
        mcpServers: current.mcpService.list(),
        approvalState: current.approvalBroker.state(),
        questionState: current.questionBroker.state(),
        pendingQuestions: current.questionBroker.list(),
        contextStates: sessions.flatMap((session) => {
          const state = current.chatService.contextCompaction.state(session.id);
          return state ? [state] : [];
        }),
      };
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.sessionPage,
    (_event, input: import("../shared/session-catalog").SessionPageInput) =>
      requireServices().repository.sessionPage(input),
  );
  ipcMain.handle(IPC_CHANNELS.sessionDelta, (_event, after: number, ids: string[]) =>
    requireServices().repository.sessionDelta(after, ids),
  );
  ipcMain.handle(IPC_CHANNELS.sessionGet, (_event, id: string) =>
    requireServices().repository.getSession(id),
  );
  ipcMain.handle(IPC_CHANNELS.projectContexts, (_event, sessionIds: unknown) => {
    if (
      !Array.isArray(sessionIds) ||
      sessionIds.length > 2_000 ||
      sessionIds.some((id) => typeof id !== "string" || !id || id.length > 200)
    )
      throw new Error("Invalid project-context session list.");
    return requireServices().projectNavigationService.list(sessionIds);
  });
  ipcMain.handle(IPC_CHANNELS.sessionGroups, () => requireServices().repository.sessionGroups());
  ipcMain.handle(IPC_CHANNELS.chatGroupsList, () =>
    requireServices().sessionService.listChatGroups(),
  );
  ipcMain.handle(IPC_CHANNELS.chatGroupCreate, (_event, name: string) =>
    requireServices().sessionService.createChatGroup(name),
  );
  ipcMain.handle(IPC_CHANNELS.chatGroupRename, (_event, id: string, name: string) =>
    requireServices().sessionService.renameChatGroup(id, name),
  );
  ipcMain.handle(IPC_CHANNELS.chatGroupRemove, (_event, id: string) =>
    requireServices().sessionService.removeChatGroup(id),
  );

  ipcMain.handle(IPC_CHANNELS.workspaceChoose, async (): Promise<string | null> => {
    const options: OpenDialogOptions = {
      title: "选择工作目录",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.modelCatalogGet, () =>
    new ModelCatalogService(requireServices().repository).getPreferences(),
  );
  ipcMain.handle(IPC_CHANNELS.modelCatalogProviderMove, (_event, input) =>
    new ModelCatalogService(requireServices().repository).moveProvider(input),
  );
  ipcMain.handle(IPC_CHANNELS.modelCatalogStarSet, (_event, input) =>
    new ModelCatalogService(requireServices().repository).setModelStar(input),
  );

  ipcMain.handle(IPC_CHANNELS.providerCreate, (_event, input) => {
    return requireServices().providerService.createProvider(input);
  });

  ipcMain.handle(IPC_CHANNELS.providerUpdate, (_event, input) => {
    const current = requireServices();
    return current.providerService.updateProvider(
      input,
      current.chatService.activeConversationCount() > 0,
    );
  });

  ipcMain.handle(IPC_CHANNELS.providerPromptCachingSet, (_event, providerId, settings) => {
    return requireServices().providerService.setPromptCaching(providerId, settings);
  });

  ipcMain.handle(IPC_CHANNELS.providerRemove, (_event, providerId: string) => {
    requireServices().providerService.removeProvider(providerId);
  });

  ipcMain.handle(IPC_CHANNELS.providerAddKey, (_event, input) => {
    return requireServices().providerService.addKey(input);
  });

  ipcMain.handle(IPC_CHANNELS.providerUpdateKey, (_event, input) => {
    return requireServices().providerService.updateKey(input);
  });

  ipcMain.handle(IPC_CHANNELS.providerRemoveKey, (_event, providerId: string, keyId: string) => {
    return requireServices().providerService.removeKey(providerId, keyId);
  });

  ipcMain.handle(IPC_CHANNELS.providerSetActiveKey, (_event, providerId: string, keyId: string) => {
    return requireServices().providerService.setActiveKey(providerId, keyId);
  });

  ipcMain.handle(IPC_CHANNELS.providerFetchModels, (_event, providerId: string) => {
    return requireServices().providerService.fetchModels(providerId);
  });

  ipcMain.handle(IPC_CHANNELS.providerTest, (_event, providerId: string, modelConfigId: string) => {
    return requireServices().providerService.testConnection(providerId, modelConfigId);
  });

  ipcMain.handle(IPC_CHANNELS.modelCreate, (_event, input) => {
    return requireServices().providerService.createModel(input);
  });

  ipcMain.handle(IPC_CHANNELS.modelUpdate, (_event, input) => {
    return requireServices().providerService.updateModel(input);
  });

  ipcMain.handle(IPC_CHANNELS.modelRemove, (_event, modelConfigId: string) => {
    return requireServices().providerService.removeModel(modelConfigId);
  });

  ipcMain.handle(IPC_CHANNELS.imageStudioGet, () =>
    requireServices().imageStudioService.loadWorkspace(),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioSave, (_event, workspace: unknown) =>
    requireServices().imageStudioService.saveWorkspace(workspace),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioCanvasesList, () =>
    requireServices().imageStudioService.listCanvases(),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioCanvasOpen, (_event, canvasId: unknown) =>
    requireServices().imageStudioService.openCanvas(canvasId),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioCanvasClose, (_event, canvasId: unknown) =>
    requireServices().imageStudioService.closeCanvas(canvasId),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioCanvasRename, (_event, canvasId: unknown, name: unknown) =>
    requireServices().imageStudioService.renameCanvas(canvasId, name),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioCanvasDuplicate, (_event, canvasId: unknown) =>
    requireServices().imageStudioService.duplicateCanvas(canvasId),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioCanvasDelete, (_event, canvasId: unknown) =>
    requireServices().imageStudioService.deleteCanvas(canvasId),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioCanvasFolder, async () => {
    const imageStudioService = requireServices().imageStudioService;
    await imageStudioService.listCanvases();
    const error = await shell.openPath(imageStudioService.getCanvasDirectoryPath());
    if (error) throw new Error(`无法打开画布文件夹：${error}`);
  });
  ipcMain.handle(IPC_CHANNELS.imageStudioAssetData, (_event, assetId: unknown) =>
    requireServices().imageStudioService.getAssetData(assetId),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioImport, (_event, files: unknown) =>
    requireServices().imageStudioService.importAssets(files),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioRemoveAsset, (_event, assetId: unknown) =>
    requireServices().imageStudioService.removeAsset(assetId),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioExportAsset, async (_event, assetId: unknown) => {
    const imageStudioService = requireServices().imageStudioService;
    if (typeof assetId !== "string") throw new Error("图片素材标识无效。");
    const asset = imageStudioService.getWorkspace().assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("图片素材不存在。");
    const extension =
      asset.mimeType === "image/jpeg" ? "jpg" : asset.mimeType.slice("image/".length);
    const options = {
      title: "保存图片",
      defaultPath: asset.name,
      filters: [{ name: "Image", extensions: [extension] }],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await imageStudioService.exportAsset(assetId, result.filePath);
    return result.filePath;
  });
  ipcMain.handle(IPC_CHANNELS.imageStudioGenerate, (_event, input) =>
    requireServices().imageStudioService.generate(input),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioPolishPrompt, (_event, input) =>
    requireServices().imageStudioService.polishPrompt(input),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioReversePrompt, (_event, input) =>
    requireServices().imageStudioService.reversePrompt(input),
  );
  ipcMain.handle(IPC_CHANNELS.imageStudioCancel, (_event, requestId: unknown) => {
    requireServices().imageStudioService.cancelRequest(requestId);
  });

  ipcMain.handle(IPC_CHANNELS.sessionCreate, (_event, input) => {
    return requireServices().sessionService.create(input);
  });

  ipcMain.handle(
    IPC_CHANNELS.sessionCreateInWorkspace,
    (_event, workspacePath: string | null, agentMode?: "code" | "work") => {
      return requireServices().sessionService.createInWorkspace(workspacePath, agentMode);
    },
  );
  ipcMain.handle(IPC_CHANNELS.sessionCreateInChatGroup, (_event, groupId: string | null) =>
    requireServices().sessionService.createChatSessionInGroup(groupId),
  );
  ipcMain.handle(IPC_CHANNELS.sessionOpenWorkspace, (_event, sessionId: string) => {
    if (!desktop) throw new Error("Application services are not ready.");
    return desktop.openSessionWorkspace(sessionId);
  });
  ipcMain.handle(IPC_CHANNELS.sessionFork, (_event, sessionId: string, messageId?: string) => {
    if (typeof sessionId !== "string" || (messageId !== undefined && typeof messageId !== "string"))
      throw new Error("Invalid session or message ID.");
    return requireServices().chatService.forkSession(sessionId, messageId);
  });

  const updateSession = async (input: SessionUpdateInput, expected?: SessionBatchTarget[]) => {
    const current = requireServices();
    const isBusy = (id: string): boolean =>
      current.chatService.isSessionBusy(id) ||
      current.repository.listChildSessions(id).some((child) => isBusy(child.id));
    if (input.archived === true) {
      await prepareSessionArchive(input.sessionId, {
        isBusy,
        quickSessionId: () => quickChat?.currentSessionId ?? null,
        flushMainDraft: () =>
          flushComposerDrafts(mainWindow, ipcMain, undefined, "save", input.sessionId),
        flushQuickDraft: () =>
          flushComposerDrafts(quickChatWindow, ipcMain, undefined, "save", input.sessionId),
      });
      if (isBusy(input.sessionId)) throw new Error("请先停止会话及其子任务，再归档。");
    }
    if (input.chatNetworkEnabled !== undefined && isBusy(input.sessionId))
      throw new Error("任务运行期间不能切换 ChatAgent 联网状态，请等待结束或手动停止。");
    const session = current.repository.getSession(input.sessionId);
    if (
      session &&
      input.agentMode !== undefined &&
      input.agentMode !== session.agentMode &&
      isBusy(input.sessionId)
    )
      throw new Error("请先停止会话及其子任务，再切换 CodeAgent/WorkAgent 模式。");
    const projectKey = (path: string | null) => (path ? canonicalProjectMemoryRoot(path) : "");
    if (
      session &&
      input.workspacePath !== undefined &&
      projectKey(input.workspacePath?.trim() || null) !== projectKey(session.workspacePath) &&
      isBusy(input.sessionId)
    )
      throw new Error("Stop the conversation before changing its project directory.");
    const { permissionMode, approvalMode, ...rest } = input;
    createSessionBatchGuard(current.repository, input.sessionId, expected);
    current.sessionService.update(rest);
    if (approvalMode !== undefined)
      current.chatService.setSessionApprovalMode(input.sessionId, approvalMode);
    if (permissionMode !== undefined)
      current.chatService.setSessionPermission(input.sessionId, permissionMode);
    if (
      session &&
      (input.workspacePath !== undefined ||
        input.executionMode !== undefined ||
        input.patchOnly === true ||
        input.agentMode === "chat" ||
        permissionMode === "request_approval" ||
        approvalMode === "automatic")
    ) {
      const invalidated = current.repository
        .listSessions()
        .filter(
          (candidate) =>
            candidate.id === session.id ||
            (candidate.permissionMode !== "full_access" &&
              projectKey(candidate.workspacePath) === projectKey(session.workspacePath)),
        );
      const results = await Promise.allSettled(
        invalidated.map((candidate) => current.terminalService.disposeSession(candidate.id)),
      );
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length)
        throw new AggregateError(
          failures,
          "权限或工作区已更新，但部分终端清理未确认，请重试关闭。",
        );
    }
    return completeSessionUpdate(input, {
      restoreContext: (sessionId) => current.chatService.restoreContext(sessionId),
      getSession: (sessionId) => current.repository.getSession(sessionId),
      emitUpdated: (session) => emitRuntimeEvent({ type: "session_updated", session }),
    });
  };
  ipcMain.handle(
    IPC_CHANNELS.sessionUpdate,
    (_event, input: SessionUpdateInput, expected?: SessionBatchTarget[]) => {
      if (input.archived !== true) return updateSession(input, expected);
      return queueQuickChatVisibility(() => {
        if (quickChat?.currentSessionId !== input.sessionId) return updateSession(input, expected);
        return withQuickChatTransition(quickChatWindow, ipcMain, () =>
          updateSession(input, expected),
        );
      });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.sessionRemove,
    async (_event, sessionId: string, expected?: SessionBatchTarget[]) => {
      const current = requireServices();
      const guard = createSessionBatchGuard(current.repository, sessionId, expected);
      await current.chatService.removeSession(sessionId, guard);
    },
  );

  ipcMain.handle(IPC_CHANNELS.sessionMessages, (_event, sessionId: string) => {
    return requireServices().sessionService.getMessages(sessionId);
  });
  ipcMain.handle(IPC_CHANNELS.sessionOpened, (_event, sessionId: string | null) => {
    if (sessionId !== null && typeof sessionId !== "string") throw new Error("Invalid session ID");
    requireServices().sessionRetentionService.opened(sessionId);
    const session = sessionId ? requireServices().repository.getSession(sessionId) : null;
    if (session)
      mainWindow?.webContents.send(IPC_CHANNELS.runtimeEvent, { type: "session_updated", session });
  });
  ipcMain.handle(IPC_CHANNELS.sessionRunState, (_event, sessionId: string) =>
    requireServices().repository.latestSessionRun(sessionId),
  );
  ipcMain.handle(IPC_CHANNELS.sessionRetentionGet, () =>
    requireServices().sessionRetentionService.settings(),
  );
  ipcMain.handle(IPC_CHANNELS.sessionRetentionSet, (_event, settings) =>
    requireServices().sessionRetentionService.configure(settings),
  );

  ipcMain.handle(IPC_CHANNELS.chatSend, (_event, input) => {
    return requireServices().chatService.send(input);
  });
  ipcMain.handle(IPC_CHANNELS.runSteeringGet, (_event, sessionId: string) =>
    requireServices().chatService.getRunSteering(sessionId),
  );
  ipcMain.handle(IPC_CHANNELS.runSteeringSend, (_event, input) =>
    requireServices().chatService.steerRun(input),
  );
  ipcMain.handle(IPC_CHANNELS.composerDraftGet, (_event, sessionId: string) =>
    requireServices().chatService.getComposerDraft(sessionId),
  );
  ipcMain.handle(IPC_CHANNELS.composerDraftSave, (event, input) => {
    requireServices().chatService.saveComposerDraft(input);
    emitComposerDraftChanged(event.sender.id, input.sessionId, input.revision);
  });
  ipcMain.handle(IPC_CHANNELS.composerDraftClear, (event, sessionId: string, revision: string) => {
    const cleared = requireServices().repository.clearComposerDraft(sessionId, revision);
    if (cleared) emitComposerDraftChanged(event.sender.id, sessionId, null);
    return cleared;
  });
  ipcMain.handle(IPC_CHANNELS.draftAssistSettingsGet, () =>
    requireServices().draftAssistService.settings(),
  );
  ipcMain.handle(IPC_CHANNELS.draftAssistSettingsSet, (_event, input) =>
    requireServices().draftAssistService.configure(input),
  );
  ipcMain.handle(IPC_CHANNELS.draftAssistPolish, (_event, input) =>
    requireServices().draftAssistService.polish(input),
  );
  ipcMain.handle(IPC_CHANNELS.draftAssistCancel, (_event, requestId: unknown) => {
    requireServices().draftAssistService.cancelRequest(requestId);
  });
  ipcMain.handle(IPC_CHANNELS.projectToneGet, (_event, sessionId: string) =>
    requireServices().draftAssistService.getProjectTone(sessionId),
  );
  ipcMain.handle(IPC_CHANNELS.projectToneSet, (_event, input) =>
    requireServices().draftAssistService.setProjectTone(input),
  );

  ipcMain.handle(IPC_CHANNELS.chatRewrite, (_event, input) => {
    return requireServices().chatService.rewriteAndSend(input);
  });

  ipcMain.handle(IPC_CHANNELS.autoDriveSuggest, (_event, sessionId: string) =>
    requireServices().chatService.suggestAutoDrive(sessionId),
  );
  ipcMain.handle(IPC_CHANNELS.autoDriveCancel, (_event, sessionId: string) => {
    requireServices().chatService.cancelAutoDrive(sessionId);
  });
  ipcMain.handle(IPC_CHANNELS.agentCoordinationGet, (_event, sessionId: string) =>
    requireServices().chatService.getCoordinationState(sessionId),
  );

  ipcMain.handle(IPC_CHANNELS.chatStop, (_event, sessionId: string) => {
    requireServices().chatService.stop(sessionId);
  });
  ipcMain.handle(IPC_CHANNELS.chatCompact, (_event, sessionId: string) => {
    if (typeof sessionId !== "string") throw new Error("Invalid session ID.");
    return requireServices().chatService.compactSession(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.approvalDecide, (_event, input) => {
    requireServices().chatService.decideApproval(input);
  });
  ipcMain.handle(IPC_CHANNELS.approvalState, () => requireServices().approvalBroker.state());
  ipcMain.handle(IPC_CHANNELS.compactionModelGet, () =>
    requireServices().chatService.contextCompaction.globalModel(),
  );
  ipcMain.handle(IPC_CHANNELS.compactionModelSet, (_event, input) =>
    requireServices().chatService.contextCompaction.setGlobalModel(input),
  );
  ipcMain.handle(IPC_CHANNELS.compactionFallbackGet, () =>
    requireServices().chatService.contextCompaction.fallbackModel(),
  );
  ipcMain.handle(IPC_CHANNELS.compactionFallbackSet, (_event, input) =>
    requireServices().chatService.contextCompaction.setFallbackModel(input),
  );
  ipcMain.handle(IPC_CHANNELS.contextUsage, (_event, sessionId: string) => {
    if (typeof sessionId !== "string") throw new Error("Invalid session ID.");
    return requireServices().chatService.restoreContext(sessionId);
  });
  ipcMain.handle(IPC_CHANNELS.approvalModelGet, () =>
    requireServices().chatService.getApprovalModelSettings(),
  );
  ipcMain.handle(IPC_CHANNELS.approvalModelSet, (_event, input) =>
    requireServices().chatService.setApprovalModelSettings(input),
  );
  ipcMain.handle(IPC_CHANNELS.approvalAutomatic, (_event, sessionId) =>
    requireServices().chatService.startAutomaticApproval(sessionId),
  );

  ipcMain.handle(IPC_CHANNELS.questionAnswer, (_event, input) => {
    requireServices().questionBroker.answer(input);
  });

  ipcMain.handle(IPC_CHANNELS.questionState, () => requireServices().questionBroker.state());

  ipcMain.handle(IPC_CHANNELS.workspaceList, (_event, root: string, relativePath: string) => {
    return requireServices().workspaceService.list(root, relativePath);
  });
  ipcMain.handle(
    IPC_CHANNELS.workspaceSearchFiles,
    (_event, input: import("../shared/project-navigation").WorkspaceFileSearchInput) => {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        typeof input.sessionId !== "string" ||
        !input.sessionId ||
        input.sessionId.length > 200 ||
        typeof input.query !== "string" ||
        (input.limit !== undefined &&
          (!Number.isFinite(input.limit) || input.limit < 1 || input.limit > 100))
      )
        throw new Error("Invalid workspace file search.");
      const current = requireServices();
      return current.workspaceSearchService.findSessionFiles(current.repository, input);
    },
  );

  ipcMain.handle(IPC_CHANNELS.workspaceRead, (_event, root: string, relativePath: string) => {
    return requireServices().workspaceService.readFile(root, relativePath);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceReadAbsolute, (_event, path: string) => {
    return requireServices().workspaceService.readAbsoluteFile(path);
  });

  ipcMain.handle(
    IPC_CHANNELS.workspaceWrite,
    (_event, root: string, relativePath: string, content: string) => {
      return requireServices().workspaceService.writeFile(root, relativePath, content);
    },
  );

  ipcMain.handle(IPC_CHANNELS.workspaceWriteAbsolute, (_event, path: string, content: string) => {
    return requireServices().workspaceService.writeAbsoluteFile(path, content);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceGitStatus, (_event, root: string) => {
    return requireServices().workspaceService.gitStatus(root);
  });
  ipcMain.handle(IPC_CHANNELS.gitChanges, (_event, root: string) =>
    requireServices().gitChangeService.changes(root),
  );
  ipcMain.handle(IPC_CHANNELS.gitLatestBackup, (_event, root: string) =>
    requireServices().gitChangeService.latestBackup(root),
  );
  ipcMain.handle(IPC_CHANNELS.gitDiscard, (_event, root: string, paths?: string[]) =>
    requireServices().gitChangeService.discard(root, paths),
  );
  ipcMain.handle(IPC_CHANNELS.gitRestoreUndo, (_event, root: string, id: string) =>
    requireServices().gitChangeService.restore(id, root),
  );

  ipcMain.handle(IPC_CHANNELS.workspaceRunCommand, (_event, root: string, command: string) => {
    return requireServices().workspaceService.runCommand(root, command);
  });
  ipcMain.handle(
    IPC_CHANNELS.localReviewGet,
    (_event, input: import("../shared/local-review").LocalReviewRequest) =>
      requireServices().localReviewService.get(input),
  );
  ipcMain.handle(
    IPC_CHANNELS.localReviewSubmit,
    (_event, input: import("../shared/local-review").LocalReviewCommentsInput) =>
      requireServices().localReviewService.submit(input),
  );

  ipcMain.handle(IPC_CHANNELS.terminalList, (event, sessionId: unknown) => {
    const ownerId = requireMainWindowSender(event);
    if (typeof sessionId !== "string") throw new Error("无效的会话标识。");
    return requireServices().terminalService.list(ownerId, sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.terminalCreate, (event, input: unknown) => {
    const ownerId = requireMainWindowSender(event);
    if (!input || typeof input !== "object") throw new Error("无效的终端创建请求。");
    const value = input as Record<string, unknown>;
    if (typeof value.sessionId !== "string") throw new Error("无效的会话标识。");
    const normalized: InteractiveTerminalCreateInput = {
      sessionId: value.sessionId,
      ...(typeof value.cols === "number" ? { cols: value.cols } : {}),
      ...(typeof value.rows === "number" ? { rows: value.rows } : {}),
    };
    return requireServices().terminalService.create(ownerId, normalized);
  });

  ipcMain.handle(IPC_CHANNELS.terminalInput, (event, terminalId: unknown, data: unknown) => {
    const ownerId = requireMainWindowSender(event);
    if (typeof terminalId !== "string" || typeof data !== "string") {
      throw new Error("无效的终端输入。");
    }
    return requireServices().terminalService.input(ownerId, terminalId, data);
  });

  ipcMain.handle(
    IPC_CHANNELS.terminalResize,
    (event, terminalId: unknown, cols: unknown, rows: unknown) => {
      const ownerId = requireMainWindowSender(event);
      if (typeof terminalId !== "string" || typeof cols !== "number" || typeof rows !== "number") {
        throw new Error("无效的终端尺寸。");
      }
      return requireServices().terminalService.resize(ownerId, terminalId, cols, rows);
    },
  );

  ipcMain.handle(IPC_CHANNELS.terminalStop, (event, terminalId: unknown) => {
    const ownerId = requireMainWindowSender(event);
    if (typeof terminalId !== "string") throw new Error("无效的终端标识。");
    return requireServices().terminalService.stop(ownerId, terminalId);
  });

  ipcMain.handle(IPC_CHANNELS.extensionsList, () => {
    return requireServices().extensionService.list();
  });

  ipcMain.handle(IPC_CHANNELS.extensionsChooseDirectory, async (): Promise<string | null> => {
    const options: OpenDialogOptions = {
      title: "选择技能、插件或本地开发市场目录",
      buttonLabel: "选择此目录",
      properties: ["openDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.extensionsImport, async (_event, sourceDirectory: string) => {
    const current = requireServices();
    const result = await current.extensionService.importRecursive(sourceDirectory);
    for (const extension of result.imported) {
      await current.mcpService.importPluginServers(extension.id);
    }
    return result;
  });

  ipcMain.handle(
    IPC_CHANNELS.extensionsSetEnabled,
    (_event, extensionId: string, enabled: boolean) => {
      requireServices().extensionService.setEnabled(extensionId, enabled);
    },
  );

  ipcMain.handle(IPC_CHANNELS.extensionsRemove, async (_event, extensionId: string) => {
    const current = requireServices();
    await current.mcpService.removePluginServers(extensionId);
    return current.extensionService.remove(extensionId);
  });

  ipcMain.handle(IPC_CHANNELS.sessionExtensionsList, (_event, sessionId: string) => {
    return requireServices().extensionService.listSessionExtensionIds(sessionId);
  });

  ipcMain.handle(
    IPC_CHANNELS.sessionExtensionsSet,
    (_event, sessionId: string, extensionId: string, enabled: boolean) => {
      requireServices().extensionService.setSessionExtension(sessionId, extensionId, enabled);
    },
  );

  ipcMain.handle(IPC_CHANNELS.sessionBuiltinCapabilitiesList, (_event, sessionId: string) =>
    requireServices().sessionBuiltinCapabilityService.list(sessionId),
  );

  ipcMain.handle(
    IPC_CHANNELS.sessionBuiltinCapabilitySet,
    (_event, sessionId: string, capabilityId: string, selected: boolean) =>
      requireServices().sessionBuiltinCapabilityService.set(sessionId, capabilityId, selected),
  );

  ipcMain.handle(IPC_CHANNELS.queuedPromptList, (_event, sessionId: string) => {
    return requireServices().queuedPromptService.list(sessionId);
  });
  ipcMain.handle(IPC_CHANNELS.queuedPromptAdd, (_event, input) => {
    return requireServices().queuedPromptService.add(input);
  });
  ipcMain.handle(IPC_CHANNELS.queuedPromptUpdate, (_event, input) => {
    return requireServices().queuedPromptService.update(input);
  });
  ipcMain.handle(IPC_CHANNELS.queuedPromptReorder, (_event, input) => {
    return requireServices().queuedPromptService.reorder(input);
  });
  ipcMain.handle(IPC_CHANNELS.queuedPromptRemove, (_event, sessionId: string, itemId: string) => {
    requireServices().queuedPromptService.remove(sessionId, itemId);
  });
  ipcMain.handle(IPC_CHANNELS.queuedPromptContinue, (_event, sessionId: string, itemId: string) => {
    return requireServices().queuedPromptService.continue(sessionId, itemId);
  });
  const queueEditOwners = new Set<number>();
  ipcMain.handle(IPC_CHANNELS.queuedPromptBeginEdit, (event, sessionId: string, itemId: string) => {
    const owner = event.sender;
    if (!queueEditOwners.has(owner.id)) {
      queueEditOwners.add(owner.id);
      const abandon = () => services?.queuedPromptService.abandonEdits(owner.id);
      owner.on("did-start-loading", abandon);
      owner.on("render-process-gone", abandon);
      owner.once("destroyed", () => {
        abandon();
        queueEditOwners.delete(owner.id);
      });
    }
    return requireServices().queuedPromptService.beginEdit(sessionId, itemId, owner.id);
  });
  ipcMain.handle(
    IPC_CHANNELS.queuedPromptEndEdit,
    (event, sessionId: string, editId: string, abandon = false) => {
      requireServices().queuedPromptService.endEdit(sessionId, editId, abandon, event.sender.id);
    },
  );

  ipcMain.handle(IPC_CHANNELS.scheduledTasksList, () => {
    return requireServices().scheduledTaskService.list();
  });

  ipcMain.handle(IPC_CHANNELS.scheduledTasksCreate, (_event, input) => {
    return requireServices().scheduledTaskService.create(input);
  });

  ipcMain.handle(
    IPC_CHANNELS.scheduledTasksSetEnabled,
    (_event, taskId: string, enabled: boolean) => {
      return requireServices().scheduledTaskService.setEnabled(taskId, enabled);
    },
  );

  ipcMain.handle(IPC_CHANNELS.scheduledTasksRemove, (_event, taskId: string) => {
    requireServices().scheduledTaskService.remove(taskId);
  });

  ipcMain.handle(IPC_CHANNELS.scheduledTasksRunNow, (_event, taskId: string) => {
    return requireServices().scheduledTaskService.runNow(taskId);
  });

  ipcMain.handle(IPC_CHANNELS.marketplaceList, (_event, source, forceRefresh?: boolean) => {
    return requireServices().marketplaceService.list(
      source === "composio" ? "composio" : "openai",
      Boolean(forceRefresh),
    );
  });

  ipcMain.handle(IPC_CHANNELS.marketplaceInstall, (_event, source, skillPath: string) => {
    return requireServices().marketplaceService.install(
      source === "composio" ? "composio" : "openai",
      skillPath,
    );
  });

  ipcMain.handle(IPC_CHANNELS.localPluginValidate, (_event, path: unknown) =>
    requireServices().localPluginMarketplaceService.inspectDirectory(
      localPluginArgument(path, "directory", 32_768),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.localPluginMarketsList, () =>
    requireServices().localPluginMarketplaceService.listSources(),
  );
  ipcMain.handle(IPC_CHANNELS.localPluginUpdatesCheck, () =>
    requireServices().localPluginMarketplaceService.checkForUpdates(),
  );
  ipcMain.handle(IPC_CHANNELS.localPluginMarketAdd, (_event, path: unknown) =>
    requireServices().localPluginMarketplaceService.addMarket(
      localPluginArgument(path, "market directory", 32_768),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.localPluginMarketGet, (_event, id: unknown) =>
    requireServices().localPluginMarketplaceService.getMarket(localPluginArgument(id, "market ID")),
  );
  ipcMain.handle(IPC_CHANNELS.localPluginMarketRefresh, (_event, id: unknown) =>
    requireServices().localPluginMarketplaceService.refreshMarket(
      localPluginArgument(id, "market ID"),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.localPluginMarketRemove, (_event, id: unknown) =>
    requireServices().localPluginMarketplaceService.removeMarketSource(
      localPluginArgument(id, "market ID"),
    ),
  );
  const installLocalPlugin = async (marketId: unknown, pluginName: unknown, update: boolean) => {
    const current = requireServices();
    if (current.chatService.activeConversationCount() > 0)
      throw new Error("请先等待 Agent 任务结束或手动停止，再安装或更新本地插件。");
    const id = localPluginArgument(marketId, "market ID");
    const name = localPluginArgument(pluginName, "name");
    const result = update
      ? await current.localPluginMarketplaceService.updatePlugin(id, name)
      : await current.localPluginMarketplaceService.installPlugin(id, name);
    try {
      await current.mcpService.importPluginServers(result.extension.id);
    } catch (cause) {
      result.warnings.push(
        `插件已安装，但 MCP 声明尚未完成同步；可重新点击安装以重试：${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    return result;
  };
  ipcMain.handle(IPC_CHANNELS.localPluginInstall, (_event, marketId: unknown, name: unknown) =>
    installLocalPlugin(marketId, name, false),
  );
  ipcMain.handle(IPC_CHANNELS.localPluginUpdate, (_event, marketId: unknown, name: unknown) =>
    installLocalPlugin(marketId, name, true),
  );

  ipcMain.handle(IPC_CHANNELS.mcpList, () => {
    return requireServices().mcpService.list();
  });

  ipcMain.handle(IPC_CHANNELS.mcpSave, (_event, input) => {
    return requireServices().mcpService.save(input);
  });

  ipcMain.handle(IPC_CHANNELS.mcpRemove, (_event, id: string) => {
    return requireServices().mcpService.remove(id);
  });

  ipcMain.handle(IPC_CHANNELS.mcpSetEnabled, (_event, id: string, enabled: boolean) => {
    return requireServices().mcpService.setEnabled(id, enabled);
  });

  ipcMain.handle(IPC_CHANNELS.mcpTest, (_event, id: string) => {
    return requireServices().mcpService.test(id);
  });
  ipcMain.handle(IPC_CHANNELS.mcpOAuthStart, (_event, id: string) => {
    return requireServices().mcpService.startOAuth(id);
  });

  ipcMain.handle(IPC_CHANNELS.agentProfilesList, () => {
    return requireServices().agentProfileService.list();
  });

  ipcMain.handle(IPC_CHANNELS.agentProfileSave, (_event, input) => {
    return requireServices().agentProfileService.save(input);
  });

  ipcMain.handle(IPC_CHANNELS.agentProfileRemove, (_event, id: string) => {
    requireServices().agentProfileService.remove(id);
  });

  ipcMain.handle(IPC_CHANNELS.projectInstructions, (_event, workspacePath: string) => {
    return requireServices().projectInstructionService.discover(workspacePath);
  });

  ipcMain.handle(IPC_CHANNELS.projectTrustGet, (_event, workspacePath: string) => {
    return requireServices().repository.isProjectTrusted(resolve(workspacePath));
  });

  ipcMain.handle(
    IPC_CHANNELS.projectTrustSet,
    async (_event, workspacePath: string, trusted: boolean) => {
      const current = requireServices();
      const root = resolve(workspacePath);
      current.repository.setProjectTrusted(root, trusted);
      if (!trusted) {
        const key = canonicalProjectMemoryRoot(root);
        const results = await Promise.allSettled(
          current.repository
            .listSessions()
            .filter(
              (session) =>
                session.workspacePath && canonicalProjectMemoryRoot(session.workspacePath) === key,
            )
            .map((session) => current.terminalService.disposeSession(session.id)),
        );
        const failures = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (failures.length)
          throw new AggregateError(failures, "项目信任已撤销，但部分终端清理未确认，请重试关闭。");
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.diagnosticsRun,
    (_event, workspacePath: string, changedPaths: string[]) => {
      return requireServices().projectToolingService.diagnostics(
        resolve(workspacePath),
        changedPaths.map((path) => resolve(path)),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.snapshotsList, (_event, sessionId: string) => {
    return requireServices().snapshotService.list(sessionId);
  });

  ipcMain.handle(
    IPC_CHANNELS.snapshotRestore,
    (_event, snapshotId: string, workspacePath: string) => {
      return requireServices().snapshotService.restore(snapshotId, workspacePath);
    },
  );

  ipcMain.handle(IPC_CHANNELS.trajectoriesList, (_event, sessionId: string, runId?: string) => {
    return requireServices().trajectoryService.list(sessionId, runId);
  });

  ipcMain.handle(
    IPC_CHANNELS.trajectoryExport,
    async (_event, sessionId: string, runId: string, format: "json" | "markdown") => {
      const trajectory = requireServices().trajectoryService.getRun(sessionId, runId);
      if (!trajectory) {
        throw new Error("运行轨迹不存在。");
      }
      const options = {
        title: "导出运行轨迹",
        defaultPath: `mingshen-trajectory-${runId.slice(0, 8)}.${format === "json" ? "json" : "md"}`,
        filters:
          format === "json"
            ? [{ name: "JSON", extensions: ["json"] }]
            : [{ name: "Markdown", extensions: ["md"] }],
      };
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) {
        return null;
      }
      const content =
        format === "json"
          ? JSON.stringify(trajectory, null, 2)
          : [
              `# Mingshen 运行轨迹`,
              "",
              `- Session: ${sessionId}`,
              `- Run: ${runId}`,
              `- Started: ${trajectory.startedAt}`,
              "",
              "## Steps",
              ...trajectory.stepSummaries.map((summary, index) => `${index + 1}. ${summary}`),
              "",
              "## Events",
              ...trajectory.events.map(
                (event) =>
                  `- ${event.createdAt} · ${event.type} · ${event.summary}\n\n\`\`\`json\n${JSON.stringify(
                    event.payload,
                    null,
                    2,
                  )}\n\`\`\``,
              ),
            ].join("\n");
      await writeFile(result.filePath, content, "utf8");
      return result.filePath;
    },
  );

  ipcMain.handle(IPC_CHANNELS.customCommandsList, (_event, workspacePath: string | null) => {
    return requireServices().customCommandService.list(workspacePath);
  });

  ipcMain.handle(IPC_CHANNELS.sessionTodos, (_event, sessionId: string) => {
    return requireServices().repository.listSessionTodos(sessionId);
  });
  ipcMain.handle(IPC_CHANNELS.workbenchGet, (_event, sessionId: string) =>
    requireServices().chatService.workbench.state(sessionId),
  );
  ipcMain.handle(IPC_CHANNELS.subagentOutput, (_event, parentId: string, sessionId: string) => {
    if (
      typeof parentId !== "string" ||
      typeof sessionId !== "string" ||
      parentId.length > 128 ||
      sessionId.length > 128
    )
      throw new Error("子会话 ID 无效。");
    return requireServices().repository.subagentOutput(parentId, sessionId);
  });
  ipcMain.handle(
    IPC_CHANNELS.workbenchPlanUpdate,
    (_event, input: import("../shared/workbench").PlanUpdateInput) => {
      const current = requireServices();
      const plan = current.chatService.workbench.update(input);
      if (plan.paused) current.chatService.stop(input.sessionId);
      return plan;
    },
  );
  ipcMain.handle(IPC_CHANNELS.workbenchResume, (_event, sessionId: string) =>
    requireServices().chatService.resumeSession(sessionId),
  );
  ipcMain.handle(IPC_CHANNELS.projectPlansList, (_event, path: string | null) =>
    requireServices().chatService.workbench.listProjectPlans(path),
  );
  ipcMain.handle(
    IPC_CHANNELS.projectPlanSave,
    (_event, id: string, name: string, planId?: string) =>
      requireServices().chatService.workbench.saveProjectPlan(id, name, planId),
  );
  ipcMain.handle(
    IPC_CHANNELS.projectPlanApply,
    (_event, id: string, planId: string, revision: number, reset?: boolean) => {
      const current = requireServices();
      if (current.chatService.isSessionBusy(id)) throw new Error("请先停止任务，再绑定计划。");
      return current.chatService.workbench.applyProjectPlan(id, planId, revision, reset);
    },
  );
  ipcMain.handle(IPC_CHANNELS.projectPlanRemove, (_event, id: string) =>
    requireServices().chatService.workbench.removeProjectPlan(id),
  );

  ipcMain.handle(IPC_CHANNELS.toolingStatus, (_event, workspacePath: string) => {
    return requireServices().projectToolingService.status(workspacePath);
  });

  ipcMain.handle(IPC_CHANNELS.customToolsList, (_event, workspacePath: string | null) => {
    return requireServices().customToolService.list(workspacePath);
  });

  ipcMain.handle(IPC_CHANNELS.agentRuntimeSettingsGet, () => {
    return requireServices().chatService.getAgentRuntimeSettings();
  });

  ipcMain.handle(IPC_CHANNELS.modelRetryGet, () =>
    requireServices().chatService.getModelRetrySettings(),
  );
  const saverSessionId = (id: unknown): string | null => {
    if (id === null || id === undefined) return null;
    if (typeof id !== "string" || !id || id.length > 128) throw new Error("Invalid session ID.");
    return id;
  };
  ipcMain.handle(IPC_CHANNELS.tokenSaverGet, (_event, id: unknown) =>
    requireServices().chatService.tokenSaver.snapshot(saverSessionId(id)),
  );
  ipcMain.handle(IPC_CHANNELS.tokenSaverSet, (_event, settings: unknown) =>
    requireServices().chatService.tokenSaver.configure(settings),
  );
  ipcMain.handle(
    IPC_CHANNELS.tokenSaverRecall,
    (
      _event,
      id: unknown,
      messageId: unknown,
      partIndex: unknown,
      startLine: unknown,
      charOffset: unknown,
    ) => {
      const sessionId = saverSessionId(id);
      if (!sessionId || !requireServices().repository.getSession(sessionId))
        throw new Error("Session not found.");
      return requireServices().chatService.tokenSaver.recall(sessionId, {
        message_id: messageId,
        part_index: partIndex,
        start_line: startLine,
        char_offset: charOffset,
      });
    },
  );
  ipcMain.handle(IPC_CHANNELS.modelRetrySet, (_event, settings) =>
    requireServices().chatService.setModelRetrySettings(settings),
  );

  ipcMain.handle(IPC_CHANNELS.agentRuntimeSettingsSet, (_event, settings) => {
    return requireServices().chatService.setAgentRuntimeSettings(settings);
  });

  ipcMain.handle(IPC_CHANNELS.dockerSettingsGet, async () => {
    const current = requireServices();
    const stored = current.repository.getSetting("docker.settings");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      const record = stored as Record<string, unknown>;
      return {
        image:
          typeof record.image === "string"
            ? record.image
            : "mcr.microsoft.com/powershell:lts-alpine",
        dockerfile: typeof record.dockerfile === "string" ? record.dockerfile : "",
        buildContext: typeof record.buildContext === "string" ? record.buildContext : ".",
      };
    }
    return {
      image: "mcr.microsoft.com/powershell:lts-alpine",
      dockerfile: "",
      buildContext: ".",
    };
  });

  ipcMain.handle(IPC_CHANNELS.dockerSettingsSet, (_event, settings) => {
    requireServices().repository.setSetting("docker.settings", settings);
  });

  ipcMain.handle(IPC_CHANNELS.headlessServerStatus, () => {
    return requireServices().headlessServerService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.headlessServerStart, (_event, host?: string, port?: number) => {
    return requireServices().headlessServerService.start(host, port);
  });

  ipcMain.handle(IPC_CHANNELS.headlessServerStop, () => {
    return requireServices().headlessServerService.stop();
  });

  ipcMain.handle(IPC_CHANNELS.sessionShare, (_event, sessionId: string) => {
    return requireServices().headlessServerService.share(sessionId);
  });

  ipcMain.handle(
    IPC_CHANNELS.sessionExport,
    async (_event, sessionId: string, format: "json" | "markdown") => {
      const current = requireServices();
      const session = current.repository.getSession(sessionId);
      if (!session) {
        throw new Error("会话不存在。");
      }
      const messages = current.repository.getMessages(sessionId);
      const options = {
        title: "导出会话",
        defaultPath: `${session.title.replace(/[<>:"/\\|?*]/g, "_")}.${format === "json" ? "json" : "md"}`,
        filters:
          format === "json"
            ? [{ name: "JSON", extensions: ["json"] }]
            : [{ name: "Markdown", extensions: ["md"] }],
      };
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) {
        return null;
      }
      const content =
        format === "json"
          ? JSON.stringify({ session, messages }, null, 2)
          : [
              `# ${session.title}`,
              "",
              `- Workspace: ${session.workspacePath ?? "(none)"}`,
              `- Model: ${session.modelId ?? "(none)"}`,
              `- Agent: ${session.agentProfileId}`,
              "",
              ...messages.map((message) => {
                const text = message.parts
                  .filter(
                    (part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
                      part.type === "text",
                  )
                  .map((part) => part.text)
                  .join("\n\n");
                return `## ${message.role === "user" ? "User" : "Mingshen"}\n\n${text}`;
              }),
            ].join("\n\n");
      await writeFile(result.filePath, content, "utf8");
      return result.filePath;
    },
  );

  ipcMain.handle(IPC_CHANNELS.pluginHooksGet, () => {
    return requireServices().repository.getSetting("plugin.shellHooksEnabled") === true;
  });

  ipcMain.handle(IPC_CHANNELS.pluginHooksSet, (_event, enabled: boolean) => {
    requireServices().repository.setSetting("plugin.shellHooksEnabled", Boolean(enabled));
  });

  ipcMain.handle(
    IPC_CHANNELS.browserOpen,
    (_event, sessionId: string, provider: "chrome" | "edge", url?: string) => {
      return requireServices().browserService.open(sessionId, provider, url);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.browserRegisterWebContents,
    (event, sessionId: string, provider: "chrome" | "edge", webContentsId: number) => {
      if (webContents.fromId(webContentsId)?.hostWebContents?.id !== event.sender.id) {
        throw new Error("Browser guest does not belong to this application window.");
      }
      return requireServices().browserService.register(sessionId, provider, webContentsId);
    },
  );

  ipcMain.handle(IPC_CHANNELS.browserStatus, (_event, sessionId: string) => {
    return requireServices().browserService.getStatus(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.browserClose, (_event, sessionId: string) => {
    return requireServices().browserService.close(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.openExternalUrl, async (_event, value: string) => {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("只能使用 http 或 https 打开外部链接。");
    }
    await shell.openExternal(url.toString());
  });

  ipcMain.handle(
    IPC_CHANNELS.openLocalPath,
    async (_event, value: string, workspacePath?: string | null) => {
      const trimmed = value.trim().replace(/^file:\/\//i, "");
      if (!trimmed) {
        throw new Error("文件路径不能为空。");
      }
      if (/^(?:\\\\|\/\/|[a-z]:[^\\/])/i.test(trimmed) || trimmed.includes("\0")) {
        throw new Error("Network shares and device paths cannot be opened from chat links.");
      }
      const target = isAbsolute(trimmed)
        ? trimmed
        : resolve(workspacePath || app.getPath("documents"), trimmed);
      if (
        /\.(?:exe|com|bat|cmd|ps1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|cpl|hta|lnk|url|reg)$/i.test(
          target,
        )
      )
        throw new Error(
          "Executable files and shortcuts cannot be launched from chat links. Open them in the editor instead.",
        );
      try {
        await stat(target);
      } catch {
        const parent = dirname(target);
        const parentError = await shell.openPath(parent);
        if (parentError) {
          throw new Error(`文件不存在，且无法打开所在目录：${parentError}`);
        }
        return;
      }
      const error = await shell.openPath(target);
      if (error) {
        throw new Error(error);
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.githubConnectionStatus, () => {
    return requireServices().githubService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.githubSetToken, async (_event, token: string) => {
    const { githubService, mcpService } = requireServices();
    const status = await githubService.setToken(token);
    await mcpService.setGitHubToken(githubService.tokenForMcp());
    return status;
  });

  ipcMain.handle(IPC_CHANNELS.githubDeviceStart, async (_event, clientId: string) => {
    return await requireServices().githubService.startDeviceAuthorization(clientId);
  });
  ipcMain.handle(IPC_CHANNELS.githubDevicePending, () =>
    requireServices().githubService.getDeviceAuthorization(),
  );
  ipcMain.handle(IPC_CHANNELS.githubDevicePoll, async () => {
    const { githubService, mcpService } = requireServices();
    const result = await githubService.pollDeviceAuthorization();
    if (result.status === "connected") await mcpService.setGitHubToken(githubService.tokenForMcp());
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.githubDeviceCancel, () =>
    requireServices().githubService.cancelDeviceAuthorization(),
  );
  ipcMain.handle(IPC_CHANNELS.githubDisconnect, async () => {
    const { githubService, mcpService } = requireServices();
    await githubService.disconnect();
    await mcpService.setGitHubToken(null);
  });
}

if (!isExperimental && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName(
    isRawElectronDevelopment
      ? "Mingshen Harness Electron Dev"
      : isExperimental
        ? "Mingshen Harness Dev"
        : "Mingshen Harness",
  );
  if (commandDataDirectory || process.env.MSH_USER_DATA_DIR) {
    app.setPath("userData", resolve(commandDataDirectory || process.env.MSH_USER_DATA_DIR || ""));
  }
  runtimeLogs = new RuntimeLogService(join(app.getPath("userData"), "logs"), app.getVersion());
  installRuntimeLog(runtimeLogs);
  for (const method of ["error", "warn"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      runtimeLogs?.record(
        `main.console.${method}`,
        args
          .map((value) =>
            value instanceof Error
              ? value.stack || value.message
              : typeof value === "string"
                ? value
                : "[structured data omitted]",
          )
          .join(" "),
        {},
        method === "error" ? "error" : "warn",
      );
      original(...args);
    };
  }
  process.on("uncaughtExceptionMonitor", (cause) => runtimeLogs?.recordFatal(cause));
  process.on("unhandledRejection", (cause) => recordRuntimeError("main.promise", cause));
  app.on("child-process-gone", (_event, details) => {
    if (!["clean-exit", "killed"].includes(details.reason))
      recordRuntimeError("desktop.child-process", details.reason, {
        operation: details.type,
        code: String(details.exitCode),
      });
  });
  app.setAppUserModelId(windowAppId);
  if (process.platform === "win32")
    app.setToastActivatorCLSID(
      isRawElectronDevelopment
        ? "{AA95B15F-D62F-4520-9F99-46641AF7CDD2}"
        : isExperimental
          ? "{6094CEE7-98E1-4D01-97A6-68A726EBA51E}"
          : "{02CF7A95-99EA-4D76-B405-4D936CF3E809}",
    );

  if (!isExperimental) {
    app.on("second-instance", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        app.emit("activate");
        return;
      }

      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      mainWindow.show();
      mainWindow.focus();
    });
  }

  void app
    .whenReady()
    .then(async () => {
      if (
        process.platform === "win32" &&
        isDevelopment &&
        process.env.MSH_NOTIFICATION_FIXTURE !== "1"
      ) {
        const programs = join(
          app.getPath("appData"),
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs",
        );
        await mkdir(programs, { recursive: true });
        shell.writeShortcutLink(join(programs, `${app.getName()}.lnk`), "update", {
          target: process.execPath,
          args: `"${app.getAppPath()}"${isExperimental ? " --mingshen-experimental" : ""} "--mingshen-user-data=${app.getPath("userData")}"`,
          cwd: dirname(process.execPath),
          description: "Mingshen Harness",
          icon: isRawElectronDevelopment
            ? join(app.getAppPath(), "build", "icon.ico")
            : process.execPath,
          iconIndex: 0,
          appUserModelId: windowAppId,
          toastActivatorClsid: app.toastActivatorCLSID,
        }) ||
          shell.writeShortcutLink(join(programs, `${app.getName()}.lnk`), {
            target: process.execPath,
            args: `"${app.getAppPath()}"${isExperimental ? " --mingshen-experimental" : ""} "--mingshen-user-data=${app.getPath("userData")}"`,
            cwd: dirname(process.execPath),
            description: "Mingshen Harness",
            icon: isRawElectronDevelopment
              ? join(app.getAppPath(), "build", "icon.ico")
              : process.execPath,
            iconIndex: 0,
            appUserModelId: windowAppId,
            toastActivatorClsid: app.toastActivatorCLSID,
          });
      }
      services = createAppServices({
        databasePath: join(app.getPath("userData"), "mingshen.db"),
        extensionDirectory: join(app.getPath("userData"), "extensions"),
        userDataDirectory: app.getPath("userData"),
        promptDirectory: isPackagedBuild
          ? join(process.resourcesPath, "prompts")
          : join(app.getAppPath(), "resources", "prompts"),
        appVersion: app.getVersion(),
        emit: (event) => {
          try {
            completions?.handle(event);
          } catch (cause) {
            recordRuntimeError("notifications.lifecycle", cause);
            console.error(
              "Completion notification failed:",
              cause instanceof Error ? cause.message : String(cause),
            );
          }
          emitRuntimeEvent(event);
        },
        emitTerminal: (ownerId, event) => {
          const window = mainWindow;
          if (window && !window.isDestroyed() && window.webContents.id === ownerId) {
            window.webContents.send(IPC_CHANNELS.terminalEvent, event);
          }
        },
      });
      startupPresentation = new StartupPresentationController({
        readEnabled: () =>
          requireServices().repository.getSetting(STARTUP_PRESENTATION_SETTING_KEY),
        readLocale: () => requireServices().repository.getSetting("desktop.locale"),
        createSurface: createStartupSurface,
        onLatePresentation: () => {
          const window = mainWindow;
          if (!disposed && !disposal && window && !window.isDestroyed()) window.showInactive();
        },
        onPresentationShown: () => {
          scheduleStartupIndexWarmup({
            shouldRun: () =>
              !disposed &&
              !disposal &&
              startupPresentation?.isPresenting() === true &&
              desktop?.state().accepted === true,
            warm: () => services?.repository.warmStartupIndexes(),
          });
        },
      });
      startupPresentation.start();
      startupPresentation.setStage("services");
      companion = new CompanionController({
        repository: services.repository,
        createWindow: createCompanionWindow,
        getWorkArea: (point) =>
          (point ? screen.getDisplayNearestPoint(point) : screen.getPrimaryDisplay()).workArea,
        emitState: (state) => {
          if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send(COMPANION_IPC_CHANNELS.state, state);
        },
        onWindowFailure: (stage, detail) => recordRuntimeError(`companion.${stage}`, detail),
      });
      screen.on("display-added", () => companion?.refreshDisplayBounds());
      screen.on("display-removed", () => companion?.refreshDisplayBounds());
      screen.on("display-metrics-changed", () => companion?.refreshDisplayBounds());
      quickChat = new QuickChatController({
        repository: services.repository,
        sessionService: services.sessionService,
        context: (sessionId) => requireServices().chatService.restoreContext(sessionId),
        isBusy: (sessionId) => requireServices().chatService.isSessionBusy(sessionId),
        emit: emitRuntimeEvent,
      });
      registerIpcHandlers();
      startupPresentation.setStage("window");
      const initializeMainWindow = () => {
        const current = requireServices();
        const window = createMainWindow();
        mainWindow = window;
        const mainDesktop = new DesktopController(
          current.repository,
          window,
          isPackagedBuild
            ? join(process.resourcesPath, "docs")
            : join(app.getAppPath(), "..", "..", "docs"),
          isPackagedBuild
            ? join(process.resourcesPath, "icon.png")
            : join(app.getAppPath(), "build", "icon.png"),
          () => requireServices().chatService.activeConversationCount(),
          (sessionId, session) =>
            session.executionMode === "worktree"
              ? (requireServices().worktreeService.get(sessionId) ?? session.workspacePath)
              : session.workspacePath,
          () => void showQuickChat().catch((cause) => recordRuntimeError("quick-chat.show", cause)),
        );
        desktop = mainDesktop;
        if (!backgroundStarted) showEnabledCompanion();
        const openNotificationSession = (sessionId: string) => {
          completions?.setActiveSession(sessionId);
          desktop?.show();
          mainWindow?.webContents.send(IPC_CHANNELS.desktopEvent, {
            type: "select-session",
            sessionId,
          });
        };
        const approvalNotifications = new ApprovalNotifications(
          current.repository,
          window,
          isPackagedBuild
            ? join(process.resourcesPath, "icon.png")
            : join(app.getAppPath(), "build", "icon.png"),
          current.approvalBroker,
          (decision) => {
            if (!desktop?.state().accepted)
              throw new Error("Please accept the application policies before approving.");
            requireServices().chatService.decideApproval(decision);
          },
          openNotificationSession,
          (message) => completions?.reportError(message),
        );
        const questionNotifications = new QuestionNotifications(
          current.repository,
          window,
          isPackagedBuild
            ? join(process.resourcesPath, "icon.png")
            : join(app.getAppPath(), "build", "icon.png"),
          current.questionBroker,
          openNotificationSession,
          (message) => completions?.reportError(message),
        );
        const windowCompletions = new CompletionNotifications(
          current.repository,
          window,
          isPackagedBuild
            ? join(process.resourcesPath, "icon.png")
            : join(app.getAppPath(), "build", "icon.png"),
          (state) => mainWindow?.webContents.send(IPC_CHANNELS.completionEvent, state),
          openNotificationSession,
          (sessionId, text) => {
            if (!desktop?.state().accepted)
              throw new Error("Please accept the application policies before replying.");
            return requireServices().chatService.send({ sessionId, text });
          },
          approvalNotifications,
          questionNotifications,
        );
        completions = windowCompletions;
        const mainWindowWebContentsId = window.webContents.id;
        window.webContents.on("did-start-loading", () => {
          companionSessionNavigation.cancelSender(mainWindowWebContentsId);
        });
        window.on("closed", () => {
          companionSessionNavigation.cancelSender(mainWindowWebContentsId);
          void services?.terminalService
            .disposeOwner(mainWindowWebContentsId)
            .catch((cause) => recordRuntimeError("terminal.window-close", cause));
          windowCompletions.dispose();
          mainDesktop.dispose();
          if (mainWindow === window) mainWindow = null;
          if (desktop === mainDesktop) desktop = null;
          if (completions === windowCompletions) completions = null;
        });
      };
      initializeMainWindow();
      shortcuts = new DesktopShortcuts(
        globalShortcut,
        {
          quickChat: () =>
            void toggleQuickChat().catch((cause) => recordRuntimeError("quick-chat.toggle", cause)),
          toggleMain: () => {
            if (disposed || disposal) return;
            if (!mainWindow || mainWindow.isDestroyed()) initializeMainWindow();
            else desktop?.toggle();
          },
        },
        reportShortcutFailure,
        {
          load: () => requireServices().repository.getSetting("desktop.shortcuts"),
          persist: (settings) =>
            requireServices().repository.setSetting("desktop.shortcuts", settings),
        },
      );
      shortcuts.start();
      app.on("activate", () => {
        if (disposed || disposal) return;
        if (!mainWindow || mainWindow.isDestroyed()) initializeMainWindow();
        desktop?.show();
      });
    })
    .catch((cause) => {
      startupPresentation?.fail();
      companion?.dispose();
      companionSessionNavigation.dispose();
      recordRuntimeError("desktop.startup", cause);
      console.error("Application startup failed:", cause);
      completions?.dispose();
      shortcuts?.stop();
      updates?.stop();
      for (const window of applicationWindows()) {
        if (!window.isDestroyed()) window.destroy();
      }
      const startupServices = services;
      services = null;
      companion = null;
      quickChat = null;
      desktop = null;
      updates = null;
      dependencies = null;
      void settleWithin([startupServices?.dispose(), runtimeLogs?.flush()], 10_000)
        .then((result) => {
          if (result === "timed_out") {
            recordRuntimeError("desktop.startup-cleanup", "Startup cleanup exceeded 10 seconds.");
          }
        })
        .finally(() => {
          disposed = true;
          app.exit(1);
        });
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    if (disposed) return;
    event.preventDefault();
    if (disposal) return;
    cancelMainWindowStartupVisibility?.();
    for (const window of applicationWindows()) window.setEnabled(false);
    disposal = (async () => {
      try {
        await flushApplicationDrafts("shutdown");
      } catch (cause) {
        recordRuntimeError("desktop.draft-flush", cause);
        const error = cause instanceof Error ? cause.message : String(cause);
        updateInstaller = null;
        services?.chatService.cancelUpdatePreparation();
        updates?.cancelHandoff(error);
        for (const window of applicationWindows()) window.setEnabled(true);
        desktop?.cancelQuit();
        mainWindow?.webContents.send(IPC_CHANNELS.desktopEvent, {
          type: "composer-draft-error",
          error,
        });
        disposal = null;
        resumeMainWindowStartup?.();
        return;
      }
      completions?.dispose();
      shortcuts?.stop();
      updates?.stop();
      startupPresentation?.dispose();
      companion?.dispose();
      companionSessionNavigation.dispose();
      try {
        await Promise.all([services?.dispose(), updates?.shutdown()]);
        await runtimeLogs?.flush();
        if (updateInstaller) app.relaunch({ execPath: updateInstaller, args: [] });
      } catch (cause) {
        recordRuntimeError("desktop.shutdown", cause);
        console.error("Shutdown failed; automatic installer launch was blocked:", cause);
      } finally {
        disposed = true;
        services = null;
        app.quit();
      }
    })();
  });
  app.on("will-quit", () => shortcuts?.stop());
}
