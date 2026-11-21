import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { IPty } from "node-pty";
import type { SessionView } from "../../shared/domain";
import {
  type InteractiveTerminalCreateInput,
  type InteractiveTerminalEvent,
  type InteractiveTerminalView,
  MAX_INTERACTIVE_TERMINAL_INPUT_CHARS,
  MAX_INTERACTIVE_TERMINALS_PER_WINDOW,
  MAX_INTERACTIVE_TERMINALS_TOTAL,
} from "../../shared/terminal";

interface TerminalSessionSource {
  getSession(sessionId: string): SessionView | null;
  isProjectTrusted(workspacePath: string): boolean;
}

interface PtyDisposable {
  dispose(): void;
}

export interface PtyExitEvent {
  exitCode: number;
  signal: number | null;
}

export interface TerminalPtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): PtyDisposable;
  onExit(listener: (event: PtyExitEvent) => void): PtyDisposable;
}

export interface TerminalPtySpawnInput {
  shell: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  platform: NodeJS.Platform;
}

export type TerminalPtyFactory = (
  input: TerminalPtySpawnInput,
) => Promise<TerminalPtyProcess> | TerminalPtyProcess;

interface TerminalRecord {
  ownerId: number;
  view: InteractiveTerminalView;
  pty: TerminalPtyProcess;
  dataSubscription: PtyDisposable;
  exitSubscription: PtyDisposable;
  binding: TerminalWorkspaceBinding;
  stopRequested: boolean;
  exitObserved: boolean;
  treeStopped: boolean;
  stopPromise: Promise<void> | null;
  exited: Promise<void>;
  resolveExit: () => void;
}

interface DirectoryIdentity {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
}

interface TerminalWorkspaceBinding {
  source: DirectoryIdentity;
  cwd: DirectoryIdentity;
  executionMode: "host" | "worktree";
}

interface PendingCreate {
  ownerId: number;
  sessionId: string;
  completed: Promise<void>;
  cancelled: boolean;
}

interface TerminalServiceOptions {
  sessions: TerminalSessionSource;
  worktreePath(sessionId: string): string | null;
  emit?(ownerId: number, event: InteractiveTerminalEvent): void;
  ptyFactory?: TerminalPtyFactory;
  terminateTree?: (pid: number) => Promise<void>;
  terminationTimeoutMs?: number;
  exitTimeoutMs?: number;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
}

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const MIN_COLS = 20;
const MAX_COLS = 500;
const MIN_ROWS = 5;
const MAX_ROWS = 300;
const MAX_OUTPUT_CHARS = 256 * 1024;
const STOP_TIMEOUT_MS = 2_000;

function terminateProcessTree(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return Promise.reject(new Error("无效的终端进程标识。"));
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
      return Promise.resolve();
    } catch (cause) {
      return Promise.reject(cause);
    }
  }
  return new Promise((resolveTermination, rejectTermination) => {
    execFile(
      join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(pid), "/T", "/F"],
      { windowsHide: true, timeout: STOP_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        if (error) {
          rejectTermination(new Error(String(stderr || error.message).trim()));
          return;
        }
        resolveTermination();
      },
    );
  });
}

async function within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const ENVIRONMENT_ALLOWLIST = new Set(
  [
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "COMMONPROGRAMFILES",
    "COMMONPROGRAMFILES(X86)",
    "COMMONPROGRAMW6432",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "OS",
    "PSMODULEPATH",
    "POWERSHELL_DISTRIBUTION_CHANNEL",
    "TERM",
    "COLORTERM",
    "LANG",
    "LC_ALL",
  ].map((name) => name.toLowerCase()),
);

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function terminalEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === "string" && ENVIRONMENT_ALLOWLIST.has(name.toLowerCase())) {
      result[name] = value;
    }
  }
  return result;
}

function defaultShell(platform: NodeJS.Platform): { shell: string; args: string[] } {
  if (platform === "win32") {
    return { shell: "powershell.exe", args: ["-NoLogo"] };
  }
  return {
    shell: process.env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
    args: ["-l"],
  };
}

