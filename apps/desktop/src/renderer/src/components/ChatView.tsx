import DOMPurify from "dompurify";
import {
  Archive,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Eye,
  File,
  FilePenLine,
  FileSearch2,
  FileText,
  FolderOpen,
  GitBranch,
  Globe2,
  HardDrive,
  Image,
  ListPlus,
  LoaderCircle,
  Music2,
  Plus,
  Presentation,
  Puzzle,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Slash,
  Sparkles,
  Square,
  SquarePen,
  Table2,
  Terminal,
  Trash2,
  UserRound,
  Video,
  Workflow,
  X,
  XCircle,
} from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { canExtractAttachment } from "../../../shared/attachments";
import type {
  ActivityEvent,
  AgentMode,
  AgentProfileView,
  ApprovalDecision,
  ApprovalRequest,
  AttachmentKind,
  ChatAttachmentInput,
  ContextUsageView,
  CustomCommandView,
  ExtensionImportResult,
  ExtensionView,
  FileChange,
  FileDiff,
  ModelConfig,
  ProviderView,
  QuestionAnswer,
  QuestionRequest,
  RunSummary,
  SessionBuiltinCapabilityView,
  SessionMessage,
  SessionRunState,
  SessionUpdateInput,
  SessionView,
} from "../../../shared/domain";
import {
  MAX_QUEUED_PROMPTS,
  type QueuedPromptContinueResult,
  type QueuedPromptView,
} from "../../../shared/queued-prompt";
import { getLocale, tr, useLocale } from "../i18n/index";
import { runtimeText } from "../i18n/runtime";
import {
  activityDetailsText,
  collectToolDetails,
  toolDetailsForActivity,
  toolDetailsForMessage,
} from "../lib/activity-details";
import { agentLabel } from "../lib/agent-labels";
import { isAllowedChatAttachment, profileSupportsAgentMode } from "../lib/agent-mode-ui";
import type { LiveRun, SessionUsage } from "../lib/chat-types";
import { clipboardImages, namedClipboardImage } from "../lib/clipboard-images";
import type { DraftAttachment } from "../lib/composer-drafts";
import { shouldOpenPastePreview } from "../lib/composer-input";
import { composerMarkdown } from "../lib/composer-markdown";
import { revealPanelItem } from "../lib/floating-panel";
import { formatCount, formatDuration, formatPath } from "../lib/format";
import { orbitTranscript } from "../lib/orbit-transcript";
import {
  type BuiltinCommand,
  parseBuiltinCommand,
  type SlashItem,
  slashItems,
} from "../lib/slash-commands";
import { composerDrafts, useComposerDraft } from "../lib/use-composer-draft";
import { useFloatingPanel } from "../lib/use-floating-panel";
import { AgentQuestionPanel } from "./AgentQuestionPanel";
import { BrandMark } from "./BrandMark";
import { ComposerEditMenu } from "./ComposerEditMenu";
import { ContextMeter } from "./ContextMeter";
import { CopyButton } from "./CopyButton";
import { useDialog } from "./DialogProvider";
import { ExpandableText } from "./ExpandableText";
import { ExtensionPicker } from "./ExtensionPicker";
import { MarkdownLite } from "./MarkdownLite";
import { ModelPicker } from "./ModelPicker";
import { QuestionNavigator } from "./QuestionNavigator";
import { QueuedPromptTray } from "./QueuedPromptTray";
import { RenameSessionDialog } from "./RenameSessionDialog";
import { ToolCallDetails } from "./ToolCallDetails";
import { useUiPreferences } from "./UiPreferences";

interface ChatViewProps {
  notificationDraft?: { sessionId: string; text: string; error: string; id: string } | null;
  compact?: boolean;
  agentMode: AgentMode;
  session: SessionView | null;
  providers: ProviderView[];
  agentProfiles: AgentProfileView[];
  extensions: ExtensionView[];
  selectedExtensionIds: string[];
  builtinCapabilities?: SessionBuiltinCapabilityView[];
  queuedPrompts?: QueuedPromptView[];
  messages: SessionMessage[];
  live: LiveRun | null;
  allLive: Record<string, LiveRun>;
  runState: SessionRunState | null;
  usage: SessionUsage | null;
  context: ContextUsageView | null;
  sessions: SessionView[];
  allActivities: Record<string, ActivityEvent[]>;
  activities: ActivityEvent[];
  approval: ApprovalRequest | null;
  question: QuestionRequest | null;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onSend: (
    text: string,
    attachments: ChatAttachmentInput[],
    draftRevision: string,
  ) => Promise<void>;
  onRewriteMessage: (messageId: string, text: string) => Promise<void>;
  onModePreparationChange: (sessionId: string, preparing: boolean) => void;
  onStop: () => Promise<void>;
  onFork: (sessionId: string) => Promise<void>;
  onCompact: (sessionId: string) => Promise<unknown>;
  onPatch: (input: SessionUpdateInput) => Promise<SessionView>;
  onToggleExtension: (extensionId: string, enabled: boolean) => Promise<void>;
  onToggleBuiltinCapability?: (capabilityId: string, selected: boolean) => Promise<void>;
  onAddQueuedPrompt?: (
    text: string,
    attachments: ChatAttachmentInput[],
  ) => Promise<QueuedPromptView>;
  onUpdateQueuedPrompt?: (itemId: string, text: string) => Promise<QueuedPromptView>;
  onBeginQueuedPromptEdit?: (itemId: string) => Promise<string>;
  onEndQueuedPromptEdit?: (editId: string, abandon?: boolean) => Promise<void>;
  onRemoveQueuedPrompt?: (itemId: string) => Promise<void>;
  onReplaceQueuedPromptAttachments?: (
    itemId: string,
    text: string,
    attachments: ChatAttachmentInput[],
  ) => Promise<QueuedPromptView>;
  onResumeQueuedPrompt?: (itemId: string) => Promise<QueuedPromptContinueResult>;
  onImportExtensions: () => Promise<ExtensionImportResult | null>;
  onOpenSettings: (section?: "permissions" | "context" | "extensions" | "mcp" | "project") => void;
  onOpenWorkspace: () => void;
  onOpenFile: (path: string) => void;
  onSyncPending: () => Promise<void>;
  onApprovalDecision: (decision: ApprovalDecision) => Promise<void>;
  onQuestionAnswer: (input: QuestionAnswer) => Promise<void>;
}

type ToolDetail = NonNullable<ReturnType<typeof toolDetailsForMessage>>;
const noActiveToolDetails: ReadonlySet<ToolDetail> = new Set();

function attachmentKindFromFile(file: File): AttachmentKind {
  if (file.type.startsWith("image/")) {
    return "image";
  }
  if (file.type.startsWith("audio/")) {
    return "audio";
  }
  if (file.type.startsWith("video/")) {
    return "video";
  }
  return "file";
}

function attachmentKindModality(kind: AttachmentKind): "image" | "audio" | "video" | "file" {
  return kind;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error(tr("\u65E0\u6CD5\u8BFB\u53D6 {0}", [file.name])));
    reader.readAsDataURL(file);
  });
}

async function prepareChatAttachment(
  file: File,
  kind: AttachmentKind,
  allowLocalPath: boolean,
  dataUrl?: string,
  path?: string,
): Promise<ChatAttachmentInput> {
  const resolvedDataUrl = dataUrl ?? (await readFileAsDataUrl(file));
  const fileWithPath = file as File & { path?: string };
  const localPath = allowLocalPath ? (path ?? fileWithPath.path) : undefined;
  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    kind,
    dataUrl: resolvedDataUrl,
    ...(localPath ? { path: localPath } : {}),
  };
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KiB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

