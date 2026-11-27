import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ModelConfig,
  ModelCreateInput,
  ProviderProtocol,
  ProviderView,
} from "../../shared/domain";
import { imageOutputProviders, textOutputProviders } from "../../shared/model-capabilities";
import type { ManagedPolicyService } from "../policy/managed-policy-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import type { SecretStore } from "../storage/secret-store";
import {
  parseImageGenerationCandidates,
  parseImageGenerationCandidatesDetailed,
  parseImageGenerationResponse,
  parseImageGenerationResponses,
} from "./image-generation";
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

describe("ProviderService managed policy guard", () => {
  it("blocks network requests before reading the provider key", () => {
    const { provider, service } = setup();
    const assertProvider = vi.fn(() => {
      throw new Error("POLICY_BLOCKED");
    });
    service.setManagedPolicy({
      assertOperational: vi.fn(),
      assertProvider,
    } as unknown as ManagedPolicyService);

    expect(() => service.getActiveApiKey(provider.id)).toThrow("POLICY_BLOCKED");
    expect(assertProvider).toHaveBeenCalledWith(provider.id, undefined, {});
  });
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

  it("parses every image in a bounded multi-image response", async () => {
    await expect(
      parseImageGenerationResponses({
        data: [
          { b64_json: TINY_PNG_BASE64, revised_prompt: "First" },
          { b64_json: TINY_PNG_BASE64, revised_prompt: "Second" },
        ],
      }),
    ).resolves.toMatchObject([
      { mimeType: "image/png", revisedPrompt: "First" },
      { mimeType: "image/png", revisedPrompt: "Second" },
    ]);
  });

  it("rejects a provider response with more than ten images", async () => {
    await expect(
      parseImageGenerationResponses({
        data: Array.from({ length: 11 }, () => ({ b64_json: TINY_PNG_BASE64 })),
      }),
    ).rejects.toThrow("10 张上限");
  });

  it("keeps mixed Base64 and remote URL candidates without fetching the URL", async () => {
    const result = await parseImageGenerationCandidates({
      data: [
        { b64_json: TINY_PNG_BASE64, revised_prompt: "Local" },
        {
          url: "https://cdn.example.test/generated.webp?token=opaque",
          revised_prompt: "Remote",
        },
      ],
    });
    expect(result).toMatchObject([
      { mimeType: "image/png", revisedPrompt: "Local" },
      {
        url: "https://cdn.example.test/generated.webp?token=opaque",
        revisedPrompt: "Remote",
      },
    ]);
  });

  it("keeps remote URL candidates lossless and leaves security checks to preview", async () => {
    await expect(
      parseImageGenerationCandidates({
        data: [{ url: "https://CDN.EXAMPLE.TEST:443/image.png#fragment" }],
      }),
    ).resolves.toEqual([
      {
        url: "https://CDN.EXAMPLE.TEST:443/image.png#fragment",
        revisedPrompt: null,
      },
    ]);
    await expect(
      parseImageGenerationCandidates({ data: [{ url: "http://cdn.example.test/image.png" }] }),
    ).resolves.toEqual([
      {
        url: "http://cdn.example.test/image.png",
        revisedPrompt: null,
      },
    ]);
    await expect(
      parseImageGenerationCandidates({
        data: [
          { b64_json: TINY_PNG_BASE64, revised_prompt: "Preserved" },
          { url: "not a URL", revised_prompt: "Preview later" },
        ],
      }),
    ).resolves.toMatchObject([
      { mimeType: "image/png", revisedPrompt: "Preserved" },
      { url: "not a URL", revisedPrompt: "Preview later" },
    ]);
    await expect(
      parseImageGenerationCandidates({
        data: [{ url: `https://cdn.example.test/${"a".repeat(8_192)}` }],
      }),
    ).resolves.toEqual([]);
  });

  it("reports per-item failures without losing valid mixed candidates or leaking source values", async () => {
    const result = await parseImageGenerationCandidatesDetailed({
      data: [
        { b64_json: TINY_PNG_BASE64, revised_prompt: "Keep" },
        {
          b64_json: "not-base64",
          url: "https://cdn.example.test/fallback.png?signature=opaque",
          revised_prompt: "Fallback",
        },
        { url: `https://cdn.example.test/${"a".repeat(8_192)}` },
        { url: "not a URL", revised_prompt: "Preview warning later" },
      ],
    });

    expect(result.resultCount).toBe(4);
    expect(result.candidates).toMatchObject([
      { mimeType: "image/png", revisedPrompt: "Keep" },
      {
        url: "https://cdn.example.test/fallback.png?signature=opaque",
        revisedPrompt: "Fallback",
      },
      { url: "not a URL", revisedPrompt: "Preview warning later" },
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ imageIndex: 2, code: "invalid_base64" }),
      expect.objectContaining({ imageIndex: 3, code: "url_too_long" }),
    ]);
    expect(JSON.stringify(result.warnings)).not.toContain("not-base64");
    expect(JSON.stringify(result.warnings)).not.toContain("signature=opaque");
  });

  it("returns warnings instead of throwing when every individual candidate is invalid", async () => {
    await expect(
      parseImageGenerationCandidatesDetailed({
        data: [{ b64_json: "not-base64" }, { url: "" }, null],
      }),
    ).resolves.toMatchObject({
      resultCount: 3,
      candidates: [],
      warnings: [
        { imageIndex: 1, code: "invalid_base64" },
        { imageIndex: 2, code: "invalid_result" },
        { imageIndex: 3, code: "invalid_result" },
      ],
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
    expect(
      textOutputProviders([
        {
          ...sources[0],
          id: "images-protocol",
          protocol: "openai_images",
          models: [model("malformed-text", ["text"])],
        } as ProviderView,
      ]),
    ).toEqual([]);
  });
});

