import { describe, expect, it } from "vitest";
import type { ManagedPolicyService } from "../policy/managed-policy-service";
import {
  buildAuthHeaders,
  extractResponseText,
  extractUsage,
  normalizeBaseUrl,
  ProviderService,
  parseModelIds,
} from "./provider-service";

describe("normalizeBaseUrl", () => {
  it("accepts a v1 endpoint and removes trailing slashes", () => {
    expect(normalizeBaseUrl("https://example.com/api/v1///")).toBe("https://example.com/api/v1");
  });

  it("accepts localhost endpoints", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/v1");
  });

  it("rejects endpoints without v1", () => {
    expect(() => normalizeBaseUrl("https://example.com/api")).toThrow("/v1");
  });

  it("requires an OpenAI Images base URL at v1 instead of an image endpoint", () => {
    expect(normalizeBaseUrl("https://api.example.com/v1///", "openai_images")).toBe(
      "https://api.example.com/v1",
    );
    expect(() =>
      normalizeBaseUrl("https://api.example.com/v1/images/generations", "openai_images"),
    ).toThrow("不要包含 /images/generations 或 /images/edits");
    expect(() =>
      normalizeBaseUrl("https://api.example.com/v1/images/edits/", "openai_images"),
    ).toThrow("不要包含 /images/generations 或 /images/edits");
    expect(() => normalizeBaseUrl("https://api.example.com", "openai_images")).toThrow(
      "必须以 /v1 结尾",
    );
  });

  it("rejects embedded credentials and query strings", () => {
    expect(() => normalizeBaseUrl("https://user:pass@example.com/v1")).toThrow("用户名或密码");
    expect(() => normalizeBaseUrl("https://example.com/v1?key=secret")).toThrow("查询参数");
  });
});

