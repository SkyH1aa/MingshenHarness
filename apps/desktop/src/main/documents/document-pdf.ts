import { randomUUID } from "node:crypto";
import type { BrowserWindow, Session, WebContents } from "electron";
import {
  type DocumentAuthoringRequest,
  MAX_AUTHORED_DOCUMENT_BYTES,
} from "./document-authoring-schema";
import { escapeDocumentHtml } from "./document-rich-content";

const MAX_HTML_BYTES = 50 * 1024 * 1024;
const PRINT_TIMEOUT_MS = 60_000;
const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");
const READY_SCRIPT =
  "Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())]).then(() => undefined)";

export async function printDocumentPdf(
  html: string,
  request: DocumentAuthoringRequest,
  signal: AbortSignal,
): Promise<Buffer> {
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new Error("PDF 渲染内容超过 50 MiB。");
  }
  signal.throwIfAborted();

  let window: BrowserWindow | undefined;
  let contents: WebContents | undefined;
  let isolated: Session | undefined;
  let interrupted = false;
  let interruption: unknown;
  let rejectInterruption: (reason: unknown) => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const destroyWindow = () => {
    if (window && !window.isDestroyed()) window.destroy();
  };
  const interrupt = (reason: unknown) => {
    if (interrupted) return;
    interrupted = true;
    interruption = reason;
    try {
      destroyWindow();
    } finally {
      rejectInterruption(reason);
    }
  };
  const assertActive = () => {
    if (interrupted) throw interruption;
    signal.throwIfAborted();
  };
  const onAbort = () =>
    interrupt(signal.reason ?? new DOMException("PDF 生成已取消。", "AbortError"));
  const onClosed = () => interrupt(new Error("PDF 渲染窗口已关闭。"));
  const onRendererGone = () => interrupt(new Error("PDF 渲染进程已退出。"));
  const blockNavigation = (event: Electron.Event) => event.preventDefault();
  const blockDownload = (event: Electron.Event) => event.preventDefault();
  const timeout = setTimeout(
    () => interrupt(new Error("PDF 生成超时（60 秒）。")),
    PRINT_TIMEOUT_MS,
  );
  timeout.unref();
  signal.addEventListener("abort", onAbort, { once: true });

  const render = async () => {
    const { BrowserWindow: PdfWindow, session } = await import("electron");
    assertActive();
    isolated = session.fromPartition(`mingshen-document-pdf-${randomUUID()}`, { cache: false });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try {
        allowed = ["data:", "blob:", "about:"].includes(new URL(details.url).protocol);
      } catch {
        // Invalid resource URLs are rejected alongside external resources.
      }
      callback({ cancel: !allowed });
    });
    isolated.on("will-download", blockDownload);
    window = new PdfWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        session: isolated,
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
    contents = window.webContents;
    window.once("closed", onClosed);
    contents.on("render-process-gone", onRendererGone);
    contents.on("will-navigate", blockNavigation);
    contents.on("will-frame-navigate", blockNavigation);
    contents.on("will-redirect", blockNavigation);
    contents.on("will-attach-webview", blockNavigation);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    assertActive();
    await contents.executeJavaScript(READY_SCRIPT);
    assertActive();
    const pdf = await contents.printToPDF({
      pageSize: request.page_size ?? "Letter",
      landscape: request.orientation === "landscape",
      preferCSSPageSize: true,
      printBackground: true,
      ...(request.header || request.footer || request.page_numbers
        ? {
            displayHeaderFooter: true,
            headerTemplate: `<div style="font-size:9px;width:100%;text-align:center">${escapeDocumentHtml(request.header ?? "")}</div>`,
            footerTemplate: `<div style="font-size:9px;width:100%;text-align:center">${escapeDocumentHtml(request.footer ?? "")}${request.page_numbers ? ' <span class="pageNumber"></span> / <span class="totalPages"></span>' : ""}</div>`,
          }
        : {}),
    });
    assertActive();
    if (!pdf.length) throw new Error("PDF 生成为空。");
    if (pdf.length > MAX_AUTHORED_DOCUMENT_BYTES) {
      throw new Error("生成的 PDF 超过 25 MiB。");
    }
    if (!pdf.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
      throw new Error("渲染结果不是有效的 PDF 文件。");
    }
    return pdf;
  };

  try {
    if (signal.aborted) onAbort();
    return await Promise.race([render(), stopped]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
    window?.removeListener("closed", onClosed);
    contents?.removeListener("render-process-gone", onRendererGone);
    contents?.removeListener("will-navigate", blockNavigation);
    contents?.removeListener("will-frame-navigate", blockNavigation);
    contents?.removeListener("will-redirect", blockNavigation);
    contents?.removeListener("will-attach-webview", blockNavigation);
    destroyWindow();
    if (isolated) {
      isolated.removeListener("will-download", blockDownload);
      isolated.webRequest.onBeforeRequest(null);
      isolated.setPermissionRequestHandler(null);
      isolated.setPermissionCheckHandler(null);
      // Session cleanup must not delay cancellation while Chromium is shutting down.
      void Promise.allSettled([
        isolated.closeAllConnections(),
        isolated.clearStorageData(),
        isolated.clearCache(),
      ]);
    }
  }
}
