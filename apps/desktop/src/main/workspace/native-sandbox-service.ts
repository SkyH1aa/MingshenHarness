import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const MAX_CAPTURE = 2 * 1024 * 1024;
const MAX_BINARY_BYTES = 25 * 1024 * 1024;
const MAX_BINARY_BASE64_LENGTH = Math.ceil(MAX_BINARY_BYTES / 3) * 4;
const DEFAULT_TERMINATION_TIMEOUT_MS = 5_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_OPERATION_WAIT_MS = 15_000;
const MAX_TOMBSTONE_OUTPUT = 64_000;
const UNSCOPED_CLEANUP_KEY = "__unscoped__";
const RECOVERY_INSPECTION = Symbol("nativeRecoveryInspection");
export const NATIVE_RUNTIME_VERSION = "0.166.0";
const NATIVE_EXECUTABLE_SHA256 = "9d563ee4e0441ff9d59d612013e0460ddf8e5709735c2d9f6b98b7ef8ca4eb42";

export interface NativeCommandScope {
  sessionId: string;
  runId: string;
  toolCallId: string;
}

export interface NativeCommandOptions {
  stdin?: string;
  timeoutMs?: number;
  readOnly?: boolean;
  cwd?: string;
  maxCapture?: number;
  readOnlyPaths?: string[];
  scope?: NativeCommandScope;
}

type InternalNativeCommandOptions = NativeCommandOptions & {
  [RECOVERY_INSPECTION]?: true;
};

export interface NativeCommandLaunch {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  initialInput: string;
}

interface NativeSandboxDependencies {
  spawn?: typeof spawn;
  terminate?: (pid: number) => Promise<void>;
  terminationTimeoutMs?: number;
  closeTimeoutMs?: number;
  operationWaitTimeoutMs?: number;
}

export interface NativeCleanupTombstone {
  operationId: string;
  scope?: NativeCommandScope;
  reason: string;
  detail: string;
  capturedOutput: string;
  recordedAt: string;
}

interface NativeActiveOperation {
  id: string;
  scope?: NativeCommandScope;
  cancel: () => void;
  confirmStopped: () => void;
  capturedOutput: () => string;
  completion: Promise<void>;
  resolveCompletion: () => void;
}

export class NativeSandboxCleanupUnconfirmedError extends Error {
  readonly code = "NATIVE_SANDBOX_CLEANUP_UNCONFIRMED";
  readonly cleanupUnconfirmed = true;

  constructor(
    readonly reason: string,
    readonly detail: string,
    readonly capturedOutput: string,
  ) {
    super(
      `COMMAND_CLEANUP_UNCONFIRMED: Native sandbox process tree termination could not be confirmed after ${reason}. ${detail} Inspect and stop the sandbox process before allowing more writes.`,
    );
    this.name = "NativeSandboxCleanupUnconfirmedError";
  }
}

export function isNativeSandboxCleanupUnconfirmedError(
  error: unknown,
): error is NativeSandboxCleanupUnconfirmedError {
  if (error instanceof NativeSandboxCleanupUnconfirmedError) return true;
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<NativeSandboxCleanupUnconfirmedError>;
  return (
    candidate.code === "NATIVE_SANDBOX_CLEANUP_UNCONFIRMED" &&
    candidate.cleanupUnconfirmed === true &&
    typeof candidate.reason === "string" &&
    typeof candidate.detail === "string" &&
    typeof candidate.capturedOutput === "string"
  );
}

type FileOperationRequest = {
  operation:
    | "read"
    | "read_binary"
    | "write"
    | "write_binary"
    | "delete"
    | "list"
    | "exists"
    | "hash";
  path: string;
  content?: string;
  expectedHash?: string;
  depth?: number;
  maxEntries?: number;
};

const READ_ONLY_FILE_OPERATIONS = new Set<FileOperationRequest["operation"]>([
  "read",
  "read_binary",
  "list",
  "exists",
  "hash",
]);

function isReadOnlyFileOperation(operation: FileOperationRequest["operation"]): boolean {
  return READ_ONLY_FILE_OPERATIONS.has(operation);
}

