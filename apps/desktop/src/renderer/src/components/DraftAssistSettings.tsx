import { Save, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProviderView } from "../../../shared/domain";
import type { DraftAssistSettings as DraftAssistSettingsValue } from "../../../shared/draft-assist";
import { tr } from "../i18n/index";
import { ModelPicker } from "./ModelPicker";

export function DraftAssistSettings({ providers }: { providers: ProviderView[] }) {
  const [settings, setSettings] = useState<DraftAssistSettingsValue>({
    providerId: null,
    modelId: null,
  });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const eligibleProviders = useMemo(
    () =>
      providers
        .map((provider) => ({
          ...provider,
          models: provider.models.filter(
            (model) =>
              model.enabled &&
              model.inputModalities.includes("text") &&
              model.outputModalities.includes("text"),
          ),
        }))
        .filter((provider) => provider.models.length > 0),
    [providers],
  );
  useEffect(() => {
    let active = true;
    void window.mingshen
      .getDraftAssistSettings()
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setLoaded(true);
      })
      .catch((cause) => {
        if (active) setNotice(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      setSettings(await window.mingshen.setDraftAssistSettings(settings));
      setNotice(tr("草稿润色模型已保存。"));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-block draft-assist-settings">
      <div className="settings-block__heading">
        <div>
          <h3>
            <WandSparkles aria-hidden="true" size={15} /> {tr("草稿润色模型")}
          </h3>
          <p>
            {tr(
              "仅在你主动点击输入区的润色按钮时调用。未指定时继承当前会话模型；润色结果先预览，不会直接覆盖原文。",
            )}
          </p>
        </div>
      </div>
      <div className="field">
        <span>{tr("润色模型")}</span>
        <ModelPicker
          providers={eligibleProviders}
          value={
            settings.providerId && settings.modelId
              ? { providerId: settings.providerId, configId: settings.modelId }
              : null
          }
          onChange={(selection) =>
            setSettings({ providerId: selection.providerId, modelId: selection.configId })
          }
          onClear={() => setSettings({ providerId: null, modelId: null })}
          disabled={busy || !loaded}
          placeholder={tr("继承当前会话模型")}
        />
      </div>
      <p className="form-note">
        {settings.providerId
          ? tr("已选择独立模型")
          : tr("默认使用各会话当前模型，并排除仅支持图片生成的模型。")}
      </p>
      <div className="approval-panel__actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy || !loaded || !settings.providerId}
          onClick={() => setSettings({ providerId: null, modelId: null })}
        >
          {tr("使用当前会话模型")}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || !loaded || Boolean(settings.providerId) !== Boolean(settings.modelId)}
          onClick={() => void save()}
        >
          <Save aria-hidden="true" size={14} />
          {tr("保存草稿润色模型")}
        </button>
      </div>
      {notice ? (
        <p className="form-note" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
