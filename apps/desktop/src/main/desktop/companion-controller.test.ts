import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "../../shared/domain";
import type { Repository } from "../storage/repository";
import {
  type CompanionBounds,
  CompanionController,
  type CompanionWindow,
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
  private bounds: CompanionBounds;
  alwaysOnTop = false;
  opacity = 1;
  showInactiveCalls = 0;

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
  show() {
    this.visible = true;
  }
  showInactive() {
    this.showInactiveCalls += 1;
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  destroy() {
    this.destroyed = true;
    this.visible = false;
  }
  getBounds() {
    return { ...this.bounds };
  }
  setBounds(bounds: CompanionBounds) {
    this.bounds = { ...bounds };
  }
  setAlwaysOnTop(flag: boolean) {
    this.alwaysOnTop = flag;
  }
  setOpacity(opacity: number) {
    this.opacity = opacity;
  }
  fire(event: "did-finish-load") {
    this.webContents.emit(event);
  }
}

function fixture(stored?: unknown) {
  const settings = new Map<string, unknown>();
  if (stored !== undefined) settings.set("desktop.companion.preferences.v1", stored);
  let failNextWrite = false;
  const repository = {
    getSetting: (key: string) => settings.get(key) ?? null,
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
      const window = new WindowFixture(bounds);
      windows.push(window);
      return window as unknown as CompanionWindow;
    },
    getWorkArea: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
  });
  return {
    controller,
    settings,
    windows,
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
    f.controller.handleChatEvent(
      event({ type: "approval_state", state: { revision: 1, requests: [] } }),
    );
    expect(f.controller.getState().mood).toBe("working");

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
});
