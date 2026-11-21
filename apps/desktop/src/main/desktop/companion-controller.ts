import {
  COMPANION_IPC_CHANNELS,
  type CompanionMood,
  type CompanionPoint,
  type CompanionPreferences,
  type CompanionState,
  chatterIntervalMs,
  DEFAULT_COMPANION_PREFERENCES,
  normalizeCompanionAction,
  normalizeCompanionPatch,
  normalizeCompanionPreferences,
} from "../../shared/desktop-companion";
import type { ChatStreamEvent } from "../../shared/domain";
import type { Repository } from "../storage/repository";

const PREFERENCES_SETTING_KEY = "desktop.companion.preferences.v1";
const EDGE_MARGIN = 24;
const PREFERENCE_SAVE_DELAY_MS = 250;
const TRANSIENT_MOOD_MS = 4_000;
const COMPANION_CHAT_LINES = [
  ["记得起来活动一下。", "喝口水，再继续也不错。", "需要搭把手时叫我。"],
  [
    "Remember to stretch a little.",
    "A sip of water might help.",
    "Let me know if you need a hand.",
  ],
];

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
  show(): void;
  showInactive?(): void;
  hide(): void;
  destroy(): void;
  getBounds(): CompanionBounds;
  setBounds(bounds: CompanionBounds): void;
  setAlwaysOnTop(flag: boolean, level?: "floating"): void;
  setOpacity(opacity: number): void;
  webContents: CompanionWebContents;
  on(event: "close", listener: (event: { preventDefault(): void }) => void): CompanionWindow;
  on(event: "closed" | "move", listener: () => void): CompanionWindow;
  removeListener(
    event: "close" | "closed" | "move",
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
}

export class CompanionController {
  private readonly repository: Repository;
  private readonly createWindow: CompanionControllerOptions["createWindow"];
  private readonly getWorkArea: CompanionControllerOptions["getWorkArea"];
  private readonly emitState: (state: CompanionState) => void;
  private readonly onWindowFailure: NonNullable<CompanionControllerOptions["onWindowFailure"]>;
  private readonly now: () => number;
  private preferences: CompanionPreferences;
  private mood: CompanionMood = "idle";
  private message: string | null = null;
  private window: CompanionWindow | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private transientMoodTimer: ReturnType<typeof setTimeout> | null = null;
  private persistenceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInteractionAt: number;
  private lastChatterAt: number;
  private chatterIndex = 0;
  private readonly activeRuns = new Set<string>();
  private readonly activeRunActivity = new Set<string>();
  private readonly approvalRunById = new Map<string, string>();
  private readonly questionRunById = new Map<string, string>();
  private disposed = false;

  constructor(options: CompanionControllerOptions) {
    this.repository = options.repository;
    this.createWindow = options.createWindow;
    this.getWorkArea = options.getWorkArea;
    this.emitState = options.emitState ?? (() => undefined);
    this.onWindowFailure = options.onWindowFailure ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.preferences = normalizeCompanionPreferences(
      this.repository.getSetting(PREFERENCES_SETTING_KEY) ?? DEFAULT_COMPANION_PREFERENCES,
    );
    this.lastInteractionAt = this.now();
    this.lastChatterAt = this.lastInteractionAt;
  }

  getPreferences(): CompanionPreferences {
    return { ...this.preferences, position: clonePoint(this.preferences.position) };
  }

  getState(): CompanionState {
    return {
      visible: this.isVisible(),
      mood: this.mood,
      message: this.message,
      progress: null,
      preferences: this.getPreferences(),
      updatedAt: this.now(),
    };
  }

  async setPreferences(input: unknown): Promise<CompanionPreferences> {
    this.assertAvailable();
    const patch = normalizeCompanionPatch(input);
    const wasEnabled = this.preferences.enabled;
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
    this.preferences = nextPreferences;
    if (Object.hasOwn(patch, "taskHintsEnabled")) this.refreshTaskMessage();
    this.applyPreferencesToWindow();
    if (!this.preferences.enabled) this.hide();
    else if (!wasEnabled) this.show();
    this.scheduleIdleTimer();
    this.publish();
    return this.getPreferences();
  }

