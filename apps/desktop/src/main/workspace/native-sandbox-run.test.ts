import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isNativeSandboxCleanupUnconfirmedError,
  type NativeCommandLaunch,
  type NativeCommandScope,
  NativeSandboxCleanupUnconfirmedError,
  NativeSandboxService,
  nativeTaskkillExecutable,
} from "./native-sandbox-service";

const scope: NativeCommandScope = {
  sessionId: "session",
  runId: "run",
  toolCallId: "call",
};

function fakeChild(pid: number | undefined = 123) {
  return Object.assign(new EventEmitter(), {
    pid,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    unref: vi.fn(),
  });
}

function serviceWith(
  child: ReturnType<typeof fakeChild> | ReturnType<typeof fakeChild>[],
  options: {
    terminate?: (pid: number) => Promise<void>;
    terminationTimeoutMs?: number;
    closeTimeoutMs?: number;
    operationWaitTimeoutMs?: number;
  } = {},
) {
  const children = Array.isArray(child) ? child : [child];
  const spawnChild = vi.fn(() => {
    const next = children[spawnChild.mock.calls.length - 1];
    if (!next) throw new Error("Unexpected extra native sandbox spawn.");
    return next;
  });
  const service = new NativeSandboxService("sandbox.exe", "profiles", {
    spawn: spawnChild as unknown as typeof spawn,
    terminate: options.terminate ?? (async () => undefined),
    terminationTimeoutMs: options.terminationTimeoutMs ?? 20,
    closeTimeoutMs: options.closeTimeoutMs ?? 20,
    operationWaitTimeoutMs: options.operationWaitTimeoutMs ?? 50,
  });
  vi.spyOn(service, "prepareCommand").mockResolvedValue({
    executable: "sandbox.exe",
    args: [],
    cwd: "C:\\workspace",
    env: {},
    initialInput: "test\n",
  });
  return { service, spawnChild };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function seedScopedTombstone(service: NativeSandboxService): Promise<void> {
  const pending = service.run("C:\\workspace", "seed", new AbortController().signal, {
    timeoutMs: 5,
    scope,
  });
  const assertion = expect(pending).rejects.toBeInstanceOf(NativeSandboxCleanupUnconfirmedError);
  await vi.advanceTimersByTimeAsync(5);
  await assertion;
  expect(service.hasUnconfirmedCleanup("run")).toBe(true);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("NativeSandboxService process lifecycle", () => {
  it("uses the absolute System32 taskkill path", () => {
    expect(nativeTaskkillExecutable().toLowerCase()).toBe(
      `${(process.env.SystemRoot || "C:\\Windows").toLowerCase()}\\system32\\taskkill.exe`,
    );
  });

  it("resolves a normal child close without invoking taskkill", async () => {
    const child = fakeChild();
    const terminate = vi.fn(async () => undefined);
    const { service } = serviceWith(child, { terminate });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal);
    await flushMicrotasks();
    child.stdout.write("hello\n");
    child.emit("close", 0);

    await expect(pending).resolves.toEqual({ output: "hello", exitCode: 0 });
    expect(terminate).not.toHaveBeenCalled();
  });

  it.each([
    ["cancelRun", (service: NativeSandboxService) => service.cancelRun("run")],
    ["shutdown", (service: NativeSandboxService) => service.shutdown()],
  ])("does not spawn when %s cancels during command preparation", async (_name, cancel) => {
    const child = fakeChild();
    const { service, spawnChild } = serviceWith(child);
    let resolvePreparation!: (launch: NativeCommandLaunch) => void;
    const preparation = new Promise<NativeCommandLaunch>((resolve) => {
      resolvePreparation = resolve;
    });
    vi.mocked(service.prepareCommand).mockReturnValue(preparation);
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      scope,
    });
    await flushMicrotasks();
    expect(service.prepareCommand).toHaveBeenCalledOnce();

    await expect(cancel(service)).resolves.toBeUndefined();
    await expect(pending).rejects.toThrow("Native sandbox operation canceled.");
    expect(spawnChild).not.toHaveBeenCalled();

    resolvePreparation({
      executable: "sandbox.exe",
      args: [],
      cwd: "C:\\workspace",
      env: {},
      initialInput: "test\n",
    });
    await flushMicrotasks();
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it("rejects instead of hanging when taskkill fails and the child never closes", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const { service } = serviceWith(child, {
      terminate: async () => {
        throw new Error("Access denied");
      },
      closeTimeoutMs: 20,
    });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 10,
    });
    const assertion = expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof NativeSandboxCleanupUnconfirmedError &&
        isNativeSandboxCleanupUnconfirmedError(error) &&
        /COMMAND_CLEANUP_UNCONFIRMED:.*Access denied/.test(error.message),
    );
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(child.unref).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a taskkill call that never settles", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const { service } = serviceWith(child, {
      terminate: () => new Promise<void>(() => undefined),
      terminationTimeoutMs: 10,
      closeTimeoutMs: 10,
    });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 5,
    });
    const assertion = expect(pending).rejects.toThrow(/taskkill did not finish within 10 ms/);
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it("rejects when taskkill succeeds but the child close is never confirmed", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const { service } = serviceWith(child, {
      terminate: async () => undefined,
      closeTimeoutMs: 10,
    });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 5,
    });
    const assertion = expect(pending).rejects.toThrow(
      /COMMAND_CLEANUP_UNCONFIRMED:.*did not close within 10 ms/,
    );
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("keeps a failed tree termination unconfirmed even if the root later closes", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const { service } = serviceWith(child, {
      terminate: async () => {
        throw new Error("taskkill rejected");
      },
    });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 5,
    });
    const assertion = expect(pending).rejects.toThrow(
      /COMMAND_CLEANUP_UNCONFIRMED:.*taskkill rejected/,
    );
    await vi.advanceTimersByTimeAsync(5);
    child.emit("close", 1);
    await flushMicrotasks();
    await assertion;
  });

  it("confirms a successful timeout stop only after taskkill and child close", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    let finishTermination!: () => void;
    const terminate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTermination = resolve;
        }),
    );
    const { service } = serviceWith(child, { terminate, closeTimeoutMs: 50 });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 5,
    });
    const assertion = expect(pending).rejects.toThrow(
      "Native sandbox timed out; its process tree was stopped.",
    );
    await vi.advanceTimersByTimeAsync(5);
    finishTermination();
    await flushMicrotasks();
    child.emit("close", 1);
    await assertion;
    expect(terminate).toHaveBeenCalledWith(123);
  });

  it("reports cancellation only after successful tree termination", async () => {
    const child = fakeChild();
    const controller = new AbortController();
    const terminate = vi.fn(async () => {
      queueMicrotask(() => child.emit("close", null));
    });
    const { service } = serviceWith(child, { terminate });
    const pending = service.run("C:\\workspace", "test", controller.signal);
    await flushMicrotasks();
    controller.abort();

    await expect(pending).rejects.toThrow("Native sandbox operation canceled.");
    expect(terminate).toHaveBeenCalledWith(123);
  });

  it("stops an output-producing process and retains bounded captured output", async () => {
    const child = fakeChild();
    let finishTermination!: () => void;
    const terminate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTermination = resolve;
        }),
    );
    const { service } = serviceWith(child, { terminate });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      maxCapture: 4,
    });
    await flushMicrotasks();
    child.stdout.write("too much output");
    await flushMicrotasks();
    child.stdout.write("late output");

    expect(terminate).toHaveBeenCalledWith(123);
    finishTermination();
    queueMicrotask(() => child.emit("close", 1));
    await expect(pending).rejects.toMatchObject({
      message: "Native sandbox output exceeded 2 MiB.",
      capturedOutput: "too ",
    });
    const error = (await pending.catch((cause: unknown) => cause)) as {
      capturedOutput: string;
    };
    expect(error.capturedOutput).toHaveLength(4);
  });

  it("settles spawn errors and ignores a later close event", async () => {
    const child = fakeChild();
    const { service } = serviceWith(child);
    const pending = service.run("C:\\workspace", "test", new AbortController().signal);
    await flushMicrotasks();
    child.emit("error", new Error("spawn failed"));

    await expect(pending).rejects.toThrow("spawn failed");
    expect(() => child.emit("close", 1)).not.toThrow();
  });

  it("records a scoped tombstone and cancelRun refuses to retry an unconfirmed kill", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const terminate = vi.fn(async () => {
      throw new Error("Access denied");
    });
    const { service } = serviceWith(child, { terminate });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 5,
      scope,
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(NativeSandboxCleanupUnconfirmedError);
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
    expect(service.hasUnconfirmedCleanup("run")).toBe(true);

    await expect(service.cancelRun("run")).rejects.toBeInstanceOf(
      NativeSandboxCleanupUnconfirmedError,
    );
    await expect(
      service.run("C:\\workspace", "retry", new AbortController().signal, {
        timeoutMs: 5,
        scope,
      }),
    ).rejects.toBeInstanceOf(NativeSandboxCleanupUnconfirmedError);
    expect(terminate).toHaveBeenCalledOnce();
    expect(service.confirmRunStopped("run")).toBe(1);
    expect(service.hasUnconfirmedCleanup("run")).toBe(false);
  });

  it.each(["read", "read_binary", "list", "exists", "hash"] as const)(
    "allows fixed %s recovery inspection under a same-run tombstone without clearing it",
    async (operation) => {
      vi.useFakeTimers();
      const failed = fakeChild(123);
      const inspection = fakeChild(456);
      const terminate = vi.fn(async () => {
        throw new Error("Access denied");
      });
      const { service, spawnChild } = serviceWith([failed, inspection], { terminate });
      await seedScopedTombstone(service);

      const pending = service.fileOperation(
        "C:\\workspace",
        { operation, path: "file.txt" },
        new AbortController().signal,
        scope,
      );
      await flushMicrotasks();
      expect(spawnChild).toHaveBeenCalledTimes(2);
      inspection.stdout.write('{"ok":true,"value":"inspected"}\n');
      inspection.emit("close", 0);

      await expect(pending).resolves.toBe("inspected");
      expect(service.hasUnconfirmedCleanup("run")).toBe(true);
      expect(service.confirmRunStopped("run")).toBe(1);
    },
  );

  const blockedWriteRequests = [
    { operation: "write", path: "file.txt", content: "blocked" },
    {
      operation: "write_binary",
      path: "file.txt",
      content: Buffer.from("blocked").toString("base64"),
      expectedHash: "missing",
    },
    { operation: "delete", path: "file.txt" },
  ] satisfies Array<Parameters<NativeSandboxService["fileOperation"]>[1]>;
  it.each(blockedWriteRequests)(
    "keeps a same-run tombstone and rejects fixed $operation file operations",
    async (request) => {
      vi.useFakeTimers();
      const failed = fakeChild();
      const terminate = vi.fn(async () => {
        throw new Error("Access denied");
      });
      const { service, spawnChild } = serviceWith(failed, { terminate });
      await seedScopedTombstone(service);

      await expect(
        service.fileOperation("C:\\workspace", request, new AbortController().signal, scope),
      ).rejects.toBeInstanceOf(NativeSandboxCleanupUnconfirmedError);
      expect(spawnChild).toHaveBeenCalledOnce();
      expect(service.hasUnconfirmedCleanup("run")).toBe(true);
      expect(service.confirmRunStopped("run")).toBe(1);
    },
  );

  it("does not let a public readOnly run bypass a same-run tombstone", async () => {
    vi.useFakeTimers();
    const failed = fakeChild();
    const terminate = vi.fn(async () => {
      throw new Error("Access denied");
    });
    const { service, spawnChild } = serviceWith(failed, { terminate });
    await seedScopedTombstone(service);

    await expect(
      service.run("C:\\workspace", "Get-ChildItem", new AbortController().signal, {
        readOnly: true,
        scope,
      }),
    ).rejects.toBeInstanceOf(NativeSandboxCleanupUnconfirmedError);
    expect(spawnChild).toHaveBeenCalledOnce();
    expect(service.hasUnconfirmedCleanup("run")).toBe(true);
    expect(service.confirmRunStopped("run")).toBe(1);
  });

  it("keeps fixed status probes behind a same-run tombstone", async () => {
    vi.useFakeTimers();
    const failed = fakeChild();
    const terminate = vi.fn(async () => {
      throw new Error("Access denied");
    });
    const { service, spawnChild } = serviceWith(failed, { terminate });
    await seedScopedTombstone(service);

    await expect(service.status("C:\\workspace", scope)).rejects.toBeInstanceOf(
      NativeSandboxCleanupUnconfirmedError,
    );
    expect(spawnChild).toHaveBeenCalledOnce();
    expect(service.hasUnconfirmedCleanup("run")).toBe(true);
    expect(service.confirmRunStopped("run")).toBe(1);
  });

  it("appends a new tombstone when recovery inspection cleanup is also unconfirmed", async () => {
    vi.useFakeTimers();
    const failed = fakeChild(123);
    const inspection = fakeChild(456);
    const terminate = vi.fn(async () => {
      throw new Error("Access denied");
    });
    const { service, spawnChild } = serviceWith([failed, inspection], { terminate });
    await seedScopedTombstone(service);
    const controller = new AbortController();
    const pending = service.fileOperation(
      "C:\\workspace",
      { operation: "read", path: "file.txt" },
      controller.signal,
      scope,
    );
    await flushMicrotasks();
    expect(spawnChild).toHaveBeenCalledTimes(2);

    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(NativeSandboxCleanupUnconfirmedError);
    expect(terminate).toHaveBeenCalledTimes(2);
    expect(service.hasUnconfirmedCleanup("run")).toBe(true);
    expect(service.confirmRunStopped("run")).toBe(2);
  });

  it("detaches a tombstoned active operation before confirming cleanup", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const terminate = vi.fn(() => new Promise<void>(() => undefined));
    const { service } = serviceWith(child, {
      terminate,
      terminationTimeoutMs: 30,
      operationWaitTimeoutMs: 5,
    });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 60_000,
      scope,
    });
    await flushMicrotasks();

    const cancel = expect(service.cancelRun("run")).rejects.toBeInstanceOf(
      NativeSandboxCleanupUnconfirmedError,
    );
    await vi.advanceTimersByTimeAsync(5);
    await cancel;
    expect(service.hasUnconfirmedCleanup("run")).toBe(true);

    expect(service.confirmRunStopped("run")).toBe(1);
    expect(service.hasUnconfirmedCleanup("run")).toBe(false);
    await expect(pending).rejects.toThrow("cleanup was confirmed");
    expect(child.listenerCount("close")).toBe(0);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.unref).toHaveBeenCalledOnce();

    await expect(service.cancelRun("run")).resolves.toBeUndefined();
    await expect(service.shutdown()).resolves.toBeUndefined();
    expect(terminate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30);
  });

  it("refuses cleanup confirmation while a non-tombstoned operation is active", async () => {
    const child = fakeChild();
    const { service } = serviceWith(child);
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      scope,
    });
    await flushMicrotasks();

    expect(() => service.confirmRunStopped("run")).toThrow("not eligible for confirmation");
    expect(service.hasUnconfirmedCleanup("run")).toBe(false);

    child.emit("close", 0);
    await expect(pending).resolves.toEqual({ output: "", exitCode: 0 });
  });

  it("cancels an active scoped operation and waits for its confirmed close", async () => {
    const child = fakeChild();
    const terminate = vi.fn(async () => {
      queueMicrotask(() => child.emit("close", null));
    });
    const { service } = serviceWith(child, { terminate });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 60_000,
      scope,
    });
    const assertion = expect(pending).rejects.toThrow("Native sandbox operation canceled.");
    await flushMicrotasks();

    await expect(service.cancelRun("run")).resolves.toBeUndefined();
    await assertion;
    expect(terminate).toHaveBeenCalledWith(123);
    expect(service.hasUnconfirmedCleanup("run")).toBe(false);
  });

  it("shutdown cancels and waits for unscoped active operations", async () => {
    const child = fakeChild();
    const terminate = vi.fn(async () => {
      queueMicrotask(() => child.emit("close", null));
    });
    const { service } = serviceWith(child, { terminate });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 60_000,
    });
    const assertion = expect(pending).rejects.toThrow("Native sandbox operation canceled.");
    await flushMicrotasks();

    await expect(service.shutdown()).resolves.toBeUndefined();
    await assertion;
    expect(terminate).toHaveBeenCalledWith(123);
  });

  it("does not retry a tombstoned operation during shutdown", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const terminate = vi.fn(() => new Promise<void>(() => undefined));
    const { service } = serviceWith(child, {
      terminate,
      terminationTimeoutMs: 30,
      closeTimeoutMs: 30,
      operationWaitTimeoutMs: 5,
    });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 60_000,
      scope,
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(NativeSandboxCleanupUnconfirmedError);
    await flushMicrotasks();

    const cancel = expect(service.cancelRun("run")).rejects.toBeInstanceOf(
      NativeSandboxCleanupUnconfirmedError,
    );
    await vi.advanceTimersByTimeAsync(5);
    await cancel;
    await expect(service.shutdown()).rejects.toBeInstanceOf(NativeSandboxCleanupUnconfirmedError);
    expect(terminate).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(30);
    await assertion;
  });

  it("tracks an unscoped tombstone globally and reports it during shutdown", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const { service } = serviceWith(child, {
      terminate: async () => {
        throw new Error("tree termination failed");
      },
    });
    const pending = service.run("C:\\workspace", "test", new AbortController().signal, {
      timeoutMs: 5,
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(NativeSandboxCleanupUnconfirmedError);
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
    expect(service.hasUnconfirmedCleanup()).toBe(true);
    await expect(service.shutdown()).rejects.toBeInstanceOf(NativeSandboxCleanupUnconfirmedError);
    expect(service.confirmAllCleanupStopped()).toBe(1);
    await expect(service.shutdown()).resolves.toBeUndefined();
  });

  it("forwards scope through fileOperation and status", async () => {
    const child = fakeChild();
    const { service } = serviceWith(child);
    const run = vi
      .spyOn(service, "run")
      .mockResolvedValueOnce({ output: '{"ok":true,"value":"read"}', exitCode: 0 })
      .mockResolvedValueOnce({ output: "MINGSHEN_NATIVE_SANDBOX_OK", exitCode: 0 })
      .mockRejectedValueOnce(
        new NativeSandboxCleanupUnconfirmedError("shutdown", "not confirmed", "output"),
      );

    await expect(
      service.fileOperation(
        "C:\\workspace",
        { operation: "read", path: "file.txt" },
        new AbortController().signal,
        scope,
      ),
    ).resolves.toBe("read");
    await expect(service.status("C:\\workspace", scope)).resolves.toEqual({
      ready: true,
      detail: "MINGSHEN_NATIVE_SANDBOX_OK",
    });
    expect(run.mock.calls[0]?.[3]?.scope).toEqual(scope);
    expect(run.mock.calls[1]?.[3]?.scope).toEqual(scope);
    await expect(service.status("C:\\workspace", scope)).rejects.toBeInstanceOf(
      NativeSandboxCleanupUnconfirmedError,
    );
  });
});
