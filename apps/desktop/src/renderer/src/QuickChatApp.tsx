import { LoaderCircle, Maximize2, Pin, PinOff, SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

export function QuickChatApp() {
  useLocale();
  const [snapshot, setSnapshot] = useState<QuickChatState | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [runState, setRunState] = useState<SessionRunState | null>(null);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [context, setContext] = useState<QuickChatState["context"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [initialStatus, setInitialStatus] = useState<"loading" | "ready" | "error">("loading");
  const [initialRetry, setInitialRetry] = useState(0);
  const currentSessionId = useRef<string | null>(null);
  const snapshotGeneration = useRef(0);
  const actionSequence = useRef(0);

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

  const applySnapshot = useCallback((next: QuickChatState, focus = false) => {
    snapshotGeneration.current += 1;
    const changed = currentSessionId.current !== (next.session?.id ?? null);
    currentSessionId.current = next.session?.id ?? null;
    setSnapshot(next);
    setMessages(next.messages);
    setRunState(next.runState);
    setContext(next.context);
    setError(next.error);
    setInitialStatus("ready");
    if (changed) {
      setLive(null);
      setActivities([]);
    }
    if (focus) focusComposer();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: initialRetry explicitly restarts startup loading.
  useEffect(() => {
    let active = true;
    setInitialStatus("loading");
    setError(null);
    const requestGeneration = snapshotGeneration.current;
    const unsubscribe = window.mingshen.onQuickChatState((next) => {
      if (!active) return;
      applySnapshot(next, true);
    });
    void window.mingshen
      .getQuickChatState()
      .then((next) => {
        if (!active || snapshotGeneration.current !== requestGeneration) return;
        applySnapshot(next, true);
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
        case "session_updated":
          setSnapshot((current) =>
            currentSessionId.current === sessionId && current
              ? { ...current, session: event.session }
              : current,
          );
          return;
        case "session_removed":
          currentSessionId.current = null;
          setSnapshot((current) =>
            current ? { ...current, session: null, messages: [] } : current,
          );
          setMessages([]);
          setLive(null);
          setRunState(null);
          return;
        case "run_started": {
          setError(null);
          setSnapshot((current) =>
            currentSessionId.current === sessionId && current?.session
              ? { ...current, session: { ...current.session, status: "running" } }
              : current,
          );
          setRunState(runningState(sessionId, event.runId));
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
              currentSessionId.current === sessionId && current
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
          setRunState((current) =>
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
          setLive(null);
          return;
        case "conversation_rewound":
          setSnapshot((current) =>
            currentSessionId.current === sessionId && current
              ? { ...current, session: event.session }
              : current,
          );
          setRunState(null);
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
  }, []);

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
      void window.mingshen.quickChatAction("hide").catch(() => undefined);
    };
    window.addEventListener("keydown", hide);
    return () => window.removeEventListener("keydown", hide);
  }, []);

  const action = useCallback(
    async (name: QuickChatAction) => {
      if (actionBusy) return;
      const request = ++actionSequence.current;
      const generation = snapshotGeneration.current;
      setActionBusy(true);
      setError(null);
      try {
        const next = await window.mingshen.quickChatAction(name);
        if (next && request === actionSequence.current && generation === snapshotGeneration.current)
          applySnapshot(next, name === "show" || name === "new");
      } catch (cause) {
        if (request === actionSequence.current && generation === snapshotGeneration.current)
          setError(errorText(cause));
      } finally {
        if (request === actionSequence.current) setActionBusy(false);
      }
    },
    [actionBusy, applySnapshot],
  );

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
      if (!session) throw new Error(tr("当前对话不可用。"));
      setError(null);
      const result = await window.mingshen.sendChat({
        sessionId: session.id,
        text,
        attachments,
        draftRevision,
      });
      if (currentSessionId.current !== session.id) return;
      setSnapshot((current) =>
        currentSessionId.current === session.id && current?.session
          ? { ...current, session: { ...current.session, status: "running" } }
          : current,
      );
      if (currentSessionId.current === session.id)
        setRunState(runningState(session.id, result.runId));
    },
    [session],
  );

  const rewrite = useCallback(
    async (messageId: string, text: string) => {
      if (!session) throw new Error(tr("当前对话不可用。"));
      setError(null);
      const result = await window.mingshen.rewriteAndSendChat({
        sessionId: session.id,
        messageId,
        text,
      });
      if (currentSessionId.current !== session.id) return;
      setSnapshot((current) =>
        currentSessionId.current === session.id && current?.session
          ? { ...current, session: { ...current.session, status: "running" } }
          : current,
      );
      if (currentSessionId.current === session.id)
        setRunState(runningState(session.id, result.runId));
    },
    [session],
  );

  const stop = useCallback(async () => {
    if (!session) return;
    const sessionId = session.id;
    await window.mingshen.stopChat(sessionId);
    if (currentSessionId.current !== sessionId) return;
    setLive(null);
    setSnapshot((current) =>
      currentSessionId.current === sessionId && current?.session
        ? { ...current, session: { ...current.session, status: "interrupted" } }
        : current,
    );
    setRunState((current) =>
      currentSessionId.current === sessionId && current
        ? { ...current, completedAt: new Date().toISOString(), status: "interrupted" }
        : current,
    );
  }, [session]);

  const compact = useCallback(async (sessionId: string) => {
    const result = await window.mingshen.compactChat(sessionId);
    if (currentSessionId.current !== sessionId) return result;
    setSnapshot((current) =>
      currentSessionId.current === sessionId && current?.session
        ? { ...current, session: { ...current.session, status: "running" } }
        : current,
    );
    if (currentSessionId.current === sessionId) setRunState(runningState(sessionId, result.runId));
    return result;
  }, []);

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
            disabled={actionBusy}
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
            disabled={actionBusy}
            onClick={() => void action("new")}
          >
            <SquarePen aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            aria-label={tr("打开主界面")}
            title={tr("打开主界面")}
            disabled={actionBusy}
            onClick={() => void action("open-main")}
          >
            <Maximize2 aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            aria-label={tr("隐藏小窗口")}
            title={tr("隐藏小窗口")}
            disabled={actionBusy}
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
              disabled={actionBusy}
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
      ) : !session && (!available || current.error) ? (
        <div className="quick-chat__unavailable">
          <BrandMark size={40} />
          <h1>{tr("尚未配置可用模型")}</h1>
          <p>{runtimeText(current.error ?? tr("添加供应商和模型后即可开始对话。"))}</p>
          <button
            type="button"
            className="btn btn--primary"
            disabled={actionBusy}
            onClick={() => void action("configure")}
          >
            {tr("打开模型设置")}
          </button>
        </div>
      ) : (
        <div className="quick-chat__surface" data-testid="quick-chat-surface">
          <ChatView
            compact
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
            onModePreparationChange={() => undefined}
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