  show(): CompanionState {
    this.assertAvailable();
    if (!this.preferences.enabled) {
      this.preferences = { ...this.preferences, enabled: true };
      this.persistPreferences();
    }
    const window = this.ensureWindow();
    if (!window.isVisible()) {
      if (window.showInactive) window.showInactive();
      else window.show();
    }
    this.lastInteractionAt = this.now();
    this.lastChatterAt = this.lastInteractionAt;
    this.clearTransientMoodTimer();
    if (this.activeRuns.size) {
      this.mood = this.activeMood();
      this.message = this.preferences.taskHintsEnabled
        ? this.localize("我正在处理任务。", "I am working on a task.")
        : null;
    } else {
      this.mood = this.preferences.greetingEnabled ? "greeting" : "idle";
      this.message = this.preferences.greetingEnabled
        ? this.localize("你好，我在这里。", "Hello, I am here.")
        : null;
      if (this.preferences.greetingEnabled) this.scheduleTransientMoodEnd();
    }
    this.scheduleIdleTimer();
    return this.publish();
  }

  hide(): CompanionState {
    this.clearIdleTimer();
    this.clearTransientMoodTimer();
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
    if (action.type === "drag") {
      this.moveTo(action);
      return this.publish();
    }

    this.recordInteraction();
    switch (action.type) {
      case "pat":
        if (this.activeRuns.size) break;
        this.clearTransientMoodTimer();
        this.mood = "greeting";
        this.message = this.preferences.greetingEnabled
          ? this.localize("我在，慢慢来。", "I am here. Take your time.")
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
        break;
      case "drag-end":
        this.mood = this.activeMood();
        break;
    }
    return this.publish();
  }

