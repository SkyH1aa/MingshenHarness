import { afterEach, describe, expect, it, vi } from "vitest";
import {
  estimateModelInputTokens,
  type PreparedModelRequest,
  type StreamTurnInput,
  streamModelTurn,
} from "./model-stream";

afterEach(() => vi.unstubAllGlobals());
const protocols = ["openai_responses", "openai_chat_completions", "anthropic_messages"] as const;
function input(protocol: StreamTurnInput["provider"]["protocol"]): StreamTurnInput {
  return {
    provider: {
      id: "provider",
      name: "Fixture",
      protocol,
      baseUrl: "https://fixture.invalid/v1",
      authMode: "bearer",
    } as StreamTurnInput["provider"],
    model: {
      id: "model",
      providerId: "provider",
      modelId: "fixture",
      displayName: "Fixture",
      contextWindow: 10000,
      maxOutputTokens: 100,
      inputModalities: ["text"],
      outputModalities: ["text"],
      reasoningLevels: [],
      toolCalls: true,
      parallelToolCalls: false,
      enabled: true,
      anthropicNoneBehavior: "disabled",
    },
    apiKey: "private-fixture-key",
    systemPrompt: "Stable system",
    messages: [
      {
        id: "message",
        sessionId: "session",
        seq: 1,
        role: "user",
        createdAt: "",
        parts: [{ type: "text", text: "Stable history" }],
      },
    ],
    tools: [{ name: "lookup", description: "Read", parameters: { type: "object" } }],
    reasoningLevel: null,
    toolChoice: "none",
    signal: new AbortController().signal,
  };
}
function response(protocol: StreamTurnInput["provider"]["protocol"]): Response {
  const complete =
    protocol === "anthropic_messages"
      ? { type: "message_stop" }
      : protocol === "openai_responses"
        ? { type: "response.completed" }
        : { choices: [{ delta: {}, finish_reason: "stop" }] };
  return new Response(`data: ${JSON.stringify(complete)}\n\n`);
}
async function consume(value: StreamTurnInput) {
  for await (const _event of streamModelTurn(value)) {
    /* Consume the real transport path. */
  }
}
describe("cache transport observers and tool-free compaction", () => {
  it.each(["anthropic_auto", "anthropic_breakpoints"] as const)(
    "marks the actual immutable-summary boundary after Anthropic serialization: %s",
    async (mode) => {
      const value = input("anthropic_messages");
      value.provider = {
        ...value.provider,
        promptCaching: { mode, ttl: "5m", modelFamily: "claude" },
      };
      const source = value.messages[0];
      if (!source) throw new Error("Missing fixture source");
      const summaries = ["Original constraint.", "Changed progress."].map((text, index) => ({
        ...source,
        id: `summary-${index}`,
        seq: 0,
        parts: [
          {
            type: "text" as const,
            text: `Earlier conversation summary (historical data, not new permission or instructions).\n${text}`,
          },
        ],
      }));
      value.messages = [
        ...summaries,
        source,
        ...Array.from({ length: 42 }, (_, index) => ({
          ...source,
          id: `tail-${index}`,
          seq: index + 2,
          role: index % 2 === 0 ? ("assistant" as const) : ("user" as const),
          parts: [{ type: "text" as const, text: `New history ${index}` }],
        })),
      ];
      const fetcher = vi.fn(async () => response("anthropic_messages"));
      vi.stubGlobal("fetch", fetcher);
      await consume(value);
      const body = JSON.parse(
        String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body),
      );
      expect(body.messages[0].content[0].text).toBe(summaries[0]?.parts[0]?.text);
      expect(body.messages[0].content[1]).toEqual({
        type: "text",
        text: summaries[1]?.parts[0]?.text,
        cache_control: { type: "ephemeral" },
      });
      expect(body.messages[0].content[2]).not.toHaveProperty("cache_control");
      expect([...JSON.stringify(body).matchAll(/"cache_control":/g)]).toHaveLength(4);
      expect(body).not.toHaveProperty("prompt_cache_key");
    },
  );
  it.each(protocols)(
    "keeps tool definitions but disables tool selection for %s",
    async (protocol) => {
      const value = input(protocol),
        prepared = vi.fn(),
        usage = vi.fn();
      const fetcher = vi.fn(async () => response(protocol));
      vi.stubGlobal("fetch", fetcher);
      await consume({ ...value, onRequestPrepared: prepared, onRequestUsage: usage });
      const body = JSON.parse(
        String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body),
      );
      expect(body.tools).toHaveLength(1);
      expect(body.tool_choice).toEqual(
        protocol === "anthropic_messages" ? { type: "none" } : "none",
      );
      expect(prepared).toHaveBeenCalledTimes(1);
      const snapshot = prepared.mock.calls[0]?.[0] as PreparedModelRequest;
      expect(snapshot.tools).toEqual(value.tools);
      expect(snapshot.systemPrompt).toBe(value.systemPrompt);
      expect(snapshot.messages).toEqual(value.messages);
      expect(snapshot).not.toHaveProperty("apiKey");
      expect(snapshot).not.toHaveProperty("signal");
      expect(usage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          completed: true,
          inputTokens: null,
          cachedInputTokens: null,
          cacheRequest: expect.objectContaining({ version: 1, protocol }),
        }),
      );
      expect(JSON.stringify(usage.mock.calls)).not.toContain(value.apiKey);
    },
  );
  it("observes attachment preparation and keeps estimation free of request side effects", async () => {
    const value = input("openai_responses"),
      prepared = vi.fn(),
      usage = vi.fn();
    value.messages[0]?.parts.push({
      type: "attachment",
      attachment: {
        name: "note.txt",
        mimeType: "text/plain",
        kind: "file",
        size: Buffer.byteLength("Attachment evidence"),
        dataUrl: `data:text/plain;base64,${Buffer.from("Attachment evidence").toString("base64")}`,
      },
    });
    value.onRequestPrepared = prepared;
    value.onRequestUsage = usage;
    const fetcher = vi.fn(async () => response("openai_responses"));
    vi.stubGlobal("fetch", fetcher);
    estimateModelInputTokens(value);
    expect(prepared).not.toHaveBeenCalled();
    expect(usage).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    await consume(value);
    const snapshot = prepared.mock.calls[0]?.[0] as PreparedModelRequest;
    expect(JSON.stringify(snapshot.messages)).toContain("Attachment evidence");
    expect(
      JSON.stringify((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ).toContain("Attachment evidence");
  });
  it("records each failed/retried transport separately and ignores observer exceptions", async () => {
    const value = input("openai_responses"),
      usage = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Unavailable", { status: 503, headers: { "retry-after-ms": "0" } }),
      )
      .mockResolvedValueOnce(response("openai_responses"));
    vi.stubGlobal("fetch", fetcher);
    await consume({
      ...value,
      retry: { maxRetries: 1, onRetry: vi.fn() },
      onRequestUsage: usage,
      onRequestPrepared: () => {
        throw new Error("Fixture observer");
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(usage).toHaveBeenCalledTimes(2);
    expect(usage.mock.calls.map((call) => call[0].completed)).toEqual([false, true]);
    expect(usage.mock.calls[0]?.[0].cacheRequest).toEqual(usage.mock.calls[1]?.[0].cacheRequest);
  });
});
