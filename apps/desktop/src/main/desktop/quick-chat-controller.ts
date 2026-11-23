import type {
  ChatStreamEvent,
  CompactionModelChoice,
  ContextUsageView,
  ModelConfig,
  ProviderView,
  SessionCreateInput,
  SessionView,
} from "../../shared/domain";
import { IPC_CHANNELS } from "../../shared/ipc";
import { isTextModel } from "../../shared/model-capabilities";
import { QUICK_CHAT_TTL_MS, type QuickChatState } from "../../shared/quick-chat";
import type { SessionService } from "../sessions/session-service";
import type { Repository } from "../storage/repository";

const LEASE_SETTING_KEY = "desktop.quickChat.lease";
const ALWAYS_ON_TOP_SETTING_KEY = "desktop.quickChat.alwaysOnTop";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_UPDATE_KEYS = new Set([
  "sessionId",
  "title",
  "providerId",
  "modelId",
  "reasoningLevel",
  "compactionModel",
  "chatNetworkEnabled",
]);
const SAFE_GLOBAL_CHANNELS = new Set<string>([
  IPC_CHANNELS.appInfo,
  IPC_CHANNELS.uiPreferencesGet,
  IPC_CHANNELS.modelCatalogGet,
  IPC_CHANNELS.modelCatalogProviderMove,
  IPC_CHANNELS.modelCatalogStarSet,
  IPC_CHANNELS.desktopState,
  IPC_CHANNELS.runtimeLogReport,
  IPC_CHANNELS.editCommand,
  IPC_CHANNELS.openExternalUrl,
  IPC_CHANNELS.quickChatState,
  IPC_CHANNELS.quickChatAction,
]);
const SESSION_ID_FIRST_CHANNELS = new Set<string>([
  IPC_CHANNELS.sessionGet,
  IPC_CHANNELS.sessionMessages,
  IPC_CHANNELS.sessionRunState,
  IPC_CHANNELS.contextUsage,
  IPC_CHANNELS.composerDraftGet,
  IPC_CHANNELS.composerDraftClear,
  IPC_CHANNELS.chatStop,
  IPC_CHANNELS.chatCompact,
  IPC_CHANNELS.runSteeringGet,
]);

interface StoredLease {
  sessionId: string;
  expiresAt: number;
}

export interface QuickChatControllerOptions {
  repository: Repository;
  sessionService: SessionService;
  context: (sessionId: string) => Promise<ContextUsageView | null> | ContextUsageView | null;
  isBusy: (sessionId: string) => boolean;
  emit: (event: ChatStreamEvent) => void;
  now?: () => number;
}

export class QuickChatController {
  private readonly repository: Repository;
  private readonly sessionService: SessionService;
  private readonly context: QuickChatControllerOptions["context"];
  private readonly isBusy: QuickChatControllerOptions["isBusy"];
  private readonly emit: QuickChatControllerOptions["emit"];
  private readonly now: () => number;
  private lease: StoredLease | null;
  private activation: Promise<QuickChatState> | null = null;
  private lastError: string | null = null;

  constructor(options: QuickChatControllerOptions) {
    this.repository = options.repository;
    this.sessionService = options.sessionService;
    this.context = options.context;
    this.isBusy = options.isBusy;
    this.emit = options.emit;
    this.now = options.now ?? Date.now;
    this.lease = this.readLease();
  }

  get currentSessionId(): string | null {
    return this.lease?.sessionId ?? null;
  }

  get pinned(): boolean {
    return this.repository.getSetting(ALWAYS_ON_TOP_SETTING_KEY) === true;
  }

  async togglePinned(): Promise<QuickChatState> {
    const pinned = !this.pinned;
    this.repository.setSetting(ALWAYS_ON_TOP_SETTING_KEY, pinned);
    return this.state();
  }

  isCurrentBusy(): boolean {
    const sessionId = this.currentSessionId;
    return sessionId ? this.isBusy(sessionId) : false;
  }

