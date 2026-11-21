import { type ChildProcess, execFile, type SpawnOptions, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BoundedOutput } from "./bounded-output";

const DEFAULT_TERMINATION_TIMEOUT_MS = 10_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 15_000;
const MAX_CAPTURED_CHARS = 256_000;
const MAX_TOMBSTONE_OUTPUT = 8_000;
const COMMAND_CANCELED_MESSAGE = "命令已取消。执行中断前可能已产生部分修改，请核实真实状态。";

export interface HostCommandResult {
  output: string;
  capturedOutput: string;
  isError: boolean;
  cleanupUnconfirmed?: boolean;
}

export interface HostCommandLaunch {
  sessionId: string;
  runId: string;
  toolCallId: string;
  executable: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
}

export interface HostCommandDependencies {
  spawn?: (executable: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  terminate?: (child: ChildProcess) => Promise<void>;
  closeTimeoutMs?: number;
}

interface ManagedHostCommand extends HostCommandLaunch {
  id: string;
  child: ChildProcess;
  capture: BoundedOutput;
  stdout: string;
  stderr: string;
  processClosed: boolean;
  exitCode: number | null;
  settled: boolean;
  confirmed: boolean;
  stopReason: string;
  childError: string;
  killError: string;
  closeError: string;
  cleanupError: string;
  timer: ReturnType<typeof setTimeout> | null;
  stopping: Promise<void> | null;
  closed: Promise<void>;
  resolveClosed: () => void;
  resolveResult: (result: HostCommandResult) => void;
  abort: () => void;
}

export class HostCommandCleanupUnconfirmedError extends Error {
  readonly cleanupUnconfirmed = true;

  constructor(readonly detail: string) {
    super(
      `COMMAND_CLEANUP_UNCONFIRMED: ${detail}. Verify that the host process tree has stopped before allowing new writes.`,
    );
    this.name = "HostCommandCleanupUnconfirmedError";
  }
}

export function isHostCommandCleanupUnconfirmedError(
  error: unknown,
): error is HostCommandCleanupUnconfirmedError {
  if (error instanceof HostCommandCleanupUnconfirmedError) return true;
  const candidate = error as Partial<HostCommandCleanupUnconfirmedError> | null;
  return (
    candidate?.name === "HostCommandCleanupUnconfirmedError" &&
    candidate.cleanupUnconfirmed === true
  );
}

function taskkillExecutable(): string {
  return join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
}

function terminateHostProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return Promise.resolve();
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return Promise.resolve();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return Promise.resolve();
      return Promise.reject(error);
    }
  }
  return new Promise((resolveTermination, rejectTermination) => {
    execFile(
      taskkillExecutable(),
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, timeout: DEFAULT_TERMINATION_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        if (error) {
          rejectTermination(
            new Error(String(stderr || error.message || error).trim() || "taskkill failed."),
          );
          return;
        }
        resolveTermination();
      },
    );
  });
}

function appendBounded(current: string, chunk: string, limit: number): string {
  if (chunk.length >= limit) return chunk.slice(-limit);
  const combined = current + chunk;
  return combined.length > limit ? combined.slice(-limit) : combined;
}

function boundedOutput(output: string): string {
  if (output.length <= MAX_TOMBSTONE_OUTPUT) return output;
  return `[${output.length - MAX_TOMBSTONE_OUTPUT} captured characters omitted]\n${output.slice(-MAX_TOMBSTONE_OUTPUT)}`;
}

export class HostCommandService {
  private readonly commands = new Map<string, ManagedHostCommand>();

  constructor(private readonly dependencies: HostCommandDependencies = {}) {}

  hasRunningCommands(runId: string): boolean {
    return [...this.commands.values()].some(
      (command) => command.runId === runId && !command.confirmed,
    );
  }

