import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest, SessionView } from "../../shared/domain";
import { registerRuntimeSecret } from "../diagnostics/runtime-log";
import { ApprovalBroker } from "../permissions/approval-broker";
import type { Repository } from "../storage/repository";
import { ApprovalNotifications } from "./approval-notifications";

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
      if (mock.failShow) throw new Error("Fixture toast rejected");
    }
  },
}));
const services: ApprovalNotifications[] = [];
beforeEach(() => {
  mock.notifications = [];
  mock.supported = true;
  mock.failShow = false;
});
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});

function fixture() {
  const settings = new Map<string, unknown>();
  const sessions = new Map(
    ["a", "b"].map((id) => [id, { id, title: `Session ${id}` } as SessionView]),
  );
  const repository = {
    getSetting: (key: string) => settings.get(key),
    getSession: (id: string) => sessions.get(id),
  } as unknown as Repository;
  let focused = false;
  let visible = true;
  let minimized = false;
  const window = Object.assign(new EventEmitter(), {
    isFocused: () => focused,
    isVisible: () => visible,
    isMinimized: () => minimized,
    isDestroyed: () => false,
  });
  let service!: ApprovalNotifications;
  const broker = new ApprovalBroker((state) => service?.handle({ type: "approval_state", state }));
  const decide = vi.fn((input) => broker.decide(input));
  const open = vi.fn();
  const error = vi.fn();
  service = new ApprovalNotifications(
    repository,
    window as unknown as BrowserWindow,
    "icon.png",
    broker,
    decide,
    open,
    error,
  );
  services.push(service);
  const request = (id = "first", sessionId = "a", extra: Partial<ApprovalRequest> = {}) => {
    const controller = new AbortController();
    const item: ApprovalRequest = {
      id,
      sessionId,
      runId: `run-${sessionId}`,
      toolCallId: `call-${id}`,
      toolName: "write_file",
      summary: "Write notes.txt",
      detail: "Complete details stay inside the application",
      pathScope: "C:\\fixture\\notes.txt",
      commandPrefix: null,
      risk: "normal",
      createdAt: new Date().toISOString(),
      ...extra,
    };
    const result = broker.request(item, controller.signal);
    void result.catch(() => undefined);
    return { item, controller, result };
  };
  const activation = (index = 0, tag = mock.notifications.at(-1)?.options.id) =>
    service.activate({ type: "action", arguments: `type=action&tag=${tag}`, actionIndex: index });
  return {
    service,
    broker,
    decide,
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
  };
}

