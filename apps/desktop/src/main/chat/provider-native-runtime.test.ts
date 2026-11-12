import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent, ProviderView, SessionView } from "../../shared/domain";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ChatService } from "./chat-service";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function service(repository: Repository, events: ChatStreamEvent[]) {
  const chat = new ChatService({
    repository,
    providerService: { getActiveApiKey: () => "fixture" },
    toolRegistry: {
      hasRunningCommands: () => false,
      commandSessions: () => [],
      cancelRun: async () => undefined,
    },
    mcpService: { list: () => [] },
    emit: (event: ChatStreamEvent) => events.push(event),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    availableTools: ReturnType<typeof vi.fn>;
    buildSystemPrompt: ReturnType<typeof vi.fn>;
    executeToolCall: ReturnType<typeof vi.fn>;
    executeRun(input: object): Promise<void>;
  };
  internal.availableTools = vi.fn(async () => []);
  internal.buildSystemPrompt = vi.fn(async () => "Stable fixture prompt");
  internal.executeToolCall = vi.fn(async () => ({ output: "File contents", isError: false }));
  return { chat, internal };
}

function fixture(family: "gemini" | "deepseek", native = false, path = ":memory:") {
  const database = openDatabase(path);
  const repository = new Repository(database);
  const provider: ProviderView = repository.insertProvider({
    name: "Fixture",
    baseUrl: native
      ? "https://generativelanguage.googleapis.com/v1beta"
      : family === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta/openai"
        : "https://api.deepseek.com/v1",
    protocol: native ? "gemini_generate_content" : "openai_chat_completions",
    authMode: native ? "x_goog_api_key" : "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: native ? "gemini-3-flash-preview" : "fixture-model",
    displayName: "Fixture",
    contextWindow: 128000,
    maxOutputTokens: 1024,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: false,
    reasoningLevels: ["none", "high"],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository.getProvider(provider.id)?.models[0];
  if (!model) throw new Error("Fixture model missing");
  const session = repository.insertSession({
    title: "Native state fixture",
    providerId: provider.id,
    modelId: model.id,
    agentProfileId: "mingshen",
    workspacePath: null,
    systemPrompt: "",
    reasoningLevel: "high",
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
  });
  repository.appendMessage({
    sessionId: session.id,
    role: "user",
    parts: [{ type: "text", text: "Inspect" }],
  });
  const events: ChatStreamEvent[] = [];
  const current = service(repository, events);
  const run = (internal = current.internal, runId = "native-run", target: SessionView = session) =>
    internal.executeRun({
      session: target,
      provider,
      model,
      runId,
      signal: new AbortController().signal,
      generateTitle: false,
    });
  return { database, repository, events, session, ...current, run };
}

const chunk = (delta: object, finish_reason: string | null = null) => ({
  choices: [{ delta, finish_reason }],
});
const sse = (...events: unknown[]) =>
  new Response(
    events
      .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
      .join(""),
  );

describe("provider-native state runtime", () => {
  it("persists native Gemini Parts across database reopen and runs same-name tools in order", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-native-gemini-"));
    const path = join(root, "fixture.db");
    const f = fixture("gemini", true, path);
    let restartedDatabase: ReturnType<typeof openDatabase> | undefined;
    let closed = false;
    const bodies: Array<Record<string, unknown>> = [];
    const parts = [
      { text: "Inspecting", thought: true, thoughtSignature: "thought-signature" },
      { functionCall: { name: "read_file", args: { path: "a.txt" } }, thoughtSignature: "first" },
      { functionCall: { id: "second-wire", name: "read_file", args: { path: "b.txt" } } },
      { text: "", thoughtSignature: "empty-signature" },
    ];
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      bodies.push(JSON.parse(String(options.body)));
      return bodies.length === 1
        ? sse({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] })
        : sse({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "Final answer", thoughtSignature: "final-signature" }],
                },
                finishReason: "STOP",
              },
            ],
          });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await f.run();
      expect(f.events.filter((event) => event.type === "run_failed")).toEqual([]);
      expect(f.internal.executeToolCall).toHaveBeenCalledTimes(2);
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
      const contents = bodies[1]?.contents as Array<Record<string, unknown>>;
      expect(contents[1]).toEqual({ role: "model", parts });
      expect(contents[2]).toMatchObject({
        role: "user",
        parts: [
          { functionResponse: { name: "read_file", response: { output: "File contents" } } },
          {
            functionResponse: {
              id: "second-wire",
              name: "read_file",
              response: { output: "File contents" },
            },
          },
        ],
      });
      const stored = f.repository.getMessages(f.session.id);
      expect(
        stored.flatMap((message) => message.parts).filter((part) => part.type === "provider_state"),
      ).toHaveLength(2);
      f.database.close();
      closed = true;
      restartedDatabase = openDatabase(path);
      const repository = new Repository(restartedDatabase);
      const restarted = service(repository, f.events);
      repository.appendMessage({
        sessionId: f.session.id,
        role: "user",
        parts: [{ type: "text", text: "Continue" }],
      });
      await f.run(restarted.internal, "native-restarted");
      expect(restarted.internal.executeToolCall).not.toHaveBeenCalled();
      const replayed = bodies.at(-1)?.contents as Array<Record<string, unknown>>;
      expect(replayed[1]).toEqual({ role: "model", parts });
      expect(replayed[3]).toEqual({
        role: "model",
        parts: [{ text: "Final answer", thoughtSignature: "final-signature" }],
      });
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    } finally {
      if (!closed) f.database.close();
      restartedDatabase?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["MAX_TOKENS", "MALFORMED_FUNCTION_CALL", "SAFETY"])(
    "does not execute native tools or save state on %s",
    async (finishReason) => {
      const f = fixture("gemini", true);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sse({
            candidates: [
              {
                content: {
                  parts: [{ functionCall: { name: "read_file", args: { path: "notes.txt" } } }],
                },
                finishReason,
              },
            ],
          }),
        ),
      );
      try {
        await f.run();
        expect(f.internal.executeToolCall).not.toHaveBeenCalled();
        expect(
          f.repository
            .getMessages(f.session.id)
            .flatMap((message) => message.parts)
            .some((part) => part.type === "provider_state"),
        ).toBe(false);
        expect(f.events.some((event) => event.type === "run_failed")).toBe(true);
      } finally {
        f.database.close();
      }
    },
  );

  it("persists Gemini signed tool turns and replays them after reconstructing ChatService", async () => {
    const f = fixture("gemini");
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      bodies.push(JSON.parse(String(options.body)));
      if (bodies.length === 1)
        return sse(
          chunk(
            {
              tool_calls: [
                {
                  index: 0,
                  id: "signed-call",
                  type: "function",
                  function: { name: "read_file", arguments: '{"path":"notes.txt"}' },
                },
              ],
            },
            "tool_calls",
          ),
          chunk({
            tool_calls: [
              { index: 0, extra_content: { google: { thought_signature: "tool-signature" } } },
            ],
          }),
          "[DONE]",
        );
      return sse(
        chunk({ content: "Final answer" }, "stop"),
        chunk({ extra_content: { google: { thought_signature: "answer-signature" } } }),
        "[DONE]",
      );
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await f.run();
      expect(f.internal.executeToolCall).toHaveBeenCalledTimes(1);
      const stored = f.repository.getMessages(f.session.id);
      expect(
        stored.flatMap((message) => message.parts).filter((part) => part.type === "provider_state"),
      ).toHaveLength(2);
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
      const restarted = service(f.repository, f.events);
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "user",
        parts: [{ type: "text", text: "Continue" }],
      });
      await f.run(restarted.internal, "restarted-run");
      const messages = bodies.at(-1)?.messages as Array<Record<string, unknown>>;
      const signed = messages.find((message) => Array.isArray(message.tool_calls));
      expect(signed).toBeDefined();
      const calls = signed?.tool_calls as Array<Record<string, unknown>> | undefined;
      expect(calls?.[0]).toMatchObject({
        id: "signed-call",
        extra_content: { google: { thought_signature: "tool-signature" } },
      });
      expect(messages.find((message) => message.content === "Final answer")).toMatchObject({
        extra_content: { google: { thought_signature: "answer-signature" } },
      });
      expect(restarted.internal.executeToolCall).not.toHaveBeenCalled();
    } finally {
      f.database.close();
    }
  });

  it("discards incomplete DeepSeek reasoning and signatures before retry, then persists successful state", async () => {
    vi.useFakeTimers();
    const f = fixture("deepseek");
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      bodies.push(String(options.body));
      if (bodies.length === 1)
        return sse(
          chunk({
            reasoning_content: "Discard incomplete native reasoning",
            tool_calls: [
              {
                index: 0,
                id: "discarded-call",
                function: { name: "read_file", arguments: '{"path":"unfinished' },
              },
            ],
          }),
        );
      if (bodies.length === 2)
        return sse(
          chunk(
            {
              reasoning_content: "Exact successful native reasoning",
              tool_calls: [
                {
                  index: 0,
                  id: "completed-call",
                  function: { name: "read_file", arguments: '{"path":"notes.txt"}' },
                },
              ],
            },
            "tool_calls",
          ),
          "[DONE]",
        );
      return sse(
        chunk({ reasoning_content: "Final native reasoning", content: "Recovered answer" }, "stop"),
        "[DONE]",
      );
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const pending = f.run();
      await vi.runAllTimersAsync();
      await pending;
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(f.internal.executeToolCall).toHaveBeenCalledTimes(1);
      expect(bodies[0]).toBe(bodies[1]);
      const final = JSON.parse(bodies[2] ?? "{}");
      expect(
        final.messages.find((message: Record<string, unknown>) =>
          Array.isArray(message.tool_calls),
        ),
      ).toMatchObject({
        reasoning_content: "Exact successful native reasoning",
      });
      const stored = JSON.stringify(f.repository.getMessages(f.session.id));
      expect(stored).toContain("Exact successful native reasoning");
      expect(stored).toContain("Final native reasoning");
      expect(stored).not.toContain("Discard incomplete");
      expect(stored).not.toContain("discarded-call");
      expect(f.events.some((event) => event.type === "model_attempt_reset")).toBe(true);
      expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    } finally {
      f.database.close();
    }
  });
});
