import {
  COMPANION_IPC_CHANNELS,
  COMPANION_TASK_PANEL_HEIGHT,
  COMPANION_TASK_PANEL_MIN_WIDTH,
  type CompanionInteractionMotion,
  type CompanionLayout,
  type CompanionMood,
  type CompanionPoint,
  type CompanionPreferences,
  type CompanionState,
  chatterIntervalMs,
  companionTaskStatusPriority,
  compareCompanionTasks,
  DEFAULT_COMPANION_PREFERENCES,
  normalizeCompanionAction,
  normalizeCompanionInteraction,
  normalizeCompanionPatch,
  normalizeCompanionPreferences,
} from "../../shared/desktop-companion";
import type { ChatStreamEvent } from "../../shared/domain";
import { RUNTIME_TERMINAL_STATUSES } from "../../shared/runtime";
import type { Repository } from "../storage/repository";

const PREFERENCES_SETTING_KEY = "desktop.companion.preferences.v1";
const EDGE_MARGIN = 24;
const PREFERENCE_SAVE_DELAY_MS = 250;
const PINNED_WINDOW_RESTORE_DELAY_MS = 120;
const PINNED_WINDOW_WATCH_INTERVAL_MS = 200;
const TRANSIENT_MOOD_MS = 4_000;
const MAX_TERMINAL_RUNS = 1_000;
const MAX_SESSION_TITLE_LENGTH = 80;
const IDLE_ANIMATIONS: readonly CompanionInteractionMotion[] = [
  "look_around",
  "stretch",
  "drink",
  "nod",
  "greet_wave",
];
const IDLE_INTERVAL_SECONDS = {
  off: [0, 0],
  low: [180, 300],
  normal: [90, 180],
  high: [45, 90],
} as const;
const COMPANION_CHAT_LINES = [
  ["记得起来活动一下。", "Remember to stretch a little."],
  ["喝口水，再继续也不错。", "A sip of water might help."],
  ["需要搭把手时叫我。", "Let me know if you need a hand."],
] as const;

export interface CompanionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompanionWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompanionWebContents {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, state: CompanionState): void;
  once(event: "did-finish-load", listener: () => void): void;
  on(
    event: "render-process-gone",
    listener: (_event: unknown, details: { reason: string }) => void,
  ): CompanionWebContents;
  on(
    event: "did-fail-load",
    listener: (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => void,
  ): CompanionWebContents;
  removeListener(
    event: "render-process-gone",
    listener: (_event: unknown, details: { reason: string }) => void,
  ): CompanionWebContents;
  removeListener(
    event: "did-fail-load",
    listener: (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => void,
  ): CompanionWebContents;
}

export interface CompanionWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  show(): void;
  showInactive?(): void;
  restore(): void;
  hide(): void;
  destroy(): void;
  getBounds(): CompanionBounds;
  setBounds(bounds: CompanionBounds): void;
  moveTop?(): void;
  setAlwaysOnTop(flag: boolean, level?: "floating" | "screen-saver"): void;
  setOpacity(opacity: number): void;
  webContents: CompanionWebContents;
  on(event: "close", listener: (event: { preventDefault(): void }) => void): CompanionWindow;
  on(
    event: "closed" | "move" | "hide" | "minimize" | "show" | "restore" | "blur",
    listener: () => void,
  ): CompanionWindow;
  removeListener(
    event: "close" | "closed" | "move" | "hide" | "minimize" | "show" | "restore" | "blur",
    listener: (...args: never[]) => void,
  ): CompanionWindow;
}

export interface CompanionControllerOptions {
  repository: Repository;
  createWindow: (bounds: CompanionBounds) => CompanionWindow;
  getWorkArea: (point?: CompanionPoint) => CompanionWorkArea;
  emitState?: (state: CompanionState) => void;
  onWindowFailure?: (source: "load" | "renderer", detail: string) => void;
  now?: () => number;
  random?: () => number;
  isReducedMotion?: () => boolean;
}

export class CompanionController {
  private readonly repository: Repository;
  private readonly createWindow: CompanionControllerOptions["createWindow"];
  private readonly getWorkArea: CompanionControllerOptions["getWorkArea"];
  private readonly emitState: (state: CompanionState) => void;
  private readonly onWindowFailure: NonNullable<CompanionControllerOptions["onWindowFailure"]>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly isReducedMotion: () => boolean;
  private preferences: CompanionPreferences;
  private mood: CompanionMood = "idle";
  private message: readonly [string, string] | null = null;
  private window: CompanionWindow | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private transientMoodTimer: ReturnType<typeof setTimeout> | null = null;
  private menuFailureTimer: ReturnType<typeof setTimeout> | null = null;
  private persistenceTimer: ReturnType<typeof setTimeout> | null = null;
  private pinnedWindowRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  private pinnedWindowWatchTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInteractionAt: number;
  private lastChatterAt: number;
  private nextIdleAnimationAt = Number.POSITIVE_INFINITY;
  private chatterIndex = 0;
  private readonly activeRuns = new Set<string>();
  private readonly runDetails = new Map<
    string,
    { sessionId: string; runId: string; title: string | null; startedAt: number }
  >();
  private readonly terminalRuns = new Set<string>();
  private readonly activeRunActivity = new Set<string>();
  private readonly runtimeWaitingRuns = new Set<string>();
  private readonly approvalRunById = new Map<string, string>();
  private readonly questionRunById = new Map<string, string>();
  private disposed = false;
  private manualSleeping = false;
  private automaticGreeting = false;
  private menuFailureVisible = false;
  private motionRequest: CompanionState["motionRequest"] = null;
  private motionRequestId = 0;
  private taskPanelOpen = false;
  private nativeMenuOpen = false;
  private motionAvailable = false;
  private appliedLayout: CompanionLayout | null = null;
  private intentionallyHidden = false;

