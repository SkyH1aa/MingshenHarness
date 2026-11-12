import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderProtocol, ResponsesStateItem, SessionMessage } from "../../shared/domain";
import { type ModelStreamEvent, type StreamTurnInput, streamModelTurn } from "./model-stream";
import { replayResponsesState, responsesEndpointKey, safeResponsesItems } from "./responses-state";

afterEach(() => vi.unstubAllGlobals());

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWoQAAAAASUVORK5CYII=";
const reasoning: ResponsesStateItem = {
  type: "reasoning",
  id: "rs_test",
  encrypted_content: "provider-issued-opaque-fixture",
  summary: [{ type: "summary_text", text: "Checking the implementation." }],
};
const commentary: ResponsesStateItem = {
  type: "message",
  id: "msg_commentary",
  role: "assistant",
  phase: "commentary",
  status: "completed",
  content: [{ type: "output_text", text: "I will inspect.", annotations: [] }],
};
const call: ResponsesStateItem = {
  type: "function_call",
  id: "fc_test",
  call_id: "call_test",
  name: "read_file",
  arguments: '{"path":"source.ts"}',
};
const endpointKey = responsesEndpointKey("https://fixture.invalid/v1");

function message(role: SessionMessage["role"], parts: SessionMessage["parts"]): SessionMessage {
  return {
    id: `message_${role}`,
    sessionId: "session",
    seq: role === "user" ? 1 : role === "assistant" ? 2 : 3,
    role,
    parts,
    createdAt: "",
  };
}

