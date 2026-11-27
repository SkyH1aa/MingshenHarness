import { mkdirSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  RuntimeLogBreakdown,
  RuntimeLogStatistics,
  RuntimeLogStatus,
} from "../../shared/runtime-log";
import { redactSecrets } from "../security/redact";

type LogContext = Partial<
  Record<
    | "sessionId"
    | "runId"
    | "providerId"
    | "modelId"
    | "toolName"
    | "serverId"
    | "operation"
    | "attempt"
    | "code"
    | "status"
    | "durationMs",
    string | number | null
  >
>;
interface Entry {
  timestamp: string;
  level: "error" | "warn";
  source: string;
  message: string;
  context: LogContext;
  omitted?: { errors: number; warnings: number };
  httpResponseSanitized?: true;
}

const FILE_SIZE = 3 * 1024 * 1024;
const FILE_COUNT = 5;
const RETENTION_DAYS = 30;
const FILE_PATTERN = /^runtime(?:\.[1-4])?\.jsonl$/;
const BREAKDOWN_LIMIT = 128;
const CONTEXT_KEYS = new Set([
  "sessionId",
  "runId",
  "providerId",
  "modelId",
  "toolName",
  "serverId",
  "operation",
  "attempt",
  "code",
  "status",
  "durationMs",
]);
const knownSecrets = new Set<string>();
let current: RuntimeLogService | null = null;

export function registerRuntimeSecret(value: string): void {
  if (value.length < 4 || value.length > 65536) return;
  knownSecrets.add(value);
}

export function sanitizeRuntimeText(value: string, secrets: string[] = []): string {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const payload = JSON.parse(value.slice(start, end + 1)) as unknown;
      const filtered = JSON.stringify(payload, (key: string, item: unknown) =>
        /^(?:messages|prompt|system_prompt|reviewInput|dataUrl|content|arguments|input|instructions|attachments)$/i.test(
          key,
        )
          ? "[OMITTED]"
          : /^(?:authorization|cookie|set-cookie|password|token|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)$/i.test(
                key,
              )
            ? "[REDACTED]"
            : item,
      );
      value = value.slice(0, start) + filtered + value.slice(end + 1);
    } catch {
      /* Most network and tool errors are plain text. */
    }
  }
  const sanitized = redactSecrets(value, [...knownSecrets, ...secrets])
    .replace(/(data:[a-z0-9.+/-]+(?:;[a-z0-9=.+-]+)*;base64,)[a-z0-9+/_=-]+/gi, "$1[OMITTED]")
    .replace(/((?:set-cookie|cookie)\s*[:=]\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, "$1?[REDACTED]")
    .replace(
      /((?:"|')?(?:messages|prompt|system_prompt|reviewInput|dataUrl|content|arguments)(?:"|')?\s*:\s*)("(?:\\.|[^"\\])*"|\[[^\r\n]*\])/gi,
      '$1"[OMITTED]"',
    );
  return sanitized.length > 16000
    ? `${sanitized.slice(0, 16000)}\n[Diagnostic truncated at 16,000 characters]`
    : sanitized;
}

function errorText(cause: unknown): string {
  if (!(cause instanceof Error)) {
    if (typeof cause === "string") return cause;
    if (cause && typeof cause === "object") {
      const item = cause as Record<string, unknown>;
      const fields = ["name", "message", "code", "errno", "syscall", "status", "type"].flatMap(
        (key) =>
          typeof item[key] === "string" || typeof item[key] === "number"
            ? [`${key}: ${item[key]}`]
            : [],
      );
      if (fields.length) return fields.join("\n");
    }
    return "Unknown runtime error";
  }
  const parts = [cause.stack || `${cause.name}: ${cause.message}`];
  const seen = new Set<unknown>([cause]);
  let inner = cause.cause;
  while (inner && !seen.has(inner) && parts.length < 4) {
    seen.add(inner);
    parts.push(inner instanceof Error ? inner.stack || inner.message : errorText(inner));
    inner = inner instanceof Error ? inner.cause : null;
  }
  return parts.join("\nCaused by: ");
}

const HTTP_ERROR_CODES = new Set([
  "invalid_request_error",
  "content_policy_violation",
  "rate_limit_exceeded",
  "insufficient_quota",
  "authentication_error",
  "permission_error",
  "model_not_found",
  "server_error",
  "api_error",
  "overloaded_error",
]);
const HTTP_ERROR_PARAMS = new Set([
  "model",
  "prompt",
  "input",
  "messages",
  "size",
  "n",
  "quality",
  "response_format",
]);

function httpFailureText(text: string, statusHint?: number): string | null {
  const match = /\bHTTP\s+([45]\d{2})\b/i.exec(text);
  const status = match ? Number(match[1]) : statusHint;
  if (!status || !Number.isInteger(status) || status < 400 || status > 599) return null;
  const start = text.indexOf("{", match?.index ?? 0);
  let payload: unknown;
  if (start >= 0) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    const end = Math.min(text.length, start + 200_000);
    for (let index = start; index < end; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          payload = JSON.parse(text.slice(start, index + 1));
        } catch {
          // Invalid or truncated bodies do not supply diagnostic fields.
        }
        break;
      }
      if (depth > 64) break;
    }
  }
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const error =
    root.error && typeof root.error === "object" && !Array.isArray(root.error)
      ? (root.error as Record<string, unknown>)
      : root;
  const fields = (["code", "type", "param"] as const).flatMap((key) => {
    const value = error[key];
    const allowed = key === "param" ? HTTP_ERROR_PARAMS : HTTP_ERROR_CODES;
    return typeof value === "string" && allowed.has(value) ? [`${key}=${value}`] : [];
  });
  return [`HTTP ${status}`, "[OMITTED] HTTP response body", ...fields].join("\n");
}

