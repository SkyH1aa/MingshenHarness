import {
  CheckCircle2,
  ChevronDown,
  Cloud,
  ExternalLink,
  GitBranch,
  Globe2,
  LoaderCircle,
  Monitor,
  Pencil,
  PlugZap,
  Plus,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type {
  McpServerSaveInput,
  McpServerTestResult,
  McpServerView,
  McpTransport,
} from "../../../shared/domain";
import { tr } from "../i18n/index";
import { useDialog } from "./DialogProvider";
import { ExpandableText } from "./ExpandableText";
import { GitHubPluginSettings } from "./GitHubPluginSettings";

const MCP_MARKET_URL = "https://mcpservers.org/zh-CN/";

interface McpSettingsProps {
  servers: McpServerView[];
  onChanged: () => Promise<void>;
}

interface McpDraft {
  id?: string;
  name: string;
  description: string;
  transport: McpTransport;
  enabled: boolean;
  command: string;
  args: string;
  cwd: string;
  url: string;
  timeoutMs: number;
  headerText: string;
  envText: string;
  oauthEnabled: boolean;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
}

function emptyDraft(): McpDraft {
  return {
    name: "",
    description: "",
    transport: "stdio",
    enabled: true,
    command: "npx",
    args: "-y package-name",
    cwd: "",
    url: "",
    timeoutMs: 30_000,
    headerText: "",
    envText: "",
    oauthEnabled: false,
    oauthClientId: "",
    oauthClientSecret: "",
    oauthScope: "",
  };
}

function serverToDraft(server: McpServerView): McpDraft {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    transport: server.transport,
    enabled: server.enabled,
    command: server.command,
    args: server.args.join("\n"),
    cwd: server.cwd,
    url: server.url,
    timeoutMs: server.timeoutMs,
    headerText: server.headerKeys.map((key) => `${key}=`).join("\n"),
    envText: server.envKeys.map((key) => `${key}=`).join("\n"),
    oauthEnabled: server.oauthEnabled,
    oauthClientId: "",
    oauthClientSecret: "",
    oauthScope: "",
  };
}

