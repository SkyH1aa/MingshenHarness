import {
  Check,
  ChevronRight,
  LoaderCircle,
  MessageSquareText,
  SlidersHorizontal,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionView } from "../../../shared/domain";
import {
  MAX_PROJECT_TONE_INSTRUCTION_CHARS,
  MAX_TEMPORARY_INSTRUCTION_CHARS,
  type ProjectTonePreset,
  type ProjectToneView,
} from "../../../shared/draft-assist";
import { tr } from "../i18n/index";
import { useFloatingPanel } from "../lib/use-floating-panel";
import "./composer-assist.css";

const toneOptions: Array<{ preset: ProjectTonePreset; label: string; detail: string }> = [
  { preset: "default", label: "不额外指定", detail: "沿用模型自身的表达方式。" },
  {
    preset: "professional",
    label: "专业清晰",
    detail: "结论优先，准确克制，减少口语。",
  },
  { preset: "concise", label: "简洁直接", detail: "压缩铺垫和重复，只保留有效信息。" },
  { preset: "friendly", label: "亲和自然", detail: "语气自然，兼顾清晰与协作感。" },
  { preset: "direct", label: "果断明确", detail: "强调判断、下一步和待确认事项。" },
  { preset: "academic", label: "严谨学术", detail: "准确区分事实、推断和未验证项。" },
  { preset: "custom", label: "自定义语气", detail: "为当前项目填写专用表达要求。" },
];

function toneLabel(preset: ProjectTonePreset): string {
  const option = toneOptions.find((candidate) => candidate.preset === preset);
  return option ? tr(option.label) : tr("项目语气");
}

interface ComposerAssistControlsProps {
  session: SessionView;
  draftText: string;
  draftRevision: string;
  formatted: boolean;
  disabled: boolean;
  temporaryInstruction: string;
  onTemporaryInstructionChange: (value: string) => void;
  onApplyPolished: (input: {
    originalText: string;
    originalRevision: string;
    polishedText: string;
  }) => void;
}

