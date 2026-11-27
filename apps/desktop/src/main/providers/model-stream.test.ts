import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderProtocol } from "../../shared/domain";
import { ModelOutputLimitError, ModelRequestError } from "./model-request-error";
import {
  getProtocolPath,
  type ModelStreamEvent,
  type StreamTurnInput,
  streamModelTurn,
} from "./model-stream";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function input(protocol: ProviderProtocol): StreamTurnInput {
  return {
    provider: {
      id: "provider",
      customHeaderName: null,
      activeKeyId: null,
      keys: [],
      models: [],
      createdAt: "",
      updatedAt: "",
      name: "Fixture",
      baseUrl: "https://fixture.invalid/v1",
      protocol,
      authMode: "bearer",
    },
    model: {
      id: "model",
      providerId: "provider",
      displayName: "Fixture",
      contextWindow: 10000,
      outputModalities: ["text"],
      reasoningLevels: ["none", "high"],
      enabled: true,
      modelId: "fixture",
      maxOutputTokens: 100,
      toolCalls: true,
      parallelToolCalls: false,
      inputModalities: ["text"],
      anthropicNoneBehavior: "disabled",
    },
    apiKey: "fixture-key",
    systemPrompt: "Test",
    messages: [
      {
        id: "message",
        sessionId: "session",
        seq: 1,
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        createdAt: new Date().toISOString(),
      },
    ],
    tools: [
      { name: "lookup", description: "Read", parameters: { type: "object", properties: {} } },
    ],
    reasoningLevel: "none",
    signal: new AbortController().signal,
  };
}

async function collect(value: StreamTurnInput): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of streamModelTurn(value)) events.push(event);
  return events;
}

