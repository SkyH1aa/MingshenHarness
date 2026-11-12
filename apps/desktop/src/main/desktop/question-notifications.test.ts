import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionRequest, SessionView } from "../../shared/domain";
import { registerRuntimeSecret } from "../diagnostics/runtime-log";
import { QuestionBroker } from "../permissions/question-broker";
import type { Repository } from "../storage/repository";
import { QuestionNotifications } from "./question-notifications";

const mock = vi.hoisted(() => ({
  supported: true,
  failShow: false,
  notifications: [] as Array<
    EventEmitter & {
      options: Electron.NotificationConstructorOptions;
      close: ReturnType<typeof vi.fn>;
    }
  >,
}));
vi.mock("electron", () => ({
  Notification: class extends EventEmitter {
    static isSupported() {
      return mock.supported;
    }
    close = vi.fn();
    constructor(readonly options: Electron.NotificationConstructorOptions) {
      super();
      mock.notifications.push(this);
    }
    show() {
      if (mock.failShow) throw new Error("Fixture question toast rejected");
    }
  },
}));
const services: QuestionNotifications[] = [];
const controllers: AbortController[] = [];
beforeEach(() => {
  mock.notifications = [];
  mock.supported = true;
  mock.failShow = false;
});
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  for (const controller of controllers.splice(0)) controller.abort();
});

function fixture() {
  const settings = new Map<string, unknown>();
  const sessions = new Map(
    ["a", "b", "child"].map((id) => [
      id,
      {
        id,
        title: `Session ${id}`,
        parentSessionId: id === "child" ? "a" : null,
      } as SessionView,
    ]),
  );
  const repository = {
    getSetting: (key: string) => settings.get(key),
    getSession: (id: string) => sessions.get(id),
  } as unknown as Repository;
  let focused = false;
  let visible = true;
  let minimized = false;
  let destroyed = false;
  const window = Object.assign(new EventEmitter(), {
    isFocused: () => focused,
    isVisible: () => visible,
    isMinimized: () => minimized,
    isDestroyed: () => destroyed,
  });
  let service!: QuestionNotifications;
  const resolved = vi.fn();
  const broker = new QuestionBroker(resolved, (state) =>
    service?.handle({ type: "question_state", state }),
  );
  const open = vi.fn();
  const error = vi.fn();
  service = new QuestionNotifications(
    repository,
    window as unknown as BrowserWindow,
    "icon.png",
    broker,
    open,
    error,
  );
  services.push(service);
  const request = (id = "first", sessionId = "a", extra: Partial<QuestionRequest> = {}) => {
    const controller = new AbortController();
    controllers.push(controller);
    const item: QuestionRequest = {
      id,
      sessionId,
      runId: `run-${sessionId}`,
      header: "Choose a direction",
      question: "Which approach should the Agent use?",
      options: [
        { label: "Proceed", description: "Continue with the proposed approach." },
        { label: "Pause", description: "Keep work paused for review." },
      ],
      createdAt: new Date().toISOString(),
      ...extra,
    };
    const result = broker.ask(item, controller.signal);
    void result.catch(() => undefined);
    return { item, controller, result };
  };
  const activation = (
    type: Electron.ActivationArguments["type"] = "action",
    tag = mock.notifications.at(-1)?.options.id,
    actionIndex = 0,
  ) => service.activate({ type, arguments: `tag=${tag}`, actionIndex });
  return {
    service,
    broker,
    resolved,
    open,
    error,
    settings,
    sessions,
    window,
    request,
    activation,
    focus: (value: boolean) => {
      focused = value;
    },
    hide: () => {
      visible = false;
    },
    minimize: () => {
      minimized = true;
    },
    destroy: () => {
      destroyed = true;
    },
  };
}