async function spawnNodePty(input: TerminalPtySpawnInput): Promise<TerminalPtyProcess> {
  const { spawn } = await import("node-pty");
  const processHandle: IPty = spawn(input.shell, input.args, {
    name: "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: input.env,
    ...(input.platform === "win32" ? { useConpty: true } : {}),
  });
  return {
    get pid() {
      return processHandle.pid;
    },
    write: (data) => processHandle.write(data),
    resize: (cols, rows) => processHandle.resize(cols, rows),
    onData: (listener) => processHandle.onData(listener),
    onExit: (listener) =>
      processHandle.onExit(({ exitCode, signal }) =>
        listener({ exitCode, signal: signal ?? null }),
      ),
  };
}

function validateOwnerId(ownerId: number): void {
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error("无效的终端窗口标识。");
}

function validateTerminalId(terminalId: string): void {
  if (!terminalId || terminalId.length > 200) throw new Error("无效的终端标识。");
}

function validateDimension(value: number | undefined, fallback: number, min: number, max: number) {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new Error(`终端尺寸必须介于 ${min} 和 ${max} 之间。`);
  }
  return normalized;
}

export class TerminalService {
  private readonly records = new Map<string, TerminalRecord>();
  private readonly pendingCreates = new Set<PendingCreate>();
  private readonly ownerDisposals = new Map<number, Promise<void>>();
  private readonly sessionDisposals = new Map<string, Promise<void>>();
  private readonly sessions: TerminalSessionSource;
  private readonly worktreePath: (sessionId: string) => string | null;
  private readonly emitEvent: (ownerId: number, event: InteractiveTerminalEvent) => void;
  private readonly ptyFactory: TerminalPtyFactory;
  private readonly terminateTree: (pid: number) => Promise<void>;
  private readonly terminationTimeoutMs: number;
  private readonly exitTimeoutMs: number;
  private readonly platform: NodeJS.Platform;
  private readonly environment: NodeJS.ProcessEnv;
  private disposed = false;
  private disposal: Promise<void> | null = null;

  constructor(options: TerminalServiceOptions) {
    this.sessions = options.sessions;
    this.worktreePath = options.worktreePath;
    this.emitEvent = options.emit ?? (() => undefined);
    this.ptyFactory = options.ptyFactory ?? spawnNodePty;
    this.terminateTree = options.terminateTree ?? terminateProcessTree;
    this.terminationTimeoutMs = options.terminationTimeoutMs ?? STOP_TIMEOUT_MS;
    this.exitTimeoutMs = options.exitTimeoutMs ?? STOP_TIMEOUT_MS;
    this.platform = options.platform ?? process.platform;
    this.environment = options.environment ?? process.env;
  }

  list(ownerId: number, sessionId: string): InteractiveTerminalView[] {
    validateOwnerId(ownerId);
    validateTerminalId(sessionId);
    return [...this.records.values()]
      .filter((record) => record.ownerId === ownerId && record.view.sessionId === sessionId)
      .sort((left, right) => left.view.createdAt.localeCompare(right.view.createdAt))
      .map((record) => ({ ...record.view }));
  }