function diagnosticErrorText(cause: unknown, statusHint?: number): { text: string; http: boolean } {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let currentCause = cause;
  let http = false;
  while (currentCause && !seen.has(currentCause) && parts.length < 4) {
    seen.add(currentCause);
    if (currentCause instanceof Error) {
      const safeHttp = httpFailureText(currentCause.message, parts.length ? undefined : statusHint);
      if (safeHttp) {
        http = true;
        const prefix = `${currentCause.name}: ${currentCause.message}`;
        const stack = currentCause.stack?.startsWith(prefix)
          ? currentCause.stack.slice(prefix.length)
          : "";
        const frames = stack
          .split("\n")
          .filter((line) => /^\s+at\s/.test(line))
          .join("\n");
        parts.push(`${currentCause.name}: ${safeHttp}${frames ? `\n${frames}` : ""}`);
      } else {
        parts.push(currentCause.stack || `${currentCause.name}: ${currentCause.message}`);
      }
      currentCause = currentCause.cause;
    } else {
      const original = errorText(currentCause);
      const safeHttp = httpFailureText(original, parts.length ? undefined : statusHint);
      http ||= Boolean(safeHttp);
      parts.push(safeHttp ?? original);
      break;
    }
  }
  return { text: parts.join("\nCaused by: ") || errorText(cause), http };
}

function sanitizeContext(value: unknown, secrets: string[] = []): LogContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (!CONTEXT_KEYS.has(key)) return [];
      if (typeof item === "string")
        return [[key, sanitizeRuntimeText(item, secrets).slice(0, 256)]];
      return item === null || (typeof item === "number" && Number.isFinite(item))
        ? [[key, item]]
        : [];
    }),
  );
}