function normalizeFileOperationRequest(request: FileOperationRequest): FileOperationRequest {
  if (!request || typeof request.path !== "string" || request.path.length === 0)
    throw new Error("File operation path is required.");
  if (request.operation !== "write_binary" && request.expectedHash !== undefined)
    throw new Error("expectedHash is only valid for write_binary.");
  if (request.operation !== "write_binary") return request;
  if (typeof request.content !== "string") throw new Error("write_binary requires base64 content.");
  if (request.content.length > MAX_BINARY_BASE64_LENGTH)
    throw new Error("Binary content exceeds the 25 MiB limit.");
  if (request.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.content))
    throw new Error("write_binary content must be canonical base64.");
  const bytes = Buffer.from(request.content, "base64");
  if (bytes.length > MAX_BINARY_BYTES) throw new Error("Binary content exceeds the 25 MiB limit.");
  if (bytes.toString("base64") !== request.content)
    throw new Error("write_binary content must be canonical base64.");
  if (
    typeof request.expectedHash !== "string" ||
    !(request.expectedHash === "missing" || /^[0-9a-f]{64}$/i.test(request.expectedHash))
  )
    throw new Error("write_binary requires expectedHash=missing or a SHA-256 hash.");
  return { ...request, expectedHash: request.expectedHash.toLowerCase() };
}

export function nativeSandboxExecutable(): string {
  return resolve(process.cwd(), "resources/native/codex-sandbox.exe");
}
export function nativeSandboxRoot(): string {
  return join(process.env.LOCALAPPDATA || homedir(), "MingshenHarness", "native-sandbox");
}

export function nativeTaskkillExecutable(): string {
  return join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
}

function errorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const output = error as { stdout?: string; stderr?: string };
  return [detail, output.stdout?.trim(), output.stderr?.trim()].filter(Boolean).join("; ");
}

function boundedTombstoneOutput(output: string): string {
  if (output.length <= MAX_TOMBSTONE_OUTPUT) return output;
  return `[${output.length - MAX_TOMBSTONE_OUTPUT} captured characters omitted]\n${output.slice(-MAX_TOMBSTONE_OUTPUT)}`;
}

async function terminateWindowsProcessTree(pid: number): Promise<void> {
  await execute(nativeTaskkillExecutable(), ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    timeout: DEFAULT_TERMINATION_TIMEOUT_MS,
  });
}

function cleanupUnconfirmedError(
  reason: string,
  detail: string,
  capturedOutput: string,
): NativeSandboxCleanupUnconfirmedError {
  return new NativeSandboxCleanupUnconfirmedError(reason, detail, capturedOutput);
}

export function sandboxEnvironment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATH",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "PROGRAMDATA",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS",
  ])
    if (process.env[key]) environment[key] = process.env[key];
  environment.CODEX_HOME = home;
  environment.CODEX_DISABLE_CLOUD_REQUIREMENTS = "1";
  return environment;
}

function normalizeScope(scope: NativeCommandScope | undefined): NativeCommandScope | undefined {
  if (!scope) return undefined;
  for (const key of ["sessionId", "runId", "toolCallId"] as const)
    if (typeof scope[key] !== "string" || !scope[key].trim())
      throw new Error(`Native sandbox scope.${key} is required.`);
  return {
    sessionId: scope.sessionId,
    runId: scope.runId,
    toolCallId: scope.toolCallId,
  };
}

export class NativeSandboxService {
  private readonly profiles = new Map<string, Promise<void>>();
  private readonly activeOperations = new Set<NativeActiveOperation>();
  private readonly cleanupTombstones = new Map<string, NativeCleanupTombstone[]>();
  constructor(
    private readonly executable = nativeSandboxExecutable(),
    private readonly root = nativeSandboxRoot(),
    private readonly dependencies: NativeSandboxDependencies = {},
  ) {}

  hasUnconfirmedCleanup(runId?: string): boolean {
    if (runId !== undefined) return (this.cleanupTombstones.get(runId)?.length ?? 0) > 0;
    return [...this.cleanupTombstones.values()].some((tombstones) => tombstones.length > 0);
  }

