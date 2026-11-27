import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS, type MingshenDesktopApi } from "../shared/ipc";

const electron = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
  send: vi.fn(),
  sendSync: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => electron.exposed.set(name, api),
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: (channel: string, listener: (...args: unknown[]) => void) =>
      electron.listeners.set(channel, listener),
    send: electron.send,
    sendSync: electron.sendSync,
  },
}));

import "./index";

describe("companion navigation preload", () => {
  it("forwards preflight synchronously and accepts only an explicit true", () => {
    const api = electron.exposed.get("mingshen") as MingshenDesktopApi;
    electron.sendSync.mockReset();
    electron.sendSync.mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValueOnce(1);
    expect(api.preflightCompanionSessionNavigation("request", "session")).toBe(true);
    expect(electron.sendSync).toHaveBeenLastCalledWith(
      IPC_CHANNELS.companionSessionNavigationPreflight,
      "request",
      "session",
    );
    expect(api.preflightCompanionSessionNavigation("request", "session")).toBe(false);
    expect(api.preflightCompanionSessionNavigation("request", "session")).toBe(false);
  });
});

describe("image asset export preload", () => {
  it("requests export by asset ID only so the main process owns the save dialog", async () => {
    const api = electron.exposed.get("mingshen") as MingshenDesktopApi;
    electron.invoke.mockReset().mockResolvedValue("C:\\Users\\Test\\image.png");

    await expect(api.exportImageStudioAsset("asset-id")).resolves.toBe(
      "C:\\Users\\Test\\image.png",
    );
    expect(electron.invoke).toHaveBeenCalledWith(IPC_CHANNELS.imageStudioExportAsset, "asset-id");
    expect(electron.invoke.mock.calls[0]).toHaveLength(2);
  });

  it("opens a pending remote image by its opaque identifier without passing a URL", async () => {
    const api = electron.exposed.get("mingshen") as MingshenDesktopApi;
    electron.invoke.mockReset().mockResolvedValue(undefined);
    const input = { id: "remote-image-id", requestId: "open-remote-request" };

    await api.openImageStudioRemoteImage(input);

    expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(
      IPC_CHANNELS.imageStudioRemoteOpenExternal,
      input,
    );
    expect(electron.invoke.mock.calls[0]).toHaveLength(2);
  });
});

describe("composer flush preload", () => {
  it("forwards a target and preserves legacy unscoped requests", () => {
    const api = electron.exposed.get("mingshen") as MingshenDesktopApi;
    const receive = electron.listeners.get(IPC_CHANNELS.composerDraftFlushRequest);
    const listener = vi.fn();
    const unsubscribe = api.onComposerDraftFlush(listener);
    receive?.({}, "target-request", "save", "target-chat");
    expect(listener).toHaveBeenLastCalledWith("target-request", "save", "target-chat");
    receive?.({}, "old-request", "shutdown");
    expect(listener).toHaveBeenLastCalledWith("old-request", "shutdown", undefined);
    unsubscribe();
  });

  it("does not broaden malformed targets into unscoped flushes", () => {
    const api = electron.exposed.get("mingshen") as MingshenDesktopApi;
    const receive = electron.listeners.get(IPC_CHANNELS.composerDraftFlushRequest);
    const listener = vi.fn();
    const unsubscribe = api.onComposerDraftFlush(listener);
    for (const target of [null, "", "a".repeat(129), 7])
      receive?.({}, "bad-request", "save", target);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("acknowledges before renderer listeners exist", () => {
    electron.send.mockClear();
    const receive = electron.listeners.get(IPC_CHANNELS.composerDraftFlushRequest);
    receive?.({}, "early-request", "save", "target-chat");
    expect(electron.send).toHaveBeenCalledWith(IPC_CHANNELS.composerDraftFlushAck, "early-request");
  });
});

describe("quick chat transition preload", () => {
  it("holds a request for a renderer that mounts after the early acknowledgement", () => {
    const api = electron.exposed.get("mingshen") as MingshenDesktopApi;
    const receive = electron.listeners.get(IPC_CHANNELS.quickChatTransition);
    const listener = vi.fn();
    electron.send.mockClear();
    receive?.({}, "early-lock", true);
    expect(electron.send).toHaveBeenCalledWith(IPC_CHANNELS.quickChatTransitionAck, "early-lock");
    const unsubscribe = api.onQuickChatTransition(listener);
    expect(listener).toHaveBeenCalledWith("early-lock", true);
    receive?.({}, "early-lock", false);
    expect(listener).toHaveBeenLastCalledWith("early-lock", false);
    unsubscribe();
  });

  it("rejects malformed messages and ignores release of an older lock", () => {
    const api = electron.exposed.get("mingshen") as MingshenDesktopApi;
    const receive = electron.listeners.get(IPC_CHANNELS.quickChatTransition);
    const listener = vi.fn();
    const unsubscribe = api.onQuickChatTransition(listener);
    receive?.({}, "", true);
    receive?.({}, null, true);
    receive?.({}, "malformed", "true");
    expect(listener).not.toHaveBeenCalled();
    receive?.({}, "first", true);
    receive?.({}, "second", true);
    receive?.({}, "first", false);
    expect(listener).toHaveBeenCalledTimes(2);
    receive?.({}, "second", false);
    expect(listener).toHaveBeenLastCalledWith("second", false);
    unsubscribe();
  });

  it("forwards renderer acknowledgement and error", () => {
    const api = electron.exposed.get("mingshen") as MingshenDesktopApi;
    electron.send.mockClear();
    api.acknowledgeQuickChatTransition("lock-id", "not ready");
    expect(electron.send).toHaveBeenCalledWith(
      IPC_CHANNELS.quickChatTransitionAck,
      "lock-id",
      "not ready",
    );
  });
});
