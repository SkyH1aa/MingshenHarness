import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BoundedOutput } from "./bounded-output";

const MAX_BUFFERED_CHARS = 256_000;
const MAX_SESSIONS = 64;
const MAX_RUNNING_SESSIONS = 32;
const MAX_RUNNING_PER_RUN = 8;
const CLOSED_RETENTION_MS = 5 * 60_000;

export interface CommandOwner {
  sessionId: string;
  runId: string;
}

export interface CommandSessionInfo extends CommandOwner {
  id: string;
  command: string;
  cwd: string;
  running: boolean;
  unreadOutputChars?: number;
  securityScope: string;
  exitCode: number | null;
  isError: boolean;
}

export interface CommandLaunch {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  initialInput?: string;
  cleanup?: () => Promise<void>;
}

export interface CommandSnapshot {
  id: string;
  running: boolean;
  unreadOutputChars: number;
  exitCode: number | null;
  output: string;
  fullOutput?: string;
  isError: boolean;
}

interface ManagedCommand extends CommandOwner {
  id: string;
  command: string;
  cwd: string;
  securityScope: string;
  child: ChildProcess;
  buffer: string;
  capture: BoundedOutput;
  baseOffset: number;
  readOffset: number;
  finished: boolean;
  processClosed: boolean;
  exitCode: number | null;
  reason: string;
  failed: boolean;
  closedAt: number;
  terminationError: string;
  cleanupError: string;
  cleanup: (() => Promise<void>) | undefined;
  manualStopConfirmed: boolean;
  closed: Promise<void>;
  resolveClosed: () => void;
  timer: ReturnType<typeof setTimeout>;
  signal: AbortSignal;
  abort: () => void;
  stopping: Promise<void> | null;
  operation: Promise<unknown>;
}

function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return Promise.resolve();
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return Promise.reject(error);
    }
    return Promise.resolve();
  }
  return new Promise((resolveKill, reject) => {
    execFile(
      join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, timeout: 10_000 },
      (error) => {
        if (error) reject(error);
        else resolveKill();
      },
    );
  });
}

export class PersistentCommandService {
  private readonly commands = new Map<string, ManagedCommand>();
  constructor(
    private readonly dependencies: {
      spawn?: typeof spawn;
      terminate?: (child: ChildProcess) => Promise<void>;
    } = {},
  ) {}

  list(runId: string): CommandSessionInfo[] {
    this.prune();
    return [...this.commands.values()]
      .filter((command) => command.runId === runId)
      .map((command) => this.info(command));
  }

  inspect(id: string, owner: CommandOwner): CommandSessionInfo {
    return this.info(this.require(id, owner));
  }

  confirmRunStopped(runId: string): number {
    const commands = [...this.commands.values()].filter((command) => command.runId === runId);
    const active = commands.filter(
      (command) => !command.finished && !this.unconfirmedCleanup(command),
    );
    if (active.length)
      throw new Error(
        `COMMAND_RUN_STILL_ACTIVE: ${active.length} command session(s) in run ${runId} are still running without unconfirmed cleanup. Stop them or wait for completion before confirming the run stopped.`,
      );
    for (const command of commands) this.discardCommand(command);
    return commands.length;
  }

