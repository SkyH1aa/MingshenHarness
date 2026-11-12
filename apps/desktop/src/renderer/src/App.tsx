import {
  Code2,
  FileDiff,
  Files,
  Folder,
  LoaderCircle,
  MessagesSquare,
  Moon,
  Network,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Settings,
  ShieldCheck,
  Sun,
  Terminal,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CompletionNotificationState } from "../../shared/desktop";
import type {
  ActivityEvent,
  AgentProfileView,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalState,
  BootstrapData,
  ChatAttachmentInput,
  ChatStreamEvent,
  ContextUsageView,
  ExtensionImportResult,
  ExtensionView,
  McpServerView,
  ProviderView,
  QuestionRequest,
  QuestionState,
  ScheduledTaskView,
  SessionMessage,
  SessionRunState,
  SessionUpdateInput,
  SessionView,
} from "../../shared/domain";
import { APP_VERSION } from "../../shared/release";
import type { WorkbenchLayout } from "../../shared/ui-preferences";
import { AgentGuide } from "./components/AgentGuide";
import { BrandMark } from "./components/BrandMark";
import { ChatView } from "./components/ChatView";
import { useDialog } from "./components/DialogProvider";
import { LayoutPicker } from "./components/LayoutPicker";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { PanelResizeHandle } from "./components/PanelResizeHandle";
import { ProviderSetup } from "./components/ProviderSetup";
import { SessionSidebar } from "./components/SessionSidebar";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { TaskWorkbench, type TaskWorkbenchViewRequest } from "./components/TaskWorkbench";
import { useProjectLayout } from "./components/UiPreferences";
import {
  type WorkspaceFileRequest,
  WorkspacePanel,
  type WorkspaceTabRequest,
} from "./components/WorkspacePanel";
import { useLocale } from "./i18n";
import { tr } from "./i18n/index";
import { runtimeText } from "./i18n/runtime";
import {
  approvalsFromSnapshot,
  newerPendingState,
  questionsFromSnapshot,
} from "./lib/approval-state";
import type { LiveRun, SessionUsage } from "./lib/chat-types";
import { composerDrafts } from "./lib/use-composer-draft";

type Theme = "day" | "night";
interface BrowserRequest {
  sessionId: string;
  provider: "chrome" | "edge";
  url: string;
  requestKey: number;
}

function readTheme(): Theme {
  return localStorage.getItem("mingshen.theme") === "day" ? "day" : "night";
}

function appendUnique(current: SessionMessage[], message: SessionMessage): SessionMessage[] {
  if (current.some((item) => item.id === message.id)) {
    return current;
  }
  return [...current, message].sort((a, b) => a.seq - b.seq);
}

function errorMessage(error: unknown): string {
  return runtimeText(error instanceof Error ? error.message : String(error));
}

