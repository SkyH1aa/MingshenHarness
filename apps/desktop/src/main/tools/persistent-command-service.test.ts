import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CommandSnapshot, PersistentCommandService } from "./persistent-command-service";

const services: PersistentCommandService[] = [];
const owner = { sessionId: "session", runId: "run" };

function fixture() {
  const service = new PersistentCommandService();
  services.push(service);
  return service;
}

function nodeLaunch(source: string) {
  return { executable: process.execPath, args: ["-e", source], cwd: tmpdir() };
}

async function untilComplete(
  service: PersistentCommandService,
  snapshot: CommandSnapshot,
  commandOwner = owner,
): Promise<CommandSnapshot> {
  let current = snapshot;
  for (let attempt = 0; current.running && attempt < 10; attempt++)
    current = await service.interact(current.id, commandOwner, {
      yieldMs: 500,
      maxOutputChars: 20_000,
    });
  expect(current.running).toBe(false);
  return current;
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.shutdown().catch(() => undefined);
});

describe("persistent command sessions", () => {
  it("returns early, accepts stdin, retains completed output and prevents cross-run access", async () => {
    const service = fixture();
    const snapshot = await service.start(
      owner,
      { command: "echo fixture", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch(
        `process.stdout.write('ready\\n');process.stdin.setEncoding('utf8');process.stdin.once('data', text=>{process.stdout.write('answer:'+text);process.stdin.destroy();});`,
      ),
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 1000,
        maxOutputChars: 2000,
      },
    );
    expect(snapshot.running).toBe(true);
    expect(snapshot.output).toContain("ready");
    expect(snapshot.output).toContain("not a PTY");
    expect(() => service.inspect(snapshot.id, { ...owner, runId: "other" })).toThrow(
      "COMMAND_SESSION_NOT_FOUND",
    );
    await expect(
      service.interact(
        snapshot.id,
        { ...owner, sessionId: "other" },
        {
          chars: "blocked",
          yieldMs: 0,
          maxOutputChars: 2000,
        },
      ),
    ).rejects.toThrow("COMMAND_SESSION_NOT_FOUND");
    const next = await service.interact(snapshot.id, owner, {
      chars: "hello\n",
      yieldMs: 1000,
      maxOutputChars: 2000,
    });
    const completed = await untilComplete(service, next);
    expect([next.output, completed.output].join("\n")).toContain("answer:hello");
    expect(next.output).not.toContain("ready");
    expect(completed.exitCode).toBe(0);
    expect(service.inspect(snapshot.id, owner)).toMatchObject({ running: false, exitCode: 0 });
    const last = await service.interact(snapshot.id, owner, { yieldMs: 0, maxOutputChars: 2000 });
    expect(last.output).not.toContain("answer:hello");
    expect(last.output).toContain("(no new output)");
  });

  it("bounds retained output, reports lost output and permits paging the remainder", async () => {
    const service = fixture();
    const first = await service.start(
      owner,
      { command: "verbose", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch(`process.stdout.write('x'.repeat(400000),()=>process.exit(7));`),
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 3000,
        maxOutputChars: 1000,
      },
    );
    expect(first.running).toBe(false);
    expect(first.output).toContain("older output characters omitted");
    expect(first.output).toContain("unread output characters remain");
    expect(first.output.length).toBeLessThan(2000);
    expect(first.isError).toBe(true);
    expect(first.exitCode).toBe(7);
    const next = await service.interact(first.id, owner, { yieldMs: 0, maxOutputChars: 1000 });
    expect(next.output).not.toContain("older output characters omitted");
    expect(next.output).toContain("x".repeat(1000));
  });

  it("keeps Unicode pairs intact in both the retained buffer and paged output", async () => {
    const service = fixture();
    const first = await service.start(
      owner,
      { command: "unicode output", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch(
        `process.stdout.write('x'+'\\uD83D\\uDE80'.repeat(140000)+'y',()=>process.exit(0));`,
      ),
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 3000,
        maxOutputChars: 101,
      },
    );
    expect(first.running).toBe(false);
    expect(first.output).toContain("older output characters omitted");
    expect(Buffer.from(first.output).toString("utf8")).toBe(first.output);
    const next = await service.interact(first.id, owner, {
      yieldMs: 0,
      maxOutputChars: 101,
    });
    expect(Buffer.from(next.output).toString("utf8")).toBe(next.output);
    expect(next.output).toContain("\uD83D\uDE80".repeat(50));
  });

  it("reports unread tail output after the process has already completed", async () => {
    const service = fixture();
    const first = await service.start(
      owner,
      { command: "tail diagnostic", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch(`process.stdout.write('x'.repeat(7000)+'LAST_PAGE_DIAGNOSTIC');`),
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 3000,
        maxOutputChars: 500,
      },
    );
    expect(first.running).toBe(false);
    expect(first.output).not.toContain("LAST_PAGE_DIAGNOSTIC");
    expect(first.unreadOutputChars).toBeGreaterThan(0);
    expect(service.inspect(first.id, owner).unreadOutputChars).toBe(first.unreadOutputChars);
    let last = first;
    const output = [first.output];
    for (let page = 0; (last.unreadOutputChars ?? 0) > 0 && page < 20; page++) {
      last = await service.interact(first.id, owner, {
        yieldMs: 0,
        maxOutputChars: 500,
      });
      expect(last.running).toBe(false);
      output.push(last.output);
    }
    expect(last.unreadOutputChars).toBe(0);
    expect(service.inspect(first.id, owner).unreadOutputChars).toBe(0);
    expect(output.join("\n")).toContain("LAST_PAGE_DIAGNOSTIC");
  });

  it("retains unread completed output beyond five minutes until it has been consumed", async () => {
    const service = fixture();
    const first = await service.start(
      owner,
      { command: "delayed tail", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch(`process.stdout.write('x'.repeat(4000)+'RETAINED_TAIL');`),
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 3000,
        maxOutputChars: 500,
      },
    );
    expect(first.running).toBe(false);
    expect(first.unreadOutputChars).toBeGreaterThan(0);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60_000);
    try {
      expect(service.inspect(first.id, owner).unreadOutputChars).toBe(first.unreadOutputChars);
      const tail = await service.interact(first.id, owner, {
        yieldMs: 0,
        maxOutputChars: 10_000,
      });
      expect(tail.output).toContain("RETAINED_TAIL");
      expect(tail.unreadOutputChars).toBe(0);
      expect(service.list(owner.runId)).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });

  it("waits for process close and cleanup before cancelRun removes ownership", async () => {
    const service = fixture();
    let started!: () => void;
    let release!: () => void;
    const cleanupStarted = new Promise<void>((resolveStart) => {
      started = resolveStart;
    });
    const cleanupDone = new Promise<void>((resolveDone) => {
      release = resolveDone;
    });
    const first = await service.start(
      owner,
      { command: "server", cwd: tmpdir(), securityScope: "host" },
      {
        ...nodeLaunch("setInterval(()=>{},1000);"),
        cleanup: async () => {
          started();
          await cleanupDone;
        },
      },
      { signal: new AbortController().signal, timeoutMs: 10_000, yieldMs: 0, maxOutputChars: 1000 },
    );
    const cancel = service.cancelRun(owner.runId);
    await cleanupStarted;
    expect(service.inspect(first.id, owner).running).toBe(true);
    release();
    await cancel;
    expect(service.list(owner.runId)).toEqual([]);
  });

  it("automatically stops a running process on abort", async () => {
    const service = fixture();
    const controller = new AbortController();
    const cleanup = vi.fn(async () => undefined);
    const first = await service.start(
      owner,
      { command: "server", cwd: tmpdir(), securityScope: "host" },
      { ...nodeLaunch("setInterval(()=>{},1000);"), cleanup },
      { signal: controller.signal, timeoutMs: 10_000, yieldMs: 0, maxOutputChars: 1000 },
    );
    controller.abort();
    const last = await untilComplete(service, first);
    expect(last.isError).toBe(true);
    expect(last.output).toContain("canceled");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("stops timed-out processes while retaining a truthful failure result", async () => {
    const service = fixture();
    const first = await service.start(
      owner,
      { command: "server", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch("setInterval(()=>{},1000);"),
      { signal: new AbortController().signal, timeoutMs: 100, yieldMs: 1000, maxOutputChars: 1000 },
    );
    const last = await untilComplete(service, first);
    expect(last.isError).toBe(true);
    expect(last.output).toContain("timed out");
  });

  it("retains a cleanup failure and rejects releasing its run", async () => {
    const service = fixture();
    const first = await service.start(
      owner,
      { command: "container", cwd: tmpdir(), securityScope: "docker" },
      {
        ...nodeLaunch("process.exit(0);"),
        cleanup: async () => {
          throw new Error("container daemon unavailable");
        },
      },
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 1000,
        maxOutputChars: 1000,
      },
    );
    const last = await untilComplete(service, first);
    expect(last.isError).toBe(true);
    expect(last.output).toContain("COMMAND_CLEANUP_UNCONFIRMED");
    await expect(service.cancelRun(owner.runId)).rejects.toThrow("COMMAND_CLEANUP_UNCONFIRMED");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60_000);
    try {
      expect(service.list(owner.runId)).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
    await service.start(
      { ...owner, runId: "other-run" },
      { command: "other server", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch("setInterval(()=>{},1000);"),
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 0,
        maxOutputChars: 1000,
      },
    );
    await expect(service.shutdown()).rejects.toThrow("COMMAND_CLEANUP_UNCONFIRMED");
    expect(service.list("other-run")).toEqual([]);
    expect(service.list(owner.runId)).toHaveLength(1);
  });

  it("clears a stale cleanup failure after a later cleanup is confirmed", async () => {
    const service = fixture();
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("container daemon temporarily unavailable"))
      .mockResolvedValueOnce(undefined);
    const first = await service.start(
      owner,
      { command: "container", cwd: tmpdir(), securityScope: "docker" },
      {
        ...nodeLaunch("process.exit(0);"),
        cleanup,
      },
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 1000,
        maxOutputChars: 1000,
      },
    );
    const failed = await untilComplete(service, first);
    expect(failed.isError).toBe(true);
    expect(failed.output).toContain("COMMAND_CLEANUP_UNCONFIRMED");
    expect(service.inspect(first.id, owner).isError).toBe(true);

    const recovered = await service.interact(first.id, owner, {
      terminate: true,
      yieldMs: 0,
      maxOutputChars: 1000,
    });
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(recovered.isError).toBe(false);
    expect(recovered.output).not.toContain("COMMAND_CLEANUP_UNCONFIRMED");

    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60_000);
    try {
      expect(service.list(owner.runId)).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });

  it("retries a failed stop without caching its rejected cleanup attempt", async () => {
    const service = fixture();
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("container still stopping"))
      .mockResolvedValueOnce(undefined);
    await service.start(
      owner,
      { command: "container", cwd: tmpdir(), securityScope: "docker" },
      {
        ...nodeLaunch("setInterval(()=>{},1000);"),
        cleanup,
      },
      { signal: new AbortController().signal, timeoutMs: 10_000, yieldMs: 0, maxOutputChars: 1000 },
    );

    await expect(service.cancelRun(owner.runId)).rejects.toThrow("COMMAND_CLEANUP_UNCONFIRMED");
    expect(service.list(owner.runId)).toHaveLength(1);
    await expect(service.cancelRun(owner.runId)).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(service.list(owner.runId)).toEqual([]);
  });

  it("retains a termination failure even when the root process later closes", async () => {
    let child!: ChildProcess;
    let terminationAttempted!: () => void;
    const attempted = new Promise<void>((resolve) => {
      terminationAttempted = resolve;
    });
    const service = new PersistentCommandService({
      terminate: async (current) => {
        child = current;
        terminationAttempted();
        throw new Error("taskkill failed");
      },
    });
    services.push(service);
    await service.start(
      owner,
      { command: "root closes after failed termination", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch("process.stdin.resume();process.stdin.once('end',()=>process.exit(0));"),
      { signal: new AbortController().signal, timeoutMs: 10_000, yieldMs: 0, maxOutputChars: 1000 },
    );

    const cancel = service.cancelRun(owner.runId);
    await attempted;
    child.stdin?.end();
    await expect(cancel).rejects.toThrow("COMMAND_CLEANUP_UNCONFIRMED");

    expect(service.list(owner.runId)).toHaveLength(1);
    expect(service.list(owner.runId)[0]).toMatchObject({ running: false, isError: true });
  });

  it("clears a termination failure after an independent termination retry succeeds", async () => {
    let child!: ChildProcess;
    let terminationAttempted!: () => void;
    const attempted = new Promise<void>((resolve) => {
      terminationAttempted = resolve;
    });
    const terminate = vi
      .fn<(current: ChildProcess) => Promise<void>>()
      .mockImplementationOnce(async (current) => {
        child = current;
        terminationAttempted();
        throw new Error("taskkill failed");
      })
      .mockResolvedValueOnce(undefined);
    const service = new PersistentCommandService({ terminate });
    services.push(service);
    await service.start(
      owner,
      { command: "retry termination", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch("setInterval(()=>{},1000);"),
      { signal: new AbortController().signal, timeoutMs: 10_000, yieldMs: 0, maxOutputChars: 1000 },
    );

    const firstCancel = service.cancelRun(owner.runId);
    await attempted;
    child.kill();
    await expect(firstCancel).rejects.toThrow("COMMAND_CLEANUP_UNCONFIRMED");
    expect(service.list(owner.runId)).toHaveLength(1);

    await expect(service.cancelRun(owner.runId)).resolves.toBeUndefined();
    expect(terminate).toHaveBeenCalledTimes(2);
    expect(service.list(owner.runId)).toEqual([]);
  });

  it("accepts independent Docker cleanup as confirmation after termination fails", async () => {
    let child!: ChildProcess;
    let terminationAttempted!: () => void;
    const attempted = new Promise<void>((resolve) => {
      terminationAttempted = resolve;
    });
    const cleanup = vi.fn(async () => undefined);
    const service = new PersistentCommandService({
      terminate: async (current) => {
        child = current;
        terminationAttempted();
        throw new Error("taskkill failed");
      },
    });
    services.push(service);
    await service.start(
      owner,
      { command: "docker cleanup confirms stop", cwd: tmpdir(), securityScope: "docker" },
      { ...nodeLaunch("setInterval(()=>{},1000);"), cleanup },
      { signal: new AbortController().signal, timeoutMs: 10_000, yieldMs: 0, maxOutputChars: 1000 },
    );

    const cancel = service.cancelRun(owner.runId);
    await attempted;
    child.kill();
    await expect(cancel).resolves.toBeUndefined();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(service.list(owner.runId)).toEqual([]);
  });

  it("keeps manual confirmation authoritative when cleanup finishes late with an error", async () => {
    let child!: ChildProcess;
    let terminationAttempted!: () => void;
    let cleanupStarted!: () => void;
    let finishCleanup!: () => void;
    const attempted = new Promise<void>((resolve) => {
      terminationAttempted = resolve;
    });
    const cleanupPending = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    const cleanupResult = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const cleanup = vi.fn(async () => {
      cleanupStarted();
      await cleanupResult;
      throw new Error("late cleanup failure");
    });
    const service = new PersistentCommandService({
      terminate: async (current) => {
        child = current;
        terminationAttempted();
        throw new Error("taskkill failed");
      },
    });
    services.push(service);
    await service.start(
      owner,
      { command: "manual stop during cleanup", cwd: tmpdir(), securityScope: "docker" },
      { ...nodeLaunch("setInterval(()=>{},1000);"), cleanup },
      { signal: new AbortController().signal, timeoutMs: 10_000, yieldMs: 0, maxOutputChars: 1000 },
    );

    const cancel = service.cancelRun(owner.runId);
    await attempted;
    child.kill();
    await cleanupPending;
    expect(service.confirmRunStopped(owner.runId)).toBe(1);
    finishCleanup();

    await expect(cancel).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(service.list(owner.runId)).toEqual([]);
  });

  it("rejects manual run confirmation atomically while a normal command is active", async () => {
    const service = fixture();
    const unconfirmed = await service.start(
      owner,
      { command: "cleanup unconfirmed", cwd: tmpdir(), securityScope: "docker" },
      {
        ...nodeLaunch("process.exit(0);"),
        cleanup: async () => {
          throw new Error("container cleanup unconfirmed");
        },
      },
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 1000,
        maxOutputChars: 1000,
      },
    );
    await untilComplete(service, unconfirmed);
    const active = await service.start(
      owner,
      { command: "still active", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch("setInterval(()=>{},1000);"),
      { signal: new AbortController().signal, timeoutMs: 10_000, yieldMs: 0, maxOutputChars: 1000 },
    );

    expect(() => service.confirmRunStopped(owner.runId)).toThrow("COMMAND_RUN_STILL_ACTIVE");
    expect(
      service
        .list(owner.runId)
        .map((command) => command.id)
        .sort(),
    ).toEqual([unconfirmed.id, active.id].sort());
  });

  it("clears only the explicitly confirmed run and returns the discarded count", async () => {
    const service = fixture();
    const completed = await service.start(
      owner,
      { command: "completed sibling", cwd: tmpdir(), securityScope: "host" },
      nodeLaunch("process.exit(0);"),
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 1000,
        maxOutputChars: 1000,
      },
    );
    await untilComplete(service, completed);
    const unconfirmed = await service.start(
      owner,
      { command: "confirmed stopped", cwd: tmpdir(), securityScope: "docker" },
      {
        ...nodeLaunch("process.exit(0);"),
        cleanup: async () => {
          throw new Error("container cleanup unconfirmed");
        },
      },
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 1000,
        maxOutputChars: 1000,
      },
    );
    await untilComplete(service, unconfirmed);
    const otherOwner = { ...owner, runId: "other-run" };
    const other = await service.start(
      otherOwner,
      { command: "other run", cwd: tmpdir(), securityScope: "docker" },
      {
        ...nodeLaunch("process.exit(0);"),
        cleanup: async () => {
          throw new Error("other container cleanup unconfirmed");
        },
      },
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 1000,
        maxOutputChars: 1000,
      },
    );
    await untilComplete(service, other, otherOwner);

    expect(service.confirmRunStopped(owner.runId)).toBe(2);
    expect(service.list(owner.runId)).toEqual([]);
    expect(service.list(otherOwner.runId).map((command) => command.id)).toEqual([other.id]);
  });

  it("removes confirmed siblings when another command in the run cannot be cleaned", async () => {
    const service = fixture();
    const confirmed = await service.start(
      owner,
      { command: "confirmed", cwd: tmpdir(), securityScope: "host" },
      {
        ...nodeLaunch("process.exit(0);"),
        cleanup: async () => undefined,
      },
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 1000,
        maxOutputChars: 1000,
      },
    );
    const unconfirmed = await service.start(
      owner,
      { command: "unconfirmed", cwd: tmpdir(), securityScope: "docker" },
      {
        ...nodeLaunch("process.exit(0);"),
        cleanup: async () => {
          throw new Error("container daemon unavailable");
        },
      },
      {
        signal: new AbortController().signal,
        timeoutMs: 10_000,
        yieldMs: 1000,
        maxOutputChars: 1000,
      },
    );
    await untilComplete(service, confirmed);
    await untilComplete(service, unconfirmed);

    await expect(service.cancelRun(owner.runId)).rejects.toThrow("COMMAND_CLEANUP_UNCONFIRMED");
    expect(service.list(owner.runId).map((command) => command.id)).toEqual([unconfirmed.id]);
  });
});