describe("image model protocol validation", () => {
  it.each(["anthropic_messages", "gemini_generate_content"] as const)(
    "rejects image output on %s",
    (protocol) => {
      const { provider: savedProvider, service } = setup(protocol);
      expect(() => service.createModel(modelInput(savedProvider.id))).toThrow(
        "OpenAI Images、OpenAI Chat Completions 或 OpenAI Responses",
      );
      expect(service.getProvider(savedProvider.id).models).toEqual([]);
    },
  );

  it.each(["openai_chat_completions", "openai_responses", "openai_images"] as const)(
    "allows image output on %s",
    (protocol) => {
      const { provider: savedProvider, service } = setup(protocol);
      expect(service.createModel(modelInput(savedProvider.id)).models[0]).toMatchObject({
        outputModalities: ["image"],
      });
    },
  );

  it("defaults omitted output modalities to image for the OpenAI Images protocol", () => {
    const { provider: savedProvider, service } = setup("openai_images");
    const { outputModalities: _outputModalities, ...withoutOutput } = modelInput(savedProvider.id);

    const created = service.createModel(withoutOutput).models[0];
    if (!created) throw new Error("Image model missing.");
    expect(created.outputModalities).toEqual(["image"]);

    const updated = service
      .updateModel({
        id: created.id,
        modelId: created.modelId,
        displayName: "Updated image model",
        contextWindow: created.contextWindow,
        maxOutputTokens: created.maxOutputTokens,
        inputModalities: created.inputModalities,
        toolCalls: created.toolCalls,
        parallelToolCalls: created.parallelToolCalls,
        reasoningLevels: created.reasoningLevels,
        anthropicNoneBehavior: created.anthropicNoneBehavior,
      })
      .models.find((model) => model.id === created.id);
    expect(updated).toMatchObject({
      displayName: "Updated image model",
      outputModalities: ["image"],
    });
  });

  it("rejects mixed text and image output on an incompatible provider", () => {
    const { provider: savedProvider, service } = setup("anthropic_messages");
    expect(() => service.createModel(modelInput(savedProvider.id, ["text", "image"]))).toThrow(
      "OpenAI Images、OpenAI Chat Completions 或 OpenAI Responses",
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
    ).toThrow("OpenAI Images、OpenAI Chat Completions 或 OpenAI Responses");
    expect(repository.getModel(saved.id)?.outputModalities).toEqual(["text"]);
  });

  it("keeps the OpenAI Images protocol image-only and closes tool capabilities", () => {
    const { repository, provider: savedProvider, service } = setup("openai_images");

    expect(() =>
      service.createModel({
        ...modelInput(savedProvider.id, ["text"]),
        modelId: "text-model",
      }),
    ).toThrow("仅支持纯图片输出模型");
    expect(() =>
      service.createModel({
        ...modelInput(savedProvider.id, ["text", "image"]),
        modelId: "mixed-model",
      }),
    ).toThrow("仅支持纯图片输出模型");
    expect(() =>
      service.createModel({
        ...modelInput(savedProvider.id),
        modelId: "tool-model",
        toolCalls: true,
      }),
    ).toThrow("不支持工具调用");

    const imageModel = service.createModel(modelInput(savedProvider.id)).models[0];
    if (!imageModel) throw new Error("Image model missing.");
    expect(() =>
      service.updateModel({
        id: imageModel.id,
        modelId: imageModel.modelId,
        displayName: imageModel.displayName,
        contextWindow: imageModel.contextWindow,
        maxOutputTokens: imageModel.maxOutputTokens,
        inputModalities: imageModel.inputModalities,
        outputModalities: ["text", "image"],
        toolCalls: false,
        parallelToolCalls: false,
        reasoningLevels: [],
        anthropicNoneBehavior: "disabled",
      }),
    ).toThrow("仅支持纯图片输出模型");
    expect(repository.getModel(imageModel.id)?.outputModalities).toEqual(["image"]);
  });

  it("rejects switching a provider with text models to OpenAI Images", () => {
    const { provider: savedProvider, service } = setup("openai_responses");
    service.createModel({
      ...modelInput(savedProvider.id, ["text"]),
      modelId: "text-model",
    });

    expect(() =>
      service.updateProvider({
        providerId: savedProvider.id,
        name: savedProvider.name,
        baseUrl: savedProvider.baseUrl,
        protocol: "openai_images",
        authMode: savedProvider.authMode,
        customHeaderName: savedProvider.customHeaderName,
      }),
    ).toThrow("仅支持纯图片输出模型");
    expect(service.getProvider(savedProvider.id).protocol).toBe("openai_responses");
  });

  it("rejects switching an OpenAI Images provider to a protocol without image output", () => {
    const { provider: savedProvider, service } = setup("openai_images");
    service.createModel(modelInput(savedProvider.id));

    expect(() =>
      service.updateProvider({
        providerId: savedProvider.id,
        name: savedProvider.name,
        baseUrl: "https://images.invalid/v1",
        protocol: "anthropic_messages",
        authMode: savedProvider.authMode,
        customHeaderName: savedProvider.customHeaderName,
      }),
    ).toThrow("OpenAI Images、OpenAI Chat Completions 或 OpenAI Responses");
    expect(service.getProvider(savedProvider.id).protocol).toBe("openai_images");
  });
});

