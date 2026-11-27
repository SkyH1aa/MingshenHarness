import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "../../shared/domain";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ChatService } from "./chat-service";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fixture() {
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Fixture",
    baseUrl: "https://fixture.invalid/v1",
    protocol: "openai_responses",
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "retry",
    displayName: "Retry",
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
    title: "Retry fixture",
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
  const events: ChatStreamEvent[] = [];
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
  internal.buildSystemPrompt = vi.fn(async () => "Fixture");
  internal.executeToolCall = vi.fn(async () => ({
    output: "File operation completed once",
    isError: false,
  }));
  const controller = new AbortController();
  return {
    database,
    repository,
    events,
    chat,
    internal,
    session,
    controller,
    run: () =>
      internal.executeRun({
        session,
        provider,
        model,
        runId: "retry-run",
        signal: controller.signal,
        generateTitle: false,
      }),
  };
}
const sse = (...events: unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
describe("runtime model retry boundaries", () => {
  it("persists validated retry settings without changing schema or subagent limits", () => {
    const f = fixture();
    try {
      expect(f.chat.getModelRetrySettings()).toEqual({ maxRetries: 5 });
      expect(f.chat.setModelRetrySettings({ maxRetries: 20 })).toEqual({ maxRetries: 20 });
      expect(f.chat.getModelRetrySettings()).toEqual({ maxRetries: 20 });
      for (const maxRetries of [-1, 21, 1.5, Number.NaN])
        expect(() => f.chat.setModelRetrySettings({ maxRetries })).toThrow("0 到 20");
      expect(f.chat.getAgentRuntimeSettings()).toEqual({ maxConcurrentSubagents: 3 });
      expect(f.chat.setModelRetrySettings({ maxRetries: 0 })).toEqual({ maxRetries: 0 });
    } finally {
      f.database.close();
    }
  });
  it("retries only the failed model turn, never replays a completed tool and discards partial tool calls", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.internal.availableTools.mockResolvedValue([
      {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    ]);
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      bodies.push(String(options.body));
      if (bodies.length === 1)
        return sse(
          {
            type: "response.output_item.added",
            item: {
              type: "function_call",
              call_id: "completed-call",
              name: "read_file",
              arguments: '{"path":"notes.txt"}',
            },
          },
          { type: "response.completed" },
        );
      if (bodies.length === 2)
        return sse(
          { type: "response.output_text.delta", delta: "Discard this partial answer" },
          {
            type: "response.output_item.added",
            item: {
              type: "function_call",
              call_id: "discarded-call",
              name: "write_file",
              arguments: '{"path":"notes.txt","content":"unfinished',
            },
          },
        );
      return sse(
        { type: "response.output_text.delta", delta: "Recovered final answer" },
        { type: "response.completed" },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const pending = f.run();
      await vi.runAllTimersAsync();
      await pending;
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(f.internal.executeToolCall).toHaveBeenCalledTimes(1);
      expect(bodies[1]).toBe(bodies[2]);
      for (const body of bodies.slice(1)) {
        expect(body).toContain('"name":"read_file"');
        expect(body).toContain('"name":"write_file"');
      }
      const stored = JSON.stringify(f.repository.getMessages(f.session.id));
      expect(stored).toContain("Recovered final answer");
      expect(stored).toContain("File operation completed once");
      expect(stored).not.toContain("discarded-call");
      expect(stored).not.toContain("Discard this partial answer");
      expect(f.events.some((event) => event.type === "model_attempt_reset")).toBe(true);
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
      expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
      const activities = f.events
        .filter((event) => event.type === "activity")
        .map((event) => event.activity);
      expect(
        activities.findLast((activity) => activity.id === "retry-run:discarded-call")?.status,
      ).toBe("failed");
      expect(activities.findLast((activity) => activity.toolName === "model_retry")?.status).toBe(
        "completed",
      );
    } finally {
      f.database.close();
    }
  });
  it("fails finitely when every attempt emits partial output, without executing or losing tools", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.chat.setModelRetrySettings({ maxRetries: 2 });
    f.internal.availableTools.mockResolvedValue([
      {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    ]);
    let attempt = 0;
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      bodies.push(String(options.body));
      attempt++;
      return sse(
        { type: "response.output_text.delta", delta: `Partial answer ${attempt}` },
        {
          type: "response.output_item.added",
          item: {
            type: "function_call",
            call_id: `incomplete-call-${attempt}`,
            name: "write_file",
            arguments: `{"path":"unfinished-${attempt}.md","content":"partial`,
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const pending = f.run();
      await vi.runAllTimersAsync();
      await pending;

      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(bodies).toHaveLength(3);
      for (const body of bodies) {
        expect(body).toContain('"name":"read_file"');
        expect(body).toContain('"name":"write_file"');
      }
      expect(f.internal.executeToolCall).not.toHaveBeenCalled();
      expect(f.events.filter((event) => event.type === "model_attempt_reset")).toHaveLength(2);
      expect(f.events.find((event) => event.type === "run_failed")).toMatchObject({
        error: expect.stringContaining("最终模型响应未完成"),
      });
      expect(f.repository.getSession(f.session.id)?.status).toBe("error");
      const stored = JSON.stringify(f.repository.getMessages(f.session.id));
      expect(stored).not.toContain("Partial answer");
      expect(stored).not.toContain("incomplete-call");
    } finally {
      f.database.close();
    }
  });
  it("keeps the final full error after exhaustion and never executes a partially streamed tool", async () => {
    const f = fixture();
    f.chat.setModelRetrySettings({ maxRetries: 2 });
    const diagnostic = `Final upstream diagnostic\n${"Diagnostic detail\n".repeat(200)}api_key=fixture\nRETRY_ERROR_TAIL`;
    const fetcher = vi.fn(
      async () =>
        new Response(diagnostic, {
          status: 503,
          headers: { "retry-after-ms": "0", "x-request-id": "trace-129" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      await f.run();
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(f.internal.executeToolCall).not.toHaveBeenCalled();
      expect(f.repository.getSession(f.session.id)?.status).toBe("error");
      expect(f.events.find((event) => event.type === "run_failed")).toMatchObject({
        error: expect.stringContaining("HTTP 503"),
      });
      expect(JSON.stringify(f.repository.getMessages(f.session.id))).toContain("trace-129");
      const activities = f.events
        .filter((event) => event.type === "activity")
        .map((event) => event.activity);
      const retries = activities.filter((activity) => activity.toolName === "model_retry");
      expect(retries.at(-1)?.status).toBe("failed");
      expect(retries.length).toBeGreaterThan(0);
      for (const retry of retries) {
        expect(retry.detail).toContain("RETRY_ERROR_TAIL");
        expect(retry.detail).toContain("api_key=[REDACTED]");
        expect(retry.detail).not.toContain("api_key=fixture");
      }
      expect(JSON.stringify(f.repository.getMessages(f.session.id))).toContain("RETRY_ERROR_TAIL");
    } finally {
      f.database.close();
    }
  });
  it("gives each model round one bounded retry budget without replaying completed tools", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.chat.setModelRetrySettings({ maxRetries: 2 });
    let request = 0;
    const fetcher = vi.fn(async () => {
      request++;
      if (request === 3)
        return sse(
          {
            type: "response.output_item.added",
            item: {
              type: "function_call",
              call_id: "execute-once",
              name: "read_file",
              arguments: '{"path":"notes.txt"}',
            },
          },
          { type: "response.completed" },
        );
      if (request === 6)
        return sse({ type: "response.output_text.delta", delta: "Failed partial output" });
      return new Response("Unavailable", { status: 503, headers: { "retry-after-ms": "0" } });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const pending = f.run();
      await vi.runAllTimersAsync();
      await pending;
      expect(fetcher).toHaveBeenCalledTimes(6);
      expect(f.internal.executeToolCall).toHaveBeenCalledTimes(1);
      const reconnecting = f.events
        .filter((event) => event.type === "activity")
        .map((event) => event.activity)
        .filter((activity) => activity.toolName === "model_retry" && activity.status === "running");
      expect(reconnecting.map((activity) => activity.title)).toEqual([
        "正在自动尝试重连（1/2）",
        "正在自动尝试重连（2/2）",
        "正在自动尝试重连（1/2）",
        "正在自动尝试重连（2/2）",
      ]);
      const stored = JSON.stringify(f.repository.getMessages(f.session.id));
      expect(stored).not.toContain("Failed partial output");
      expect(f.events.some((event) => event.type === "run_failed")).toBe(true);
      expect(f.repository.getSession(f.session.id)?.status).toBe("error");
    } finally {
      f.database.close();
    }
  });
  it("stops immediately during the backoff without requesting or executing again", async () => {
    const f = fixture();
    const fetcher = vi.fn(
      async () => new Response("Unavailable", { status: 503, headers: { "retry-after": "300" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    const emit = f.events.push.bind(f.events);
    f.events.push = (...events) => {
      const result = emit(...events);
      if (
        events.some(
          (event) =>
            event.type === "activity" &&
            event.activity.toolName === "model_retry" &&
            event.activity.status === "running",
        )
      )
        queueMicrotask(() => f.controller.abort());
      return result;
    };
    try {
      await f.run();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(f.internal.executeToolCall).not.toHaveBeenCalled();
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
      expect(f.events.filter((event) => event.type === "activity").at(-1)).toMatchObject({
        activity: { status: "failed", title: "重试已取消" },
      });
    } finally {
      f.database.close();
    }
  });
  it("ends partial file preparation on the final failed attempt without executing it", async () => {
    const f = fixture();
    f.chat.setModelRetrySettings({ maxRetries: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse({
          type: "response.output_item.added",
          item: {
            type: "function_call",
            call_id: "incomplete",
            name: "write_file",
            arguments: '{"path":"unfinished.txt","content":"',
          },
        }),
      ),
    );
    try {
      await f.run();
      expect(f.internal.executeToolCall).not.toHaveBeenCalled();
      const activities = f.events
        .filter((event) => event.type === "activity")
        .map((event) => event.activity);
      expect(
        activities.findLast((activity) => activity.id === "retry-run:incomplete")?.status,
      ).toBe("failed");
      expect(f.repository.getSession(f.session.id)?.status).toBe("error");
    } finally {
      f.database.close();
    }
  });
});
