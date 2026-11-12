import {
  CheckCircle2,
  CircleDot,
  Copy,
  GitBranch,
  GitPullRequest,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Trash2,
  Workflow,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { GitHubConnectionStatus } from "../../../shared/domain";
import githubLogo from "../assets/github.svg";
import { tr } from "../i18n/index";
import { useDialog } from "./DialogProvider";

const EMPTY_STATUS: GitHubConnectionStatus = {
  configured: false,
  maskedHint: null,
  login: null,
  displayName: null,
  avatarUrl: null,
};

export function GitHubPluginSettings({
  onConnectionChanged,
}: {
  onConnectionChanged?: () => Promise<void>;
} = {}) {
  const { confirm } = useDialog();
  const [status, setStatus] = useState<GitHubConnectionStatus>(EMPTY_STATUS);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [device, setDevice] = useState<{
    userCode: string;
    verificationUrl: string;
    expiresAt: number;
  } | null>(null);
  const authorizationAttempt = useRef(0);
  const connectionChanged = useRef(onConnectionChanged);
  connectionChanged.current = onConnectionChanged;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void window.mingshen
      .getDesktopState()
      .then((state) => {
        if (state.githubClientId) setClientId(state.githubClientId);
      })
      .catch((cause) => setError(String(cause)));
    void window.mingshen
      .getGitHubAuthorization()
      .then(setDevice)
      .catch((cause) => setError(String(cause)));
    void window.mingshen
      .getGitHubStatus()
      .then(setStatus)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(
    () => () => {
      authorizationAttempt.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!device) return;
    const attempt = ++authorizationAttempt.current;
    setBusy(true);
    const poll = async () => {
      try {
        while (Date.now() < device.expiresAt && attempt === authorizationAttempt.current) {
          const result = await window.mingshen.pollGitHubAuthorization();
          if (attempt !== authorizationAttempt.current) return;
          if (result.status === "connected" && result.connection) {
            setStatus(result.connection);
            setBusy(false);
            setDevice(null);
            await connectionChanged.current?.();
            return;
          }
        }
        if (attempt === authorizationAttempt.current) {
          setBusy(false);
          setDevice(null);
          throw new Error(tr("授权已过期，请重试。"));
        }
      } catch (cause) {
        if (attempt === authorizationAttempt.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (attempt === authorizationAttempt.current) setBusy(false);
      }
    };
    void poll();
    return () => {
      authorizationAttempt.current += 1;
    };
  }, [device]);

  const authorize = async () => {
    const attempt = ++authorizationAttempt.current;
    setBusy(true);
    setError(null);
    try {
      const started = await window.mingshen.startGitHubAuthorization(clientId);
      if (attempt !== authorizationAttempt.current) return;
      setDevice(started);
      setCopied(false);
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      await window.mingshen
        .openExternalUrl(started.verificationUrl)
        .catch((cause) => setError(String(cause)));
    } catch (cause) {
      if (attempt === authorizationAttempt.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (attempt === authorizationAttempt.current) {
        setBusy(false);
      }
    }
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await window.mingshen.setGitHubToken(token);
      setStatus(next);
      await onConnectionChanged?.();
      setToken("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    const confirmed = await confirm({
      title: tr("\u65AD\u5F00 GitHub"),
      description: tr(
        "\u5C06\u5220\u9664\u672C\u5730\u4FDD\u5B58\u7684 GitHub Token\uFF0C\u5E76\u505C\u6B62\u5F53\u524D\u63D2\u4EF6\u8BBF\u95EE\u3002\u4E4B\u540E\u53EF\u4EE5\u91CD\u65B0\u8FDE\u63A5\u3002",
      ),
      confirmLabel: tr("\u65AD\u5F00\u5E76\u5220\u9664 Token"),
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.mingshen.disconnectGitHub();
      setStatus(EMPTY_STATUS);
      await onConnectionChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-page github-plugin-settings">
      <section className="settings-block">
        <div className="github-plugin-summary">
          <span className="github-plugin-summary__icon" aria-hidden="true">
            <img src={githubLogo} alt="" />
          </span>
          <div>
            <h3>GitHub</h3>
            <p>Triage PRs, issues, CI, and publish flows</p>
          </div>
          <span
            className={
              status.configured
                ? "github-plugin-summary__state github-plugin-summary__state--connected"
                : "github-plugin-summary__state"
            }
          >
            {status.configured ? (
              <>
                <CheckCircle2 aria-hidden="true" size={13} />
                {tr("\u5DF2\u8FDE\u63A5")}
              </>
            ) : (
              tr("\u672A\u8FDE\u63A5")
            )}
          </span>
        </div>

        <div className="github-plugin-capabilities">
          <div>
            <GitPullRequest aria-hidden="true" size={16} />
            <strong>Pull Requests</strong>
            <span>{tr("\u67E5\u770B\u3001\u68C0\u7D22\u5E76\u8BC4\u8BBA PR")}</span>
          </div>
          <div>
            <CircleDot aria-hidden="true" size={16} />
            <strong>Issues</strong>
            <span>{tr("\u8BFB\u53D6\u548C\u521B\u5EFA Issue")}</span>
          </div>
          <div>
            <Workflow aria-hidden="true" size={16} />
            <strong>CI / Actions</strong>
            <span>{tr("\u68C0\u67E5\u5DE5\u4F5C\u6D41\u548C\u5931\u8D25\u72B6\u6001")}</span>
          </div>
          <div>
            <GitBranch aria-hidden="true" size={16} />
            <strong>Repositories</strong>
            <span>{tr("\u641C\u7D22\u548C\u68C0\u67E5\u4EE3\u7801\u4ED3\u5E93")}</span>
          </div>
        </div>

        {!status.configured ? (
          <div className="github-token-form">
            <label className="field">
              <span>GitHub App / OAuth App Client ID</span>
              <input
                value={clientId}
                disabled={busy}
                onChange={(event) => setClientId(event.target.value)}
                placeholder={tr("Mingshen \u5E94\u7528\u7684 Client ID")}
              />

              <small>
                {tr(
                  "\u53D1\u5E03\u8005\u9700\u5728 GitHub \u6CE8\u518C\u5E94\u7528\u5E76\u542F\u7528 Device Flow\u3002\u9996\u6B21\u6388\u6743\u5C06\u5728\u9ED8\u8BA4\u6D4F\u89C8\u5668\u4E2D\u8FDB\u884C\uFF0CToken \u52A0\u5BC6\u4FDD\u5B58\u5E76\u4F9B GitHub MCP \u4F7F\u7528\u3002",
                )}
              </small>
            </label>
            {device ? (
              <div className="github-device-authorization" role="status" aria-live="polite">
                <p>
                  {tr("\u5728 GitHub \u6388\u6743\u9875\u9762\u8F93\u5165\u9A8C\u8BC1\u7801\uFF1A")}
                </p>
                <div className="github-device-code">
                  <code>{device.userCode}</code>
                  <button
                    className="icon-button"
                    type="button"
                    title={tr(copied ? "已复制" : "复制验证码")}
                    aria-label={tr(copied ? "已复制" : "复制验证码")}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(device.userCode)
                        .then(() => setCopied(true))
                        .catch((cause) => setError(String(cause)))
                    }
                  >
                    <Copy size={16} />
                  </button>
                </div>
                <small>
                  {tr("验证码由 Mingshen Harness 提供，在 GitHub 页面输入后返回此处等待连接。")}
                </small>
                <div className="github-device-actions">
                  <button
                    className="btn btn--secondary"
                    type="button"
                    onClick={() => void window.mingshen.openExternalUrl(device.verificationUrl)}
                  >
                    {tr("\u91CD\u65B0\u6253\u5F00\u6388\u6743\u9875\u9762")}
                  </button>
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() => {
                      authorizationAttempt.current += 1;
                      void window.mingshen.cancelGitHubAuthorization();
                      setDevice(null);
                      setBusy(false);
                    }}
                  >
                    {tr("\u53D6\u6D88\u6388\u6743")}
                  </button>
                  {!busy ? (
                    <button
                      className="btn btn--secondary"
                      type="button"
                      onClick={() => {
                        setError(null);
                        setDevice({ ...device });
                      }}
                    >
                      {tr("继续等待授权")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <button
                className="btn btn--primary"
                type="button"
                disabled={busy || !clientId.trim()}
                onClick={() => void authorize()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />
                ) : (
                  <ShieldCheck size={14} aria-hidden="true" />
                )}
                {tr("\u4F7F\u7528\u6D4F\u89C8\u5668\u6388\u6743")}
              </button>
            )}
          </div>
        ) : null}

        {status.configured ? (
          <div className="github-plugin-account">
            {status.avatarUrl ? <img src={status.avatarUrl} alt="" /> : null}
            <div>
              <strong>{status.displayName || status.login}</strong>
              <span>
                @{status.login} · {status.maskedHint}
              </span>
            </div>
            <button
              className="btn btn--secondary"
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              <Trash2 aria-hidden="true" size={14} />
              {tr("\u65AD\u5F00")}
            </button>
          </div>
        ) : (
          <form className="github-token-form" onSubmit={(event) => void connect(event)}>
            <label className="field">
              <span>Personal Access Token</span>
              <div className="github-token-input">
                <KeyRound aria-hidden="true" size={15} />
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="github_pat_..."
                  autoComplete="off"
                />
              </div>
              <small>
                {tr(
                  "\u5EFA\u8BAE\u6388\u4E88 repository\u3001issues\u3001pull requests \u548C Actions \u8BFB\u53D6\u6743\u9650\u3002Token \u4F7F\u7528\u7CFB\u7EDF\u51ED\u636E\u5B58\u50A8\uFF0C\u4E0D\u4F1A\u8FDB\u5165\u4F1A\u8BDD\u4E0A\u4E0B\u6587\u3002",
                )}
              </small>
            </label>
            <button className="btn btn--primary" type="submit" disabled={busy || !token.trim()}>
              {busy ? (
                <LoaderCircle className="spin" aria-hidden="true" size={14} />
              ) : (
                <ShieldCheck aria-hidden="true" size={14} />
              )}
              {tr("\u9A8C\u8BC1\u5E76\u8FDE\u63A5")}
            </button>
          </form>
        )}

        <small>
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            onClick={(event) => {
              event.preventDefault();
              void window.mingshen.openExternalUrl(
                "https://github.com/settings/personal-access-tokens/new",
              );
            }}
          >
            {tr("获取 GitHub Token：Settings → Developer settings → Personal access tokens")}
          </a>
        </small>
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("Agent \u8C03\u7528\u65B9\u5F0F")}</h3>
            <p>
              {tr(
                "\u8FDE\u63A5\u540E\uFF0CAgent \u53EF\u4EE5\u76F4\u63A5\u68C0\u7D22\u4ED3\u5E93\u3001\u8BFB\u53D6 Issues \u548C Pull Requests\u3001\u67E5\u770B GitHub Actions \u72B6\u6001\uFF0C\u5E76\u5728\u6709\u5199\u5165\u6743\u9650\u65F6\u521B\u5EFA Issue \u6216\u8BC4\u8BBA PR\u3002",
              )}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