describe("Background approval notifications", () => {
  it("shows two actions and approves the exact operation once without granting a session rule", async () => {
    const f = fixture();
    const pending = f.request();
    const toast = mock.notifications[0];
    expect(toast?.options).toMatchObject({
      groupId: "mingshen-approvals",
      actions: [
        { type: "button", text: "批准" },
        { type: "button", text: "拒绝" },
      ],
    });
    f.activation();
    toast?.emit("action", { actionIndex: 0 }, 0);
    expect(await pending.result).toEqual({ approvalId: pending.item.id, decision: "allow_once" });
    expect(f.decide).toHaveBeenCalledTimes(1);
    expect(toast?.close).toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });

  it("rejects with feedback and leaves other concurrent requests pending", async () => {
    const f = fixture();
    const first = f.request();
    const second = f.request("second", "b");
    f.activation(1, mock.notifications[0]?.options.id);
    expect(await first.result).toMatchObject({
      decision: "deny",
      feedback: expect.stringContaining("Windows"),
    });
    expect(f.broker.get(second.item.id)).not.toBeNull();
    f.activation(0, mock.notifications[1]?.options.id);
    expect(await second.result).toMatchObject({ decision: "allow_once" });
  });

  it("does not notify the foreground selected chat until it loses focus", async () => {
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

  it("notifies other chats while the app is foreground, and supports hidden or minimized windows", () => {
    const f = fixture();
    f.focus(true);
    f.service.setActiveSession("a");
    f.request("other", "b");
    expect(mock.notifications).toHaveLength(1);
    f.hide();
    f.request("hidden");
    expect(mock.notifications).toHaveLength(2);
    f.minimize();
    f.request("minimized");
    expect(mock.notifications).toHaveLength(3);
  });

  it("opens the original conversation from the body without deciding", () => {
    const f = fixture();
    f.request();
    f.service.activate({ type: "click", arguments: `tag=${mock.notifications[0]?.options.id}` });
    expect(f.open).toHaveBeenCalledWith("a");
    expect(f.decide).not.toHaveBeenCalled();
  });

  it("invalidates manual, cancelled, finished and deleted request routes", () => {
    const f = fixture();
    const first = f.request();
    const tag = mock.notifications[0]?.options.id;
    f.broker.decide({ approvalId: first.item.id, decision: "deny" });
    f.activation(0, tag);
    expect(f.decide).not.toHaveBeenCalled();
    const cancelled = f.request("cancelled");
    const cancelledTag = mock.notifications.at(-1)?.options.id;
    cancelled.controller.abort();
    f.activation(0, cancelledTag);
    expect(f.decide).not.toHaveBeenCalled();
    const ended = f.request("ended");
    const endedTag = mock.notifications.at(-1)?.options.id;
    f.service.handle({ type: "run_interrupted", sessionId: "a", runId: ended.item.runId });
    f.activation(0, endedTag);
    expect(f.decide).not.toHaveBeenCalled();
    f.request("deleted");
    const deletedTag = mock.notifications.at(-1)?.options.id;
    f.sessions.delete("a");
    f.activation(0, deletedTag);
    expect(f.decide).not.toHaveBeenCalled();
  });

  it("does not let an old route approve a replacement request with a reused ID", () => {
    const f = fixture();
    const first = f.request();
    const tag = mock.notifications[0]?.options.id;
    first.controller.abort();
    f.request("first", "a", { runId: "different-run", toolCallId: "different-call" });
    f.activation(0, tag);
    expect(f.decide).not.toHaveBeenCalled();
  });

  it("waits during automatic review and notifies when review fails back to manual", () => {
    const f = fixture();
    const first = f.request("auto", "a", { review: { state: "reviewing" } });
    expect(mock.notifications).toHaveLength(0);
    f.broker.update(first.item.id, { state: "manual", reason: "Both reviewers failed" });
    expect(mock.notifications).toHaveLength(1);
    const old = mock.notifications[0]?.options.id;
    f.broker.update(first.item.id, { state: "reviewing" });
    f.activation(0, old);
    expect(f.decide).not.toHaveBeenCalled();
    f.broker.update(first.item.id, { state: "manual", reason: "Retry failed" });
    expect(mock.notifications).toHaveLength(2);
  });

  it("honors native/approval switches, preview privacy and sound, retaining old profiles' default", () => {
    const f = fixture();
    f.settings.set("desktop.notificationSettings", { nativeEnabled: false });
    f.request();
    expect(mock.notifications).toHaveLength(0);
    f.settings.set("desktop.notificationSettings", { nativeEnabled: true, approvalEnabled: false });
    f.service.refreshSettings();
    expect(mock.notifications).toHaveLength(0);
    f.settings.set("desktop.notificationSettings", {
      nativeEnabled: true,
      showPreview: false,
      sound: false,
    });
    f.service.refreshSettings();
    expect(mock.notifications.at(-1)?.options).toMatchObject({
      title: "Mingshen Harness",
      body: "等待批准\n批准仅允许本次操作。",
      silent: true,
    });
    f.settings.set("desktop.locale", "en");
    f.service.refreshSettings();
    expect(mock.notifications.at(-1)?.options.actions?.[0]?.text).toBe("Approve once");
    expect(mock.notifications.at(-1)?.options.body).toBe(
      "Approval required\nApprove allows this operation once.",
    );
    f.settings.set("desktop.notificationSettings", { approvalEnabled: false });
    f.service.refreshSettings();
    expect(mock.notifications.at(-1)?.close).toHaveBeenCalled();
  });

  it("redacts known credentials and omits full arguments and details from previews", () => {
    const f = fixture();
    registerRuntimeSecret("opaque-notification-fixture-secret");
    f.sessions.set("a", { id: "a", title: "opaque-notification-fixture-secret" } as SessionView);
    f.request("private", "a", {
      summary: "opaque-notification-fixture-secret",
      detail: "PRIVATE_FULL_COMMAND",
      reviewInput: "PRIVATE_FILE_CONTENT",
    });
    const options = JSON.stringify(mock.notifications[0]?.options);
    expect(options).toContain("[REDACTED]");
    for (const text of [
      "opaque-notification-fixture-secret",
      "PRIVATE_FULL_COMMAND",
      "PRIVATE_FILE_CONTENT",
    ])
      expect(options).not.toContain(text);
  });

  it("fails closed when Windows is unsupported, delivery fails or decision throws", () => {
    const f = fixture();
    mock.supported = false;
    const pending = f.request();
    expect(mock.notifications).toHaveLength(0);
    expect(f.broker.get(pending.item.id)).not.toBeNull();
    mock.supported = true;
    mock.failShow = true;
    f.service.refreshSettings();
    expect(f.error).toHaveBeenCalled();
    expect(f.decide).not.toHaveBeenCalled();
    mock.failShow = false;
    f.service.refreshSettings();
    f.decide.mockImplementationOnce(() => {
      throw new Error("Fixture decision rejected");
    });
    f.activation();
    expect(f.open).toHaveBeenCalledWith("a");
    expect(f.broker.get(pending.item.id)).not.toBeNull();
  });

  it("ignores unknown tags, invalid actions, replay after restart and callbacks after disposal", () => {
    const f = fixture();
    f.request();
    const tag = mock.notifications[0]?.options.id;
    expect(f.activation(0, "forged")).toBe(false);
    f.activation(9);
    expect(f.decide).not.toHaveBeenCalled();
    f.service.dispose();
    f.activation(0, tag);
    expect(f.decide).not.toHaveBeenCalled();
    const next = fixture();
    next.request("new");
    next.activation(0, tag);
    expect(next.decide).not.toHaveBeenCalled();
  });
});
