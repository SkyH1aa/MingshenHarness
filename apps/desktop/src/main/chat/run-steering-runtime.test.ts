import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent, SessionMessage } from "../../shared/domain";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ChatService } from "./chat-service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const encoder = new TextEncoder();
const sse = (...events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
const answer = (text: string) =>
  new Response(
    sse(
      { type: "response.output_text.delta", delta: text },
      { type: "response.completed", response: { status: "completed", output: [] } },
    ),
  );
const toolCall = () =>
  new Response(
    sse(
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          call_id: "tool-call-1",
          name: "web_search",
          arguments: '{"query":"fixture"}',
        },
      },
      { type: "response.completed", response: { status: "completed", output: [] } },
    ),
  );

function heldResponse(text = "First response") {
  const started = deferred<AbortSignal>();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let finished = false;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      controller.enqueue(encoder.encode(sse({ type: "response.output_text.delta", delta: text })));
    },
  });
  const respond = (signal: AbortSignal) => {
    started.resolve(signal);
    signal.addEventListener(
      "abort",
      () => {
        if (!finished) {
          finished = true;
          controller.error(signal.reason ?? new Error("aborted"));
        }
      },
      { once: true },
    );
    return new Response(stream);
  };
  return {
    started: started.promise,
    respond,
    complete() {
      if (finished) throw new Error("Held stream already ended");
      finished = true;
      controller.enqueue(
        encoder.encode(
          sse({ type: "response.completed", response: { status: "completed", output: [] } }),
        ),
      );
      controller.close();
    },
    fail() {
      if (finished) throw new Error("Held stream already ended");
      finished = true;
      controller.error(new Error("fixture stream failure"));
    },
  };
}

