import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderProtocol } from "../../shared/domain";
import { providerPromptCachingKey } from "../../shared/prompt-caching";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import type { SecretStore } from "../storage/secret-store";
import { streamModelTurn } from "./model-stream";
import { normalizeBaseUrl, ProviderService } from "./provider-service";

afterEach(() => vi.unstubAllGlobals());

function setup(protocol: ProviderProtocol) {
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Cache gateway fixture",
    baseUrl: "https://gateway.invalid/v1",
    protocol,
    authMode: "bearer",
    customHeaderName: null,
  });
  const service = new ProviderService(repository, {} as SecretStore);
  return { database, repository, provider, service };
}

describe("provider prompt caching persistence and transport", () => {
  it.each([
    [
      "https://generativelanguage.googleapis.com/v1beta/openai/",
      "https://generativelanguage.googleapis.com/v1beta/openai",
    ],
    ["https://api.deepseek.com/", "https://api.deepseek.com"],
    ["https://api.deepseek.com/beta///", "https://api.deepseek.com/beta"],
    ["https://api.deepseek.com/anthropic/v1/", "https://api.deepseek.com/anthropic/v1"],
  ])("accepts documented official base URL %s", (baseUrl, normalized) => {
    expect(normalizeBaseUrl(baseUrl)).toBe(normalized);
  });

  it.each([
    "https://generativelanguage.googleapis.com.evil.invalid/v1beta/openai",
    "http://generativelanguage.googleapis.com/v1beta/openai",
    "https://generativelanguage.googleapis.com:8443/v1beta/openai",
    "https://api.deepseek.com.evil.invalid",
    "http://api.deepseek.com/beta",
    "https://api.deepseek.com:8443/beta",
    "https://gateway.invalid/beta",
    "https://api.deepseek.com/anthropic",
  ])("retains strict generic base URL validation for %s", (baseUrl) => {
    expect(() => normalizeBaseUrl(baseUrl)).toThrow("/v1");
  });

  it.each(["gemini", "deepseek"] as const)("saves and reloads the %s family", (modelFamily) => {
    const { database, repository, provider, service } = setup("openai_chat_completions");
    try {
      const settings = { modelFamily, mode: "auto", ttl: "5m" } as const;
      const saved = service.setPromptCaching(provider.id, settings);
      expect(saved.promptCaching).toEqual(settings);
      expect(new Repository(database).getProvider(provider.id)?.promptCaching).toEqual(settings);
      expect(() =>
        service.setPromptCaching(provider.id, { ...settings, modelFamily: "invented" }),
      ).toThrow("无效");
      expect(repository.getProvider(provider.id)?.promptCaching).toEqual(settings);
    } finally {
      database.close();
    }
  });

  it("validates family settings before storing credentials and persists them during creation", () => {
    const { database, repository } = setup("openai_responses");
    const store = vi.fn(() => {
      database
        .prepare("insert into secrets (id, ciphertext, created_at) values (?, ?, ?)")
        .run("fixture-secret", new Uint8Array([1]), "2026-11-07");
      return { secretRef: "fixture-secret", maskedHint: "***fixture" };
    });
    const remove = vi.fn();
    const service = new ProviderService(repository, { store, remove } as unknown as SecretStore);
    const input = {
      name: "New gateway",
      baseUrl: "https://gateway.invalid/v1",
      protocol: "openai_responses" as const,
      authMode: "bearer" as const,
      apiKey: "fixture",
      keyLabel: "Fixture",
      neverReveal: true,
    };
    try {
      expect(() =>
        service.createProvider({ ...input, promptCaching: { mode: "anthropic_auto", ttl: "5m" } }),
      ).toThrow("不匹配");
      expect(store).not.toHaveBeenCalled();
      expect(repository.listProviders()).toHaveLength(1);
      const created = service.createProvider({
        ...input,
        promptCaching: { mode: "auto", ttl: "5m", modelFamily: "openai" },
      });
      expect(created.promptCaching).toEqual({ mode: "auto", ttl: "5m", modelFamily: "openai" });
      expect(new Repository(database).getProvider(created.id)?.promptCaching).toEqual(
        created.promptCaching,
      );
      service.removeProvider(created.id);
      expect(repository.getSetting(providerPromptCachingKey(created.id))).toBeNull();
      expect(remove).toHaveBeenCalledWith("fixture-secret");
    } finally {
      database.close();
    }
  });

  it("defaults old providers safely, persists validated settings and removes them on deletion", () => {
    const { database, repository, provider, service } = setup("openai_responses");
    try {
      expect(provider.promptCaching).toEqual({ mode: "auto", ttl: "5m" });
      const saved = service.setPromptCaching(provider.id, { mode: "openai", ttl: "5m" });
      expect(saved.promptCaching).toEqual({ mode: "openai", ttl: "5m" });
      expect(new Repository(database).listProviders()[0]?.promptCaching).toEqual(
        saved.promptCaching,
      );
      expect(() =>
        service.setPromptCaching(provider.id, { mode: "anthropic_auto", ttl: "1h" }),
      ).toThrow("不匹配");
      expect(service.getProvider(provider.id).promptCaching).toEqual(saved.promptCaching);
      expect(() => service.setPromptCaching(123 as unknown as string, {})).toThrow("无效");
      expect(() => service.setPromptCaching("missing", { mode: "off", ttl: "5m" })).toThrow(
        "不存在",
      );
      service.removeProvider(provider.id);
      expect(repository.getSetting(providerPromptCachingKey(provider.id))).toBeNull();
    } finally {
      database.close();
    }
  });

  it.each([
    ["openai_responses", "openai"],
    ["openai_chat_completions", "openai"],
    ["anthropic_messages", "anthropic_auto"],
    ["anthropic_messages", "anthropic_breakpoints"],
  ] as const)(
    "compiles saved %s/%s settings into the actual request body",
    async (protocol, mode) => {
      const { database, repository, provider, service } = setup(protocol);
      try {
        const configured = service.setPromptCaching(provider.id, {
          mode,
          ttl: protocol === "anthropic_messages" ? "1h" : "5m",
        });
        const responses =
          protocol === "anthropic_messages"
            ? [{ type: "message_stop" }]
            : protocol === "openai_responses"
              ? [{ type: "response.completed", response: { output: [] } }]
              : [{ choices: [{ delta: {}, finish_reason: "stop" }] }, "[DONE]"];
        const fetcher = vi.fn(async () => {
          return new Response(
            responses
              .map(
                (event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`,
              )
              .join(""),
            { headers: { "content-type": "text/event-stream" } },
          );
        });
        vi.stubGlobal("fetch", fetcher);
        repository.insertModel({
          providerId: provider.id,
          modelId: "fixture",
          displayName: "Fixture",
          contextWindow: 10000,
          maxOutputTokens: 512,
          inputModalities: ["text"],
          outputModalities: ["text"],
          toolCalls: true,
          parallelToolCalls: false,
          reasoningLevels: [],
          anthropicNoneBehavior: "disabled",
        });
        const model = repository.getProvider(provider.id)?.models[0];
        if (!model) throw new Error("Fixture model missing.");
        for await (const _event of streamModelTurn({
          provider: configured,
          model,
          apiKey: "fixture-key",
          systemPrompt: "Stable instructions",
          messages: [
            {
              id: "question",
              sessionId: "session",
              seq: 1,
              role: "user",
              createdAt: "2026-11-07",
              parts: [{ type: "text", text: "Question" }],
            },
          ],
          tools: [{ name: "read", description: "Read", parameters: { type: "object" } }],
          reasoningLevel: null,
          signal: new AbortController().signal,
        })) {
          // Consume the actual transport.
        }
        const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
        const body = JSON.parse(String(call[1].body)) as Record<string, unknown>;
        if (protocol === "anthropic_messages") {
          expect(body.system).toEqual([
            {
              type: "text",
              text: "Stable instructions",
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ]);
          expect(body.cache_control).toEqual(
            mode === "anthropic_auto" ? { type: "ephemeral", ttl: "1h" } : undefined,
          );
          expect(body).not.toHaveProperty("prompt_cache_key");
        } else {
          expect(body.prompt_cache_key).toMatch(/^msh:/);
          expect(body).not.toHaveProperty("cache_control");
          expect(body).not.toHaveProperty("prompt_cache_retention");
        }
      } finally {
        database.close();
      }
    },
  );
});