describe("buildAuthHeaders", () => {
  it("uses the protocol-appropriate Anthropic default", () => {
    expect(
      buildAuthHeaders({
        baseUrl: "https://example.com/v1",
        protocol: "anthropic_messages",
        authMode: "x_api_key",
        customHeaderName: null,
        apiKey: "test-key",
      }),
    ).toEqual({
      "content-type": "application/json",
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
  });

  it("supports custom headers", () => {
    expect(
      buildAuthHeaders({
        baseUrl: "https://example.com/v1",
        protocol: "openai_responses",
        authMode: "custom",
        customHeaderName: "x-gateway-key",
        apiKey: "test-key",
      })["x-gateway-key"],
    ).toBe("test-key");
  });
});

describe("managed policy model request hook", () => {
  it("checks provider, provider.request and network.request before the request", async () => {
    const service = new ProviderService({} as never, {} as never);
    const calls: string[] = [];
    service.setManagedPolicy({
      assertProvider(providerId: string, modelId?: string, options?: { approved?: boolean }) {
        calls.push(`provider:${providerId}/${modelId}:${String(options?.approved)}`);
      },
      assertCapability(capability: string, options?: { approved?: boolean }) {
        calls.push(`${capability}:${String(options?.approved)}`);
      },
    } as unknown as ManagedPolicyService);

    await service.managedPolicyRequestHook({ approved: true })?.(
      { id: "provider" } as never,
      { id: "model" } as never,
    );

    expect(calls).toEqual([
      "provider:provider/model:true",
      "provider.request:true",
      "network.request:true",
    ]);
  });
});

describe("remote model parsing", () => {
  it("accepts data, models and raw array shapes", () => {
    expect(parseModelIds({ data: [{ id: "b" }, { id: "a" }, { id: "a" }] })).toEqual(["a", "b"]);
    expect(parseModelIds({ models: [{ name: "model-a" }] })).toEqual(["model-a"]);
    expect(parseModelIds(["x", { model: "y" }])).toEqual(["x", "y"]);
  });
});

describe("response extraction", () => {
  it("reads Anthropic, Responses and Chat Completions shapes", () => {
    expect(extractResponseText({ content: [{ type: "text", text: "anthropic" }] })).toBe(
      "anthropic",
    );
    expect(
      extractResponseText({
        output: [{ content: [{ type: "output_text", text: "responses" }] }],
      }),
    ).toBe("responses");
    expect(extractResponseText({ choices: [{ message: { content: "chat" } }] })).toBe("chat");
  });

  it("reads usage across protocol naming conventions", () => {
    expect(
      extractUsage({
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 8000,
          cache_creation_input_tokens: 500,
          output_tokens: 12,
        },
      }),
    ).toEqual({
      inputTokens: 8600,
      outputTokens: 12,
      totalTokens: 8612,
      cachedInputTokens: 8000,
      cacheCreationInputTokens: 500,
    });
    expect(extractUsage({ usage: { input_tokens: 1, output_tokens: 2 } })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
    });
    expect(
      extractUsage({ usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 } }),
    ).toEqual({
      inputTokens: 4,
      outputTokens: 5,
      totalTokens: 9,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
    });
  });

  it.each([
    ["openai_responses", "input_tokens", "output_tokens", "input_tokens_details"],
    ["openai_chat_completions", "prompt_tokens", "completion_tokens", "prompt_tokens_details"],
  ] as const)(
    "retains cached subsets without adding them to %s input",
    (protocol, input, output, details) => {
      expect(
        extractUsage(
          {
            usage: {
              [input]: 10000,
              [output]: 30,
              [details]: { cached_tokens: 9000, cache_creation_tokens: 1000 },
            },
          },
          protocol,
        ),
      ).toEqual({
        inputTokens: 10000,
        outputTokens: 30,
        totalTokens: 10030,
        cachedInputTokens: 9000,
        cacheCreationInputTokens: 1000,
      });
    },
  );

  it("reads DeepSeek-compatible hits and misses even without a prompt total", () => {
    expect(
      extractUsage(
        {
          usage: {
            prompt_cache_hit_tokens: 9000,
            prompt_cache_miss_tokens: 1000,
            completion_tokens: 30,
          },
        },
        "openai_chat_completions",
      ),
    ).toMatchObject({ inputTokens: 10000, cachedInputTokens: 9000, totalTokens: 10030 });
    expect(
      extractUsage(
        { usage: { prompt_cache_hit_tokens: 9000, completion_tokens: 30 } },
        "openai_chat_completions",
      ),
    ).toMatchObject({ inputTokens: null, cachedInputTokens: 9000, totalTokens: null });
  });

  it("reads Gemini OpenAI-compatible cache counts without adding them to prompt totals", () => {
    expect(
      extractUsage(
        {
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_tokens_details: { cached_tokens: 80 },
          },
        },
        "openai_chat_completions",
      ),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 80,
      cacheCreationInputTokens: null,
    });
  });

  it.each([
    [
      "usageMetadata",
      "promptTokenCount",
      "candidatesTokenCount",
      "thoughtsTokenCount",
      "totalTokenCount",
      "cachedContentTokenCount",
    ],
    [
      "usage_metadata",
      "prompt_token_count",
      "candidates_token_count",
      "thoughts_token_count",
      "total_token_count",
      "cached_content_token_count",
    ],
  ] as const)(
    "reads Gemini %s aliases and includes generated thoughts exactly once",
    (container, prompt, candidates, thoughts, total, cached) => {
      expect(
        extractUsage(
          {
            [container]: {
              [prompt]: 100,
              [candidates]: 20,
              [thoughts]: 5,
              [total]: 125,
              [cached]: 80,
            },
          },
          "openai_chat_completions",
        ),
      ).toEqual({
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
        cachedInputTokens: 80,
        cacheCreationInputTokens: null,
      });
    },
  );

  it("preserves a Gemini reported total that also includes provider tool prompt tokens", () => {
    expect(
      extractUsage({
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 5,
          toolUsePromptTokenCount: 10,
          totalTokenCount: 135,
          cachedContentTokenCount: 80,
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 135,
      cachedInputTokens: 80,
      cacheCreationInputTokens: null,
    });
  });

  it("keeps standard usage, including explicit zeros, ahead of Gemini aliases", () => {
    expect(
      extractUsage(
        {
          usage: {
            prompt_tokens: 100,
            completion_tokens: 0,
            total_tokens: 100,
            prompt_tokens_details: { cached_tokens: 0 },
          },
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 20,
            thoughtsTokenCount: 5,
            totalTokenCount: 125,
            cachedContentTokenCount: 80,
          },
        },
        "openai_chat_completions",
      ),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 0,
      totalTokens: 100,
      cachedInputTokens: 0,
      cacheCreationInputTokens: null,
    });
  });

  it("falls back to valid Gemini aliases for missing or invalid standard measurements", () => {
    expect(
      extractUsage(
        {
          usage: {
            prompt_tokens: "100",
            completion_tokens: -1,
            total_tokens: Number.NaN,
            prompt_tokens_details: { cached_tokens: Number.POSITIVE_INFINITY },
          },
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 20,
            totalTokenCount: 120,
            cachedContentTokenCount: 80,
          },
        },
        "openai_responses",
      ),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 80,
      cacheCreationInputTokens: null,
    });
  });

  it("does not combine a conflicting Gemini metadata prompt with standard usage", () => {
    expect(
      extractUsage(
        {
          usage: { prompt_tokens: 100, completion_tokens: 20 },
          usageMetadata: {
            promptTokenCount: 1000,
            candidatesTokenCount: 200,
            totalTokenCount: 1200,
            cachedContentTokenCount: 80,
          },
        },
        "openai_chat_completions",
      ),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
    });
  });

  it("does not combine conflicting native metadata carriers", () => {
    expect(
      extractUsage({
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
        usage_metadata: {
          prompt_token_count: 200,
          candidates_token_count: 30,
          total_token_count: 230,
          cached_content_token_count: 80,
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
    });
  });

  it("keeps a DeepSeek prompt total ahead of hit-plus-miss and Gemini fallback counts", () => {
    expect(
      extractUsage(
        {
          usage: {
            prompt_tokens: 100,
            prompt_cache_hit_tokens: 80,
            prompt_cache_miss_tokens: 30,
            completion_tokens: 20,
          },
          usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 900 },
        },
        "openai_chat_completions",
      ),
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: 80, totalTokens: 120 });
    expect(
      extractUsage(
        {
          usage: {
            prompt_cache_hit_tokens: 80,
            prompt_cache_miss_tokens: 20,
            completion_tokens: 10,
          },
          usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 900 },
        },
        "openai_chat_completions",
      ),
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: 80, totalTokens: 110 });
  });

  it("keeps native zero cache measurements and leaves absent measurements unknown", () => {
    expect(
      extractUsage({
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
    });
    expect(
      extractUsage({
        usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 0 },
      }),
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: 0, totalTokens: null });
    expect(extractUsage({ usageMetadata: { cachedContentTokenCount: 80 } })).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: 80,
      cacheCreationInputTokens: null,
    });
  });

  it("rejects impossible cached subsets without replacing them with a lower-priority alias", () => {
    expect(
      extractUsage({
        usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 101 } },
        usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 80 },
      }),
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: null });
    expect(
      extractUsage({
        usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 101 },
      }),
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: null });
    expect(
      extractUsage(
        { usage: { input_tokens: 100, cache_creation_input_tokens: 101 } },
        "openai_responses",
      ),
    ).toMatchObject({ inputTokens: 100, cacheCreationInputTokens: null });
  });

  it("does not mix native aliases into Anthropic uncached-input accounting", () => {
    expect(
      extractUsage(
        {
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 5,
            output_tokens: 20,
          },
          usageMetadata: {
            promptTokenCount: 10,
            cachedContentTokenCount: 8,
            totalTokenCount: 1000,
          },
        },
        "anthropic_messages",
      ),
    ).toEqual({
      inputTokens: 95,
      outputTokens: 20,
      totalTokens: 115,
      cachedInputTokens: 80,
      cacheCreationInputTokens: 5,
    });
  });

  it("does not add Anthropic cache counters to an already complete hit-plus-miss fallback", () => {
    expect(
      extractUsage(
        {
          usage: {
            prompt_cache_hit_tokens: 80,
            prompt_cache_miss_tokens: 20,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 5,
            output_tokens: 20,
          },
        },
        "anthropic_messages",
      ),
    ).toMatchObject({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  });

  it("leaves native output unknown when the provider explicitly reports invalid thought counts", () => {
    expect(
      extractUsage({
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          thoughtsTokenCount: Number.NaN,
          totalTokenCount: 125,
          cachedContentTokenCount: 80,
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: null,
      totalTokens: 125,
      cachedInputTokens: 80,
      cacheCreationInputTokens: null,
    });
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "80"])(
    "rejects invalid count %s without manufacturing zeros",
    (invalid) => {
      expect(
        extractUsage({
          usageMetadata: {
            promptTokenCount: invalid,
            candidatesTokenCount: invalid,
            thoughtsTokenCount: invalid,
            totalTokenCount: invalid,
            cachedContentTokenCount: invalid,
          },
        }),
      ).toEqual({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        cachedInputTokens: null,
        cacheCreationInputTokens: null,
      });
    },
  );

  it("does not report overflowing derived token counts", () => {
    expect(
      extractUsage(
        { usage: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 } },
        "openai_chat_completions",
      ),
    ).toMatchObject({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, totalTokens: null });
    expect(
      extractUsage(
        {
          usage: {
            prompt_cache_hit_tokens: Number.MAX_SAFE_INTEGER,
            prompt_cache_miss_tokens: 1,
            completion_tokens: 20,
          },
        },
        "openai_chat_completions",
      ),
    ).toMatchObject({
      inputTokens: null,
      cachedInputTokens: Number.MAX_SAFE_INTEGER,
      totalTokens: null,
    });
  });

  it("ignores non-object usage carriers and malformed metadata", () => {
    expect(extractUsage(null)).toBeNull();
    expect(extractUsage([])).toBeNull();
    expect(extractUsage({ usage: [], usageMetadata: "invalid" })).toBeNull();
    expect(extractUsage({ usage: null, usageMetadata: [] })).toBeNull();
    expect(
      extractUsage({
        usageMetadata: { promptTokenCount: -1 },
        usage_metadata: { prompt_token_count: 100, cached_content_token_count: 80 },
      }),
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: 80 });
  });

  it("distinguishes missing cache measurements from an explicit zero", () => {
    expect(
      extractUsage(
        {
          usage: {
            input_tokens: 100,
            output_tokens: 5,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
        "openai_responses",
      ),
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: 0, cacheCreationInputTokens: null });
    expect(
      extractUsage({ usage: { input_tokens: 100, output_tokens: 5 } }, "openai_responses"),
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: null, cacheCreationInputTokens: null });
  });

  it("uses the complete Anthropic context when a gateway total omits cached tokens", () => {
    expect(
      extractUsage(
        {
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 50,
            output_tokens: 3,
            total_tokens: 13,
          },
        },
        "anthropic_messages",
      ),
    ).toMatchObject({
      inputTokens: 160,
      outputTokens: 3,
      totalTokens: 163,
      cachedInputTokens: 100,
      cacheCreationInputTokens: 50,
    });
  });

  it("rejects invalid or impossible measurements and respects the selected protocol", () => {
    expect(
      extractUsage(
        {
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 10,
            output_tokens: 5,
          },
        },
        "openai_responses",
      ),
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: 80, totalTokens: 105 });
    expect(
      extractUsage(
        {
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 101 },
            output_tokens: -1,
            total_tokens: Number.POSITIVE_INFINITY,
            cache_creation_input_tokens: Number.NaN,
          },
        },
        "openai_responses",
      ),
    ).toMatchObject({
      inputTokens: 100,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
    });
    expect(
      extractUsage(
        {
          usage: {
            prompt_tokens: 100,
            completion_tokens: 5,
            prompt_tokens_details: { cached_tokens: 80 },
            total_tokens: 50,
          },
        },
        "openai_chat_completions",
      ),
    ).toMatchObject({ inputTokens: 100, cachedInputTokens: 80, totalTokens: 105 });
  });
});
