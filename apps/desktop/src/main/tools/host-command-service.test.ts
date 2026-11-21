import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { HostCommandCleanupUnconfirmedError, HostCommandService } from "./host-command-service";

function fakeChild(pid: number | undefined = 4321): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    unref: vi.fn(),
  }) as unknown as ChildProcess;
}

function launch(signal: AbortSignal, timeoutMs = 1_000) {
  return {
    sessionId: "session",
    runId: "run",
    toolCallId: "call",
    executable: "powershell.exe",
    args: ["-Command", "Write-Output hello"],
    cwd: process.cwd(),
    signal,
    timeoutMs,
  };
}

describe("HostCommandService", () => {
  it("keeps the normal command exit semantics when the process closes", async () => {
    const child = fakeChild();
    const stdout = new PassThrough();
    Object.defineProperty(child, "stdout", { value: stdout });
    const spawn = vi.fn(() => {
      queueMicrotask(() => {
        stdout.write("hello");
        setImmediate(() => child.emit("close", 0));
      });
      return child;
    });
    const service = new HostCommandService({ spawn });

    const result = await service.run(launch(new AbortController().signal));

    expect(result).toEqual({
      output: "exit_code: 0\nhello",
      capturedOutput: "hello",
      isError: false,
    });
    expect(service.hasRunningCommands("run")).toBe(false);
  });

  it("settles an aborted command after confirmed process close", async () => {
    const child = fakeChild();
    const stdout = new PassThrough();
    Object.defineProperty(child, "stdout", { value: stdout });
    const controller = new AbortController();
    const terminate = vi.fn(async () => {
      stdout.write("partial output");
      queueMicrotask(() => child.emit("close", 1));
    });
    const service = new HostCommandService({
      spawn: vi.fn(() => child),
      terminate,
    });

    const pending = service.run(launch(controller.signal));
    controller.abort();
    const result = await pending;

    expect(terminate).toHaveBeenCalledWith(child);
    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain("命令已取消");
    expect(result.capturedOutput).toBe("partial output");
    expect(result.cleanupUnconfirmed).toBeUndefined();
    expect(service.hasRunningCommands("run")).toBe(false);
  });

  it("returns a bounded unconfirmed result when taskkill fails", async () => {
    const child = fakeChild();
    const stdout = new PassThrough();
    Object.defineProperty(child, "stdout", { value: stdout });
    const service = new HostCommandService({
      spawn: vi.fn(() => child),
      terminate: vi.fn(async () => {
        stdout.write("partial output");
        throw new Error("Access is denied.");
      }),
    });

    const result = await service.run(launch(new AbortController().signal, 1));

    expect(result).toMatchObject({ isError: true, cleanupUnconfirmed: true });
    expect(result.output).toContain("COMMAND_CLEANUP_UNCONFIRMED");
    expect(result.output).toContain("Access is denied.");
    expect(result.capturedOutput).toBe("partial output");
    expect(service.hasRunningCommands("run")).toBe(true);
    expect(service.hasUnconfirmedCleanup("run")).toBe(true);
    await expect(service.cancelRun("run")).rejects.toBeInstanceOf(
      HostCommandCleanupUnconfirmedError,
    );
    expect(service.confirmRunStopped("run")).toBe(1);
    expect(service.hasUnconfirmedCleanup("run")).toBe(false);
  });

  it("does not wait forever when taskkill succeeds but close never arrives", async () => {
    const child = fakeChild();
    const service = new HostCommandService({
      spawn: vi.fn(() => child),
      terminate: vi.fn(async () => undefined),
      closeTimeoutMs: 5,
    });

    const result = await service.run(launch(new AbortController().signal, 1));

    expect(result).toMatchObject({ isError: true, cleanupUnconfirmed: true });
    expect(result.output).toContain("CLOSE_ERROR");
    service.confirmRunStopped("run");
  });

  it("accepts a late close after a successful termination attempt", async () => {
    const child = fakeChild();
    const service = new HostCommandService({
      spawn: vi.fn(() => child),
      terminate: vi.fn(async () => {
        setTimeout(() => child.emit("close", 1), 5);
      }),
      closeTimeoutMs: 50,
    });

    const result = await service.run(launch(new AbortController().signal, 1));

    expect(result).toMatchObject({ isError: true });
    expect(result.cleanupUnconfirmed).toBeUndefined();
    expect(service.hasRunningCommands("run")).toBe(false);
  });

  it("keeps termination failure unconfirmed even if the parent closes later", async () => {
    const child = fakeChild();
    const service = new HostCommandService({
      spawn: vi.fn(() => child),
      terminate: vi.fn(async () => {
        setTimeout(() => child.emit("close", 1), 5);
        throw new Error("taskkill could not target the process tree");
      }),
    });

    const result = await service.run(launch(new AbortController().signal, 1));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result).toMatchObject({ isError: true, cleanupUnconfirmed: true });
    expect(service.hasUnconfirmedCleanup("run")).toBe(true);
    expect(service.confirmRunStopped("run")).toBe(1);
  });

  it("blocks another host command in the same run until cleanup is confirmed", async () => {
    const firstChild = fakeChild();
    const firstController = new AbortController();
    let spawnCount = 0;
    const service = new HostCommandService({
      spawn: vi.fn(() => {
        spawnCount++;
        if (spawnCount > 1) {
          const recovered = fakeChild();
          const stdout = new PassThrough();
          Object.defineProperty(recovered, "stdout", { value: stdout });
          queueMicrotask(() => {
            stdout.write("recovered");
            setImmediate(() => recovered.emit("close", 0));
          });
          return recovered;
        }
        queueMicrotask(() => firstController.abort());
        return firstChild;
      }),
      terminate: vi.fn(async () => {
        throw new Error("Access is denied.");
      }),
    });

    const first = await service.run(launch(firstController.signal));
    expect(first.cleanupUnconfirmed).toBe(true);
    await expect(service.run(launch(new AbortController().signal))).rejects.toThrow(
      "Access is denied.",
    );

    service.confirmRunStopped("run");
    const recovered = await service.run(launch(new AbortController().signal));
    expect(recovered).toEqual({
      output: "exit_code: 0\nrecovered",
      capturedOutput: "recovered",
      isError: false,
    });
  });

  it.each([
    ["80K", 80_001],
    ["256K", 256_001],
    ["4M", 4_000_001],
  ])("returns the recoverable capture above %s", async (_label, size) => {
    const child = fakeChild();
    const stdout = new PassThrough();
    Object.defineProperty(child, "stdout", { value: stdout });
    const output = `H${"x".repeat(size - 2)}L`;
    const service = new HostCommandService({
      spawn: vi.fn(() => {
        queueMicrotask(() => {
          stdout.write(output);
          setImmediate(() => child.emit("close", 0));
        });
        return child;
      }),
    });

    const result = await service.run(launch(new AbortController().signal));

    expect(result.capturedOutput.startsWith("H")).toBe(true);
    expect(result.capturedOutput.endsWith("L")).toBe(true);
    if (size > 4_000_000) {
      expect(result.capturedOutput).toContain("OUTPUT_CAPTURE_LIMIT");
      expect(result.capturedOutput.length).toBeLessThan(4_000_200);
    } else {
      expect(result.capturedOutput).toBe(output);
    }
  });

  it("fails a spawn error without a pid directly", async () => {
    const child = fakeChild(0);
    const terminate = vi.fn(async () => undefined);
    const service = new HostCommandService({
      spawn: vi.fn(() => {
        queueMicrotask(() => child.emit("error", new Error("spawn ENOENT")));
        return child;
      }),
      terminate,
    });

    const result = await service.run(launch(new AbortController().signal));

    expect(result).toEqual({
      output: "spawn ENOENT",
      capturedOutput: "",
      isError: true,
    });
    expect(terminate).not.toHaveBeenCalled();
    expect(service.hasRunningCommands("run")).toBe(false);
  });

  it("keeps an error after spawn unconfirmed when termination fails", async () => {
    const child = fakeChild();
    const stdout = new PassThrough();
    Object.defineProperty(child, "stdout", { value: stdout });
    const terminate = vi.fn(async () => {
      throw new Error("process tree termination failed");
    });
    const service = new HostCommandService({
      spawn: vi.fn(() => {
        queueMicrotask(() => {
          stdout.write("partial");
          child.emit("error", new Error("pipe broke after spawn"));
        });
        return child;
      }),
      terminate,
      closeTimeoutMs: 50,
    });

    const result = await service.run(launch(new AbortController().signal));
    expect(terminate).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ isError: true, cleanupUnconfirmed: true });
    expect(result.output).toContain("pipe broke after spawn");
    expect(result.output).toContain("process tree termination failed");
    expect(result.capturedOutput).toBe("partial");
    expect(service.hasRunningCommands("run")).toBe(true);

    child.emit("close", 1);
    await Promise.resolve();
    expect(service.hasUnconfirmedCleanup("run")).toBe(true);
    expect(service.confirmRunStopped("run")).toBe(1);
  });

  it("does not settle early when an error arrives during an existing stop", async () => {
    const child = fakeChild();
    const controller = new AbortController();
    let finishTermination!: () => void;
    const terminate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTermination = resolve;
        }),
    );
    const service = new HostCommandService({
      spawn: vi.fn(() => child),
      terminate,
      closeTimeoutMs: 50,
    });

    let settled = false;
    const pending = service.run(launch(controller.signal)).then((result) => {
      settled = true;
      return result;
    });
    controller.abort();
    child.emit("error", new Error("stream failed while stopping"));
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(service.hasRunningCommands("run")).toBe(true);

    finishTermination();
    await Promise.resolve();
    child.emit("close", 1);
    const result = await pending;

    expect(result.output).toContain("stream failed while stopping");
    expect(result.cleanupUnconfirmed).toBeUndefined();
  });
});
