import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent, SessionView } from "../../shared/domain";
import type { Repository } from "../storage/repository";
import type { ApprovalNotifications } from "./approval-notifications";
import { badgeBitmap, CompletionNotifications } from "./completion-notifications";
import type { QuestionNotifications } from "./question-notifications";

const mock = vi.hoisted(() => ({
  notifications: [] as Array<
    EventEmitter & {
      options: Electron.NotificationConstructorOptions;
      close: ReturnType<typeof vi.fn>;
      show: ReturnType<typeof vi.fn>;
    }
  >,
  activation: null as ((details: Electron.ActivationArguments) => void) | null,
  activationRegistrations: vi.fn(),
  badge: vi.fn(),
  supported: true,
}));
vi.mock("electron", () => ({
  app: { setBadgeCount: mock.badge },
  nativeImage: { createFromBitmap: (pixels: Buffer) => pixels },
  Notification: class extends EventEmitter {
    static isSupported() {
      return mock.supported;
    }
    static handleActivation(handler: (details: Electron.ActivationArguments) => void) {
      mock.activationRegistrations(handler);
      mock.activation = handler;
    }
    close = vi.fn();
    show = vi.fn(() => this.emit("show"));
    constructor(readonly options: Electron.NotificationConstructorOptions) {
      super();
      mock.notifications.push(this);
    }
  },
}));
function fixture(approvals?: ApprovalNotifications, questions?: QuestionNotifications) {
  const settings = new Map<string, unknown>();
  const sessions = new Map(
    ["a", "b", "c"].map((id) => [
      id,
      { id, title: `Task ${id}`, parentSessionId: null } as SessionView,
    ]),
  );
  const repository = {
    getSetting: (key: string) => settings.get(key),
    setSetting: (key: string, value: unknown) => settings.set(key, value),
    removeSetting: (key: string) => settings.delete(key),
    getSession: (id: string) => sessions.get(id),
    getMessages: () => [
      { role: "assistant", parts: [{ type: "text", text: "Fixture completed" }] },
    ],
  } as unknown as Repository;
  let focused = true;
  const window = Object.assign(new EventEmitter(), {
    isFocused: () => focused,
    isVisible: () => true,
    isMinimized: () => false,
    isDestroyed: () => false,
    setOverlayIcon: vi.fn(),
    webContents: { send: vi.fn() },
  });
  const reply = vi.fn(async () => ({ runId: "reply" }));
  const open = vi.fn();
  const emit = vi.fn();
  const service = new CompletionNotifications(
    repository,
    window as unknown as BrowserWindow,
    "icon.png",
    emit,
    open,
    reply,
    approvals,
    questions,
  );
  const complete = (sessionId: string, runId = `run-${sessionId}`) =>
    service.handle({ type: "run_completed", sessionId, runId });
  return {
    service,
    settings,
    sessions,
    repository,
    window,
    reply,
    open,
    emit,
    complete,
    focus: (value: boolean) => {
      focused = value;
    },
  };
}
beforeEach(() => {
  mock.notifications = [];
  mock.activation = null;
  mock.activationRegistrations.mockClear();
  mock.badge.mockClear();
  mock.supported = true;
});
describe("Task completion notifications", () => {
  it("dispatches question clicks and actions through one activation handler and forwards lifecycle", () => {
    const approvals = {
      activate: vi.fn(() => false),
      handle: vi.fn(),
      refreshSettings: vi.fn(),
      setActiveSession: vi.fn(),
      dispose: vi.fn(),
    };
    const questions = {
      activate: vi.fn(() => true),
      handle: vi.fn(),
      refreshSettings: vi.fn(),
      setActiveSession: vi.fn(),
      dispose: vi.fn(),
    };
    const f = fixture(
      approvals as unknown as ApprovalNotifications,
      questions as unknown as QuestionNotifications,
    );
    expect(mock.activationRegistrations).toHaveBeenCalledTimes(1);
    const click = {
      type: "click",
      arguments: "tag=0011223344556677",
    };
    const action = {
      type: "action",
      arguments: "tag=0011223344556677",
      actionIndex: 0,
    };
    mock.activation?.(click);
    mock.activation?.(action);
    expect(approvals.activate.mock.calls).toEqual([[click], [action]]);
    expect(questions.activate.mock.calls).toEqual([[click], [action]]);
    expect(approvals.activate.mock.invocationCallOrder[0]).toBeLessThan(
      questions.activate.mock.invocationCallOrder[0] ?? 0,
    );
    expect(f.reply).not.toHaveBeenCalled();
    approvals.activate.mockReturnValueOnce(true);
    mock.activation?.(action);
    expect(questions.activate).toHaveBeenCalledTimes(2);
    f.service.setActiveSession("b");
    expect(approvals.setActiveSession).toHaveBeenCalledWith("b");
    expect(questions.setActiveSession).toHaveBeenCalledWith("b");
    const event: ChatStreamEvent = {
      type: "question_state",
      state: { revision: 1, requests: [] },
    };
    f.service.handle(event);
    expect(approvals.handle).toHaveBeenCalledWith(event);
    expect(questions.handle).toHaveBeenCalledWith(event);
    f.service.configure({ ...f.service.state().settings, sound: false });
    expect(approvals.refreshSettings).toHaveBeenCalledExactlyOnceWith();
    expect(questions.refreshSettings).toHaveBeenCalledExactlyOnceWith();
    f.service.dispose();
    expect(approvals.dispose).toHaveBeenCalledExactlyOnceWith();
    expect(questions.dispose).toHaveBeenCalledExactlyOnceWith();
    mock.activation?.(click);
    expect(questions.activate).toHaveBeenCalledTimes(2);
  });
  it("keeps native completion replies working when interaction routers decline the activation", async () => {
    const approvals = {
      activate: vi.fn(() => false),
      handle: vi.fn(),
      refreshSettings: vi.fn(),
      setActiveSession: vi.fn(),
      dispose: vi.fn(),
    };
    const questions = {
      activate: vi.fn(() => false),
      handle: vi.fn(),
      refreshSettings: vi.fn(),
      setActiveSession: vi.fn(),
      dispose: vi.fn(),
    };
    const f = fixture(
      approvals as unknown as ApprovalNotifications,
      questions as unknown as QuestionNotifications,
    );
    f.service.configure({ ...f.service.state().settings, questionEnabled: false });
    f.complete("b");
    const activation = {
      type: "reply",
      arguments: `tag=${mock.notifications[0]?.options.id}`,
      reply: "Continue after the question reminder was disabled",
    };
    mock.activation?.(activation);
    await vi.waitFor(() => expect(f.reply).toHaveBeenCalledTimes(1));
    expect(approvals.activate).toHaveBeenCalledWith(activation);
    expect(questions.activate).toHaveBeenCalledWith(activation);
    expect(f.reply).toHaveBeenCalledWith("b", "Continue after the question reminder was disabled");
    expect(f.open).toHaveBeenCalledWith("b");
    f.service.dispose();
  });
  it("defaults question reminders on, preserves older settings calls and rejects nonboolean values", () => {
    const f = fixture();
    expect(f.service.state().settings.questionEnabled).toBe(true);
    f.service.configure({ ...f.service.state().settings, questionEnabled: false });
    expect(f.settings.get("desktop.notificationSettings")).toMatchObject({
      questionEnabled: false,
      approvalEnabled: true,
    });
    f.service.configure({
      nativeEnabled: true,
      taskbarEnabled: true,
      showPreview: false,
      sound: false,
    });
    expect(f.service.state().settings.questionEnabled).toBe(false);
    for (const questionEnabled of [null, 0, "true", [], {}])
      expect(() =>
        f.service.configure({
          ...f.service.state().settings,
          questionEnabled,
        } as never),
      ).toThrow("Invalid notification settings.");
    expect(f.service.state().settings.questionEnabled).toBe(false);
    f.service.dispose();
    const restored = new CompletionNotifications(
      f.repository,
      f.window as unknown as BrowserWindow,
      "icon.png",
      f.emit,
      f.open,
      f.reply,
    );
    expect(restored.state().settings.questionEnabled).toBe(false);
    restored.dispose();
  });
  it("dispatches approval actions through the single native activation handler without breaking replies", () => {
    const f = fixture();
    f.service.dispose();
    const approvals = {
      activate: vi.fn(() => true),
      handle: vi.fn(),
      refreshSettings: vi.fn(),
      setActiveSession: vi.fn(),
      dispose: vi.fn(),
    };
    const service = new CompletionNotifications(
      f.repository,
      f.window as unknown as BrowserWindow,
      "icon.png",
      f.emit,
      f.open,
      f.reply,
      approvals as unknown as ApprovalNotifications,
    );
    const activation = {
      type: "action",
      arguments: "type=action&action=0&tag=0011223344556677",
      actionIndex: 0,
    };
    mock.activation?.(activation);
    expect(approvals.activate).toHaveBeenCalledWith(activation);
    expect(f.reply).not.toHaveBeenCalled();
    service.setActiveSession("a");
    expect(approvals.setActiveSession).toHaveBeenCalledWith("a");
    expect(service.state().settings.approvalEnabled).toBe(true);
    service.configure({ ...service.state().settings, approvalEnabled: false });
    expect(approvals.refreshSettings).toHaveBeenCalled();
    expect(service.state().settings.approvalEnabled).toBe(false);
    service.configure({
      nativeEnabled: true,
      taskbarEnabled: true,
      showPreview: true,
      sound: true,
    });
    expect(service.state().settings.approvalEnabled).toBe(false);
    service.dispose();
    expect(approvals.dispose).toHaveBeenCalled();
  });
  it("manual compaction neither clears an unread task nor sends another notification", () => {
    const f = fixture();
    f.complete("b");
    const count = mock.notifications.length;
    f.service.handle({ type: "run_started", sessionId: "b", runId: "summary", kind: "compaction" });
    f.service.handle({
      type: "run_completed",
      sessionId: "b",
      runId: "summary",
      kind: "compaction",
    });
    expect(mock.notifications).toHaveLength(count);
    expect(f.service.state().unread.map((item) => item.sessionId)).toEqual(["b"]);
    f.service.dispose();
  });
  it("counts unread conversations once, persists them, clears on viewing and ignores stopped/failed runs", () => {
    const f = fixture();
    f.service.setActiveSession("a");
    f.complete("a");
    expect(f.service.state().badgeCount).toBe(0);
    f.complete("b");
    f.complete("b");
    f.complete("c");
    expect(f.service.state().badgeCount).toBe(2);
    expect(mock.notifications).toHaveLength(3);
    expect(f.settings.get("desktop.completions")).toHaveLength(2);
    expect(mock.badge).toHaveBeenLastCalledWith(2);
    f.service.handle({ type: "run_failed", sessionId: "a", runId: "failed", error: "fixture" });
    f.service.handle({ type: "run_interrupted", sessionId: "a", runId: "stopped" });
    expect(mock.notifications).toHaveLength(3);
    f.service.setActiveSession("b");
    expect(f.service.state().unread.map((item) => item.sessionId)).toEqual(["c"]);
    f.service.dispose();
    const restored = new CompletionNotifications(
      f.repository,
      f.window as unknown as BrowserWindow,
      "icon.png",
      vi.fn(),
      f.open,
      f.reply,
    );
    expect(restored.state().badgeCount).toBe(1);
    restored.dispose();
  });
  it("marks the selected background conversation unread until the window is focused", () => {
    const f = fixture();
    f.service.setActiveSession("a");
    f.focus(false);
    f.complete("a");
    expect(f.service.state().badgeCount).toBe(1);
    f.focus(true);
    f.window.emit("focus");
    expect(f.service.state().badgeCount).toBe(0);
    expect(mock.notifications[0]?.close).toHaveBeenCalled();
    f.service.dispose();
  });
  it("routes a native quick reply once to the original conversation and keeps its permissions", async () => {
    const f = fixture();
    f.complete("b");
    const toast = mock.notifications[0];
    expect(toast?.options).toMatchObject({
      hasReply: true,
      replyPlaceholder: "回复 Mingshen Harness",
      body: "任务已完成 · Fixture completed",
    });
    const activation = {
      type: "reply",
      arguments: `type=reply&tag=${toast?.options.id}`,
      reply: "继续检查",
    };
    mock.activation?.(activation);
    mock.activation?.(activation);
    await vi.waitFor(() => expect(f.reply).toHaveBeenCalledTimes(1));
    expect(f.reply).toHaveBeenCalledWith("b", "继续检查");
    expect(f.open).toHaveBeenCalledWith("b");
    expect(f.service.state().badgeCount).toBe(0);
    f.service.dispose();
  });
  it("preserves a failed reply as a draft and rejects blank or forged activations", async () => {
    const f = fixture();
    f.reply.mockRejectedValueOnce(new Error("Conversation is running"));
    f.complete("b");
    const tag = mock.notifications[0]?.options.id;
    mock.activation?.({ type: "reply", arguments: "type=reply&tag=forged", reply: "invalid" });
    mock.activation?.({ type: "reply", arguments: `type=reply&tag=${tag}`, reply: " " });
    expect(f.reply).not.toHaveBeenCalled();
    mock.activation?.({
      type: "reply",
      arguments: `type=reply&tag=${tag}`,
      reply: "Preserve this reply",
    });
    await vi.waitFor(() =>
      expect(f.window.webContents.send).toHaveBeenCalledWith(
        "desktop:event",
        expect.objectContaining({
          type: "notification-reply-failed",
          sessionId: "b",
          text: "Preserve this reply",
        }),
      ),
    );
    expect(f.service.state().replyDraft).toMatchObject({
      id: tag,
      sessionId: "b",
      text: "Preserve this reply",
    });
    f.service.dispose();
    const restored = new CompletionNotifications(
      f.repository,
      f.window as unknown as BrowserWindow,
      "icon.png",
      vi.fn(),
      f.open,
      f.reply,
    );
    expect(restored.state().replyDraft?.text).toBe("Preserve this reply");
    restored.acknowledgeDraft("wrong-id");
    expect(restored.state().replyDraft).not.toBeNull();
    restored.acknowledgeDraft(tag || "");
    expect(restored.state().replyDraft).toBeNull();
    expect(f.settings.has("desktop.notificationReplyDraft")).toBe(false);
    restored.dispose();
  });
  it("queues failed replies across sessions and restarts until each draft is acknowledged", async () => {
    const f = fixture();
    f.reply.mockRejectedValue(new Error("Conversation is running"));
    const tags: string[] = [];
    for (const [index, sessionId] of ["a", "b", "a"].entries()) {
      f.complete(sessionId, `queued-${index}`);
      const tag = mock.notifications.at(-1)?.options.id ?? "";
      tags.push(tag);
      mock.activation?.({
        type: "reply",
        arguments: `type=reply&tag=${tag}`,
        reply: `Pending reply ${index}`,
      });
      await vi.waitFor(() =>
        expect(f.settings.get("desktop.notificationReplyDraft")).toHaveLength(index + 1),
      );
    }
    f.service.dispose();
    const restored = new CompletionNotifications(
      f.repository,
      f.window as unknown as BrowserWindow,
      "icon.png",
      f.emit,
      f.open,
      f.reply,
    );
    expect(restored.state().replyDraft?.text).toBe("Pending reply 0");
    restored.setActiveSession("b");
    expect(restored.state().replyDraft?.text).toBe("Pending reply 1");
    restored.acknowledgeDraft(tags[1] ?? "");
    expect(f.settings.get("desktop.notificationReplyDraft")).toHaveLength(2);
    restored.setActiveSession("a");
    restored.acknowledgeDraft(tags[0] ?? "");
    expect(restored.state().replyDraft?.text).toBe("Pending reply 2");
    restored.handle({ type: "session_removed", sessionId: "b" });
    expect(restored.state().replyDraft?.text).toBe("Pending reply 2");
    restored.handle({ type: "session_removed", sessionId: "a" });
    expect(restored.state().replyDraft).toBeNull();
    expect(f.settings.has("desktop.notificationReplyDraft")).toBe(false);
    restored.dispose();
  });
  it("restores the previous single-draft storage shape without discarding it", () => {
    const f = fixture();
    f.service.dispose();
    f.settings.set("desktop.notificationReplyDraft", {
      sessionId: "a",
      text: "Legacy pending reply",
      error: "Not accepted",
      id: "0011223344556677",
    });
    const restored = new CompletionNotifications(
      f.repository,
      f.window as unknown as BrowserWindow,
      "icon.png",
      f.emit,
      f.open,
      f.reply,
    );
    expect(restored.state().replyDraft?.text).toBe("Legacy pending reply");
    restored.acknowledgeDraft("0011223344556677");
    expect(f.settings.has("desktop.notificationReplyDraft")).toBe(false);
    restored.dispose();
  });
  it("supports independent notification, preview, sound and taskbar toggles", () => {
    const f = fixture();
    f.service.configure({
      nativeEnabled: true,
      taskbarEnabled: false,
      showPreview: false,
      sound: false,
    });
    f.complete("b");
    expect(f.service.state().unread).toHaveLength(1);
    expect(f.service.state().badgeCount).toBe(0);
    expect(mock.notifications[0]?.options).toMatchObject({
      title: "Mingshen Harness",
      body: "任务已完成",
      silent: true,
    });
    f.service.configure({
      nativeEnabled: false,
      taskbarEnabled: true,
      showPreview: false,
      sound: false,
    });
    f.complete("c");
    expect(mock.notifications).toHaveLength(1);
    expect(f.service.state().badgeCount).toBe(2);
    expect(() => f.service.configure({} as never)).toThrow();
    f.service.dispose();
  });
  it("opens the original conversation when its notification is clicked", () => {
    const f = fixture();
    f.service.setActiveSession("a");
    f.complete("b");
    mock.notifications[0]?.emit("click");
    expect(f.open).toHaveBeenCalledWith("b");
    expect(f.service.state().badgeCount).toBe(0);
    f.service.dispose();
  });
  it("restores reply routing after restart while rejecting expired and consumed routes", async () => {
    const f = fixture();
    f.complete("b");
    const tag = mock.notifications[0]?.options.id;
    f.settings.set("desktop.notificationRoutes", [
      ...(f.settings.get("desktop.notificationRoutes") as unknown[]),
      {
        id: "0011223344556677",
        sessionId: "a",
        runId: "old",
        createdAt: Date.now() - 8 * 86400000,
        consumed: false,
      },
      {
        id: "1122334455667788",
        sessionId: "a",
        runId: "used",
        createdAt: Date.now(),
        consumed: true,
      },
      {
        id: "2233445566778899",
        sessionId: "missing",
        runId: "gone",
        createdAt: Date.now(),
        consumed: false,
      },
    ]);
    f.service.dispose();
    const restored = new CompletionNotifications(
      f.repository,
      f.window as unknown as BrowserWindow,
      "icon.png",
      vi.fn(),
      f.open,
      f.reply,
    );
    for (const id of ["0011223344556677", "1122334455667788", "2233445566778899"])
      mock.activation?.({
        type: "reply",
        arguments: `type=reply&tag=${id}`,
        userInputs: { reply: "Ignored" },
      });
    expect(f.reply).not.toHaveBeenCalled();
    mock.activation?.({
      type: "reply",
      arguments: `type=reply&tag=${tag}`,
      userInputs: { reply: "After restart" },
    });
    await vi.waitFor(() => expect(f.reply).toHaveBeenCalledWith("b", "After restart"));
    restored.dispose();
  });
  it("clears unread state on a new run and skips duplicate automatic child completions", () => {
    const f = fixture();
    f.complete("a");
    f.service.handle({ type: "run_started", sessionId: "a", runId: "next" });
    expect(f.service.state().unread).toHaveLength(0);
    f.sessions.set("c", { ...f.sessions.get("c"), parentSessionId: "a" } as SessionView);
    f.complete("c");
    expect(mock.notifications).toHaveLength(1);
    f.service.dispose();
  });
  it("retains unread indicators if Windows notifications fail or are unavailable", () => {
    const f = fixture();
    f.complete("b");
    mock.notifications[0]?.emit("failed", {}, "Windows notifications disabled");
    expect(f.service.state()).toMatchObject({
      badgeCount: 1,
      lastDelivery: "failed",
      lastError: "Windows notifications disabled",
    });
    mock.supported = false;
    f.complete("c");
    expect(mock.notifications).toHaveLength(1);
    expect(f.service.state().unread).toHaveLength(2);
    f.service.dispose();
  });
  it("renders stable numbered badge bitmaps", () => {
    for (const count of [1, 9, 10, 99, 100]) {
      const bitmap = badgeBitmap(count);
      expect(bitmap.length).toBe(4096);
      expect(bitmap.some((value) => value !== 0)).toBe(true);
    }
    expect(badgeBitmap(100)).toEqual(badgeBitmap(99));
  });
  it("redacts credential patterns from notification titles and previews", () => {
    const f = fixture();
    f.sessions.set("b", {
      ...f.sessions.get("b"),
      title: "Check sk-notificationfixturesecret",
    } as SessionView);
    f.complete("b");
    expect(mock.notifications[0]?.options.title).toBe("Check [REDACTED]");
    f.service.dispose();
  });
  it("removes stale badges and blocks replies to deleted conversations", () => {
    const f = fixture();
    f.complete("b");
    const tag = mock.notifications[0]?.options.id;
    f.sessions.delete("b");
    f.service.handle({ type: "session_removed", sessionId: "b" });
    expect(f.service.state().badgeCount).toBe(0);
    mock.notifications[0]?.emit("click");
    mock.activation?.({ type: "reply", arguments: `type=reply&tag=${tag}`, reply: "Deleted" });
    expect(f.open).not.toHaveBeenCalled();
    expect(f.reply).not.toHaveBeenCalled();
    f.service.dispose();
  });
  it("localizes failed quick replies and native notification copy", async () => {
    const f = fixture();
    f.settings.set("desktop.locale", "en");
    f.reply.mockRejectedValueOnce(new Error("该会话正在运行，请先停止或等待完成。"));
    f.complete("b");
    const toast = mock.notifications[0];
    expect(toast?.options.replyPlaceholder).toBe("Reply to Mingshen Harness");
    expect(toast?.options.body).toBe("Task completed · Fixture completed");
    mock.activation?.({
      type: "reply",
      arguments: `type=reply&tag=${toast?.options.id}`,
      reply: "Continue",
    });
    await vi.waitFor(() => expect(f.service.state().replyDraft).not.toBeNull());
    expect(f.service.state().replyDraft?.error).not.toMatch(/[\u4e00-\u9fff]/);
    f.service.dispose();
  });
});
