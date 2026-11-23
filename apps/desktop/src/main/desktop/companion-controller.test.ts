import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent, SessionView } from "../../shared/domain";
import type { Repository } from "../storage/repository";
import {
  type CompanionBounds,
  CompanionController,
  type CompanionWindow,
  type CompanionWorkArea,
} from "./companion-controller";

class WebContentsFixture extends EventEmitter {
  readonly id = 41;
  readonly sent: unknown[] = [];
  isDestroyed() {
    return false;
  }
  send(_channel: string, state: unknown) {
    this.sent.push(state);
  }
}

class WindowFixture extends EventEmitter {
  readonly webContents = new WebContentsFixture();
  private destroyed = false;
  private visible = false;
  private minimized = false;
  private bounds: CompanionBounds;
  alwaysOnTop = false;
  alwaysOnTopCalls: Array<{ flag: boolean; level?: string }> = [];
  opacity = 1;
  showInactiveCalls = 0;
  restoreCalls = 0;
  moveTopCalls = 0;

  constructor(bounds: CompanionBounds) {
    super();
    this.bounds = { ...bounds };
  }

  isDestroyed() {
    return this.destroyed;
  }
  isVisible() {
    return this.visible;
  }
  isMinimized() {
    return this.minimized;
  }
  show() {
    this.visible = true;
    this.minimized = false;
    this.emit("show");
  }
  showInactive() {
    this.showInactiveCalls += 1;
    this.visible = true;
    this.minimized = false;
    this.emit("show");
  }
  hide() {
    this.visible = false;
    this.emit("hide");
  }
  minimize() {
    this.minimized = true;
    this.visible = false;
    this.emit("minimize");
  }
  systemHideWithoutWindowEvent() {
    this.minimized = true;
    this.visible = false;
  }
  restore() {
    this.restoreCalls += 1;
    this.minimized = false;
    this.emit("restore");
  }
  moveTop() {
    this.moveTopCalls += 1;
  }
  destroy() {
    this.destroyed = true;
    this.visible = false;
    this.minimized = false;
  }
  getBounds() {
    return { ...this.bounds };
  }
  setBounds(bounds: CompanionBounds) {
    this.bounds = { ...bounds };
  }
  setAlwaysOnTop(flag: boolean, level?: string) {
    this.alwaysOnTop = flag;
    this.alwaysOnTopCalls.push({ flag, ...(level ? { level } : {}) });
  }
  setOpacity(opacity: number) {
    this.opacity = opacity;
  }
  fire(event: "did-finish-load") {
    this.webContents.emit(event);
  }
}

type FixtureSession = { id: string; title: string; archived: boolean };

function fixture(
  stored?: unknown,
  options: {
    now?: () => number;
    random?: () => number;
    isReducedMotion?: () => boolean;
    getWorkArea?: (point?: { x: number; y: number }) => CompanionWorkArea;
    motionAvailable?: boolean;
    createWindow?: (bounds: CompanionBounds) => WindowFixture;
  } = {},
) {
  const settings = new Map<string, unknown>();
  if (stored !== undefined) settings.set("desktop.companion.preferences.v1", stored);
  let failNextWrite = false;
  const sessions = new Map<string, FixtureSession | null>();
  const getSession = vi.fn((id: string) =>
    sessions.has(id) ? (sessions.get(id) ?? null) : { id, title: "", archived: false },
  );
  const repository = {
    getSetting: (key: string) => settings.get(key) ?? null,
    getSession,
    setSetting: (key: string, value: unknown) => {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("fixture write failed");
      }
      settings.set(key, value);
    },
  } as unknown as Repository;
  const windows: WindowFixture[] = [];
  const controller = new CompanionController({
    repository,
    createWindow: (bounds) => {
      const window = options.createWindow?.(bounds) ?? new WindowFixture(bounds);
      windows.push(window);
      return window as unknown as CompanionWindow;
    },
    getWorkArea: options.getWorkArea ?? (() => ({ x: 0, y: 0, width: 1280, height: 800 })),
    ...(options.now ? { now: options.now } : {}),
    random: options.random ?? (() => 0),
    ...(options.isReducedMotion ? { isReducedMotion: options.isReducedMotion } : {}),
  });
  controller.setMotionAvailability(options.motionAvailable ?? true);
  return {
    controller,
    settings,
    windows,
    sessions,
    getSession,
    failNextWrite: () => {
      failNextWrite = true;
    },
  };
}

function event(input: ChatStreamEvent): ChatStreamEvent {
  return input;
}

