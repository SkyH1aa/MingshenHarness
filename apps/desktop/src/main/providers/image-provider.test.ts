import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ModelConfig,
  ModelCreateInput,
  ProviderProtocol,
  ProviderView,
} from "../../shared/domain";
import { imageOutputProviders, textOutputProviders } from "../../shared/model-capabilities";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import type { SecretStore } from "../storage/secret-store";
import { parseImageGenerationResponse } from "./image-generation";
import { ProviderService } from "./provider-service";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const databases: ReturnType<typeof openDatabase>[] = [];
type CompleteModelInput = ModelCreateInput &
  Required<Pick<ModelCreateInput, "displayName" | "outputModalities">>;

afterEach(() => {
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.close();
});

function setup(protocol: ProviderProtocol = "openai_chat_completions") {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Image gateway",
    baseUrl: "https://images.invalid/v1",
    protocol,
    authMode: "bearer",
    customHeaderName: null,
  });
  database
    .prepare("insert into secrets (id, ciphertext, created_at) values (?, ?, ?)")
    .run("image-test-secret", new Uint8Array([1, 2, 3]), "2026-11-20");
  repository.insertProviderKey({
    providerId: provider.id,
    label: "Synthetic key",
    secretRef: "image-test-secret",
    maskedHint: "***test",
    neverReveal: true,
    priority: 0,
  });
  const service = new ProviderService(repository, {
    read: vi.fn(() => "synthetic-image-key"),
    store: vi.fn(),
    remove: vi.fn(),
  } as unknown as SecretStore);
  return { database, repository, provider, service };
}

function modelInput(
  providerId: string,
  outputModalities: ModelCreateInput["outputModalities"] = ["image"],
): CompleteModelInput {
  return {
    providerId,
    modelId: "image-model",
    displayName: "Image model",
    contextWindow: 1,
    maxOutputTokens: 1,
    inputModalities: ["text"],
    outputModalities,
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  };
}

function model(
  id: string,
  outputModalities: ModelConfig["outputModalities"],
  enabled = true,
): ModelConfig {
  return {
    id,
    providerId: "provider",
    modelId: id,
    displayName: id,
    contextWindow: 1000,
    maxOutputTokens: 100,
    inputModalities: ["text"],
    outputModalities,
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
    enabled,
  };
}

function provider(models: ModelConfig[]): ProviderView {
  return {
    id: "provider",
    name: "Provider",
    baseUrl: "https://gateway.invalid/v1",
    protocol: "openai_chat_completions",
    authMode: "bearer",
    customHeaderName: null,
    activeKeyId: "key",
    keys: [],
    models,
    createdAt: "",
    updatedAt: "",
  };
}

describe("image generation response", () => {
  it("accepts a validated Base64 PNG and canonicalizes it", async () => {
    await expect(
      parseImageGenerationResponse({
        data: [{ b64_json: TINY_PNG_BASE64, revised_prompt: "A test image" }],
      }),
    ).resolves.toMatchObject({
      base64: TINY_PNG_BASE64,
      mimeType: "image/png",
      byteLength: Buffer.from(TINY_PNG_BASE64, "base64").length,
      revisedPrompt: "A test image",
    });
  });

  it.each([
    [{ data: [{ url: "https://untrusted.invalid/image.png" }] }],
    [{ data: [{ b64_json: "https://untrusted.invalid/image.png" }] }],
    [{ data: [{ b64_json: Buffer.from("not an image").toString("base64") }] }],
    [{ data: [{ b64_json: Buffer.from("RIFF0000WEBP").toString("base64") }] }],
  ])("rejects an invalid or URL-only response %#", async (payload) => {
    await expect(parseImageGenerationResponse(payload)).rejects.toThrow();
  });
});

describe("image model output filtering", () => {
  it("keeps image-only models out of text selection and isolates them for image selection", () => {
    const sources = [
      provider([
        model("text", ["text"]),
        model("image", ["image"]),
        model("mixed", ["text", "image"]),
        model("disabled-image", ["image"], false),
      ]),
    ];

    expect(textOutputProviders(sources)[0]?.models.map((item) => item.id)).toEqual([
      "text",
      "mixed",
    ]);
    expect(imageOutputProviders(sources)[0]?.models.map((item) => item.id)).toEqual(["image"]);
  });
});

