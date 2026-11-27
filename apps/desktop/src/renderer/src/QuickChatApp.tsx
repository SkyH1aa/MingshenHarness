import { LoaderCircle, Maximize2, Pin, PinOff, SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type {
  ActivityEvent,
  ChatAttachmentInput,
  ChatStreamEvent,
  SessionMessage,
  SessionRunState,
  SessionUpdateInput,
  SessionView,
} from "../../shared/domain";
import type { QuickChatAction, QuickChatState } from "../../shared/quick-chat";
import { BrandMark } from "./components/BrandMark";
import { ChatView } from "./components/ChatView";
import { setLocale, tr, useLocale } from "./i18n/index";
import { runtimeText } from "./i18n/runtime";
import type { LiveRun } from "./lib/chat-types";
import { isActiveRuntimeRunStatus } from "./lib/format";
import { PendingSubmissionKeys } from "./lib/pending-submission-keys";
import {
  QuickChatTransitionWork,
  quickChatTransitionReady,
} from "./lib/quick-chat-transition-work";
import { composerDrafts, useComposerDraft } from "./lib/use-composer-draft";

function errorText(cause: unknown): string {
  return runtimeText(cause instanceof Error ? cause.message : String(cause));
}

function mergeMessage(current: SessionMessage[], next: SessionMessage): SessionMessage[] {
  if (current.some((message) => message.id === next.id)) return current;
  return [...current, next].sort((left, right) => left.seq - right.seq);
}

function mergeActivity(current: ActivityEvent[], next: ActivityEvent): ActivityEvent[] {
  const index = current.findIndex((activity) => activity.id === next.id);
  if (index === -1) return [...current, next];
  return current.map((activity) => (activity.id === next.id ? next : activity));
}

function runningState(sessionId: string, runId: string): SessionRunState {
  return {
    sessionId,
    runId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "running",
  };
}

function runtimeSessionStatus(status: SessionRunState["status"]): SessionView["status"] {
  switch (status) {
    case "completed":
      return "idle";
    case "interrupted":
      return "interrupted";
    case "failed":
    case "blocked_policy":
      return "error";
    case "waiting_approval":
      return "waiting_approval";
    default:
      return "running";
  }
}

function focusComposer(): void {
  let attempts = 0;
  const focus = () => {
    const field = document.querySelector<HTMLElement>(
      ".chat-view--quick textarea:not([hidden]):not(:disabled), .chat-view--quick .composer-preview[tabindex]",
    );
    if (field) {
      field.focus({ preventScroll: true });
      return;
    }
    attempts += 1;
    if (attempts < 16) requestAnimationFrame(focus);
  };
  requestAnimationFrame(focus);
}

function ArchivedDraft({
  sessionId,
  interactionLocked,
  onModePreparationChange,
}: {
  sessionId: string;
  interactionLocked: boolean;
  onModePreparationChange: (sessionId: string, preparing: boolean) => void;
}) {
  const draft = useComposerDraft(sessionId);
  const recoveryRef = useRef(false);
  const [recovering, setRecovering] = useState(false);
  const recover = async (resolution?: "overwrite" | "reload") => {
    if (interactionLocked || recoveryRef.current) return;
    recoveryRef.current = true;
    setRecovering(true);
    onModePreparationChange(sessionId, true);
    try {
      if (resolution) await composerDrafts.resolveConflict(sessionId, resolution);
      else await composerDrafts.flush(sessionId);
    } catch {
      // The draft store retains the recovery error for the existing UI.
    } finally {
      onModePreparationChange(sessionId, false);
      recoveryRef.current = false;
      setRecovering(false);
    }
  };
  return (
    <div className="quick-chat__unavailable" data-testid="quick-chat-archived">
      <h1>{tr("此对话已归档")}</h1>
      <p>{tr("草稿保留在原对话中。处理完保存问题后，可新建快捷对话。")}</p>
      {draft.ready && draft.value.text ? (
        <textarea
          data-testid="quick-chat-archived-draft"
          aria-label={tr("已归档对话的草稿")}
          value={draft.value.text}
          rows={6}
          readOnly
        />
      ) : null}
      {draft.value.attachments.length ? (
        <ul aria-label={tr("草稿附件")}>
          {draft.value.attachments.map((attachment) => (
            <li key={attachment.id}>{attachment.file.name}</li>
          ))}
        </ul>
      ) : null}
      {draft.error ? (
        <div role="alert">
          <p>
            {draft.conflict
              ? tr("另一个窗口已更新此草稿。当前窗口的内容已保留，请选择如何处理。")
              : tr("草稿保存或恢复失败：{0}", [runtimeText(draft.error)])}
          </p>
          <div className="quick-chat__recovery-actions">
            {draft.conflict ? (
              <>
                <button
                  className="btn btn--secondary"
                  type="button"
                  disabled={interactionLocked || draft.saving || recovering}
                  onClick={() => void recover("overwrite")}
                >
                  {tr("用本地内容覆盖")}
                </button>
                <button
                  className="btn btn--secondary"
                  type="button"
                  disabled={interactionLocked || draft.saving || recovering}
                  onClick={() => void recover("reload")}
                >
                  {tr("载入最新草稿")}
                </button>
              </>
            ) : (
              <button
                className="btn btn--secondary"
                type="button"
                disabled={interactionLocked || draft.saving || recovering}
                onClick={() => void recover()}
              >
                {tr("重试")}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function QuickChatApp() {
  useLocale();
  const [snapshot, setSnapshot] = useState<QuickChatState | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [runState, setRunState] = useState<SessionRunState | null>(null);
  const runStateRef = useRef<SessionRunState | null>(null);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [context, setContext] = useState<QuickChatState["context"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [transitionLocked, setTransitionLocked] = useState(false);
  const [initialStatus, setInitialStatus] = useState<"loading" | "ready" | "error">("loading");
  const [initialRetry, setInitialRetry] = useState(0);
  const currentSessionId = useRef<string | null>(null);
  const snapshotGeneration = useRef(0);
  const actionSequence = useRef(0);
  const actionBusyRef = useRef(false);
  const runEventVersion = useRef(0);
  const pendingSubmissionKeys = useRef(new PendingSubmissionKeys());
  const transitionWork = useRef(new QuickChatTransitionWork()).current;
  const preparationFinishers = useRef(new Map<string, Array<() => void>>());
  const transitionRef = useRef<{ requestId: string; controller: AbortController } | null>(null);
  const deferredConsumed = useRef(new Map<string, Set<string>>());

  const reconcileConsumedDraft = useCallback(
    (sessionId: string, revision: string) => {
      const finish = transitionWork.begin();
      void composerDrafts
        .accepted(sessionId, revision)
        .catch(() => undefined)
        .finally(finish);
    },
    [transitionWork],
  );

  const commitRunState = useCallback(
    (
      next: SessionRunState | null | ((current: SessionRunState | null) => SessionRunState | null),
    ) => {
      const current = runStateRef.current;
      const resolved = typeof next === "function" ? next(current) : next;
      runStateRef.current = resolved;
      setRunState(resolved);
      return resolved;
    },
    [],
  );

  const onModePreparationChange = useCallback(
    (sessionId: string, preparing: boolean) => {
      const finishers = preparationFinishers.current.get(sessionId) ?? [];
      if (preparing) {
        finishers.push(transitionWork.begin());
        preparationFinishers.current.set(sessionId, finishers);
      } else {
        finishers.shift()?.();
        if (finishers.length === 0) preparationFinishers.current.delete(sessionId);
      }
    },
    [transitionWork],
  );

  useLayoutEffect(() => {
    const unsubscribe = window.mingshen.onQuickChatTransition((requestId, locked) => {
      if (!locked) {
        if (transitionRef.current?.requestId !== requestId) return;
        transitionRef.current.controller.abort();
        transitionRef.current = null;
        flushSync(() => setTransitionLocked(false));
        const sessionId = currentSessionId.current;
        if (sessionId) {
          for (const revision of deferredConsumed.current.get(sessionId) ?? [])
            reconcileConsumedDraft(sessionId, revision);
        }
        deferredConsumed.current.clear();
        return;
      }
      if (transitionRef.current?.requestId === requestId) return;
      transitionRef.current?.controller.abort();
      const transition = { requestId, controller: new AbortController() };
      transitionRef.current = transition;
      // Preload may replay an existing lock during effect registration.
      queueMicrotask(() => {
        if (transitionRef.current !== transition) return;
        flushSync(() => setTransitionLocked(true));
        void (async () => {
          try {
            const ready = await quickChatTransitionReady(
              transitionWork,
              transition.controller.signal,
              () => Boolean(document.querySelector('[data-unsaved="true"]')),
            );
            if (transitionRef.current !== transition) return;
            if (!ready) {
              window.mingshen.acknowledgeQuickChatTransition(
                requestId,
                tr("存在未保存的消息编辑，请先提交或取消。"),
              );
              return;
            }
            window.mingshen.acknowledgeQuickChatTransition(requestId);
          } catch (cause) {
            if (transitionRef.current === transition && !transition.controller.signal.aborted)
              window.mingshen.acknowledgeQuickChatTransition(requestId, errorText(cause));
          }
        })();
      });
    });
    return () => {
      unsubscribe();
      transitionRef.current?.controller.abort();
      transitionRef.current = null;
    };
  }, [reconcileConsumedDraft, transitionWork]);

  useEffect(() => {
    let active = true;
    let request = 0;
    const syncAppearance = () => {
      const theme = localStorage.getItem("mingshen.theme") === "day" ? "day" : "night";
      document.documentElement.dataset.theme = theme;
      const currentRequest = ++request;
      void window.mingshen
        .getDesktopState()
        .then((next) => {
          if (active && currentRequest === request) setLocale(next.locale);
        })
        .catch(() => undefined);
    };
    syncAppearance();
    window.addEventListener("focus", syncAppearance);
    return () => {
      active = false;
      request += 1;
      window.removeEventListener("focus", syncAppearance);
    };
  }, []);

  const applySnapshot = useCallback(
    (next: QuickChatState, focus = false) => {
      snapshotGeneration.current += 1;
      runEventVersion.current += 1;
      const previousSessionId = currentSessionId.current;
      const changed = previousSessionId !== (next.session?.id ?? null);
      if (changed && previousSessionId && transitionRef.current) {
        deferredConsumed.current.delete(previousSessionId);
        composerDrafts.forget([previousSessionId]);
      }
      currentSessionId.current = next.session?.id ?? null;
      setSnapshot(next);
      setMessages(next.messages);
      commitRunState(next.runState);
      setContext(next.context);
      setError(next.error);
      setInitialStatus("ready");
      if (changed) {
        setLive(null);
        setActivities([]);
      }
      if (focus) focusComposer();
    },
    [commitRunState],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: initialRetry explicitly restarts startup loading.
  useEffect(() => {
    let active = true;
    setInitialStatus("loading");
    setError(null);
    const requestGeneration = snapshotGeneration.current;
    const unsubscribe = window.mingshen.onQuickChatState((next) => {
      if (!active) return;
      if (transitionRef.current) flushSync(() => applySnapshot(next, true));
      else applySnapshot(next, true);
    });
    void window.mingshen
      .getQuickChatState()
      .then((next) => {
        if (!active || snapshotGeneration.current !== requestGeneration) return;
        if (transitionRef.current) flushSync(() => applySnapshot(next, true));
        else applySnapshot(next, true);
      })
      .catch((cause) => {
        if (!active || snapshotGeneration.current !== requestGeneration) return;
        setError(errorText(cause));
        setInitialStatus("error");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySnapshot, initialRetry]);

  useEffect(() => {
    const unsubscribe = window.mingshen.onRuntimeEvent((event: ChatStreamEvent) => {
      if (event.type === "session_removed") composerDrafts.forget([event.sessionId]);
      const sessionId = currentSessionId.current;
      if (!sessionId) return;
      const eventSessionId =
        event.type === "context_updated"
          ? event.context.sessionId
          : event.type === "session_updated"
            ? event.session.id
            : event.type === "activity"
              ? event.activity.sessionId
              : "sessionId" in event
                ? event.sessionId
                : null;
      if (eventSessionId !== sessionId) return;
      switch (event.type) {
        case "runtime_run_updated": {
          runEventVersion.current += 1;
          const startedAt = event.run.startedAt ?? event.run.createdAt;
          const next: SessionRunState = {
            sessionId: event.sessionId,
            runId: event.run.runId,
            startedAt,
            completedAt: event.run.completedAt,
            status: event.run.status,
          };
          const resolved = commitRunState((current) => {
            if (!current) return next;
            const previousStartedAt = Date.parse(current.startedAt);
            const nextStartedAt = Date.parse(next.startedAt);
            if (current.runId === next.runId) {
              if (
                !isActiveRuntimeRunStatus(current.status) &&
                isActiveRuntimeRunStatus(next.status)
              ) {
                return current;
              }
              return next;
            }
            if (Number.isFinite(previousStartedAt) && nextStartedAt < previousStartedAt)
              return current;
            return next;
          });
          setSnapshot((snapshot) =>
            currentSessionId.current === sessionId && snapshot?.session
              ? {
                  ...snapshot,
                  session: {
                    ...snapshot.session,
                    status: runtimeSessionStatus(resolved?.status ?? event.run.status),
                  },
                }
              : snapshot,
          );
          if (!isActiveRuntimeRunStatus(resolved?.status ?? event.run.status)) {
            setLive((current) => (current?.runId === event.run.runId ? null : current));
            if (resolved?.status === "failed" || resolved?.status === "blocked_policy") {
              setError(runtimeText(event.run.terminalReason ?? resolved.status));
            }
          }
          return;
        }
        case "composer_draft_consumed":
          if (transitionRef.current) {
            const revisions = deferredConsumed.current.get(sessionId) ?? new Set<string>();
            revisions.add(event.revision);
            deferredConsumed.current.set(sessionId, revisions);
          } else reconcileConsumedDraft(sessionId, event.revision);
          return;
        case "session_updated":
          snapshotGeneration.current += 1;
          {
            const update = () =>
              setSnapshot((current) =>
                currentSessionId.current === sessionId && current
                  ? { ...current, session: event.session }
                  : current,
              );
            if (transitionRef.current) flushSync(update);
            else update();
          }
          return;
        case "session_removed":
          snapshotGeneration.current += 1;
          runEventVersion.current += 1;
          pendingSubmissionKeys.current.forgetSession(event.sessionId);
          currentSessionId.current = null;
          setSnapshot((current) =>
            current ? { ...current, session: null, messages: [] } : current,
          );
          setMessages([]);
          setLive(null);
          commitRunState(null);
          setContext(null);
          setActivities([]);
          return;
        case "run_started": {
          runEventVersion.current += 1;
          setError(null);
          const previous = runStateRef.current;
          if (previous && previous.runId !== event.runId) {
            return;
          }
          if (previous?.runId === event.runId && !isActiveRuntimeRunStatus(previous.status)) {
            return;
          }
          const next = runningState(sessionId, event.runId);
          commitRunState((current) =>
            current?.runId === event.runId ? { ...next, startedAt: current.startedAt } : next,
          );
          setSnapshot((current) =>
            currentSessionId.current === sessionId && current?.session
              ? { ...current, session: { ...current.session, status: "running" } }
              : current,
          );
          setActivities([]);
          if (event.kind !== "compaction")
            setLive({ runId: event.runId, text: "", reasoning: "", startedAt: Date.now() });
          else setLive(null);
          return;
        }
        case "model_attempt_reset":
          setLive((current) => {
            if (currentSessionId.current !== sessionId) return current;
            return current?.runId === event.runId
              ? { ...current, text: "", reasoning: "" }
              : current;
          });
          return;
        case "assistant_delta":
          setLive((current) => {
            if (currentSessionId.current !== sessionId) return current;
            const base =
              current?.runId === event.runId
                ? current
                : { runId: event.runId, text: "", reasoning: "", startedAt: Date.now() };
            return { ...base, text: base.text + event.text };
          });
          return;
        case "reasoning_delta":
          setLive((current) => {
            if (currentSessionId.current !== sessionId) return current;
            const base =
              current?.runId === event.runId
                ? current
                : { runId: event.runId, text: "", reasoning: "", startedAt: Date.now() };
            return { ...base, reasoning: base.reasoning + event.text };
          });
          return;
        case "user_message":
        case "assistant_message":
          setMessages((current) =>
            currentSessionId.current === sessionId ? mergeMessage(current, event.message) : current,
          );
          if (event.type === "assistant_message")
            setLive((current) =>
              currentSessionId.current === sessionId && current?.runId === event.runId
                ? { ...current, text: "", reasoning: "" }
                : current,
            );
          return;
        case "activity":
          setActivities((current) =>
            currentSessionId.current === sessionId
              ? mergeActivity(current, event.activity)
              : current,
          );
          return;
        case "context_updated":
          if (currentSessionId.current === sessionId) setContext(event.context);
          return;
        case "run_completed":
        case "run_interrupted":
        case "run_failed":
          runEventVersion.current += 1;
          if (runStateRef.current && runStateRef.current.runId !== event.runId) {
            setLive((current) => (current?.runId === event.runId ? null : current));
            return;
          }
          setSnapshot((current) =>
            currentSessionId.current === sessionId && current?.session
              ? {
                  ...current,
                  session: {
                    ...current.session,
                    status:
                      event.type === "run_completed"
                        ? "idle"
                        : event.type === "run_interrupted"
                          ? "interrupted"
                          : "error",
                  },
                }
              : current,
          );
          commitRunState((current) =>
            currentSessionId.current === sessionId
              ? {
                  sessionId,
                  runId: event.runId,
                  startedAt:
                    current?.runId === event.runId ? current.startedAt : new Date().toISOString(),
                  completedAt: new Date().toISOString(),
                  status:
                    event.type === "run_completed"
                      ? "completed"
                      : event.type === "run_interrupted"
                        ? "interrupted"
                        : "failed",
                }
              : current,
          );
          if (event.type === "run_failed") setError(runtimeText(event.error));
          setLive((current) => (current?.runId === event.runId ? null : current));
          return;
        case "conversation_rewound":
          runEventVersion.current += 1;
          setSnapshot((current) =>
            currentSessionId.current === sessionId && current
              ? { ...current, session: event.session }
              : current,
          );
          commitRunState(null);
          setLive(null);
          void window.mingshen
            .getSessionMessages(sessionId)
            .then((next) => {
              if (currentSessionId.current === sessionId) setMessages(next);
            })
            .catch(() => undefined);
          return;
        default:
          return;
      }
    });
    return unsubscribe;
  }, [commitRunState, reconcileConsumedDraft]);

  const action = useCallback(
    async (name: QuickChatAction) => {
      if (actionBusyRef.current || transitionRef.current) return;
      actionBusyRef.current = true;
      const request = ++actionSequence.current;
      const generation = snapshotGeneration.current;
      flushSync(() => setActionBusy(true));
      setError(null);
      try {
        const next = await window.mingshen.quickChatAction(name);
        if (next && request === actionSequence.current && generation === snapshotGeneration.current)
          flushSync(() => applySnapshot(next, name === "show" || name === "new"));
      } catch (cause) {
        if (request === actionSequence.current && generation === snapshotGeneration.current)
          setError(errorText(cause));
      } finally {
        if (request === actionSequence.current) {
          actionBusyRef.current = false;
          setActionBusy(false);
        }
      }
    },
    [applySnapshot],
  );

  useEffect(() => {
    const hide = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.repeat ||
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return;
      void action("hide");
    };
    window.addEventListener("keydown", hide);
    return () => window.removeEventListener("keydown", hide);
  }, [action]);

  const current = snapshot;
  const session = current?.session ?? null;
  const providers = current?.providers ?? [];
  const selectedModel = providers
    .find((provider) => provider.id === session?.providerId)
    ?.models.find((model) => model.id === session?.modelId);
  const available = providers.some((provider) => provider.models.some((model) => model.enabled));

  const patchSession = useCallback(async (input: SessionUpdateInput): Promise<SessionView> => {
    const sessionId = input.sessionId;
    const updated = await window.mingshen.updateSession(input);
    if (currentSessionId.current === sessionId)
      setSnapshot((current) =>
        currentSessionId.current === sessionId && current
          ? { ...current, session: updated }
          : current,
      );
    return updated;
  }, []);

  const send = useCallback(
    async (text: string, attachments: ChatAttachmentInput[], draftRevision: string) => {
      if (!session || session.archived) throw new Error(tr("当前对话不可用。"));
      const sessionId = session.id;
      const identity = { sessionId, draftRevision };
      const idempotencyKey = pendingSubmissionKeys.current.acquire(identity);
      setError(null);
      const version = runEventVersion.current;
      const result = await window.mingshen.sendChat({
        sessionId,
        text,
        attachments,
        draftRevision,
        idempotencyKey,
      });
      pendingSubmissionKeys.current.release(identity);
      if (currentSessionId.current !== sessionId || runEventVersion.current !== version) return;
      setSnapshot((current) =>
        currentSessionId.current === sessionId && current?.session
          ? { ...current, session: { ...current.session, status: "running" } }
          : current,
      );
      if (currentSessionId.current === sessionId)
        commitRunState(runningState(sessionId, result.runId));
    },
    [commitRunState, session],
  );

  const rewrite = useCallback(
    async (messageId: string, text: string) => {
      if (!session || session.archived) throw new Error(tr("当前对话不可用。"));
      if (actionBusyRef.current || transitionRef.current)
        throw new Error(tr("正在切换对话，请稍后重试。"));
      setError(null);
      const version = runEventVersion.current;
      const finish = transitionWork.begin();
      try {
        const result = await window.mingshen.rewriteAndSendChat({
          sessionId: session.id,
          messageId,
          text,
        });
        if (currentSessionId.current !== session.id || runEventVersion.current !== version) return;
        setSnapshot((current) =>
          currentSessionId.current === session.id && current?.session
            ? { ...current, session: { ...current.session, status: "running" } }
            : current,
        );
        if (currentSessionId.current === session.id)
          commitRunState(runningState(session.id, result.runId));
      } finally {
        finish();
      }
    },
    [commitRunState, session, transitionWork],
  );

  const stop = useCallback(async () => {
    if (!session) return;
    const sessionId = session.id;
    const runId = runStateRef.current?.runId;
    const version = runEventVersion.current;
    await window.mingshen.stopChat(sessionId, runId);
    if (currentSessionId.current !== sessionId || runEventVersion.current !== version) return;
    setLive(null);
    setSnapshot((current) =>
      currentSessionId.current === sessionId && current?.session
        ? { ...current, session: { ...current.session, status: "interrupted" } }
        : current,
    );
    commitRunState((current) =>
      currentSessionId.current === sessionId && current && (!runId || current.runId === runId)
        ? { ...current, completedAt: new Date().toISOString(), status: "interrupted" }
        : current,
    );
  }, [commitRunState, session]);

  const compact = useCallback(
    async (sessionId: string) => {
      const version = runEventVersion.current;
      const result = await window.mingshen.compactChat(sessionId);
      if (currentSessionId.current !== sessionId || runEventVersion.current !== version)
        return result;
      setSnapshot((current) =>
        currentSessionId.current === sessionId && current?.session
          ? { ...current, session: { ...current.session, status: "running" } }
          : current,
      );
      if (currentSessionId.current === sessionId)
        commitRunState(runningState(sessionId, result.runId));
      return result;
    },
    [commitRunState],
  );

  const syncPending = useCallback(async () => undefined, []);
  const ignoreApprovalDecision = useCallback(async () => undefined, []);
  const ignoreQuestionAnswer = useCallback(async () => undefined, []);

  return (
    <div className="quick-chat" data-run-state={runState?.status ?? "idle"}>
      <header className="quick-chat__bar">
        <div className="quick-chat__identity">
          <BrandMark size={22} />
          <span>
            <strong>Mingshen</strong>
            <small>ChatAgent</small>
          </span>
          <span className="quick-chat__live" aria-hidden="true" />
        </div>
        <div className="quick-chat__model" title={selectedModel?.displayName}>
          {selectedModel?.displayName ?? tr("未选择模型")}
        </div>
        <div className="quick-chat__actions">
          <button
            type="button"
            className="quick-chat__pin"
            aria-label={current?.pinned ? tr("取消置顶窗口") : tr("置顶窗口")}
            title={current?.pinned ? tr("取消置顶窗口") : tr("置顶窗口")}
            aria-pressed={current?.pinned ?? false}
            data-testid="quick-chat-pin"
            disabled={actionBusy || transitionLocked}
            onClick={() => void action("toggle-pin")}
          >
            {current?.pinned ? (
              <PinOff aria-hidden="true" size={15} />
            ) : (
              <Pin aria-hidden="true" size={15} />
            )}
          </button>
          <button
            type="button"
            aria-label={tr("新建对话")}
            title={tr("新建对话")}
            disabled={actionBusy || transitionLocked}
            onClick={() => void action("new")}
          >
            <SquarePen aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            aria-label={tr("打开主界面")}
            title={tr("打开主界面")}
            disabled={actionBusy || transitionLocked}
            onClick={() => void action("open-main")}
          >
            <Maximize2 aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            aria-label={tr("隐藏小窗口")}
            title={tr("隐藏小窗口")}
            disabled={actionBusy || transitionLocked}
            onClick={() => void action("hide")}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      </header>

      {current === null && initialStatus === "loading" ? (
        <div className="quick-chat__loading" role="status">
          <LoaderCircle className="spin" aria-hidden="true" size={18} />
          <span>{tr("正在恢复对话…")}</span>
        </div>
      ) : current === null && initialStatus === "error" ? (
        <div className="quick-chat__unavailable" role="alert">
          <BrandMark size={40} />
          <h1>{tr("无法载入快捷对话")}</h1>
          <p>{runtimeText(error ?? tr("无法读取快捷对话状态。"))}</p>
          <div className="quick-chat__recovery-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setInitialStatus("loading");
                setInitialRetry((currentRetry) => currentRetry + 1);
              }}
            >
              {tr("重试")}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={actionBusy || transitionLocked}
              onClick={() => void action("configure")}
            >
              {tr("打开模型设置")}
            </button>
          </div>
        </div>
      ) : current === null ? (
        <div className="quick-chat__loading" role="status">
          <LoaderCircle className="spin" aria-hidden="true" size={18} />
          <span>{tr("正在恢复对话…")}</span>
        </div>
      ) : session?.archived ? (
        <ArchivedDraft
          sessionId={session.id}
          interactionLocked={actionBusy || transitionLocked}
          onModePreparationChange={onModePreparationChange}
        />
      ) : !session && (!available || current.error) ? (
        <div className="quick-chat__unavailable">
          <BrandMark size={40} />
          <h1>{tr("尚未配置可用模型")}</h1>
          <p>{runtimeText(current.error ?? tr("添加供应商和模型后即可开始对话。"))}</p>
          <button
            type="button"
            className="btn btn--primary"
            disabled={actionBusy || transitionLocked}
            onClick={() => void action("configure")}
          >
            {tr("打开模型设置")}
          </button>
        </div>
      ) : (
        <div className="quick-chat__surface" data-testid="quick-chat-surface">
          <ChatView
            compact
            interactionLocked={actionBusy || transitionLocked}
            agentMode="chat"
            session={session}
            providers={providers}
            agentProfiles={[]}
            extensions={[]}
            selectedExtensionIds={[]}
            messages={messages}
            live={live}
            allLive={live && session ? { [session.id]: live } : {}}
            runState={runState}
            usage={null}
            context={context}
            sessions={session ? [session] : []}
            allActivities={session ? { [session.id]: activities } : {}}
            activities={activities}
            approval={null}
            question={null}
            onNewSession={() => void action("new")}
            onSelectSession={() => undefined}
            onSend={send}
            onRewriteMessage={rewrite}
            onModePreparationChange={onModePreparationChange}
            onStop={stop}
            onFork={() => action("new").then(() => undefined)}
            onCompact={compact}
            onPatch={patchSession}
            onToggleExtension={async () => undefined}
            onImportExtensions={async () => null}
            onOpenSettings={() => void action("configure")}
            onOpenWorkspace={() => undefined}
            onOpenFile={() => undefined}
            onSyncPending={syncPending}
            onApprovalDecision={ignoreApprovalDecision}
            onQuestionAnswer={ignoreQuestionAnswer}
          />
        </div>
      )}
      {current !== null && error && !current.error ? (
        <div className="quick-chat__error" role="alert">
          {runtimeText(error)}
        </div>
      ) : null}
    </div>
  );
}
