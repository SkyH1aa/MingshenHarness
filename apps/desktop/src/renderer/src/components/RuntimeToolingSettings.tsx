import {
  Copy,
  ExternalLink,
  FileCode2,
  LoaderCircle,
  Play,
  Server,
  Share2,
  Square,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  AgentRuntimeSettings,
  CustomToolView,
  DockerRuntimeSettings,
  HeadlessServerStatus,
  ProviderView,
  SessionView,
  ToolingServerStatus,
} from "../../../shared/domain";
import { DEFAULT_MODEL_RETRIES, MAX_MODEL_RETRIES } from "../../../shared/model-retry";
import { tr } from "../i18n/index";
import { useDialog } from "./DialogProvider";
import { ExpandableText } from "./ExpandableText";
import {
  type RuntimeGovernanceAdapter,
  RuntimeGovernanceSettings,
} from "./RuntimeGovernanceSettings";

export function RuntimeToolingSettings({
  session,
  onOpenExternal,
  providers = [],
  governanceAdapter,
}: {
  session: SessionView | null;
  onOpenExternal: (url: string) => Promise<void>;
  providers?: ProviderView[];
  governanceAdapter?: RuntimeGovernanceAdapter;
}) {
  const { confirm } = useDialog();
  const [dependencies, setDependencies] = useState<Awaited<
    ReturnType<typeof window.mingshen.getRuntimeDependencies>
  > | null>(null);
  const [dependencyBusy, setDependencyBusy] = useState(false);
  const [tooling, setTooling] = useState<ToolingServerStatus[]>([]);
  const [customTools, setCustomTools] = useState<CustomToolView[]>([]);
  const [docker, setDocker] = useState<DockerRuntimeSettings>({
    image: "mcr.microsoft.com/powershell:lts-alpine",
    dockerfile: "",
    buildContext: ".",
  });
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntimeSettings>({
    maxConcurrentSubagents: 3,
  });
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentNotice, setAgentNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [server, setServer] = useState<HeadlessServerStatus | null>(null);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(4096);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(String(DEFAULT_MODEL_RETRIES));
  const [retryReady, setRetryReady] = useState(false);
  const [retrySaving, setRetrySaving] = useState(false);
  const [retryNotice, setRetryNotice] = useState<{ error: boolean; text: string } | null>(null);
  const loadRetry = useCallback(async () => {
    try {
      const settings = await window.mingshen.getModelRetrySettings();
      setRetryCount(String(settings.maxRetries));
      setRetryReady(true);
      setRetryNotice(null);
    } catch (cause) {
      setRetryNotice({ error: true, text: String(cause) });
    }
  }, []);
  useEffect(() => {
    void loadRetry();
  }, [loadRetry]);
  const saveRetry = async () => {
    setRetrySaving(true);
    setRetryNotice(null);
    try {
      const saved = await window.mingshen.setModelRetrySettings({ maxRetries: Number(retryCount) });
      setRetryCount(String(saved.maxRetries));
      setRetryNotice({ error: false, text: tr("自动重试设置已保存。") });
    } catch (cause) {
      setRetryNotice({ error: true, text: String(cause) });
    } finally {
      setRetrySaving(false);
    }
  };
  const checkDependencies = async () => {
    setDependencyBusy(true);
    try {
      setDependencies(await window.mingshen.getRuntimeDependencies());
    } catch (cause) {
      setNotice(String(cause));
    } finally {
      setDependencyBusy(false);
    }
  };
  const installDependency = async (name: "docker" | "embiody" | "wsl") => {
    if (
      !(await confirm({
        title: name === "docker" ? "Docker Desktop" : name === "wsl" ? "WSL2" : "Embiody",
        description: tr("从官方地址下载并安装。该软件适用独立许可，安装可能需要系统确认或重启。"),
        confirmLabel: tr("安装"),
      }))
    )
      return;
    setDependencyBusy(true);
    try {
      setNotice(await window.mingshen.installRuntimeDependency(name));
    } catch (cause) {
      setNotice(String(cause));
    } finally {
      setDependencyBusy(false);
    }
  };

  const refresh = useCallback(async () => {
    const [nextDocker, nextServer, nextTooling, nextAgentRuntime, nextCustomTools] =
      await Promise.all([
        window.mingshen.getDockerSettings(),
        window.mingshen.getHeadlessServerStatus(),
        session?.workspacePath
          ? window.mingshen.getToolingStatus(session.workspacePath)
          : Promise.resolve([]),
        window.mingshen.getAgentRuntimeSettings(),
        window.mingshen.listCustomTools(session?.workspacePath ?? null),
      ]);
    setDocker(nextDocker);
    setServer(nextServer);
    setAgentRuntime(nextAgentRuntime);
    setCustomTools(nextCustomTools);
    if (nextServer.running) {
      setHost(nextServer.host);
      setPort(nextServer.port);
    }
    setTooling(nextTooling);
  }, [session?.workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveDocker = async () => {
    await window.mingshen.setDockerSettings(docker);
    setNotice(tr("Docker \u8FD0\u884C\u914D\u7F6E\u5DF2\u4FDD\u5B58\u3002"));
  };

  const saveAgentRuntime = async () => {
    setAgentSaving(true);
    setAgentNotice(null);
    try {
      const saved = await window.mingshen.setAgentRuntimeSettings(agentRuntime);
      setAgentRuntime(saved);
      setAgentNotice({ error: false, text: tr("Agent 并行运行配置已保存。") });
    } catch (cause) {
      setAgentNotice({ error: true, text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setAgentSaving(false);
    }
  };

  const toggleServer = async () => {
    setBusy(true);
    try {
      const wasRunning = Boolean(server?.running);
      if (wasRunning) {
        await window.mingshen.stopHeadlessServer();
        setServer(await window.mingshen.getHeadlessServerStatus());
      } else {
        setServer(await window.mingshen.startHeadlessServer(host, port));
      }
      setNotice(
        wasRunning
          ? tr("\u672C\u5730\u670D\u52A1\u5DF2\u505C\u6B62\u3002")
          : tr("\u672C\u5730\u670D\u52A1\u5DF2\u542F\u52A8\u3002"),
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!session) {
      return;
    }
    try {
      const result = await window.mingshen.createSessionShare(session.id);
      await navigator.clipboard.writeText(result.url);
      setNotice(
        tr(
          "\u672C\u5730\u53EA\u8BFB\u5206\u4EAB\u94FE\u63A5\u5DF2\u590D\u5236\uFF0C\u8FC7\u671F\u65F6\u95F4 {0}",
          [new Date(result.expiresAt).toLocaleString()],
        ),
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const copyToken = async () => {
    if (!server?.token) {
      return;
    }
    await navigator.clipboard.writeText(server.token);
    setNotice(tr("\u8BBF\u95EE\u4EE4\u724C\u5DF2\u590D\u5236\u3002"));
  };

  const copyAcpCommand = async () => {
    if (!server?.running || !server.token) {
      return;
    }
    const command = [
      `$env:MINGSHEN_SERVER_URL="${server.url}"`,
      `$env:MINGSHEN_SERVER_TOKEN="${server.token}"`,
      tr('node "<Mingshen Harness \u5B89\u88C5\u76EE\u5F55>\\resources\\sdk\\mingshen-acp.mjs"'),
    ].join("\n");
    await navigator.clipboard.writeText(command);
    setNotice(
      tr(
        "ACP \u542F\u52A8\u547D\u4EE4\u5DF2\u590D\u5236\uFF0C\u53EF\u5728 Zed/JetBrains \u7684 ACP \u81EA\u5B9A\u4E49 Agent \u4E2D\u4F7F\u7528\u3002",
      ),
    );
  };

  return (
    <div className="settings-page">
      {governanceAdapter ? (
        <RuntimeGovernanceSettings adapter={governanceAdapter} providers={providers} />
      ) : null}
      <section className="settings-block" aria-labelledby="model-retry-heading">
        <div className="settings-block__heading">
          <h3 id="model-retry-heading">{tr("模型请求自动重试")}</h3>
        </div>
        <p>
          {tr(
            "默认每次模型回复最多重试 5 次，可调整为 0–20 次；0 表示关闭。部分输出不会重置本次预算，下一模型轮次重新计算。",
          )}
        </p>
        <div className="settings-form-grid">
          <label className="field">
            <span>{tr("每次模型回复的最大重试次数")}</span>
            <input
              aria-describedby="model-retry-hint"
              type="number"
              min={0}
              max={MAX_MODEL_RETRIES}
              step={1}
              value={retryCount}
              disabled={!retryReady || retrySaving}
              onChange={(event) => setRetryCount(event.target.value)}
            />
          </label>
        </div>
        <p id="model-retry-hint">
          {tr(
            "次数是一次模型流调用的总预算，不是每次断连分别计算，也不是整段对话总额。文本、思考或工具参数的部分输出不会重置次数；等待期间可以停止，已完成的工具不会重放。",
          )}
        </p>
        <div className="settings-actions">
          <button
            className="btn btn--primary"
            type="button"
            disabled={
              !retryReady ||
              retrySaving ||
              retryCount.trim() === "" ||
              !Number.isInteger(Number(retryCount)) ||
              Number(retryCount) < 0 ||
              Number(retryCount) > MAX_MODEL_RETRIES
            }
            onClick={() => void saveRetry()}
          >
            {retrySaving ? <LoaderCircle size={14} className="spin" /> : null}
            {tr("保存重试设置")}
          </button>
          {!retryReady ? (
            <button className="btn btn--secondary" type="button" onClick={() => void loadRetry()}>
              {tr("重新加载")}
            </button>
          ) : null}
        </div>
        {retryNotice ? (
          retryNotice.error ? (
            <div role="alert">
              <ExpandableText text={retryNotice.text} className="form-error" tone="error" />
            </div>
          ) : (
            <p className="form-note" role="status">
              {retryNotice.text}
            </p>
          )
        ) : null}
      </section>
      <section className="settings-block">
        <div className="settings-block__heading">
          <h3>{tr("运行依赖")}</h3>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={dependencyBusy}
            onClick={() => void checkDependencies()}
          >
            {dependencyBusy ? <LoaderCircle size={14} className="spin" /> : <Wrench size={14} />}
            {tr("检查依赖")}
          </button>
        </div>
        <p>{tr("BrowserDo 随应用提供；Docker 和 Embiody 从官方渠道安装，受其独立许可约束。")}</p>
        <p>
          {tr(
            "请求批准默认使用 Windows 原生进程沙箱。可在会话中切换 Docker；Git worktree 只隔离编辑目录。隔离不可用时停止执行。",
          )}
        </p>
        <div className="settings-actions">
          <button
            className="btn btn--secondary"
            type="button"
            disabled={dependencyBusy}
            onClick={() => void installDependency("docker")}
          >
            Docker Desktop · {tr("安装")}
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={dependencyBusy}
            onClick={() => void installDependency("embiody")}
          >
            Embiody · {tr("安装")}
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={dependencyBusy}
            onClick={() => void installDependency("wsl")}
          >
            WSL2 · {tr("安装")}
          </button>
        </div>
        {dependencies ? (
          <>
            <p>
              {tr("Windows 原生沙箱")}: {dependencies.native ? tr("就绪") : tr("不可用")}
            </p>
            <ExpandableText text={dependencies.nativeDetail} />
            <p>WSL2: {dependencies.wsl ? tr("就绪") : tr("不可用")}</p>
            <ExpandableText text={dependencies.wslDetail} />
            <p>Docker: {dependencies.docker ? tr("就绪") : tr("不可用")}</p>
            <ExpandableText text={dependencies.dockerDetail} />
            <p>BrowserDo: {dependencies.browserdo ? tr("已连接") : tr("不可用")}</p>
            <ExpandableText text={dependencies.browserDetail} />
          </>
        ) : null}
      </section>
      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("Agent \u5E76\u884C\u6267\u884C")}</h3>
            <p>
              {tr(
                "\u63A7\u5236\u540C\u65F6\u8FD0\u884C\u7684\u5B50 Agent \u6570\u91CF\u3002\u9ED8\u8BA4 3 \u4E2A\uFF0C\u4E0A\u9650 8 \u4E2A\u3002",
              )}
            </p>
          </div>
        </div>
        <div className="settings-form-grid">
          <label className="field">
            <span>{tr("\u6700\u5927\u5E76\u53D1\u5B50 Agent")}</span>
            <input
              type="number"
              min={1}
              max={8}
              disabled={agentSaving}
              value={agentRuntime.maxConcurrentSubagents}
              onChange={(event) =>
                setAgentRuntime({
                  maxConcurrentSubagents: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
        <div className="settings-actions">
          <button
            className="btn btn--primary"
            type="button"
            disabled={agentSaving}
            onClick={() => void saveAgentRuntime()}
          >
            {tr("\u4FDD\u5B58 Agent \u914D\u7F6E")}
          </button>
        </div>
        {agentNotice ? (
          agentNotice.error ? (
            <div role="alert">
              <ExpandableText text={agentNotice.text} className="form-error" tone="error" />
            </div>
          ) : (
            <p className="form-note" role="status">
              {agentNotice.text}
            </p>
          )
        ) : null}
      </section>

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("OpenCode \u81EA\u5B9A\u4E49\u5DE5\u5177")}</h3>
            <p>
              {tr("\u81EA\u52A8\u52A0\u8F7D\u5168\u5C40\u4E0E\u9879\u76EE\u4E2D\u7684")}
              <code>.opencode/tools</code>、 <code>.mingshen/tools</code>{" "}
              {tr(
                "JavaScript/TypeScript \u5DE5\u5177\u3002\u9879\u76EE\u5DE5\u5177\u4EC5\u5728\u4FE1\u4EFB\u76EE\u5F55\u540E\u6267\u884C\u3002",
              )}
            </p>
          </div>
        </div>
        <div className="tooling-status-list">
          {customTools.map((tool) => (
            <article
              className="tooling-status-row tooling-status-row--tool"
              key={`${tool.sourcePath}:${tool.name}`}
            >
              <span className="tooling-status-row__icon">
                <Wrench size={15} />
              </span>
              <div>
                <strong>{tool.name}</strong>
                <ExpandableText
                  preview={[tool.sourcePath, tool.description].filter(Boolean).join(" · ")}
                  text={[tool.sourcePath, tool.description].filter(Boolean).join("\n\n")}
                  className="tooling-status-row__command"
                />
              </div>
              <span className={tool.available ? "state-ok" : "state-muted"}>
                {tr(tool.available ? "\u53EF\u7528" : "\u4E0D\u53EF\u7528")}
              </span>
              {!tool.available && tool.error ? (
                <ExpandableText
                  text={tool.error}
                  className="tooling-status-row__error"
                  tone="error"
                />
              ) : null}
            </article>
          ))}
          {customTools.length === 0 ? (
            <p className="quiet-copy">
              {tr(
                "\u5F53\u524D\u6CA1\u6709\u53D1\u73B0 OpenCode \u517C\u5BB9\u81EA\u5B9A\u4E49\u5DE5\u5177\u3002",
              )}
            </p>
          ) : null}
        </div>
      </section>

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("\u8BED\u8A00\u670D\u52A1\u4E0E\u683C\u5F0F\u5316\u5668")}</h3>
            <p>
              {tr(
                "\u652F\u6301\u9879\u76EE\u914D\u7F6E\u4E2D\u7684\u81EA\u5B9A\u4E49 LSP \u548C Formatter\uFF0C\u547D\u4EE4\u6309\u6587\u4EF6\u6269\u5C55\u540D\u81EA\u52A8\u5339\u914D\u3002",
              )}
            </p>
          </div>
        </div>
        <div className="tooling-status-list">
          {tooling.map((item) => (
            <article className="tooling-status-row" key={`${item.kind}:${item.id}`}>
              <span className="tooling-status-row__icon">
                {item.kind === "lsp" ? <FileCode2 size={15} /> : <Wrench size={15} />}
              </span>
              <div>
                <strong>{item.name}</strong>
                <ExpandableText
                  preview={item.command.join(" ")}
                  text={[item.command.join(" "), item.extensions.join(" ")]
                    .filter(Boolean)
                    .join("\n\n")}
                  className="tooling-status-row__command"
                />
              </div>
              <span>{item.extensions.join(" ")}</span>
              <span className={item.available ? "state-ok" : "state-muted"}>
                {item.available ? tr("\u53EF\u7528") : tr("\u5DF2\u7981\u7528")}
              </span>
            </article>
          ))}
          {tooling.length === 0 ? (
            <p className="quiet-copy">
              {tr(
                "\u5F53\u524D\u5DE5\u4F5C\u533A\u6CA1\u6709\u914D\u7F6E\u989D\u5916\u7684 LSP \u6216 Formatter\u3002",
              )}
            </p>
          ) : null}
        </div>
      </section>

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("Docker \u9694\u79BB")}</h3>
            <p>
              {tr(
                "\u53EF\u4EE5\u56FA\u5B9A\u955C\u50CF\uFF0C\u6216\u6307\u5B9A Dockerfile \u5728\u6BCF\u8F6E\u9694\u79BB\u73AF\u5883\u9996\u6B21\u8FD0\u884C\u65F6\u6784\u5EFA\u3002",
              )}
            </p>
          </div>
        </div>
        <div className="settings-form-grid">
          <label className="field settings-form-grid__full">
            <span>{tr("\u9ED8\u8BA4\u955C\u50CF")}</span>
            <input
              value={docker.image}
              onChange={(event) => setDocker({ ...docker, image: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Dockerfile</span>
            <input
              value={docker.dockerfile}
              onChange={(event) => setDocker({ ...docker, dockerfile: event.target.value })}
              placeholder={tr("\u7559\u7A7A\u65F6\u76F4\u63A5\u4F7F\u7528\u9ED8\u8BA4\u955C\u50CF")}
            />
          </label>
          <label className="field">
            <span>{tr("\u6784\u5EFA\u4E0A\u4E0B\u6587")}</span>
            <input
              value={docker.buildContext}
              onChange={(event) => setDocker({ ...docker, buildContext: event.target.value })}
            />
          </label>
        </div>
        <div className="settings-actions">
          <button className="btn btn--primary" type="button" onClick={() => void saveDocker()}>
            {tr("\u4FDD\u5B58 Docker \u914D\u7F6E")}
          </button>
        </div>
      </section>

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("\u672C\u5730\u65E0\u5934\u670D\u52A1\u4E0E SDK")}</h3>
            <p>
              {tr(
                "\u4EC5\u76D1\u542C\u672C\u673A\u56DE\u73AF\u5730\u5740\uFF0C\u4F7F\u7528 Bearer Token\uFF1B\u5206\u4EAB\u94FE\u63A5\u53EA\u8BFB\u4E14 24 \u5C0F\u65F6\u540E\u5931\u6548\u3002",
              )}
            </p>
          </div>
          <button
            className={server?.running ? "btn btn--danger" : "btn btn--primary"}
            type="button"
            onClick={() => void toggleServer()}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : server?.running ? (
              <Square size={14} />
            ) : (
              <Play size={14} />
            )}
            {server?.running ? tr("\u505C\u6B62\u670D\u52A1") : tr("\u542F\u52A8\u670D\u52A1")}
          </button>
        </div>
        <div className="server-settings-grid">
          <label className="field">
            <span>{tr("\u76D1\u542C\u5730\u5740")}</span>
            <input value={host} onChange={(event) => setHost(event.target.value)} />
          </label>
          <label className="field">
            <span>{tr("\u7AEF\u53E3")}</span>
            <input
              type="number"
              min={1024}
              max={65535}
              value={port}
              onChange={(event) => setPort(Number(event.target.value))}
            />
          </label>
        </div>
        {server?.running ? (
          <>
            <div className="server-connection">
              <Server size={16} />
              <code>{server.url}</code>
              <button className="icon-button" type="button" onClick={() => void copyToken()}>
                <Copy size={14} />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => void onOpenExternal(`${server.url}/doc`)}
              >
                <ExternalLink size={14} />
              </button>
            </div>
            <div className="server-connection">
              <FileCode2 size={16} />
              <code>ACP · mingshen-acp.mjs</code>
              <button
                className="icon-button"
                type="button"
                aria-label={tr("\u590D\u5236 ACP \u542F\u52A8\u547D\u4EE4")}
                onClick={() => void copyAcpCommand()}
              >
                <Copy size={14} />
              </button>
            </div>
          </>
        ) : null}
        <div className="settings-actions">
          <button
            className="btn btn--secondary"
            type="button"
            disabled={!session || !server?.running}
            onClick={() => void share()}
          >
            <Share2 size={14} />
            {tr("\u590D\u5236\u672C\u5730\u5206\u4EAB\u94FE\u63A5")}
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={!session}
            onClick={() => session && void window.mingshen.exportSession(session.id, "markdown")}
          >
            {tr("\u5BFC\u51FA Markdown")}
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={!session}
            onClick={() => session && void window.mingshen.exportSession(session.id, "json")}
          >
            {tr("\u5BFC\u51FA JSON")}
          </button>
        </div>
        {notice ? <p className="form-note">{notice}</p> : null}
      </section>
    </div>
  );
}
