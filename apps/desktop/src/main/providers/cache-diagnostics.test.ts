import { describe, expect, it } from "vitest";
import {
  compareWireCacheFingerprints,
  createWireCacheFingerprint,
  readCacheDiagnostics,
  recordCacheDiagnostic,
} from "./cache-diagnostics";

const base = () => ({
  provider: {
    id: "provider-fixture",
    protocol: "openai_responses" as const,
    baseUrl: "https://gateway.example/v1",
    authMode: "bearer",
  },
  model: { modelId: "fixture-model" },
  apiKey: "private-fixture-key",
  path: "/responses",
  body: {
    model: "fixture-model",
    instructions: "Keep the user's constraints.",
    tools: [{ type: "function", name: "read", parameters: { type: "object" } }],
    input: [{ role: "user", content: "Review the payment function." }],
    max_output_tokens: 1000,
  } as Record<string, unknown>,
});
const fingerprint = (body: Record<string, unknown>) =>
  createWireCacheFingerprint({ ...base(), body });

function repository() {
  const settings = new Map<string, unknown>();
  return {
    getSetting: (key: string) => settings.get(key) ?? null,
    setSetting: (key: string, value: unknown) => {
      settings.set(key, value);
    },
    settings,
  };
}

describe("actual request cache diagnostics", () => {
  it("establishes a baseline without claiming that the supplier cache was cold", () => {
    const current = createWireCacheFingerprint(base());
    expect(compareWireCacheFingerprints(null, current)).toMatchObject({
      change: "first_observation",
      previousBlocks: 0,
      currentBlocks: 2,
    });
  });

  it("classifies unchanged retransmissions and append-only responses history", () => {
    const input = base();
    const before = createWireCacheFingerprint(input);
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input))).toMatchObject({
      change: "unchanged",
      matchedBlocks: 2,
    });
    input.body.input = [
      ...(input.body.input as unknown[]),
      { role: "assistant", content: "I will inspect it." },
      { type: "function_call", call_id: "read-1", name: "read", arguments: "{}" },
      { type: "function_call_output", call_id: "read-1", output: "payment source" },
    ];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input))).toMatchObject({
      change: "append_only",
      matchedBlocks: 2,
    });
  });

  it("recognizes merged Anthropic user blocks growing without rewriting old content", () => {
    const input = {
      ...base(),
      provider: { ...base().provider, protocol: "anthropic_messages" as const },
      path: "/messages",
      body: {
        model: "fixture-model",
        system: [{ type: "text", text: "Stable system" }],
        messages: [
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "read-1", content: "Original result" }],
          },
        ],
      } as Record<string, unknown>,
    };
    const before = createWireCacheFingerprint(input);
    input.body.messages = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "read-1", content: "Original result" },
          { type: "text", text: "The plan has changed." },
        ],
      },
    ];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input))).toMatchObject({
      change: "append_only",
      matchedBlocks: 2,
      currentBlocks: 3,
    });
  });

  it("separates intentional moving cache markers from content changes", () => {
    const input = {
      ...base(),
      provider: { ...base().provider, protocol: "anthropic_messages" as const },
      path: "/messages",
      body: {
        model: "fixture-model",
        system: [{ type: "text", text: "Stable system" }],
        tools: [{ name: "read", input_schema: { type: "object" } }],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Earlier content", cache_control: { type: "ephemeral" } },
              { type: "text", text: "Latest content" },
            ],
          },
        ],
      } as Record<string, unknown>,
    };
    const before = createWireCacheFingerprint(input);
    input.body.messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Earlier content" },
          { type: "text", text: "Latest content", cache_control: { type: "ephemeral" } },
        ],
      },
    ];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input))).toMatchObject({
      change: "unchanged",
      cachePolicyChanged: true,
    });
    input.body.tools = [
      {
        name: "read",
        input_schema: { type: "object" },
        cache_control: { type: "ephemeral" },
      },
    ];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input)).change).toBe(
      "unchanged",
    );
  });

  it("does not strip an input field named cache_control from actual tool arguments", () => {
    const input = {
      ...base(),
      provider: { ...base().provider, protocol: "anthropic_messages" as const },
      path: "/messages",
      body: {
        model: "fixture-model",
        system: "Stable system",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "configure",
                input: { cache_control: "first-value" },
              },
            ],
          },
        ],
      } as Record<string, unknown>,
    };
    const before = createWireCacheFingerprint(input);
    input.body.messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "configure",
            input: { cache_control: "changed-value" },
          },
        ],
      },
    ];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input)).change).toBe(
      "history",
    );
  });

  it("distinguishes system text changes in Chat Completions from conversation changes", () => {
    const input = {
      ...base(),
      provider: { ...base().provider, protocol: "openai_chat_completions" as const },
      path: "/chat/completions",
      body: {
        model: "fixture-model",
        messages: [
          { role: "system", content: "Stable policy" },
          { role: "user", content: "The user request" },
        ],
      } as Record<string, unknown>,
    };
    const before = createWireCacheFingerprint(input);
    input.body.messages = [
      { role: "system", content: "New policy" },
      { role: "user", content: "The user request" },
    ];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input)).change).toBe(
      "system",
    );
  });

  it.each([
    ["provider", (input: ReturnType<typeof base>) => (input.provider.id = "different-provider")],
    [
      "protocol",
      (input: ReturnType<typeof base>) =>
        Object.assign(input.provider, { protocol: "openai_chat_completions" }),
    ],
    [
      "endpoint",
      (input: ReturnType<typeof base>) => (input.provider.baseUrl = "https://other.example/v1"),
    ],
    ["model", (input: ReturnType<typeof base>) => (input.body.model = "other-model")],
    [
      "authentication",
      (input: ReturnType<typeof base>) => (input.apiKey = "other-private-fixture"),
    ],
    ["tools", (input: ReturnType<typeof base>) => (input.body.tools = [])],
    [
      "system",
      (input: ReturnType<typeof base>) => (input.body.instructions = "Changed instructions"),
    ],
  ])("reports %s as the earliest differing structural section", (expected, mutate) => {
    const input = base();
    const before = createWireCacheFingerprint(input);
    mutate(input);
    input.body.input = [{ role: "user", content: "Also changed history" }];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input)).change).toBe(
      expected,
    );
  });

  it("reports output and reasoning settings separately without assuming prefix invalidation", () => {
    const input = base();
    const before = createWireCacheFingerprint(input);
    input.body.max_output_tokens = 800;
    input.body.reasoning = { effort: "high" };
    input.body.tool_choice = "none";
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input))).toMatchObject({
      change: "unchanged",
      settingsChanged: true,
    });
  });

  it("finds the first changed block and recognizes an identical truncated prefix", () => {
    const input = base();
    input.body.input = [
      { role: "user", content: "First request" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second request" },
    ];
    const before = createWireCacheFingerprint(input);
    input.body.input = [
      { role: "user", content: "First request" },
      { role: "assistant", content: "Changed answer" },
      { role: "user", content: "Second request" },
    ];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input))).toMatchObject({
      change: "history",
      matchedBlocks: 3,
    });
    input.body.input = [{ role: "user", content: "First request" }];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input))).toMatchObject({
      change: "history_truncated",
      matchedBlocks: 2,
    });
  });

  it("bounds stored blocks and declines to claim that an untracked suffix is append-only", () => {
    const input = base();
    input.body.input = Array.from({ length: 1500 }, (_, index) => ({
      role: "user",
      content: `item-${index}`,
    }));
    const before = createWireCacheFingerprint(input);
    expect(before.history).toHaveLength(2048);
    expect(before.historyBlocks).toBe(3000);
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input)).change).toBe(
      "unchanged",
    );
    input.body.input = [...(input.body.input as unknown[]), { role: "user", content: "new" }];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input)).change).toBe(
      "comparison_limit",
    );
  });

  it("does not misclassify changed untracked suffixes as a proven truncated prefix", () => {
    const input = base();
    const messages = Array.from({ length: 1500 }, (_, index) => ({
      role: "user",
      content: `item-${index}`,
    }));
    input.body.input = messages;
    const before = createWireCacheFingerprint(input);
    input.body.input = [
      ...messages.slice(0, 1249),
      { role: "user", content: "Changed beyond the tracked prefix" },
    ];
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input))).toMatchObject({
      change: "comparison_limit",
      matchedBlocks: 2048,
      previousBlocks: 3000,
      currentBlocks: 2500,
    });
    input.body.input = messages.slice(0, 1024);
    expect(compareWireCacheFingerprints(before, createWireCacheFingerprint(input))).toMatchObject({
      change: "history_truncated",
      matchedBlocks: 2048,
      currentBlocks: 2048,
    });
  });

  it("resets comparison after a new process epoch instead of comparing unrelated HMACs", () => {
    const current = createWireCacheFingerprint(base());
    const previous = { ...current, epoch: "0".repeat(32) };
    expect(compareWireCacheFingerprints(previous, current)).toMatchObject({
      change: "process_restart",
      matchedBlocks: 0,
    });
  });

  it("stores no plaintext request, endpoint, key, tool name, or path", () => {
    const input = base();
    input.body.input = [{ role: "user", content: "C:\\Private\\confidential-workspace" }];
    const output = JSON.stringify(createWireCacheFingerprint(input));
    for (const secret of [
      input.apiKey,
      input.provider.id,
      input.provider.baseUrl,
      input.model.modelId,
      "private",
      "constraints",
      "confidential",
      "parameters",
    ])
      expect(output.toLowerCase()).not.toContain(secret.toLowerCase());
  });

  it("keeps per-purpose baselines and unknown/zero/partial cache outcomes distinct", () => {
    const repo = repository();
    const current = createWireCacheFingerprint(base());
    recordCacheDiagnostic(repo, "session", "agent", current, {
      inputTokens: 100,
      cachedInputTokens: null,
    });
    expect(readCacheDiagnostics(repo, "session").agent).toMatchObject({
      change: "first_observation",
      cacheOutcome: "unknown",
      cachedInputTokens: null,
    });
    recordCacheDiagnostic(repo, "session", "compaction", current, {
      inputTokens: 100,
      cachedInputTokens: 90,
    });
    recordCacheDiagnostic(repo, "session", "agent", current, {
      inputTokens: 100,
      cachedInputTokens: 0,
    });
    expect(readCacheDiagnostics(repo, "session")).toMatchObject({
      agent: { change: "unchanged", cacheOutcome: "none", cachedInputTokens: 0 },
      compaction: { change: "first_observation", cacheOutcome: "partial", cachedInputTokens: 90 },
    });
    recordCacheDiagnostic(repo, "session", "title", current, {
      inputTokens: 100,
      cachedInputTokens: 100,
    });
    expect(readCacheDiagnostics(repo, "session").title?.cacheOutcome).toBe("full");
  });

  it("rejects impossible measured counts and corrupted saved state without losing the request", () => {
    const repo = repository();
    repo.settings.set("tokenSaver.cache.session", { version: 99, plaintext: "ignored" });
    expect(readCacheDiagnostics(repo, "session")).toEqual({});
    const current = fingerprint(base().body);
    recordCacheDiagnostic(repo, "session", "agent", current, {
      inputTokens: 50,
      cachedInputTokens: 100,
    });
    expect(readCacheDiagnostics(repo, "session").agent).toMatchObject({
      change: "first_observation",
      cacheOutcome: "unknown",
      cachedInputTokens: null,
    });
    recordCacheDiagnostic(repo, "session", "agent", current, {
      inputTokens: Number.NaN,
      cachedInputTokens: 0,
    });
    expect(readCacheDiagnostics(repo, "session").agent?.inputTokens).toBeNull();
  });
});
