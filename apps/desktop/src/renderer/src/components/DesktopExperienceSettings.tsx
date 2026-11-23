import { MonitorPlay, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionPreferences, CompanionState } from "../../../shared/desktop-companion";
import { useLocale } from "../i18n";

export function DesktopExperienceSettings({
  onPendingChange,
}: {
  onPendingChange?: (pending: boolean) => void;
}) {
  const locale = useLocale();
  const isEnglish = locale === "en";
  const [preferences, setPreferences] = useState<CompanionPreferences | null>(null);
  const savedPreferencesRef = useRef<CompanionPreferences | null>(null);
  const inFlightPatchRef = useRef<Partial<CompanionPreferences>>({});
  const pendingPatchRef = useRef<Partial<CompanionPreferences>>({});
  const saveInProgressRef = useRef(false);
  const lastStateTimestampRef = useRef(0);
  const stateEventRevisionRef = useRef(0);
  const restDraftDirtyRef = useRef(false);
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [startupLoading, setStartupLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [errorOperation, setErrorOperation] = useState<"load" | "show" | "hide">("load");
  const [startupError, setStartupError] = useState("");
  const [notice, setNotice] = useState("");
  const [restDraft, setRestDraft] = useState("");
  const [restDraftDirty, setRestDraftDirty] = useState(false);

  const acceptState = useCallback((state: CompanionState) => {
    if (state.updatedAt < lastStateTimestampRef.current) return;
    stateEventRevisionRef.current += 1;
    lastStateTimestampRef.current = state.updatedAt;
    setVisible(state.visible);
    savedPreferencesRef.current = state.preferences;
    const localPatch = { ...inFlightPatchRef.current, ...pendingPatchRef.current };
    const effective = { ...state.preferences, ...localPatch };
    setPreferences(effective);
    if (!restDraftDirtyRef.current && !Object.hasOwn(localPatch, "restAfterMinutes"))
      setRestDraft(String(effective.restAfterMinutes));
  }, []);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setError("");
    const revisionAtStart = stateEventRevisionRef.current;
    try {
      const state = await window.mingshen.getCompanionState();
      if (
        revisionAtStart === stateEventRevisionRef.current &&
        state.updatedAt >= lastStateTimestampRef.current
      ) {
        lastStateTimestampRef.current = state.updatedAt;
        savedPreferencesRef.current = state.preferences;
        setVisible(state.visible);
      }
      const baseline = savedPreferencesRef.current ?? state.preferences;
      const localPatch = { ...inFlightPatchRef.current, ...pendingPatchRef.current };
      const effective = { ...baseline, ...localPatch };
      setPreferences(effective);
      if (!restDraftDirtyRef.current && !Object.hasOwn(localPatch, "restAfterMinutes"))
        setRestDraft(String(effective.restAfterMinutes));
    } catch (cause) {
      setErrorOperation("load");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStartup = useCallback(async () => {
    setStartupLoading(true);
    setStartupError("");
    try {
      setStartupEnabled(await window.mingshen.getStartupAnimationEnabled());
    } catch (cause) {
      setStartupError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStartupLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreferences();
    void loadStartup();
    return window.mingshen.onCompanionState(acceptState);
  }, [acceptState, loadPreferences, loadStartup]);

  useEffect(() => {
    onPendingChange?.(saving || restDraftDirty);
  }, [onPendingChange, restDraftDirty, saving]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);

  const flushPreferences = useCallback(async () => {
    if (saveInProgressRef.current) return;
    const nextPatch = pendingPatchRef.current;
    if (Object.keys(nextPatch).length === 0) {
      setSaving(false);
      return;
    }

    pendingPatchRef.current = {};
    inFlightPatchRef.current = nextPatch;
    saveInProgressRef.current = true;
    setSaving(true);
    setNotice("");
    let saved = false;
    const revisionAtStart = stateEventRevisionRef.current;
    try {
      const result = await window.mingshen.setCompanionPreferences(nextPatch);
      if (revisionAtStart === stateEventRevisionRef.current) savedPreferencesRef.current = result;
      inFlightPatchRef.current = {};
      saved = true;
      const baseline = savedPreferencesRef.current ?? result;
      const effective = { ...baseline, ...pendingPatchRef.current };
      setPreferences(effective);
      if (!restDraftDirtyRef.current) setRestDraft(String(effective.restAfterMinutes));
      setSaveError("");
      setNotice(isEnglish ? "Saved" : "已保存");
    } catch (cause) {
      pendingPatchRef.current = { ...nextPatch, ...pendingPatchRef.current };
      inFlightPatchRef.current = {};
      const baseline = savedPreferencesRef.current;
      if (baseline) {
        const effective = { ...baseline, ...pendingPatchRef.current };
        setPreferences(effective);
        if (!restDraftDirtyRef.current) setRestDraft(String(effective.restAfterMinutes));
      }
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saveInProgressRef.current = false;
      const hasPendingPatch = Object.keys(pendingPatchRef.current).length > 0;
      setSaving(hasPendingPatch);
      if (saved && hasPendingPatch) void flushPreferences();
    }
  }, [isEnglish]);

  const persistPatch = useCallback(
    (patch: Partial<CompanionPreferences>) => {
      if (Object.keys(patch).length > 0) {
        pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
        setPreferences((current) => (current ? { ...current, ...patch } : current));
      }
      setSaving(true);
      setSaveError("");
      setNotice("");
      void flushPreferences();
    },
    [flushPreferences],
  );

  const saveStartup = async (enabled: boolean) => {
    setStartupLoading(true);
    setStartupError("");
    try {
      const saved = await window.mingshen.setStartupAnimationEnabled(enabled);
      setStartupEnabled(saved);
    } catch (cause) {
      setStartupError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStartupLoading(false);
    }
  };

  const showCompanion = async () => {
    setActionBusy(true);
    setError("");
    try {
      await window.mingshen.showCompanion();
      acceptState(await window.mingshen.getCompanionState());
    } catch (cause) {
      setErrorOperation("show");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(false);
    }
  };

  const hideCompanion = async () => {
    setActionBusy(true);
    setError("");
    try {
      await window.mingshen.hideCompanion();
      setVisible(false);
    } catch (cause) {
      setErrorOperation("hide");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(false);
    }
  };

  const update = <K extends keyof CompanionPreferences>(key: K, value: CompanionPreferences[K]) => {
    persistPatch({ [key]: value } as Pick<CompanionPreferences, K>);
  };

  const retryCompanionOperation = () => {
    if (errorOperation === "show") void showCompanion();
    else if (errorOperation === "hide") void hideCompanion();
    else void loadPreferences();
  };

  const saveRestInterval = () => {
    restDraftDirtyRef.current = false;
    setRestDraftDirty(false);
    const parsed = Number(restDraft);
    if (!Number.isFinite(parsed)) {
      setRestDraft(String(preferences?.restAfterMinutes ?? 0));
      return;
    }
    const restAfterMinutes = Math.min(240, Math.max(0, Math.round(parsed)));
    setRestDraft(String(restAfterMinutes));
    update("restAfterMinutes", restAfterMinutes);
  };

  const activePreferences = preferences;
  const titlesPending =
    activePreferences !== null &&
    savedPreferencesRef.current !== null &&
    activePreferences.showSessionTitles !== savedPreferencesRef.current.showSessionTitles;
  return (
    <div className="settings-page desktop-experience-settings">
      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{isEnglish ? "Startup" : "启动动画"}</h3>
            <p>
              {isEnglish
                ? "Show the atomic mark across the screen while the desktop app is opening."
                : "应用启动时全屏置顶展示原子标识动画。"}
            </p>
          </div>
        </div>
        <label className="desktop-experience-row">
          <span>
            <strong>{isEnglish ? "Startup animation" : "显示启动动画"}</strong>
            <small>
              {isEnglish ? "The animation can be skipped at any time." : "展示期间可随时点击跳过。"}
            </small>
          </span>
          <input
            type="checkbox"
            checked={startupEnabled}
            disabled={startupLoading}
            onChange={(event) => void saveStartup(event.target.checked)}
            aria-label={isEnglish ? "Enable startup animation" : "开启启动动画"}
          />
        </label>
        {startupError ? (
          <p className="form-error" role="alert">
            {startupError}
            <button type="button" onClick={() => void loadStartup()}>
              {isEnglish ? "Retry" : "重试"}
            </button>
          </p>
        ) : null}
      </section>

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{isEnglish ? "Desktop companion" : "桌面宠物"}</h3>
            <p>
              {isEnglish
                ? "Choose its presence, movement and task notifications."
                : "设置桌宠显示方式、互动频率与任务状态提示。"}
            </p>
          </div>
        </div>
        {loading ? (
          <p className="desktop-experience-status" role="status">
            {isEnglish ? "Loading settings…" : "正在读取设置…"}
          </p>
        ) : activePreferences ? (
          <>
            <label className="desktop-experience-row">
              <span>
                <strong>{isEnglish ? "Show companion" : "显示桌宠"}</strong>
                <small>
                  {isEnglish
                    ? "Keep the companion available on the desktop."
                    : "在桌面显示宠物窗口。"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={activePreferences.enabled}
                onChange={(event) => update("enabled", event.target.checked)}
                aria-label={isEnglish ? "Show companion" : "显示桌宠"}
              />
            </label>

            <div className="desktop-experience-actions">
              {visible ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={actionBusy}
                  onClick={() => void hideCompanion()}
                >
                  <MonitorPlay size={15} aria-hidden="true" />
                  {isEnglish ? "Hide for now" : "暂时隐藏"}
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={actionBusy}
                  onClick={() => void showCompanion()}
                >
                  <MonitorPlay size={15} aria-hidden="true" />
                  {isEnglish ? "Show companion" : "显示桌宠"}
                </button>
              )}
              <button
                type="button"
                className="text-button"
                disabled={actionBusy || !activePreferences.position}
                onClick={() => update("position", null)}
                title={isEnglish ? "Reset the saved screen position" : "重置保存的位置"}
              >
                <RotateCcw size={14} aria-hidden="true" />
                {isEnglish ? "Reset position" : "重置位置"}
              </button>
            </div>

            <label className="desktop-experience-control">
              <span>
                <strong>{isEnglish ? "Window size" : "桌宠大小"}</strong>
                <output>{activePreferences.size} px</output>
              </span>
              <input
                type="range"
                min="96"
                max="320"
                step="8"
                value={activePreferences.size}
                onChange={(event) => update("size", Number(event.target.value))}
                aria-label={isEnglish ? "Companion size" : "桌宠大小"}
              />
            </label>

            <label className="desktop-experience-control">
              <span>
                <strong>{isEnglish ? "Opacity" : "显示透明度"}</strong>
                <output>{Math.round(activePreferences.opacity * 100)}%</output>
              </span>
              <input
                type="range"
                min="35"
                max="100"
                step="5"
                value={Math.round(activePreferences.opacity * 100)}
                onChange={(event) => update("opacity", Number(event.target.value) / 100)}
                aria-label={isEnglish ? "Companion opacity" : "桌宠透明度"}
              />
            </label>

            <label className="desktop-experience-row">
              <span>
                <strong>{isEnglish ? "Always on top" : "窗口置顶"}</strong>
                <small>
                  {isEnglish ? "Keep it above other windows." : "让桌宠显示在其他窗口上方。"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={activePreferences.alwaysOnTop}
                onChange={(event) => update("alwaysOnTop", event.target.checked)}
                aria-label={isEnglish ? "Keep companion on top" : "桌宠窗口置顶"}
              />
            </label>

            <label className="desktop-experience-row">
              <span>
                <strong>{isEnglish ? "Play animations" : "播放动作动画"}</strong>
                <small>
                  {isEnglish ? "Pause to keep the companion still." : "关闭后静止显示桌宠。"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={activePreferences.animationEnabled}
                onChange={(event) => update("animationEnabled", event.target.checked)}
                aria-label={isEnglish ? "Play companion animations" : "播放桌宠动作动画"}
              />
            </label>

            <label className="desktop-experience-row">
              <span>
                <strong>{isEnglish ? "Lock position" : "锁定位置"}</strong>
                <small>
                  {isEnglish
                    ? "Keep the companion in its current screen position."
                    : "固定当前位置，防止拖动时误移。"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={activePreferences.positionLocked}
                onChange={(event) => update("positionLocked", event.target.checked)}
                aria-label={isEnglish ? "Lock companion position" : "锁定桌宠位置"}
              />
            </label>

            <label className="desktop-experience-row">
              <span>
                <strong>{isEnglish ? "Greeting" : "问候"}</strong>
                <small>{isEnglish ? "Greet when the app opens." : "应用启动后主动打招呼。"}</small>
              </span>
              <input
                type="checkbox"
                checked={activePreferences.greetingEnabled}
                onChange={(event) => update("greetingEnabled", event.target.checked)}
                aria-label={isEnglish ? "Enable greeting" : "开启问候"}
              />
            </label>

            <label className="desktop-experience-row desktop-experience-row--select">
              <span>
                <strong>{isEnglish ? "Idle animations" : "待机趣味动作"}</strong>
                <small>
                  {isEnglish
                    ? "Play occasional short actions only while no tasks are active."
                    : "没有任务时偶尔伸懒腰、喝水或播放短互动动作。"}
                </small>
              </span>
              <select
                value={activePreferences.idleAnimationFrequency}
                onChange={(event) =>
                  update(
                    "idleAnimationFrequency",
                    event.target.value as CompanionPreferences["idleAnimationFrequency"],
                  )
                }
                aria-label={isEnglish ? "Idle animation frequency" : "待机动作频率"}
              >
                <option value="off">{isEnglish ? "Off" : "关闭"}</option>
                <option value="low">{isEnglish ? "Low" : "低"}</option>
                <option value="normal">{isEnglish ? "Normal" : "普通"}</option>
                <option value="high">{isEnglish ? "High" : "高"}</option>
              </select>
            </label>

            <label className="desktop-experience-row">
              <span>
                <strong>{isEnglish ? "Quiet mode" : "免打扰"}</strong>
                <small>
                  {isEnglish
                    ? "Pause greetings, idle actions and reminders; keep real task status."
                    : "暂停主动问候、闲聊、趣味动作和休息提醒，保留真实任务状态。"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={activePreferences.quietMode}
                onChange={(event) => update("quietMode", event.target.checked)}
                aria-label={isEnglish ? "Companion quiet mode" : "桌宠免打扰"}
              />
            </label>

            <label className="desktop-experience-row desktop-experience-row--select">
              <span>
                <strong>{isEnglish ? "Idle chat" : "闲聊频率"}</strong>
                <small>
                  {isEnglish ? "Limit unprompted messages." : "控制没有任务时主动闲聊的频率。"}
                </small>
              </span>
              <select
                value={activePreferences.chattiness}
                onChange={(event) =>
                  update("chattiness", event.target.value as CompanionPreferences["chattiness"])
                }
                aria-label={isEnglish ? "Idle chat frequency" : "闲聊频率"}
              >
                <option value="off">{isEnglish ? "Off" : "关闭"}</option>
                <option value="low">{isEnglish ? "Low · hourly" : "低 · 每小时"}</option>
                <option value="normal">
                  {isEnglish ? "Normal · every 30 min" : "普通 · 每 30 分钟"}
                </option>
                <option value="high">
                  {isEnglish ? "High · every 15 min" : "高 · 每 15 分钟"}
                </option>
              </select>
            </label>

            <label className="desktop-experience-row desktop-experience-row--select">
              <span>
                <strong>{isEnglish ? "Rest after inactivity" : "闲置后休息"}</strong>
                <small>
                  {isEnglish ? "Set 0 to disable automatic rest." : "设为 0 可关闭自动休息。"}
                </small>
              </span>
              <span className="desktop-experience-number">
                <input
                  type="number"
                  min="0"
                  max="240"
                  step="5"
                  value={restDraft}
                  onChange={(event) => {
                    restDraftDirtyRef.current = true;
                    setRestDraftDirty(true);
                    setRestDraft(event.target.value);
                  }}
                  onBlur={saveRestInterval}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  aria-label={isEnglish ? "Minutes before resting" : "闲置休息分钟数"}
                />
                <span>{isEnglish ? "min" : "分钟"}</span>
              </span>
            </label>

            <label className="desktop-experience-row">
              <span>
                <strong>{isEnglish ? "Task status hints" : "任务提示"}</strong>
                <small>
                  {isEnglish
                    ? "Show brief working, waiting and completion cues."
                    : "显示简短的工作中、等待与完成状态。"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={activePreferences.taskHintsEnabled}
                onChange={(event) => update("taskHintsEnabled", event.target.checked)}
                aria-label={isEnglish ? "Enable task hints" : "开启任务提示"}
              />
            </label>

            <div className="desktop-experience-status desktop-experience-status--position">
              <span>{isEnglish ? "Saved position" : "保存位置"}</span>
              <code>
                {activePreferences.position
                  ? `${activePreferences.position.x}, ${activePreferences.position.y}`
                  : isEnglish
                    ? "Default"
                    : "默认位置"}
              </code>
            </div>

            <label className="desktop-experience-row">
              <span>
                <strong>{isEnglish ? "Working conversations" : "工作会话面板"}</strong>
                <small>
                  {isEnglish
                    ? "Show active conversations, status and elapsed time below the companion."
                    : "在桌宠下方显示正在工作的会话、状态和运行时长。"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={activePreferences.taskPanelEnabled}
                onChange={(event) => update("taskPanelEnabled", event.target.checked)}
                aria-label={isEnglish ? "Show working conversations" : "显示工作会话面板"}
              />
            </label>

            <label className="desktop-experience-row">
              <span>
                <strong>{isEnglish ? "Conversation titles" : "显示会话标题"}</strong>
                <small>
                  {titlesPending
                    ? savedPreferencesRef.current?.showSessionTitles
                      ? isEnglish
                        ? "Not applied yet: conversation titles are still visible until saving succeeds."
                        : "尚未生效：保存成功前，桌宠仍可能显示会话标题。"
                      : isEnglish
                        ? "Not applied yet: titles remain hidden until saving succeeds."
                        : "尚未生效：保存成功前，桌宠仍隐藏会话标题。"
                    : isEnglish
                      ? "Turn off to use anonymous labels in the companion and its menu."
                      : "关闭后桌宠及右键菜单使用匿名会话名称，不传递标题。"}
                </small>
              </span>
              <input
                type="checkbox"
                checked={activePreferences.showSessionTitles}
                onChange={(event) => update("showSessionTitles", event.target.checked)}
                aria-label={isEnglish ? "Show conversation titles" : "显示会话标题"}
              />
            </label>

            {saving && !saveError ? (
              <p className="desktop-experience-status" role="status">
                {isEnglish ? "Saving…" : "正在保存…"}
              </p>
            ) : null}
            {notice ? (
              <p
                className="desktop-experience-status desktop-experience-status--saved"
                role="status"
              >
                <Sparkles size={14} aria-hidden="true" />
                {notice}
              </p>
            ) : null}
            {saveError ? (
              <div className="desktop-experience-error" role="alert">
                <span>{saveError}</span>
                <button type="button" onClick={() => persistPatch({})}>
                  {isEnglish ? "Retry save" : "重试保存"}
                </button>
              </div>
            ) : null}
            {error ? (
              <div className="desktop-experience-error" role="alert">
                <span>{error}</span>
                <button type="button" disabled={actionBusy} onClick={retryCompanionOperation}>
                  {isEnglish ? "Retry" : "重试"}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="desktop-experience-error" role="alert">
            <span>
              {error || (isEnglish ? "Companion settings are unavailable." : "无法读取桌宠设置。")}
            </span>
            <button type="button" onClick={() => void loadPreferences()}>
              {isEnglish ? "Retry" : "重试"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
