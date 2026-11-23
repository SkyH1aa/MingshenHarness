import { EventEmitter } from "node:events";
import type { BrowserWindow, IpcMain } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../shared/ipc";
import { lockQuickChatTransition, withQuickChatTransition } from "./quick-chat-transition";

function fixture() {
  const events = new EventEmitter();
  const contents = Object.assign(new EventEmitter(), {
    id: 17,
    mainFrame: {},
    isDestroyed: vi.fn(() => false),
    isLoadingMainFrame: vi.fn(() => false),
    send: vi.fn(),
  });
  const window = { isDestroyed: vi.fn(() => false), webContents: contents };
  const lock = (timeout = 1000) =>
    lockQuickChatTransition(
      window as unknown as BrowserWindow,
      events as unknown as IpcMain,
      timeout,
    );
  const acknowledge = (error?: unknown, id = contents.send.mock.calls.at(-1)?.[1]) =>
    events.emit(
      IPC_CHANNELS.quickChatTransitionAck,
      { sender: contents, senderFrame: contents.mainFrame },
      id,
      error,
    );
  return { events, contents, window, lock, acknowledge };
}

afterEach(() => vi.useRealTimers());

describe("quick chat transition lock", () => {
  it("waits for the matching renderer before switching and releases once", async () => {
    const f = fixture();
    const settled = vi.fn();
    const pending = f.lock().then((release) => {
      settled();
      return release;
    });
    expect(f.contents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.quickChatTransition,
      expect.any(String),
      true,
    );
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    const id = f.contents.send.mock.calls[0]?.[1];
    f.acknowledge();
    const release = await pending;
    expect(settled).toHaveBeenCalledOnce();
    expect(f.events.listenerCount(IPC_CHANNELS.quickChatTransitionAck)).toBe(0);
    release();
    release();
    expect(f.contents.send).toHaveBeenCalledTimes(2);
    expect(f.contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.quickChatTransition, id, false);
  });

  it("ignores stale IDs, other windows, child frames and invalid errors", async () => {
    const f = fixture();
    const settled = vi.fn();
    const pending = f.lock().then((release) => {
      settled();
      return release;
    });
    const id = f.contents.send.mock.calls[0]?.[1];
    const emit = (sender: unknown, frame: unknown, request: unknown, error?: unknown) =>
      f.events.emit(
        IPC_CHANNELS.quickChatTransitionAck,
        { sender, senderFrame: frame },
        request,
        error,
      );
    emit(f.contents, f.contents.mainFrame, "older-id");
    emit({ id: 99 }, f.contents.mainFrame, id);
    emit(f.contents, {}, id);
    emit(f.contents, f.contents.mainFrame, id, {});
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    f.acknowledge();
    (await pending)();
  });

  it("waits for a loading renderer and then requests its lock", async () => {
    const f = fixture();
    f.contents.isLoadingMainFrame.mockReturnValue(true);
    const pending = f.lock();
    expect(f.contents.send).not.toHaveBeenCalled();
    f.contents.emit("did-finish-load");
    expect(f.contents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.quickChatTransition,
      expect.any(String),
      true,
    );
    f.acknowledge();
    (await pending)();
    expect(f.contents.listenerCount("did-finish-load")).toBe(0);
  });

  it("rejects unsaved message edits and unlocks without permitting a switch or archive", async () => {
    const f = fixture();
    const switchSession = vi.fn();
    const pending = f.lock().then((release) => {
      switchSession();
      release();
    });
    const assertion = expect(pending).rejects.toThrow("存在未保存的消息编辑");
    const id = f.contents.send.mock.calls[0]?.[1];
    f.acknowledge("存在未保存的消息编辑，请先提交或取消。");
    await assertion;
    expect(switchSession).not.toHaveBeenCalled();
    expect(f.contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.quickChatTransition, id, false);
    expect(f.events.listenerCount(IPC_CHANNELS.quickChatTransitionAck)).toBe(0);
  });

  it("times out, unlocks, and ignores a late acknowledgement", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.lock();
    const assertion = expect(pending).rejects.toThrow("未切换窗口");
    const id = f.contents.send.mock.calls[0]?.[1];
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(f.contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.quickChatTransition, id, false);
    f.acknowledge(undefined, id);
    expect(f.events.listenerCount(IPC_CHANNELS.quickChatTransitionAck)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["destroyed", "render-process-gone"])(
    "rejects and cleans up when the renderer emits %s",
    async (event) => {
      const f = fixture();
      const pending = f.lock();
      const assertion = expect(pending).rejects.toThrow("未切换窗口");
      f.contents.emit(event);
      await assertion;
      expect(f.events.listenerCount(IPC_CHANNELS.quickChatTransitionAck)).toBe(0);
      expect(f.contents.listenerCount("destroyed")).toBe(0);
      expect(f.contents.listenerCount("render-process-gone")).toBe(0);
    },
  );

  it("does not wait if there is no live window", async () => {
    const f = fixture();
    (await lockQuickChatTransition(null, f.events as unknown as IpcMain))();
    f.window.isDestroyed.mockReturnValue(true);
    (await f.lock())();
    f.window.isDestroyed.mockReturnValue(false);
    f.contents.isDestroyed.mockReturnValue(true);
    (await f.lock())();
    expect(f.contents.send).not.toHaveBeenCalled();
  });

  it("rejects a failed IPC send and cleans up its listeners", async () => {
    const f = fixture();
    f.contents.send.mockImplementation(() => {
      throw new Error("destroyed");
    });
    await expect(f.lock()).rejects.toThrow("未切换窗口");
    expect(f.events.listenerCount(IPC_CHANNELS.quickChatTransitionAck)).toBe(0);
  });

  it("keeps the renderer locked through an asynchronous archive commit and event", async () => {
    const f = fixture();
    let complete = () => {};
    const wait = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const steps: string[] = [];
    const operation = withQuickChatTransition(
      f.window as unknown as BrowserWindow,
      f.events as unknown as IpcMain,
      async () => {
        steps.push("flush");
        await wait;
        steps.push("commit", "broadcast");
        return "archived";
      },
    );
    const id = f.contents.send.mock.calls[0]?.[1];
    expect(steps).toEqual([]);
    f.acknowledge();
    await Promise.resolve();
    expect(steps).toEqual(["flush"]);
    expect(f.contents.send).toHaveBeenCalledTimes(1);
    complete();
    expect(await operation).toBe("archived");
    expect(steps).toEqual(["flush", "commit", "broadcast"]);
    expect(f.contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.quickChatTransition, id, false);
  });

  it("releases the renderer when archive persistence fails", async () => {
    const f = fixture();
    const operation = withQuickChatTransition(
      f.window as unknown as BrowserWindow,
      f.events as unknown as IpcMain,
      async () => {
        throw new Error("draft conflict");
      },
    );
    const id = f.contents.send.mock.calls[0]?.[1];
    f.acknowledge();
    await expect(operation).rejects.toThrow("draft conflict");
    expect(f.contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.quickChatTransition, id, false);
  });
});