function decodeEntry(line: string): Entry | null {
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (
      typeof item.timestamp !== "string" ||
      (item.level !== "error" && item.level !== "warn") ||
      typeof item.source !== "string" ||
      typeof item.message !== "string"
    )
      return null;
    let omitted: Entry["omitted"];
    if (item.omitted && typeof item.omitted === "object" && !Array.isArray(item.omitted)) {
      const counts = item.omitted as Record<string, unknown>;
      if (
        Number.isSafeInteger(counts.errors) &&
        (counts.errors as number) >= 0 &&
        Number.isSafeInteger(counts.warnings) &&
        (counts.warnings as number) >= 0
      )
        omitted = { errors: counts.errors as number, warnings: counts.warnings as number };
    }
    const context = sanitizeContext(item.context);
    return {
      timestamp: item.timestamp,
      level: item.level,
      source: sanitizeRuntimeText(item.source)
        .replace(/[^\w.:-]/g, "_")
        .slice(0, 100),
      message: sanitizeRuntimeText(
        item.httpResponseSanitized === true
          ? item.message
          : (httpFailureText(
              item.message,
              typeof context.status === "number" ? context.status : undefined,
            ) ?? item.message),
      ),
      context,
      ...(omitted ? { omitted } : {}),
      ...(item.httpResponseSanitized === true ? { httpResponseSanitized: true } : {}),
    };
  } catch {
    return null;
  }
}

function addBreakdown(map: Map<string, RuntimeLogBreakdown>, label: string, level: Entry["level"]) {
  const name = map.has(label) || map.size < BREAKDOWN_LIMIT ? label : "<other>";
  const count = map.get(name) ?? { name, errors: 0, warnings: 0 };
  if (level === "error") count.errors++;
  else count.warnings++;
  map.set(name, count);
}

// Read only a bounded tail if a legacy or damaged log exceeds the per-file budget.
async function readLogTail(path: string, size: number): Promise<string> {
  const length = Math.min(size, FILE_SIZE + 1);
  const start = size - length;
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const result = await handle.read(buffer, offset, length - offset, start + offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    let raw = buffer.subarray(0, offset).toString("utf8");
    if (size > FILE_SIZE) {
      const newline = raw.indexOf("\n");
      raw = newline === -1 ? "" : raw.slice(newline + 1);
    }
    return raw;
  } finally {
    await handle.close();
  }
}

export function recordRuntimeError(
  source: string,
  cause: unknown,
  context: LogContext = {},
  secrets: string[] = [],
): void {
  current?.record(source, cause, context, "error", secrets);
}

export function recordRuntimeWarning(
  source: string,
  cause: unknown,
  context: LogContext = {},
  secrets: string[] = [],
): void {
  current?.record(source, cause, context, "warn", secrets);
}

export function installRuntimeLog(service: RuntimeLogService): void {
  current = service;
}

export class RuntimeLogService {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private dropped = { errors: 0, warnings: 0 };
  private failure: string | null = null;
  private initialized = false;
  private bytes = 0;
  private maintenanceAt = 0;

  constructor(
    readonly directory: string,
    private readonly version: string,
  ) {}

  private files(): string[] {
    return [
      "runtime.jsonl",
      ...Array.from({ length: FILE_COUNT - 1 }, (_, index) => `runtime.${index + 1}.jsonl`),
    ];
  }

