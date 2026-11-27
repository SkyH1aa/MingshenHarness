import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentProfileView,
  ChatSendInput,
  ModelConfig,
  SessionView,
} from "../../shared/domain";
import { LspDiagnosticsService } from "../agents/lsp-diagnostics-service";
import { ProjectConfigService } from "../agents/project-config-service";
import { ProjectToolingService } from "../agents/project-tooling-service";
import { McpService } from "../mcp/mcp-service";
import { PermissionStore } from "../permissions/permission-store";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { SecretStore } from "../storage/secret-store";
import { agentPermission, ChatService, USER_INTERRUPT_REASON } from "./chat-service";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

describe("Chat MCP routing", () => {
  it("runs activated plugin hooks without requiring a persistent session reference", async () => {
    const extension = {
      id: "plugin-1",
      type: "plugin",
      enabled: true,
    };
    const run = vi.fn(async () => []);
    const repository = {
      getAgentProfile: () => null,
      listSessionExtensionIds: () => [],
      getExtension: (id: string) => (id === extension.id ? extension : null),
    };
    const chat = new ChatService({
      repository,
      pluginHookService: { run },
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      runActivatedPlugins: Map<string, Set<string>>;
      withExternalWriter: (
        session: SessionView,
        runId: string,
        signal: AbortSignal,
        execute: () => Promise<unknown>,
      ) => Promise<unknown>;
      runPluginHooks: (
        event: "Stop",
        session: SessionView,
        runId: string,
        signal: AbortSignal,
      ) => Promise<void>;
    };
    internal.runActivatedPlugins.set("run-1", new Set([extension.id]));
    vi.spyOn(internal, "withExternalWriter").mockImplementation(
      async (_session, _runId, _signal, execute) => await execute(),
    );
    const session = {
      id: "session-1",
      agentMode: "code",
      workspacePath: "C:\\workspace",
      executionMode: "host",
      permissionMode: "full_access",
    } as SessionView;
    const signal = new AbortController().signal;

    await internal.runPluginHooks("Stop", session, "run-1", signal);

    expect(run).toHaveBeenCalledExactlyOnceWith(
      "Stop",
      session,
      "run-1",
      signal,
      expect.any(Function),
      {},
      [extension.id],
      { policyApproved: true },
    );
  });

  it("routes manual @subagent sessions to the profile's dedicated provider and model", async () => {
    const child = { id: "child", status: "idle" };
    const insertSession = vi.fn(() => child);
    const parentModel = {
      id: "parent-model",
      providerId: "parent-provider",
      enabled: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
    };
    const dedicatedModel = {
      id: "dedicated-model",
      providerId: "dedicated-provider",
      enabled: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
    };
    const parentProfile = {
      id: "parent-profile",
      permissions: {},
      readOnly: false,
      toolAllowlist: [],
    };
    const childProfile = {
      id: "worker",
      name: "Worker",
      role: "subagent",
      modelId: "dedicated-model",
      enabled: true,
      readOnly: false,
      permissions: {},
      toolAllowlist: [],
    };
    const repository = {
      getSession: () => ({
        id: "parent",
        agentProfileId: "parent-profile",
        providerId: "parent-provider",
        modelId: "parent-model",
        workspacePath: null,
        permissionMode: "request_approval",
        executionMode: "host",
      }),
      getMessages: () => [],
      listAgentProfiles: () => [childProfile],
      getAgentProfile: (id: string) => (id === parentProfile.id ? parentProfile : childProfile),
      getModel: (id: string) =>
        id === parentModel.id ? parentModel : id === dedicatedModel.id ? dedicatedModel : null,
      getProvider: (id: string) => ({ id }),
      insertSession,
      listSessionExtensionIds: () => [],
    };
    const chat = new ChatService({
      repository,
      agentProfileService: { syncWorkspace: vi.fn() },
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const send = vi.spyOn(chat, "send").mockResolvedValue({ runId: "child-run" });

    const internal = chat as unknown as {
      prepareSend: (input: ChatSendInput, signal: AbortSignal) => Promise<{ runId: string }>;
    };
    await expect(
      internal.prepareSend(
        {
          sessionId: "parent",
          text: "@worker inspect this",
          draftRevision: "parent-draft-revision",
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ runId: "child-run" });
    expect(insertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: "parent",
        agentProfileId: "worker",
        providerId: "dedicated-provider",
        modelId: "dedicated-model",
      }),
    );
    expect(send).toHaveBeenCalledExactlyOnceWith(
      {
        sessionId: "child",
        text: "inspect this",
        attachments: [],
        draftRevision: "parent-draft-revision",
      },
      expect.any(AbortSignal),
      false,
      "parent",
    );
  });

  it.each([
    { permissionMode: "request_approval", executionMode: "host" },
    { permissionMode: "full_access", executionMode: "docker" },
  ])("does not inject diagnostic advice when host checks are disabled: %o", async (modes) => {
    const detectFormatter = vi.fn();
    const diagnostics = vi.fn();
    const emit = vi.fn();
    const chat = new ChatService({
      repository: { getSetting: () => null },
      projectToolingService: { detectFormatter, diagnostics },
      emit,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      runPostEditChecks: (
        session: SessionView,
        runId: string,
        paths: string[],
        signal: AbortSignal,
      ) => Promise<string>;
    };
    const feedback = await internal.runPostEditChecks(
      { id: "s", workspacePath: "C:\\workspace", ...modes } as SessionView,
      "run",
      ["C:\\workspace\\notes.txt"],
      new AbortController().signal,
    );
    expect(feedback).toBe("");
    expect(detectFormatter).not.toHaveBeenCalled();
    expect(diagnostics).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
  it("does not run code diagnostics or return feedback for ordinary document edits", async () => {
    const diagnostics = vi.fn();
    const emit = vi.fn();
    const chat = new ChatService({
      repository: { getSetting: () => null },
      projectToolingService: {
        detectFormatter: vi.fn().mockResolvedValue(null),
        diagnosticPaths: vi.fn().mockResolvedValue([]),
        diagnostics,
      },
      emit,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      runPostEditChecks: (
        session: SessionView,
        runId: string,
        paths: string[],
        signal: AbortSignal,
      ) => Promise<string>;
    };
    expect(
      await internal.runPostEditChecks(
        {
          id: "s",
          workspacePath: "C:\\workspace",
          permissionMode: "full_access",
          executionMode: "host",
        } as SessionView,
        "r",
        ["C:\\workspace\\notes.txt"],
        new AbortController().signal,
      ),
    ).toBe("");
    expect(diagnostics).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
  it("skips automatic diagnostic activities when edited code has no applicable engine", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-chat-no-diagnostics-"));
    try {
      const file = join(root, "setup.ps1");
      await writeFile(file, "Write-Output 'ok'\n");
      const diagnostics = vi.fn().mockResolvedValue(null);
      const emit = vi.fn();
      const chat = new ChatService({
        repository: { getSetting: () => null },
        projectToolingService: new ProjectToolingService(
          { diagnostics } as unknown as LspDiagnosticsService,
          new ProjectConfigService(join(root, "user")),
        ),
        emit,
      } as unknown as ConstructorParameters<typeof ChatService>[0]);
      const internal = chat as unknown as {
        runPostEditChecks: (
          session: SessionView,
          runId: string,
          paths: string[],
          signal: AbortSignal,
        ) => Promise<string>;
        emitActivity: ReturnType<typeof vi.fn>;
      };
      internal.emitActivity = vi.fn();
      const feedback = await internal.runPostEditChecks(
        {
          id: "s",
          workspacePath: root,
          permissionMode: "full_access",
          executionMode: "host",
        } as SessionView,
        "r",
        [file],
        new AbortController().signal,
      );
      expect(diagnostics).toHaveBeenCalledOnce();
      expect(feedback).toBe("");
      expect(internal.emitActivity).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("does not announce or start an engine when stopped during diagnostic discovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-chat-cancel-diagnostics-"));
    try {
      const file = join(root, "setup.ps1");
      const marker = join(root, "diagnostic-started.txt");
      const server = join(root, "server.mjs");
      await writeFile(file, "Write-Output 'ok'\n");
      await writeFile(
        server,
        `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], "started");
process.exit(1);`,
      );
      const servers = [
        {
          id: "project-powershell",
          command: [process.execPath, server, marker],
          extensions: [".ps1"],
          environment: { ELECTRON_RUN_AS_NODE: "1" },
          initialization: {},
          source: "project" as const,
        },
      ];
      let finishDiscovery!: (value: typeof servers) => void;
      const discovery = new Promise<typeof servers>((resolve) => {
        finishDiscovery = resolve;
      });
      let enteredDiscovery!: () => void;
      const discovering = new Promise<void>((resolve) => {
        enteredDiscovery = resolve;
      });
      const lsp = new LspDiagnosticsService(join(root, "lsp"));
      vi.spyOn(
        lsp as unknown as { configuredRuntimeServers: () => Promise<typeof servers> },
        "configuredRuntimeServers",
      ).mockImplementation(() => {
        enteredDiscovery();
        return discovery;
      });
      const chat = new ChatService({
        repository: { getSetting: () => null },
        projectToolingService: new ProjectToolingService(
          lsp,
          new ProjectConfigService(join(root, "user")),
        ),
      } as unknown as ConstructorParameters<typeof ChatService>[0]);
      const internal = chat as unknown as {
        runPostEditChecks: (
          session: SessionView,
          runId: string,
          paths: string[],
          signal: AbortSignal,
        ) => Promise<string>;
        emitActivity: ReturnType<typeof vi.fn>;
      };
      internal.emitActivity = vi.fn();
      const controller = new AbortController();
      const checking = internal.runPostEditChecks(
        {
          id: "s",
          workspacePath: root,
          permissionMode: "full_access",
          executionMode: "host",
        } as SessionView,
        "r",
        [file],
        controller.signal,
      );
      const cancelled = expect(checking).rejects.toMatchObject({ name: "AbortError" });
      await discovering;
      controller.abort();
      finishDiscovery(servers);
      await cancelled;
      expect(internal.emitActivity).not.toHaveBeenCalled();
      await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each(["not-configured", "not-applicable"])(
    "completes an explicitly configured server named %s instead of treating it as a skip",
    async (engine) => {
      const file = "C:\\workspace\\setup.ps1";
      const chat = new ChatService({
        repository: { getSetting: () => null },
        projectToolingService: {
          detectFormatter: vi.fn().mockResolvedValue(null),
          diagnosticPaths: vi.fn().mockResolvedValue([file]),
          diagnostics: vi
            .fn()
            .mockImplementation(
              async (_workspace: string, _paths: string[], onStart: () => void) => {
                onStart();
                return {
                  ok: true,
                  engine,
                  servers: [engine],
                  diagnostics: [],
                  error: null,
                };
              },
            ),
        },
      } as unknown as ConstructorParameters<typeof ChatService>[0]);
      const internal = chat as unknown as {
        runPostEditChecks: (
          session: SessionView,
          runId: string,
          paths: string[],
          signal: AbortSignal,
        ) => Promise<string>;
        emitActivity: ReturnType<typeof vi.fn>;
      };
      internal.emitActivity = vi.fn();
      const feedback = await internal.runPostEditChecks(
        {
          id: "s",
          workspacePath: "C:\\workspace",
          permissionMode: "full_access",
          executionMode: "host",
        } as SessionView,
        "r",
        [file],
        new AbortController().signal,
      );
      expect(feedback).toBe("");
      expect(internal.emitActivity).toHaveBeenCalledTimes(2);
      expect(internal.emitActivity).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ status: "running" }),
      );
      expect(internal.emitActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: "项目诊断通过", status: "completed" }),
      );
    },
  );
  it.each(["Configured PowerShell language server could not start.", null])(
    "keeps real diagnostic failures visible even without output: %s",
    async (error) => {
      const file = "C:\\workspace\\setup.ps1";
      const expectedError = error ?? "项目诊断未通过，检查器未提供错误详情。";
      const chat = new ChatService({
        repository: { getSetting: () => null },
        projectToolingService: {
          detectFormatter: vi.fn().mockResolvedValue(null),
          diagnosticPaths: vi.fn().mockResolvedValue([file]),
          diagnostics: vi
            .fn()
            .mockImplementation(
              async (_workspace: string, _paths: string[], onStart: () => void) => {
                onStart();
                return {
                  ok: false,
                  engine: "project-powershell",
                  diagnostics: [],
                  error,
                };
              },
            ),
        },
      } as unknown as ConstructorParameters<typeof ChatService>[0]);
      const internal = chat as unknown as {
        runPostEditChecks: (
          session: SessionView,
          runId: string,
          paths: string[],
          signal: AbortSignal,
        ) => Promise<string>;
        emitActivity: ReturnType<typeof vi.fn>;
      };
      internal.emitActivity = vi.fn();
      const feedback = await internal.runPostEditChecks(
        {
          id: "s",
          workspacePath: "C:\\workspace",
          permissionMode: "full_access",
          executionMode: "host",
        } as SessionView,
        "r",
        [file],
        new AbortController().signal,
      );
      expect(internal.emitActivity).toHaveBeenCalledTimes(2);
      expect(internal.emitActivity).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ status: "running" }),
      );
      expect(internal.emitActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: "项目诊断未通过",
          status: "failed",
          detail: expect.stringContaining(expectedError),
        }),
      );
      expect(feedback).toContain(expectedError);
    },
  );
  it.each([false, true])(
    "returns real code diagnostic feedback only when there are issues: %s",
    async (hasIssues) => {
      const file = "C:\\workspace\\code.ts";
      const chat = new ChatService({
        repository: { insertActivity: vi.fn(), getSetting: () => null },
        trajectoryService: { record: vi.fn() },
        projectToolingService: {
          detectFormatter: vi.fn().mockResolvedValue(null),
          diagnosticPaths: vi.fn().mockResolvedValue([file]),
          diagnostics: vi.fn().mockResolvedValue({
            engine: "typescript",
            diagnostics: hasIssues
              ? [
                  {
                    path: file,
                    line: 2,
                    column: 3,
                    severity: "error",
                    message: "TS2322: Incorrect type",
                  },
                ]
              : [],
            error: null,
          }),
        },
        emit: vi.fn(),
      } as unknown as ConstructorParameters<typeof ChatService>[0]);
      const internal = chat as unknown as {
        runPostEditChecks: (
          session: SessionView,
          runId: string,
          paths: string[],
          signal: AbortSignal,
        ) => Promise<string>;
        emitActivity: ReturnType<typeof vi.fn>;
      };
      internal.emitActivity = vi.fn();
      const feedback = await internal.runPostEditChecks(
        {
          id: "s",
          workspacePath: "C:\\workspace",
          permissionMode: "full_access",
          executionMode: "host",
        } as SessionView,
        "r",
        [file],
        new AbortController().signal,
      );
      if (hasIssues) expect(feedback).toContain(`${file}:2:3 [error] TS2322`);
      else expect(feedback).toBe("");
    },
  );
  it("preserves every diagnostic and the complete failure for disclosure while bounding model feedback", async () => {
    const file = "C:\\workspace\\code.ts";
    const diagnostics = Array.from({ length: 90 }, (_, index) => ({
      path: file,
      line: index + 1,
      column: 3,
      severity: "error",
      message: `TS2322: Diagnostic ${index + 1}`,
    }));
    const error = `DIAGNOSTICS_START\n${"preserve full diagnostics failure\n".repeat(100)}DIAGNOSTICS_END`;
    const chat = new ChatService({
      repository: { getSetting: () => null },
      projectToolingService: {
        detectFormatter: vi.fn().mockResolvedValue(null),
        diagnosticPaths: vi.fn().mockResolvedValue([file]),
        diagnostics: vi.fn().mockResolvedValue({ engine: "typescript", diagnostics, error }),
      },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      runPostEditChecks: (
        session: SessionView,
        runId: string,
        paths: string[],
        signal: AbortSignal,
      ) => Promise<string>;
      emitActivity: ReturnType<typeof vi.fn>;
    };
    internal.emitActivity = vi.fn();
    const feedback = await internal.runPostEditChecks(
      {
        id: "s",
        workspacePath: "C:\\workspace",
        permissionMode: "full_access",
        executionMode: "host",
      } as SessionView,
      "r",
      [file],
      new AbortController().signal,
    );
    const detail = internal.emitActivity.mock.lastCall?.[0].detail;
    expect(detail).toContain(`${file}:90:3 [error] TS2322: Diagnostic 90`);
    expect(detail).toContain(error);
    expect(internal.emitActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
    expect(feedback).toContain(`${file}:80:3 [error] TS2322: Diagnostic 80`);
    expect(feedback).not.toContain(`${file}:81:3`);
    expect(feedback).toContain(error);
  });
  it("rejects duplicate sends while the original message is still preparing", async () => {
    let release!: () => void;
    const prepare = new Promise<void>((done) => {
      release = done;
    });
    const chat = new ChatService({
      repository: { getSession: () => ({ id: "session", workspacePath: null }) },
      agentProfileService: { syncWorkspace: () => prepare },
      approvalBroker: { cancelSession: vi.fn() },
      questionBroker: { cancelSession: vi.fn() },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const pending = chat.send({ sessionId: "session", text: "First" });
    await expect(chat.send({ sessionId: "session", text: "Duplicate" })).rejects.toThrow(
      "正在运行",
    );
    const closing = chat.shutdown();
    release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await closing;
    await expect(chat.send({ sessionId: "session", text: "Too late" })).rejects.toThrow(
      "shutting down",
    );
  });
  it("waits for interrupted runs to finish before shutdown resolves", async () => {
    const cancel = vi.fn();
    const chat = new ChatService({
      approvalBroker: { cancelSession: cancel },
      questionBroker: { cancelSession: cancel },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const state = chat as unknown as {
      activeRuns: Map<string, AbortController>;
      activeExecutions: Map<string, Promise<void>>;
    };
    const controller = new AbortController();
    state.activeRuns.set("session", controller);
    let finish!: () => void;
    state.activeExecutions.set(
      "session",
      new Promise<void>((done) => {
        finish = done;
      }),
    );
    let closed = false;
    const closing = chat.shutdown().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(controller.signal.aborted).toBe(true);
    expect(closed).toBe(false);
    finish();
    await closing;
    expect(closed).toBe(true);
  });
  it("dispatches Interrupt with a fresh signal after an explicit user stop", async () => {
    let resolveHook!: () => void;
    const runPluginHooks = vi.fn(
      (..._args: unknown[]) =>
        new Promise<void>((resolve) => {
          resolveHook = resolve;
        }),
    );
    const cancel = vi.fn();
    const chat = new ChatService({
      repository: { listChildSessions: () => [] },
      approvalBroker: { cancelSession: cancel },
      questionBroker: { cancelSession: cancel },
      pluginHookService: {},
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const state = chat as unknown as {
      activeRuns: Map<string, AbortController>;
      runPluginHooks: (...args: unknown[]) => Promise<void>;
      dispatchInterruptHooks: (session: SessionView, runId: string, signal: AbortSignal) => void;
    };
    state.runPluginHooks = runPluginHooks;
    const main = new AbortController();
    state.activeRuns.set("session", main);
    const session = {
      id: "session",
      agentMode: "code",
      workspacePath: process.cwd(),
      agentProfileId: "primary",
      parentSessionId: null,
      permissionMode: "full_access",
      executionMode: "host",
    } as SessionView;

    chat.stop(session.id);
    expect(main.signal.reason).toBe(USER_INTERRUPT_REASON);
    state.dispatchInterruptHooks(session, "run", main.signal);
    await vi.waitFor(() => expect(runPluginHooks).toHaveBeenCalledOnce());
    const call = runPluginHooks.mock.calls[0];
    const cleanupSignal = call?.[3] as AbortSignal;
    expect(call?.[0]).toBe("Interrupt");
    expect(call?.[1]).toBe(session);
    expect(call?.[2]).toBe("run");
    expect(cleanupSignal).not.toBe(main.signal);
    expect(cleanupSignal.aborted).toBe(false);
    expect(call?.[4]).toEqual({ metadata: { reason: "user_stop" } });
    resolveHook();
  });
  it("does not dispatch Interrupt for an internal abort", async () => {
    const runPluginHooks = vi.fn(async () => undefined);
    const chat = new ChatService({
      repository: { listChildSessions: () => [] },
      pluginHookService: {},
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const state = chat as unknown as {
      runPluginHooks: (...args: unknown[]) => Promise<void>;
      dispatchInterruptHooks: (session: SessionView, runId: string, signal: AbortSignal) => void;
    };
    state.runPluginHooks = runPluginHooks;
    const internal = new AbortController();
    internal.abort();
    state.dispatchInterruptHooks(
      {
        id: "session",
        agentMode: "code",
        workspacePath: process.cwd(),
        parentSessionId: null,
        permissionMode: "full_access",
        executionMode: "host",
      } as SessionView,
      "run",
      internal.signal,
    );
    await Promise.resolve();
    expect(runPluginHooks).not.toHaveBeenCalled();
  });
  it("bounds Interrupt dispatch with an independent cleanup timeout", async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const runPluginHooks = vi.fn(
        (..._args: unknown[]) =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const chat = new ChatService({
        repository: { listChildSessions: () => [] },
        pluginHookService: {},
        emit: vi.fn(),
      } as unknown as ConstructorParameters<typeof ChatService>[0]);
      const state = chat as unknown as {
        runPluginHooks: (...args: unknown[]) => Promise<void>;
        dispatchInterruptHooks: (session: SessionView, runId: string, signal: AbortSignal) => void;
      };
      state.runPluginHooks = runPluginHooks;
      const main = new AbortController();
      main.abort(USER_INTERRUPT_REASON);
      state.dispatchInterruptHooks(
        {
          id: "session",
          agentMode: "code",
          workspacePath: process.cwd(),
          parentSessionId: null,
          permissionMode: "full_access",
          executionMode: "host",
        } as SessionView,
        "run",
        main.signal,
      );
      const cleanupSignal = runPluginHooks.mock.calls[0]?.[3] as AbortSignal;
      await vi.advanceTimersByTimeAsync(1_500);
      expect(cleanupSignal.aborted).toBe(true);
      expect(cleanupSignal.reason).toBe("interrupt-hook-timeout");
      finish();
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not dispatch Interrupt while the application is closing", async () => {
    const runPluginHooks = vi.fn(async () => undefined);
    const chat = new ChatService({
      repository: { listChildSessions: () => [] },
      pluginHookService: {},
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const state = chat as unknown as {
      closing: boolean;
      runPluginHooks: (...args: unknown[]) => Promise<void>;
      dispatchInterruptHooks: (session: SessionView, runId: string, signal: AbortSignal) => void;
    };
    state.closing = true;
    state.runPluginHooks = runPluginHooks;
    const main = new AbortController();
    main.abort(USER_INTERRUPT_REASON);
    state.dispatchInterruptHooks(
      {
        id: "session",
        agentMode: "code",
        workspacePath: process.cwd(),
        parentSessionId: null,
        permissionMode: "full_access",
        executionMode: "host",
      } as SessionView,
      "run",
      main.signal,
    );
    await Promise.resolve();
    expect(runPluginHooks).not.toHaveBeenCalled();
  });
  it("blocks new work at the updater handoff only after live and preparing tasks drain", async () => {
    const chat = new ChatService({} as ConstructorParameters<typeof ChatService>[0]);
    const state = chat as unknown as {
      activeRuns: Map<string, AbortController>;
      preparingSends: Map<string, Promise<void>>;
      removingSessions: Map<string, Promise<void>>;
    };
    state.activeRuns.set("running", new AbortController());
    expect(chat.prepareForUpdate()).toBe(false);
    state.activeRuns.clear();
    state.preparingSends.set("preparing", Promise.resolve());
    expect(chat.prepareForUpdate()).toBe(false);
    state.preparingSends.clear();
    state.removingSessions.set("removing", Promise.resolve());
    expect(chat.prepareForUpdate()).toBe(false);
    state.removingSessions.clear();
    expect(chat.prepareForUpdate()).toBe(true);
    await expect(chat.send({ sessionId: "new", text: "Arrived during update" })).rejects.toThrow(
      "shutting down",
    );
  });
  it("waits for an active run before deleting its session and prevents another send", async () => {
    let exists = true;
    let finish!: () => void;
    const remove = vi.fn(() => {
      exists = false;
    });
    const emit = vi.fn();
    const onSessionRemoved = vi.fn();
    const permissions = new PermissionStore();
    const chat = new ChatService({
      repository: { removeSession: remove, listChildSessions: () => [] },
      approvalBroker: { cancelSession: vi.fn() },
      questionBroker: { cancelSession: vi.fn() },
      permissions,
      emit,
      onSessionRemoved,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const state = chat as unknown as {
      activeRuns: Map<string, AbortController>;
      activeExecutions: Map<string, Promise<void>>;
    };
    const controller = new AbortController();
    state.activeRuns.set("session", controller);
    state.activeExecutions.set(
      "session",
      new Promise<void>((done) => {
        finish = done;
      }),
    );
    const removing = chat.removeSession("session");
    await Promise.resolve();
    expect(controller.signal.aborted).toBe(true);
    expect(exists).toBe(true);
    await expect(chat.send({ sessionId: "session", text: "Too late" })).rejects.toThrow("正在删除");
    finish();
    await removing;
    expect(remove).toHaveBeenCalledExactlyOnceWith("session");
    expect(emit).toHaveBeenCalledWith({ type: "session_removed", sessionId: "session" });
    expect(onSessionRemoved).toHaveBeenCalledExactlyOnceWith("session");
    expect(exists).toBe(false);
  });
  it("removes child histories and snapshots before the parent and retains the parent if snapshot cleanup fails", async () => {
    const existing = new Set(["parent", "child"]);
    const operations: string[] = [];
    let fail = true;
    const chat = new ChatService({
      repository: {
        listChildSessions: (id: string) =>
          id === "parent" && existing.has("child") ? [{ id: "child" }] : [],
        removeSession: (id: string) => {
          operations.push(`db:${id}`);
          existing.delete(id);
        },
      },
      snapshotService: {
        removeForSession: async (id: string) => {
          operations.push(`snapshots:${id}`);
          if (id === "parent" && fail) throw new Error("Fixture disk unavailable");
        },
      },
      approvalBroker: { cancelSession: vi.fn() },
      questionBroker: { cancelSession: vi.fn() },
      permissions: new PermissionStore(),
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    await expect(chat.removeSession("parent")).rejects.toThrow("disk unavailable");
    expect(operations).toEqual(["snapshots:child", "db:child", "snapshots:parent"]);
    expect(existing.has("parent")).toBe(true);
    fail = false;
    await chat.removeSession("parent");
    expect(existing.size).toBe(0);
    expect(operations.at(-1)).toBe("db:parent");
  });
  it("cancels a send during workspace preparation without starting a model request", async () => {
    let release!: () => void;
    const prepare = new Promise<void>((done) => {
      release = done;
    });
    const chat = new ChatService({
      repository: { getSession: () => ({ id: "session", workspacePath: null }) },
      agentProfileService: { syncWorkspace: () => prepare },
      approvalBroker: { cancelSession: vi.fn() },
      questionBroker: { cancelSession: vi.fn() },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const pending = chat.send({ sessionId: "session", text: "First" });
    chat.stop("session");
    release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await chat.shutdown();
  });
  it("preserves saved drafts when sending fails or is stopped before acceptance", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const session = repository.insertSession({
      title: "Draft fixture",
      providerId: null,
      modelId: null,
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    });
    repository.saveComposerDraft({
      sessionId: session.id,
      revision: "unsent-revision",
      text: "Keep this draft",
      formatted: true,
      attachmentIds: [],
      notificationDraftIds: [],
    });
    let release!: () => void;
    const syncWorkspace = vi.fn(async (): Promise<void> => undefined);
    const chat = new ChatService({
      repository,
      agentProfileService: { syncWorkspace },
      approvalBroker: { cancelSession: vi.fn() },
      questionBroker: { cancelSession: vi.fn() },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const input: ChatSendInput = {
      sessionId: session.id,
      text: "Keep this draft",
      draftRevision: "unsent-revision",
    };
    try {
      await expect(chat.send(input)).rejects.toThrow("尚未选择模型");
      syncWorkspace.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const pending = chat.send(input);
      chat.stop(session.id);
      release();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(repository.getMessages(session.id)).toEqual([]);
      expect(repository.getComposerDraft(session.id)).toMatchObject({
        revision: "unsent-revision",
        text: "Keep this draft",
        formatted: true,
      });
    } finally {
      await chat.shutdown();
      database.close();
    }
  });
  it.each(["current", "newer", "manual-child"])(
    "publishes consumption immediately after durable acceptance for a %s draft",
    async (kind) => {
      const database = openDatabase(":memory:");
      const repository = new Repository(database);
      const provider = repository.insertProvider({
        name: "Fixture",
        baseUrl: "http://127.0.0.1:1/v1",
        protocol: "openai_responses",
        authMode: "bearer",
        customHeaderName: null,
      });
      repository.insertModel({
        providerId: provider.id,
        modelId: "fixture",
        displayName: "Fixture",
        contextWindow: 10000,
        maxOutputTokens: 1000,
        inputModalities: ["text"],
        outputModalities: ["text"],
        toolCalls: false,
        parallelToolCalls: false,
        reasoningLevels: ["none"],
        anthropicNoneBehavior: "disabled",
      });
      const model = repository.getProvider(provider.id)?.models[0];
      if (!model) throw new Error("Fixture model missing");
      const session = repository.insertSession({
        title: "Draft fixture",
        providerId: provider.id,
        modelId: model.id,
        agentProfileId: "primary",
        workspacePath: null,
        systemPrompt: "",
        reasoningLevel: null,
        permissionMode: "request_approval",
        executionMode: "host",
        patchOnly: false,
      });
      repository.saveComposerDraft({
        sessionId: session.id,
        revision: kind === "newer" ? "newer-revision" : "sent-revision",
        text: kind === "newer" ? "Keep this next draft" : "Accepted text",
        formatted: false,
        attachmentIds: [],
        notificationDraftIds: [],
      });
      const emit = vi.fn();
      const chat = new ChatService({
        repository,
        agentProfileService: { syncWorkspace: vi.fn() },
        approvalBroker: { cancelSession: vi.fn() },
        questionBroker: { cancelSession: vi.fn() },
        emit,
      } as unknown as ConstructorParameters<typeof ChatService>[0]);
      const internal = chat as unknown as {
        executeRun: () => Promise<void>;
      };
      const run = vi.spyOn(internal, "executeRun").mockImplementation(async () => {
        const owner =
          kind === "manual-child" ? repository.listChildSessions(session.id)[0] : session;
        expect(owner).toBeDefined();
        expect(repository.getMessages(owner?.id ?? "")[0]?.role).toBe("user");
        expect(emit).toHaveBeenCalledWith({
          type: "composer_draft_consumed",
          sessionId: session.id,
          revision: "sent-revision",
        });
        expect(repository.getComposerDraft(session.id)?.text ?? "").toBe(
          kind === "newer" ? "Keep this next draft" : "",
        );
      });
      try {
        await chat.send({
          sessionId: session.id,
          text: kind === "manual-child" ? "@general Accepted text" : "Accepted text",
          draftRevision: "sent-revision",
        });
        expect(run).toHaveBeenCalledOnce();
        await run.mock.results[0]?.value;
        expect(emit).toHaveBeenCalledWith({
          type: "composer_draft_consumed",
          sessionId: session.id,
          revision: "sent-revision",
        });
      } finally {
        await chat.shutdown();
        database.close();
      }
    },
  );

  it.each([true, false])(
    "publishes a compact command's consumed revision even when CAS returns %s",
    async (cleared) => {
      const clearComposerDraft = vi.fn(() => cleared);
      const emit = vi.fn();
      const chat = new ChatService({
        repository: { clearComposerDraft },
        emit,
      } as unknown as ConstructorParameters<typeof ChatService>[0]);
      vi.spyOn(chat, "compactSession").mockReturnValue({ runId: "compact-run" });
      await expect(
        chat.send({
          sessionId: "session",
          text: "/compact",
          draftRevision: "compact-revision",
        }),
      ).resolves.toEqual({ runId: "compact-run" });
      expect(clearComposerDraft).toHaveBeenCalledExactlyOnceWith("session", "compact-revision");
      expect(emit).toHaveBeenCalledExactlyOnceWith({
        type: "composer_draft_consumed",
        sessionId: "session",
        revision: "compact-revision",
      });
    },
  );
  it("retains a compact command's draft when accepting compaction fails", async () => {
    const clearComposerDraft = vi.fn();
    const emit = vi.fn();
    const chat = new ChatService({
      repository: { clearComposerDraft },
      emit,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    vi.spyOn(chat, "compactSession").mockImplementation(() => {
      throw new Error("Fixture compact is unavailable");
    });
    await expect(
      chat.send({
        sessionId: "session",
        text: "/compact",
        draftRevision: "compact-revision",
      }),
    ).rejects.toThrow("Fixture compact is unavailable");
    expect(clearComposerDraft).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
  it("does not start a local MCP process when startup approval is denied", async () => {
    const discover = vi.fn(async (_remote: boolean, _workspace: null, allowed: Set<string>) => {
      expect(allowed.size).toBe(0);
      return [];
    });
    const chat = new ChatService({
      repository: {
        getAgentProfile: () => null,
        getSetting: () => null,
        listAgentProfiles: () => [],
      },
      mcpService: {
        toolDefinitions: discover,
        list: () => [
          {
            id: "untrusted",
            name: "Untrusted",
            enabled: true,
            configured: true,
            transport: "stdio",
            command: "node",
            args: ["unknown.js"],
            cwd: "",
          },
        ],
      },
      customToolService: { descriptors: vi.fn() },
      toolRegistry: { descriptors: () => [] },
      permissions: new PermissionStore(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      requestApproval: ReturnType<typeof vi.fn>;
      availableTools: (
        session: SessionView,
        model: ModelConfig,
        runId: string,
        signal: AbortSignal,
      ) => Promise<unknown[]>;
    };
    internal.requestApproval = vi.fn(async () => ({ decision: "deny" }));
    expect(
      await internal.availableTools(
        {
          id: "s",
          workspacePath: null,
          permissionMode: "request_approval",
          executionMode: "host",
        } as SessionView,
        { toolCalls: true } as ModelConfig,
        "run",
        new AbortController().signal,
      ),
    ).toEqual([
      expect.objectContaining({ name: "use_plugin" }),
      expect.objectContaining({ name: "read_tool_output" }),
      expect.objectContaining({ name: "recall_context" }),
    ]);
    expect(internal.requestApproval).toHaveBeenCalledOnce();
    expect(discover).toHaveBeenCalledOnce();
  });
  it("filters MCP results using exact plugin ownership instead of the server id prefix", async () => {
    const toolDefinitions = [
      {
        name: "mcp__custom__read",
        serverId: "plugin-user-owned-id",
        readOnly: true,
      },
      {
        name: "mcp__plugin__read",
        serverId: "plugin-owned-id",
        readOnly: true,
      },
    ];
    const chat = new ChatService({
      repository: {
        getAgentProfile: () => null,
        getSetting: () => null,
        listAgentProfiles: () => [],
      },
      extensionService: { getAvailablePluginMcpServerIds: () => new Set<string>() },
      mcpService: {
        pluginMcpServerIds: () => new Set(["plugin-owned-id"]),
        toolDefinitions: vi.fn(async () => toolDefinitions),
        list: () => [],
      },
      customToolService: { descriptors: vi.fn(async () => []) },
      toolRegistry: { descriptors: () => [] },
      permissions: new PermissionStore(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      availableTools: (
        session: SessionView,
        model: ModelConfig,
      ) => Promise<Array<{ name: string; serverId?: string }>>;
    };

    const tools = await internal.availableTools(
      {
        id: "session",
        agentMode: "code",
        workspacePath: null,
        permissionMode: "full_access",
        executionMode: "host",
      } as SessionView,
      { toolCalls: true } as ModelConfig,
    );

    expect(tools).toContainEqual(expect.objectContaining({ serverId: "plugin-user-owned-id" }));
    expect(tools).not.toContainEqual(expect.objectContaining({ serverId: "plugin-owned-id" }));
  });
  it("does not ask to start an unactivated plugin stdio server", async () => {
    const server = {
      id: "plugin-server-id",
      name: "Plugin local process",
      enabled: true,
      configured: true,
      transport: "stdio",
      command: "node",
      args: ["plugin-server.mjs"],
      cwd: "",
    };
    const discover = vi.fn(async () => []);
    const chat = new ChatService({
      repository: {
        getAgentProfile: () => null,
        getSetting: () => null,
        listAgentProfiles: () => [],
      },
      extensionService: {
        getAvailablePluginMcpServerIds: (_sessionId: string, activeIds: string[]) =>
          new Set(activeIds.includes("plugin-extension") ? [server.id] : []),
      },
      mcpService: {
        pluginMcpServerIds: () => new Set([server.id]),
        toolDefinitions: discover,
        list: () => [server],
      },
      customToolService: { descriptors: vi.fn(async () => []) },
      toolRegistry: { descriptors: () => [] },
      permissions: new PermissionStore(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      runActivatedPlugins: Map<string, Set<string>>;
      requestApproval: ReturnType<typeof vi.fn>;
      availableTools: (
        session: SessionView,
        model: ModelConfig,
        runId: string,
        signal: AbortSignal,
      ) => Promise<Array<{ name: string }>>;
    };
    internal.requestApproval = vi.fn(async () => ({ decision: "deny" }));
    const session = {
      id: "session",
      agentMode: "code",
      workspacePath: null,
      permissionMode: "request_approval",
      executionMode: "host",
    } as SessionView;
    const model = { toolCalls: true } as ModelConfig;
    const signal = new AbortController().signal;

    await internal.availableTools(session, model, "run", signal);
    expect(internal.requestApproval).not.toHaveBeenCalled();
    expect(discover).toHaveBeenLastCalledWith(false, null, new Set(), new Set(), true);

    internal.runActivatedPlugins.set("run", new Set(["plugin-extension"]));
    await internal.availableTools(session, model, "run", signal);
    expect(internal.requestApproval).toHaveBeenCalledOnce();
    expect(discover).toHaveBeenLastCalledWith(false, null, new Set(), new Set([server.id]), true);
  });
  it("exposes web tools only when a ChatAgent session allows internet access", async () => {
    const chat = new ChatService({
      toolRegistry: {
        descriptors: () =>
          [{ name: "web_search" }, { name: "web_fetch" }, { name: "read_file" }] as never,
      },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      availableTools: (
        session: SessionView,
        model: ModelConfig,
      ) => Promise<Array<{ name: string }>>;
    };
    const allowed = {
      id: "chat-session",
      agentMode: "chat",
      chatNetworkEnabled: true,
    } as SessionView;
    const denied = { ...allowed, chatNetworkEnabled: false };

    expect(await internal.availableTools(allowed, { toolCalls: true } as ModelConfig)).toEqual([
      { name: "web_search" },
      { name: "web_fetch" },
    ]);
    expect(await internal.availableTools(denied, { toolCalls: true } as ModelConfig)).toEqual([]);
  });
  it("asks before GitHub writes and honors rejection", async () => {
    const execute = vi.fn();
    const approval = vi.fn(async () => ({ decision: "deny", feedback: "不要发布" }));
    const chat = new ChatService({
      repository: {
        getAgentProfile: () => null,
        getSession: () => ({ id: "s", permissionMode: "request_approval" }),
        getSetting: () => null,
        listSessionTodos: () => [],
      },
      githubService: { execute },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      requestApproval: typeof approval;
      executeToolCall: (input: unknown) => Promise<{ isError: boolean; output: string }>;
    };
    internal.requestApproval = approval;
    const result = await internal.executeToolCall({
      session: { id: "s", permissionMode: "request_approval" },
      runId: "r",
      signal: new AbortController().signal,
      toolCall: {
        name: "github_create_issue",
        callId: "c",
        arguments: JSON.stringify({ repo: "owner/repo", title: "test" }),
      },
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("不要发布");
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not load host custom tools or stdio MCP for Docker sessions", async () => {
    const custom = vi.fn();
    const discover = vi.fn(async () => []);
    const chat = new ChatService({
      repository: {
        getAgentProfile: () => null,
        getSetting: () => null,
        listAgentProfiles: () => [],
      },
      mcpService: { toolDefinitions: discover, list: () => [] },
      customToolService: { descriptors: custom },
      toolRegistry: {
        descriptors: () => [{ name: "lsp" }, { name: "read_file" }, { name: "run_command" }],
      },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const tools = await (
      chat as unknown as {
        availableTools: (
          session: SessionView,
          model: ModelConfig,
        ) => Promise<Array<{ name: string }>>;
      }
    ).availableTools(
      { executionMode: "docker", workspacePath: null } as SessionView,
      { toolCalls: true } as ModelConfig,
    );
    expect(tools.map((tool) => tool.name)).toEqual([
      "use_plugin",
      "read_tool_output",
      "recall_context",
      "execute_tool_chain",
      "read_file",
      "run_command",
    ]);
    expect(discover).toHaveBeenCalledWith(true, null, undefined, new Set(), true);
    expect(custom).not.toHaveBeenCalled();
  });
  it("hides and rejects third-party readOnlyHint MCP tools in read-only Plan", async () => {
    let calls = 0;
    const server = createServer(async (request, response) => {
      const buffers: Buffer[] = [];
      for await (const chunk of request) buffers.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(buffers).toString());
      response.setHeader("Content-Type", "application/json");
      if (message.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      let result: unknown = {};
      if (message.method === "initialize")
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        };
      if (message.method === "tools/list")
        result = {
          tools: [
            {
              name: "lookup",
              description: "Read",
              inputSchema: { type: "object", properties: {} },
              annotations: { readOnlyHint: true },
            },
            {
              name: "mutate",
              description: "Write",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        };
      if (message.method === "tools/call") {
        calls++;
        result = {
          content: [{ type: "text", text: "actual MCP result" }],
          isError: message.params.name === "mutate",
        };
      }
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const root = await mkdtemp(join(tmpdir(), "mingshen-chat-mcp-"));
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    const mcp = new McpService(repository, new SecretStore(database), "1.0.0");
    const approval = vi.fn(async () => ({ decision: "allow_session" }));
    const permissions = new PermissionStore();
    // Exercise the real chat discovery/dispatch path against a real HTTP MCP transport.
    const options = {
      repository: {
        getAgentProfile: () => ({ readOnly: true, toolAllowlist: [], permissions: {} }),
        getSession: () => ({ id: "session", permissionMode: "request_approval" }),
        getSetting: () => null,
        listSessionTodos: () => [],
      },
      mcpService: mcp,
      customToolService: { descriptors: async () => [] },
      toolRegistry: { descriptors: () => [] },
      permissions,
    };
    const chat = new ChatService(
      options as unknown as ConstructorParameters<typeof ChatService>[0],
    );
    const internal = chat as unknown as {
      availableTools: (
        session: SessionView,
        model: ModelConfig,
      ) => Promise<Array<{ name: string }>>;
      executeToolCall: (input: unknown) => Promise<{ output: string; isError: boolean }>;
      requestApproval: typeof approval;
    };
    internal.requestApproval = approval;
    try {
      await mcp.save({
        id: "fixture",
        name: "Fixture",
        description: "test",
        enabled: true,
        transport: "http",
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`,
      });
      const session = {
        id: "session",
        agentProfileId: "plan",
        workspacePath: null,
        permissionMode: "request_approval",
      } as SessionView;
      const tools = await internal.availableTools(session, { toolCalls: true } as ModelConfig);
      expect(tools.map((tool) => tool.name)).toEqual([
        "use_plugin",
        "read_tool_output",
        "recall_context",
      ]);
      const lookup = await internal.executeToolCall({
        session,
        runId: "run",
        signal: new AbortController().signal,
        toolCall: {
          name: "mcp__fixture__lookup",
          callId: "call",
          arguments: "{}",
        },
      });
      expect(lookup).toMatchObject({ isError: true });
      expect(lookup.output).toContain("不符合只读 Agent 策略");
      expect(approval).not.toHaveBeenCalled();
      expect(calls).toBe(0);

      const mutate = await internal.executeToolCall({
        session,
        runId: "run",
        signal: new AbortController().signal,
        toolCall: {
          name: "mcp__fixture__mutate",
          callId: "call-mutate",
          arguments: "{}",
        },
      });
      expect(mutate).toMatchObject({ isError: true });
      expect(mutate.output).toContain("不符合只读 Agent 策略");
      expect(approval).not.toHaveBeenCalled();
      expect(calls).toBe(0);

      await mcp.setEnabled("fixture", false);
      expect(await internal.availableTools(session, { toolCalls: true } as ModelConfig)).toEqual([
        expect.objectContaining({ name: "use_plugin" }),
        expect.objectContaining({ name: "read_tool_output" }),
        expect.objectContaining({ name: "recall_context" }),
      ]);
    } finally {
      mcp.dispose();
      database.close();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("dispatches PreToolUse and PostToolUse around the real tool executor", async () => {
    const runPluginHooks = vi.fn(async (..._args: unknown[]) => undefined);
    const performToolCall = vi.fn(async () => ({
      output: "tool result",
      isError: false,
    }));
    const chat = new ChatService({
      repository: { getSetting: () => null },
      pluginHookService: {},
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      runPluginHooks: (...args: unknown[]) => Promise<void>;
      performToolCall: (...args: unknown[]) => Promise<{ output: string; isError: boolean }>;
      executeToolCall: (input: {
        session: SessionView;
        runId: string;
        signal: AbortSignal;
        toolCall: { index: number; callId: string; name: string; arguments: string };
      }) => Promise<{ output: string; isError: boolean }>;
    };
    internal.runPluginHooks = runPluginHooks;
    internal.performToolCall = performToolCall;
    const signal = new AbortController().signal;
    const session = {
      id: "session",
      agentMode: "code",
      workspacePath: process.cwd(),
      agentProfileId: "primary",
      parentSessionId: null,
      permissionMode: "full_access",
      executionMode: "host",
    } as SessionView;

    await expect(
      internal.executeToolCall({
        session,
        runId: "run",
        signal,
        toolCall: {
          index: 0,
          callId: "call",
          name: "read_file",
          arguments: JSON.stringify({ path: "a.txt" }),
        },
      }),
    ).resolves.toMatchObject({
      output: "tool result",
      isError: false,
      outcome: { status: "success", effect: "none", validation: { status: "validated" } },
    });

    expect(performToolCall).toHaveBeenCalledOnce();
    expect(runPluginHooks).toHaveBeenNthCalledWith(
      1,
      "PreToolUse",
      session,
      "run",
      signal,
      expect.objectContaining({
        toolCallId: "call",
        toolName: "read_file",
        toolInput: { path: "a.txt" },
      }),
    );
    expect(runPluginHooks).toHaveBeenNthCalledWith(
      2,
      "PostToolUse",
      session,
      "run",
      signal,
      expect.objectContaining({
        toolCallId: "call",
        toolName: "read_file",
        toolInput: { path: "a.txt" },
        toolResponse: expect.objectContaining({ output: "tool result", isError: false }),
      }),
    );
  });
});

function permissionRuntime(
  permissions: AgentProfileView["permissions"],
  toolAllowlist: string[] = ["read_file", "use_skill", "read_tool_output"],
  extensionService: Record<string, unknown> = {},
) {
  const profile = {
    id: "permission-profile",
    permissions,
    readOnly: false,
    toolAllowlist,
  } as AgentProfileView;
  const session = {
    id: "permission-session",
    agentProfileId: profile.id,
    agentMode: "code",
    workspacePath: null,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
  } as SessionView;
  const values = new Map<string, unknown>();
  const repository = {
    getAgentProfile: () => profile,
    getSession: () => session,
    getSetting: (key: string) => values.get(key) ?? null,
    setSetting: (key: string, value: unknown) => values.set(key, value),
    removeSetting: (key: string) => values.delete(key),
  };
  const chat = new ChatService({
    repository,
    providerService: {},
    extensionService,
    promptDirectory: join(process.cwd(), "resources", "prompts"),
    emit: vi.fn(),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const approvalTarget = chat as unknown as {
    requestApproval: (...args: unknown[]) => Promise<{ decision: "deny" }>;
  };
  const requestApproval = vi
    .spyOn(approvalTarget, "requestApproval")
    .mockResolvedValue({ decision: "deny" });
  const executeTarget = chat as unknown as {
    executeOwnedToolCall(
      input: {
        session: SessionView;
        runId: string;
        signal: AbortSignal;
        toolCall: { name: string; arguments: string; callId: string; index: number };
      },
      onCommandLease: (release: () => void) => void,
    ): Promise<{ output: string; isError: boolean }>;
  };
  return {
    requestApproval,
    execute: (name: string, args: Record<string, unknown>, callId = "permission-call") =>
      executeTarget.executeOwnedToolCall(
        {
          session,
          runId: "permission-run",
          signal: new AbortController().signal,
          toolCall: {
            name,
            arguments: JSON.stringify(args),
            callId,
            index: 0,
          },
        },
        vi.fn(),
      ),
  };
}

describe("Agent profile permission resolution", () => {
  it.each([
    { edit: "allow", write_file: "deny" },
    { write_file: "deny", edit: "allow" },
  ] as const)("keeps an explicit tool denial ahead of its group fallback: %o", (permissions) => {
    expect(agentPermission({ permissions } as unknown as AgentProfileView, "write_file")).toBe(
      "deny",
    );
  });

  it.each([
    { edit: "deny", write_file: "allow" },
    { write_file: "allow", edit: "deny" },
  ] as const)("keeps an explicit tool allow ahead of its group fallback: %o", (permissions) => {
    expect(agentPermission({ permissions } as unknown as AgentProfileView, "write_file")).toBe(
      "allow",
    );
  });

  it.each([
    {
      permissions: {
        read: "allow",
        "use_skill:builtin:work-word": "deny",
      } as AgentProfileView["permissions"],
      toolName: "use_skill",
      subject: "builtin:work-word",
    },
    {
      permissions: {
        read: "allow",
        "read_file:builtin:work-word": "deny",
      } as AgentProfileView["permissions"],
      toolName: "use_skill",
      subject: "builtin:work-word",
    },
    {
      permissions: {
        read: "allow",
        "read_tool_output:retained-call": "ask",
      } as AgentProfileView["permissions"],
      toolName: "read_tool_output",
      subject: "retained-call",
    },
  ])(
    "resolves subject-scoped and inherited read rules: %o",
    ({ permissions, toolName, subject }) => {
      const expected = Object.values(permissions).includes("ask") ? "ask" : "deny";
      expect(agentPermission({ permissions } as AgentProfileView, toolName, subject)).toBe(
        expected,
      );
    },
  );

  it.each([
    {
      name: "use_skill",
      args: { name: "builtin:work-word" },
      permissions: { read: "allow", "use_skill:builtin:work-word": "deny" },
    },
    {
      name: "discover_capabilities",
      args: { query: "pdf" },
      permissions: { read: "allow", "discover_capabilities:pdf": "deny" },
    },
    {
      name: "use_skill",
      args: { name: "builtin:work-word" },
      permissions: { read: "allow", "read_file:builtin:work-word": "deny" },
    },
    {
      name: "read_tool_output",
      args: { call_id: "retained-call" },
      permissions: { read: "allow", "read_tool_output:retained-call": "deny" },
    },
  ] as const)("blocks $name with its subject-specific deny before approval", async (testCase) => {
    const runtime = permissionRuntime({ ...testCase.permissions });
    const result = await runtime.execute(testCase.name, testCase.args);
    expect(result).toMatchObject({ isError: true, output: expect.stringContaining("禁止") });
    expect(runtime.requestApproval).not.toHaveBeenCalled();
  });

  it.each([
    { name: "use_skill", args: { name: "builtin:work-word" } },
    { name: "read_tool_output", args: { call_id: "retained-call" } },
  ] as const)("checks the profile allowlist before asking for $name", async (testCase) => {
    const runtime = permissionRuntime({ [testCase.name]: "ask" }, ["web_search"]);
    const result = await runtime.execute(testCase.name, testCase.args);
    expect(result).toMatchObject({ isError: true, output: expect.stringContaining("禁止") });
    expect(runtime.requestApproval).not.toHaveBeenCalled();
  });

  it("includes built-in creators in paginated discovery inside the read permission boundary", async () => {
    const discoverCapabilities = vi.fn(async () => "combined capability index");
    const runtime = permissionRuntime({ read: "allow" }, ["discover_capabilities"], {
      discoverCapabilities,
    });

    const result = await runtime.execute("discover_capabilities", { query: "creator" });

    expect(result).toEqual({ output: "combined capability index", isError: false });
    expect(discoverCapabilities).toHaveBeenCalledWith(
      "permission-session",
      { query: "creator", kind: "all", offset: 0, limit: 20 },
      expect.arrayContaining([
        expect.objectContaining({ id: "builtin:skill-creator", source: "builtin" }),
        expect.objectContaining({ id: "builtin:plugin-creator", source: "builtin" }),
        expect.objectContaining({ id: "builtin:harness-plugin-api", source: "builtin" }),
      ]),
      { approved: true },
    );
    expect(runtime.requestApproval).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "use_skill",
      args: { name: "builtin:work-word" },
      permissions: { read: "allow", "use_skill:builtin:work-word": "ask" },
    },
    {
      name: "read_tool_output",
      args: { call_id: "retained-call" },
      permissions: { read: "allow", "read_tool_output:retained-call": "ask" },
    },
  ] as const)("asks only after $name passes deny and allowlist checks", async (testCase) => {
    const runtime = permissionRuntime({ ...testCase.permissions }, ["read_file"]);
    const result = await runtime.execute(testCase.name, testCase.args);
    expect(result).toMatchObject({ isError: true, output: "用户拒绝了读取。" });
    expect(runtime.requestApproval).toHaveBeenCalledOnce();
  });
});

describe("Chat workspace and rewrite boundaries", () => {
  it("rejects LSP paths outside the workspace before starting a language server", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-lsp-boundary-"));
    const codeIntelligence = vi.fn();
    const load = vi.fn();
    const chat = new ChatService({
      repository: {
        getAgentProfile: () => null,
        getSession: () => null,
        getSetting: () => null,
      },
      projectConfigService: { load },
      lspDiagnosticsService: { codeIntelligence },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      executeOwnedToolCall: (
        input: unknown,
        onCommandLease: (release: () => void) => void,
      ) => Promise<{ output: string; isError: boolean }>;
    };
    try {
      const result = await internal.executeOwnedToolCall(
        {
          session: {
            id: "session",
            agentMode: "code",
            workspacePath: root,
            agentProfileId: "primary",
            parentSessionId: null,
            permissionMode: "full_access",
            executionMode: "host",
          },
          runId: "run",
          signal: new AbortController().signal,
          toolCall: {
            index: 0,
            callId: "call",
            name: "lsp",
            arguments: JSON.stringify({
              operation: "hover",
              path: join(root, "..", "outside.ts"),
              line: 1,
              column: 1,
            }),
          },
        },
        vi.fn(),
      );
      expect(result).toMatchObject({
        isError: true,
        output: expect.stringContaining("只能查询当前工作区"),
      });
      expect(codeIntelligence).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("defers conversation deletion until send preparation succeeds", async () => {
    const target = {
      id: "message-1",
      sessionId: "session",
      seq: 4,
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Original" }],
      createdAt: new Date().toISOString(),
    };
    const repository = {
      getSession: () => ({
        id: "session",
        agentMode: "chat",
        archived: false,
        status: "idle",
      }),
      getMessage: () => target,
      listAgentProfiles: () => [],
      deleteMessagesFromSeq: vi.fn(),
    };
    const chat = new ChatService({
      repository,
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      sendWithContext: (
        input: ChatSendInput,
        parentSignal: AbortSignal | undefined,
        resumePlan: boolean,
        draftSessionId: string,
        queuedPrompt: boolean,
        replaceTailFromSeq?: number,
      ) => Promise<{ runId: string }>;
    };
    const sendWithContext = vi
      .spyOn(internal, "sendWithContext")
      .mockResolvedValue({ runId: "replacement-run" });

    await expect(
      chat.rewriteAndSend({ sessionId: "session", messageId: target.id, text: "Replacement" }),
    ).resolves.toEqual({ runId: "replacement-run" });
    expect(repository.deleteMessagesFromSeq).not.toHaveBeenCalled();
    expect(sendWithContext).toHaveBeenCalledWith(
      { sessionId: "session", text: "Replacement", attachments: [] },
      undefined,
      false,
      "session",
      false,
      target.seq,
    );
  });

  it("rolls back the whole rewrite when session metadata cannot be committed", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const provider = repository.insertProvider({
      name: "Rewrite fixture",
      baseUrl: "http://127.0.0.1:1/v1",
      protocol: "openai_responses",
      authMode: "bearer",
      customHeaderName: null,
    });
    repository.insertModel({
      providerId: provider.id,
      modelId: "rewrite-fixture",
      displayName: "Rewrite fixture",
      contextWindow: 10_000,
      maxOutputTokens: 1_000,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: false,
      parallelToolCalls: false,
      reasoningLevels: ["none"],
      anthropicNoneBehavior: "disabled",
    });
    const model = repository.getProvider(provider.id)?.models[0];
    if (!model) throw new Error("Fixture model missing");
    const session = repository.insertSession({
      title: "Original title",
      providerId: provider.id,
      modelId: model.id,
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    });
    const original = repository.appendMessage({
      sessionId: session.id,
      role: "user",
      parts: [{ type: "text", text: "Original request" }],
    });
    repository.appendMessage({
      sessionId: session.id,
      role: "assistant",
      parts: [{ type: "text", text: "Original answer" }],
    });
    const chat = new ChatService({
      repository,
      agentProfileService: { syncWorkspace: vi.fn(async (): Promise<void> => undefined) },
      approvalBroker: { cancelSession: vi.fn() },
      questionBroker: { cancelSession: vi.fn() },
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    chat.workbench.update({
      sessionId: session.id,
      revision: 0,
      steps: [
        {
          id: "done",
          content: "Completed before rewrite",
          status: "completed",
          priority: "medium",
          dependsOn: [],
          updatedAt: "",
        },
      ],
      breakpoints: ["done"],
    });
    const messagesBefore = repository.getMessages(session.id);
    const sessionBefore = repository.getSession(session.id);
    const planBefore = chat.workbench.state(session.id).plan;
    database.exec(`
      create trigger fail_rewrite_metadata before update on sessions
      when new.title = 'Replacement request'
      begin select raise(abort, 'Fixture metadata failure'); end;
    `);

    try {
      await expect(
        chat.rewriteAndSend({
          sessionId: session.id,
          messageId: original.id,
          text: "Replacement request",
        }),
      ).rejects.toThrow("Fixture metadata failure");
      expect(repository.getMessages(session.id)).toEqual(messagesBefore);
      expect(repository.getSession(session.id)).toEqual(sessionBefore);
      expect(chat.workbench.state(session.id).plan).toEqual(planBefore);
    } finally {
      database.close();
    }
  });

  it("rejects subagent delegation from an edit or retry before creating a child run", async () => {
    const target = {
      id: "message-1",
      sessionId: "session",
      seq: 4,
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Original" }],
      createdAt: new Date().toISOString(),
    };
    const repository = {
      getSession: () => ({
        id: "session",
        agentMode: "code",
        archived: false,
        status: "idle",
      }),
      getMessage: () => target,
      listAgentProfiles: () => [
        {
          id: "general",
          name: "General",
          role: "subagent",
          enabled: true,
          applicableModes: ["code"],
        },
      ],
    };
    const chat = new ChatService({
      repository,
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      sendWithContext: ReturnType<typeof vi.fn>;
    };
    const sendWithContext = vi.spyOn(internal, "sendWithContext");

    await expect(
      chat.rewriteAndSend({
        sessionId: "session",
        messageId: target.id,
        text: "@General inspect this",
      }),
    ).rejects.toThrow("编辑重发不支持 @子 Agent 委派");
    expect(sendWithContext).not.toHaveBeenCalled();
  });
});
