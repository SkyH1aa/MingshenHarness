import { describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { type ChatRunOutcome, ChatService } from "./chat-service";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

type ChatLifecycle = {
  activeExecutions: Map<string, Promise<unknown>>;
  activeRuns: Map<string, AbortController>;
  closing: boolean;
  contextCompaction: {
    finishRun: (sessionId: string) => void;
    prepare: (...args: unknown[]) => Promise<void>;
  };
  deferRunSettlement: (input: {
    sessionId: string;
    runId: string;
    outcome: ChatRunOutcome;
    isSubagent: boolean;
  }) => void;
  flushRunSettlement: (sessionId: string) => void;
  pendingRunSettlements: Map<string, unknown>;
  preparingControllers: Map<string, AbortController>;
  preparingSends: Map<string, Promise<{ runId: string }>>;
  prepareSendWithSlot: (...args: unknown[]) => Promise<{ runId: string }>;
  removingSessions: Map<string, Promise<void>>;
  runPromises: Map<string, Promise<unknown>>;
  startMentionedSubagentRun: (input: {
    parent: SessionView;
    childSessionId: string;
    text: string;
    attachments: [];
    signal: AbortSignal;
    draftSessionId: string;
  }) => Promise<{ runId: string }>;
};

function createChat(options: Record<string, unknown> = {}) {
  return new ChatService({
    repository: {},
    providerService: {},
    agentProfileService: {},
    promptDirectory: process.cwd(),
    emit: vi.fn(),
    approvalBroker: { cancelSession: vi.fn() },
    questionBroker: { cancelSession: vi.fn() },
    ...options,
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
}

function lifecycle(chat: ChatService): ChatLifecycle {
  return chat as unknown as ChatLifecycle;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createMentionDispatchChat(options: Record<string, unknown> = {}) {
  const parent = {
    id: "parent",
    title: "Parent",
    providerId: "provider",
    modelId: "model",
    agentProfileId: "primary",
    agentMode: "code",
    workspacePath: null,
    systemPrompt: "",
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
    status: "idle",
  } as SessionView;
  const child = {
    ...parent,
    id: "child",
    parentSessionId: "parent",
    agentProfileId: "worker",
  } as SessionView;
  const parentProfile = {
    id: "primary",
    name: "primary",
    role: "primary",
    enabled: true,
    applicableModes: ["code"],
    permissions: {},
    toolAllowlist: [],
    readOnly: false,
  };
  const worker = {
    id: "worker",
    name: "worker",
    role: "subagent",
    enabled: true,
    applicableModes: ["code"],
    permissions: {},
    toolAllowlist: [],
    readOnly: false,
    modelId: null,
  };
  const repository = {
    getSession: (sessionId: string) =>
      sessionId === parent.id ? parent : sessionId === child.id ? child : null,
    getMessages: () => [],
    listAgentProfiles: () => [parentProfile, worker],
    getAgentProfile: () => parentProfile,
    getModel: () => ({
      id: "model",
      providerId: "provider",
      enabled: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
    }),
    getProvider: () => ({ id: "provider" }),
    insertSession: () => child,
    listSessionExtensionIds: () => [],
  };
  const chat = createChat({
    repository,
    agentProfileService: { syncWorkspace: vi.fn(async () => undefined) },
    ...options,
  });
  return { chat, parent, child };
}

describe("queued prompt run lifecycle", () => {
  it("holds an ultra-short settlement until preparingSends has been cleared", async () => {
    let preparingDuringCallback: boolean | null = null;
    const onRunSettled = vi.fn(() => {
      preparingDuringCallback = active.preparingSends.has("session");
    });
    const chat = new ChatService({
      repository: {},
      providerService: {},
      agentProfileService: {},
      promptDirectory: process.cwd(),
      emit: vi.fn(),
      onRunSettled,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const active = lifecycle(chat);
    vi.spyOn(active, "prepareSendWithSlot").mockImplementation(() =>
      Promise.resolve().then(() => {
        active.deferRunSettlement({
          sessionId: "session",
          runId: "short-run",
          outcome: "completed",
          isSubagent: false,
        });
        return { runId: "short-run" };
      }),
    );

    await chat.send({ sessionId: "session", text: "short" });

    expect(onRunSettled).toHaveBeenCalledExactlyOnceWith({
      sessionId: "session",
      runId: "short-run",
      outcome: "completed",
    });
    expect(preparingDuringCallback).toBe(false);
    expect(active.preparingSends.size).toBe(0);
    expect(active.preparingControllers.size).toBe(0);
    expect(active.pendingRunSettlements.size).toBe(0);
  });

  it.each(["completed", "failed", "interrupted"] as const)(
    "forwards the %s outcome after cleanup",
    (outcome) => {
      const onRunSettled = vi.fn();
      const chat = createChat({ onRunSettled });
      const internal = lifecycle(chat);

      internal.deferRunSettlement({
        sessionId: "session",
        runId: `run-${outcome}`,
        outcome,
        isSubagent: false,
      });

      expect(onRunSettled).toHaveBeenCalledExactlyOnceWith({
        sessionId: "session",
        runId: `run-${outcome}`,
        outcome,
      });
    },
  );

  it("contains settlement callback failures", () => {
    const chat = createChat({
      onRunSettled: () => {
        throw new Error("queue callback failed");
      },
    });

    expect(() =>
      lifecycle(chat).deferRunSettlement({
        sessionId: "session",
        runId: "callback-error",
        outcome: "completed",
        isSubagent: false,
      }),
    ).not.toThrow();
  });

  it("notifies Stop before aborting the parent and child runs", () => {
    const events: string[] = [];
    const chat = new ChatService({
      repository: {
        listChildSessions: (sessionId: string) => (sessionId === "parent" ? [{ id: "child" }] : []),
      },
      approvalBroker: { cancelSession: vi.fn() },
      questionBroker: { cancelSession: vi.fn() },
      onRunStopped: (sessionId: string) => events.push(`notify:${sessionId}`),
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = lifecycle(chat);
    const parent = new AbortController();
    const child = new AbortController();
    parent.signal.addEventListener("abort", () => events.push("abort:parent"));
    child.signal.addEventListener("abort", () => events.push("abort:child"));
    internal.activeRuns.set("parent", parent);
    internal.activeRuns.set("child", child);

    chat.stop("parent");

    expect(events).toEqual(["notify:parent", "abort:parent", "notify:child", "abort:child"]);
  });

  it("contains Stop callback failures", () => {
    const chat = createChat({
      onRunStopped: () => {
        throw new Error("pause failed");
      },
    });

    expect(() => chat.stop("session")).not.toThrow();
  });

  it("does not settle SubAgent runs or sessions that are closing or being removed", () => {
    const onRunSettled = vi.fn();
    const chat = createChat({ onRunSettled });
    const internal = lifecycle(chat);

    internal.deferRunSettlement({
      sessionId: "child",
      runId: "child-run",
      outcome: "completed",
      isSubagent: true,
    });
    internal.removingSessions.set("removing", Promise.resolve());
    internal.deferRunSettlement({
      sessionId: "removing",
      runId: "removing-run",
      outcome: "completed",
      isSubagent: false,
    });
    internal.closing = true;
    internal.deferRunSettlement({
      sessionId: "closing",
      runId: "closing-run",
      outcome: "completed",
      isSubagent: false,
    });

    expect(onRunSettled).not.toHaveBeenCalled();
  });

  it("keeps ordinary direct @SubAgent dispatch free of the queue parent lock", async () => {
    const onDelegatedSubagentRunStarted = vi.fn();
    const { chat } = createMentionDispatchChat({
      onDelegatedSubagentRunStarted,
    });
    const internal = lifecycle(chat);
    const delegated = vi.spyOn(internal, "startMentionedSubagentRun");
    const originalSend = chat.send.bind(chat);
    const send = vi
      .spyOn(chat, "send")
      .mockImplementation(async (input, parentSignal, resumePlan, draftSessionId) => {
        if (input.sessionId === "child") {
          internal.runPromises.set("ordinary-child-run", Promise.resolve("completed"));
          return { runId: "ordinary-child-run" };
        }
        return originalSend(input, parentSignal, resumePlan, draftSessionId);
      });

    const result = await chat.send({ sessionId: "parent", text: "@worker inspect" });

    expect(result).toEqual({ runId: "ordinary-child-run" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "child", text: "inspect" }),
      expect.any(AbortSignal),
      false,
      "parent",
    );
    expect(delegated).not.toHaveBeenCalled();
    expect(onDelegatedSubagentRunStarted).not.toHaveBeenCalled();
    expect(internal.activeRuns.has("parent")).toBe(false);
  });

  it("routes sendQueuedPrompt direct @SubAgent through delegated tracking", async () => {
    const { chat } = createMentionDispatchChat();
    const internal = lifecycle(chat);
    const delegated = vi
      .spyOn(internal, "startMentionedSubagentRun")
      .mockResolvedValue({ runId: "queued-child-run" });

    await expect(
      chat.sendQueuedPrompt({ sessionId: "parent", text: "@worker inspect" }),
    ).resolves.toEqual({ runId: "queued-child-run" });

    expect(delegated).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: expect.objectContaining({ id: "parent" }),
        childSessionId: "child",
        text: "inspect",
      }),
    );
    expect(internal.activeRuns.has("parent")).toBe(false);
  });

  it("tracks a direct @SubAgent through child cleanup without faking parent run events", async () => {
    const events: string[] = [];
    const emit = vi.fn();
    const childCompletion = deferred<ChatRunOutcome>();
    const onRunSettled = vi.fn(() => events.push("settled"));
    const chat = createChat({
      emit,
      onRunSettled,
      onDelegatedSubagentRunStarted: vi.fn(() => events.push("delegated-started")),
    });
    const internal = lifecycle(chat);
    vi.spyOn(chat, "send").mockImplementation(async (input) => {
      expect(input.sessionId).toBe("child");
      internal.runPromises.set("child-run", childCompletion.promise);
      return { runId: "child-run" };
    });

    const started = await internal.startMentionedSubagentRun({
      parent: { id: "parent" } as SessionView,
      childSessionId: "child",
      text: "inspect the queue",
      attachments: [],
      signal: new AbortController().signal,
      draftSessionId: "parent",
    });
    const tracking = internal.activeExecutions.get("parent");

    expect(started).toEqual({ runId: "child-run" });
    expect(events).toEqual(["delegated-started"]);
    expect(internal.activeRuns.has("parent")).toBe(true);
    expect(tracking).toBeDefined();
    expect(emit).not.toHaveBeenCalled();
    expect(onRunSettled).not.toHaveBeenCalled();

    childCompletion.resolve("completed");
    await tracking;

    expect(events).toEqual(["delegated-started", "settled"]);
    expect(onRunSettled).toHaveBeenCalledExactlyOnceWith({
      sessionId: "parent",
      runId: "child-run",
      outcome: "completed",
    });
    expect(internal.activeRuns.has("parent")).toBe(false);
    expect(internal.activeExecutions.has("parent")).toBe(false);
  });

  it("defers a fast delegated completion until the parent preparing send is released", async () => {
    const onRunSettled = vi.fn();
    const chat = createChat({ onRunSettled });
    const internal = lifecycle(chat);
    internal.preparingSends.set("parent", new Promise(() => undefined));
    const childCompletion = deferred<ChatRunOutcome>();
    vi.spyOn(chat, "send").mockImplementation(async () => {
      internal.runPromises.set("child-run", childCompletion.promise);
      return { runId: "child-run" };
    });

    const started = await internal.startMentionedSubagentRun({
      parent: { id: "parent" } as SessionView,
      childSessionId: "child",
      text: "fast task",
      attachments: [],
      signal: new AbortController().signal,
      draftSessionId: "parent",
    });
    const tracking = internal.activeExecutions.get("parent");
    childCompletion.resolve("completed");
    await tracking;

    expect(started).toEqual({ runId: "child-run" });
    expect(onRunSettled).not.toHaveBeenCalled();
    expect(internal.pendingRunSettlements.has("parent")).toBe(true);

    internal.preparingSends.delete("parent");
    internal.flushRunSettlement("parent");

    expect(onRunSettled).toHaveBeenCalledExactlyOnceWith({
      sessionId: "parent",
      runId: "child-run",
      outcome: "completed",
    });
  });

  it.each(["failed", "interrupted"] as const)(
    "settles a delegated %s only after the child cleanup",
    async (outcome) => {
      const onRunSettled = vi.fn();
      const chat = createChat({ onRunSettled });
      const internal = lifecycle(chat);
      const childCompletion = deferred<ChatRunOutcome>();
      vi.spyOn(chat, "send").mockImplementation(async () => {
        internal.runPromises.set("child-run", childCompletion.promise);
        return { runId: "child-run" };
      });

      await internal.startMentionedSubagentRun({
        parent: { id: "parent" } as SessionView,
        childSessionId: "child",
        text: "failing task",
        attachments: [],
        signal: new AbortController().signal,
        draftSessionId: "parent",
      });
      const tracking = internal.activeExecutions.get("parent");
      childCompletion.resolve(outcome);
      await tracking;

      expect(onRunSettled).toHaveBeenCalledExactlyOnceWith({
        sessionId: "parent",
        runId: "child-run",
        outcome,
      });
    },
  );

  it("aborts a delegated child on parent Stop and keeps the parent queue paused", async () => {
    const onRunStopped = vi.fn();
    const onRunSettled = vi.fn();
    const chat = createChat({
      repository: {
        listChildSessions: (sessionId: string) => (sessionId === "parent" ? [{ id: "child" }] : []),
      },
      onRunStopped,
      onRunSettled,
    });
    const internal = lifecycle(chat);
    const childCompletion = deferred<ChatRunOutcome>();
    let childSignal: AbortSignal | undefined;
    vi.spyOn(chat, "send").mockImplementation(async (_input, signal) => {
      childSignal = signal;
      internal.runPromises.set("child-run", childCompletion.promise);
      return { runId: "child-run" };
    });

    await internal.startMentionedSubagentRun({
      parent: { id: "parent" } as SessionView,
      childSessionId: "child",
      text: "stoppable task",
      attachments: [],
      signal: new AbortController().signal,
      draftSessionId: "parent",
    });
    const tracking = internal.activeExecutions.get("parent");

    chat.stop("parent");
    expect(onRunStopped).toHaveBeenCalledWith("parent");
    expect(childSignal?.aborted).toBe(true);

    childCompletion.resolve("interrupted");
    await tracking;

    expect(onRunSettled).toHaveBeenCalledExactlyOnceWith({
      sessionId: "parent",
      runId: "child-run",
      outcome: "interrupted",
    });
  });

  it("blocks a concurrent direct delegation and suppresses settlement during shutdown", async () => {
    const onRunSettled = vi.fn();
    const chat = createChat({ onRunSettled });
    const internal = lifecycle(chat);
    const childCompletion = deferred<ChatRunOutcome>();
    vi.spyOn(chat, "send").mockImplementation(async () => {
      internal.runPromises.set("child-run", childCompletion.promise);
      return { runId: "child-run" };
    });
    const input = {
      parent: { id: "parent" } as SessionView,
      childSessionId: "child",
      text: "exclusive task",
      attachments: [] as [],
      signal: new AbortController().signal,
      draftSessionId: "parent",
    };

    await internal.startMentionedSubagentRun(input);
    await expect(internal.startMentionedSubagentRun(input)).rejects.toThrow(
      "该会话正在运行，请先停止或等待完成。",
    );
    const tracking = internal.activeExecutions.get("parent");
    internal.closing = true;
    childCompletion.resolve("completed");
    await tracking;

    expect(onRunSettled).not.toHaveBeenCalled();
    expect(internal.activeRuns.has("parent")).toBe(false);
    expect(internal.activeExecutions.has("parent")).toBe(false);
  });

  it("settles compaction after cleanup for queue runId correlation", async () => {
    const session = {
      id: "compact-session",
      title: "Compact fixture",
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      agentMode: "code",
      workspacePath: null,
      systemPrompt: "",
      permissionMode: "request_approval",
      executionMode: "host",
      status: "idle",
    } as SessionView;
    const events: unknown[] = [];
    const onRunSettled = vi.fn();
    const repository = {
      getSession: () => session,
      getProvider: () => ({ id: "provider" }),
      getModel: () => ({
        id: "model",
        providerId: "provider",
        enabled: true,
        inputModalities: ["text"],
        outputModalities: ["text"],
      }),
      getMessages: () => [{ id: "one" }, { id: "two" }],
      getAgentProfile: () => null,
      updateSession: (_sessionId: string, patch: Record<string, unknown>) => ({
        ...session,
        ...patch,
      }),
    };
    const chat = createChat({
      repository,
      onRunSettled,
      emit: (event: unknown) => events.push(event),
    });
    const internal = lifecycle(chat);
    internal.contextCompaction.prepare = vi.fn(async () => undefined);
    internal.contextCompaction.finishRun = vi.fn();

    const { runId } = chat.compactSession(session.id);
    const completion = internal.activeExecutions.get(session.id);
    expect(completion).toBeDefined();
    await completion;

    expect(onRunSettled).toHaveBeenCalledExactlyOnceWith({
      sessionId: session.id,
      runId,
      outcome: "completed",
    });
    expect(events).toContainEqual({
      type: "run_completed",
      sessionId: session.id,
      runId,
      kind: "compaction",
    });
  });

  it("reports failed when compaction cleanup throws after run_completed", async () => {
    const session = {
      id: "compact-cleanup-session",
      title: "Compact cleanup fixture",
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      agentMode: "code",
      workspacePath: null,
      systemPrompt: "",
      permissionMode: "request_approval",
      executionMode: "host",
      status: "idle",
    } as SessionView;
    const onRunSettled = vi.fn();
    const chat = createChat({
      repository: {
        getSession: () => session,
        getProvider: () => ({ id: "provider" }),
        getModel: () => ({
          id: "model",
          providerId: "provider",
          enabled: true,
          inputModalities: ["text"],
          outputModalities: ["text"],
        }),
        getMessages: () => [{ id: "one" }, { id: "two" }],
        getAgentProfile: () => null,
        updateSession: (_sessionId: string, patch: Record<string, unknown>) => ({
          ...session,
          ...patch,
        }),
      },
      onRunSettled,
    });
    const internal = lifecycle(chat);
    internal.contextCompaction.prepare = vi.fn(async () => undefined);
    internal.contextCompaction.finishRun = vi.fn(() => {
      throw new Error("cleanup failed");
    });

    const { runId } = chat.compactSession(session.id);
    const completion = internal.activeExecutions.get(session.id);
    expect(completion).toBeDefined();
    await completion;

    expect(onRunSettled).toHaveBeenCalledExactlyOnceWith({
      sessionId: session.id,
      runId,
      outcome: "failed",
    });
  });
});
