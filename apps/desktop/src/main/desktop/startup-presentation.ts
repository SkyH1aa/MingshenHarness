import {
  STARTUP_PRESENTATION_CHANNELS,
  STARTUP_PRESENTATION_SETTING_KEY,
  type StartupPresentationLocale,
  type StartupPresentationStage,
  startupPresentationEnabled,
} from "../../shared/startup-presentation";

export const STARTUP_PRESENTATION_MAX_LIFETIME_MS = 8_000;
export const STARTUP_PRESENTATION_READY_DELAY_MS = 320;
export const STARTUP_PRESENTATION_READY_GRACE_MS = 500;
export const STARTUP_PRESENTATION_MIN_VISIBLE_MS = 4_680;

export interface StartupPresentationSurface {
  readonly senderId: number;
  load(): Promise<void>;
  show(): void;
  close(): void;
  sendStage(stage: StartupPresentationStage, locale: StartupPresentationLocale): void;
  onClosed(listener: () => void): () => void;
}

export interface StartupPresentationControllerOptions {
  readEnabled(): unknown | Promise<unknown>;
  readLocale?(): unknown | Promise<unknown>;
  createSurface(): StartupPresentationSurface;
  onLatePresentation?(): void;
  onPresentationShown?(): void;
  maxLifetimeMs?: number;
  readyDelayMs?: number;
  readyGraceMs?: number;
  minimumVisibleMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

type Timer = ReturnType<typeof setTimeout>;

export class StartupPresentationController {
  private readonly readEnabled: StartupPresentationControllerOptions["readEnabled"];
  private readonly readLocale: StartupPresentationControllerOptions["readLocale"];
  private readonly createSurface: StartupPresentationControllerOptions["createSurface"];
  private readonly onLatePresentation: StartupPresentationControllerOptions["onLatePresentation"];
  private readonly onPresentationShown: StartupPresentationControllerOptions["onPresentationShown"];
  private readonly maxLifetimeMs: number;
  private readonly readyDelayMs: number;
  private readonly readyGraceMs: number;
  private readonly minimumVisibleMs: number;
  private readonly setTimer: (callback: () => void, delayMs: number) => Timer;
  private readonly clearTimer: (timer: Timer) => void;
  private surface: StartupPresentationSurface | null = null;
  private removeClosedListener: (() => void) | null = null;
  private lifetimeTimer: Timer | null = null;
  private readyTimer: Timer | null = null;
  private graceTimer: Timer | null = null;
  private minimumVisibleTimer: Timer | null = null;
  private started = false;
  private readyRequested = false;
  private surfaceShown = false;
  private minimumVisibleElapsed = false;
  private exiting = false;
  private settled = false;
  private stage: StartupPresentationStage = "preparing";
  private locale: StartupPresentationLocale = "zh-CN";
  private readonly completion: Promise<void>;
  private resolveCompletion!: () => void;

