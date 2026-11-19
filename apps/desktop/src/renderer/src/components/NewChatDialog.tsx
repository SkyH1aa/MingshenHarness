import { FolderPlus, LoaderCircle, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type {
  ChatGroupView,
  ProviderView,
  SessionCreateInput,
  SessionView,
} from "../../../shared/domain";
import { tr } from "../i18n/index";
import { ModelPicker, type ModelSelection } from "./ModelPicker";

interface NewChatDialogProps {
  providers: ProviderView[];
  groups: ChatGroupView[];
  initialGroupId?: string | null;
  onClose: () => void;
  onCreated: (session: SessionView) => void;
}

export function NewChatDialog({
  providers,
  groups,
  initialGroupId = null,
  onClose,
  onCreated,
}: NewChatDialogProps) {
  const firstProvider = providers.find((provider) => provider.models.length > 0);
  const [selection, setSelection] = useState<ModelSelection | null>(
    firstProvider?.models[0]
      ? { providerId: firstProvider.id, configId: firstProvider.models[0].id }
      : null,
  );
  const [reasoningLevel, setReasoningLevel] = useState<string | null>(null);
  const [chatGroupId, setChatGroupId] = useState<string | null>(initialGroupId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedProvider = providers.find((provider) => provider.id === selection?.providerId);
  const selectedModel = selectedProvider?.models.find((model) => model.id === selection?.configId);

  useEffect(() => {
    setReasoningLevel(
      selectedModel?.reasoningLevels.find((level) => level !== "none") ??
        selectedModel?.reasoningLevels[0] ??
        null,
    );
  }, [selectedModel]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedModel) {
      setError(tr("请选择一个模型。"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input: SessionCreateInput = {
        providerId: selectedModel.providerId,
        modelId: selectedModel.id,
        agentMode: "chat",
        chatGroupId,
        agentProfileId: "primary",
        workspacePath: null,
        reasoningLevel,
        permissionMode: "request_approval",
        approvalMode: "manual",
        executionMode: "host",
        patchOnly: false,
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
        aria-label={tr("关闭新建对话")}
        onClick={onClose}
      />
      <div
        className="dialog chat-new-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-chat-title"
        data-testid="new-chat-dialog"
      >
        <header className="dialog__header">
          <div>
            <h2 id="new-chat-title">{tr("新建对话")}</h2>
            <p>{tr("ChatAgent · 联网搜索 · 独立会话")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={tr("关闭")} onClick={onClose}>
            <X aria-hidden="true" size={17} />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="dialog__body chat-new-dialog__body">
            <div className="field">
              <span>{tr("模型")}</span>
              <ModelPicker
                providers={providers.filter((provider) =>
                  provider.models.some((model) => model.enabled),
                )}
                value={selection}
                onChange={(next) => setSelection(next)}
                disabled={busy}
                ariaLabel={tr("模型")}
              />
            </div>
            <div className="form-grid form-grid--two">
              <label className="field">
                <span>{tr("推理等级")}</span>
                <select
                  value={reasoningLevel ?? ""}
                  disabled={busy || !selectedModel?.reasoningLevels.length}
                  onChange={(event) => setReasoningLevel(event.target.value || null)}
                >
                  <option value="">{tr("不设置")}</option>
                  {selectedModel?.reasoningLevels.map((level) => (
                    <option value={level} key={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{tr("分组")}</span>
                <select
                  value={chatGroupId ?? ""}
                  disabled={busy}
                  onChange={(event) => setChatGroupId(event.target.value || null)}
                >
                  <option value="">{tr("未分组")}</option>
                  {groups.map((group) => (
                    <option value={group.id} key={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="chat-new-dialog__scope">
              <FolderPlus size={16} aria-hidden="true" />
              <span>
                <strong>{tr("独立对话空间")}</strong>
                <small>{tr("不上传工作目录，不调用本地文件或开发工具。")}</small>
              </span>
            </div>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <footer className="dialog__footer">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={busy}>
              {tr("取消")}
            </button>
            <button className="btn btn--primary" type="submit" disabled={busy || !selectedModel}>
              {busy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}
              {tr("开始对话")}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