describe("desktop companion controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows at the bottom-right and resets an explicit null position", async () => {
    const f = fixture();
    expect(f.controller.getState().visible).toBe(false);
    await f.controller.setPreferences({ enabled: true, greetingEnabled: false });
    const window = f.windows.at(0);
    expect(window).toBeDefined();
    if (!window) throw new Error("Companion window was not created.");
    expect(window.showInactiveCalls).toBe(1);
    expect(window.getBounds()).toMatchObject({ x: 1080, y: 600, width: 176, height: 176 });

    f.controller.action({ type: "drag", x: 120, y: 140 });
    expect(f.controller.getPreferences().position).toEqual({ x: 120, y: 140 });
    await f.controller.setPreferences({ position: null });
    expect(f.controller.getPreferences().position).toEqual({ x: 1080, y: 600 });
    expect(window.getBounds()).toMatchObject({ x: 1080, y: 600 });
    expect(f.settings.get("desktop.companion.preferences.v1")).toMatchObject({
      position: { x: 1080, y: 600 },
    });
    f.controller.dispose();
  });

  it("flushes a recently dragged position during dispose", () => {
    const f = fixture();
    f.controller.show();
    f.controller.action({ type: "drag", x: 200, y: 220 });
    f.controller.dispose();
    expect(f.settings.get("desktop.companion.preferences.v1")).toMatchObject({
      position: { x: 200, y: 220 },
    });
  });

  it("keeps a failed enable save retryable and shows after the retry succeeds", async () => {
    const f = fixture();
    f.failNextWrite();

    await expect(f.controller.setPreferences({ enabled: true })).rejects.toThrow("write failed");
    expect(f.controller.getPreferences().enabled).toBe(false);
    expect(f.controller.getState().visible).toBe(false);
    expect(f.windows).toHaveLength(0);

    await f.controller.setPreferences({ enabled: true });
    expect(f.controller.getPreferences().enabled).toBe(true);
    expect(f.controller.getState().visible).toBe(true);
    expect(f.windows.at(0)?.showInactiveCalls).toBe(1);
    f.controller.dispose();
  });

  it("retries an explicit enable after window creation fails", async () => {
    let failCreation = true;
    const f = fixture(undefined, {
      createWindow: (bounds) => {
        if (failCreation) {
          failCreation = false;
          throw new Error("fixture creation failed");
        }
        return new WindowFixture(bounds);
      },
    });

    await expect(f.controller.setPreferences({ enabled: true })).rejects.toThrow("creation failed");
    expect(f.controller.getPreferences().enabled).toBe(true);
    expect(f.controller.getState().visible).toBe(false);
    expect(f.windows).toHaveLength(0);

    await f.controller.setPreferences({ enabled: true });
    expect(f.controller.getState().visible).toBe(true);
    expect(f.windows).toHaveLength(1);
    expect(f.windows[0]?.showInactiveCalls).toBe(1);
    f.controller.dispose();
  });

  it("retries an explicit enable after showing the window fails", async () => {
    const f = fixture(undefined, {
      createWindow: (bounds) => {
        const window = new WindowFixture(bounds);
        vi.spyOn(window, "showInactive").mockImplementationOnce(() => {
          throw new Error("fixture show failed");
        });
        return window;
      },
    });

    await expect(f.controller.setPreferences({ enabled: true })).rejects.toThrow("show failed");
    expect(f.controller.getPreferences().enabled).toBe(true);
    expect(f.controller.getState().visible).toBe(false);
    expect(f.windows).toHaveLength(1);

    await f.controller.setPreferences({ enabled: true });
    expect(f.controller.getState().visible).toBe(true);
    expect(f.windows).toHaveLength(1);
    expect(f.windows[0]?.showInactiveCalls).toBe(1);
    f.controller.dispose();
  });

  it("does not reopen a temporarily hidden companion when changing other preferences", async () => {
    const f = fixture();
    await f.controller.setPreferences({ enabled: true });
    f.controller.hide();

    await f.controller.setPreferences({ size: 240 });
    expect(f.controller.getPreferences().enabled).toBe(true);
    expect(f.controller.getState().visible).toBe(false);
    expect(f.windows[0]?.showInactiveCalls).toBe(1);

    await f.controller.setPreferences({ enabled: true });
    expect(f.controller.getState().visible).toBe(true);
    expect(f.windows[0]?.showInactiveCalls).toBe(2);
    f.controller.dispose();
  });

  it("restores a pinned companion after the system hide/minimize pass without taking focus", async () => {
    const f = fixture();
    await f.controller.setPreferences({ enabled: true, alwaysOnTop: true });
    const window = f.windows[0];
    if (!window) throw new Error("Companion window was not created.");
    const expectedLevel = process.platform === "win32" ? "screen-saver" : "floating";
    expect(window.alwaysOnTopCalls.at(-1)).toEqual({ flag: true, level: expectedLevel });

    window.hide();
    window.minimize();
    expect(window.isVisible()).toBe(false);
    expect(window.restoreCalls).toBe(0);
    vi.advanceTimersByTime(119);
    expect(window.isVisible()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(window.isVisible()).toBe(true);
    expect(window.isMinimized()).toBe(false);
    expect(window.restoreCalls).toBe(1);
    expect(window.showInactiveCalls).toBe(2);
    expect(window.alwaysOnTopCalls.at(-1)).toEqual({ flag: true, level: expectedLevel });
    f.controller.dispose();
  });

  it.skipIf(process.platform !== "win32")(
    "polls for a Windows Shell hide even when Electron emits no hide/minimize event",
    async () => {
      const f = fixture();
      await f.controller.setPreferences({ enabled: true, alwaysOnTop: true });
      const window = f.windows[0];
      if (!window) throw new Error("Companion window was not created.");

      window.systemHideWithoutWindowEvent();
      vi.advanceTimersByTime(319);
      expect(window.isVisible()).toBe(false);
      vi.advanceTimersByTime(1);

      expect(window.isVisible()).toBe(true);
      expect(window.isMinimized()).toBe(false);
      expect(window.restoreCalls).toBe(1);
      expect(window.showInactiveCalls).toBe(2);

      f.controller.hide();
      vi.advanceTimersByTime(1_000);
      expect(window.isVisible()).toBe(false);
      expect(window.showInactiveCalls).toBe(2);
      f.controller.dispose();
    },
  );

  it.skipIf(process.platform !== "win32")(
    "reasserts the pinned z-order while visible even when no blur event fires",
    async () => {
      const f = fixture();
      await f.controller.setPreferences({ enabled: true, alwaysOnTop: true });
      const window = f.windows[0];
      if (!window) throw new Error("Companion window was not created.");
      const topmostCalls = window.alwaysOnTopCalls.length;
      const moveTopCalls = window.moveTopCalls;

      vi.advanceTimersByTime(200);

      expect(window.isVisible()).toBe(true);
      expect(window.alwaysOnTopCalls).toHaveLength(topmostCalls + 1);
      expect(window.moveTopCalls).toBe(moveTopCalls + 1);
      f.controller.dispose();
    },
  );

  it.skipIf(process.platform !== "win32")(
    "does not raise over its native menu and resumes pinning after it closes",
    async () => {
      const f = fixture();
      await f.controller.setPreferences({ enabled: true, alwaysOnTop: true });
      const window = f.windows[0];
      if (!window) throw new Error("Companion window was not created.");
      const topmostCalls = window.alwaysOnTopCalls.length;
      const moveTopCalls = window.moveTopCalls;

      f.controller.setNativeMenuOpen(true);
      vi.advanceTimersByTime(200);
      expect(window.alwaysOnTopCalls).toHaveLength(topmostCalls);
      expect(window.moveTopCalls).toBe(moveTopCalls);

      f.controller.setNativeMenuOpen(false);
      vi.advanceTimersByTime(200);
      expect(window.alwaysOnTopCalls).toHaveLength(topmostCalls + 1);
      expect(window.moveTopCalls).toBe(moveTopCalls + 1);
      f.controller.dispose();
    },
  );

  it("reasserts the pinned z-order when the companion loses focus", async () => {
    const f = fixture();
    await f.controller.setPreferences({ enabled: true, alwaysOnTop: true });
    const window = f.windows[0];
    if (!window) throw new Error("Companion window was not created.");
    const topmostCalls = window.alwaysOnTopCalls.length;
    const moveTopCalls = window.moveTopCalls;

    window.emit("blur");

    expect(window.alwaysOnTopCalls).toHaveLength(topmostCalls + 1);
    expect(window.alwaysOnTopCalls.at(-1)).toEqual({
      flag: true,
      level: process.platform === "win32" ? "screen-saver" : "floating",
    });
    expect(window.moveTopCalls).toBe(moveTopCalls + 1);
    f.controller.dispose();
  });

  it("does not restore after the user hides, disables pinning, or closes the companion", async () => {
    const f = fixture();
    await f.controller.setPreferences({ enabled: true, alwaysOnTop: true });
    const window = f.windows[0];
    if (!window) throw new Error("Companion window was not created.");

    window.minimize();
    await f.controller.setPreferences({ alwaysOnTop: false });
    vi.advanceTimersByTime(200);
    expect(window.isVisible()).toBe(false);
    expect(window.showInactiveCalls).toBe(1);

    await f.controller.setPreferences({ alwaysOnTop: true });
    window.minimize();
    f.controller.hide();
    vi.advanceTimersByTime(200);
    expect(window.isVisible()).toBe(false);
    expect(window.showInactiveCalls).toBe(1);

    f.controller.show();
    window.minimize();
    window.emit("close", { preventDefault: vi.fn() });
    vi.advanceTimersByTime(200);
    expect(window.isVisible()).toBe(false);
    expect(window.showInactiveCalls).toBe(2);
    f.controller.dispose();
  });

  it("cancels a pending system restore when the controller is disposed", async () => {
    const f = fixture();
    await f.controller.setPreferences({ enabled: true, alwaysOnTop: true });
    const window = f.windows[0];
    if (!window) throw new Error("Companion window was not created.");
    window.minimize();

    f.controller.dispose();
    vi.advanceTimersByTime(200);
    expect(window.isVisible()).toBe(false);
    expect(window.showInactiveCalls).toBe(1);
  });

  it("keeps a failed show save disabled until a successful retry persists it", () => {
    const f = fixture();
    f.failNextWrite();

    expect(() => f.controller.show()).toThrow("write failed");
    expect(f.controller.getPreferences().enabled).toBe(false);
    expect(f.controller.getState().visible).toBe(false);
    expect(f.windows).toHaveLength(0);

    f.controller.show();
    expect(f.controller.getPreferences().enabled).toBe(true);
    expect(f.controller.getState().visible).toBe(true);
    expect(f.settings.get("desktop.companion.preferences.v1")).toMatchObject({ enabled: true });
    f.controller.dispose();
  });

  it("returns greeting and completion moods to idle", () => {
    const f = fixture();
    f.controller.show();
    expect(f.controller.getState().mood).toBe("greeting");
    vi.advanceTimersByTime(4_000);
    expect(f.controller.getState().mood).toBe("idle");

    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    f.controller.handleChatEvent(event({ type: "run_completed", sessionId: "s", runId: "r" }));
    expect(f.controller.getState().mood).toBe("success");
    vi.advanceTimersByTime(4_000);
    expect(f.controller.getState().mood).toBe("idle");
    f.controller.dispose();
  });

  it("returns a pat to idle after four seconds when greetings are disabled", async () => {
    const f = fixture();
    await f.controller.setPreferences({ enabled: true, greetingEnabled: false });
    expect(f.controller.getState().mood).toBe("idle");

    f.controller.action({ type: "pat" });
    expect(f.controller.getState().mood).toBe("greeting");
    expect(f.controller.getState().message).toBeNull();

    vi.advanceTimersByTime(4_000);
    expect(f.controller.getState().mood).toBe("idle");
    expect(f.controller.getState().message).toBeNull();
    f.controller.dispose();
  });

  it("preserves the active task mood when hidden and shown again", () => {
    const f = fixture();
    f.controller.show();
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    f.controller.hide();
    expect(f.controller.getState().visible).toBe(false);
    f.controller.show();
    expect(f.controller.getState().mood).toBe("thinking");
    f.controller.dispose();
  });

  it("clears and restores task hints when the preference changes", async () => {
    const f = fixture();
    f.controller.show();
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    expect(f.controller.getState().message).toBe("我开始处理了。");
    await f.controller.setPreferences({ taskHintsEnabled: false });
    expect(f.controller.getState().message).toBeNull();
    await f.controller.setPreferences({ taskHintsEnabled: true });
    expect(f.controller.getState().message).toBe("我开始处理了。");
    f.controller.dispose();
  });

  it("publishes locale changes for greetings without changing motion or restarting timers", () => {
    const f = fixture();
    f.controller.show();
    const before = f.controller.interact("nod");
    const window = f.windows.at(0);
    if (!window) throw new Error("Companion window was not created.");
    const previousSends = window.webContents.sent.length;

    f.settings.set("desktop.locale", "en");
    f.controller.refreshLocale();
    expect(window.webContents.sent).toHaveLength(previousSends + 1);
    expect(window.webContents.sent.at(-1)).toMatchObject({
      locale: "en",
      mood: before.mood,
      tasks: before.tasks,
      motionRequest: before.motionRequest,
      message: "Hello, I am here.",
    });
    vi.advanceTimersByTime(3_000);
    f.settings.set("desktop.locale", "zh");
    f.controller.refreshLocale();
    expect(f.controller.getState().message).toBe("你好，我在这里。");
    vi.advanceTimersByTime(1_000);
    expect(f.controller.getState().mood).toBe("idle");

    f.controller.action({ type: "pat" });
    f.settings.set("desktop.locale", "en");
    f.controller.refreshLocale();
    expect(f.controller.getState().message).toBe("I am here. Take your time.");
    f.controller.dispose();
  });

  it("updates locale through manual sleep and failure overlays without modifying active tasks", async () => {
    const f = fixture();
    f.controller.show();
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    const before = f.controller.interact("sleep");
    f.settings.set("desktop.locale", "en");
    f.controller.refreshLocale();
    expect(f.controller.getState()).toMatchObject({
      locale: "en",
      mood: before.mood,
      tasks: before.tasks,
      manualSleeping: true,
      message: "Taking a break.",
    });

    f.controller.reportMenuFailure();
    f.settings.set("desktop.locale", "zh");
    f.controller.refreshLocale();
    expect(f.controller.getState()).toMatchObject({
      mood: before.mood,
      tasks: before.tasks,
      manualSleeping: true,
      message: "操作未完成，请重试或打开设置。",
    });
    f.settings.set("desktop.locale", "en");
    f.controller.refreshLocale();
    f.controller.interact("wake");
    vi.advanceTimersByTime(4_000);
    expect(f.controller.getState()).toMatchObject({
      mood: "thinking",
      tasks: before.tasks,
      manualSleeping: false,
      message: "I am getting started.",
    });
    await f.controller.setPreferences({ taskHintsEnabled: false });
    f.settings.set("desktop.locale", "zh");
    f.controller.refreshLocale();
    expect(f.controller.getState().message).toBeNull();
    f.controller.dispose();
  });

  it("preserves the selected chatter and rest state when switching locales", async () => {
    const chatter = fixture();
    await chatter.controller.setPreferences({
      enabled: true,
      greetingEnabled: false,
      chattiness: "high",
      restAfterMinutes: 0,
    });
    vi.advanceTimersByTime(15 * 60_000);
    expect(chatter.controller.getState().message).toBe("记得起来活动一下。");
    chatter.settings.set("desktop.locale", "en");
    chatter.controller.refreshLocale();
    expect(chatter.controller.getState()).toMatchObject({
      mood: "greeting",
      message: "Remember to stretch a little.",
    });
    chatter.controller.dispose();

    const resting = fixture();
    await resting.controller.setPreferences({
      enabled: true,
      greetingEnabled: false,
      chattiness: "off",
      restAfterMinutes: 1,
    });
    vi.advanceTimersByTime(60_000);
    const before = resting.controller.getState();
    resting.settings.set("desktop.locale", "en");
    resting.controller.refreshLocale();
    expect(resting.controller.getState()).toMatchObject({
      mood: before.mood,
      tasks: before.tasks,
      manualSleeping: before.manualSleeping,
      message: "I am taking a quiet break.",
    });
    await resting.controller.setPreferences({ taskHintsEnabled: false });
    resting.settings.set("desktop.locale", "zh");
    resting.controller.refreshLocale();
    expect(resting.controller.getState().message).toBeNull();
    resting.controller.dispose();
  });

  it("restores working state after an approval or question is resolved", () => {
    const f = fixture();
    f.controller.show();
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    f.controller.handleChatEvent(
      event({
        type: "approval_required",
        sessionId: "s",
        runId: "r",
        approval: {
          id: "approval",
          sessionId: "s",
          runId: "r",
          toolCallId: "call",
          toolName: "read_file",
          summary: "Read a file",
          detail: "fixture",
          pathScope: "C:\\fixture",
          commandPrefix: null,
          risk: "normal",
          createdAt: new Date().toISOString(),
        },
      }),
    );
    expect(f.controller.getState().mood).toBe("waiting");
    expect(f.controller.getState().tasks).toMatchObject([{ status: "waiting" }]);
    f.controller.handleChatEvent(
      event({ type: "approval_state", state: { revision: 1, requests: [] } }),
    );
    expect(f.controller.getState().mood).toBe("working");
    expect(f.controller.getState().tasks).toMatchObject([{ status: "working" }]);

    f.controller.handleChatEvent(
      event({
        type: "question_required",
        sessionId: "s",
        runId: "r",
        question: {
          id: "question",
          sessionId: "s",
          runId: "r",
          kind: "agent",
          header: "Need input",
          question: "Continue?",
          options: [],
          multiSelect: false,
          questions: [],
          createdAt: new Date().toISOString(),
        },
      }),
    );
    f.controller.handleChatEvent(
      event({ type: "question_resolved", sessionId: "s", questionId: "question" }),
    );
    expect(f.controller.getState().mood).toBe("working");
    f.controller.dispose();
  });

  it("does not let rest timer override an active run", async () => {
    const f = fixture();
    await f.controller.setPreferences({
      enabled: true,
      greetingEnabled: false,
      restAfterMinutes: 1,
    });
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    vi.advanceTimersByTime(60_000);
    expect(f.controller.getState().mood).toBe("thinking");
    f.controller.dispose();
  });

  it("keeps the waiting message consistent while other tasks start, work, or finish", () => {
    const f = fixture();
    f.controller.show();
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s1", runId: "r1" }));
    f.controller.handleChatEvent(
      event({
        type: "approval_state",
        state: {
          revision: 1,
          requests: [
            {
              id: "approval",
              sessionId: "s1",
              runId: "r1",
              toolCallId: "call",
              toolName: "read_file",
              summary: "Read a file",
              detail: "fixture",
              pathScope: "C:\\fixture",
              commandPrefix: null,
              risk: "normal",
              createdAt: new Date().toISOString(),
            },
          ],
        },
      }),
    );
    const waiting = { mood: "waiting", message: "需要你确认一下。" };
    expect(f.controller.getState()).toMatchObject(waiting);
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s2", runId: "r2" }));
    expect(f.controller.getState()).toMatchObject(waiting);
    f.controller.handleChatEvent(
      event({
        type: "activity",
        activity: {
          id: "activity",
          sessionId: "s2",
          runId: "r2",
          toolName: "read_file",
          kind: "read",
          title: "Read",
          detail: "private",
          status: "running",
          startedAt: new Date().toISOString(),
          completedAt: null,
          durationMs: null,
          fileChange: null,
        },
      }),
    );
    expect(f.controller.getState()).toMatchObject(waiting);
    f.controller.handleChatEvent(event({ type: "run_completed", sessionId: "s2", runId: "r2" }));
    expect(f.controller.getState()).toMatchObject(waiting);
    f.controller.hide();
    expect(f.controller.show()).toMatchObject(waiting);
    f.controller.handleChatEvent(
      event({ type: "approval_state", state: { revision: 2, requests: [] } }),
    );
    expect(f.controller.getState()).toMatchObject({
      mood: "working",
      message: "正在处理任务。",
      tasks: [{ sessionId: "s1", runId: "r1", status: "working" }],
    });
    f.controller.dispose();
  });

  it("tracks concurrent task identities without exposing event content or resurrecting finished runs", () => {
    const f = fixture();
    f.controller.show();
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "a:b", runId: "c" }));
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "a", runId: "b:c" }));
    expect(f.controller.getState().tasks).toMatchObject([
      { sessionId: "a:b", runId: "c", status: "thinking" },
      { sessionId: "a", runId: "b:c", status: "thinking" },
    ]);

    f.controller.handleChatEvent(
      event({
        type: "run_failed",
        sessionId: "a:b",
        runId: "c",
        error: "private error and C:\\private\\path",
      }),
    );
    expect(f.controller.getState().tasks).toMatchObject([
      { sessionId: "a", runId: "b:c", status: "thinking" },
    ]);
    expect(f.controller.getState().mood).toBe("thinking");
    expect(JSON.stringify(f.controller.getState())).not.toContain("private");

    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "a:b", runId: "c" }));
    f.controller.handleChatEvent(event({ type: "run_completed", sessionId: "a:b", runId: "c" }));
    expect(f.controller.getState().tasks).toHaveLength(1);
    expect(f.controller.getState().mood).toBe("thinking");
    f.controller.dispose();
  });

  it("aggregates concurrent runs by session with waiting status taking priority", () => {
    const f = fixture();
    f.sessions.set("shared", { id: "shared", title: "Review", archived: false });
    f.controller.show();
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "shared", runId: "r1" }));
    vi.advanceTimersByTime(100);
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "shared", runId: "r2" }));
    f.controller.handleChatEvent(
      event({
        type: "approval_required",
        sessionId: "shared",
        runId: "r2",
        approval: {
          id: "approval",
          sessionId: "shared",
          runId: "r2",
          toolCallId: "call",
          toolName: "read_file",
          summary: "Read",
          detail: "private detail",
          pathScope: "C:\\private",
          commandPrefix: null,
          risk: "normal",
          createdAt: new Date().toISOString(),
        },
      }),
    );
    expect(f.controller.getState().tasks).toMatchObject([
      { sessionId: "shared", title: "Review", status: "waiting" },
    ]);
    expect(f.controller.getState().tasks).toHaveLength(1);
    f.controller.handleChatEvent(
      event({ type: "run_interrupted", sessionId: "shared", runId: "r1" }),
    );
    expect(f.controller.getState().tasks).toMatchObject([{ status: "waiting" }]);
    f.controller.handleChatEvent(
      event({ type: "run_completed", sessionId: "shared", runId: "r2" }),
    );
    expect(f.controller.getState().tasks).toEqual([]);
    expect(f.controller.getState().taskPanelOpen).toBe(false);
    f.controller.dispose();
  });

  it("sorts aggregated sessions by status, then start time, preserving ties", () => {
    let now = 0;
    const f = fixture(undefined, { now: () => now });
    f.controller.show();
    const start = (sessionId: string, runId = "run") =>
      f.controller.handleChatEvent(event({ type: "run_started", sessionId, runId }));
    const question = (sessionId: string, runId: string) => {
      const id = `${sessionId}-${runId}`;
      f.controller.handleChatEvent(
        event({
          type: "question_required",
          sessionId,
          runId,
          question: {
            id,
            sessionId,
            runId,
            kind: "agent",
            header: "Input",
            question: "Continue?",
            options: [],
            multiSelect: false,
            questions: [],
            createdAt: new Date().toISOString(),
          },
        }),
      );
      return id;
    };

    start("thinking");
    now = 2;
    start("working-later");
    const workingQuestion = question("working-later", "run");
    f.controller.handleChatEvent(
      event({ type: "question_resolved", sessionId: "working-later", questionId: workingQuestion }),
    );
    now = 3;
    start("shared", "first");
    start("waiting-tie");
    question("waiting-tie", "run");
    now = 4;
    start("working-even-later");
    const anotherQuestion = question("working-even-later", "run");
    f.controller.handleChatEvent(
      event({
        type: "question_resolved",
        sessionId: "working-even-later",
        questionId: anotherQuestion,
      }),
    );
    now = 5;
    start("waiting-later");
    question("waiting-later", "run");
    now = 6;
    start("shared", "second");
    question("shared", "second");

    expect(
      f.controller.getState().tasks.map(({ sessionId, status, startedAt }) => ({
        sessionId,
        status,
        startedAt,
      })),
    ).toEqual([
      { sessionId: "shared", status: "waiting", startedAt: 3 },
      { sessionId: "waiting-tie", status: "waiting", startedAt: 3 },
      { sessionId: "waiting-later", status: "waiting", startedAt: 5 },
      { sessionId: "working-later", status: "working", startedAt: 2 },
      { sessionId: "working-even-later", status: "working", startedAt: 4 },
      { sessionId: "thinking", status: "thinking", startedAt: 0 },
    ]);
    f.controller.dispose();
  });

  it("updates sanitized titles from the repository and withholds them from IPC when disabled", async () => {
    const f = fixture();
    f.sessions.set("s", { id: "s", title: "Initial\nbrief", archived: false });
    f.controller.show();
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    expect(f.controller.getState().tasks[0]?.title).toBe("Initial brief");

    const changedTitle = `Confidential\u0000${"字".repeat(90)}`;
    f.sessions.set("s", { id: "s", title: changedTitle, archived: false });
    f.controller.handleChatEvent(
      event({
        type: "session_updated",
        session: { id: "s", title: "untrusted event" } as SessionView,
      }),
    );
    const title = f.controller.getState().tasks[0]?.title;
    expect(title).toMatch(/^Confidential 字+…$/u);
    expect(Array.from(title ?? "")).toHaveLength(80);
    expect(title).not.toContain("untrusted event");

    await f.controller.setPreferences({ showSessionTitles: false });
    const latestIpcState = f.windows[0]?.webContents.sent.at(-1);
    expect(f.controller.getState().tasks[0]?.title).toBeNull();
    expect(latestIpcState).toMatchObject({ tasks: [{ sessionId: "s", title: null }] });
    expect(JSON.stringify(latestIpcState)).not.toContain("Confidential");

    f.sessions.set("s", { id: "s", title: "Renamed privately", archived: false });
    f.controller.handleChatEvent(
      event({ type: "session_updated", session: { id: "s" } as SessionView }),
    );
    expect(JSON.stringify(f.windows[0]?.webContents.sent.at(-1))).not.toContain(
      "Renamed privately",
    );
    await f.controller.setPreferences({ showSessionTitles: true });
    expect(f.controller.getState().tasks[0]?.title).toBe("Renamed privately");
    f.controller.dispose();
  });

  it("rejects stale, archived and unknown session navigation and drops deleted tasks", () => {
    const f = fixture();
    expect(f.controller.isTrustedSender(41)).toBe(false);
    f.sessions.set("archived", { id: "archived", title: "Archive", archived: true });
    f.sessions.set("missing", null);
    f.controller.show();
    expect(f.controller.isTrustedSender(41)).toBe(true);
    expect(f.controller.isTrustedSender(42)).toBe(false);
    for (const sessionId of ["archived", "missing", "active"]) {
      f.controller.handleChatEvent(
        event({ type: "run_started", sessionId, runId: `run-${sessionId}` }),
      );
    }
    expect(f.controller.getState().tasks).toMatchObject([{ sessionId: "active" }]);
    expect(f.controller.getState().tasks).toHaveLength(1);
    expect(f.controller.canOpenSession("active")).toBe(true);
    for (const invalid of [null, 42, {}, "", "missing", "archived"]) {
      expect(f.controller.canOpenSession(invalid)).toBe(false);
    }

    f.sessions.set("active", { id: "active", title: "Archived", archived: true });
    expect(f.controller.canOpenSession("active")).toBe(false);
    f.controller.handleChatEvent(
      event({ type: "session_updated", session: { id: "active" } as SessionView }),
    );
    expect(f.controller.getState()).toMatchObject({ tasks: [], taskPanelOpen: false });
    f.sessions.set("active", { id: "active", title: "Restored", archived: false });
    f.controller.handleChatEvent(
      event({ type: "run_started", sessionId: "active", runId: "next" }),
    );
    expect(f.controller.canOpenSession("active")).toBe(true);
    f.sessions.set("active", null);
    f.controller.handleChatEvent(event({ type: "session_removed", sessionId: "active" }));
    expect(f.controller.canOpenSession("active")).toBe(false);
    expect(f.controller.getState()).toMatchObject({ tasks: [], taskPanelOpen: false });
    f.controller.dispose();
    expect(f.controller.isTrustedSender(41)).toBe(false);
  });

  it("expands and collapses task geometry without persisting the panel offset", async () => {
    const f = fixture({ enabled: true, greetingEnabled: false, position: { x: 500, y: 300 } });
    f.controller.show();
    const window = f.windows[0];
    if (!window) throw new Error("Companion window was not created.");
    const collapsed = window.getBounds();
    expect(collapsed).toEqual({ x: 500, y: 300, width: 176, height: 176 });
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    const expanded = window.getBounds();
    expect(f.controller.getState().taskPanelOpen).toBe(true);
    expect(expanded.width).toBeGreaterThanOrEqual(collapsed.width);
    expect(expanded.height).toBeGreaterThan(collapsed.height);
    expect(expanded.x + expanded.width - collapsed.width).toBe(collapsed.x);
    expect(expanded.y).toBe(collapsed.y);
    window.emit("move");
    expect(f.controller.getPreferences().position).toEqual({ x: 500, y: 300 });

    f.controller.action({ type: "task-panel", open: false });
    window.emit("move");
    expect(window.getBounds()).toEqual(collapsed);
    expect(f.controller.getPreferences().position).toEqual({ x: 500, y: 300 });
    f.controller.action({ type: "task-panel", open: true });
    await f.controller.setPreferences({ taskPanelEnabled: false });
    expect(window.getBounds()).toEqual(collapsed);
    expect(f.controller.getState().taskPanelOpen).toBe(false);
    f.controller.dispose();
  });

  it("restores the saved position after task panel clamping at a work area edge", () => {
    const f = fixture({ enabled: true, greetingEnabled: false, position: { x: 1080, y: 600 } });
    f.controller.show();
    const window = f.windows[0];
    if (!window) throw new Error("Companion window was not created.");
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    const expanded = window.getBounds();
    expect(expanded.x).toBeGreaterThanOrEqual(0);
    expect(expanded.y).toBeGreaterThanOrEqual(0);
    expect(expanded.x + expanded.width).toBeLessThanOrEqual(1280);
    expect(expanded.y + expanded.height).toBeLessThanOrEqual(800);
    window.emit("move");
    expect(f.controller.getPreferences().position).toEqual({ x: 1080, y: 600 });
    f.controller.action({ type: "task-panel", open: false });
    expect(window.getBounds()).toEqual({ x: 1080, y: 600, width: 176, height: 176 });
    f.controller.dispose();
  });

  it("persists the avatar position rather than the expanded window origin after dragging", async () => {
    const f = fixture({ enabled: true, greetingEnabled: false, position: { x: 500, y: 300 } });
    f.controller.show();
    const window = f.windows[0];
    if (!window) throw new Error("Companion window was not created.");
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    const before = window.getBounds();
    f.controller.action({ type: "drag-start" });
    f.controller.action({ type: "drag", x: before.x - 100, y: before.y - 50 });
    f.controller.action({ type: "drag-end" });
    window.emit("move");
    expect(f.controller.getPreferences().position).toEqual({ x: 400, y: 250 });
    vi.advanceTimersByTime(250);
    expect(f.settings.get("desktop.companion.preferences.v1")).toMatchObject({
      position: { x: 400, y: 250 },
    });
    f.controller.action({ type: "task-panel", open: false });
    expect(window.getBounds()).toEqual({ x: 400, y: 250, width: 176, height: 176 });
    f.controller.action({ type: "task-panel", open: true });
    await f.controller.setPreferences({ size: 320, positionLocked: true });
    expect(f.controller.getPreferences().position).toEqual({ x: 400, y: 250 });
    const lockedBounds = window.getBounds();
    f.controller.action({ type: "drag", x: 1, y: 1 });
    expect(window.getBounds()).toEqual(lockedBounds);
    f.controller.hide();
    f.controller.show();
    expect(f.controller.getState()).toMatchObject({
      taskPanelOpen: true,
      tasks: [{ sessionId: "s" }],
    });
    f.controller.action({ type: "task-panel", open: false });
    expect(window.getBounds()).toEqual({ x: 400, y: 250, width: 320, height: 320 });
    f.controller.dispose();
  });

  it("keeps task panel bounds inside a negative-coordinate monitor and restores the anchor", () => {
    const area = { x: -1600, y: -100, width: 1600, height: 1000 };
    const position = { x: -900, y: 120 };
    const f = fixture(
      { enabled: true, greetingEnabled: false, position },
      { getWorkArea: () => area },
    );
    f.controller.show();
    const window = f.windows[0];
    if (!window) throw new Error("Companion window was not created.");
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    const bounds = window.getBounds();
    expect(bounds.x).toBeGreaterThanOrEqual(area.x);
    expect(bounds.y).toBeGreaterThanOrEqual(area.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
    window.emit("move");
    expect(f.controller.getPreferences().position).toEqual(position);
    f.controller.handleChatEvent(event({ type: "run_completed", sessionId: "s", runId: "r" }));
    expect(window.getBounds()).toEqual({ ...position, width: 176, height: 176 });
    f.controller.dispose();
  });

  it("fits a small work area without changing the stored size and restores the larger layout", () => {
    let area = { x: -400, y: 20, width: 240, height: 280 };
    const position = { x: -200, y: 120 };
    const f = fixture(
      { enabled: true, greetingEnabled: false, size: 320, position },
      { getWorkArea: () => area },
    );
    f.controller.show();
    const window = f.windows[0];
    if (!window) throw new Error("Companion window was not created.");
    expect(f.controller.getState().layout).toEqual({ avatarSize: 240, panelHeight: 0 });
    expect(window.getBounds().width).toBe(240);
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    expect(f.controller.getState().layout).toEqual({ avatarSize: 168, panelHeight: 112 });
    expect(window.getBounds()).toEqual({ x: -400, y: 20, width: 240, height: 280 });
    window.emit("move");
    expect(f.controller.getPreferences()).toMatchObject({ size: 320, position });

    area = { x: -400, y: 20, width: 1280, height: 800 };
    f.controller.refreshDisplayBounds();
    expect(f.controller.getState().layout).toEqual({ avatarSize: 320, panelHeight: 144 });
    expect(window.getBounds()).toEqual({ x: -200, y: 120, width: 320, height: 464 });
    expect(f.controller.getPreferences()).toMatchObject({ size: 320, position });
    f.controller.dispose();
  });

  it("keeps bounds on screen when dragging between different work area sizes", () => {
    const small = { x: -400, y: 0, width: 240, height: 280 };
    const large = { x: 0, y: 0, width: 1280, height: 800 };
    const f = fixture(
      { enabled: true, greetingEnabled: false, size: 320, position: { x: -300, y: 10 } },
      { getWorkArea: (point) => (point && point.x < 0 ? small : large) },
    );
    f.controller.show();
    const window = f.windows[0];
    if (!window) throw new Error("Companion window was not created.");
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    f.controller.action({ type: "drag", x: 100, y: 120 });
    expect(window.getBounds()).toEqual({ x: 172, y: 120, width: 320, height: 464 });
    expect(f.controller.getState().layout).toEqual({ avatarSize: 320, panelHeight: 144 });
    f.controller.action({ type: "drag", x: -380, y: 10 });
    expect(window.getBounds()).toEqual({ x: -400, y: 0, width: 240, height: 280 });
    expect(f.controller.getState().layout).toEqual({ avatarSize: 168, panelHeight: 112 });
    expect(f.controller.getPreferences().size).toBe(320);
    f.controller.dispose();
  });

  it("schedules bounded idle motions and interrupts only idle motion when work starts", async () => {
    const f = fixture(undefined, { random: () => 0 });
    await f.controller.setPreferences({
      enabled: true,
      greetingEnabled: false,
      chattiness: "off",
      restAfterMinutes: 0,
      idleAnimationFrequency: "high",
    });
    vi.advanceTimersByTime(44_999);
    expect(f.controller.getState().motionRequest).toBeNull();
    vi.advanceTimersByTime(1);
    expect(f.controller.getState().motionRequest).toMatchObject({
      source: "idle",
      action: "look_around",
    });
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    expect(f.controller.getState().motionRequest).toBeNull();
    vi.advanceTimersByTime(180_000);
    expect(f.controller.getState().motionRequest).toBeNull();
    f.controller.interact("dance");
    const manual = f.controller.getState().motionRequest;
    expect(manual).toMatchObject({ source: "manual", action: "dance" });
    f.controller.handleChatEvent(
      event({ type: "run_started", sessionId: "other", runId: "other" }),
    );
    expect(f.controller.getState().motionRequest).toEqual(manual);
    f.controller.dispose();
  });

  it("chooses only finite one-shot actions for automatic idle motion", async () => {
    const expected = ["look_around", "stretch", "drink", "nod", "greet_wave"];
    for (const [index, action] of expected.entries()) {
      const f = fixture(undefined, { random: () => (index + 0.1) / expected.length });
      await f.controller.setPreferences({
        enabled: true,
        greetingEnabled: false,
        chattiness: "off",
        restAfterMinutes: 0,
        idleAnimationFrequency: "high",
      });
      vi.advanceTimersByTime(90_000);
      expect(f.controller.getState().motionRequest).toMatchObject({ source: "idle", action });
      f.controller.dispose();
    }
  });

  it("restarts the idle countdown after work completes and respects disabled animation", async () => {
    const f = fixture(undefined, { random: () => 0 });
    await f.controller.setPreferences({
      enabled: true,
      greetingEnabled: false,
      chattiness: "off",
      restAfterMinutes: 0,
      idleAnimationFrequency: "high",
    });
    vi.advanceTimersByTime(44_000);
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    vi.advanceTimersByTime(120_000);
    f.controller.handleChatEvent(event({ type: "run_completed", sessionId: "s", runId: "r" }));
    vi.advanceTimersByTime(44_999);
    expect(f.controller.getState().motionRequest).toBeNull();
    vi.advanceTimersByTime(1);
    expect(f.controller.getState().motionRequest).toMatchObject({ source: "idle" });

    await f.controller.setPreferences({ animationEnabled: false });
    expect(f.controller.getState().motionRequest).toBeNull();
    vi.advanceTimersByTime(180_000);
    expect(f.controller.getState().motionRequest).toBeNull();
    await f.controller.setPreferences({ idleAnimationFrequency: "off", animationEnabled: true });
    vi.advanceTimersByTime(180_000);
    expect(f.controller.getState().motionRequest).toBeNull();
    f.controller.dispose();
  });

  it("stops an automatic greeting on quiet mode without cancelling a manual action", async () => {
    const f = fixture();
    f.controller.show();
    expect(f.controller.getState()).toMatchObject({
      mood: "greeting",
      message: "你好，我在这里。",
    });
    const manual = f.controller.interact("nod").motionRequest;
    await f.controller.setPreferences({ quietMode: true });
    expect(f.controller.getState()).toMatchObject({
      mood: "idle",
      message: null,
      motionRequest: manual,
    });

    await f.controller.setPreferences({ quietMode: false });
    f.controller.action({ type: "pat" });
    await f.controller.setPreferences({ quietMode: true });
    expect(f.controller.getState()).toMatchObject({
      mood: "greeting",
      motionRequest: { action: "pat", source: "manual" },
    });
    f.controller.dispose();
  });

  it("suppresses automatic idle motion in quiet mode, sleep, hidden state and reduced motion", async () => {
    let reducedMotion = true;
    const f = fixture(undefined, { random: () => 0, isReducedMotion: () => reducedMotion });
    await f.controller.setPreferences({
      enabled: true,
      greetingEnabled: false,
      chattiness: "off",
      restAfterMinutes: 0,
      idleAnimationFrequency: "high",
    });
    vi.advanceTimersByTime(120_000);
    expect(f.controller.getState().motionRequest).toBeNull();
    reducedMotion = false;
    f.controller.setMotionAvailability(false);
    vi.advanceTimersByTime(120_000);
    expect(f.controller.getState().motionRequest).toBeNull();
    f.controller.setMotionAvailability(true);
    vi.advanceTimersByTime(45_000);
    expect(f.controller.getState().motionRequest).toMatchObject({ source: "idle" });

    f.controller.setMotionAvailability(false);
    expect(f.controller.getState().motionRequest).toBeNull();
    f.controller.setMotionAvailability(true);
    vi.advanceTimersByTime(45_000);
    expect(f.controller.getState().motionRequest).toMatchObject({ source: "idle" });

    await f.controller.setPreferences({ quietMode: true });
    expect(f.controller.getState().motionRequest).toBeNull();
    vi.advanceTimersByTime(120_000);
    expect(f.controller.getState().motionRequest).toBeNull();
    f.controller.interact("nod");
    expect(f.controller.getState().motionRequest).toMatchObject({
      source: "manual",
      action: "nod",
    });
    f.controller.setMotionAvailability(false);
    expect(f.controller.getState().motionRequest).toMatchObject({
      source: "manual",
      action: "nod",
    });
    await f.controller.setPreferences({ quietMode: false });
    const manualRequest = f.controller.getState().motionRequest;
    await f.controller.setPreferences({ quietMode: true });
    expect(f.controller.getState().motionRequest).toEqual(manualRequest);
    await f.controller.setPreferences({ quietMode: false });
    f.controller.setMotionAvailability(true);
    f.controller.interact("sleep");
    vi.advanceTimersByTime(120_000);
    expect(f.controller.getState().motionRequest).toBeNull();
    f.controller.interact("wake");
    f.controller.hide();
    vi.advanceTimersByTime(120_000);
    expect(f.controller.getState().motionRequest).toBeNull();
    expect(() => f.controller.setMotionAvailability("true")).toThrow("Invalid");
    f.controller.dispose();
  });

  it("keeps manual interactions separate from real task status and sequences requests", () => {
    const f = fixture();
    f.controller.show();
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));

    const first = f.controller.interact("preview_success");
    expect(first.mood).toBe("thinking");
    expect(first.tasks).toMatchObject([{ sessionId: "s", runId: "r", status: "thinking" }]);
    expect(first.motionRequest).toMatchObject({ action: "preview_success" });

    const second = f.controller.action({ type: "pat" });
    expect(second.mood).toBe("thinking");
    expect(second.motionRequest?.action).toBe("pat");
    expect(second.motionRequest?.id).toBeGreaterThan(first.motionRequest?.id ?? 0);
    expect(second.tasks).toEqual(first.tasks);
    expect(() => f.controller.interact("execute_arbitrary_command")).toThrow("Unsupported");
    expect(() => f.controller.action({ type: "interact", action: "pat", extra: true })).toThrow(
      "Unsupported",
    );
    f.controller.dispose();
  });

  it("shows a retryable menu failure without changing task state even when hints are disabled", async () => {
    const f = fixture();
    await f.controller.setPreferences({ enabled: true, taskHintsEnabled: false });
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    const before = f.controller.getState();

    f.controller.reportMenuFailure();
    expect(f.controller.getState()).toMatchObject({
      mood: before.mood,
      tasks: before.tasks,
      message: "操作未完成，请重试或打开设置。",
    });
    vi.advanceTimersByTime(3_000);
    f.controller.reportMenuFailure();
    vi.advanceTimersByTime(2_000);
    expect(f.controller.getState().message).toBe("操作未完成，请重试或打开设置。");
    await f.controller.setPreferences({ taskHintsEnabled: true });
    expect(f.controller.getState().message).toBe("操作未完成，请重试或打开设置。");
    vi.advanceTimersByTime(2_000);
    expect(f.controller.getState()).toMatchObject({
      mood: "thinking",
      tasks: before.tasks,
      message: "我开始处理了。",
    });
    f.controller.dispose();
  });

  it("localizes a menu failure and clears it when the companion is hidden", () => {
    const f = fixture();
    f.settings.set("desktop.locale", "en");
    f.controller.show();
    f.controller.interact("sleep");
    f.controller.reportMenuFailure();
    expect(f.controller.getState()).toMatchObject({
      mood: "sleeping",
      manualSleeping: true,
      message: "Action could not be completed. Try again or open settings.",
    });
    f.controller.hide();
    expect(f.controller.getState().message).toBe("Taking a break.");
    f.controller.dispose();
  });

  it("keeps manual sleep across task events while exposing real status and resumes on wake", () => {
    const f = fixture();
    f.controller.show();
    expect(f.controller.interact("sleep")).toMatchObject({
      manualSleeping: true,
      mood: "sleeping",
    });
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    expect(f.controller.getState()).toMatchObject({
      mood: "sleeping",
      manualSleeping: true,
      tasks: [{ sessionId: "s", runId: "r", status: "thinking" }],
    });
    f.controller.interact("cancel_interaction");
    expect(f.controller.getState().manualSleeping).toBe(true);
    expect(f.controller.interact("wake")).toMatchObject({
      manualSleeping: false,
      mood: "thinking",
      tasks: [{ sessionId: "s", runId: "r", status: "thinking" }],
    });
    f.controller.dispose();
  });

  it("honors locked positions, resets position explicitly, and separates hide from disable", async () => {
    const f = fixture({ enabled: true, greetingEnabled: false });
    f.controller.show();
    expect(f.controller.getPreferences()).toMatchObject({
      animationEnabled: true,
      positionLocked: false,
    });
    await f.controller.setPreferences({ positionLocked: true });
    f.controller.action({ type: "drag-start" });
    f.controller.action({ type: "drag", x: 5, y: 10 });
    expect(f.controller.getState().mood).toBe("idle");
    expect(f.windows.at(0)?.getBounds()).toMatchObject({ x: 1080, y: 600 });
    await f.controller.setPreferences({ position: null });
    expect(f.controller.getPreferences().position).toEqual({ x: 1080, y: 600 });

    f.controller.hide();
    expect(f.controller.getPreferences().enabled).toBe(true);
    f.controller.show();
    await f.controller.setPreferences({ enabled: false });
    expect(f.controller.getState().visible).toBe(false);
    expect(f.settings.get("desktop.companion.preferences.v1")).toMatchObject({
      enabled: false,
      positionLocked: true,
    });
    f.controller.dispose();
  });

  it("ends an in-progress drag when position locking succeeds, preserving task and sleep state", async () => {
    const f = fixture();
    f.controller.show();
    f.controller.handleChatEvent(event({ type: "run_started", sessionId: "s", runId: "r" }));
    const tasks = f.controller.getState().tasks;
    expect(f.controller.action({ type: "drag-start" }).mood).toBe("dragging");

    f.failNextWrite();
    await expect(f.controller.setPreferences({ positionLocked: true })).rejects.toThrow(
      "write failed",
    );
    expect(f.controller.getState()).toMatchObject({
      mood: "dragging",
      tasks,
      preferences: { positionLocked: false },
    });
    await f.controller.setPreferences({ positionLocked: true });
    expect(f.controller.getState()).toMatchObject({
      mood: "thinking",
      tasks,
      preferences: { positionLocked: true },
    });
    expect(f.controller.action({ type: "drag-end" }).mood).toBe("thinking");

    await f.controller.setPreferences({ positionLocked: false });
    f.controller.interact("sleep");
    expect(f.controller.action({ type: "drag-start" }).mood).toBe("dragging");
    await f.controller.setPreferences({ positionLocked: true });
    expect(f.controller.getState()).toMatchObject({
      mood: "sleeping",
      tasks,
      manualSleeping: true,
    });
    f.controller.dispose();
  });

  it("clears stale manual actions when animations are toggled or the window is hidden", async () => {
    const f = fixture();
    f.controller.show();
    f.controller.interact("greet_wave");
    expect(f.controller.getState().motionRequest?.action).toBe("greet_wave");
    await f.controller.setPreferences({ animationEnabled: false });
    expect(f.controller.getState().motionRequest).toBeNull();
    await f.controller.setPreferences({ animationEnabled: true });
    expect(f.controller.getState().motionRequest).toBeNull();
    f.controller.interact("nod");
    f.controller.hide();
    f.controller.show();
    expect(f.controller.getState().motionRequest).toBeNull();
    f.controller.dispose();
  });
});
