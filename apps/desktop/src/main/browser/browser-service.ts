import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { webContents as electronWebContents, type WebContents } from "electron";
import type {
  BrowserProvider,
  BrowserStatus,
  ChatStreamEvent,
  ToolResultImage,
} from "../../shared/domain";
import { normalizeBrowserUrl } from "./browser-url";

interface BrowserSession {
  provider: BrowserProvider;
  guest: WebContents | null;
  approvedLocalFileUrl: string | null;
  pending: {
    resolve: (status: BrowserStatus) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null;
}

interface BrowserToolResult {
  output: string;
  isError: boolean;
  images?: ToolResultImage[];
}

export class BrowserService {
  private readonly sessions = new Map<string, BrowserSession>();

  constructor(
    private readonly captureRoot: string,
    private readonly emit: (event: ChatStreamEvent) => void,
    private readonly getWorkspacePath: (sessionId: string) => string | null = () => null,
  ) {}

  async open(
    sessionId: string,
    provider: BrowserProvider,
    url = "about:blank",
  ): Promise<BrowserStatus> {
    const normalizedUrl = await normalizeBrowserUrl(url, this.getWorkspacePath(sessionId));
    const existing = this.sessions.get(sessionId);
    if (existing?.provider === provider && existing.guest && !existing.guest.isDestroyed()) {
      existing.approvedLocalFileUrl = normalizedUrl.startsWith("file:") ? normalizedUrl : null;
      await existing.guest.loadURL(normalizedUrl);
      return this.statusFromGuest(sessionId, existing.guest, provider);
    }
    if (existing) {
      this.closeSession(sessionId);
    }

    return await new Promise<BrowserStatus>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.sessions.delete(sessionId);
        reject(new Error("内嵌浏览器面板没有在限定时间内完成注册。"));
      }, 15_000);
      this.sessions.set(sessionId, {
        provider,
        guest: null,
        approvedLocalFileUrl: normalizedUrl.startsWith("file:") ? normalizedUrl : null,
        pending: { resolve, reject, timeout },
      });
      this.emit({
        type: "browser_open_requested",
        sessionId,
        provider,
        url: normalizedUrl,
      });
    });
  }

  async register(
    sessionId: string,
    provider: BrowserProvider,
    guestId: number,
  ): Promise<BrowserStatus> {
    const guest = electronWebContents.fromId(guestId);
    if (!guest || guest.isDestroyed() || guest.getType() !== "webview") {
      throw new Error("无法注册内嵌浏览器 WebContents。");
    }
    const previous = this.sessions.get(sessionId);
    if (previous?.guest && previous.guest.id !== guest.id && !previous.guest.isDestroyed()) {
      previous.guest.close();
    }
    const pending = previous?.pending ?? null;
    if (pending) {
      clearTimeout(pending.timeout);
    }
    this.sessions.set(sessionId, {
      provider,
      guest,
      approvedLocalFileUrl: previous?.approvedLocalFileUrl ?? null,
      pending: null,
    });
    guest.on("will-navigate", (event, url) => {
      if (!url.startsWith("file:")) {
        return;
      }
      const current = this.sessions.get(sessionId);
      if (current?.guest?.id !== guest.id || current.approvedLocalFileUrl !== url) {
        event.preventDefault();
      }
    });
    guest.on("page-title-updated", () => {
      this.syncGuestSession(sessionId, guest);
    });
    guest.on("did-navigate", () => {
      this.syncGuestSession(sessionId, guest);
    });
    guest.on("did-navigate-in-page", () => {
      this.syncGuestSession(sessionId, guest);
    });
    guest.once("destroyed", () => {
      const current = this.sessions.get(sessionId);
      if (current?.guest?.id === guest.id) {
        this.sessions.delete(sessionId);
      }
    });
    const status = await this.statusFromGuest(sessionId, guest, provider);
    pending?.resolve(status);
    return status;
  }

  async getStatus(sessionId: string): Promise<BrowserStatus> {
    const session = this.sessions.get(sessionId);
    if (!session?.guest || session.guest.isDestroyed()) {
      return { connected: false, provider: null, url: null, title: null };
    }
    try {
      return await this.statusFromGuest(sessionId, session.guest, session.provider);
    } catch {
      return { connected: false, provider: null, url: null, title: null };
    }
  }

  async close(sessionId: string): Promise<void> {
    this.closeSession(sessionId);
  }

  dispose(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.closeSession(sessionId);
    }
  }

  async execute(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<BrowserToolResult> {
    try {
      signal?.throwIfAborted();
      switch (toolName) {
        case "browser_open": {
          const provider = args.provider === "chrome" ? "chrome" : "edge";
          const url = typeof args.url === "string" ? args.url.trim() : "about:blank";
          const status = await this.open(sessionId, provider, url);
          return {
            output: `已在内嵌 ${provider === "edge" ? "Edge 兼容" : "Chrome 兼容"}浏览器中打开\n${status.title || "新标签页"}\n${status.url || "about:blank"}`,
            isError: false,
          };
        }
        case "browser_navigate": {
          const guest = this.requireGuest(sessionId);
          const url = await normalizeBrowserUrl(
            requireString(args.url, "url"),
            this.getWorkspacePath(sessionId),
          );
          const session = this.sessions.get(sessionId);
          if (session) {
            session.approvedLocalFileUrl = url.startsWith("file:") ? url : null;
          }
          await guest.loadURL(url);
          await sleep(400);
          return {
            output: `已打开 ${guest.getTitle() || url}\n${guest.getURL()}`,
            isError: false,
          };
        }
        case "browser_snapshot": {
          const guest = this.requireGuest(sessionId);
          const snapshot = await guest.executeJavaScript(buildSnapshotScript(), true);
          return {
            output:
              typeof snapshot === "string" && snapshot.trim()
                ? snapshot
                : "浏览器页面没有可读取的可访问性内容。",
            isError: false,
          };
        }
        case "browser_click": {
          const guest = this.requireGuest(sessionId);
          const selector = typeof args.selector === "string" ? args.selector.trim() : "";
          const text = typeof args.text === "string" ? args.text.trim() : "";
          if (selector || text) {
            const clicked = await guest.executeJavaScript(buildClickScript(selector, text), true);
            if (clicked !== true) {
              throw new Error(selector ? `没有找到 ${selector}` : `没有找到“${text}”`);
            }
          } else {
            const x = typeof args.x === "number" ? args.x : 640;
            const y = typeof args.y === "number" ? args.y : 360;
            guest.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
            guest.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
          }
          await sleep(350);
          return {
            output: `已点击。当前页面：${guest.getTitle() || guest.getURL()}`,
            isError: false,
          };
        }
        case "browser_type": {
          const guest = this.requireGuest(sessionId);
          const text = requireString(args.text, "text");
          const selector = typeof args.selector === "string" ? args.selector.trim() : "";
          if (selector) {
            const filled = await guest.executeJavaScript(buildTypeScript(selector, text), true);
            if (filled !== true) {
              throw new Error(`没有找到输入框：${selector}`);
            }
          } else {
            guest.insertText(text);
          }
          return { output: "已输入文本。", isError: false };
        }
        case "browser_press_key": {
          const guest = this.requireGuest(sessionId);
          const key = requireString(args.key, "key");
          guest.sendInputEvent({ type: "keyDown", keyCode: key });
          guest.sendInputEvent({ type: "char", keyCode: key });
          guest.sendInputEvent({ type: "keyUp", keyCode: key });
          await sleep(300);
          return {
            output: `已按下 ${key}。当前页面：${guest.getTitle() || guest.getURL()}`,
            isError: false,
          };
        }
        case "browser_scroll": {
          const guest = this.requireGuest(sessionId);
          const pixels =
            typeof args.pixels === "number" && Number.isFinite(args.pixels) ? args.pixels : 700;
          guest.sendInputEvent({
            type: "mouseWheel",
            x: 640,
            y: 420,
            deltaX: 0,
            deltaY: -pixels,
            canScroll: true,
          });
          return { output: `已滚动 ${pixels}px。`, isError: false };
        }
        case "browser_screenshot": {
          const guest = this.requireGuest(sessionId);
          let image = await guest.capturePage();
          signal?.throwIfAborted();
          if (image.isEmpty()) throw new Error("浏览器没有返回有效截图。");
          const size = image.getSize();
          if (Math.max(size.width, size.height) > 2048) {
            const scale = 2048 / Math.max(size.width, size.height);
            image = image.resize({
              width: Math.max(1, Math.round(size.width * scale)),
              height: Math.max(1, Math.round(size.height * scale)),
              quality: "best",
            });
          }
          const png = image.toPNG();
          if (!png.length || png.length > 8 * 1024 * 1024)
            throw new Error("浏览器截图为空或超过 8 MiB，请缩小页面后重试。");
          await mkdir(this.captureRoot, { recursive: true });
          signal?.throwIfAborted();
          const filePath = join(this.captureRoot, `browser-${randomUUID()}.png`);
          try {
            await writeFile(filePath, png, { flag: "wx" });
            signal?.throwIfAborted();
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST")
              await unlink(filePath).catch(() => undefined);
            throw error;
          }
          return {
            output: `内嵌浏览器截图已保存：${filePath}\n图片尺寸：${image.getSize().width} × ${image.getSize().height}`,
            isError: false,
            images: [
              {
                dataUrl: `data:image/png;base64,${png.toString("base64")}`,
                mimeType: "image/png",
                alt: "Browser screenshot",
              },
            ],
          };
        }
        case "browser_back": {
          const guest = this.requireGuest(sessionId);
          if (guest.navigationHistory.canGoBack()) {
            guest.navigationHistory.goBack();
          }
          await sleep(350);
          return {
            output: `已返回。当前页面：${guest.getTitle() || guest.getURL()}`,
            isError: false,
          };
        }
        case "browser_close": {
          this.closeSession(sessionId);
          return { output: "内嵌浏览器已关闭。", isError: false };
        }
        default:
          return { output: `未知浏览器工具：${toolName}`, isError: true };
      }
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  private requireGuest(sessionId: string): WebContents {
    const session = this.sessions.get(sessionId);
    if (!session?.guest || session.guest.isDestroyed()) {
      throw new Error("当前会话尚未打开内嵌浏览器。请先调用 browser_open。");
    }
    return session.guest;
  }

  private closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    if (session.pending) {
      clearTimeout(session.pending.timeout);
      session.pending.reject(new Error("浏览器打开请求已取消。"));
    }
    if (session.guest && !session.guest.isDestroyed()) {
      session.guest.close();
    }
    this.sessions.delete(sessionId);
  }

  private async statusFromGuest(
    sessionId: string,
    guest: WebContents,
    provider: BrowserProvider,
  ): Promise<BrowserStatus> {
    if (guest.isDestroyed()) {
      this.sessions.delete(sessionId);
      return { connected: false, provider: null, url: null, title: null };
    }
    await guest.executeJavaScript("document.readyState", true).catch(() => "");
    return {
      connected: true,
      provider,
      url: guest.getURL() || "about:blank",
      title: guest.getTitle() || "",
    };
  }

  private syncGuestSession(sessionId: string, guest: WebContents): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.guest?.id !== guest.id || guest.isDestroyed()) {
      return;
    }
    session.guest = guest;
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`缺少 ${field}。`);
  }
  return value.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSnapshotScript(): string {
  return `
    (() => {
      const limit = 260;
      const nodes = [...document.querySelectorAll(
        'a,button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[role="menuitem"],h1,h2,h3'
      )].slice(0, limit).map((el, index) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || tag;
        const name = (
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          el.innerText ||
          el.value ||
          ''
        ).replace(/\\s+/g, ' ').trim().slice(0, 180);
        const href = tag === 'a' ? el.getAttribute('href') : null;
        const disabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true');
        const visible = Boolean(el.getClientRects().length);
        return { index, role, name, href, disabled, visible };
      }).filter((node) => node.visible && (node.name || node.href));
      return [
        'Title: ' + document.title,
        'URL: ' + location.href,
        '',
        ...nodes.map((node) => '[' + node.index + '] ' + node.role + ': ' + node.name + (node.href ? ' -> ' + node.href : '') + (node.disabled ? ' (disabled)' : ''))
      ].join('\\n');
    })()
  `;
}

function buildClickScript(selector: string, text: string): string {
  return `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const text = ${JSON.stringify(text)};
      const el = selector
        ? document.querySelector(selector)
        : [...document.querySelectorAll('a,button,[role="button"],[role="link"],input[type="submit"]')]
            .find((candidate) => (
              candidate.innerText ||
              candidate.getAttribute('aria-label') ||
              candidate.getAttribute('value') ||
              ''
            ).includes(text));
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return true;
    })()
  `;
}

function buildTypeScript(selector: string, text: string): string {
  return `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      const proto = el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : el.tagName === 'INPUT'
          ? HTMLInputElement.prototype
          : null;
      const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
      if (setter) setter.call(el, ${JSON.stringify(text)});
      else el.textContent = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `;
}
