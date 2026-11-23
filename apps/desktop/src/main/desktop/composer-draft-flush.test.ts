import { EventEmitter } from "node:events";
import type { BrowserWindow, IpcMain } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../shared/ipc";
import { flushComposerDrafts } from "./composer-draft-flush";

function fixture() {
  const events = new EventEmitter();
  const contents = Object.assign(new EventEmitter(), {
    id: 17,
    mainFrame: {},
    isDestroyed: (): boolean => false,
    send: vi.fn(),
  });
  const window = { isDestroyed: () => false, webContents: contents };
  const flush = (timeout = 1000) =>
    flushComposerDrafts(window as unknown as BrowserWindow, events as unknown as IpcMain, timeout);
  const acknowledge = (error?: string) =>
    events.emit(
      IPC_CHANNELS.composerDraftFlushAck,
      { sender: contents, senderFrame: contents.mainFrame },
      contents.send.mock.calls.at(-1)?.[1],
      error,
    );
  return { events, contents, window, flush, acknowledge };
}

afterEach(() => vi.useRealTimers());

describe("composer draft flush before closing", () => {
  it("waits for the matching main-frame acknowledgement and releases its listeners", async () => {
    const f = fixture();
    const settled = vi.fn();
    const pending = f.flush().then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(f.contents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.composerDraftFlushRequest,
      expect.any(String),
      "shutdown",
    );
    f.acknowledge();
    await pending;
    expect(settled).toHaveBeenCalledOnce();
    expect(f.events.listenerCount(IPC_CHANNELS.composerDraftFlushAck)).toBe(0);
    expect(f.contents.listenerCount("destroyed")).toBe(0);
    expect(f.contents.listenerCount("render-process-gone")).toBe(0);
  });

  it("ignores stale IDs, other windows, child frames and invalid acknowledgements", async () => {
    const f = fixture();
    const settled = vi.fn();
    const pending = f.flush().then(settled);
    const id = f.contents.send.mock.calls.at(-1)?.[1];
    const emit = (sender: unknown, frame: unknown, request: unknown, error?: unknown) =>
      f.events.emit(
        IPC_CHANNELS.composerDraftFlushAck,
        { sender, senderFrame: frame },
        request,
        error,
      );
    emit(f.contents, f.contents.mainFrame, "old-request");
    emit({ id: 99 }, f.contents.mainFrame, id);
    emit(f.contents, {}, id);
    emit(f.contents, f.contents.mainFrame, id, {});
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    f.acknowledge();
    await pending;
  });

  it("keeps simultaneous barriers independent", async () => {
    const f = fixture();
    const first = f.flush();
    const firstId = f.contents.send.mock.calls[0]?.[1];
    const secondSettled = vi.fn();
    const second = f.flush().then(secondSettled);
    f.events.emit(
      IPC_CHANNELS.composerDraftFlushAck,
      { sender: f.contents, senderFrame: f.contents.mainFrame },
      firstId,
    );
    await first;
    expect(secondSettled).not.toHaveBeenCalled();
    f.acknowledge();
    await second;
    expect(f.events.listenerCount(IPC_CHANNELS.composerDraftFlushAck)).toBe(0);
  });

  it.each(["save", "interface-reload"] as const)(
    "passes the %s purpose through the barrier",
    async (purpose) => {
      const f = fixture();
      const pending = flushComposerDrafts(
        f.window as unknown as BrowserWindow,
        f.events as unknown as IpcMain,
        1000,
        purpose,
      );
      expect(f.contents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.composerDraftFlushRequest,
        expect.any(String),
        purpose,
      );
      f.acknowledge();
      await pending;
    },
  );

  it("includes the target session only for a targeted flush", async () => {
    const f = fixture();
    const pending = flushComposerDrafts(
      f.window as unknown as BrowserWindow,
      f.events as unknown as IpcMain,
      1000,
      "save",
      "target-chat",
    );
    expect(f.contents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.composerDraftFlushRequest,
      expect.any(String),
      "save",
      "target-chat",
    );
    f.acknowledge();
    await pending;
    expect(f.events.listenerCount(IPC_CHANNELS.composerDraftFlushAck)).toBe(0);
  });

  it.each(["", "a".repeat(129)])(
    "rejects an invalid target without sending a request",
    async (id) => {
      const f = fixture();
      await expect(
        flushComposerDrafts(
          f.window as unknown as BrowserWindow,
          f.events as unknown as IpcMain,
          1000,
          "save",
          id,
        ),
      ).rejects.toThrow("Invalid session ID");
      expect(f.contents.send).not.toHaveBeenCalled();
      expect(f.events.listenerCount(IPC_CHANNELS.composerDraftFlushAck)).toBe(0);
    },
  );

  it("surfaces renderer persistence failures instead of accepting a failed save", async () => {
    const f = fixture();
    const pending = f.flush();
    const assertion = expect(pending).rejects.toThrow("storage full");
    f.acknowledge("storage full");
    await assertion;
    expect(f.events.listenerCount(IPC_CHANNELS.composerDraftFlushAck)).toBe(0);
  });

  it("fails a missing acknowledgement and cleans up the timeout", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.flush();
    const assertion = expect(pending).rejects.toThrow("已取消退出或重载");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(f.events.listenerCount(IPC_CHANNELS.composerDraftFlushAck)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["destroyed", "render-process-gone"])(
    "fails when the renderer is interrupted by %s",
    async (event) => {
      const f = fixture();
      const pending = f.flush();
      const assertion = expect(pending).rejects.toThrow("草稿尚未保存");
      f.contents.emit(event);
      await assertion;
      expect(f.events.listenerCount(IPC_CHANNELS.composerDraftFlushAck)).toBe(0);
    },
  );

  it("does not wait when there is no live renderer", async () => {
    const f = fixture();
    await flushComposerDrafts(null, f.events as unknown as IpcMain);
    f.window.isDestroyed = () => true;
    await f.flush();
    f.window.isDestroyed = () => false;
    f.contents.isDestroyed = () => true;
    await f.flush();
    expect(f.contents.send).not.toHaveBeenCalled();
  });

  it("rejects if sending the flush request itself fails", async () => {
    const f = fixture();
    f.contents.send.mockImplementation(() => {
      throw new Error("destroyed");
    });
    await expect(f.flush()).rejects.toThrow("草稿尚未保存");
    expect(f.events.listenerCount(IPC_CHANNELS.composerDraftFlushAck)).toBe(0);
  });
});