  acceptsSession(sessionId: string | null): boolean {
    return Boolean(
      sessionId &&
        sessionId === this.currentSessionId &&
        this.structuralSession(sessionId) !== null,
    );
  }

  acceptsDraftSession(sessionId: string | null): boolean {
    return Boolean(
      sessionId &&
        sessionId === this.currentSessionId &&
        this.structuralSession(sessionId, true) !== null,
    );
  }

  activate(forceNew = false): Promise<QuickChatState> {
    if (!forceNew && this.activation) return this.activation;
    const previous = forceNew ? this.activation : null;
    const task = (async () => {
      if (previous) await previous.catch(() => undefined);
      return this.performActivate(forceNew);
    })();
    this.activation = task;
    const clear = () => {
      if (this.activation === task) this.activation = null;
    };
    void task.then(clear, clear);
    return task;
  }

  async state(): Promise<QuickChatState> {
    const sessionId = this.currentSessionId;
    const initialSession = sessionId ? this.structuralSession(sessionId, true) : null;
    const context = initialSession
      ? await Promise.resolve(this.context(initialSession.id)).catch(() => null)
      : null;
    if (sessionId !== this.currentSessionId) return this.state();
    const providers = this.repository.listProviders();
    const session = sessionId ? this.structuralSession(sessionId, true) : null;
    if (sessionId && !session) {
      this.lease = null;
      this.persistLease();
    }
    let error: string | null = null;
    if (session && !this.validPair(session.providerId, session.modelId)) {
      error = this.missingModelError();
    } else if (!session && !this.hasUsableTextModel()) {
      error = this.missingModelError();
    } else {
      error = this.lastError;
    }
    return {
      session,
      providers,
      messages: session ? this.sessionService.getMessages(session.id) : [],
      runState: session ? this.repository.latestSessionRun(session.id) : null,
      context: session ? context : null,
      expiresAt: this.lease?.expiresAt ?? null,
      pinned: this.pinned,
      error,
    };
  }

  permitsIpc(channel: string, args: unknown[]): boolean {
    if (!Array.isArray(args)) return false;
    if (SAFE_GLOBAL_CHANNELS.has(channel)) {
      if (channel === IPC_CHANNELS.openExternalUrl) {
        return args.length === 1 && typeof args[0] === "string" && /^https?:\/\//i.test(args[0]);
      }
      if (channel === IPC_CHANNELS.editCommand) {
        return args.length === 1 && ["copy", "cut", "paste", "selectAll"].includes(String(args[0]));
      }
      if (channel === IPC_CHANNELS.quickChatState) return args.length === 0;
      if (channel === IPC_CHANNELS.quickChatAction) {
        return (
          args.length === 1 &&
          ["show", "new", "toggle", "hide", "open-main", "configure", "toggle-pin"].includes(
            String(args[0]),
          )
        );
      }
      return true;
    }
    if (channel === IPC_CHANNELS.desktopAction) {
      return (
        args.length >= 1 &&
        args.length <= 3 &&
        ["show", "minimize", "close", "tray"].includes(String(args[0])) &&
        (args.length < 2 || args[1] === undefined) &&
        (args.length < 3 || args[2] === undefined)
      );
    }
    if (channel === IPC_CHANNELS.sessionUpdate) return this.safeSessionUpdate(args[0]);
    if (channel === IPC_CHANNELS.sessionOpened) {
      return args.length === 1 && (args[0] === null || this.acceptsSession(asString(args[0])));
    }
    if (channel === IPC_CHANNELS.chatSend || channel === IPC_CHANNELS.chatRewrite) {
      return this.acceptsSession(this.inputSessionId(args[0]));
    }
    if (channel === IPC_CHANNELS.runSteeringSend) {
      return args.length === 1 && this.acceptsSession(this.inputSessionId(args[0]));
    }
    if (channel === IPC_CHANNELS.composerDraftSave) {
      return args.length === 1 && this.acceptsDraftSession(this.inputSessionId(args[0]));
    }
    if (channel === IPC_CHANNELS.composerDraftGet) {
      return args.length === 1 && this.acceptsDraftSession(asString(args[0]));
    }
    if (channel === IPC_CHANNELS.composerDraftClear) {
      return (
        args.length === 2 &&
        this.acceptsDraftSession(asString(args[0])) &&
        typeof args[1] === "string" &&
        Boolean(args[1])
      );
    }
    if (SESSION_ID_FIRST_CHANNELS.has(channel)) {
      return args.length === 1 && this.acceptsSession(asString(args[0]));
    }
    return false;
  }

