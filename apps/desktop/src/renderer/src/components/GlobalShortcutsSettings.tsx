import {
  Check,
  CircleAlert,
  Keyboard,
  LoaderCircle,
  MessageCircle,
  PanelTop,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_DESKTOP_SHORTCUTS,
  formatDesktopShortcut,
} from "../../../shared/desktop-shortcuts";
import type {
  DesktopShortcutErrorCode,
  DesktopShortcutName,
  DesktopShortcutState,
} from "../../../shared/quick-chat";
import { tr } from "../i18n/index";
import {
  captureDesktopShortcut,
  type ShortcutCaptureEvent,
  shortcutParts,
} from "../lib/desktop-shortcut-input";

const ACTIONS: Array<{
  name: DesktopShortcutName;
  label: string;
  description: string;
  icon: typeof MessageCircle;
}> = [
  {
    name: "quickChat",
    label: "快捷对话",
    description: "打开或创建 ChatAgent 快捷对话",
    icon: MessageCircle,
  },
  {
    name: "toggleMain",
    label: "显示或隐藏主界面",
    description: "显示、聚焦主窗口，或将其收回托盘",
    icon: PanelTop,
  },
];

function shortcutErrorText(code: DesktopShortcutErrorCode): string {
  switch (code) {
    case "shortcut-missing-modifier":
      return tr("快捷键需要至少一个 Ctrl、Alt 或 Shift 修饰键。");
    case "shortcut-missing-key":
      return tr("请按下一个非修饰键。");
    case "shortcut-invalid-key":
      return tr("该按键不能用于全局快捷键。");
    case "shortcut-reserved":
      return tr("该快捷键由 Windows 保留。");
    case "shortcut-duplicate":
      return tr("两个操作不能使用相同的快捷键。");
    case "shortcut-occupied":
      return tr("此快捷键已被其他应用占用。");
    case "shortcut-registration-failed":
      return tr("系统无法注册此快捷键。");
    case "shortcut-persist-failed":
      return tr("快捷键设置无法保存。");
    case "shortcut-load-failed":
      return tr("快捷键设置无法读取。");
  }
}

function ShortcutKeycaps({ accelerator, muted = false }: { accelerator: string; muted?: boolean }) {
  return (
    <span className={muted ? "shortcut-keycaps shortcut-keycaps--muted" : "shortcut-keycaps"}>
      {shortcutParts(formatDesktopShortcut(accelerator)).map((part, index) => (
        <span className="shortcut-keycaps__part" key={part}>
          {index ? <span className="shortcut-keycaps__plus">+</span> : null}
          <kbd>{part}</kbd>
        </span>
      ))}
    </span>
  );
}

async function releaseShortcutRecording(): Promise<void> {
  try {
    await window.mingshen.setDesktopShortcutRecording(false);
  } catch {
    await window.mingshen.setDesktopShortcutRecording(false);
  }
}

