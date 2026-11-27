import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
  emptyImageStudioWorkspace,
  IMAGE_STUDIO_MAX_ASSETS,
  type ImageStudioCanvas,
  type ImageStudioGenerateInput,
} from "../../shared/image-studio";
import type { ManagedPolicyService } from "../policy/managed-policy-service";
import type { ImageGenerationPayload } from "../providers/image-generation";
import { assertPublicRemoteImageHost, fetchRemoteImage } from "../providers/image-result-download";
import type { ProviderService } from "../providers/provider-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import {
  canReserveRemoteImagePreviewBytes,
  IMAGE_STUDIO_MAX_REMOTE_PREVIEW_BYTES,
  ImageStudioService,
} from "./image-studio-service";

vi.mock("../providers/image-result-download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../providers/image-result-download")>();
  return {
    ...actual,
    assertPublicRemoteImageHost: vi.fn(),
    fetchRemoteImage: vi.fn(),
  };
});

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const DATABASES: ReturnType<typeof openDatabase>[] = [];
const TEMPORARY_ROOTS: string[] = [];
const SERVICES: ImageStudioService[] = [];
const remoteImage = vi.mocked(fetchRemoteImage);
const publicHostCheck = vi.mocked(assertPublicRemoteImageHost);

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await Promise.allSettled(SERVICES.splice(0).map((service) => service.dispose()));
  for (const database of DATABASES.splice(0)) database.close();
  await Promise.all(
    TEMPORARY_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const database = openDatabase(":memory:");
  DATABASES.push(database);
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Remote image fixture",
    baseUrl: "https://images.invalid/v1",
    protocol: "openai_chat_completions",
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "image-model",
    displayName: "Image model",
    contextWindow: 1,
    maxOutputTokens: 1,
    inputModalities: ["text"],
    outputModalities: ["image"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository.getProvider(provider.id)?.models[0];
  if (!model) throw new Error("Missing image model fixture");
  const root = await mkdtemp(join(tmpdir(), "mingshen-image-remote-"));
  TEMPORARY_ROOTS.push(root);
  const service = new ImageStudioService(
    repository,
    {
      getProvider: () => repository.getProvider(provider.id),
      getActiveApiKey: () => "fixture-key",
    } as unknown as ProviderService,
    root,
  );
  SERVICES.push(service);
  return {
    repository,
    root,
    service,
    model: { providerId: provider.id, modelId: model.id },
  };
}

function generationInput(
  model: ImageStudioGenerateInput["model"],
  requestId: string,
  patch: Partial<ImageStudioGenerateInput> = {},
): ImageStudioGenerateInput {
  return {
    requestId,
    model,
    prompt: "Original positive prompt",
    negativePrompt: "Original negative prompt",
    generation: {
      ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
      imageCount: 1,
    },
    addToActiveCanvas: false,
    ...patch,
  };
}

function downloadedImage(patch: Partial<ImageGenerationPayload> = {}): ImageGenerationPayload {
  return {
    base64: TINY_PNG_BASE64,
    mimeType: "image/png",
    byteLength: Buffer.from(TINY_PNG_BASE64, "base64").length,
    revisedPrompt: null,
    width: 1,
    height: 1,
    extension: ".png",
    ...patch,
  };
}

async function fillAssetLibrary(service: ImageStudioService): Promise<void> {
  for (let offset = 0; offset < IMAGE_STUDIO_MAX_ASSETS; offset += 20) {
    const count = Math.min(20, IMAGE_STUDIO_MAX_ASSETS - offset);
    await service.importAssets(
      Array.from({ length: count }, (_, index) => ({
        name: `fixture-${offset + index}.png`,
        dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}`,
      })),
    );
  }
}

async function listAssetFiles(root: string): Promise<string[]> {
  try {
    return await readdir(join(root, "image-studio", "assets"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function canvas(id: string, name: string): ImageStudioCanvas {
  return {
    id,
    name,
    width: 640,
    height: 480,
    background: "#101619",
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    layers: [],
    createdAt: "2026-11-27T00:00:00.000Z",
    updatedAt: "2026-11-27T00:00:00.000Z",
  };
}

describe("Image Studio remote generation results", () => {
  it("caps generation at three and serializes three successful commits with their original prompts", async () => {
    const { root, service, model } = await fixture();
    const pending: Array<{
      prompt: string;
      negativePrompt: string;
      signal: AbortSignal;
      response: ReturnType<typeof deferred<Response>>;
    }> = [];
    const providerFetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body)) as {
          prompt?: string;
          [key: string]: unknown;
        };
        const response = deferred<Response>();
        pending.push({
          prompt: body.prompt ?? "",
          negativePrompt: "",
          signal: init?.signal as AbortSignal,
          response,
        });
        return response.promise;
      },
    );
    vi.stubGlobal("fetch", providerFetch);

    const requests = [
      { requestId: "generate-concurrent-001", prompt: "First original prompt" },
      { requestId: "generate-concurrent-002", prompt: "Second original prompt" },
      { requestId: "generate-concurrent-003", prompt: "Third original prompt" },
    ].map(({ requestId, prompt }) =>
      service.generate(
        generationInput(model, requestId, {
          prompt,
          negativePrompt: `${prompt} negative`,
        }),
      ),
    );

    await vi.waitFor(() => expect(pending).toHaveLength(3));
    await expect(
      service.generate(generationInput(model, "generate-concurrent-004")),
    ).rejects.toThrow("同时最多运行 3 个生图请求");
    expect(providerFetch).toHaveBeenCalledTimes(3);

    for (const index of [2, 0, 1]) {
      pending[index]?.response.resolve(Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }));
    }
    const results = await Promise.all(requests);
    expect(results.flatMap((result) => result.generatedAssets)).toHaveLength(3);
    expect(service.getWorkspace().assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prompt: "First original prompt",
          negativePrompt: "First original prompt negative",
        }),
        expect.objectContaining({
          prompt: "Second original prompt",
          negativePrompt: "Second original prompt negative",
        }),
        expect.objectContaining({
          prompt: "Third original prompt",
          negativePrompt: "Third original prompt negative",
        }),
      ]),
    );
    expect(service.getWorkspace().assets).toHaveLength(3);
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toHaveLength(3);
  });

  it("isolates cancellation to one generation and releases only that concurrency slot", async () => {
    const { service, model } = await fixture();
    const pending: Array<{
      signal: AbortSignal;
      response: ReturnType<typeof deferred<Response>>;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const response = deferred<Response>();
        const signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => response.reject(signal.reason), { once: true });
        pending.push({ signal, response });
        return response.promise;
      }),
    );

    const cancelled = service.generate(
      generationInput(model, "generate-cancel-isolated-001", {
        prompt: "Cancelled prompt",
      }),
    );
    const second = service.generate(
      generationInput(model, "generate-cancel-isolated-002", {
        prompt: "Surviving prompt two",
      }),
    );
    const third = service.generate(
      generationInput(model, "generate-cancel-isolated-003", {
        prompt: "Surviving prompt three",
      }),
    );
    await vi.waitFor(() => expect(pending).toHaveLength(3));

    service.cancelRequest("generate-cancel-isolated-001");
    await expect(cancelled).rejects.toThrow("已取消");
    expect((pending[0]?.signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect((pending[1]?.signal as AbortSignal | undefined)?.aborted).toBe(false);
    expect((pending[2]?.signal as AbortSignal | undefined)?.aborted).toBe(false);

    const replacement = service.generate(
      generationInput(model, "generate-cancel-isolated-004", {
        prompt: "Replacement prompt",
      }),
    );
    await vi.waitFor(() => expect(pending).toHaveLength(4));
    for (const index of [1, 2, 3]) {
      pending[index]?.response.resolve(Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }));
    }
    await Promise.all([second, third, replacement]);

    expect(service.getWorkspace().assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prompt: "Surviving prompt two" }),
        expect.objectContaining({ prompt: "Surviving prompt three" }),
        expect.objectContaining({ prompt: "Replacement prompt" }),
      ]),
    );
    expect(service.getWorkspace().assets).toHaveLength(3);
  });

  it("returns the committed result when cancellation lands after the workspace commit", async () => {
    const { repository, root, service, model } = await fixture();
    const requestId = "generate-commit-boundary-cancel-001";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] })),
    );
    const setSetting = repository.setSetting.bind(repository);
    let cancelledAtCommit = false;
    vi.spyOn(repository, "setSetting").mockImplementation((key, value) => {
      const result = setSetting(key, value);
      if (!cancelledAtCommit && key === "image.studio.workspace.v1") {
        cancelledAtCommit = true;
        service.cancelRequest(requestId);
      }
      return result;
    });

    const committed = await service.generate(
      generationInput(model, requestId, {
        prompt: "Commit before cancelling",
      }),
    );

    expect(cancelledAtCommit).toBe(true);
    expect(committed.generatedAssets).toHaveLength(1);
    expect(committed.workspace.assets).toHaveLength(1);
    expect(committed.generatedAssets[0]).toMatchObject({
      prompt: "Commit before cancelling",
    });
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toHaveLength(1);
  });

  it("uses the generation-start canvas and preserves newer draft prompts", async () => {
    const { service, model } = await fixture();
    const first = canvas("generation-start-first", "First canvas");
    const second = canvas("generation-start-second", "Second canvas");
    await service.saveWorkspace({
      ...emptyImageStudioWorkspace(),
      documents: [first, second],
      activeDocumentId: second.id,
      prompt: "Original workspace draft",
      negativePrompt: "Original negative draft",
    });
    const response = deferred<Response>();
    const providerFetch = vi.fn(
      (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => response.promise,
    );
    vi.stubGlobal("fetch", providerFetch);

    const generationInputWithTarget = generationInput(model, "generate-captured-canvas-001", {
      prompt: "Request prompt",
      negativePrompt: "Request negative",
      addToActiveCanvas: true,
      targetDocumentId: first.id,
    });
    const generation = service.generate(generationInputWithTarget);
    await vi.waitFor(() => expect(providerFetch).toHaveBeenCalledTimes(1));
    const edited = service.getWorkspace();
    await service.saveWorkspace({
      ...edited,
      prompt: "Newer user draft",
      negativePrompt: "Newer user negative",
    });

    response.resolve(Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }));
    const result = await generation;
    expect(result.workspace.activeDocumentId).toBe(second.id);
    expect(result.workspace.prompt).toBe("Newer user draft");
    expect(result.workspace.negativePrompt).toBe("Newer user negative");
    const assetId = result.generatedAssets[0]?.id;
    if (!assetId) throw new Error("Missing captured canvas asset");
    expect(result.workspace.documents.find((document) => document.id === first.id)?.layers).toEqual(
      [expect.objectContaining({ assetId })],
    );
    expect(
      result.workspace.documents.find((document) => document.id === second.id)?.layers,
    ).toEqual([]);
    expect(result.generatedAssets[0]).toMatchObject({
      prompt: "Request prompt",
      negativePrompt: "Request negative",
    });
  });

  it("saves an asset without resurrecting a canvas deleted during generation", async () => {
    const { service, model } = await fixture();
    const target = canvas("generation-deleted-target", "Deleted target");
    await service.saveWorkspace({
      ...emptyImageStudioWorkspace(),
      documents: [target],
      activeDocumentId: target.id,
    });
    const response = deferred<Response>();
    const providerFetch = vi.fn(
      (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => response.promise,
    );
    vi.stubGlobal("fetch", providerFetch);

    const generation = service.generate(
      generationInput(model, "generate-deleted-canvas-001", {
        prompt: "Keep the asset only",
        addToActiveCanvas: true,
      }),
    );
    await vi.waitFor(() => expect(providerFetch).toHaveBeenCalledTimes(1));
    await service.deleteCanvas(target.id);
    response.resolve(Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }));

    const result = await generation;
    expect(result.generatedAssets).toHaveLength(1);
    expect(result.workspace.assets).toHaveLength(1);
    expect(result.workspace.documents).toEqual([]);
    expect(result.workspace.activeDocumentId).toBeNull();
    await expect(service.listCanvases()).resolves.toEqual([]);
  });

  it("keeps generation active until the 600 second hard timeout", async () => {
    vi.useFakeTimers();
    const { service, model } = await fixture();
    let signal: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        signal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
        });
      }),
    );

    const generation = service.generate(
      generationInput(model, "generate-timeout-600-001", {
        prompt: "Wait for the full generation budget",
      }),
    );
    const generationFailure = expect(generation).rejects.toThrow("请求超过 600 秒");
    await vi.advanceTimersByTimeAsync(0);
    expect(signal).not.toBeNull();
    expect((signal as AbortSignal | null)?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(599_999);
    expect((signal as AbortSignal | null)?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await generationFailure;
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("opens a pending remote URL externally without previewing or consuming its token", async () => {
    const { root, service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ url: "https://cdn.example.test/generated-external.png" }],
        }),
      ),
    );
    const generated = await service.generate(generationInput(model, "generate-external-open-001"));
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing external opening fixture");
    const opener = vi.fn(async (_url: string) => undefined);
    publicHostCheck.mockResolvedValue(undefined);

    await service.openRemoteImageExternal({ id: remoteId, requestId: "external-open-001" }, opener);
    expect(opener).toHaveBeenCalledWith("https://cdn.example.test/generated-external.png");
    expect(publicHostCheck).toHaveBeenCalledWith("https://cdn.example.test/generated-external.png");
    expect(remoteImage).not.toHaveBeenCalled();
    await expect(listAssetFiles(root)).resolves.toEqual([]);

    remoteImage.mockRejectedValueOnce(new Error("preview transport failure"));
    await expect(
      service.previewRemoteImage({ id: remoteId, requestId: "external-preview-fail-001" }),
    ).rejects.toThrow("preview transport failure");
    await expect(
      service.openRemoteImageExternal({ id: remoteId, requestId: "external-open-002" }, opener),
    ).resolves.toBeUndefined();
    expect(opener).toHaveBeenCalledTimes(2);

    remoteImage.mockResolvedValueOnce(downloadedImage());
    await expect(
      service.previewRemoteImage({ id: remoteId, requestId: "external-preview-retry-001" }),
    ).resolves.toMatchObject({ id: remoteId });
    await expect(listAssetFiles(root)).resolves.toEqual([]);
  });

  it("does not invoke the external opener when the host resolves private", async () => {
    const { service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: [{ url: "https://cdn.example.test/private-after-dns.png" }] }),
      ),
    );
    const generated = await service.generate(
      generationInput(model, "generate-external-private-001"),
    );
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing private DNS fixture");
    publicHostCheck.mockRejectedValueOnce(new Error("host resolves to a private address"));
    const opener = vi.fn(async (_url: string) => undefined);

    await expect(
      service.openRemoteImageExternal({ id: remoteId, requestId: "external-private-001" }, opener),
    ).rejects.toThrow("private address");
    expect(opener).not.toHaveBeenCalled();
    expect(remoteImage).not.toHaveBeenCalled();
  });

  it("does not open a candidate discarded while host resolution is pending", async () => {
    const { service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: [{ url: "https://cdn.example.test/discarded-during-dns.png" }] }),
      ),
    );
    const generated = await service.generate(
      generationInput(model, "generate-external-discard-001"),
    );
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing discard-during-DNS fixture");
    const hostCheck = deferred<void>();
    publicHostCheck.mockReturnValueOnce(hostCheck.promise);
    const opener = vi.fn(async (_url: string) => undefined);
    const opening = service.openRemoteImageExternal(
      { id: remoteId, requestId: "external-discard-during-dns-001" },
      opener,
    );
    await vi.waitFor(() =>
      expect(publicHostCheck).toHaveBeenCalledWith(
        "https://cdn.example.test/discarded-during-dns.png",
      ),
    );

    service.discardRemoteImages([remoteId]);
    hostCheck.resolve(undefined);
    await expect(opening).rejects.toThrow("过期或失效");
    expect(opener).not.toHaveBeenCalled();
  });

  it("does not open a candidate that expires while host resolution is pending", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T00:00:00.000Z"));
    const { service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: [{ url: "https://cdn.example.test/expires-during-dns.png" }] }),
      ),
    );
    const generated = await service.generate(
      generationInput(model, "generate-external-expiry-001"),
    );
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing expiry-during-DNS fixture");
    const hostCheck = deferred<void>();
    publicHostCheck.mockReturnValueOnce(hostCheck.promise);
    const opener = vi.fn(async (_url: string) => undefined);
    const opening = service.openRemoteImageExternal(
      { id: remoteId, requestId: "external-expiry-during-dns-001" },
      opener,
    );
    await vi.waitFor(() =>
      expect(publicHostCheck).toHaveBeenCalledWith(
        "https://cdn.example.test/expires-during-dns.png",
      ),
    );

    vi.setSystemTime(new Date("2026-11-27T00:30:00.001Z"));
    hostCheck.resolve(undefined);
    await expect(opening).rejects.toThrow("过期或失效");
    expect(opener).not.toHaveBeenCalled();
  });

  it("rechecks the managed policy after host resolution before opening externally", async () => {
    const { service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: [{ url: "https://cdn.example.test/policy-change-during-dns.png" }] }),
      ),
    );
    const generated = await service.generate(
      generationInput(model, "generate-external-policy-change-001"),
    );
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing dynamic policy fixture");
    const hostCheck = deferred<void>();
    publicHostCheck.mockReturnValueOnce(hostCheck.promise);
    let denyBrowserUse = false;
    const assertOperational = vi.fn();
    const assertCapability = vi.fn((capability: string) => {
      if (denyBrowserUse && capability === "browser.use")
        throw new Error("POLICY_DENIED:browser.use");
    });
    service.setManagedPolicy({
      assertOperational,
      assertCapability,
    } as unknown as ManagedPolicyService);
    const opener = vi.fn(async (_url: string) => undefined);
    const opening = service.openRemoteImageExternal(
      { id: remoteId, requestId: "external-policy-change-001" },
      opener,
    );
    await vi.waitFor(() =>
      expect(publicHostCheck).toHaveBeenCalledWith(
        "https://cdn.example.test/policy-change-during-dns.png",
      ),
    );

    denyBrowserUse = true;
    hostCheck.resolve(undefined);
    await expect(opening).rejects.toThrow("POLICY_DENIED:browser.use");
    expect(assertOperational).toHaveBeenCalledTimes(2);
    expect(
      assertCapability.mock.calls.filter(([capability]) => capability === "network.request"),
    ).toHaveLength(2);
    expect(
      assertCapability.mock.calls.filter(([capability]) => capability === "browser.use"),
    ).toHaveLength(2);
    expect(opener).not.toHaveBeenCalled();
  });

  it.each(["network.request", "browser.use"] as const)(
    "does not open externally when %s is denied",
    async (deniedCapability) => {
      const { service, model } = await fixture();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ data: [{ url: "https://cdn.example.test/policy-denied.png" }] }),
        ),
      );
      const generated = await service.generate(
        generationInput(model, `generate-policy-${deniedCapability.replace(".", "-")}`),
      );
      const remoteId = generated.remoteImages?.[0]?.id;
      if (!remoteId) throw new Error("Missing policy fixture");
      const assertCapability = vi.fn((capability: string) => {
        if (capability === deniedCapability) throw new Error(`POLICY_DENIED:${capability}`);
      });
      service.setManagedPolicy({
        assertOperational: vi.fn(),
        assertCapability,
      } as unknown as ManagedPolicyService);
      const opener = vi.fn(async (_url: string) => undefined);

      await expect(
        service.openRemoteImageExternal(
          { id: remoteId, requestId: `external-policy-${deniedCapability.replace(".", "-")}` },
          opener,
        ),
      ).rejects.toThrow(`POLICY_DENIED:${deniedCapability}`);
      expect(opener).not.toHaveBeenCalled();
      expect(publicHostCheck).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown remote token before invoking the external opener", async () => {
    const { service } = await fixture();
    const opener = vi.fn(async (_url: string) => undefined);
    await expect(
      service.openRemoteImageExternal(
        {
          id: "11111111-1111-4111-8111-111111111111",
          requestId: "external-unknown-001",
        },
        opener,
      ),
    ).rejects.toThrow("过期或失效");
    expect(opener).not.toHaveBeenCalled();
  });

  it("keeps validated Base64 output, defers remote download, and saves confirmed bytes with original prompts", async () => {
    const { root, service, model } = await fixture();
    const providerFetch = vi.fn(async () =>
      Response.json({
        data: [
          { b64_json: TINY_PNG_BASE64, revised_prompt: "Local revision" },
          {
            url: "https://cdn.example.test/generated.png",
            revised_prompt: "Remote revision",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const generationRequestId = "generate-remote-001";
    const generated = await service.generate(
      generationInput(model, generationRequestId, {
        generation: {
          ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
          imageCount: 2,
        },
      }),
    );

    expect(generated.generatedAssets).toHaveLength(1);
    expect(generated.generatedAssets[0]).toMatchObject({
      prompt: "Original positive prompt",
      negativePrompt: "Original negative prompt",
      revisedPrompt: "Local revision",
    });
    expect(generated.remoteImages).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        expiresAt: expect.any(String),
      }),
    ]);
    expect(generated.remoteImages?.[0]).not.toHaveProperty("sourceUrl");
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing remote image token");
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(remoteImage).not.toHaveBeenCalled();
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toHaveLength(1);

    remoteImage.mockResolvedValueOnce(downloadedImage());
    const preview = await service.previewRemoteImage({
      id: remoteId,
      requestId: "preview-remote-001",
    });
    expect(preview).toMatchObject({
      id: remoteId,
      sourceHost: "cdn.example.test",
      mimeType: "image/png",
      width: 1,
      height: 1,
      size: Buffer.from(TINY_PNG_BASE64, "base64").length,
      prompt: "Original positive prompt",
      negativePrompt: "Original negative prompt",
      revisedPrompt: "Remote revision",
    });
    expect(preview.dataUrl).toBe(`data:image/png;base64,${TINY_PNG_BASE64}`);
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toHaveLength(1);

    const current = service.getWorkspace();
    await service.saveWorkspace({
      ...current,
      prompt: "Edited after generation",
      negativePrompt: "Edited negative",
    });
    const saved = await service.saveRemoteImage({
      id: remoteId,
      requestId: "save-remote-001",
    });
    expect(saved.generatedAssets).toHaveLength(1);
    expect(saved.generatedAssets[0]).toMatchObject({
      source: "generated",
      prompt: "Original positive prompt",
      negativePrompt: "Original negative prompt",
      revisedPrompt: "Remote revision",
      mimeType: "image/png",
      width: 1,
      height: 1,
      model,
    });
    expect(saved.warnings).toContainEqual(
      expect.objectContaining({
        code: "size_mismatch",
        actualWidth: 1,
        actualHeight: 1,
      }),
    );
    expect(saved.workspace.prompt).toBe("Edited after generation");
    expect(saved.workspace.negativePrompt).toBe("Edited negative");
    expect(saved.workspace.documents).toEqual([]);
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toHaveLength(2);
    expect(remoteImage).toHaveBeenCalledTimes(1);
  });

  it("preserves valid Base64 output when another candidate has an unsafe URL", async () => {
    const { service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            { b64_json: TINY_PNG_BASE64, revised_prompt: "Keep this image" },
            { url: "http://127.0.0.1/private.png", revised_prompt: "Unsafe URL" },
          ],
        }),
      ),
    );

    const generationRequestId = "generate-mixed-unsafe-001";
    const generated = await service.generate(
      generationInput(model, generationRequestId, {
        generation: {
          ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
          imageCount: 2,
        },
      }),
    );
    expect(generated.generatedAssets).toHaveLength(1);
    expect(generated.generatedAssets[0]?.revisedPrompt).toBe("Keep this image");
    expect(generated.remoteImages ?? []).toEqual([]);
    expect(generated.remoteWarnings?.join("\n")).toMatch(/URL|HTTPS|远程/);
    expect(remoteImage).not.toHaveBeenCalled();
  });

  it("skips only non-PNG/WebP Base64 results for transparent requests and keeps URL output", async () => {
    const { service, model } = await fixture();
    const jpeg = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 220, g: 70, b: 40 },
      },
    })
      .jpeg()
      .toBuffer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            { b64_json: jpeg.toString("base64"), revised_prompt: "JPEG should be skipped" },
            {
              url: "https://cdn.example.test/transparent.png",
              revised_prompt: "Remote transparent result",
            },
          ],
        }),
      ),
    );

    const generated = await service.generate(
      generationInput(model, "generate-transparent-mixed-001", {
        generation: {
          ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
          imageCount: 2,
          transparentBackground: true,
        },
      }),
    );

    expect(generated.generatedAssets).toEqual([]);
    expect(generated.workspace.assets).toEqual([]);
    expect(generated.remoteImages).toHaveLength(1);
    expect(generated.remoteWarnings?.join("\n")).toMatch(/透明背景.*PNG.*WebP/);
    expect(remoteImage).not.toHaveBeenCalled();
  });

  it("keeps a previewable URL when Base64 import fails because the asset library is full", async () => {
    const { service, model } = await fixture();
    await fillAssetLibrary(service);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            { b64_json: TINY_PNG_BASE64, revised_prompt: "Cannot fit locally" },
            {
              url: "https://cdn.example.test/library-full.png",
              revised_prompt: "Remote fallback",
            },
          ],
        }),
      ),
    );

    const generated = await service.generate(
      generationInput(model, "generate-import-fallback-001", {
        generation: {
          ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
          imageCount: 2,
        },
      }),
    );

    expect(generated.generatedAssets).toEqual([]);
    expect(generated.workspace.assets).toHaveLength(IMAGE_STUDIO_MAX_ASSETS);
    expect(generated.remoteImages).toHaveLength(1);
    expect(generated.remoteWarnings?.join("\n")).toMatch(/Base64.*本地.*URL/);
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing fallback remote image token");
    remoteImage.mockResolvedValueOnce(downloadedImage());
    await expect(
      service.previewRemoteImage({
        id: remoteId,
        requestId: "preview-import-fallback-001",
      }),
    ).resolves.toMatchObject({
      id: remoteId,
      revisedPrompt: "Remote fallback",
      mimeType: "image/png",
    });
  });

  it("allows a failed preview to be retried and never writes remote bytes before confirmation", async () => {
    const { root, service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ url: "https://cdn.example.test/retry.png", revised_prompt: "Retry fixture" }],
        }),
      ),
    );
    const generationRequestId = "generate-retry-001";
    const generated = await service.generate(generationInput(model, generationRequestId));
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing retry remote image token");

    remoteImage.mockRejectedValueOnce(new Error("temporary image transport failure"));
    await expect(
      service.previewRemoteImage({
        id: remoteId,
        requestId: "preview-failure-001",
      }),
    ).rejects.toThrow("temporary image transport failure");
    await expect(listAssetFiles(root)).resolves.toEqual([]);

    remoteImage.mockResolvedValueOnce(downloadedImage());
    await expect(
      service.previewRemoteImage({
        id: remoteId,
        requestId: "preview-retry-001",
      }),
    ).resolves.toMatchObject({ id: remoteId, mimeType: "image/png" });
    await expect(listAssetFiles(root)).resolves.toEqual([]);

    const saved = await service.saveRemoteImage({
      id: remoteId,
      requestId: "save-retry-001",
    });
    expect(saved.generatedAssets).toHaveLength(1);
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toHaveLength(1);
    await expect(
      service.saveRemoteImage({
        id: remoteId,
        requestId: "save-retry-002",
      }),
    ).rejects.toThrow(/过期|预览|不存在|expired|preview/i);
  });

  it("discards previews idempotently and invalidates their save token", async () => {
    const { service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ url: "https://cdn.example.test/discard.png" }],
        }),
      ),
    );
    const generationRequestId = "generate-discard-001";
    const generated = await service.generate(generationInput(model, generationRequestId));
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing discard remote image token");

    remoteImage.mockResolvedValueOnce(downloadedImage());
    await service.previewRemoteImage({
      id: remoteId,
      requestId: "preview-discard-001",
    });
    expect(() => service.discardRemoteImages([remoteId])).not.toThrow();
    expect(() => service.discardRemoteImages([remoteId])).not.toThrow();
    await expect(
      service.previewRemoteImage({
        id: remoteId,
        requestId: "preview-after-discard-001",
      }),
    ).rejects.toThrow(/过期|不存在|expired|missing/i);
    await expect(
      service.saveRemoteImage({
        id: remoteId,
        requestId: "save-after-discard-001",
      }),
    ).rejects.toThrow(/预览|preview/i);
  });

  it("expires unconfirmed remote previews after 30 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T00:00:00.000Z"));
    const { service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ url: "https://cdn.example.test/expiry.png" }],
        }),
      ),
    );
    const generationRequestId = "generate-expiry-001";
    const generated = await service.generate(generationInput(model, generationRequestId));
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing expiring remote image token");

    remoteImage.mockResolvedValueOnce(downloadedImage());
    await service.previewRemoteImage({
      id: remoteId,
      requestId: "preview-expiry-001",
    });
    vi.setSystemTime(new Date("2026-11-25T00:30:00.001Z"));
    await expect(
      service.previewRemoteImage({
        id: remoteId,
        requestId: "preview-expiry-002",
      }),
    ).rejects.toThrow(/过期|expired/i);
    await expect(
      service.saveRemoteImage({
        id: remoteId,
        requestId: "save-expiry-001",
      }),
    ).rejects.toThrow(/过期|expired/i);
  });

  it("caps all pending URL candidates at 30 while preserving Base64 output at capacity", async () => {
    const { service, model } = await fixture();
    let generation = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        generation += 1;
        return Response.json({
          data: Array.from({ length: 10 }, (_, index) => ({
            url: `https://cdn.example.test/batch-${generation}-${index}.png`,
          })),
        });
      }),
    );

    for (let index = 1; index <= 3; index += 1) {
      const result = await service.generate(
        generationInput(model, `generate-pending-${index}`, {
          generation: {
            ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
            imageCount: 10,
          },
        }),
      );
      expect(result.generatedAssets).toEqual([]);
      expect(result.remoteImages).toHaveLength(10);
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            { b64_json: TINY_PNG_BASE64, revised_prompt: "Keep at capacity" },
            ...Array.from({ length: 9 }, (_, index) => ({
              url: `https://cdn.example.test/dropped-${index}.png`,
            })),
          ],
        }),
      ),
    );
    const fourth = await service.generate(
      generationInput(model, "generate-pending-4", {
        generation: {
          ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
          imageCount: 10,
        },
      }),
    );
    expect(fourth.generatedAssets).toHaveLength(1);
    expect(fourth.generatedAssets[0]?.revisedPrompt).toBe("Keep at capacity");
    expect(fourth.remoteImages ?? []).toEqual([]);
    expect(fourth.remoteWarnings?.join("\n")).toMatch(/最多保留 30 张/);
  });

  it("keeps the shared remote preview cache budget at 100 MiB", () => {
    expect(IMAGE_STUDIO_MAX_REMOTE_PREVIEW_BYTES).toBe(100 * 1024 * 1024);
    expect(canReserveRemoteImagePreviewBytes(0, IMAGE_STUDIO_MAX_REMOTE_PREVIEW_BYTES)).toBe(true);
    expect(
      canReserveRemoteImagePreviewBytes(
        IMAGE_STUDIO_MAX_REMOTE_PREVIEW_BYTES,
        IMAGE_STUDIO_MAX_REMOTE_PREVIEW_BYTES,
      ),
    ).toBe(false);
    expect(canReserveRemoteImagePreviewBytes(-1, 1)).toBe(false);
    expect(canReserveRemoteImagePreviewBytes(0, 0)).toBe(false);
  });

  it("uses a fresh request ID per operation and preserves a pending token after cancellation", async () => {
    const { service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ url: "https://cdn.example.test/cancel.png" }],
        }),
      ),
    );
    const generated = await service.generate(generationInput(model, "generate-cancel-001"));
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing cancel remote image token");

    let downloadSignal: AbortSignal | null = null;
    remoteImage.mockImplementationOnce(
      async (_url, signal) =>
        new Promise<ImageGenerationPayload>((_resolve, reject) => {
          downloadSignal = signal;
          signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), {
            once: true,
          });
        }),
    );
    const preview = service.previewRemoteImage({
      id: remoteId,
      requestId: "preview-cancel-001",
    });
    await vi.waitFor(() => expect(downloadSignal).not.toBeNull());
    service.cancelRequest("preview-cancel-001");
    await expect(preview).rejects.toThrow(/取消|canceled|aborted/i);
    expect((downloadSignal as AbortSignal | null)?.aborted).toBe(true);

    remoteImage.mockResolvedValueOnce(downloadedImage());
    await expect(
      service.previewRemoteImage({
        id: remoteId,
        requestId: "preview-after-cancel-001",
      }),
    ).resolves.toMatchObject({ id: remoteId, mimeType: "image/png" });
    await expect(
      service.saveRemoteImage({
        id: remoteId,
        requestId: "save-after-cancel-001",
      }),
    ).resolves.toMatchObject({ generatedAssets: [{ id: expect.any(String) }] });
  });

  it("aborts an active remote download and clears pending previews on dispose", async () => {
    const { service, model } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ url: "https://cdn.example.test/dispose.png" }],
        }),
      ),
    );
    const generated = await service.generate(generationInput(model, "generate-dispose-001"));
    const remoteId = generated.remoteImages?.[0]?.id;
    if (!remoteId) throw new Error("Missing dispose remote image token");

    let downloadSignal: AbortSignal | null = null;
    remoteImage.mockImplementationOnce(
      async (_url, signal) =>
        new Promise<ImageGenerationPayload>((_resolve, reject) => {
          downloadSignal = signal;
          signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), {
            once: true,
          });
        }),
    );
    const preview = service.previewRemoteImage({
      id: remoteId,
      requestId: "preview-dispose-001",
    });
    await vi.waitFor(() => expect(downloadSignal).not.toBeNull());
    await service.dispose();
    await expect(preview).rejects.toThrow(/关闭|取消|canceled|aborted/i);
    expect((downloadSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(() => service.discardRemoteImages([remoteId])).not.toThrow();
  });
});