function input(protocol: ProviderProtocol = "openai_responses"): StreamTurnInput {
  return {
    provider: {
      id: "provider",
      name: "Fixture",
      baseUrl: "https://fixture.invalid/v1",
      protocol,
      authMode: "bearer",
      customHeaderName: null,
      activeKeyId: null,
      keys: [],
      models: [],
      createdAt: "",
      updatedAt: "",
    },
    model: {
      id: "model-config",
      providerId: "provider",
      modelId: "provider-model",
      displayName: "Fixture",
      contextWindow: 100_000,
      maxOutputTokens: 8192,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: ["none", "low"],
      anthropicNoneBehavior: "disabled",
      enabled: true,
    },
    apiKey: "fixture-key",
    systemPrompt: "Test",
    messages: [message("user", [{ type: "text", text: "Inspect source.ts." }])],
    reasoningLevel: "low",
    tools: [
      {
        name: "read_file",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ],
    signal: new AbortController().signal,
  };
}

function response(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function mock(events: unknown[]) {
  const fetcher = vi.fn(async (_url: string, _options: RequestInit) => response(events));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

async function collect(value: StreamTurnInput): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of streamModelTurn(value)) events.push(event);
  return events;
}

function appendState(value: StreamTurnInput, items = [reasoning, commentary, call]) {
  value.messages.push(
    message("assistant", [
      { type: "text", text: "I will inspect." },
      {
        type: "tool_call",
        callId: "call_test",
        name: "read_file",
        arguments: '{"path":"source.ts"}',
        status: "completed",
      },
      {
        type: "responses_state",
        providerId: "provider",
        modelId: "provider-model",
        endpointKey,
        items,
      },
    ]),
    message("tool", [
      { type: "tool_result", callId: "call_test", output: "source contents", isError: false },
    ]),
  );
}

describe("Completed Responses state", () => {
  it.each(["completed", "item.done"])(
    "preserves ordered message phases and encrypted reasoning from %s without hidden text",
    async (source) => {
      const final: ResponsesStateItem = {
        ...commentary,
        id: "msg_final",
        phase: "final_answer",
        content: [{ type: "output_text", text: "Done.", annotations: [] }],
      };
      const items = [
        { ...reasoning, content: [{ type: "reasoning_text", text: "DO NOT PERSIST" }] },
        commentary,
        final,
      ];
      mock([
        ...(source === "item.done"
          ? items.map((item, output_index) => ({
              type: "response.output_item.done",
              output_index,
              item,
            }))
          : []),
        {
          type: "response.completed",
          response: { status: "completed", output: source === "completed" ? items : [] },
        },
      ]);
      const events = await collect(input());
      expect(
        events.flatMap((event) => (event.type === "text_delta" ? [event.text] : [])).join(""),
      ).toBe("I will inspect.Done.");
      expect(events.filter((event) => event.type === "responses_state")).toEqual([
        {
          type: "responses_state",
          providerId: "provider",
          modelId: "provider-model",
          endpointKey,
          items: [reasoning, commentary, final],
        },
      ]);
      expect(JSON.stringify(events)).not.toContain("DO NOT PERSIST");
    },
  );

  it("replays scoped native items in their original order without duplicate text or tool calls", async () => {
    const value = input();
    appendState(value);
    const fetcher = mock([{ type: "response.completed", response: {} }]);
    await collect(value);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.store).toBe(false);
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
    expect(body.input.slice(1, 4)).toEqual([reasoning, commentary, call]);
    expect(body.input[4]).toEqual({
      type: "function_call_output",
      call_id: "call_test",
      output: "source contents",
    });
    expect(
      body.input.filter((item: { type: string }) => item.type === "function_call"),
    ).toHaveLength(1);
  });

  it.each(["provider", "model", "endpoint", "legacy-state", "history-edit"])(
    "falls back to legacy history after a %s change without leaking opaque state",
    async (change) => {
      const value = input();
      appendState(value);
      if (change === "provider") value.provider.id = "other-provider";
      if (change === "model") value.model.modelId = "other-model";
      if (change === "endpoint") value.provider.baseUrl = "https://other.invalid/v1";
      if (change === "legacy-state") {
        const state = value.messages[1]?.parts.find((part) => part.type === "responses_state");
        if (state?.type === "responses_state") Reflect.deleteProperty(state, "endpointKey");
      }
      if (change === "history-edit")
        value.messages[1]?.parts.unshift({ type: "text", text: "Edited history." });
      const fetcher = mock([{ type: "response.completed", response: {} }]);
      await collect(value);
      const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
      expect(body.include).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(reasoning.encrypted_content);
      expect(body.input.some((item: { role?: string }) => item.role === "assistant")).toBe(true);
      expect(
        body.input.filter((item: { type: string }) => item.type === "function_call"),
      ).toHaveLength(1);
    },
  );

  it.each(["https://api.openai.com/v1", "https://fixture.invalid/v1"])(
    "requests encrypted items only for confirmed official endpoints or existing native state: %s",
    async (baseUrl) => {
      const value = input();
      value.provider.baseUrl = baseUrl;
      const fetcher = mock([{ type: "response.completed", response: {} }]);
      await collect(value);
      const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
      expect(body.store).toBe(false);
      expect(body.include).toEqual(
        baseUrl === "https://api.openai.com/v1" ? ["reasoning.encrypted_content"] : undefined,
      );
    },
  );

  it("does not emit partially completed native state on an incomplete or interrupted stream", async () => {
    for (const last of [
      undefined,
      {
        type: "response.incomplete",
        response: { incomplete_details: { reason: "max_output_tokens" } },
      },
      { type: "response.failed", response: { error: { message: "Failed fixture" } } },
    ]) {
      mock([
        { type: "response.output_item.done", output_index: 0, item: reasoning },
        ...(last ? [last] : []),
      ]);
      const events: ModelStreamEvent[] = [];
      await expect(
        (async () => {
          for await (const event of streamModelTurn(input())) events.push(event);
        })(),
      ).rejects.toThrow();
      expect(events.some((event) => event.type === "responses_state")).toBe(false);
    }
  });

  it("keeps a failed retry's native items out of the successful response state", async () => {
    const value = input();
    value.retry = { maxRetries: 1, onRetry: vi.fn() };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response([{ type: "response.output_item.done", output_index: 0, item: reasoning }]),
      )
      .mockResolvedValueOnce(
        response([{ type: "response.completed", response: { output: [commentary] } }]),
      );
    vi.stubGlobal("fetch", fetcher);
    const events = await collect(value);
    expect(events.filter((event) => event.type === "responses_state")).toEqual([
      {
        type: "responses_state",
        providerId: "provider",
        modelId: "provider-model",
        endpointKey,
        items: [commentary],
      },
    ]);
    expect(value.retry.onRetry).toHaveBeenCalledOnce();
  });

  it("rejects unsafe output fields and oversized or incomplete replay state", () => {
    expect(
      safeResponsesItems([
        { type: "reasoning", content: [{ type: "reasoning_text", text: "hidden" }] },
        { ...commentary, status: "in_progress" },
        { type: "unexpected", arbitrary: "untrusted" },
      ]),
    ).toEqual([]);
    expect(safeResponsesItems(new Array(513).fill(commentary))).toEqual([]);
    expect(
      safeResponsesItems([{ ...reasoning, encrypted_content: "x".repeat(8 * 1024 * 1024 + 1) }]),
    ).toEqual([]);
    const value = input();
    appendState(value, [reasoning, commentary]);
    const assistant = value.messages[1];
    if (!assistant) throw new Error("Missing assistant fixture");
    expect(replayResponsesState(assistant, "provider", "provider-model", endpointKey)).toBeNull();
  });

  it("normalizes endpoint identity without persisting URL secrets and retains citation annotations", () => {
    const key = responsesEndpointKey(
      "https://name:password@fixture.invalid/v1/?key=secret#fragment",
    );
    expect(key).toBe(endpointKey);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    const annotations = [
      {
        type: "url_citation",
        url: "https://example.com",
        title: "Reference",
        start_index: 0,
        end_index: 1,
      },
    ];
    expect(
      safeResponsesItems([
        { ...commentary, content: [{ type: "output_text", text: "x", annotations }] },
      ])[0]?.content?.[0]?.annotations,
    ).toEqual(annotations);
  });
});

