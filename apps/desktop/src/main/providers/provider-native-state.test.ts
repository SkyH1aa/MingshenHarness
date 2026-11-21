import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessagePart, ProviderProtocol, SessionMessage } from "../../shared/domain";
import {
  estimateModelInputTokens,
  type ModelStreamEvent,
  type StreamTurnInput,
  streamModelTurn,
} from "./model-stream";
import {
  createProviderState,
  providerStateEndpointKey,
  replayProviderState,
  safeProviderState,
} from "./provider-native-state";

afterEach(() => vi.unstubAllGlobals());

function message(role: SessionMessage["role"], parts: MessagePart[]): SessionMessage {
  return { id: `${role}-message`, sessionId: "session", seq: 2, role, parts, createdAt: "" };
}

function input(
  family: "gemini" | "deepseek" = "gemini",
  protocol: ProviderProtocol = "openai_chat_completions",
): StreamTurnInput {
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
      promptCaching: {
        mode: "off",
        modelFamily: family,
        ttl: "5m",
      },
    },
    model: {
      id: "model-config",
      providerId: "provider",
      modelId: "network-model",
      displayName: "Fixture",
      contextWindow: 100_000,
      maxOutputTokens: 8192,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: ["none", "high"],
      anthropicNoneBehavior: "disabled",
      enabled: true,
    },
    apiKey: "fixture-key",
    systemPrompt: "Stable prompt",
    messages: [message("user", [{ type: "text", text: "Inspect." }])],
    reasoningLevel: "high",
    tools: [
      { name: "read_file", description: "Read", parameters: { type: "object", properties: {} } },
    ],
    signal: new AbortController().signal,
  };
}

