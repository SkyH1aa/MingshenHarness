import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatSendInput, ChatStreamEvent, SessionTodo, SessionView } from "../../shared/domain";
import { ApprovalBroker } from "../permissions/approval-broker";
import { PermissionStore } from "../permissions/permission-store";
import { ManagedPolicyError, ManagedPolicyService } from "../policy/managed-policy-service";
import { RuntimeIdempotencyConflictError, RuntimeService } from "../runtime/runtime-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import type { ToolExecutionResult } from "../tools/tool-registry";
import { PlanClaimService } from "../workbench/plan-claim-service";
import { ChatService } from "./chat-service";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const encoder = new TextEncoder();
const sse = (...events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

function heldResponse(text: string) {
  const started = deferred<AbortSignal>();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let finished = false;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      controller.enqueue(encoder.encode(sse({ type: "response.output_text.delta", delta: text })));
    },
  });
  return {
    started: started.promise,
    respond(signal: AbortSignal) {
      started.resolve(signal);
      signal.addEventListener(
        "abort",
        () => {
          if (finished) return;
          finished = true;
          controller.error(signal.reason ?? new Error("aborted"));
        },
        { once: true },
      );
      return new Response(stream);
    },
    complete() {
      if (finished) throw new Error("Held stream already finished.");
      finished = true;
      controller.enqueue(
        encoder.encode(
          sse({ type: "response.completed", response: { status: "completed", output: [] } }),
        ),
      );
      controller.close();
    },
  };
}

interface FixtureOptions {
  managedPolicyPath?: string | undefined;
  syncWorkspace?: (() => Promise<void>) | undefined;
  workspacePath?: string | null | undefined;
}

function fixture(options: FixtureOptions = {}) {
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Governance fixture",
    baseUrl: "https://fixture.invalid/v1",
    protocol: "openai_responses",
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "governance-fixture",
    displayName: "Governance fixture",
    contextWindow: 128_000,
    maxOutputTokens: 2_048,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository.getProvider(provider.id)?.models[0];
  if (!model) throw new Error("Fixture model missing.");
  const session = repository.insertSession({
    title: "Governance fixture",
    providerId: provider.id,
    modelId: model.id,
    agentProfileId: "mingshen",
    workspacePath: options.workspacePath ?? null,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
  });
  const events: ChatStreamEvent[] = [];
  const runtime = new RuntimeService(database, repository);
  const planClaims = new PlanClaimService(database, repository);
  const managedPolicy = options.managedPolicyPath
    ? new ManagedPolicyService(repository, {
        machinePolicyPath: options.managedPolicyPath,
      })
    : undefined;
  const syncWorkspace = vi.fn(options.syncWorkspace ?? (async () => undefined));
  const confirmRunStopped = vi.fn();
  const emit = vi.fn((event: ChatStreamEvent) => {
    events.push(event);
    runtime.recordEvent(event);
  });
  const approvalBroker = new ApprovalBroker((state) => emit({ type: "approval_state", state }));
  const chat = new ChatService({
    repository,
    runtimeService: runtime,
    ...(managedPolicy ? { managedPolicy } : {}),
    planClaims,
    providerService: { getActiveApiKey: () => "fixture" },
    agentProfileService: { syncWorkspace },
    customCommandService: { prepare: vi.fn(async () => null) },
    toolRegistry: {
      descriptors: () => [],
      hasRunningCommands: () => false,
      commandSessions: () => [],
      cancelRun: async () => undefined,
      confirmRunStopped,
      invalidateCache: vi.fn(),
    },
    approvalBroker,
    permissions: new PermissionStore(),
    questionBroker: {
      cancelSession: vi.fn(),
      list: () => [],
    },
    mcpService: {
      list: () => [],
      toolDefinitions: async () => [],
    },
    emit,
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    availableTools: ReturnType<typeof vi.fn>;
    buildSystemPrompt: ReturnType<typeof vi.fn>;
    executeOwnedToolCall: ReturnType<typeof vi.fn>;
    executeToolCall: (input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      toolCall: {
        index: number;
        callId: string;
        name: string;
        arguments: string;
      };
      onOutcomeSettled?: (result: {
        output: string;
        isError: boolean;
        outcome?: {
          validation: { status: string };
          effect: string;
        };
      }) => void;
    }) => Promise<{
      output: string;
      isError: boolean;
      outcome?: {
        validation: { status: string };
        effect: string;
      };
    }>;
    performToolCall: (input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      toolCall: {
        index: number;
        callId: string;
        name: string;
        arguments: string;
      };
    }) => Promise<{
      output: string;
      isError: boolean;
      outcome?: {
        validation: { status: string };
        effect: string;
      };
    }>;
    executionSafety: {
      begin: (sessionId: string, runId: string) => void;
      finish: (runId: string) => void;
    };
    runPluginHooks: (
      event: string,
      session: SessionView,
      runId: string,
      signal: AbortSignal,
      payload: Record<string, unknown>,
    ) => Promise<void>;
    runHostTool: (
      session: SessionView,
      runId: string,
      signal: AbortSignal,
      name: string,
      args: Record<string, unknown>,
    ) => Promise<ToolExecutionResult>;
    workspaceBarrierKey: (session: SessionView) => string | null;
    acceptedRunIds: Map<string, string>;
    activeRuns: Map<string, AbortController>;
    activeToolCalls: Map<string, number>;
    delegatedRunIds: Map<string, string>;
    commandEffects: Map<string, Map<string, unknown>>;
    fileLocks: import("../workspace/file-lock-service").FileLockService;
    runPromises: Map<string, Promise<unknown>>;
    activePlanStepClaims: Map<
      string,
      Map<string, { claimId: string; sessionId: string; heartbeat: ReturnType<typeof setInterval> }>
    >;
    subagentPromptPlugins: Map<string, { parentRunId: string; extensionIds: Set<string> }>;
    settleRunPlanStepClaims: (
      runId: string,
      outcome: "completed" | "failed" | "interrupted",
      cleanupFailed: boolean,
    ) => boolean;
  };
  internal.availableTools = vi.fn(async () => []);
  internal.buildSystemPrompt = vi.fn(async () => "Runtime governance fixture");
  chat.setModelRetrySettings({ maxRetries: 0 });

  return {
    chat,
    database,
    events,
    approvalBroker,
    confirmRunStopped,
    internal,
    managedPolicy,
    model,
    planClaims,
    provider,
    repository,
    runtime,
    session,
    syncWorkspace,
    async runCompletion(runId: string): Promise<unknown> {
      const completion = internal.runPromises.get(runId);
      if (!completion) throw new Error(`Run completion missing for ${runId}.`);
      return await completion;
    },
    async close() {
      chat.stop(session.id);
      await Promise.allSettled([...internal.runPromises.values()]);
      await chat.shutdown();
      database.close();
    },
  };
}