function fixture(events: unknown[]) {
  const fetcher = vi.fn(
    async (_url: string, _options: RequestInit) =>
      new Response(
        events
          .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
          .join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

type TextProtocol = Exclude<ProviderProtocol, "openai_images">;

function completedStreamEvents(protocol: TextProtocol, text: string): unknown[] {
  switch (protocol) {
    case "anthropic_messages":
      return [
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        { type: "message_stop" },
      ];
    case "openai_responses":
      return [{ type: "response.output_text.delta", delta: text }, { type: "response.completed" }];
    case "openai_chat_completions":
      return [{ choices: [{ delta: { content: text }, finish_reason: "stop" }] }, "[DONE]"];
    case "gemini_generate_content":
      return [
        {
          candidates: [
            {
              index: 0,
              content: { role: "model", parts: [{ text }] },
              finishReason: "STOP",
            },
          ],
        },
      ];
  }
}

function sseResponse(events: unknown[]): Response {
  return new Response(
    events
      .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
      .join(""),
  );
}

function decodedCalls(events: ModelStreamEvent[]) {
  const calls = new Map<number, { callId: string; name: string; arguments: string }>();
  for (const event of events) {
    if (event.type === "tool_call_started")
      calls.set(event.index, { callId: event.callId, name: event.name, arguments: "" });
    if (event.type === "tool_call_arguments" || event.type === "tool_call_arguments_delta") {
      const call = calls.get(event.index);
      if (call)
        call.arguments =
          event.type === "tool_call_arguments" ? event.arguments : call.arguments + event.delta;
    }
  }
  return [...calls.values()];
}

describe("Tool argument compatibility", () => {
  const args = { command: "Write-Output '中文 C:\\project\\notes.txt'" };
  const json = JSON.stringify(args);
  const item = {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: "run_command",
    arguments: json,
  };
  const expected = [{ callId: "call_1", name: "run_command", arguments: json }];

  it.each([false, true])(
    "preserves Anthropic initial input with repeated deltas: %s",
    async (repeat) => {
      fixture([
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "call_1", name: "run_command", input: args },
        },
        ...(repeat
          ? [json.slice(0, 12), json.slice(12)].map((partial_json) => ({
              type: "content_block_delta",
              index: 1,
              delta: { type: "input_json_delta", partial_json },
            }))
          : []),
        { type: "message_stop" },
      ]);
      const events = await collect(input("anthropic_messages"));
      expect(decodedCalls(events)).toEqual(expected);
      expect(events.filter((event) => event.type === "tool_call_started")).toHaveLength(1);
    },
  );

  it.each(["arguments.done", "output_item.done", "completed"])(
    "recovers Responses arguments only supplied in %s",
    async (source) => {
      fixture([
        { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
        ...(source === "arguments.done"
          ? [{ type: "response.function_call_arguments.done", output_index: 0, arguments: json }]
          : source === "output_item.done"
            ? [{ type: "response.output_item.done", output_index: 0, item }]
            : []),
        { type: "response.completed", response: { output: source === "completed" ? [item] : [] } },
      ]);
      expect(decodedCalls(await collect(input("openai_responses")))).toEqual(expected);
    },
  );

  it("recovers a completed Responses tool even when no added event was sent", async () => {
    fixture([{ type: "response.completed", response: { output: [{ type: "reasoning" }, item] } }]);
    expect(decodedCalls(await collect(input("openai_responses")))).toEqual(expected);
  });

  it.each([false, true])(
    "reconciles Responses deltas and repeated final snapshots with initial input: %s",
    async (initial) => {
      fixture([
        {
          type: "response.output_item.added",
          output_index: 1,
          item: { ...item, arguments: initial ? json : "" },
        },
        ...[json.slice(0, 10), json.slice(10)].map((delta) => ({
          type: "response.function_call_arguments.delta",
          output_index: 1,
          item_id: "fc_1",
          delta,
        })),
        {
          type: "response.function_call_arguments.done",
          output_index: 1,
          item_id: "fc_1",
          arguments: json,
        },
        { type: "response.output_item.done", output_index: 1, item },
        { type: "response.completed", response: { output: [{ type: "reasoning" }, item] } },
      ]);
      const events = await collect(input("openai_responses"));
      expect(decodedCalls(events)).toEqual(expected);
      expect(events.filter((event) => event.type === "tool_call_started")).toHaveLength(1);
    },
  );

  it("uses the final authoritative snapshot instead of concatenating a partial prefix", async () => {
    fixture([
      { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: '{"command":"unfinished',
      },
      { type: "response.function_call_arguments.done", output_index: 0, arguments: json },
      { type: "response.completed" },
    ]);
    expect(decodedCalls(await collect(input("openai_responses")))).toEqual(expected);
  });

  it.each(["arguments.done", "output_item.done"])(
    "ignores late repeated argument deltas after Responses %s",
    async (source) => {
      fixture([
        { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
        {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          item_id: "fc_1",
          delta: json,
        },
        source === "arguments.done"
          ? {
              type: "response.function_call_arguments.done",
              output_index: 0,
              item_id: "fc_1",
              arguments: json,
            }
          : { type: "response.output_item.done", output_index: 0, item },
        ...[json.slice(0, 10), json.slice(10), '{"command":"late replacement"}'].map((delta) => ({
          type: "response.function_call_arguments.delta",
          output_index: 0,
          item_id: "fc_1",
          delta,
        })),
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, arguments: '{"command":"stale initial snapshot"}' },
        },
        { type: "response.completed", response: { output: [] } },
      ]);
      expect(decodedCalls(await collect(input("openai_responses")))).toEqual(expected);
    },
  );

  it.each(["output_item.added", "output_item.done", "completed"])(
    "buffers index-free Responses arguments before metadata from %s",
    async (source) => {
      fixture([
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          delta: json.slice(0, 10),
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          delta: json.slice(10),
        },
        ...(source === "completed"
          ? []
          : [
              {
                type: `response.${source}`,
                output_index: 1,
                item: { ...item, arguments: source === "output_item.added" ? "" : json },
              },
            ]),
        {
          type: "response.completed",
          response: { output: source === "completed" ? [{ type: "reasoning" }, item] : [] },
        },
      ]);
      const events = await collect(input("openai_responses"));
      expect(decodedCalls(events)).toEqual(expected);
      expect(events.filter((event) => event.type === "tool_call_started")).toEqual([
        { type: "tool_call_started", index: 1, callId: "call_1", name: "run_command" },
      ]);
    },
  );

  it("keeps early index-free parallel arguments separate from reasoning and identified tools", async () => {
    const read = {
      ...item,
      id: "fc_read",
      call_id: "call_read",
      name: "read_file",
      arguments: '{"path":"notes.txt"}',
    };
    fixture([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { id: "reasoning", type: "reasoning" },
      },
      { type: "response.output_item.added", output_index: 1, item: { ...item, arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_read", delta: '{"path":' },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: json },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_read",
        arguments: read.arguments,
      },
      {
        type: "response.output_item.done",
        output_index: 2,
        item: { ...read, arguments: undefined },
      },
      { type: "response.function_call_arguments.delta", item_id: "fc_read", delta: "ignored" },
      { type: "response.completed", response: { output: [] } },
    ]);
    expect(decodedCalls(await collect(input("openai_responses")))).toEqual([
      ...expected,
      { callId: "call_read", name: "read_file", arguments: read.arguments },
    ]);
  });

  it("rejects unresolved index-free argument events instead of attaching them to another tool", async () => {
    fixture([
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.function_call_arguments.delta", item_id: "missing", delta: json },
      { type: "response.completed", response: { output: [] } },
    ]);
    await expect(collect(input("openai_responses"))).rejects.toThrow("Incomplete tool identity");
  });

  it("retains parallel Responses tools and associates index-free argument events by item id", async () => {
    const read = {
      ...item,
      id: "fc_read",
      call_id: "call_read",
      name: "read_file",
      arguments: '{"path":"notes.txt"}',
    };
    fixture([
      { type: "response.output_item.added", output_index: 1, item: { ...item, arguments: "" } },
      { type: "response.output_item.added", output_index: 2, item: { ...read, arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_read", delta: '{"path":' },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: json.slice(0, 8) },
      { type: "response.function_call_arguments.delta", item_id: "fc_read", delta: '"notes.txt"}' },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: json.slice(8) },
      { type: "response.completed", response: { output: [{ type: "reasoning" }, item, read] } },
    ]);
    expect(decodedCalls(await collect(input("openai_responses")))).toEqual([
      ...expected,
      { callId: "call_read", name: "read_file", arguments: read.arguments },
    ]);
  });

  it("keeps arguments buffered until late Responses metadata identifies the call", async () => {
    fixture([
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        item_id: "fc_1",
        delta: json,
      },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed" },
    ]);
    expect(decodedCalls(await collect(input("openai_responses")))).toEqual(expected);
  });

  it.each([false, true])(
    "accepts Chat Completions object parameters with later string deltas: %s",
    async (repeat) => {
      fixture([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", function: { name: "run_command", arguments: args } },
                ],
              },
            },
          ],
        },
        ...(repeat
          ? [json.slice(0, 7), json.slice(7)].map((arguments_) => ({
              choices: [
                { delta: { tool_calls: [{ index: 0, function: { arguments: arguments_ } }] } },
              ],
            }))
          : []),
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        "[DONE]",
      ]);
      expect(decodedCalls(await collect(input("openai_chat_completions")))).toEqual(expected);
    },
  );

  it("accepts complete Chat Completions message tool calls without indexes", async () => {
    fixture([
      {
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                { id: "call_1", function: { name: "run_command", arguments: json } },
                {
                  id: "call_read",
                  function: { name: "read_file", arguments: { path: "notes.txt" } },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      "[DONE]",
    ]);
    expect(decodedCalls(await collect(input("openai_chat_completions")))).toEqual([
      ...expected,
      { callId: "call_read", name: "read_file", arguments: '{"path":"notes.txt"}' },
    ]);
  });

  it.each(["repeat", "placeholder", "placeholder-fragments"])(
    "reconciles complete Chat Completions delta snapshots: %s",
    async (mode) => {
      const values =
        mode === "repeat"
          ? [json, json]
          : mode === "placeholder"
            ? ["{}", json]
            : ["{}", json.slice(0, 10), json.slice(10)];
      fixture([
        ...values.map((arguments_, index) => ({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    ...(index === 0 ? { id: "call_1" } : {}),
                    function: {
                      ...(index === 0 ? { name: "run_command" } : {}),
                      arguments: arguments_,
                    },
                  },
                ],
              },
            },
          ],
        })),
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        "[DONE]",
      ]);
      expect(decodedCalls(await collect(input("openai_chat_completions")))).toEqual(expected);
    },
  );
  it("preserves a nested JSON object arriving as a standalone argument fragment", async () => {
    fixture([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "lookup", arguments: '{"options":' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]);
    expect(decodedCalls(await collect(input("openai_chat_completions")))).toEqual([
      { callId: "call_1", name: "lookup", arguments: '{"options":{}}' },
    ]);
  });

  it("preserves parameters that arrive before a Chat Completions tool name and id", async () => {
    fixture([
      {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: json.slice(0, 10) } }] } },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "run_command", arguments: json.slice(10) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      "[DONE]",
    ]);
    expect(decodedCalls(await collect(input("openai_chat_completions")))).toEqual(expected);
  });

  it.each(["read_file", "run_command"])("does not invent missing fields for %s", async (name) => {
    fixture([
      { type: "response.output_item.added", item: { ...item, name, arguments: "{}" } },
      { type: "response.completed" },
    ]);
    const calls = decodedCalls(await collect(input("openai_responses")));
    expect(JSON.parse(calls[0]?.arguments || "{}")).toEqual({});
  });

  it("rejects a stream with parameters but no call identity instead of silently losing a tool", async () => {
    fixture([
      { type: "response.function_call_arguments.done", output_index: 1, arguments: json },
      { type: "response.completed" },
    ]);
    await expect(collect(input("openai_responses"))).rejects.toThrow("Incomplete tool identity");
  });

  it("rejects conflicting IDs rather than merging two tools into one", async () => {
    fixture([
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.output_item.done", output_index: 0, item: { ...item, call_id: "other" } },
      { type: "response.completed" },
    ]);
    await expect(collect(input("openai_responses"))).rejects.toThrow("Conflicting tool call IDs");
  });
});

