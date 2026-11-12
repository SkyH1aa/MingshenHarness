import { describe, expect, it } from "vitest";
import type { SessionMessage } from "../../shared/domain";
import type { PreparedModelRequest } from "../providers/model-stream";
import {
  CompactionRequestCache,
  compactionSourceHash,
  isTextCompactionRequest,
} from "./compaction-request-cache";

function request(sessionId: string): PreparedModelRequest {
  const messages: SessionMessage[] = [
    {
      id: `${sessionId}-message`,
      sessionId,
      seq: 1,
      role: "user",
      createdAt: "2026-11-07T00:00:00.000Z",
      parts: [{ type: "text", text: "Preserve the real task" }],
    },
  ];
  return {
    provider: {
      id: "provider",
      name: "Fixture",
      protocol: "openai_responses",
      baseUrl: "https://fixture.invalid/v1",
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
      modelId: "fixture",
      displayName: "Fixture",
      contextWindow: 20000,
      maxOutputTokens: 2048,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: false,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
      enabled: true,
    },
    messages,
    systemPrompt: "Fixed instructions",
    tools: [],
    reasoningLevel: null,
  };
}

describe("compaction request snapshots", () => {
  it("keeps only eight recent sessions and a two MiB aggregate bound", () => {
    const cache = new CompactionRequestCache();
    for (let index = 0; index < 9; index++) {
      const current = request(`session-${index}`);
      cache.capture(`session-${index}`, current, current.messages, "config");
    }
    expect(cache.matching("session-0", request("session-0").messages, "config")).toBeNull();
    expect(cache.matching("session-8", request("session-8").messages, "config")).not.toBeNull();
    for (let index = 0; index < 3; index++) {
      const current = request(`large-${index}`);
      current.systemPrompt = "x".repeat(800000);
      cache.capture(`large-${index}`, current, current.messages, "config");
    }
    expect(cache.matching("large-0", request("large-0").messages, "config")).toBeNull();
    expect(cache.matching("large-2", request("large-2").messages, "config")).not.toBeNull();
    const oversized = request("oversized");
    oversized.systemPrompt = "x".repeat(2 * 1024 * 1024);
    cache.capture("oversized", oversized, oversized.messages, "config");
    expect(cache.matching("oversized", oversized.messages, "config")).toBeNull();
  });

  it("clones snapshots and returns, excludes transport credentials, and clears on deletion", () => {
    const cache = new CompactionRequestCache();
    const current = request("session");
    const input = { ...current, apiKey: "never-copy-this-credential" };
    cache.capture("session", input, current.messages, "config");
    current.systemPrompt = "Changed after capture";
    const matching = cache.matching("session", current.messages, "config");
    expect(matching?.request.systemPrompt).toBe("Fixed instructions");
    expect(JSON.stringify(matching)).not.toContain("never-copy-this-credential");
    if (!matching) throw new Error("Missing snapshot");
    matching.request.systemPrompt = "Changed return";
    expect(cache.matching("session", current.messages, "config")?.request.systemPrompt).toBe(
      "Fixed instructions",
    );
    cache.delete("session");
    expect(cache.matching("session", current.messages, "config")).toBeNull();
  });

  it("matches model-relevant source prefixes and ignores UI-only parts", () => {
    const cache = new CompactionRequestCache();
    const current = request("session");
    cache.capture("session", current, current.messages, "config");
    const first = current.messages[0];
    if (!first) throw new Error("Missing source");
    const source = [
      { ...first, parts: [...first.parts, { type: "reasoning" as const, text: "UI" }] },
    ];
    expect(cache.matching("session", source, "config")?.prefixLength).toBe(1);
    expect(cache.matching("session", source, "changed")).toBeNull();
    source[0] = { ...first, parts: [{ type: "text", text: "Rewritten source" }] };
    expect(cache.matching("session", source, "config")).toBeNull();
  });

  it("includes Responses payload, phase and provider/model scope in source fingerprints", () => {
    const cache = new CompactionRequestCache();
    const current = request("session");
    const first = current.messages[0];
    if (!first) throw new Error("Missing fixture source.");
    first.parts.push({
      type: "responses_state",
      providerId: "provider",
      modelId: "model",
      endpointKey: "fixture-endpoint",
      items: [
        { type: "reasoning", encrypted_content: "opaque-fixture" },
        { type: "message", role: "assistant", phase: "commentary", content: [] },
      ],
    });
    cache.capture("session", current, current.messages, "config");
    expect(cache.matching("session", current.messages, "config")).not.toBeNull();
    const originalHash = compactionSourceHash(first);
    const state = first.parts.find((part) => part.type === "responses_state");
    if (state?.type !== "responses_state") throw new Error("Missing fixture state.");
    state.items[0] = { type: "reasoning", encrypted_content: "changed-opaque-fixture" };
    expect(compactionSourceHash(first)).not.toBe(originalHash);
    expect(cache.matching("session", current.messages, "config")).toBeNull();
    const payloadHash = compactionSourceHash(first);
    state.items[1] = {
      type: "message",
      role: "assistant",
      phase: "final_answer",
      content: [],
    };
    expect(compactionSourceHash(first)).not.toBe(payloadHash);
    const phaseHash = compactionSourceHash(first);
    state.modelId = "other-model";
    expect(compactionSourceHash(first)).not.toBe(phaseHash);
    const modelHash = compactionSourceHash(first);
    state.endpointKey = "different-endpoint";
    expect(compactionSourceHash(first)).not.toBe(modelHash);
  });

  it("rejects tool image requests as non-text and fingerprints image changes", () => {
    const cache = new CompactionRequestCache();
    const current = request("session");
    const first = current.messages[0];
    if (!first) throw new Error("Missing fixture source.");
    const image = { mimeType: "image/png", dataUrl: "data:image/png;base64,FIRST" };
    first.parts.push({
      type: "tool_result",
      callId: "image",
      output: "Visual evidence",
      isError: false,
      images: [image],
    });
    expect(isTextCompactionRequest(current)).toBe(false);
    const original = compactionSourceHash(first);
    image.dataUrl = "data:image/png;base64,SECOND";
    expect(compactionSourceHash(first)).not.toBe(original);
    cache.capture("session", current, current.messages, "config");
    expect(cache.matching("session", current.messages, "config")).toBeNull();
  });

  it("invalidates native provider payload and scope edits in compaction snapshots", () => {
    const cache = new CompactionRequestCache();
    const current = request("session");
    const first = current.messages[0];
    if (!first) throw new Error("Missing fixture source");
    const state = {
      family: "gemini" as const,
      protocol: "openai_chat_completions" as const,
      providerId: "provider",
      modelId: "model",
      endpointKey: "fixture-endpoint",
      payload: {
        role: "assistant",
        content: "Answer",
        extra_content: { google: { thought_signature: "native-signature" } },
      },
    };
    first.parts.push({ type: "provider_state", state });
    cache.capture("session", current, current.messages, "configuration");
    expect(cache.matching("session", current.messages, "configuration")).not.toBeNull();
    const originalHash = compactionSourceHash(first);
    state.payload.extra_content.google.thought_signature = "changed-signature";
    expect(compactionSourceHash(first)).not.toBe(originalHash);
    expect(cache.matching("session", current.messages, "configuration")).toBeNull();
    const changedHash = compactionSourceHash(first);
    state.endpointKey = "different-account-endpoint";
    expect(compactionSourceHash(first)).not.toBe(changedHash);
  });

  it.each([
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/pdf",
  ])("does not clone attachments even when extracted text is available: %s", (mimeType) => {
    const cache = new CompactionRequestCache();
    const current = request("session");
    current.messages[0]?.parts.push({
      type: "attachment",
      attachment: {
        name: "document",
        mimeType,
        kind: "file",
        size: 3,
        dataUrl: "data:application/octet-stream;base64,AQID",
        extractedContent: {
          text: "Already extracted",
          format: "text",
          warnings: [],
          truncated: false,
        },
      },
    });
    cache.capture("session", current, current.messages, "config");
    expect(cache.matching("session", current.messages, "config")).toBeNull();
  });

  it("rejects binary, mismatched, and cross-session snapshots", () => {
    const cache = new CompactionRequestCache();
    for (const reason of ["binary", "id", "session"]) {
      const current = request("session");
      const source = structuredClone(current.messages);
      const first = current.messages[0];
      if (!first) throw new Error("Missing source");
      if (reason === "id") first.id = "different";
      if (reason === "session") first.sessionId = "other";
      if (reason === "binary")
        first.parts.push({
          type: "attachment",
          attachment: {
            name: "image.png",
            mimeType: "image/png",
            kind: "image",
            size: 3,
            dataUrl: "data:image/png;base64,Zm9v",
          },
        });
      cache.capture("session", current, source, "config");
      expect(cache.matching("session", source, "config")).toBeNull();
    }
  });
});