  hasUnconfirmedCleanup(runId?: string): boolean {
    return [...this.commands.values()].some(
      (command) =>
        !command.confirmed &&
        Boolean(command.cleanupError) &&
        (runId === undefined || command.runId === runId),
    );
  }

  async run(launch: HostCommandLaunch): Promise<HostCommandResult> {
    launch.signal.throwIfAborted();
    const existing = [...this.commands.values()].find(
      (command) => command.runId === launch.runId && command.cleanupError,
    );
    if (existing)
      throw new HostCommandCleanupUnconfirmedError(
        [existing.stopReason, existing.cleanupError].filter(Boolean).join("\n"),
      );

    const child = (this.dependencies.spawn ?? spawn)(launch.executable, launch.args, {
      cwd: launch.cwd,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    let resolveResult!: (result: HostCommandResult) => void;
    const resultPromise = new Promise<HostCommandResult>((resolve) => {
      resolveResult = resolve;
    });
    const abort = () => {
      void this.stop(command, COMMAND_CANCELED_MESSAGE);
    };
    const command: ManagedHostCommand = {
      ...launch,
      signal: launch.signal,
      id: randomUUID(),
      child,
      capture: new BoundedOutput(),
      stdout: "",
      stderr: "",
      processClosed: false,
      exitCode: null,
      settled: false,
      confirmed: false,
      stopReason: "",
      childError: "",
      killError: "",
      closeError: "",
      cleanupError: "",
      timer: null,
      stopping: null,
      closed,
      resolveClosed,
      resolveResult,
      abort,
    };
    this.commands.set(command.id, command);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      command.capture.append(chunk);
      command.stdout = appendBounded(command.stdout, chunk, MAX_CAPTURED_CHARS);
    });
    child.stderr?.on("data", (chunk: string) => {
      command.capture.append(chunk);
      command.stderr = appendBounded(command.stderr, chunk, MAX_CAPTURED_CHARS);
    });
    child.once("error", (error) => {
      if (command.settled || command.confirmed) return;
      command.childError = error.message;
      if (child.pid) {
        void this.stop(
          command,
          "Command failed after the host process started. Partial effects may exist.",
        );
        return;
      }
      this.settle(command, {
        output: error.message,
        capturedOutput: command.capture.text(),
        isError: true,
      });
    });
    child.once("close", (code) => {
      command.processClosed = true;
      command.exitCode = code;
      command.resolveClosed();
      if (command.stopping || command.settled) return;
      const combined = [command.stdout.trim(), command.stderr.trim()].filter(Boolean).join("\n");
      this.settle(command, {
        output: `exit_code: ${code ?? "null"}\n${combined || "(no output)"}`,
        capturedOutput: command.capture.text(),
        isError: (code ?? 1) !== 0,
      });
    });

    command.timer = setTimeout(() => {
      void this.stop(
        command,
        `Command timed out after ${launch.timeoutMs} ms. Partial effects may exist.`,
      );
    }, launch.timeoutMs);
    launch.signal.addEventListener("abort", command.abort, { once: true });
    if (launch.signal.aborted) command.abort();
    return await resultPromise;
  }

  async cancelRun(runId: string): Promise<void> {
    const commands = [...this.commands.values()].filter(
      (command) => command.runId === runId && !command.confirmed,
    );
    await Promise.all(
      commands.map((command) => this.stop(command, "Command stopped at the end of its run.")),
    );
    const failures = commands
      .filter((command) => !command.confirmed && command.cleanupError)
      .map((command) => [command.stopReason, command.cleanupError].filter(Boolean).join("\n"));
    if (failures.length) throw new HostCommandCleanupUnconfirmedError(failures.join("\n"));
  }

