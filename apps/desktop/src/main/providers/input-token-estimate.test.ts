import { describe, expect, it } from "vitest";
import type { ProviderProtocol, ResponsesStateItem, SessionMessage } from "../../shared/domain";
import { ContextCompactionService } from "../chat/context-compaction-service";
import { SessionService } from "../sessions/session-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { estimateModelInputTokens, type StreamTurnInput } from "./model-stream";
import type { ProviderService } from "./provider-service";
import { responsesEndpointKey } from "./responses-state";

function input(protocol: ProviderProtocol = "openai_responses"): StreamTurnInput {
  return {
    provider: {
      id: "provider",
      name: "Estimate fixture",
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
      id: "model",
      providerId: "provider",
      modelId: "estimate-fixture",
      displayName: "Estimate fixture",
      contextWindow: 200000,
      maxOutputTokens: 2048,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
      enabled: true,
    },
    messages: [message("user", [{ type: "text", text: "Continue the task." }])],
    systemPrompt: "Preserve the user's constraints.",
    apiKey: "",
    tools: [],
    reasoningLevel: null,
    signal: new AbortController().signal,
  };
}

function message(role: SessionMessage["role"], parts: SessionMessage["parts"]): SessionMessage {
  return { id: `message-${role}`, sessionId: "session", seq: 1, role, parts, createdAt: "" };
}

function nativeHistory(
  value: StreamTurnInput,
  encrypted: string,
  count = 1,
  type: "reasoning" | "compaction" = "reasoning",
  summary = "",
) {
  const items: ResponsesStateItem[] = Array.from({ length: count }, (_, index) => ({
    type,
    id: `opaque-${index}`,
    encrypted_content: encrypted,
    ...(type === "reasoning"
      ? { summary: summary ? [{ type: "summary_text", text: summary }] : [] }
      : {}),
  }));
  items.push({
    type: "message",
    role: "assistant",
    phase: "final_answer",
    content: [{ type: "output_text", text: "Saved.", annotations: [] }],
  });
  value.messages.push(
    message("assistant", [
      { type: "text", text: "Saved." },
      {
        type: "responses_state",
        providerId: value.provider.id,
        modelId: value.model.modelId,
        endpointKey: responsesEndpointKey(value.provider.baseUrl),
        items,
      },
    ]),
  );
}

describe("wire input token estimates for opaque state and binary images", () => {
  it.each(["reasoning", "compaction"] as const)(
    "does not tokenize %s ciphertext bytes as ordinary visible text",
    (type) => {
      const small = input();
      nativeHistory(small, "opaque", 1, type);
      const large = input();
      nativeHistory(large, "X".repeat(4 * 1024 * 1024), 1, type);
      expect(estimateModelInputTokens(large)).toBe(estimateModelInputTokens(small));
      expect(estimateModelInputTokens(large)).toBeGreaterThan(1024);
      expect(estimateModelInputTokens(large)).toBeLessThan(2000);
    },
  );

  it.each([200000, 20000])(
    "bounds aggregate unknown-state reserves for a %i-token model window",
    (window) => {
      const small = input();
      small.model.contextWindow = window;
      nativeHistory(small, "opaque", 64);
      const large = input();
      large.model.contextWindow = window;
      nativeHistory(large, "X".repeat(64000), 64);
      const estimate = estimateModelInputTokens(large);
      expect(estimate).toBe(estimateModelInputTokens(small));
      // Include ordinary per-item metadata beyond the bounded opaque reserve.
      expect(estimate).toBeLessThan(Math.min(8192, window * 0.05) + 3000);
      expect(estimate).toBeLessThan(window * 0.85);
    },
  );

  it("continues counting visible native summaries and real prose", () => {
    const short = input();
    nativeHistory(short, "opaque");
    const long = input();
    nativeHistory(long, "opaque", 1, "reasoning", "Known visible facts. ".repeat(1500));
    expect(estimateModelInputTokens(long) - estimateModelInputTokens(short)).toBeGreaterThan(8000);

    const prose = input();
    prose.messages.push(
      message("user", [
        { type: "text", text: JSON.stringify({ encrypted_content: "X".repeat(50000) }) },
      ]),
    );
    expect(estimateModelInputTokens(prose)).toBeGreaterThan(14000);
  });

  it("does not reserve native-state tokens after provider scope invalidates replay", () => {
    const value = input();
    nativeHistory(value, "X".repeat(4 * 1024 * 1024));
    const state = value.messages[1]?.parts.find((part) => part.type === "responses_state");
    if (state?.type !== "responses_state") throw new Error("Missing estimate fixture state");
    state.providerId = "different-provider";
    const ordinary = input();
    ordinary.messages.push(message("assistant", [{ type: "text", text: "Saved." }]));
    expect(estimateModelInputTokens(value)).toBe(estimateModelInputTokens(ordinary));
  });

  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "does not count image base64 transport bytes as prose for %s",
    (protocol) => {
      const withImage = (bytes: number) => {
        const value = input(protocol);
        value.messages.push(
          message("assistant", [
            {
              type: "tool_call",
              callId: "image",
              name: "view_image",
              arguments: '{"path":"capture.png"}',
              status: "completed",
            },
          ]),
          message("tool", [
            {
              type: "tool_result",
              callId: "image",
              output: "Capture.",
              isError: false,
              images: [
                {
                  mimeType: "image/png",
                  dataUrl: `data:image/png;base64,${Buffer.alloc(bytes).toString("base64")}`,
                },
              ],
            },
          ]),
        );
        return value;
      };
      const small = estimateModelInputTokens(withImage(32));
      const large = estimateModelInputTokens(withImage(4 * 1024 * 1024));
      expect(large).toBe(small);
      expect(large).toBeGreaterThan(1600);
      expect(large).toBeLessThan(2200);
    },
  );

  it("keeps actual provider usage authoritative when real context pressure is higher", () => {
    const db = openDatabase(":memory:");
    try {
      const repository = new Repository(db);
      const value = input();
      value.provider = repository.insertProvider({
        name: value.provider.name,
        baseUrl: value.provider.baseUrl,
        protocol: value.provider.protocol,
        authMode: "bearer",
        customHeaderName: null,
      });
      repository.insertModel({ ...value.model, providerId: value.provider.id });
      const model = repository.getProvider(value.provider.id)?.models[0];
      if (!model) throw new Error("Missing estimate fixture model");
      value.model = model;
      const session = new SessionService(repository).create({
        title: "Native context estimate",
        workspacePath: null,
        providerId: value.provider.id,
        modelId: model.id,
        permissionMode: "request_approval",
        reasoningLevel: null,
      });
      nativeHistory(value, "X".repeat(4 * 1024 * 1024));
      for (const entry of value.messages)
        repository.appendMessage({ sessionId: session.id, role: entry.role, parts: entry.parts });
      const service = new ContextCompactionService(
        repository,
        {} as ProviderService,
        "",
        () => undefined,
      );
      const context = { ...value, session, runId: "estimate-only" };
      service.recordResponse(context, { inputTokens: null, outputTokens: null });
      expect(service.state(session.id)?.usedTokens).toBeLessThan(model.contextWindow * 0.85);
      service.recordResponse(context, { inputTokens: 190000, outputTokens: 1000 });
      expect(service.state(session.id)).toMatchObject({
        usedTokens: 191000,
        source: "provider",
      });
      expect(service.state(session.id)?.usedTokens).toBeGreaterThan(model.contextWindow * 0.85);
    } finally {
      db.close();
    }
  });
});