  permitsRuntimeEvent(event: ChatStreamEvent): boolean {
    if (event.type === "context_updated") return this.acceptsSession(event.context.sessionId);
    if (event.type === "session_updated") return this.acceptsDraftSession(event.session.id);
    if (event.type === "session_removed") return event.sessionId === this.currentSessionId;
    if (event.type === "activity") return this.acceptsSession(event.activity.sessionId);
    if ("sessionId" in event) return this.acceptsSession(event.sessionId);
    return false;
  }

  private async performActivate(forceNew: boolean): Promise<QuickChatState> {
    if (!forceNew && this.reusableLease()) {
      this.lastError = null;
      this.renewLease();
      return this.state();
    }

    this.lease = null;
    const selection = this.selectModel();
    if (!selection) {
      this.lastError = this.missingModelError();
      this.persistLease();
      return this.state();
    }

    const source = selection.source?.agentMode === "chat" ? selection.source : null;
    const inheritedCompaction = this.inheritedCompaction(source);
    const input: SessionCreateInput = {
      title: this.newTitle(),
      providerId: selection.provider.id,
      modelId: selection.model.id,
      agentMode: "chat",
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: this.reasoningLevel(source, selection.model),
      permissionMode: "request_approval",
      approvalMode: "manual",
      executionMode: "host",
      patchOnly: false,
      ...(source?.chatNetworkEnabled === false ? { chatNetworkEnabled: false } : {}),
      ...(inheritedCompaction ? { compactionModel: inheritedCompaction } : {}),
    };

    let session: SessionView;
    try {
      session = this.sessionService.create(input);
    } catch (cause) {
      this.lastError = cause instanceof Error ? cause.message : String(cause);
      return this.state();
    }
    this.lastError = null;
    this.lease = { sessionId: session.id, expiresAt: this.now() + QUICK_CHAT_TTL_MS };
    this.persistLease();
    try {
      this.emit({ type: "session_updated", session });
    } catch {
      // The session is valid even if a window listener has already gone away.
    }
    return this.state();
  }

  private reusableLease(): boolean {
    const lease = this.lease;
    if (!lease || this.now() >= lease.expiresAt) return false;
    const session = this.structuralSession(lease.sessionId);
    return Boolean(session && this.validPair(session.providerId, session.modelId));
  }

  private renewLease(): void {
    if (!this.lease) return;
    const session = this.structuralSession(this.lease.sessionId);
    this.lease = {
      sessionId: this.lease.sessionId,
      expiresAt: this.now() + QUICK_CHAT_TTL_MS,
    };
    this.persistLease();
    if (session) this.emit({ type: "session_updated", session });
  }

  private structuralSession(sessionId: string, allowArchived = false): SessionView | null {
    if (!UUID_PATTERN.test(sessionId)) return null;
    const session = this.repository.getSession(sessionId);
    if (
      session?.agentMode !== "chat" ||
      (session.archived && !allowArchived) ||
      session.parentSessionId !== null ||
      session.workspacePath !== null ||
      session.agentProfileId !== "primary" ||
      session.permissionMode !== "request_approval" ||
      session.executionMode !== "host" ||
      session.patchOnly
    )
      return null;
    return session;
  }

