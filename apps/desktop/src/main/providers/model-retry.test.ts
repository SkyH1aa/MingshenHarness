import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeModelRetrySettings } from "../../shared/model-retry";
import {
  ModelInputBudgetError,
  ModelRequestError,
  retryAfterMs,
  retryDelayMs,
  upstreamError,
} from "./model-request-error";
import {
  estimateModelInputTokens,
  type ModelStreamEvent,
  type StreamTurnInput,
  streamModelTurn,
} from "./model-stream";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function input(
  protocol: StreamTurnInput["provider"]["protocol"] = "openai_responses",
): StreamTurnInput & { retry: NonNullable<StreamTurnInput["retry"]> } {
  return {
    provider: {
      id: "p",
      name: "Fixture",
      baseUrl: "https://fixture.invalid/v1",
      protocol,
      authMode: "bearer",
    } as StreamTurnInput["provider"],
    model: {
      id: "m",
      providerId: "p",
      modelId: "fixture",
      displayName: "Fixture",
      contextWindow: 10000,
      maxOutputTokens: 100,
      inputModalities: ["text"],
      outputModalities: ["text"],
      reasoningLevels: [],
      toolCalls: true,
      parallelToolCalls: false,
      anthropicNoneBehavior: "disabled",
      enabled: true,
    },
    apiKey: "local-fixture-secret",
    systemPrompt: "Test",
    messages: [],
    tools: [],
    reasoningLevel: null,
    signal: new AbortController().signal,
    retry: { maxRetries: 5, onRetry: vi.fn() },
  };
}
const sse = (...events: unknown[]) =>
  new Response(
    events
      .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
      .join(""),
  );
async function collect(value: StreamTurnInput) {
  const events: ModelStreamEvent[] = [];
  for await (const event of streamModelTurn(value)) events.push(event);
  return events;
}

