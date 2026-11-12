import { mkdirSync, writeFileSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { RuntimeLogStatus } from "../../shared/runtime-log";
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
}

const FILE_SIZE = 2 * 1024 * 1024;
const FILE_COUNT = 5;
const RETENTION_DAYS = 30;
const FILE_PATTERN = /^runtime(?:\.[1-4])?\.jsonl$/;
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

export function recordRuntimeError(
  source: string,
  cause: unknown,
  context: LogContext = {},
  secrets: string[] = [],
): void {
  current?.record(source, cause, context, "error", secrets);
}

export function installRuntimeLog(service: RuntimeLogService): void {
  current = service;
}

export class RuntimeLogService {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private dropped = 0;
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
      writeFileSync(
        join(this.directory, "runtime.4.jsonl"),
        `${JSON.stringify({ timestamp: new Date().toISOString(), level: "error", source: "main.uncaught", message: sanitizeRuntimeText(errorText(cause)), context: {} } satisfies Entry)}\n`,
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
      this.dropped++;
      return;
    }
    const text = errorText(cause);
    const safeContext = Object.fromEntries(
      Object.entries(context).map(([key, value]) => [
        key,
        typeof value === "string" ? sanitizeRuntimeText(value, secrets).slice(0, 256) : value,
      ]),
    );
    const status = /\bHTTP\s+(\d{3})\b/i.exec(text)?.[1];
    const entry: Entry = {
      timestamp: new Date().toISOString(),
      level,
      source: source.replace(/[^\w.:-]/g, "_").slice(0, 100),
      message: sanitizeRuntimeText(text, secrets),
      context: { ...(status ? { status: Number(status) } : {}), ...safeContext },
    };
    this.pending++;
    this.queue = this.queue
      .then(async () => {
        await this.maintain();
        if (this.dropped) {
          entry.message = `[${this.dropped} additional errors omitted during a burst]\n${entry.message}`;
          this.dropped = 0;
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
      const raw = await readFile(path, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      const retained = lines.filter((line) => {
        try {
          const timestamp = Date.parse(String((JSON.parse(line) as Entry).timestamp));
          return !Number.isFinite(timestamp) || timestamp >= cutoff;
        } catch {
          return true;
        }
      });
      if (retained.length !== lines.length) {
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
    };
  }

  export(path: string): Promise<void> {
    return this.serialize(() => this.writeExport(path));
  }

  private async writeExport(path: string): Promise<void> {
    const target = relative(resolve(this.directory), resolve(path));
    if (target === "" || (!target.startsWith("..") && !isAbsolute(target)))
      throw new Error("Choose an export location outside the active log directory.");
    await this.maintain();
    const entries: Entry[] = [];
    for (const name of this.files().reverse()) {
      const raw = await readFile(join(this.directory, name), "utf8").catch((cause) => {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        return "";
      });
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Entry;
          entries.push({
            timestamp: entry.timestamp,
            level: entry.level,
            source: sanitizeRuntimeText(entry.source),
            message: sanitizeRuntimeText(entry.message),
            context: Object.fromEntries(
              Object.entries(entry.context).map(([key, value]) => [
                key,
                typeof value === "string" ? sanitizeRuntimeText(value) : value,
              ]),
            ),
          });
        } catch {
          entries.push({
            timestamp: new Date().toISOString(),
            level: "warn",
            source: "logs.read",
            message: "A damaged log entry was omitted.",
            context: {},
          });
        }
      }
    }
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
