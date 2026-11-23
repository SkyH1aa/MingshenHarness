import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatAttachmentInput, ProviderProtocol, SessionMessage } from "../../shared/domain";
import {
  formatBeforeModelRequestContext,
  type PluginPromptContextEntry,
} from "../extensions/plugin-hook-service";
import { ModelInputBudgetError } from "./model-request-error";
import {
  estimateModelInputTokens,
  type ModelRequestContext,
  type PreparedModelRequest,
  type StreamTurnInput,
  streamModelTurn,
  withModelRequestContext,
} from "./model-stream";
import { responsesEndpointKey } from "./responses-state";

type JsonObject = Record<string, unknown>;

const protocols: ProviderProtocol[] = [
  "openai_chat_completions",
  "openai_responses",
  "anthropic_messages",
  "gemini_generate_content",
];

afterEach(() => {
  vi.unstubAllGlobals();
});

function streamInput(protocol: ProviderProtocol): StreamTurnInput {
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
      baseUrl: `https://fixture.invalid/${protocol}`,
      protocol,
      authMode: "bearer",
    },
    model: {
      id: "model",
      providerId: "provider",
      displayName: "Fixture",
      contextWindow: 20_000,
      outputModalities: ["text"],
      reasoningLevels: ["none"],
      enabled: true,
      modelId: "fixture",
      maxOutputTokens: 256,
      toolCalls: true,
      parallelToolCalls: false,
      inputModalities: ["text"],
      anthropicNoneBehavior: "disabled",
    },
    apiKey: "fixture-key",
    systemPrompt: "BASE_SYSTEM",
    messages: [message("user", [{ type: "text", text: "xxxx" }], 1)],
    tools: [],
    reasoningLevel: null,
    signal: new AbortController().signal,
  };
}

function message(
  role: SessionMessage["role"],
  parts: SessionMessage["parts"],
  seq: number,
): SessionMessage {
  return {
    id: `message-${seq}`,
    sessionId: "session",
    seq,
    role,
    parts,
    createdAt: "2026-11-23T00:00:00.000Z",
  };
}

function responseFor(protocol: ProviderProtocol): Response {
  const payload =
    protocol === "openai_responses"
      ? { type: "response.completed", response: { output: [] } }
      : protocol === "anthropic_messages"
        ? { type: "message_stop" }
        : protocol === "gemini_generate_content"
          ? {
              candidates: [
                {
                  content: { role: "model", parts: [{ text: "OK" }] },
                  finishReason: "STOP",
                },
              ],
            }
          : { choices: [{ delta: {}, finish_reason: "stop" }] };
  return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function requestFetcher(protocol: ProviderProtocol) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => responseFor(protocol));
}

async function collect(input: StreamTurnInput): Promise<void> {
  for await (const _event of streamModelTurn(input)) {
    // The assertions inspect the prepared wire request.
  }
}

function requestBody(fetcher: ReturnType<typeof requestFetcher>, index = 0) {
  return JSON.parse(String(fetcher.mock.calls[index]?.[1]?.body ?? "{}")) as JsonObject;
}