describe("image model protocol validation", () => {
  it.each(["anthropic_messages", "gemini_generate_content"] as const)(
    "rejects image output on %s",
    (protocol) => {
      const { provider: savedProvider, service } = setup(protocol);
      expect(() => service.createModel(modelInput(savedProvider.id))).toThrow(
        "OpenAI Chat Completions 或 OpenAI Responses",
      );
      expect(service.getProvider(savedProvider.id).models).toEqual([]);
    },
  );

  it.each(["openai_chat_completions", "openai_responses"] as const)(
    "allows image output on %s",
    (protocol) => {
      const { provider: savedProvider, service } = setup(protocol);
      expect(service.createModel(modelInput(savedProvider.id)).models[0]).toMatchObject({
        outputModalities: ["image"],
      });
    },
  );

  it("rejects mixed text and image output on an incompatible provider", () => {
    const { provider: savedProvider, service } = setup("anthropic_messages");
    expect(() => service.createModel(modelInput(savedProvider.id, ["text", "image"]))).toThrow(
      "OpenAI Chat Completions 或 OpenAI Responses",
    );
    expect(service.getProvider(savedProvider.id).models).toEqual([]);
  });

  it("rejects an update that would add image output to an incompatible provider", () => {
    const { repository, provider: savedProvider, service } = setup("anthropic_messages");
    repository.insertModel({
      ...modelInput(savedProvider.id),
      modelId: "text-model",
      outputModalities: ["text"],
    });
    const saved = repository.getProvider(savedProvider.id)?.models[0];
    if (!saved) throw new Error("Fixture model missing.");

    expect(() =>
      service.updateModel({
        id: saved.id,
        modelId: saved.modelId,
        displayName: saved.displayName,
        contextWindow: saved.contextWindow,
        maxOutputTokens: saved.maxOutputTokens,
        inputModalities: saved.inputModalities,
        outputModalities: ["image"],
        toolCalls: saved.toolCalls,
        parallelToolCalls: saved.parallelToolCalls,
        reasoningLevels: saved.reasoningLevels,
        anthropicNoneBehavior: saved.anthropicNoneBehavior,
      }),
    ).toThrow("OpenAI Chat Completions 或 OpenAI Responses");
    expect(repository.getModel(saved.id)?.outputModalities).toEqual(["text"]);
  });
});

describe("image connection test", () => {
  it("uses Images generations and validates b64_json without downloading a URL", async () => {
    const { provider: savedProvider, repository, service } = setup();
    const created = service.createModel(modelInput(savedProvider.id));
    const imageModel = created.models[0];
    if (!imageModel) throw new Error("Image model missing.");
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ data: [{ b64_json: TINY_PNG_BASE64, revised_prompt: "Generated" }] }),
    );
    vi.stubGlobal("fetch", fetcher);

    const result = await service.testConnection(savedProvider.id, imageModel.id);

    expect(result).toMatchObject({
      ok: true,
      requestUrl: "https://images.invalid/v1/images/generations",
      responseBody: expect.stringContaining("[base64 omitted"),
      error: null,
    });
    expect(result.responseBody).not.toContain(TINY_PNG_BASE64);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://images.invalid/v1/images/generations");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "image-model",
      prompt: "Generate one small test image.",
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    });
    expect(repository.getModel(imageModel.id)?.outputModalities).toEqual(["image"]);
  });

  it("returns a failed test for URL-only output and never requests that URL", async () => {
    const { provider: savedProvider, service } = setup();
    const imageModel = service.createModel(modelInput(savedProvider.id)).models[0];
    if (!imageModel) throw new Error("Image model missing.");
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ data: [{ url: "https://untrusted.invalid/generated.png" }] }),
    );
    vi.stubGlobal("fetch", fetcher);

    const result = await service.testConnection(savedProvider.id, imageModel.id);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("不接受仅返回 URL");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://images.invalid/v1/images/generations");
  });

  it("rejects a legacy image model saved on an incompatible protocol before fetching", async () => {
    const { repository, provider: savedProvider, service } = setup("anthropic_messages");
    repository.insertModel(modelInput(savedProvider.id));
    const imageModel = repository.getProvider(savedProvider.id)?.models[0];
    if (!imageModel) throw new Error("Image model missing.");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(service.testConnection(savedProvider.id, imageModel.id)).rejects.toThrow(
      "OpenAI Chat Completions 或 OpenAI Responses",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