  private validPair(providerId: string | null, modelId: string | null): boolean {
    if (!providerId || !modelId) return false;
    const provider = this.repository.getProvider(providerId);
    return Boolean(
      provider?.models.some((model) => model.id === modelId && model.enabled && isTextModel(model)),
    );
  }

  private hasUsableTextModel(): boolean {
    return this.repository
      .listProviders()
      .some((provider) => provider.models.some((model) => model.enabled && isTextModel(model)));
  }

  private selectModel(): {
    provider: ProviderView;
    model: ModelConfig;
    source: SessionView | null;
  } | null {
    this.releaseSessionIfInvalid();
    const sessions = this.repository
      .listSessions()
      .filter((session) => !session.archived)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    for (const source of sessions.filter((session) => session.agentMode === "chat")) {
      const pair = this.pair(source.providerId, source.modelId);
      if (pair) return { ...pair, source };
    }
    for (const source of sessions.filter(
      (session) => session.agentMode === "work" || session.agentMode === "code",
    )) {
      const pair = this.pair(source.providerId, source.modelId);
      if (pair) return { ...pair, source };
    }
    const providers = this.repository
      .listProviders()
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    for (const provider of providers) {
      const model = provider.models.find(
        (candidate) => candidate.enabled && isTextModel(candidate),
      );
      if (model) return { provider, model, source: null };
    }
    return null;
  }

  private pair(
    providerId: string | null,
    modelId: string | null,
  ): { provider: ProviderView; model: ModelConfig } | null {
    if (!providerId || !modelId) return null;
    const provider = this.repository.getProvider(providerId);
    const model = provider?.models.find(
      (candidate) => candidate.id === modelId && candidate.enabled && isTextModel(candidate),
    );
    return provider && model ? { provider, model } : null;
  }

  private reasoningLevel(source: SessionView | null, model: ModelConfig): string | null {
    if (!source?.reasoningLevel || !model.reasoningLevels.includes(source.reasoningLevel))
      return null;
    return source.reasoningLevel;
  }

  private inheritedCompaction(source: SessionView | null): CompactionModelChoice | undefined {
    const choice = source?.compactionModel;
    if (!choice) return undefined;
    if (choice.mode !== "custom") return choice;
    if (!this.validPair(choice.providerId, choice.modelId)) return undefined;
    return choice;
  }

  private safeSessionUpdate(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const input = value as Record<string, unknown>;
    if (!this.acceptsSession(asString(input.sessionId))) return false;
    return Object.keys(input).every((key) => SESSION_UPDATE_KEYS.has(key));
  }

  private inputSessionId(value: unknown): string | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return asString((value as Record<string, unknown>).sessionId);
  }

  private readLease(): StoredLease | null {
    const value = this.repository.getSetting(LEASE_SETTING_KEY);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const lease = value as Record<string, unknown>;
    const sessionId = asString(lease.sessionId);
    const expiresAt = lease.expiresAt;
    if (
      !UUID_PATTERN.test(sessionId) ||
      typeof expiresAt !== "number" ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= this.now() ||
      expiresAt > this.now() + QUICK_CHAT_TTL_MS
    )
      return null;
    return { sessionId, expiresAt };
  }

  private releaseSessionIfInvalid(): void {
    if (this.lease && !this.structuralSession(this.lease.sessionId)) {
      this.lease = null;
      this.persistLease();
    }
  }

  private persistLease(): void {
    try {
      this.repository.setSetting(LEASE_SETTING_KEY, this.lease);
    } catch {
      // A persistence failure must not prevent the in-memory temporary chat session.
    }
  }

  private missingModelError(): string {
    return this.repository.getSetting("desktop.locale") === "en"
      ? "No enabled text model is available. Configure a provider in the main window."
      : "尚无可用模型。请先在主界面配置供应商和模型。";
  }

  private newTitle(): string {
    return this.repository.getSetting("desktop.locale") === "en" ? "Quick chat" : "快捷对话";
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