  constructor(options: CompanionControllerOptions) {
    this.repository = options.repository;
    this.createWindow = options.createWindow;
    this.getWorkArea = options.getWorkArea;
    this.emitState = options.emitState ?? (() => undefined);
    this.onWindowFailure = options.onWindowFailure ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.isReducedMotion = options.isReducedMotion ?? (() => false);
    this.preferences = normalizeCompanionPreferences(
      this.repository.getSetting(PREFERENCES_SETTING_KEY) ?? DEFAULT_COMPANION_PREFERENCES,
    );
    this.lastInteractionAt = this.now();
    this.lastChatterAt = this.lastInteractionAt;
    this.resetIdleAnimation();
  }

  getPreferences(): CompanionPreferences {
    return { ...this.preferences, position: clonePoint(this.preferences.position) };
  }

  getState(): CompanionState {
    const waitingRuns = new Set([
      ...this.runtimeWaitingRuns,
      ...this.approvalRunById.values(),
      ...this.questionRunById.values(),
    ]);
    const sessions = new Map<string, CompanionState["tasks"][number]>();
    for (const [key, details] of this.runDetails) {
      const status = waitingRuns.has(key)
        ? "waiting"
        : this.activeRunActivity.has(key)
          ? "working"
          : "thinking";
      const existing = sessions.get(details.sessionId);
      if (!existing) {
        sessions.set(details.sessionId, {
          ...details,
          title: this.preferences.showSessionTitles ? details.title : null,
          status,
        });
      } else if (
        companionTaskStatusPriority(status) > companionTaskStatusPriority(existing.status)
      ) {
        existing.status = status;
      }
      if (existing) existing.startedAt = Math.min(existing.startedAt, details.startedAt);
    }
    return {
      visible: this.isVisible(),
      mood: this.manualSleeping && this.mood !== "dragging" ? "sleeping" : this.mood,
      message: this.menuFailureVisible
        ? this.localize(
            "操作未完成，请重试或打开设置。",
            "Action could not be completed. Try again or open settings.",
          )
        : this.manualSleeping
          ? this.preferences.taskHintsEnabled
            ? this.localize("正在休息。", "Taking a break.")
            : null
          : this.message
            ? this.localize(...this.message)
            : null,
      progress: null,
      locale: this.repository.getSetting("desktop.locale") === "en" ? "en" : "zh",
      tasks: [...sessions.values()].sort(compareCompanionTasks),
      taskPanelOpen:
        this.taskPanelOpen && this.preferences.taskPanelEnabled && this.activeRuns.size > 0,
      layout: this.windowGeometry(this.currentPosition()).layout,
      motionRequest: this.motionRequest ? { ...this.motionRequest } : null,
      manualSleeping: this.manualSleeping,
      preferences: this.getPreferences(),
      updatedAt: this.now(),
    };
  }

  async setPreferences(input: unknown): Promise<CompanionPreferences> {
    this.assertAvailable();
    const patch = normalizeCompanionPatch(input);
    let nextPreferences = normalizeCompanionPreferences({ ...this.preferences, ...patch });
    if (Object.hasOwn(patch, "position") && patch.position === null) {
      const currentWindow = this.isWindowAlive() ? this.window : null;
      nextPreferences = {
        ...nextPreferences,
        position: this.defaultPosition(
          nextPreferences.size,
          currentWindow
            ? { x: currentWindow.getBounds().x, y: currentWindow.getBounds().y }
            : undefined,
        ),
      };
    }
    // Persist the candidate first so a failed write cannot leave memory and the
    // actual companion window out of sync. The caller can safely retry.
    this.persistPreferences(nextPreferences);
    if (
      nextPreferences.animationEnabled !== this.preferences.animationEnabled ||
      (nextPreferences.quietMode &&
        !this.preferences.quietMode &&
        this.motionRequest?.source === "idle") ||
      (nextPreferences.idleAnimationFrequency === "off" && this.motionRequest?.source === "idle")
    ) {
      this.motionRequest = null;
    }
    if (
      !this.preferences.positionLocked &&
      nextPreferences.positionLocked &&
      this.mood === "dragging"
    ) {
      this.mood = this.activeMood();
    }
    if (nextPreferences.quietMode && !this.preferences.quietMode && this.automaticGreeting) {
      this.automaticGreeting = false;
      this.clearTransientMoodTimer();
      if (this.mood === "greeting") {
        this.mood = this.activeMood();
        this.message = null;
      }
    }
    const resumeQuietMode = this.preferences.quietMode && !nextPreferences.quietMode;
    this.preferences = nextPreferences;
    if (resumeQuietMode) {
      this.lastInteractionAt = this.now();
      this.lastChatterAt = this.lastInteractionAt;
    }
    if (!this.preferences.taskPanelEnabled) this.taskPanelOpen = false;
    else if (patch.taskPanelEnabled === true && this.activeRuns.size) this.taskPanelOpen = true;
    if (!this.preferences.enabled || !this.preferences.alwaysOnTop)
      this.clearPinnedWindowRestoreTimer();
    if (
      Object.hasOwn(patch, "idleAnimationFrequency") ||
      Object.hasOwn(patch, "quietMode") ||
      Object.hasOwn(patch, "animationEnabled")
    )
      this.resetIdleAnimation();
    if (Object.hasOwn(patch, "taskHintsEnabled")) this.refreshTaskMessage();
    this.applyPreferencesToWindow();
    if (!this.preferences.enabled) this.hide();
    else if (patch.enabled === true && !this.isVisible()) this.show();
    this.scheduleIdleTimer();
    this.publish();
    return this.getPreferences();
  }

  show(): CompanionState {
    this.assertAvailable();
    this.intentionallyHidden = false;
    if (!this.preferences.enabled) {
      const nextPreferences = { ...this.preferences, enabled: true };
      this.persistPreferences(nextPreferences);
      this.preferences = nextPreferences;
    }
    const window = this.ensureWindow();
    this.syncPinnedWindowWatch(window);
    if (!window.isVisible()) {
      if (window.showInactive) window.showInactive();
      else window.show();
    }
    this.lastInteractionAt = this.now();
    this.lastChatterAt = this.lastInteractionAt;
    this.resetIdleAnimation();
    this.motionRequest = null;
    this.clearMenuFailure();
    this.clearTransientMoodTimer();
    if (this.activeRuns.size) {
      this.automaticGreeting = false;
      this.mood = this.activeMood();
      this.setActiveTaskMessage();
    } else {
      const greeting = this.preferences.greetingEnabled && !this.preferences.quietMode;
      this.automaticGreeting = greeting;
      this.mood = greeting ? "greeting" : "idle";
      this.message = greeting ? ["你好，我在这里。", "Hello, I am here."] : null;
      if (greeting) this.scheduleTransientMoodEnd();
    }
    this.scheduleIdleTimer();
    return this.publish();
  }

