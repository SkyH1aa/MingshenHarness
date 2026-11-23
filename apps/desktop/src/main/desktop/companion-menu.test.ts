import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  buildCompanionMenu,
  type CompanionMenuHandlers,
  type CompanionMenuItem,
  type CompanionMenuState,
} from "./companion-menu";

function fixture(overrides: Partial<CompanionMenuState> = {}) {
  const state: CompanionMenuState = {
    locale: "zh",
    tasks: [],
    preferences: {
      alwaysOnTop: true,
      positionLocked: false,
      animationEnabled: true,
      size: 176,
      opacity: 1,
      taskPanelEnabled: true,
      showSessionTitles: true,
      quietMode: false,
    },
    manualSleeping: false,
    ...overrides,
  };
  const handlers = {
    openMain: vi.fn(),
    openQuickChat: vi.fn(),
    openSession: vi.fn(),
    openSettings: vi.fn(),
    setPreferences: vi.fn(),
    interact: vi.fn(),
    hide: vi.fn(),
    disable: vi.fn(),
    onError: vi.fn(),
  } satisfies CompanionMenuHandlers;
  const menu = buildCompanionMenu(state, handlers);
  const electronTemplate: MenuItemConstructorOptions[] = menu;
  expect(electronTemplate).toBe(menu);
  return { state, handlers, menu };
}

function item(items: CompanionMenuItem[], id: string): CompanionMenuItem {
  for (const entry of items) {
    if (entry.id === id) return entry;
    const nested = entry.submenu?.find((candidate) => candidate.id === id);
    if (nested) return nested;
  }
  throw new Error(`Missing menu item: ${id}`);
}

function click(items: CompanionMenuItem[], id: string) {
  const selected = item(items, id);
  if (!selected.click) throw new Error(`Menu item is not actionable: ${id}`);
  selected.click();
}

