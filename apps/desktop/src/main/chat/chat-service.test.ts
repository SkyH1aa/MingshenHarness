import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ChatSendInput, ModelConfig, SessionView } from "../../shared/domain";
import { LspDiagnosticsService } from "../agents/lsp-diagnostics-service";
import { ProjectConfigService } from "../agents/project-config-service";
import { ProjectToolingService } from "../agents/project-tooling-service";
import { McpService } from "../mcp/mcp-service";
import { PermissionStore } from "../permissions/permission-store";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { SecretStore } from "../storage/secret-store";
import { ChatService } from "./chat-service";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

describe("Chat MCP routing", () => {
  it("routes manual @subagent sessions to the profile's dedicated provider and model", async () => {
    const child = { id: "child", status: "idle" };
    const insertSession = vi.fn(() => child);
    const parentModel = { id: "parent-model", providerId: "parent-provider", enabled: true };
    const dedicatedModel = {
      id: "dedicated-model",
      providerId: "dedicated-provider",
      enabled: true,
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
    await expect(pending).rejects.toThrow("shutting down");
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
    const permissions = new PermissionStore();
    const chat = new ChatService({
      repository: { removeSession: remove, listChildSessions: () => [] },
      approvalBroker: { cancelSession: vi.fn() },
      questionBroker: { cancelSession: vi.fn() },
      permissions,
      emit,
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
      repository: { getAgentProfile: () => null, getSetting: () => null },
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
    ).toEqual([expect.objectContaining({ name: "recall_context" })]);
    expect(internal.requestApproval).toHaveBeenCalledOnce();
    expect(discover).toHaveBeenCalledOnce();
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
      repository: { getAgentProfile: () => null, getSetting: () => null },
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
      "recall_context",
      "execute_tool_chain",
      "read_file",
      "run_command",
    ]);
    expect(discover).toHaveBeenCalledWith(true, null, undefined);
    expect(custom).not.toHaveBeenCalled();
  });
  it("exposes read-only MCP tools in Plan, executes them and remembers per-server approval", async () => {
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
      expect(tools.map((tool) => tool.name)).toEqual(["recall_context", "mcp__fixture__lookup"]);
      const input = {
        session,
        runId: "run",
        signal: new AbortController().signal,
        toolCall: {
          name: tools.find((tool) => tool.name === "mcp__fixture__lookup")?.name,
          callId: "call",
          arguments: "{}",
        },
      };
      expect((await internal.executeToolCall(input)).output).toContain("actual MCP result");
      expect((await internal.executeToolCall(input)).isError).toBe(false);
      expect(approval).toHaveBeenCalledTimes(1);
      expect(calls).toBe(2);
      expect(
        (
          await internal.executeToolCall({
            ...input,
            toolCall: { ...input.toolCall, name: "mcp__fixture__mutate" },
          })
        ).isError,
      ).toBe(true);
      expect(calls).toBe(2);
      expect((await mcp.callTool("fixture", "mutate", {})).isError).toBe(true);
      await mcp.setEnabled("fixture", false);
      expect(await internal.availableTools(session, { toolCalls: true } as ModelConfig)).toEqual([
        expect.objectContaining({ name: "recall_context" }),
      ]);
    } finally {
      mcp.dispose();
      database.close();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
