export interface ModelWatchdogSettings {
  /** Maximum wait from the network send until the first meaningful model event. Zero disables it. */
  firstResponseTimeoutMs: number;
  /** Maximum silence after the latest meaningful event. Zero disables it. */
  idleTimeoutMs: number;
}

export type ModelWatchdogTimeoutKind = "first_response" | "idle";

export const DEFAULT_MODEL_FIRST_RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_MODEL_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const MAX_MODEL_WATCHDOG_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const MODEL_WATCHDOG_SETTING = "models.watchdog";

const DEFAULT_MODEL_WATCHDOG_SETTINGS: ModelWatchdogSettings = {
  firstResponseTimeoutMs: DEFAULT_MODEL_FIRST_RESPONSE_TIMEOUT_MS,
  idleTimeoutMs: DEFAULT_MODEL_IDLE_TIMEOUT_MS,
};

function normalizeTimeout(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.min(MAX_MODEL_WATCHDOG_TIMEOUT_MS, Math.round(value));
}

export function normalizeModelWatchdogSettings(value: unknown): ModelWatchdogSettings {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : Object.create(null);
  return {
    firstResponseTimeoutMs: normalizeTimeout(
      record.firstResponseTimeoutMs,
      DEFAULT_MODEL_WATCHDOG_SETTINGS.firstResponseTimeoutMs,
    ),
    idleTimeoutMs: normalizeTimeout(
      record.idleTimeoutMs,
      DEFAULT_MODEL_WATCHDOG_SETTINGS.idleTimeoutMs,
    ),
  };
}

export class ModelWatchdogTimeoutError extends Error {
  override readonly name = "TimeoutError";

  constructor(
    readonly kind: ModelWatchdogTimeoutKind,
    readonly timeoutMs: number,
  ) {
    const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
    super(
      kind === "first_response"
        ? `模型请求在 ${minutes} 分钟内没有收到有效响应；本次请求未执行任何工具。`
        : `模型流连续 ${minutes} 分钟没有有效进展；本次请求未执行任何工具。`,
    );
  }
}

export function isModelWatchdogTimeout(value: unknown): value is ModelWatchdogTimeoutError {
  return (
    value instanceof ModelWatchdogTimeoutError ||
    (value instanceof Error &&
      value.name === "TimeoutError" &&
      ("kind" in value
        ? (value as { kind?: unknown }).kind === "first_response" ||
          (value as { kind?: unknown }).kind === "idle"
        : false))
  );
}

/**
 * Tracks one wire attempt. The caller starts it immediately before fetch and
 * reports only content-bearing progress, never heartbeats or usage accounting.
 */
export class ModelRequestWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private meaningfulResponseSeen = false;
  private stopped = false;
  private timedOutError: ModelWatchdogTimeoutError | null = null;

  constructor(
    settings: ModelWatchdogSettings,
    private readonly onTimeout: (error: ModelWatchdogTimeoutError) => void,
  ) {
    this.settings = normalizeModelWatchdogSettings(settings);
  }

  private readonly settings: ModelWatchdogSettings;

  get timeout(): ModelWatchdogTimeoutError | null {
    return this.timedOutError;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.arm(
      this.settings.firstResponseTimeoutMs,
      this.meaningfulResponseSeen ? "idle" : "first_response",
    );
  }

  progress(): void {
    if (!this.started || this.stopped) return;
    this.meaningfulResponseSeen = true;
    this.arm(this.settings.idleTimeoutMs, "idle");
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
  }

  private arm(timeoutMs: number, kind: ModelWatchdogTimeoutKind): void {
    this.clearTimer();
    if (timeoutMs === 0 || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped) return;
      const error = new ModelWatchdogTimeoutError(kind, timeoutMs);
      this.timedOutError = error;
      this.onTimeout(error);
    }, timeoutMs);
    if (typeof this.timer === "object" && this.timer !== null)
      (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

export function isMeaningfulModelStreamProgress(event: {
  type: string;
  text?: string;
  delta?: string;
  arguments?: string;
}): boolean {
  switch (event.type) {
    case "text_delta":
    case "reasoning_delta":
      return Boolean(event.text);
    case "tool_call_arguments_delta":
      return Boolean(event.delta);
    case "tool_call_arguments":
      return event.arguments !== undefined && event.arguments !== "";
    default:
      return false;
  }
}