  hide(): CompanionState {
    this.intentionallyHidden = true;
    this.clearPinnedWindowRestoreTimer();
    this.clearPinnedWindowWatchTimer();
    this.clearIdleTimer();
    this.clearTransientMoodTimer();
    this.motionRequest = null;
    this.automaticGreeting = false;
    this.clearMenuFailure();
    if (this.isWindowAlive() && this.window?.isVisible()) this.window.hide();
    if (!this.activeRuns.size) {
      this.mood = "idle";
      this.message = null;
    }
    return this.publish();
  }

  toggle(): CompanionState {
    return this.isVisible() ? this.hide() : this.show();
  }

  action(input: unknown): CompanionState {
    this.assertAvailable();
    const action = normalizeCompanionAction(input);
    if (action.type === "interact") return this.interact(action.action);
    if (action.type === "task-panel") {
      this.taskPanelOpen =
        action.open && this.preferences.taskPanelEnabled && this.activeRuns.size > 0;
      return this.publish();
    }
    if (action.type === "drag") {
      if (this.preferences.positionLocked) return this.getState();
      this.moveTo(action);
      return this.publish();
    }

    if (
      this.preferences.positionLocked &&
      (action.type === "drag-start" || action.type === "drag-end")
    )
      return this.getState();

    this.recordInteraction();
    switch (action.type) {
      case "pat":
        this.manualSleeping = false;
        this.automaticGreeting = false;
        this.requestMotion("pat");
        if (this.activeRuns.size) {
          this.mood = this.activeMood();
          break;
        }
        this.clearTransientMoodTimer();
        this.mood = "greeting";
        this.message = this.preferences.greetingEnabled
          ? ["我在，慢慢来。", "I am here. Take your time."]
          : null;
        this.scheduleTransientMoodEnd();
        break;
      case "dismiss":
        return this.hide();
      case "hover":
        if (action.active) {
          if (!this.activeRuns.size && !this.transientMoodTimer) this.mood = "hover";
        } else if (this.mood === "hover") this.mood = this.activeMood();
        break;
      case "drag-start":
        this.mood = "dragging";
        this.clearIdleTimer();
        break;
      case "drag-end":
        this.mood = this.activeMood();
        this.scheduleIdleTimer();
        break;
    }
    return this.publish();
  }

  interact(input: unknown): CompanionState {
    this.assertAvailable();
    const interaction = normalizeCompanionInteraction(input);
    if (interaction === "sleep") {
      this.manualSleeping = true;
      this.motionRequest = null;
      this.clearIdleTimer();
    } else if (interaction === "wake") {
      this.manualSleeping = false;
      this.motionRequest = null;
      if (this.mood === "resting" || this.mood === "sleeping") this.mood = this.activeMood();
      this.recordInteraction();
    } else {
      if (this.manualSleeping && interaction !== "cancel_interaction") {
        this.manualSleeping = false;
        this.mood = this.activeMood();
      }
      this.recordInteraction();
      this.requestMotion(interaction);
    }
    return this.publish();
  }

  reportMenuFailure(): void {
    if (this.disposed) return;
    this.clearMenuFailure();
    this.menuFailureVisible = true;
    this.menuFailureTimer = setTimeout(() => {
      this.menuFailureTimer = null;
      this.menuFailureVisible = false;
      if (!this.disposed) this.publish();
    }, TRANSIENT_MOOD_MS);
    this.publish();
  }

  refreshLocale(): void {
    if (!this.disposed) this.publish();
  }

  setNativeMenuOpen(open: boolean): void {
    if (!this.disposed) this.nativeMenuOpen = open;
  }

  refreshDisplayBounds(): void {
    if (!this.disposed) this.publish();
  }

  setMotionAvailability(allowed: unknown): void {
    this.assertAvailable();
    if (typeof allowed !== "boolean") throw new Error("Invalid companion motion availability.");
    if (this.motionAvailable === allowed) return;
    this.motionAvailable = allowed;
    if (!allowed && this.motionRequest?.source === "idle") this.motionRequest = null;
    this.resetIdleAnimation();
    this.scheduleIdleTimer();
    this.publish();
  }

  canOpenSession(sessionId: unknown): sessionId is string {
    if (
      typeof sessionId !== "string" ||
      !sessionId ||
      ![...this.runDetails.values()].some((run) => run.sessionId === sessionId)
    )
      return false;
    const session = this.repository.getSession(sessionId);
    return Boolean(session && !session.archived);
  }