function response(events: unknown[]): Response {
  return new Response(
    events
      .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
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

function assistant(events: ModelStreamEvent[]): SessionMessage {
  let text = "";
  let reasoning = "";
  const calls = new Map<number, Extract<MessagePart, { type: "tool_call" }>>();
  const parts: MessagePart[] = [];
  for (const event of events) {
    if (event.type === "text_delta") text += event.text;
    if (event.type === "reasoning_delta") reasoning += event.text;
    if (event.type === "tool_call_started")
      calls.set(event.index, {
        type: "tool_call",
        callId: event.callId,
        name: event.name,
        arguments: "",
        status: "completed",
      });
    if (event.type === "tool_call_arguments_delta" || event.type === "tool_call_arguments") {
      const call = calls.get(event.index);
      if (call)
        call.arguments =
          event.type === "tool_call_arguments" ? event.arguments : call.arguments + event.delta;
    }
    if (event.type === "provider_state") parts.push({ type: "provider_state", state: event.state });
  }
  return message("assistant", [
    ...(reasoning ? [{ type: "reasoning" as const, text: reasoning }] : []),
    ...(text ? [{ type: "text" as const, text }] : []),
    ...[...calls].sort(([left], [right]) => left - right).map(([, call]) => call),
    ...parts,
  ]);
}

const call = (index = 0, extra?: unknown) => ({
  index,
  id: `call-${index}`,
  type: "function",
  function: { name: "read_file", arguments: `{"path":"file-${index}.ts"}` },
  ...(extra === undefined ? {} : { extra_content: extra }),
});
const chunk = (delta: object, finish_reason: string | null = null) => ({
  choices: [{ delta, finish_reason }],
});
const signature = (value: string) => ({ google: { thought_signature: value } });

describe("provider-native continuation state", () => {
  it("round-trips Gemini parallel call and message signatures delivered after finish", async () => {
    const value = input();
    mock([
      chunk({ content: "Inspecting.", tool_calls: [call(1), call(0)] }),
      chunk({}, "tool_calls"),
      chunk({ tool_calls: [{ index: 0, extra_content: signature("call-signature==") }] }),
      chunk({ extra_content: signature("message-signature==") }),
      { usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 80 } }, choices: [] },
      "[DONE]",
    ]);
    const events = await collect(value);
    const stored = JSON.parse(JSON.stringify(assistant(events))) as SessionMessage;
    const fetcher = mock([chunk({ content: "Done" }, "stop"), "[DONE]"]);
    value.messages.push(
      stored,
      message("tool", [
        { type: "tool_result", callId: "call-0", output: "First", isError: false },
        { type: "tool_result", callId: "call-1", output: "Second", isError: false },
      ]),
    );
    await collect(value);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
    expect(body.messages[2]).toEqual({
      role: "assistant",
      content: "Inspecting.",
      extra_content: signature("message-signature=="),
      tool_calls: [
        { ...call(0, signature("call-signature==")), index: undefined },
        { ...call(1), index: undefined },
      ],
    });
    expect(events.findLast((event) => event.type === "usage")).toMatchObject({
      cachedInputTokens: 80,
    });
    expect(body).not.toHaveProperty("prompt_cache_key");
  });

  it("accepts unrelated extra metadata and saves a message-only late signature", async () => {
    const value = input();
    mock([
      chunk({ content: "Answer", extra_content: { unrelated: true } }, "stop"),
      chunk({ extra_content: signature("late-signature") }),
      "[DONE]",
    ]);
    const stored = assistant(await collect(value));
    expect(replayProviderState(stored, value.provider, value.model)).toEqual({
      role: "assistant",
      content: "Answer",
      extra_content: signature("late-signature"),
    });
  });

  it("reconciles a final assistant snapshot with streamed prefixes before replaying its signature", async () => {
    const value = input();
    mock([
      chunk({ content: "Final " }),
      {
        choices: [
          {
            delta: {},
            message: {
              role: "assistant",
              content: "Final answer",
              extra_content: signature("snapshot-signature"),
            },
            finish_reason: "stop",
          },
        ],
      },
      "[DONE]",
    ]);
    const stored = assistant(await collect(value));
    expect(stored.parts.filter((part) => part.type === "text")).toEqual([
      { type: "text", text: "Final answer" },
    ]);
    expect(replayProviderState(stored, value.provider, value.model)).toEqual({
      role: "assistant",
      content: "Final answer",
      extra_content: signature("snapshot-signature"),
    });
    mock([
      chunk({ content: "Original prefix" }),
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: "Conflicting snapshot",
              extra_content: signature("unsafe"),
            },
            finish_reason: "stop",
          },
        ],
      },
      "[DONE]",
    ]);
    expect((await collect(value)).some((event) => event.type === "provider_state")).toBe(false);
  });

  it("does not save incomplete, conflicting or oversized Gemini state", async () => {
    const value = input();
    mock([chunk({ tool_calls: [call(0, signature("partial"))] })]);
    const events: ModelStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of streamModelTurn(value)) events.push(event);
      })(),
    ).rejects.toThrow("before completion");
    expect(events.some((event) => event.type === "provider_state")).toBe(false);
    for (const invalid of ["different", "x".repeat(8 * 1024 * 1024 + 1)]) {
      mock([
        chunk({ tool_calls: [call(0, signature("original"))] }),
        chunk({ tool_calls: [{ index: 0, extra_content: signature(invalid) }] }, "tool_calls"),
        "[DONE]",
      ]);
      expect((await collect(value)).some((event) => event.type === "provider_state")).toBe(false);
    }
  });

  it("binds state to protocol, family, provider, model and the entire endpoint", async () => {
    const value = input();
    mock([chunk({ tool_calls: [call(0, signature("original"))] }, "tool_calls"), "[DONE]"]);
    const stored = assistant(await collect(value));
    expect(replayProviderState(stored, value.provider, value.model)).not.toBeNull();
    for (const provider of [
      { ...value.provider, id: "other-provider" },
      { ...value.provider, baseUrl: "https://fixture.invalid/v1?account=other" },
      { ...value.provider, protocol: "openai_responses" as const },
      {
        ...value.provider,
        promptCaching: { mode: "off" as const, ttl: "5m" as const, modelFamily: "other" as const },
      },
    ])
      expect(replayProviderState(stored, provider, value.model)).toBeNull();
    expect(
      replayProviderState(stored, value.provider, { ...value.model, modelId: "other" }),
    ).toBeNull();
    expect(providerStateEndpointKey(value.provider)).not.toBe(
      providerStateEndpointKey({
        ...value.provider,
        baseUrl: `${value.provider.baseUrl}?account=A`,
      }),
    );
    for (const mutate of [
      (parts: MessagePart[]) => parts.unshift({ type: "text", text: "Changed" }),
      (parts: MessagePart[]) => {
        const item = parts.find((part) => part.type === "tool_call");
        if (item?.type === "tool_call") item.arguments = "{}";
      },
    ]) {
      const edited = structuredClone(stored);
      mutate(edited.parts);
      expect(replayProviderState(edited, value.provider, value.model)).toBeNull();
    }
  });

  it("passes every captured DeepSeek reasoning_content turn unchanged and ignores UI-only reasoning", async () => {
    const value = input("deepseek");
    const thinking = "  Exact native reasoning\nwith whitespace.  ";
    mock([
      chunk({ reasoning_content: thinking.slice(0, 10) }),
      chunk({ reasoning_content: thinking.slice(10), content: "Earlier answer" }, "stop"),
      "[DONE]",
    ]);
    const previous = assistant(await collect(value));
    previous.parts.push({
      type: "reasoning",
      text: "Display-only summary must not replace native state",
    });
    value.messages.push(previous, message("user", [{ type: "text", text: "Next" }]));
    const fetcher = mock([
      chunk({ reasoning_content: "Next reasoning", tool_calls: [call()] }, "tool_calls"),
      "[DONE]",
    ]);
    const current = assistant(await collect(value));
    value.messages.push(
      current,
      message("tool", [
        { type: "tool_result", callId: "call-0", output: "Read contents", isError: false },
      ]),
    );
    await collect(value);
    const body = JSON.parse(String(fetcher.mock.calls[1]?.[1].body));
    expect(body.messages[2].reasoning_content).toBe(thinking);
    expect(body.messages[4].reasoning_content).toBe("Next reasoning");
    expect(body.messages[2].content).toBe("Earlier answer");
    expect(JSON.stringify(body)).not.toContain("Display-only summary");
    const onlyUi = message("assistant", [
      { type: "reasoning", text: "Not verified" },
      { type: "text", text: "Answer" },
    ]);
    expect(replayProviderState(onlyUi, value.provider, value.model)).toBeNull();
  });

  it("supplies an empty reasoning_content field for synthetic DeepSeek thinking tool turns", async () => {
    const value = input("deepseek");
    value.messages.push(
      message("assistant", [
        {
          type: "tool_call",
          callId: "synthetic-call",
          name: "read_file",
          arguments: '{"path":"file.ts"}',
          status: "completed",
        },
      ]),
      message("tool", [
        {
          type: "tool_result",
          callId: "synthetic-call",
          output: "Read contents",
          isError: false,
        },
      ]),
    );
    const fetcher = mock([
      chunk({ content: "Done", reasoning_content: "Final reasoning" }, "stop"),
      "[DONE]",
    ]);

    await collect(value);

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.messages[2]).toMatchObject({
      role: "assistant",
      content: null,
      reasoning_content: "",
      tool_calls: [
        {
          id: "synthetic-call",
          type: "function",
          function: {
            name: "read_file",
            arguments: '{"path":"file.ts"}',
          },
        },
      ],
    });
  });

  it("does not add DeepSeek reasoning_content when thinking is disabled", async () => {
    const value = input("deepseek");
    value.reasoningLevel = "none";
    value.messages.push(
      message("assistant", [
        {
          type: "tool_call",
          callId: "synthetic-call",
          name: "read_file",
          arguments: "{}",
          status: "completed",
        },
      ]),
      message("tool", [
        {
          type: "tool_result",
          callId: "synthetic-call",
          output: "Read contents",
          isError: false,
        },
      ]),
    );
    const fetcher = mock([chunk({ content: "Done" }, "stop"), "[DONE]"]);

    await collect(value);

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages[2]).not.toHaveProperty("reasoning_content");
  });

  it("keeps DeepSeek default-mode tool history valid when reasoning level is null", async () => {
    const value = input("deepseek");
    value.reasoningLevel = null;
    value.model.reasoningLevels = [];
    value.messages.push(
      message("assistant", [
        {
          type: "tool_call",
          callId: "synthetic-call",
          name: "read_file",
          arguments: "{}",
          status: "completed",
        },
      ]),
      message("tool", [
        {
          type: "tool_result",
          callId: "synthetic-call",
          output: "Read contents",
          isError: false,
        },
      ]),
    );
    const fetcher = mock([chunk({ content: "Done" }, "stop"), "[DONE]"]);

    await collect(value);

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.messages[2]).toMatchObject({
      role: "assistant",
      content: null,
      reasoning_content: "",
      tool_calls: [{ id: "synthetic-call" }],
    });
  });

  it("collapses marked execution-chain steps into the root DeepSeek tool result", async () => {
    const value = input("deepseek");
    value.messages.push(
      message("assistant", [
        {
          type: "tool_call",
          callId: "chain-root",
          name: "execute_tool_chain",
          arguments: '{"steps":[]}',
          status: "completed",
        },
      ]),
      message("tool", [
        {
          type: "tool_result",
          callId: "chain-root",
          output: "Execution chain accepted",
          isError: false,
        },
      ]),
      message("assistant", [
        {
          type: "tool_call",
          callId: "chain-step",
          name: "read_file",
          arguments: '{"path":"file.ts"}',
          status: "completed",
          synthetic: true,
          chainRootCallId: "chain-root",
        },
      ]),
      message("tool", [
        {
          type: "tool_result",
          callId: "chain-step",
          output: "Read contents",
          isError: false,
          synthetic: true,
          chainRootCallId: "chain-root",
        },
      ]),
    );
    const fetcher = mock([chunk({ content: "Done" }, "stop"), "[DONE]"]);

    await collect(value);

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
    expect(body.messages).toHaveLength(4);
    expect(JSON.stringify(body)).not.toContain("chain-step");
    expect(body.messages[3]).toMatchObject({
      role: "tool",
      tool_call_id: "chain-root",
      content: expect.stringContaining("Read contents"),
    });
  });

  it("ignores nullable DeepSeek reasoning placeholders after real thinking deltas", async () => {
    const value = input("deepseek");
    mock([
      chunk({ reasoning_content: "Exact " }),
      chunk({ reasoning_content: "native reasoning" }),
      chunk({ reasoning_content: null, tool_calls: [call()] }),
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              reasoning_content: null,
              tool_calls: [call()],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      "[DONE]",
    ]);
    const stored = assistant(await collect(value));
    expect(replayProviderState(stored, value.provider, value.model)).toMatchObject({
      reasoning_content: "Exact native reasoning",
    });
    value.messages.push(stored);
    const fetcher = mock([chunk({ content: "Answer", reasoning_content: null }, "stop"), "[DONE]"]);
    await collect(value);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
    expect(body.messages[2].reasoning_content).toBe("Exact native reasoning");
  });

  it.each(["insufficient_system_resource", "aborted"])(
    "rejects interrupted DeepSeek finish_reason=%s without saving native state",
    async (finish) => {
      const value = input("deepseek");
      mock([
        chunk({ reasoning_content: "Incomplete native reasoning", tool_calls: [call()] }),
        chunk({}, finish),
        "[DONE]",
      ]);
      const events: ModelStreamEvent[] = [];
      await expect(
        (async () => {
          for await (const event of streamModelTurn(value)) events.push(event);
        })(),
      ).rejects.toThrow(`incomplete: ${finish}`);
      expect(events.some((event) => event.type === "provider_state")).toBe(false);
    },
  );

  it("preserves plain DeepSeek Responses items and does not request OpenAI encrypted state", async () => {
    const value = input("deepseek", "openai_responses");
    const items = [
      {
        type: "reasoning",
        id: "reason",
        content: [{ type: "reasoning_text", text: "Native reasoning" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Inspecting." }],
      },
      {
        type: "function_call",
        call_id: "call-0",
        name: "read_file",
        arguments: '{"path":"file-0.ts"}',
      },
    ];
    mock([{ type: "response.completed", response: { output: items } }]);
    value.messages.push(assistant(await collect(value)));
    const fetcher = mock([{ type: "response.completed", response: { output: [] } }]);
    await collect(value);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
    expect(body.input.slice(1)).toEqual(items);
    expect(body).not.toHaveProperty("include");
    expect(
      createProviderState(value.provider, value.model, {
        items: [{ type: "reasoning", encrypted_content: "foreign-opaque-state", content: [] }],
      }),
    ).toBeNull();
  });

  it("preserves complete DeepSeek Anthropic thinking, signature and tool block order", async () => {
    const value = input("deepseek", "anthropic_messages");
    mock([
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Native thought" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig-" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "end" },
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "Inspecting." },
      },
      {
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "call-0", name: "read_file", input: {} },
      },
      {
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"path": "file-0.ts"}' },
      },
      { type: "message_stop" },
    ]);
    value.messages.push(assistant(await collect(value)));
    const fetcher = mock([{ type: "message_stop" }]);
    await collect(value);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
    expect(body.messages[1].content).toEqual([
      { type: "thinking", thinking: "Native thought", signature: "sig-end" },
      { type: "text", text: "Inspecting." },
      { type: "tool_use", id: "call-0", name: "read_file", input: { path: "file-0.ts" } },
    ]);
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it.each(["none", "high", null])(
    "uses explicit DeepSeek thinking switches for %s",
    async (level) => {
      const value = input("deepseek");
      value.reasoningLevel = level;
      const fetcher = mock([chunk({ content: "Answer" }, "stop"), "[DONE]"]);
      await collect(value);
      const body = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
      if (level === null) expect(body).not.toHaveProperty("thinking");
      else expect(body.thinking).toEqual({ type: level === "none" ? "disabled" : "enabled" });
      if (level === "none") expect(body).not.toHaveProperty("reasoning_effort");
      if (level === "high") expect(body.reasoning_effort).toBe("high");
      expect(body).not.toHaveProperty("enable_thinking");
    },
  );

  it("does not treat signature ciphertext length as semantic tokens, but counts DeepSeek plain reasoning", () => {
    const gemini = input();
    const build = (size: number, deepseek = false) => {
      const value = deepseek
        ? input("deepseek")
        : structuredClone({ ...gemini, signal: undefined });
      const payload = {
        role: "assistant",
        content: "Answer",
        ...(deepseek
          ? { reasoning_content: "x".repeat(size) }
          : { extra_content: signature("x".repeat(size)) }),
      };
      const state = createProviderState(value.provider, value.model, payload);
      if (!state) throw new Error("Missing native state");
      value.messages.push(
        message("assistant", [
          { type: "text", text: "Answer" },
          { type: "provider_state", state },
        ]),
      );
      return estimateModelInputTokens(value);
    };
    expect(build(32_000) - build(100)).toBeLessThan(100);
    expect(build(32_000, true) - build(100, true)).toBeGreaterThan(5000);
    const state = createProviderState(gemini.provider, gemini.model, {
      role: "assistant",
      content: "Answer",
      extra_content: signature("sig"),
    });
    expect(
      state && safeProviderState({ ...state, payload: { ...state.payload, content: 1 } }),
    ).toBeNull();
  });
});
