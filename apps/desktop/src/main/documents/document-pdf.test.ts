import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentAuthoringSchema } from "./document-authoring-schema";
import { printDocumentPdf } from "./document-pdf";

type RequestListener = (
  details: { url: string },
  callback: (response: { cancel: boolean }) => void,
) => void;
type PermissionListener = (
  contents: unknown,
  permission: string,
  callback: (allowed: boolean) => void,
) => void;
type PdfSession = EventEmitter & {
  request: RequestListener | null;
  permissionRequest: PermissionListener | null;
  permissionCheck: (() => boolean) | null;
  webRequest: { onBeforeRequest: ReturnType<typeof vi.fn> };
  setPermissionRequestHandler: ReturnType<typeof vi.fn>;
  setPermissionCheckHandler: ReturnType<typeof vi.fn>;
  closeAllConnections: ReturnType<typeof vi.fn>;
  clearStorageData: ReturnType<typeof vi.fn>;
  clearCache: ReturnType<typeof vi.fn>;
};
type PdfContents = EventEmitter & {
  executeJavaScript: ReturnType<typeof vi.fn>;
  printToPDF: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
};
type PdfWindow = EventEmitter & {
  options: Electron.BrowserWindowConstructorOptions;
  webContents: PdfContents;
  loadURL: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
};
const mock = vi.hoisted(() => ({
  windows: [] as PdfWindow[],
  sessions: [] as PdfSession[],
  fromPartition: vi.fn(),
  load: vi.fn<(url: string) => Promise<void>>(),
  ready: vi.fn<(script: string) => Promise<void>>(),
  print: vi.fn<(options: Electron.PrintToPDFOptions) => Promise<Buffer>>(),
}));

vi.mock("electron", async () => {
  const { EventEmitter: MockEmitter } = await import("node:events");
  class IsolatedSession extends MockEmitter {
    request: RequestListener | null = null;
    permissionRequest: PermissionListener | null = null;
    permissionCheck: (() => boolean) | null = null;
    webRequest = {
      onBeforeRequest: vi.fn((listener: RequestListener | null) => {
        this.request = listener;
      }),
    };
    setPermissionRequestHandler = vi.fn((listener: PermissionListener | null) => {
      this.permissionRequest = listener;
    });
    setPermissionCheckHandler = vi.fn((listener: (() => boolean) | null) => {
      this.permissionCheck = listener;
    });
    closeAllConnections = vi.fn(async () => undefined);
    clearStorageData = vi.fn(async () => undefined);
    clearCache = vi.fn(async () => undefined);
  }
  class Contents extends MockEmitter {
    executeJavaScript = vi.fn((script: string) => mock.ready(script));
    printToPDF = vi.fn((options: Electron.PrintToPDFOptions) => mock.print(options));
    setWindowOpenHandler = vi.fn();
  }
  class Window extends MockEmitter {
    webContents = new Contents();
    destroyed = false;
    loadURL = vi.fn((url: string) => mock.load(url));
    destroy = vi.fn(() => {
      this.destroyed = true;
      this.emit("closed");
    });
    isDestroyed = () => this.destroyed;
    constructor(readonly options: Electron.BrowserWindowConstructorOptions) {
      super();
      mock.windows.push(this);
    }
  }
  return {
    BrowserWindow: Window,
    session: {
      fromPartition: (partition: string, options: Electron.FromPartitionOptions) => {
        mock.fromPartition(partition, options);
        const isolated = new IsolatedSession();
        mock.sessions.push(isolated);
        return isolated;
      },
    },
  };
});

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function request(orientation: "portrait" | "landscape" = "portrait") {
  return documentAuthoringSchema.parse({
    path: "report.pdf",
    page_size: "Letter",
    orientation,
    blocks: [{ type: "paragraph", text: "Report" }],
  });
}

async function flushUntil(condition: () => boolean) {
  for (let index = 0; index < 100 && !condition(); index++) await Promise.resolve();
  expect(condition()).toBe(true);
}

