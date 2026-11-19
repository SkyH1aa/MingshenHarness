import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION, POLICY_VERSION } from "../../shared/release";
import type { Repository } from "../storage/repository";
import { DesktopController } from "./desktop-controller";

const mock = vi.hoisted(() => ({
  quit: vi.fn(),
  menu: vi.fn(),
  send: vi.fn(),
  openPath: vi.fn(async (_path: string) => ""),
}));
vi.mock("electron", () => ({
  app: { quit: mock.quit, on: vi.fn() },
  Menu: {
    buildFromTemplate: (template: unknown) => {
      mock.menu(template);
      return template;
    },
  },
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
  shell: { openExternal: vi.fn(), openPath: mock.openPath },
  Tray: class {
    setToolTip() {}
    on() {}
    setContextMenu() {}
    destroy() {}
    popUpContextMenu() {}
  },
}));
afterEach(() => vi.useRealTimers());
describe("Desktop consent and tray lifecycle", () => {
  it("toggles a focused main window to tray and restores a hidden or background window", () => {
    const window = Object.assign(new EventEmitter(), {
      webContents: { send: mock.send },
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      isVisible: vi.fn(() => true),
      isFocused: vi.fn(() => true),
      isMinimized: vi.fn(() => false),
    });
    const repository = { getSetting: () => null, listSessions: () => [] } as unknown as Repository;
    const controller = new DesktopController(
      repository,
      window as unknown as BrowserWindow,
      "docs",
      "icon.png",
    );
    controller.toggle();
    expect(window.hide).toHaveBeenCalledOnce();
    window.isFocused.mockReturnValue(false);
    controller.toggle();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    window.isMinimized.mockReturnValue(true);
    controller.toggle();
    expect(window.restore).toHaveBeenCalledOnce();
  });
  it("requires five seconds after policy opening and persists close preference", async () => {
    vi.useFakeTimers();
    const settings = new Map<string, unknown>();
    const repository = {
      getSetting: (key: string) => settings.get(key),
      setSetting: (key: string, value: unknown) => settings.set(key, value),
      listSessions: () =>
        Array.from({ length: 8 }, (_, i) => ({
          id: `session-${i}`,
          title: `Recent ${i}`,
          archived: i === 0,
        })),
      listScheduledTasks: () => [{ enabled: true }],
    } as unknown as Repository;
    const window = Object.assign(new EventEmitter(), {
      webContents: { send: mock.send },
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      isMinimized: () => false,
      isMaximized: () => false,
      close: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      minimize: vi.fn(),
    });
    const controller = new DesktopController(
      repository,
      window as unknown as BrowserWindow,
      resolve(process.cwd(), "..", "..", "docs"),
      "icon.png",
      () => 3,
    );
    const menu = mock.menu.mock.calls.at(-1)?.[0] as Array<{ label?: string; click?: () => void }>;
    expect(menu.filter((entry) => entry.label?.startsWith("Recent"))).toHaveLength(5);
    menu.find((entry) => entry.label === "Recent 1")?.click?.();
    expect(mock.send).toHaveBeenCalledWith("desktop:event", {
      type: "select-session",
      sessionId: "session-1",
    });
    const consent = { terms: true, privacy: true, disclaimer: true };
    await expect(controller.accept(consent)).rejects.toThrow("five seconds");
    const changelog = await controller.policy("changelog");
    expect(changelog).toContain("## 1.2.2");
    expect(changelog).toContain("## 1.2.1");
    expect(changelog).toContain(`## ${APP_VERSION}`);
    expect(await controller.policy("changelog", "en")).toContain("Changelog");
    const documentFiles = {
      terms: "TERMS_OF_SERVICE",
      privacy: "PRIVACY_POLICY",
      disclaimer: "DISCLAIMER",
    } as const;
    for (const document of ["terms", "privacy", "disclaimer"] as const) {
      const source = await readFile(
        resolve(process.cwd(), "..", "..", "docs", `${documentFiles[document]}.md`),
        "utf8",
      );
      expect(source).toContain(`协议修订号：${POLICY_VERSION}；当前适用软件版本：${APP_VERSION}`);
      expect(
        await readFile(
          resolve(process.cwd(), "..", "..", "docs", `${documentFiles[document]}.en.md`),
          "utf8",
        ),
      ).toContain(
        `Policy revision: ${POLICY_VERSION}. Current application version: ${APP_VERSION}.`,
      );
    }
    await controller.policy("manual");
    expect(await controller.policy("manual")).toContain(`适用版本：${APP_VERSION}`);
    expect(await controller.policy("manual", "en")).toContain(`Version ${APP_VERSION}`);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(controller.accept(consent)).rejects.toThrow("five seconds");
    await expect(controller.policy("../README" as "manual")).rejects.toThrow("Unknown document");
    const terms = await controller.policy("terms");
    expect(terms).toContain("我已阅读并同意服务协议");
    expect(terms).toContain("我已阅读并同意隐私政策");
    expect(terms).toContain("我已阅读并同意免责协议");
    expect(terms).toContain("完整阅读、理解并接受");
    expect(await controller.policy("terms", "en")).toContain("fully read, understood and accepted");
    await vi.advanceTimersByTimeAsync(4999);
    await expect(controller.accept(consent)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    await expect(controller.accept({ ...consent, disclaimer: false })).rejects.toThrow("all three");
    expect(await controller.policy("disclaimer")).toContain("免责协议");
    await controller.accept(consent);
    expect(controller.state().accepted).toBe(true);
    expect(controller.state().manualPending).toBe(true);
    await expect(controller.action("finish-onboarding")).rejects.toThrow("使用手册");
    await controller.policy("manual");
    await controller.action("finish-onboarding");
    expect(controller.state().manualPending).toBe(false);
    settings.set("legal.acceptedVersion", "2026-11-03.2");
    expect(controller.state().accepted).toBe(false);
    await controller.accept(consent);
    const event = { preventDefault: vi.fn() };
    window.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(mock.send).toHaveBeenCalledWith("desktop:event", {
      type: "close-request",
      tasks: 1,
      runningConversations: 3,
    });
    await controller.action("tray", undefined, true);
    expect(window.hide).toHaveBeenCalled();
    expect(controller.state().closeAction).toBe("tray");
    await controller.action("close-preference", "ask");
    expect(controller.state().closeAction).toBe("ask");
    await controller.action("quit");
    const closing = { preventDefault: vi.fn() };
    window.emit("close", closing);
    expect(closing.preventDefault).not.toHaveBeenCalled();
    controller.cancelQuit();
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    window.emit("close", closing);
    expect(closing.preventDefault).toHaveBeenCalledOnce();
  });
  it("requires all stored consents and resumes only an interrupted first-run guide", async () => {
    const settings = new Map<string, unknown>();
    const repository = {
      getSetting: (key: string) => settings.get(key),
      setSetting: (key: string, value: unknown) => settings.set(key, value),
      listSessions: () => [],
    } as unknown as Repository;
    const create = () =>
      new DesktopController(
        repository,
        Object.assign(new EventEmitter(), {
          webContents: { send: mock.send },
          isMaximized: () => false,
        }) as unknown as BrowserWindow,
        resolve(process.cwd(), "..", "..", "docs"),
        "icon.png",
      );
    expect(create().state().accepted).toBe(false);
    settings.set("legal.acceptedVersion", POLICY_VERSION);
    expect(create().state().accepted).toBe(false);
    settings.set("legal.consent", {
      terms: true,
      privacy: true,
      disclaimer: false,
      version: POLICY_VERSION,
    });
    expect(create().state().accepted).toBe(false);
    settings.set("legal.consent", {
      terms: true,
      privacy: true,
      disclaimer: true,
      version: POLICY_VERSION,
    });
    expect(create().state()).toMatchObject({ accepted: true, manualPending: false });
    settings.set("legal.manualPending", true);
    const restarted = create();
    expect(restarted.state()).toMatchObject({ accepted: true, manualPending: true });
    await restarted.policy("manual", "en");
    await restarted.action("finish-onboarding");
    expect(create().state()).toMatchObject({ accepted: true, manualPending: false });
  });
  it("opens only the stored conversation directory and reports invalid or inaccessible paths", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "mingshen-open-workspace-"));
    try {
      const workspace = resolve(root, "项目 folder.cmd");
      await mkdir(workspace);
      const file = resolve(root, "document.txt");
      await writeFile(file, "fixture");
      const paths = new Map<string, string | null>([
        ["valid", workspace],
        ["empty", null],
        ["relative", "relative-folder"],
        ["share", "\\\\server\\share"],
        ["device", "\\\\?\\C:\\Windows"],
        ["nul", `${workspace}\0`],
        ["missing", resolve(root, "missing")],
        ["file", file],
      ]);
      const repository = {
        getSetting: () => undefined,
        listSessions: () => [],
        getSession: (id: string) => (paths.has(id) ? { id, workspacePath: paths.get(id) } : null),
      } as unknown as Repository;
      const window = Object.assign(new EventEmitter(), {
        webContents: { send: mock.send },
      }) as unknown as BrowserWindow;
      const controller = new DesktopController(repository, window, root, "icon.png");
      mock.openPath.mockClear();
      await controller.openSessionWorkspace("valid");
      expect(mock.openPath).toHaveBeenCalledExactlyOnceWith(workspace);
      for (const id of [
        "",
        "unknown",
        "empty",
        "relative",
        "share",
        "device",
        "nul",
        "missing",
        "file",
      ])
        await expect(controller.openSessionWorkspace(id)).rejects.toThrow();
      expect(mock.openPath).toHaveBeenCalledTimes(1);
      mock.openPath.mockResolvedValueOnce("Windows refused to open folder");
      await expect(controller.openSessionWorkspace("valid")).rejects.toThrow(
        "无法打开工作目录：Windows refused to open folder",
      );
      const isolated = resolve(root, "worktree");
      await mkdir(isolated);
      const resolveWorkspace = vi.fn(() => isolated);
      const isolatedController = new DesktopController(
        repository,
        window,
        root,
        "icon.png",
        () => 0,
        resolveWorkspace,
      );
      await isolatedController.openSessionWorkspace("valid");
      expect(resolveWorkspace).toHaveBeenCalledWith("valid", {
        id: "valid",
        workspacePath: workspace,
      });
      expect(mock.openPath).toHaveBeenLastCalledWith(isolated);
    } finally {
      expect(root.startsWith(resolve(tmpdir()) + sep)).toBe(true);
      await rm(root, { recursive: true, force: true });
    }
  });
});
