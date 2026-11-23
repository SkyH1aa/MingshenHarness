import { randomUUID } from "node:crypto";
import type { BrowserWindow, IpcMain, IpcMainEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc";

const transitionError = "快捷对话正在处理输入，未切换窗口。请稍后重试。";

export async function withQuickChatTransition<T>(
  window: Pick<BrowserWindow, "isDestroyed" | "webContents"> | null,
  events: Pick<IpcMain, "on" | "removeListener">,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await lockQuickChatTransition(window, events);
  try {
    return await operation();
  } finally {
    release();
  }
}

export function lockQuickChatTransition(
  window: Pick<BrowserWindow, "isDestroyed" | "webContents"> | null,
  events: Pick<IpcMain, "on" | "removeListener">,
  timeoutMs = 30_000,
): Promise<() => void> {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed())
    return Promise.resolve(() => undefined);
  const contents = window.webContents;
  const requestId = randomUUID();
  let sent = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (!sent || contents.isDestroyed()) return;
    try {
      contents.send(IPC_CHANNELS.quickChatTransition, requestId, false);
    } catch {
      // The renderer may have gone away after the operation settled.
    }
  };

  return new Promise<() => void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      events.removeListener(IPC_CHANNELS.quickChatTransitionAck, acknowledge);
      contents.removeListener("did-finish-load", request);
      contents.removeListener("destroyed", interrupted);
      contents.removeListener("render-process-gone", interrupted);
    };
    const fail = (detail?: string) => {
      cleanup();
      release();
      reject(new Error(detail ? `${transitionError} ${detail.slice(0, 1000)}` : transitionError));
    };
    const acknowledge = (event: IpcMainEvent, id: unknown, error: unknown) => {
      if (
        !sent ||
        id !== requestId ||
        event.sender.id !== contents.id ||
        event.senderFrame !== contents.mainFrame
      )
        return;
      if (error !== undefined && typeof error !== "string") return;
      if (error) return fail(error);
      cleanup();
      resolve(release);
    };
    const interrupted = () => fail();
    const request = () => {
      try {
        sent = true;
        contents.send(IPC_CHANNELS.quickChatTransition, requestId, true);
      } catch {
        fail();
      }
    };
    const timer = setTimeout(() => fail(), timeoutMs);
    events.on(IPC_CHANNELS.quickChatTransitionAck, acknowledge);
    contents.once("destroyed", interrupted);
    contents.once("render-process-gone", interrupted);
    if (contents.isLoadingMainFrame()) contents.once("did-finish-load", request);
    else request();
  });
}
