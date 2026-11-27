import { recordInterfaceResult } from "./interface-result";
import { recordRuntimeError, recordRuntimeWarning } from "./runtime-log";

const IPC_ECHO_WINDOW_MS = 5_000;
const MAX_ECHO_CHANNELS = 512;
const reportedFailures = new Map<string, { expiresAt: number; remaining: number }>();

function noteFailure(operation: string): void {
  const now = Date.now();
  for (const [channel, entry] of reportedFailures)
    if (entry.expiresAt <= now) reportedFailures.delete(channel);
  const previous = reportedFailures.get(operation);
  reportedFailures.delete(operation);
  reportedFailures.set(operation, {
    expiresAt: now + IPC_ECHO_WINDOW_MS,
    remaining: Math.min((previous?.remaining ?? 0) + 1, 512),
  });
  if (reportedFailures.size > MAX_ECHO_CHANNELS)
    reportedFailures.delete(reportedFailures.keys().next().value as string);
}

// Electron echoes rejected invoke handlers to console.error after the request boundary logged them.
export function consumeReportedIpcConsoleError(args: unknown[]): boolean {
  if (typeof args[0] !== "string") return false;
  const operation = /^Error occurred in handler for '([^'\r\n]{1,200})':/.exec(args[0])?.[1];
  if (!operation) return false;
  const entry = reportedFailures.get(operation);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    reportedFailures.delete(operation);
    return false;
  }
  if (--entry.remaining === 0) reportedFailures.delete(operation);
  return true;
}

export function instrumentIpcHandler<Arguments extends unknown[], Result>(
  operation: string,
  listener: (...args: Arguments) => Result,
  mapError: (cause: unknown) => unknown = (cause) => cause,
): (...args: Arguments) => Promise<Awaited<Result>> {
  return async (...args): Promise<Awaited<Result>> => {
    try {
      const result = await listener(...args);
      recordInterfaceResult("ipc", operation, result);
      return result as Awaited<Result>;
    } catch (cause) {
      const error = cause && typeof cause === "object" ? (cause as Record<string, unknown>) : null;
      const code =
        typeof error?.code === "string" && /^[\w.:-]{1,80}$/.test(error.code) ? error.code : null;
      const cancelled =
        error?.name === "AbortError" ||
        code === "ABORT_ERR" ||
        code === "ERR_CANCELED" ||
        (cause instanceof Error && cause.message === "请求已取消。");
      const source = code?.startsWith("IPC_") ? "ipc.security" : "ipc.request";
      const record = cancelled ? recordRuntimeWarning : recordRuntimeError;
      record(source, cause, { operation, ...(code ? { code } : {}) });
      noteFailure(operation);
      throw mapError(cause);
    }
  };
}