  recordFatal(cause: unknown): void {
    // A dying main process cannot wait for the asynchronous queue. Reserve the oldest slot.
    try {
      mkdirSync(this.directory, { recursive: true });
      const diagnostic = diagnosticErrorText(cause);
      writeFileSync(
        join(this.directory, "runtime.4.jsonl"),
        `${JSON.stringify({ timestamp: new Date().toISOString(), level: "error", source: "main.uncaught", message: sanitizeRuntimeText(diagnostic.text), context: {}, ...(diagnostic.http ? { httpResponseSanitized: true } : {}) } satisfies Entry)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    } catch (cause) {
      this.failure = sanitizeRuntimeText(errorText(cause));
    }
  }

  record(
    source: string,
    cause: unknown,
    context: LogContext = {},
    level: Entry["level"] = "error",
    secrets: string[] = [],
  ): void {
    if (this.pending >= 512) {
      if (level === "error") this.dropped.errors++;
      else this.dropped.warnings++;
      return;
    }
    const diagnostic = diagnosticErrorText(
      cause,
      typeof context.status === "number" ? context.status : undefined,
    );
    const text = diagnostic.text;
    const safeContext = sanitizeContext(context, secrets);
    const status = /\bHTTP\s+(\d{3})\b/i.exec(text)?.[1];
    const entry: Entry = {
      timestamp: new Date().toISOString(),
      level,
      source: sanitizeRuntimeText(source, secrets)
        .replace(/[^\w.:-]/g, "_")
        .slice(0, 100),
      message: sanitizeRuntimeText(text, secrets),
      context: { ...(status ? { status: Number(status) } : {}), ...safeContext },
      ...(diagnostic.http ? { httpResponseSanitized: true } : {}),
    };
    this.pending++;
    let omitted: Entry["omitted"];
    this.queue = this.queue
      .then(async () => {
        await this.maintain();
        if (this.dropped.errors || this.dropped.warnings) {
          omitted = this.dropped;
          this.dropped = { errors: 0, warnings: 0 };
          entry.omitted = omitted;
          entry.message = `[${omitted.errors + omitted.warnings} additional records omitted during a burst]\n${entry.message}`;
        }
        const line = `${JSON.stringify(entry)}\n`;
        const size = Buffer.byteLength(line);
        if (this.bytes + size > FILE_SIZE) {
          const files = this.files();
          await rm(join(this.directory, files.at(-1) as string), { force: true });
          for (let index = files.length - 2; index >= 0; index--) {
            try {
              await rename(
                join(this.directory, files[index] as string),
                join(this.directory, files[index + 1] as string),
              );
            } catch (cause) {
              if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
            }
          }
          this.bytes = 0;
        }
        await appendFile(join(this.directory, "runtime.jsonl"), line, {
          encoding: "utf8",
          mode: 0o600,
        });
        this.bytes += size;
      })
      .catch((cause) => {
        if (omitted) {
          this.dropped.errors += omitted.errors;
          this.dropped.warnings += omitted.warnings;
        }
        if (level === "error") this.dropped.errors++;
        else this.dropped.warnings++;
        this.failure = sanitizeRuntimeText(errorText(cause));
        this.initialized = false;
      })
      .finally(() => {
        this.pending--;
      });
  }

  private async maintain(): Promise<void> {
    if (this.initialized && Date.now() - this.maintenanceAt < 3600000) return;
    await mkdir(this.directory, { recursive: true });
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    for (const name of await readdir(this.directory)) {
      if (!FILE_PATTERN.test(name)) continue;
      const path = join(this.directory, name);
      const info = await stat(path);
      if (info.mtimeMs < cutoff) {
        await rm(path);
        continue;
      }
      const raw = await readLogTail(path, info.size);
      const lines = raw.split("\n").filter(Boolean);
      let retained = lines.filter((line) => {
        try {
          const timestamp = Date.parse(String((JSON.parse(line) as Entry).timestamp));
          return !Number.isFinite(timestamp) || timestamp >= cutoff;
        } catch {
          return true;
        }
      });
      let retainedBytes = retained.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0);
      let first = 0;
      while (retainedBytes > FILE_SIZE && first < retained.length) {
        retainedBytes -= Buffer.byteLength(retained[first] as string) + 1;
        first++;
      }
      if (first) retained = retained.slice(first);
      if (
        info.size > FILE_SIZE ||
        retained.length !== lines.length ||
        (raw && !raw.endsWith("\n"))
      ) {
        if (retained.length) await writeFile(path, `${retained.join("\n")}\n`, "utf8");
        else await rm(path);
      }
    }
    this.bytes = await stat(join(this.directory, "runtime.jsonl"))
      .then((info) => info.size)
      .catch((cause) => {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        return 0;
      });
    this.initialized = true;
    this.maintenanceAt = Date.now();
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  status(): Promise<RuntimeLogStatus> {
    return this.serialize(() => this.readStatus());
  }

  private async readStatus(): Promise<RuntimeLogStatus> {
    await this.maintain();
    let bytes = 0;
    let files = 0;
    for (const name of this.files()) {
      const info = await stat(join(this.directory, name)).catch((cause) => {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        return null;
      });
      if (info) {
        bytes += info.size;
        files++;
      }
    }
    return {
      directory: this.directory,
      files,
      bytes,
      retentionDays: RETENTION_DAYS,
      maxBytes: FILE_SIZE * FILE_COUNT,
      lastError: this.failure,
      statistics: (await this.collectEntries(false)).statistics,
    };
  }

  private async collectEntries(includeEntries: boolean): Promise<{
    entries: Entry[];
    statistics: RuntimeLogStatistics;
  }> {
    const entries: Entry[] = [];
    const statistics: RuntimeLogStatistics = {
      errors: 0,
      warnings: 0,
      omitted: { ...this.dropped, unknown: 0 },
      damaged: 0,
      bySource: [],
      byOperation: [],
    };
    const sources = new Map<string, RuntimeLogBreakdown>();
    const operations = new Map<string, RuntimeLogBreakdown>();
    for (const name of this.files().reverse()) {
      const path = join(this.directory, name);
      const info = await stat(path).catch((cause) => {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        return null;
      });
      const raw = info ? await readLogTail(path, info.size) : "";
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        const entry = decodeEntry(line);
        if (!entry) {
          statistics.damaged++;
          if (includeEntries)
            entries.push({
              timestamp: new Date().toISOString(),
              level: "warn",
              source: "logs.read",
              message: "A damaged log entry was omitted.",
              context: {},
            });
          continue;
        }
        if (entry.level === "error") statistics.errors++;
        else statistics.warnings++;
        addBreakdown(sources, entry.source || "<unknown>", entry.level);
        if (typeof entry.context.operation === "string" && entry.context.operation.trim())
          addBreakdown(
            operations,
            entry.context.operation.replace(/[^\w.:-]/g, "_").slice(0, 100),
            entry.level,
          );
        if (entry.omitted) {
          statistics.omitted.errors = Math.min(
            Number.MAX_SAFE_INTEGER,
            statistics.omitted.errors + entry.omitted.errors,
          );
          statistics.omitted.warnings = Math.min(
            Number.MAX_SAFE_INTEGER,
            statistics.omitted.warnings + entry.omitted.warnings,
          );
        } else {
          const legacy = /^\[(\d+) additional errors omitted during a burst\]\n/.exec(
            entry.message,
          );
          const count = legacy ? Number(legacy[1]) : 0;
          if (Number.isSafeInteger(count))
            statistics.omitted.unknown = Math.min(
              Number.MAX_SAFE_INTEGER,
              statistics.omitted.unknown + count,
            );
        }
        if (includeEntries) entries.push(entry);
      }
    }
    statistics.bySource = [...sources.values()].sort((a, b) => a.name.localeCompare(b.name));
    statistics.byOperation = [...operations.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { entries, statistics };
  }

  export(path: string): Promise<void> {
    return this.serialize(() => this.writeExport(path));
  }

  private async writeExport(path: string): Promise<void> {
    const target = relative(resolve(this.directory), resolve(path));
    if (target === "" || (!target.startsWith("..") && !isAbsolute(target)))
      throw new Error("Choose an export location outside the active log directory.");
    await this.maintain();
    const { entries, statistics } = await this.collectEntries(true);
    entries.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    await writeFile(
      path,
      JSON.stringify(
        {
          application: "Mingshen Harness",
          version: this.version,
          platform: process.platform,
          exportedAt: new Date().toISOString(),
          retentionDays: RETENTION_DAYS,
          maxBytes: FILE_SIZE * FILE_COUNT,
          statistics,
          localOnly: true,
          lastWriteError: this.failure,
          entries,
        },
        null,
        2,
      ),
      { encoding: "utf8", mode: 0o600 },
    );
  }
}
