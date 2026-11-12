import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { BrowserProvider } from "../../../shared/domain";
import { tr } from "../i18n/index";

interface BrowserDockProps {
  sessionId: string;
  provider: BrowserProvider;
  initialUrl: string;
}

interface WebviewElement extends HTMLElement {
  getWebContentsId(): number;
  loadURL(url: string): Promise<void>;
  reload(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

const USER_AGENTS: Record<BrowserProvider, string> = {
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
};

export function BrowserDock({ sessionId, provider, initialUrl }: BrowserDockProps) {
  const webviewRef = useRef<WebviewElement>(null);
  const [address, setAddress] = useState(initialUrl === "about:blank" ? "" : initialUrl);
  const [title, setTitle] = useState(tr("\u65B0\u6807\u7B7E\u9875"));
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }
    let cancelled = false;

    const syncNavigation = () => {
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      } catch {
        setCanGoBack(false);
        setCanGoForward(false);
      }
    };
    const onDomReady = () => {
      setLoading(false);
      void window.mingshen
        .registerBrowserWebContents(sessionId, provider, webview.getWebContentsId())
        .then(() => {
          if (!cancelled) {
            setConnected(true);
            setError(null);
            if (initialUrl && initialUrl !== "about:blank") {
              setAddress(initialUrl);
            }
            syncNavigation();
          }
        })
        .catch((cause) => {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        });
    };
    const onStartLoading = () => {
      setLoading(true);
      setError(null);
    };
    const onStopLoading = () => {
      setLoading(false);
      syncNavigation();
    };
    const onNavigate = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (url) {
        setAddress(url === "about:blank" ? "" : url);
      }
      syncNavigation();
    };
    const onTitle = (event: Event) => {
      const nextTitle = (event as Event & { title?: string }).title;
      if (nextTitle) {
        setTitle(nextTitle);
      }
    };
    const onDestroyed = () => {
      if (!cancelled) {
        setConnected(false);
        setError(
          tr(
            "\u6D4F\u89C8\u5668\u9875\u9762\u5DF2\u5173\u95ED\u3002\u518D\u6B21\u6253\u5F00\u6D4F\u89C8\u5668\u53EF\u91CD\u65B0\u521B\u5EFA\u3002",
          ),
        );
      }
    };

    webview.addEventListener("dom-ready", onDomReady);
    webview.addEventListener("did-start-loading", onStartLoading);
    webview.addEventListener("did-stop-loading", onStopLoading);
    webview.addEventListener("did-navigate", onNavigate);
    webview.addEventListener("did-navigate-in-page", onNavigate);
    webview.addEventListener("page-title-updated", onTitle);
    webview.addEventListener("destroyed", onDestroyed);
    return () => {
      cancelled = true;
      webview.removeEventListener("dom-ready", onDomReady);
      webview.removeEventListener("did-start-loading", onStartLoading);
      webview.removeEventListener("did-stop-loading", onStopLoading);
      webview.removeEventListener("did-navigate", onNavigate);
      webview.removeEventListener("did-navigate-in-page", onNavigate);
      webview.removeEventListener("page-title-updated", onTitle);
      webview.removeEventListener("destroyed", onDestroyed);
    };
  }, [initialUrl, provider, sessionId]);

  useEffect(() => {
    if (!connected || !webviewRef.current || !initialUrl) {
      return;
    }
    const current = webviewRef.current;
    try {
      if (current.getAttribute("src") !== initialUrl) {
        void current.loadURL(initialUrl);
      }
    } catch {
      // Initial URL is already handled by the webview src attribute.
    }
  }, [connected, initialUrl]);

  const navigate = async (event: FormEvent) => {
    event.preventDefault();
    if (!address.trim() || !webviewRef.current) {
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const status = await window.mingshen.openBrowser(sessionId, provider, address);
      if (status.url) {
        setAddress(status.url);
      }
    } catch (cause) {
      setLoading(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="browser-dock">
      <div className="browser-dock__toolbar">
        <div className="browser-dock__nav">
          <button
            className="icon-button icon-button--small"
            type="button"
            aria-label={tr("\u540E\u9000")}
            disabled={!canGoBack}
            onClick={() => webviewRef.current?.goBack()}
          >
            <ArrowLeft aria-hidden="true" size={14} />
          </button>
          <button
            className="icon-button icon-button--small"
            type="button"
            aria-label={tr("\u524D\u8FDB")}
            disabled={!canGoForward}
            onClick={() => webviewRef.current?.goForward()}
          >
            <ArrowRight aria-hidden="true" size={14} />
          </button>
          <button
            className="icon-button icon-button--small"
            type="button"
            aria-label={tr("\u5237\u65B0")}
            onClick={() => webviewRef.current?.reload()}
          >
            <RefreshCw className={loading ? "spin" : undefined} aria-hidden="true" size={14} />
          </button>
        </div>
        <form className="browser-dock__address" onSubmit={(event) => void navigate(event)}>
          {loading ? (
            <LoaderCircle className="spin" aria-hidden="true" size={13} />
          ) : address.startsWith("https://") ? (
            <LockKeyhole aria-hidden="true" size={13} />
          ) : (
            <Search aria-hidden="true" size={13} />
          )}
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={tr("\u8F93\u5165\u7F51\u5740\u6216\u641C\u7D22")}
            aria-label={tr("\u6D4F\u89C8\u5668\u5730\u5740")}
            spellCheck={false}
          />
        </form>
        <span className="browser-dock__provider">
          <Globe2 aria-hidden="true" size={13} />
          {provider === "edge" ? "Edge" : "Chrome"}
        </span>
      </div>

      {error ? <p className="browser-dock__error">{error}</p> : null}
      <div className="browser-dock__title" title={title}>
        {title}
      </div>
      <webview
        ref={webviewRef as never}
        className="browser-dock__webview"
        src={initialUrl || "about:blank"}
        partition={`persist:mingshen-${provider}`}
        useragent={USER_AGENTS[provider]}
        webpreferences="contextIsolation=yes,sandbox=yes,nodeIntegration=no"
      />
    </section>
  );
}
