export class ModelRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelRequestError";
  }
}

export class ModelOutputLimitError extends ModelRequestError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, false, null, options);
    this.name = "ModelOutputLimitError";
  }
}

export class ModelInputBudgetError extends ModelRequestError {
  constructor(inputTokens: number, contextWindow: number) {
    super(
      `Estimated model input (${inputTokens} tokens) leaves no safe output budget in the ${contextWindow}-token context window. No request was sent.`,
      false,
    );
    this.name = "ModelInputBudgetError";
  }
}

export function retryableStatus(status: number): boolean {
  return [408, 409, 425, 429].includes(status) || (status >= 500 && status <= 599);
}

export function retryAfterMs(headers: Headers): number | null {
  const milliseconds = headers.get("retry-after-ms");
  if (milliseconds && /^\d+(?:\.\d+)?$/.test(milliseconds))
    return Math.min(300_000, Number(milliseconds));
  const value = headers.get("retry-after");
  if (!value) return null;
  const duration = /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(duration) ? Math.min(300_000, Math.max(0, duration)) : null;
}

export function upstreamError(message: string, payload: unknown): ModelRequestError {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const codes = [record.code, record.type].map((value) => String(value ?? "").toLowerCase());
  const status = Number(record.status ?? record.status_code);
  if (
    (status >= 400 && status < 500 && !retryableStatus(status)) ||
    codes.some((code) =>
      /^(?:invalid_api_key|authentication_error|permission_denied|permission_error|insufficient_quota|invalid_request_error|content_filter|content_policy_violation)$/.test(
        code,
      ),
    )
  )
    return new ModelRequestError(message, false);
  const transient = codes.some((code) =>
    /^(?:server_error|internal_error|internal_server_error|upstream_error|server_overloaded|overloaded_error|rate_limit_error|rate_limit_exceeded|timeout|request_timeout|stream_error|stream_failed|connection_error|service_unavailable)$/.test(
      code,
    ),
  );
  return new ModelRequestError(message, transient || retryableStatus(status));
}

export function retryDelayMs(retry: number, serverDelay: number | null): number {
  return serverDelay ?? Math.min(30_000, 1000 * 2 ** Math.min(5, retry - 1));
}

export function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