function messageText(message: ReturnType<Repository["getMessages"]>[number]): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function todo(id: string): SessionTodo {
  return {
    id,
    content: `Complete ${id}`,
    status: "pending",
    priority: "medium",
    updatedAt: new Date().toISOString(),
    dependsOn: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runtime governance integration", () => {
  it("durably accepts the run before workspace preparation begins", async () => {
    let observedRunId: string | undefined;
    let observedStatus: string | undefined;
    let observedAcceptances = 0;
    const f = fixture({
      syncWorkspace: async () => {
        const run = f.runtime.listRuns(f.session.id)[0];
        observedRunId = run?.runId;
        observedStatus = run?.status;
        observedAcceptances = f.runtime.snapshot(f.session.id).acceptances.length;
      },
    });
    const held = heldResponse("Accepted before preparation");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => held.respond(init.signal as AbortSignal)),
    );
    try {
      const accepted = await f.chat.send({
        sessionId: f.session.id,
        text: "Prepare the workspace",
      });
      await held.started;
      expect(observedRunId).toBe(accepted.runId);
      expect(observedStatus).toBe("preparing");
      expect(observedAcceptances).toBe(1);
      expect(
        f.events
          .flatMap((event) =>
            event.type === "runtime_run_updated" && event.runId === accepted.runId
              ? [event.run.status]
              : [],
          )
          .slice(0, 2),
      ).toEqual(["accepted", "preparing"]);
      expect(f.runtime.getRun(accepted.runId).status).toBe("running");

      held.complete();
      await f.runCompletion(accepted.runId);
      expect(f.runtime.getRun(accepted.runId).status).toBe("completed");
    } finally {
      await f.close();
    }
  });

  it("deduplicates a request before execution and rejects key reuse for different content", async () => {
    const f = fixture();
    const held = heldResponse("One execution");
    const fetcher = vi.fn(async (_url: string, init: RequestInit) =>
      held.respond(init.signal as AbortSignal),
    );
    vi.stubGlobal("fetch", fetcher);
    const input: ChatSendInput = {
      sessionId: f.session.id,
      text: "Create the report exactly once",
      idempotencyKey: "governance-idempotency-key",
    };
    try {
      const first = await f.chat.send(input);
      await held.started;
      await expect(f.chat.send(input)).resolves.toEqual(first);
      await expect(
        f.chat.send({
          ...input,
          text: "A different request must conflict",
        }),
      ).rejects.toBeInstanceOf(RuntimeIdempotencyConflictError);
      expect(f.runtime.listRuns(f.session.id)).toHaveLength(1);
      expect(f.runtime.snapshot(f.session.id).acceptances).toHaveLength(1);
      expect(
        f.repository
          .getMessages(f.session.id)
          .filter((message) => message.role === "user" && messageText(message).includes("report")),
      ).toHaveLength(1);

      held.complete();
      await f.runCompletion(first.runId);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await f.close();
    }
  });

  it("binds cancellation to the requested run instead of a newer run in the same session", async () => {
    const f = fixture();
    const oldResponse = heldResponse("Old run");
    const newResponse = heldResponse("New run");
    let request = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        request += 1;
        return request === 1
          ? oldResponse.respond(init.signal as AbortSignal)
          : newResponse.respond(init.signal as AbortSignal);
      }),
    );
    try {
      const oldRun = await f.chat.send({ sessionId: f.session.id, text: "Old request" });
      const oldSignal = await oldResponse.started;
      expect(f.chat.stopRun(oldRun.runId)).toBe(true);
      await f.runCompletion(oldRun.runId);
      expect(oldSignal.aborted).toBe(true);
      expect(f.runtime.getRun(oldRun.runId).status).toBe("interrupted");

      const newRun = await f.chat.send({ sessionId: f.session.id, text: "New request" });
      const newSignal = await newResponse.started;
      expect(f.chat.stopRun(oldRun.runId)).toBe(false);
      expect(newSignal.aborted).toBe(false);
      expect(f.runtime.getRun(newRun.runId).status).toBe("running");

      newResponse.complete();
      await f.runCompletion(newRun.runId);
      expect(f.runtime.getRun(newRun.runId).status).toBe("completed");
    } finally {
      await f.close();
    }
  });

  it("marks a cancelled preparation as interrupted without sending a model request", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const f = fixture({
      syncWorkspace: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      const pending = f.chat.send({ sessionId: f.session.id, text: "Cancel during preparation" });
      const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await entered.promise;
      const run = f.runtime.listRuns(f.session.id)[0];
      expect(run?.status).toBe("preparing");
      expect(f.chat.stopRun(run?.runId ?? "")).toBe(true);
      release.resolve();
      await rejected;
      expect(f.runtime.getRun(run?.runId ?? "").status).toBe("interrupted");
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await f.close();
    }
  });

  it("fails closed on a corrupt machine policy without hiding existing history", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-runtime-policy-"));
    const machinePolicyPath = join(root, "managed-policy.json");
    await writeFile(machinePolicyPath, "{ invalid machine policy", "utf8");
    const f = fixture({ managedPolicyPath: machinePolicyPath });
    const existing = f.repository.appendMessage({
      sessionId: f.session.id,
      role: "user",
      parts: [{ type: "text", text: "Readable existing history" }],
    });
    try {
      await expect(
        f.chat.send({ sessionId: f.session.id, text: "Start blocked work" }),
      ).rejects.toBeInstanceOf(ManagedPolicyError);
      expect(f.managedPolicy?.status()).toMatchObject({
        state: "invalid",
        machine: { state: "invalid", path: machinePolicyPath },
      });
      expect(f.repository.getMessages(f.session.id)).toEqual([existing]);
      expect(f.runtime.snapshot(f.session.id).messages).toEqual([existing]);
      expect(f.runtime.listRuns(f.session.id)[0]?.status).toBe("blocked_policy");
    } finally {
      await f.close();
      await rm(machinePolicyPath, { force: true });
      await rmdir(root);
    }
  });

  it("preserves the paused plan and checkpoint when a resume request is rejected by policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-resume-policy-"));
    const machinePolicyPath = join(root, "managed-policy.json");
    await writeFile(machinePolicyPath, "{ invalid machine policy", "utf8");
    const f = fixture({ managedPolicyPath: machinePolicyPath });
    const plan = f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      paused: true,
      steps: [todo("resume-step")],
    });
    const checkpoint = {
      runId: "interrupted-before-resume",
      state: "interrupted" as const,
      updatedAt: new Date().toISOString(),
      lastSafeTool: "read_file",
      lastSafeCallId: "previous-safe-read",
      completedTools: 1,
      uncertainTools: [],
    };
    f.chat.workbench.checkpoint(f.session.id, checkpoint);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(f.chat.resumeSession(f.session.id)).rejects.toBeInstanceOf(ManagedPolicyError);
      expect(f.chat.workbench.state(f.session.id)).toMatchObject({ plan, checkpoint });
      expect(f.runtime.listRuns(f.session.id)[0]?.status).toBe("blocked_policy");
      expect(f.syncWorkspace).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await f.close();
      await rm(machinePolicyPath, { force: true });
      await rmdir(root);
    }
  });

  it("requires human policy approval even in full access and rechecks a changed revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-runtime-approval-"));
    const machinePolicyPath = join(root, "managed-policy.json");
    await writeFile(
      machinePolicyPath,
      JSON.stringify({ version: 1, capabilities: { "provider.request": "ask" } }),
      "utf8",
    );
    const f = fixture({ managedPolicyPath: machinePolicyPath });
    const held = heldResponse("Policy approved once");
    const fetcher = vi.fn(async (_url: string, init: RequestInit) =>
      held.respond(init.signal as AbortSignal),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      const accepted = await f.chat.send({
        sessionId: f.session.id,
        text: "A policy-controlled request",
      });
      await vi.waitFor(() => expect(f.approvalBroker.state().requests).toHaveLength(1));
      const approval = f.approvalBroker.state().requests[0];
      expect(approval).toMatchObject({ manualOnly: true, runId: accepted.runId });
      expect(f.runtime.getRun(accepted.runId).status).toBe("waiting_approval");
      expect(fetcher).not.toHaveBeenCalled();
      f.chat.decideApproval({ approvalId: approval?.id ?? "", decision: "allow_once" });
      await held.started;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(f.runtime.getRun(accepted.runId).status).toBe("running");
      const internal = f.chat as unknown as {
        authorizeModelRequest: (
          session: SessionView,
          runId: string,
          model: typeof f.model,
          signal: AbortSignal,
        ) => Promise<void>;
      };
      await internal.authorizeModelRequest(
        f.session,
        accepted.runId,
        f.model,
        new AbortController().signal,
      );
      expect(f.approvalBroker.state().requests).toHaveLength(0);
      await writeFile(
        machinePolicyPath,
        JSON.stringify({ version: 1, capabilities: { "provider.request": "deny" } }),
        "utf8",
      );
      await expect(
        internal.authorizeModelRequest(
          f.session,
          accepted.runId,
          f.model,
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(ManagedPolicyError);
      expect(f.runtime.getRun(accepted.runId)).toMatchObject({
        lastPolicyDenial: {
          revision: f.managedPolicy?.status().revision,
          code: "POLICY_BLOCKED",
          sources: [expect.objectContaining({ layer: "machine", path: machinePolicyPath })],
        },
      });
      held.complete();
      await f.runCompletion(accepted.runId);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await f.close();
      await rm(machinePolicyPath, { force: true });
      await rmdir(root);
    }
  });

  it("publishes the terminal state only after host cleanup has settled", async () => {
    const f = fixture();
    const held = heldResponse("Done, waiting for cleanup");
    const cleanup = deferred<void>();
    let cleanups = 0;
    const options = (
      f.chat as unknown as { options: { toolRegistry: { cancelRun: () => Promise<void> } } }
    ).options;
    options.toolRegistry.cancelRun = async () => {
      cleanups++;
      await cleanup.promise;
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => held.respond(init.signal as AbortSignal)),
    );
    try {
      const accepted = await f.chat.send({
        sessionId: f.session.id,
        text: "Wait for real cleanup",
      });
      await held.started;
      held.complete();
      await vi.waitFor(() => expect(cleanups).toBeGreaterThan(0));
      expect(f.events.some((event) => event.type === "run_completed")).toBe(false);
      expect(f.runtime.getRun(accepted.runId).status).toBe("running");
      cleanup.resolve();
      await f.runCompletion(accepted.runId);
      expect(f.runtime.getRun(accepted.runId).status).toBe("completed");
    } finally {
      cleanup.resolve();
      await f.close();
    }
  });

  it("does not load executable custom-tool metadata when a host capability is denied", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-discovery-policy-"));
    const machinePolicyPath = join(root, "managed-policy.json");
    await writeFile(
      machinePolicyPath,
      JSON.stringify({ version: 1, capabilities: { "file.write": "deny" } }),
      "utf8",
    );
    const f = fixture({ managedPolicyPath: machinePolicyPath });
    const custom = {
      list: vi.fn(async () => [{ name: "custom_fixture" }]),
      descriptors: vi.fn(async () => [{ name: "custom_fixture", parameters: {} }]),
    };
    const options = (f.chat as unknown as { options: { customToolService: typeof custom } })
      .options;
    options.customToolService = custom;
    const availableTools = Object.getPrototypeOf(f.chat).availableTools as (
      this: ChatService,
      session: SessionView,
      model: typeof f.model,
      runId: string,
      signal: AbortSignal,
    ) => Promise<Array<{ name: string }>>;
    try {
      const tools = await availableTools.call(
        f.chat,
        f.session,
        f.model,
        "custom-discovery-run",
        new AbortController().signal,
      );
      expect(custom.list).toHaveBeenCalledTimes(1);
      expect(custom.descriptors).not.toHaveBeenCalled();
      expect(tools.some((tool) => tool.name === "custom_fixture")).toBe(false);
    } finally {
      await f.close();
      await rm(machinePolicyPath, { force: true });
      await rmdir(root);
    }
  });

  it("requires scoped human approval before custom code can use host and network capabilities", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-execute-policy-"));
    const machinePolicyPath = join(root, "managed-policy.json");
    await writeFile(
      machinePolicyPath,
      JSON.stringify({ version: 1, capabilities: { "network.request": "ask" } }),
      "utf8",
    );
    const f = fixture({ managedPolicyPath: machinePolicyPath });
    const custom = {
      has: vi.fn(async () => true),
      execute: vi.fn(async () => ({ output: "Custom execution completed", isError: false })),
    };
    const options = (f.chat as unknown as { options: { customToolService: typeof custom } })
      .options;
    options.customToolService = custom;
    f.internal.executionSafety.begin(f.session.id, "custom-execute-run");
    try {
      const pending = f.internal.executeToolCall({
        session: f.session,
        runId: "custom-execute-run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "custom-call",
          name: "custom_fixture",
          arguments: "{}",
        },
      });
      await vi.waitFor(() => expect(f.approvalBroker.state().requests).toHaveLength(1));
      expect(custom.execute).not.toHaveBeenCalled();
      const approval = f.approvalBroker.state().requests[0];
      expect(approval).toMatchObject({ manualOnly: true, runId: "custom-execute-run" });
      f.chat.decideApproval({ approvalId: approval?.id ?? "", decision: "allow_once" });
      await expect(pending).resolves.toMatchObject({ isError: false });
      expect(custom.execute).toHaveBeenCalledWith(
        "custom_fixture",
        {},
        expect.objectContaining({ approved: true, effect: "confirmed" }),
        { approved: true },
      );
      await writeFile(
        machinePolicyPath,
        JSON.stringify({ version: 1, capabilities: { "network.request": "deny" } }),
        "utf8",
      );
      const blocked = await f.internal.executeToolCall({
        session: f.session,
        runId: "custom-execute-run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "custom-after-policy-change",
          name: "custom_fixture",
          arguments: "{}",
        },
      });
      expect(blocked.isError).toBe(true);
      expect(custom.execute).toHaveBeenCalledTimes(1);
    } finally {
      f.internal.executionSafety.finish("custom-execute-run");
      await f.close();
      await rm(machinePolicyPath, { force: true });
      await rmdir(root);
    }
  });

  it("requires a plan-step claim before a custom tool can override a read-only builtin name", async () => {
    const f = fixture();
    const custom = {
      has: vi.fn(async (name: string) => name === "read_file"),
      execute: vi.fn(async () => ({ output: "unexpected execution", isError: false })),
    };
    const options = (f.chat as unknown as { options: { customToolService: typeof custom } })
      .options;
    options.customToolService = custom;
    f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      steps: [todo("authorize-custom-step")],
    });
    f.internal.executionSafety.begin(f.session.id, "custom-builtin-name-run");
    try {
      const result = await f.internal.executeToolCall({
        session: f.session,
        runId: "custom-builtin-name-run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "custom-read-file",
          name: "read_file",
          arguments: JSON.stringify({ path: "target.md" }),
        },
      });
      expect(result).toMatchObject({ isError: true });
      expect(result.output).toContain("PLAN_STEP_REQUIRED");
      expect(custom.has).toHaveBeenCalledWith("read_file", f.session.workspacePath);
      expect(custom.execute).not.toHaveBeenCalled();
      expect(f.planClaims.listClaims(f.session.id)).toEqual([]);
    } finally {
      f.internal.executionSafety.finish("custom-builtin-name-run");
      await f.close();
    }
  });

  it("rechecks policy before automatic formatter and diagnostics execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-post-edit-policy-"));
    const machinePolicyPath = join(root, "managed-policy.json");
    await writeFile(machinePolicyPath, JSON.stringify({ version: 1 }), "utf8");
    const f = fixture({ managedPolicyPath: machinePolicyPath, workspacePath: root });
    const formatter = { label: "Fixture formatter", command: ["fixture"] };
    const tooling = {
      detectFormatter: vi.fn(async () => {
        await writeFile(
          machinePolicyPath,
          JSON.stringify({ version: 1, capabilities: { "command.execute": "deny" } }),
          "utf8",
        );
        return formatter;
      }),
      format: vi.fn(),
      diagnosticPaths: vi.fn(async () => [join(root, "fixture.ts")]),
      diagnostics: vi.fn(),
    };
    const internal = f.chat as unknown as {
      options: { projectToolingService: typeof tooling };
      runPostEditChecks: (
        session: SessionView,
        runId: string,
        paths: string[],
        signal: AbortSignal,
      ) => Promise<string>;
    };
    internal.options.projectToolingService = tooling;
    try {
      const report = await internal.runPostEditChecks(
        f.session,
        "post-edit-run",
        [join(root, "fixture.ts")],
        new AbortController().signal,
      );
      expect(tooling.detectFormatter).toHaveBeenCalledTimes(1);
      expect(tooling.format).not.toHaveBeenCalled();
      expect(tooling.diagnostics).not.toHaveBeenCalled();
      expect(report).toContain("DIAGNOSTICS_UNVERIFIED");
      expect(f.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "activity",
            activity: expect.objectContaining({ toolName: "formatter", status: "failed" }),
          }),
        ]),
      );
    } finally {
      await f.close();
      await rm(machinePolicyPath, { force: true });
      await rmdir(root);
    }
  });

  it("applies file and command policies to shell and LSP while leaving termination available", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-command-policy-"));
    const machinePolicyPath = join(root, "managed-policy.json");
    await writeFile(
      machinePolicyPath,
      JSON.stringify({ version: 1, capabilities: { "file.write": "deny" } }),
      "utf8",
    );
    const f = fixture({ managedPolicyPath: machinePolicyPath });
    const internal = f.chat as unknown as {
      checkManagedToolPolicy: (input: {
        session: SessionView;
        runId: string;
        signal: AbortSignal;
        toolCall: { index: number; callId: string; name: string; arguments: string };
      }) => Promise<{ isError: boolean; output: string } | null>;
    };
    const check = (name: string, args: Record<string, unknown>) =>
      internal.checkManagedToolPolicy({
        session: f.session,
        runId: "command-policy-run",
        signal: new AbortController().signal,
        toolCall: { index: 0, callId: `policy-${name}`, name, arguments: JSON.stringify(args) },
      });
    try {
      await expect(
        check("run_command", { command: "Set-Content -LiteralPath fixture.txt hi" }),
      ).resolves.toMatchObject({ isError: true });
      await expect(
        check("run_command", { command: "Get-Content -LiteralPath 'fixture.txt'" }),
      ).resolves.toBeNull();
      await writeFile(
        machinePolicyPath,
        JSON.stringify({ version: 1, capabilities: { "command.execute": "deny" } }),
        "utf8",
      );
      await expect(check("lsp", { operation: "workspaceSymbol" })).resolves.toMatchObject({
        isError: true,
      });
      await writeFile(machinePolicyPath, "{ invalid policy", "utf8");
      await expect(
        check("write_stdin", { session_id: "fixture", terminate: true }),
      ).resolves.toBeNull();
      await expect(
        check("write_stdin", { session_id: "fixture", chars: "new command" }),
      ).resolves.toMatchObject({ isError: true });
    } finally {
      await f.close();
      await rm(machinePolicyPath, { force: true });
      await rmdir(root);
    }
  });

  it("enforces file policies for Office sources, document templates, and validation outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-office-source-policy-"));
    const machinePolicyPath = join(root, "managed-policy.json");
    await writeFile(
      machinePolicyPath,
      JSON.stringify({ version: 1, capabilities: { "file.read": "deny" } }),
      "utf8",
    );
    const f = fixture({ managedPolicyPath: machinePolicyPath });
    const internal = f.chat as unknown as {
      checkManagedToolPolicy: (input: {
        session: SessionView;
        runId: string;
        signal: AbortSignal;
        toolCall: { index: number; callId: string; name: string; arguments: string };
      }) => Promise<{ isError: boolean; output: string } | null>;
    };
    const check = (name: string, args: Record<string, unknown>) =>
      internal.checkManagedToolPolicy({
        session: f.session,
        runId: "office-source-policy-run",
        signal: new AbortController().signal,
        toolCall: { index: 0, callId: `policy-${name}`, name, arguments: JSON.stringify(args) },
      });
    try {
      for (const args of [
        { operation: "inspect", path: "source.docx" },
        { operation: "verify", path: "source.xlsx", render: false },
        {
          operation: "edit_spreadsheet",
          path: "updated.xlsx",
          source: { path: "source.xlsx", expected_sha256: "a".repeat(64) },
          operations: [{ type: "rename_sheet", sheet: "Sheet1", name: "Renamed" }],
        },
        {
          operation: "edit_presentation",
          path: "updated.pptx",
          source: { path: "source.pptx", expected_sha256: "b".repeat(64) },
          operations: [{ type: "replace_notes_text", slide: 1, old_text: "old", new_text: "new" }],
        },
      ]) {
        await expect(check("office_document", args)).resolves.toMatchObject({
          isError: true,
          output: expect.stringContaining("POLICY_BLOCKED"),
        });
      }
      await expect(
        check("create_document", {
          path: "updated.docx",
          template: {
            path: "source.docx",
            replacements: [{ placeholder: "title", blocks: [{ type: "paragraph", text: "New" }] }],
          },
        }),
      ).resolves.toMatchObject({
        isError: true,
        output: expect.stringContaining("POLICY_BLOCKED"),
      });
      await expect(
        check("create_document", {
          path: "new.docx",
          blocks: [{ type: "paragraph", text: "New" }],
        }),
      ).resolves.toBeNull();

      await writeFile(
        machinePolicyPath,
        JSON.stringify({ version: 1, capabilities: { "file.write": "deny" } }),
        "utf8",
      );
      await expect(
        check("office_document", { operation: "verify", path: "source.xlsx", render: false }),
      ).resolves.toBeNull();
      await expect(
        check("office_document", {
          operation: "verify",
          path: "source.xlsx",
          render_path: "checked.pdf",
        }),
      ).resolves.toMatchObject({
        isError: true,
        output: expect.stringContaining("POLICY_BLOCKED"),
      });
    } finally {
      await f.close();
      await rm(machinePolicyPath, { force: true });
      await rmdir(root);
    }
  });

  it("keeps invalid side-effecting tool output out of the ledger and behind the write barrier", async () => {
    const f = fixture({ workspacePath: "C:\\runtime-governance-fixture" });
    const runId = "invalid-output-run";
    f.internal.executionSafety.begin(f.session.id, runId);
    f.internal.executeOwnedToolCall = vi.fn(async () => ({
      output: "written",
      isError: false,
      fileChange: {
        path: "",
        changeType: "modified",
        additions: -1,
        deletions: 0,
      },
    }));
    try {
      const result = await f.internal.performToolCall({
        session: f.session,
        runId,
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "invalid-write-call",
          name: "write_file",
          arguments: JSON.stringify({
            path: "report.docx",
            content: "fixture",
          }),
        },
      });

      expect(result).toMatchObject({
        isError: true,
        outcome: {
          validation: { status: "invalid" },
          effect: "uncertain",
        },
      });
      expect(f.repository.getSetting(`workbench.ledger.${f.session.id}`)).toEqual([]);
      const barrierKey = f.internal.workspaceBarrierKey(f.session);
      expect(barrierKey).toBeTruthy();
      expect(f.repository.getSetting(barrierKey ?? "")).toMatchObject({
        sessionId: f.session.id,
        runId,
      });
    } finally {
      f.internal.executionSafety.finish(runId);
      await f.close();
    }
  });

  it("settles validated writes before PostToolUse and survives a hook failure", async () => {
    const f = fixture({ workspacePath: "C:\\runtime-governance-settlement" });
    const runId = "settlement-order-run";
    const order: string[] = [];
    f.internal.executionSafety.begin(f.session.id, runId);
    f.internal.executeOwnedToolCall = vi.fn(async () => {
      order.push("execute");
      return {
        output: "written",
        isError: false,
        fileChange: {
          path: "report.docx",
          changeType: "modified",
          additions: 2,
          deletions: 1,
        },
      };
    });
    f.internal.runPluginHooks = vi.fn(async (event: string) => {
      order.push(event);
      if (event === "PostToolUse") throw new Error("POST_TOOL_USE_FAILED_AFTER_SETTLEMENT");
    });
    const settled = vi.fn((result) => {
      order.push("outcome-settled");
      expect(result.outcome?.validation.status).toBe("validated");
      expect(f.repository.getSetting(`workbench.ledger.${f.session.id}`)).toHaveLength(1);
    });

    try {
      const result = await f.internal.executeToolCall({
        session: f.session,
        runId,
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "settled-write",
          name: "write_file",
          arguments: JSON.stringify({
            path: "report.docx",
            content: "fixture",
          }),
        },
        onOutcomeSettled: settled,
      });

      expect(order).toEqual(["PreToolUse", "execute", "outcome-settled", "PostToolUse"]);
      expect(settled).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        isError: false,
        outcome: {
          status: "success",
          effect: "confirmed",
          validation: { status: "validated" },
          codes: expect.arrayContaining(["POST_TOOL_USE_HOOK_FAILED"]),
        },
      });
      expect(result.output).toContain("POST_TOOL_USE_FAILED_AFTER_SETTLEMENT");
      expect(result.output).toContain("already settled and remains authoritative");
      const ledger = f.repository.getSetting(`workbench.ledger.${f.session.id}`) as Array<{
        callId: string;
      }>;
      expect(ledger).toEqual([
        expect.objectContaining({
          callId: "settled-write",
        }),
      ]);
    } finally {
      f.internal.executionSafety.finish(runId);
      await f.close();
    }
  });

  it("settles host-tool checkpoints before PostToolUse and persists a paired hook failure", async () => {
    const f = fixture({ workspacePath: "C:\\runtime-governance-host-tool" });
    const runId = "host-tool-settlement-run";
    f.chat.workbench.checkpoint(f.session.id, {
      runId,
      state: "running",
      updatedAt: new Date().toISOString(),
      lastSafeTool: null,
      lastSafeCallId: null,
      completedTools: 0,
      uncertainTools: [],
    });
    f.internal.executeOwnedToolCall = vi.fn(async () => ({
      output: "Fixture file contents",
      isError: false,
    }));
    let checkpointAtPostToolUse: unknown;
    f.internal.runPluginHooks = vi.fn(async (event: string) => {
      if (event !== "PostToolUse") return;
      checkpointAtPostToolUse = f.chat.workbench.state(f.session.id).checkpoint;
      throw new Error("HOST_POST_TOOL_USE_FAILED");
    });

    try {
      const result = await f.internal.runHostTool(
        f.session,
        runId,
        new AbortController().signal,
        "read_file",
        { path: "fixture.txt" },
      );

      expect(checkpointAtPostToolUse).toMatchObject({
        completedTools: 1,
        lastSafeTool: "read_file",
        uncertainTools: [],
      });
      expect(result).toMatchObject({
        isError: false,
        outcome: {
          status: "success",
          codes: expect.arrayContaining(["POST_TOOL_USE_HOOK_FAILED"]),
        },
      });
      expect(result.output).toContain("HOST_POST_TOOL_USE_FAILED");
      const parts = f.repository.getMessages(f.session.id).flatMap((message) => message.parts);
      const call = parts.find((part) => part.type === "tool_call" && part.name === "read_file");
      const toolResult = parts.find(
        (part) =>
          part.type === "tool_result" && call?.type === "tool_call" && part.callId === call.callId,
      );
      expect(toolResult).toMatchObject({
        type: "tool_result",
        callId: call?.type === "tool_call" ? call.callId : undefined,
        output: expect.stringContaining("HOST_POST_TOOL_USE_FAILED"),
      });
    } finally {
      await f.close();
    }
  });

  it("clears a failed host-tool pending state without marking it safe", async () => {
    const f = fixture({ workspacePath: "C:\\runtime-governance-host-tool-failure" });
    const runId = "host-tool-failure-run";
    f.chat.workbench.checkpoint(f.session.id, {
      runId,
      state: "running",
      updatedAt: new Date().toISOString(),
      lastSafeTool: null,
      lastSafeCallId: null,
      completedTools: 0,
      uncertainTools: [],
    });
    f.internal.executeOwnedToolCall = vi.fn(async () => ({
      output: "Fixture file was not found",
      isError: true,
    }));
    f.internal.runPluginHooks = vi.fn(async () => undefined);

    try {
      const result = await f.internal.runHostTool(
        f.session,
        runId,
        new AbortController().signal,
        "read_file",
        { path: "missing.txt" },
      );
      expect(result.isError).toBe(true);
      expect(f.chat.workbench.state(f.session.id).checkpoint).toMatchObject({
        completedTools: 0,
        lastSafeTool: null,
        lastSafeCallId: null,
        uncertainTools: [],
      });
    } finally {
      await f.close();
    }
  });

  it("requires both an accepted run alias and its delegated executor to be live", async () => {
    const f = fixture();
    try {
      const parentRunId = "accepted-alias";
      const childRunId = "delegated-child";
      f.internal.acceptedRunIds.set(f.session.id, parentRunId);
      f.internal.activeRuns.set(f.session.id, new AbortController());
      f.internal.runPromises.set(parentRunId, Promise.resolve("completed"));
      f.internal.delegatedRunIds.set(parentRunId, childRunId);
      f.internal.acceptedRunIds.set("child-session", childRunId);
      f.internal.activeRuns.set("child-session", new AbortController());
      f.internal.runPromises.set(childRunId, Promise.resolve("completed"));

      expect(f.chat.isPlanClaimRunActive(f.session.id, parentRunId)).toBe(true);
      f.internal.activeRuns.delete("child-session");
      expect(f.chat.isPlanClaimRunActive(f.session.id, parentRunId)).toBe(false);
      expect(f.chat.isPlanClaimRunActive(f.session.id, "admitted-only-run")).toBe(false);
    } finally {
      await f.close();
    }
  });

  it("blocks side effects when an in-progress step only has a stale claim", async () => {
    const f = fixture();
    const plan = f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      steps: [todo("stale-mutation-step")],
    });
    const claim = f.planClaims.begin({
      sessionId: f.session.id,
      runId: "old-mutation-run",
      ownerSessionId: f.session.id,
      stepId: "stale-mutation-step",
      revision: plan.revision,
    }).claim;
    f.database
      .prepare("update plan_step_claims set lease_until = ? where id = ?")
      .run("2000-01-01T00:00:00.000Z", claim.id);
    f.internal.executeOwnedToolCall = vi.fn(async () => ({
      output: "unexpected side effect",
      isError: false,
    }));
    try {
      const result = await f.internal.performToolCall({
        session: f.session,
        runId: "new-mutation-run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "stale-mutation-call",
          name: "write_file",
          arguments: JSON.stringify({ path: "stale.txt", content: "must not write" }),
        },
      });
      expect(result).toMatchObject({ isError: true });
      expect(result.output).toContain("PLAN_CLAIM_CONFLICT");
      expect(f.internal.executeOwnedToolCall).not.toHaveBeenCalled();
      expect(f.planClaims.getClaim(claim.id)?.status).toBe("stale");
    } finally {
      await f.close();
    }
  });

  it("lets a managed Subagent mutate under its live parent run claim", async () => {
    const f = fixture();
    const plan = f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      steps: [todo("parent-authorized-step")],
    });
    const parentRunId = "parent-claim-run";
    f.planClaims.begin({
      sessionId: f.session.id,
      runId: parentRunId,
      ownerSessionId: f.session.id,
      stepId: "parent-authorized-step",
      revision: plan.revision,
    });
    f.internal.acceptedRunIds.set(f.session.id, parentRunId);
    f.internal.activeRuns.set(f.session.id, new AbortController());
    f.internal.runPromises.set(parentRunId, Promise.resolve("completed"));
    const child = f.repository.insertSession({
      title: "Managed claim child",
      parentSessionId: f.session.id,
      providerId: f.session.providerId,
      modelId: f.session.modelId,
      agentProfileId: f.session.agentProfileId,
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: f.session.permissionMode,
      executionMode: f.session.executionMode,
      patchOnly: f.session.patchOnly,
    });
    f.internal.subagentPromptPlugins.set(child.id, {
      parentRunId,
      extensionIds: new Set(),
    });
    f.internal.executeOwnedToolCall = vi.fn(async () => ({
      output: "authorized fixture write",
      isError: false,
    }));
    try {
      const result = await f.internal.performToolCall({
        session: child,
        runId: "managed-child-run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "parent-authorized-call",
          name: "write_file",
          arguments: JSON.stringify({ path: "authorized.txt", content: "ok" }),
        },
      });
      expect(result).toMatchObject({ isError: false });
      expect(result.output).toBe("authorized fixture write");
      expect(f.internal.executeOwnedToolCall).toHaveBeenCalledOnce();
    } finally {
      await f.close();
    }
  });

  it("creates a persistent ChatService claim and rejects stale plan generations", async () => {
    const f = fixture();
    const initialPlan = f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      steps: [todo("step-a")],
    });
    try {
      const claimed = await f.internal.executeToolCall({
        session: f.session,
        runId: "claim-owner-run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "begin-step-a",
          name: "begin_plan_step",
          arguments: JSON.stringify({
            revision: initialPlan.revision,
            step_id: "step-a",
          }),
        },
      });
      expect(claimed.isError).toBe(false);
      const activeClaim = f.planClaims.listClaims(f.session.id)[0];
      expect(activeClaim).toMatchObject({
        sessionId: f.session.id,
        stepId: "step-a",
        ownerRunId: "claim-owner-run",
        ownerSessionId: f.session.id,
        status: "active",
        generation: initialPlan.generation,
      });

      const conflicting = await f.internal.executeToolCall({
        session: f.session,
        runId: "other-claim-run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "conflicting-begin-step-a",
          name: "begin_plan_step",
          arguments: JSON.stringify({
            revision: initialPlan.revision,
            step_id: "step-a",
          }),
        },
      });
      expect(conflicting).toMatchObject({ isError: true });
      expect(conflicting.output).toContain("already claimed");

      f.planClaims.settle({
        claimId: activeClaim?.id ?? "",
        ownerRunId: "claim-owner-run",
        status: "released",
        summary: "Fixture released the claim before replacing the plan.",
      });
      const replacement = f.chat.workbench.update({
        sessionId: f.session.id,
        revision: initialPlan.revision,
        steps: [todo("step-b")],
      });
      expect(replacement.generation).toBe(initialPlan.generation + 1);

      const stale = await f.internal.executeToolCall({
        session: f.session,
        runId: "stale-owner-run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "stale-begin-step-b",
          name: "begin_plan_step",
          arguments: JSON.stringify({
            revision: initialPlan.revision,
            step_id: "step-b",
          }),
        },
      });
      expect(stale).toMatchObject({ isError: true });
      expect(stale.output).toContain("Plan changed");
      expect(f.planClaims.listClaims(f.session.id)).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it("tracks heartbeat state for direct plan-step claims and settles them on successful run cleanup", async () => {
    const f = fixture();
    const plan = f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      steps: [todo("direct-step")],
    });
    try {
      const claimed = await f.internal.executeToolCall({
        session: f.session,
        runId: "direct-claim-run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "direct-begin",
          name: "begin_plan_step",
          arguments: JSON.stringify({
            revision: plan.revision,
            step_id: "direct-step",
          }),
        },
      });
      expect(claimed.isError).toBe(false);
      const tracked = f.internal.activePlanStepClaims.get("direct-claim-run");
      expect(tracked).toHaveLength(1);
      const claim = [...(tracked?.values() ?? [])][0];
      expect(claim).toMatchObject({ sessionId: f.session.id });
      expect(f.internal.settleRunPlanStepClaims("direct-claim-run", "completed", false)).toBe(true);
      expect(f.planClaims.getClaim(claim?.claimId ?? "")).toMatchObject({
        status: "completed",
        summary: "The owning run completed normally.",
      });
      expect(f.internal.activePlanStepClaims.has("direct-claim-run")).toBe(false);
    } finally {
      await f.close();
    }
  });

  it("guards API settlement with the exact live run, lease, generation and owner", async () => {
    const f = fixture();
    const plan = f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      steps: [todo("live-step"), todo("expired-step"), todo("terminal-step")],
    });
    const accepted = f.runtime.admitTurn({
      sessionId: f.session.id,
      idempotencyKey: "guarded-live-settle",
      requestHash: "b".repeat(64),
      source: "desktop",
    });
    const runId = accepted.runId;
    const controller = new AbortController();
    f.runtime.transitionRun(runId, "running", null);
    f.internal.acceptedRunIds.set(f.session.id, runId);
    f.internal.activeRuns.set(f.session.id, controller);
    f.internal.runPromises.set(runId, Promise.resolve("completed"));
    try {
      const live = f.planClaims.begin({
        sessionId: f.session.id,
        runId,
        ownerSessionId: f.session.id,
        stepId: "live-step",
        revision: plan.revision,
      }).claim;
      const inspectedVersion = live.claimVersion;
      const heartbeat = f.planClaims.heartbeat({ claimId: live.id, ownerRunId: runId });
      expect(() =>
        f.chat.settlePlanClaim({
          claimId: live.id,
          ownerRunId: runId,
          status: "completed",
          expectedVersion: inspectedVersion,
          summary: "A stale caller must not settle after heartbeat.",
        }),
      ).toThrowError(/claim changed after inspection/i);
      expect(
        f.chat.settlePlanClaim({
          claimId: live.id,
          ownerRunId: runId,
          status: "completed",
          expectedVersion: heartbeat.claimVersion,
          summary: "The exact live owner completed the step.",
        }).claim,
      ).toMatchObject({ status: "completed" });

      const expired = f.planClaims.begin({
        sessionId: f.session.id,
        runId,
        ownerSessionId: f.session.id,
        stepId: "expired-step",
        revision: plan.revision,
      }).claim;
      f.database
        .prepare("update plan_step_claims set lease_until = ? where id = ?")
        .run("2000-01-01T00:00:00.000Z", expired.id);
      expect(() =>
        f.chat.settlePlanClaim({
          claimId: expired.id,
          ownerRunId: runId,
          status: "released",
        }),
      ).toThrowError(/stale|lease|inspect/i);
      expect(f.planClaims.getClaim(expired.id)).toMatchObject({ status: "stale" });

      const terminal = f.planClaims.begin({
        sessionId: f.session.id,
        runId,
        ownerSessionId: f.session.id,
        stepId: "terminal-step",
        revision: plan.revision,
      }).claim;
      expect(() =>
        f.chat.settlePlanClaim({
          claimId: terminal.id,
          ownerRunId: "different-owner-run",
          status: "completed",
        }),
      ).toThrowError(/does not own/i);
      f.runtime.transitionRun(runId, "interrupted", "fixture stopped the run");
      expect(() =>
        f.chat.settlePlanClaim({
          claimId: terminal.id,
          ownerRunId: runId,
          status: "completed",
        }),
      ).toThrowError(/already terminal/i);
    } finally {
      controller.abort();
      f.internal.activeToolCalls.delete(runId);
      f.internal.activeRuns.delete(f.session.id);
      f.internal.acceptedRunIds.delete(f.session.id);
      f.internal.runPromises.delete(runId);
      await f.close();
    }
  });

  it("blocks live API settlement while tools, file leases or write barriers remain", async () => {
    const f = fixture({ workspacePath: "C:\\runtime-governance-live-settle" });
    const plan = f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      steps: [todo("resource-step")],
    });
    const accepted = f.runtime.admitTurn({
      sessionId: f.session.id,
      idempotencyKey: "guarded-resource-settle",
      requestHash: "c".repeat(64),
      source: "desktop",
    });
    const runId = accepted.runId;
    const controller = new AbortController();
    f.runtime.transitionRun(runId, "running", null);
    f.internal.acceptedRunIds.set(f.session.id, runId);
    f.internal.activeRuns.set(f.session.id, controller);
    f.internal.runPromises.set(runId, Promise.resolve("completed"));
    const claim = f.planClaims.begin({
      sessionId: f.session.id,
      runId,
      ownerSessionId: f.session.id,
      stepId: "resource-step",
      revision: plan.revision,
    }).claim;
    try {
      f.internal.activeToolCalls.set(runId, 1);
      expect(() =>
        f.chat.settlePlanClaim({
          claimId: claim.id,
          ownerRunId: runId,
          status: "completed",
        }),
      ).toThrowError(/active tool call/i);
      f.internal.activeToolCalls.delete(runId);

      const release = await f.internal.fileLocks.acquire(
        [f.session.workspacePath as string],
        true,
        { sessionId: f.session.id, runId, label: f.session.title },
        controller.signal,
        async () => false,
      );
      expect(() =>
        f.chat.settlePlanClaim({
          claimId: claim.id,
          ownerRunId: runId,
          status: "completed",
        }),
      ).toThrowError(/file lease/i);
      release();

      const barrierKey = f.internal.workspaceBarrierKey(f.session);
      f.repository.setSetting(barrierKey ?? "", {
        sessionId: f.session.id,
        runId,
        owners: [{ sessionId: f.session.id, runId }],
      });
      expect(() =>
        f.chat.settlePlanClaim({
          claimId: claim.id,
          ownerRunId: runId,
          status: "released",
        }),
      ).toThrowError(/write barrier/i);
      if (barrierKey) f.repository.removeSetting(barrierKey);

      expect(
        f.chat.settlePlanClaim({
          claimId: claim.id,
          ownerRunId: runId,
          status: "released",
        }).claim,
      ).toMatchObject({ status: "released" });
    } finally {
      f.internal.fileLocks.releaseRun(runId);
      f.internal.activeToolCalls.delete(runId);
      f.internal.activeRuns.delete(f.session.id);
      f.internal.acceptedRunIds.delete(f.session.id);
      f.internal.runPromises.delete(runId);
      controller.abort();
      await f.close();
    }
  });

  it("reads the child owner checkpoint during manual claim recovery", async () => {
    const f = fixture();
    const plan = f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      steps: [todo("child-step")],
    });
    const child = f.repository.insertSession({
      title: "Child claim owner",
      parentSessionId: f.session.id,
      providerId: null,
      modelId: null,
      agentProfileId: "mingshen",
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
    });
    try {
      const admitted = f.runtime.admitTurn({
        sessionId: child.id,
        idempotencyKey: "child-claim-run",
        requestHash: "a".repeat(64),
        source: "desktop",
      });
      f.runtime.transitionRun(admitted.runId, "running", null);
      const claimed = f.planClaims.begin({
        sessionId: f.session.id,
        runId: admitted.runId,
        ownerSessionId: child.id,
        stepId: "child-step",
        revision: plan.revision,
      });
      f.runtime.transitionRun(admitted.runId, "interrupted", "fixture stopped the child");
      f.repository.appendMessage({
        sessionId: child.id,
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            callId: "inspect-child-files",
            name: "read_file",
            arguments: JSON.stringify({ path: "result.md" }),
            status: "completed",
          },
        ],
      });
      f.repository.appendMessage({
        sessionId: child.id,
        role: "tool",
        parts: [
          {
            type: "tool_result",
            callId: "inspect-child-files",
            output: "Inspected the child output.",
            isError: false,
          },
        ],
      });
      f.chat.workbench.checkpoint(child.id, {
        runId: admitted.runId,
        state: "interrupted",
        updatedAt: new Date().toISOString(),
        lastSafeTool: "read_file",
        lastSafeCallId: "inspect-child-files",
        completedTools: 1,
        uncertainTools: [{ callId: "child-write", name: "write_file", state: "executing" }],
      });
      f.database
        .prepare("update plan_step_claims set lease_until = ? where id = ?")
        .run("2000-01-01T00:00:00.000Z", claimed.claim.id);
      const stale = f.planClaims.listClaims(f.session.id)[0];
      expect(stale).toMatchObject({ id: claimed.claim.id, status: "stale" });
      expect(() =>
        f.chat.recoverPlanClaim({
          sessionId: f.session.id,
          claimId: claimed.claim.id,
          expectedVersion: stale?.claimVersion ?? 0,
          summary: "Stopped the child before release.",
        }),
      ).toThrowError(/unresolved state target/i);
      expect(
        f.chat.recoverPlanClaim({
          sessionId: f.session.id,
          claimId: claimed.claim.id,
          expectedVersion: stale?.claimVersion ?? 0,
          summary: "Inspected the child output and confirmed the uncertain write.",
          inspectionCallIds: ["inspect-child-files"],
        }).claim,
      ).toMatchObject({
        status: "released",
        evidence: expect.arrayContaining(["inspection:inspect-child-files"]),
      });
      expect(f.confirmRunStopped).toHaveBeenCalledWith(admitted.runId);
    } finally {
      await f.close();
    }
  });

  it("requires distinct read-only evidence after the final uncertain effect", async () => {
    const f = fixture();
    const plan = f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      steps: [todo("evidence-step")],
    });
    const accepted = f.runtime.admitTurn({
      sessionId: f.session.id,
      idempotencyKey: "guarded-claim-evidence",
      requestHash: "d".repeat(64),
      source: "desktop",
    });
    const runId = accepted.runId;
    f.runtime.transitionRun(runId, "running", null);
    const claim = f.planClaims.begin({
      sessionId: f.session.id,
      runId,
      ownerSessionId: f.session.id,
      stepId: "evidence-step",
      revision: plan.revision,
    }).claim;
    f.runtime.transitionRun(runId, "interrupted", "fixture stopped the run");
    f.database
      .prepare("update plan_step_claims set lease_until = ? where id = ?")
      .run("2000-01-01T00:00:00.000Z", claim.id);
    const appendCall = (callId: string, name: string, args: Record<string, unknown>) =>
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            callId,
            name,
            arguments: JSON.stringify(args),
            status: "completed",
          },
        ],
      });
    const appendResult = (callId: string) =>
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "tool",
        parts: [
          {
            type: "tool_result",
            callId,
            output: "Inspected current state.",
            isError: false,
          },
        ],
      });
    try {
      appendCall("read-before", "read_file", { path: "before.txt" });
      appendResult("read-before");
      appendCall("uncertain-write-1", "write_file", { path: "one.txt" });
      appendResult("uncertain-write-1");
      appendCall("uncertain-write-2", "write_file", { path: "two.txt" });
      appendResult("uncertain-write-2");
      appendCall("generic-mcp-read", "mcp__fixture__read", { path: "state.txt" });
      appendResult("generic-mcp-read");
      appendCall("read-after-1", "read_file", { path: "one.txt" });
      appendResult("read-after-1");
      appendCall("read-after-2", "list_files", { path: "." });
      appendResult("read-after-2");
      f.chat.workbench.checkpoint(f.session.id, {
        runId,
        state: "interrupted",
        updatedAt: new Date().toISOString(),
        lastSafeTool: "read_file",
        lastSafeCallId: "read-before",
        completedTools: 1,
        uncertainTools: [
          { callId: "uncertain-write-1", name: "write_file", state: "executing" },
          { callId: "uncertain-write-2", name: "write_file", state: "executing" },
        ],
      });
      const stale = f.planClaims.getClaim(claim.id);
      const recover = (inspectionCallIds: string[]) =>
        f.chat.recoverPlanClaim({
          sessionId: f.session.id,
          claimId: claim.id,
          expectedVersion: stale?.claimVersion ?? 0,
          summary: "Inspected both uncertain writes and the retained process state.",
          inspectionCallIds,
        });

      expect(() => recover(["read-before"])).toThrowError(/after the final uncertain effect/i);
      expect(() => recover(["generic-mcp-read"])).toThrowError(/proven read-only tool result/i);
      expect(() => recover(["read-after-1"])).toThrowError(
        /distinct successful inspection call IDs/i,
      );
      expect(recover(["read-after-1", "read-after-2"]).claim).toMatchObject({ status: "released" });
      expect(f.confirmRunStopped).toHaveBeenCalledWith(runId);
    } finally {
      await f.close();
    }
  });

  it("releases retained claim resources only after cleanup confirmation and recovery CAS", async () => {
    const f = fixture({ workspacePath: "C:\\runtime-governance-claim-cleanup" });
    const plan = f.chat.workbench.update({
      sessionId: f.session.id,
      revision: 0,
      steps: [todo("cleanup-step")],
    });
    const accepted = f.runtime.admitTurn({
      sessionId: f.session.id,
      idempotencyKey: "guarded-claim-cleanup",
      requestHash: "f".repeat(64),
      source: "desktop",
    });
    const runId = accepted.runId;
    const controller = new AbortController();
    f.runtime.transitionRun(runId, "running", null);
    const claim = f.planClaims.begin({
      sessionId: f.session.id,
      runId,
      ownerSessionId: f.session.id,
      stepId: "cleanup-step",
      revision: plan.revision,
    }).claim;
    const barrierKey = f.internal.workspaceBarrierKey(f.session) ?? "";
    f.repository.setSetting(barrierKey, {
      sessionId: f.session.id,
      runId,
      owners: [{ sessionId: f.session.id, runId }],
      updatedAt: "2000-01-01T00:00:00.000Z",
    });
    f.internal.commandEffects.set(runId, new Map([["command-effect", {}]]));
    const release = await f.internal.fileLocks.acquire(
      [f.session.workspacePath as string],
      true,
      { sessionId: f.session.id, runId, label: f.session.title },
      controller.signal,
      async () => false,
    );
    const appendCall = (callId: string, name: string, args: Record<string, unknown>) =>
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            callId,
            name,
            arguments: JSON.stringify(args),
            status: "completed",
          },
        ],
      });
    const appendResult = (callId: string) =>
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "tool",
        parts: [
          {
            type: "tool_result",
            callId,
            output: "Inspected current state.",
            isError: false,
          },
        ],
      });
    try {
      appendCall("uncertain-cleanup-write", "write_file", { path: "effect.txt" });
      appendResult("uncertain-cleanup-write");
      appendCall("cleanup-read-1", "read_file", { path: "effect.txt" });
      appendResult("cleanup-read-1");
      appendCall("cleanup-read-2", "list_files", { path: "." });
      appendResult("cleanup-read-2");
      f.chat.workbench.checkpoint(f.session.id, {
        runId,
        state: "interrupted",
        updatedAt: new Date().toISOString(),
        lastSafeTool: "read_file",
        lastSafeCallId: "cleanup-read-1",
        completedTools: 1,
        uncertainTools: [
          { callId: "uncertain-cleanup-write", name: "write_file", state: "executing" },
        ],
      });
      f.runtime.transitionRun(runId, "interrupted", "fixture stopped the run");
      f.database
        .prepare("update plan_step_claims set lease_until = ? where id = ?")
        .run("2000-01-01T00:00:00.000Z", claim.id);
      const stale = f.planClaims.getClaim(claim.id);
      f.confirmRunStopped.mockImplementationOnce(() => {
        throw new Error("PROCESS_STILL_ACTIVE");
      });
      expect(() =>
        f.chat.recoverPlanClaim({
          sessionId: f.session.id,
          claimId: claim.id,
          expectedVersion: stale?.claimVersion ?? 0,
          summary: "Inspected the write and retained cleanup state.",
          inspectionCallIds: ["cleanup-read-1", "cleanup-read-2"],
        }),
      ).toThrowError(/could not be confirmed/i);
      expect(f.planClaims.getClaim(claim.id)).toMatchObject({ status: "stale" });
      expect(f.internal.fileLocks.hasRun(runId)).toBe(true);
      expect(f.repository.getSetting(barrierKey)).toBeTruthy();
      expect(f.internal.commandEffects.has(runId)).toBe(true);

      expect(
        f.chat.recoverPlanClaim({
          sessionId: f.session.id,
          claimId: claim.id,
          expectedVersion: stale?.claimVersion ?? 0,
          summary: "Confirmed cleanup and inspected the retained write.",
          inspectionCallIds: ["cleanup-read-1", "cleanup-read-2"],
        }).claim,
      ).toMatchObject({ status: "released" });
      expect(f.internal.fileLocks.hasRun(runId)).toBe(false);
      expect(f.repository.getSetting(barrierKey)).toBeNull();
      expect(f.internal.commandEffects.has(runId)).toBe(false);
      expect(f.confirmRunStopped).toHaveBeenCalledTimes(2);
    } finally {
      release();
      f.internal.fileLocks.releaseRun(runId);
      f.internal.commandEffects.delete(runId);
      if (barrierKey) f.repository.removeSetting(barrierKey);
      controller.abort();
      await f.close();
    }
  });
});
