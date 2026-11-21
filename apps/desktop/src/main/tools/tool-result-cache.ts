import { createHash } from "node:crypto";

interface Entry {
  value: string;
  expires: number;
}
export class ToolResultCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private generation = 0;
  get(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry || entry.expires < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  put(key: string, value: string, ttl = 60_000): void {
    if (value.length > 100_000) return;
    this.entries.set(key, { value, expires: Date.now() + ttl });
    while (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value as string);
  }
  clear(): void {
    this.entries.clear();
    this.generation++;
  }
  async deduplicate(
    key: string,
    execute: () => Promise<string>,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const flightKey = `${this.generation}:${key}`;
    const existing = this.inFlight.get(flightKey);
    if (existing)
      return await existing.then((result) => {
        signal.throwIfAborted();
        return result;
      });
    const pending = execute();
    this.inFlight.set(flightKey, pending);
    try {
      const result = await pending;
      signal.throwIfAborted();
      return result;
    } finally {
      if (this.inFlight.get(flightKey) === pending) this.inFlight.delete(flightKey);
    }
  }
}

export function readonlyCommand(
  command: string,
): { operation: "read" | "list" | "exists"; path: string; nameOnly: boolean } | null {
  const match =
    /^(Get-Content|Get-ChildItem|Test-Path)\s+-LiteralPath\s+(?:'([^'\r\n]+)'|([\w.\\/: -]+?))(\s+-Name)?\s*$/i.exec(
      command.trim(),
    );
  if (!match) return null;
  const path = (match[2] ?? match[3] ?? "").trim();
  if (!match[2] && /\s/.test(path)) return null;
  if (!path || /[;&|`$<>*?[\]{}()\r\n]/.test(path) || path.startsWith("-")) return null;
  const operation =
    match[1]?.toLowerCase() === "get-content"
      ? "read"
      : match[1]?.toLowerCase() === "test-path"
        ? "exists"
        : "list";
  if (match[4] && operation !== "list") return null;
  return { operation, path, nameOnly: Boolean(match[4]) };
}

export function contentCacheKey(scope: string, path: string, content: string): string {
  return `${scope}:${path}:${createHash("sha256").update(content).digest("hex")}`;
}

// Only immutable runtime probes can skip command execution. Project commands may have side effects.
export function cacheableCommand(command: string): boolean {
  return /^(?:node|node\.exe|python|python\.exe|python3|git|git\.exe|npm|pnpm|cargo|rustc|go|dotnet) --version$/i.test(
    command.trim(),
  );
}
