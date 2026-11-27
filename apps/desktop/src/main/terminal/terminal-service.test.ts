import { mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import type { InteractiveTerminalEvent } from "../../shared/terminal";
import type { ManagedPolicyService } from "../policy/managed-policy-service";
import { type PtyExitEvent, type TerminalPtySpawnInput, TerminalService } from "./terminal-service";

class FakePty {
  constructor(readonly pid = 4242) {}

  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExitEvent) => void>();

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: (event: PtyExitEvent) => void) {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  output(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  exit(exitCode: number, signal: number | null): void {
    for (const listener of this.exitListeners) listener({ exitCode, signal });
  }
}

function sessionView(workspacePath: string, overrides: Partial<SessionView> = {}): SessionView {
  const now = "2026-11-20T00:00:00.000Z";
  return {
    id: "session-1",
    title: "Terminal test",
    parentSessionId: null,
    agentMode: "code",
    providerId: null,
    modelId: null,
    agentProfileId: "primary",
    workspacePath,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "full_access",
    approvalMode: "manual",
    executionMode: "host",
    patchOnly: false,
    status: "idle",
    archived: false,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    ...overrides,
  };
}

describe("TerminalService", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "mingshen-terminal-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  function setup(
    options: {
      session?: SessionView;
      trusted?: boolean;
      worktreePath?: string | null;
      terminateTree?: (pid: number) => Promise<void>;
      exitTimeoutMs?: number;
      terminationTimeoutMs?: number;
      exitAfterTermination?: boolean;
      managedPolicy?: ManagedPolicyService;
    } = {},
  ) {
    const session = options.session ?? sessionView(workspace);
    const pty = new FakePty();
    const events: Array<{ ownerId: number; event: InteractiveTerminalEvent }> = [];
    const factory = vi.fn((input: TerminalPtySpawnInput) => {
      expect(input.cwd).toBe(workspace);
      expect(input.shell).toBe("powershell.exe");
      expect(input.env.OPENAI_API_KEY).toBeUndefined();
      return pty;
    });
    const service = new TerminalService({
      sessions: {
        getSession: (id) => (id === session.id ? session : null),
        isProjectTrusted: () => options.trusted ?? true,
      },
      worktreePath: () => options.worktreePath ?? null,
      emit: (ownerId, event) => events.push({ ownerId, event }),
      ptyFactory: factory,
      terminateTree: async (pid) => {
        await options.terminateTree?.(pid);
        if (options.exitAfterTermination !== false) pty.exit(0, null);
      },
      ...(options.exitTimeoutMs !== undefined ? { exitTimeoutMs: options.exitTimeoutMs } : {}),
      ...(options.terminationTimeoutMs !== undefined
        ? { terminationTimeoutMs: options.terminationTimeoutMs }
        : {}),
      platform: "win32",
      ...(options.managedPolicy ? { managedPolicy: options.managedPolicy } : {}),
      environment: {
        PATH: "C:\\Windows\\System32",
        OPENAI_API_KEY: "must-not-be-inherited",
        SystemRoot: "C:\\Windows",
      },
    });
    return { service, pty, session, events, factory };
  }

  it("creates, writes, resizes and reports a bounded PTY lifecycle", async () => {
    const { service, pty, events } = setup();
    const terminal = await service.create(11, {
      sessionId: "session-1",
      cols: 120,
      rows: 40,
    });

    expect(terminal).toMatchObject({
      sessionId: "session-1",
      status: "running",
      pid: 4242,
      cols: 120,
      rows: 40,
    });
    expect(service.list(11, "session-1")).toHaveLength(1);

    pty.output("PowerShell ready\r\n");
    expect(events).toContainEqual({
      ownerId: 11,
      event: {
        type: "output",
        terminalId: terminal.id,
        data: "PowerShell ready\r\n",
      },
    });

    service.input(11, terminal.id, "Get-Location\r");
    expect(pty.writes).toEqual(["Get-Location\r"]);
    expect(service.resize(11, terminal.id, 90, 28)).toMatchObject({ cols: 90, rows: 28 });
    expect(pty.resizes).toEqual([{ cols: 90, rows: 28 }]);

    pty.exit(7, null);
    expect(service.list(11, "session-1")[0]).toMatchObject({
      status: "exited",
      exitCode: 7,
    });
    expect(events.at(-1)?.event.type).toBe("state");

    await service.stop(11, terminal.id);
    expect(service.list(11, "session-1")).toEqual([]);
    expect(events.at(-1)?.event).toEqual({ type: "removed", terminalId: terminal.id });
  });

  it("rejects terminal creation before spawning a process when managed policy denies it", async () => {
    const assertCapability = vi.fn((capability: string) => {
      if (capability === "terminal.interactive") throw new Error("POLICY_BLOCKED");
    });
    const managedPolicy = {
      assertOperational: vi.fn(),
      assertCapability,
      assertPermissionMode: vi.fn(),
      assertExecutionMode: vi.fn(),
    } as unknown as ManagedPolicyService;
    const { service, factory } = setup({ managedPolicy });

    await expect(
      service.create(11, { sessionId: "session-1", cols: 100, rows: 30 }),
    ).rejects.toThrow("POLICY_BLOCKED");
    expect(factory).not.toHaveBeenCalled();
  });

  it("requires command execution authorization before spawning a PTY", async () => {
    const assertCapability = vi.fn((capability: string, options?: { approved?: boolean }) => {
      if (capability !== "command.execute") return;
      expect(options).toBeUndefined();
      throw new Error("POLICY_APPROVAL_REQUIRED");
    });
    const managedPolicy = {
      assertOperational: vi.fn(),
      assertCapability,
      assertPermissionMode: vi.fn(),
      assertExecutionMode: vi.fn(),
    } as unknown as ManagedPolicyService;
    const { service, factory } = setup({ managedPolicy });

    await expect(service.create(11, { sessionId: "session-1" })).rejects.toThrow(
      "POLICY_APPROVAL_REQUIRED",
    );
    expect(factory).not.toHaveBeenCalled();
    expect(assertCapability).toHaveBeenCalledWith("command.execute");
  });

  it("rechecks command execution authorization before writing terminal input", async () => {
    let denyCommand = false;
    const assertCapability = vi.fn((capability: string, options?: { approved?: boolean }) => {
      if (capability !== "command.execute") return;
      expect(options).toBeUndefined();
      if (denyCommand) throw new Error("POLICY_APPROVAL_REQUIRED");
    });
    const managedPolicy = {
      assertOperational: vi.fn(),
      assertCapability,
      assertPermissionMode: vi.fn(),
      assertExecutionMode: vi.fn(),
    } as unknown as ManagedPolicyService;
    const { service, factory, pty } = setup({ managedPolicy });

    const terminal = await service.create(11, { sessionId: "session-1" });
    denyCommand = true;

    expect(() => service.input(11, terminal.id, "Get-ChildItem\r")).toThrow(
      "POLICY_APPROVAL_REQUIRED",
    );
    expect(factory).toHaveBeenCalledOnce();
    expect(pty.writes).toEqual([]);
    expect(
      assertCapability.mock.calls.filter(([capability]) => capability === "command.execute"),
    ).toEqual([["command.execute"], ["command.execute"]]);
  });

  it.each([
    ["ChatAgent", { agentMode: "chat" }, "ChatAgent"],
    ["SubAgent", { parentSessionId: "parent" }, "SubAgent"],
    ["Docker", { executionMode: "docker" }, "Docker"],
    ["request approval", { permissionMode: "request_approval" }, "完全访问"],
    ["patch-only", { patchOnly: true }, "Patch-only"],
    ["missing workspace", { workspacePath: null }, "工作目录"],
  ] as const)("rejects %s sessions", async (_label, overrides, message) => {
    const { service, factory } = setup({
      session: sessionView(workspace, overrides as Partial<SessionView>),
    });
    await expect(service.create(11, { sessionId: "session-1" })).rejects.toThrow(message);
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects untrusted projects and worktrees that have not been created", async () => {
    const untrusted = setup({ trusted: false });
    await expect(untrusted.service.create(11, { sessionId: "session-1" })).rejects.toThrow(
      "尚未受信任",
    );

    const pendingWorktree = setup({
      session: sessionView(workspace, { executionMode: "worktree" }),
      worktreePath: null,
    });
    await expect(pendingWorktree.service.create(11, { sessionId: "session-1" })).rejects.toThrow(
      "worktree 尚未建立",
    );
  });

  it("uses only the already active worktree directory", async () => {
    const session = sessionView(workspace, { executionMode: "worktree" });
    const pty = new FakePty();
    const factory = vi.fn(() => pty);
    const service = new TerminalService({
      sessions: {
        getSession: () => session,
        isProjectTrusted: () => true,
      },
      worktreePath: () => workspace,
      ptyFactory: factory,
      terminateTree: async () => pty.exit(0, null),
      platform: "win32",
      environment: { SystemRoot: "C:\\Windows" },
    });

    await expect(service.create(11, { sessionId: "session-1" })).resolves.toMatchObject({
      cwd: workspace,
    });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace }));
    await service.dispose();
  });

  it("binds terminals to one owner and revalidates permissions before input", async () => {
    const { service, pty, session } = setup();
    const terminal = await service.create(11, { sessionId: "session-1" });

    expect(service.list(12, "session-1")).toEqual([]);
    expect(() => service.input(12, terminal.id, "whoami\r")).toThrow("不属于当前窗口");
    expect(() => service.resize(12, terminal.id, 80, 20)).toThrow("不属于当前窗口");
    expect(() => service.stop(12, terminal.id)).toThrow("不属于当前窗口");
    expect(pty.writes).toEqual([]);

    session.permissionMode = "request_approval";
    expect(() => service.input(11, terminal.id, "whoami\r")).toThrow("完全访问");
    await service.dispose();
    expect(service.list(11, "session-1")).toEqual([]);
  });

  it("enforces the per-window terminal limit", async () => {
    const { service } = setup();
    for (let index = 0; index < 8; index += 1) {
      await service.create(11, { sessionId: "session-1" });
    }
    await expect(service.create(11, { sessionId: "session-1" })).rejects.toThrow(
      "最多可同时打开 8 个终端",
    );
    await service.disposeOwner(11);
    expect(service.list(11, "session-1")).toEqual([]);
  });

  it("confirms stop through the PTY exit event and releases its owner", async () => {
    const { service, events } = setup();
    const terminal = await service.create(11, { sessionId: "session-1" });

    await service.stop(11, terminal.id);

    expect(service.list(11, "session-1")).toEqual([]);
    expect(events.some(({ event }) => event.type === "removed")).toBe(true);
  });

  it("retains a tree termination failure and retries it on the next stop", async () => {
    const terminateTree = vi
      .fn<(_pid: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error("taskkill failed"))
      .mockResolvedValue(undefined);
    const { service, events } = setup({ terminateTree });
    const terminal = await service.create(11, { sessionId: "session-1" });

    await expect(service.stop(11, terminal.id)).rejects.toThrow("taskkill failed");
    expect(service.list(11, "session-1")[0]).toMatchObject({
      status: "error",
      error: expect.stringContaining("清理未确认"),
    });
    expect(events.some(({ event }) => event.type === "removed")).toBe(false);

    await service.stop(11, terminal.id);
    expect(terminateTree).toHaveBeenCalledTimes(2);
    expect(service.list(11, "session-1")).toEqual([]);
  });

  it("bounds an unresponsive tree termination and keeps the record retryable", async () => {
    const terminateTree = vi
      .fn<(_pid: number) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>(() => undefined))
      .mockResolvedValue(undefined);
    const { service } = setup({ terminateTree, terminationTimeoutMs: 10 });
    const terminal = await service.create(11, { sessionId: "session-1" });

    await expect(service.stop(11, terminal.id)).rejects.toThrow("进程树停止超时");
    expect(service.list(11, "session-1")[0]?.status).toBe("error");
    await service.stop(11, terminal.id);
    expect(service.list(11, "session-1")).toEqual([]);
  });

  it("retains an unconfirmed PTY exit and waits again without retargeting the tree", async () => {
    const terminateTree = vi.fn(async () => undefined);
    const { service, pty } = setup({
      terminateTree,
      exitTimeoutMs: 10,
      exitAfterTermination: false,
    });
    const terminal = await service.create(11, { sessionId: "session-1" });

    await expect(service.stop(11, terminal.id)).rejects.toThrow("退出未确认");
    expect(service.list(11, "session-1")[0]?.status).toBe("error");
    const retry = service.stop(11, terminal.id);
    pty.exit(0, null);
    await retry;
    expect(terminateTree).toHaveBeenCalledOnce();
    expect(service.list(11, "session-1")).toEqual([]);
  });

  it("accepts a late PTY exit after confirmed tree termination", async () => {
    const { service, pty } = setup({ exitTimeoutMs: 10, exitAfterTermination: false });
    const terminal = await service.create(11, { sessionId: "session-1" });

    await expect(service.stop(11, terminal.id)).rejects.toThrow("退出未确认");
    expect(service.list(11, "session-1")).toHaveLength(1);
    pty.exit(0, null);
    expect(service.list(11, "session-1")).toEqual([]);
  });

  it("does not target a potentially reused PID after an unconfirmed tree exits", async () => {
    const terminateTree = vi.fn(async () => {
      throw new Error("taskkill failed");
    });
    const { service, pty } = setup({ terminateTree });
    const terminal = await service.create(11, { sessionId: "session-1" });

    await expect(service.stop(11, terminal.id)).rejects.toThrow("taskkill failed");
    pty.exit(0, null);
    await expect(service.stop(11, terminal.id)).rejects.toThrow("无法安全重试");
    expect(terminateTree).toHaveBeenCalledOnce();
    expect(service.list(11, "session-1")[0]?.status).toBe("error");
  });

  it("aggregates disposal failures and permits a subsequent disposal retry", async () => {
    const first = new FakePty(4241);
    const second = new FakePty(4242);
    const processes = [first, second];
    const attempts = new Set<number>();
    const session = sessionView(workspace);
    const service = new TerminalService({
      sessions: { getSession: () => session, isProjectTrusted: () => true },
      worktreePath: () => null,
      ptyFactory: () => processes.shift() as FakePty,
      terminateTree: async (pid) => {
        if (!attempts.has(pid)) {
          attempts.add(pid);
          throw new Error(pid === first.pid ? "first kill failed" : "second kill failed");
        }
        (pid === first.pid ? first : second).exit(0, null);
      },
    });
    await service.create(11, { sessionId: session.id });
    await service.create(11, { sessionId: session.id });

    await expect(service.dispose()).rejects.toThrow(/first kill failed.*second kill failed/);
    expect(service.list(11, session.id)).toHaveLength(2);
    await service.dispose();
    expect(service.list(11, session.id)).toEqual([]);
  });

  it("waits for an in-flight creation before disposing a session", async () => {
    let resolveSpawn!: (pty: FakePty) => void;
    const pty = new FakePty();
    const session = sessionView(workspace);
    const service = new TerminalService({
      sessions: { getSession: () => session, isProjectTrusted: () => true },
      worktreePath: () => null,
      ptyFactory: () =>
        new Promise<FakePty>((resolve) => {
          resolveSpawn = resolve;
        }),
      terminateTree: async () => pty.exit(0, null),
    });
    const creating = service.create(11, { sessionId: session.id });
    const createResult = expect(creating).rejects.toThrow("正在关闭");
    const disposing = service.disposeSession(session.id);
    await expect(service.create(11, { sessionId: session.id })).rejects.toThrow("正在关闭");
    resolveSpawn(pty);
    await createResult;
    await disposing;
    expect(service.list(11, session.id)).toEqual([]);
  });

  it("bounds disposal while a spawn is stuck and cleans a late result", async () => {
    let resolveSpawn!: (pty: FakePty) => void;
    const pty = new FakePty();
    const session = sessionView(workspace);
    const service = new TerminalService({
      sessions: { getSession: () => session, isProjectTrusted: () => true },
      worktreePath: () => null,
      ptyFactory: () =>
        new Promise<FakePty>((resolve) => {
          resolveSpawn = resolve;
        }),
      terminateTree: async () => pty.exit(0, null),
      terminationTimeoutMs: 10,
    });
    const creating = service.create(11, { sessionId: session.id });
    const createResult = expect(creating).rejects.toThrow("正在关闭");
    await expect(service.disposeSession(session.id)).rejects.toThrow("终端创建尚未结束");

    resolveSpawn(pty);
    await createResult;
    expect(service.list(11, session.id)).toEqual([]);
    await service.disposeSession(session.id);
  });

  it("cleans a late spawn when the session workspace changed during creation", async () => {
    const replacement = join(workspace, "replacement");
    await mkdir(replacement);
    let resolveSpawn!: (pty: FakePty) => void;
    const pty = new FakePty();
    const session = sessionView(workspace);
    const service = new TerminalService({
      sessions: { getSession: () => session, isProjectTrusted: () => true },
      worktreePath: () => null,
      ptyFactory: () =>
        new Promise<FakePty>((resolve) => {
          resolveSpawn = resolve;
        }),
      terminateTree: async () => pty.exit(0, null),
    });
    const creating = service.create(11, { sessionId: session.id });
    const result = expect(creating).rejects.toThrow("工作目录已更改");
    session.workspacePath = replacement;
    resolveSpawn(pty);
    await result;
    expect(service.list(11, session.id)).toEqual([]);
  });

  it("cleans a spawned PTY if output subscription fails", async () => {
    const pty = new FakePty();
    vi.spyOn(pty, "onData").mockImplementationOnce(() => {
      throw new Error("output subscription failed");
    });
    const session = sessionView(workspace);
    const service = new TerminalService({
      sessions: { getSession: () => session, isProjectTrusted: () => true },
      worktreePath: () => null,
      ptyFactory: () => pty,
      terminateTree: async () => pty.exit(0, null),
    });

    await expect(service.create(11, { sessionId: session.id })).rejects.toThrow(
      "output subscription failed",
    );
    expect(service.list(11, session.id)).toEqual([]);
  });

  it("retains an unconfirmed record if PTY exit subscription fails", async () => {
    const pty = new FakePty();
    vi.spyOn(pty, "onExit").mockImplementationOnce(() => {
      throw new Error("exit subscription failed");
    });
    const session = sessionView(workspace);
    const service = new TerminalService({
      sessions: { getSession: () => session, isProjectTrusted: () => true },
      worktreePath: () => null,
      ptyFactory: () => pty,
      terminateTree: async () => pty.exit(0, null),
      exitTimeoutMs: 10,
    });

    await expect(service.create(11, { sessionId: session.id })).rejects.toThrow("清理未确认");
    expect(service.list(11, session.id)[0]).toMatchObject({ status: "error" });
  });

  it("rechecks the session and directory identity before input and resize", async () => {
    const source = join(workspace, "project");
    const replacement = join(workspace, "replacement");
    await mkdir(source);
    await mkdir(replacement);
    const session = sessionView(source);
    const pty = new FakePty();
    const service = new TerminalService({
      sessions: { getSession: () => session, isProjectTrusted: () => true },
      worktreePath: () => null,
      ptyFactory: () => pty,
      terminateTree: async () => pty.exit(0, null),
    });
    const terminal = await service.create(11, { sessionId: session.id });

    session.workspacePath = replacement;
    expect(() => service.input(11, terminal.id, "command\r")).toThrow("工作目录已更改");
    expect(() => service.resize(11, terminal.id, 80, 20)).toThrow("工作目录已更改");
    session.workspacePath = source;
    await rename(source, join(workspace, "old-project"));
    await mkdir(source);
    expect(() => service.input(11, terminal.id, "command\r")).toThrow("工作目录已更改");
    expect(pty.writes).toEqual([]);
    await service.dispose();
  });

  it("rejects linked workspaces and a changed active worktree", async () => {
    const source = join(workspace, "source");
    const tree = join(workspace, "tree");
    const linked = join(workspace, "linked");
    await mkdir(source);
    await mkdir(tree);
    await symlink(source, linked, process.platform === "win32" ? "junction" : "dir");
    const linkedSession = sessionView(linked);
    const linkedService = new TerminalService({
      sessions: { getSession: () => linkedSession, isProjectTrusted: () => true },
      worktreePath: () => null,
      ptyFactory: () => new FakePty(),
      terminateTree: async () => undefined,
    });
    await expect(linkedService.create(11, { sessionId: linkedSession.id })).rejects.toThrow(
      "目录链接",
    );

    const session = sessionView(source, { executionMode: "worktree" });
    const pty = new FakePty();
    let activeTree = tree;
    const service = new TerminalService({
      sessions: { getSession: () => session, isProjectTrusted: () => true },
      worktreePath: () => activeTree,
      ptyFactory: () => pty,
      terminateTree: async () => pty.exit(0, null),
    });
    const terminal = await service.create(11, { sessionId: session.id });
    activeTree = source;
    expect(() => service.input(11, terminal.id, "command\r")).toThrow("工作目录已更改");
    expect(() => service.resize(11, terminal.id, 80, 20)).toThrow("工作目录已更改");
    activeTree = tree;
    await rename(tree, join(workspace, "old-tree"));
    await symlink(source, tree, process.platform === "win32" ? "junction" : "dir");
    expect(() => service.input(11, terminal.id, "command\r")).toThrow("目录链接");
    expect(() => service.resize(11, terminal.id, 80, 20)).toThrow("目录链接");
    await service.dispose();
  });

  it.runIf(process.platform === "win32")(
    "stops a real PowerShell process tree and confirms its PTY exit",
    async () => {
      const session = sessionView(workspace);
      let output = "";
      let reportChild!: (pid: number) => void;
      const childReady = new Promise<number>((resolve) => {
        reportChild = resolve;
      });
      const service = new TerminalService({
        sessions: { getSession: () => session, isProjectTrusted: () => true },
        worktreePath: () => null,
        emit: (_owner, event) => {
          if (event.type !== "output") return;
          output += event.data;
          const match = /MSH_CHILD_PID=(\d+)/.exec(output);
          if (match?.[1]) reportChild(Number(match[1]));
        },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const terminal = await service.create(11, { sessionId: session.id });
        service.input(
          11,
          terminal.id,
          "$p=Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 20' -PassThru; Write-Output ('MSH_CHILD_PID=' + $p.Id)\r",
        );
        const childPid = await Promise.race([
          childReady,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("PowerShell child was not observed")),
              10_000,
            );
          }),
        ]);
        expect(() => process.kill(childPid, 0)).not.toThrow();
        await service.stop(11, terminal.id);
        expect(service.list(11, session.id)).toEqual([]);
        expect(() => process.kill(childPid, 0)).toThrow();
      } finally {
        if (timer) clearTimeout(timer);
        await service.dispose();
      }
    },
    15_000,
  );
});
