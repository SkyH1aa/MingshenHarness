import { randomUUID } from "node:crypto";
import type { BrowserWindow, IpcMain, IpcMainEvent } from "electron";
import type { ComposerDraftFlushPurpose } from "../../shared/ipc";
import { IPC_CHANNELS } from "../../shared/ipc";

const flushError = "草稿尚未保存，已取消退出或重载。请返回输入框重试保存。";

export function flushComposerDrafts(
  window: Pick<BrowserWindow, "isDestroyed" | "webContents"> | null,
  events: Pick<IpcMain, "on" | "removeListener">,
  timeoutMs = 30_000,
  purpose: ComposerDraftFlushPurpose = "shutdown",
  sessionId?: string,
): Promise<void> {
  if (sessionId !== undefined && (!sessionId || sessionId.length > 128))
    return Promise.reject(new Error("Invalid session ID."));
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve();
  const contents = window.webContents;
  const requestId = randomUUID();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      events.removeListener(IPC_CHANNELS.composerDraftFlushAck, acknowledge);
      contents.removeListener("destroyed", interrupted);
      contents.removeListener("render-process-gone", interrupted);
    };
    const finish = (error?: string) => {
      cleanup();
      if (error) reject(new Error(error));
      else resolve();
    };
    const acknowledge = (event: IpcMainEvent, id: unknown, error: unknown) => {
      if (
        id !== requestId ||
        event.sender.id !== contents.id ||
        event.senderFrame !== contents.mainFrame
      )
        return;
      if (error !== undefined && typeof error !== "string") return;
      finish(error ? `${flushError} ${error.slice(0, 1000)}` : undefined);
    };
    const interrupted = () => finish(flushError);
    const timer = setTimeout(() => finish(flushError), timeoutMs);
    events.on(IPC_CHANNELS.composerDraftFlushAck, acknowledge);
    contents.once("destroyed", interrupted);
    contents.once("render-process-gone", interrupted);
    try {
      if (sessionId === undefined)
        contents.send(IPC_CHANNELS.composerDraftFlushRequest, requestId, purpose);
      else contents.send(IPC_CHANNELS.composerDraftFlushRequest, requestId, purpose, sessionId);
    } catch {
      finish(flushError);
    }
  });
}
