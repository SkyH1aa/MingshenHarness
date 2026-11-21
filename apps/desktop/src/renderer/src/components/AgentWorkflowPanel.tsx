import { ArrowRight, Check, LoaderCircle, RefreshCw, Route, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type AutoDriveResult, autoDriveChoicePrompt } from "../../../shared/autodrive";
import type { CoordinationStateView } from "../../../shared/coordination";
import type { SessionView } from "../../../shared/domain";
import { useLocale } from "../i18n";
import "./agent-workflow.css";

function failure(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function AgentWorkflowPanel({
  session,
  disabled,
  onDraft,
}: {
  session: SessionView;
  disabled: boolean;
  onDraft(text: string): Promise<void> | void;
}) {
  const en = useLocale() === "en";
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<AutoDriveResult | null>(null);
  const [selected, setSelected] = useState("");
  const [coordination, setCoordination] = useState<CoordinationStateView | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const mounted = useRef(true);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await window.mingshen.getAgentCoordination(session.id);
      if (mounted.current) setCoordination(next);
    } catch (cause) {
      if (mounted.current) setError(failure(cause));
    }
  }, [session.id]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.mingshen.onRuntimeEvent((event) => {
      if (!("sessionId" in event) || event.sessionId !== session.id || timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 180);
    });
    return () => {
      mounted.current = false;
      generation.current++;
      if (timer) clearTimeout(timer);
      off();
      void window.mingshen.cancelAutoDrive(session.id).catch(() => undefined);
    };
  }, [refresh, session.id]);
  useEffect(() => {
    if (!result) return;
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [result]);

  const suggest = async () => {
    if (busy || disabled) return;
    const attempt = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await window.mingshen.getAutoDriveSuggestions(session.id);
      if (!mounted.current || generation.current !== attempt) return;
      setSelected(next.suggestions[0]?.id ?? "");
      setResult(next);
    } catch (cause) {
      if (mounted.current && generation.current === attempt) setError(failure(cause));
    } finally {
      if (mounted.current && generation.current === attempt) setBusy(false);
    }
  };
  const cancel = () => {
    generation.current++;
    setBusy(false);
    void window.mingshen.cancelAutoDrive(session.id).catch((cause) => {
      if (mounted.current) setError(failure(cause));
    });
  };
  const apply = async () => {
    if (!result || applying) return;
    const attempt = generation.current;
    setApplying(true);
    try {
      await onDraft(autoDriveChoicePrompt(result, selected));
      if (mounted.current && generation.current === attempt) {
        setResult(null);
        setError("");
      }
    } catch (cause) {
      if (mounted.current && generation.current === attempt) setError(failure(cause));
    } finally {
      if (mounted.current && generation.current === attempt) setApplying(false);
    }
  };
  const choice = result?.suggestions.find((item) => item.id === selected);
  const phaseLabel = (value: string) => {
    if (en) return value.replaceAll("_", " ");
    const labels: Record<string, string> = {
      planned: "已规划",
      executing: "执行中",
      qa: "复核中",
      completed: "已完成",
      failed: "未通过",
      cancelled: "已取消",
      queued: "等待调度",
      running: "运行中",
      not_run: "未执行",
      passed: "通过",
      blocked: "受阻",
    };
    return labels[value] ?? value;
  };
  return (
    <div className="agent-workflow" data-testid="agent-workflow">
      <div className="agent-workflow__actions">
        <button
          ref={trigger}
          type="button"
          className="btn btn--ghost"
          data-testid="autodrive-suggest"
          disabled={disabled || busy || !session.modelId}
          onClick={() => void suggest()}
          title={en ? "Plan the next project direction" : "自动规划下一步"}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
          ) : (
            <Route size={14} aria-hidden="true" />
          )}
          <span>{en ? "AutoDrive" : "自动规划下一步"}</span>
        </button>
        {busy ? (
          <button
            type="button"
            className="icon-button"
            data-testid="autodrive-cancel"
            aria-label={en ? "Cancel planning" : "取消规划"}
            onClick={cancel}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
        {coordination ? (
          <span className="agent-workflow__phase" data-phase={coordination.phase}>
            {phaseLabel(coordination.phase)}
          </span>
        ) : null}
      </div>
      {coordination ? (
        <details
          className="agent-workflow__coordination"
          data-testid="agent-coordination"
          data-quality={coordination.qa.status}
        >
          <summary>
            <ShieldCheck size={14} aria-hidden="true" />
            <span>{coordination.goal}</span>
            <strong>
              {en ? "QA" : "质量"}: {phaseLabel(coordination.qa.status)}
            </strong>
          </summary>
          <ol>
            {coordination.tasks.map((task) => (
              <li key={task.id} data-task-status={task.status}>
                <span>
                  {task.label}
                  <small>{task.agentProfileId}</small>
                </span>
                <strong>{phaseLabel(task.status)}</strong>
                {task.summary ? <p>{task.summary}</p> : null}
              </li>
            ))}
          </ol>
          <p>
            {en ? "Verification" : "验证"}: {phaseLabel(coordination.verification.status)}
          </p>
          <p>{coordination.verification.summary}</p>
          <p>QA: {coordination.qa.summary || phaseLabel(coordination.qa.status)}</p>
          {coordination.qa.evidence.length ? (
            <ul>
              {[...new Set(coordination.qa.evidence)].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label={en ? "Refresh quality status" : "刷新质量状态"}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        </details>
      ) : null}
      {error && !result ? (
        <p className="agent-workflow__error" role="alert">
          {error}
        </p>
      ) : null}
      {result && choice
        ? createPortal(
            <div className="autodrive-layer">
              <button
                className="autodrive-scrim"
                type="button"
                aria-label={en ? "Close proposals" : "关闭方案"}
                disabled={applying}
                onClick={() => setResult(null)}
              />
              <section
                className="autodrive-dialog"
                ref={dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="autodrive-title"
                data-testid="autodrive-dialog"
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !applying) {
                    event.preventDefault();
                    event.stopPropagation();
                    setResult(null);
                  }
                  if (event.key !== "Tab") return;
                  const controls = [
                    ...event.currentTarget.querySelectorAll<HTMLElement>(
                      'button:not(:disabled),[tabindex="0"]',
                    ),
                  ];
                  const first = controls[0],
                    last = controls.at(-1);
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                  } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                  }
                }}
              >
                <header>
                  <div>
                    <span>AutoDrive</span>
                    <h2 id="autodrive-title">
                      {en ? "Choose the next direction" : "选择项目的下一步"}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={applying}
                    aria-label={en ? "Close" : "关闭"}
                    onClick={() => setResult(null)}
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </header>
                <div className="autodrive-dialog__content">
                  <nav aria-label={en ? "Project proposals" : "项目方案"}>
                    {result.suggestions.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={item.id === selected}
                        data-autodrive-choice={item.id}
                        onClick={() => setSelected(item.id)}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{item.title}</strong>
                        {item.id === selected ? (
                          <Check size={15} aria-hidden="true" />
                        ) : (
                          <ArrowRight size={15} aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </nav>
                  <article>
                    <h3>{choice.title}</h3>
                    <p>{choice.summary}</p>
                    <p className="autodrive-rationale">{choice.rationale}</p>
                    <h4>{en ? "Steps" : "建议步骤"}</h4>
                    <ol>
                      {[...new Set(choice.steps)].map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                    <h4>{en ? "Risks" : "风险与取舍"}</h4>
                    <ul>
                      {[...new Set(choice.risks)].map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <h4>{en ? "Verification" : "验收标准"}</h4>
                    <ul>
                      {[...new Set(choice.verification)].map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                </div>
                {error ? (
                  <p className="agent-workflow__error" role="alert">
                    {error}
                  </p>
                ) : null}
                <footer>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={applying}
                    onClick={() => setResult(null)}
                  >
                    {en ? "Cancel" : "取消"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    data-testid="autodrive-apply"
                    disabled={applying || disabled}
                    onClick={() => void apply()}
                  >
                    {applying ? (
                      <LoaderCircle className="spin" size={15} aria-hidden="true" />
                    ) : (
                      <ArrowRight size={15} aria-hidden="true" />
                    )}
                    {en ? "Add to draft" : "加入草稿"}
                  </button>
                </footer>
              </section>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
