import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessagePart, SessionMessage } from "../../shared/domain";
import { validatePromptCachingSettings } from "../../shared/prompt-caching";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import type { SecretStore } from "../storage/secret-store";
import { compareWireCacheFingerprints, createWireCacheFingerprint } from "./cache-diagnostics";
import { geminiModelPath, geminiThinkingConfig } from "./gemini-format";
import {
  estimateModelInputTokens,
  type ModelStreamEvent,
  type StreamTurnInput,
  streamModelTurn,
} from "./model-stream";
import { promptCachingPolicy, resolveProviderModelFamily } from "./prompt-caching";
import { replayProviderState, safeProviderState } from "./provider-native-state";
import { buildAuthHeaders, normalizeBaseUrl, ProviderService } from "./provider-service";

afterEach(() => vi.unstubAllGlobals());

function message(role: SessionMessage["role"], parts: MessagePart[]): SessionMessage {
  return { id: "message", sessionId: "session", seq: 1, role, parts, createdAt: "" };
}
function input(): StreamTurnInput {
  return {
    provider: {
      id: "provider",
      name: "Google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      protocol: "gemini_generate_content",
      authMode: "x_goog_api_key",
      customHeaderName: null,
      activeKeyId: null,
      keys: [],
      models: [],
      createdAt: "",
      updatedAt: "",
    },
    model: {
      id: "model",
      providerId: "provider",
      modelId: "gemini-3-flash-preview",
      displayName: "Gemini",
      contextWindow: 100000,
      maxOutputTokens: 8192,
      inputModalities: ["text", "image", "audio", "file"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: ["minimal", "high"],
      anthropicNoneBehavior: "disabled",
      enabled: true,
    },
    apiKey: "synthetic-gemini-key",
    systemPrompt: "Stable system prompt",
    messages: [message("user", [{ type: "text", text: "Inspect" }])],
    tools: [
      {
        name: "lookup",
        description: "Read",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
      },
    ],
    reasoningLevel: null,
    signal: new AbortController().signal,
  };
}
function chunk(parts: object[], finishReason?: string) {
  return {
    candidates: [
      { index: 0, content: { role: "model", parts }, ...(finishReason ? { finishReason } : {}) },
    ],
  };
}
const response = (...values: unknown[]) =>
  new Response(
    values
      .map((value) => `data: ${typeof value === "string" ? value : JSON.stringify(value)}\r\n\r\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
async function collect(value = input()) {
  const events: ModelStreamEvent[] = [];
  for await (const event of streamModelTurn(value)) events.push(event);
  return events;
}
function fixture(...values: unknown[]) {
  const fetcher = vi.fn(async () => response(...values));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const final = () => chunk([{ text: "Done", thoughtSignature: "final-signature" }], "STOP");
function nativeMessage(events: ModelStreamEvent[]) {
  return message(
    "assistant",
    events.flatMap<MessagePart>((event) =>
      event.type === "text_delta"
        ? [{ type: "text", text: event.text }]
        : event.type === "tool_call_started"
          ? [
              {
                type: "tool_call",
                callId: event.callId,
                name: event.name,
                status: "completed",
                arguments: (
                  events.find(
                    (item) => item.type === "tool_call_arguments" && item.index === event.index,
                  ) as Extract<ModelStreamEvent, { type: "tool_call_arguments" }>
                ).arguments,
              },
            ]
          : event.type === "provider_state"
            ? [{ type: "provider_state", state: event.state }]
            : [],
    ),
  );
}

describe("native Gemini wire and continuation", () => {
  it("sends native contents, JSON-schema tools, auth, thinking and sampling without foreign fields", async () => {
    const fetcher = fixture(chunk([{ text: "Thinking", thought: true }]), final(), {
      usageMetadata: {
        promptTokenCount: 100,
        cachedContentTokenCount: 80,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 7,
        totalTokenCount: 112,
      },
    });
    const value = {
      ...input(),
      reasoningLevel: "high",
      temperature: 0.5,
      topP: 0.8,
      toolChoice: "none" as const,
    };
    const events = await collect(value);
    const [url, options] = (fetcher.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse",
    );
    expect(options.headers).toMatchObject({
      "x-goog-api-key": value.apiKey,
      accept: "text/event-stream",
    });
    const body = JSON.parse(String(options.body));
    expect(body).toEqual({
      systemInstruction: { parts: [{ text: value.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: "Inspect" }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        candidateCount: 1,
        temperature: 0.5,
        topP: 0.8,
        thinkingConfig: { thinkingLevel: "HIGH", includeThoughts: true },
      },
      tools: [
        {
          functionDeclarations: [
            {
              ...value.tools[0],
              parameters: undefined,
              parametersJsonSchema: value.tools[0]?.parameters,
            },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
    });
    expect(events).toContainEqual({ type: "reasoning_delta", text: "Thinking" });
    expect(events.find((event) => event.type === "usage")).toMatchObject({
      inputTokens: 100,
      outputTokens: 12,
      cachedInputTokens: 80,
      totalTokens: 112,
    });
    expect(events.at(-1)?.type).toBe("provider_state");
  });

  it("preserves exact Part order, same-name calls, absent wire IDs and trailing empty signatures", async () => {
    const parts = [
      { text: "Plan", thought: true, thoughtSignature: "thought" },
      { functionCall: { name: "lookup", args: { path: "a" } }, thoughtSignature: "first" },
      { functionCall: { id: "wire-b", name: "lookup", args: { path: "b" } } },
    ];
    fixture(chunk(parts, "STOP"), chunk([{ text: "", thoughtSignature: "trailing" }]));
    const events = await collect();
    const assistant = nativeMessage(events);
    // ChatService combines text deltas; this turn contains only tool calls and thoughts.
    const state = events.find((event) => event.type === "provider_state");
    expect(state?.type).toBe("provider_state");
    if (state?.type !== "provider_state") throw new Error("Missing state");
    expect(state.state.payload.content).toEqual({
      role: "model",
      parts: [...parts, { text: "", thoughtSignature: "trailing" }],
    });
    const ids = events
      .filter((event) => event.type === "tool_call_started")
      .map((event) => event.callId);
    expect(new Set(ids).size).toBe(2);
    const fetcher = fixture(final());
    const value = input();
    value.messages.push(
      assistant,
      message("tool", [
        { type: "tool_result", callId: ids[1] ?? "", output: "B", isError: false },
        {
          type: "tool_result",
          callId: ids[0] ?? "",
          output: "A",
          isError: false,
          images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64," + "aGVsbG8=" }],
        },
      ]),
    );
    await collect(value);
    const options = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    const contents = JSON.parse(String(options.body)).contents;
    expect(contents[1]).toEqual(state.state.payload.content);
    expect(contents[2].parts.slice(0, 2)).toEqual([
      { functionResponse: { name: "lookup", response: { output: "A" } } },
      { functionResponse: { id: "wire-b", name: "lookup", response: { output: "B" } } },
    ]);
    expect(contents[2].parts[2]).toEqual({
      inlineData: { mimeType: "image/png", data: "aGVsbG8=" },
    });
    expect(JSON.stringify(contents)).not.toContain("gemini_");
    for (const modified of [
      { ...value.provider, id: "other" },
      { ...value.provider, baseUrl: "https://gateway.invalid/v1beta" },
      { ...value.provider, authMode: "bearer" as const },
      { ...value.provider, protocol: "openai_chat_completions" as const },
    ])
      expect(replayProviderState(assistant, modified, value.model)).toBeNull();
    expect(
      replayProviderState(assistant, value.provider, { ...value.model, modelId: "other" }),
    ).toBeNull();
    const edited = structuredClone(assistant);
    const call = edited.parts.find((part) => part.type === "tool_call");
    if (call?.type === "tool_call") call.arguments = '{"path":"changed"}';
    expect(replayProviderState(edited, value.provider, value.model)).toBeNull();
    expect(
      safeProviderState({
        ...state.state,
        payload: { ...state.state.payload, callIds: [ids[0], ids[0]] },
      }),
    ).toBeNull();
  });

  it.each([
    [chunk([{ functionCall: { name: "lookup", args: {} } }])],
    [chunk([{ functionCall: { name: "lookup", args: {} } }], "MAX_TOKENS")],
    [chunk([{ text: "Blocked" }], "SAFETY")],
    [chunk([{ functionCall: { name: "lookup", args: "invalid" } }], "STOP")],
    [chunk([{ inlineData: { mimeType: "image/png", data: "aA==" } }], "STOP")],
    [
      chunk(
        [
          { functionCall: { id: "same", name: "lookup" } },
          { functionCall: { id: "same", name: "lookup" } },
        ],
        "STOP",
      ),
    ],
    [{ promptFeedback: { blockReason: "SAFETY" } }],
    [{ error: { code: 503, message: "Unavailable" } }],
    ["malformed JSON"],
    [chunk([{ text: "Only thoughts", thought: true }], "STOP")],
    [chunk([{ text: "Done" }], "STOP"), chunk([{ text: "Unexpected" }])],
  ])(
    "does not save native state for incomplete, blocked or malformed streams %#",
    async (...values) => {
      fixture(...values);
      const events: ModelStreamEvent[] = [];
      await expect(
        (async () => {
          for await (const event of streamModelTurn(input())) events.push(event);
        })(),
      ).rejects.toThrow();
      expect(events.some((event) => event.type === "provider_state")).toBe(false);
    },
  );

  it("does not persist a cancelled response even when STOP was received", async () => {
    const controller = new AbortController();
    fixture(final());
    const events: ModelStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of streamModelTurn({ ...input(), signal: controller.signal })) {
          events.push(event);
          if (event.type === "text_delta") controller.abort();
        }
      })(),
    ).rejects.toThrow();
    expect(events.some((event) => event.type === "provider_state")).toBe(false);
  });

  it("estimates pending tool turns locally while rejecting an incomplete actual request", async () => {
    const value = input();
    const before = estimateModelInputTokens(value);
    value.messages.push(
      message("assistant", [
        {
          type: "tool_call",
          callId: "pending",
          name: "lookup",
          arguments: '{"path":"notes.txt"}',
          status: "pending",
        },
      ]),
    );
    expect(estimateModelInputTokens(value)).toBeGreaterThan(before);
    const fetcher = fixture(final());
    await expect(collect(value)).rejects.toThrow("unanswered functionCall");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends native PDF bytes when file input is enabled and preserves text fallback otherwise", async () => {
    const value = input();
    value.messages[0]?.parts.push({
      type: "attachment",
      attachment: {
        kind: "file",
        name: "fixture.pdf",
        mimeType: "application/pdf",
        size: 5,
        dataUrl: "data:application/pdf;base64,aGVsbG8=",
        extractedContent: {
          text: "Extracted PDF text",
          format: "PDF",
          warnings: [],
          truncated: false,
          parserVersion: 2,
          pdfMode: "native",
        },
      },
    });
    const fetcher = fixture(final());
    await collect(value);
    let options = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(options.body)).contents[0].parts[1]).toEqual({
      inlineData: { mimeType: "application/pdf", data: "aGVsbG8=" },
    });
    value.model = { ...value.model, inputModalities: ["text"] };
    const attachment = value.messages[0]?.parts.find((part) => part.type === "attachment");
    if (attachment?.type !== "attachment" || !attachment.attachment.extractedContent)
      throw new Error("Missing PDF");
    attachment.attachment.extractedContent.pdfMode = "ocr";
    await collect(value);
    options = (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(JSON.stringify(JSON.parse(String(options.body)).contents)).toContain(
      "Extracted PDF text",
    );
    expect(JSON.stringify(JSON.parse(String(options.body)).contents)).not.toContain("inlineData");
  });

  it("transmits native images/audio and estimates contents instead of ignoring native fields", async () => {
    const fetcher = fixture(final());
    const value = input();
    const before = estimateModelInputTokens(value);
    const parts = value.messages[0]?.parts;
    for (const [kind, mimeType] of [
      ["image", "image/png"],
      ["audio", "audio/wav"],
    ] as const)
      parts?.push({
        type: "attachment",
        attachment: {
          kind,
          name: kind,
          mimeType,
          size: 5,
          dataUrl: `data:${mimeType};base64,aGVsbG8=`,
        },
      });
    await collect(value);
    const options = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(options.body)).contents[0].parts).toEqual([
      { text: "Inspect" },
      { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
      { inlineData: { mimeType: "audio/wav", data: "aGVsbG8=" } },
    ]);
    expect(estimateModelInputTokens(value)).toBeGreaterThan(before + 3000);
    parts?.push({ type: "text", text: "x".repeat(10000) });
    expect(estimateModelInputTokens(value)).toBeGreaterThan(before + 5000);
  });

  it("uses hash-only native cache fingerprints with append-only histories", async () => {
    const value = input();
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return response(final());
      }),
    );
    await collect(value);
    value.messages.push(
      message("assistant", [{ type: "text", text: "Previous" }]),
      message("user", [{ type: "text", text: "Next" }]),
    );
    await collect(value);
    const fingerprint = (body: Record<string, unknown>) =>
      createWireCacheFingerprint({
        ...value,
        path: geminiModelPath(value.model.modelId),
        body,
      });
    const a = fingerprint(bodies[0] ?? {}),
      b = fingerprint(bodies[1] ?? {});
    expect(compareWireCacheFingerprints(a, b).change).toBe("append_only");
    expect(JSON.stringify(b)).not.toContain("Inspect");
    expect(JSON.stringify(b)).not.toContain(value.apiKey);
    expect(
      resolveProviderModelFamily({
        ...value.provider,
        promptCaching: { mode: "auto", ttl: "5m", modelFamily: "other" },
      }),
    ).toBe("gemini");
    expect(
      promptCachingPolicy({ ...value.provider, promptCaching: { mode: "openai", ttl: "5m" } }),
    ).toBe("implicit");
    expect(() =>
      validatePromptCachingSettings({ mode: "openai", ttl: "5m" }, "gemini_generate_content"),
    ).toThrow();
  });
});

describe("native Gemini provider management", () => {
  it.each([
    "https://generativelanguage.googleapis.com/v1beta",
    "http://127.0.0.1:1234/api/v1beta/",
    "https://gateway.invalid/v1",
  ])("accepts native base %s", (base) => {
    expect(normalizeBaseUrl(base, "gemini_generate_content")).toBe(base.replace(/\/$/, ""));
  });
  it.each([
    "https://gateway.invalid/v1beta/openai",
    "https://gateway.invalid/v1beta/models/a",
    "https://gateway.invalid/v1beta?key=private",
    "https://user:pass@gateway.invalid/v1beta",
  ])("rejects invalid native base %s", (base) => {
    expect(() => normalizeBaseUrl(base, "gemini_generate_content")).toThrow();
  });
  it("does not weaken URL rules for existing protocols", () => {
    expect(() => normalizeBaseUrl("https://gateway.invalid/v1beta", "openai_responses")).toThrow();
  });
  it("validates model paths and thinking without synthesizing unsupported budgets", () => {
    expect(geminiModelPath("models/gemini-2.5-flash", false)).toBe(
      "/models/gemini-2.5-flash:generateContent",
    );
    for (const id of ["../secret", "a/b", "model?key=x", "models/"])
      expect(() => geminiModelPath(id)).toThrow();
    expect(geminiThinkingConfig({ modelId: "gemini-2.5-flash" }, "none")).toEqual({
      thinkingBudget: 0,
    });
    expect(geminiThinkingConfig({ modelId: "gemini-2.5-pro" }, "auto")).toBeUndefined();
    expect(() => geminiThinkingConfig({ modelId: "gemini-2.5-pro" }, "none")).toThrow();
    expect(() => geminiThinkingConfig({ modelId: "gemini-2.5-flash" }, "high")).toThrow();
    expect(() => geminiThinkingConfig({ modelId: "gemini-3-pro-preview" }, "max")).toThrow();
    expect(buildAuthHeaders({ ...input().provider, apiKey: "synthetic" })).toEqual({
      "content-type": "application/json",
      "x-goog-api-key": "synthetic",
    });
  });
  it("discovers all generateContent models, tests native connection and edits auth in place", async () => {
    const db = openDatabase(":memory:");
    try {
      const repository = new Repository(db);
      const secrets = {
        read: () => "synthetic",
        remove: vi.fn(),
        store: () => {
          db.prepare("insert into secrets values('secret',x'1234','now')").run();
          return { secretRef: "secret", maskedHint: "***fixture" };
        },
      };
      const service = new ProviderService(repository, secrets as unknown as SecretStore);
      const created = service.createProvider({
        name: "Native",
        baseUrl: "https://fixture.invalid/v1beta",
        protocol: "gemini_generate_content",
        authMode: "x_goog_api_key",
        apiKey: "synthetic",
        keyLabel: "Key",
        neverReveal: true,
      });
      const fetcher = vi.fn(async (url: string) =>
        url.endsWith(":generateContent")
          ? Response.json({
              candidates: [
                {
                  content: { parts: [{ text: "hidden", thought: true }, { text: "OK" }] },
                  finishReason: "STOP",
                },
              ],
            })
          : url.includes("pageToken=")
            ? Response.json({
                models: [
                  { name: "models/second", supportedGenerationMethods: ["generateContent"] },
                ],
              })
            : Response.json({
                models: [
                  { name: "models/first", supportedGenerationMethods: ["generateContent"] },
                  { name: "models/embed", supportedGenerationMethods: ["embedContent"] },
                ],
                nextPageToken: "next page/+",
              }),
      );
      vi.stubGlobal("fetch", fetcher);
      expect((await service.fetchModels(created.id)).modelIds).toEqual(["first", "second"]);
      expect(fetcher.mock.calls[1]?.[0]).toBe(
        "https://fixture.invalid/v1beta/models?pageSize=1000&pageToken=next%20page%2F%2B",
      );
      service.createModel({
        providerId: created.id,
        modelId: "models/first",
        contextWindow: 10000,
        maxOutputTokens: 2000,
        inputModalities: ["text"],
        toolCalls: true,
        parallelToolCalls: true,
        reasoningLevels: [],
        anthropicNoneBehavior: "disabled",
      });
      const model = repository.getProvider(created.id)?.models[0];
      if (!model) throw new Error("Missing model");
      expect(await service.testConnection(created.id, model.id)).toMatchObject({
        ok: true,
        responseText: "OK",
        requestUrl: "https://fixture.invalid/v1beta/models/first:generateContent",
      });
      expect(() =>
        service.updateProvider(
          {
            providerId: created.id,
            name: created.name,
            baseUrl: created.baseUrl,
            protocol: created.protocol,
            authMode: "bearer",
          },
          true,
        ),
      ).toThrow("等待所有会话");
      const updated = service.updateProvider({
        providerId: created.id,
        name: created.name,
        baseUrl: created.baseUrl,
        protocol: created.protocol,
        authMode: "bearer",
      });
      expect(updated.authMode).toBe("bearer");
      expect(updated.models[0]?.id).toBe(model.id);
      expect(updated.keys).toEqual(created.keys);
      fetcher.mockImplementation(async () => Response.json({ models: [], nextPageToken: "same" }));
      await expect(service.fetchModels(created.id)).rejects.toThrow("分页重复");
      fetcher.mockImplementation(async () =>
        Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] }),
      );
      expect(await service.testConnection(created.id, model.id)).toMatchObject({
        ok: false,
        error: expect.stringContaining("完整文字"),
      });
    } finally {
      db.close();
    }
  });
});