  handleChatEvent(event: ChatStreamEvent): void {
    if (this.disposed) return;
    const runId = "runId" in event ? runKey(event.sessionId, event.runId) : null;
    switch (event.type) {
      case "runtime_run_updated": {
        if (!runId || this.terminalRuns.has(runId)) return;
        const status = event.run.status;
        if (RUNTIME_TERMINAL_STATUSES.has(status)) {
          this.runtimeWaitingRuns.delete(runId);
          this.finishRun(
            runId,
            status === "completed"
              ? "success"
              : status === "failed" || status === "blocked_policy"
                ? "error"
                : "idle",
          );
          break;
        }
        if (!this.activeRuns.has(runId)) {
          const session = this.repository.getSession(event.sessionId);
          if (!session || session.archived) return;
          const startedAt = Date.parse(event.run.startedAt ?? event.run.createdAt);
          this.runDetails.set(runId, {
            sessionId: event.sessionId,
            runId: event.run.runId,
            title: sanitizeSessionTitle(session.title),
            startedAt: Number.isFinite(startedAt) ? startedAt : this.now(),
          });
          this.activeRuns.add(runId);
          this.automaticGreeting = false;
          if (this.preferences.taskPanelEnabled) this.taskPanelOpen = true;
          if (this.motionRequest?.source === "idle") this.motionRequest = null;
          this.clearIdleTimer();
          this.clearTransientMoodTimer();
        }
        if (status === "waiting_approval" || status === "waiting_user") {
          this.runtimeWaitingRuns.add(runId);
          this.activeRunActivity.add(runId);
        } else {
          this.runtimeWaitingRuns.delete(runId);
          this.clearWaitingApprovals(runId);
        }
        this.mood = this.activeMood();
        this.setActiveTaskMessage();
        break;
      }
      case "run_started":
        if (!runId || this.terminalRuns.has(runId) || this.activeRuns.has(runId)) return;
        {
          const session = this.repository.getSession(event.sessionId);
          if (!session || session.archived) return;
          this.runDetails.set(runId, {
            sessionId: event.sessionId,
            runId: event.runId,
            title: sanitizeSessionTitle(session.title),
            startedAt: this.now(),
          });
        }
        this.activeRuns.add(runId);
        this.automaticGreeting = false;
        if (this.preferences.taskPanelEnabled) this.taskPanelOpen = true;
        if (this.motionRequest?.source === "idle") this.motionRequest = null;
        this.activeRunActivity.delete(runId);
        this.clearIdleTimer();
        this.clearTransientMoodTimer();
        this.mood = this.activeMood();
        this.setActiveTaskMessage();
        break;
      case "activity":
        if (!this.activeRuns.has(runKey(event.activity.sessionId, event.activity.runId))) return;
        this.activeRunActivity.add(runKey(event.activity.sessionId, event.activity.runId));
        this.clearTransientMoodTimer();
        this.mood = this.activeMood();
        this.setActiveTaskMessage();
        break;
      case "approval_required":
        if (!runId || !this.activeRuns.has(runId)) return;
        this.activeRunActivity.add(runId);
        this.approvalRunById.set(event.approval.id, runId);
        this.clearTransientMoodTimer();
        this.mood = "waiting";
        this.setTaskMessage(["需要你确认一下。", "I need your confirmation."]);
        break;
      case "question_required":
        if (!runId || !this.activeRuns.has(runId)) return;
        this.activeRunActivity.add(runId);
        this.questionRunById.set(event.question.id, runId);
        this.clearTransientMoodTimer();
        this.mood = "waiting";
        this.setTaskMessage(["需要你确认一下。", "I need your confirmation."]);
        break;
      case "approval_state":
        this.replaceWaitingRuns(
          this.approvalRunById,
          event.state.requests.map((request) => [
            request.id,
            runKey(request.sessionId, request.runId),
          ]),
        );
        this.restoreActiveMoodIfReady();
        break;
      case "question_state":
        this.replaceWaitingRuns(
          this.questionRunById,
          event.state.requests.map((request) => [
            request.id,
            runKey(request.sessionId, request.runId),
          ]),
        );
        this.restoreActiveMoodIfReady();
        break;
      case "question_resolved":
        this.questionRunById.delete(event.questionId);
        this.restoreActiveMoodIfReady();
        break;
      case "run_completed":
        this.finishRun(runId, "success");
        break;
      case "run_failed":
        this.finishRun(runId, "error");
        break;
      case "run_interrupted":
        this.finishRun(runId, "idle");
        break;
      case "session_updated": {
        if (![...this.runDetails.values()].some((run) => run.sessionId === event.session.id))
          return;
        const session = this.repository.getSession(event.session.id);
        if (!session || session.archived) this.removeSessionRuns(event.session.id);
        else {
          for (const run of this.runDetails.values()) {
            if (run.sessionId === session.id) run.title = sanitizeSessionTitle(session.title);
          }
        }
        break;
      }
      case "session_removed":
        if (![...this.runDetails.values()].some((run) => run.sessionId === event.sessionId)) return;
        this.removeSessionRuns(event.sessionId);
        break;
      default:
        return;
    }
    this.publish();
  }

  isTrustedSender(webContentsId: number): boolean {
    return this.isWindowAlive() && this.window?.webContents.id === webContentsId;
  }