export function App() {
  const locale = useLocale();
  const { confirm } = useDialog();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    const observer = new ResizeObserver(resize);
    observer.observe(document.documentElement);
    resize();
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      observer.disconnect();
    };
  }, []);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [sessionGroups, setSessionGroups] = useState<
    import("../../shared/session-catalog").SessionWorkspaceGroup[]
  >([]);
  const sessionRevision = useRef(0);
  const sessionsRef = useRef<SessionView[]>([]);
  sessionsRef.current = sessions;
  const mergeSessions = useCallback(
    (items: SessionView[]) =>
      setSessions((current) => {
        const next = new Map(current.map((item) => [item.id, item]));
        for (const item of items) next.set(item.id, item);
        return [...next.values()];
      }),
    [],
  );
  const [agentProfiles, setAgentProfiles] = useState<AgentProfileView[]>([]);
  const [extensions, setExtensions] = useState<ExtensionView[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskView[]>([]);
  const [sessionExtensionsBySession, setSessionExtensionsBySession] = useState<
    Record<string, string[]>
  >({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [completionNotifications, setCompletionNotifications] =
    useState<CompletionNotificationState | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [liveBySession, setLiveBySession] = useState<Record<string, LiveRun>>({});
  const [runsBySession, setRunsBySession] = useState<Record<string, SessionRunState>>({});
  const [activitiesBySession, setActivitiesBySession] = useState<Record<string, ActivityEvent[]>>(
    {},
  );
  const [usageBySession, setUsageBySession] = useState<Record<string, SessionUsage>>({});
  const [contextsBySession, setContextsBySession] = useState<Record<string, ContextUsageView>>({});
  const [approvalsBySession, setApprovalsBySession] = useState<Record<string, ApprovalRequest>>({});
  const [questionsBySession, setQuestionsBySession] = useState<Record<string, QuestionRequest>>({});
  const [search, setSearch] = useState("");
  const currentWorkspace =
    sessions.find((session) => session.id === selectedSessionId)?.workspacePath ?? null;
  const {
    layout,
    activeStyle,
    setLayout,
    error: layoutError,
    retry: retryLayout,
  } = useProjectLayout(currentWorkspace);
  const optical = activeStyle === "orbit";
  const sidebarOpen = layout.sidebarOpen;
  const setSidebarOpen = (value: boolean | ((previous: boolean) => boolean)) => {
    const open = typeof value === "function" ? value(sidebarOpen) : value;
    setLayout({ sidebarOpen: open, ...(open && sidebarDrawer ? { inspectorOpen: false } : {}) });
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sessionManagementBusyRef = useRef(false);
  const onSessionManagementBusyChange = useCallback((busy: boolean) => {
    sessionManagementBusyRef.current = busy;
  }, []);
  const [settingsSection, setSettingsSection] = useState<
    "appearance" | "permissions" | "context" | "extensions" | "mcp" | "project"
  >("appearance");
  const workspaceOpen = layout.inspectorOpen;
  const shellWidth = optical ? 56 + 40 + 36 : 12;
  const inspectorDrawer =
    viewportWidth <
    480 + (sidebarOpen ? layout.sidebarWidth : 0) + layout.inspectorWidth + shellWidth;
  const sidebarDrawer = viewportWidth < 480 + layout.sidebarWidth + (optical ? 104 : 6);
  const layoutRef = useRef({ layout, setLayout, sidebarDrawer });
  layoutRef.current = { layout, setLayout, sidebarDrawer };
  const setWorkspaceOpen = useCallback((value: boolean | ((previous: boolean) => boolean)) => {
    const current = layoutRef.current;
    const open = typeof value === "function" ? value(current.layout.inspectorOpen) : value;
    current.setLayout({
      inspectorOpen: open,
      ...(open && current.sidebarDrawer ? { sidebarOpen: false } : {}),
    });
  }, []);
  const [browserRequest, setBrowserRequest] = useState<BrowserRequest | null>(null);
  const [fileRequest, setFileRequest] = useState<WorkspaceFileRequest | null>(null);
  const [workspaceTabRequest, setWorkspaceTabRequest] = useState<WorkspaceTabRequest | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] =
    useState<WorkspaceTabRequest["tab"]>("review");
  const [taskViewRequest, setTaskViewRequest] = useState<TaskWorkbenchViewRequest | null>(null);
  useEffect(() => {
    setTaskViewRequest((current) => (current?.sessionId === selectedSessionId ? current : null));
  }, [selectedSessionId]);
  const [inspectorView, setInspectorView] = useState<"tasks" | "workspace">("tasks");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newSessionWorkspace, setNewSessionWorkspace] = useState<string | null>(null);
  const [creatingWorkspaceSession, setCreatingWorkspaceSession] = useState(false);
  const [workspaceSessionError, setWorkspaceSessionError] = useState("");
  const creatingWorkspaceSessionRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const selectedSessionRef = useRef<string | null>(null);
  const restoredNotificationDraftRef = useRef<string | null>(null);
  const approvalSnapshotRef = useRef<ApprovalState>({ revision: -1, requests: [] });
  const questionSnapshotRef = useRef<QuestionState>({ revision: -1, requests: [] });
  const receiveApprovals = useCallback((state: ApprovalState) => {
    const next = newerPendingState(approvalSnapshotRef.current, state);
    if (next === approvalSnapshotRef.current) return;
    approvalSnapshotRef.current = next;
    setApprovalsBySession(approvalsFromSnapshot(state));
  }, []);
  const receiveQuestions = useCallback((state: QuestionState) => {
    const next = newerPendingState(questionSnapshotRef.current, state);
    if (next === questionSnapshotRef.current) return;
    questionSnapshotRef.current = next;
    setQuestionsBySession(questionsFromSnapshot(state));
  }, []);
  const syncPendingRequests = useCallback(async () => {
    await Promise.all([
      window.mingshen.getApprovalState().then(receiveApprovals),
      window.mingshen.getQuestionState().then(receiveQuestions),
    ]);
  }, [receiveApprovals, receiveQuestions]);
  const selectedSessionExists = Boolean(
    selectedSessionId && sessions.some((session) => session.id === selectedSessionId),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mingshen.theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("mingshen.sidebar", sidebarOpen ? "open" : "closed");
  }, [sidebarOpen]);

  useEffect(() => {
    selectedSessionRef.current = selectedSessionId;
    void window.mingshen.setActiveNotificationSession(selectedSessionId).catch(() => undefined);
    void window.mingshen.markSessionOpened(selectedSessionId).catch(() => undefined);
  }, [selectedSessionId]);
  useEffect(() => {
    let cancelled = false;
    const receive = (state: CompletionNotificationState) => {
      if (cancelled) return;
      setCompletionNotifications(state);
      if (state.replyDraft && restoredNotificationDraftRef.current !== state.replyDraft.id) {
        restoredNotificationDraftRef.current = state.replyDraft.id;
        setSelectedSessionId(state.replyDraft.sessionId);
      }
    };
    const unsubscribe = window.mingshen.onCompletionNotifications(receive);
    void window.mingshen
      .getCompletionNotifications()
      .then(receive)
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  useEffect(
    () =>
      window.mingshen.onDesktopEvent((event) => {
        if (
          (event.type === "select-session" || event.type === "notification-reply-failed") &&
          event.sessionId
        )
          setSelectedSessionId(event.sessionId);
      }),
    [],
  );

  const refreshAll = useCallback(async (): Promise<BootstrapData> => {
    const priorRevision = sessionRevision.current;
    const loadedIds = sessionsRef.current.map((item) => item.id);
    const data = await window.mingshen.bootstrap({
      paged: true,
      selectedId: selectedSessionRef.current,
    });
    setProviders(data.providers);
    mergeSessions(data.sessions);
    if (data.sessionCatalog) {
      if (loadedIds.length && priorRevision >= 0) {
        const delta = await window.mingshen.getSessionDelta(priorRevision, loadedIds);
        if (delta.reset) setSessions(data.sessions);
        else {
          mergeSessions(delta.sessions);
          setSessions((items) => items.filter((item) => !delta.removed.includes(item.id)));
        }
        sessionRevision.current = delta.revision;
      } else sessionRevision.current = data.sessionCatalog.revision;
      setSessionGroups(data.sessionCatalog.groups);
    }
    setAgentProfiles(data.agentProfiles);
    setExtensions(data.extensions);
    setMcpServers(data.mcpServers);
    setScheduledTasks(data.scheduledTasks);
    setContextsBySession((current) => {
      const next = { ...current };
      for (const state of data.contextStates)
        if (
          !next[state.sessionId] ||
          Date.parse(state.updatedAt) >= Date.parse(next[state.sessionId]?.updatedAt ?? "")
        )
          next[state.sessionId] = state;
      return next;
    });
    receiveApprovals(data.approvalState);
    receiveQuestions(data.questionState);
    setRunsBySession((current) => {
      const ids = new Set([...loadedIds, ...data.sessions.map((session) => session.id)]);
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)));
      for (const run of data.sessionRuns) {
        const previous = next[run.sessionId];
        if (
          previous?.runId === run.runId &&
          previous.status !== "running" &&
          run.status === "running"
        )
          continue;
        if (!previous || Date.parse(run.startedAt) >= Date.parse(previous.startedAt))
          next[run.sessionId] = run;
      }
      return next;
    });
    return data;
  }, [receiveApprovals, receiveQuestions, mergeSessions]);

  useEffect(() => {
    const sync = async () => {
      try {
        const delta = await window.mingshen.getSessionDelta(
          sessionRevision.current,
          sessionsRef.current.map((item) => item.id),
        );
        if (delta.reset) {
          setSessions([]);
          await refreshAll();
          return;
        }
        if (delta.revision !== sessionRevision.current) {
          sessionRevision.current = delta.revision;
          mergeSessions(delta.sessions);
          setSessions((items) => items.filter((item) => !delta.removed.includes(item.id)));
          setSessionGroups(await window.mingshen.listSessionGroups());
        }
      } catch {
        /* Focus refresh remains available when synchronization fails. */
      }
    };
    const timer = setInterval(() => void sync(), 3000);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", sync);
    };
  }, [refreshAll, mergeSessions]);
  useEffect(() => {
    let alive = true;
    if (selectedSessionId && !selectedSessionExists)
      void window.mingshen
        .getSession(selectedSessionId)
        .then(async (item) => {
          if (!alive) return;
          if (item && !item.archived) {
            const rows = [item];
            const seen = new Set([item.id]);
            let parentId = item.parentSessionId;
            while (parentId && !seen.has(parentId)) {
              seen.add(parentId);
              const parent = await window.mingshen.getSession(parentId);
              if (!parent || parent.archived) break;
              rows.push(parent);
              parentId = parent.parentSessionId;
            }
            if (alive) mergeSessions(rows);
          } else setSelectedSessionId(null);
        })
        .catch((error) => {
          if (alive) setBootError(errorMessage(error));
        });
    return () => {
      alive = false;
    };
  }, [selectedSessionId, selectedSessionExists, mergeSessions]);
  useEffect(() => {
    if (!settingsOpen) return;
    let alive = true;
    void (async () => {
      let cursor: string | null = null;
      do {
        const page = await window.mingshen.listSessionPage({
          archived: true,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        if (!alive) return;
        mergeSessions(page.sessions);
        cursor = page.nextCursor;
      } while (cursor);
    })().catch((error) => {
      if (alive) setBootError(errorMessage(error));
    });
    return () => {
      alive = false;
    };
  }, [settingsOpen, mergeSessions]);

  useEffect(() => {
    const sync = () => void syncPendingRequests().catch(() => undefined);
    window.addEventListener("focus", sync);
    const timer = window.setInterval(sync, 3000);
    return () => {
      window.removeEventListener("focus", sync);
      window.clearInterval(timer);
    };
  }, [syncPendingRequests]);

  useEffect(() => {
    if (selectedSessionId) void syncPendingRequests().catch(() => undefined);
  }, [selectedSessionId, syncPendingRequests]);

  useEffect(() => {
    let cancelled = false;
    void refreshAll()
      .catch((error: unknown) => {
        if (!cancelled) {
          setBootError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshAll]);

  useEffect(() => {
    if (sessions.length === 0) {
      return;
    }
    const currentExists = sessions.some(
      (session) => session.id === selectedSessionId && !session.archived,
    );
    if (
      !selectedSessionId ||
      (!currentExists && sessions.some((item) => item.id === selectedSessionId && item.archived))
    ) {
      setSelectedSessionId(sessions.find((session) => !session.archived)?.id ?? null);
    }
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedSessionId || !selectedSessionExists) {
      setMessages([]);
      return;
    }

    void Promise.all([
      window.mingshen.getSessionMessages(selectedSessionId),
      window.mingshen.listSessionExtensions(selectedSessionId),
      window.mingshen.getContextUsage(selectedSessionId),
    ])
      .then(([loaded, extensionIds, context]) => {
        if (!cancelled) {
          setMessages(loaded);
          setBootError(null);
          if (context)
            setContextsBySession((current) => {
              const existing = current[context.sessionId];
              return !existing || Date.parse(context.updatedAt) >= Date.parse(existing.updatedAt)
                ? { ...current, [context.sessionId]: context }
                : current;
            });
          setSessionExtensionsBySession((current) => ({
            ...current,
            [selectedSessionId]: extensionIds,
          }));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = errorMessage(error);
        if (message.includes("会话不存在")) {
          void refreshAll().then((data) => {
            if (!cancelled) {
              setSelectedSessionId(data.sessions.find((session) => !session.archived)?.id ?? null);
              setMessages([]);
              setBootError(null);
            }
          });
          return;
        }
        setBootError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshAll, selectedSessionExists, selectedSessionId]);

  useEffect(() => {
    const unsubscribe = window.mingshen.onRuntimeEvent((event: ChatStreamEvent) => {
      if (event.type === "composer_draft_consumed") {
        void composerDrafts.accepted(event.sessionId, event.revision).catch(() => undefined);
        return;
      }
      if (event.type === "context_updated") {
        setContextsBySession((current) => ({
          ...current,
          [event.context.sessionId]: event.context,
        }));
        return;
      }
      if (event.type === "session_updated") {
        setSessions((current) =>
          current.some((session) => session.id === event.session.id)
            ? current.map((session) => (session.id === event.session.id ? event.session : session))
            : [event.session, ...current],
        );
        return;
      }

      if (event.type === "session_removed") {
        composerDrafts.forget([event.sessionId]);
        setSelectedSessionId((current) => (current === event.sessionId ? null : current));
        setContextsBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setSessions((current) => current.filter((session) => session.id !== event.sessionId));
        setRunsBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setActivitiesBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        return;
      }

      if (event.type === "usage") {
        setUsageBySession((current) => ({
          ...current,
          [event.sessionId]: {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            totalTokens: event.totalTokens,
          },
        }));
        return;
      }

      if (event.type === "run_started") {
        setRunsBySession((current) => ({
          ...current,
          [event.sessionId]: {
            sessionId: event.sessionId,
            runId: event.runId,
            startedAt: new Date().toISOString(),
            completedAt: null,
            status: "running",
          },
        }));
        setActivitiesBySession((current) => ({
          ...current,
          [event.sessionId]: [],
        }));
        if (event.kind === "compaction") return;
        setLiveBySession((current) => ({
          ...current,
          [event.sessionId]: {
            runId: event.runId,
            text: "",
            reasoning: "",
            startedAt: Date.now(),
          },
        }));
        return;
      }

      if (event.type === "activity") {
        setActivitiesBySession((current) => {
          const existing = current[event.activity.sessionId] ?? [];
          const index = existing.findIndex((activity) => activity.id === event.activity.id);
          const next =
            index === -1
              ? [...existing, event.activity]
              : existing.map((activity) =>
                  activity.id === event.activity.id ? event.activity : activity,
                );
          return { ...current, [event.activity.sessionId]: next };
        });
        return;
      }

      if (event.type === "conversation_rewound") {
        setContextsBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setSessions((current) =>
          current.map((session) => (session.id === event.session.id ? event.session : session)),
        );
        if (event.sessionId === selectedSessionRef.current)
          setMessages((current) => current.filter((message) => message.seq < event.fromSeq));
        setRunsBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setLiveBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setActivitiesBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        void syncPendingRequests().catch(() => undefined);
        return;
      }

      if (event.type === "browser_open_requested") {
        setBrowserRequest({
          sessionId: event.sessionId,
          provider: event.provider,
          url: event.url,
          requestKey: Date.now(),
        });
        setInspectorView("workspace");
        if (!sessionManagementBusyRef.current) setSettingsOpen(false);
        setWorkspaceOpen(true);
        return;
      }

      if (event.type === "approval_required") {
        void syncPendingRequests().catch(() => undefined);
        return;
      }

      if (event.type === "approval_state") {
        receiveApprovals(event.state);
        return;
      }

      if (event.type === "question_resolved") {
        void syncPendingRequests().catch(() => undefined);
        return;
      }

      if (event.type === "question_state") {
        receiveQuestions(event.state);
        return;
      }

      if (event.type === "question_required") {
        void syncPendingRequests().catch(() => undefined);
        return;
      }

      if (event.type === "user_message" || event.type === "assistant_message") {
        if (event.sessionId === selectedSessionRef.current) {
          setMessages((current) => appendUnique(current, event.message));
        }
        if (event.type === "assistant_message") {
          setLiveBySession((current) => {
            const previous = current[event.sessionId];
            return previous
              ? { ...current, [event.sessionId]: { ...previous, text: "", reasoning: "" } }
              : current;
          });
        }
        return;
      }

      if (event.type === "model_attempt_reset") {
        setLiveBySession((current) => {
          const previous = current[event.sessionId];
          return previous?.runId === event.runId
            ? { ...current, [event.sessionId]: { ...previous, text: "", reasoning: "" } }
            : current;
        });
        return;
      }

      if (event.type === "assistant_delta" || event.type === "reasoning_delta") {
        setLiveBySession((current) => {
          const previous = current[event.sessionId] ?? {
            runId: event.runId,
            text: "",
            reasoning: "",
            startedAt: Date.now(),
          };
          return {
            ...current,
            [event.sessionId]: {
              ...previous,
              text: event.type === "assistant_delta" ? previous.text + event.text : previous.text,
              reasoning:
                event.type === "reasoning_delta"
                  ? previous.reasoning + event.text
                  : previous.reasoning,
            },
          };
        });
        return;
      }

      if (
        event.type === "run_interrupted" ||
        event.type === "run_completed" ||
        event.type === "run_failed"
      ) {
        setRunsBySession((current) => {
          const previous = current[event.sessionId];
          return previous
            ? {
                ...current,
                [event.sessionId]: {
                  ...previous,
                  completedAt: new Date().toISOString(),
                  status:
                    event.type === "run_completed"
                      ? "completed"
                      : event.type === "run_failed"
                        ? "failed"
                        : "interrupted",
                },
              }
            : current;
        });
        setLiveBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        void syncPendingRequests().catch(() => undefined);
      }
    });

    return unsubscribe;
  }, [receiveApprovals, receiveQuestions, syncPendingRequests, setWorkspaceOpen]);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const visualRunState =
    selectedSessionId && questionsBySession[selectedSessionId]
      ? "question"
      : selectedSession?.status === "waiting_approval"
        ? "approval"
        : selectedSession?.status === "running"
          ? "running"
          : "idle";
  const visualRunLabel =
    visualRunState === "question"
      ? tr("等待回答")
      : visualRunState === "approval"
        ? tr("等待批准")
        : visualRunState === "running"
          ? tr("运行中")
          : tr("就绪");
  const selectedProvider = providers.find(
    (provider) => provider.id === selectedSession?.providerId,
  );
  const canEnterWorkspace = providers.some((provider) => provider.models.length > 0);
  const connectionCount = providers.filter((provider) => provider.keys.length > 0).length;

  useEffect(() => {
    if (browserRequest && browserRequest.sessionId !== selectedSessionId) {
      setBrowserRequest(null);
    }
    setFileRequest(null);
  }, [browserRequest, selectedSessionId]);

  const createSessionFromDialog = (session: SessionView) => {
    setSessions((current) => [session, ...current]);
    setSelectedSessionId(session.id);
    setMessages([]);
    setNewSessionOpen(false);
    setNewSessionWorkspace(null);
  };

  const openNewSession = (workspacePath: string | null) => {
    setNewSessionWorkspace(workspacePath);
    setNewSessionOpen(true);
  };

  const createWorkspaceSession = async (workspacePath: string | null) => {
    if (creatingWorkspaceSessionRef.current) return;
    creatingWorkspaceSessionRef.current = true;
    setCreatingWorkspaceSession(true);
    setWorkspaceSessionError("");
    try {
      const session = await window.mingshen.createSessionInWorkspace(workspacePath);
      setSearch("");
      createSessionFromDialog(session);
    } catch (error) {
      setWorkspaceSessionError(errorMessage(error));
    } finally {
      creatingWorkspaceSessionRef.current = false;
      setCreatingWorkspaceSession(false);
    }
  };

  const patchSession = async (input: SessionUpdateInput): Promise<SessionView> => {
    const updated = await window.mingshen.updateSession(input);
    setSessions((current) =>
      current.map((session) => (session.id === updated.id ? updated : session)),
    );
    if (input.archived !== undefined) await refreshAll();
    return updated;
  };

  const sendMessage = async (
    text: string,
    attachments: ChatAttachmentInput[],
    draftRevision: string,
  ) => {
    if (!selectedSessionId) {
      throw new Error(tr("\u8BF7\u5148\u9009\u62E9\u4F1A\u8BDD\u3002"));
    }
    await window.mingshen.sendChat({
      sessionId: selectedSessionId,
      text,
      attachments,
      draftRevision,
    });
  };

  const forkSession = async (sessionId: string) => {
    const forked = await window.mingshen.forkSession(sessionId);
    await refreshAll();
    setSearch("");
    setSelectedSessionId(forked.id);
  };

  const stopRun = async () => {
    if (selectedSessionId) {
      await window.mingshen.stopChat(selectedSessionId);
    }
  };

  const rewriteMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!selectedSessionId) {
        throw new Error(tr("\u8BF7\u5148\u9009\u62E9\u4F1A\u8BDD\u3002"));
      }
      await window.mingshen.rewriteAndSendChat({
        sessionId: selectedSessionId,
        messageId,
        text,
      });
    },
    [selectedSessionId],
  );

  const openWorkspaceFromConversation = useCallback(() => {
    setInspectorView("workspace");
    setWorkspaceOpen(true);
  }, [setWorkspaceOpen]);
  const openFileFromConversation = useCallback(
    (path: string) => {
      setInspectorView("workspace");
      setFileRequest({ path, requestKey: Date.now() });
      setWorkspaceOpen(true);
    },
    [setWorkspaceOpen],
  );

  const changeLayout = (mode: WorkbenchLayout) => {
    setInspectorView(mode === "agents" ? "tasks" : "workspace");
    setLayout({
      mode,
      inspectorOpen: optical || mode !== "chat",
      ...((optical || mode !== "chat") && sidebarDrawer ? { sidebarOpen: false } : {}),
    });
    if (optical && mode === "agents") {
      setTaskViewRequest((current) => ({
        sessionId: selectedSessionId,
        tab: "agents",
        requestKey: (current?.requestKey ?? 0) + 1,
      }));
    }
  };
  const openWorkspaceTab = (tab: WorkspaceTabRequest["tab"]) => {
    setWorkspaceTabRequest((current) => ({
      tab,
      requestKey: (current?.requestKey ?? 0) + 1,
    }));
    setInspectorView("workspace");
    setLayout({
      mode: "code",
      inspectorOpen: true,
      ...(sidebarDrawer ? { sidebarOpen: false } : {}),
    });
  };
  const workspaceName =
    currentWorkspace?.split(/[\\/]/).filter(Boolean).at(-1) ??
    (locale === "en" ? "No workspace" : "未选择工作目录");

  const toggleSessionExtension = async (extensionId: string, enabled: boolean) => {
    if (!selectedSessionId) {
      throw new Error(tr("\u8BF7\u5148\u9009\u62E9\u4F1A\u8BDD\u3002"));
    }
    await window.mingshen.setSessionExtension(selectedSessionId, extensionId, enabled);
    setSessionExtensionsBySession((current) => {
      const existing = new Set(current[selectedSessionId] ?? []);
      if (enabled) {
        existing.add(extensionId);
      } else {
        existing.delete(extensionId);
      }
      return { ...current, [selectedSessionId]: [...existing] };
    });
  };

  const importExtensions = async (): Promise<ExtensionImportResult | null> => {
    const directory = await window.mingshen.chooseExtensionDirectory();
    if (!directory) {
      return null;
    }
    const result = await window.mingshen.importExtensions(directory);
    await refreshAll();
    return result;
  };

  if (loading) {
    return (
      <div className="app-loading">
        <LoaderCircle className="spin" aria-hidden="true" size={20} />
        <span>{tr("\u6B63\u5728\u52A0\u8F7D\u672C\u5730\u6570\u636E")}</span>
      </div>
    );
  }

  if (bootError && providers.length === 0) {
    return (
      <div className="app-loading app-loading--error">
        <h1>{tr("\u65E0\u6CD5\u542F\u52A8\u5DE5\u4F5C\u533A")}</h1>
        <p>{bootError}</p>
        <button
          className="btn btn--secondary"
          type="button"
          onClick={() => window.location.reload()}
        >
          {tr("\u91CD\u65B0\u52A0\u8F7D")}
        </button>
      </div>
    );
  }

  if (!canEnterWorkspace) {
    return (
      <div className="setup-shell">
        <header className="setup-topbar">
          <Brand />
          <button
            className="icon-button"
            type="button"
            aria-label={
              theme === "day"
                ? tr("\u5207\u6362\u5230\u591C\u95F4\u4E3B\u9898")
                : tr("\u5207\u6362\u5230\u65E5\u95F4\u4E3B\u9898")
            }
            title={
              theme === "day"
                ? tr("\u5207\u6362\u5230\u591C\u95F4\u4E3B\u9898")
                : tr("\u5207\u6362\u5230\u65E5\u95F4\u4E3B\u9898")
            }
            onClick={() => setTheme(theme === "day" ? "night" : "day")}
          >
            {theme === "day" ? (
              <Moon aria-hidden="true" size={17} />
            ) : (
              <Sun aria-hidden="true" size={17} />
            )}
          </button>
        </header>
        <main className="setup-content">
          <ProviderSetup
            providers={providers}
            onChanged={async () => {
              await refreshAll();
            }}
          />
          <AgentGuide profiles={agentProfiles} />
        </main>
      </div>
    );
  }

  return (
    <>
      <div
        className={`app-shell${optical ? " app-shell--orbit" : ""}`}
        data-layout={layout.mode}
        data-run-state={visualRunState}
      >
        {createPortal(
          <header
            className={`app-topbar${optical ? " app-topbar--orbit" : ""}`}
            data-run-state={visualRunState}
          >
            {!optical ? (
              <button
                className="icon-button sidebar-toggle"
                type="button"
                aria-label={
                  sidebarOpen
                    ? tr("\u6536\u8D77\u4F1A\u8BDD\u680F")
                    : tr("\u5C55\u5F00\u4F1A\u8BDD\u680F")
                }
                title={
                  sidebarOpen
                    ? tr("\u6536\u8D77\u4F1A\u8BDD\u680F")
                    : tr("\u5C55\u5F00\u4F1A\u8BDD\u680F")
                }
                onClick={() => setSidebarOpen((value) => !value)}
              >
                {sidebarOpen ? (
                  <PanelLeftClose aria-hidden="true" size={17} />
                ) : (
                  <PanelLeftOpen aria-hidden="true" size={17} />
                )}
              </button>
            ) : null}
            <Brand optical={optical} />
            {optical ? (
              <span className="orbit-style-mark">
                <Orbit size={18} aria-hidden="true" />
                {locale === "en" ? "Light Trails" : "光轨"}
              </span>
            ) : null}
            {!optical ? (
              <div className="topbar-session">
                <strong>{selectedSession?.title ?? tr("\u672A\u9009\u62E9\u4F1A\u8BDD")}</strong>
                <span title={currentWorkspace ?? ""}>
                  {currentWorkspace?.split(/[\\/]/).filter(Boolean).at(-1) ??
                    selectedProvider?.name}
                </span>
              </div>
            ) : null}
            <div className="topbar-actions">
              {optical ? (
                <span className="orbit-topbar-state" title={visualRunLabel}>
                  <i aria-hidden="true" />
                  <span>{visualRunLabel}</span>
                </span>
              ) : null}
              {!optical ? <LayoutPicker value={layout.mode} onChange={changeLayout} /> : null}
              <span className="connection-state">
                <span
                  className={
                    connectionCount > 0
                      ? "connection-state__dot"
                      : "connection-state__dot connection-state__dot--empty"
                  }
                  aria-hidden="true"
                />

                {tr("{0} 个连接", [connectionCount])}
              </span>
              {!optical ? (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={tr("\u6253\u5F00\u5DE5\u4F5C\u533A")}
                  title={tr("\u5DE5\u4F5C\u533A")}
                  onClick={() => {
                    setInspectorView("workspace");
                    setWorkspaceOpen((value) => !value);
                  }}
                >
                  <PanelRight aria-hidden="true" size={17} />
                </button>
              ) : null}
              <button
                className="icon-button"
                type="button"
                aria-label={
                  theme === "day"
                    ? tr("\u5207\u6362\u5230\u591C\u95F4\u4E3B\u9898")
                    : tr("\u5207\u6362\u5230\u65E5\u95F4\u4E3B\u9898")
                }
                title={
                  theme === "day"
                    ? tr("\u5207\u6362\u5230\u591C\u95F4\u4E3B\u9898")
                    : tr("\u5207\u6362\u5230\u65E5\u95F4\u4E3B\u9898")
                }
                onClick={() => setTheme(theme === "day" ? "night" : "day")}
              >
                {theme === "day" ? (
                  <Moon aria-hidden="true" size={17} />
                ) : (
                  <Sun aria-hidden="true" size={17} />
                )}
              </button>
              {!optical ? (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={tr("\u6253\u5F00\u8BBE\u7F6E")}
                  title={tr("\u8BBE\u7F6E")}
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings aria-hidden="true" size={17} />
                </button>
              ) : null}
            </div>
          </header>,
          document.getElementById("workbench-titlebar") as HTMLElement,
        )}

        {layoutError ? (
          <div className="layout-save-error" role="alert">
            {layoutError}
            <button type="button" onClick={retryLayout}>
              {tr("重试")}
            </button>
          </div>
        ) : null}

        <div
          className={[
            "app-body",
            optical ? "app-body--orbit" : "",
            workspaceOpen ? "app-body--workspace" : "",
            sidebarOpen ? "" : "app-body--sidebar-collapsed",
            sidebarOpen ? "app-body--sidebar-open" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={
            {
              "--sidebar-width": `${layout.sidebarWidth}px`,
              "--inspector-width": `${layout.inspectorWidth}px`,
            } as CSSProperties
          }
          data-inspector-drawer={inspectorDrawer}
          data-sidebar-drawer={sidebarDrawer}
        >
          {optical ? (
            <>
              <nav
                className="orbit-tool-rail"
                aria-label={locale === "en" ? "Workspace tools" : "工作区工具"}
              >
                <div className="orbit-tool-rail__brand">
                  <BrandMark size={32} />
                </div>
                <div className="orbit-tool-rail__main">
                  <button
                    type="button"
                    className="icon-button"
                    data-orbit-action="chat"
                    aria-label={locale === "en" ? "Conversation" : "对话"}
                    title={locale === "en" ? "Conversation" : "对话"}
                    aria-pressed={layout.mode === "chat"}
                    onClick={() => {
                      changeLayout("chat");
                      requestAnimationFrame(() =>
                        document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(),
                      );
                    }}
                  >
                    <MessagesSquare size={19} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    data-orbit-action="files"
                    aria-label={tr("文件")}
                    title={tr("文件")}
                    aria-pressed={
                      workspaceOpen && layout.mode === "code" && activeWorkspaceTab === "files"
                    }
                    onClick={() => openWorkspaceTab("files")}
                  >
                    <Code2 size={19} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    data-orbit-action="agents"
                    aria-label={tr("查看子 Agent 任务树")}
                    title={tr("多任务协作")}
                    aria-pressed={layout.mode === "agents"}
                    onClick={() => changeLayout("agents")}
                  >
                    <Network size={19} aria-hidden="true" />
                  </button>
                  <span className="orbit-tool-rail__divider" />
                  <button
                    type="button"
                    className="icon-button"
                    data-orbit-action="terminal"
                    aria-label={tr("终端")}
                    title={tr("终端")}
                    aria-pressed={
                      workspaceOpen && layout.mode === "code" && activeWorkspaceTab === "terminal"
                    }
                    onClick={() => openWorkspaceTab("terminal")}
                  >
                    <Terminal size={19} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    data-orbit-action="review"
                    aria-label={tr("审查")}
                    title={tr("审查")}
                    aria-pressed={
                      workspaceOpen && layout.mode === "code" && activeWorkspaceTab === "review"
                    }
                    onClick={() => openWorkspaceTab("review")}
                  >
                    <FileDiff size={19} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button orbit-tool-rail__sessions"
                    data-orbit-action="sessions"
                    aria-label={sidebarOpen ? tr("收起会话栏") : tr("展开会话栏")}
                    title={sidebarOpen ? tr("收起会话栏") : tr("展开会话栏")}
                    aria-expanded={sidebarOpen}
                    onClick={() => setSidebarOpen((open) => !open)}
                  >
                    <Files size={18} aria-hidden="true" />
                  </button>
                </div>
                <div className="orbit-tool-rail__bottom">
                  <button
                    type="button"
                    className="icon-button"
                    data-orbit-action="settings"
                    aria-label={tr("打开设置")}
                    title={tr("设置")}
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings size={19} aria-hidden="true" />
                  </button>
                  <span className="orbit-tool-rail__identity" title="Mingshen" aria-hidden="true">
                    M
                  </span>
                </div>
              </nav>
              <header className="orbit-workspace-header">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={sidebarOpen ? tr("收起会话栏") : tr("展开会话栏")}
                  title={sidebarOpen ? tr("收起会话栏") : tr("展开会话栏")}
                  aria-expanded={sidebarOpen}
                  onClick={() => setSidebarOpen((open) => !open)}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose size={16} aria-hidden="true" />
                  ) : (
                    <PanelLeftOpen size={16} aria-hidden="true" />
                  )}
                </button>
                <div className="orbit-workspace-header__path">
                  <Folder size={16} aria-hidden="true" />
                  <span title={currentWorkspace ?? undefined}>{workspaceName}</span>
                  <span className="orbit-workspace-header__slash" aria-hidden="true">
                    /
                  </span>
                  <h1 title={selectedSession?.title}>
                    {selectedSession?.title ?? tr("未选择会话")}
                  </h1>
                </div>
                <LayoutPicker value={layout.mode} onChange={changeLayout} labels />
                <button
                  className="icon-button"
                  type="button"
                  data-orbit-action="panels"
                  aria-label={workspaceOpen ? tr("关闭面板") : tr("打开工作区")}
                  title={workspaceOpen ? tr("关闭面板") : tr("打开工作区")}
                  aria-expanded={workspaceOpen}
                  onClick={() => setWorkspaceOpen((open) => !open)}
                >
                  <PanelRight size={17} aria-hidden="true" />
                </button>
              </header>
              <footer className="orbit-status-bar">
                <span className="orbit-status-bar__workspace" title={currentWorkspace ?? undefined}>
                  <i aria-hidden="true" />
                  <Folder size={12} aria-hidden="true" />
                  {workspaceName}
                </span>
                <span className="orbit-status-bar__state" data-state={visualRunState}>
                  {visualRunLabel}
                </span>
                <span className="orbit-status-bar__local">
                  <ShieldCheck size={12} aria-hidden="true" />
                  {tr("本地运行")}
                  <span>{APP_VERSION}</span>
                </span>
              </footer>
            </>
          ) : null}
          {(workspaceOpen && inspectorDrawer) || (sidebarOpen && sidebarDrawer) ? (
            <button
              className="workbench-drawer-scrim"
              type="button"
              aria-label={tr("关闭面板")}
              onClick={() =>
                workspaceOpen && inspectorDrawer ? setWorkspaceOpen(false) : setSidebarOpen(false)
              }
            />
          ) : null}
          <div className="sidebar-host" hidden={!sidebarOpen}>
            <SessionSidebar
              sessions={sessions}
              catalogGroups={sessionGroups}
              onLoadSessions={mergeSessions}
              unreadCompletions={completionNotifications?.unread || []}
              selectedSessionId={selectedSessionId}
              search={search}
              onSearchChange={setSearch}
              onSelect={setSelectedSessionId}
              runs={runsBySession}
              pendingQuestionSessionIds={Object.keys(questionsBySession)}
              onPatch={patchSession}
              onFork={forkSession}
              onRemove={async (sessionId) => {
                await window.mingshen.removeSession(sessionId);
                const removed = new Set([sessionId]);
                let previousSize = 0;
                while (previousSize !== removed.size) {
                  previousSize = removed.size;
                  for (const item of sessions)
                    if (item.parentSessionId && removed.has(item.parentSessionId))
                      removed.add(item.id);
                }
                composerDrafts.forget([...removed]);
                await refreshAll();
              }}
              onNewSession={openNewSession}
              onNewWorkspaceSession={(path) => void createWorkspaceSession(path)}
              creatingWorkspaceSession={creatingWorkspaceSession}
              workspaceSessionError={workspaceSessionError}
              onCollapse={() => setSidebarOpen(false)}
            />
          </div>
          {sidebarOpen ? (
            <PanelResizeHandle
              side="left"
              value={layout.sidebarWidth}
              min={220}
              max={320}
              onChange={(sidebarWidth) => setLayout({ sidebarWidth })}
            />
          ) : null}
          <ChatView
            key={selectedSessionId}
            notificationDraft={completionNotifications?.replyDraft ?? null}
            session={selectedSession}
            providers={providers}
            agentProfiles={agentProfiles}
            extensions={extensions}
            activities={selectedSessionId ? (activitiesBySession[selectedSessionId] ?? []) : []}
            selectedExtensionIds={
              selectedSessionId ? (sessionExtensionsBySession[selectedSessionId] ?? []) : []
            }
            messages={messages}
            live={selectedSessionId ? (liveBySession[selectedSessionId] ?? null) : null}
            allLive={liveBySession}
            runState={selectedSessionId ? (runsBySession[selectedSessionId] ?? null) : null}
            usage={selectedSessionId ? (usageBySession[selectedSessionId] ?? null) : null}
            context={selectedSessionId ? (contextsBySession[selectedSessionId] ?? null) : null}
            sessions={sessions}
            allActivities={activitiesBySession}
            approval={selectedSessionId ? (approvalsBySession[selectedSessionId] ?? null) : null}
            question={selectedSessionId ? (questionsBySession[selectedSessionId] ?? null) : null}
            onNewSession={() => openNewSession(selectedSession?.workspacePath ?? null)}
            onSelectSession={setSelectedSessionId}
            onSend={sendMessage}
            onRewriteMessage={rewriteMessage}
            onStop={stopRun}
            onFork={forkSession}
            onCompact={(sessionId) => window.mingshen.compactChat(sessionId)}
            onPatch={patchSession}
            onToggleExtension={toggleSessionExtension}
            onImportExtensions={importExtensions}
            onOpenSettings={(section) => {
              setSettingsSection(section ?? "appearance");
              setSettingsOpen(true);
            }}
            onOpenWorkspace={openWorkspaceFromConversation}
            onOpenFile={openFileFromConversation}
            onSyncPending={syncPendingRequests}
            onApprovalDecision={async (decision: ApprovalDecision) => {
              try {
                await window.mingshen.decideApproval(decision);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (!message.includes("已经处理")) {
                  throw error;
                }
              }
              await syncPendingRequests();
            }}
            onQuestionAnswer={async (answer) => {
              if (!selectedSessionId) {
                return;
              }
              await window.mingshen.answerQuestion(answer);
              await syncPendingRequests();
            }}
          />

          {workspaceOpen ? (
            <PanelResizeHandle
              side="right"
              value={layout.inspectorWidth}
              min={360}
              max={720}
              onChange={(inspectorWidth) => setLayout({ inspectorWidth })}
            />
          ) : null}
          <div className="inspector-host" hidden={!workspaceOpen}>
            <div
              className="inspector-workspace"
              hidden={!optical && layout.mode === "agents" && inspectorView === "tasks"}
            >
              <WorkspacePanel
                sessionId={selectedSessionId}
                messages={messages}
                runState={selectedSessionId ? (runsBySession[selectedSessionId] ?? null) : null}
                activities={selectedSessionId ? (activitiesBySession[selectedSessionId] ?? []) : []}
                root={selectedSession?.workspacePath ?? null}
                browserRequest={browserRequest}
                fileRequest={fileRequest}
                tabRequest={workspaceTabRequest}
                onTabChange={setActiveWorkspaceTab}
                onChooseRoot={async () => {
                  const path = await window.mingshen.chooseWorkspace();
                  if (path && selectedSession) {
                    if (!(await window.mingshen.getProjectTrust(path))) {
                      const trusted = await confirm({
                        title: tr("\u662F\u5426\u4FE1\u4EFB\u6B64\u5DE5\u4F5C\u76EE\u5F55"),
                        description: tr(
                          "\u4FE1\u4EFB\u540E\u5141\u8BB8\u9879\u76EE\u7EA7 AGENTS.md\u3001\u63D2\u4EF6 MCP \u548C\u663E\u5F0F\u542F\u7528\u7684 Shell Hook \u5728\u6B64\u76EE\u5F55\u8FD0\u884C\u3002",
                        ),

                        confirmLabel: tr("\u4FE1\u4EFB\u9879\u76EE"),
                        cancelLabel: tr("\u6682\u4E0D\u4FE1\u4EFB"),
                      });
                      if (trusted) {
                        await window.mingshen.setProjectTrust(path, true);
                      }
                    }
                    await patchSession({ sessionId: selectedSession.id, workspacePath: path });
                  }
                }}
                onClose={() => setWorkspaceOpen(false)}
              />
            </div>
          </div>
          <div
            className={`task-host${optical || (layout.mode === "agents" && workspaceOpen && inspectorView === "tasks") ? " task-host--docked" : ""}`}
            hidden={optical && !workspaceOpen}
          >
            {selectedSession ? (
              <TaskWorkbench
                key={selectedSession.id}
                docked={
                  optical ||
                  (layout.mode === "agents" && workspaceOpen && inspectorView === "tasks")
                }
                viewRequest={taskViewRequest}
                session={selectedSession}
                sessions={sessions}
                activities={activitiesBySession}
                liveBySession={liveBySession}
                onSelect={setSelectedSessionId}
                onOpenFile={(path) => {
                  setInspectorView("workspace");
                  openFileFromConversation(path);
                }}
              />
            ) : optical ? (
              <div className="orbit-task-empty">
                <strong>{tr("任务计划")}</strong>
                <p>
                  {locale === "en"
                    ? "Select a conversation to view its tasks."
                    : "选择会话以查看任务进度"}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {settingsOpen ? (
        <SettingsDrawer
          initialSection={settingsSection}
          providers={providers}
          agentProfiles={agentProfiles}
          extensions={extensions}
          mcpServers={mcpServers}
          scheduledTasks={scheduledTasks}
          sessions={sessions}
          activeSessionId={selectedSessionId}
          theme={theme}
          onThemeChange={setTheme}
          onChanged={async () => {
            await refreshAll();
          }}
          onClose={() => setSettingsOpen(false)}
          onSessionManagementBusyChange={onSessionManagementBusyChange}
        />
      ) : null}

      {newSessionOpen ? (
        <NewSessionDialog
          providers={providers}
          agentProfiles={agentProfiles}
          initialWorkspacePath={newSessionWorkspace}
          onClose={() => {
            setNewSessionOpen(false);
            setNewSessionWorkspace(null);
          }}
          onCreated={createSessionFromDialog}
        />
      ) : null}
    </>
  );
}

function Brand({ optical = false }: { optical?: boolean }) {
  return (
    <div className="brand">
      <BrandMark size={30} />
      <span className="brand__copy">
        <strong>{optical ? "MINGSHEN" : "Mingshen"}</strong>
        <small>
          {optical ? (
            <>
              INTELLIGENCE HARNESS <span>{APP_VERSION}</span>
            </>
          ) : (
            "Harness"
          )}
        </small>
      </span>
    </div>
  );
}