  confirmRunStopped(runId: string): number {
    if (!runId.trim()) throw new Error("Native sandbox runId is required.");
    const tombstones = this.cleanupTombstones.get(runId) ?? [];
    const tombstonedIds = new Set(tombstones.map((tombstone) => tombstone.operationId));
    const activeForRun = [...this.activeOperations].filter(
      (operation) => operation.scope?.runId === runId,
    );
    const unconfirmedActive = activeForRun.filter((operation) => !tombstonedIds.has(operation.id));
    if (unconfirmedActive.length)
      throw new Error(
        `Cannot confirm native sandbox cleanup for run ${runId}; it still has active operations that are not eligible for confirmation.`,
      );
    if (!tombstones.length) return 0;
    for (const operation of activeForRun) operation.confirmStopped();
    if (
      [...this.activeOperations].some(
        (operation) => operation.scope?.runId === runId && tombstonedIds.has(operation.id),
      )
    )
      throw new Error(
        `Cannot confirm native sandbox cleanup for run ${runId}; a tombstoned operation is still active.`,
      );
    this.cleanupTombstones.delete(runId);
    return tombstones.length;
  }

  confirmAllCleanupStopped(): number {
    const tombstonedIds = this.tombstonedOperationIds();
    const unconfirmedActive = [...this.activeOperations].filter(
      (operation) => !tombstonedIds.has(operation.id),
    );
    if (unconfirmedActive.length)
      throw new Error(
        "Cannot confirm native sandbox cleanup while active operations are not eligible for confirmation.",
      );
    let count = 0;
    for (const tombstones of this.cleanupTombstones.values()) count += tombstones.length;
    for (const operation of [...this.activeOperations]) {
      if (tombstonedIds.has(operation.id)) operation.confirmStopped();
    }
    if (this.activeOperations.size)
      throw new Error("Cannot confirm native sandbox cleanup while an operation is still active.");
    this.cleanupTombstones.clear();
    return count;
  }

  async cancelRun(runId: string): Promise<void> {
    if (!runId.trim()) throw new Error("Native sandbox runId is required.");
    const tombstonedOperations = this.tombstonedOperationIds();
    const operations = [...this.activeOperations].filter(
      (operation) => operation.scope?.runId === runId && !tombstonedOperations.has(operation.id),
    );
    for (const operation of operations) operation.cancel();
    if (operations.length) await this.waitForOperations(operations, `canceling run ${runId}`);
    const unconfirmed = this.cleanupTombstones.get(runId)?.[0];
    if (unconfirmed) throw this.tombstoneError(unconfirmed);
  }

  async shutdown(): Promise<void> {
    const tombstonedOperations = this.tombstonedOperationIds();
    const operations = [...this.activeOperations].filter(
      (operation) => !tombstonedOperations.has(operation.id),
    );
    for (const operation of operations) operation.cancel();
    if (operations.length) await this.waitForOperations(operations, "shutdown");
    const unconfirmed = [...this.cleanupTombstones.values()].flat()[0];
    if (unconfirmed) throw this.tombstoneError(unconfirmed);
  }

  private tombstoneError(tombstone: NativeCleanupTombstone): NativeSandboxCleanupUnconfirmedError {
    return new NativeSandboxCleanupUnconfirmedError(
      tombstone.reason,
      tombstone.detail,
      tombstone.capturedOutput,
    );
  }

  private tombstonedOperationIds(): Set<string> {
    return new Set(
      [...this.cleanupTombstones.values()].flat().map((tombstone) => tombstone.operationId),
    );
  }

  private recordCleanupTombstone(
    operation: NativeActiveOperation,
    error: NativeSandboxCleanupUnconfirmedError,
  ): void {
    const key = operation.scope?.runId ?? UNSCOPED_CLEANUP_KEY;
    const existing = this.cleanupTombstones.get(key) ?? [];
    if (existing.some((tombstone) => tombstone.operationId === operation.id)) return;
    existing.push({
      operationId: operation.id,
      ...(operation.scope ? { scope: operation.scope } : {}),
      reason: error.reason,
      detail: error.detail,
      capturedOutput: boundedTombstoneOutput(error.capturedOutput),
      recordedAt: new Date().toISOString(),
    });
    this.cleanupTombstones.set(key, existing);
  }