  async shutdown(): Promise<void> {
    const runIds = [
      ...new Set(
        [...this.commands.values()]
          .filter((command) => !command.confirmed)
          .map((command) => command.runId),
      ),
    ];
    const results = await Promise.allSettled(runIds.map((runId) => this.cancelRun(runId)));
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [String(result.reason)] : [],
    );
    if (failures.length) throw new Error(failures.join("\n"));
  }

  confirmRunStopped(runId: string): number {
    const commands = [...this.commands.values()].filter(
      (command) => command.runId === runId && !command.confirmed,
    );
    const unconfirmedActive = commands.filter((command) => !command.cleanupError);
    if (unconfirmedActive.length)
      throw new Error(
        `COMMAND_RUN_STILL_ACTIVE: ${unconfirmedActive.length} host command(s) in run ${runId} have not reached an unconfirmed cleanup state.`,
      );
    for (const command of commands) this.confirmCommand(command);
    return commands.length;
  }

  private stop(command: ManagedHostCommand, reason: string): Promise<void> {
    if (command.confirmed || command.stopping) return command.stopping ?? Promise.resolve();
    if (command.settled && !command.cleanupError) return Promise.resolve();
    if (command.timer) {
      clearTimeout(command.timer);
      command.timer = null;
    }
    command.signal.removeEventListener("abort", command.abort);
    command.stopReason ||= reason;
    const attempt = (async () => {
      if (!command.processClosed) {
        try {
          await (this.dependencies.terminate ?? terminateHostProcessTree)(command.child);
          command.killError = "";
        } catch (error) {
          command.killError = error instanceof Error ? error.message : String(error);
        }
      }
      if (!command.killError && !command.processClosed) {
        let closeTimer: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            command.closed,
            new Promise<never>((_resolve, reject) => {
              closeTimer = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Process close was not confirmed after the bounded termination attempt.",
                    ),
                  ),
                this.dependencies.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
              );
            }),
          ]);
          command.closeError = "";
        } catch (error) {
          command.closeError = error instanceof Error ? error.message : String(error);
        } finally {
          if (closeTimer) clearTimeout(closeTimer);
        }
      }
      if (command.processClosed) command.closeError = "";
      const cleanupDetail = [
        command.killError ? `TERMINATION_ERROR: ${command.killError}` : "",
        command.closeError ? `CLOSE_ERROR: ${command.closeError}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      command.cleanupError = cleanupDetail ? boundedOutput(cleanupDetail) : "";
      if (command.cleanupError) {
        this.releaseUnconfirmedHandles(command);
      } else {
        this.commands.delete(command.id);
      }
      this.settle(command, {
        output: [
          command.stopReason,
          command.childError,
          command.stdout.trim(),
          command.stderr.trim(),
          command.cleanupError ? `COMMAND_CLEANUP_UNCONFIRMED: ${command.cleanupError}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        capturedOutput: command.capture.text(),
        isError: true,
        ...(command.cleanupError ? { cleanupUnconfirmed: true } : {}),
      });
    })();
    command.stopping = attempt;
    void attempt.then(
      () => {
        if (command.stopping === attempt) command.stopping = null;
      },
      () => {
        if (command.stopping === attempt) command.stopping = null;
      },
    );
    return attempt;
  }

  private settle(command: ManagedHostCommand, result: HostCommandResult): void {
    if (command.settled || command.confirmed) return;
    command.settled = true;
    if (command.timer) {
      clearTimeout(command.timer);
      command.timer = null;
    }
    command.signal.removeEventListener("abort", command.abort);
    command.resolveResult(result);
    if (!command.cleanupError) this.commands.delete(command.id);
  }

  private releaseUnconfirmedHandles(command: ManagedHostCommand): void {
    command.child.stdout?.destroy();
    command.child.stderr?.destroy();
    command.child.unref();
  }

  private confirmCommand(command: ManagedHostCommand): void {
    command.confirmed = true;
    command.stopReason = "";
    command.killError = "";
    command.closeError = "";
    command.cleanupError = "";
    command.child.stdout?.destroy();
    command.child.stderr?.destroy();
    command.child.unref();
    command.childError = "";
    command.resolveClosed();
    this.commands.delete(command.id);
  }
}