function expectCleanedUp() {
  const window = mock.windows[0];
  const isolated = mock.sessions[0];
  expect(window?.isDestroyed()).toBe(true);
  expect(window?.destroy).toHaveBeenCalledTimes(1);
  expect(window?.listenerCount("closed")).toBe(0);
  expect(window?.webContents.eventNames()).toEqual([]);
  expect(isolated?.listenerCount("will-download")).toBe(0);
  expect(isolated?.request).toBeNull();
  expect(isolated?.permissionRequest).toBeNull();
  expect(isolated?.permissionCheck).toBeNull();
  expect(isolated?.closeAllConnections).toHaveBeenCalledExactlyOnceWith();
  expect(isolated?.clearStorageData).toHaveBeenCalledExactlyOnceWith();
  expect(isolated?.clearCache).toHaveBeenCalledExactlyOnceWith();
}

beforeEach(() => {
  mock.windows.length = 0;
  mock.sessions.length = 0;
  mock.fromPartition.mockReset();
  mock.load.mockReset().mockResolvedValue(undefined);
  mock.ready.mockReset().mockResolvedValue(undefined);
  mock.print.mockReset().mockResolvedValue(Buffer.from("%PDF-fixture"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Isolated PDF printing", () => {
  it("escapes requested headers and footers and inserts native PDF page counters", async () => {
    await printDocumentPdf(
      "<p>Report</p>",
      { ...request(), header: "<header>&", footer: "Footer", page_numbers: true },
      new AbortController().signal,
    );
    expect(mock.print).toHaveBeenCalledWith(
      expect.objectContaining({
        displayHeaderFooter: true,
        headerTemplate: expect.stringContaining("&lt;header&gt;&amp;"),
        footerTemplate: expect.stringContaining('class="pageNumber"'),
      }),
    );
    expectCleanedUp();
  });
  it("prints with a unique memory session and fixed font/image readiness script", async () => {
    const html = "<!doctype html><title>Report</title><p>Ready</p>";
    const pdf = await printDocumentPdf(html, request("landscape"), new AbortController().signal);
    expect(pdf.toString()).toBe("%PDF-fixture");
    expect(mock.fromPartition).toHaveBeenCalledWith(
      expect.stringMatching(/^mingshen-document-pdf-[0-9a-f-]{36}$/),
      { cache: false },
    );
    expect(mock.windows[0]?.options).toEqual({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        session: mock.sessions[0],
        javascript: true,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
      },
    });
    expect(mock.load).toHaveBeenCalledExactlyOnceWith(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    expect(mock.ready).toHaveBeenCalledExactlyOnceWith(
      "Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())]).then(() => undefined)",
    );
    expect(mock.print).toHaveBeenCalledExactlyOnceWith({
      pageSize: "Letter",
      landscape: true,
      preferCSSPageSize: true,
      printBackground: true,
    });
    expectCleanedUp();
    await printDocumentPdf(html, request(), new AbortController().signal);
    expect(mock.fromPartition.mock.calls[0]?.[0]).not.toBe(mock.fromPartition.mock.calls[1]?.[0]);
  });

  it("blocks external resources, permissions, navigation, new windows and downloads", async () => {
    const loading = deferred<void>();
    mock.load.mockReturnValueOnce(loading.promise);
    const printing = printDocumentPdf("<p>Report</p>", request(), new AbortController().signal);
    await flushUntil(() => mock.windows.length === 1);
    const isolated = mock.sessions[0];
    const window = mock.windows[0];
    expect(isolated).toBeDefined();
    expect(window).toBeDefined();
    for (const url of [
      "https://example.test/asset.png",
      "http://127.0.0.1/private",
      "file:///C:/Users/ASUS/private.txt",
      "ftp://example.test/file",
      "javascript:alert(1)",
      "invalid",
    ]) {
      const callback = vi.fn();
      isolated?.request?.({ url }, callback);
      expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: true });
    }
    for (const url of ["data:image/png;base64,AA==", "blob:null/asset", "about:blank"]) {
      const callback = vi.fn();
      isolated?.request?.({ url }, callback);
      expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: false });
    }
    const permission = vi.fn();
    isolated?.permissionRequest?.({}, "media", permission);
    expect(permission).toHaveBeenCalledExactlyOnceWith(false);
    expect(isolated?.permissionCheck?.()).toBe(false);
    for (const name of [
      "will-navigate",
      "will-frame-navigate",
      "will-redirect",
      "will-attach-webview",
    ]) {
      const event = { preventDefault: vi.fn() };
      window?.webContents.emit(name, event);
      expect(event.preventDefault).toHaveBeenCalledExactlyOnceWith();
    }
    const openHandler = window?.webContents.setWindowOpenHandler.mock.calls[0]?.[0];
    expect(openHandler?.({ url: "https://example.test/" })).toEqual({ action: "deny" });
    const download = { preventDefault: vi.fn() };
    isolated?.emit("will-download", download);
    expect(download.preventDefault).toHaveBeenCalledExactlyOnceWith();
    loading.resolve();
    await printing;
    expectCleanedUp();
  });

  it("rejects an already cancelled request without creating a renderer", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Stopped before rendering"));
    await expect(printDocumentPdf("<p>Report</p>", request(), controller.signal)).rejects.toThrow(
      "Stopped before rendering",
    );
    expect(mock.fromPartition).not.toHaveBeenCalled();
    expect(mock.windows).toHaveLength(0);
  });

  it.each(["load", "ready", "print"] as const)(
    "cancels immediately during %s and prevents late continuation",
    async (phase) => {
      const pending = deferred<never>();
      mock[phase].mockReturnValueOnce(pending.promise);
      const controller = new AbortController();
      const printing = printDocumentPdf("<p>Report</p>", request(), controller.signal);
      const rejection = expect(printing).rejects.toThrow(`Stopped during ${phase}`);
      await flushUntil(() => mock[phase].mock.calls.length === 1);
      controller.abort(new Error(`Stopped during ${phase}`));
      expect(mock.windows[0]?.isDestroyed()).toBe(true);
      await rejection;
      expectCleanedUp();
      pending.reject(new Error("Late renderer failure"));
      await Promise.resolve();
      if (phase !== "print") expect(mock.print).not.toHaveBeenCalled();
    },
  );

  it.each(["load", "print"] as const)("destroys a stalled %s after 60 seconds", async (phase) => {
    vi.useFakeTimers();
    mock[phase].mockReturnValueOnce(new Promise<never>(() => undefined));
    const printing = printDocumentPdf("<p>Report</p>", request(), new AbortController().signal);
    const rejection = expect(printing).rejects.toThrow("60 秒");
    await flushUntil(() => mock[phase].mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    expectCleanedUp();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["load", "ready", "print"] as const)("cleans up when %s fails", async (phase) => {
    mock[phase].mockRejectedValueOnce(new Error(`${phase} failed`));
    await expect(
      printDocumentPdf("<p>Report</p>", request(), new AbortController().signal),
    ).rejects.toThrow(`${phase} failed`);
    expectCleanedUp();
  });

  it.each(["closed", "render-process-gone"] as const)(
    "stops waiting when the renderer emits %s",
    async (event) => {
      mock.load.mockReturnValueOnce(new Promise<never>(() => undefined));
      const printing = printDocumentPdf("<p>Report</p>", request(), new AbortController().signal);
      const rejection = expect(printing).rejects.toThrow(
        event === "closed" ? "渲染窗口已关闭" : "渲染进程已退出",
      );
      await flushUntil(() => mock.windows.length === 1);
      if (event === "closed") mock.windows[0]?.emit(event);
      else mock.windows[0]?.webContents.emit(event);
      await rejection;
      expectCleanedUp();
    },
  );

  it("rejects oversized HTML before opening Electron", async () => {
    await expect(
      printDocumentPdf("x".repeat(50 * 1024 * 1024 + 1), request(), new AbortController().signal),
    ).rejects.toThrow("50 MiB");
    expect(mock.fromPartition).not.toHaveBeenCalled();
    expect(mock.windows).toHaveLength(0);
  });

  it.each([
    { buffer: Buffer.alloc(0), error: "PDF 生成为空" },
    { buffer: Buffer.alloc(25 * 1024 * 1024 + 1), error: "25 MiB" },
    { buffer: Buffer.from("Not a PDF file"), error: "不是有效的 PDF" },
  ])("rejects invalid output: $error", async ({ buffer, error }) => {
    mock.print.mockResolvedValueOnce(buffer);
    await expect(
      printDocumentPdf("<p>Report</p>", request(), new AbortController().signal),
    ).rejects.toThrow(error);
    expectCleanedUp();
  });
});