describe("Tool image wire results", () => {
  function withImages(protocol: ProviderProtocol) {
    const value = input(protocol);
    appendState(value);
    const part = value.messages[2]?.parts[0];
    if (part?.type === "tool_result")
      part.images = [{ dataUrl: png, mimeType: "image/png", alt: "Preview" }];
    return value;
  }

  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "transmits tool pixels through the %s native image structure",
    async (protocol) => {
      const value = withImages(protocol);
      const fetcher = mock(
        protocol === "openai_responses"
          ? [{ type: "response.completed", response: {} }]
          : protocol === "anthropic_messages"
            ? [{ type: "message_stop" }]
            : [{ choices: [{ delta: { content: "Inspected." }, finish_reason: "stop" }] }],
      );
      await collect(value);
      const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
      if (protocol === "openai_responses") {
        const result = body.input.find(
          (item: { type: string }) => item.type === "function_call_output",
        );
        expect(result.output.at(-1)).toEqual({
          type: "input_image",
          image_url: png,
          detail: "high",
        });
      } else if (protocol === "anthropic_messages") {
        const result = body.messages.at(-1).content[0];
        expect(result.type).toBe("tool_result");
        expect(result.content.at(-1)).toEqual({
          type: "image",
          source: { type: "base64", media_type: "image/png", data: png.split(",")[1] },
        });
      } else {
        expect(body.messages.at(-2).role).toBe("tool");
        expect(body.messages.at(-1).role).toBe("user");
        expect(body.messages.at(-1).content.at(-1)).toEqual({
          type: "image_url",
          image_url: { url: png, detail: "high" },
        });
      }
      if (protocol !== "openai_responses")
        expect(JSON.stringify(body)).not.toContain(reasoning.encrypted_content);
    },
  );

  it("places Chat image follow-ups after every pending tool result", async () => {
    const value = withImages("openai_chat_completions");
    const assistant = value.messages[1];
    assistant?.parts.push({
      type: "tool_call",
      callId: "second",
      name: "read_file",
      arguments: "{}",
      status: "completed",
    });
    value.messages.push(
      message("tool", [
        { type: "tool_result", callId: "second", output: "second result", isError: false },
      ]),
    );
    const fetcher = mock([{ choices: [{ delta: {}, finish_reason: "stop" }] }]);
    await collect(value);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.messages.slice(-3).map((item: { role: string }) => item.role)).toEqual([
      "tool",
      "tool",
      "user",
    ]);
  });

  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "reports untransmitted pixels clearly for text-only models over %s",
    async (protocol) => {
      const value = withImages(protocol);
      value.model.inputModalities = ["text"];
      const fetcher = mock(
        protocol === "openai_responses"
          ? [{ type: "response.completed", response: {} }]
          : protocol === "anthropic_messages"
            ? [{ type: "message_stop" }]
            : [{ choices: [{ delta: {}, finish_reason: "stop" }] }],
      );
      await collect(value);
      const wire = String(fetcher.mock.calls[0]?.[1]?.body);
      expect(wire).not.toContain(png);
      expect(wire).toContain("does not support image input");
      expect(wire).toContain("Do not claim to have inspected");
    },
  );

  it("does not follow a remote URL passed as a tool image", async () => {
    const value = withImages("openai_responses");
    const part = value.messages[2]?.parts[0];
    if (part?.type === "tool_result")
      part.images = [{ dataUrl: "https://example.com/image.png", mimeType: "image/png" }];
    const fetcher = mock([{ type: "response.completed", response: {} }]);
    await collect(value);
    const wire = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(wire).not.toContain("https://example.com/image.png");
    expect(wire).toContain("invalid or oversized tool image");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
