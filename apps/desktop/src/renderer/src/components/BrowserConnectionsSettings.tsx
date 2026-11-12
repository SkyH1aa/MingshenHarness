import { ArrowUpRight, CircleDot, Globe2, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrowserProvider, BrowserStatus } from "../../../shared/domain";
import { tr } from "../i18n/index";

interface BrowserConnectionsSettingsProps {
  sessionId: string | null;
}

const EMPTY_STATUS: BrowserStatus = {
  connected: false,
  provider: null,
  url: null,
  title: null,
};

export function BrowserConnectionsSettings({ sessionId }: BrowserConnectionsSettingsProps) {
  const [status, setStatus] = useState<BrowserStatus>(EMPTY_STATUS);
  const [busy, setBusy] = useState<BrowserProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStatus(EMPTY_STATUS);
      return;
    }
    void window.mingshen
      .getBrowserStatus(sessionId)
      .then(setStatus)
      .catch(() => setStatus(EMPTY_STATUS));
  }, [sessionId]);

  const open = async (provider: BrowserProvider, url = "about:blank") => {
    if (!sessionId) {
      setError(
        tr("\u8BF7\u5148\u5728\u4E3B\u754C\u9762\u9009\u62E9\u4E00\u4E2A\u4F1A\u8BDD\u3002"),
      );
      return;
    }
    setBusy(provider);
    setError(null);
    try {
      setStatus(await window.mingshen.openBrowser(sessionId, provider, url));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    if (!sessionId) {
      return;
    }
    await window.mingshen.closeBrowser(sessionId);
    setStatus(EMPTY_STATUS);
  };

  return (
    <div className="settings-page browser-connections">
      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("\u5185\u5D4C\u6D4F\u89C8\u5668")}</h3>
            <p>
              {tr(
                "\u5728 Harness \u5DE5\u4F5C\u533A\u5185\u6253\u5F00\u72EC\u7ACB Chromium \u9875\u9762\uFF0CAgent \u53EF\u4EE5\u5BFC\u822A\u3001\u8BFB\u53D6\u9875\u9762\u3001\u70B9\u51FB\u3001\u8F93\u5165\u3001\u6EDA\u52A8\u548C\u622A\u56FE\u3002",
              )}
            </p>
          </div>
        </div>

        <div className="integration-list">
          <div className="integration-row">
            <span className="integration-row__icon">
              <CircleDot aria-hidden="true" size={18} />
            </span>
            <span className="integration-row__copy">
              <strong>Google Chrome</strong>
              <small>
                {tr(
                  "Harness \u5185\u5D4C Chromium \xB7 Chrome \u517C\u5BB9\u914D\u7F6E\u4E0E\u72EC\u7ACB\u4F1A\u8BDD\u6570\u636E",
                )}
              </small>
            </span>
            <button
              className="btn btn--secondary"
              type="button"
              disabled={!sessionId || Boolean(busy)}
              onClick={() => void open("chrome")}
            >
              {busy === "chrome" ? (
                <LoaderCircle className="spin" aria-hidden="true" size={14} />
              ) : (
                <ArrowUpRight aria-hidden="true" size={14} />
              )}
              {tr("\u6253\u5F00")}
            </button>
          </div>

          <div className="integration-row">
            <span className="integration-row__icon">
              <Globe2 aria-hidden="true" size={18} />
            </span>
            <span className="integration-row__copy">
              <strong>Microsoft Edge</strong>
              <small>
                {tr(
                  "Harness \u5185\u5D4C Chromium \xB7 Edge \u517C\u5BB9\u914D\u7F6E\u4E0E\u72EC\u7ACB\u4F1A\u8BDD\u6570\u636E",
                )}
              </small>
            </span>
            <button
              className="btn btn--secondary"
              type="button"
              disabled={!sessionId || Boolean(busy)}
              onClick={() => void open("edge")}
            >
              {busy === "edge" ? (
                <LoaderCircle className="spin" aria-hidden="true" size={14} />
              ) : (
                <ArrowUpRight aria-hidden="true" size={14} />
              )}
              {tr("\u6253\u5F00")}
            </button>
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("\u5F53\u524D\u8FDE\u63A5")}</h3>
            <p>
              {tr(
                "\u5185\u5D4C\u6D4F\u89C8\u5668\u4E0E\u5F53\u524D\u4F1A\u8BDD\u7ED1\u5B9A\u3002Agent \u7684\u6D4F\u89C8\u5668\u5DE5\u5177\u4F1A\u81EA\u52A8\u590D\u7528\u6B64\u8FDE\u63A5\u3002",
              )}
            </p>
          </div>
        </div>
        <div className="settings-block__heading">
          <div>
            <h3>
              {status.connected
                ? status.title || tr("\u5185\u5D4C\u6D4F\u89C8\u5668\u5DF2\u8FDE\u63A5")
                : tr("\u5C1A\u672A\u8FDE\u63A5")}
            </h3>
            <p className="browser-status-url">
              {status.url ||
                tr(
                  "\u6253\u5F00 Chrome \u6216 Edge \u517C\u5BB9\u6D4F\u89C8\u5668\u540E\u663E\u793A\u72B6\u6001\u3002",
                )}
            </p>
          </div>
          {status.connected ? (
            <button className="btn btn--secondary" type="button" onClick={() => void close()}>
              {tr("\u5173\u95ED\u6D4F\u89C8\u5668")}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
