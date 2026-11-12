import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { OpenDialogOptions } from "electron";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, webContents } from "electron";
import type { BootstrapData } from "../shared/domain";
import type { AppInfo } from "../shared/ipc";
import { IPC_CHANNELS } from "../shared/ipc";
import { localizeError } from "../shared/localized-errors";
import type { SessionBatchTarget } from "../shared/session-catalog";
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
import { CompletionNotifications } from "./desktop/completion-notifications";
import { flushComposerDrafts } from "./desktop/composer-draft-flush";
import { DesktopController } from "./desktop/desktop-controller";
import { reloadInterfaceWindow } from "./desktop/interface-reload";
import { QuestionNotifications } from "./desktop/question-notifications";
import { RuntimeDependencies } from "./desktop/runtime-dependencies";
import { UpdateService } from "./desktop/update-service";
import { createUpdateFetcher } from "./desktop/update-transport";
import {
  installRuntimeLog,
  RuntimeLogService,
  recordRuntimeError,
} from "./diagnostics/runtime-log";
import { ModelCatalogService } from "./providers/model-catalog-service";
import { createSessionBatchGuard } from "./sessions/session-batch-guard";

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
let services: AppServices | null = null;
let disposed = false;
let disposal: Promise<void> | null = null;
let desktop: DesktopController | null = null;
let updates: UpdateService | null = null;
let dependencies: RuntimeDependencies | null = null;
let backgroundStarted = false;
let completions: CompletionNotifications | null = null;
let runtimeLogs: RuntimeLogService | null = null;
let updateInstaller: string | null = null;