function record(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function records(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  const result: JsonObject[] = [];
  for (const item of value) {
    const parsed = record(item);
    if (parsed) result.push(parsed);
  }
  return result;
}

function systemText(body: JsonObject, protocol: ProviderProtocol): string {
  if (protocol === "openai_responses") return String(body.instructions ?? "");
  if (protocol === "anthropic_messages") return String(body.system ?? "");
  if (protocol === "gemini_generate_content")
    return String(records(record(body.systemInstruction)?.parts)[0]?.text ?? "");
  return String(records(body.messages)[0]?.content ?? "");
}

function requestItems(body: JsonObject, protocol: ProviderProtocol): JsonObject[] {
  if (protocol === "openai_responses") return records(body.input);
  if (protocol === "gemini_generate_content") return records(body.contents);
  return records(body.messages);
}

function itemBlocks(item: JsonObject | undefined, protocol: ProviderProtocol): JsonObject[] {
  const content = item?.content ?? item?.parts;
  if (typeof content === "string") {
    return [{ type: protocol === "openai_responses" ? "input_text" : "text", text: content }];
  }
  return records(content);
}

function userBlocks(body: JsonObject, protocol: ProviderProtocol): JsonObject[] {
  const last = requestItems(body, protocol)
    .filter((item) => item.role === "user")
    .at(-1);
  return itemBlocks(last, protocol);
}

function allUserBlocks(body: JsonObject, protocol: ProviderProtocol): JsonObject[] {
  return requestItems(body, protocol)
    .filter((item) => item.role === "user")
    .flatMap((item) => itemBlocks(item, protocol));
}

function userText(body: JsonObject, protocol: ProviderProtocol): string {
  return userBlocks(body, protocol)
    .filter((block) => typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function contextEntry(
  text: string,
  position?: "before" | "after",
  format?: "context" | "plain",
): PluginPromptContextEntry {
  return {
    extensionId: "route-marker",
    extensionName: "Route marker",
    text,
    ...(position ? { position } : {}),
    ...(format ? { format } : {}),
  };
}

function effectiveInput(protocol: ProviderProtocol, context: ModelRequestContext): StreamTurnInput {
  const effective = withModelRequestContext(streamInput(protocol), context);
  return {
    ...effective,
    baseSystemPrompt: "BASE_SYSTEM",
  };
}

describe("BeforeModelRequest wire composition", () => {
  const cases: Array<{
    name: string;
    entry: PluginPromptContextEntry;
    expected: string;
  }> = [
    {
      name: "legacy before/context",
      entry: contextEntry("LEGACY_CONTEXT"),
      expected: "xxxx",
    },
    {
      name: "before/plain",
      entry: contextEntry("PREFIX_ONLY", "before", "plain"),
      expected: "PREFIX_ONLY\nxxxx",
    },
    {
      name: "after/context",
      entry: contextEntry("AFTER_CONTEXT", "after", "context"),
      expected: "xxxx",
    },
    {
      name: "after/plain",
      entry: contextEntry("AFTER_PLAIN", "after", "plain"),
      expected: "xxxx\nAFTER_PLAIN",
    },
  ];

  for (const protocol of protocols) {
    for (const testCase of cases) {
      it(`${protocol} applies ${testCase.name} without changing protocol shape`, async () => {
        const fetcher = requestFetcher(protocol);
        vi.stubGlobal("fetch", fetcher);
        const context = formatBeforeModelRequestContext([testCase.entry]);
        await collect(effectiveInput(protocol, context));

        const body = requestBody(fetcher);
        const actualUserText = userText(body, protocol);
        if (testCase.name === "after/context") {
          expect(actualUserText).toMatch(/^xxxx\n<mingshen_plugin_context/);
          expect(actualUserText).toContain("AFTER_CONTEXT");
        } else {
          expect(actualUserText).toBe(testCase.expected);
        }
        if (testCase.entry.position === "after") {
          expect(systemText(body, protocol)).toBe("BASE_SYSTEM");
        }
        if (testCase.entry.format === "context" && testCase.entry.position !== "after") {
          expect(systemText(body, protocol)).toContain("<mingshen_plugin_context");
          expect(systemText(body, protocol)).toContain("route-marker");
        }
        if (testCase.entry.format === "context" && testCase.entry.position === "after") {
          expect(actualUserText).toContain("<mingshen_plugin_context");
          expect(actualUserText).toContain("route-marker");
        }
        if (testCase.entry.format === "plain") {
          const serialized = JSON.stringify(body);
          expect(serialized).not.toContain("<mingshen_plugin_context");
          expect(serialized).not.toContain("route-marker");
          expect(serialized).not.toContain("Plugin 1");
        }
      });
    }
  }

  it.each(protocols)(
    "%s appends a plain suffix after image, text and PDF attachment material",
    async (protocol) => {
      const fetcher = requestFetcher(protocol);
      vi.stubGlobal("fetch", fetcher);
      const value = effectiveInput(protocol, { userSuffix: "ATTACHMENT_TAIL" });
      value.messages[0]?.parts.push(
        {
          type: "attachment",
          attachment: attachment({
            kind: "image",
            name: "image.png",
            mimeType: "image/png",
          }),
        },
        {
          type: "attachment",
          attachment: attachment({
            kind: "file",
            name: "notes.txt",
            mimeType: "text/plain",
            extractedContent: extracted("TEXT_ATTACHMENT_MARKER", "TEXT"),
          }),
        },
        {
          type: "attachment",
          attachment: attachment({
            kind: "file",
            name: "report.pdf",
            mimeType: "application/pdf",
            extractedContent: extracted("PDF_ATTACHMENT_MARKER", "PDF"),
          }),
        },
      );

      await collect(value);

      const body = requestBody(fetcher);
      const text = userText(body, protocol);
      expect(text).toContain("TEXT_ATTACHMENT_MARKER");
      expect(text).toContain("PDF_ATTACHMENT_MARKER");
      expect(text.endsWith("ATTACHMENT_TAIL")).toBe(true);
      expect(userBlocks(body, protocol).at(-1)?.text).toBe("ATTACHMENT_TAIL");
    },
  );

  it.each(protocols)(
    "%s keeps tool calls and tool results intact while adding an ordinary user tail",
    async (protocol) => {
      const fetcher = requestFetcher(protocol);
      vi.stubGlobal("fetch", fetcher);
      const value = effectiveInput(protocol, { userSuffix: "TOOL_TAIL" });
      value.messages = [
        message("user", [{ type: "text", text: "Run the lookup" }], 1),
        message(
          "assistant",
          [
            {
              type: "tool_call",
              callId: "call_1",
              name: "lookup",
              arguments: '{"query":"fixture"}',
              status: "completed",
            },
          ],
          2,
        ),
        message(
          "tool",
          [
            {
              type: "tool_result",
              callId: "call_1",
              output: '{"exact":"tool-output"}',
              isError: false,
            },
          ],
          3,
        ),
      ];
      const original = structuredClone(value.messages);

      await collect(value);

      const body = requestBody(fetcher);
      expect(userText(body, protocol)).toContain("TOOL_TAIL");
      if (protocol === "openai_chat_completions") {
        const history = records(body.messages);
        expect(records(history[2]?.tool_calls)[0]).toMatchObject({
          id: "call_1",
          function: { name: "lookup", arguments: '{"query":"fixture"}' },
        });
        expect(history[3]).toMatchObject({
          role: "tool",
          tool_call_id: "call_1",
          content: '{"exact":"tool-output"}',
        });
      } else if (protocol === "openai_responses") {
        const inputItems = records(body.input);
        expect(inputItems).toContainEqual(
          expect.objectContaining({
            type: "function_call",
            call_id: "call_1",
            arguments: '{"query":"fixture"}',
          }),
        );
        expect(inputItems).toContainEqual({
          type: "function_call_output",
          call_id: "call_1",
          output: '{"exact":"tool-output"}',
        });
      } else if (protocol === "anthropic_messages") {
        const history = records(body.messages);
        expect(records(history[1]?.content)).toContainEqual({
          type: "tool_use",
          id: "call_1",
          name: "lookup",
          input: { query: "fixture" },
        });
        expect(records(history[2]?.content)[0]).toMatchObject({
          type: "tool_result",
          tool_use_id: "call_1",
          content: '{"exact":"tool-output"}',
        });
      } else {
        const contents = records(body.contents);
        expect(records(contents[1]?.parts)).toContainEqual({
          functionCall: { name: "lookup", args: { query: "fixture" } },
        });
        expect(records(contents[2]?.parts)[0]).toMatchObject({
          functionResponse: {
            name: "lookup",
            response: { output: '{"exact":"tool-output"}' },
          },
        });
      }
      expect(value.messages).toEqual(original);
    },
  );

  it.each(protocols)(
    "%s places before/plain before the complete trailing steering sequence",
    async (protocol) => {
      const fetcher = requestFetcher(protocol);
      vi.stubGlobal("fetch", fetcher);
      const value = effectiveInput(protocol, {
        userPrefix: "STEERING_PREFIX",
        userSuffix: "STEERING_SUFFIX",
      });
      value.model.inputModalities = ["text", "image"];
      value.messages = [
        message("user", [{ type: "text", text: "Run lookup" }], 1),
        message(
          "assistant",
          [
            {
              type: "tool_call",
              callId: "call_1",
              name: "lookup",
              arguments: "{}",
              status: "completed",
            },
          ],
          2,
        ),
        message(
          "tool",
          [
            {
              type: "tool_result",
              callId: "call_1",
              output: "lookup complete",
              isError: false,
              images: [
                {
                  mimeType: "image/png",
                  dataUrl:
                    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                  alt: "TOOL_IMAGE_ALT",
                },
              ],
            },
          ],
          3,
        ),
        message(
          "user",
          [
            { type: "text", text: "STEERING_ONE" },
            {
              type: "attachment",
              attachment: attachment({
                kind: "file",
                name: "steering-notes.txt",
                mimeType: "text/plain",
                extractedContent: extracted("STEERING_ATTACHMENT", "TEXT"),
              }),
            },
          ],
          4,
        ),
        message("user", [{ type: "text", text: "STEERING_TWO" }], 5),
      ];

      await collect(value);

      const body = requestBody(fetcher);
      const blocks = allUserBlocks(body, protocol);
      const userWireText = blocks
        .filter((block): block is JsonObject & { text: string } => typeof block.text === "string")
        .map((block) => block.text)
        .join("\n");
      const prefixIndex = userWireText.indexOf("STEERING_PREFIX");
      const firstSteeringIndex = userWireText.indexOf("STEERING_ONE");
      const lastSteeringIndex = userWireText.indexOf("STEERING_TWO");
      const suffixIndex = userWireText.indexOf("STEERING_SUFFIX");
      expect(prefixIndex).toBeLessThan(firstSteeringIndex);
      expect(firstSteeringIndex).toBeLessThan(lastSteeringIndex);
      expect(lastSteeringIndex).toBeLessThan(suffixIndex);

      const serialized = JSON.stringify(body);
      let previousIndex = -1;
      for (const marker of [
        "lookup complete",
        "TOOL_IMAGE_ALT",
        "STEERING_PREFIX",
        "STEERING_ONE",
        "STEERING_ATTACHMENT",
        "STEERING_TWO",
        "STEERING_SUFFIX",
      ]) {
        const markerIndex = serialized.indexOf(marker);
        expect(markerIndex).toBeGreaterThan(previousIndex);
        previousIndex = markerIndex;
      }
    },
  );

  it("does not alter signed Responses continuation items when appending a suffix", async () => {
    const protocol: ProviderProtocol = "openai_responses";
    const fetcher = requestFetcher(protocol);
    vi.stubGlobal("fetch", fetcher);
    const value = effectiveInput(protocol, { userSuffix: "SIGNED_TAIL" });
    const endpointKey = responsesEndpointKey(value.provider.baseUrl);
    value.messages = [
      message(
        "assistant",
        [
          {
            type: "tool_call",
            callId: "call_1",
            name: "lookup",
            arguments: '{"query":"fixture"}',
            status: "completed",
          },
          {
            type: "responses_state",
            providerId: "provider",
            modelId: "fixture",
            endpointKey,
            items: [
              {
                type: "reasoning",
                id: "reasoning-1",
                encrypted_content: "SIGNED_OPAQUE_STATE",
                summary: [],
              },
              {
                type: "function_call",
                call_id: "call_1",
                name: "lookup",
                arguments: '{"query":"fixture"}',
              },
            ],
          },
        ],
        1,
      ),
      message(
        "tool",
        [
          {
            type: "tool_result",
            callId: "call_1",
            output: "signed-result",
            isError: false,
          },
        ],
        2,
      ),
    ];
    const original = structuredClone(value.messages);

    await collect(value);

    const body = requestBody(fetcher);
    const inputItems = records(body.input);
    expect(inputItems).toContainEqual({
      type: "reasoning",
      id: "reasoning-1",
      encrypted_content: "SIGNED_OPAQUE_STATE",
      summary: [],
    });
    expect(inputItems).toContainEqual({
      type: "function_call",
      call_id: "call_1",
      name: "lookup",
      arguments: '{"query":"fixture"}',
    });
    expect(inputItems.at(-1)).toEqual({
      role: "user",
      content: "SIGNED_TAIL",
    });
    expect(value.messages).toEqual(original);
  });

  it("replaces or clears stale requestContext instead of carrying it into a new request", () => {
    const source = streamInput("openai_chat_completions");
    source.requestContext = {
      userPrefix: "STALE_PREFIX",
      userSuffix: "STALE_SUFFIX",
    };

    const replaced = withModelRequestContext(source, { userSuffix: "FRESH_SUFFIX" });
    expect(replaced.requestContext).toEqual({ userSuffix: "FRESH_SUFFIX" });
    expect(replaced.systemPrompt).toBe("BASE_SYSTEM");

    const cleared = withModelRequestContext(source, { systemContext: "SYSTEM_ONLY" });
    expect(cleared.requestContext).toBeUndefined();
    expect(cleared.systemPrompt).toBe("BASE_SYSTEM\n\nSYSTEM_ONLY");
  });

  it("reloads a fresh suffix after a retry without accumulating into history", async () => {
    const protocol: ProviderProtocol = "openai_responses";
    const requestBodies: string[] = [];
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(String(init?.body ?? ""));
      return requestBodies.length === 1
        ? new Response("temporary", {
            status: 503,
            headers: { "retry-after-ms": "0" },
          })
        : responseFor(protocol);
    });
    vi.stubGlobal("fetch", fetcher);
    const value = effectiveInput(protocol, { userSuffix: "FIRST_SUFFIX" });
    const original = structuredClone(value.messages);
    const prepared: PreparedModelRequest[] = [];
    value.retry = { maxRetries: 1, onRetry: vi.fn() };
    value.firstRequestContext = { userSuffix: "FIRST_SUFFIX" };
    value.beforeEachRequest = vi.fn(async () => ({ userSuffix: "SECOND_SUFFIX" }));
    value.onRequestPrepared = (request) => prepared.push(request);

    await collect(value);

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).toContain("FIRST_SUFFIX");
    expect(requestBodies[0]).not.toContain("SECOND_SUFFIX");
    expect(requestBodies[1]).toContain("SECOND_SUFFIX");
    expect(requestBodies[1]).not.toContain("FIRST_SUFFIX");
    expect(value.beforeEachRequest).toHaveBeenCalledExactlyOnceWith(value.provider, value.model);
    expect(value.messages).toEqual(original);
    expect(prepared).toHaveLength(2);
    expect(prepared[0]?.requestContext).toEqual({ userSuffix: "FIRST_SUFFIX" });
    expect(prepared[0]?.messages).toEqual(original);
    expect(prepared[1]?.requestContext).toEqual({ userSuffix: "SECOND_SUFFIX" });
    expect(prepared[1]?.messages).toEqual(original);
  });

  it("reuses firstRequestContext on retries when no per-request hook is configured", async () => {
    const protocol: ProviderProtocol = "openai_responses";
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return bodies.length === 1
        ? new Response("temporary", {
            status: 503,
            headers: { "retry-after-ms": "0" },
          })
        : responseFor(protocol);
    });
    vi.stubGlobal("fetch", fetcher);
    const value = streamInput(protocol);
    value.firstRequestContext = { userPrefix: "STABLE_PREFIX", userSuffix: "STABLE_SUFFIX" };
    value.retry = { maxRetries: 1, onRetry: vi.fn() };

    await collect(value);

    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toContain("STABLE_PREFIX");
      expect(body).toContain("STABLE_SUFFIX");
      expect(body.match(/STABLE_PREFIX/g)).toHaveLength(1);
      expect(body.match(/STABLE_SUFFIX/g)).toHaveLength(1);
    }
    expect(value.beforeEachRequest).toBeUndefined();
  });

  it("counts a dynamic suffix in output clamping and rejects an over-window suffix before fetch", async () => {
    const protocol: ProviderProtocol = "openai_responses";
    const fetcher = requestFetcher(protocol);
    vi.stubGlobal("fetch", fetcher);
    const suffix = `BUDGET_${"x".repeat(2400)}`;
    const requestContext = { userSuffix: suffix };
    const value = effectiveInput(protocol, requestContext);
    value.maxOutputTokens = 100;
    const estimate = estimateModelInputTokens({
      ...value,
      requestContext,
    });
    value.model.contextWindow = estimate + 256 + 37;

    await collect(value);

    expect(requestBody(fetcher).max_output_tokens).toBe(37);

    const rejected = effectiveInput(protocol, requestContext);
    rejected.model.contextWindow = estimate - 1;
    const unexpectedFetch = vi.fn(async () => responseFor(protocol));
    vi.stubGlobal("fetch", unexpectedFetch);
    await expect(collect(rejected)).rejects.toBeInstanceOf(ModelInputBudgetError);
    expect(unexpectedFetch).not.toHaveBeenCalled();
  });
});

function attachment(
  overrides: Partial<ChatAttachmentInput> & Pick<ChatAttachmentInput, "kind" | "name" | "mimeType">,
): ChatAttachmentInput {
  const text = overrides.name.endsWith(".txt");
  const data = text
    ? Buffer.from("plain attachment")
    : Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
  return {
    ...overrides,
    size: data.length,
    dataUrl: `data:${overrides.mimeType};base64,${data.toString("base64")}`,
  };
}

function extracted(text: string, format: string) {
  return {
    text,
    format,
    warnings: [],
    truncated: false,
    parserVersion: 2,
    pdfMode: "ocr" as const,
    ...(format === "PDF" ? { pdf: { totalPages: 1, inspectedPages: 1, ocrPages: 0 } } : {}),
  };
}
