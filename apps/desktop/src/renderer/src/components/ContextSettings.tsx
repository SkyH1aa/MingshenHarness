import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  CompactionModelChoice,
  ModelReference,
  ProviderView,
  SessionView,
} from "../../../shared/domain";
import { tr } from "../i18n/index";
import { runtimeText } from "../i18n/runtime";
import { ModelPicker } from "./ModelPicker";

export function ContextSettings({
  providers,
  session,
  onChanged,
}: {
  providers: ProviderView[];
  session: SessionView | null;
  onChanged: () => Promise<void>;
}) {
  const [global, setGlobal] = useState<ModelReference | null>(null);
  const [fallback, setFallback] = useState<ModelReference | null>(null);
  const [choice, setChoice] = useState<CompactionModelChoice>({
    mode: "default",
    providerId: null,
    modelId: null,
  });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const sessionId = session?.id;
  const choiceMode = session?.compactionModel?.mode;
  const choiceProvider = session?.compactionModel?.providerId;
  const choiceModel = session?.compactionModel?.modelId;
  useEffect(() => {
    let active = true;
    void Promise.all([
      window.mingshen.getGlobalCompactionModel(),
      window.mingshen.getCompactionFallbackModel(),
    ])
      .then(([value, backup]) => {
        if (active) {
          setGlobal(value);
          setFallback(backup);
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (active) setNotice(String(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setChoice({
      mode: sessionId ? (choiceMode ?? "default") : "default",
      providerId: sessionId ? (choiceProvider ?? null) : null,
      modelId: sessionId ? (choiceModel ?? null) : null,
    });
  }, [sessionId, choiceMode, choiceProvider, choiceModel]);
  const save = async (scope: "global" | "session" | "fallback") => {
    setBusy(true);
    setNotice("");
    try {
      if (scope === "global") setGlobal(await window.mingshen.setGlobalCompactionModel(global));
      else if (scope === "fallback")
        setFallback(await window.mingshen.setCompactionFallbackModel(fallback));
      else if (session)
        await window.mingshen.updateSession({ sessionId: session.id, compactionModel: choice });
      await onChanged();
      setNotice("压缩模型配置已保存。");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-page context-settings">
      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("全局默认压缩模型")}</h3>
            <p>{tr("上下文达到 85% 时自动生成摘要。未指定全局模型时，使用每个会话当前的模型。")}</p>
          </div>
        </div>
        <div className="field">
          <span>{tr("压缩模型")}</span>
          <ModelPicker
            providers={providers}
            value={global ? { providerId: global.providerId, configId: global.modelId } : null}
            onChange={(selection) =>
              setGlobal({ providerId: selection.providerId, modelId: selection.configId })
            }
            disabled={busy || !loaded}
          />
        </div>
        <p className="form-note">{global ? tr("已选择独立模型") : tr("默认使用各会话当前模型")}</p>
        <div className="approval-panel__actions">
          <button
            className="btn btn--ghost"
            type="button"
            disabled={busy || !loaded}
            onClick={() => setGlobal(null)}
          >
            {tr("使用当前模型")}
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={busy || !loaded}
            onClick={() => void save("global")}
          >
            <Save size={14} />
            {tr("保存全局配置")}
          </button>
        </div>
      </section>
      <section className="settings-block context-settings__fallback">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("备用压缩模型（可选）")}</h3>
            <p>
              {tr(
                "对所有会话生效。当前会话实际使用的主压缩模型失败时，使用备用模型从原始历史重新生成完整摘要。",
              )}
            </p>
          </div>
        </div>
        <div className="field">
          <span>{tr("备用压缩模型")}</span>
          <ModelPicker
            providers={providers}
            value={
              fallback ? { providerId: fallback.providerId, configId: fallback.modelId } : null
            }
            onChange={(selection) =>
              setFallback({ providerId: selection.providerId, modelId: selection.configId })
            }
            disabled={busy || !loaded}
          />
        </div>
        <p className="form-note">
          {tr(
            "主模型网络错误、超时、返回空摘要或摘要无效时自动切换一次。备用供应商会接收相同历史与工具内容，可能产生额外 API 用量。",
          )}
        </p>
        <div className="approval-panel__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || !loaded || !fallback}
            onClick={() => setFallback(null)}
          >
            {tr("清除备用模型")}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy || !loaded}
            onClick={() => void save("fallback")}
          >
            <Save size={14} />
            {tr("保存备用压缩模型")}
          </button>
        </div>
      </section>
      <section className="settings-block context-settings__session">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("当前会话的压缩模型")}</h3>
            <p>{session?.title ?? tr("请先在主界面选择一个会话。")}</p>
          </div>
        </div>
        {session ? (
          <>
            <label className="field">
              <span>{tr("模型来源")}</span>
              <select
                value={choice.mode}
                disabled={busy}
                onChange={(event) =>
                  setChoice({
                    mode: event.target.value as CompactionModelChoice["mode"],
                    providerId: null,
                    modelId: null,
                  })
                }
              >
                <option value="default">{tr("继承全局默认")}</option>
                <option value="current">{tr("始终使用当前会话模型")}</option>
                <option value="custom">{tr("指定压缩模型")}</option>
              </select>
            </label>
            {choice.mode === "custom" ? (
              <div className="field">
                <span>{tr("会话压缩模型")}</span>
                <ModelPicker
                  providers={providers}
                  value={
                    choice.providerId && choice.modelId
                      ? { providerId: choice.providerId, configId: choice.modelId }
                      : null
                  }
                  onChange={(selection) =>
                    setChoice({
                      mode: "custom",
                      providerId: selection.providerId,
                      modelId: selection.configId,
                    })
                  }
                  disabled={busy}
                />
              </div>
            ) : null}
            <div className="approval-panel__actions">
              <button
                className="btn btn--secondary"
                type="button"
                disabled={
                  busy || (choice.mode === "custom" && (!choice.providerId || !choice.modelId))
                }
                onClick={() => void save("session")}
              >
                <Save size={14} />
                {tr("保存会话配置")}
              </button>
            </div>
          </>
        ) : null}
      </section>
      <p className="form-note">
        {tr(
          "压缩会向选定模型发送较早的聊天和工具结果，可能产生 API 用量。原始记录仍保存在本地；当前指令和最近工具步骤会保留，压缩后自动继续。",
        )}
      </p>
      {notice ? (
        <p className="form-note" role="status">
          {runtimeText(notice)}
        </p>
      ) : null}
    </div>
  );
}