function startBackgroundServices(): void {
  if (backgroundStarted || !desktop?.state().accepted) return;
  backgroundStarted = true;
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
    window.show();
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("render-process-gone", (_event, details) =>
    recordRuntimeError("renderer.process", `Renderer process exited: ${details.reason}`, {
      code: String(details.exitCode),
    }),
  );
  window.webContents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
    if (mainFrame) recordRuntimeError("renderer.load", description, { code: String(code) });
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
    if (!/^persist:mingshen-(chrome|edge)$/.test(webPreferences.partition ?? "")) {
      event.preventDefault();
      return;
    }
    const source = params.src ?? "about:blank";
    if (source !== "about:blank" && !/^https?:\/\//i.test(source)) {
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
      if (url !== "about:blank" && !/^https?:\/\//i.test(url)) {
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
        await flushComposerDrafts(mainWindow, ipcMain, undefined, "save");
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
      const frame = event.senderFrame;
      const trusted =
        mainWindow &&
        event.sender.id === mainWindow.webContents.id &&
        frame === event.sender.mainFrame &&
        (process.env.ELECTRON_RENDERER_URL && isDevelopment
          ? frame.url.startsWith(`${new URL(process.env.ELECTRON_RENDERER_URL).origin}/`)
          : frame.url.split(/[?#]/)[0] ===
            pathToFileURL(join(__dirname, "../renderer/index.html")).href);
      if (!trusted) {
        recordRuntimeError("ipc.security", "Untrusted IPC sender", { operation: channel });
        throw new Error("Untrusted IPC sender");
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
  ipcMain.handle(IPC_CHANNELS.editCommand, (event, command: unknown) => {
    if (!mainWindow?.isFocused() || !event.sender.isFocused())
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
    await flushComposerDrafts(mainWindow, ipcMain, undefined, "interface-reload");
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
    return desktop.state();
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
  ipcMain.handle(IPC_CHANNELS.desktopAction, (_event, action, value, remember) => {
    if (!desktop) throw new Error("Application services are not ready.");
    return desktop.action(action, value, remember);
  });
  ipcMain.handle(IPC_CHANNELS.policyRead, (_event, document, locale) => {
    if (!desktop) throw new Error("Application services are not ready.");
    return desktop.policy(document, locale);
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
      const sessions = page ? page.sessions : current.repository.listSessions();
      if (options?.selectedId && !sessions.some((item) => item.id === options.selectedId)) {
        const selected = current.repository.getSession(options.selectedId);
        if (selected) sessions.push(selected);
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
  ipcMain.handle(IPC_CHANNELS.sessionGroups, () => requireServices().repository.sessionGroups());

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

  ipcMain.handle(IPC_CHANNELS.sessionCreate, (_event, input) => {
    return requireServices().sessionService.create(input);
  });

  ipcMain.handle(IPC_CHANNELS.sessionCreateInWorkspace, (_event, workspacePath: string | null) => {
    return requireServices().sessionService.createInWorkspace(workspacePath);
  });
  ipcMain.handle(IPC_CHANNELS.sessionOpenWorkspace, (_event, sessionId: string) => {
    if (!desktop) throw new Error("Application services are not ready.");
    return desktop.openSessionWorkspace(sessionId);
  });
  ipcMain.handle(IPC_CHANNELS.sessionFork, (_event, sessionId: string, messageId?: string) => {
    if (typeof sessionId !== "string" || (messageId !== undefined && typeof messageId !== "string"))
      throw new Error("Invalid session or message ID.");
    return requireServices().chatService.forkSession(sessionId, messageId);
  });

  ipcMain.handle(
    IPC_CHANNELS.sessionUpdate,
    async (_event, input, expected?: SessionBatchTarget[]) => {
      const current = requireServices();
      const isBusy = (id: string): boolean =>
        current.chatService.isSessionBusy(id) ||
        current.repository.listChildSessions(id).some((child) => isBusy(child.id));
      if (input.archived === true && isBusy(input.sessionId))
        throw new Error("请先停止会话及其子任务，再归档。");
      const session = current.repository.getSession(input.sessionId);
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
      await current.chatService.restoreContext(input.sessionId);
      return current.repository.getSession(input.sessionId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.sessionRemove,
    async (_event, sessionId: string, expected?: SessionBatchTarget[]) => {
      const current = requireServices();
      const guard = createSessionBatchGuard(current.repository, sessionId, expected);
      await current.chatService.removeSession(sessionId, guard);
      completions?.handle({ type: "session_removed", sessionId });
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
  ipcMain.handle(IPC_CHANNELS.composerDraftGet, (_event, sessionId: string) =>
    requireServices().repository.getComposerDraft(sessionId),
  );
  ipcMain.handle(IPC_CHANNELS.composerDraftSave, (_event, input) =>
    requireServices().repository.saveComposerDraft(input),
  );
  ipcMain.handle(IPC_CHANNELS.composerDraftClear, (_event, sessionId: string, revision: string) =>
    requireServices().repository.clearComposerDraft(sessionId, revision),
  );

  ipcMain.handle(IPC_CHANNELS.chatRewrite, (_event, input) => {
    return requireServices().chatService.rewriteAndSend(input);
  });

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

  ipcMain.handle(IPC_CHANNELS.extensionsList, () => {
    return requireServices().extensionService.list();
  });

  ipcMain.handle(IPC_CHANNELS.extensionsChooseDirectory, async (): Promise<string | null> => {
    const options: OpenDialogOptions = {
      title: "导入 Skills 或 Codex Plugin",
      buttonLabel: "导入此目录",
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
    (_event, workspacePath: string, trusted: boolean) => {
      requireServices().repository.setProjectTrusted(resolve(workspacePath), trusted);
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
      if (!mainWindow) {
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
            console.error(
              "Completion notification failed:",
              cause instanceof Error ? cause.message : String(cause),
            );
          }
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) {
              window.webContents.send(IPC_CHANNELS.runtimeEvent, event);
            }
          }
        },
      });
      registerIpcHandlers();
      mainWindow = createMainWindow();
      desktop = new DesktopController(
        services.repository,
        mainWindow,
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
      );
      const openNotificationSession = (sessionId: string) => {
        completions?.setActiveSession(sessionId);
        desktop?.show();
        mainWindow?.webContents.send(IPC_CHANNELS.desktopEvent, {
          type: "select-session",
          sessionId,
        });
      };
      const approvalNotifications = new ApprovalNotifications(
        services.repository,
        mainWindow,
        isPackagedBuild
          ? join(process.resourcesPath, "icon.png")
          : join(app.getAppPath(), "build", "icon.png"),
        services.approvalBroker,
        (decision) => {
          if (!desktop?.state().accepted)
            throw new Error("Please accept the application policies before approving.");
          requireServices().chatService.decideApproval(decision);
        },
        openNotificationSession,
        (message) => completions?.reportError(message),
      );
      const questionNotifications = new QuestionNotifications(
        services.repository,
        mainWindow,
        isPackagedBuild
          ? join(process.resourcesPath, "icon.png")
          : join(app.getAppPath(), "build", "icon.png"),
        services.questionBroker,
        openNotificationSession,
        (message) => completions?.reportError(message),
      );
      completions = new CompletionNotifications(
        services.repository,
        mainWindow,
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
      mainWindow.on("closed", () => {
        mainWindow = null;
      });

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createMainWindow();
        }
      });
    })
    .catch((cause) => {
      recordRuntimeError("desktop.startup", cause);
      console.error("Application startup failed:", cause);
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
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setEnabled(false);
    disposal = (async () => {
      try {
        await flushComposerDrafts(mainWindow, ipcMain);
      } catch (cause) {
        recordRuntimeError("desktop.draft-flush", cause);
        const error = cause instanceof Error ? cause.message : String(cause);
        updateInstaller = null;
        services?.chatService.cancelUpdatePreparation();
        updates?.cancelHandoff(error);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setEnabled(true);
        desktop?.cancelQuit();
        mainWindow?.webContents.send(IPC_CHANNELS.desktopEvent, {
          type: "composer-draft-error",
          error,
        });
        disposal = null;
        return;
      }
      completions?.dispose();
      updates?.stop();
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
}