describe("OpenAI Images protocol isolation", () => {
  it("fails closed before a text request or tool hook can run", async () => {
    const fetcher = vi.fn();
    const beforeEachRequest = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const value = input("openai_images");
    value.beforeEachRequest = beforeEachRequest;

    await expect(collect(value)).rejects.toThrow(
      "OpenAI Images 是纯生图协议，不能用于文本或 Agent 请求",
    );
    expect(beforeEachRequest).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose a text protocol path", () => {
    expect(() => getProtocolPath("openai_images", "image-model")).toThrow(
      "OpenAI Images 是纯生图协议，不能用于文本或 Agent 请求",
    );
  });
});

describe("Model protocol streaming", () => {
  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "sends rendered scan/handwriting page images to vision models over %s",
    async (protocol) => {
      const { scannedPdf } = createRequire(import.meta.url)(
        resolve("../../scripts/fixtures/document-fixtures.cjs"),
      ) as { scannedPdf: (options: { handwriting: boolean }) => Buffer };
      const bytes = scannedPdf({ handwriting: true });
      const fetcher = fixture(
        protocol === "openai_responses"
          ? [{ type: "response.completed", response: {} }]
          : protocol === "anthropic_messages"
            ? [{ type: "message_stop" }]
            : [{ choices: [{ delta: {}, finish_reason: "stop" }] }, "[DONE]"],
      );
      const value = input(protocol);
      value.model.inputModalities =
        protocol === "openai_chat_completions" ? ["text", "image", "file"] : ["text", "image"];
      value.messages[0]?.parts.push({
        type: "attachment",
        attachment: {
          kind: "file",
          name: "handwriting.pdf",
          mimeType: "application/pdf",
          size: bytes.length,
          dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}`,
        },
      });
      await collect(value);
      const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
      const content =
        protocol === "openai_responses"
          ? body.input[0].content
          : body.messages.find((message: { role: string }) => message.role === "user").content;
      expect(content.some((part: { text?: string }) => part.text?.includes("PDF page 1"))).toBe(
        true,
      );
      const image = content.find(
        (part: { type: string }) =>
          part.type ===
          (protocol === "openai_responses"
            ? "input_image"
            : protocol === "anthropic_messages"
              ? "image"
              : "image_url"),
      );
      const encoded =
        protocol === "anthropic_messages"
          ? image.source.data
          : (protocol === "openai_responses" ? image.image_url : image.image_url.url).split(",")[1];
      expect(Buffer.from(encoded, "base64").subarray(0, 8).toString("hex")).toBe(
        "89504e470d0a1a0a",
      );
      expect(
        content.some(
          (part: { type: string }) => part.type === "input_file" || part.type === "document",
        ),
      ).toBe(false);
    },
  );
  it.each(["openai_responses", "anthropic_messages"] as const)(
    "preserves native PDF bytes when file input is enabled over %s",
    async (protocol) => {
      const fetcher = fixture(
        protocol === "openai_responses"
          ? [{ type: "response.completed", response: {} }]
          : [{ type: "message_stop" }],
      );
      const value = input(protocol);
      value.model.inputModalities = ["text", "file"];
      const base64 = Buffer.from("native-pdf-fixture").toString("base64");
      value.messages[0]?.parts.push({
        type: "attachment",
        attachment: {
          kind: "file",
          name: "native.pdf",
          mimeType: "application/pdf",
          dataUrl: `data:application/pdf;base64,${base64}`,
          size: 18,
          extractedContent: { text: "", format: "PDF", warnings: [], truncated: false },
        },
      });
      await collect(value);
      const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
      if (protocol === "openai_responses")
        expect(body.input[0].content).toContainEqual({
          type: "input_file",
          filename: "native.pdf",
          file_data: `data:application/pdf;base64,${base64}`,
        });
      else
        expect(body.messages[0].content).toContainEqual({
          type: "document",
          title: "native.pdf",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        });
    },
  );
  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "sends actual uploaded PDF text to text-only models over %s",
    async (protocol) => {
      const content = "BT /F1 12 Tf 50 700 Td (PDF attachment evidence 127) Tj ET";
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      ];
      let pdf = "%PDF-1.4\n";
      const offsets = [0];
      for (const [i, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
      }
      const xref = Buffer.byteLength(pdf);
      pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      const fetcher = fixture(
        protocol === "openai_responses"
          ? [
              { type: "response.output_text.delta", delta: "Read" },
              { type: "response.completed", response: {} },
            ]
          : protocol === "anthropic_messages"
            ? [
                { type: "content_block_delta", delta: { type: "text_delta", text: "Read" } },
                { type: "message_stop" },
              ]
            : [{ choices: [{ delta: { content: "Read" }, finish_reason: "stop" }] }, "[DONE]"],
      );
      const value = input(protocol);
      value.messages[0]?.parts.push({
        type: "attachment",
        attachment: {
          name: "uploaded.pdf",
          mimeType: "application/pdf",
          size: Buffer.byteLength(pdf),
          kind: "file",
          dataUrl: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
        },
      });
      await collect(value);
      const body = String(fetcher.mock.calls[0]?.[1]?.body);
      expect(body).toContain("PDF attachment evidence 127");
      expect(body).not.toContain("无法直接读取");
    },
  );
  it.each(["openai_responses", "openai_chat_completions"] as const)(
    "sends explicit none and honors parallel-tool settings for %s",
    async (protocol) => {
      const fetcher = fixture(
        protocol === "openai_responses"
          ? [
              { type: "response.output_text.delta", delta: "OK" },
              {
                type: "response.completed",
                response: { usage: { input_tokens: 1, output_tokens: 2 } },
              },
            ]
          : [{ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] }, "[DONE]"],
      );
      expect(await collect(input(protocol))).toContainEqual({ type: "text_delta", text: "OK" });
      const options = fetcher.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(String(options.body));
      expect(protocol === "openai_responses" ? body.reasoning.effort : body.reasoning_effort).toBe(
        "none",
      );
      expect(body.parallel_tool_calls).toBe(false);
    },
  );
  it("retains Anthropic adaptive effort, streamed text, tool arguments and cached input usage", async () => {
    const fetcher = fixture([
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 8,
            output_tokens: 0,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 200,
          },
        },
      },
      { type: "content_block_delta", delta: { type: "text_delta", text: "OK" } },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "call", name: "lookup", input: {} },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"q":"x"}' },
      },
      { type: "message_delta", usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ]);
    const onRequestUsage = vi.fn();
    const events = await collect({
      ...input("anthropic_messages"),
      reasoningLevel: "high",
      onRequestUsage,
    });
    expect(events).toContainEqual({
      type: "tool_call_started",
      index: 1,
      callId: "call",
      name: "lookup",
    });
    expect(events).toContainEqual({
      type: "tool_call_arguments_delta",
      index: 1,
      delta: '{"q":"x"}',
    });
    expect(events.filter((event) => event.type === "usage").at(-1)).toMatchObject({
      inputTokens: 308,
      outputTokens: 3,
      totalTokens: 311,
      cachedInputTokens: 100,
      cacheCreationInputTokens: 200,
    });
    expect(onRequestUsage).toHaveBeenCalledExactlyOnceWith({
      inputTokens: 308,
      outputTokens: 3,
      totalTokens: 311,
      cachedInputTokens: 100,
      cacheCreationInputTokens: 200,
      completed: true,
      cacheRequest: expect.objectContaining({ version: 1, protocol: "anthropic_messages" }),
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.thinking).toMatchObject({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
  });
  it("merges late Anthropic cache usage with the original uncached input", async () => {
    fixture([
      { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
      {
        type: "message_delta",
        usage: { output_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
      },
      { type: "message_delta", usage: { output_tokens: 4 } },
      { type: "message_stop" },
    ]);
    const events = await collect(input("anthropic_messages"));
    expect(events.filter((event) => event.type === "usage").at(-1)).toMatchObject({
      inputTokens: 160,
      outputTokens: 4,
      totalTokens: 164,
      cachedInputTokens: 100,
      cacheCreationInputTokens: 50,
    });
  });
  it.each(["response.incomplete", "response.failed"] as const)(
    "records returned usage before rejecting %s",
    async (type) => {
      fixture([
        {
          type,
          response: {
            usage: {
              input_tokens: 100,
              output_tokens: 3,
              input_tokens_details: { cached_tokens: 80 },
            },
            error: { type: "invalid_request_error", message: "Fixture failure" },
            incomplete_details: { reason: "max_output_tokens" },
          },
        },
      ]);
      const onRequestUsage = vi.fn();
      await expect(collect({ ...input("openai_responses"), onRequestUsage })).rejects.toThrow();
      expect(onRequestUsage).toHaveBeenCalledExactlyOnceWith({
        inputTokens: 100,
        outputTokens: 3,
        totalTokens: 103,
        cachedInputTokens: 80,
        cacheCreationInputTokens: null,
        completed: false,
        cacheRequest: expect.objectContaining({ version: 1, protocol: "openai_responses" }),
      });
    },
  );
  it("records usage returned with a Chat Completions stream error", async () => {
    fixture([
      {
        error: { type: "invalid_request_error", message: "Fixture failure" },
        usage: {
          prompt_tokens: 100,
          completion_tokens: 3,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      },
    ]);
    const onRequestUsage = vi.fn();
    await expect(collect({ ...input("openai_chat_completions"), onRequestUsage })).rejects.toThrow(
      "Fixture failure",
    );
    expect(onRequestUsage).toHaveBeenCalledExactlyOnceWith({
      inputTokens: 100,
      outputTokens: 3,
      totalTokens: 103,
      cachedInputTokens: 0,
      cacheCreationInputTokens: null,
      completed: false,
      cacheRequest: expect.objectContaining({ version: 1, protocol: "openai_chat_completions" }),
    });
  });
  it("retains Anthropic message_start usage when a later stream error terminates the response", async () => {
    fixture([
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 10,
            output_tokens: 0,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: "error",
        error: { type: "invalid_request_error", message: "Fixture failure" },
        usage: { output_tokens: 3 },
      },
    ]);
    const onRequestUsage = vi.fn();
    await expect(collect({ ...input("anthropic_messages"), onRequestUsage })).rejects.toThrow(
      "Fixture failure",
    );
    expect(onRequestUsage).toHaveBeenCalledExactlyOnceWith({
      inputTokens: 110,
      outputTokens: 3,
      totalTokens: 113,
      cachedInputTokens: 100,
      cacheCreationInputTokens: 0,
      completed: false,
      cacheRequest: expect.objectContaining({ version: 1, protocol: "anthropic_messages" }),
    });
  });
  it("records explicit cache usage on an HTTP failure without treating it as successful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: "Fixture HTTP failure" },
              usage: {
                input_tokens: 100,
                output_tokens: 3,
                input_tokens_details: { cached_tokens: 80 },
              },
            }),
            { status: 400 },
          ),
      ),
    );
    const onRequestUsage = vi.fn();
    await expect(collect({ ...input("openai_responses"), onRequestUsage })).rejects.toThrow(
      "HTTP 400",
    );
    expect(onRequestUsage).toHaveBeenCalledExactlyOnceWith({
      inputTokens: 100,
      outputTokens: 3,
      totalTokens: 103,
      cachedInputTokens: 80,
      cacheCreationInputTokens: null,
      completed: false,
      cacheRequest: expect.objectContaining({ version: 1, protocol: "openai_responses" }),
    });
  });
  it("reports incomplete Responses instead of declaring a partial answer complete", async () => {
    fixture([
      { type: "response.output_text.delta", delta: "Partial" },
      {
        type: "response.incomplete",
        response: { incomplete_details: { reason: "max_output_tokens" } },
      },
    ]);
    await expect(collect(input("openai_responses"))).rejects.toThrow("max_output_tokens");
  });
  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "reports truncated streams for %s",
    async (protocol) => {
      fixture(
        protocol === "openai_responses"
          ? [{ type: "response.output_text.delta", delta: "Partial" }]
          : protocol === "openai_chat_completions"
            ? [{ choices: [{ delta: { content: "Partial" } }] }]
            : [{ type: "content_block_delta", delta: { type: "text_delta", text: "Partial" } }],
      );
      await expect(collect(input(protocol))).rejects.toThrow(/stream|流/i);
    },
  );
  it("does not accept non-empty Chat Completions text when [DONE] has no finish_reason", async () => {
    fixture([{ choices: [{ delta: { content: "Partial" } }] }, "[DONE]"]);
    await expect(collect(input("openai_chat_completions"))).rejects.toMatchObject({
      name: "ModelRequestError",
      retryable: true,
      message: expect.stringContaining("without finish_reason"),
    });
  });
  it("does not release a complete Chat Completions tool call when [DONE] has no finish_reason", async () => {
    fixture([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: {
                    name: "run_command",
                    arguments: JSON.stringify({ command: "Write-Output truncated" }),
                  },
                },
              ],
            },
          },
        ],
      },
      "[DONE]",
    ]);
    await expect(collect(input("openai_chat_completions"))).rejects.toMatchObject({
      name: "ModelRequestError",
      retryable: true,
      message: expect.stringContaining("without finish_reason"),
    });
  });
  it("accepts Chat Completions text after an explicit finish_reason", async () => {
    fixture([{ choices: [{ delta: { content: "Complete" }, finish_reason: "stop" }] }, "[DONE]"]);
    expect(await collect(input("openai_chat_completions"))).toContainEqual({
      type: "text_delta",
      text: "Complete",
    });
  });
});

describe("explicit model output limits", () => {
  const anthropicStop = {
    type: "message_delta",
    delta: { stop_reason: "max_tokens" },
    usage: { output_tokens: 3 },
    diagnostic: "fixture-key",
  };
  const chatStop = {
    choices: [{ delta: {}, finish_reason: "length" }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 3,
      prompt_tokens_details: { cached_tokens: 80 },
    },
    diagnostic: "fixture-key",
  };
  const incompleteResponse = {
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    usage: {
      input_tokens: 100,
      output_tokens: 3,
      input_tokens_details: { cached_tokens: 80 },
    },
    diagnostic: "fixture-key",
  };
  const bareIncomplete = { type: "response.incomplete", ...incompleteResponse };
  const cases = [
    {
      name: "Anthropic max_tokens",
      protocol: "anthropic_messages",
      events: [
        {
          type: "message_start",
          message: { usage: { input_tokens: 20, output_tokens: 0, cache_read_input_tokens: 80 } },
        },
        anthropicStop,
      ],
      message: `Anthropic response incomplete: max_tokens\n${JSON.stringify(anthropicStop)}`,
    },
    {
      name: "Chat Completions length",
      protocol: "openai_chat_completions",
      events: [chatStop],
      message: `Chat Completions response incomplete: length\n${JSON.stringify(chatStop)}`,
    },
    ...["response.incomplete", "response.completed"].map((type) => ({
      name: `Responses ${type}`,
      protocol: "openai_responses",
      events: [{ type, response: incompleteResponse }],
      message: `Responses response incomplete\n${JSON.stringify(incompleteResponse, null, 2)}`,
    })),
    {
      name: "Responses top-level incomplete details",
      protocol: "openai_responses",
      events: [bareIncomplete],
      message: `Responses response incomplete\n${JSON.stringify(bareIncomplete, null, 2)}`,
    },
  ] satisfies Array<{
    name: string;
    protocol: string;
    events: unknown[];
    message: string;
  }>;

  it.each(cases)(
    "preserves the redacted $name error and records failed usage once without transport retry",
    async ({ protocol, events, message }) => {
      const fetcher = fixture(events);
      const onRequestUsage = vi.fn();
      const onRetry = vi.fn();
      const error: unknown = await collect({
        ...input(protocol as ProviderProtocol),
        onRequestUsage,
        retry: { maxRetries: 5, onRetry },
      }).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ModelOutputLimitError);
      expect(error).toBeInstanceOf(ModelRequestError);
      expect(error).toMatchObject({
        name: "ModelOutputLimitError",
        message: message.replaceAll("fixture-key", "[REDACTED]"),
        retryable: false,
        retryAfterMs: null,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
      expect(onRequestUsage).toHaveBeenCalledExactlyOnceWith({
        inputTokens: 100,
        outputTokens: 3,
        totalTokens: 103,
        cachedInputTokens: 80,
        cacheCreationInputTokens: null,
        completed: false,
        cacheRequest: expect.objectContaining({ version: 1, protocol }),
      });
    },
  );

  it.each(["response.incomplete", "response.completed"])(
    "does not classify another incomplete reason in %s as an output limit",
    async (type) => {
      for (const reason of ["content_filter", "context_window_exceeded", undefined]) {
        fixture([{ type, response: { status: "incomplete", incomplete_details: { reason } } }]);
        const error: unknown = await collect(input("openai_responses")).catch(
          (cause: unknown) => cause,
        );
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(ModelOutputLimitError);
        expect(error).toHaveProperty("message", expect.stringContaining("response incomplete"));
      }
    },
  );

  it.each([
    {
      protocol: "openai_chat_completions",
      events: [{ choices: [{ finish_reason: "content_filter" }] }],
    },
    {
      protocol: "openai_chat_completions",
      events: [{ error: { type: "invalid_request_error", message: "Fixture max_tokens" } }],
    },
    {
      protocol: "anthropic_messages",
      events: [
        { type: "error", error: { type: "invalid_request_error", message: "Fixture max_tokens" } },
      ],
    },
    {
      protocol: "openai_responses",
      events: [
        {
          type: "response.failed",
          response: {
            ...incompleteResponse,
            error: { type: "invalid_request_error", message: "Fixture max_output_tokens" },
          },
        },
      ],
    },
    {
      protocol: "openai_responses",
      events: [
        {
          type: "error",
          error: { type: "invalid_request_error", message: "Fixture max_output_tokens" },
        },
      ],
    },
  ])("does not reclassify filtering or upstream errors for $protocol", async (value) => {
    fixture(value.events);
    const error: unknown = await collect(input(value.protocol as ProviderProtocol)).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ModelOutputLimitError);
  });

  it.each(["anthropic_messages", "openai_responses", "openai_chat_completions"] as const)(
    "keeps premature %s EOF retryable rather than reporting budget exhaustion",
    async (protocol) => {
      fixture([]);
      const error: unknown = await collect(input(protocol)).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ModelRequestError);
      expect(error).not.toBeInstanceOf(ModelOutputLimitError);
      expect(error).toHaveProperty("retryable", true);
    },
  );
});

describe("model response watchdog", () => {
  it.each([
    "anthropic_messages",
    "openai_responses",
    "openai_chat_completions",
    "gemini_generate_content",
  ] as const)(
    "aborts and retries a %s request that never receives a meaningful response",
    async (protocol) => {
      vi.useFakeTimers();
      let calls = 0;
      const fetcher = vi.fn((_url: string, options: RequestInit) => {
        calls++;
        if (calls > 1)
          return Promise.resolve(sseResponse(completedStreamEvents(protocol, "Recovered")));
        return new Promise<Response>((_resolve, reject) => {
          const signal = options.signal;
          if (!signal) throw new Error("Fixture request signal missing");
          const abort = () => reject(signal.reason);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      });
      vi.stubGlobal("fetch", fetcher);
      const onRetry = vi.fn();
      const result = collect({
        ...input(protocol),
        reasoningLevel: protocol === "gemini_generate_content" ? null : "none",
        retry: { maxRetries: 1, onRetry },
        watchdog: { firstResponseTimeoutMs: 300_000, idleTimeoutMs: 900_000 },
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(onRetry).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          attempt: 1,
          maxRetries: 1,
          error: expect.stringContaining("没有收到有效响应"),
        }),
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(result).resolves.toContainEqual({ type: "text_delta", text: "Recovered" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("does not let SSE heartbeat comments renew an idle stream", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const heartbeatTimes: number[] = [];
    let heartbeatCount = 0;
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
      calls++;
      if (calls > 1)
        return Promise.resolve(
          new Response(
            [
              'data: {"type":"response.output_text.delta","delta":"Recovered"}\n\n',
              'data: {"type":"response.completed"}\n\n',
            ].join(""),
          ),
        );
      const encoder = new TextEncoder();
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode('data: {"type":"response.output_text.delta","delta":"First"}\n\n'),
              );
              const heartbeat = setInterval(() => {
                heartbeatTimes.push(Date.now());
                heartbeatCount++;
                controller.enqueue(
                  encoder.encode(
                    heartbeatCount % 2 === 0
                      ? 'data: {"usage":{"input_tokens":10,"output_tokens":1,"total_tokens":11}}\n\n'
                      : ": provider heartbeat\n\n",
                  ),
                );
              }, 60_000);
              const signal = options.signal;
              if (!signal) throw new Error("Fixture request signal missing");
              signal.addEventListener(
                "abort",
                () => {
                  clearInterval(heartbeat);
                  try {
                    controller.error(signal.reason);
                  } catch {
                    // The stream may already have been cancelled by its reader.
                  }
                },
                { once: true },
              );
            },
          }),
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const onRetry = vi.fn();
    const result = collect({
      ...input("openai_responses"),
      retry: { maxRetries: 1, onRetry },
      watchdog: { firstResponseTimeoutMs: 300_000, idleTimeoutMs: 900_000 },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeatTimes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(899_999);
    expect(onRetry).not.toHaveBeenCalled();
    expect(heartbeatTimes.length).toBeGreaterThanOrEqual(14);
    await vi.advanceTimersByTimeAsync(1);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry.mock.calls[0]?.[0].error).toContain("连续 15 分钟没有有效进展");
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toEqual(
      expect.arrayContaining([
        { type: "text_delta", text: "First" },
        { type: "text_delta", text: "Recovered" },
      ]),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
