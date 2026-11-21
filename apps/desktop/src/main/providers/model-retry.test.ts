import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeModelRetrySettings } from "../../shared/model-retry";
import {
  ModelRequestError,
  retryAfterMs,
  retryDelayMs,
  upstreamError,
} from "./model-request-error";
import { type ModelStreamEvent, type StreamTurnInput, streamModelTurn } from "./model-stream";

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
  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "renews the allowance and backoff for each recovered disconnection in one %s turn",
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
      const completion =
        protocol === "openai_responses"
          ? { type: "response.completed" }
          : protocol === "anthropic_messages"
            ? { type: "message_stop" }
            : { choices: [{ delta: {}, finish_reason: "stop" }] };
      const fetcher = vi.fn(async () => {
        request++;
        if (![3, 5, 7].includes(request)) return new Response("Unavailable", { status: 503 });
        return request === 7
          ? sse(delta("Recovered final output"), completion)
          : sse(delta(request === 3 ? "First" : "First, then more progress"));
      });
      vi.stubGlobal("fetch", fetcher);
      const pending = expect(collect(value)).resolves.toContainEqual({
        type: "text_delta",
        text: "Recovered final output",
      });
      await vi.runAllTimersAsync();
      await pending;
      expect(fetcher).toHaveBeenCalledTimes(7);
      const calls = vi.mocked(value.retry.onRetry).mock.calls.map(([state]) => ({
        attempt: state.attempt,
        delayMs: state.delayMs,
      }));
      expect(calls).toEqual([
        { attempt: 1, delayMs: 1000 },
        { attempt: 2, delayMs: 2000 },
        { attempt: 1, delayMs: 1000 },
        { attempt: 2, delayMs: 2000 },
        { attempt: 1, delayMs: 1000 },
        { attempt: 2, delayMs: 2000 },
      ]);
      expect(value.retry.onRecovered).toHaveBeenCalledTimes(3);
    },
  );
  it.each(["reasoning", "tool arguments"])(
    "recognizes forward %s progress after reconnection",
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
        .mockResolvedValueOnce(sse(progress))
        .mockResolvedValueOnce(sse({ type: "response.completed" }));
      vi.stubGlobal("fetch", fetcher);
      const pending = collect(value);
      await vi.runAllTimersAsync();
      await pending;
      expect(vi.mocked(value.retry.onRetry).mock.calls.map(([state]) => state.attempt)).toEqual([
        1, 1,
      ]);
      expect(fetcher).toHaveBeenCalledTimes(3);
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
  it("exhausts a fresh allowance if recovery is followed by persistent failure", async () => {
    vi.useFakeTimers();
    const value = input();
    value.retry.maxRetries = 2;
    const unavailable = () => new Response("Unavailable", { status: 503 });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(sse({ type: "response.output_text.delta", delta: "New progress" }))
      .mockImplementation(async () => unavailable());
    vi.stubGlobal("fetch", fetcher);
    const pending = expect(collect(value)).rejects.toThrow("HTTP 503");
    await vi.runAllTimersAsync();
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(vi.mocked(value.retry.onRetry).mock.calls.map(([state]) => state.attempt)).toEqual([
      1, 2, 1, 2,
    ]);
  });
  it("recognizes different shorter output as recovery without depending on token chunk boundaries", async () => {
    vi.useFakeTimers();
    const value = input();
    value.retry.maxRetries = 1;
    value.retry.onRecovered = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        sse({ type: "response.output_text.delta", delta: "A long incomplete response" }),
      )
      .mockResolvedValueOnce(sse({ type: "response.output_text.delta", delta: "New" }))
      .mockResolvedValueOnce(
        sse(
          { type: "response.output_text.delta", delta: "New answer" },
          { type: "response.completed" },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const pending = expect(collect(value)).resolves.toContainEqual({
      type: "text_delta",
      text: "New answer",
    });
    await vi.runAllTimersAsync();
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(vi.mocked(value.retry.onRetry).mock.calls.map(([state]) => state.attempt)).toEqual([
      1, 1,
    ]);
    expect(value.retry.onRecovered).toHaveBeenCalledTimes(2);
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
});