export function ComposerAssistControls({
  session,
  draftText,
  draftRevision,
  formatted,
  disabled,
  temporaryInstruction,
  onTemporaryInstructionChange,
  onApplyPolished,
}: ComposerAssistControlsProps) {
  const [menu, setMenu] = useState<"tone" | "instruction" | null>(null);
  const [tone, setTone] = useState<ProjectToneView>({
    preset: "default",
    customInstruction: null,
    configured: false,
    updatedAt: null,
  });
  const [customTone, setCustomTone] = useState("");
  const [customToneOpen, setCustomToneOpen] = useState(false);
  const [toneBusy, setToneBusy] = useState(false);
  const [toneError, setToneError] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState("");
  const [polishResult, setPolishResult] = useState<{
    originalText: string;
    draftRevision: string;
    text: string;
    modelDisplayName: string;
  } | null>(null);
  const generation = useRef(0);
  const polishRequest = useRef<string | null>(null);
  const toneTriggerRef = useRef<HTMLButtonElement>(null);
  const instructionTriggerRef = useRef<HTMLButtonElement>(null);
  const instructionInputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeTriggerRef = menu === "tone" ? toneTriggerRef : instructionTriggerRef;
  const position = useFloatingPanel(Boolean(menu), activeTriggerRef, panelRef, {
    minWidth: 320,
    maxHeight: 440,
    preferAbove: true,
    anchorComposer: true,
  });
  const projectToneAvailable = session.agentMode !== "chat" && Boolean(session.workspacePath);

  useEffect(() => {
    generation.current++;
    setMenu(null);
    setPolishing(false);
    setPolishResult(null);
    setPolishError("");
    setToneError("");
    setCustomTone("");
    setCustomToneOpen(false);
    let active = true;
    const cleanup = () => {
      active = false;
      generation.current++;
      const requestId = polishRequest.current;
      polishRequest.current = null;
      if (requestId) void window.mingshen.cancelDraftPolish(requestId).catch(() => undefined);
    };
    if (!projectToneAvailable) {
      setTone({
        preset: "default",
        customInstruction: null,
        configured: false,
        updatedAt: null,
      });
      return cleanup;
    }
    void window.mingshen
      .getProjectTone(session.id)
      .then((value) => {
        if (!active) return;
        setTone(value);
        setCustomTone(value.customInstruction ?? "");
      })
      .catch((cause) => {
        if (active) setToneError(cause instanceof Error ? cause.message : String(cause));
      });
    return cleanup;
  }, [projectToneAvailable, session.id]);

  useEffect(() => {
    if (menu === "instruction") instructionInputRef.current?.focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !panelRef.current?.contains(target) &&
        !toneTriggerRef.current?.contains(target) &&
        !instructionTriggerRef.current?.contains(target)
      )
        setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setMenu(null);
      activeTriggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeTriggerRef, menu]);

  const saveTone = async (preset: ProjectTonePreset, customInstruction?: string | null) => {
    const attempt = generation.current;
    setToneBusy(true);
    setToneError("");
    try {
      const saved = await window.mingshen.setProjectTone(
        preset === "custom"
          ? {
              sessionId: session.id,
              preset,
              customInstruction: customInstruction ?? "",
            }
          : { sessionId: session.id, preset },
      );
      if (generation.current !== attempt) return;
      setTone(saved);
      setCustomTone(saved.customInstruction ?? "");
      setCustomToneOpen(false);
      setMenu(null);
      toneTriggerRef.current?.focus({ preventScroll: true });
    } catch (cause) {
      if (generation.current === attempt)
        setToneError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation.current === attempt) setToneBusy(false);
    }
  };

  const polish = async () => {
    const originalText = draftText;
    if (!originalText.trim() || formatted || polishRequest.current || disabled) return;
    const attempt = generation.current;
    const requestId = crypto.randomUUID();
    polishRequest.current = requestId;
    setPolishing(true);
    setPolishError("");
    try {
      const result = await window.mingshen.polishDraft({
        requestId,
        sessionId: session.id,
        text: originalText,
        draftRevision,
      });
      if (generation.current !== attempt || polishRequest.current !== requestId) return;
      setPolishResult({
        originalText,
        draftRevision: result.draftRevision,
        text: result.text,
        modelDisplayName: result.modelDisplayName,
      });
    } catch (cause) {
      if (generation.current === attempt && polishRequest.current === requestId)
        setPolishError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (polishRequest.current === requestId) {
        polishRequest.current = null;
        if (generation.current === attempt) setPolishing(false);
      }
    }
  };
  const cancelPolish = () => {
    const requestId = polishRequest.current;
    if (!requestId) return;
    polishRequest.current = null;
    setPolishing(false);
    void window.mingshen.cancelDraftPolish(requestId).catch((cause) => {
      setPolishError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  return (
    <div className="composer-assist-controls" data-testid="composer-assist-controls">
      <button
        ref={instructionTriggerRef}
        type="button"
        className="icon-button composer-assist-trigger"
        data-testid="composer-temporary-instruction-trigger"
        data-active={Boolean(temporaryInstruction.trim())}
        aria-label={tr("设置仅下一轮生效的临时指令")}
        aria-haspopup="dialog"
        aria-expanded={menu === "instruction"}
        title={tr("临时指令（仅下一轮）")}
        disabled={disabled}
        onClick={() => setMenu((current) => (current === "instruction" ? null : "instruction"))}
      >
        <MessageSquareText aria-hidden="true" size={16} />
        {temporaryInstruction.trim() ? (
          <span className="composer-assist-trigger__dot" aria-hidden="true" />
        ) : null}
      </button>
      {polishing ? (
        <button
          type="button"
          className="icon-button"
          data-testid="draft-polish-cancel"
          aria-label={tr("取消润色")}
          title={tr("取消润色")}
          onClick={cancelPolish}
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
      {projectToneAvailable ? (
        <button
          ref={toneTriggerRef}
          type="button"
          className="icon-button composer-assist-trigger composer-assist-trigger--tone"
          data-testid="composer-project-tone-trigger"
          data-active={tone.preset !== "default"}
          aria-label={tr("项目语气：{0}", [toneLabel(tone.preset)])}
          aria-haspopup="dialog"
          aria-expanded={menu === "tone"}
          title={`${tr("项目语气")} · ${toneLabel(tone.preset)}`}
          disabled={disabled || toneBusy}
          onClick={() => setMenu((current) => (current === "tone" ? null : "tone"))}
        >
          <SlidersHorizontal aria-hidden="true" size={16} />
        </button>
      ) : null}
      <button
        type="button"
        className="icon-button composer-assist-trigger"
        data-testid="composer-polish-trigger"
        aria-label={tr("一键润色草稿")}
        title={tr("一键润色草稿")}
        disabled={disabled || polishing || formatted || !draftText.trim()}
        onClick={() => void polish()}
      >
        {polishing ? (
          <LoaderCircle className="spin" aria-hidden="true" size={16} />
        ) : (
          <WandSparkles aria-hidden="true" size={16} />
        )}
      </button>
      {polishError && !polishResult ? (
        <span className="composer-assist-inline-error" role="alert">
          {polishError}
        </span>
      ) : null}

      {menu
        ? createPortal(
            <div
              ref={panelRef}
              className="composer-assist-popover"
              data-testid="composer-assist-popover"
              role="dialog"
              aria-label={menu === "tone" ? tr("项目语气") : tr("临时指令")}
              style={{ ...position, zIndex: 82 }}
            >
              {menu === "instruction" ? (
                <>
                  <header className="composer-assist-popover__header">
                    <div>
                      <strong>{tr("临时指令")}</strong>
                      <small>{tr("只影响下一轮，不写入原文，也不会延续到后面的消息。")}</small>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={tr("关闭")}
                      onClick={() => setMenu(null)}
                    >
                      <X aria-hidden="true" size={15} />
                    </button>
                  </header>
                  <textarea
                    ref={instructionInputRef}
                    className="composer-assist-textarea"
                    data-testid="temporary-instruction-input"
                    value={temporaryInstruction}
                    maxLength={MAX_TEMPORARY_INSTRUCTION_CHARS}
                    placeholder={tr("例如：这一轮先只分析，不改文件；先给出风险最高的三项。")}
                    onChange={(event) => onTemporaryInstructionChange(event.target.value)}
                  />
                  <footer className="composer-assist-popover__footer">
                    <span>
                      {temporaryInstruction.length}/{MAX_TEMPORARY_INSTRUCTION_CHARS}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={!temporaryInstruction}
                      onClick={() => onTemporaryInstructionChange("")}
                    >
                      {tr("清除")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setMenu(null)}
                    >
                      {tr("完成")}
                    </button>
                  </footer>
                </>
              ) : (
                <>
                  <header className="composer-assist-popover__header">
                    <div>
                      <strong>{tr("项目语气")}</strong>
                      <small>{tr("按工作目录保存，CodeAgent 与 WorkAgent 共用。")}</small>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={tr("关闭")}
                      onClick={() => setMenu(null)}
                    >
                      <X aria-hidden="true" size={15} />
                    </button>
                  </header>
                  <div className="composer-tone-options">
                    {toneOptions.map((option) => (
                      <button
                        key={option.preset}
                        type="button"
                        className="composer-tone-option"
                        data-testid={`project-tone-option-${option.preset}`}
                        aria-pressed={tone.preset === option.preset}
                        disabled={toneBusy}
                        onClick={() => {
                          if (option.preset === "custom") {
                            setCustomTone(tone.customInstruction ?? "");
                            setCustomToneOpen(true);
                            return;
                          }
                          setCustomToneOpen(false);
                          void saveTone(option.preset);
                        }}
                      >
                        <span>
                          <strong>{tr(option.label)}</strong>
                          <small>{tr(option.detail)}</small>
                        </span>
                        {tone.preset === option.preset ? (
                          <Check aria-hidden="true" size={15} />
                        ) : (
                          <ChevronRight aria-hidden="true" size={15} />
                        )}
                      </button>
                    ))}
                  </div>
                  {customToneOpen || tone.preset === "custom" ? (
                    <div className="composer-tone-custom">
                      <label>
                        <span>{tr("当前项目的自定义表达要求")}</span>
                        <textarea
                          className="composer-assist-textarea"
                          data-testid="project-tone-custom-input"
                          value={customTone}
                          maxLength={MAX_PROJECT_TONE_INSTRUCTION_CHARS}
                          placeholder={tr(
                            "例如：面向非技术客户，先讲结果，再补充风险和下一步；避免内部缩写。",
                          )}
                          onChange={(event) => setCustomTone(event.target.value)}
                        />
                      </label>
                      <div className="composer-tone-custom__actions">
                        <span>
                          {customTone.length}/{MAX_PROJECT_TONE_INSTRUCTION_CHARS}
                        </span>
                        <button
                          type="button"
                          className="btn btn--secondary"
                          data-testid="project-tone-custom-save"
                          disabled={toneBusy || !customTone.trim()}
                          onClick={() => void saveTone("custom", customTone)}
                        >
                          {toneBusy ? (
                            <LoaderCircle className="spin" aria-hidden="true" size={14} />
                          ) : null}
                          {tr("保存项目语气")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {toneError ? (
                    <p className="composer-assist-popover__error" role="alert">
                      {toneError}
                    </p>
                  ) : null}
                </>
              )}
            </div>,
            document.body,
          )
        : null}

      {polishResult
        ? createPortal(
            <DraftPolishDialog
              original={polishResult.originalText}
              polished={polishResult.text}
              modelDisplayName={polishResult.modelDisplayName}
              draftChanged={
                draftRevision !== polishResult.draftRevision ||
                draftText !== polishResult.originalText
              }
              onClose={() => setPolishResult(null)}
              onApply={() => {
                onApplyPolished({
                  originalText: polishResult.originalText,
                  originalRevision: polishResult.draftRevision,
                  polishedText: polishResult.text,
                });
                setPolishResult(null);
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function DraftPolishDialog({
  original,
  polished,
  modelDisplayName,
  draftChanged,
  onClose,
  onApply,
}: {
  original: string;
  polished: string;
  modelDisplayName: string;
  draftChanged: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  const applyRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    applyRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const buttons =
        dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
      const first = buttons?.[0];
      const last = buttons?.[buttons.length - 1];
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="draft-polish-layer" role="presentation">
      <button
        type="button"
        className="draft-polish-scrim"
        aria-label={tr("取消润色")}
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        className="draft-polish-dialog"
        data-testid="draft-polish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-polish-title"
      >
        <header>
          <div>
            <span className="draft-polish-kicker">
              <WandSparkles aria-hidden="true" size={14} />
              {modelDisplayName}
            </span>
            <h2 id="draft-polish-title">{tr("润色结果预览")}</h2>
            <p>{tr("比较后再决定是否替换，原稿在应用前不会改变。")}</p>
          </div>
          <button type="button" className="icon-button" aria-label={tr("关闭")} onClick={onClose}>
            <X aria-hidden="true" size={17} />
          </button>
        </header>
        <div className="draft-polish-compare">
          <article>
            <h3>{tr("原始草稿")}</h3>
            <pre>{original}</pre>
          </article>
          <article className="draft-polish-compare__result">
            <h3>{tr("润色后")}</h3>
            <pre>{polished}</pre>
          </article>
        </div>
        {draftChanged ? (
          <p className="draft-polish-warning" role="alert">
            {tr("草稿在润色期间已发生变化。为避免覆盖新内容，请关闭后重新润色。")}
          </p>
        ) : null}
        <footer>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {tr("保留原稿")}
          </button>
          <button
            ref={applyRef}
            type="button"
            className="btn btn--secondary"
            data-testid="draft-polish-apply"
            disabled={draftChanged}
            onClick={onApply}
          >
            <Check aria-hidden="true" size={15} />
            {tr("应用到草稿")}
          </button>
        </footer>
      </section>
    </div>
  );
}