describe("desktop companion context menu", () => {
  it("uses the selected language and reports an empty task list without exposing details", () => {
    const chinese = fixture();
    expect(item(chinese.menu, "open-main").label).toBe("打开主界面");
    expect(item(chinese.menu, "quick-chat").label).toContain("ChatAgent");
    expect(item(chinese.menu, "tasks").label).toBe("当前任务 (0)");
    expect(item(chinese.menu, "tasks-empty")).toMatchObject({
      label: "暂无运行中的任务",
      enabled: false,
    });

    const english = fixture({ locale: "en" });
    expect(item(english.menu, "open-main").label).toBe("Open main window");
    expect(item(english.menu, "tasks").label).toBe("Active tasks (0)");
    expect(item(english.menu, "tasks-empty").label).toBe("No active tasks");
    expect(item(english.menu, "hide").label).toBe("Hide for now");
    expect(item(english.menu, "disable").label).toBe("Turn off companion");
  });

  it("routes aggregated tasks to their sessions and escapes menu accelerators", () => {
    const f = fixture({
      tasks: [
        {
          sessionId: "private-session-b",
          runId: "private-run-c",
          title: null,
          status: "waiting",
          startedAt: 3,
        },
        {
          sessionId: "private-session-a",
          runId: "private-run-a",
          title: "Planning & review",
          status: "thinking",
          startedAt: 1,
        },
      ],
    });
    expect(item(f.menu, "tasks").label).toBe("当前任务 (2)");
    expect(item(f.menu, "task-1").label).toBe("任务 1 · 等待处理");
    expect(item(f.menu, "task-2").label).toBe("Planning && review · 思考中");
    expect(JSON.stringify(f.menu)).not.toContain("private-session");
    expect(JSON.stringify(f.menu)).not.toContain("private-run");
    click(f.menu, "task-1");
    click(f.menu, "task-2");
    expect(f.handlers.openSession.mock.calls).toEqual([
      ["private-session-b"],
      ["private-session-a"],
    ]);
  });

  it("orders the task menu by status and start time while preserving ties", () => {
    const f = fixture({
      tasks: [
        { sessionId: "thinking", runId: "1", title: null, status: "thinking", startedAt: 0 },
        { sessionId: "working-later", runId: "2", title: null, status: "working", startedAt: 4 },
        { sessionId: "waiting-tie", runId: "3", title: null, status: "waiting", startedAt: 3 },
        { sessionId: "waiting-later", runId: "4", title: null, status: "waiting", startedAt: 5 },
        { sessionId: "working-earlier", runId: "5", title: null, status: "working", startedAt: 2 },
        { sessionId: "waiting-tie-2", runId: "6", title: null, status: "waiting", startedAt: 3 },
      ],
    });
    for (let index = 1; index <= 6; index += 1) click(f.menu, `task-${index}`);
    expect(f.handlers.openSession.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      "waiting-tie",
      "waiting-tie-2",
      "waiting-later",
      "working-earlier",
      "working-later",
      "thinking",
    ]);
  });

  it("bounds the native task submenu and keeps an overflow path to the main window", () => {
    const f = fixture({
      tasks: Array.from({ length: 23 }, (_, index) => ({
        sessionId: `session-${index}`,
        runId: `run-${index}`,
        title: null,
        status: "working" as const,
        startedAt: index,
      })),
    });
    expect(item(f.menu, "tasks").label).toBe("当前任务 (23)");
    expect(item(f.menu, "tasks").submenu).toHaveLength(21);
    expect(item(f.menu, "tasks-more").label).toBe("还有 3 项，打开主界面");
    click(f.menu, "tasks-more");
    expect(f.handlers.openMain).toHaveBeenCalledOnce();
  });

  it("maps all interaction commands and rest, wake, and stop independently", () => {
    const f = fixture();
    const actions = [
      "greet_wave",
      "pat",
      "nod",
      "shake_head",
      "look_around",
      "stretch",
      "dance",
      "jump",
      "drink",
      "listen",
      "notify",
      "read_enter",
      "read_exit",
      "walk_left",
      "walk_right",
    ] as const;
    for (const action of actions) click(f.menu, `interaction-${action}`);
    click(f.menu, "interaction-rest");
    click(f.menu, "interaction-cancel");
    expect(f.handlers.interact.mock.calls).toEqual(
      [...actions, "sleep", "cancel_interaction"].map((action) => [action]),
    );

    const sleeping = fixture({ locale: "en", manualSleeping: true });
    expect(item(sleeping.menu, "interaction-rest").label).toBe("Wake up");
    click(sleeping.menu, "interaction-rest");
    expect(sleeping.handlers.interact).toHaveBeenCalledWith("wake");
  });

  it("sends state previews as motion requests without modifying real task state", () => {
    const f = fixture({
      locale: "en",
      tasks: [{ sessionId: "session", runId: "run", title: null, status: "working", startedAt: 1 }],
    });
    const actions = [
      "preview_thinking",
      "preview_working",
      "preview_waiting",
      "preview_success",
      "preview_error",
      "preview_sleep",
    ] as const;
    expect(item(f.menu, "state-previews").label).toBe("Preview states");
    for (const action of actions) click(f.menu, `interaction-${action}`);
    expect(f.handlers.interact.mock.calls).toEqual(actions.map((action) => [action]));
    expect(f.state.tasks).toEqual([
      { sessionId: "session", runId: "run", title: null, status: "working", startedAt: 1 },
    ]);
    expect(item(f.menu, "task-1").label).toBe("Task 1 · Working");
    expect(f.handlers.setPreferences).not.toHaveBeenCalled();
  });

  it("represents preferences from the snapshot and sends explicit patches", () => {
    const f = fixture();
    expect(item(f.menu, "always-on-top").checked).toBe(true);
    expect(item(f.menu, "position-locked").checked).toBe(false);
    expect(item(f.menu, "animation-enabled").checked).toBe(true);
    expect(item(f.menu, "task-panel-enabled").checked).toBe(true);
    expect(item(f.menu, "show-session-titles").checked).toBe(true);
    expect(item(f.menu, "quiet-mode").checked).toBe(false);
    expect(item(f.menu, "size-176").checked).toBe(true);
    expect(item(f.menu, "size-96").checked).toBe(false);
    expect(item(f.menu, "opacity-100").checked).toBe(true);
    expect(item(f.menu, "opacity-35").checked).toBe(false);
    for (const id of [
      "always-on-top",
      "position-locked",
      "reset-position",
      "animation-enabled",
      "task-panel-enabled",
      "show-session-titles",
      "quiet-mode",
      "size-96",
      "size-128",
      "size-176",
      "size-240",
      "size-320",
      "opacity-35",
      "opacity-50",
      "opacity-75",
      "opacity-100",
    ]) {
      click(f.menu, id);
    }
    expect(f.handlers.setPreferences.mock.calls).toEqual([
      [{ alwaysOnTop: false }],
      [{ positionLocked: true }],
      [{ position: null }],
      [{ animationEnabled: false }],
      [{ taskPanelEnabled: false }],
      [{ showSessionTitles: false }],
      [{ quietMode: true }],
      [{ size: 96 }],
      [{ size: 128 }],
      [{ size: 176 }],
      [{ size: 240 }],
      [{ size: 320 }],
      [{ opacity: 0.35 }],
      [{ opacity: 0.5 }],
      [{ opacity: 0.75 }],
      [{ opacity: 1 }],
    ]);
  });

  it("routes navigation, temporary hide, and persistent disable separately", () => {
    const f = fixture();
    for (const id of ["open-main", "quick-chat", "settings", "hide", "disable"]) click(f.menu, id);
    expect(f.handlers.openMain).toHaveBeenCalledOnce();
    expect(f.handlers.openQuickChat).toHaveBeenCalledOnce();
    expect(f.handlers.openSettings).toHaveBeenCalledOnce();
    expect(f.handlers.hide).toHaveBeenCalledOnce();
    expect(f.handlers.disable).toHaveBeenCalledOnce();
  });

  it("reports both synchronous errors and rejected operations", async () => {
    const syncFailure = new Error("sync failure");
    const asyncFailure = new Error("async failure");
    const f = fixture();
    f.handlers.openMain.mockImplementation(() => {
      throw syncFailure;
    });
    f.handlers.openQuickChat.mockImplementation(() => Promise.reject(asyncFailure));
    click(f.menu, "open-main");
    click(f.menu, "quick-chat");
    await Promise.resolve();
    await Promise.resolve();
    expect(f.handlers.onError.mock.calls).toEqual([[syncFailure], [asyncFailure]]);
  });

  it("logs an error when no reporter is supplied, including rejected reporters", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const f = fixture();
      const failure = new Error("no reporter");
      const reporterFailure = new Error("reporter failed");
      const { onError: _unused, ...withoutReporter } = f.handlers;
      const noReporter = buildCompanionMenu(f.state, {
        ...withoutReporter,
        openMain: () => {
          throw failure;
        },
      });
      click(noReporter, "open-main");
      const badReporter = buildCompanionMenu(f.state, {
        ...f.handlers,
        openMain: () => Promise.reject(failure),
        onError: () => Promise.reject(reporterFailure),
      });
      click(badReporter, "open-main");
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
      expect(consoleError).toHaveBeenCalledWith("Desktop companion menu action failed:", failure);
      expect(consoleError).toHaveBeenCalledWith(
        "Desktop companion menu error reporting failed:",
        reporterFailure,
        failure,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