describe("Background question and conflict notifications", () => {
  it("opens an exact pending question once without supplying any answer", () => {
    const f = fixture();
    const pending = f.request();
    const toast = mock.notifications[0];
    expect(toast?.options).toMatchObject({
      groupId: "mingshen-questions",
      actions: [{ type: "button", text: "查看问题" }],
    });
    expect(toast?.options.id).toMatch(/^[a-f0-9]{16}$/);
    expect(f.activation()).toBe(true);
    toast?.emit("action", { actionIndex: 0 }, 0);
    toast?.emit("click");
    expect(f.open).toHaveBeenCalledExactlyOnceWith("a");
    expect(f.resolved).not.toHaveBeenCalled();
    expect(f.broker.list()).toEqual([pending.item]);
    expect(toast?.close).toHaveBeenCalled();
  });

  it("consumes body-click routes before opening and leaves multi-question answers untouched", () => {
    const f = fixture();
    const pending = f.request("multi", "a", {
      questions: [
        {
          id: "first",
          header: "First choice",
          question: "Pick one approach.",
          options: [{ label: "First", description: "First implementation." }],
          multiSelect: false,
        },
        {
          id: "second",
          header: "Second choice",
          question: "Pick applicable checks.",
          options: [{ label: "Lint", description: "Run the project linter." }],
          multiSelect: true,
        },
      ],
    });
    const tag = mock.notifications[0]?.options.id;
    f.activation("click", tag);
    f.activation("click", tag);
    expect(f.open).toHaveBeenCalledExactlyOnceWith("a");
    expect(f.broker.list()).toEqual([pending.item]);
    expect(f.resolved).not.toHaveBeenCalled();
  });

  it("labels writer conflicts distinctly while opening only the blocked conversation", () => {
    const f = fixture();
    f.settings.set("desktop.locale", "en");
    const pending = f.request("writer", "b", {
      kind: "file_conflict",
      header: "Workspace conflict",
      question: "Another Agent holds C:\\fixture\\notes.ts. Choose one writer.",
      options: [
        { label: "Keep original Agent", description: "PRIVATE_KEEP_WRITER_DETAIL" },
        { label: "Use this Agent", description: "PRIVATE_TRANSFER_WRITER_DETAIL" },
      ],
    });
    const options = mock.notifications[0]?.options;
    expect(options?.actions).toEqual([{ type: "button", text: "Resolve conflict" }]);
    expect(JSON.stringify(options)).not.toContain("PRIVATE_TRANSFER_WRITER_DETAIL");
    f.activation();
    expect(f.open).toHaveBeenCalledExactlyOnceWith("b");
    expect(f.broker.list()).toEqual([pending.item]);
    expect(f.resolved).not.toHaveBeenCalled();
  });

  it("keeps concurrent parent, child and other-session requests independently routed", () => {
    const f = fixture();
    f.request("parent");
    f.request("child-conflict", "child", { kind: "file_conflict" });
    f.request("other", "b");
    expect(mock.notifications).toHaveLength(3);
    for (const toast of mock.notifications) f.activation("action", toast.options.id);
    expect(f.open.mock.calls.map(([id]) => id)).toEqual(["a", "child", "b"]);
    expect(f.broker.list()).toHaveLength(3);
    expect(f.resolved).not.toHaveBeenCalled();
  });

  it("waits while the selected chat is foreground and deduplicates later blur refreshes", async () => {
    const f = fixture();
    f.focus(true);
    f.service.setActiveSession("a");
    f.request();
    expect(mock.notifications).toHaveLength(0);
    f.focus(false);
    f.window.emit("blur");
    await vi.waitFor(() => expect(mock.notifications).toHaveLength(1));
    f.window.emit("blur");
    await new Promise((done) => setTimeout(done, 80));
    expect(mock.notifications).toHaveLength(1);
  });

  it("notifies another chat in the foreground and selected chats hidden or minimized", () => {
    const f = fixture();
    f.focus(true);
    f.service.setActiveSession("a");
    f.request("other", "b");
    expect(mock.notifications).toHaveLength(1);
    f.hide();
    f.request("tray");
    expect(mock.notifications).toHaveLength(2);
    f.minimize();
    f.request("minimized");
    expect(mock.notifications).toHaveLength(3);
  });

  it("removes an existing route when its question becomes visible in the active foreground", async () => {
    const f = fixture();
    f.request();
    const toast = mock.notifications[0];
    f.focus(true);
    f.service.setActiveSession("a");
    await vi.waitFor(() => expect(toast?.close).toHaveBeenCalled());
    f.activation("click", toast?.options.id);
    expect(f.open).not.toHaveBeenCalled();
    expect(f.broker.list()).toHaveLength(1);
  });

  it("invalidates answered and cancelled routes without opening later requests", async () => {
    const f = fixture();
    const answered = f.request();
    const answeredTag = mock.notifications[0]?.options.id;
    f.broker.answer({ questionId: answered.item.id, answer: "Proceed" });
    await answered.result;
    f.activation("click", answeredTag);
    expect(f.open).not.toHaveBeenCalled();
    const cancelled = f.request("cancelled");
    const cancelledTag = mock.notifications.at(-1)?.options.id;
    cancelled.controller.abort();
    f.request("replacement");
    f.activation("action", cancelledTag);
    expect(f.open).not.toHaveBeenCalled();
    expect(f.broker.list().map((item) => item.id)).toEqual(["replacement"]);
  });

  it.each(["run_completed", "run_failed", "run_interrupted"] as const)(
    "removes matching %s routes and preserves unrelated runs",
    (type) => {
      const f = fixture();
      f.request("ended");
      const endedTag = mock.notifications[0]?.options.id;
      f.request("other-run", "b");
      f.service.handle(
        type === "run_failed"
          ? { type, sessionId: "a", runId: "run-a", error: "Fixture run failure" }
          : { type, sessionId: "a", runId: "run-a" },
      );
      f.activation("click", endedTag);
      expect(f.open).not.toHaveBeenCalled();
      f.activation();
      expect(f.open).toHaveBeenCalledExactlyOnceWith("b");
    },
  );

  it("invalidates deleted sessions and reused IDs with a different run", () => {
    const f = fixture();
    const old = f.request();
    const tag = mock.notifications[0]?.options.id;
    old.controller.abort();
    f.request("first", "a", { runId: "replacement-run" });
    f.activation("click", tag);
    expect(f.open).not.toHaveBeenCalled();
    const deletedTag = mock.notifications.at(-1)?.options.id;
    f.sessions.delete("a");
    f.service.handle({ type: "session_removed", sessionId: "a" });
    f.activation("action", deletedTag);
    expect(f.open).not.toHaveBeenCalled();
  });

  it("supports old profiles, independent enablement, privacy previews and sound settings", () => {
    const f = fixture();
    f.settings.set("desktop.notificationSettings", { nativeEnabled: false });
    f.request();
    expect(mock.notifications).toHaveLength(0);
    f.settings.set("desktop.notificationSettings", {
      nativeEnabled: true,
      questionEnabled: false,
    });
    f.service.refreshSettings();
    expect(mock.notifications).toHaveLength(0);
    f.settings.set("desktop.notificationSettings", {
      nativeEnabled: true,
      approvalEnabled: false,
      showPreview: false,
      sound: false,
    });
    f.service.refreshSettings();
    expect(mock.notifications).toHaveLength(1);
    expect(mock.notifications[0]?.options.title).toBe("Mingshen Harness");
    expect(mock.notifications[0]?.options.silent).toBe(true);
    const privatePreview = JSON.stringify(mock.notifications[0]?.options);
    expect(privatePreview).not.toContain("Session a");
    expect(privatePreview).not.toContain("Which approach");
    f.settings.set("desktop.notificationSettings", { questionEnabled: false });
    f.service.refreshSettings();
    expect(mock.notifications[0]?.close).toHaveBeenCalled();
    f.activation("click", mock.notifications[0]?.options.id);
    expect(f.open).not.toHaveBeenCalled();
    expect(f.broker.list()).toHaveLength(1);
  });

  it("hides conflict paths and question choices when previews are disabled", () => {
    const f = fixture();
    f.settings.set("desktop.notificationSettings", { showPreview: false });
    f.request("private", "child", {
      kind: "file_conflict",
      question: "PRIVATE_WORKSPACE_PATH",
      options: [{ label: "PRIVATE_ANSWER", description: "PRIVATE_DESCRIPTION" }],
    });
    const preview = JSON.stringify(mock.notifications[0]?.options);
    for (const value of [
      "Session child",
      "PRIVATE_WORKSPACE_PATH",
      "PRIVATE_ANSWER",
      "PRIVATE_DESCRIPTION",
    ])
      expect(preview).not.toContain(value);
    expect(mock.notifications[0]?.options.actions?.[0]?.text).toBe("处理冲突");
  });

  it("redacts known secrets and bounds the first-question preview", () => {
    const f = fixture();
    const secret = "opaque-question-notification-fixture-secret";
    registerRuntimeSecret(secret);
    f.sessions.set("a", { id: "a", title: secret + "x".repeat(1000) } as SessionView);
    f.request("private", "a", {
      question: secret + "y".repeat(5000),
      options: [{ label: "Proceed", description: "PRIVATE_FULL_OPTION" }],
    });
    const options = mock.notifications[0]?.options;
    expect(JSON.stringify(options)).toContain("[REDACTED]");
    expect(JSON.stringify(options)).not.toContain(secret);
    expect(JSON.stringify(options)).not.toContain("PRIVATE_FULL_OPTION");
    expect(options?.title?.length).toBeLessThanOrEqual(120);
    expect(options?.body?.length).toBeLessThan(600);
  });

  it("retains pending questions when unsupported, delivery fails or the open callback throws", () => {
    const f = fixture();
    mock.supported = false;
    f.request();
    expect(mock.notifications).toHaveLength(0);
    mock.supported = true;
    mock.failShow = true;
    f.service.refreshSettings();
    expect(f.error).toHaveBeenCalled();
    expect(f.broker.list()).toHaveLength(1);
    mock.failShow = false;
    f.service.refreshSettings();
    f.open.mockImplementationOnce(() => {
      throw new Error("Fixture opening failed");
    });
    expect(() => f.activation()).not.toThrow();
    expect(f.error).toHaveBeenCalled();
    expect(f.broker.list()).toHaveLength(1);
    expect(f.resolved).not.toHaveBeenCalled();
  });

  it("ignores forged tags, unknown actions, replies and callbacks after disposal or restart", () => {
    const f = fixture();
    f.request();
    const tag = mock.notifications[0]?.options.id;
    expect(f.activation("click", "forged")).toBe(false);
    f.activation("action", tag, 9);
    f.activation("reply", tag);
    expect(f.open).not.toHaveBeenCalled();
    f.service.dispose();
    f.activation("click", tag);
    mock.notifications[0]?.emit("click");
    expect(f.open).not.toHaveBeenCalled();
    const restarted = fixture();
    restarted.request("new");
    restarted.activation("click", tag);
    expect(restarted.open).not.toHaveBeenCalled();
    expect(restarted.resolved).not.toHaveBeenCalled();
  });

  it("does not deliver new notifications after the window is destroyed", () => {
    const f = fixture();
    f.destroy();
    f.request();
    expect(mock.notifications).toHaveLength(0);
    expect(f.broker.list()).toHaveLength(1);
  });
});