function OrbitMessageMeta({
  user = false,
  child,
  createdAt,
  generating = false,
}: {
  user?: boolean;
  child: boolean;
  createdAt?: string | number;
  generating?: boolean;
}) {
  const timestamp = createdAt === undefined ? Number.NaN : new Date(createdAt).getTime();
  const time = Number.isFinite(timestamp) ? new Date(timestamp) : null;
  return (
    <div className="message__meta orbit-message-meta">
      {user ? (
        <span className="orbit-user-avatar" aria-hidden="true">
          <UserRound size={14} />
        </span>
      ) : (
        <BrandMark className="orbit-message-mark" size={24} />
      )}
      <span className="orbit-message-author">{user ? tr("你") : "Mingshen"}</span>
      {!user ? (
        <span className="orbit-agent-role">{tr(child ? "子 Agent" : "主 Agent")}</span>
      ) : null}
      {generating ? <span className="orbit-message-generating">{tr("生成中")}</span> : null}
      {time ? (
        <time dateTime={time.toISOString()} title={time.toLocaleString(getLocale())}>
          {time.toLocaleTimeString(getLocale(), {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </time>
      ) : null}
    </div>
  );
}

export function ChatView({
  notificationDraft,
  compact = false,
  agentMode,
  session,
  providers,
  agentProfiles,
  extensions,
  selectedExtensionIds,
  builtinCapabilities = [],
  queuedPrompts = [],
  messages,
  live,
  runState,
  usage,
  context,
  activities,
  approval,
  question,
  onNewSession,
  onSelectSession,
  onSend,
  onRewriteMessage,
  onModePreparationChange,
  onStop,
  onFork,
  onCompact,
  onPatch,
  onToggleExtension,
  onToggleBuiltinCapability = async () => undefined,
  onAddQueuedPrompt,
  onUpdateQueuedPrompt,
  onBeginQueuedPromptEdit,
  onEndQueuedPromptEdit,
  onRemoveQueuedPrompt,
  onReplaceQueuedPromptAttachments,
  onResumeQueuedPrompt,
  onImportExtensions,
  onOpenSettings,
  onOpenWorkspace,
  onOpenFile,
  onSyncPending,
  onApprovalDecision,
  onQuestionAnswer,
}: ChatViewProps) {
  const { confirm } = useDialog();
  const { activeStyle, preferences } = useUiPreferences();
  const orbit = activeStyle === "orbit";
  const sessionId = session?.id ?? null;
  const chatMode = agentMode === "chat" || session?.agentMode === "chat";
  const workStarters = orbit && !compact && !chatMode && agentMode === "work";
  const draftState = useComposerDraft(sessionId);
  const draft = draftState.value.text;
  const attachments = draftState.value.attachments;
  const formattedDraft = draftState.value.formatted ? draft : null;
  const previewFocusRequested = useRef(false);
  const setDraft = useCallback(
    (next: SetStateAction<string>) => {
      previewFocusRequested.current = false;
      if (!sessionId) return;
      composerDrafts.update(sessionId, (current) => ({
        ...current,
        text: typeof next === "function" ? next(current.text) : next,
        formatted: false,
      }));
    },
    [sessionId],
  );
  const setFormattedDraft = useCallback(
    (text: string | null) => {
      if (!sessionId) return;
      composerDrafts.update(sessionId, (current) =>
        current.formatted === (text !== null && text === current.text)
          ? current
          : { ...current, formatted: text !== null && text === current.text },
      );
    },
    [sessionId],
  );
  const setAttachments = useCallback(
    (next: SetStateAction<DraftAttachment[]>) => {
      if (!sessionId) return;
      composerDrafts.update(sessionId, (current) => ({
        ...current,
        attachments: typeof next === "function" ? next(current.attachments) : next,
      }));
    },
    [sessionId],
  );
  // A paste only opens preview when the matching input event arrives immediately after it.
  // Consuming the flag here prevents a stale paste from moving later typing into preview.
  const pasteWaitingRef = useRef(false);
  const previewRef = useRef<HTMLElement>(null);
  const previewRequested =
    preferences.composerRichPaste && Boolean(draft) && formattedDraft === draft;
  const previewHtml = useMemo(() => {
    if (!previewRequested) return null;
    const html = composerMarkdown(draft);
    return html === null
      ? null
      : DOMPurify.sanitize(html, {
          USE_PROFILES: { html: true },
          FORBID_TAGS: ["img", "style", "audio", "video", "source", "iframe", "form"],
          FORBID_ATTR: ["href", "src", "srcset", "autofocus", "tabindex"],
        });
  }, [draft, previewRequested]);
  const formatted = previewHtml !== null;
  const [editMenu, setEditMenu] = useState<{ x: number; y: number } | null>(null);
  const closeEditMenu = useCallback(() => setEditMenu(null), []);
  const [dragActive, setDragActive] = useState(false);
  const [sending, setSending] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [sendingStartedAt, setSendingStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryResult, setMemoryResult] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [approvalFeedback, setApprovalFeedback] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [dismissedApprovalId, setDismissedApprovalId] = useState<string | null>(null);
  const questionId = question?.id ?? null;
  const [commands, setCommands] = useState<CustomCommandView[]>([]);
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [contextOpenRequest, setContextOpenRequest] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const choices =
    chatMode || formatted || slashDismissed === draft
      ? null
      : slashItems(draft, commands, extensions);
  const scrollRef = useRef<HTMLElement>(null);
  const followOutputRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollActionsRef = useRef<{ jumpTo: (top: number, follow: boolean) => void } | null>(null);
  const [followingOutput, setFollowingOutput] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!draftState.ready) return;
    const field = textareaRef.current;
    if (formatted && previewFocusRequested.current) {
      previewRef.current?.focus({ preventScroll: true });
    } else if (!formatted && field && document.activeElement === document.body) {
      field.focus({ preventScroll: true });
    }
    previewFocusRequested.current = false;
    if (!formatted && field) {
      field.style.height = "auto";
      field.style.height = `${Math.min(240, field.scrollHeight)}px`;
    }
  }, [formatted, draftState.ready]);
  const submittedApprovalRef = useRef<{ id: string } | null>(null);
  const approvalId = approval?.id ?? null;
  const approvalIdRef = useRef(approvalId);
  approvalIdRef.current = approvalId;
  const waitingForRequest = session?.status === "waiting_approval" && !approval && !question;
  const selectedModel = providers
    .find((provider) => provider.id === session?.providerId)
    ?.models.find((model) => model.id === session?.modelId);
  const toolDetails = useMemo(() => collectToolDetails(messages), [messages]);
  const transcript = useMemo(
    () =>
      orbit
        ? orbitTranscript(messages)
        : messages.map((message, index) => ({
            messages: [message],
            execution: false,
            showAssistantHeader:
              message.role === "assistant" && (index === 0 || messages[index - 1]?.role === "user"),
          })),
    [messages, orbit],
  );
  const incompatibleAttachments = attachments.filter(
    (attachment) =>
      !selectedModel?.inputModalities.includes(attachmentKindModality(attachment.kind)) &&
      !(
        attachment.kind === "file" &&
        canExtractAttachment(attachment.file.name, attachment.file.type)
      ),
  );
  const effectiveSessionAgentMode =
    session?.agentMode === "work" || agentMode === "work" ? "work" : "code";
  const availableAgentProfiles = agentProfiles.filter(
    (profile) => profile.enabled && profileSupportsAgentMode(profile, effectiveSessionAgentMode),
  );
  const selectedExtensions = selectedExtensionIds
    .map((id) => extensions.find((extension) => extension.id === id))
    .filter((extension): extension is ExtensionView => Boolean(extension?.enabled) && !chatMode);
  const selectedBuiltinCapabilities = chatMode
    ? []
    : builtinCapabilities.filter((capability) => capability.selected);
  const queuedPromptActionsAvailable = Boolean(
    session &&
      !session.parentSessionId &&
      onUpdateQueuedPrompt &&
      onBeginQueuedPromptEdit &&
      onEndQueuedPromptEdit &&
      onRemoveQueuedPrompt &&
      onReplaceQueuedPromptAttachments &&
      onResumeQueuedPrompt,
  );
  const mentionMatch = chatMode ? null : /(?:^|\s)@([^\s]*)$/.exec(draft);
  const mentionQuery = formatted ? null : (mentionMatch?.[1]?.toLocaleLowerCase("zh-CN") ?? null);
  const commandPosition = useFloatingPanel(Boolean(choices), textareaRef, slashMenuRef, {
    maxHeight: 360,
    preferAbove: true,
    anchorComposer: true,
  });
  const mentionPosition = useFloatingPanel(mentionQuery !== null, textareaRef, mentionMenuRef, {
    maxHeight: 300,
    preferAbove: true,
    anchorComposer: true,
  });
  const running =
    session?.status === "running" || session?.status === "waiting_approval" || Boolean(live);
  const activeToolDetails = useMemo(() => {
    if (!running || activities.length === 0) return noActiveToolDetails;
    const calls = new Set<ToolDetail>();
    for (const activity of activities) {
      const call = toolDetailsForActivity(activity, toolDetails);
      if (call) calls.add(call);
    }
    return calls;
  }, [running, activities, toolDetails]);

  useEffect(() => {
    const panel = slashMenuRef.current;
    const item = panel?.querySelector<HTMLElement>(`[data-index="${slashIndex}"]`);
    if (panel && item) revealPanelItem(panel, item);
  }, [slashIndex]);

  const restoredNotificationDraftRef = useRef<string | null>(null);
  useEffect(() => {
    if (!running && !sending) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, sending]);

  useEffect(() => {
    setFollowingOutput(true);
    if (!session?.id) return;
    const element = scrollRef.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    let previousTop = element.scrollTop;
    let touchY: number | null = null;
    followOutputRef.current = true;
    const updatePosition = () => {
      setFollowingOutput(followOutputRef.current);
    };
    const cancelScroll = () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
    const pauseFollowing = () => {
      if (element.scrollHeight - element.clientHeight <= 8) return;
      followOutputRef.current = false;
      cancelScroll();
      updatePosition();
    };
    const follow = () => {
      if (!followOutputRef.current || scrollFrameRef.current !== null) return;
      if (content.querySelector(".conversation-empty")) return;
      if (element.scrollHeight - element.clientHeight - element.scrollTop <= 0) {
        updatePosition();
        return;
      }
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        if (!followOutputRef.current) return;
        if (content.querySelector(".conversation-empty")) return;
        previousTop = Math.max(0, element.scrollHeight - element.clientHeight);
        element.scrollTop = previousTop;
        updatePosition();
      });
    };
    scrollActionsRef.current = {
      jumpTo: (top, following) => {
        cancelScroll();
        followOutputRef.current = following;
        element.scrollTo({ top: Math.max(0, top), behavior: "instant" });
        // History navigation must retain its explicitly paused follow state.
        previousTop = element.scrollTop;
        updatePosition();
      },
    };
    const onScroll = () => {
      const top = element.scrollTop;
      const bottom = Math.max(0, element.scrollHeight - element.clientHeight);
      const atBottom = bottom - top <= 8;
      // Content shrinking can clamp scrollTop without any upward reading gesture.
      if (top < previousTop - 1 && previousTop <= bottom + 1) pauseFollowing();
      else if (atBottom && (followOutputRef.current || top > previousTop + 1)) {
        followOutputRef.current = true;
        follow();
      }
      previousTop = top;
      updatePosition();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) pauseFollowing();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable=true]")) return;
      if (target === element && ["Home", "End", "PageUp", "PageDown"].includes(event.key)) {
        event.preventDefault();
        const bottom = Math.max(0, element.scrollHeight - element.clientHeight);
        const top =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? bottom
              : element.scrollTop + element.clientHeight * (event.key === "PageUp" ? -0.9 : 0.9);
        scrollActionsRef.current?.jumpTo(top, event.key === "End");
        return;
      }
      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.shiftKey && event.key === " ")
      )
        pauseFollowing();
    };
    const onDisclosure = (event: MouseEvent) => {
      if (
        (event.target as HTMLElement | null)?.closest(
          "summary, .activity-trail__current-main, .activity-trail__current-toggle, .activity-row__diff-toggle",
        )
      ) {
        followOutputRef.current = false;
        cancelScroll();
        updatePosition();
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const next = event.touches[0]?.clientY ?? null;
      if (next !== null && touchY !== null && next > touchY) pauseFollowing();
      touchY = next;
    };
    const resetTouch = () => {
      touchY = null;
    };
    // Observe actual layout growth, including streaming, tool records and loaded images.
    const observer = new ResizeObserver(() => {
      if (followOutputRef.current) follow();
      else updatePosition();
    });
    observer.observe(content);
    observer.observe(element);
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: true });
    element.addEventListener("keydown", onKey);
    element.addEventListener("click", onDisclosure, true);
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: true });
    element.addEventListener("touchend", resetTouch, { passive: true });
    element.addEventListener("touchcancel", resetTouch, { passive: true });
    follow();
    return () => {
      scrollActionsRef.current = null;
      cancelScroll();
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("click", onDisclosure, true);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", resetTouch);
      element.removeEventListener("touchcancel", resetTouch);
    };
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) {
      return;
    }
    setError(null);
    restoredNotificationDraftRef.current = null;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [session?.id]);
  useEffect(() => {
    if (!draftState.ready || notificationDraft?.sessionId !== sessionId || !notificationDraft)
      return;
    if (restoredNotificationDraftRef.current === notificationDraft.id) return;
    restoredNotificationDraftRef.current = notificationDraft.id;
    composerDrafts.update(sessionId, (current) =>
      current.notificationDraftIds.includes(notificationDraft.id)
        ? current
        : {
            ...current,
            text: current.text
              ? `${current.text}\n${notificationDraft.text}`
              : notificationDraft.text,
            formatted: false,
            notificationDraftIds: [...current.notificationDraftIds, notificationDraft.id].slice(
              -128,
            ),
          },
    );
    void composerDrafts
      .flush(sessionId)
      .then(() => window.mingshen.acknowledgeNotificationDraft(notificationDraft.id))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    setError(notificationDraft.error);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [notificationDraft, sessionId, draftState.ready]);
  useEffect(
    () =>
      window.mingshen.onDesktopEvent((event) => {
        if (event.type === "composer-draft-error") setError(event.error ?? tr("草稿保存失败。"));
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    if (!session?.id || chatMode) {
      setCommands([]);
      return;
    }
    void window.mingshen
      .listCustomCommands(session.workspacePath)
      .then((items) => {
        if (!cancelled) {
          setCommands(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommands([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chatMode, session?.id, session?.workspacePath]);

  useEffect(() => {
    if (approvalId) {
      setApprovalFeedback("");
      setApprovalError(null);
    }
    submittedApprovalRef.current = null;
    setDismissedApprovalId(null);
    setApprovalBusy(false);
  }, [approvalId]);

  useEffect(() => {
    if (approvalId || questionId || waitingForRequest) {
      if (composerWrapRef.current) composerWrapRef.current.scrollTop = 0;
    }
  }, [approvalId, questionId, waitingForRequest]);

  useEffect(() => {
    if (!dismissedApprovalId || dismissedApprovalId !== approvalId) return;
    const timer = window.setTimeout(() => {
      submittedApprovalRef.current = null;
      setDismissedApprovalId(null);
      setApprovalBusy(false);
      setApprovalError(tr("审批提交尚未确认，可重试或刷新请求。"));
      void onSyncPending().catch(() => undefined);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [approvalId, dismissedApprovalId, onSyncPending]);

  useEffect(() => {
    if (waitingForRequest) void onSyncPending().catch(() => undefined);
  }, [waitingForRequest, onSyncPending]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (!sessionId || !composerDrafts.state(sessionId).ready || files.length === 0) {
        return;
      }
      if (chatMode) {
        const unsupported = files.filter((file) => !isAllowedChatAttachment(file));
        if (unsupported.length > 0) {
          setError(
            tr(
              "ChatAgent 仅支持 PNG/JPEG/WebP/GIF/BMP/TIFF/AVIF 图片，以及 PDF、DOC/DOCX、XLS/XLSX、PPTX：{0}",
              [unsupported.map((file) => file.name).join("、")],
            ),
          );
          return;
        }
      }
      const oversized = files.find((file) => file.size > 25 * 1024 * 1024);
      if (oversized) {
        setError(
          tr(
            "\u9644\u4EF6\u300C{0}\u300D\u8D85\u8FC7\u5355\u6587\u4EF6 25 MiB \u9650\u5236\u3002",
            [oversized.name],
          ),
        );
        return;
      }
      setError(null);
      void composerDrafts
        .load(sessionId)
        .then(() =>
          setAttachments((current) => {
            const existing = new Set(current.map((item) => `${item.file.name}:${item.file.size}`));
            const next = files
              .filter((file) => !existing.has(`${file.name}:${file.size}`))
              .map((file) => ({
                id: crypto.randomUUID(),
                file,
                kind: attachmentKindFromFile(file),
              }));
            return [...current, ...next];
          }),
        )
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : String(cause)),
        );
    },
    [chatMode, sessionId, setAttachments],
  );

  useEffect(() => {
    let dragDepth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      dragDepth += 1;
      setDragActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setDragActive(false);
      }
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      dragDepth = 0;
      setDragActive(false);
      addFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  const jumpToQuestion = (messageId: string) => {
    const scroll = scrollRef.current;
    const target = [
      ...(scroll?.querySelectorAll<HTMLElement>(".message--user[data-message-id]") ?? []),
    ].find((element) => element.dataset.messageId === messageId);
    if (!scroll || !target) return;
    const top =
      scroll.scrollTop +
      target.getBoundingClientRect().top -
      scroll.getBoundingClientRect().top -
      20;
    scrollActionsRef.current?.jumpTo(top, false);
  };

  if (!session) {
    return (
      <main
        className={`chat-view chat-view--empty${chatMode ? " chat-view--conversation" : ""}${compact ? " chat-view--quick" : ""}`}
        data-agent-mode={agentMode}
      >
        <div className="empty-work">
          <h1>{tr(chatMode ? "开始一段对话" : "\u5F00\u59CB\u4E00\u9879\u5DE5\u4F5C")}</h1>
          <p>
            {tr(
              chatMode
                ? "选择已有对话，或新建一段独立对话。可以上传资料做只读问答，也可以联网搜索公开信息。"
                : "\u9009\u62E9\u5DF2\u6709\u4F1A\u8BDD\uFF0C\u6216\u8BA9 Mingshen \u8FDB\u5165\u4E00\u4E2A\u672C\u5730\u5DE5\u4F5C\u76EE\u5F55\u3002",
            )}
          </p>
          <button className="btn btn--primary" type="button" onClick={onNewSession}>
            <Plus aria-hidden="true" size={16} />
            {tr(chatMode ? "新建对话" : "\u65B0\u5EFA\u4F1A\u8BDD")}
          </button>
        </div>
      </main>
    );
  }

  const send = async () => {
    if (!draftState.ready) return;
    const submitted = composerDrafts.state(session.id).value;
    const text = submitted.text.trim();
    if ((!text && submitted.attachments.length === 0) || sending || running) {
      return;
    }
    const builtin = chatMode ? null : parseBuiltinCommand(text);
    if (builtin) {
      if (attachments.length) {
        setError(tr("请先移除附件，再执行聊天命令。"));
        return;
      }
      await executeBuiltin(builtin.command, builtin.argument);
      return;
    }
    if (!selectedModel) {
      setError(tr("\u8BF7\u5148\u4E3A\u5F53\u524D\u4F1A\u8BDD\u9009\u62E9\u6A21\u578B\u3002"));
      return;
    }
    if (incompatibleAttachments.length > 0) {
      setError(
        tr(
          "\u5F53\u524D\u6A21\u578B\u4E0D\u652F\u6301\u4EE5\u4E0B\u9644\u4EF6\u7C7B\u578B\uFF1A{0}",
          [incompatibleAttachments.map((attachment) => attachment.file.name).join("、")],
        ),
      );
      return;
    }

    setSending(true);
    setSendingStartedAt(Date.now());
    setError(null);
    onModePreparationChange(session.id, true);
    try {
      await composerDrafts.flush(session.id);
      const preparedAttachments = await Promise.all(
        submitted.attachments.map((attachment) =>
          prepareChatAttachment(
            attachment.file,
            attachment.kind,
            !chatMode,
            attachment.dataUrl,
            attachment.path,
          ),
        ),
      );
      await onSend(text, preparedAttachments, submitted.revision);
      await composerDrafts.accepted(session.id, submitted.revision);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      onModePreparationChange(session.id, false);
      setSending(false);
      setSendingStartedAt(null);
    }
  };

  const queueCurrentDraft = async () => {
    if (
      !onAddQueuedPrompt ||
      session.parentSessionId ||
      !draftState.ready ||
      queueing ||
      sending ||
      !running ||
      queuedPrompts.length >= MAX_QUEUED_PROMPTS
    ) {
      return;
    }
    const submitted = composerDrafts.state(session.id).value;
    const text = submitted.text.trim();
    if (!text && submitted.attachments.length === 0) return;
    if (!selectedModel) {
      setError(tr("请先为当前会话选择模型。"));
      return;
    }
    if (incompatibleAttachments.length > 0) {
      setError(
        tr("当前模型不支持以下附件类型：{0}", [
          incompatibleAttachments.map((attachment) => attachment.file.name).join("、"),
        ]),
      );
      return;
    }
    if (!chatMode && parseBuiltinCommand(text)) {
      setError(tr("聊天命令不能加入下一轮队列。"));
      return;
    }

    setQueueing(true);
    setError(null);
    try {
      await composerDrafts.flush(session.id);
      const preparedAttachments = await Promise.all(
        submitted.attachments.map((attachment) =>
          prepareChatAttachment(
            attachment.file,
            attachment.kind,
            !chatMode,
            attachment.dataUrl,
            attachment.path,
          ),
        ),
      );
      await onAddQueuedPrompt(text, preparedAttachments);
      await composerDrafts.clearIfCurrent(session.id, submitted.revision);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      textareaRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setQueueing(false);
    }
  };

  const replaceQueuedAttachments = async (itemId: string, text: string, files: File[]) => {
    if (!onReplaceQueuedPromptAttachments || !files.length) return;
    if (!selectedModel) {
      throw new Error(tr("请先为当前会话选择模型。"));
    }
    const oversized = files.find((file) => file.size > 25 * 1024 * 1024);
    if (oversized) {
      throw new Error(tr("附件「{0}」超过单文件 25 MiB 限制。", [oversized.name]));
    }
    if (chatMode) {
      const unsupported = files.find(
        (file) => !isAllowedChatAttachment({ name: file.name, type: file.type }),
      );
      if (unsupported) {
        throw new Error(tr("ChatAgent 不支持附件「{0}」。", [unsupported.name]));
      }
    }
    const unsupported = files.find((file) => {
      const kind = attachmentKindFromFile(file);
      return (
        !selectedModel.inputModalities.includes(attachmentKindModality(kind)) &&
        !(kind === "file" && canExtractAttachment(file.name, file.type))
      );
    });
    if (unsupported) {
      throw new Error(tr("当前模型不支持以下附件类型：{0}", [unsupported.name]));
    }
    const prepared = await Promise.all(
      files.map((file) => prepareChatAttachment(file, attachmentKindFromFile(file), !chatMode)),
    );
    await onReplaceQueuedPromptAttachments(itemId, text, prepared);
  };

  const executeBuiltin = async (command: BuiltinCommand, argument = "") => {
    if (!draftState.ready) return;
    const submittedRevision = composerDrafts.state(session.id).value.revision;
    setSlashIndex(0);
    if (sending) return;
    if (running && !["status", "skills", "plugins", "mcp"].includes(command)) {
      setError(tr("请等待当前任务完成或停止后再执行此命令。"));
      return;
    }
    if (attachments.length) {
      setError(tr("请先移除附件，再执行聊天命令。"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      switch (command) {
        case "remember":
        case "forget":
        case "memory":
          if (command === "memory" && !argument) {
            onOpenSettings("project");
            break;
          }
          if (!argument) {
            setDraft(`/${command} `);
            textareaRef.current?.focus();
            return;
          }
          if (
            command === "forget" &&
            !(await confirm({
              title: tr("删除项目记忆？"),
              description: argument,
              confirmLabel: tr("删除"),
              tone: "danger",
            }))
          )
            return;
          setMemoryResult(
            await window.mingshen.projectMemoryCommand(session.id, `/${command} ${argument}`),
          );
          break;
        case "compact":
          await onCompact(session.id);
          break;
        case "fork":
          await onFork(session.id);
          break;
        case "rename":
          if (argument) await onPatch({ sessionId: session.id, title: argument });
          else setRenameOpen(true);
          break;
        case "archive":
          if (
            !(await confirm({
              title: tr("归档当前聊天？"),
              description: tr("聊天将从侧栏隐藏，可随时从设置中的已归档会话恢复。"),
              confirmLabel: tr("归档"),
            }))
          )
            return;
          await onPatch({ sessionId: session.id, archived: true });
          break;
        case "status":
          setContextOpenRequest((value) => value + 1);
          break;
        case "skills":
        case "plugins":
          setDraft(`/${command} `);
          return;
        case "mcp":
          onOpenSettings("mcp");
          break;
        case "plan": {
          const plan = agentProfiles.find((profile) => profile.enabled && profile.role === "plan");
          if (!plan) throw new Error(tr("没有已启用的计划 Agent，请在设置中启用。"));
          await onPatch({ sessionId: session.id, agentProfileId: plan.id });
          break;
        }
      }
      await composerDrafts.clearIfCurrent(session.id, submittedRevision);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const selectSlashItem = async (item: SlashItem) => {
    setSlashIndex(0);
    if (item.kind === "builtin" && item.command) {
      await executeBuiltin(item.command);
      return;
    }
    if (item.kind === "custom") {
      setDraft(`${item.name} `);
      textareaRef.current?.focus();
      return;
    }
    if (item.kind === "manage") {
      setDraft("");
      onOpenSettings("extensions");
      return;
    }
    if (item.extension) {
      const submittedRevision = composerDrafts.state(session.id).value.revision;
      setSending(true);
      setError(null);
      try {
        await onToggleExtension(
          item.extension.id,
          !selectedExtensionIds.includes(item.extension.id),
        );
        await composerDrafts.clearIfCurrent(session.id, submittedRevision);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSending(false);
        textareaRef.current?.focus();
      }
    }
  };

  const decideApproval = async (decision: ApprovalDecision["decision"], rememberForMs?: number) => {
    if (!approval) {
      return;
    }
    if (submittedApprovalRef.current?.id === approval.id) {
      return;
    }
    if (
      decision === "full_access" &&
      !(await confirm({
        title: tr("将此项目切换为完全访问？"),
        description: tr(
          "当前任务和同一工作目录内的会话将立即使用完全访问，后续新会话也会继承。Agent 可直接读写文件和执行命令；致命命令保护仍然生效。",
        ),
        confirmLabel: tr("切换为完全访问"),
        tone: "danger",
      }))
    )
      return;
    if (approvalIdRef.current !== approval.id || submittedApprovalRef.current?.id === approval.id)
      return;
    const submission = { id: approval.id };
    submittedApprovalRef.current = submission;
    setDismissedApprovalId(approval.id);
    setApprovalBusy(true);
    setApprovalError(null);
    try {
      await onApprovalDecision({
        approvalId: approval.id,
        decision,
        ...(decision === "deny" && approvalFeedback.trim()
          ? { feedback: approvalFeedback.trim() }
          : {}),
        ...(rememberForMs ? { rememberForMs } : {}),
      });
      if (submittedApprovalRef.current === submission) setApprovalFeedback("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (
        submittedApprovalRef.current === submission &&
        approvalIdRef.current === approval.id &&
        !message.includes("已经处理")
      ) {
        submittedApprovalRef.current = null;
        setDismissedApprovalId(null);
        setApprovalBusy(false);
        setApprovalError(message);
      }
    } finally {
      if (submittedApprovalRef.current === submission) setApprovalBusy(false);
    }
  };

  const automaticApproval = async () => {
    const requestId = approvalId;
    setApprovalBusy(true);
    setApprovalError(null);
    try {
      await window.mingshen.startAutomaticApproval(session.id);
    } catch (cause) {
      if (approvalIdRef.current !== requestId) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("APPROVAL_MODEL_REQUIRED")) {
        const open = await confirm({
          title: tr("请先配置审批模型"),
          description: tr(
            "自动审批需要一个可用的供应商和模型。请在设置的权限与安全中选择并保存审批模型。",
          ),
          confirmLabel: tr("打开设置"),
        });
        if (open) onOpenSettings("permissions");
      } else setApprovalError(message);
    } finally {
      if (approvalIdRef.current === requestId) setApprovalBusy(false);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (choices) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSlashDismissed(draft);
        return;
      }
      if (["ArrowDown", "ArrowUp"].includes(event.key) && choices.length) {
        event.preventDefault();
        setSlashIndex(
          (index) =>
            (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length,
        );
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        const item = choices[slashIndex] ?? choices[0];
        if (item) void selectSlashItem(item);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const editDraft = () => {
    flushSync(() => setFormattedDraft(null));
    textareaRef.current?.focus({ preventScroll: true });
  };
  const onPreviewKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (sending) return;
    if ((event.ctrlKey || event.metaKey) && ["a", "x"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      editDraft();
      if (event.key.toLowerCase() === "a") textareaRef.current?.select();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      editDraft();
      return;
    }
    // Focus the mounted native editor before the browser handles text/IME/undo.
    if (
      event.key.length === 1 ||
      ["Backspace", "Delete", "Enter", "Process", "Unidentified"].includes(event.key) ||
      event.keyCode === 229
    ) {
      if (
        (event.ctrlKey || event.metaKey) &&
        !["z", "y", "x", "v"].includes(event.key.toLowerCase())
      )
        return;
      editDraft();
    }
  };

  const changeModel = async (
    selection: { providerId: string; configId: string },
    next: ModelConfig,
  ) => {
    const nextReasoning =
      next.reasoningLevels.find((level) => level === session.reasoningLevel && level !== "none") ??
      next.reasoningLevels.find((level) => level !== "none") ??
      next.reasoningLevels[0] ??
      null;
    try {
      await onPatch({
        sessionId: session.id,
        providerId: selection.providerId,
        modelId: selection.configId,
        reasoningLevel: nextReasoning,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const changeReasoningIndex = async (index: number) => {
    const levels = selectedModel?.reasoningLevels ?? [];
    const level = levels[index] ?? null;
    try {
      await onPatch({ sessionId: session.id, reasoningLevel: level });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const chooseWorkspace = async () => {
    const path = await window.mingshen.chooseWorkspace();
    if (!path) {
      return;
    }
    try {
      if (!(await window.mingshen.getProjectTrust(path))) {
        const trusted = await confirm({
          title: tr("\u662F\u5426\u4FE1\u4EFB\u6B64\u5DE5\u4F5C\u76EE\u5F55"),
          description: tr(
            "\u4FE1\u4EFB\u540E\u5141\u8BB8\u9879\u76EE\u7EA7 AGENTS.md\u3001\u63D2\u4EF6 MCP \u548C\u663E\u5F0F\u542F\u7528\u7684 Shell Hook \u5728\u6B64\u76EE\u5F55\u8FD0\u884C\u3002\u6587\u4EF6\u64CD\u4F5C\u4ECD\u9075\u5B88\u5F53\u524D\u6743\u9650\u6A21\u5F0F\u3002",
          ),

          confirmLabel: tr("\u4FE1\u4EFB\u9879\u76EE"),
          cancelLabel: tr("\u6682\u4E0D\u4FE1\u4EFB"),
        });
        if (trusted) {
          await window.mingshen.setProjectTrust(path, true);
        }
      }
      await onPatch({ sessionId: session.id, workspacePath: path });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const reasoningLevels = selectedModel?.reasoningLevels ?? [];
  const reasoningIndex = Math.max(
    0,
    reasoningLevels.indexOf(session.reasoningLevel ?? reasoningLevels[0] ?? ""),
  );
  const startedAt =
    sending && !running
      ? sendingStartedAt
      : runState
        ? Date.parse(runState.startedAt)
        : (live?.startedAt ?? sendingStartedAt);
  const elapsedSeconds =
    startedAt !== null && startedAt !== undefined
      ? Math.max(
          0,
          Math.floor(
            ((!running && !sending && runState
              ? Date.parse(runState.completedAt ?? session.updatedAt)
              : now) -
              startedAt) /
              1000,
          ),
        )
      : null;
  const liveFileChanges = new Map<string, FileChange>();
  for (const change of activities
    .map((activity) => activity.fileChange)
    .filter((value): value is FileChange => Boolean(value))) {
    const previous = liveFileChanges.get(change.path);
    liveFileChanges.set(change.path, {
      ...change,
      changeType:
        previous?.changeType === "created" && change.changeType === "modified"
          ? "created"
          : change.changeType,
      additions: (previous?.additions ?? 0) + change.additions,
      deletions: (previous?.deletions ?? 0) + change.deletions,
    });
  }
  const liveChangeCount = liveFileChanges.size;
  const liveAdditions = [...liveFileChanges.values()].reduce(
    (total, change) => total + change.additions,
    0,
  );
  const liveDeletions = [...liveFileChanges.values()].reduce(
    (total, change) => total + change.deletions,
    0,
  );
  const statusLabel = question
    ? tr("等待回答")
    : session.status === "waiting_approval"
      ? tr("\u7B49\u5F85\u6279\u51C6")
      : session.status === "running"
        ? tr("\u6B63\u5728\u6267\u884C")
        : session.status === "error"
          ? tr("\u6267\u884C\u5931\u8D25")
          : session.status === "interrupted"
            ? tr("\u5DF2\u4E2D\u65AD")
            : tr("\u5C31\u7EEA");

  const applyStarterPrompt = (text: string) => {
    setDraft((current) => (current ? `${current}\n\n${text}` : text));
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(240, textareaRef.current.scrollHeight)}px`;
      }
    });
  };
  const permissionControls = (
    <>
      <label className={`compact-control${orbit ? " orbit-permission-mode" : ""}`}>
        {orbit ? <ShieldCheck size={14} aria-hidden="true" /> : null}
        <span className={orbit ? "visually-hidden" : undefined}>{tr("\u6743\u9650")}</span>
        <select
          value={
            session.permissionMode === "request_approval" && session.approvalMode === "automatic"
              ? "automatic"
              : session.permissionMode
          }
          onChange={(event) =>
            event.target.value === "automatic"
              ? void automaticApproval()
              : void onPatch({
                  sessionId: session.id,
                  permissionMode: event.target.value as SessionView["permissionMode"],
                  approvalMode: "manual",
                }).catch((cause) => setError(String(cause)))
          }
        >
          <option value="request_approval">{tr("\u8BF7\u6C42\u6279\u51C6")}</option>
          <option value="automatic">{tr("自动审批")}</option>
          <option value="full_access">{tr("\u5B8C\u5168\u8BBF\u95EE")}</option>
        </select>
      </label>
      <details className="permission-details">
        <summary title={tr("隔离与安全")}>
          {session.executionMode === "docker"
            ? "Docker"
            : session.executionMode === "worktree"
              ? "Worktree"
              : tr("隔离")}
          <ChevronDown size={12} />
        </summary>
        <div>
          <label className="compact-control">
            <span>{tr("\u9694\u79BB")}</span>
            <select
              value={session.executionMode}
              disabled={running}
              onChange={(event) =>
                void onPatch({
                  sessionId: session.id,
                  executionMode: event.target.value as SessionView["executionMode"],
                })
              }
            >
              <option value="host">
                {tr(
                  session.permissionMode === "request_approval" ? "Windows 原生沙箱" : "当前工作区",
                )}
              </option>
              <option value="worktree">Git worktree</option>
              <option value="docker">Docker</option>
            </select>
          </label>
          <label className="compact-check">
            <input
              type="checkbox"
              checked={session.patchOnly}
              disabled={running}
              onChange={(event) =>
                void onPatch({ sessionId: session.id, patchOnly: event.target.checked })
              }
            />
            <span>{tr("\u4EC5\u8865\u4E01")}</span>
          </label>
        </div>
      </details>
    </>
  );

  return (
    <main
      className={`chat-view${compact ? " chat-view--quick" : ""}${dragActive ? " chat-view--drag-active" : ""}${question ? " chat-view--question" : ""}`}
      data-testid="chat-view"
      data-agent-mode={agentMode}
      data-compact={compact ? "true" : "false"}
      data-run-state={
        approval ? "approval" : question ? "question" : running || sending ? "running" : "idle"
      }
    >
      {dragActive ? (
        <div className="drag-drop-overlay" aria-hidden="true">
          <span className="drag-drop-overlay__icon">
            <FileText size={24} />
          </span>
          <strong>{tr("\u91CA\u653E\u4EE5\u4E0A\u4F20\u9644\u4EF6")}</strong>
          <small>{tr("\u5355\u4E2A\u6587\u4EF6\u4E0D\u8D85\u8FC7 25 MiB")}</small>
        </div>
      ) : null}
      {session.parentSessionId ? (
        <button
          className="parent-session-link"
          type="button"
          onClick={() => onSelectSession(session.parentSessionId as string)}
        >
          <ArrowLeft size={14} />
          {tr("返回父会话")}
        </button>
      ) : null}
      <div className="conversation-viewport conversation-viewport--tasks">
        <section
          className="conversation-scroll"
          ref={scrollRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable history needs keyboard focus for Page Up/Down.
          tabIndex={0}
          aria-label={tr("会话记录")}
        >
          <div className="conversation">
            {messages.length === 0 && !live && !sending ? (
              <div className={`conversation-empty${chatMode ? " conversation-empty--chat" : ""}`}>
                <BrandMark className="conversation-empty__mark" size={46} />
                <h1>
                  {session.title === "新会话" || session.title === "新对话"
                    ? chatMode
                      ? tr("有什么可以帮你？")
                      : workStarters
                        ? tr("从工作目标开始")
                        : tr("\u4ECE\u4E00\u53E5\u76EE\u6807\u5F00\u59CB")
                    : session.title}
                </h1>
                <p>
                  {chatMode
                    ? tr("可以回答问题、分析资料，也可以联网查找最新信息。")
                    : tr("\u5F53\u524D\u4F1A\u8BDD\u4F7F\u7528") +
                      " " +
                      (selectedModel?.displayName ??
                        tr("\u5C1A\u672A\u914D\u7F6E\u7684\u6A21\u578B"))}
                </p>
                <fieldset
                  className="conversation-empty__starters"
                  disabled={!draftState.ready}
                  aria-label={tr("\u5E38\u7528\u8D77\u59CB\u4EFB\u52A1")}
                >
                  <button
                    type="button"
                    data-starter-kind={workStarters ? "document" : undefined}
                    onClick={() =>
                      applyStarterPrompt(
                        tr(
                          chatMode
                            ? "帮我梳理一下这个问题，先给出清晰结论，再说明依据。"
                            : workStarters
                              ? "请根据我提供的材料和目标，梳理受众、提纲和关键信息，起草结构清晰、排版得体的 Word 文档。"
                              : "\u5206\u6790\u5F53\u524D\u9879\u76EE\u7684\u7ED3\u6784\u3001\u98CE\u9669\u548C\u6700\u503C\u5F97\u4F18\u5148\u5904\u7406\u7684\u95EE\u9898\u3002",
                        ),
                      )
                    }
                  >
                    {chatMode ? (
                      tr("梳理问题")
                    ) : workStarters ? (
                      <span className="orbit-work-starter-label">
                        <FileText size={15} aria-hidden="true" />
                        {tr("起草 Word 文档")}
                      </span>
                    ) : (
                      tr("\u5206\u6790\u5F53\u524D\u9879\u76EE")
                    )}
                    <ArrowUpRight className="orbit-starter-arrow" size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    data-starter-kind={workStarters ? "spreadsheet" : undefined}
                    onClick={() =>
                      applyStarterPrompt(
                        tr(
                          chatMode
                            ? "搜索并概括这个主题的最新公开信息，注明来源和发布时间。"
                            : workStarters
                              ? "请根据我提供的数据，整理 Excel 表格结构，检查关键公式，并清晰呈现分析结果。"
                              : "\u68C0\u67E5\u5F53\u524D\u5DE5\u4F5C\u533A\u4E2D\u7684\u9519\u8BEF\uFF0C\u5B9A\u4F4D\u539F\u56E0\u5E76\u5B8C\u6210\u4FEE\u590D\u3002",
                        ),
                      )
                    }
                  >
                    {chatMode ? (
                      tr("联网研究")
                    ) : workStarters ? (
                      <span className="orbit-work-starter-label">
                        <Table2 size={15} aria-hidden="true" />
                        {tr("分析 Excel 表格")}
                      </span>
                    ) : (
                      tr("\u5B9A\u4F4D\u5E76\u4FEE\u590D\u95EE\u9898")
                    )}
                    <ArrowUpRight className="orbit-starter-arrow" size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    data-starter-kind={workStarters ? "presentation" : undefined}
                    onClick={() =>
                      applyStarterPrompt(
                        tr(
                          chatMode
                            ? "把这个想法整理成结构清楚、可以直接使用的说明。"
                            : workStarters
                              ? "请根据我提供的主题和材料，先规划叙事与页面结构，再制作重点清晰、版式统一的 PPT 演示文稿。"
                              : "\u68B3\u7406\u8FD9\u6B21\u9700\u6C42\u7684\u5B9E\u73B0\u8303\u56F4\uFF0C\u7ED9\u51FA\u8BA1\u5212\u540E\u5F00\u59CB\u6267\u884C\u3002",
                        ),
                      )
                    }
                  >
                    {chatMode ? (
                      tr("整理内容")
                    ) : workStarters ? (
                      <span className="orbit-work-starter-label">
                        <Presentation size={15} aria-hidden="true" />
                        {tr("制作 PPT 演示")}
                      </span>
                    ) : (
                      tr("\u8BA1\u5212\u5E76\u6267\u884C\u4EFB\u52A1")
                    )}
                    <ArrowUpRight className="orbit-starter-arrow" size={16} aria-hidden="true" />
                  </button>
                </fieldset>
              </div>
            ) : null}

            {transcript.map((entry) => {
              const first = entry.messages[0];
              if (!first) return null;
              const rows = entry.messages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  orbit={orbit}
                  child={Boolean(session.parentSessionId)}
                  executionGroup={entry.execution}
                  toolDetails={toolDetails}
                  activeToolDetails={activeToolDetails}
                  onOpenWorkspace={onOpenWorkspace}
                  onRewriteMessage={onRewriteMessage}
                  rewriteDisabled={running}
                  workspacePath={session.workspacePath}
                  onOpenError={setError}
                  onOpenFile={onOpenFile}
                  allowLocalFiles={!chatMode}
                  showAssistantHeader={entry.execution ? false : entry.showAssistantHeader}
                />
              ));
              if (!entry.execution) return rows;
              const count = entry.messages.reduce(
                (total, message) =>
                  total +
                  message.parts.filter((part) => {
                    if (part.type !== "tool_call") return false;
                    const detail = toolDetailsForMessage(toolDetails, message.id, part.callId);
                    return !detail || !activeToolDetails.has(detail);
                  }).length,
                0,
              );
              const hasReasoning = entry.messages.some((message) =>
                message.parts.some((part) => part.type === "reasoning" && part.text.trim()),
              );
              return (
                <div
                  className="orbit-transcript-group"
                  key={first.id}
                  hidden={count === 0 && !hasReasoning}
                >
                  {entry.showAssistantHeader ? (
                    <OrbitMessageMeta
                      child={Boolean(session.parentSessionId)}
                      createdAt={first.createdAt}
                    />
                  ) : null}
                  <details className="orbit-execution-records" data-count={count} open>
                    <summary hidden={count === 0}>
                      <Workflow aria-hidden="true" size={15} />
                      <span>{tr("执行记录")}</span>
                      <span className="orbit-execution-count">{count}</span>
                      <ChevronDown
                        className="orbit-execution-chevron"
                        aria-hidden="true"
                        size={13}
                      />
                    </summary>
                    <div className="orbit-execution-list">{rows}</div>
                  </details>
                </div>
              );
            })}

            {activities.length > 0 && (running || Boolean(live)) ? (
              <>
                <ActivityTrail
                  key={live?.runId ?? activities[0]?.runId}
                  orbit={orbit}
                  activities={activities}
                  toolDetails={toolDetails}
                  onOpenFile={onOpenFile}
                />
                {liveChangeCount > 0 ? (
                  <button className="live-change-summary" type="button" onClick={onOpenWorkspace}>
                    <FilePenLine aria-hidden="true" size={15} />
                    <strong>
                      {liveChangeCount}
                      {tr("\u4E2A\u6587\u4EF6\u5DF2\u66F4\u6539")}
                    </strong>
                    <span className="run-summary__added">+{formatCount(liveAdditions)}</span>
                    <span className="run-summary__deleted">-{formatCount(liveDeletions)}</span>
                  </button>
                ) : null}
              </>
            ) : null}

            {live && (live.text || live.reasoning) ? (
              <article className="message message--assistant message--streaming">
                {orbit ? (
                  <OrbitMessageMeta
                    child={Boolean(session.parentSessionId)}
                    createdAt={live.startedAt}
                    generating
                  />
                ) : (
                  <div className="message__meta">
                    <span>MINGSHEN</span>
                    <span>{tr("\u751F\u6210\u4E2D")}</span>
                  </div>
                )}
                {live.reasoning ? (
                  <details className="reasoning-block" open>
                    <summary>{tr("\u601D\u8003\u6458\u8981")}</summary>
                    <p>{live.reasoning}</p>
                  </details>
                ) : null}
                {live.text ? (
                  <div className="message__content">
                    <MarkdownLite
                      text={live.text}
                      workspacePath={session.workspacePath}
                      onOpenError={setError}
                      onOpenFile={onOpenFile}
                      allowLocalFiles={!chatMode}
                    />

                    <span className="stream-caret" aria-hidden="true" />
                  </div>
                ) : null}
              </article>
            ) : null}
            {running || sending || runState ? (
              <div
                className={running || sending ? "run-status run-status--active" : "run-status"}
                role="status"
              >
                {running || sending ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : (
                  <Check aria-hidden="true" size={14} />
                )}
                <span>
                  {question
                    ? tr("等待回答")
                    : approval
                      ? tr("等待批准")
                      : context?.state === "compacting" && running
                        ? tr("正在压缩上下文")
                        : running || sending
                          ? activities.some((activity) => activity.status === "running")
                            ? tr("正在执行")
                            : tr("思考中")
                          : runState?.status === "failed"
                            ? tr("执行失败")
                            : runState?.status === "interrupted" || runState?.status === "running"
                              ? tr("已中断")
                              : tr("已完成")}
                </span>
                {elapsedSeconds !== null ? (
                  <span>{tr("已运行 {0}", [formatDuration(elapsedSeconds)])}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
        <QuestionNavigator
          key={session.id}
          messages={messages}
          scrollRef={scrollRef}
          onJump={jumpToQuestion}
        />
        {!followingOutput ? (
          <div className="chat-scroll-controls">
            <button
              className="chat-scroll-controls__latest"
              type="button"
              aria-label={tr("回到底部并恢复自动跟随")}
              title={tr("回到底部并恢复自动跟随")}
              onClick={(event) => {
                if (document.activeElement === event.currentTarget)
                  scrollRef.current?.focus({ preventScroll: true });
                scrollActionsRef.current?.jumpTo(scrollRef.current?.scrollHeight ?? 0, true);
              }}
            >
              <ArrowDown size={16} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      <div className="composer-wrap" ref={composerWrapRef}>
        {waitingForRequest || (approval && approval.id === dismissedApprovalId) ? (
          <div className="approval-submission" role="status">
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
            <span>{tr(waitingForRequest ? "正在恢复待处理请求…" : "正在提交审批…")}</span>
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => void onSyncPending().catch((cause) => setError(String(cause)))}
            >
              {tr("刷新请求")}
            </button>
          </div>
        ) : null}
        {context?.state === "compacting" && running ? (
          <div className="context-notice" role="status">
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
            <div>
              <strong>{tr("正在压缩上下文")}</strong>
              <span>{tr("可能需要几分钟。原始记录会保留；运行中的任务将在压缩后继续。")}</span>
              {context.notice ? <span>{runtimeText(context.notice)}</span> : null}
            </div>
          </div>
        ) : null}
        {context?.state === "failed" ? (
          <ExpandableText
            className="context-notice context-notice--error"
            label={tr("上下文压缩未完成，原始记录已保留")}
            text={runtimeText(context.error ?? "")}
            tone="error"
          />
        ) : null}
        {question ? (
          <AgentQuestionPanel
            key={question.id}
            request={question}
            onAnswer={onQuestionAnswer}
            onSyncPending={onSyncPending}
          />
        ) : null}
        {approval && approval.id !== dismissedApprovalId ? (
          <section className="approval-panel" aria-label={tr("\u64CD\u4F5C\u5BA1\u6279")}>
            <div className="approval-panel__heading">
              <ShieldAlert aria-hidden="true" size={16} />
              <div>
                <strong>{runtimeText(approval.summary)}</strong>
                <span>{approval.toolName}</span>
              </div>
            </div>
            <pre className="approval-panel__detail">{approval.detail}</pre>
            {approval.review ? (
              <p className="approval-review-status" role="status">
                {approval.review.state === "reviewing" ? (
                  <>
                    <LoaderCircle size={14} className="spin" />
                    {runtimeText(
                      approval.review.reason ?? tr("审批模型正在审核，可随时手动处理。"),
                    )}
                  </>
                ) : (
                  runtimeText(approval.review.reason ?? tr("自动审批未完成，请手动处理。"))
                )}
              </p>
            ) : null}
            <input
              className="approval-panel__feedback"
              value={approvalFeedback}
              onChange={(event) => setApprovalFeedback(event.target.value)}
              placeholder={tr("\u62D2\u7EDD\u539F\u56E0\uFF08\u53EF\u9009\uFF09")}
              disabled={approvalBusy}
            />

            {approvalError ? <p className="form-error">{approvalError}</p> : null}
            <div className="approval-panel__actions">
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => void decideApproval("allow_once")}
                disabled={approvalBusy}
              >
                {approvalBusy ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={15} />
                ) : null}
                {tr("\u4EC5\u672C\u6B21")}
              </button>
              <button
                className="btn btn--danger"
                type="button"
                onClick={() => void decideApproval("deny")}
                disabled={approvalBusy}
              >
                {tr("拒绝")}
              </button>
              <details className="approval-advanced">
                <summary>
                  {tr("更多授权选项")}
                  <ChevronDown size={13} />
                </summary>
                <div>
                  <button
                    className="btn btn--secondary"
                    type="button"
                    onClick={() => void decideApproval("allow_session", 300_000)}
                    disabled={approvalBusy || approval.manualOnly}
                  >
                    {tr("5 \u5206\u949F\u5185\u5141\u8BB8")}
                  </button>
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() => void decideApproval("allow_session")}
                    disabled={approvalBusy || approval.manualOnly}
                  >
                    {tr("\u672C\u4F1A\u8BDD\u5141\u8BB8")}
                  </button>
                  {approval.similarScope ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={approvalBusy}
                      title={approval.similarScope}
                      onClick={() => void decideApproval("allow_similar")}
                    >
                      {tr("本会话同类批量批准")}
                    </button>
                  ) : null}
                  <button
                    className="btn btn--secondary"
                    type="button"
                    onClick={() => void automaticApproval()}
                    disabled={
                      approvalBusy ||
                      approval.manualOnly ||
                      approval.toolName.startsWith("hook:") ||
                      approval.review?.state === "reviewing"
                    }
                  >
                    {tr("自动审批")}
                  </button>
                  <button
                    className="btn btn--secondary"
                    type="button"
                    onClick={() => void decideApproval("full_access")}
                    disabled={
                      approvalBusy || approval.manualOnly || approval.toolName.startsWith("hook:")
                    }
                  >
                    {tr("此项目完全访问")}
                  </button>
                </div>
              </details>
            </div>
          </section>
        ) : null}
        <div
          className={`composer${orbit ? " composer--orbit" : ""}`}
          data-testid="chat-composer"
          data-busy={running || sending ? "true" : "false"}
        >
          <div className={`composer__context${orbit ? " orbit-composer-top" : ""}`}>
            <span className="composer-run-state" role="status">
              {statusLabel}
            </span>
            <ModelPicker
              className="chat-model-picker"
              inlineProvider
              providers={providers}
              value={
                session.providerId && session.modelId
                  ? { providerId: session.providerId, configId: session.modelId }
                  : null
              }
              onChange={(selection, model) => void changeModel(selection, model)}
              disabled={running}
            />
            {!chatMode ? (
              <>
                <label className="composer-agent">
                  <Bot size={14} aria-hidden="true" />
                  <select
                    aria-label={tr("当前 Agent")}
                    value={session.agentProfileId}
                    disabled={running}
                    onChange={(event) =>
                      void onPatch({ sessionId: session.id, agentProfileId: event.target.value })
                    }
                  >
                    {availableAgentProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {agentLabel(profile)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="workspace-button"
                  type="button"
                  onClick={() => void chooseWorkspace()}
                  title={formatPath(session.workspacePath)}
                >
                  <FolderOpen aria-hidden="true" size={14} />
                  <span>
                    {session.workspacePath?.split(/[\\/]/).filter(Boolean).at(-1) ??
                      formatPath(null)}
                  </span>
                </button>
              </>
            ) : null}

            {!orbit && !chatMode ? permissionControls : null}
          </div>

          {!compact && queuedPromptActionsAvailable ? (
            <QueuedPromptTray
              items={queuedPrompts}
              onResume={async (itemId) => {
                if (!onResumeQueuedPrompt) throw new Error(tr("队列操作不可用。"));
                return await onResumeQueuedPrompt(itemId);
              }}
              onUpdate={async (itemId, text) => {
                await onUpdateQueuedPrompt?.(itemId, text);
              }}
              onBeginEdit={async (itemId) => {
                if (!onBeginQueuedPromptEdit) throw new Error(tr("队列操作不可用。"));
                return await onBeginQueuedPromptEdit(itemId);
              }}
              onEndEdit={async (editId, abandon) => {
                if (!onEndQueuedPromptEdit) throw new Error(tr("队列操作不可用。"));
                await onEndQueuedPromptEdit(editId, abandon);
              }}
              onRemove={async (itemId) => {
                if (!onRemoveQueuedPrompt) throw new Error(tr("队列操作不可用。"));
                await onRemoveQueuedPrompt(itemId);
              }}
              onReplaceAttachments={replaceQueuedAttachments}
            />
          ) : null}

          {attachments.length > 0 ? (
            <fieldset
              className="draft-attachments"
              aria-label={tr("\u5F85\u53D1\u9001\u9644\u4EF6")}
            >
              {attachments.map((attachment) => {
                const incompatible = incompatibleAttachments.some(
                  (item) => item.id === attachment.id,
                );
                const Icon = attachmentIcon(attachment.kind);
                return (
                  <div
                    className={
                      incompatible
                        ? "draft-attachment draft-attachment--incompatible"
                        : "draft-attachment"
                    }
                    key={attachment.id}
                  >
                    <span className="draft-attachment__icon" aria-hidden="true">
                      <Icon size={14} />
                    </span>
                    <span className="draft-attachment__copy">
                      <strong>{attachment.file.name}</strong>
                      <small>
                        {formatBytes(attachment.file.size)}
                        {incompatible ? tr(" \xB7 \u5F53\u524D\u6A21\u578B\u4E0D\u652F\u6301") : ""}
                      </small>
                    </span>
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      aria-label={tr("\u79FB\u9664 {0}", [attachment.file.name])}
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((item) => item.id !== attachment.id),
                        )
                      }
                    >
                      <XCircle aria-hidden="true" size={14} />
                    </button>
                  </div>
                );
              })}
            </fieldset>
          ) : null}

          <textarea
            ref={textareaRef}
            data-testid="chat-composer-input"
            hidden={formatted}
            value={draft}
            rows={3}
            aria-label={tr("消息输入框")}
            aria-controls={choices ? "composer-slash-menu" : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              choices?.length ? `slash-item-${Math.min(slashIndex, choices.length - 1)}` : undefined
            }
            placeholder={
              draftState.ready
                ? tr(
                    chatMode
                      ? "输入问题，或上传图片、PDF、Word、Excel、PPTX 做只读问答"
                      : "\u63CF\u8FF0\u76EE\u6807\u3001\u7EA6\u675F\u548C\u5B8C\u6210\u6807\u51C6",
                  )
                : tr("正在恢复草稿…")
            }
            onChange={(event) => {
              const text = event.target.value;
              const inputType = (event.nativeEvent as InputEvent).inputType;
              const pasted = shouldOpenPastePreview({
                inputType,
                pastePending: pasteWaitingRef.current,
                richPasteEnabled: preferences.composerRichPaste,
              });
              pasteWaitingRef.current = false;
              setDraft(text);
              if (pasted) {
                previewFocusRequested.current = true;
                setFormattedDraft(text);
              }
              setSlashIndex(0);
              setSlashDismissed(null);
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(240, event.target.scrollHeight)}px`;
            }}
            onKeyDown={(event) => {
              pasteWaitingRef.current = false;
              onComposerKeyDown(event);
            }}
            onCompositionStart={() => {
              pasteWaitingRef.current = false;
            }}
            onPaste={(event) => {
              pasteWaitingRef.current = false;
              const images = clipboardImages(event.clipboardData);
              if (images.length) {
                event.preventDefault();
                addFiles(images.map(namedClipboardImage));
              } else {
                pasteWaitingRef.current = Boolean(event.clipboardData.getData("text/plain"));
                // Bounded expiry protects against a paste that never produces an input event.
                // Keydown and composition start also clear it immediately.
                setTimeout(() => {
                  pasteWaitingRef.current = false;
                }, 1000);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              setEditMenu({
                x: event.clientX || bounds.left + 12,
                y: event.clientY || bounds.top + 12,
              });
            }}
            disabled={sending || !draftState.ready}
          />
          {formatted ? (
            <section
              ref={previewRef}
              className="composer-preview"
              aria-label={tr("消息格式预览")}
              aria-disabled={sending}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable draft accepts send, edit and native undo shortcuts.
              tabIndex={0}
              onKeyDown={onPreviewKeyDown}
              onPaste={(event) => {
                if (sending) return;
                const images = clipboardImages(event.clipboardData);
                if (images.length) {
                  event.preventDefault();
                  addFiles(images.map(namedClipboardImage));
                } else {
                  pasteWaitingRef.current = Boolean(event.clipboardData.getData("text/plain"));
                  setTimeout(() => {
                    pasteWaitingRef.current = false;
                  }, 1000);
                  editDraft();
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                const point = {
                  x: event.clientX || bounds.left + 12,
                  y: event.clientY || bounds.top + 12,
                };
                editDraft();
                const field = textareaRef.current;
                if (field) field.setSelectionRange(field.selectionEnd, field.selectionEnd);
                setEditMenu(point);
              }}
            >
              <div
                className="rich-text markdown-body"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Draft Markdown is escaped and sanitized before insertion.
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </section>
          ) : null}
          {previewRequested && !formatted ? (
            <p className="composer-preview-status" role="status">
              {tr("内容较长或格式复杂，已保留原文编辑。")}
            </p>
          ) : null}
          {editMenu ? (
            <ComposerEditMenu
              position={editMenu}
              textarea={textareaRef}
              onClose={closeEditMenu}
              onError={setError}
            />
          ) : null}

          {choices
            ? createPortal(
                <div
                  ref={slashMenuRef}
                  id="composer-slash-menu"
                  className="slash-command-menu composer-slash-menu"
                  role="listbox"
                  aria-label={tr("聊天命令")}
                  style={commandPosition}
                >
                  {choices.map((item, index) => {
                    const Icon =
                      item.command === "fork"
                        ? GitBranch
                        : item.command === "compact"
                          ? ArrowDownToLine
                          : item.command === "rename"
                            ? SquarePen
                            : item.command === "archive"
                              ? Archive
                              : item.kind === "extension" ||
                                  item.command === "plugins" ||
                                  item.command === "skills"
                                ? Puzzle
                                : Slash;
                    return (
                      <button
                        type="button"
                        role="option"
                        id={`slash-item-${index}`}
                        data-index={index}
                        aria-selected={index === slashIndex}
                        key={item.id}
                        disabled={
                          sending ||
                          (running &&
                            item.kind === "builtin" &&
                            !["status", "skills", "plugins", "mcp"].includes(item.command ?? ""))
                        }
                        onMouseEnter={() => setSlashIndex(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void selectSlashItem(item)}
                      >
                        <Icon size={15} aria-hidden="true" />
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.description}</small>
                        </span>
                        {item.extension && selectedExtensionIds.includes(item.extension.id) ? (
                          <Check size={14} />
                        ) : null}
                      </button>
                    );
                  })}
                  {!choices.length ? (
                    <p className="slash-command-menu__empty">{tr("没有匹配的命令或扩展")}</p>
                  ) : null}
                </div>,
                document.body,
              )
            : null}

          {mentionQuery !== null
            ? createPortal(
                <div
                  ref={mentionMenuRef}
                  className="mention-menu"
                  role="listbox"
                  aria-label={tr("\u8C03\u7528 Agent")}
                  style={mentionPosition}
                >
                  {agentProfiles
                    .filter(
                      (profile) =>
                        profile.enabled &&
                        profile.role === "subagent" &&
                        !profile.hidden &&
                        `${profile.name} ${profile.id}`
                          .toLocaleLowerCase("zh-CN")
                          .includes(mentionQuery),
                    )
                    .map((profile) => (
                      <button
                        type="button"
                        role="option"
                        key={profile.id}
                        onClick={() => {
                          setDraft((current) => current.replace(/@([^\s]*)$/, `@${profile.name} `));
                          textareaRef.current?.focus();
                        }}
                      >
                        <Bot aria-hidden="true" size={14} />
                        <strong>{profile.name}</strong>
                        <span>{profile.description || tr("\u5B50 Agent")}</span>
                      </button>
                    ))}
                </div>,
                document.body,
              )
            : null}

          {selectedBuiltinCapabilities.length + selectedExtensions.length > 0 ? (
            <fieldset
              className="composer__references"
              aria-label={tr("\u5F53\u524D\u4F1A\u8BDD\u5F15\u7528\u7684\u80FD\u529B")}
            >
              {selectedBuiltinCapabilities.map((capability) => (
                <button
                  className="reference-chip reference-chip--builtin"
                  type="button"
                  key={capability.id}
                  data-testid="capability-chip"
                  data-capability-id={capability.id}
                  data-capability-type={capability.type}
                  data-capability-source="builtin"
                  disabled={sending || running}
                  title={tr("\u53D6\u6D88\u5F15\u7528 {0}", [capability.name])}
                  onClick={() => void onToggleBuiltinCapability(capability.id, false)}
                >
                  {capability.type === "plugin" ? (
                    <Puzzle className="reference-chip__type-icon" aria-hidden="true" size={12} />
                  ) : (
                    <Sparkles className="reference-chip__type-icon" aria-hidden="true" size={12} />
                  )}
                  <span>{capability.type === "skill" ? "SKILL" : "PLUGIN"}</span>
                  <strong>{capability.name}</strong>
                  <XCircle aria-hidden="true" size={12} />
                </button>
              ))}
              {selectedExtensions.map((extension) => (
                <button
                  className="reference-chip"
                  type="button"
                  key={extension.id}
                  data-testid="capability-chip"
                  data-capability-id={extension.id}
                  data-capability-type={extension.type}
                  data-capability-source="installed"
                  disabled={sending || running}
                  title={tr("\u53D6\u6D88\u5F15\u7528 {0}", [extension.name])}
                  onClick={() => void onToggleExtension(extension.id, false)}
                >
                  {extension.type === "plugin" ? (
                    <Puzzle className="reference-chip__type-icon" aria-hidden="true" size={12} />
                  ) : (
                    <Sparkles className="reference-chip__type-icon" aria-hidden="true" size={12} />
                  )}
                  <span>{extension.type === "skill" ? "SKILL" : "PLUGIN"}</span>
                  <strong>{extension.name}</strong>
                  <XCircle aria-hidden="true" size={12} />
                </button>
              ))}
            </fieldset>
          ) : null}

          <div className="composer__footer">
            <div className="composer__footer-left">
              {preferences.composerRichPaste && draft ? (
                <fieldset className="composer-format-switch" aria-label={tr("消息格式")}>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={tr("编辑原文")}
                    title={tr("编辑原文")}
                    aria-pressed={!formatted}
                    disabled={sending}
                    onClick={editDraft}
                  >
                    <Code2 size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={tr("格式预览")}
                    title={tr("格式预览")}
                    aria-pressed={formatted}
                    disabled={sending}
                    onClick={() => {
                      previewFocusRequested.current = true;
                      setFormattedDraft(draft);
                    }}
                  >
                    <Eye size={16} aria-hidden="true" />
                  </button>
                </fieldset>
              ) : null}
              <ExtensionPicker
                builtinCapabilities={builtinCapabilities}
                extensions={extensions}
                selectedIds={selectedExtensionIds}
                disabled={sending || running}
                attachmentsOnly={chatMode}
                onToggle={onToggleExtension}
                onToggleBuiltin={onToggleBuiltinCapability}
                onImport={onImportExtensions}
                onAttachFiles={addFiles}
              />
              {!compact && !session.parentSessionId && running && !sending && onAddQueuedPrompt ? (
                <button
                  className="btn btn--secondary queue-next-button"
                  type="button"
                  title={tr("加入下一轮队列")}
                  aria-label={tr("加入下一轮队列")}
                  data-testid="chat-queue-add"
                  onClick={() => void queueCurrentDraft()}
                  disabled={
                    queueing ||
                    !draftState.ready ||
                    (!draft.trim() && attachments.length === 0) ||
                    !selectedModel ||
                    incompatibleAttachments.length > 0 ||
                    queuedPrompts.length >= MAX_QUEUED_PROMPTS ||
                    Boolean(!chatMode && draft.trim() && parseBuiltinCommand(draft.trim()))
                  }
                >
                  {queueing ? (
                    <LoaderCircle className="spin" aria-hidden="true" size={14} />
                  ) : (
                    <ListPlus aria-hidden="true" size={14} />
                  )}
                  {tr("加入下一轮")}
                </button>
              ) : null}
              {orbit && !chatMode ? (
                <div className="orbit-composer-permissions">{permissionControls}</div>
              ) : null}

              <div className="metric-strip">
                <span>TOK {formatCount(usage?.totalTokens)}</span>
                <ContextMeter
                  sessionId={session.id}
                  context={context}
                  model={selectedModel}
                  provider={providers.find((provider) => provider.id === session.providerId)}
                  running={running || sending}
                  canCompact={messages.length >= 2}
                  openRequest={contextOpenRequest}
                  onSettings={() => onOpenSettings("context")}
                  onCompact={() => void executeBuiltin("compact")}
                />
                {elapsedSeconds !== null ? <span>{formatDuration(elapsedSeconds)}</span> : null}
              </div>
            </div>
            <div className="composer__footer-right">
              <label className="effort-control">
                <span>
                  {tr("\u601D\u8003")}{" "}
                  <strong>{session.reasoningLevel ?? tr("\u4E0D\u8BBE\u7F6E")}</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, reasoningLevels.length - 1)}
                  step="1"
                  value={reasoningIndex}
                  disabled={running || reasoningLevels.length === 0}
                  onChange={(event) => void changeReasoningIndex(Number(event.target.value))}
                  aria-label={tr("\u601D\u8003\u5F3A\u5EA6")}
                />
              </label>

              <div className="composer__actions">
                {running || sending ? (
                  <button
                    className="btn btn--secondary"
                    type="button"
                    aria-label={tr("\u505C\u6B62")}
                    data-testid="chat-composer-stop"
                    onClick={() => void onStop()}
                  >
                    <Square aria-hidden="true" size={14} />
                    {tr("\u505C\u6B62")}
                  </button>
                ) : (
                  <button
                    className="send-button"
                    type="button"
                    aria-label={tr("\u53D1\u9001\u6D88\u606F")}
                    data-testid="chat-composer-send"
                    title={tr("\u53D1\u9001\u6D88\u606F")}
                    onClick={() => void send()}
                    disabled={
                      (!draft.trim() && attachments.length === 0) ||
                      !draftState.ready ||
                      sending ||
                      !selectedModel ||
                      incompatibleAttachments.length > 0
                    }
                  >
                    {sending ? (
                      <LoaderCircle className="spin" aria-hidden="true" size={18} />
                    ) : (
                      <ArrowUp aria-hidden="true" size={18} />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        {memoryResult ? (
          <div className="memory-command-result" role="status">
            <pre>{memoryResult}</pre>
            <button
              type="button"
              className="icon-button"
              aria-label={tr("关闭")}
              title={tr("关闭")}
              onClick={() => setMemoryResult(null)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {draftState.error ? (
          <div
            className={
              draftState.conflict
                ? "composer-error composer-error--draft-conflict"
                : "composer-error"
            }
            role="alert"
          >
            {draftState.conflict ? (
              <p className="composer-draft-conflict__message">
                {tr("另一个窗口已更新此草稿。当前窗口的内容已保留，请选择如何处理。")}
              </p>
            ) : (
              <ExpandableText
                text={tr("草稿保存或恢复失败：{0}", [runtimeText(draftState.error)])}
                tone="error"
              />
            )}
            {draftState.conflict ? (
              <>
                <button
                  className="btn btn--secondary"
                  type="button"
                  disabled={draftState.saving}
                  onClick={() =>
                    void composerDrafts
                      .resolveConflict(session.id, "overwrite")
                      .catch(() => undefined)
                  }
                >
                  {tr("用本地内容覆盖")}
                </button>
                <button
                  className="btn btn--secondary"
                  type="button"
                  disabled={draftState.saving}
                  onClick={() =>
                    void composerDrafts.resolveConflict(session.id, "reload").catch(() => undefined)
                  }
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  {tr("载入最新草稿")}
                </button>
              </>
            ) : (
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => void composerDrafts.flush(session.id).catch(() => undefined)}
              >
                <RotateCcw size={14} aria-hidden="true" />
                {tr("重试")}
              </button>
            )}
          </div>
        ) : null}
        {error ? <ExpandableText className="composer-error" text={error} tone="error" /> : null}
      </div>
      {renameOpen ? (
        <RenameSessionDialog
          title={session.title}
          onClose={() => setRenameOpen(false)}
          onSave={(title) => onPatch({ sessionId: session.id, title })}
        />
      ) : null}
    </main>
  );
}

const ActivityTrail = memo(function ActivityTrail({
  orbit,
  activities,
  toolDetails,
  onOpenFile,
}: {
  orbit: boolean;
  activities: ActivityEvent[];
  toolDetails: ReturnType<typeof collectToolDetails>;
  onOpenFile: (path: string) => void;
}) {
  useLocale();
  const [expanded, setExpanded] = useState(orbit);
  const [expandedDiffId, setExpandedDiffId] = useState<string | null>(null);
  const current =
    [...activities].reverse().find((activity) => activity.status === "running") ??
    activities.at(-1);
  const CurrentIcon = current ? activityIcon(current.kind) : FilePenLine;
  const currentLabel =
    (current?.title ? runtimeText(current.title) : "") ||
    (current ? currentActivityLabel(current.kind) : tr("\u6B63\u5728\u5904\u7406"));
  const currentDetail = current?.fileChange
    ? current.detail.replace(/^\+\d+\s+-\d+\s*(?:·\s*)?/, "")
    : current?.detail;
  return (
    <section
      className={`${expanded ? "activity-trail" : "activity-trail activity-trail--collapsed"}${orbit ? " orbit-execution-records orbit-execution-records--live" : ""}`}
      aria-label={tr("\u5B9E\u65F6\u6267\u884C\u8FDB\u5EA6")}
    >
      <div className="activity-trail__current">
        <button
          className="activity-trail__current-main"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="activity-row__icon" aria-hidden="true">
            {orbit && expanded ? (
              <Workflow size={14} />
            ) : current?.status === "running" ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <CurrentIcon size={14} />
            )}
          </span>
          <strong>{orbit && expanded ? tr("执行记录") : currentLabel}</strong>
          {orbit ? <span className="orbit-execution-count">{activities.length}</span> : null}
          {current?.fileChange ? (
            <>
              <span className="activity-row__added">+{current.fileChange.additions}</span>
              <span className="activity-row__deleted">-{current.fileChange.deletions}</span>
            </>
          ) : null}
          {currentDetail ? <code>{currentDetail}</code> : null}
        </button>
        <button
          className="activity-trail__current-toggle"
          type="button"
          aria-label={
            expanded
              ? tr("\u6536\u8D77\u6267\u884C\u8FDB\u5EA6")
              : tr("\u5C55\u5F00\u6267\u884C\u8FDB\u5EA6")
          }
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown aria-hidden="true" size={13} />
        </button>
      </div>
      {expanded
        ? activities.map((activity) => {
            const Icon = activityIcon(activity.kind);
            const change = activity.fileChange;
            const diffExpanded = expandedDiffId === activity.id;
            return (
              <div
                className={`activity-file-group${orbit ? " orbit-execution-step" : ""}`}
                key={activity.id}
                data-activity-id={activity.id}
                data-status={activity.status}
              >
                <div
                  className={`activity-row activity-row--${activity.status}${
                    change ? " activity-row--file" : " activity-row--disclosure"
                  }`}
                >
                  <span
                    className={`activity-row__icon${orbit ? " orbit-execution-node" : ""}`}
                    aria-hidden="true"
                  >
                    {orbit && activity.status === "completed" ? (
                      <Check size={13} />
                    ) : orbit && activity.status === "failed" ? (
                      <XCircle size={13} />
                    ) : orbit && activity.status === "running" ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : (
                      <Icon size={13} />
                    )}
                  </span>
                  {change ? (
                    <button
                      className="activity-row__file-link"
                      type="button"
                      title={tr("\u5728\u53F3\u4FA7\u6253\u5F00\u6587\u4EF6")}
                      onClick={() => onOpenFile(change.path)}
                    >
                      <span className="activity-row__title">{runtimeText(activity.title)}</span>
                      <span className="activity-row__added">+{change.additions}</span>
                      <span className="activity-row__deleted">-{change.deletions}</span>
                    </button>
                  ) : (
                    <ExpandableText
                      className="activity-disclosure"
                      label={runtimeText(activity.title)}
                      preview={activity.detail}
                      text={() => activityDetailsText(activity, toolDetails)}
                      tone={activity.status === "failed" ? "error" : undefined}
                    />
                  )}
                  {activity.durationMs !== null ? (
                    <span className="activity-row__duration">
                      {activity.durationMs < 1000
                        ? `${Math.max(0, Math.round(activity.durationMs))} ms`
                        : formatDuration(activity.durationMs / 1000)}
                    </span>
                  ) : null}
                  {orbit ? (
                    <span className="orbit-execution-state">
                      {tr(
                        activity.status === "completed"
                          ? "完成"
                          : activity.status === "failed"
                            ? "失败"
                            : "运行中",
                      )}
                    </span>
                  ) : null}
                  {change?.diff ? (
                    <button
                      className={
                        diffExpanded
                          ? "activity-row__diff-toggle activity-row__diff-toggle--open"
                          : "activity-row__diff-toggle"
                      }
                      type="button"
                      aria-label={
                        diffExpanded
                          ? tr("\u6536\u8D77\u4FEE\u6539\u9884\u89C8")
                          : tr("\u5C55\u5F00\u4FEE\u6539\u9884\u89C8")
                      }
                      aria-expanded={diffExpanded}
                      onClick={() =>
                        setExpandedDiffId((currentId) =>
                          currentId === activity.id ? null : activity.id,
                        )
                      }
                    >
                      <ChevronDown aria-hidden="true" size={13} />
                    </button>
                  ) : null}
                </div>
                {change ? (
                  <ExpandableText
                    className="activity-file-details"
                    label={tr("详情")}
                    preview={activity.detail || change.path}
                    text={() => activityDetailsText(activity, toolDetails)}
                    tone={activity.status === "failed" ? "error" : undefined}
                  />
                ) : null}
                {change?.diff && diffExpanded ? (
                  <DiffPreview
                    path={change.path}
                    additions={change.additions}
                    deletions={change.deletions}
                    diff={change.diff}
                    onOpenFile={onOpenFile}
                  />
                ) : null}
              </div>
            );
          })
        : null}
    </section>
  );
});

export function DiffPreview({
  path,
  additions,
  deletions,
  diff,
  onOpenFile,
}: {
  path: string;
  additions: number;
  deletions: number;
  diff: FileDiff;
  onOpenFile: (path: string) => void;
}) {
  return (
    <section className="activity-diff" aria-label={tr("{0} \u4FEE\u6539\u9884\u89C8", [path])}>
      <header className="activity-diff__header">
        <button
          type="button"
          onClick={() => onOpenFile(path)}
          title={tr("\u5728\u53F3\u4FA7\u6253\u5F00\u6587\u4EF6")}
        >
          <FilePenLine aria-hidden="true" size={14} />
          <code>{path}</code>
        </button>
        <span className="activity-diff__added">+{formatCount(additions)}</span>
        <span className="activity-diff__deleted">-{formatCount(deletions)}</span>
      </header>
      <div className="activity-diff__code">
        {diff.lines.map((line) => (
          <div
            className={`activity-diff__line activity-diff__line--${line.type}`}
            key={`${line.type}:${line.oldLine ?? "x"}:${line.newLine ?? "x"}:${line.text}`}
          >
            <span aria-hidden="true">{line.oldLine ?? ""}</span>
            <span aria-hidden="true">{line.newLine ?? ""}</span>
            <code>
              {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
              {line.text}
            </code>
          </div>
        ))}
        {diff.truncated ? (
          <div className="activity-diff__truncated">
            {tr("\u4FEE\u6539\u5185\u5BB9\u8F83\u957F\uFF0C\u9884\u89C8\u5DF2\u622A\u65AD\u3002")}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function currentActivityLabel(kind: ActivityEvent["kind"]): string {
  if (kind === "edit") {
    return tr("\u6B63\u5728\u7F16\u8F91\u6587\u4EF6");
  }
  if (kind === "delete") {
    return tr("\u6B63\u5728\u5220\u9664\u6587\u4EF6");
  }
  if (kind === "read") {
    return tr("\u6B63\u5728\u8BFB\u53D6\u6587\u4EF6");
  }
  if (kind === "command") {
    return tr("\u6B63\u5728\u8FD0\u884C\u547D\u4EE4");
  }
  if (kind === "browser") {
    return tr("\u6B63\u5728\u4F7F\u7528\u6D4F\u89C8\u5668");
  }
  if (kind === "github") {
    return tr("\u6B63\u5728\u67E5\u8BE2 GitHub");
  }
  if (kind === "subagent") {
    return tr("\u6B63\u5728\u7B49\u5F85\u5B50 Agent");
  }
  if (kind === "search") {
    return tr("\u6B63\u5728\u641C\u7D22\u5185\u5BB9");
  }
  return tr("\u6B63\u5728\u5904\u7406");
}

function RunSummaryCard({
  summary,
  onOpenWorkspace,
  onOpenFile,
}: {
  summary: RunSummary;
  onOpenWorkspace: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [expandedDiffPath, setExpandedDiffPath] = useState<string | null>(null);
  const visible = summary.fileChanges.slice(0, 3);
  const remaining = summary.fileChanges.slice(3);
  const renderChange = (change: FileChange) => (
    <div className="run-summary__change" key={change.path}>
      <div className="run-summary__file">
        <button
          className="run-summary__file-open"
          type="button"
          title={tr("\u5728\u53F3\u4FA7\u6253\u5F00\u6587\u4EF6")}
          onClick={() => onOpenFile(change.path)}
        >
          <code>{change.path}</code>
          <span className="run-summary__added">+{change.additions}</span>
          <span className="run-summary__deleted">-{change.deletions}</span>
        </button>
        {change.diff ? (
          <button
            className={
              expandedDiffPath === change.path
                ? "run-summary__diff-toggle run-summary__diff-toggle--open"
                : "run-summary__diff-toggle"
            }
            type="button"
            aria-expanded={expandedDiffPath === change.path}
            aria-label={
              expandedDiffPath === change.path
                ? tr("\u6536\u8D77\u4FEE\u6539\u9884\u89C8")
                : tr("\u5C55\u5F00\u4FEE\u6539\u9884\u89C8")
            }
            onClick={() =>
              setExpandedDiffPath((current) => (current === change.path ? null : change.path))
            }
          >
            <ChevronDown aria-hidden="true" size={13} />
          </button>
        ) : null}
      </div>
      {change.diff && expandedDiffPath === change.path ? (
        <DiffPreview
          path={change.path}
          additions={change.additions}
          deletions={change.deletions}
          diff={change.diff}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </div>
  );

  return (
    <section className="run-summary" aria-label={tr("\u672C\u8F6E\u6587\u4EF6\u53D8\u66F4")}>
      <header className="run-summary__header">
        <span className="run-summary__icon" aria-hidden="true">
          <FilePenLine size={18} />
        </span>
        <div>
          <strong>{tr("已编辑 {0} 个文件", [summary.fileChanges.length])}</strong>
          <span>
            {tr("{0} 次工具调用 · 用时 {1}", [
              summary.toolCount,
              formatDuration(summary.durationMs / 1000),
            ])}
          </span>
        </div>
        <button className="btn btn--secondary" type="button" onClick={onOpenWorkspace}>
          {tr("\u67E5\u770B\u53D8\u66F4")}
        </button>
      </header>
      <div className="run-summary__files">{visible.map(renderChange)}</div>
      {remaining.length > 0 ? (
        <details className="run-summary__more">
          <summary>
            {tr("另外 {0} 个文件", [remaining.length])}
            <ChevronDown aria-hidden="true" size={13} />
          </summary>
          <div className="run-summary__files">{remaining.map(renderChange)}</div>
        </details>
      ) : null}
    </section>
  );
}

function activityIcon(kind: ActivityEvent["kind"]) {
  if (kind === "edit") {
    return FilePenLine;
  }
  if (kind === "delete") {
    return Trash2;
  }
  if (kind === "command") {
    return Terminal;
  }
  if (kind === "browser") {
    return Globe2;
  }
  if (kind === "subagent") {
    return Bot;
  }
  if (kind === "github") {
    return GitBranch;
  }
  if (kind === "search") {
    return Search;
  }
  if (kind === "read") {
    return FileSearch2;
  }
  return HardDrive;
}

function attachmentIcon(kind: AttachmentKind) {
  if (kind === "image") {
    return Image;
  }
  if (kind === "audio") {
    return Music2;
  }
  if (kind === "video") {
    return Video;
  }
  return File;
}

function MessageAttachments({
  attachments,
  onOpenFile,
  allowLocalFiles,
}: {
  attachments: ChatAttachmentInput[];
  onOpenFile: (path: string) => void;
  allowLocalFiles: boolean;
}) {
  return (
    <fieldset className="message-attachments" aria-label={tr("\u6D88\u606F\u9644\u4EF6")}>
      {attachments.map((attachment) => {
        const Icon = attachmentIcon(attachment.kind);
        const content = (
          <>
            {attachment.kind === "image" ? (
              <img src={attachment.dataUrl} alt="" />
            ) : (
              <span className="message-attachment__icon" aria-hidden="true">
                <Icon size={15} />
              </span>
            )}
            <span className="message-attachment__copy">
              <strong>{attachment.name}</strong>
              <small>{formatBytes(attachment.size)}</small>
            </span>
          </>
        );

        return attachment.path && allowLocalFiles ? (
          <button
            className="message-attachment"
            type="button"
            title={tr("\u6253\u5F00\u6587\u4EF6")}
            key={`${attachment.name}:${attachment.size}:${attachment.dataUrl.slice(0, 32)}`}
            onClick={() => {
              if (!attachment.path) {
                return;
              }
              onOpenFile(attachment.path);
            }}
          >
            {content}
          </button>
        ) : (
          <div
            className="message-attachment"
            key={`${attachment.name}:${attachment.size}:${attachment.dataUrl.slice(0, 32)}`}
          >
            {content}
          </div>
        );
      })}
    </fieldset>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  orbit,
  child,
  executionGroup,
  toolDetails,
  activeToolDetails,
  onOpenWorkspace,
  onRewriteMessage,
  rewriteDisabled,
  workspacePath,
  onOpenError,
  onOpenFile,
  allowLocalFiles,
  showAssistantHeader,
}: {
  message: SessionMessage;
  orbit: boolean;
  child: boolean;
  executionGroup: boolean;
  toolDetails: ReturnType<typeof collectToolDetails>;
  activeToolDetails: ReadonlySet<NonNullable<ReturnType<typeof toolDetailsForMessage>>>;
  onOpenWorkspace: () => void;
  onRewriteMessage: (messageId: string, text: string) => Promise<void>;
  rewriteDisabled: boolean;
  workspacePath: string | null;
  onOpenError: (message: string) => void;
  onOpenFile: (path: string) => void;
  allowLocalFiles: boolean;
  showAssistantHeader: boolean;
}) {
  useLocale();
  const { confirm } = useDialog();
  const text = message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join("\n\n");
  const reasoning = message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "reasoning" }> => {
      return part.type === "reasoning";
    })
    .map((part) => part.text)
    .join("\n\n");
  const error = message.parts.find((part) => part.type === "error");
  const attachments = message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: "attachment" }> =>
        part.type === "attachment",
    )
    .map((part) => part.attachment);
  const toolCalls = message.parts.filter(
    (part): part is Extract<(typeof message.parts)[number], { type: "tool_call" }> =>
      part.type === "tool_call",
  );
  const visibleToolCalls = toolCalls.filter((call) => {
    const detail = toolDetailsForMessage(toolDetails, message.id, call.callId);
    return !detail || !activeToolDetails.has(detail);
  });
  const runSummaryPart = message.parts.find(
    (part): part is Extract<(typeof message.parts)[number], { type: "run_summary" }> =>
      part.type === "run_summary",
  );
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(text);
  const [actionBusy, setActionBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditDraft(text);
  }, [text]);

  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
    }
  }, [editing]);

  if (runSummaryPart) {
    return (
      <RunSummaryCard
        summary={runSummaryPart.summary}
        onOpenWorkspace={onOpenWorkspace}
        onOpenFile={onOpenFile}
      />
    );
  }

  if (message.role === "user") {
    const submitRewrite = async () => {
      if ((!editDraft.trim() && attachments.length === 0) || rewriteDisabled || actionBusy) {
        return;
      }
      setActionBusy(true);
      setActionError(null);
      try {
        await onRewriteMessage(message.id, editDraft);
        setEditing(false);
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setActionBusy(false);
      }
    };
    const retry = async () => {
      if (rewriteDisabled || actionBusy) {
        return;
      }
      const confirmed = await confirm({
        title: tr("\u91CD\u65B0\u53D1\u9001\u6D88\u606F"),
        description: tr(
          "\u8FD9\u4F1A\u5220\u9664\u5F53\u524D\u6D88\u606F\u4EE5\u53CA\u5B83\u4E4B\u540E\u7684\u6240\u6709\u5BF9\u8BDD\u5185\u5BB9\uFF0C\u7136\u540E\u91CD\u65B0\u53D1\u9001\u539F\u59CB\u6D88\u606F\u548C\u9644\u4EF6\u3002",
        ),
        confirmLabel: tr("\u8986\u76D6\u5E76\u91CD\u8BD5"),
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
      setActionBusy(true);
      setActionError(null);
      try {
        await onRewriteMessage(message.id, text);
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setActionBusy(false);
      }
    };
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    return (
      <article
        className="message message--user"
        id={`message-${message.id}`}
        data-message-id={message.id}
        data-unsaved={editing && editDraft !== text}
      >
        {orbit ? (
          <OrbitMessageMeta user child={child} createdAt={message.createdAt} />
        ) : (
          <div className="message__meta">
            <span>{tr("\u4F60")}</span>
          </div>
        )}
        {editing ? (
          <div className="user-message-editor">
            <textarea
              ref={editRef}
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              rows={4}
              aria-label={tr("\u4FEE\u6539\u6D88\u606F")}
            />

            <p>
              {tr(
                "\u53D1\u9001\u540E\u4F1A\u5220\u9664\u8FD9\u6761\u6D88\u606F\u4E4B\u540E\u7684\u6240\u6709\u5BF9\u8BDD\u5185\u5BB9\u3002",
              )}
            </p>
            <div className="user-message-editor__actions">
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => {
                  setEditDraft(text);
                  setEditing(false);
                  setActionError(null);
                }}
                disabled={actionBusy}
              >
                {tr("\u53D6\u6D88")}
              </button>
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => void submitRewrite()}
                disabled={
                  (!editDraft.trim() && attachments.length === 0) || rewriteDisabled || actionBusy
                }
              >
                {actionBusy ? <LoaderCircle className="spin" aria-hidden="true" size={14} /> : null}
                {tr("\u4FDD\u5B58\u5E76\u53D1\u9001")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {text ? (
              <div className="message__content">
                <MarkdownLite
                  text={text}
                  workspacePath={workspacePath}
                  onOpenError={onOpenError}
                  onOpenFile={onOpenFile}
                  allowLocalFiles={allowLocalFiles}
                />
              </div>
            ) : null}
            {attachments.length > 0 ? (
              <MessageAttachments
                attachments={attachments}
                onOpenFile={onOpenFile}
                allowLocalFiles={allowLocalFiles}
              />
            ) : null}
            <fieldset className="message-actions" aria-label={tr("\u6D88\u606F\u64CD\u4F5C")}>
              <button
                className="message-action"
                type="button"
                title={tr("\u590D\u5236\u6D88\u606F")}
                aria-label={tr("\u590D\u5236\u6D88\u606F")}
                onClick={() => void copy()}
              >
                {copied ? (
                  <Check aria-hidden="true" size={14} />
                ) : (
                  <Copy aria-hidden="true" size={14} />
                )}
              </button>
              <button
                className="message-action"
                type="button"
                title={tr("\u4FEE\u6539\u6D88\u606F\u5E76\u8986\u76D6\u540E\u7EED\u5BF9\u8BDD")}
                aria-label={tr("\u4FEE\u6539\u6D88\u606F")}
                disabled={rewriteDisabled}
                onClick={() => setEditing(true)}
              >
                <SquarePen aria-hidden="true" size={14} />
              </button>
              <button
                className="message-action"
                type="button"
                title={tr("\u91CD\u65B0\u53D1\u9001\u5E76\u8986\u76D6\u540E\u7EED\u5BF9\u8BDD")}
                aria-label={tr("\u91CD\u8BD5\u6D88\u606F")}
                disabled={rewriteDisabled}
                onClick={() => void retry()}
              >
                {actionBusy ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : (
                  <RotateCcw aria-hidden="true" size={14} />
                )}
              </button>
            </fieldset>
          </>
        )}
        {actionError ? <p className="message-action-error">{actionError}</p> : null}
      </article>
    );
  }

  if (!text && !reasoning && !error && toolCalls.length > 0 && visibleToolCalls.length === 0) {
    return null;
  }

  if (message.role === "tool") {
    return null;
  }

  return (
    <article className={`message message--assistant${executionGroup ? " message--execution" : ""}`}>
      {showAssistantHeader ? (
        orbit ? (
          <OrbitMessageMeta child={child} createdAt={message.createdAt} />
        ) : (
          <div className="message__meta">
            <span>MINGSHEN</span>
          </div>
        )
      ) : null}
      {reasoning ? (
        <details className="reasoning-block">
          <summary>{tr("\u601D\u8003\u6458\u8981")}</summary>
          <p>{reasoning}</p>
        </details>
      ) : null}
      {text ? (
        <div className="message__content">
          <MarkdownLite
            text={text}
            workspacePath={workspacePath}
            onOpenError={onOpenError}
            onOpenFile={onOpenFile}
            allowLocalFiles={allowLocalFiles}
          />
        </div>
      ) : null}
      {visibleToolCalls.map((toolCall) => {
        const detail = toolDetailsForMessage(toolDetails, message.id, toolCall.callId);
        return (
          <ToolCallDetails
            key={toolCall.callId}
            toolCall={toolCall}
            output={detail?.output}
            isError={detail?.isError}
            orbit={orbit}
          />
        );
      })}
      {error?.type === "error" ? (
        <ExpandableText className="message-error" text={error.message} tone="error" />
      ) : null}
      {text && toolCalls.length === 0 ? (
        <fieldset
          className="message-actions message-actions--assistant"
          aria-label={tr("消息操作")}
        >
          <CopyButton text={text} label={tr("复制回复")} />
        </fieldset>
      ) : null}
    </article>
  );
});