function parseSecretLines(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        return separator < 0
          ? [line, ""]
          : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
      .filter(([key, entry]) => Boolean(key && entry)),
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mcpIcon(server: McpServerView) {
  if (server.id === "builtin-github") {
    return GitBranch;
  }
  if (server.id === "builtin-notion") {
    return Monitor;
  }
  if (server.id === "builtin-wikipedia") {
    return Globe2;
  }
  if (server.id === "builtin-browserbase") {
    return Cloud;
  }
  return PlugZap;
}

export function McpSettings({ servers, onChanged }: McpSettingsProps) {
  const { confirm } = useDialog();
  const [draft, setDraft] = useState<McpDraft | null>(servers.length === 0 ? emptyDraft() : null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, McpServerTestResult>>({});
  const [oauthBusyId, setOauthBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const draftId = draft?.id ?? (draft ? "new" : null);
  useEffect(() => {
    if (draftId) formRef.current?.querySelector("input")?.focus();
  }, [draftId]);
  const matches = (server: McpServerView) =>
    `${server.name} ${server.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const builtins = servers.filter((server) => server.builtin && matches(server));
  const custom = servers.filter((server) => !server.builtin && matches(server));
  const selected = servers.find((server) => server.id === expandedId);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: McpServerSaveInput = {
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name,
        description: draft.description,
        transport: draft.transport,
        enabled: draft.enabled,
        command: draft.command,
        args: draft.args
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean),
        cwd: draft.cwd,
        url: draft.url,
        timeoutMs: draft.timeoutMs,
        headers: parseSecretLines(draft.headerText),
        env: parseSecretLines(draft.envText),
        oauthEnabled: draft.oauthEnabled,
        ...(draft.oauthClientId.trim() ? { oauthClientId: draft.oauthClientId } : {}),
        ...(draft.oauthClientSecret ? { oauthClientSecret: draft.oauthClientSecret } : {}),
        ...(draft.oauthScope.trim() ? { oauthScope: draft.oauthScope } : {}),
      };
      await window.mingshen.saveMcpServer(input);
      setDraft(null);
      await onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (server: McpServerView) => {
    setBusyId(server.id);
    setError(null);
    try {
      await window.mingshen.setMcpServerEnabled(server.id, !server.enabled);
      await onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  };

  const test = async (server: McpServerView) => {
    setExpandedId(server.id);
    setBusyId(server.id);
    setError(null);
    try {
      const result = await window.mingshen.testMcpServer(server.id);
      setTestResults((current) => ({ ...current, [server.id]: result }));
      await onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (server: McpServerView) => {
    const confirmed = await confirm({
      title: tr("\u5220\u9664 MCP Server"),
      description: tr(
        "\u5220\u9664\u300C{0}\u300D\u53CA\u5176\u672C\u5730\u52A0\u5BC6\u914D\u7F6E\uFF1F\u5185\u7F6E MCP \u4E0D\u53D7\u5F71\u54CD\u3002",
        [server.name],
      ),
      confirmLabel: tr("\u5220\u9664 MCP"),
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setBusyId(server.id);
    try {
      await window.mingshen.removeMcpServer(server.id);
      await onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  };

  const authenticate = async (server: McpServerView) => {
    setOauthBusyId(server.id);
    setError(null);
    try {
      const result = await window.mingshen.startMcpOAuth(server.id);
      await window.mingshen.openExternalUrl(result.authorizationUrl);
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
        const current = (await window.mingshen.listMcpServers()).find(
          (entry) => entry.id === server.id,
        );
        if (current?.oauthAuthenticated) {
          await onChanged();
          setTestResults((results) => {
            const next = { ...results };
            delete next[server.id];
            return next;
          });
          return;
        }
      }
      throw new Error(
        tr("OAuth \u6388\u6743\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u5C1D\u8BD5\u3002"),
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setOauthBusyId(null);
    }
  };

  const renderServer = (server: McpServerView, detail = false) => {
    const Icon = mcpIcon(server);
    const expanded = expandedId === server.id;
    const result = testResults[server.id];
    const connection =
      server.transport === "http" ? server.url : `${server.command} ${server.args.join(" ")}`;
    return (
      <article className={`mcp-card${detail ? " mcp-card--detail" : ""}`} key={server.id}>
        <div className="mcp-card__main">
          <span className="mcp-card__icon" aria-hidden="true">
            <Icon size={17} />
          </span>
          <div className="mcp-card__copy">
            <div>
              {detail ? (
                <strong>{server.name}</strong>
              ) : (
                <button
                  className="connection-select"
                  type="button"
                  aria-pressed={expanded}
                  onClick={() => setExpandedId(server.id)}
                >
                  {server.name}
                </button>
              )}
              {server.builtin ? <span>BUILT-IN</span> : <span>CUSTOM</span>}
              <small className={`mcp-status mcp-status--${server.status}`}>
                {server.status === "connected"
                  ? tr("\u5DF2\u8FDE\u63A5")
                  : server.status === "error"
                    ? tr("\u8FDE\u63A5\u5F02\u5E38")
                    : server.configured
                      ? tr("\u672A\u8FDE\u63A5")
                      : tr("\u5F85\u914D\u7F6E")}
              </small>
            </div>
            <p>
              {(server.builtin ? tr(server.description) : server.description) ||
                tr("\u672A\u63D0\u4F9B\u63CF\u8FF0")}
            </p>
            {detail ? (
              <ExpandableText text={connection} className="mcp-card__connection" />
            ) : (
              <code>{connection}</code>
            )}
          </div>
          <div className="mcp-card__actions">
            <label className="mcp-toggle">
              <input
                type="checkbox"
                checked={server.enabled}
                onChange={() => void toggle(server)}
                disabled={busyId === server.id}
              />

              <span>{server.enabled ? tr("\u5DF2\u542F\u7528") : tr("\u5DF2\u505C\u7528")}</span>
            </label>
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => void test(server)}
              disabled={busyId === server.id || !server.configured}
            >
              {busyId === server.id ? (
                <LoaderCircle className="spin" aria-hidden="true" size={14} />
              ) : (
                <Server aria-hidden="true" size={14} />
              )}
              {tr("\u6D4B\u8BD5")}
            </button>
            {server.id !== "builtin-github" &&
            server.transport === "http" &&
            server.oauthEnabled ? (
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => void authenticate(server)}
                disabled={oauthBusyId === server.id}
              >
                {oauthBusyId === server.id ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : (
                  <Cloud aria-hidden="true" size={14} />
                )}
                {server.oauthAuthenticated
                  ? tr("\u91CD\u65B0\u6388\u6743")
                  : tr("OAuth \u6388\u6743")}
              </button>
            ) : null}
            {server.id === "builtin-github" ? (
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => setExpandedId(expanded ? null : server.id)}
              >
                <Cloud size={14} aria-hidden="true" />
                {tr("GitHub \u6388\u6743")}
              </button>
            ) : null}
            <button
              className="icon-button"
              type="button"
              aria-label={tr("\u7F16\u8F91 {0}", [server.name])}
              title={tr("\u914D\u7F6E")}
              onClick={() => {
                setDraft(serverToDraft(server));
                setExpandedId(server.id);
              }}
            >
              <Pencil aria-hidden="true" size={14} />
            </button>
            {!server.builtin ? (
              <button
                className="icon-button icon-button--danger"
                type="button"
                aria-label={tr("\u5220\u9664 {0}", [server.name])}
                onClick={() => void remove(server)}
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            ) : null}
            <button
              className="icon-button icon-button--small"
              type="button"
              aria-label={
                expanded ? tr("\u6536\u8D77 MCP \u8BE6\u60C5") : tr("\u5C55\u5F00 MCP \u8BE6\u60C5")
              }
              aria-expanded={expanded}
              onClick={() => setExpandedId((current) => (current === server.id ? null : server.id))}
            >
              <ChevronDown
                className={
                  expanded ? "mcp-card__chevron mcp-card__chevron--open" : "mcp-card__chevron"
                }
                aria-hidden="true"
                size={14}
              />
            </button>
          </div>
        </div>
        {expanded && detail ? (
          <div className="mcp-card__details">
            <span>
              {server.tools.length}
              {tr("\u4E2A\u5DE5\u5177")}
            </span>
            <span>
              {tr("\u8D85\u65F6\uFF1A")}
              {server.timeoutMs} ms
            </span>
            {server.cwd ? (
              <span>
                {tr("\u76EE\u5F55\uFF1A")}
                {server.cwd}
              </span>
            ) : null}
            {server.headerKeys.length > 0 ? (
              <span>
                {tr("\u8BF7\u6C42\u5934\uFF1A")}
                {server.headerKeys.join(", ")}
              </span>
            ) : null}
            {server.envKeys.length > 0 ? (
              <span>
                {tr("\u73AF\u5883\u53D8\u91CF\uFF1A")}
                {server.envKeys.join(", ")}
              </span>
            ) : null}
            {server.oauthEnabled ? (
              <span>
                OAuth：
                {server.oauthAuthenticated
                  ? tr("\u5DF2\u6388\u6743")
                  : tr("\u5C1A\u672A\u6388\u6743")}
              </span>
            ) : null}
            {server.lastError ? (
              <ExpandableText text={server.lastError} className="mcp-card__error" tone="error" />
            ) : null}
            {server.id === "builtin-github" ? (
              <GitHubPluginSettings onConnectionChanged={onChanged} />
            ) : null}
            {result ? (
              <div className={result.ok ? "mcp-test mcp-test--ok" : "mcp-test mcp-test--error"}>
                <CheckCircle2 aria-hidden="true" size={14} />
                {result.ok ? (
                  <span>
                    {tr("\u8FDE\u63A5\u6210\u529F \xB7 {0} ms \xB7 {1} \u4E2A\u5DE5\u5177", [
                      result.latencyMs,
                      result.tools.length,
                    ])}
                  </span>
                ) : (
                  <ExpandableText
                    text={result.error || tr("\u8FDE\u63A5\u5F02\u5E38")}
                    tone="error"
                  />
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <div className="settings-page mcp-settings">
      <section className="settings-block">
        <div className="settings-block__heading mcp-settings__heading">
          <div>
            <h3>MCP Servers</h3>
            <p>
              {tr(
                "\u5185\u7F6E\u5E38\u7528\u670D\u52A1\uFF0C\u4E5F\u53EF\u4EE5\u8FDE\u63A5\u4EFB\u610F stdio \u6216 Streamable HTTP MCP Server\u3002",
              )}
            </p>
          </div>
          <div className="mcp-settings__heading-actions">
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => void window.mingshen.openExternalUrl(MCP_MARKET_URL)}
            >
              <ExternalLink aria-hidden="true" size={14} />
              {tr("MCP \u5E02\u573A")}
            </button>
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => setDraft(emptyDraft())}
            >
              <Plus aria-hidden="true" size={14} />
              {tr("\u6DFB\u52A0 MCP")}
            </button>
          </div>
        </div>

        {error ? <ExpandableText text={error} className="form-error" tone="error" /> : null}

        <label className="field catalog-search">
          <span>{tr("搜索连接")}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="connection-workspace">
          <div className="connection-master">
            <div className="mcp-group">
              <div className="mcp-group__heading">
                <span>{tr("\u5185\u7F6E\u670D\u52A1")}</span>
                <small>{builtins.length}</small>
              </div>
              {builtins.map((server) => renderServer(server))}
            </div>

            <div className="mcp-group">
              <div className="mcp-group__heading">
                <span>{tr("\u81EA\u5B9A\u4E49\u670D\u52A1")}</span>
                <small>{custom.length}</small>
              </div>
              {custom.length > 0 ? (
                custom.map((server) => renderServer(server))
              ) : (
                <div className="mcp-empty">
                  <PlugZap aria-hidden="true" size={20} />
                  <strong>{tr("\u5C1A\u672A\u6DFB\u52A0\u81EA\u5B9A\u4E49 MCP")}</strong>
                  <p>
                    {tr(
                      "\u53EF\u4EE5\u914D\u7F6E\u672C\u5730\u547D\u4EE4\u3001\u73AF\u5883\u53D8\u91CF\u3001\u8FDC\u7A0B URL \u548C\u81EA\u5B9A\u4E49\u8BF7\u6C42\u5934\u3002",
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="connection-detail">
            {selected ? (
              renderServer(selected, true)
            ) : (
              <p className="quiet-copy">{tr("选择连接查看详情")}</p>
            )}
          </div>
        </div>
      </section>

      {draft ? (
        <form ref={formRef} className="mcp-form" onSubmit={(event) => void save(event)}>
          <header className="mcp-form__header">
            <div>
              <h3>{draft.id ? tr("\u7F16\u8F91 MCP Server") : tr("\u6DFB\u52A0 MCP Server")}</h3>
              <p>
                {tr(
                  "\u654F\u611F\u8BF7\u6C42\u5934\u548C\u73AF\u5883\u53D8\u91CF\u4F1A\u5199\u5165 Windows \u51ED\u636E\u4FDD\u62A4\uFF0C\u4E0D\u4F1A\u56DE\u663E\u3002",
                )}
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={tr("\u5173\u95ED MCP \u914D\u7F6E")}
              onClick={() => setDraft(null)}
            >
              <X aria-hidden="true" size={15} />
            </button>
          </header>

          <div className="form-grid form-grid--two">
            <label className="field">
              <span>{tr("\u540D\u79F0")}</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder={tr("\u4F8B\u5982\uFF1AContext7")}
                required
              />
            </label>
            <label className="field">
              <span>{tr("\u4F20\u8F93\u65B9\u5F0F")}</span>
              <select
                value={draft.transport}
                onChange={(event) =>
                  setDraft({ ...draft, transport: event.target.value as McpTransport })
                }
              >
                <option value="stdio">{tr("stdio / \u672C\u5730\u8FDB\u7A0B")}</option>
                <option value="http">Streamable HTTP</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>{tr("\u63CF\u8FF0")}</span>
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder={tr("\u8FD9\u4E2A MCP \u63D0\u4F9B\u4EC0\u4E48\u80FD\u529B")}
            />
          </label>

          {draft.transport === "stdio" ? (
            <>
              <label className="field">
                <span>{tr("\u542F\u52A8\u547D\u4EE4")}</span>
                <input
                  value={draft.command}
                  onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                  placeholder="npx"
                  required
                />
              </label>
              <label className="field">
                <span>{tr("\u53C2\u6570\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09")}</span>
                <textarea
                  value={draft.args}
                  onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                  rows={4}
                />
              </label>
              <label className="field">
                <span>{tr("\u5DE5\u4F5C\u76EE\u5F55")}</span>
                <input
                  value={draft.cwd}
                  onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                  placeholder={tr("\u7559\u7A7A\u4F7F\u7528\u5E94\u7528\u5F53\u524D\u76EE\u5F55")}
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>MCP URL</span>
                <input
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  placeholder="https://example.com/mcp"
                  spellCheck={false}
                  required
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.oauthEnabled}
                  onChange={(event) => setDraft({ ...draft, oauthEnabled: event.target.checked })}
                />

                <span>
                  {tr(
                    "\u542F\u7528 OAuth\uFF08\u81EA\u52A8\u53D1\u73B0\u4E0E\u52A8\u6001\u5BA2\u6237\u7AEF\u6CE8\u518C\uFF09",
                  )}
                </span>
              </label>
              {draft.oauthEnabled ? (
                <div className="form-grid form-grid--two">
                  <label className="field">
                    <span>{tr("OAuth Client ID\uFF08\u53EF\u9009\uFF09")}</span>
                    <input
                      value={draft.oauthClientId}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          oauthClientId: event.target.value,
                        })
                      }
                      placeholder={tr("\u7559\u7A7A\u65F6\u5C1D\u8BD5\u52A8\u6001\u6CE8\u518C")}
                    />
                  </label>
                  <label className="field">
                    <span>{tr("OAuth Client Secret\uFF08\u53EF\u9009\uFF09")}</span>
                    <input
                      type="password"
                      value={draft.oauthClientSecret}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          oauthClientSecret: event.target.value,
                        })
                      }
                      placeholder={tr("\u7559\u7A7A\u65F6\u6CBF\u7528\u5DF2\u4FDD\u5B58\u503C")}
                    />
                  </label>
                  <label className="field settings-form-grid__full">
                    <span>{tr("OAuth Scope\uFF08\u53EF\u9009\uFF09")}</span>
                    <input
                      value={draft.oauthScope}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          oauthScope: event.target.value,
                        })
                      }
                      placeholder={tr("\u4F8B\u5982 tools:read tools:execute")}
                    />
                  </label>
                </div>
              ) : null}
            </>
          )}

          <label className="field">
            <span>{tr("\u8BF7\u6C42\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09")}</span>
            <input
              type="number"
              min={1000}
              max={600000}
              step={1000}
              value={draft.timeoutMs}
              onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) })}
            />
          </label>

          <div className="form-grid form-grid--two">
            <label className="field">
              <span>{tr("\u8BF7\u6C42\u5934\uFF08KEY=value\uFF09")}</span>
              <textarea
                value={draft.headerText}
                onChange={(event) => setDraft({ ...draft, headerText: event.target.value })}
                placeholder="Authorization=Bearer token"
                rows={4}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>{tr("\u73AF\u5883\u53D8\u91CF\uFF08KEY=value\uFF09")}</span>
              <textarea
                value={draft.envText}
                onChange={(event) => setDraft({ ...draft, envText: event.target.value })}
                placeholder="API_KEY=..."
                rows={4}
                spellCheck={false}
              />
            </label>
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />

            <span>{tr("\u4FDD\u5B58\u540E\u542F\u7528\u6B64 MCP Server")}</span>
          </label>

          <div className="form-actions">
            <button className="btn btn--ghost" type="button" onClick={() => setDraft(null)}>
              {tr("\u53D6\u6D88")}
            </button>
            <button className="btn btn--primary" type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="spin" aria-hidden="true" size={14} /> : null}
              {tr("\u4FDD\u5B58 MCP")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