  async create(
    ownerId: number,
    input: InteractiveTerminalCreateInput,
  ): Promise<InteractiveTerminalView> {
    validateOwnerId(ownerId);
    validateTerminalId(input.sessionId);
    this.assertCreateAllowed(ownerId, input.sessionId);
    const binding = this.currentBinding(input.sessionId);
    const cols = validateDimension(input.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS);
    const rows = validateDimension(input.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS);
    const ownerCount =
      [...this.records.values()].filter((record) => record.ownerId === ownerId).length +
      [...this.pendingCreates].filter((pending) => pending.ownerId === ownerId).length;
    if (ownerCount >= MAX_INTERACTIVE_TERMINALS_PER_WINDOW) {
      throw new Error(`此窗口最多可同时打开 ${MAX_INTERACTIVE_TERMINALS_PER_WINDOW} 个终端。`);
    }
    if (this.records.size + this.pendingCreates.size >= MAX_INTERACTIVE_TERMINALS_TOTAL) {
      throw new Error(`应用最多可同时运行 ${MAX_INTERACTIVE_TERMINALS_TOTAL} 个终端。`);
    }

    let completeCreate!: () => void;
    const pending: PendingCreate = {
      ownerId,
      sessionId: input.sessionId,
      cancelled: false,
      completed: new Promise<void>((resolveCreate) => {
        completeCreate = resolveCreate;
      }),
    };
    this.pendingCreates.add(pending);
    try {
      const shell = defaultShell(this.platform);
      const pty = await this.ptyFactory({
        ...shell,
        cwd: binding.cwd.path,
        cols,
        rows,
        env: terminalEnvironment(this.environment),
        platform: this.platform,
      });
      const now = new Date().toISOString();
      const id = randomUUID();
      const view: InteractiveTerminalView = {
        id,
        sessionId: input.sessionId,
        title: this.nextTitle(ownerId),
        shell: shell.shell,
        cwd: binding.cwd.path,
        status: "running",
        pid: pty.pid,
        cols,
        rows,
        exitCode: null,
        signal: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      let resolveExit!: () => void;
      const record: TerminalRecord = {
        ownerId,
        view,
        pty,
        dataSubscription: { dispose: () => undefined },
        exitSubscription: { dispose: () => undefined },
        binding,
        stopRequested: false,
        exitObserved: false,
        treeStopped: false,
        stopPromise: null,
        exited: new Promise<void>((resolveExited) => {
          resolveExit = resolveExited;
        }),
        resolveExit: () => resolveExit(),
      };
      this.records.set(id, record);
      try {
        record.exitSubscription = pty.onExit(({ exitCode, signal }) => {
          this.handleExit(id, exitCode, signal);
        });
        record.dataSubscription = pty.onData((data) => {
          const current = this.records.get(id);
          if (!current || current !== record || current.stopRequested) return;
          const text = String(data);
          if (!text) return;
          this.emitEvent(ownerId, {
            type: "output",
            terminalId: id,
            data: text.length > MAX_OUTPUT_CHARS ? text.slice(-MAX_OUTPUT_CHARS) : text,
          });
        });
        if (pending.cancelled) throw new Error("终端所属窗口或会话正在关闭。");
        this.assertCreateAllowed(ownerId, input.sessionId);
        this.assertBinding(record);
      } catch (cause) {
        try {
          await this.stop(ownerId, id);
        } catch (cleanupCause) {
          throw new Error(
            `无法初始化终端进程：${errorMessage(cause)}；进程清理未确认：${errorMessage(cleanupCause)}`,
          );
        }
        throw new Error(`无法初始化终端进程：${errorMessage(cause)}`);
      }
      this.emitEvent(ownerId, { type: "state", terminal: { ...view } });
      return { ...view };
    } finally {
      this.pendingCreates.delete(pending);
      completeCreate();
    }
  }

  input(ownerId: number, terminalId: string, data: string): void {
    validateOwnerId(ownerId);
    validateTerminalId(terminalId);
    if (typeof data !== "string" || data.length > MAX_INTERACTIVE_TERMINAL_INPUT_CHARS) {
      throw new Error("终端输入无效或过长。");
    }
    const record = this.ownedRecord(ownerId, terminalId);
    if (record.view.status !== "running") throw new Error("终端进程当前不可写入。");
    this.assertBinding(record);
    record.pty.write(data);
    record.view.updatedAt = new Date().toISOString();
  }

  resize(ownerId: number, terminalId: string, cols: number, rows: number): InteractiveTerminalView {
    validateOwnerId(ownerId);
    validateTerminalId(terminalId);
    const record = this.ownedRecord(ownerId, terminalId);
    if (record.view.status !== "running") throw new Error("终端进程当前不可调整尺寸。");
    this.assertBinding(record);
    const nextCols = validateDimension(cols, DEFAULT_COLS, MIN_COLS, MAX_COLS);
    const nextRows = validateDimension(rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS);
    record.pty.resize(nextCols, nextRows);
    record.view.cols = nextCols;
    record.view.rows = nextRows;
    record.view.updatedAt = new Date().toISOString();
    return { ...record.view };
  }

  stop(ownerId: number, terminalId: string): Promise<void> {
    validateOwnerId(ownerId);
    validateTerminalId(terminalId);
    const record = this.ownedRecord(ownerId, terminalId);
    if (record.stopPromise) return record.stopPromise;
    if (record.exitObserved && !record.stopRequested) {
      this.removeRecord(record);
      return Promise.resolve();
    }
    record.stopRequested = true;
    record.view.status = "stopping";
    record.view.error = null;
    record.view.updatedAt = new Date().toISOString();
    this.emitEvent(ownerId, { type: "state", terminal: { ...record.view } });
    const attempt = this.stopRecord(record);
    record.stopPromise = attempt;
    void attempt.then(
      () => {
        if (record.stopPromise === attempt) record.stopPromise = null;
      },
      () => {
        if (record.stopPromise === attempt) record.stopPromise = null;
      },
    );
    return attempt;
  }

  disposeOwner(ownerId: number): Promise<void> {
    validateOwnerId(ownerId);
    const existing = this.ownerDisposals.get(ownerId);
    if (existing) return existing;
    const disposal = this.disposeMatching((record) => record.ownerId === ownerId);
    this.ownerDisposals.set(ownerId, disposal);
    void disposal.then(
      () => this.ownerDisposals.delete(ownerId),
      () => this.ownerDisposals.delete(ownerId),
    );
    return disposal;
  }

  disposeSession(sessionId: string): Promise<void> {
    validateTerminalId(sessionId);
    const existing = this.sessionDisposals.get(sessionId);
    if (existing) return existing;
    const disposal = this.disposeMatching((record) => record.sessionId === sessionId);
    this.sessionDisposals.set(sessionId, disposal);
    void disposal.then(
      () => this.sessionDisposals.delete(sessionId),
      () => this.sessionDisposals.delete(sessionId),
    );
    return disposal;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    if (this.disposal) return this.disposal;
    const disposal = this.disposeMatching(() => true);
    this.disposal = disposal;
    void disposal.then(
      () => {
        if (this.disposal === disposal) this.disposal = null;
      },
      () => {
        if (this.disposal === disposal) this.disposal = null;
      },
    );
    return disposal;
  }

  private assertCreateAllowed(ownerId: number, sessionId: string): void {
    if (this.disposed) throw new Error("终端服务已停止。");
    if (this.ownerDisposals.has(ownerId) || this.sessionDisposals.has(sessionId)) {
      throw new Error("终端所属窗口或会话正在关闭。");
    }
  }

  private nextTitle(ownerId: number): string {
    const used = new Set<number>();
    for (const record of this.records.values()) {
      if (record.ownerId !== ownerId) continue;
      const match = /^PowerShell (\d+)$/.exec(record.view.title);
      if (match) used.add(Number(match[1]));
    }
    let index = 1;
    while (used.has(index)) index += 1;
    return `PowerShell ${index}`;
  }

  private currentBinding(sessionId: string): TerminalWorkspaceBinding {
    const session = this.sessions.getSession(sessionId);
    if (!session || session.id !== sessionId) throw new Error("会话不存在，不能打开终端。");
    if (session.parentSessionId) throw new Error("SubAgent 不能打开本地终端。");
    if ((session.agentMode ?? "code") === "chat") {
      throw new Error("ChatAgent 不提供本地终端。");
    }
    if (session.patchOnly) throw new Error("Patch-only 会话不能打开本地终端。");
    if (session.permissionMode !== "full_access") {
      throw new Error("本地终端仅在完全访问会话中可用。");
    }
    if (session.executionMode !== "host" && session.executionMode !== "worktree") {
      throw new Error("Docker 隔离会话不能打开宿主终端。");
    }
    if (!session.workspacePath) throw new Error("当前会话没有可用的工作目录。");
    const sourceWorkspace = resolve(session.workspacePath);
    if (!this.sessions.isProjectTrusted(sourceWorkspace)) {
      throw new Error("工作区尚未受信任，不能打开本地终端。");
    }
    const cwd =
      session.executionMode === "worktree" ? this.worktreePath(sessionId) : session.workspacePath;
    if (!cwd) throw new Error("worktree 尚未建立，不能打开本地终端。");
    return {
      source: this.directoryIdentity(sourceWorkspace),
      cwd: this.directoryIdentity(resolve(cwd)),
      executionMode: session.executionMode,
    };
  }

  private directoryIdentity(path: string): DirectoryIdentity {
    try {
      let cursor = resolve(path);
      for (;;) {
        const metadata = lstatSync(cursor);
        if (metadata.isSymbolicLink()) throw new Error("终端工作目录不能经过符号链接或目录链接。");
        if (!metadata.isDirectory()) throw new Error("终端工作目录不存在或不可用。");
        const parent = dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
      const realPath = realpathSync(path);
      if (!this.samePath(path, realPath)) {
        throw new Error("终端工作目录不能经过符号链接或目录链接。");
      }
      const metadata = lstatSync(path);
      return { path, realPath, dev: metadata.dev, ino: metadata.ino };
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith("终端工作目录")) throw cause;
      throw new Error(`终端工作目录不存在或不可用：${errorMessage(cause)}`);
    }
  }

  private samePath(left: string, right: string): boolean {
    const resolvedLeft = resolve(left);
    const resolvedRight = resolve(right);
    return process.platform === "win32"
      ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
      : resolvedLeft === resolvedRight;
  }

  private assertBinding(record: TerminalRecord): void {
    const current = this.currentBinding(record.view.sessionId);
    const sameDirectory = (left: DirectoryIdentity, right: DirectoryIdentity) =>
      this.samePath(left.path, right.path) &&
      this.samePath(left.realPath, right.realPath) &&
      left.dev === right.dev &&
      left.ino === right.ino;
    if (
      current.executionMode !== record.binding.executionMode ||
      !sameDirectory(current.source, record.binding.source) ||
      !sameDirectory(current.cwd, record.binding.cwd)
    ) {
      throw new Error("终端所属会话或工作目录已更改，请关闭并重新打开终端。");
    }
  }

  private ownedRecord(ownerId: number, terminalId: string): TerminalRecord {
    const record = this.records.get(terminalId);
    if (!record || record.ownerId !== ownerId) {
      throw new Error("终端不存在或不属于当前窗口。");
    }
    return record;
  }

  private handleExit(terminalId: string, exitCode: number, signal: number | null): void {
    const record = this.records.get(terminalId);
    if (!record || record.exitObserved) return;
    record.exitObserved = true;
    record.view.exitCode = exitCode;
    record.view.signal = signal;
    record.view.updatedAt = new Date().toISOString();
    record.resolveExit();
    if (!record.stopRequested) {
      record.view.status = "exited";
      this.emitEvent(record.ownerId, { type: "state", terminal: { ...record.view } });
    } else if (record.treeStopped && !record.stopPromise) {
      this.removeRecord(record);
    }
  }

  private async stopRecord(record: TerminalRecord): Promise<void> {
    try {
      if (!record.treeStopped) {
        if (record.exitObserved) {
          throw new Error("终端进程已退出，但进程树停止未确认，无法安全重试原进程标识。");
        }
        await within(
          Promise.resolve().then(() => this.terminateTree(record.pty.pid)),
          this.terminationTimeoutMs,
          "终端进程树停止超时。",
        );
        record.treeStopped = true;
      }
      if (!record.exitObserved) {
        await within(record.exited, this.exitTimeoutMs, "终端进程退出未确认。");
      }
      this.removeRecord(record);
    } catch (cause) {
      const error = new Error(`终端清理未确认：${errorMessage(cause)}`);
      record.view.status = "error";
      record.view.error = error.message;
      record.view.updatedAt = new Date().toISOString();
      this.emitEvent(record.ownerId, { type: "state", terminal: { ...record.view } });
      throw error;
    }
  }

  private removeRecord(record: TerminalRecord): void {
    if (this.records.get(record.view.id) !== record) return;
    this.records.delete(record.view.id);
    record.dataSubscription.dispose();
    record.exitSubscription.dispose();
    this.emitEvent(record.ownerId, { type: "removed", terminalId: record.view.id });
  }

  private async disposeMatching(
    matches: (scope: { ownerId: number; sessionId: string }) => boolean,
  ): Promise<void> {
    const pending = [...this.pendingCreates].filter(matches);
    for (const item of pending) item.cancelled = true;
    const pendingResults = await Promise.allSettled(
      pending.map((item) =>
        within(item.completed, this.terminationTimeoutMs, "终端创建尚未结束，清理未确认。"),
      ),
    );
    const records = [...this.records.values()].filter((record) =>
      matches({ ownerId: record.ownerId, sessionId: record.view.sessionId }),
    );
    const results = await Promise.allSettled(
      records.map(async (record) => {
        if (this.records.get(record.view.id) === record) {
          await this.stop(record.ownerId, record.view.id);
        }
      }),
    );
    const failures = pendingResults.flatMap((result, index) =>
      result.status === "rejected"
        ? [new Error(`${pending[index]?.sessionId}: ${errorMessage(result.reason)}`)]
        : [],
    );
    failures.push(
      ...results.flatMap((result, index) =>
        result.status === "rejected"
          ? [new Error(`${records[index]?.view.id}: ${errorMessage(result.reason)}`)]
          : [],
      ),
    );
    if (failures.length) {
      throw new AggregateError(
        failures,
        `终端清理失败：${failures.map((error) => error.message).join("；")}`,
      );
    }
  }
}
