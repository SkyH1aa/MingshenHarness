import {
  AlertTriangle,
  Check,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  PackagePlus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LocalPluginMarketSource,
  LocalPluginMarketView,
  LocalPluginValidation,
} from "../../../shared/local-plugins";
import { tr } from "../i18n/index";
import { useDialog } from "./DialogProvider";
import "./local-plugin-marketplace.css";

interface LocalPluginMarketplaceProps {
  onChanged: () => Promise<void>;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function manifestKindLabel(
  kind: LocalPluginMarketView["plugins"][number]["validation"]["manifestKind"],
) {
  switch (kind) {
    case "mingshen":
      return "MINGSHEN";
    case "codex":
      return "CODEX";
    case "zcode":
      return "ZCODE";
    case "legacy":
      return tr("兼容清单");
    default:
      return tr("无清单");
  }
}

function ValidationIssues({
  validation,
  label,
}: {
  validation: LocalPluginValidation;
  label?: string | undefined;
}) {
  if (!validation.errors.length && !validation.warnings.length) {
    return (
      <p className="local-plugin-marketplace__valid">
        <ShieldCheck aria-hidden="true" size={13} />
        {tr("校验通过")}
      </p>
    );
  }
  return (
    <details className="local-plugin-marketplace__issues">
      <summary>
        <AlertTriangle aria-hidden="true" size={13} />
        {label ??
          tr("{0} 个错误 · {1} 个警告", [validation.errors.length, validation.warnings.length])}
      </summary>
      <ul>
        {validation.errors.map((issue) => (
          <li
            className="local-plugin-marketplace__issue--error"
            key={`error:${issue.code}:${issue.path ?? ""}:${issue.message}`}
          >
            <strong>{tr("错误")}</strong>
            <span>
              {issue.message}
              {issue.path ? <code>{issue.path}</code> : null}
            </span>
          </li>
        ))}
        {validation.warnings.map((issue) => (
          <li
            className="local-plugin-marketplace__issue--warning"
            key={`warning:${issue.code}:${issue.path ?? ""}:${issue.message}`}
          >
            <strong>{tr("警告")}</strong>
            <span>
              {issue.message}
              {issue.path ? <code>{issue.path}</code> : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function LocalPluginMarketplace({ onChanged }: LocalPluginMarketplaceProps) {
  const { confirm } = useDialog();
  const [sources, setSources] = useState<LocalPluginMarketSource[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [market, setMarket] = useState<LocalPluginMarketView | null>(null);
  const [marketPath, setMarketPath] = useState("");
  const [validationPath, setValidationPath] = useState("");
  const [validation, setValidation] = useState<LocalPluginValidation | null>(null);
  const [query, setQuery] = useState("");
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [pluginBusy, setPluginBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const mounted = useRef(true);
  const marketRequest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      marketRequest.current += 1;
    };
  }, []);

  const applySources = useCallback(
    (next: LocalPluginMarketSource[], preferredId?: string | null) => {
      setSources(next);
      const preferred: string | null =
        preferredId && next.some((source) => source.id === preferredId)
          ? preferredId
          : (next[0]?.id ?? null);
      setSelectedMarketId((current) =>
        current && next.some((source) => source.id === current) ? current : preferred,
      );
      if (!next.length) {
        setMarket(null);
        setAddOpen(true);
      }
    },
    [],
  );

  const loadMarket = useCallback(async (id: string) => {
    const request = ++marketRequest.current;
    setLoadingMarket(true);
    setError("");
    try {
      const next = await window.mingshen.getLocalPluginMarket(id);
      if (mounted.current && request === marketRequest.current) setMarket(next);
    } catch (cause) {
      if (mounted.current && request === marketRequest.current) {
        setMarket(null);
        setError(message(cause));
      }
    } finally {
      if (mounted.current && request === marketRequest.current) setLoadingMarket(false);
    }
  }, []);

  const loadSources = useCallback(async () => {
    setLoadingSources(true);
    setError("");
    try {
      const next = await window.mingshen.listLocalPluginMarkets();
      if (!mounted.current) return;
      applySources(next);
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setLoadingSources(false);
    }
  }, [applySources]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    if (selectedMarketId) void loadMarket(selectedMarketId);
  }, [loadMarket, selectedMarketId]);

  const addMarket = async (event: FormEvent) => {
    event.preventDefault();
    const path = marketPath.trim();
    if (!path) {
      setError(tr("请选择或输入本地插件市场的目录。"));
      return;
    }
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const view = await window.mingshen.addLocalPluginMarket(path);
      if (!mounted.current) return;
      setMarket(view);
      setSelectedMarketId(view.market.id);
      setMarketPath("");
      setAddOpen(false);
      setNotice(tr("本地插件市场已添加。"));
      const next = await window.mingshen.listLocalPluginMarkets();
      if (mounted.current) applySources(next, view.market.id);
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setAdding(false);
    }
  };

  const chooseMarketDirectory = async () => {
    setError("");
    try {
      const directory = await window.mingshen.chooseExtensionDirectory();
      if (directory && mounted.current) setMarketPath(directory);
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    }
  };

  const chooseValidationDirectory = async () => {
    setError("");
    try {
      const directory = await window.mingshen.chooseExtensionDirectory();
      if (directory && mounted.current) {
        setValidationPath(directory);
        setValidation(null);
      }
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    }
  };

  const refreshMarket = async () => {
    if (!selectedMarketId) return;
    setRefreshing(true);
    setError("");
    setNotice("");
    try {
      const next = await window.mingshen.refreshLocalPluginMarket(selectedMarketId);
      if (!mounted.current) return;
      setMarket(next);
      setSources((current) =>
        current.map((source) => (source.id === next.market.id ? next.market : source)),
      );
      setNotice(tr("本地市场已刷新。"));
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  const removeSource = async () => {
    if (!market) return;
    const confirmed = await confirm({
      title: tr("移除本地市场源？"),
      description: tr("只会移除对「{0}」的市场引用，已经安装的插件和扩展不会卸载。", [
        market.market.displayName || market.market.name,
      ]),
      confirmLabel: tr("移除市场源"),
      tone: "danger",
    });
    if (!confirmed || !mounted.current) return;
    setRemoving(true);
    setError("");
    setNotice("");
    try {
      await window.mingshen.removeLocalPluginMarket(market.market.id);
      if (!mounted.current) return;
      const next = await window.mingshen.listLocalPluginMarkets();
      if (!mounted.current) return;
      applySources(next, null);
      setNotice(tr("本地市场源已移除，已安装插件保持不变。"));
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setRemoving(false);
    }
  };

  const validateDirectory = async (event?: FormEvent) => {
    event?.preventDefault();
    const path = validationPath.trim();
    if (!path) {
      setError(tr("请选择或输入要校验的插件目录。"));
      return;
    }
    setValidating(true);
    setValidation(null);
    setError("");
    setNotice("");
    try {
      const result = await window.mingshen.validateLocalPlugin(path);
      if (!mounted.current) return;
      setValidation(result);
      setNotice(
        result.ok
          ? tr("插件目录校验通过，可加入本地市场后手动安装。")
          : tr("插件目录存在需要修复的校验错误。"),
      );
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setValidating(false);
    }
  };

  const refreshAfterChange = async (marketId: string): Promise<string> => {
    const warnings: string[] = [];
    try {
      await onChanged();
    } catch (cause) {
      warnings.push(tr("扩展列表刷新失败：{0}", [message(cause)]));
    }
    try {
      const next = await window.mingshen.getLocalPluginMarket(marketId);
      if (mounted.current) setMarket(next);
    } catch (cause) {
      warnings.push(tr("市场状态刷新失败：{0}", [message(cause)]));
    }
    return warnings.join("\n");
  };

  const installPlugin = async (pluginName: string, update: boolean) => {
    if (!selectedMarketId) return;
    setPluginBusy(`${update ? "update" : "install"}:${pluginName}`);
    setError("");
    setNotice("");
    try {
      const result = update
        ? await window.mingshen.updateLocalPlugin(selectedMarketId, pluginName)
        : await window.mingshen.installLocalPlugin(selectedMarketId, pluginName);
      const refreshWarnings = await refreshAfterChange(selectedMarketId);
      if (!mounted.current) return;
      setNotice(
        result.action === "updated"
          ? tr("「{0}」已更新，下一轮对话使用新版本。", [result.extension.name])
          : result.action === "installed"
            ? tr("「{0}」已安装并默认启用。", [result.extension.name])
            : result.plugin.validation.mcpServers.length
              ? tr("「{0}」的 MCP 声明已同步。", [result.extension.name])
              : tr("「{0}」已是最新版本。", [result.extension.name]),
      );
      const warnings = [...result.warnings, refreshWarnings].filter(Boolean);
      if (warnings.length) setError(warnings.join("\n"));
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setPluginBusy(null);
    }
  };

  const setPluginEnabled = async (extensionId: string, enabled: boolean) => {
    if (!selectedMarketId) return;
    setPluginBusy(`enabled:${extensionId}`);
    setError("");
    setNotice("");
    try {
      await window.mingshen.setExtensionEnabled(extensionId, enabled);
      const refreshWarnings = await refreshAfterChange(selectedMarketId);
      if (!mounted.current) return;
      setNotice(enabled ? tr("插件已启用。") : tr("插件已禁用。"));
      if (refreshWarnings) setError(refreshWarnings);
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setPluginBusy(null);
    }
  };

  const filteredPlugins = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized || !market) return market?.plugins ?? [];
    return market.plugins.filter((plugin) =>
      `${plugin.displayName} ${plugin.name} ${plugin.description} ${plugin.category}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [market, query]);

  const updateCount = market?.plugins.filter((plugin) => plugin.updateAvailable).length ?? 0;
  const installedCount = market?.plugins.filter((plugin) => plugin.installed).length ?? 0;

  return (
    <section
      className="settings-block local-plugin-marketplace"
      data-testid="local-plugin-marketplace"
    >
      <div className="settings-block__heading local-plugin-marketplace__heading">
        <div>
          <h3>
            <HardDrive aria-hidden="true" size={15} />
            {tr("本地插件开发市场")}
          </h3>
          <p>
            {tr(
              "添加本地 marketplace.json 目录，校验后安装或更新插件。市场只读取本机文件，不下载远端代码。",
            )}
          </p>
        </div>
        <button
          className="btn btn--secondary"
          type="button"
          onClick={() => setAddOpen((open) => !open)}
          aria-expanded={addOpen}
        >
          <PackagePlus aria-hidden="true" size={14} />
          {tr("添加市场")}
        </button>
      </div>

      {error ? (
        <p className="form-error local-plugin-marketplace__alert" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="local-plugin-marketplace__notice" role="status">
          <Check aria-hidden="true" size={13} />
          {notice}
        </p>
      ) : null}

      {addOpen ? (
        <form
          className="local-plugin-marketplace__form"
          onSubmit={(event) => void addMarket(event)}
        >
          <div className="local-plugin-marketplace__field">
            <span>{tr("市场目录或 marketplace.json")}</span>
            <div className="local-plugin-marketplace__path-row">
              <input
                data-testid="local-plugin-market-path"
                aria-label={tr("市场目录或 marketplace.json")}
                value={marketPath}
                onChange={(event) => setMarketPath(event.target.value)}
                placeholder="C:\\plugins\\marketplace.json"
                spellCheck={false}
              />
              <button
                className="icon-button"
                type="button"
                onClick={() => void chooseMarketDirectory()}
                title={tr("选择市场目录")}
                aria-label={tr("选择市场目录")}
              >
                <FolderOpen aria-hidden="true" size={14} />
              </button>
              <button
                className="btn btn--primary"
                data-testid="local-plugin-market-add"
                type="submit"
                disabled={adding || Boolean(pluginBusy)}
              >
                {adding ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : (
                  <PackagePlus aria-hidden="true" size={14} />
                )}
                {tr("添加")}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {loadingSources ? (
        <p className="local-plugin-marketplace__loading">
          <LoaderCircle className="spin" aria-hidden="true" size={14} />
          {tr("正在读取本地市场…")}
        </p>
      ) : sources.length ? (
        <>
          <div className="local-plugin-marketplace__source-row">
            <label>
              <span>{tr("开发市场")}</span>
              <select
                data-testid="local-plugin-market-select"
                value={selectedMarketId ?? ""}
                disabled={Boolean(pluginBusy) || refreshing}
                onChange={(event) => {
                  setSelectedMarketId(event.target.value || null);
                  setQuery("");
                }}
              >
                {sources.map((source) => (
                  <option value={source.id} key={source.id}>
                    {source.displayName || source.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="local-plugin-marketplace__source-actions">
              <button
                className="btn btn--secondary"
                data-testid="local-plugin-market-refresh"
                type="button"
                onClick={() => void refreshMarket()}
                disabled={refreshing || loadingMarket || !selectedMarketId || Boolean(pluginBusy)}
              >
                <RefreshCw
                  className={refreshing ? "spin" : undefined}
                  aria-hidden="true"
                  size={14}
                />
                {tr("刷新")}
              </button>
              <button
                className="icon-button icon-button--danger"
                data-testid="local-plugin-market-remove"
                type="button"
                onClick={() => void removeSource()}
                disabled={removing || !market || loadingMarket || Boolean(pluginBusy)}
                title={tr("移除市场源")}
                aria-label={tr("移除市场源")}
              >
                {removing ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : (
                  <Trash2 aria-hidden="true" size={14} />
                )}
              </button>
            </div>
          </div>

          {market ? (
            <div className="local-plugin-marketplace__market-meta">
              <code title={market.market.catalogPath}>{market.market.catalogPath}</code>
              <span>
                {tr("{0} 个插件", [market.plugins.length])} · {tr("{0} 个已安装", [installedCount])}
                {updateCount ? <strong>{tr(" · {0} 个可更新", [updateCount])}</strong> : null}
              </span>
            </div>
          ) : null}

          {market?.warnings.length ? (
            <div className="local-plugin-marketplace__market-warning" role="status">
              <AlertTriangle aria-hidden="true" size={13} />
              <span>{market.warnings.join(" ")}</span>
            </div>
          ) : null}

          <div className="local-plugin-marketplace__hook-boundary">
            <ShieldCheck aria-hidden="true" size={14} />
            <span>
              {tr(
                "安装并启用只提供发现能力。若插件 Hook 需要生效，请在当前 CodeAgent/WorkAgent 会话的 + 菜单或 /plugins 中引用该插件。动作型 Hook 还要求宿主执行、完全访问和已信任项目；请求批准、Docker、ChatAgent 与实际 SubAgent 不会执行。",
              )}
            </span>
          </div>

          <label className="local-plugin-marketplace__search">
            <Search aria-hidden="true" size={14} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tr("搜索本地插件")}
              aria-label={tr("搜索本地插件")}
            />
          </label>

          {loadingMarket ? (
            <p className="local-plugin-marketplace__loading">
              <LoaderCircle className="spin" aria-hidden="true" size={14} />
              {tr("正在校验市场插件…")}
            </p>
          ) : !market ? (
            <div className="local-plugin-marketplace__empty">
              <HardDrive aria-hidden="true" size={22} />
              <strong>{tr("无法显示此市场")}</strong>
              <p>{tr("刷新市场或重新添加目录后再试。")}</p>
            </div>
          ) : market.plugins.length === 0 ? (
            <div className="local-plugin-marketplace__empty">
              <PackagePlus aria-hidden="true" size={22} />
              <strong>{tr("此市场还没有插件")}</strong>
              <p>{tr("在 marketplace.json 中添加插件目录，然后刷新市场。")}</p>
            </div>
          ) : filteredPlugins.length === 0 ? (
            <div className="local-plugin-marketplace__empty">
              <Search aria-hidden="true" size={22} />
              <strong>{tr("没有匹配的插件")}</strong>
              <p>{tr("清空搜索词，或刷新市场目录。")}</p>
            </div>
          ) : (
            <div className="local-plugin-marketplace__plugin-list">
              {filteredPlugins.map((plugin) => {
                const installBusy = pluginBusy === `install:${plugin.name}`;
                const updateBusy = pluginBusy === `update:${plugin.name}`;
                const toggleBusy =
                  Boolean(plugin.extensionId) && pluginBusy === `enabled:${plugin.extensionId}`;
                return (
                  <article
                    className="local-plugin-marketplace__plugin"
                    data-testid={`local-plugin-${plugin.name}`}
                    key={plugin.id}
                  >
                    <span className="local-plugin-marketplace__plugin-mark" aria-hidden="true">
                      <PackagePlus size={16} />
                    </span>
                    <div className="local-plugin-marketplace__plugin-main">
                      <div className="local-plugin-marketplace__plugin-title">
                        <strong>{plugin.displayName || plugin.name}</strong>
                        <span>{plugin.version || tr("无版本")}</span>
                        {plugin.updateAvailable ? (
                          <b>{tr("可更新")}</b>
                        ) : plugin.installed ? (
                          <b className="is-installed">{tr("已安装")}</b>
                        ) : null}
                      </div>
                      <p>{plugin.description || tr("该插件未提供描述。")}</p>
                      <div className="local-plugin-marketplace__plugin-meta">
                        <span>{manifestKindLabel(plugin.validation.manifestKind)}</span>
                        <span>{tr("{0} 个技能", [plugin.validation.skills.length])}</span>
                        <span>{tr("{0} 个命令", [plugin.validation.commands.length])}</span>
                        <span>{tr("{0} 个 MCP", [plugin.validation.mcpServers.length])}</span>
                        <span>{tr("{0} 个 Hook", [plugin.validation.hookEvents.length])}</span>
                        <code title={plugin.sourcePath}>{plugin.source}</code>
                      </div>
                      <ValidationIssues
                        validation={plugin.validation}
                        label={
                          plugin.validation.ok
                            ? tr("{0} 个警告", [plugin.validation.warnings.length])
                            : undefined
                        }
                      />
                    </div>
                    <div className="local-plugin-marketplace__plugin-actions">
                      {plugin.installed && plugin.extensionId ? (
                        <button
                          className={
                            plugin.enabled ? "switch-button switch-button--on" : "switch-button"
                          }
                          data-testid={`local-plugin-toggle-${plugin.name}`}
                          type="button"
                          role="switch"
                          aria-checked={plugin.enabled}
                          aria-label={plugin.enabled ? tr("禁用扩展") : tr("启用扩展")}
                          disabled={Boolean(pluginBusy)}
                          onClick={() => {
                            if (plugin.extensionId) {
                              void setPluginEnabled(plugin.extensionId, !plugin.enabled);
                            }
                          }}
                        >
                          {toggleBusy ? (
                            <LoaderCircle className="spin" aria-hidden="true" size={13} />
                          ) : (
                            <Power aria-hidden="true" size={13} />
                          )}
                        </button>
                      ) : null}
                      {plugin.updateAvailable ? (
                        <button
                          className="btn btn--primary"
                          data-testid={`local-plugin-update-${plugin.name}`}
                          type="button"
                          disabled={Boolean(pluginBusy) || !plugin.validation.ok}
                          onClick={() => void installPlugin(plugin.name, true)}
                        >
                          {updateBusy ? (
                            <LoaderCircle className="spin" aria-hidden="true" size={14} />
                          ) : (
                            <RefreshCw aria-hidden="true" size={14} />
                          )}
                          {tr("更新")}
                        </button>
                      ) : plugin.installed ? (
                        <>
                          <span className="local-plugin-marketplace__installed-version">
                            {plugin.installedVersion
                              ? tr("已装 {0}", [plugin.installedVersion])
                              : tr("已安装")}
                          </span>
                          {plugin.validation.mcpServers.length ? (
                            <button
                              className="icon-button"
                              data-testid={`local-plugin-sync-${plugin.name}`}
                              type="button"
                              disabled={Boolean(pluginBusy) || !plugin.validation.ok}
                              onClick={() => void installPlugin(plugin.name, false)}
                              title={tr("重试 MCP 同步")}
                              aria-label={tr("重试 MCP 同步")}
                            >
                              {installBusy ? (
                                <LoaderCircle className="spin" aria-hidden="true" size={14} />
                              ) : (
                                <RefreshCw aria-hidden="true" size={14} />
                              )}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <button
                          className="btn btn--primary"
                          data-testid={`local-plugin-install-${plugin.name}`}
                          type="button"
                          disabled={Boolean(pluginBusy) || !plugin.validation.ok}
                          onClick={() => void installPlugin(plugin.name, false)}
                        >
                          {installBusy ? (
                            <LoaderCircle className="spin" aria-hidden="true" size={14} />
                          ) : (
                            <PackagePlus aria-hidden="true" size={14} />
                          )}
                          {tr("安装")}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : loadingSources ? null : (
        <div className="local-plugin-marketplace__empty">
          <HardDrive aria-hidden="true" size={22} />
          <strong>{tr("还没有本地开发市场")}</strong>
          <p>{tr("添加包含 marketplace.json 的目录，或直接粘贴插件清单路径。")}</p>
        </div>
      )}

      <form
        className="local-plugin-marketplace__validator"
        onSubmit={(event) => void validateDirectory(event)}
      >
        <div>
          <strong>{tr("校验开发目录")}</strong>
          <p>{tr("安装前检查清单、技能入口、引用路径和声明文件。")}</p>
        </div>
        <div className="local-plugin-marketplace__path-row">
          <input
            data-testid="local-plugin-validation-path"
            value={validationPath}
            onChange={(event) => {
              setValidationPath(event.target.value);
              setValidation(null);
            }}
            placeholder={tr("插件根目录")}
            spellCheck={false}
            aria-label={tr("要校验的插件目录")}
          />
          <button
            className="icon-button"
            type="button"
            onClick={() => void chooseValidationDirectory()}
            title={tr("选择插件目录")}
            aria-label={tr("选择插件目录")}
          >
            <FolderOpen aria-hidden="true" size={14} />
          </button>
          <button
            className="btn btn--secondary"
            data-testid="local-plugin-validate"
            type="submit"
            disabled={validating}
          >
            {validating ? (
              <LoaderCircle className="spin" aria-hidden="true" size={14} />
            ) : (
              <ShieldCheck aria-hidden="true" size={14} />
            )}
            {tr("校验")}
          </button>
        </div>
        {validation ? (
          <div
            className={
              validation.ok
                ? "local-plugin-marketplace__validation-result"
                : "local-plugin-marketplace__validation-result has-errors"
            }
            data-testid="local-plugin-validation-result"
          >
            <div>
              <strong>{validation.name || tr("未命名插件")}</strong>
              <span>
                {validation.version || tr("无版本")} · {manifestKindLabel(validation.manifestKind)}
              </span>
              <code title={validation.rootPath}>{validation.rootPath}</code>
            </div>
            <ValidationIssues validation={validation} />
          </div>
        ) : null}
      </form>
    </section>
  );
}
