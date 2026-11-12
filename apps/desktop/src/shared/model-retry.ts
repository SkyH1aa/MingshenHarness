export interface ModelRetrySettings {
  /** Consecutive reconnection attempts per interruption, reset after forward progress. */
  maxRetries: number;
}

export const DEFAULT_MODEL_RETRIES = 5;
export const MAX_MODEL_RETRIES = 20;
export const MODEL_RETRY_SETTING = "models.retry";

export function normalizeModelRetrySettings(value: unknown): ModelRetrySettings {
  const count =
    value && typeof value === "object" && "maxRetries" in value ? value.maxRetries : undefined;
  return {
    maxRetries:
      typeof count === "number" && Number.isFinite(count)
        ? Math.min(MAX_MODEL_RETRIES, Math.max(0, Math.round(count)))
        : DEFAULT_MODEL_RETRIES,
  };
}
