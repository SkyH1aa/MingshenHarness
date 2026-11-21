import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyImageStudioWorkspace, type ImageStudioAsset } from "../../shared/image-studio";
import * as imageValidation from "../providers/image-validation";
import type { ProviderService } from "../providers/provider-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ImageStudioService } from "./image-studio-service";

const databases: ReturnType<typeof openDatabase>[] = [];
const temporaryRoots: string[] = [];
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function asset(id: string): ImageStudioAsset {
  return {
    id,
    name: "fixture.png",
    mimeType: "image/png",
    size: 68,
    width: 1,
    height: 1,
    source: "generated",
    createdAt: "2026-11-20T00:00:00.000Z",
    prompt: "Fixture",
    model: null,
  };
}

async function visionFixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Vision fixture",
    baseUrl: "https://images.invalid/v1",
    protocol: "openai_chat_completions",
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "vision-model",
    displayName: "Vision model",
    contextWindow: 8_192,
    maxOutputTokens: 1_024,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository.getProvider(provider.id)?.models[0];
  if (!model) throw new Error("Missing fixture vision model");
  const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-"));
  temporaryRoots.push(root);
  const service = new ImageStudioService(
    repository,
    {
      getProvider: () => repository.getProvider(provider.id),
      getActiveApiKey: () => "fixture-key",
    } as unknown as ProviderService,
    root,
  );
  const imported = await service.importAssets([
    { name: "fixture.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
  ]);
  const importedAsset = imported.assets[0];
  if (!importedAsset) throw new Error("Missing imported fixture asset");
  return {
    repository,
    service,
    root,
    importedAsset,
    model: { providerId: provider.id, modelId: model.id },
  };
}

