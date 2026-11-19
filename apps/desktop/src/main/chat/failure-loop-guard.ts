import { createHash } from "node:crypto";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export class FailureLoopGuard {
  private readonly failures = new Map<string, number>();
  private consecutive = 0;
  private key(name: string, args: unknown): string {
    return createHash("sha256")
      .update(`${name}\n${canonical(args)}`)
      .digest("hex");
  }

  before(name: string, args: unknown): string | null {
    if (this.consecutive >= 12)
      return "TOOL_FAILURE_LIMIT: 12 consecutive failed or blocked tool calls. Stop this strategy and report the blocker with evidence; do not claim completion. A new user turn can resume after the cause is addressed.";
    if ((this.failures.get(this.key(name, args)) ?? 0) >= 3) {
      this.consecutive++;
      return "STRATEGY_CHANGE_REQUIRED: this exact tool and arguments failed three times. It was not executed again. Inspect the error and current state, choose a different hypothesis or tool, or report the blocker. Cosmetic retries will not repair the cause.";
    }
    return null;
  }

  record(name: string, args: unknown, isError: boolean): void {
    const key = this.key(name, args);
    if (isError) {
      this.consecutive++;
      this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
    } else {
      this.consecutive = 0;
      this.failures.delete(key);
    }
  }

  get exhausted(): boolean {
    return this.consecutive >= 12;
  }
}