  async start(
    owner: CommandOwner,
    metadata: { command: string; cwd: string; securityScope: string },
    launch: CommandLaunch,
    options: {
      signal: AbortSignal;
      timeoutMs: number;
      yieldMs: number;
      maxOutputChars: number;
    },
  ): Promise<CommandSnapshot> {
    options.signal.throwIfAborted();
    this.prune();
    const running = [...this.commands.values()].filter((command) => !command.finished);
    if (
      running.length >= MAX_RUNNING_SESSIONS ||
      running.filter((command) => command.runId === owner.runId).length >= MAX_RUNNING_PER_RUN ||
      this.commands.size >= MAX_SESSIONS
    )
      throw new Error("COMMAND_SESSION_LIMIT: finish or terminate an existing command first.");

    const child = (this.dependencies.spawn ?? spawn)(launch.executable, launch.args, {
      cwd: launch.cwd,
      ...(launch.env ? { env: launch.env } : {}),
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolveDone) => {
      resolveClosed = resolveDone;
    });
    const command: ManagedCommand = {
      ...owner,
      ...metadata,
      id: randomUUID(),
      child,
      buffer: "",
      capture: new BoundedOutput(),
      baseOffset: 0,
      readOffset: 0,
      finished: false,
      processClosed: false,
      exitCode: null,
      reason: "",
      failed: false,
      closedAt: 0,
      terminationError: "",
      cleanupError: "",
      cleanup: launch.cleanup,
      manualStopConfirmed: false,
      closed,
      resolveClosed,
      timer: setTimeout(() => {
        command.failed = true;
        void this.stop(command, `Command timed out after ${options.timeoutMs} ms.`).catch(
          () => undefined,
        );
      }, options.timeoutMs),
      signal: options.signal,
      abort: () => {
        command.failed = true;
        void this.stop(command, "Command canceled. Inspect any partial effects.").catch(
          () => undefined,
        );
      },
      stopping: null,
      operation: Promise.resolve(),
    };
    this.commands.set(command.id, command);
    const collect = (chunk: string) => {
      command.capture.append(chunk);
      command.buffer += chunk;
      if (command.buffer.length > MAX_BUFFERED_CHARS) {
        let dropped = command.buffer.length - MAX_BUFFERED_CHARS;
        if (
          /[\uD800-\uDBFF]/.test(command.buffer[dropped - 1] ?? "") &&
          /[\uDC00-\uDFFF]/.test(command.buffer[dropped] ?? "")
        )
          dropped++;
        command.buffer = command.buffer.slice(dropped);
        command.baseOffset += dropped;
      }
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.stdin?.on("error", () => undefined);
    child.once("error", (error) => {
      command.failed = true;
      command.reason = error.message;
    });
    child.once("close", (code) => {
      void this.finish(command, code);
    });
    options.signal.addEventListener("abort", command.abort, { once: true });
    if (options.signal.aborted) command.abort();
    if (launch.initialInput && !command.processClosed) {
      child.stdin?.write(launch.initialInput, "utf8", (error) => {
        if (error && !command.processClosed) {
          command.failed = true;
          void this.stop(command, `Command input failed: ${error.message}`).catch((cause) => {
            command.cleanupError = String(cause);
          });
        }
      });
    }
    await this.wait(command, options.yieldMs);
    return this.snapshot(command, options.maxOutputChars);
  }

  async interact(
    id: string,
    owner: CommandOwner,
    options: {
      chars?: string;
      closeStdin?: boolean;
      terminate?: boolean;
      yieldMs: number;
      maxOutputChars: number;
    },
  ): Promise<CommandSnapshot> {
    const command = this.require(id, owner);
    const next = command.operation
      .catch(() => undefined)
      .then(async () => {
        if (options.terminate) {
          await this.stop(command, "Command terminated.");
        } else if (options.chars || options.closeStdin) {
          if (command.finished || command.processClosed || !command.child.stdin?.writable)
            throw new Error("COMMAND_STDIN_CLOSED: the process no longer accepts input.");
          if (options.chars)
            await new Promise<void>((resolveWrite, rejectWrite) => {
              command.child.stdin?.write(options.chars, "utf8", (error) =>
                error ? rejectWrite(error) : resolveWrite(),
              );
            });
          if (options.closeStdin) command.child.stdin.end();
        }
        await this.wait(command, options.yieldMs);
        return this.snapshot(command, options.maxOutputChars);
      });
    command.operation = next;
    return await next;
  }

  async cancelRun(runId: string): Promise<void> {
    const commands = [...this.commands.values()].filter((command) => command.runId === runId);
    const results = await Promise.all(
      commands.map(async (command) => {
        try {
          await this.stop(command, "Command stopped at the end of its run.");
          return { command, error: null };
        } catch (error) {
          return { command, error: String(error) };
        }
      }),
    );
    const errors = results.flatMap((result) => (result.error === null ? [] : [result.error]));
    for (const result of results)
      if (result.error === null) this.commands.delete(result.command.id);
    if (errors.length)
      throw new Error(`COMMAND_CLEANUP_UNCONFIRMED: ${errors.join("\n").slice(0, 4000)}`);
  }

  async shutdown(): Promise<void> {
    const results = await Promise.allSettled(
      [...new Set([...this.commands.values()].map((command) => command.runId))].map((runId) =>
        this.cancelRun(runId),
      ),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [String(result.reason)] : [],
    );
    if (failures.length)
      throw new Error(`COMMAND_CLEANUP_UNCONFIRMED: ${failures.join("\n").slice(0, 4000)}`);
  }

  private info(command: ManagedCommand): CommandSessionInfo {
    return {
      id: command.id,
      sessionId: command.sessionId,
      runId: command.runId,
      command: command.command,
      cwd: command.cwd,
      running: !command.finished,
      unreadOutputChars: Math.max(
        0,
        command.baseOffset +
          command.buffer.length -
          Math.max(command.readOffset, command.baseOffset),
      ),
      securityScope: command.securityScope,
      exitCode: command.exitCode,
      isError:
        command.failed ||
        Boolean(command.terminationError) ||
        Boolean(command.cleanupError) ||
        (command.finished && command.exitCode !== 0),
    };
  }

  private require(id: string, owner: CommandOwner): ManagedCommand {
    this.prune();
    const command = this.commands.get(id);
    if (!command || command.sessionId !== owner.sessionId || command.runId !== owner.runId)
      throw new Error("COMMAND_SESSION_NOT_FOUND: no command belongs to this session and run.");
    return command;
  }

  private async finish(command: ManagedCommand, exitCode: number | null): Promise<void> {
    if (command.processClosed) return;
    command.processClosed = true;
    command.exitCode = exitCode;
    clearTimeout(command.timer);
    command.signal.removeEventListener("abort", command.abort);
    try {
      await this.confirmCleanup(command);
    } catch {
      // The retained error keeps the session and writer barrier unconfirmed.
    } finally {
      command.finished = true;
      command.closedAt = Date.now();
      command.resolveClosed();
    }
  }

  private async stop(command: ManagedCommand, reason: string): Promise<void> {
    if (command.manualStopConfirmed) return;
    if (command.finished && !this.unconfirmedCleanup(command)) return;
    if (!command.stopping) {
      const attempt = (async () => {
        if (command.finished) {
          await this.retryUnconfirmedCleanup(command);
          return;
        }
        command.reason ||= reason;
        let terminationFailure: unknown;
        if (!command.processClosed || command.terminationError)
          try {
            await this.confirmTermination(command);
          } catch (error) {
            terminationFailure = error;
          }
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            command.closed,
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new Error("Process close was not confirmed after cancellation.")),
                15_000,
              );
            }),
          ]);
        } catch (error) {
          throw terminationFailure ?? error;
        } finally {
          if (timeout) clearTimeout(timeout);
        }
        if (command.manualStopConfirmed) return;
        const unconfirmed = this.unconfirmedCleanup(command);
        if (unconfirmed) throw new Error(unconfirmed);
      })();
      command.stopping = attempt;
      try {
        await attempt;
      } finally {
        if (command.stopping === attempt) command.stopping = null;
      }
      return;
    }
    await command.stopping;
  }

  private async retryUnconfirmedCleanup(command: ManagedCommand): Promise<void> {
    let firstFailure: unknown;
    if (command.terminationError)
      try {
        await this.confirmTermination(command);
      } catch (error) {
        firstFailure = error;
      }
    if (command.cleanupError || (command.cleanup && command.terminationError))
      try {
        await this.confirmCleanup(command);
      } catch (error) {
        firstFailure ??= error;
      }
    if (command.manualStopConfirmed) return;
    const unconfirmed = this.unconfirmedCleanup(command);
    if (unconfirmed) throw firstFailure ?? new Error(unconfirmed);
  }

  private async confirmTermination(command: ManagedCommand): Promise<void> {
    try {
      await (this.dependencies.terminate ?? killTree)(command.child);
      if (!command.manualStopConfirmed) command.terminationError = "";
    } catch (error) {
      if (!command.manualStopConfirmed) command.terminationError = String(error);
      throw error;
    }
  }

  private async confirmCleanup(command: ManagedCommand): Promise<void> {
    try {
      await command.cleanup?.();
      if (!command.manualStopConfirmed) {
        command.cleanupError = "";
        if (command.cleanup) command.terminationError = "";
      }
    } catch (error) {
      if (!command.manualStopConfirmed) command.cleanupError = String(error);
      throw error;
    }
  }

  private unconfirmedCleanup(command: ManagedCommand): string {
    return [command.terminationError, command.cleanupError].filter(Boolean).join("\n");
  }

  private discardCommand(command: ManagedCommand): void {
    command.manualStopConfirmed = true;
    command.terminationError = "";
    command.cleanupError = "";
    clearTimeout(command.timer);
    command.signal.removeEventListener("abort", command.abort);
    command.child.stdin?.destroy();
    command.child.stdout?.destroy();
    command.child.stderr?.destroy();
    command.child.unref();
    command.processClosed = true;
    command.finished = true;
    command.closedAt ||= Date.now();
    command.resolveClosed();
    this.commands.delete(command.id);
  }

  private async wait(command: ManagedCommand, yieldMs: number): Promise<void> {
    if (command.finished || yieldMs <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      command.closed,
      new Promise<void>((resolveWait) => {
        timer = setTimeout(resolveWait, Math.min(yieldMs, 30_000));
      }),
    ]);
    if (timer) clearTimeout(timer);
  }

  private snapshot(command: ManagedCommand, maxOutputChars: number): CommandSnapshot {
    const dropped = Math.max(0, command.baseOffset - command.readOffset);
    const start = Math.max(0, command.readOffset - command.baseOffset);
    let end = Math.min(command.buffer.length, start + maxOutputChars);
    if (
      end > start &&
      /[\uD800-\uDBFF]/.test(command.buffer[end - 1] ?? "") &&
      /[\uDC00-\uDFFF]/.test(command.buffer[end] ?? "")
    )
      end--;
    const text = command.buffer.slice(start, end);
    command.readOffset = command.baseOffset + start + text.length;
    const remaining = command.baseOffset + command.buffer.length - command.readOffset;
    return {
      id: command.id,
      running: !command.finished,
      ...(command.baseOffset > 0
        ? {
            fullOutput: `command_session: ${command.id}\nstatus: ${command.finished ? "completed" : "running"}\n${command.capture.text()}`,
          }
        : {}),
      unreadOutputChars: remaining,
      exitCode: command.exitCode,
      isError:
        command.failed ||
        Boolean(command.terminationError) ||
        Boolean(command.cleanupError) ||
        (command.finished && command.exitCode !== 0),
      output: [
        `command_session: ${command.id}`,
        `status: ${command.finished ? "completed" : "running"}`,
        "transport: pipe (not a PTY)",
        ...(command.finished ? [`exit_code: ${command.exitCode ?? "null"}`] : []),
        ...(dropped ? [`[${dropped} older output characters omitted by the buffer limit]`] : []),
        text || "(no new output)",
        ...(remaining
          ? [
              `[${remaining} unread output characters remain; poll write_stdin with this session_id]`,
            ]
          : []),
        ...(command.reason ? [command.reason] : []),
        ...(this.unconfirmedCleanup(command)
          ? [`COMMAND_CLEANUP_UNCONFIRMED: ${this.unconfirmedCleanup(command).slice(0, 2000)}`]
          : []),
        ...(!command.finished
          ? [
              "Poll with write_stdin; send chars for input, close_stdin for EOF, or terminate to stop.",
            ]
          : []),
      ].join("\n"),
    };
  }

  private prune(): void {
    for (const command of this.commands.values())
      if (
        command.finished &&
        !this.unconfirmedCleanup(command) &&
        command.readOffset >= command.baseOffset + command.buffer.length &&
        (Date.now() - command.closedAt > CLOSED_RETENTION_MS || this.commands.size >= MAX_SESSIONS)
      )
        this.commands.delete(command.id);
  }
}