describe("image connection test", () => {
  it("uses Images generations and validates b64_json", async () => {
    const { provider: savedProvider, repository, service } = setup("openai_images");
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
    });
    expect(repository.getModel(imageModel.id)?.outputModalities).toEqual(["image"]);
  });

  it("rejects malformed text models saved under the OpenAI Images protocol before fetching", async () => {
    const { repository, provider: savedProvider, service } = setup("openai_images");
    repository.insertModel({
      ...modelInput(savedProvider.id, ["text"]),
      modelId: "legacy-text-model",
    });
    const malformed = repository.getProvider(savedProvider.id)?.models[0];
    if (!malformed) throw new Error("Malformed model fixture missing.");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(service.testConnection(savedProvider.id, malformed.id)).rejects.toThrow(
      "仅支持纯图片输出模型",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts URL-only output without downloading it and directs the user to Image Studio", async () => {
    const { provider: savedProvider, service } = setup();
    const imageModel = service.createModel(modelInput(savedProvider.id)).models[0];
    if (!imageModel) throw new Error("Image model missing.");
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ data: [{ url: "https://cdn.example.test/generated.png" }] }),
    );
    vi.stubGlobal("fetch", fetcher);

    const result = await service.testConnection(savedProvider.id, imageModel.id);

    expect(result).toMatchObject({
      ok: true,
      error: null,
      responseText: "已检测到远程图片结果。连接测试不会下载图片，请在生图工作台预览并确认保存。",
      responseBody: expect.stringContaining("[URL omitted]"),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://images.invalid/v1/images/generations");
  });

  it("rejects an unsafe URL-only result without downloading it", async () => {
    const { provider: savedProvider, service } = setup();
    const imageModel = service.createModel(modelInput(savedProvider.id)).models[0];
    if (!imageModel) throw new Error("Image model missing.");
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ data: [{ url: "https://127.0.0.1/generated.png" }] }),
    );
    vi.stubGlobal("fetch", fetcher);

    const result = await service.testConnection(savedProvider.id, imageModel.id);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("连接测试未检测到可用的图片结果。");
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
      "OpenAI Images、OpenAI Chat Completions 或 OpenAI Responses",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