describe("automatic model request retries", () => {
  it("defaults to five and normalizes persisted counts without exceeding twenty", () => {
    expect(normalizeModelRetrySettings(null)).toEqual({ maxRetries: 5 });
    expect(normalizeModelRetrySettings({ maxRetries: 80 })).toEqual({ maxRetries: 20 });
    expect(normalizeModelRetrySettings({ maxRetries: -1 })).toEqual({ maxRetries: 0 });
    expect(normalizeModelRetrySettings({ maxRetries: Number.NaN })).toEqual({ maxRetries: 5 });
  });
  it("honors Retry-After and bounds exponential waits", () => {
    expect(retryAfterMs(new Headers({ "retry-after": "2" }))).toBe(2000);
    expect(retryAfterMs(new Headers({ "retry-after-ms": "120" }))).toBe(120);
    expect(retryAfterMs(new Headers({ "retry-after": "999999" }))).toBe(300000);
    expect(retryAfterMs(new Headers({ "retry-after": "invalid" }))).toBe(null);
    expect(retryDelayMs(20, null)).toBe(30000);
    expect(retryDelayMs(1, null)).toBe(1000);
    expect(upstreamError("invalid", { code: "invalid_api_key" }).retryable).toBe(false);
  });
  it.each([408, 409, 425, 429, 500, 502, 503, 504, 529])(
    "recovers HTTP %i without losing detailed errors",
    async (status) => {
      const value = input();
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("temporary upstream", {
            status,
            headers: { "retry-after-ms": "0", "x-request-id": "retry-fixture" },
          }),
        )
        .mockResolvedValueOnce(
          sse(
            { type: "response.output_text.delta", delta: "Recovered" },
            { type: "response.completed" },
          ),
        );
      vi.stubGlobal("fetch", fetcher);
      expect(await collect(value)).toContainEqual({ type: "text_delta", text: "Recovered" });
      expect(value.retry?.onRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxRetries: 5,
          error: expect.stringContaining(`HTTP ${status}`),
        }),
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each([400, 401, 403, 404, 413, 422])("does not loop on permanent HTTP %i", async (status) => {
    const value = input();
    const fetcher = vi.fn(async () => new Response("configuration error", { status }));
    vi.stubGlobal("fetch", fetcher);
    await expect(collect(value)).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(value.retry?.onRetry).not.toHaveBeenCalled();
  });
  it.each([0, 5, 20])(
    "performs exactly N retries in addition to the initial request: %i",
    async (count) => {
      const value = input();
      value.retry.maxRetries = count;
      const fetcher = vi.fn(
        async () =>
          new Response("unavailable", { status: 503, headers: { "retry-after-ms": "0" } }),
      );
      vi.stubGlobal("fetch", fetcher);
      await expect(collect(value)).rejects.toThrow("HTTP 503");
      expect(fetcher).toHaveBeenCalledTimes(count + 1);
      expect(value.retry?.onRetry).toHaveBeenCalledTimes(count);
    },
  );
  it("refreshes BeforeModelRequest before retries and refuses to send one without its context", async () => {
    const value = input();
    value.retry.maxRetries = 1;
    const requestBodies: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(String(init?.body ?? ""));
      if (requestBodies.length === 1)
        return new Response("temporary upstream", {
          status: 503,
          headers: { "retry-after-ms": "0" },
        });
      return sse(
        { type: "response.output_text.delta", delta: "Recovered" },
        { type: "response.completed" },
      );
    });
    const beforeEachRequest = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("plugin marker: attempt one")
      .mockRejectedValueOnce(new Error("fixture hook failure"));
    value.beforeEachRequest = beforeEachRequest;
    vi.stubGlobal("fetch", fetcher);

    await expect(collect(value)).rejects.toThrow(
      "BeforeModelRequest failed; the next model request was not sent.",
    );
    expect(beforeEachRequest).toHaveBeenCalledTimes(2);
    expect(requestBodies).toHaveLength(1);
    expect(JSON.parse(requestBodies[0] ?? "{}").instructions).toContain(
      "plugin marker: attempt one",
    );
  });
  it("clamps output using the fully injected prompt and snapshots its stable base", async () => {
    const value = input();
    const context = `PLUGIN_NEAR_WINDOW ${"x".repeat(2400)}`;
    const effectivePrompt = `${value.systemPrompt}\n\n${context}`;
    const estimate = estimateModelInputTokens({ ...value, systemPrompt: effectivePrompt });
    value.model.contextWindow = estimate + 256 + 37;
    value.maxOutputTokens = 100;
    value.firstRequestContext = context;
    value.baseSystemPrompt = "Test";
    const prepared = vi.fn();
    value.onRequestPrepared = prepared;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      sse(
        { type: "response.output_text.delta", delta: "Budgeted" },
        { type: "response.completed" },
      ),
    );
    vi.stubGlobal("fetch", fetcher);

    await collect(value);

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.max_output_tokens).toBe(37);
    expect(prepared).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: effectivePrompt,
        baseSystemPrompt: "Test",
      }),
    );
  });
  it("rejects an injected prompt over the context window before fetch", async () => {
    const value = input();
    value.firstRequestContext = "OVERSIZED_PLUGIN_CONTEXT";
    value.model.contextWindow =
      estimateModelInputTokens({
        ...value,
        systemPrompt: `${value.systemPrompt}\n\n${value.firstRequestContext}`,
      }) - 1;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      throw new Error("Unexpected fetch");
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(collect(value)).rejects.toBeInstanceOf(ModelInputBudgetError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "keeps one total retry budget when truncated %s attempts emit partial progress",
    async (protocol) => {
      vi.useFakeTimers();
      const value = input(protocol);
      value.retry.maxRetries = 2;
      value.retry.onRecovered = vi.fn();
      let request = 0;
      const delta = (text: string) =>
        protocol === "openai_responses"
          ? { type: "response.output_text.delta", delta: text }
          : protocol === "anthropic_messages"
            ? { type: "content_block_delta", delta: { type: "text_delta", text } }
            : { choices: [{ delta: { content: text } }] };
      const fetcher = vi.fn(async () => {
        request++;
        return sse(delta(`Partial response ${request}`));
      });
      vi.stubGlobal("fetch", fetcher);
      const pending = expect(collect(value)).rejects.toThrow("incomplete");
      await vi.runAllTimersAsync();
      await pending;
      expect(fetcher).toHaveBeenCalledTimes(3);
      const calls = vi.mocked(value.retry.onRetry).mock.calls.map(([state]) => ({
        attempt: state.attempt,
        delayMs: state.delayMs,
      }));
      expect(calls).toEqual([
        { attempt: 1, delayMs: 1000 },
        { attempt: 2, delayMs: 2000 },
      ]);
      expect(value.retry.onRecovered).not.toHaveBeenCalled();
    },
  );
  it.each(["reasoning", "tool arguments"])(
    "does not renew retries for forward %s progress after reconnection",
    async (kind) => {
      vi.useFakeTimers();
      const value = input();
      value.retry.maxRetries = 1;
      value.retry.onRecovered = vi.fn();
      const progress =
        kind === "reasoning"
          ? { type: "response.reasoning_summary_text.delta", delta: "Checking the task" }
          : {
              type: "response.function_call_arguments.delta",
              output_index: 0,
              delta: '{"path":"notes.txt"}',
            };
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
        .mockResolvedValueOnce(sse(progress));
      vi.stubGlobal("fetch", fetcher);
      const pending = expect(collect(value)).rejects.toThrow("incomplete");
      await vi.runAllTimersAsync();
      await pending;
      expect(vi.mocked(value.retry.onRetry).mock.calls.map(([state]) => state.attempt)).toEqual([
        1,
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(value.retry.onRecovered).not.toHaveBeenCalled();
    },
  );
  it("does not renew retries for empty, usage-only or replayed incomplete output", async () => {
    vi.useFakeTimers();
    const value = input();
    value.retry.maxRetries = 3;
    value.retry.onRecovered = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(sse({ type: "response.output_text.delta", delta: "Same prefix" }))
      .mockResolvedValueOnce(
        sse(
          { type: "response.output_text.delta", delta: "Same " },
          { type: "response.output_text.delta", delta: "prefix" },
        ),
      )
      .mockResolvedValueOnce(sse({ usage: { input_tokens: 50, output_tokens: 0 } }))
      .mockResolvedValueOnce(sse({ type: "response.output_text.delta", delta: "" }));
    vi.stubGlobal("fetch", fetcher);
    const pending = expect(collect(value)).rejects.toThrow("stream ended before");
    await vi.runAllTimersAsync();
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(vi.mocked(value.retry.onRetry).mock.calls.map(([state]) => state.attempt)).toEqual([
      1, 2, 3,
    ]);
    expect(value.retry.onRecovered).not.toHaveBeenCalled();
  });
  it("keeps the total allowance exhausted after an attempt makes partial progress", async () => {
    vi.useFakeTimers();
    const value = input();
    value.retry.maxRetries = 2;
    const unavailable = () => new Response("Unavailable", { status: 503 });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(sse({ type: "response.output_text.delta", delta: "New progress" }))
      .mockImplementation(async () => sse({ type: "response.output_text.delta", delta: "More" }));
    vi.stubGlobal("fetch", fetcher);
    const pending = expect(collect(value)).rejects.toThrow("incomplete");
    await vi.runAllTimersAsync();
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(vi.mocked(value.retry.onRetry).mock.calls.map(([state]) => state.attempt)).toEqual([
      1, 2,
    ]);
  });
  it("does not treat different shorter output as recovery", async () => {
    vi.useFakeTimers();
    const value = input();
    value.retry.maxRetries = 1;
    value.retry.onRecovered = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        sse({ type: "response.output_text.delta", delta: "A long incomplete response" }),
      )
      .mockResolvedValueOnce(sse({ type: "response.output_text.delta", delta: "New" }));
    vi.stubGlobal("fetch", fetcher);
    const pending = expect(collect(value)).rejects.toThrow("incomplete");
    await vi.runAllTimersAsync();
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.mocked(value.retry.onRetry).mock.calls.map(([state]) => state.attempt)).toEqual([1]);
    expect(value.retry.onRecovered).not.toHaveBeenCalled();
  });
  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "discards failed partial output and recovers a truncated %s stream",
    async (protocol) => {
      vi.useFakeTimers();
      const value = input(protocol);
      let text = "";
      value.retry.onRetry = vi.fn(() => {
        text = "";
      });
      const partial =
        protocol === "openai_responses"
          ? { type: "response.output_text.delta", delta: "Discard" }
          : protocol === "anthropic_messages"
            ? { type: "content_block_delta", delta: { type: "text_delta", text: "Discard" } }
            : { choices: [{ delta: { content: "Discard" } }] };
      const complete =
        protocol === "openai_responses"
          ? [{ type: "response.output_text.delta", delta: "Good" }, { type: "response.completed" }]
          : protocol === "anthropic_messages"
            ? [
                { type: "content_block_delta", delta: { type: "text_delta", text: "Good" } },
                { type: "message_stop" },
              ]
            : [{ choices: [{ delta: { content: "Good" }, finish_reason: "stop" }] }, "[DONE]"];
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(sse(partial))
          .mockResolvedValueOnce(sse(...complete)),
      );
      const result = (async () => {
        for await (const event of streamModelTurn(value))
          if (event.type === "text_delta") text += event.text;
      })();
      await vi.runAllTimersAsync();
      await result;
      expect(text).toBe("Good");
      expect(value.retry?.onRetry).toHaveBeenCalledTimes(1);
    },
  );
  it("cancels the retry wait immediately without a further request", async () => {
    const controller = new AbortController();
    const value = input();
    value.signal = controller.signal;
    value.retry.onRetry = () => {
      setTimeout(() => controller.abort(new Error("User stopped")), 1);
    };
    const fetcher = vi.fn(
      async () => new Response("unavailable", { status: 503, headers: { "retry-after": "300" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(collect(value)).rejects.toThrow("User stopped");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "retries a typed transient %s stream error but stops for permission errors",
    async (protocol) => {
      vi.useFakeTimers();
      const value = input(protocol);
      const complete =
        protocol === "openai_responses"
          ? [
              { type: "response.output_text.delta", delta: "Recovered" },
              { type: "response.completed" },
            ]
          : protocol === "anthropic_messages"
            ? [
                { type: "content_block_delta", delta: { type: "text_delta", text: "Recovered" } },
                { type: "message_stop" },
              ]
            : [{ choices: [{ delta: { content: "Recovered" }, finish_reason: "stop" }] }, "[DONE]"];
      const error = (type: string) =>
        protocol === "openai_responses"
          ? {
              type: "response.failed",
              response: { error: { type, message: "Upstream diagnostic" } },
            }
          : { type: "error", error: { type, message: "Upstream diagnostic" } };
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(sse(error("server_error")))
        .mockResolvedValueOnce(sse(...complete));
      vi.stubGlobal("fetch", fetcher);
      const pending = collect(value);
      await vi.runAllTimersAsync();
      await pending;
      expect(fetcher).toHaveBeenCalledTimes(2);
      fetcher.mockReset().mockImplementation(async () => sse(error("permission_error")));
      await expect(collect(value)).rejects.toThrow("Upstream diagnostic");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("retries network reset but never retries invalid certificates or unknown server errors", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }))
      .mockResolvedValueOnce(
        sse(
          { type: "response.output_text.delta", delta: "Recovered" },
          { type: "response.completed" },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = collect(input());
    await vi.runAllTimersAsync();
    await result;
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher
      .mockReset()
      .mockRejectedValue(new TypeError("fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } }));
    await expect(collect(input())).rejects.toBeInstanceOf(ModelRequestError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries only unsignalled AbortErrors from fetch and the response reader", async () => {
    vi.useFakeTimers();
    const value = input();
    value.retry.maxRetries = 2;
    let request = 0;
    const unsignalledAbort = () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      return error;
    };
    const fetcher = vi.fn(async () => {
      request++;
      if (request === 1) throw unsignalledAbort();
      if (request === 2)
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Partial" })}\n\n`,
                ),
              );
            },
            pull(controller) {
              controller.error(unsignalledAbort());
            },
          }),
        );
      return sse(
        { type: "response.output_text.delta", delta: "Recovered" },
        { type: "response.completed" },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const pending = collect(value);
    await vi.runAllTimersAsync();
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(vi.mocked(value.retry.onRetry).mock.calls.map(([state]) => state.attempt)).toEqual([
      1, 2,
    ]);

    fetcher.mockClear();
    const controller = new AbortController();
    const userStop = new Error("User stopped the run");
    userStop.name = "AbortError";
    controller.abort(userStop);
    const cancelled = input();
    cancelled.signal = controller.signal;
    await expect(collect(cancelled)).rejects.toThrow("User stopped the run");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
