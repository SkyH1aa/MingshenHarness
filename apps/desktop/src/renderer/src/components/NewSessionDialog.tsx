import { FolderOpen, LoaderCircle, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type {
  AgentProfileView,
  PermissionMode,
  ProviderView,
  SessionCreateInput,
  SessionExecutionMode,
  SessionView,
} from "../../../shared/domain";
import type { MemoryBackend, ProjectMemorySelection } from "../../../shared/project-memory";
import { tr } from "../i18n/index";
import { agentLabel } from "../lib/agent-labels";
import { formatPath } from "../lib/format";
import { AgentGuide } from "./AgentGuide";
import { useDialog } from "./DialogProvider";
import { ModelPicker, type ModelSelection } from "./ModelPicker";

interface NewSessionDialogProps {
  providers: ProviderView[];
  agentProfiles: AgentProfileView[];
  initialWorkspacePath?: string | null;
  onClose: () => void;
  onCreated: (session: SessionView) => void;
}

export function NewSessionDialog({
  providers,
  agentProfiles,
  initialWorkspacePath = null,
  onClose,
  onCreated,
}: NewSessionDialogProps) {
  const { confirm } = useDialog();
  const firstProvider = providers.find((provider) => provider.models.length > 0);
  const [selection, setSelection] = useState<ModelSelection | null>(
    firstProvider?.models[0]
      ? { providerId: firstProvider.id, configId: firstProvider.models[0].id }
      : null,
  );
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("request_approval");
  const [agentProfileId, setAgentProfileId] = useState(
    agentProfiles.find((profile) => profile.enabled && profile.id === "primary")?.id ??
      agentProfiles.find((profile) => profile.enabled)?.id ??
      "primary",
  );
  const [executionMode, setExecutionMode] = useState<SessionExecutionMode>("host");
  const [patchOnly, setPatchOnly] = useState(false);
  const [trustPromptedPath, setTrustPromptedPath] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(initialWorkspacePath);
  const [memoryBackend, setMemoryBackend] = useState<MemoryBackend>("native");
  const [memorySelection, setMemorySelection] = useState<
    (ProjectMemorySelection & { path: string | null; request: number }) | null
  >(null);
  const [memoryError, setMemoryError] = useState("");
  const [memoryRefresh, setMemoryRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedProvider = providers.find((provider) => provider.id === selection?.providerId);
  const selectedModel = selectedProvider?.models.find((model) => model.id === selection?.configId);
  const initialReasoning =
    selectedModel?.reasoningLevels.find((level) => level !== "none") ??
    selectedModel?.reasoningLevels[0] ??
    null;
  const [reasoningLevel, setReasoningLevel] = useState<string | null>(initialReasoning);
  useEffect(() => {
    let active = true;
    setMemorySelection(null);
    setMemoryError("");
    void window.mingshen
      .getProjectMemorySelection(workspacePath)
      .then((next) => {
        if (!active) return;
        setMemoryBackend(next.backend);
        setMemorySelection({ ...next, path: workspacePath, request: memoryRefresh });
      })
      .catch((cause) => {
        if (active) {
          const message = cause instanceof Error ? cause.message : String(cause);
          setMemoryError(
            tr(message.replace(/^Error invoking remote method '[^']+': Error: /, "")) ||
              tr("无法读取项目记忆配置，请重试。"),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [workspacePath, memoryRefresh]);
  const memoryReady = Boolean(
    memorySelection &&
      memorySelection.path === workspacePath &&
      memorySelection.request === memoryRefresh,
  );

  const chooseWorkspace = async () => {
    const selected = await window.mingshen.chooseWorkspace();
    if (selected) {
      setWorkspacePath(selected);
      if (!(await window.mingshen.getProjectTrust(selected))) {
        const trusted = await confirm({
          title: tr("\u662F\u5426\u4FE1\u4EFB\u6B64\u5DE5\u4F5C\u76EE\u5F55"),
          description: tr(
            "\u4FE1\u4EFB\u540E\u5141\u8BB8\u9879\u76EE\u7EA7 AGENTS.md\u3001\u63D2\u4EF6 MCP \u548C\u663E\u5F0F\u542F\u7528\u7684 Shell Hook \u5728\u6B64\u76EE\u5F55\u8FD0\u884C\u3002\u4EE3\u7801\u6587\u4EF6\u4ECD\u53D7\u5F53\u524D\u6743\u9650\u6A21\u5F0F\u4FDD\u62A4\u3002",
          ),

          confirmLabel: tr("\u4FE1\u4EFB\u9879\u76EE"),
          cancelLabel: tr("\u6682\u4E0D\u4FE1\u4EFB"),
          tone: "default",
        });
        if (trusted) {
          await window.mingshen.setProjectTrust(selected, true);
        }
        setTrustPromptedPath(selected);
      }
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedModel) {
      setError(tr("\u8BF7\u9009\u62E9\u4E00\u4E2A\u6A21\u578B\u3002"));
      return;
    }
    if (!memoryReady) {
      setError(tr("请先读取项目记忆配置。"));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (
        workspacePath &&
        trustPromptedPath !== workspacePath &&
        !(await window.mingshen.getProjectTrust(workspacePath))
      ) {
        const trusted = await confirm({
          title: tr("\u662F\u5426\u4FE1\u4EFB\u6B64\u5DE5\u4F5C\u76EE\u5F55"),
          description: tr(
            "\u4FE1\u4EFB\u540E\u5141\u8BB8\u9879\u76EE\u7EA7 AGENTS.md\u3001\u63D2\u4EF6 MCP \u548C\u663E\u5F0F\u542F\u7528\u7684 Shell Hook \u5728\u6B64\u76EE\u5F55\u8FD0\u884C\u3002\u6587\u4EF6\u64CD\u4F5C\u4ECD\u9075\u5B88\u5F53\u524D\u6743\u9650\u6A21\u5F0F\u3002",
          ),

          confirmLabel: tr("\u4FE1\u4EFB\u9879\u76EE"),
          cancelLabel: tr("\u6682\u4E0D\u4FE1\u4EFB"),
        });
        if (trusted) {
          await window.mingshen.setProjectTrust(workspacePath, true);
        }
        setTrustPromptedPath(workspacePath);
      }
      const input: SessionCreateInput = {
        providerId: selectedModel.providerId,
        modelId: selectedModel.id,
        agentProfileId,
        workspacePath,
        reasoningLevel,
        permissionMode,
        executionMode,
        patchOnly,
        memoryBackend,
      };
      const session = await window.mingshen.createSession(input);
      onCreated(session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <button
        className="dialog-scrim"
        type="button"
        aria-label={tr("\u5173\u95ED\u65B0\u5EFA\u4F1A\u8BDD")}
        onClick={onClose}
      />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-session-title">
        <header className="dialog__header">
          <h2 id="new-session-title">{tr("\u65B0\u5EFA\u4F1A\u8BDD")}</h2>
          <button
            className="icon-button"
            type="button"
            aria-label={tr("\u5173\u95ED")}
            onClick={onClose}
          >
            <X aria-hidden="true" size={17} />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="dialog__body">
            <div className="field">
              <span>{tr("\u6A21\u578B")}</span>
              <ModelPicker
                providers={providers}
                value={selection}
                onChange={(nextSelection, nextModel) => {
                  setSelection(nextSelection);
                  setReasoningLevel(
                    nextModel.reasoningLevels.find((level) => level !== "none") ??
                      nextModel.reasoningLevels[0] ??
                      null,
                  );
                }}
              />
            </div>

            <div className="field">
              <span>{tr("\u5DE5\u4F5C\u76EE\u5F55")}</span>
              <button className="path-picker" type="button" onClick={chooseWorkspace}>
                <FolderOpen aria-hidden="true" size={15} />
                <span>{formatPath(workspacePath)}</span>
              </button>
            </div>

            <div className="form-grid form-grid--two">
              <label className="field">
                <span>{tr("项目记忆")}</span>
                <select
                  value={memoryBackend}
                  aria-describedby="project-memory-choice-note"
                  disabled={busy || !workspacePath || !memoryReady || memorySelection?.locked}
                  onChange={(event) => setMemoryBackend(event.target.value as MemoryBackend)}
                >
                  <option value="native">{tr("原生 Memory")}</option>
                  <option value="tencentdb">{tr("TencentDB Agent Memory（本地核心）")}</option>
                </select>
              </label>
            </div>
            <p className="form-note" id="project-memory-choice-note" aria-live="polite">
              {!workspacePath
                ? tr("选择工作目录后可配置项目记忆。")
                : !memoryReady && !memoryError
                  ? tr("正在读取项目记忆配置…")
                  : memoryError
                    ? tr("请先读取项目记忆配置。")
                    : memorySelection?.locked
                      ? tr("新会话和子 Agent 默认继承此项目记忆，可在项目指令与信任中修改。")
                      : tr(
                          "原生记忆保存偏好与日记；TencentDB 由记忆分析模型提取结构化记忆，可在项目指令与信任中修改。",
                        )}
            </p>
            {memoryError ? (
              <div className="form-error" role="alert">
                {memoryError}
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() => setMemoryRefresh((value) => value + 1)}
                >
                  {tr("重试")}
                </button>
              </div>
            ) : null}
            <div className="form-grid form-grid--two">
              <label className="field">
                <span>{tr("\u6267\u884C Agent")}</span>
                <select
                  value={agentProfileId}
                  onChange={(event) => setAgentProfileId(event.target.value)}
                >
                  {agentProfiles
                    .filter((profile) => profile.enabled)
                    .map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {agentLabel(profile)}
                      </option>
                    ))}
                </select>
              </label>

              <label className="field">
                <span>{tr("\u601D\u8003\u7B49\u7EA7")}</span>
                <select
                  value={reasoningLevel ?? ""}
                  onChange={(event) => setReasoningLevel(event.target.value || null)}
                >
                  <option value="">{tr("\u4E0D\u8BBE\u7F6E")}</option>
                  {selectedModel?.reasoningLevels.map((level) => (
                    <option value={level} key={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>{tr("\u6743\u9650\u6A21\u5F0F")}</span>
                <select
                  value={permissionMode}
                  onChange={(event) => setPermissionMode(event.target.value as PermissionMode)}
                >
                  <option value="request_approval">{tr("\u8BF7\u6C42\u6279\u51C6")}</option>
                  <option value="full_access">{tr("\u5B8C\u5168\u8BBF\u95EE")}</option>
                </select>
              </label>
            </div>

            <AgentGuide profiles={agentProfiles} />
            <div className="form-grid form-grid--two">
              <label className="field">
                <span>{tr("\u6267\u884C\u9694\u79BB")}</span>
                <select
                  value={executionMode}
                  onChange={(event) => setExecutionMode(event.target.value as SessionExecutionMode)}
                >
                  <option value="host">
                    {tr(permissionMode === "request_approval" ? "Windows 原生沙箱" : "当前工作区")}
                  </option>
                  <option value="worktree">Git worktree</option>
                  <option value="docker">Docker</option>
                </select>
              </label>
              <label className="field field--checkbox">
                <span>{tr("\u8865\u4E01\u7B56\u7565")}</span>
                <span className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={patchOnly}
                    onChange={(event) => setPatchOnly(event.target.checked)}
                  />
                  {tr("\u4EC5\u5141\u8BB8\u8865\u4E01\u5F0F\u6587\u4EF6\u4FEE\u6539")}
                </span>
              </label>
            </div>

            <p className="form-note">
              {tr(
                "\u8BF7\u6C42\u6279\u51C6\u6A21\u5F0F\u4F1A\u62E6\u622A Agent \u7684\u6587\u4EF6\u8BFB\u53D6\u3001\u5199\u5165\u3001\u547D\u4EE4\u548C MCP \u5199\u64CD\u4F5C\u3002\u5B8C\u5168\u8BBF\u95EE\u6A21\u5F0F\u4ECD\u4FDD\u7559\u81F4\u547D\u547D\u4EE4\u4FDD\u62A4\u3002",
              )}
            </p>
            {error ? <p className="form-error">{error}</p> : null}
          </div>

          <footer className="dialog__footer">
            <button className="btn btn--ghost" type="button" onClick={onClose}>
              {tr("\u53D6\u6D88")}
            </button>
            <button
              className="btn btn--primary"
              type="submit"
              disabled={busy || !selectedModel || !memoryReady}
            >
              {busy ? <LoaderCircle className="spin" aria-hidden="true" size={16} /> : null}
              {tr("\u5F00\u59CB\u4F1A\u8BDD")}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
