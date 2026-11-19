import {
  DEFAULT_DESKTOP_SHORTCUTS,
  loadDesktopShortcutSettings,
  validateDesktopShortcutSettings,
} from "../../shared/desktop-shortcuts";
import type {
  DesktopShortcutError,
  DesktopShortcutErrors,
  DesktopShortcutName,
  DesktopShortcutSettings,
  DesktopShortcutState,
  DesktopShortcutStatus,
  DesktopShortcutUpdateResult,
} from "../../shared/quick-chat";

export const DESKTOP_SHORTCUTS = DEFAULT_DESKTOP_SHORTCUTS;

export interface DesktopShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface DesktopShortcutsOptions {
  load?: () => unknown;
  persist?: (settings: DesktopShortcutSettings) => void;
  defaults?: DesktopShortcutSettings;
}

const NAMES = ["quickChat", "toggleMain"] as const;

function cloneSettings(settings: DesktopShortcutSettings): DesktopShortcutSettings {
  return { ...settings };
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class DesktopShortcuts {
  private registered: DesktopShortcutStatus = { quickChat: false, toggleMain: false };
  private settings: DesktopShortcutSettings = cloneSettings(DEFAULT_DESKTOP_SHORTCUTS);
  private owned: Record<DesktopShortcutName, string | null> = {
    quickChat: null,
    toggleMain: null,
  };
  private errors: DesktopShortcutErrors = {};
  private configurationErrors: DesktopShortcutErrors = {};
  private initialized = false;
  private suppressed = false;

  constructor(
    private readonly registry: DesktopShortcutRegistry,
    private readonly handlers: Record<DesktopShortcutName, () => void>,
    private readonly report: (accelerator: string, cause?: unknown) => void,
    private readonly options: DesktopShortcutsOptions = {},
  ) {}

  start(): DesktopShortcutStatus {
    this.ensureInitialized();
    if (!this.suppressed) this.registerCurrentBindings();
    return this.status();
  }

  private registerCurrentBindings(): void {
    for (const name of NAMES) {
      if (this.registered[name] || this.owned[name]) continue;
      const accelerator = this.settings[name];
      try {
        this.registered[name] = this.registry.register(accelerator, () => this.invoke(name));
        if (this.registered[name]) {
          this.owned[name] = accelerator;
          if (
            this.errors[name]?.code === "shortcut-occupied" ||
            this.errors[name]?.code === "shortcut-registration-failed"
          )
            delete this.errors[name];
        } else {
          this.errors[name] = {
            code: "shortcut-occupied",
            message: `${accelerator} is already in use by another application or the operating system.`,
          };
          this.safeReport(accelerator);
        }
      } catch (cause) {
        this.registered[name] = false;
        this.errors[name] = {
          code: "shortcut-registration-failed",
          message: `Cannot register ${accelerator}: ${causeMessage(cause)}`,
        };
        this.safeReport(accelerator, cause);
      }
    }
  }

  status(): DesktopShortcutStatus {
    return { ...this.registered };
  }

  state(): DesktopShortcutState {
    return {
      settings: cloneSettings(this.settings),
      status: this.status(),
      errors: { ...this.configurationErrors, ...this.errors },
    };
  }

  update(input: unknown): DesktopShortcutUpdateResult {
    if (!this.initialized) this.start();
    if (this.suppressed) this.setCallbacksSuppressed(false);
    const validation = validateDesktopShortcutSettings(input);
    if (!validation.ok) return { ok: false, ...this.state(), errors: { ...validation.errors } };

    const previous = {
      settings: cloneSettings(this.settings),
      status: this.status(),
      owned: { ...this.owned },
      errors: { ...this.errors },
      configurationErrors: { ...this.configurationErrors },
    };
    const changedNames = NAMES.filter(
      (name) => validation.settings[name] !== previous.settings[name],
    );
    const shouldRetry =
      !changedNames.length &&
      (!previous.status.quickChat ||
        !previous.status.toggleMain ||
        Object.keys(previous.errors).length > 0 ||
        Object.keys(previous.configurationErrors).length > 0);
    if (!changedNames.length && !shouldRetry) return { ok: true, ...this.state() };

    const registrationNames = changedNames.length ? changedNames : NAMES;
    this.releaseOwnedNames(registrationNames);
    const registered: Record<DesktopShortcutName, string | null> = {
      quickChat: null,
      toggleMain: null,
    };
    let failure: DesktopShortcutError | null = null;
    let failedName: DesktopShortcutName | null = null;
    for (const name of registrationNames) {
      const accelerator = validation.settings[name];
      try {
        if (this.registry.register(accelerator, () => this.invoke(name)))
          registered[name] = accelerator;
        else {
          failedName = name;
          failure = {
            code: "shortcut-occupied",
            message: `${accelerator} is already in use by another application or the operating system.`,
          };
          this.safeReport(accelerator);
          break;
        }
      } catch (cause) {
        failedName = name;
        failure = {
          code: "shortcut-registration-failed",
          message: `Cannot register ${accelerator}: ${causeMessage(cause)}`,
        };
        this.safeReport(accelerator, cause);
        break;
      }
    }

    if (failure) {
      this.releaseAccelerators(registered);
      this.restore(previous, registrationNames);
      if (failedName) this.errors[failedName] = failure;
      return { ok: false, ...this.state() };
    }

    this.settings = cloneSettings(validation.settings);
    for (const name of registrationNames) {
      this.owned[name] = registered[name];
      this.registered[name] = Boolean(registered[name]);
      delete this.errors[name];
    }
    this.configurationErrors = {};

    if (this.options.persist) {
      try {
        this.options.persist(cloneSettings(this.settings));
      } catch (cause) {
        this.releaseAccelerators(registered);
        const persistError: DesktopShortcutError = {
          code: "shortcut-persist-failed",
          message: `Cannot save shortcut settings: ${causeMessage(cause)}`,
        };
        this.restore(previous, registrationNames);
        this.safeReport(this.settings.quickChat, cause);
        for (const name of registrationNames) this.errors[name] = persistError;
        return {
          ok: false,
          ...this.state(),
        };
      }
      this.clearPersistenceErrors();
    }
    return { ok: true, ...this.state() };
  }

  setCallbacksSuppressed(suppressed: boolean): DesktopShortcutState {
    if (suppressed === this.suppressed) return this.state();
    this.suppressed = suppressed;
    if (suppressed) this.releaseOwned();
    else {
      this.ensureInitialized();
      this.registerCurrentBindings();
    }
    return this.state();
  }

  stop(): void {
    this.releaseOwned();
  }

  private invoke(name: DesktopShortcutName): void {
    if (!this.suppressed) this.handlers[name]();
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.loadSettings();
  }

  private loadSettings(): void {
    try {
      const loaded = this.options.load?.() ?? this.options.defaults;
      const validation = loadDesktopShortcutSettings(loaded ?? DEFAULT_DESKTOP_SHORTCUTS);
      if (validation.ok) {
        this.settings = cloneSettings(validation.settings);
        this.errors = {};
        this.configurationErrors = {};
      } else {
        this.settings = cloneSettings(DEFAULT_DESKTOP_SHORTCUTS);
        this.errors = {};
        this.configurationErrors = { ...validation.errors };
        for (const name of NAMES) this.safeReport(this.settings[name], validation.errors[name]);
      }
    } catch (cause) {
      this.settings = cloneSettings(DEFAULT_DESKTOP_SHORTCUTS);
      const loadError: DesktopShortcutError = {
        code: "shortcut-load-failed",
        message: `Cannot load shortcut settings: ${causeMessage(cause)}`,
      };
      this.errors = {};
      this.configurationErrors = { quickChat: loadError, toggleMain: loadError };
      for (const name of NAMES) this.safeReport(this.settings[name], cause);
    }
  }

  private releaseOwned(): void {
    this.releaseOwnedNames(NAMES);
  }

  private releaseOwnedNames(names: readonly DesktopShortcutName[]): void {
    for (const name of names) {
      const accelerator = this.owned[name];
      if (!accelerator) continue;
      try {
        this.registry.unregister(accelerator);
      } catch (cause) {
        this.safeReport(accelerator, cause);
      }
      this.owned[name] = null;
      this.registered[name] = false;
    }
  }

  private releaseAccelerators(accelerators: Record<DesktopShortcutName, string | null>): void {
    for (const name of NAMES) {
      const accelerator = accelerators[name];
      if (!accelerator) continue;
      try {
        this.registry.unregister(accelerator);
      } catch (cause) {
        this.safeReport(accelerator, cause);
      }
    }
  }

  private restore(
    previous: {
      settings: DesktopShortcutSettings;
      status: DesktopShortcutStatus;
      owned: Record<DesktopShortcutName, string | null>;
      errors: DesktopShortcutErrors;
      configurationErrors: DesktopShortcutErrors;
    },
    names: readonly DesktopShortcutName[],
  ): DesktopShortcutErrors {
    this.settings = cloneSettings(previous.settings);
    this.configurationErrors = { ...previous.configurationErrors };
    for (const name of names) {
      this.owned[name] = null;
      this.registered[name] = false;
      const accelerator = previous.owned[name];
      if (!accelerator) {
        const previousError = previous.errors[name];
        if (previousError) this.errors[name] = previousError;
        else delete this.errors[name];
        continue;
      }
      try {
        const restored = this.registry.register(accelerator, () => this.invoke(name));
        this.registered[name] = restored;
        if (restored) {
          this.owned[name] = accelerator;
          const previousError = previous.errors[name];
          if (previousError) this.errors[name] = previousError;
          else delete this.errors[name];
        } else {
          this.errors[name] = {
            code: "shortcut-occupied",
            message: `${accelerator} could not be restored because it is already in use.`,
          };
          this.safeReport(accelerator);
        }
      } catch (cause) {
        this.errors[name] = {
          code: "shortcut-registration-failed",
          message: `Cannot restore ${accelerator}: ${causeMessage(cause)}`,
        };
        this.safeReport(accelerator, cause);
      }
    }
    return { ...this.errors };
  }

  private safeReport(accelerator: string, cause?: unknown): void {
    try {
      if (cause === undefined) this.report(accelerator);
      else this.report(accelerator, cause);
    } catch {
      // Logging must not break shortcut registration or rollback.
    }
  }

  private clearPersistenceErrors(): void {
    for (const name of NAMES) {
      if (this.errors[name]?.code === "shortcut-persist-failed") delete this.errors[name];
    }
  }
}