  private async waitForOperations(
    operations: NativeActiveOperation[],
    action: string,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      Promise.all(operations.map((operation) => operation.completion)).then(() => false),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(
          () => resolveTimeout(true),
          this.dependencies.operationWaitTimeoutMs ?? DEFAULT_OPERATION_WAIT_MS,
        );
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!timedOut) return;
    for (const operation of operations) {
      if (!this.activeOperations.has(operation)) continue;
      this.recordCleanupTombstone(
        operation,
        new NativeSandboxCleanupUnconfirmedError(
          action,
          `The native sandbox operation did not settle within ${this.dependencies.operationWaitTimeoutMs ?? DEFAULT_OPERATION_WAIT_MS} ms.`,
          operation.capturedOutput(),
        ),
      );
    }
  }

  private verify(): Promise<void> {
    return (async () => {
      if ((await lstat(this.executable)).isSymbolicLink())
        throw new Error("Linked sandbox executables are not allowed.");
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(this.executable)) hash.update(chunk);
      if (hash.digest("hex") !== NATIVE_EXECUTABLE_SHA256)
        throw new Error("Native sandbox runtime integrity check failed. Execution blocked.");
    })();
  }

  async prepareCommand(
    workspace: string,
    command: string,
    signal: AbortSignal,
    options: NativeCommandOptions = {},
  ): Promise<NativeCommandLaunch> {
    signal.throwIfAborted();
    if (process.platform !== "win32")
      throw new Error("Native Windows sandbox is only available on Windows.");
    await access(this.executable).catch(() => {
      throw new Error(
        "Native sandbox runtime is missing. Execution was blocked; no host fallback.",
      );
    });
    await this.verify();
    const root = resolve(workspace);
    if ((await lstat(root)).isSymbolicLink())
      throw new Error("Linked workspace roots are not allowed.");
    if (
      root.length <= 3 ||
      root.toLowerCase() === (process.env.SystemRoot || "C:\\Windows").toLowerCase()
    )
      throw new Error("A disk root or Windows directory cannot be a protected workspace.");
    const runtimeRelative = relative(root, resolve(this.root));
    if (!runtimeRelative.startsWith("..") && !isAbsolute(runtimeRelative))
      throw new Error(
        "The protected workspace cannot contain application credentials or sandbox configuration.",
      );
    const cwd = resolve(options.cwd || root);
    const local = relative(root, cwd);
    if (isAbsolute(local) || local === ".." || local.startsWith("..\\"))
      throw new Error("Sandbox working directory must be inside the workspace.");
    const protectedPaths = [...new Set((options.readOnlyPaths ?? []).map((path) => resolve(path)))]
      .sort()
      .map((target) => {
        const local = relative(root, target);
        if (!local || isAbsolute(local) || local === ".." || local.startsWith(`..\\`))
          throw new Error("Protected memory must be inside the workspace.");
        return target;
      });
    const home = join(
      this.root,
      createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 20),
      options.readOnly
        ? "read"
        : protectedPaths.length
          ? `write-protected-${createHash("sha256").update(JSON.stringify(protectedPaths)).digest("hex").slice(0, 20)}`
          : "write",
    );
    let prepared = this.profiles.get(home);
    if (!prepared) {
      prepared = (async () => {
        await mkdir(home, { recursive: true });
        const tomlKey = JSON.stringify(root.replaceAll("\\", "/"));
        const executableKey = JSON.stringify(resolve(this.executable).replaceAll("\\", "/"));
        const protectedRules = protectedPaths
          .map((target) => `${JSON.stringify(target.replaceAll("\\", "/"))} = "read"\n`)
          .join("");
        await writeFile(
          join(home, "config.toml"),
          `default_permissions = "mingshen"\n[windows]\nsandbox = "mxc"\n[permissions.mingshen.filesystem]\n":minimal" = "read"\n${tomlKey} = "${options.readOnly ? "read" : "write"}"\n${protectedRules}${executableKey} = "deny"\n[permissions.mingshen.network]\nenabled = false\n`,
          "utf8",
        );
      })().catch((cause) => {
        this.profiles.delete(home);
        throw cause;
      });
      this.profiles.set(home, prepared);
    }
    await prepared;
    const powershell = join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const bootstrap =
      "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;$ErrorActionPreference='Stop';$global:LASTEXITCODE=0;$source=[Console]::In.ReadLine()|ConvertFrom-Json;& ([ScriptBlock]::Create([string]$source));if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}";
    const args = [
      "-c",
      'windows.sandbox="mxc"',
      "sandbox",
      "-P",
      "mingshen",
      "-C",
      cwd,
      "--",
      powershell,
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-OutputFormat",
      "Text",
      "-EncodedCommand",
      Buffer.from(bootstrap, "utf16le").toString("base64"),
    ];
    signal.throwIfAborted();
    return {
      executable: this.executable,
      args,
      cwd: root,
      env: sandboxEnvironment(home),
      initialInput: `${JSON.stringify(command)}\n`,
    };
  }

  async run(
    workspace: string,
    command: string,
    signal: AbortSignal,
    options: NativeCommandOptions = {},
  ): Promise<{ output: string; exitCode: number | null }> {
    const scope = normalizeScope(options.scope);
    const existing = scope ? this.cleanupTombstones.get(scope.runId)?.[0] : undefined;
    const recoveryInspection =
      (options as InternalNativeCommandOptions)[RECOVERY_INSPECTION] === true &&
      options.readOnly === true;
    if (existing && !recoveryInspection) throw this.tombstoneError(existing);

    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolveDone) => {
      resolveCompletion = resolveDone;
    });
    let capturedOutput = () => "";
    let cancelOperation: () => void = () => undefined;
    let confirmOperation: () => void = () => undefined;
    const operation: NativeActiveOperation = {
      id: randomUUID(),
      ...(scope ? { scope } : {}),
      cancel: () => cancelOperation(),
      confirmStopped: () => confirmOperation(),
      capturedOutput: () => capturedOutput(),
      completion,
      resolveCompletion,
    };
    this.activeOperations.add(operation);

    let operationFinished = false;
    const finishOperation = (unconfirmed = false, error?: NativeSandboxCleanupUnconfirmedError) => {
      if (operationFinished) return;
      operationFinished = true;
      if (unconfirmed && error) this.recordCleanupTombstone(operation, error);
      this.activeOperations.delete(operation);
      operation.resolveCompletion();
    };

    let preparationFinished = false;
    let preparationCanceled = false;
    let resolvePreparationCanceled!: () => void;
    const preparationCanceledPromise = new Promise<void>((resolveDone) => {
      resolvePreparationCanceled = resolveDone;
    });
    const cancelDuringPreparation = () => {
      if (preparationFinished) return;
      preparationCanceled = true;
      resolvePreparationCanceled();
      finishOperation();
    };
    cancelOperation = cancelDuringPreparation;
    confirmOperation = cancelDuringPreparation;
    const abortDuringPreparation = () => cancelDuringPreparation();
    signal.addEventListener("abort", abortDuringPreparation, { once: true });
    if (signal.aborted) cancelDuringPreparation();

    let launch: NativeCommandLaunch;
    try {
      const prepared = await Promise.race([
        this.prepareCommand(workspace, command, signal, options),
        preparationCanceledPromise.then(() => null),
      ]);
      preparationFinished = true;
      signal.removeEventListener("abort", abortDuringPreparation);
      if (!prepared || preparationCanceled || signal.aborted) {
        finishOperation();
        throw Object.assign(new Error("Native sandbox operation canceled."), {
          capturedOutput: capturedOutput(),
        });
      }
      launch = prepared;
    } catch (cause) {
      preparationFinished = true;
      signal.removeEventListener("abort", abortDuringPreparation);
      finishOperation();
      if (preparationCanceled || signal.aborted)
        throw Object.assign(new Error("Native sandbox operation canceled."), {
          capturedOutput: capturedOutput(),
        });
      throw cause;
    }

    return await new Promise((resolveRun, reject) => {
      const child = (this.dependencies.spawn ?? spawn)(launch.executable, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let captured = "";
      let settled = false;
      let closed = false;
      let closeCode: number | null = null;
      let stopReason = "";
      let resolveClosed!: () => void;
      const closedPromise = new Promise<void>((resolveDone) => {
        resolveClosed = resolveDone;
      });
      capturedOutput = () => captured;
      const requestedMaxCapture = options.maxCapture ?? MAX_CAPTURE;
      const maxCapture = Number.isFinite(requestedMaxCapture)
        ? Math.max(0, Math.floor(requestedMaxCapture))
        : MAX_CAPTURE;
      const onStdout = (chunk: string) => collect(chunk);
      const onStderr = (chunk: string) => collect(chunk);
      const onStdinError = () => undefined;
      const abort = () => requestStop("cancellation");
      let runTimer: ReturnType<typeof setTimeout> | undefined;
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      let terminationTimer: ReturnType<typeof setTimeout> | undefined;

      const releaseRunResources = (unconfirmed: boolean) => {
        if (runTimer) clearTimeout(runTimer);
        if (closeTimer) clearTimeout(closeTimer);
        if (terminationTimer) clearTimeout(terminationTimer);
        signal.removeEventListener("abort", abort);
        child.stdout?.off("data", onStdout);
        child.stderr?.off("data", onStderr);
        child.stdin?.off("error", onStdinError);
        child.off("error", onError);
        child.off("close", onClose);
        if (unconfirmed) {
          child.stdin?.destroy();
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
        }
      };
      const resolveOnce = (value: { output: string; exitCode: number | null }) => {
        if (settled) return;
        settled = true;
        releaseRunResources(false);
        finishOperation(false);
        resolveRun(value);
      };
      const rejectOnce = (error: Error, unconfirmed = false) => {
        if (settled) return;
        settled = true;
        const cleanupError = unconfirmed
          ? isNativeSandboxCleanupUnconfirmedError(error)
            ? error
            : new NativeSandboxCleanupUnconfirmedError(
                reasonLabel(stopReason),
                errorDetail(error),
                capturedOutput(),
              )
          : undefined;
        releaseRunResources(unconfirmed);
        finishOperation(unconfirmed, cleanupError);
        reject(cleanupError ?? error);
      };
      const confirmStopped = () => {
        if (settled) return;
        settled = true;
        releaseRunResources(true);
        finishOperation();
        reject(
          Object.assign(
            new Error("Native sandbox operation stopped after cleanup was confirmed."),
            {
              capturedOutput: capturedOutput(),
            },
          ),
        );
      };
      confirmOperation = confirmStopped;
      const reasonLabel = (reason: string) =>
        reason === "timeout"
          ? `the ${options.timeoutMs || 120_000} ms timeout`
          : reason === "output_limit"
            ? "the output limit"
            : "cancellation";
      const settleStopped = (terminationFailure: unknown) => {
        const reason = reasonLabel(stopReason);
        if (terminationFailure) {
          rejectOnce(
            cleanupUnconfirmedError(
              reason,
              `taskkill did not complete successfully: ${errorDetail(terminationFailure)}`,
              capturedOutput(),
            ),
            true,
          );
          return;
        }
        if (!closed) {
          rejectOnce(
            cleanupUnconfirmedError(
              reason,
              `The root process did not close within ${this.dependencies.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS} ms after taskkill completed.`,
              capturedOutput(),
            ),
            true,
          );
          return;
        }
        if (stopReason === "cancellation") {
          rejectOnce(
            Object.assign(new Error("Native sandbox operation canceled."), {
              capturedOutput: capturedOutput(),
            }),
          );
          return;
        }
        rejectOnce(
          Object.assign(
            new Error(
              stopReason === "timeout"
                ? "Native sandbox timed out; its process tree was stopped."
                : "Native sandbox output exceeded 2 MiB.",
            ),
            { capturedOutput: capturedOutput() },
          ),
        );
      };
      const stopProcessTree = async () => {
        if (settled) return;
        const pid = child.pid;
        if (!pid) {
          settleStopped(new Error("The spawned process did not expose a process ID."));
          return;
        }
        const termination = Promise.resolve()
          .then(() => (this.dependencies.terminate ?? terminateWindowsProcessTree)(pid))
          .then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error }),
          );
        const outcome = await Promise.race([
          termination,
          new Promise<{ ok: false; error: Error }>((resolveTimeout) => {
            terminationTimer = setTimeout(
              () =>
                resolveTimeout({
                  ok: false,
                  error: new Error(
                    `taskkill did not finish within ${this.dependencies.terminationTimeoutMs ?? DEFAULT_TERMINATION_TIMEOUT_MS} ms.`,
                  ),
                }),
              this.dependencies.terminationTimeoutMs ?? DEFAULT_TERMINATION_TIMEOUT_MS,
            );
          }),
        ]);
        if (terminationTimer) clearTimeout(terminationTimer);
        if (settled) return;
        if (!outcome.ok) {
          settleStopped(outcome.error);
          return;
        }
        if (!closed) {
          await Promise.race([
            closedPromise,
            new Promise<void>((resolveTimeout) => {
              closeTimer = setTimeout(
                resolveTimeout,
                this.dependencies.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
              );
            }),
          ]);
        }
        if (settled) return;
        settleStopped(undefined);
      };
      const requestStop = (reason: string) => {
        if (settled || stopReason) return;
        stopReason = reason;
        void stopProcessTree().catch((error) =>
          rejectOnce(error instanceof Error ? error : new Error(String(error)), true),
        );
      };
      cancelOperation = () => requestStop("cancellation");
      function collect(chunk: string) {
        if (settled || stopReason) return;
        const remaining = Math.max(0, maxCapture - captured.length);
        if (remaining > 0) captured += chunk.slice(0, remaining);
        if (chunk.length > remaining) requestStop("output_limit");
      }
      const onClose = (code: number | null) => {
        closed = true;
        closeCode = code;
        resolveClosed();
        if (!stopReason && !settled)
          resolveOnce({
            output: captured.trim(),
            exitCode: closeCode,
          });
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.stdin.on("error", onStdinError);
      const onError = (cause: Error) => {
        if (settled) return;
        rejectOnce(cause);
      };
      child.once("error", onError);
      child.once("close", onClose);
      runTimer = setTimeout(() => requestStop("timeout"), options.timeoutMs || 120_000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      child.stdin.end(`${launch.initialInput}${options.stdin || ""}`);
    });
  }

  async status(
    workspace: string,
    scope?: NativeCommandScope,
  ): Promise<{ ready: boolean; detail: string }> {
    try {
      const result = await this.run(
        workspace,
        "'MINGSHEN_NATIVE_SANDBOX_OK'",
        AbortSignal.timeout(20_000),
        { readOnly: true, timeoutMs: 15_000, ...(scope ? { scope } : {}) },
      );
      return {
        ready: result.exitCode === 0 && result.output.includes("MINGSHEN_NATIVE_SANDBOX_OK"),
        detail: result.output,
      };
    } catch (cause) {
      if (isNativeSandboxCleanupUnconfirmedError(cause)) throw cause;
      return { ready: false, detail: String(cause) };
    }
  }

  async fileOperation(
    workspace: string,
    request: FileOperationRequest,
    signal: AbortSignal,
    scope?: NativeCommandScope,
  ): Promise<unknown> {
    const normalizedRequest = normalizeFileOperationRequest(request);
    const readOnly = isReadOnlyFileOperation(normalizedRequest.operation);
    const script = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
  $r=[Console]::In.ReadToEnd() | ConvertFrom-Json
  $root=[IO.Path]::GetFullPath($r.root).TrimEnd('\\')
  $path=[IO.Path]::GetFullPath([IO.Path]::Combine($root,$r.path))
  if($path -ne $root -and -not $path.StartsWith($root+'\\',[StringComparison]::OrdinalIgnoreCase)){throw 'Path outside workspace'}
  $cursor=$path
  while($cursor -and $cursor.Length -ge $root.Length){
    if(Test-Path -LiteralPath $cursor){
      $item=Get-Item -LiteralPath $cursor -Force
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse points are not allowed'}
    }
    $cursor=[IO.Path]::GetDirectoryName($cursor)
  }
  $value=$null
  switch($r.operation){
    'exists' {$value=[IO.File]::Exists($path) -or [IO.Directory]::Exists($path)}
    'read' {if(-not [IO.File]::Exists($path)){throw 'FILE_NOT_FOUND'};if((Get-Item -LiteralPath $path).Length -gt 2000000){throw 'Text file too large'};$value=[IO.File]::ReadAllText($path)}
    'read_binary' {if(-not [IO.File]::Exists($path)){throw 'FILE_NOT_FOUND'};if((Get-Item -LiteralPath $path).Length -gt 26214400){throw 'Document too large'};$value=[Convert]::ToBase64String([IO.File]::ReadAllBytes($path))}
    'write' {[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))|Out-Null;[IO.File]::WriteAllText($path,[string]$r.content,[Text.UTF8Encoding]::new($false))}
    'write_binary' {
      if($null -eq $r.content -or $r.content -isnot [string]){throw 'Binary content is required'}
      if($r.content.Length -gt 34952536){throw 'Binary content too large'}
      try{$bytes=[Convert]::FromBase64String([string]$r.content)}catch{throw 'Invalid base64 content'}
      if($bytes.Length -gt 26214400){throw 'Binary content too large'}
      if([Convert]::ToBase64String($bytes) -cne [string]$r.content){throw 'Invalid base64 content'}
      $expected=[string]$r.expectedHash
      if($expected -ne 'missing' -and $expected -notmatch '^[0-9a-fA-F]{64}$'){throw 'Expected SHA-256 hash is required'}
      if([IO.Directory]::Exists($path)){throw 'Target is not a regular file'}
      $exists=[IO.File]::Exists($path)
      if($expected -eq 'missing' -and $exists){throw 'Target changed before binary write'}
      if($expected -ne 'missing' -and -not $exists){throw 'Target is missing before binary write'}
      if($exists){
        $current=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if($current -cne $expected.ToLowerInvariant()){throw 'Target changed before binary write'}
      }
      $parent=[IO.Path]::GetDirectoryName($path)
      if($parent -and -not [IO.Directory]::Exists($parent)){[IO.Directory]::CreateDirectory($parent)|Out-Null}
      $temp=[IO.Path]::Combine($parent,'.mingshen-write-'+[IO.Path]::GetRandomFileName()+'.tmp')
      try{
        [IO.File]::WriteAllBytes($temp,$bytes)
        if([IO.File]::Exists($path)){
          if($expected -eq 'missing'){throw 'Target changed before binary write'}
          $current=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
          if($current -cne $expected.ToLowerInvariant()){throw 'Target changed before binary write'}
          [IO.File]::Replace($temp,$path,$null)
        }else{
          if($expected -ne 'missing'){throw 'Target changed before binary write'}
          [IO.File]::Move($temp,$path)
        }
      }finally{
        if([IO.File]::Exists($temp)){Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
      }
    }
    'hash' {
      if([IO.Directory]::Exists($path)){throw 'Target is not a regular file'}
      if(-not [IO.File]::Exists($path)){$value='missing'}
      else{
        if((Get-Item -LiteralPath $path).Length -gt 26214400){throw 'Binary file too large'}
        $value=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    }
    'delete' {if(-not [IO.File]::Exists($path)){throw 'FILE_NOT_FOUND'};[IO.File]::Delete($path)}
    'list' {
      $items=New-Object 'Collections.Generic.List[object]'
      $q=New-Object 'Collections.Generic.Queue[object]'
      $q.Enqueue(@{path=$path;depth=0})
      $limit=if($r.maxEntries){[Math]::Min(25000,[Math]::Max(1,$r.maxEntries))}else{2000}
      while($q.Count -gt 0 -and $items.Count -lt $limit){
        $current=$q.Dequeue()
        foreach($item in Get-ChildItem -LiteralPath $current.path -Force){
          if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Name -in @('.git','node_modules','dist','out','.next','.turbo','.cache','release')){continue}
          $items.Add(@{path=$item.FullName.Substring($root.Length+1).Replace('\\','/');directory=$item.PSIsContainer;fingerprint=([string]$item.Length+':'+$item.LastWriteTimeUtc.Ticks+':'+$item.CreationTimeUtc.Ticks)})
          if($items.Count -ge $limit){break}
          if($item.PSIsContainer -and $current.depth+1 -lt [Math]::Min(64,[Math]::Max(1,$r.depth))){$q.Enqueue(@{path=$item.FullName;depth=$current.depth+1})}
        }
      }
      $value=@($items.ToArray())
    }
    default {throw 'Unsupported operation'}
  }
  @{ok=$true;value=$value}|ConvertTo-Json -Depth 12 -Compress
} catch {@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress;exit 1}`;
    const runOptions: InternalNativeCommandOptions = {
      stdin: JSON.stringify({ ...normalizedRequest, root: resolve(workspace) }),
      ...(scope ? { scope } : {}),
      readOnly,
      maxCapture:
        normalizedRequest.operation === "read_binary" ? 36 * 1024 * 1024 : 14 * 1024 * 1024,
      ...(readOnly ? { [RECOVERY_INSPECTION]: true as const } : {}),
    };
    const result = await this.run(workspace, script, signal, runOptions);
    try {
      const line = result.output.split(/\r?\n/).find((value) => value.startsWith('{"'));
      const parsed = JSON.parse(line || "") as { ok: boolean; value: unknown; error: string };
      if (!parsed.ok) throw new Error(parsed.error);
      if (result.exitCode !== 0) throw new Error(result.output);
      return parsed.value;
    } catch (cause) {
      throw new Error(`Native file operation failed: ${result.output || String(cause)}`);
    }
  }
}
