interface InterfaceWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    reload(): void;
  };
}

export function reloadInterfaceWindow(options: {
  window: InterfaceWindow | null;
  activeConversations: number;
  disposed: boolean;
  disposing: boolean;
  installingUpdate: boolean;
}): void {
  if (options.disposed || options.disposing || options.installingUpdate)
    throw new Error("应用正在退出或安装更新，请稍后重载界面。");
  if (options.activeConversations > 0)
    throw new Error("有会话正在运行或准备中，请等待全部任务完成后重载界面。");
  if (!options.window || options.window.isDestroyed() || options.window.webContents.isDestroyed())
    throw new Error("应用窗口不可用，请重新启动应用。");
  options.window.webContents.reload();
}
