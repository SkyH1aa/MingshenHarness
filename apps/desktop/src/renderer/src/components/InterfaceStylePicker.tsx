import { Check, LoaderCircle, RotateCw } from "lucide-react";
import { useState } from "react";
import type { InterfaceStyle } from "../../../shared/ui-preferences";
import { useLocale } from "../i18n";
import { requestInterfaceReload } from "../lib/use-composer-draft";
import { useUiPreferences } from "./UiPreferences";

export function InterfaceStylePicker() {
  const locale = useLocale();
  const { preferences, activeStyle, ready, update, save } = useUiPreferences();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const pending = preferences.interfaceStyle !== activeStyle;
  const english = locale === "en";
  const styles: { id: InterfaceStyle; name: string }[] = [
    { id: "simple", name: english ? "Simple" : "简约" },
    { id: "orbit", name: english ? "Light Trails" : "光轨" },
  ];
  const apply = async () => {
    setError("");
    const unsavedMessage = english
      ? "Save file, history-message, and plan edits before reloading."
      : "请先保存文件、历史消息及计划编辑，再重载界面。";
    const checkUnsaved = () => {
      if (!document.querySelector('[data-unsaved="true"]')) return;
      throw new Error(unsavedMessage);
    };
    setApplying(true);
    try {
      checkUnsaved();
      await save();
      checkUnsaved();
      await requestInterfaceReload((cause) =>
        setError(cause === undefined ? unsavedMessage : String(cause)),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setApplying(false);
    }
  };
  return (
    <section className="settings-block interface-style-picker">
      <div className="settings-block__heading">
        <div>
          <h3>{english ? "Interface style" : "界面风格"}</h3>
          <p>
            {english
              ? "Reload or restart to apply a new style."
              : "切换风格后，重载界面或重启应用生效。"}
          </p>
        </div>
      </div>
      <fieldset className="interface-style-options" disabled={!ready || applying}>
        <legend className="visually-hidden">{english ? "Interface style" : "界面风格"}</legend>
        {styles.map((style) => (
          <label className="interface-style-option" data-interface-style={style.id} key={style.id}>
            <input
              type="radio"
              name="interface-style"
              value={style.id}
              checked={preferences.interfaceStyle === style.id}
              onChange={() => {
                setError("");
                update((current) => ({ ...current, interfaceStyle: style.id }));
              }}
            />
            <span
              className={`interface-style-thumbnail${style.id === "orbit" ? " interface-style-thumbnail--orbit" : ""}`}
              aria-hidden="true"
            >
              <span className="interface-style-thumbnail__bar" />
              {style.id === "orbit" ? (
                <span className="interface-style-thumbnail__tools">
                  <i />
                  <i />
                  <i />
                </span>
              ) : null}
              <span className="interface-style-thumbnail__rail">
                <i />
                <i />
                <i />
              </span>
              <span className="interface-style-thumbnail__body">
                <i />
                <i />
                <i />
                <span />
              </span>
              {style.id === "orbit" ? (
                <>
                  <span className="interface-style-thumbnail__inspector">
                    <span>
                      <i />
                      <i />
                    </span>
                    <span>
                      <i />
                      <i />
                    </span>
                  </span>
                  <span className="interface-style-thumbnail__status" />
                </>
              ) : null}
            </span>
            <span className="interface-style-option__label">
              <strong>{style.name}</strong>
              <span>
                {activeStyle === style.id ? (
                  <>
                    <Check size={13} aria-hidden="true" />
                    {english ? "Active" : "使用中"}
                  </>
                ) : preferences.interfaceStyle === style.id ? (
                  english ? (
                    "Pending reload"
                  ) : (
                    "待重载"
                  )
                ) : null}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {pending ? (
        <div className="interface-style-pending" role="status">
          <p>
            {english
              ? "Your choice is saved automatically. Apply when your work is ready."
              : "选择将自动保存，处理好当前工作后即可应用。"}
          </p>
          <button
            className="btn btn--primary interface-style-apply"
            type="button"
            disabled={!ready || applying}
            onClick={() => void apply()}
          >
            {applying ? (
              <LoaderCircle size={15} className="spin" aria-hidden="true" />
            ) : (
              <RotateCw size={15} aria-hidden="true" />
            )}
            {english ? "Reload and apply" : "重载并应用"}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
