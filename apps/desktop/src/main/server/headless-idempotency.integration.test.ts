import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "../../shared/domain";
import { ChatService } from "../chat/chat-service";
import { ApprovalBroker } from "../permissions/approval-broker";
import { PermissionStore } from "../permissions/permission-store";
import { QuestionBroker } from "../permissions/question-broker";
import { RuntimeService } from "../runtime/runtime-service";
import { SessionService } from "../sessions/session-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { TrajectoryService } from "../trajectories/trajectory-service";
import { HeadlessServerService } from "./headless-server-service";

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
  let controller!: ReadableStreamDefaultController<Uint8Array>;
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
      if (finished) return;
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

function fixture() {
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Idempotency fixture",
    baseUrl: "https://fixture.invalid/v1",
    protocol: "openai_responses",
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "idempotency-fixture",
    displayName: "Idempotency fixture",
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
    title: "Idempotency fixture",
    providerId: provider.id,
    modelId: model.id,
    agentProfileId: "mingshen",
    workspacePath: null,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
  });
  const runtime = new RuntimeService(database, repository);
  const approvalBroker = new ApprovalBroker();
  const questionBroker = new QuestionBroker();
  const emit = vi.fn((_event: ChatStreamEvent) => undefined);
  const agentProfileService = {
    list: vi.fn(async () => []),
    syncWorkspace: vi.fn(async () => undefined),
  };
  const customCommandService = {
    list: vi.fn(async () => []),
    prepare: vi.fn(async () => null),
  };
  const mcpService = {
    list: () => [],
    toolDefinitions: vi.fn(async () => []),
  };
  const chat = new ChatService({
    repository,
    runtimeService: runtime,
    providerService: { getActiveApiKey: () => "fixture" },
    agentProfileService,
    customCommandService,
    toolRegistry: {
      descriptors: () => [],
      hasRunningCommands: () => false,
      commandSessions: () => [],
      cancelRun: async () => undefined,
      confirmRunStopped: vi.fn(),
      invalidateCache: vi.fn(),
    },
    approvalBroker,
    permissions: new PermissionStore(),
    questionBroker,
    mcpService,
    emit,
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    availableTools: ReturnType<typeof vi.fn>;
    buildSystemPrompt: ReturnType<typeof vi.fn>;
  };
  internal.availableTools = vi.fn(async () => []);
  internal.buildSystemPrompt = vi.fn(async () => "Idempotency fixture");
  chat.setModelRetrySettings({ maxRetries: 0 });

  const headless = new HeadlessServerService(
    repository,
    new SessionService(repository),
    chat,
    agentProfileService as unknown as ConstructorParameters<typeof HeadlessServerService>[3],
    customCommandService as unknown as ConstructorParameters<typeof HeadlessServerService>[4],
    {
      status: vi.fn(async () => []),
    } as unknown as ConstructorParameters<typeof HeadlessServerService>[5],
    mcpService as unknown as ConstructorParameters<typeof HeadlessServerService>[6],
    new TrajectoryService(repository),
    approvalBroker,
    questionBroker,
    emit,
  );
  headless.setRuntimeService(runtime);
  headless.setRunCanceller((runId) => chat.stopRun(runId));

  return {
    chat,
    database,
    headless,
    repository,
    runtime,
    session,
    async close() {
      await headless.stop();
      chat.stop(session.id);
      await chat.shutdown();
      database.close();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("headless request-parts idempotency", () => {
  it("uses the ChatService host hash for request parts and rejects changed parts", async () => {
    const f = fixture();
    const held = heldResponse("Accepted once");
    const modelRequests: Array<{ url: string; body: string }> = [];
    const nativeFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        modelRequests.push({
          url: String(url),
          body: String(init?.body ?? ""),
        });
        return held.respond(init?.signal as AbortSignal);
      }),
    );

    try {
      const status = await f.headless.start("127.0.0.1", 0);
      const turnsUrl = `${status.url}/v1/sessions/${f.session.id}/turns`;
      const post = (parts: unknown) =>
        nativeFetch(turnsUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${status.token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": "parts-identity-key",
          },
          body: JSON.stringify({
            text: "Execute the request once",
            parts,
          }),
        });
      const requestParts = [{ type: "identity", marker: "parts-v1" }];

      const first = await post(requestParts);
      expect(first.status).toBe(202);
      const firstBody = (await first.json()) as { runId: string };
      await held.started;

      const duplicate = await post(requestParts);
      expect(duplicate.status).toBe(202);
      expect(await duplicate.json()).toMatchObject({ runId: firstBody.runId });

      const conflict = await post([{ type: "identity", marker: "parts-v2" }]);
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

      expect(f.runtime.listRuns(f.session.id)).toHaveLength(1);
      expect(modelRequests).toHaveLength(1);
      expect(modelRequests[0]?.body).not.toContain("parts-v1");

      held.complete();
      await vi.waitFor(() => {
        expect(f.runtime.getRun(firstBody.runId).status).toBe("completed");
      });
    } finally {
      held.complete();
      await f.close();
    }
  });
});
