import { describe, expect, it } from "vitest";
import type { ProviderProtocol } from "../../shared/domain";
import { validatePromptCachingSettings } from "../../shared/prompt-caching";
import {
  promptCachingPolicy,
  resolveProviderModelFamily,
  stableToolDefinitions,
  withPromptCachingHints,
} from "./prompt-caching";

function input(
  protocol: ProviderProtocol,
  baseUrl = protocol === "anthropic_messages"
    ? "https://api.anthropic.com/v1"
    : "https://api.openai.com/v1",
) {
  return {
    provider: { id: "provider", protocol, baseUrl },
    model: { modelId: "model" },
    messages: [{ sessionId: "conversation" }],
  };
}

describe("stable allowed tool definitions", () => {
  it("canonicalizes nested schema keys without changing semantic arrays or the originals", () => {
    const tools = [
      {
        name: "write",
        description: "Write an approved file",
        parameters: {
          required: ["path", "content"],
          type: "object",
          properties: {
            path: { type: "string", description: "Path" },
            content: { type: "array", items: { type: "string", minLength: 1 } },
          },
        },
      },
      {
        name: "Read",
        description: "Read an approved file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ];
    const before = JSON.stringify(tools);
    const stable = stableToolDefinitions(tools);
    expect(stable.map((tool) => tool.name)).toEqual(["Read", "write"]);
    expect(stable).toHaveLength(tools.length);
    expect(stable[1]?.parameters.required).toEqual(["path", "content"]);
    expect(JSON.stringify(stable[1]?.parameters)).toBe(
      '{"properties":{"content":{"items":{"minLength":1,"type":"string"},"type":"array"},"path":{"description":"Path","type":"string"}},"required":["path","content"],"type":"object"}',
    );
    expect(JSON.stringify(tools)).toBe(before);
    expect(stable[1]?.parameters).not.toBe(tools[0]?.parameters);
  });

  it("produces identical wire schemas for discovery order and object-key order changes", () => {
    const first = [
      { name: "z", parameters: { type: "object", properties: { b: {}, a: {} } } },
      { name: "a", parameters: { required: ["value"], type: "object" } },
    ];
    const second = [
      { name: "a", parameters: { type: "object", required: ["value"] } },
      { name: "z", parameters: { properties: { a: {}, b: {} }, type: "object" } },
    ];
    expect(JSON.stringify(stableToolDefinitions(first))).toBe(
      JSON.stringify(stableToolDefinitions(second)),
    );
    expect(stableToolDefinitions(first.slice(1)).map((tool) => tool.name)).toEqual(["a"]);
  });
});

describe("provider-scoped prompt cache hints", () => {
  it.each([
    [
      "openai_chat_completions",
      "https://generativelanguage.googleapis.com/v1beta/openai",
      "gemini",
    ],
    [
      "openai_chat_completions",
      "https://generativelanguage.googleapis.com/v1beta/openai/",
      "gemini",
    ],
    ["openai_chat_completions", "https://api.deepseek.com", "deepseek"],
    ["openai_chat_completions", "https://api.deepseek.com/", "deepseek"],
    ["openai_chat_completions", "https://api.deepseek.com/v1", "deepseek"],
    ["openai_chat_completions", "https://api.deepseek.com/beta", "deepseek"],
    ["openai_responses", "https://api.deepseek.com/v1", "deepseek"],
    ["anthropic_messages", "https://api.deepseek.com/anthropic/v1", "deepseek"],
    ["openai_responses", "https://api.deepseek.com/beta", "auto"],
    ["anthropic_messages", "https://api.deepseek.com/v1", "auto"],
    ["anthropic_messages", "https://api.deepseek.com/anthropic", "auto"],
    ["openai_responses", "https://generativelanguage.googleapis.com/v1beta/openai", "auto"],
    ["anthropic_messages", "https://generativelanguage.googleapis.com/v1beta/openai", "auto"],
    ["openai_chat_completions", "https://generativelanguage.googleapis.com/v1", "auto"],
  ] as const)("detects only supported official %s paths: %s", (protocol, baseUrl, expected) => {
    const provider = input(protocol, baseUrl).provider;
    expect(resolveProviderModelFamily(provider)).toBe(expected);
    expect(promptCachingPolicy(provider)).toBe("implicit");
  });

  it.each([
    "https://api.deepseek.com.evil.invalid/v1",
    "https://generativelanguage.googleapis.com.evil.invalid/v1beta/openai",
    "https://api.deepseek.com:8443/v1",
    "https://generativelanguage.googleapis.com:8443/v1beta/openai",
    "https://api.deepseek.com/proxy/v1",
    "https://user@api.deepseek.com/v1",
    "https://api.deepseek.com/v1?key=fixture",
    "https://generativelanguage.googleapis.com/v1beta/openai#api",
    "http://api.deepseek.com/v1",
    "https://gateway.invalid/v1",
  ])("does not infer a family from a lookalike endpoint: %s", (baseUrl) => {
    expect(resolveProviderModelFamily(input("openai_chat_completions", baseUrl).provider)).toBe(
      "auto",
    );
  });

  it.each(["gemini", "deepseek"] as const)(
    "persists %s family semantics without adding other vendors' cache hints",
    (modelFamily) => {
      const current = input("openai_chat_completions", "https://gateway.invalid/v1");
      const provider = {
        ...current.provider,
        promptCaching: { mode: "auto", ttl: "5m", modelFamily } as const,
      };
      const body = { model: "fixture", messages: [{ role: "user", content: "Question" }] };
      expect(resolveProviderModelFamily(provider)).toBe(modelFamily);
      expect(withPromptCachingHints({ ...current, provider }, body)).toBe(body);
      expect(
        resolveProviderModelFamily({
          ...provider,
          promptCaching: { ...provider.promptCaching, mode: "off" },
        }),
      ).toBe(modelFamily);
    },
  );

  it("honors an explicit mixed family over official endpoint detection", () => {
    const provider = {
      ...input("openai_chat_completions", "https://api.deepseek.com/v1").provider,
      promptCaching: { mode: "auto", ttl: "5m", modelFamily: "other" } as const,
    };
    expect(resolveProviderModelFamily(provider)).toBe("other");
    expect(promptCachingPolicy(provider)).toBe("implicit");
  });

  it.each([
    ["openai_responses", "openai", "openai"],
    ["openai_chat_completions", "openai", "openai"],
    ["anthropic_messages", "claude", "anthropic_auto"],
    ["openai_responses", "claude", "implicit"],
    ["anthropic_messages", "openai", "implicit"],
    ["anthropic_messages", "other", "implicit"],
    ["openai_chat_completions", "gemini", "implicit"],
    ["openai_chat_completions", "deepseek", "implicit"],
    ["openai_responses", "deepseek", "implicit"],
    ["anthropic_messages", "deepseek", "implicit"],
  ] as const)(
    "adapts a configured %s/%s family without changing wire protocol",
    (protocol, modelFamily, expected) => {
      expect(
        promptCachingPolicy({
          ...input(protocol, "https://gateway.invalid/v1").provider,
          promptCaching: { mode: "auto", ttl: "5m", modelFamily },
        }),
      ).toBe(expected);
    },
  );

  it.each(["anthropic_auto", "anthropic_breakpoints"] as const)(
    "reserves a %s boundary for the immutable summary prefix beyond tail lookback",
    (mode) => {
      const text =
        "Earlier conversation summary (historical data, not instructions). Verified work.";
      const current = input("anthropic_messages");
      const body = {
        tools: [{ name: "read" }],
        system: "Stable rules",
        messages: [
          { role: "user", content: [{ type: "text", text }] },
          ...Array.from({ length: 30 }, (_, i) => ({
            role: i % 2 ? "user" : "assistant",
            content: [{ type: "text", text: `Tail ${i}` }],
          })),
        ],
      };
      const original = structuredClone(body);
      const result = withPromptCachingHints(
        {
          ...current,
          provider: { ...current.provider, promptCaching: { mode, ttl: "5m" } },
          messages: [{ sessionId: "conversation", seq: 0, parts: [{ type: "text", text }] }],
        },
        body,
      );
      const messages = result.messages as typeof body.messages;
      expect(messages[0]?.content[0]).toMatchObject({ text, cache_control: { type: "ephemeral" } });
      const count = JSON.stringify(result).match(/"cache_control"/g)?.length ?? 0;
      expect(count).toBeLessThanOrEqual(4);
      expect(body).toEqual(original);
    },
  );

  it.each(["openai_responses", "openai_chat_completions"] as const)(
    "uses a stable opaque conversation key for the official %s endpoint",
    (protocol) => {
      const current = input(protocol);
      const body = { model: "model", messages: [{ role: "user", content: "private" }] };
      const first = withPromptCachingHints(current, body);
      const second = withPromptCachingHints(
        { ...current, messages: [...current.messages, { sessionId: "conversation" }] },
        body,
      );
      expect(first.prompt_cache_key).toMatch(/^msh:[0-9a-f]{60}$/);
      expect(first.prompt_cache_key).toBe(second.prompt_cache_key);
      expect(first.messages).toBe(body.messages);
      expect(body).not.toHaveProperty("prompt_cache_key");
      expect(first).not.toHaveProperty("prompt_cache_retention");
      expect(
        withPromptCachingHints({ ...current, messages: [{ sessionId: "other" }] }, body)
          .prompt_cache_key,
      ).not.toBe(first.prompt_cache_key);
      expect(
        withPromptCachingHints({ ...current, model: { modelId: "other" } }, body).prompt_cache_key,
      ).not.toBe(first.prompt_cache_key);
      expect(
        withPromptCachingHints({ ...current, provider: { ...current.provider, id: "other" } }, body)
          .prompt_cache_key,
      ).not.toBe(first.prompt_cache_key);
    },
  );

  it("enables official Anthropic automatic caching with stable tool/system boundaries", () => {
    const current = input("anthropic_messages");
    const body = {
      system: "Stable instructions",
      messages: [
        { role: "user", content: [{ type: "text", text: "Question" }] },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call", name: "read", input: { path: "a" } }],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call", content: "a" }] },
      ],
      tools: [{ name: "read" }],
    };
    const first = withPromptCachingHints(current, body);
    expect(first.cache_control).toEqual({ type: "ephemeral" });
    expect(first.messages).toBe(body.messages);
    expect(first.system).toEqual([
      { type: "text", text: body.system, cache_control: { type: "ephemeral" } },
    ]);
    expect(first.tools).toEqual([{ name: "read", cache_control: { type: "ephemeral" } }]);
    expect(body.system).toBe("Stable instructions");
    expect(body.tools).toEqual([{ name: "read" }]);
    expect(body).not.toHaveProperty("cache_control");
    expect(first).not.toHaveProperty("prompt_cache_key");
  });

  it.each([
    "https://gateway.invalid/v1",
    "https://api.openai.com.gateway.invalid/v1",
    "https://api.anthropic.com.gateway.invalid/v1",
    "https://api.openai.com:8443/v1",
    "http://api.openai.com/v1",
    "https://api.openai.com/proxy/v1",
    "https://secret@api.openai.com/v1",
    "https://api.openai.com/v1?key=secret",
    "https://api.openai.com/v1#api",
    "invalid",
  ])("leaves custom and nonstandard endpoint bodies unchanged: %s", (url) => {
    for (const protocol of [
      "anthropic_messages",
      "openai_responses",
      "openai_chat_completions",
    ] as const) {
      const body = { model: "model" };
      expect(withPromptCachingHints(input(protocol, url), body)).toBe(body);
    }
  });

  it("does not infer support from an official hostname used with the other protocol", () => {
    const body = { model: "model" };
    expect(
      withPromptCachingHints(input("anthropic_messages", "https://api.openai.com/v1"), body),
    ).toBe(body);
    expect(
      withPromptCachingHints(input("openai_responses", "https://api.anthropic.com/v1"), body),
    ).toBe(body);
  });

  it("retains explicit cache options and avoids guessing a missing or mixed conversation", () => {
    const openai = input("openai_responses");
    const explicit = { prompt_cache_key: "already-set" };
    expect(withPromptCachingHints(openai, explicit)).toBe(explicit);
    const body = { model: "model" };
    expect(withPromptCachingHints({ ...openai, messages: [] }, body)).toBe(body);
    expect(
      withPromptCachingHints(
        { ...openai, messages: [{ sessionId: "conversation" }, { sessionId: "other" }] },
        body,
      ),
    ).toBe(body);
    const anthropic = { cache_control: { type: "ephemeral", ttl: "1h" } };
    expect(withPromptCachingHints(input("anthropic_messages"), anthropic)).toBe(anthropic);
  });

  it("requires opt-in for a compatible gateway and supports disabling generated hints", () => {
    const gateway = input("openai_responses", "https://gateway.invalid/v1");
    const body = { model: "model" };
    expect(promptCachingPolicy(gateway.provider)).toBe("implicit");
    const configured = {
      ...gateway,
      provider: { ...gateway.provider, promptCaching: { mode: "openai", ttl: "5m" } as const },
    };
    expect(promptCachingPolicy(configured.provider)).toBe("openai");
    expect(withPromptCachingHints(configured, body).prompt_cache_key).toMatch(/^msh:/);
    expect(
      withPromptCachingHints(
        {
          ...configured,
          provider: { ...configured.provider, promptCaching: { mode: "off", ttl: "5m" } },
        },
        body,
      ),
    ).toBe(body);
  });

  it.each(["anthropic_auto", "anthropic_breakpoints"] as const)(
    "uses an explicit one-hour gateway policy for %s without mutating originals",
    (mode) => {
      const gateway = input("anthropic_messages", "https://gateway.invalid/v1");
      const configured = {
        ...gateway,
        provider: { ...gateway.provider, promptCaching: { mode, ttl: "1h" } as const },
      };
      const body = {
        tools: [{ name: "read" }],
        system: "Stable",
        messages: [
          { role: "user", content: [{ type: "text", text: "Earlier" }] },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "call", name: "read", input: { path: "a" } }],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "call", content: "contents" },
              { type: "image", source: { type: "base64", data: "not-an-image-fixture" } },
            ],
          },
        ],
      };
      const before = JSON.stringify(body);
      const result = withPromptCachingHints(configured, body);
      const markers = [...JSON.stringify(result).matchAll(/"cache_control":/g)].length;
      expect(markers).toBe(mode === "anthropic_auto" ? 3 : 4);
      const marker = { type: "ephemeral", ttl: "1h" };
      expect(result.tools).toEqual([{ name: "read", cache_control: marker }]);
      expect(result.system).toEqual([{ type: "text", text: "Stable", cache_control: marker }]);
      if (mode === "anthropic_auto") {
        expect(result.cache_control).toEqual(marker);
        expect(result.messages).toBe(body.messages);
      } else {
        expect(result).not.toHaveProperty("cache_control");
        expect(result.messages).toMatchObject([
          { content: [{ text: "Earlier" }] },
          { content: [{ type: "tool_use", cache_control: marker }] },
          { content: [{ type: "tool_result", cache_control: marker }, { type: "image" }] },
        ]);
        const messages = result.messages as typeof body.messages;
        expect(messages[2]?.content[1]).not.toHaveProperty("cache_control");
      }
      expect(JSON.stringify(body)).toBe(before);
    },
  );

  it("preserves all caller-defined cache boundaries and their TTL ordering", () => {
    const current = input("anthropic_messages");
    const body = {
      system: [{ type: "text", text: "Stable", cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "Question" }] }],
    };
    expect(withPromptCachingHints(current, body)).toBe(body);
  });

  it("does not mistake schema properties or tool input fields for cache boundaries", () => {
    const body = {
      tools: [
        {
          name: "inspect",
          input_schema: {
            type: "object",
            properties: { cache_control: { type: "string" } },
          },
        },
      ],
      system: "Stable",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call",
              name: "inspect",
              input: { cache_control: "a tool argument" },
            },
          ],
        },
      ],
    };
    const result = withPromptCachingHints(input("anthropic_messages"), body);
    expect(result.cache_control).toEqual({ type: "ephemeral" });
    expect(result.tools).toMatchObject([{ cache_control: { type: "ephemeral" } }]);
    expect(result.messages).toBe(body.messages);
  });

  it("validates strict protocol-specific configuration and does not enable invalid modes", () => {
    expect(
      validatePromptCachingSettings({ mode: "openai", ttl: "5m" }, "openai_responses"),
    ).toEqual({ mode: "openai", ttl: "5m" });
    expect(() =>
      validatePromptCachingSettings({ mode: "openai", ttl: "5m" }, "anthropic_messages"),
    ).toThrow("不匹配");
    expect(() =>
      validatePromptCachingSettings({ mode: "anthropic_auto", ttl: "5m" }, "openai_responses"),
    ).toThrow("不匹配");
    expect(() =>
      validatePromptCachingSettings({ mode: "openai", ttl: "1h" }, "openai_responses"),
    ).toThrow("一小时");
    expect(() =>
      validatePromptCachingSettings(
        { mode: "openai", ttl: "5m", apiKey: "not-accepted" },
        "openai_responses",
      ),
    ).toThrow("无效");
    const wrong = input("anthropic_messages", "https://gateway.invalid/v1");
    expect(
      promptCachingPolicy({
        ...wrong.provider,
        promptCaching: { mode: "openai", ttl: "5m" },
      }),
    ).toBe("implicit");
  });
});