describe("image studio workspace safety", () => {
  it("never accepts caller-supplied assets or restores removed layer references", () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const service = new ImageStudioService(
      repository,
      {} as ProviderService,
      "C:\\fixture-user-data",
    );
    const valid = asset("11111111-1111-4111-8111-111111111111");
    const workspace = {
      ...emptyImageStudioWorkspace(),
      documents: [
        {
          id: "canvas",
          name: "Canvas",
          width: 640,
          height: 480,
          background: "#101619",
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
          createdAt: "",
          updatedAt: "",
          layers: [
            {
              id: "layer",
              assetId: valid.id,
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              rotation: 0,
              opacity: 1,
              zIndex: 0,
            },
          ],
        },
      ],
    };

    const saved = service.saveWorkspace({
      ...workspace,
      assets: [valid, asset("../outside")],
    });

    expect(saved.assets).toEqual([]);
    expect(saved.documents[0]?.layers).toEqual([]);
    expect(service.getWorkspace().assets).toEqual([]);
  });

  it("preserves concurrent imports and newer canvas state at commit", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const file = { name: "fixture.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` };
    const first = service.importAssets([file]);
    const second = service.importAssets([file]);
    service.saveWorkspace({ ...emptyImageStudioWorkspace(), prompt: "Latest canvas" });
    await Promise.all([first, second]);
    expect(service.getWorkspace().assets).toHaveLength(2);
    expect(service.getWorkspace().prompt).toBe("Latest canvas");
    const stale = service.getWorkspace();
    await service.removeAsset(stale.assets[0]?.id);
    expect(service.saveWorkspace(stale).assets).toHaveLength(1);
    await service.dispose();
  });

  it("waits for an in-flight import, discards its files and prevents writes after disposal", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const detect = imageValidation.detectImage;
    vi.spyOn(imageValidation, "detectImage").mockImplementation(async (...args) => {
      entered();
      await waiting;
      return detect(...args);
    });
    const setSetting = vi.spyOn(repository, "setSetting");
    const importing = service.importAssets([
      { name: "fixture.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const importingResult = expect(importing).rejects.toThrow("正在关闭");
    await started;
    let settled = false;
    const disposing = service.dispose().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await importingResult;
    await disposing;
    expect(setSetting).not.toHaveBeenCalled();
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toEqual([]);
    expect(() => service.saveWorkspace(emptyImageStudioWorkspace())).toThrow("正在关闭");
    await expect(service.importAssets([])).rejects.toThrow("正在关闭");
  });

  it("rejects corrupted or changed assets before reading or sending them to a provider", async () => {
    const { repository, service, root, importedAsset, model } = await visionFixture();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const path = join(root, "image-studio", "assets", `${importedAsset.id}.png`);

    await writeFile(path, Buffer.alloc(importedAsset.size));
    await expect(service.getAssetData(importedAsset.id)).rejects.toThrow();
    await expect(
      service.reversePrompt({ requestId: "corrupted-asset", model, assetId: importedAsset.id }),
    ).rejects.toThrow();

    await writeFile(path, Buffer.alloc(importedAsset.size + 1));
    await expect(service.getAssetData(importedAsset.id)).rejects.toThrow("变化或损坏");

    await writeFile(path, Buffer.from(TINY_PNG_BASE64, "base64"));
    const current = service.getWorkspace();
    repository.setSetting("image.studio.workspace.v1", {
      ...current,
      assets: current.assets.map((item) => ({ ...item, width: item.width + 1 })),
    });
    await expect(service.getAssetData(importedAsset.id)).rejects.toThrow("尺寸");
    expect(fetch).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("cancels reverse prompting during asset validation without contacting the provider", async () => {
    const { service, importedAsset, model } = await visionFixture();
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const detect = imageValidation.detectImage;
    vi.spyOn(imageValidation, "detectImage").mockImplementation(async (...args) => {
      entered();
      await waiting;
      return detect(...args);
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const reverse = service.reversePrompt({
      requestId: "cancel-while-validating",
      model,
      assetId: importedAsset.id,
    });
    const reverseResult = expect(reverse).rejects.toThrow("已取消");
    await started;
    service.cancelRequest("cancel-while-validating");
    release();
    await reverseResult;
    expect(fetch).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("aborts and drains a request that completes after shutdown begins", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const provider = repository.insertProvider({
      name: "Fixture",
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
    if (!model) throw new Error("Missing fixture model");
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(
      repository,
      {
        getProvider: () => repository.getProvider(provider.id),
        getActiveApiKey: () => "fixture-key",
      } as unknown as ProviderService,
      root,
    );
    let resolveFetch!: (response: Response) => void;
    let fetchStarted!: () => void;
    let signal: AbortSignal | null = null;
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        fetchStarted();
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }),
    );
    const setSetting = vi.spyOn(repository, "setSetting");
    const generating = service.generate({
      requestId: "shutdown-request",
      model: { providerId: provider.id, modelId: model.id },
      prompt: "Fixture",
      size: "1024x1024",
    });
    const generatingResult = expect(generating).rejects.toThrow("已取消");
    await started;
    let settled = false;
    const disposing = service.dispose().then(() => {
      settled = true;
    });
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveFetch(Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }));
    await generatingResult;
    await disposing;
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("removes a generated image when saving its workspace fails", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const provider = repository.insertProvider({
      name: "Image gateway",
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
    if (!model) throw new Error("Fixture image model missing.");

    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-"));
    temporaryRoots.push(root);
    const providerService = {
      getProvider: (providerId: string) => {
        const stored = repository.getProvider(providerId);
        if (!stored) throw new Error("Fixture provider missing.");
        return stored;
      },
      getActiveApiKey: () => "fixture-key",
    } as unknown as ProviderService;
    const service = new ImageStudioService(repository, providerService, root);
    const previousWorkspace = {
      ...emptyImageStudioWorkspace(),
      prompt: "Keep the existing workspace",
    };
    repository.setSetting("image.studio.workspace.v1", previousWorkspace);
    vi.spyOn(repository, "setSetting").mockImplementation(() => {
      throw new Error("workspace save failed");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ b64_json: TINY_PNG_BASE64, revised_prompt: "Generated fixture" }],
        }),
      ),
    );

    await expect(
      service.generate({
        requestId: "request-save-failure",
        model: { providerId: provider.id, modelId: model.id },
        prompt: "Generate a fixture",
        size: "1024x1024",
      }),
    ).rejects.toThrow("workspace save failed");

    expect(repository.getSetting("image.studio.workspace.v1")).toEqual(previousWorkspace);
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toEqual([]);
  });
});