export function GlobalShortcutsSettings() {
  const [state, setState] = useState<DesktopShortcutState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [recording, setRecording] = useState<DesktopShortcutName | null>(null);
  const [starting, setStarting] = useState<DesktopShortcutName | null>(null);
  const [saving, setSaving] = useState<DesktopShortcutName | null>(null);
  const [preview, setPreview] = useState("");
  const [captureError, setCaptureError] = useState<DesktopShortcutErrorCode | null>(null);
  const [attempted, setAttempted] = useState<Partial<Record<DesktopShortcutName, string>>>({});
  const recordingGeneration = useRef(0);
  const mounted = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reloads shortcut state.
  useEffect(() => {
    let active = true;
    setLoadError("");
    void window.mingshen
      .getDesktopShortcutSettings()
      .then((next) => {
        if (active) setState(next);
      })
      .catch((cause) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [retry]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recordingGeneration.current += 1;
      void releaseShortcutRecording().catch(() => undefined);
    };
  }, []);

  const stopRecording = useCallback(() => {
    recordingGeneration.current += 1;
    setRecording(null);
    setStarting(null);
    setPreview("");
    setCaptureError(null);
    void (async () => {
      try {
        await releaseShortcutRecording();
        const next = await window.mingshen.getDesktopShortcutSettings();
        if (mounted.current) setState(next);
      } catch (cause) {
        if (mounted.current)
          setOperationError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, []);

  const focusRecorder = useCallback((name: DesktopShortcutName) => {
    window.requestAnimationFrame(() => {
      if (!mounted.current) return;
      document.querySelector<HTMLButtonElement>(`[data-shortcut-recorder="${name}"]`)?.focus();
    });
  }, []);

  const applyBinding = useCallback(
    async (name: DesktopShortcutName, accelerator: string) => {
      if (!state) return;
      recordingGeneration.current += 1;
      setRecording(null);
      setPreview("");
      setCaptureError(null);
      setOperationError("");
      setNotice("");
      setSaving(name);
      setAttempted((current) => ({ ...current, [name]: accelerator }));
      try {
        await releaseShortcutRecording();
        const result = await window.mingshen.setDesktopShortcutSettings({
          ...state.settings,
          [name]: accelerator,
        });
        if (!mounted.current) return;
        setState(result);
        if (result.ok) setNotice(tr("快捷键设置已更新。"));
      } catch (cause) {
        if (mounted.current)
          setOperationError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        try {
          await releaseShortcutRecording();
        } catch (cause) {
          if (mounted.current)
            setOperationError(cause instanceof Error ? cause.message : String(cause));
        }
        if (mounted.current) {
          setSaving(null);
          focusRecorder(name);
        }
      }
    },
    [focusRecorder, state],
  );

  useEffect(() => {
    if (!recording && !starting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (starting) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          stopRecording();
        }
        return;
      }
      if (!recording) return;
      const capture = captureDesktopShortcut({
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        isComposing: event.isComposing,
        repeat: event.repeat,
        altGraph: event.getModifierState("AltGraph"),
      } satisfies ShortcutCaptureEvent);
      if (capture.kind === "cancel") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        stopRecording();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (capture.kind === "pending") {
        setPreview(capture.preview);
        setCaptureError(null);
        return;
      }
      if (capture.kind === "invalid") {
        setPreview(capture.preview);
        setCaptureError(capture.code);
        return;
      }
      void applyBinding(recording, capture.accelerator);
    };
    const onBlur = () => stopRecording();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [applyBinding, recording, starting, stopRecording]);

  const beginRecording = async (name: DesktopShortcutName) => {
    if (!state || loadError) return;
    if (recording === name) {
      stopRecording();
      return;
    }
    if (recording || starting || saving) return;
    const generation = ++recordingGeneration.current;
    setStarting(name);
    setOperationError("");
    setNotice("");
    setPreview(formatDesktopShortcut(state?.settings[name] ?? DEFAULT_DESKTOP_SHORTCUTS[name]));
    setCaptureError(null);
    try {
      await window.mingshen.setDesktopShortcutRecording(true);
      if (!mounted.current || generation !== recordingGeneration.current) {
        await releaseShortcutRecording().catch(() => undefined);
        return;
      }
      setRecording(name);
    } catch (cause) {
      if (mounted.current && generation === recordingGeneration.current)
        setOperationError(cause instanceof Error ? cause.message : String(cause));
      await releaseShortcutRecording().catch(() => undefined);
    } finally {
      if (mounted.current && generation === recordingGeneration.current) setStarting(null);
    }
  };

  return (
    <section
      className="settings-block global-shortcuts-settings"
      data-testid="desktop-shortcut-settings"
    >
      <div className="settings-block__heading">
        <div>
          <h3>
            <Keyboard aria-hidden="true" size={15} /> {tr("全局快捷键")}
          </h3>
          <p>
            {tr(
              "快捷键仅在 Mingshen 运行时可使用。点击按键后录制组合，支持 Ctrl+Alt+K 等三键或四键组合。",
            )}
          </p>
        </div>
      </div>

      <div data-testid="shortcut-errors">
        {loadError ? (
          <div className="form-error" role="alert">
            <span>
              {tr("快捷键设置无法读取：{0}", [loadError])}
              <button type="button" onClick={() => setRetry((count) => count + 1)}>
                {tr("重试")}
              </button>
            </span>
          </div>
        ) : null}
        {operationError ? (
          <p className="form-error" role="alert">
            {tr("快捷键设置无法注册、保存或读取：{0}", [operationError])}
          </p>
        ) : null}
      </div>

      <div className="setting-list">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          const current = state?.settings[action.name] ?? DEFAULT_DESKTOP_SHORTCUTS[action.name];
          const active = state?.status[action.name] ?? false;
          const error = state?.errors[action.name];
          const isRecording = recording === action.name;
          const isStarting = starting === action.name;
          const isSaving = saving === action.name;
          const isDefault = current === DEFAULT_DESKTOP_SHORTCUTS[action.name];
          const attemptedBinding = attempted[action.name];
          const rowError =
            (isRecording && captureError ? shortcutErrorText(captureError) : "") ||
            (error ? shortcutErrorText(error.code) : "") ||
            "";
          return (
            <div className="setting-row global-shortcut-row" key={action.name}>
              <div className="setting-row__label">
                <Icon aria-hidden="true" size={16} />
                <span>
                  <strong>{tr(action.label)}</strong>
                  <small id={`shortcut-help-${action.name}`}>{tr(action.description)}</small>
                </span>
              </div>
              <div className="global-shortcut-actions">
                <button
                  className={
                    isRecording
                      ? "shortcut-recorder shortcut-recorder--recording"
                      : "shortcut-recorder"
                  }
                  type="button"
                  data-shortcut-recorder={action.name}
                  data-testid={`shortcut-record-${action.name}`}
                  aria-pressed={isRecording}
                  aria-label={
                    isRecording
                      ? tr("录制“{0}”的快捷键", [tr(action.label)])
                      : tr("设置“{0}”的快捷键", [tr(action.label)])
                  }
                  aria-describedby={`shortcut-help-${action.name} shortcut-status-${action.name}`}
                  disabled={
                    !state ||
                    Boolean(loadError) ||
                    Boolean(
                      saving ||
                        (starting && starting !== action.name) ||
                        (recording && recording !== action.name),
                    )
                  }
                  onClick={() => void beginRecording(action.name)}
                  onBlur={() => {
                    if (isRecording || isStarting) stopRecording();
                  }}
                >
                  {isStarting || isSaving ? (
                    <>
                      <LoaderCircle className="spin" aria-hidden="true" size={15} />
                      <span>{isSaving ? tr("正在保存…") : tr("正在准备录制…")}</span>
                    </>
                  ) : isRecording ? (
                    <>
                      <span className="shortcut-recorder__live" aria-hidden="true" />
                      <span>{tr("按键中…")}</span>
                      {preview ? (
                        <span className="shortcut-recorder__preview">{preview}</span>
                      ) : null}
                    </>
                  ) : (
                    <ShortcutKeycaps accelerator={current} />
                  )}
                </button>
                <button
                  className="icon-button shortcut-reset"
                  type="button"
                  data-shortcut-reset={action.name}
                  title={tr("恢复“{0}”的默认快捷键", [tr(action.label)])}
                  aria-label={tr("恢复“{0}”的默认快捷键", [tr(action.label)])}
                  disabled={
                    !state ||
                    Boolean(loadError) ||
                    Boolean(recording || starting || saving) ||
                    (isDefault && active && !error)
                  }
                  onClick={() =>
                    void applyBinding(action.name, DEFAULT_DESKTOP_SHORTCUTS[action.name])
                  }
                >
                  <RotateCcw aria-hidden="true" size={14} />
                </button>
              </div>
              <div className="global-shortcut-feedback" id={`shortcut-status-${action.name}`}>
                {isRecording ? (
                  <span className="global-shortcut-feedback__recording">
                    <Keyboard aria-hidden="true" size={13} />
                    {tr("按下组合键；按 Esc 取消")}
                  </span>
                ) : active ? (
                  <span className="global-shortcut-feedback__active">
                    <Check aria-hidden="true" size={13} />
                    {tr("快捷键已启用")}
                  </span>
                ) : state ? (
                  <span className="global-shortcut-feedback__error">
                    <CircleAlert aria-hidden="true" size={13} />
                    {tr("快捷键不可用")}
                  </span>
                ) : null}
                {rowError ? (
                  <span
                    className="global-shortcut-feedback__error"
                    data-shortcut-error={action.name}
                    role="alert"
                  >
                    {rowError}
                    {attemptedBinding && state ? (
                      <>
                        {" "}
                        {active
                          ? tr("未能应用 {0}；{1} 当前仍有效。", [
                              formatDesktopShortcut(attemptedBinding),
                              formatDesktopShortcut(current),
                            ])
                          : tr("未能应用 {0}；当前没有可用的旧绑定。", [
                              formatDesktopShortcut(attemptedBinding),
                            ])}
                      </>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="global-shortcuts-settings__notice" role="status">
        {notice}
      </p>
    </section>
  );
}