  attachWindow(window: CompanionWindow): void {
    this.assertAvailable();
    if (this.window && this.window !== window) {
      this.clearPinnedWindowRestoreTimer();
      this.clearPinnedWindowWatchTimer();
      this.detachWindow(this.window, true);
    }
    this.window = window;
    const onClose = (event: { preventDefault(): void }) => {
      if (this.disposed) return;
      event.preventDefault();
      this.intentionallyHidden = true;
      this.clearPinnedWindowRestoreTimer();
      this.clearPinnedWindowWatchTimer();
      window.hide();
      this.clearIdleTimer();
      this.clearTransientMoodTimer();
      this.clearMenuFailure();
      this.publish();
    };
    const onClosed = () => {
      this.clearPinnedWindowRestoreTimer();
      this.clearPinnedWindowWatchTimer();
      if (this.window === window) this.window = null;
      this.clearIdleTimer();
      this.clearTransientMoodTimer();
      this.clearMenuFailure();
      if (!this.disposed) this.publish();
    };
    const onMove = () => {
      if (this.window !== window || window.isDestroyed()) return;
      const bounds = window.getBounds();
      const currentPosition =
        this.preferences.position ?? this.defaultPosition(this.preferences.size, bounds);
      if (sameBounds(bounds, this.windowBounds(currentPosition))) return;
      const position = {
        x: bounds.x + bounds.width - (this.appliedLayout?.avatarSize ?? this.preferences.size),
        y: bounds.y,
      };
      this.preferences = { ...this.preferences, position };
      this.schedulePersistence();
      this.publish();
    };
    const onHide = () => this.schedulePinnedWindowRestore(window);
    const onMinimize = () => this.schedulePinnedWindowRestore(window);
    const onShowOrRestore = () => this.raisePinnedWindow(window);
    const onBlur = () => this.raisePinnedWindow(window);
    this.windowListeners = {
      window,
      onClose,
      onClosed,
      onMove,
      onHide,
      onMinimize,
      onShowOrRestore,
      onBlur,
    };
    window.on("close", onClose);
    window.on("closed", onClosed);
    window.on("move", onMove);
    window.on("hide", onHide);
    window.on("minimize", onMinimize);
    window.on("show", onShowOrRestore);
    window.on("restore", onShowOrRestore);
    window.on("blur", onBlur);
    window.webContents.on("render-process-gone", this.onRendererGone);
    window.webContents.on("did-fail-load", this.onLoadFailed);
    this.applyPreferencesToWindow();
    window.webContents.once("did-finish-load", () => {
      if (this.window === window && this.isWindowAlive()) this.publish();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPinnedWindowRestoreTimer();
    this.clearPinnedWindowWatchTimer();
    this.clearIdleTimer();
    this.clearTransientMoodTimer();
    this.clearMenuFailure();
    if (this.persistenceTimer) {
      this.clearPersistenceTimer();
      try {
        this.persistPreferences();
      } catch {
        // Shutdown must complete even when the final settings write fails.
      }
    }
    if (this.isWindowAlive()) {
      const window = this.window;
      if (window) this.detachWindow(window, false);
      window?.destroy();
    }
    this.window = null;
  }

  private windowListeners: {
    window: CompanionWindow;
    onClose: (event: { preventDefault(): void }) => void;
    onClosed: () => void;
    onMove: () => void;
    onHide: () => void;
    onMinimize: () => void;
    onShowOrRestore: () => void;
    onBlur: () => void;
  } | null = null;

  private readonly onRendererGone = (_event: unknown, details: { reason: string }): void => {
    this.failWindow("renderer", `Renderer exited: ${details.reason}`);
  };

  private readonly onLoadFailed = (
    _event: unknown,
    errorCode: number,
    errorDescription: string,
    _validatedURL: string,
    isMainFrame: boolean,
  ): void => {
    if (isMainFrame && errorCode !== -3)
      this.failWindow("load", `${errorDescription} (${errorCode})`);
  };

  private ensureWindow(): CompanionWindow {
    if (this.isWindowAlive()) return this.window as CompanionWindow;
    const position = this.preferences.position ?? this.defaultPosition(this.preferences.size);
    const window = this.createWindow(this.windowBounds(position));
    this.attachWindow(window);
    this.applyPreferencesToWindow();
    return window;
  }

  private applyPreferencesToWindow(): void {
    if (!this.isWindowAlive()) return;
    const window = this.window as CompanionWindow;
    this.applyWindowGeometry();
    this.setWindowTopmost(window);
    window.setOpacity(this.preferences.opacity);
    this.syncPinnedWindowWatch(window);
  }

  private syncPinnedWindowWatch(window: CompanionWindow): void {
    if (
      process.platform !== "win32" ||
      this.disposed ||
      this.window !== window ||
      window.isDestroyed() ||
      !this.preferences.enabled ||
      !this.preferences.alwaysOnTop ||
      this.intentionallyHidden
    ) {
      this.clearPinnedWindowWatchTimer();
      return;
    }
    if (this.pinnedWindowWatchTimer) return;
    this.pinnedWindowWatchTimer = setTimeout(() => {
      this.pinnedWindowWatchTimer = null;
      if (
        this.disposed ||
        this.window !== window ||
        window.isDestroyed() ||
        !this.preferences.enabled ||
        !this.preferences.alwaysOnTop ||
        this.intentionallyHidden
      )
        return;
      if (window.isMinimized() || !window.isVisible()) {
        this.schedulePinnedWindowRestore(window);
      } else if (!this.nativeMenuOpen) {
        // A competing topmost window can cover a non-focusable pet without a blur event.
        this.setWindowTopmost(window);
        window.moveTop?.();
      }
      this.syncPinnedWindowWatch(window);
    }, PINNED_WINDOW_WATCH_INTERVAL_MS);
  }

  private schedulePinnedWindowRestore(window: CompanionWindow): void {
    if (
      this.disposed ||
      this.window !== window ||
      window.isDestroyed() ||
      !this.preferences.enabled ||
      !this.preferences.alwaysOnTop ||
      this.intentionallyHidden ||
      this.pinnedWindowRestoreTimer
    )
      return;
    // Let Windows Shell finish its Show Desktop/minimize pass before restoring the pinned pet.
    this.pinnedWindowRestoreTimer = setTimeout(() => {
      this.pinnedWindowRestoreTimer = null;
      this.restorePinnedWindowAfterSystemHide(window);
    }, PINNED_WINDOW_RESTORE_DELAY_MS);
  }

  private restorePinnedWindowAfterSystemHide(window: CompanionWindow): void {
    if (
      this.disposed ||
      this.window !== window ||
      window.isDestroyed() ||
      !this.preferences.enabled ||
      !this.preferences.alwaysOnTop ||
      this.intentionallyHidden
    )
      return;

    this.setWindowTopmost(window);
    const wasMinimized = window.isMinimized();
    if (wasMinimized) window.restore();
    if (wasMinimized || !window.isVisible()) {
      if (window.showInactive) window.showInactive();
      else window.show();
    } else {
      window.moveTop?.();
    }
  }

  private raisePinnedWindow(window: CompanionWindow): void {
    if (
      this.window !== window ||
      window.isDestroyed() ||
      !this.preferences.enabled ||
      !this.preferences.alwaysOnTop ||
      this.intentionallyHidden
    )
      return;
    this.setWindowTopmost(window);
    window.moveTop?.();
  }

  private setWindowTopmost(window: CompanionWindow): void {
    const level =
      this.preferences.alwaysOnTop && process.platform === "win32" ? "screen-saver" : "floating";
    window.setAlwaysOnTop(this.preferences.alwaysOnTop, level);
  }

  private applyWindowGeometry(): void {
    if (!this.isWindowAlive()) return;
    const window = this.window as CompanionWindow;
    const bounds = window.getBounds();
    const { bounds: nextBounds, layout } = this.windowGeometry(this.currentPosition());
    this.appliedLayout = layout;
    if (!sameBounds(bounds, nextBounds)) window.setBounds(nextBounds);
  }

  private moveTo(point: CompanionPoint): void {
    const current = this.windowGeometry(this.currentPosition());
    const width = this.isWindowAlive()
      ? (this.window?.getBounds().width ?? current.bounds.width)
      : current.bounds.width;
    const avatarSize = this.appliedLayout?.avatarSize ?? current.layout.avatarSize;
    // Drag coordinates are the window's top-left; stored positions anchor the avatar.
    const position = {
      x: point.x + width - avatarSize,
      y: point.y,
    };
    const next = this.windowGeometry(position);
    position.x = next.bounds.x + next.bounds.width - next.layout.avatarSize;
    position.y = next.bounds.y;
    this.preferences = { ...this.preferences, position };
    this.schedulePersistence();
  }

  private defaultPosition(size: number, reference?: CompanionPoint): CompanionPoint {
    const area = this.getWorkArea(reference);
    return {
      x: Math.max(area.x, area.x + area.width - size - EDGE_MARGIN),
      y: Math.max(area.y, area.y + area.height - size - EDGE_MARGIN),
    };
  }

  private currentPosition(): CompanionPoint {
    const bounds = this.isWindowAlive() ? this.window?.getBounds() : undefined;
    return this.preferences.position ?? this.defaultPosition(this.preferences.size, bounds);
  }

  private windowBounds(avatarPosition: CompanionPoint): CompanionBounds {
    return this.windowGeometry(avatarPosition).bounds;
  }

  private windowGeometry(avatarPosition: CompanionPoint): {
    bounds: CompanionBounds;
    layout: CompanionLayout;
  } {
    const area = this.getWorkArea(avatarPosition);
    const maxWidth = Math.max(1, Math.floor(area.width));
    const maxHeight = Math.max(1, Math.floor(area.height));
    const expanded =
      this.taskPanelOpen && this.preferences.taskPanelEnabled && this.activeRuns.size > 0;
    const reservedPanel = expanded
      ? Math.min(COMPANION_TASK_PANEL_HEIGHT, Math.floor(maxHeight * 0.4))
      : 0;
    const avatarSize = Math.min(
      this.preferences.size,
      maxWidth,
      Math.max(1, maxHeight - reservedPanel),
    );
    const panelHeight = expanded
      ? Math.min(COMPANION_TASK_PANEL_HEIGHT, maxHeight - avatarSize)
      : 0;
    const width = Math.min(
      maxWidth,
      Math.max(avatarSize, expanded ? COMPANION_TASK_PANEL_MIN_WIDTH : avatarSize),
    );
    const height = avatarSize + panelHeight;
    const x = avatarPosition.x - (width - avatarSize);
    const maxX = area.x + Math.max(0, area.width - width);
    const maxY = area.y + Math.max(0, area.height - height);
    return {
      bounds: {
        x: Math.round(Math.max(area.x, Math.min(maxX, x))),
        y: Math.round(Math.max(area.y, Math.min(maxY, avatarPosition.y))),
        width,
        height,
      },
      layout: { avatarSize, panelHeight },
    };
  }

  private recordInteraction(): void {
    this.lastInteractionAt = this.now();
    this.lastChatterAt = this.lastInteractionAt;
    this.resetIdleAnimation();
    if (this.mood === "resting" || this.mood === "sleeping") {
      this.mood = "idle";
      this.message = null;
    }
    this.scheduleIdleTimer();
  }

  private scheduleIdleTimer(): void {
    this.clearIdleTimer();
    if (
      !this.isVisible() ||
      this.disposed ||
      this.manualSleeping ||
      this.activeRuns.size ||
      this.mood === "dragging" ||
      this.mood === "resting" ||
      this.mood === "sleeping"
    )
      return;
    const restMs = this.preferences.quietMode ? 0 : this.preferences.restAfterMinutes * 60_000;
    const chatterMs = this.preferences.quietMode
      ? 0
      : chatterIntervalMs(this.preferences.chattiness);
    const restAt = restMs > 0 ? this.lastInteractionAt + restMs : Number.POSITIVE_INFINITY;
    const chatterAt = chatterMs > 0 ? this.lastChatterAt + chatterMs : Number.POSITIVE_INFINITY;
    const animationAt = this.canPlayIdleAnimation()
      ? this.nextIdleAnimationAt
      : Number.POSITIVE_INFINITY;
    const dueAt = Math.min(restAt, chatterAt, animationAt);
    if (!Number.isFinite(dueAt)) return;
    this.idleTimer = setTimeout(() => this.onIdleTimer(), Math.max(0, dueAt - this.now()));
  }

  private onIdleTimer(): void {
    this.idleTimer = null;
    if (!this.isVisible() || this.disposed) return;
    if (this.activeRuns.size || this.manualSleeping || this.mood === "dragging") {
      this.scheduleIdleTimer();
      return;
    }
    const restMs = this.preferences.quietMode ? 0 : this.preferences.restAfterMinutes * 60_000;
    if (restMs > 0 && this.now() - this.lastInteractionAt >= restMs) {
      this.mood = "resting";
      this.message = this.preferences.taskHintsEnabled
        ? ["我先安静休息一会儿。", "I am taking a quiet break."]
        : null;
      this.publish();
      return;
    }
    const chatterMs = this.preferences.quietMode
      ? 0
      : chatterIntervalMs(this.preferences.chattiness);
    if (chatterMs > 0 && this.now() - this.lastChatterAt >= chatterMs) {
      this.lastChatterAt = this.now();
      if (this.mood === "idle" && this.preferences.chattiness !== "off") {
        this.clearTransientMoodTimer();
        this.automaticGreeting = true;
        this.mood = "greeting";
        this.message =
          COMPANION_CHAT_LINES[this.chatterIndex % COMPANION_CHAT_LINES.length] ?? null;
        this.chatterIndex += 1;
        this.publish();
        this.scheduleTransientMoodEnd();
      }
    }
    if (this.canPlayIdleAnimation() && this.now() >= this.nextIdleAnimationAt) {
      this.resetIdleAnimation();
      if (this.mood === "idle" && !this.transientMoodTimer) {
        const index = Math.min(
          IDLE_ANIMATIONS.length - 1,
          Math.floor(this.safeRandom() * IDLE_ANIMATIONS.length),
        );
        const action = IDLE_ANIMATIONS[index];
        if (action) {
          this.requestMotion(action, "idle");
          this.publish();
        }
      }
    }
    this.scheduleIdleTimer();
  }

  private canPlayIdleAnimation(): boolean {
    return (
      !this.preferences.quietMode &&
      this.preferences.animationEnabled &&
      this.preferences.idleAnimationFrequency !== "off" &&
      this.motionAvailable &&
      !this.isReducedMotion()
    );
  }

  private safeRandom(): number {
    const value = this.random();
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0;
  }

  private resetIdleAnimation(): void {
    const [min, max] = IDLE_INTERVAL_SECONDS[this.preferences.idleAnimationFrequency];
    this.nextIdleAnimationAt =
      min === 0
        ? Number.POSITIVE_INFINITY
        : this.now() + (min + this.safeRandom() * (max - min)) * 1000;
  }

  private setTaskMessage(message: readonly [string, string] | null): void {
    this.message = this.preferences.taskHintsEnabled ? message : null;
  }

  private refreshTaskMessage(): void {
    const messageByMood: Partial<Record<CompanionMood, [string, string]>> = {
      thinking: ["我开始处理了。", "I am getting started."],
      working: ["正在处理任务。", "Working on your task."],
      waiting: ["需要你确认一下。", "I need your confirmation."],
      success: ["任务已完成。", "Task complete."],
      error: ["任务未能完成。", "The task could not be completed."],
      resting: ["我先安静休息一会儿。", "I am taking a quiet break."],
    };
    const message = messageByMood[this.mood];
    if (!message) return;
    this.message = this.preferences.taskHintsEnabled ? message : null;
  }

  private finishRun(runId: string | null, terminalMood: "success" | "error" | "idle"): void {
    if (runId && !this.activeRuns.has(runId)) return;
    if (runId) this.forgetRun(runId);
    this.clearTransientMoodTimer();
    if (this.activeRuns.size) {
      this.mood = this.activeMood();
      this.setActiveTaskMessage();
      return;
    }
    this.taskPanelOpen = false;
    this.lastInteractionAt = this.now();
    this.lastChatterAt = this.lastInteractionAt;
    this.resetIdleAnimation();
    this.mood = terminalMood;
    this.setTaskMessage(
      terminalMood === "success"
        ? ["任务已完成。", "Task complete."]
        : terminalMood === "error"
          ? ["任务未能完成。", "The task could not be completed."]
          : null,
    );
    if (terminalMood !== "idle") this.scheduleTransientMoodEnd();
    else this.scheduleIdleTimer();
  }

  private forgetRun(runId: string): void {
    this.activeRuns.delete(runId);
    this.runDetails.delete(runId);
    this.activeRunActivity.delete(runId);
    this.runtimeWaitingRuns.delete(runId);
    this.terminalRuns.add(runId);
    if (this.terminalRuns.size > MAX_TERMINAL_RUNS) {
      const oldest = this.terminalRuns.values().next().value;
      if (oldest !== undefined) this.terminalRuns.delete(oldest);
    }
    for (const [id, waitingRunId] of this.approvalRunById) {
      if (waitingRunId === runId) this.approvalRunById.delete(id);
    }
    for (const [id, waitingRunId] of this.questionRunById) {
      if (waitingRunId === runId) this.questionRunById.delete(id);
    }
  }

  private removeSessionRuns(sessionId: string): void {
    for (const [key, run] of this.runDetails) {
      if (run.sessionId === sessionId) this.forgetRun(key);
    }
    this.clearTransientMoodTimer();
    this.mood = this.activeMood();
    this.setActiveTaskMessage();
    if (!this.activeRuns.size) {
      this.taskPanelOpen = false;
      this.message = null;
      this.lastInteractionAt = this.now();
      this.lastChatterAt = this.lastInteractionAt;
      this.resetIdleAnimation();
      this.scheduleIdleTimer();
    }
  }

  private restoreActiveMoodIfReady(): void {
    if (!this.activeRuns.size) return;
    if (this.hasWaitingRun()) {
      this.clearTransientMoodTimer();
      this.mood = "waiting";
      this.setTaskMessage(["需要你确认一下。", "I need your confirmation."]);
    } else if (this.mood === "waiting") {
      this.mood = this.activeMood();
      this.setTaskMessage(
        this.mood === "working"
          ? ["正在处理任务。", "Working on your task."]
          : ["我开始处理了。", "I am getting started."],
      );
    }
    this.publish();
  }

  private hasWaitingRun(): boolean {
    const active = this.activeRuns;
    return (
      [...this.runtimeWaitingRuns].some((runId) => active.has(runId)) ||
      [...this.approvalRunById.values(), ...this.questionRunById.values()].some((runId) =>
        active.has(runId),
      )
    );
  }

  private clearWaitingApprovals(runId: string): void {
    for (const [id, waitingRunId] of this.approvalRunById) {
      if (waitingRunId === runId) this.approvalRunById.delete(id);
    }
    for (const [id, waitingRunId] of this.questionRunById) {
      if (waitingRunId === runId) this.questionRunById.delete(id);
    }
  }

  private replaceWaitingRuns(target: Map<string, string>, entries: Array<[string, string]>): void {
    const next = new Map(entries.filter(([, runId]) => this.activeRuns.has(runId)));
    for (const id of target.keys()) if (!next.has(id)) target.delete(id);
    for (const [id, runId] of next) {
      target.set(id, runId);
      this.activeRunActivity.add(runId);
    }
  }

  private scheduleTransientMoodEnd(): void {
    this.clearTransientMoodTimer();
    this.transientMoodTimer = setTimeout(() => {
      this.transientMoodTimer = null;
      this.automaticGreeting = false;
      if (this.disposed || !this.isVisible()) return;
      if (this.activeRuns.size) {
        this.restoreActiveMoodIfReady();
        return;
      }
      this.mood = "idle";
      this.message = null;
      this.publish();
      this.scheduleIdleTimer();
    }, TRANSIENT_MOOD_MS);
  }

  private activeMood(): CompanionMood {
    if (this.activeRuns.size) {
      if (this.hasWaitingRun()) return "waiting";
      return [...this.activeRuns].some((runId) => this.activeRunActivity.has(runId))
        ? "working"
        : "thinking";
    }
    return "idle";
  }

  private setActiveTaskMessage(): void {
    this.setTaskMessage(
      this.mood === "waiting"
        ? ["需要你确认一下。", "I need your confirmation."]
        : this.mood === "working"
          ? ["正在处理任务。", "Working on your task."]
          : ["我开始处理了。", "I am getting started."],
    );
  }

  private requestMotion(
    action: CompanionInteractionMotion,
    source: "manual" | "idle" = "manual",
  ): void {
    this.motionRequestId += 1;
    this.motionRequest = { id: this.motionRequestId, action, source };
  }

  private publish(): CompanionState {
    this.applyWindowGeometry();
    const state = this.getState();
    try {
      this.emitState(state);
    } catch {
      // State consumers may be closing independently of the overlay.
    }
    if (this.isWindowAlive()) {
      try {
        this.window?.webContents.send(COMPANION_IPC_CHANNELS.state, state);
      } catch {
        // A failed renderer send must not interrupt task or shutdown handling.
      }
    }
    return state;
  }

  private persistPreferences(preferences = this.preferences): void {
    this.repository.setSetting(PREFERENCES_SETTING_KEY, {
      ...preferences,
      position: clonePoint(preferences.position),
    });
  }

  private schedulePersistence(): void {
    this.clearPersistenceTimer();
    this.persistenceTimer = setTimeout(() => {
      this.persistenceTimer = null;
      if (this.disposed) return;
      try {
        this.persistPreferences();
      } catch {
        // Keep the current in-memory position; a later preference save retries it.
      }
    }, PREFERENCE_SAVE_DELAY_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private clearTransientMoodTimer(): void {
    if (this.transientMoodTimer) clearTimeout(this.transientMoodTimer);
    this.transientMoodTimer = null;
  }

  private clearMenuFailure(): void {
    if (this.menuFailureTimer) clearTimeout(this.menuFailureTimer);
    this.menuFailureTimer = null;
    this.menuFailureVisible = false;
  }

  private clearPersistenceTimer(): void {
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer);
    this.persistenceTimer = null;
  }

  private clearPinnedWindowRestoreTimer(): void {
    if (this.pinnedWindowRestoreTimer) clearTimeout(this.pinnedWindowRestoreTimer);
    this.pinnedWindowRestoreTimer = null;
  }

  private clearPinnedWindowWatchTimer(): void {
    if (this.pinnedWindowWatchTimer) clearTimeout(this.pinnedWindowWatchTimer);
    this.pinnedWindowWatchTimer = null;
  }

  private isVisible(): boolean {
    return this.isWindowAlive() && Boolean(this.window?.isVisible());
  }

  private isWindowAlive(): boolean {
    return Boolean(this.window && !this.window.isDestroyed());
  }

  private detachWindow(window: CompanionWindow, destroy: boolean): void {
    if (this.window === window) {
      this.clearPinnedWindowRestoreTimer();
      this.clearPinnedWindowWatchTimer();
    }
    const listeners = this.windowListeners;
    if (listeners?.window === window) {
      window.removeListener("close", listeners.onClose as (...args: never[]) => void);
      window.removeListener("closed", listeners.onClosed as (...args: never[]) => void);
      window.removeListener("move", listeners.onMove as (...args: never[]) => void);
      window.removeListener("hide", listeners.onHide as (...args: never[]) => void);
      window.removeListener("minimize", listeners.onMinimize as (...args: never[]) => void);
      window.removeListener("show", listeners.onShowOrRestore as (...args: never[]) => void);
      window.removeListener("restore", listeners.onShowOrRestore as (...args: never[]) => void);
      window.removeListener("blur", listeners.onBlur as (...args: never[]) => void);
      this.windowListeners = null;
      window.webContents.removeListener("render-process-gone", this.onRendererGone);
      window.webContents.removeListener("did-fail-load", this.onLoadFailed);
    }
    if (destroy && !window.isDestroyed()) window.destroy();
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error("Desktop companion is shutting down.");
  }

  private failWindow(source: "load" | "renderer", detail: string): void {
    const window = this.window;
    if (!window) return;
    this.clearIdleTimer();
    this.clearTransientMoodTimer();
    this.clearMenuFailure();
    this.motionAvailable = false;
    this.detachWindow(window, false);
    this.window = null;
    if (!window.isDestroyed()) window.destroy();
    try {
      this.onWindowFailure(source, detail);
    } catch {
      // A logging failure must not preserve a broken transparent window.
    }
    if (!this.disposed) this.publish();
  }

  private localize(chinese: string, english: string): string {
    return this.repository.getSetting("desktop.locale") === "en" ? english : chinese;
  }
}

function clonePoint(point: CompanionPoint | null): CompanionPoint | null {
  return point ? { x: point.x, y: point.y } : null;
}

function runKey(sessionId: string, runId: string): string {
  return JSON.stringify([sessionId, runId]);
}

function sanitizeSessionTitle(title: string): string | null {
  const normalized = title
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return null;
  const characters = Array.from(normalized);
  return characters.length > MAX_SESSION_TITLE_LENGTH
    ? `${characters.slice(0, MAX_SESSION_TITLE_LENGTH - 1).join("")}…`
    : normalized;
}

function sameBounds(left: CompanionBounds, right: CompanionBounds): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}
