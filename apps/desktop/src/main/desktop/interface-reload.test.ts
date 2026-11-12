import { describe, expect, it, vi } from "vitest";
import { reloadInterfaceWindow } from "./interface-reload";

function fixture() {
  const reload = vi.fn();
  return {
    window: {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, reload },
    },
    activeConversations: 0,
    disposed: false,
    disposing: false,
    installingUpdate: false,
  };
}

describe("interface reload", () => {
  it("reloads only the available main renderer while idle", () => {
    const options = fixture();
    reloadInterfaceWindow(options);
    expect(options.window.webContents.reload).toHaveBeenCalledOnce();
  });

  it("refuses reload for active conversations, send preparation or manual compaction", () => {
    const options = { ...fixture(), activeConversations: 1 };
    expect(() => reloadInterfaceWindow(options)).toThrow("请等待全部任务完成");
    expect(options.window.webContents.reload).not.toHaveBeenCalled();
  });

  it.each(["disposed", "disposing", "installingUpdate"] as const)(
    "refuses reload during %s",
    (state) => {
      const options = { ...fixture(), [state]: true };
      expect(() => reloadInterfaceWindow(options)).toThrow("正在退出或安装更新");
      expect(options.window.webContents.reload).not.toHaveBeenCalled();
    },
  );

  it("does not reload a missing or destroyed main window", () => {
    expect(() => reloadInterfaceWindow({ ...fixture(), window: null })).toThrow("应用窗口不可用");
    const destroyedWindow = fixture();
    destroyedWindow.window.isDestroyed = () => true;
    expect(() => reloadInterfaceWindow(destroyedWindow)).toThrow("应用窗口不可用");
    expect(destroyedWindow.window.webContents.reload).not.toHaveBeenCalled();
    const destroyedRenderer = fixture();
    destroyedRenderer.window.webContents.isDestroyed = () => true;
    expect(() => reloadInterfaceWindow(destroyedRenderer)).toThrow("应用窗口不可用");
    expect(destroyedRenderer.window.webContents.reload).not.toHaveBeenCalled();
  });
});
