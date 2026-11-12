import { Bot, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentQuestionAnswer, QuestionAnswer, QuestionRequest } from "../../../shared/domain";
import { MAX_QUESTION_ANSWER_LENGTH, requestQuestions } from "../../../shared/questions";
import { tr } from "../i18n";

interface Draft {
  selected: string[];
  other: boolean;
  text: string;
}

const blank = (): Draft => ({ selected: [], other: false, text: "" });

export function AgentQuestionPanel({
  request,
  onAnswer,
  onSyncPending,
}: {
  request: QuestionRequest;
  onAnswer: (answer: QuestionAnswer) => Promise<void>;
  onSyncPending: () => Promise<void>;
}) {
  const questions = requestQuestions(request);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef<object | null>(null);
  const mounted = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const question = questions[index] ?? questions[0];
  const getDraft = (id: string): Draft =>
    Object.hasOwn(drafts, id) ? (drafts[id] ?? blank()) : blank();
  const draft = question ? getDraft(question.id) : blank();
  const complete = (value: Draft) =>
    (value.selected.length > 0 || (value.other && Boolean(value.text.trim()))) &&
    (!value.other || Boolean(value.text.trim()));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setTimeout(() => {
      submitting.current = null;
      setBusy(false);
      setError(tr("回答提交尚未确认，可重试或刷新请求。"));
      void onSyncPending().catch(() => undefined);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [busy, onSyncPending]);

  const update = (next: Draft) => {
    if (!question || busy) return;
    setDrafts((current) => ({ ...current, [question.id]: next }));
    setError("");
  };
  const move = (next: number) => {
    setIndex(next);
    formRef.current?.querySelector(".question-panel__body")?.scrollTo(0, 0);
    requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLElement>("input:not(:disabled),textarea:not(:disabled)")
        ?.focus({ preventScroll: true });
    });
  };
  const submit = async () => {
    if (submitting.current) return;
    const missing = questions.findIndex((entry) => !complete(getDraft(entry.id)));
    if (missing >= 0) {
      move(missing);
      return;
    }
    const attempt = {};
    submitting.current = attempt;
    setBusy(true);
    setError("");
    const answers: AgentQuestionAnswer[] = questions.map((entry) => {
      const value = getDraft(entry.id);
      return {
        id: entry.id,
        selectedOptions: value.selected,
        otherText: value.other ? value.text.trim() : null,
      };
    });
    try {
      await onAnswer({ questionId: request.id, answers });
    } catch (cause) {
      if (mounted.current && submitting.current === attempt)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (submitting.current === attempt) {
        submitting.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  };
  if (!question) return null;
  return (
    <form
      className="question-panel"
      aria-label={tr("Agent 提问")}
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="question-panel__header">
        <Bot aria-hidden="true" size={17} />
        <strong>{tr("Agent 提问")}</strong>
        {questions.length > 1 ? (
          <span>{tr("问题 {0} / {1}", [index + 1, questions.length])}</span>
        ) : null}
        <span className="question-panel__mode">{tr(question.multiSelect ? "多选" : "单选")}</span>
      </div>
      <div className="question-panel__body">
        <fieldset disabled={busy}>
          <legend>{question.question}</legend>
          {question.header ? <p className="question-panel__topic">{question.header}</p> : null}
          <div className="question-options">
            {question.options.map((option, optionIndex) => {
              const selected = draft.selected.includes(option.label);
              return (
                <label
                  className={`question-option${selected ? " question-option--selected" : ""}`}
                  key={option.label}
                >
                  <input
                    type={question.multiSelect ? "checkbox" : "radio"}
                    name={`question-${request.id}-${question.id}`}
                    value={option.label}
                    checked={selected}
                    aria-labelledby={`question-${request.id}-${question.id}-${optionIndex}-title`}
                    aria-describedby={`question-${request.id}-${question.id}-${optionIndex}-description`}
                    onChange={() =>
                      update(
                        question.multiSelect
                          ? {
                              ...draft,
                              selected: selected
                                ? draft.selected.filter((value) => value !== option.label)
                                : [...draft.selected, option.label],
                            }
                          : { ...draft, selected: [option.label], other: false },
                      )
                    }
                  />
                  <span className="question-option__copy">
                    <strong id={`question-${request.id}-${question.id}-${optionIndex}-title`}>
                      {option.label}
                    </strong>
                    <span id={`question-${request.id}-${question.id}-${optionIndex}-description`}>
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
            <label
              className={`question-option question-option--other${draft.other ? " question-option--selected" : ""}`}
            >
              <input
                type={question.multiSelect ? "checkbox" : "radio"}
                name={`question-${request.id}-${question.id}`}
                value="__other__"
                checked={draft.other}
                aria-label={tr("其他")}
                onChange={() =>
                  update({
                    ...draft,
                    selected: question.multiSelect ? draft.selected : [],
                    other: question.multiSelect ? !draft.other : true,
                  })
                }
              />
              <span className="question-option__copy">
                <strong>{tr("其他")}</strong>
                <span>{tr("填写自己的回答")}</span>
              </span>
            </label>
          </div>
          {draft.other || !question.options.length ? (
            <textarea
              aria-label={tr("其他回答")}
              placeholder={tr("请输入你的回答")}
              rows={3}
              maxLength={MAX_QUESTION_ANSWER_LENGTH}
              value={draft.text}
              onChange={(event) => update({ ...draft, text: event.target.value, other: true })}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.ctrlKey || event.metaKey) &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          ) : null}
        </fieldset>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="question-panel__actions">
        {questions.length > 1 ? (
          <div className="question-panel__pagination">
            <button
              className="icon-button"
              type="button"
              title={tr("上一题")}
              aria-label={tr("上一题")}
              disabled={busy || index === 0}
              onClick={() => move(index - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              title={tr("下一题")}
              aria-label={tr("下一题")}
              disabled={busy || index === questions.length - 1}
              onClick={() => move(index + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
        {index < questions.length - 1 ? (
          <button
            className="btn btn--primary"
            type="button"
            disabled={busy || !complete(draft)}
            onClick={() => move(index + 1)}
          >
            {tr("下一题")}
          </button>
        ) : (
          <button className="btn btn--primary" type="submit" disabled={busy || !complete(draft)}>
            {busy ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : null}
            {tr(busy ? "正在提交回答…" : "提交回答")}
          </button>
        )}
      </div>
    </form>
  );
}
