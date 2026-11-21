import {
  Code2,
  Command,
  FileDiff,
  Files,
  Folder,
  Image,
  LoaderCircle,
  MessagesSquare,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelsTopLeft,
  Settings,
  ShieldCheck,
  Sun,
  Terminal,
} from "lucide-react";
import {
  type CSSProperties,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { CompletionNotificationState } from "../../shared/desktop";
import type {
  ActivityEvent,
  AgentMode,
  AgentProfileView,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalState,
  BootstrapData,
  ChatAttachmentInput,
  ChatGroupView,
  ChatStreamEvent,
  ChatTurnOptions,
  ContextUsageView,
  ExtensionImportResult,
  ExtensionView,
  McpServerView,
  ProviderView,
  QuestionRequest,
  QuestionState,
  ScheduledTaskView,
  SessionBuiltinCapabilityView,
  SessionMessage,
  SessionRunState,
  SessionUpdateInput,
  SessionView,
} from "../../shared/domain";
import type { QueuedPromptContinueResult, QueuedPromptView } from "../../shared/queued-prompt";
import { APP_VERSION } from "../../shared/release";
import type { SessionPage } from "../../shared/session-catalog";
import type { WorkbenchLayout } from "../../shared/ui-preferences";
import { AgentGuide } from "./components/AgentGuide";
import { AgentModeSwitcher } from "./components/AgentModeSwitcher";
import { BrandMark } from "./components/BrandMark";
import { ChatSidebar } from "./components/ChatSidebar";
import { ChatView } from "./components/ChatView";
import { CommandPalette } from "./components/CommandPalette";
import { CreativeWorkstation } from "./components/CreativeWorkstation";
import { useDialog } from "./components/DialogProvider";
import { ImageStudio } from "./components/ImageStudio";
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
import { profileSupportsAgentMode, updateSessionLockSet } from "./lib/agent-mode-ui";
import {
  approvalsFromSnapshot,
  newerPendingState,
  questionsFromSnapshot,
} from "./lib/approval-state";
import type { LiveRun, SessionUsage } from "./lib/chat-types";
import { ComposerDraftHandoff } from "./lib/composer-draft-handoff";
import {
  loadSessionCatalogRefresh,
  replaceActiveChatSessions,
  replaceWorkspaceCatalogPreservingChat,
} from "./lib/session-catalog-sync";
import { composerDrafts } from "./lib/use-composer-draft";

type Theme = "day" | "night";
type AppSurface = "conversation" | "workstation" | "image-studio";
interface BrowserRequest {
  sessionId: string;
  provider: "chrome" | "edge";
  url: string;
  requestKey: number;
}

const MIN_READABLE_CHAT_WIDTH = 480;
const ORBIT_RAIL_WIDTH = 48;
const ORBIT_OUTER_INSET = 24;
const ORBIT_SPLITTER_WIDTH = 8;
const ORBIT_SIDEBAR_SHELL_WIDTH = ORBIT_RAIL_WIDTH + ORBIT_OUTER_INSET + ORBIT_SPLITTER_WIDTH * 2;
const ORBIT_INSPECTOR_SHELL_WIDTH = ORBIT_RAIL_WIDTH + ORBIT_OUTER_INSET + ORBIT_SPLITTER_WIDTH * 3;

function readTheme(): Theme {
  return localStorage.getItem("mingshen.theme") === "day" ? "day" : "night";
}

function readAgentMode(): AgentMode {
  const stored = localStorage.getItem("mingshen.agent-mode");
  return stored === "work" || stored === "chat" ? stored : "code";
}

function sessionAgentMode(session: SessionView | null | undefined): AgentMode {
  return session?.agentMode === "work" || session?.agentMode === "chat"
    ? session.agentMode
    : "code";
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
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  useEffect(() => {
    const resize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
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
  const [sessionBuiltinCapabilitiesBySession, setSessionBuiltinCapabilitiesBySession] = useState<
    Record<string, SessionBuiltinCapabilityView[]>
  >({});
  const [queuedPromptsBySession, setQueuedPromptsBySession] = useState<
    Record<string, QueuedPromptView[]>
  >({});
  const queuedPromptLoadVersionsRef = useRef(new Map<string, number>());
  const queuedPromptRefreshTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const [agentMode, setAgentMode] = useState<AgentMode>(readAgentMode);
  const [surface, setSurface] = useState<AppSurface>("conversation");
  const [surfaceError, setSurfaceError] = useState("");
  const draftHandoff = useRef(new ComposerDraftHandoff(composerDrafts));
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const togglePalette = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyP") {
        if (event.isComposing || event.repeat) return;
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", togglePalette);
    return () => window.removeEventListener("keydown", togglePalette);
  }, []);
  const [workbenchSessionId, setWorkbenchSessionId] = useState<string | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatDesktopSidebarOpen, setChatDesktopSidebarOpen] = useState(
    () => localStorage.getItem("mingshen.chat-sidebar.desktop") !== "closed",
  );
  const [chatCompactSidebarOpen, setChatCompactSidebarOpen] = useState(false);
  const chatSidebarDrawer = viewportWidth <= 900;
  const chatSidebarOpen = chatSidebarDrawer ? chatCompactSidebarOpen : chatDesktopSidebarOpen;
  const setChatSidebarOpen = (value: boolean | ((previous: boolean) => boolean)) => {
    if (chatSidebarDrawer) {
      setChatCompactSidebarOpen(value);
      return;
    }
    setChatDesktopSidebarOpen(value);
  };
  const selectedSessionId = agentMode === "chat" ? chatSessionId : workbenchSessionId;
  const creativeContextRef = useRef({ selectedSessionId, workbenchSessionId });
  creativeContextRef.current = { selectedSessionId, workbenchSessionId };
  const [chatGroups, setChatGroups] = useState<ChatGroupView[]>([]);
  const [completionNotifications, setCompletionNotifications] =
    useState<CompletionNotificationState | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [liveBySession, setLiveBySession] = useState<Record<string, LiveRun>>({});
  const [runsBySession, setRunsBySession] = useState<Record<string, SessionRunState>>({});
  const [modeStartLockSessionIds, setModeStartLockSessionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [modePreparationSessionIds, setModePreparationSessionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
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
  const taskPanelCollapsed = optical && layout.taskPanelCollapsed === true;
  const taskPanelMaxHeight = Math.max(160, Math.min(640, viewportHeight - 300));
  const taskPanelHeight = Math.min(
    taskPanelMaxHeight,
    layout.taskPanelHeight ??
      (viewportWidth <= 900 ? 160 : Math.max(224, Math.min(304, viewportHeight * 0.28))),
  );
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
    "appearance" | "providers" | "permissions" | "context" | "extensions" | "mcp" | "project"
  >("appearance");
  const workspaceOpen = layout.inspectorOpen;
  const shellWidth = optical ? ORBIT_INSPECTOR_SHELL_WIDTH : 12;
  const inspectorDrawer =
    viewportWidth <
    MIN_READABLE_CHAT_WIDTH +
      (sidebarOpen ? layout.sidebarWidth : 0) +
      layout.inspectorWidth +
      shellWidth;
  const sidebarDrawer =
    viewportWidth <
    MIN_READABLE_CHAT_WIDTH + layout.sidebarWidth + (optical ? ORBIT_SIDEBAR_SHELL_WIDTH : 6);
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
  const [planEditing, setPlanEditing] = useState(false);
  useEffect(() => {
    setTaskViewRequest((current) => (current?.sessionId === selectedSessionId ? current : null));
  }, [selectedSessionId]);
  const [inspectorView, setInspectorView] = useState<"tasks" | "workspace">("tasks");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newSessionWorkspace, setNewSessionWorkspace] = useState<string | null>(null);
  const [creatingChatSession, setCreatingChatSession] = useState(false);
  const [chatSessionError, setChatSessionError] = useState("");
  const creatingChatSessionRef = useRef(false);
  const [creatingWorkspaceSession, setCreatingWorkspaceSession] = useState(false);
  const [workspaceSessionError, setWorkspaceSessionError] = useState("");
  const creatingWorkspaceSessionRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const updateModeStartLock = useCallback((sessionId: string, locked: boolean) => {
    setModeStartLockSessionIds((current) => updateSessionLockSet(current, sessionId, locked));
  }, []);
  const updateModePreparationLock = useCallback((sessionId: string, preparing: boolean) => {
    setModePreparationSessionIds((current) => updateSessionLockSet(current, sessionId, preparing));
  }, []);
  const allowPlanNavigation = useCallback(
    (nextSessionId: string | null) => {
      const editor = document.querySelector<HTMLElement>('.task-workbench[data-unsaved="true"]');
      if (!editor || editor.dataset.taskSession === nextSessionId) return true;
      setWorkspaceOpen(true);
      setTaskViewRequest({
        sessionId: editor.dataset.taskSession ?? null,
        tab: "plan",
        requestKey: performance.now(),
        notice: tr("请先保存或取消计划编辑，再切换会话或 ChatAgent。"),
      });
      return false;
    },
    [setWorkspaceOpen],
  );
  const applySessionSelection = useCallback(
    (session: SessionView) => {
      if (!allowPlanNavigation(session.id)) return false;
      setSurface("conversation");
      if (session.agentMode === "chat") {
        setChatSessionId(session.id);
        setAgentMode("chat");
        return true;
      }
      setWorkbenchSessionId(session.id);
      setAgentMode(session.agentMode === "work" ? "work" : "code");
      return true;
    },
    [allowPlanNavigation],
  );
  const selectSession = useCallback(
    async (sessionId: string | null) => {
      if (!allowPlanNavigation(sessionId)) return false;
      if (!sessionId) {
        if (agentMode === "chat") setChatSessionId(null);
        else setWorkbenchSessionId(null);
        return true;
      }
      const known = sessionsRef.current.find((session) => session.id === sessionId);
      if (known) {
        return applySessionSelection(known);
      }
      try {
        const session = await window.mingshen.getSession(sessionId);
        if (!session) {
          setBootError(tr("会话不存在。"));
          return false;
        }
        mergeSessions([session]);
        return applySessionSelection(session);
      } catch (error) {
        setBootError(errorMessage(error));
        return false;
      }
    },
    [agentMode, allowPlanNavigation, applySessionSelection, mergeSessions],
  );
  const setSelectedSessionId = useCallback(
    (next: SetStateAction<string | null>) => {
      const current = agentMode === "chat" ? chatSessionId : workbenchSessionId;
      const value = typeof next === "function" ? next(current) : next;
      if (agentMode === "chat") setChatSessionId(value);
      else setWorkbenchSessionId(value);
    },
    [agentMode, chatSessionId, workbenchSessionId],
  );
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
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedSessionAgentMode = selectedSession ? sessionAgentMode(selectedSession) : null;
  const selectedSessionExists = Boolean(
    selectedSessionId && sessions.some((session) => session.id === selectedSessionId),
  );
  const loadQueuedPrompts = useCallback(async (sessionId: string): Promise<QueuedPromptView[]> => {
    const version = (queuedPromptLoadVersionsRef.current.get(sessionId) ?? 0) + 1;
    queuedPromptLoadVersionsRef.current.set(sessionId, version);
    const items = await window.mingshen.listQueuedPrompts(sessionId);
    if (queuedPromptLoadVersionsRef.current.get(sessionId) === version)
      setQueuedPromptsBySession((current) => ({ ...current, [sessionId]: items }));
    return items;
  }, []);
  const scheduleQueuedPromptsRefresh = useCallback(
    (sessionId: string) => {
      const existing = queuedPromptRefreshTimersRef.current.get(sessionId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        queuedPromptRefreshTimersRef.current.delete(sessionId);
        void loadQueuedPrompts(sessionId).catch((error: unknown) => {
          setBootError(errorMessage(error));
        });
      }, 0);
      queuedPromptRefreshTimersRef.current.set(sessionId, timer);
    },
    [loadQueuedPrompts],
  );

  useEffect(() => {
    if (!selectedSessionId || !selectedSessionExists) return;
    let cancelled = false;
    void loadQueuedPrompts(selectedSessionId).catch((error: unknown) => {
      if (!cancelled) setBootError(errorMessage(error));
    });
    return () => {
      cancelled = true;
    };
  }, [loadQueuedPrompts, selectedSessionExists, selectedSessionId]);

  useEffect(
    () => () => {
      for (const timer of queuedPromptRefreshTimersRef.current.values()) clearTimeout(timer);
      queuedPromptRefreshTimersRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mingshen.theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("mingshen.agent-mode", agentMode);
  }, [agentMode]);

  useEffect(() => {
    localStorage.setItem(
      "mingshen.chat-sidebar.desktop",
      chatDesktopSidebarOpen ? "open" : "closed",
    );
  }, [chatDesktopSidebarOpen]);

  useEffect(() => {
    if (agentMode === "chat" && chatSessionId && chatSidebarDrawer) {
      setChatCompactSidebarOpen(false);
    }
  }, [agentMode, chatSessionId, chatSidebarDrawer]);

  useEffect(() => {
    localStorage.setItem("mingshen.sidebar", sidebarOpen ? "open" : "closed");
  }, [sidebarOpen]);

  useEffect(() => {
    selectedSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);
  useEffect(() => {
    const visibleSessionId = surface === "conversation" ? selectedSessionId : null;
    void window.mingshen.setActiveNotificationSession(visibleSessionId).catch(() => undefined);
    if (visibleSessionId)
      void window.mingshen.markSessionOpened(visibleSessionId).catch(() => undefined);
  }, [selectedSessionId, surface]);
  useEffect(() => {
    let cancelled = false;
    const receive = (state: CompletionNotificationState) => {
      if (cancelled) return;
      setCompletionNotifications(state);
      if (
        !planEditing &&
        state.replyDraft &&
        restoredNotificationDraftRef.current !== state.replyDraft.id
      ) {
        const draft = state.replyDraft;
        void selectSession(draft.sessionId).then((selected) => {
          if (!cancelled && selected) restoredNotificationDraftRef.current = draft.id;
        });
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
  }, [selectSession, planEditing]);
  useEffect(
    () =>
      window.mingshen.onDesktopEvent((event) => {
        if (event.type === "open-provider-settings") {
          setSettingsSection("providers");
          setSettingsOpen(true);
        }
        if (
          (event.type === "select-session" || event.type === "notification-reply-failed") &&
          event.sessionId
        )
          void selectSession(event.sessionId);
      }),
    [selectSession],
  );

  const loadChatGroups = useCallback(async () => {
    const groups = await window.mingshen.listChatGroups();
    setChatGroups(groups);
  }, []);

  const loadAllChatSessions = useCallback(
    async (replaceActive = false) => {
      const rows: SessionView[] = [];
      let cursor: string | null = null;
      do {
        const page: SessionPage = await window.mingshen.listSessionPage({
          agentMode: "chat",
          archived: false,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        rows.push(...page.sessions);
        cursor = page.nextCursor;
      } while (cursor);
      if (replaceActive) setSessions((current) => replaceActiveChatSessions(current, rows));
      else mergeSessions(rows);
    },
    [mergeSessions],
  );

  const refreshAll = useCallback(async (): Promise<BootstrapData> => {
    const priorRevision = sessionRevision.current;
    const loadedIds = sessionsRef.current.map((item) => item.id);
    const { data, delta, appliedRevision } = await loadSessionCatalogRefresh({
      priorRevision,
      loadedIds,
      bootstrap: () =>
        window.mingshen.bootstrap({
          paged: true,
          selectedId: selectedSessionRef.current,
        }),
      getDelta: (after, ids) => window.mingshen.getSessionDelta(after, [...ids]),
    });
    setProviders(data.providers);
    mergeSessions(data.sessions);
    if (data.sessionCatalog) {
      if (delta) {
        if (delta.reset) {
          setSessions((current) => replaceWorkspaceCatalogPreservingChat(current, data.sessions));
          await loadAllChatSessions(true);
        } else {
          mergeSessions(delta.sessions);
          setSessions((items) => items.filter((item) => !delta.removed.includes(item.id)));
        }
      }
      if (appliedRevision !== null) sessionRevision.current = appliedRevision;
      setSessionGroups(data.sessionCatalog.groups);
    }
    if (data.chatGroups) setChatGroups(data.chatGroups);
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
  }, [receiveApprovals, receiveQuestions, loadAllChatSessions, mergeSessions]);

  useEffect(() => {
    const sync = async () => {
      try {
        const delta = await window.mingshen.getSessionDelta(
          sessionRevision.current,
          sessionsRef.current.map((item) => item.id),
        );
        if (delta.reset) {
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
  }, [mergeSessions, selectedSessionExists, selectedSessionId, setSelectedSessionId]);
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
    void Promise.all([refreshAll(), loadAllChatSessions(), loadChatGroups()])
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
  }, [loadAllChatSessions, loadChatGroups, refreshAll]);

  useEffect(() => {
    const workspaceSessions = sessions.filter(
      (session) => session.agentMode !== "chat" && !session.archived,
    );
    const currentWorkspaceSession = workspaceSessions.find(
      (session) => session.id === workbenchSessionId,
    );
    if (currentWorkspaceSession) return;
    const next = workspaceSessions[0] ?? null;
    setWorkbenchSessionId(next?.id ?? null);
    if (agentMode !== "chat" && next) setAgentMode(sessionAgentMode(next));
  }, [agentMode, sessions, workbenchSessionId]);

  useEffect(() => {
    const activeChats = sessions.filter(
      (session) => session.agentMode === "chat" && !session.archived,
    );
    if (activeChats.some((session) => session.id === chatSessionId)) return;
    const next = activeChats[0] ?? null;
    setChatSessionId(next?.id ?? null);
  }, [chatSessionId, sessions]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedSessionId || !selectedSessionExists) {
      setMessages([]);
      return;
    }
    if (agentMode !== "chat" && selectedSessionAgentMode !== agentMode) {
      return;
    }

    void Promise.all([
      window.mingshen.getSessionMessages(selectedSessionId),
      window.mingshen.listSessionExtensions(selectedSessionId),
      window.mingshen.getContextUsage(selectedSessionId),
      agentMode === "chat"
        ? Promise.resolve([])
        : window.mingshen.listSessionBuiltinCapabilities(selectedSessionId),
    ])
      .then(([loaded, extensionIds, context, builtinCapabilities]) => {
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
          setSessionBuiltinCapabilitiesBySession((current) => ({
            ...current,
            [selectedSessionId]: builtinCapabilities,
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
              const next =
                data.sessions.find(
                  (session) =>
                    !session.archived &&
                    (agentMode === "chat"
                      ? session.agentMode === "chat"
                      : session.agentMode !== "chat"),
                )?.id ?? null;
              void selectSession(next);
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
  }, [
    agentMode,
    refreshAll,
    selectSession,
    selectedSessionAgentMode,
    selectedSessionExists,
    selectedSessionId,
  ]);

  useEffect(() => {
    const unsubscribe = window.mingshen.onRuntimeEvent((event: ChatStreamEvent) => {
      if (event.type === "composer_draft_consumed") {
        void composerDrafts.accepted(event.sessionId, event.revision).catch(() => undefined);
        return;
      }
      if (event.type === "queued_prompts_updated") {
        scheduleQueuedPromptsRefresh(event.sessionId);
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
        scheduleQueuedPromptsRefresh(event.session.id);
        return;
      }

      if (event.type === "session_removed") {
        queuedPromptLoadVersionsRef.current.set(
          event.sessionId,
          (queuedPromptLoadVersionsRef.current.get(event.sessionId) ?? 0) + 1,
        );
        composerDrafts.forget([event.sessionId]);
        const queuedRefreshTimer = queuedPromptRefreshTimersRef.current.get(event.sessionId);
        if (queuedRefreshTimer) {
          clearTimeout(queuedRefreshTimer);
          queuedPromptRefreshTimersRef.current.delete(event.sessionId);
        }
        updateModeStartLock(event.sessionId, false);
        updateModePreparationLock(event.sessionId, false);
        setWorkbenchSessionId((current) => (current === event.sessionId ? null : current));
        setChatSessionId((current) => (current === event.sessionId ? null : current));
        setContextsBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setQueuedPromptsBySession((current) => {
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
        updateModeStartLock(event.sessionId, true);
        scheduleQueuedPromptsRefresh(event.sessionId);
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
            return previous?.runId === event.runId
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
        updateModeStartLock(event.sessionId, false);
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
        scheduleQueuedPromptsRefresh(event.sessionId);
      }
    });

    return unsubscribe;
  }, [
    receiveApprovals,
    receiveQuestions,
    scheduleQueuedPromptsRefresh,
    syncPendingRequests,
    setWorkspaceOpen,
    updateModePreparationLock,
    updateModeStartLock,
  ]);

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
  const workspaceSession = sessions.find((session) => session.id === workbenchSessionId) ?? null;
  const sessionTaskRunning = (session: SessionView | null): boolean =>
    Boolean(
      session &&
        (session.status === "running" ||
          session.status === "waiting_approval" ||
          approvalsBySession[session.id] ||
          questionsBySession[session.id] ||
          liveBySession[session.id] ||
          runsBySession[session.id]?.status === "running" ||
          modeStartLockSessionIds.has(session.id) ||
          modePreparationSessionIds.has(session.id)),
    );
  const activeTaskRunning =
    sessionTaskRunning(selectedSession) ||
    (agentMode === "chat" && sessionTaskRunning(workspaceSession));
  const canEnterWorkspace = providers.some((provider) => provider.models.length > 0);
  const connectionCount = providers.filter((provider) => provider.keys.length > 0).length;

  useEffect(() => {
    if (browserRequest && browserRequest.sessionId !== selectedSessionId) {
      setBrowserRequest(null);
    }
    setFileRequest(null);
  }, [browserRequest, selectedSessionId]);

  const createSessionFromDialog = (session: SessionView) => {
    mergeSessions([session]);
    if (applySessionSelection(session)) setMessages([]);
    setNewSessionOpen(false);
    setNewSessionWorkspace(null);
  };

  const appendComposerDraft = async (text: string, sessionId = selectedSessionId) => {
    if (!sessionId) throw new Error(tr("请先选择会话。"));
    await draftHandoff.current.append(sessionId, text);
    if (selectedSessionRef.current !== sessionId) return;
    setSurface("conversation");
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(),
    );
  };

  const applyCreativeTemplate = async (prompt: string) => {
    const workstation = document.querySelector<HTMLElement>(".creative-workstation");
    const initialContext = creativeContextRef.current;
    let target = workspaceSession;
    const isCurrent = () => {
      const current = creativeContextRef.current;
      return (
        workstation?.isConnected &&
        (current.selectedSessionId === initialContext.selectedSessionId ||
          (initialContext.selectedSessionId === null &&
            current.selectedSessionId === target?.id)) &&
        (current.workbenchSessionId === initialContext.workbenchSessionId ||
          (initialContext.workbenchSessionId === null && current.workbenchSessionId === target?.id))
      );
    };
    const navigationError = () =>
      new Error(
        locale === "en"
          ? "Save or cancel the edited plan before opening this conversation."
          : "请先保存或取消正在编辑的计划，再打开此会话。",
      );
    const changedContextError = () =>
      new Error(
        locale === "en"
          ? "The workspace or view changed before the work request could be saved."
          : "工作区或页面已变化，工作请求尚未保存。",
      );
    try {
      if (!allowPlanNavigation(target?.id ?? null)) throw navigationError();
      if (target && sessionAgentMode(target) !== "work") {
        if (sessionTaskRunning(target))
          throw new Error(
            locale === "en"
              ? "Wait for this task to finish before switching to WorkAgent."
              : "请等待当前任务结束，再切换到 WorkAgent 使用模板。",
          );
        const profile = agentProfiles.find(
          (profile) =>
            profile.enabled &&
            profile.id === target?.agentProfileId &&
            profileSupportsAgentMode(profile, "work"),
        );
        if (!profile)
          throw new Error(
            locale === "en"
              ? "The current Agent profile does not support WorkAgent. Choose an appropriate profile in the conversation before handing off the template."
              : "当前 Agent 配置不适用于 WorkAgent。请先在对话中选择适用配置，再交接模板。",
          );
        target = await window.mingshen.updateSession({
          sessionId: target.id,
          agentMode: "work",
          agentProfileId: profile.id,
        });
        mergeSessions([target]);
        if (!isCurrent()) throw changedContextError();
      }
      if (!target) {
        const path = await window.mingshen.chooseWorkspace();
        if (!isCurrent()) throw changedContextError();
        if (!path)
          throw new Error(
            locale === "en" ? "Workspace selection was cancelled." : "已取消选择工作目录。",
          );
        target = await window.mingshen.createSessionInWorkspace(path, "work");
        mergeSessions([target]);
        if (!isCurrent()) throw changedContextError();
      }
      if (!allowPlanNavigation(target.id)) throw navigationError();
      await draftHandoff.current.append(target.id, prompt);
      let verifiedTarget: SessionView | null;
      try {
        verifiedTarget = await window.mingshen.getSession(target.id);
      } catch (cause) {
        draftHandoff.current.rememberUnconfirmed(target.id, prompt);
        throw new Error(
          locale === "en"
            ? `Could not verify the target session. The request may already be saved; check its composer before retrying. ${errorMessage(cause)}`
            : `无法确认目标会话。工作请求可能已保存，请先检查输入框再重试。${errorMessage(cause)}`,
        );
      }
      if (!verifiedTarget)
        throw new Error(
          locale === "en"
            ? "The target session was removed before the handoff could be confirmed."
            : "目标会话已被删除，无法确认交接。",
        );
      if (
        !isCurrent() ||
        verifiedTarget.archived ||
        sessionAgentMode(verifiedTarget) !== "work" ||
        verifiedTarget.workspacePath !== target.workspacePath ||
        !applySessionSelection(verifiedTarget)
      ) {
        setSurfaceError(
          locale === "en"
            ? "The work request was saved in the target session's composer; the current view was not changed."
            : "工作请求已保存到目标会话的输入框，当前页面未切换。",
        );
        return;
      }
      requestAnimationFrame(() =>
        document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(),
      );
    } catch (cause) {
      if (!workstation?.isConnected)
        setSurfaceError(
          locale === "en"
            ? `Could not hand off the work request: ${errorMessage(cause)}`
            : `无法交给 WorkAgent：${errorMessage(cause)}`,
        );
      throw cause;
    }
  };

  const openSurface = (next: AppSurface) => {
    if (next !== "conversation" && !allowPlanNavigation(null)) return;
    setSurfaceError("");
    setSurface(next);
  };

  const paletteCommand = (commandId: string) => {
    setPaletteOpen(false);
    if (commandId === "workstation") return openSurface("workstation");
    if (commandId === "image-studio") return openSurface("image-studio");
    if (commandId === "settings") return setSettingsOpen(true);
    if (commandId === "new-session") {
      if (agentMode === "chat") void createChatSession(selectedSession?.chatGroupId ?? null);
      else openNewSession(currentWorkspace);
      return;
    }
    if (commandId === "terminal" || commandId === "files" || commandId === "review") {
      setSurface("conversation");
      openWorkspaceTab(commandId);
      return;
    }
    const text = commandId.startsWith("custom:") ? `/${commandId.slice(7)} ` : `/${commandId} `;
    void appendComposerDraft(text).catch((cause) => setSurfaceError(errorMessage(cause)));
  };

  const openNewSession = (workspacePath: string | null) => {
    if (!allowPlanNavigation(null)) return;
    setNewSessionWorkspace(workspacePath);
    setNewSessionOpen(true);
  };

  const changeAgentMode = async (next: AgentMode) => {
    if (next === agentMode || activeTaskRunning) return;
    const previousUiMode = agentMode;
    if (next === "chat") {
      if (!allowPlanNavigation(chatSessionId)) return;
      setNewSessionOpen(false);
      setNewSessionWorkspace(null);
      setAgentMode("chat");
      if (!chatSessionId) {
        const firstChat = sessions.find(
          (session) => session.agentMode === "chat" && !session.archived,
        );
        setChatSessionId(firstChat?.id ?? null);
        if (!firstChat) void loadAllChatSessions().catch(() => undefined);
      }
      return;
    }
    setAgentMode(next);
    if (!workspaceSession || sessionAgentMode(workspaceSession) === next) return;
    const currentProfile = agentProfiles.find(
      (profile) => profile.id === workspaceSession.agentProfileId,
    );
    const compatibleProfile =
      currentProfile && profileSupportsAgentMode(currentProfile, next)
        ? currentProfile
        : (agentProfiles.find(
            (profile) =>
              profile.enabled &&
              profile.id === "primary" &&
              profileSupportsAgentMode(profile, next),
          ) ??
          agentProfiles.find(
            (profile) => profile.enabled && profileSupportsAgentMode(profile, next),
          ));
    if (!compatibleProfile) {
      setAgentMode(previousUiMode);
      setBootError(tr("没有适用于 {0} 的 Agent 配置。", [next]));
      return;
    }
    try {
      const updated = await window.mingshen.updateSession({
        sessionId: workspaceSession.id,
        agentMode: next,
        agentProfileId: compatibleProfile.id,
      });
      mergeSessions([updated]);
    } catch (error) {
      setAgentMode(previousUiMode);
      setBootError(errorMessage(error));
    }
  };

  const createWorkspaceSession = async (workspacePath: string | null) => {
    if (!allowPlanNavigation(null)) return;
    if (creatingWorkspaceSessionRef.current) return;
    creatingWorkspaceSessionRef.current = true;
    setCreatingWorkspaceSession(true);
    setWorkspaceSessionError("");
    try {
      const session = await window.mingshen.createSessionInWorkspace(
        workspacePath,
        agentMode === "work" ? "work" : "code",
      );
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
    if (input.archived) {
      const ancestors = new Set<string>();
      let ancestorId = workbenchSessionId;
      while (ancestorId && !ancestors.has(ancestorId)) {
        ancestors.add(ancestorId);
        ancestorId =
          sessionsRef.current.find((session) => session.id === ancestorId)?.parentSessionId ?? null;
      }
      if (ancestors.has(input.sessionId) && !allowPlanNavigation(null)) {
        throw new Error(tr("请先保存或取消计划编辑，再切换会话或 ChatAgent。"));
      }
    }
    const updated = await window.mingshen.updateSession(input);
    setSessions((current) =>
      current.map((session) => (session.id === updated.id ? updated : session)),
    );
    if (input.archived !== undefined) await refreshAll();
    return updated;
  };

  const removeSessionCascade = async (sessionId: string) => {
    await window.mingshen.removeSession(sessionId);
    const removed = new Set([sessionId]);
    let previousSize = 0;
    while (previousSize !== removed.size) {
      previousSize = removed.size;
      for (const item of sessionsRef.current) {
        if (item.parentSessionId && removed.has(item.parentSessionId)) removed.add(item.id);
      }
    }
    composerDrafts.forget([...removed]);
    draftHandoff.current.forget([...removed]);
    setSessions((current) => current.filter((item) => !removed.has(item.id)));
    if (workbenchSessionId && removed.has(workbenchSessionId)) setWorkbenchSessionId(null);
    if (chatSessionId && removed.has(chatSessionId)) setChatSessionId(null);
    await refreshAll();
  };

  const createChatGroup = async (name: string) => {
    await window.mingshen.createChatGroup(name);
    await loadChatGroups();
  };

  const renameChatGroup = async (groupId: string, name: string) => {
    await window.mingshen.renameChatGroup(groupId, name);
    await loadChatGroups();
  };

  const removeChatGroup = async (groupId: string) => {
    await window.mingshen.removeChatGroup(groupId);
    setChatGroups((current) => current.filter((group) => group.id !== groupId));
    setSessions((current) =>
      current.map((session) =>
        session.chatGroupId === groupId ? { ...session, chatGroupId: null } : session,
      ),
    );
  };

  const createChatSession = async (groupId: string | null = null) => {
    if (!allowPlanNavigation(null) || creatingChatSessionRef.current) return;
    creatingChatSessionRef.current = true;
    setCreatingChatSession(true);
    setChatSessionError("");
    try {
      const session = await window.mingshen.createChatSessionInGroup(groupId);
      createSessionFromDialog(session);
      if (chatSidebarDrawer) setChatSidebarOpen(false);
    } catch (error) {
      setChatSessionError(errorMessage(error));
      setChatSidebarOpen(true);
    } finally {
      creatingChatSessionRef.current = false;
      setCreatingChatSession(false);
    }
  };

  const sendMessage = async (
    text: string,
    attachments: ChatAttachmentInput[],
    draftRevision: string,
    turnOptions?: ChatTurnOptions,
  ) => {
    if (!selectedSessionId) {
      throw new Error(tr("\u8BF7\u5148\u9009\u62E9\u4F1A\u8BDD\u3002"));
    }
    updateModeStartLock(selectedSessionId, true);
    try {
      await window.mingshen.sendChat({
        sessionId: selectedSessionId,
        text,
        attachments,
        draftRevision,
        ...(turnOptions?.temporaryInstruction
          ? { temporaryInstruction: turnOptions.temporaryInstruction }
          : {}),
      });
    } catch (error) {
      updateModeStartLock(selectedSessionId, false);
      throw error;
    }
  };

  const forkSession = async (sessionId: string) => {
    const forked = await window.mingshen.forkSession(sessionId);
    await refreshAll();
    setSearch("");
    await selectSession(forked.id);
  };

  const stopRun = async () => {
    if (selectedSessionId) {
      await window.mingshen.stopChat(selectedSessionId);
    }
  };

  const compactSession = async (sessionId: string) => {
    updateModeStartLock(sessionId, true);
    try {
      return await window.mingshen.compactChat(sessionId);
    } catch (error) {
      updateModeStartLock(sessionId, false);
      throw error;
    }
  };

  const rewriteMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!selectedSessionId) {
        throw new Error(tr("\u8BF7\u5148\u9009\u62E9\u4F1A\u8BDD\u3002"));
      }
      updateModeStartLock(selectedSessionId, true);
      try {
        await window.mingshen.rewriteAndSendChat({
          sessionId: selectedSessionId,
          messageId,
          text,
        });
      } catch (error) {
        updateModeStartLock(selectedSessionId, false);
        throw error;
      }
    },
    [selectedSessionId, updateModeStartLock],
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

  const toggleSessionBuiltinCapability = async (capabilityId: string, selected: boolean) => {
    if (!selectedSessionId) {
      throw new Error(tr("\u8BF7\u5148\u9009\u62E9\u4F1A\u8BDD\u3002"));
    }
    await window.mingshen.setSessionBuiltinCapability(selectedSessionId, capabilityId, selected);
    setSessionBuiltinCapabilitiesBySession((current) => ({
      ...current,
      [selectedSessionId]: (current[selectedSessionId] ?? []).map((capability) =>
        capability.id === capabilityId ? { ...capability, selected } : capability,
      ),
    }));
  };

  const requireSelectedWorkspaceSession = (): string => {
    if (!selectedSessionId) throw new Error(tr("请先选择会话。"));
    if (selectedSession?.parentSessionId) {
      throw new Error(tr("SubAgent 不支持运行队列。"));
    }
    return selectedSessionId;
  };

  const addQueuedPromptForCurrentSession = async (
    text: string,
    attachments: ChatAttachmentInput[],
    turnOptions?: ChatTurnOptions,
  ): Promise<QueuedPromptView> => {
    const sessionId = requireSelectedWorkspaceSession();
    const item = await window.mingshen.addQueuedPrompt({
      sessionId,
      text,
      attachments,
      ...(turnOptions?.temporaryInstruction
        ? { temporaryInstruction: turnOptions.temporaryInstruction }
        : {}),
    });
    await loadQueuedPrompts(sessionId);
    return item;
  };

  const updateQueuedPromptForCurrentSession = async (
    itemId: string,
    text: string,
  ): Promise<QueuedPromptView> => {
    const sessionId = requireSelectedWorkspaceSession();
    const item = await window.mingshen.updateQueuedPrompt({ sessionId, itemId, text });
    await loadQueuedPrompts(sessionId);
    return item;
  };

  const replaceQueuedPromptAttachmentsForCurrentSession = async (
    itemId: string,
    text: string,
    attachments: ChatAttachmentInput[],
  ): Promise<QueuedPromptView> => {
    const sessionId = requireSelectedWorkspaceSession();
    const item = await window.mingshen.updateQueuedPrompt({
      sessionId,
      itemId,
      text,
      attachments,
    });
    await loadQueuedPrompts(sessionId);
    return item;
  };

  const beginQueuedPromptEditForCurrentSession = async (itemId: string): Promise<string> => {
    const sessionId = requireSelectedWorkspaceSession();
    return await window.mingshen.beginQueuedPromptEdit(sessionId, itemId);
  };

  const endQueuedPromptEditForCurrentSession = async (
    editId: string,
    abandon?: boolean,
  ): Promise<void> => {
    const sessionId = requireSelectedWorkspaceSession();
    await window.mingshen.endQueuedPromptEdit(sessionId, editId, abandon);
    scheduleQueuedPromptsRefresh(sessionId);
  };

  const removeQueuedPromptForCurrentSession = async (itemId: string): Promise<void> => {
    const sessionId = requireSelectedWorkspaceSession();
    await window.mingshen.removeQueuedPrompt(sessionId, itemId);
    await loadQueuedPrompts(sessionId);
  };

  const resumeQueuedPromptForCurrentSession = async (
    itemId: string,
  ): Promise<QueuedPromptContinueResult> => {
    const sessionId = requireSelectedWorkspaceSession();
    const result = await window.mingshen.continueQueuedPrompt(sessionId, itemId);
    await loadQueuedPrompts(sessionId);
    return result;
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
        className={`app-shell${optical ? " app-shell--orbit" : ""}${agentMode === "chat" ? " app-shell--chat" : ""}`}
        data-agent-mode={agentMode}
        data-layout={layout.mode}
        data-run-state={visualRunState}
      >
        {createPortal(
          <header
            className={`app-topbar${optical ? " app-topbar--orbit" : ""}${agentMode === "chat" ? " app-topbar--chat" : ""}`}
            data-agent-mode={agentMode}
            data-run-state={visualRunState}
            data-app-surface={surface}
          >
            {surface === "conversation" && (!optical || agentMode === "chat") ? (
              <button
                className="icon-button sidebar-toggle"
                type="button"
                aria-label={
                  agentMode === "chat"
                    ? chatSidebarOpen
                      ? tr("收起对话栏")
                      : tr("展开对话栏")
                    : sidebarOpen
                      ? tr("\u6536\u8D77\u4F1A\u8BDD\u680F")
                      : tr("\u5C55\u5F00\u4F1A\u8BDD\u680F")
                }
                title={
                  agentMode === "chat"
                    ? chatSidebarOpen
                      ? tr("收起对话栏")
                      : tr("展开对话栏")
                    : sidebarOpen
                      ? tr("\u6536\u8D77\u4F1A\u8BDD\u680F")
                      : tr("\u5C55\u5F00\u4F1A\u8BDD\u680F")
                }
                onClick={() => {
                  if (agentMode === "chat") setChatSidebarOpen((value) => !value);
                  else setSidebarOpen((value) => !value);
                }}
              >
                {(agentMode === "chat" ? chatSidebarOpen : sidebarOpen) ? (
                  <PanelLeftClose aria-hidden="true" size={17} />
                ) : (
                  <PanelLeftOpen aria-hidden="true" size={17} />
                )}
              </button>
            ) : null}
            <Brand optical={optical} />
            <AgentModeSwitcher
              value={agentMode}
              running={activeTaskRunning}
              onChange={(next) => {
                openSurface("conversation");
                void changeAgentMode(next);
              }}
            />
            <nav
              className="surface-navigation"
              aria-label={locale === "en" ? "Workspaces" : "工作面"}
            >
              <button
                type="button"
                aria-pressed={surface === "conversation"}
                title={locale === "en" ? "Conversations" : "对话工作台"}
                aria-label={locale === "en" ? "Conversations" : "对话工作台"}
                onClick={() => openSurface("conversation")}
              >
                <MessagesSquare size={16} aria-hidden="true" />
                <span>{locale === "en" ? "Conversations" : "对话"}</span>
              </button>
              <button
                type="button"
                data-surface-action="workstation"
                aria-pressed={surface === "workstation"}
                title={locale === "en" ? "Mingshen workstation" : "Mingshen 工作站"}
                aria-label={locale === "en" ? "Mingshen workstation" : "Mingshen 工作站"}
                onClick={() => openSurface("workstation")}
              >
                <PanelsTopLeft size={16} aria-hidden="true" />
                <span>{locale === "en" ? "Workstation" : "工作站"}</span>
              </button>
              <button
                type="button"
                data-surface-action="image-studio"
                aria-pressed={surface === "image-studio"}
                title={locale === "en" ? "Image studio" : "生图工作台"}
                aria-label={locale === "en" ? "Image studio" : "生图工作台"}
                onClick={() => openSurface("image-studio")}
              >
                <Image size={16} aria-hidden="true" />
                <span>{locale === "en" ? "Image studio" : "生图"}</span>
              </button>
            </nav>
            {!optical ? (
              <div className="topbar-session">
                <strong>{selectedSession?.title ?? tr("\u672A\u9009\u62E9\u4F1A\u8BDD")}</strong>
                <span title={agentMode === "chat" ? "ChatAgent" : (currentWorkspace ?? "")}>
                  {agentMode === "chat"
                    ? tr("独立对话")
                    : (currentWorkspace?.split(/[\\/]/).filter(Boolean).at(-1) ??
                      selectedProvider?.name)}
                </span>
              </div>
            ) : null}
            <div className="topbar-actions">
              <button
                className="icon-button"
                type="button"
                title={
                  locale === "en" ? "Command palette (Ctrl+Shift+P)" : "命令面板（Ctrl+Shift+P）"
                }
                aria-label={locale === "en" ? "Command palette" : "命令面板"}
                onClick={() => setPaletteOpen(true)}
              >
                <Command size={16} aria-hidden="true" />
              </button>
              {optical && agentMode !== "chat" ? (
                <span className="orbit-topbar-state" title={visualRunLabel}>
                  <i aria-hidden="true" />
                  <span>{visualRunLabel}</span>
                </span>
              ) : null}
              {!optical && agentMode !== "chat" && surface === "conversation" ? (
                <LayoutPicker value={layout.mode} onChange={changeLayout} />
              ) : null}
              {agentMode !== "chat" ? (
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
              ) : null}
              {!optical && agentMode !== "chat" && surface === "conversation" ? (
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
              {!optical || agentMode === "chat" || surface !== "conversation" ? (
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

        {surfaceError ? (
          <div className="surface-error" role="alert">
            <span>{surfaceError}</span>
            <button type="button" className="link-button" onClick={() => setSurfaceError("")}>
              {tr("关闭")}
            </button>
          </div>
        ) : null}

        {surface === "workstation" ? (
          <div className="app-studio-host" data-app-surface="workstation">
            <CreativeWorkstation
              workspacePath={workspaceSession?.workspacePath ?? null}
              onUseTemplate={applyCreativeTemplate}
            />
          </div>
        ) : null}
        {surface === "image-studio" ? (
          <div className="app-studio-host" data-app-surface="image-studio">
            <ImageStudio
              providers={providers}
              onOpenProviderSettings={() => {
                setSettingsSection("providers");
                setSettingsOpen(true);
              }}
            />
          </div>
        ) : null}

        <div
          hidden={surface !== "conversation"}
          className={[
            "app-body",
            optical ? "app-body--orbit" : "",
            agentMode === "chat" ? "app-body--chat" : "",
            agentMode !== "chat" && workspaceOpen ? "app-body--workspace" : "",
            agentMode !== "chat" && !sidebarOpen ? "app-body--sidebar-collapsed" : "",
            agentMode !== "chat" && sidebarOpen ? "app-body--sidebar-open" : "",
            agentMode === "chat" && !chatSidebarOpen ? "app-body--chat-sidebar-closed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={
            {
              "--sidebar-width": `${layout.sidebarWidth}px`,
              "--inspector-width": `${layout.inspectorWidth}px`,
              "--orbit-task-height-override": layout.taskPanelHeight
                ? `${layout.taskPanelHeight}px`
                : undefined,
            } as CSSProperties
          }
          data-inspector-drawer={inspectorDrawer}
          data-sidebar-drawer={sidebarDrawer}
          data-chat-sidebar-open={chatSidebarOpen}
          data-task-collapsed={taskPanelCollapsed}
        >
          {optical && agentMode !== "chat" ? (
            <>
              <nav
                className="orbit-tool-rail"
                aria-label={locale === "en" ? "Workspace tools" : "工作区工具"}
              >
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
          {agentMode === "chat" && chatSidebarOpen && chatSidebarDrawer ? (
            <button
              className="workbench-drawer-scrim chat-sidebar-scrim"
              type="button"
              aria-label={tr("关闭对话栏")}
              onClick={() => setChatSidebarOpen(false)}
            />
          ) : null}
          {agentMode !== "chat" &&
          ((workspaceOpen && inspectorDrawer) || (sidebarOpen && sidebarDrawer)) ? (
            <button
              className="workbench-drawer-scrim"
              type="button"
              aria-label={tr("关闭面板")}
              onClick={() =>
                workspaceOpen && inspectorDrawer ? setWorkspaceOpen(false) : setSidebarOpen(false)
              }
            />
          ) : null}
          {agentMode === "chat" ? (
            <div className="chat-sidebar-host" hidden={!chatSidebarOpen}>
              <ChatSidebar
                sessions={sessions}
                groups={chatGroups}
                selectedSessionId={chatSessionId}
                onSelect={(sessionId) => {
                  if (chatSidebarDrawer) setChatSidebarOpen(false);
                  void selectSession(sessionId);
                }}
                onNewChat={(groupId) => void createChatSession(groupId)}
                creatingChatSession={creatingChatSession}
                chatSessionError={chatSessionError}
                onLoadSessions={mergeSessions}
                onPatch={patchSession}
                onRemove={removeSessionCascade}
                onCreateGroup={createChatGroup}
                onRenameGroup={renameChatGroup}
                onRemoveGroup={removeChatGroup}
              />
            </div>
          ) : (
            <div className="sidebar-host" hidden={!sidebarOpen}>
              <SessionSidebar
                sessions={sessions.filter((session) => session.agentMode !== "chat")}
                catalogGroups={sessionGroups}
                onLoadSessions={mergeSessions}
                unreadCompletions={completionNotifications?.unread || []}
                selectedSessionId={workbenchSessionId}
                search={search}
                onSearchChange={setSearch}
                onSelect={(sessionId) => void selectSession(sessionId)}
                runs={runsBySession}
                pendingQuestionSessionIds={Object.keys(questionsBySession)}
                onPatch={patchSession}
                onFork={forkSession}
                onRemove={removeSessionCascade}
                onNewSession={openNewSession}
                onNewWorkspaceSession={(path) => void createWorkspaceSession(path)}
                creatingWorkspaceSession={creatingWorkspaceSession}
                workspaceSessionError={workspaceSessionError}
                onCollapse={() => setSidebarOpen(false)}
              />
            </div>
          )}
          {agentMode !== "chat" && sidebarOpen ? (
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
            agentMode={agentMode}
            session={selectedSession}
            providers={providers}
            agentProfiles={agentProfiles}
            extensions={extensions}
            activities={selectedSessionId ? (activitiesBySession[selectedSessionId] ?? []) : []}
            selectedExtensionIds={
              selectedSessionId ? (sessionExtensionsBySession[selectedSessionId] ?? []) : []
            }
            builtinCapabilities={
              selectedSessionId
                ? (sessionBuiltinCapabilitiesBySession[selectedSessionId] ?? [])
                : []
            }
            queuedPrompts={
              selectedSessionId ? (queuedPromptsBySession[selectedSessionId] ?? []) : []
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
            creatingSession={agentMode === "chat" && creatingChatSession}
            onNewSession={() => {
              if (agentMode === "chat") void createChatSession(null);
              else openNewSession(selectedSession?.workspacePath ?? null);
            }}
            onSelectSession={(sessionId) => void selectSession(sessionId)}
            onSend={sendMessage}
            onRewriteMessage={rewriteMessage}
            onModePreparationChange={updateModePreparationLock}
            onStop={stopRun}
            onFork={forkSession}
            onCompact={compactSession}
            onPatch={patchSession}
            onToggleExtension={toggleSessionExtension}
            onToggleBuiltinCapability={toggleSessionBuiltinCapability}
            {...(selectedSession && !selectedSession.parentSessionId
              ? {
                  onAddQueuedPrompt: addQueuedPromptForCurrentSession,
                  onUpdateQueuedPrompt: updateQueuedPromptForCurrentSession,
                  onBeginQueuedPromptEdit: beginQueuedPromptEditForCurrentSession,
                  onEndQueuedPromptEdit: endQueuedPromptEditForCurrentSession,
                  onRemoveQueuedPrompt: removeQueuedPromptForCurrentSession,
                  onReplaceQueuedPromptAttachments: replaceQueuedPromptAttachmentsForCurrentSession,
                  onResumeQueuedPrompt: resumeQueuedPromptForCurrentSession,
                }
              : {})}
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

          {agentMode !== "chat" && workspaceOpen ? (
            <PanelResizeHandle
              side="right"
              value={layout.inspectorWidth}
              min={360}
              max={720}
              onChange={(inspectorWidth) => setLayout({ inspectorWidth })}
            />
          ) : null}
          <div className="inspector-host" hidden={agentMode === "chat" || !workspaceOpen}>
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
                onReviewComment={(text) => appendComposerDraft(text)}
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
          {optical && agentMode !== "chat" && workspaceOpen && !taskPanelCollapsed ? (
            <PanelResizeHandle
              side="bottom"
              value={taskPanelHeight}
              min={160}
              max={taskPanelMaxHeight}
              onChange={(taskPanelHeight) => setLayout({ taskPanelHeight })}
              onReset={() => setLayout({ taskPanelHeight: undefined })}
            />
          ) : null}
          <div
            className={`task-host${optical || (layout.mode === "agents" && workspaceOpen && inspectorView === "tasks") ? " task-host--docked" : ""}`}
            hidden={agentMode === "chat" || (optical && !workspaceOpen)}
          >
            {agentMode !== "chat" && selectedSession ? (
              <TaskWorkbench
                key={selectedSession.id}
                docked={
                  optical ||
                  (layout.mode === "agents" && workspaceOpen && inspectorView === "tasks")
                }
                viewRequest={taskViewRequest}
                onEditingChange={setPlanEditing}
                collapsed={taskPanelCollapsed}
                {...(optical
                  ? {
                      onToggleCollapsed: () =>
                        setLayout({ taskPanelCollapsed: !taskPanelCollapsed }),
                    }
                  : {})}
                onReveal={() => {
                  if (optical && taskPanelCollapsed) setLayout({ taskPanelCollapsed: false });
                }}
                session={selectedSession}
                onDraft={(text) => appendComposerDraft(text)}
                sessions={sessions.filter((session) => session.agentMode !== "chat")}
                activities={activitiesBySession}
                liveBySession={liveBySession}
                onSelect={(sessionId) => void selectSession(sessionId)}
                onOpenFile={(path) => {
                  setInspectorView("workspace");
                  openFileFromConversation(path);
                }}
              />
            ) : agentMode !== "chat" && optical ? (
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

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sessionId={selectedSessionId}
        onOpenFile={(path) => {
          setSurface("conversation");
          openFileFromConversation(path);
        }}
        onSelectSession={(id) => void selectSession(id)}
        onCommand={paletteCommand}
      />

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

      {newSessionOpen && agentMode !== "chat" ? (
        <NewSessionDialog
          providers={providers}
          agentProfiles={agentProfiles}
          initialAgentMode={agentMode}
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