  constructor(options: StartupPresentationControllerOptions) {
    this.readEnabled = options.readEnabled;
    this.readLocale = options.readLocale;
    this.createSurface = options.createSurface;
    this.onLatePresentation = options.onLatePresentation;
    this.onPresentationShown = options.onPresentationShown;
    this.maxLifetimeMs = options.maxLifetimeMs ?? STARTUP_PRESENTATION_MAX_LIFETIME_MS;
    this.readyDelayMs = options.readyDelayMs ?? STARTUP_PRESENTATION_READY_DELAY_MS;
    this.readyGraceMs = options.readyGraceMs ?? STARTUP_PRESENTATION_READY_GRACE_MS;
    this.minimumVisibleMs = options.minimumVisibleMs ?? STARTUP_PRESENTATION_MIN_VISIBLE_MS;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  start(): void {
    if (this.started || this.settled) return;
    this.started = true;
    this.lifetimeTimer = this.setTimer(() => this.finish(), this.maxLifetimeMs);
    void this.openSurface();
  }

  setStage(stage: StartupPresentationStage): void {
    if (this.settled || this.readyRequested) return;
    this.stage = stage;
    this.sendStage(stage);
  }

  ready(): Promise<void> {
    if (this.settled || this.readyRequested) return this.completion;
    this.readyRequested = true;
    if (!this.started) {
      this.finish();
    } else if (!this.surfaceShown) {
      // A fast main window gives the local splash a brief chance to load, but
      // a stuck preference read or renderer must not hold the main window.
      this.graceTimer = this.setTimer(() => this.finish(), this.readyGraceMs);
    } else if (this.minimumVisibleElapsed) {
      this.beginExit();
    }
    return this.completion;
  }

  isTrustedSender(senderId: number): boolean {
    return this.surface !== null && !this.settled && senderId === this.surface.senderId;
  }

  isPresenting(): boolean {
    return this.surfaceShown && !this.settled;
  }

  handleSkip(senderId: number): boolean {
    if (!this.isTrustedSender(senderId)) return false;
    this.finish();
    return true;
  }

  fail(): void {
    this.finish();
  }

  stop(): void {
    this.finish();
  }

  dispose(): void {
    this.finish();
  }

  private async openSurface(): Promise<void> {
    let enabled: unknown;
    try {
      enabled = await this.readEnabled();
    } catch {
      this.finish();
      return;
    }
    if (this.settled || !startupPresentationEnabled(enabled)) {
      this.finish();
      return;
    }

    try {
      try {
        this.locale = (await this.readLocale?.()) === "en" ? "en" : "zh-CN";
      } catch {
        this.locale = "zh-CN";
      }
      if (this.settled) return;
      const surface = this.createSurface();
      this.surface = surface;
      this.removeClosedListener = surface.onClosed(() => this.finish());
      await surface.load();
      if (this.settled) return;
      surface.sendStage(this.stage, this.locale);
      surface.show();
      if (this.settled) return;
      this.surfaceShown = true;
      if (this.graceTimer !== null) this.clearTimer(this.graceTimer);
      this.graceTimer = null;
      if (this.readyRequested) {
        this.onLatePresentation?.();
        if (this.settled) return;
      }
      this.minimumVisibleTimer = this.setTimer(() => {
        this.minimumVisibleTimer = null;
        this.minimumVisibleElapsed = true;
        if (this.readyRequested) this.beginExit();
      }, this.minimumVisibleMs);
      try {
        this.onPresentationShown?.();
      } catch {
        // Optional work must not prevent the animation from finishing.
      }
    } catch {
      this.finish();
    }
  }

  private beginExit(): void {
    if (this.settled || this.exiting) return;
    this.exiting = true;
    this.stage = "ready";
    this.sendStage("ready");
    if (this.settled) return;
    this.readyTimer = this.setTimer(() => this.finish(), this.readyDelayMs);
  }

  private sendStage(stage: StartupPresentationStage): void {
    if (!this.surface || this.settled) return;
    try {
      this.surface.sendStage(stage, this.locale);
    } catch {
      this.finish();
    }
  }

  private finish(): void {
    if (this.settled) return;
    this.settled = true;
    this.clearActiveTimers();
    try {
      this.removeClosedListener?.();
    } catch {
      // Listener cleanup must not block main-window startup.
    }
    this.removeClosedListener = null;
    const surface = this.surface;
    this.surface = null;
    try {
      surface?.close();
    } catch {
      // Startup UI cleanup must not prevent the main window from opening.
    }
    this.resolveCompletion();
  }

  private clearActiveTimers(): void {
    if (this.lifetimeTimer !== null) this.clearTimer(this.lifetimeTimer);
    if (this.readyTimer !== null) this.clearTimer(this.readyTimer);
    if (this.graceTimer !== null) this.clearTimer(this.graceTimer);
    if (this.minimumVisibleTimer !== null) this.clearTimer(this.minimumVisibleTimer);
    this.lifetimeTimer = null;
    this.readyTimer = null;
    this.graceTimer = null;
    this.minimumVisibleTimer = null;
  }
}

export { STARTUP_PRESENTATION_CHANNELS, STARTUP_PRESENTATION_SETTING_KEY };