function service(repository: Repository, events: ChatStreamEvent[]) {
  const chat = new ChatService({
    repository,
    providerService: { getActiveApiKey: () => "fixture" },
    toolRegistry: {
      hasRunningCommands: () => false,
      commandSessions: () => [],
      cancelRun: async () => undefined,
    },
    approvalBroker: { cancelSession: vi.fn() },
    questionBroker: { cancelSession: vi.fn() },
    mcpService: { list: () => [] },
    emit: (event: ChatStreamEvent) => events.push(event),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    availableTools: ReturnType<typeof vi.fn>;
    buildSystemPrompt: ReturnType<typeof vi.fn>;
    contextCompaction: { prepare: (...args: never[]) => Promise<SessionMessage[]> };
    executeToolCall: ReturnType<typeof vi.fn>;
    runPluginHooks: ReturnType<typeof vi.fn>;
    runPromises: Map<string, Promise<unknown>>;
  };
  internal.availableTools = vi.fn(async () => []);
  internal.buildSystemPrompt = vi.fn(async () => "Local fixture");
  internal.executeToolCall = vi.fn(async () => ({ output: "tool result", isError: false }));
  chat.setModelRetrySettings({ maxRetries: 0 });
  return { chat, internal };
}

function fixture(path = ":memory:", nativeGemini = false) {
  const database = openDatabase(path);
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Local fixture",
    baseUrl: nativeGemini
      ? "https://generativelanguage.googleapis.com/v1beta"
      : "https://fixture.invalid/v1",
    protocol: nativeGemini ? "gemini_generate_content" : "openai_responses",
    authMode: nativeGemini ? "x_goog_api_key" : "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "steering-fixture",
    displayName: "Steering fixture",
    contextWindow: 128000,
    maxOutputTokens: 1024,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository.getProvider(provider.id)?.models[0];
  if (!model) throw new Error("Fixture model missing");
  const session = repository.insertSession({
    title: "Steering fixture",
    agentMode: "chat",
    providerId: provider.id,
    modelId: model.id,
    agentProfileId: "mingshen",
    workspacePath: null,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
  const events: ChatStreamEvent[] = [];
  const { chat, internal } = service(repository, events);
  const completions: Promise<unknown>[] = [];
  return {
    chat,
    database,
    events,
    internal,
    repository,
    session,
    async start(text = "Initial request") {
      const { runId } = await chat.send({ sessionId: session.id, text });
      const completion = internal.runPromises.get(runId);
      if (!completion) throw new Error("Run completion missing");
      completions.push(completion);
      return { runId, completion };
    },
    steer(runId: string, requestId: string, text: string, draftRevision?: string) {
      return chat.steerRun({
        sessionId: session.id,
        runId,
        requestId,
        text,
        ...(draftRevision === undefined ? {} : { draftRevision }),
      });
    },
    async close() {
      chat.stop(session.id);
      await Promise.allSettled(completions);
      database.close();
    },
  };
}

function textOf(message: SessionMessage) {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("run steering runtime", () => {
  it("keeps an active model stream alive and delivers FIFO once on the same run", async () => {
    const f = fixture();
    const held = heldResponse();
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return bodies.length === 1
          ? held.respond(init.signal as AbortSignal)
          : answer("Final response");
      }),
    );
    try {
      const { runId, completion } = await f.start();
      const signal = await held.started;
      const first = await f.steer(runId, "request-1", "/compact");
      const duplicate = await f.steer(runId, "request-1", "/compact");
      const second = await f.steer(runId, "request-2", "@worker review this");
      expect(duplicate).toEqual(first);
      expect(second.messageId).not.toBe(first.messageId);
      expect(signal.aborted).toBe(false);
      expect(bodies).toHaveLength(1);
      expect(f.chat.getRunSteering(f.session.id)).toMatchObject({
        runId,
        accepting: true,
        messages: [
          { id: first.messageId, text: "/compact", status: "pending" },
          { id: second.messageId, text: "@worker review this", status: "pending" },
        ],
      });
      await expect(
        Promise.resolve().then(() => f.steer(runId, "request-1", "Different text")),
      ).rejects.toThrow();
      held.complete();
      await completion;
      expect(bodies).toHaveLength(2);
      expect(JSON.stringify(bodies[0])).not.toContain("@worker review this");
      expect(bodies[1]).toContain("/compact");
      expect(bodies[1]).toContain("@worker review this");
      const messages = f.repository.getMessages(f.session.id);
      expect(messages.map((message) => [message.role, textOf(message)])).toEqual([
        ["user", "Initial request"],
        ["assistant", "First response"],
        ["user", "/compact"],
        ["user", "@worker review this"],
        ["assistant", "Final response"],
      ]);
      expect(f.chat.getRunSteering(f.session.id)).toMatchObject({
        runId,
        accepting: false,
        messages: [
          { id: first.messageId, status: "delivered" },
          { id: second.messageId, status: "delivered" },
        ],
      });
      expect(
        f.events.some((event) => event.type === "run_completed" && event.runId === runId),
      ).toBe(true);
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    } finally {
      await f.close();
    }
  });

  it("does not interrupt a running tool or insert a user message inside its call/result pair", async () => {
    const f = fixture();
    const toolStarted = deferred<AbortSignal>();
    const finishTool = deferred<void>();
    const bodies: string[] = [];
    f.internal.executeToolCall = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      toolStarted.resolve(signal);
      await finishTool.promise;
      signal.throwIfAborted();
      return { output: "TOOL_RESULT_MARKER", isError: false };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return bodies.length === 1 ? toolCall() : answer("Tool complete");
      }),
    );
    try {
      const { runId, completion } = await f.start();
      const signal = await toolStarted.promise;
      const receipt = await f.steer(runId, "during-tool", "Follow the tool result");
      expect(signal.aborted).toBe(false);
      expect(f.internal.executeToolCall).toHaveBeenCalledTimes(1);
      expect(bodies).toHaveLength(1);
      expect(f.chat.getRunSteering(f.session.id)?.messages[0]?.status).toBe("pending");
      finishTool.resolve();
      await completion;
      expect(f.internal.executeToolCall).toHaveBeenCalledTimes(1);
      expect(bodies).toHaveLength(2);
      const stored = f.repository.getMessages(f.session.id);
      const callIndex = stored.findIndex((message) =>
        message.parts.some((part) => part.type === "tool_call"),
      );
      const resultIndex = stored.findIndex((message) =>
        message.parts.some((part) => part.type === "tool_result"),
      );
      const steeringIndex = stored.findIndex(
        (message) => textOf(message) === "Follow the tool result",
      );
      expect(callIndex).toBeGreaterThanOrEqual(0);
      expect(resultIndex).toBeGreaterThan(callIndex);
      expect(steeringIndex).toBeGreaterThan(resultIndex);
      expect(bodies[1]?.indexOf("TOOL_RESULT_MARKER")).toBeLessThan(
        bodies[1]?.indexOf("Follow the tool result") ?? -1,
      );
      expect(f.chat.getRunSteering(f.session.id)?.messages[0]).toMatchObject({
        id: receipt.messageId,
        status: "delivered",
      });
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    } finally {
      finishTool.resolve();
      await f.close();
    }
  });

  it("preserves native Gemini tool state and adds guidance after the function response", async () => {
    const f = fixture(":memory:", true);
    const toolStarted = deferred<void>();
    const finishTool = deferred<void>();
    const bodies: Array<Record<string, unknown>> = [];
    const parts = [
      { text: "Inspecting", thought: true, thoughtSignature: "thought-signature" },
      {
        functionCall: { name: "web_search", args: { query: "fixture" } },
        thoughtSignature: "tool-signature",
      },
    ];
    f.internal.executeToolCall = vi.fn(async () => {
      toolStarted.resolve();
      await finishTool.promise;
      return { output: "Native tool result", isError: false };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(
          sse({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: bodies.length === 1 ? parts : [{ text: "Native final" }],
                },
                finishReason: "STOP",
              },
            ],
          }),
        );
      }),
    );
    try {
      const { runId, completion } = await f.start();
      await toolStarted.promise;
      const receipt = await f.steer(runId, "native", "Use the native tool result");
      finishTool.resolve();
      await completion;
      expect(bodies).toHaveLength(2);
      const contents = bodies[1]?.contents as Array<{ role: string; parts: unknown[] }>;
      expect(contents[1]).toEqual({ role: "model", parts });
      expect(contents[2]).toMatchObject({
        role: "user",
        parts: [
          { functionResponse: { name: "web_search", response: { output: "Native tool result" } } },
          { text: "Use the native tool result" },
        ],
      });
      expect(f.chat.getRunSteering(f.session.id)?.messages[0]).toMatchObject({
        id: receipt.messageId,
        status: "delivered",
      });
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    } finally {
      finishTool.resolve();
      await f.close();
    }
  });

  it.each(["cancel", "failure"] as const)(
    "marks pending steering unapplied after %s and never replays it into a later run",
    async (kind) => {
      const f = fixture();
      const held = heldResponse();
      const nextHeld = heldResponse();
      const bodies: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          bodies.push(String(init.body));
          return bodies.length === 1
            ? held.respond(init.signal as AbortSignal)
            : nextHeld.respond(init.signal as AbortSignal);
        }),
      );
      try {
        const { runId, completion } = await f.start();
        await held.started;
        const receipt = await f.steer(runId, "pending-failure", "DO_NOT_REPLAY_STEERING");
        if (kind === "cancel") f.chat.stop(f.session.id);
        else held.fail();
        await completion;
        expect(f.chat.getRunSteering(f.session.id)).toMatchObject({
          runId,
          accepting: false,
          messages: [{ id: receipt.messageId, status: "unapplied" }],
        });
        expect(f.chat.getRunSteering(f.session.id)?.messages[0]?.reason).toBeTruthy();
        expect(
          f.repository
            .getMessages(f.session.id)
            .some((message) => textOf(message).includes("DO_NOT_REPLAY_STEERING")),
        ).toBe(false);
        await expect(
          Promise.resolve().then(() => f.steer(runId, "too-late", "Late guidance")),
        ).rejects.toThrow();
        const next = await f.start("New independent request");
        const nextSignal = await nextHeld.started;
        await expect(
          Promise.resolve().then(() => f.steer(runId, "old-run", "Stale run guidance")),
        ).rejects.toThrow();
        expect(nextSignal.aborted).toBe(false);
        expect(
          f.chat
            .getRunSteering(f.session.id)
            ?.messages.some((message) => message.text === "Stale run guidance"),
        ).toBe(false);
        nextHeld.complete();
        await next.completion;
        expect(bodies.at(-1)).not.toContain("DO_NOT_REPLAY_STEERING");
      } finally {
        await f.close();
      }
    },
  );

  it("rejects a stale draft revision without consuming newer text or enqueuing guidance", async () => {
    const f = fixture();
    const held = heldResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => held.respond(init.signal as AbortSignal)),
    );
    try {
      const { runId, completion } = await f.start();
      await held.started;
      f.repository.saveComposerDraft({
        sessionId: f.session.id,
        baseRevision: null,
        revision: "current-revision",
        text: "Newer draft",
        formatted: false,
        attachmentIds: [],
        notificationDraftIds: [],
      });
      await expect(
        Promise.resolve().then(() => f.steer(runId, "stale", "Older draft", "old-revision")),
      ).rejects.toThrow();
      expect(f.repository.getComposerDraft(f.session.id)).toMatchObject({
        revision: "current-revision",
        text: "Newer draft",
      });
      expect(f.chat.getRunSteering(f.session.id)?.messages ?? []).toHaveLength(0);
      f.chat.stop(f.session.id);
      await completion;
    } finally {
      await f.close();
    }
  });

  it("consumes a matching draft once when steering is accepted", async () => {
    const f = fixture();
    const held = heldResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => held.respond(init.signal as AbortSignal)),
    );
    try {
      const { runId, completion } = await f.start();
      await held.started;
      f.repository.saveComposerDraft({
        sessionId: f.session.id,
        baseRevision: null,
        revision: "accepted-revision",
        text: "Draft guidance",
        formatted: false,
        attachmentIds: [],
        notificationDraftIds: [],
      });
      const receipt = await f.steer(runId, "accepted-draft", "Draft guidance", "accepted-revision");
      expect(f.repository.getComposerDraft(f.session.id)).toBeNull();
      expect(f.chat.getRunSteering(f.session.id)?.messages).toMatchObject([
        { id: receipt.messageId, text: "Draft guidance", status: "pending" },
      ]);

      f.repository.saveComposerDraft({
        sessionId: f.session.id,
        baseRevision: null,
        revision: "new-revision",
        text: "New draft",
        formatted: false,
        attachmentIds: [],
        notificationDraftIds: [],
      });
      expect(await f.steer(runId, "accepted-draft", "Draft guidance", "accepted-revision")).toEqual(
        receipt,
      );
      expect(f.repository.getComposerDraft(f.session.id)).toMatchObject({
        revision: "new-revision",
        text: "New draft",
      });
      expect(f.chat.getRunSteering(f.session.id)?.messages).toHaveLength(1);
      expect(f.events.filter((event) => event.type === "composer_draft_consumed")).toHaveLength(1);
      f.chat.stop(f.session.id);
      await completion;
    } finally {
      await f.close();
    }
  });

  it("rolls back draft consumption and steering when acceptance fails inside the transaction", async () => {
    const f = fixture();
    const held = heldResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => held.respond(init.signal as AbortSignal)),
    );
    try {
      const { runId, completion } = await f.start();
      await held.started;
      f.repository.saveComposerDraft({
        sessionId: f.session.id,
        baseRevision: null,
        revision: "rollback-revision",
        text: "Keep draft",
        formatted: false,
        attachmentIds: [],
        notificationDraftIds: [],
      });
      const clear = f.repository.clearComposerDraft.bind(f.repository);
      const failure = vi
        .spyOn(f.repository, "clearComposerDraft")
        .mockImplementation((sessionId, revision) => {
          clear(sessionId, revision);
          throw new Error("injected acceptance failure");
        });
      await expect(
        Promise.resolve().then(() => f.steer(runId, "rollback", "Keep draft", "rollback-revision")),
      ).rejects.toThrow("injected acceptance failure");
      failure.mockRestore();
      expect(f.repository.getComposerDraft(f.session.id)).toMatchObject({
        revision: "rollback-revision",
        text: "Keep draft",
      });
      expect(f.chat.getRunSteering(f.session.id)?.messages ?? []).toHaveLength(0);

      const receipt = await f.steer(runId, "rollback", "Keep draft", "rollback-revision");
      expect(f.repository.getComposerDraft(f.session.id)).toBeNull();
      expect(f.chat.getRunSteering(f.session.id)?.messages).toMatchObject([
        { id: receipt.messageId, status: "pending" },
      ]);
      f.chat.stop(f.session.id);
      await completion;
    } finally {
      await f.close();
    }
  });

  it.each(["second-append", "state-write"] as const)(
    "rolls back the entire steering batch if delivery fails at %s",
    async (kind) => {
      const f = fixture();
      const held = heldResponse();
      const bodies: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          bodies.push(String(init.body));
          return bodies.length === 1 ? held.respond(init.signal as AbortSignal) : answer("Done");
        }),
      );
      try {
        const { runId, completion } = await f.start();
        await held.started;
        const first = await f.steer(runId, "delivery-first", "DELIVERY_ROLLBACK_FIRST");
        const second = await f.steer(runId, "delivery-second", "DELIVERY_ROLLBACK_SECOND");
        const append = f.repository.appendMessage.bind(f.repository);
        const setSetting = f.repository.setSetting.bind(f.repository);
        let injected = false;
        vi.spyOn(f.repository, "appendMessage").mockImplementation((input) => {
          const result = append(input);
          if (
            kind === "second-append" &&
            input.role === "user" &&
            input.parts.some(
              (part) => part.type === "text" && part.text === "DELIVERY_ROLLBACK_SECOND",
            )
          ) {
            injected = true;
            throw new Error("injected delivery failure");
          }
          return result;
        });
        vi.spyOn(f.repository, "setSetting").mockImplementation((key, value) => {
          const storage = value as { runs?: Array<{ messages?: Array<{ status?: string }> }> };
          if (
            kind === "state-write" &&
            key === `runSteering.v1.${f.session.id}` &&
            storage.runs?.some((run) =>
              run.messages?.some((message) => message.status === "delivered"),
            )
          ) {
            injected = true;
            throw new Error("injected delivery failure");
          }
          setSetting(key, value);
        });
        held.complete();
        await completion;
        expect(injected).toBe(true);
        expect(
          f.repository
            .getMessages(f.session.id)
            .some((message) => textOf(message).startsWith("DELIVERY_ROLLBACK_")),
        ).toBe(false);
        expect(f.chat.getRunSteering(f.session.id)?.messages).toMatchObject([
          { id: first.messageId, status: "unapplied" },
          { id: second.messageId, status: "unapplied" },
        ]);
        expect(
          f.chat.getRunSteering(f.session.id)?.messages.every((message) => message.reason),
        ).toBe(true);
        expect(bodies).toHaveLength(1);
        expect(f.events.some((event) => event.type === "run_failed")).toBe(true);
      } finally {
        await f.close();
      }
    },
  );

  it.each(["attachment", "different-text"] as const)(
    "does not consume a draft containing unsent %s",
    async (kind) => {
      const f = fixture();
      const held = heldResponse();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => held.respond(init.signal as AbortSignal)),
      );
      try {
        const { runId, completion } = await f.start();
        await held.started;
        const attachment = {
          id: "file-1",
          name: "file.bin",
          mimeType: "application/octet-stream",
          size: 4,
          kind: "file" as const,
          dataUrl: "data:application/octet-stream;base64,AP8DgA==",
          path: "C:\\fixture\\file.bin",
        };
        f.repository.saveComposerDraft({
          sessionId: f.session.id,
          baseRevision: null,
          revision: "unsent-revision",
          text: kind === "different-text" ? "Original longer draft" : "Guidance",
          formatted: false,
          attachmentIds: kind === "attachment" ? [attachment.id] : [],
          addedAttachments: kind === "attachment" ? [attachment] : [],
          notificationDraftIds: [],
        });
        await expect(
          Promise.resolve().then(() => f.steer(runId, "unsent", "Guidance", "unsent-revision")),
        ).rejects.toThrow();
        expect(f.repository.getComposerDraft(f.session.id)).toMatchObject({
          revision: "unsent-revision",
          text: kind === "different-text" ? "Original longer draft" : "Guidance",
          attachments: kind === "attachment" ? [attachment] : [],
        });
        expect(f.chat.getRunSteering(f.session.id)?.messages ?? []).toHaveLength(0);
        expect(f.events.filter((event) => event.type === "composer_draft_consumed")).toHaveLength(
          0,
        );
        f.chat.stop(f.session.id);
        await completion;
      } finally {
        await f.close();
      }
    },
  );

  it("keeps steering pending while a prepared context is still being assembled", async () => {
    const f = fixture();
    const prepared = deferred<void>();
    const finishPreparation = deferred<void>();
    const firstModel = heldResponse();
    const bodies: string[] = [];
    const prepare = f.internal.contextCompaction.prepare.bind(f.internal.contextCompaction);
    f.internal.contextCompaction.prepare = vi.fn(async (...args: never[]) => {
      const messages = await prepare(...args);
      if (bodies.length === 0) {
        prepared.resolve();
        await finishPreparation.promise;
      }
      return messages;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return bodies.length === 1
          ? firstModel.respond(init.signal as AbortSignal)
          : answer("Done");
      }),
    );
    try {
      const { runId, completion } = await f.start("INITIAL_CONSTRAINT");
      await prepared.promise;
      const first = await f.steer(runId, "prepare-1", "FIRST_GUIDANCE");
      const second = await f.steer(runId, "prepare-2", "SECOND_GUIDANCE");
      expect(f.chat.getRunSteering(f.session.id)?.messages).toMatchObject([
        { id: first.messageId, status: "pending" },
        { id: second.messageId, status: "pending" },
      ]);
      expect(bodies).toHaveLength(0);
      finishPreparation.resolve();
      await firstModel.started;
      firstModel.complete();
      await completion;
      const requestWithGuidance = bodies.find((body) => body.includes("FIRST_GUIDANCE"));
      expect(requestWithGuidance).toContain("INITIAL_CONSTRAINT");
      expect(requestWithGuidance).toContain("SECOND_GUIDANCE");
      expect(requestWithGuidance?.indexOf("FIRST_GUIDANCE")).toBeLessThan(
        requestWithGuidance?.indexOf("SECOND_GUIDANCE") ?? -1,
      );
      expect(f.chat.getRunSteering(f.session.id)?.messages).toMatchObject([
        { id: first.messageId, status: "delivered" },
        { id: second.messageId, status: "delivered" },
      ]);
    } finally {
      finishPreparation.resolve();
      await f.close();
    }
  });

  it("retains accepted guidance through an in-flight history compaction", async () => {
    const f = fixture();
    const summary = heldResponse("Summary retains ORIGINAL_CONSTRAINT.");
    const bodies: string[] = [];
    f.repository.setSetting("plugins.tokenSaver", {
      enabled: true,
      historySummaries: true,
      minimumSummaryTokens: 1024,
      deduplicate: false,
    });
    f.repository.appendMessage({
      sessionId: f.session.id,
      role: "user",
      parts: [{ type: "text", text: "ORIGINAL_CONSTRAINT" }],
    });
    for (let index = 0; index < 10; index++) {
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "assistant",
        parts: [{ type: "text", text: `Old explanation ${index}. `.repeat(100) }],
      });
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "user",
        parts: [{ type: "text", text: `Old turn ${index}` }],
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return bodies.length === 1 ? summary.respond(init.signal as AbortSignal) : answer("Done");
      }),
    );
    try {
      const { runId, completion } = await f.start("CURRENT_CONSTRAINT");
      const signal = await summary.started;
      expect(bodies[0]).toContain("ORIGINAL_CONSTRAINT");
      const first = await f.steer(runId, "compact-1", "COMPACT_GUIDANCE_1");
      const second = await f.steer(runId, "compact-2", "COMPACT_GUIDANCE_2");
      expect(signal.aborted).toBe(false);
      expect(f.chat.getRunSteering(f.session.id)?.messages).toMatchObject([
        { id: first.messageId, status: "pending" },
        { id: second.messageId, status: "pending" },
      ]);
      summary.complete();
      await completion;
      const request = bodies.slice(1).find((body) => body.includes("COMPACT_GUIDANCE_1"));
      expect(request).toContain("ORIGINAL_CONSTRAINT");
      expect(request).toContain("CURRENT_CONSTRAINT");
      expect(request).toContain("COMPACT_GUIDANCE_2");
      expect(request?.indexOf("COMPACT_GUIDANCE_1")).toBeLessThan(
        request?.indexOf("COMPACT_GUIDANCE_2") ?? -1,
      );
      expect(f.chat.getRunSteering(f.session.id)?.messages).toMatchObject([
        { id: first.messageId, status: "delivered" },
        { id: second.messageId, status: "delivered" },
      ]);
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    } finally {
      await f.close();
    }
  });

  it("never silently loses guidance submitted during final cleanup", async () => {
    const f = fixture();
    const cleanupStarted = deferred<void>();
    const finishCleanup = deferred<void>();
    const bodies: string[] = [];
    f.internal.runPluginHooks = vi.fn(async (event: string) => {
      if (event === "Stop") {
        cleanupStarted.resolve();
        await finishCleanup.promise;
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return answer("Final response");
      }),
    );
    try {
      const { runId, completion } = await f.start();
      await cleanupStarted.promise;
      const receipt = await Promise.resolve()
        .then(() => f.steer(runId, "cleanup", "CLEANUP_GUIDANCE"))
        .catch(() => null);
      finishCleanup.resolve();
      await completion;
      if (receipt) {
        const message = f.chat
          .getRunSteering(f.session.id)
          ?.messages.find((entry) => entry.id === receipt.messageId);
        expect(["delivered", "unapplied"]).toContain(message?.status);
        if (message?.status === "delivered")
          expect(bodies.some((body) => body.includes("CLEANUP_GUIDANCE"))).toBe(true);
        else expect(message?.reason).toBeTruthy();
      } else {
        expect(
          f.repository
            .getMessages(f.session.id)
            .some((message) => textOf(message) === "CLEANUP_GUIDANCE"),
        ).toBe(false);
      }
    } finally {
      finishCleanup.resolve();
      await f.close();
    }
  });

  it("stops accepting guidance even if persisting run closure fails", async () => {
    const f = fixture();
    const held = heldResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => held.respond(init.signal as AbortSignal)),
    );
    try {
      const { runId, completion } = await f.start();
      await held.started;
      const setSetting = f.repository.setSetting.bind(f.repository);
      let closureFailures = 0;
      const failure = vi.spyOn(f.repository, "setSetting").mockImplementation((key, value) => {
        if (key === `runSteering.v1.${f.session.id}`) {
          closureFailures++;
          throw new Error("injected closure write failure");
        }
        setSetting(key, value);
      });
      held.complete();
      await completion.catch(() => undefined);
      failure.mockRestore();
      expect(closureFailures).toBeGreaterThan(0);
      expect(f.chat.getRunSteering(f.session.id)?.accepting).toBe(false);
      await expect(
        Promise.resolve().then(() => f.steer(runId, "after-close-failure", "Too late")),
      ).rejects.toThrow();
      expect(
        f.repository.getMessages(f.session.id).some((message) => textOf(message) === "Too late"),
      ).toBe(false);
    } finally {
      await f.close();
    }
  });

  it("recovers a pending steering message as unapplied after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-steering-"));
    const path = join(root, "fixture.db");
    const f = fixture(path);
    const held = heldResponse();
    const bodies: string[] = [];
    let restartedDatabase: ReturnType<typeof openDatabase> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return bodies.length === 1 ? held.respond(init.signal as AbortSignal) : answer("New run");
      }),
    );
    try {
      const { runId, completion } = await f.start();
      await held.started;
      const receipt = await f.steer(runId, "restart", "RESTART_DO_NOT_REPLAY");
      restartedDatabase = openDatabase(path);
      const restartedRepository = new Repository(restartedDatabase);
      restartedRepository.recoverInterruptedRuns();
      const restarted = service(restartedRepository, []);
      expect(restarted.chat.getRunSteering(f.session.id)).toMatchObject({
        runId,
        accepting: false,
        messages: [{ id: receipt.messageId, status: "unapplied" }],
      });
      expect(restarted.chat.getRunSteering(f.session.id)?.messages[0]?.reason).toBeTruthy();

      f.chat.stop(f.session.id);
      await completion;
      const next = await restarted.chat.send({ sessionId: f.session.id, text: "New request" });
      const nextCompletion = restarted.internal.runPromises.get(next.runId);
      if (!nextCompletion) throw new Error("Restarted run completion missing");
      await nextCompletion;
      expect(bodies.at(-1)).not.toContain("RESTART_DO_NOT_REPLAY");
      expect(
        restartedRepository
          .getMessages(f.session.id)
          .some((message) => textOf(message) === "RESTART_DO_NOT_REPLAY"),
      ).toBe(false);
    } finally {
      restartedDatabase?.close();
      await f.close();
      await rm(`${path}-wal`, { force: true });
      await rm(`${path}-shm`, { force: true });
      await rm(path, { force: true });
      await rmdir(root);
    }
  });

  it("preserves damaged persisted steering metadata during restart recovery", async () => {
    const f = fixture();
    try {
      const key = `runSteering.v1.${f.session.id}`;
      const raw = "{ invalid steering metadata";
      f.database
        .prepare("insert into app_settings (key, value_json, updated_at) values (?, ?, ?)")
        .run(key, raw, new Date().toISOString());
      f.repository.recoverInterruptedRuns();
      expect(
        f.database.prepare("select value_json from app_settings where key = ?").get(key),
      ).toEqual({
        value_json: raw,
      });
    } finally {
      await f.close();
    }
  });
});