  handleChatEvent(event: ChatStreamEvent): void {
    if (this.disposed) return;
    const runId = "runId" in event ? `${event.sessionId}:${event.runId}` : null;
    switch (event.type) {
      case "run_started":
        this.activeRuns.add(runId ?? "");
        this.activeRunActivity.delete(runId ?? "");
        this.clearIdleTimer();
        this.clearTransientMoodTimer();
        this.mood = "thinking";
        this.setTaskMessage(this.localize("我开始处理了。", "I am getting started."));
        break;
      case "activity":
        if (!this.activeRuns.has(`${event.activity.sessionId}:${event.activity.runId}`)) return;
        this.activeRunActivity.add(`${event.activity.sessionId}:${event.activity.runId}`);
        this.clearTransientMoodTimer();
        this.mood = this.hasWaitingRun() ? "waiting" : "working";
        this.setTaskMessage(this.localize("正在处理任务。", "Working on your task."));
        break;
      case "approval_required":
        this.approvalRunById.set(event.approval.id, runId ?? "");
        this.clearTransientMoodTimer();
        this.mood = "waiting";
        this.setTaskMessage(this.localize("需要你确认一下。", "I need your confirmation."));
        break;
      case "question_required":
        this.questionRunById.set(event.question.id, runId ?? "");
        this.clearTransientMoodTimer();
        this.mood = "waiting";
        this.setTaskMessage(this.localize("需要你确认一下。", "I need your confirmation."));
        break;
      case "approval_state":
        this.replaceWaitingRuns(
          this.approvalRunById,
          event.state.requests.map((request) => [
            request.id,
            `${request.sessionId}:${request.runId}`,
          ]),
        );
        this.restoreActiveMoodIfReady();
        break;
      case "question_state":
        this.replaceWaitingRuns(
          this.questionRunById,
          event.state.requests.map((request) => [
            request.id,
            `${request.sessionId}:${request.runId}`,
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
    if (this.window && this.window !== window) this.detachWindow(this.window, true);
    this.window = window;
    const onClose = (event: { preventDefault(): void }) => {
      if (this.disposed) return;
      event.preventDefault();
      window.hide();
      this.clearIdleTimer();
      this.clearTransientMoodTimer();
      this.publish();
    };
    const onClosed = () => {
      if (this.window === window) this.window = null;
      this.clearIdleTimer();
      this.clearTransientMoodTimer();
      if (!this.disposed) this.publish();
    };
    const onMove = () => {
      if (this.window !== window || window.isDestroyed()) return;
      const bounds = window.getBounds();
      const position = this.clampPosition({ x: bounds.x, y: bounds.y }, bounds.width);
      this.preferences = { ...this.preferences, position };
      this.schedulePersistence();
      this.publish();
    };
    this.windowListeners = { window, onClose, onClosed, onMove };
    window.on("close", onClose);
    window.on("closed", onClosed);
    window.on("move", onMove);
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
    this.clearIdleTimer();
    this.clearTransientMoodTimer();
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
    const window = this.createWindow({
      ...this.clampBounds(position, this.preferences.size),
      width: this.preferences.size,
      height: this.preferences.size,
    });
    this.attachWindow(window);
    this.applyPreferencesToWindow();
    return window;
  }

  private applyPreferencesToWindow(): void {
    if (!this.isWindowAlive()) return;
    const window = this.window as CompanionWindow;
    const bounds = window.getBounds();
    const size = this.preferences.size;
    const position =
      this.preferences.position ?? this.defaultPosition(size, { x: bounds.x, y: bounds.y });
    const clamped = this.clampBounds(position, size);
    window.setBounds({ ...clamped, width: size, height: size });
    window.setAlwaysOnTop(this.preferences.alwaysOnTop, "floating");
    window.setOpacity(this.preferences.opacity);
  }

  private moveTo(point: CompanionPoint): void {
    const size = this.preferences.size;
    const position = this.clampPosition(point, size);
    this.preferences = { ...this.preferences, position };
    if (this.isWindowAlive()) {
      this.window?.setBounds({ ...position, width: size, height: size });
    }
    this.schedulePersistence();
  }

  private defaultPosition(size: number, reference?: CompanionPoint): CompanionPoint {
    const area = this.getWorkArea(reference);
    return this.clampBounds(
      {
        x: area.x + area.width - size - EDGE_MARGIN,
        y: area.y + area.height - size - EDGE_MARGIN,
      },
      size,
    );
  }

  private clampPosition(point: CompanionPoint, size: number): CompanionPoint {
    const area = this.getWorkArea(point);
    const maxX = area.x + Math.max(0, area.width - size);
    const maxY = area.y + Math.max(0, area.height - size);
    return {
      x: Math.round(Math.max(area.x, Math.min(maxX, point.x))),
      y: Math.round(Math.max(area.y, Math.min(maxY, point.y))),
    };
  }

  private clampBounds(point: CompanionPoint, size: number): CompanionPoint {
    const bounded = this.clampPosition(point, size);
    const area = this.getWorkArea(bounded);
    const maxX = area.x + Math.max(0, area.width - size - EDGE_MARGIN);
    const maxY = area.y + Math.max(0, area.height - size - EDGE_MARGIN);
    return {
      x: Math.round(Math.max(area.x, Math.min(maxX, bounded.x))),
      y: Math.round(Math.max(area.y, Math.min(maxY, bounded.y))),
    };
  }

  private recordInteraction(): void {
    this.lastInteractionAt = this.now();
    this.lastChatterAt = this.lastInteractionAt;
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
      this.activeRuns.size ||
      this.mood === "resting" ||
      this.mood === "sleeping"
    )
      return;
    const restMs = this.preferences.restAfterMinutes * 60_000;
    const chatterMs = chatterIntervalMs(this.preferences.chattiness);
    const restAt = restMs > 0 ? this.lastInteractionAt + restMs : Number.POSITIVE_INFINITY;
    const chatterAt = chatterMs > 0 ? this.lastChatterAt + chatterMs : Number.POSITIVE_INFINITY;
    const dueAt = Math.min(restAt, chatterAt);
    if (!Number.isFinite(dueAt)) return;
    this.idleTimer = setTimeout(() => this.onIdleTimer(), Math.max(0, dueAt - this.now()));
  }

  private onIdleTimer(): void {
    this.idleTimer = null;
    if (!this.isVisible() || this.disposed) return;
    if (this.activeRuns.size) {
      this.scheduleIdleTimer();
      return;
    }
    const restMs = this.preferences.restAfterMinutes * 60_000;
    if (restMs > 0 && this.now() - this.lastInteractionAt >= restMs) {
      this.mood = "resting";
      this.message = this.preferences.taskHintsEnabled
        ? this.localize("我先安静休息一会儿。", "I am taking a quiet break.")
        : null;
      this.publish();
      return;
    }
    const chatterMs = chatterIntervalMs(this.preferences.chattiness);
    if (chatterMs > 0 && this.now() - this.lastChatterAt >= chatterMs) {
      this.lastChatterAt = this.now();
      if (this.mood === "idle" && this.preferences.chattiness !== "off") {
        this.clearTransientMoodTimer();
        this.mood = "greeting";
        const languageIndex = this.repository.getSetting("desktop.locale") === "en" ? 1 : 0;
        const lines = COMPANION_CHAT_LINES[languageIndex] ?? [];
        this.message = lines.length ? (lines[this.chatterIndex % lines.length] ?? null) : null;
        this.chatterIndex += 1;
        this.publish();
        this.scheduleTransientMoodEnd();
      }
    }
    this.scheduleIdleTimer();
  }

  private setTaskMessage(message: string | null): void {
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
    this.message = this.preferences.taskHintsEnabled ? this.localize(...message) : null;
  }

  private finishRun(runId: string | null, terminalMood: "success" | "error" | "idle"): void {
    if (runId && !this.activeRuns.has(runId)) return;
    if (runId) {
      this.activeRuns.delete(runId);
      this.activeRunActivity.delete(runId);
      for (const [id, waitingRunId] of this.approvalRunById) {
        if (waitingRunId === runId) this.approvalRunById.delete(id);
      }
      for (const [id, waitingRunId] of this.questionRunById) {
        if (waitingRunId === runId) this.questionRunById.delete(id);
      }
    }
    this.clearTransientMoodTimer();
    if (this.activeRuns.size) {
      this.mood = this.hasWaitingRun() ? "waiting" : "working";
      this.setTaskMessage(this.localize("还有任务正在处理。", "Another task is still running."));
      return;
    }
    this.mood = terminalMood;
    this.setTaskMessage(
      terminalMood === "success"
        ? this.localize("任务已完成。", "Task complete.")
        : terminalMood === "error"
          ? this.localize("任务未能完成。", "The task could not be completed.")
          : null,
    );
    if (terminalMood !== "idle") this.scheduleTransientMoodEnd();
    else this.scheduleIdleTimer();
  }

  private restoreActiveMoodIfReady(): void {
    if (!this.activeRuns.size) return;
    if (this.hasWaitingRun()) {
      this.clearTransientMoodTimer();
      this.mood = "waiting";
      this.setTaskMessage(this.localize("需要你确认一下。", "I need your confirmation."));
    } else if (this.mood === "waiting") {
      this.mood = "working";
      this.setTaskMessage(this.localize("正在处理任务。", "Working on your task."));
    }
    this.publish();
  }

  private hasWaitingRun(): boolean {
    const active = this.activeRuns;
    return [...this.approvalRunById.values(), ...this.questionRunById.values()].some((runId) =>
      active.has(runId),
    );
  }

  private replaceWaitingRuns(target: Map<string, string>, entries: Array<[string, string]>): void {
    const next = new Map(entries);
    for (const id of target.keys()) if (!next.has(id)) target.delete(id);
    for (const [id, runId] of next) target.set(id, runId);
  }

  private scheduleTransientMoodEnd(): void {
    this.clearTransientMoodTimer();
    this.transientMoodTimer = setTimeout(() => {
      this.transientMoodTimer = null;
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

  private publish(): CompanionState {
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

  private clearPersistenceTimer(): void {
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer);
    this.persistenceTimer = null;
  }

  private isVisible(): boolean {
    return this.isWindowAlive() && Boolean(this.window?.isVisible());
  }

  private isWindowAlive(): boolean {
    return Boolean(this.window && !this.window.isDestroyed());
  }

  private detachWindow(window: CompanionWindow, destroy: boolean): void {
    const listeners = this.windowListeners;
    if (listeners?.window === window) {
      window.removeListener("close", listeners.onClose as (...args: never[]) => void);
      window.removeListener("closed", listeners.onClosed as (...args: never[]) => void);
      window.removeListener("move", listeners.onMove as (...args: never[]) => void);
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
