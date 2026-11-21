import { describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { ChatService } from "./chat-service";

function fixture(limit = 2) {
  const settings = new Map<string, unknown>([["subagents.maxConcurrent", limit]]);
  const repository = {
    getSetting: (key: string) => settings.get(key),
    setSetting: (key: string, value: unknown) => settings.set(key, value),
    removeSetting: (key: string) => settings.delete(key),
    listSessionTodos: () => [],
    getSession: () => ({ parentSessionId: "parent" }),
    updateSession: (id: string, updates: object) => ({ id, ...updates }),
  };
  const chat = new ChatService({ repository, emit: vi.fn() } as unknown as ConstructorParameters<
    typeof ChatService
  >[0]);
  return chat as unknown as {
    activeSubagents: number;
    subagentWaiters: Array<() => void>;
    runPromises: Map<string, Promise<void>>;
    prepareSend: ReturnType<typeof vi.fn>;
    prepareSendWithSlot: (
      input: { sessionId: string; text: string },
      signal: AbortSignal,
    ) => Promise<{ runId: string }>;
    acquireSubagentSlot: (signal?: AbortSignal) => Promise<void>;
    releaseSubagentSlot: () => void;
    setAgentRuntimeSettings: ChatService["setAgentRuntimeSettings"];
  };
}

describe("Subagent concurrency", () => {
  it("reserves slots before waking queued work and never exceeds the limit", async () => {
    const chat = fixture();
    await Promise.all([chat.acquireSubagentSlot(), chat.acquireSubagentSlot()]);
    let started = 0;
    const queued = Array.from({ length: 6 }, () =>
      chat.acquireSubagentSlot().then(() => {
        started += 1;
      }),
    );
    expect(chat.activeSubagents).toBe(2);
    expect(chat.subagentWaiters).toHaveLength(6);
    chat.releaseSubagentSlot();
    await vi.waitFor(() => expect(started).toBe(1));
    expect(started).toBe(1);
    expect(chat.activeSubagents).toBe(2);
    expect(() => chat.setAgentRuntimeSettings({ maxConcurrentSubagents: 1 })).toThrow("新上限");
    for (let index = 0; index < 5; index += 1) {
      chat.releaseSubagentSlot();
      await Promise.resolve();
      expect(chat.activeSubagents).toBeLessThanOrEqual(2);
    }
    await Promise.all(queued);
    chat.releaseSubagentSlot();
    chat.releaseSubagentSlot();
    expect(chat.activeSubagents).toBe(0);
  });

  it("removes cancelled queued work and releases slots only after child execution ends", async () => {
    const chat = fixture(1);
    let finish!: () => void;
    chat.prepareSend = vi.fn(async () => {
      chat.runPromises.set(
        "child",
        new Promise<void>((done) => {
          finish = done;
        }),
      );
      return { runId: "child" };
    });
    await chat.prepareSendWithSlot(
      { sessionId: "child", text: "task" },
      new AbortController().signal,
    );
    expect(chat.activeSubagents).toBe(1);
    const controller = new AbortController();
    const waiting = chat.prepareSendWithSlot(
      { sessionId: "queued", text: "task" },
      controller.signal,
    );
    const rejected = expect(waiting).rejects.toThrow("取消");
    controller.abort();
    await rejected;
    expect(chat.subagentWaiters).toHaveLength(0);
    expect(chat.prepareSend).toHaveBeenCalledTimes(1);
    expect(chat.activeSubagents).toBe(1);
    finish();
    await Promise.resolve();
    expect(chat.activeSubagents).toBe(0);
  });

  it("passes the correct child depth into prompt assembly", async () => {
    const chat = new ChatService({
      appVersion: "1.2.3",
      promptDirectory: `${process.cwd()}/resources/prompts`,
      repository: {
        getSetting: () => null,
        getAgentProfile: () => null,
        listAgentProfiles: () => [],
        getMessages: () => [],
      },
      extensionService: {
        buildSessionContext: async () => ({ skills: [], mcpServers: [], text: "" }),
      },
      projectInstructionService: { discover: async () => [] },
      mcpService: { enabledServerNames: () => [] },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      buildSystemPrompt: (
        session: SessionView,
        model: unknown,
        runId: string,
        tools: unknown[],
      ) => Promise<string>;
    };
    const prompt = await internal.buildSystemPrompt(
      {
        id: "019ae23e-37d1-7e1f-8ed4-4dc56f380001",
        parentSessionId: "parent",
        workspacePath: null,
        permissionMode: "full_access",
        executionMode: "host",
        reasoningLevel: null,
      } as SessionView,
      {
        modelId: "fixture",
        contextWindow: 10000,
        maxOutputTokens: 1000,
        inputModalities: ["text"],
        toolCalls: true,
        parallelToolCalls: true,
      },
      "019ae23e-37d1-7e1f-8ed4-4dc56f380002",
      [],
    );
    expect(prompt).toMatch(/"agent_depth":\s*1/);
    expect(prompt).toContain("# 子 Agent 职责");
    expect(prompt).toContain("命令工具的工作区只读");
  });

  it.each([
    { role: "subagent", profileModelId: "dedicated-model", expectedModelId: "dedicated-model" },
    { role: "all", profileModelId: "dedicated-model", expectedModelId: "dedicated-model" },
    { role: "subagent", profileModelId: null, expectedModelId: "parent-model" },
    { role: "all", profileModelId: null, expectedModelId: "parent-model" },
  ] as const)("routes $role child runs to its configured or inherited model", async (testCase) => {
    const child = { id: "child", status: "idle" };
    const dedicatedModel = {
      id: "dedicated-model",
      providerId: "dedicated-provider",
      enabled: true,
    };
    const parentModel = { id: "parent-model", providerId: "parent-provider", enabled: true };
    const insertSession = vi.fn(() => child);
    const repository = {
      getAgentProfile: (id: string) =>
        id === "parent-profile" ? { id, permissions: {}, readOnly: false } : null,
      listAgentProfiles: () => [
        {
          id: "worker",
          name: "Worker",
          role: testCase.role,
          modelId: testCase.profileModelId,
          enabled: true,
          readOnly: false,
          permissions: {},
          toolAllowlist: [],
        },
      ],
      getModel: (id: string) =>
        id === dedicatedModel.id ? dedicatedModel : id === parentModel.id ? parentModel : null,
      getProvider: (id: string) => ({ id }),
      insertSession,
      listSessionExtensionIds: () => [],
      getSession: () => child,
      getMessages: () => [{ role: "assistant", parts: [{ type: "text", text: "Done" }] }],
    };
    const chat = new ChatService({
      repository,
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    Object.defineProperty(chat, "send", {
      value: vi.fn().mockResolvedValue({ runId: "child-run" }),
    });
    Object.defineProperty(chat, "waitForRun", { value: vi.fn().mockResolvedValue(undefined) });
    const internal = chat as unknown as {
      runSubagent: (
        session: SessionView,
        signal: AbortSignal,
        args: object,
      ) => Promise<{ output: string; isError: boolean }>;
    };

    await expect(
      internal.runSubagent(
        {
          id: "parent",
          agentProfileId: "parent-profile",
          providerId: parentModel.providerId,
          modelId: parentModel.id,
          workspacePath: null,
        } as SessionView,
        new AbortController().signal,
        { task: "inspect", agent: "worker" },
      ),
    ).resolves.toMatchObject({ output: "Done", isError: false });
    expect(insertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: "worker",
        providerId:
          testCase.expectedModelId === dedicatedModel.id
            ? dedicatedModel.providerId
            : parentModel.providerId,
        modelId: testCase.expectedModelId,
      }),
    );
  });

  it("runs SubagentStop through the parent session with child metadata", async () => {
    const child = { id: "child", status: "idle" };
    const runPluginHooks = vi.fn(async (..._args: unknown[]) => undefined);
    const chat = new ChatService({
      repository: {
        getAgentProfile: (id: string) =>
          id === "parent-profile"
            ? { id, permissions: {}, readOnly: false }
            : {
                id: "worker",
                name: "Worker",
                role: "subagent",
                modelId: null,
                enabled: true,
                readOnly: false,
                permissions: {},
                toolAllowlist: [],
              },
        listAgentProfiles: () => [
          {
            id: "worker",
            name: "Worker",
            role: "subagent",
            modelId: null,
            enabled: true,
            readOnly: false,
            permissions: {},
            toolAllowlist: [],
          },
        ],
        getModel: () => ({ id: "model", providerId: "provider", enabled: true }),
        getProvider: () => ({ id: "provider" }),
        insertSession: () => child,
        listSessionExtensionIds: () => [],
        getSession: () => child,
        getMessages: () => [
          { role: "assistant", parts: [{ type: "text", text: "Child finished" }] },
        ],
      },
      pluginHookService: {},
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    Object.defineProperty(chat, "send", {
      value: vi.fn().mockResolvedValue({ runId: "child-run" }),
    });
    Object.defineProperty(chat, "waitForRun", { value: vi.fn().mockResolvedValue(undefined) });
    const internal = chat as unknown as {
      runPluginHooks: (...args: unknown[]) => Promise<void>;
      runSubagent: (
        session: SessionView,
        signal: AbortSignal,
        args: object,
        parentRunId?: string,
      ) => Promise<{ output: string; isError: boolean }>;
    };
    internal.runPluginHooks = runPluginHooks;
    const signal = new AbortController().signal;
    const parent = {
      id: "parent",
      agentProfileId: "parent-profile",
      agentMode: "code",
      providerId: "provider",
      modelId: "model",
      workspacePath: process.cwd(),
      permissionMode: "full_access",
      executionMode: "host",
      parentSessionId: null,
      status: "running",
    } as SessionView;

    await expect(
      internal.runSubagent(parent, signal, { task: "inspect", agent: "worker" }, "parent-run"),
    ).resolves.toEqual({ output: "Child finished", isError: false, childSessionId: "child" });
    expect(runPluginHooks).toHaveBeenCalledExactlyOnceWith(
      "SubagentStop",
      parent,
      "parent-run",
      signal,
      expect.objectContaining({
        agentId: "child",
        metadata: expect.objectContaining({
          childSessionId: "child",
          status: "idle",
          output: "Child finished",
        }),
      }),
    );
  });

  it("keeps a subagent active under the parent cancellation signal without a wall-clock deadline", async () => {
    const child = { id: "child", status: "running" };
    const parentController = new AbortController();
    let childSignal: AbortSignal | undefined;
    const chat = new ChatService({
      repository: {
        getAgentProfile: () => ({ id: "parent-profile", readOnly: false, permissions: {} }),
        listAgentProfiles: () => [
          {
            id: "worker",
            name: "Worker",
            role: "subagent",
            modelId: null,
            enabled: true,
            readOnly: false,
            permissions: {},
            toolAllowlist: [],
          },
        ],
        getModel: () => ({ id: "model", providerId: "provider", enabled: true }),
        getProvider: () => ({ id: "provider" }),
        insertSession: () => child,
        listSessionExtensionIds: () => [],
        getSession: () => child,
        getMessages: () => [],
      },
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    Object.defineProperty(chat, "send", {
      value: vi.fn(async (_input: object, signal: AbortSignal) => {
        childSignal = signal;
        return { runId: "child-run" };
      }),
    });
    Object.defineProperty(chat, "waitForRun", {
      value: vi.fn(
        (_runId: string, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            const abort = () => reject(signal.reason);
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          }),
      ),
    });
    const internal = chat as unknown as {
      runSubagent: (
        session: SessionView,
        signal: AbortSignal,
        args: object,
      ) => Promise<{ output: string; isError: boolean }>;
    };
    const running = internal.runSubagent(
      {
        id: "parent",
        agentProfileId: "parent-profile",
        providerId: "provider",
        modelId: "model",
        workspacePath: null,
      } as SessionView,
      parentController.signal,
      { task: "long investigation", agent: "worker" },
    );
    await vi.waitFor(() => expect(childSignal).toBe(parentController.signal));
    expect(childSignal?.aborted).toBe(false);
    parentController.abort(new Error("parent stopped"));
    await expect(running).resolves.toMatchObject({ isError: true });
  });

  it("rejects recursive delegation and writable children from read-only parents", async () => {
    const chat = new ChatService({
      repository: {
        getAgentProfile: () => ({ readOnly: true, permissions: {}, toolAllowlist: [] }),
        listAgentProfiles: () => [
          { id: "general", role: "subagent", enabled: true, readOnly: false },
        ],
      },
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      executeToolCall: (input: object) => Promise<{ output: string; isError: boolean }>;
      runSubagent: (
        session: SessionView,
        signal: AbortSignal,
        args: object,
      ) => Promise<{ output: string; isError: boolean }>;
    };
    const signal = new AbortController().signal;
    for (const name of ["spawn_subagent", "wait_subagents"]) {
      expect(
        await internal.executeToolCall({
          session: { parentSessionId: "parent" },
          runId: "run",
          signal,
          toolCall: { name, arguments: "{}" },
        }),
      ).toMatchObject({ isError: true });
    }
    const result = await internal.runSubagent(
      { providerId: "provider", modelId: "model" } as SessionView,
      signal,
      { task: "inspect", agent: "general" },
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("只读子 Agent");
  });

  it("rejects a disabled dedicated model instead of inheriting the parent model", async () => {
    const insertSession = vi.fn();
    const chat = new ChatService({
      repository: {
        getAgentProfile: () => ({ id: "parent-profile", readOnly: false, permissions: {} }),
        listAgentProfiles: () => [
          {
            id: "worker",
            name: "Worker",
            role: "subagent",
            modelId: "disabled-model",
            enabled: true,
            readOnly: false,
            permissions: {},
            toolAllowlist: [],
          },
        ],
        getModel: (id: string) =>
          id === "disabled-model"
            ? { id, providerId: "disabled-provider", enabled: false }
            : { id, providerId: "parent-provider", enabled: true },
        getProvider: (id: string) => ({ id }),
        insertSession,
      },
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      runSubagent: (
        session: SessionView,
        signal: AbortSignal,
        args: object,
      ) => Promise<{ output: string; isError: boolean }>;
    };

    const result = await internal.runSubagent(
      {
        id: "parent",
        agentProfileId: "parent-profile",
        providerId: "parent-provider",
        modelId: "parent-model",
        workspacePath: null,
      } as SessionView,
      new AbortController().signal,
      { task: "inspect", agent: "worker" },
    );
    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain("指定的模型不可用");
    expect(insertSession).not.toHaveBeenCalled();
  });

  it("blocks inherited plugin hooks for writable General children and retains root hooks", async () => {
    const run = vi.fn(async () => []);
    const emit = vi.fn();
    const chat = new ChatService({
      repository: {
        getSetting: () => null,
        getAgentProfile: () => ({ id: "general", readOnly: false }),
        listSessionExtensionIds: () => ["inherited-plugin"],
        getExtension: () => ({ id: "inherited-plugin", enabled: true, type: "plugin" }),
      },
      pluginHookService: { run },
      toolRegistry: {},
      emit,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      runPluginHooks: (
        event: "PreToolUse" | "PostToolUse" | "Stop" | "SubagentStop" | "Interrupt",
        session: SessionView,
        runId: string,
        signal: AbortSignal,
      ) => Promise<void>;
    };
    const signal = new AbortController().signal;
    const child = {
      id: "child",
      parentSessionId: "parent",
      agentProfileId: "general",
      workspacePath: process.cwd(),
      title: "General child",
      permissionMode: "full_access",
      executionMode: "host",
    } as SessionView;
    for (const event of ["Stop", "SubagentStop", "Interrupt"] as const) {
      await internal.runPluginHooks(event, child, "child-run", signal);
    }
    expect(run).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();

    const root = { ...child, id: "parent", parentSessionId: null };
    await internal.runPluginHooks("Stop", root, "root-run", signal);
    expect(run).toHaveBeenCalledExactlyOnceWith(
      "Stop",
      root,
      "root-run",
      signal,
      expect.any(Function),
      {},
    );
    expect(emit).not.toHaveBeenCalled();
  });
});
