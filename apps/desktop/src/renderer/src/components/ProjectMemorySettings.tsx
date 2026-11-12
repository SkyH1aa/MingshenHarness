import { FileText, FolderCheck, FolderOpen, FolderX, RefreshCw, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ModelReference,
  ProjectInstructionView,
  ProviderView,
  SessionView,
} from "../../../shared/domain";
import type { MemoryBackend, ProjectMemoryConfiguration } from "../../../shared/project-memory";
import { tr } from "../i18n/index";
import { useDialog } from "./DialogProvider";
import { ModelPicker } from "./ModelPicker";
import { ProjectDiarySettings } from "./ProjectDiarySettings";

function workspaceKey(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function sameModel(left: ModelReference | null, right: ModelReference | null): boolean {
  return left?.providerId === right?.providerId && left?.modelId === right?.modelId;
}

function settingsError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return tr(message.replace(/^Error invoking remote method '[^']+': Error: /, ""));
}

export function ProjectMemorySettings({
  workspacePath: initialWorkspace,
  sessionId,
  providers,
  sessions,
  onDirtyChange,
}: {
  workspacePath: string | null;
  sessionId: string | null;
  providers: ProviderView[];
  sessions: SessionView[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [workspacePath, setWorkspacePath] = useState<string | null>(
    initialWorkspace ?? sessions.find((session) => !session.parentSessionId)?.workspacePath ?? null,
  );
  const [browsedWorkspaces, setBrowsedWorkspaces] = useState<string[]>([]);
  const [instructions, setInstructions] = useState<ProjectInstructionView[]>([]);
  const [trusted, setTrusted] = useState(false);
  const [configuration, setConfiguration] = useState<ProjectMemoryConfiguration | null>(null);
  const [backend, setBackend] = useState<MemoryBackend | "">("");
  const [analysisModel, setAnalysisModel] = useState<ModelReference | null>(null);
  const [fallbackModel, setFallbackModel] = useState<ModelReference | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [trustBusy, setTrustBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [errors, setErrors] = useState({ configuration: "", instructions: "", trust: "" });
  const [notice, setNotice] = useState("");
  const [memoryDirty, setMemoryDirty] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const requestRef = useRef(0);
  const selectionRef = useRef(workspacePath);
  const { confirm } = useDialog();

  const workspaces = useMemo(() => {
    const paths = new Map<string, string>();
    for (const path of [
      initialWorkspace,
      ...sessions
        .filter((session) => !session.parentSessionId)
        .map((session) => session.workspacePath),
      ...browsedWorkspaces,
      workspacePath,
    ]) {
      if (path) paths.set(workspaceKey(path), path);
    }
    return [...paths.values()];
  }, [initialWorkspace, sessions, browsedWorkspaces, workspacePath]);
  const memoryWorkspace = configuration?.workspacePath ?? workspacePath;
  const selectedSessions = sessions.filter(
    (session) =>
      !session.parentSessionId &&
      session.workspacePath &&
      memoryWorkspace &&
      workspaceKey(session.workspacePath) === workspaceKey(memoryWorkspace),
  );
  const memorySession =
    selectedSessions.find((session) => session.id === sessionId) ??
    selectedSessions.find((session) => !session.archived) ??
    selectedSessions[0];
  const activeSession = sessions.find((session) => session.id === sessionId);
  const readOnly = Boolean(
    activeSession?.parentSessionId &&
      activeSession.workspacePath &&
      workspacePath &&
      workspaceKey(activeSession.workspacePath) === workspaceKey(workspacePath),
  );
  const configurationDirty =
    Boolean(backend) &&
    (backend !== configuration?.backend ||
      !sameModel(analysisModel, configuration?.analysisModel ?? null) ||
      !sameModel(fallbackModel, configuration?.fallbackModel ?? null));
  const disabled = loading || saving || trustBusy;
  const modelProviders = providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model) =>
          model.enabled &&
          model.inputModalities.includes("text") &&
          model.outputModalities.includes("text"),
      ),
    }))
    .filter((provider) => provider.models.length > 0);
  const modelAvailable = (reference: ModelReference | null) =>
    !reference ||
    modelProviders.some(
      (provider) =>
        provider.id === reference.providerId &&
        provider.models.some((model) => model.id === reference.modelId),
    );
  const modelsUnavailable = !modelAvailable(analysisModel) || !modelAvailable(fallbackModel);

  useEffect(() => {
    onDirtyChange?.(configurationDirty || memoryDirty);
  }, [configurationDirty, memoryDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    setInstructions([]);
    setTrusted(false);
    setConfiguration(null);
    setBackend("");
    setAnalysisModel(null);
    setFallbackModel(null);
    setLoaded(false);
    setErrors({ configuration: "", instructions: "", trust: "" });
    setNotice("");
    if (!workspacePath) return;
    setLoading(true);
    const [nextConfiguration, nextInstructions, nextTrusted] = await Promise.allSettled([
      window.mingshen.getProjectMemoryConfiguration(workspacePath),
      window.mingshen.discoverProjectInstructions(workspacePath),
      window.mingshen.getProjectTrust(workspacePath),
    ]);
    if (request !== requestRef.current || selectionRef.current !== workspacePath) return;
    if (nextConfiguration.status === "fulfilled") {
      setConfiguration(nextConfiguration.value);
      setBackend(nextConfiguration.value.backend);
      setAnalysisModel(nextConfiguration.value.analysisModel);
      setFallbackModel(nextConfiguration.value.fallbackModel);
    }
    if (nextInstructions.status === "fulfilled") setInstructions(nextInstructions.value);
    if (nextTrusted.status === "fulfilled") setTrusted(nextTrusted.value);
    setErrors({
      configuration:
        nextConfiguration.status === "rejected" ? settingsError(nextConfiguration.reason) : "",
      instructions:
        nextInstructions.status === "rejected" ? settingsError(nextInstructions.reason) : "",
      trust: nextTrusted.status === "rejected" ? settingsError(nextTrusted.reason) : "",
    });
    setLoaded(true);
    setLoading(false);
  }, [workspacePath]);

  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current += 1;
    };
  }, [refresh]);

  const canDiscard = async () =>
    !(configurationDirty || memoryDirty) ||
    (await confirm({
      title: tr("放弃未保存的项目修改？"),
      description: tr("尚未保存的记忆配置或记忆内容将被丢弃。"),
      confirmLabel: tr("放弃修改"),
    }));

  const selectWorkspace = async (path: string) => {
    if (workspacePath && workspaceKey(path) === workspaceKey(workspacePath)) return;
    if (!(await canDiscard())) return;
    selectionRef.current = path;
    requestRef.current += 1;
    setMemoryDirty(false);
    setConfiguration(null);
    setBackend("");
    setLoaded(false);
    setInstructions([]);
    setTrusted(false);
    setWorkspacePath(path);
    setBrowsedWorkspaces((current) =>
      current.some((item) => workspaceKey(item) === workspaceKey(path))
        ? current
        : [...current, path],
    );
  };

  const browseWorkspace = async () => {
    setBrowsing(true);
    try {
      const path = await window.mingshen.chooseWorkspace();
      if (path) await selectWorkspace(path);
    } catch (cause) {
      setErrors((current) => ({ ...current, configuration: settingsError(cause) }));
    } finally {
      setBrowsing(false);
    }
  };

  const saveConfiguration = async () => {
    if (!workspacePath || !backend) return;
    const switchingBackend = configuration?.backend !== backend;
    if (
      switchingBackend &&
      memoryDirty &&
      !(await confirm({
        title: tr("放弃未保存的记忆修改？"),
        description: tr("切换记忆方案后将重新读取所选方案的记忆内容。"),
        confirmLabel: tr("切换记忆方案"),
      }))
    )
      return;
    setSaving(true);
    setNotice("");
    setErrors((current) => ({ ...current, configuration: "" }));
    try {
      const next = await window.mingshen.setProjectMemoryConfiguration({
        workspacePath: configuration?.workspacePath ?? workspacePath,
        backend,
        analysisModel,
        fallbackModel,
      });
      if (selectionRef.current !== workspacePath) return;
      setConfiguration(next);
      setBackend(next.backend);
      setAnalysisModel(next.analysisModel);
      setFallbackModel(next.fallbackModel);
      if (switchingBackend) {
        setMemoryDirty(false);
        setEditorVersion((current) => current + 1);
      }
      setNotice(tr("项目记忆配置已保存。"));
    } catch (cause) {
      setErrors((current) => ({ ...current, configuration: settingsError(cause) }));
    } finally {
      setSaving(false);
    }
  };

  const setProjectTrust = async (next: boolean) => {
    if (!workspacePath) return;
    setTrustBusy(true);
    setErrors((current) => ({ ...current, trust: "" }));
    try {
      await window.mingshen.setProjectTrust(workspacePath, next);
      if (selectionRef.current === workspacePath) setTrusted(next);
    } catch (cause) {
      if (selectionRef.current === workspacePath)
        setErrors((current) => ({ ...current, trust: settingsError(cause) }));
    } finally {
      setTrustBusy(false);
    }
  };

  return (
    <div className="settings-page project-memory-settings" data-unsaved={configurationDirty}>
      <section className="settings-block">
        <div className="settings-block__heading">
          <h3>{tr("工作区")}</h3>
          <button
            className="icon-button"
            type="button"
            aria-label={tr("刷新工作区设置")}
            title={tr("刷新工作区设置")}
            disabled={!workspacePath || disabled || browsing}
            onClick={() =>
              void (async () => {
                if (!(await canDiscard())) return;
                setMemoryDirty(false);
                setEditorVersion((current) => current + 1);
                await refresh();
              })()
            }
          >
            <RefreshCw className={loading ? "spin" : undefined} aria-hidden="true" size={15} />
          </button>
        </div>
        <div className="field">
          <label htmlFor="project-memory-workspace">{tr("工作文件夹")}</label>
          <div className="project-memory-workspace">
            <select
              id="project-memory-workspace"
              value={workspacePath ?? ""}
              disabled={saving || trustBusy || browsing}
              onChange={(event) => void selectWorkspace(event.target.value)}
            >
              {!workspacePath ? <option value="">{tr("选择工作文件夹")}</option> : null}
              {workspaces.map((path) => (
                <option value={path} key={workspaceKey(path)}>
                  {path}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              type="button"
              aria-label={tr("浏览工作文件夹")}
              title={tr("浏览工作文件夹")}
              disabled={saving || trustBusy || browsing}
              onClick={() => void browseWorkspace()}
            >
              <FolderOpen aria-hidden="true" size={17} />
            </button>
          </div>
        </div>
      </section>
      {workspacePath ? (
        <>
          <section className="settings-block" aria-labelledby="project-memory-configuration-title">
            <div className="settings-block__heading">
              <h3 id="project-memory-configuration-title">{tr("记忆配置")}</h3>
            </div>
            {configuration &&
            workspaceKey(configuration.workspacePath) !== workspaceKey(workspacePath) ? (
              <p className="quiet-copy project-memory-owner">
                {tr("记忆归属工作区：{0}", [configuration.workspacePath])}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="project-memory-backend">{tr("项目记忆方案")}</label>
              <select
                id="project-memory-backend"
                value={backend}
                disabled={disabled || !loaded}
                onChange={(event) => {
                  setBackend(event.target.value as MemoryBackend);
                  setNotice("");
                }}
              >
                {!backend ? <option value="">{tr("选择记忆方案")}</option> : null}
                <option value="native">{tr("原生 Memory")}</option>
                <option value="tencentdb">{tr("TencentDB Agent Memory（本地核心）")}</option>
              </select>
            </div>
            {backend === "tencentdb" ? (
              <>
                <fieldset
                  className="field field-group"
                  aria-labelledby="project-memory-analysis-label"
                >
                  <legend id="project-memory-analysis-label">{tr("记忆分析模型")}</legend>
                  <div className="project-memory-model">
                    <ModelPicker
                      providers={modelProviders}
                      value={
                        analysisModel
                          ? {
                              providerId: analysisModel.providerId,
                              configId: analysisModel.modelId,
                            }
                          : null
                      }
                      disabled={disabled || !loaded}
                      onChange={(selection) => {
                        const next = {
                          providerId: selection.providerId,
                          modelId: selection.configId,
                        };
                        setAnalysisModel(next);
                        if (sameModel(next, fallbackModel)) setFallbackModel(null);
                        setNotice("");
                      }}
                    />
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={tr("使用当前对话主 Agent")}
                      title={tr("使用当前对话主 Agent")}
                      disabled={disabled || !analysisModel}
                      onClick={() => {
                        setAnalysisModel(null);
                        setNotice("");
                      }}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <small>
                    {analysisModel
                      ? tr("已选择独立模型")
                      : tr("未指定时使用当前对话的主 Agent 模型。")}
                  </small>
                </fieldset>
                <fieldset
                  className="field field-group"
                  aria-labelledby="project-memory-fallback-label"
                >
                  <legend id="project-memory-fallback-label">
                    {tr("备用记忆分析模型（可选）")}
                  </legend>
                  <div className="project-memory-model">
                    <ModelPicker
                      providers={modelProviders.map((provider) => ({
                        ...provider,
                        models: provider.models.filter(
                          (model) =>
                            !sameModel(analysisModel, {
                              providerId: provider.id,
                              modelId: model.id,
                            }),
                        ),
                      }))}
                      value={
                        fallbackModel
                          ? {
                              providerId: fallbackModel.providerId,
                              configId: fallbackModel.modelId,
                            }
                          : null
                      }
                      disabled={disabled || !loaded}
                      onChange={(selection) => {
                        setFallbackModel({
                          providerId: selection.providerId,
                          modelId: selection.configId,
                        });
                        setNotice("");
                      }}
                    />
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={tr("清除备用记忆分析模型")}
                      title={tr("清除备用记忆分析模型")}
                      disabled={disabled || !fallbackModel}
                      onClick={() => {
                        setFallbackModel(null);
                        setNotice("");
                      }}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </div>
                </fieldset>
                <p className="form-note">
                  {tr(
                    "分析模型会接收本轮对话和相关记忆，并可能产生额外 API 用量。主模型失败时尝试备用模型。",
                  )}
                </p>
                {modelsUnavailable ? (
                  <p className="form-error" role="alert">
                    {tr("已配置的记忆分析模型不可用，请重新选择或清除。")}
                  </p>
                ) : null}
              </>
            ) : null}
            <div className="project-memory-actions">
              <button
                className="btn btn--secondary"
                type="button"
                disabled={
                  disabled ||
                  !loaded ||
                  !backend ||
                  !configurationDirty ||
                  (backend === "tencentdb" && modelsUnavailable)
                }
                onClick={() => void saveConfiguration()}
              >
                <Save aria-hidden="true" size={14} />
                {saving ? tr("正在保存…") : tr("保存记忆配置")}
              </button>
            </div>
            {loading ? (
              <p className="quiet-copy" role="status">
                {tr("正在读取项目记忆配置…")}
              </p>
            ) : null}
            {notice ? (
              <p className="quiet-copy" role="status">
                {notice}
              </p>
            ) : null}
            {errors.configuration ? (
              <p className="form-error" role="alert">
                {errors.configuration}
              </p>
            ) : null}
          </section>
          {configuration && memorySession ? (
            <ProjectDiarySettings
              key={`${memorySession.id}:${configuration.backend}:${editorVersion}`}
              sessionId={memorySession.id}
              readOnly={readOnly}
              onDirtyChange={setMemoryDirty}
            />
          ) : null}
          <section className="settings-block">
            <div className="settings-block__heading">
              <div>
                <h3>{tr("项目信任")}</h3>
                <p>{tr("未信任项目不会自动运行插件 Hook 或项目脚本。")}</p>
              </div>
            </div>
            <div className="project-trust-row">
              <span
                className={trusted ? "project-trust-row__trusted" : "project-trust-row__untrusted"}
              >
                {trusted ? (
                  <FolderCheck aria-hidden="true" size={17} />
                ) : (
                  <FolderX aria-hidden="true" size={17} />
                )}
                <strong>{trusted ? tr("已信任此项目") : tr("未信任此项目")}</strong>
              </span>
              <button
                className="btn btn--secondary"
                type="button"
                disabled={disabled || !loaded || Boolean(errors.trust)}
                onClick={() => void setProjectTrust(!trusted)}
              >
                {trusted ? tr("撤销信任") : tr("信任此项目")}
              </button>
            </div>
            <code className="settings-path" title={workspacePath}>
              {workspacePath}
            </code>
            {errors.trust ? (
              <p className="form-error" role="alert">
                {errors.trust}
              </p>
            ) : null}
          </section>
          <section className="settings-block">
            <div className="settings-block__heading">
              <div>
                <h3>{tr("自动发现的 AGENTS.md")}</h3>
                <p>{tr("从用户级目录到当前工作区逐层加载，最近的规则排在后面。")}</p>
              </div>
            </div>
            {errors.instructions ? (
              <p className="form-error" role="alert">
                {errors.instructions}
              </p>
            ) : null}
            {instructions.length === 0 ? (
              <p className="quiet-copy">
                {loading ? tr("正在读取项目指令…") : tr("没有发现 AGENTS.md 或项目级指令文件。")}
              </p>
            ) : (
              <div className="instruction-list">
                {instructions.map((instruction) => (
                  <details className="instruction-row" key={instruction.path}>
                    <summary>
                      <FileText aria-hidden="true" size={14} />
                      <span>{instruction.scope}</span>
                      <code>{instruction.path}</code>
                      <small>{instruction.source}</small>
                      {instruction.truncated ? <small>{tr("已截断")}</small> : null}
                    </summary>
                    <pre>{instruction.content}</pre>
                  </details>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="settings-block">
          <p className="quiet-copy">{tr("选择工作目录后可配置项目记忆。")}</p>
          {errors.configuration ? (
            <p className="form-error" role="alert">
              {errors.configuration}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
