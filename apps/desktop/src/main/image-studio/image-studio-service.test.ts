import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
  emptyImageStudioWorkspace,
  IMAGE_STUDIO_MAX_EXPORT_BYTES,
  IMAGE_STUDIO_MAX_SINGLE_BYTES,
  type ImageStudioAsset,
  type ImageStudioCanvas,
} from "../../shared/image-studio";
import * as imageValidation from "../providers/image-validation";
import type { ProviderService } from "../providers/provider-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ImageStudioService } from "./image-studio-service";

const fsFailure = vi.hoisted(() => ({
  renameSource: null as string | null,
  renameDestinations: [] as string[],
  unlinkSources: [] as string[],
}));
const sharpFailure = vi.hoisted(() => ({
  pngOutput: null as Buffer | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fsFailure.renameSource === args[0]) {
        fsFailure.renameSource = null;
        throw Object.assign(new Error("project file is locked"), { code: "EPERM" });
      }
      if (fsFailure.renameDestinations[0] === args[1]) {
        fsFailure.renameDestinations.shift();
        throw Object.assign(new Error("project destination is locked"), { code: "EPERM" });
      }
      return actual.rename(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (fsFailure.unlinkSources[0] === args[0]) {
        fsFailure.unlinkSources.shift();
        throw Object.assign(new Error("asset file is locked"), { code: "EPERM" });
      }
      return actual.unlink(...args);
    },
  };
});

vi.mock("sharp", async (importOriginal) => {
  const actualModule = await importOriginal<typeof import("sharp")>();
  const actual = actualModule.default;
  const wrapped = ((...args: Parameters<typeof actual>) => {
    const pipeline = actual(...args);
    if (!sharpFailure.pngOutput) return pipeline;
    return new Proxy(pipeline, {
      get(target, property, receiver) {
        if (property === "png") {
          return () => ({
            toBuffer: async () => sharpFailure.pngOutput as Buffer,
          });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof actual;
  Object.assign(wrapped, actual);
  return { ...actualModule, default: wrapped };
});

const databases: ReturnType<typeof openDatabase>[] = [];
const temporaryRoots: string[] = [];
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TINY_GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function colorPngDataUrl(color: string): string {
  const canvas = createCanvas(1, 1);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
}

function bytesFromDataUrl(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.replace(/^data:[^;]+;base64,/, ""), "base64");
}

afterEach(async () => {
  fsFailure.renameSource = null;
  fsFailure.renameDestinations = [];
  fsFailure.unlinkSources = [];
  sharpFailure.pngOutput = null;
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
    negativePrompt: null,
    revisedPrompt: null,
    promptOrigin: "mingshen_generated",
    promptMetadataVersion: 1,
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

async function imageOutputFixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Image output fixture",
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
  if (!model) throw new Error("Missing fixture image model");
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
  return {
    repository,
    service,
    root,
    model: { providerId: provider.id, modelId: model.id },
  };
}

describe("image studio workspace safety", () => {
  it("retains selections up to the complete 200-asset library limit", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-selection-limit-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const assets = Array.from({ length: 200 }, (_, index) => asset(`selected-${index}`));
    repository.setSetting("image.studio.workspace.v1", {
      ...emptyImageStudioWorkspace(),
      assets,
      selectedAssetIds: assets.map((item) => item.id),
    });

    expect(service.getWorkspace().selectedAssetIds).toHaveLength(200);
    await service.dispose();
  });

  it("migrates canvas files, closes tabs without deleting projects, and restores them after restart", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-library-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const imported = await service.importAssets([
      { name: "fixture.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing imported fixture asset");
    const document: ImageStudioCanvas = {
      id: "canvas-reopen",
      name: "Saved local canvas",
      width: 800,
      height: 600,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
      layers: [
        {
          id: "fixture-layer",
          assetId: image.id,
          x: 10,
          y: 20,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
        },
      ],
    };
    await service.saveWorkspace({
      ...imported,
      activeDocumentId: document.id,
      documents: [document],
    });
    const projectPath = join(root, "image-studio", "canvases", `${document.id}.mingcanvas.json`);
    await expect(readFile(projectPath, "utf8")).resolves.toContain("Saved local canvas");

    await expect(service.closeCanvas(document.id)).resolves.toMatchObject({ documents: [] });
    await expect(readFile(projectPath)).resolves.toBeInstanceOf(Buffer);
    await expect(service.openCanvas(document.id)).resolves.toMatchObject({
      activeDocumentId: document.id,
      documents: [{ id: document.id, layers: [{ id: "fixture-layer", assetId: image.id }] }],
    });
    await service.dispose();

    const restarted = new ImageStudioService(repository, {} as ProviderService, root);
    await expect(restarted.loadWorkspace()).resolves.toMatchObject({
      activeDocumentId: document.id,
      documents: [{ id: document.id, name: "Saved local canvas" }],
    });
    await restarted.dispose();
  });

  it("restores canvas layers from project asset metadata when the SQLite index is incomplete", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-project-source-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const imported = await service.importAssets([
      { name: "fixture.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing imported fixture asset");
    const document: ImageStudioCanvas = {
      id: "canvas-project-source",
      name: "Project source",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [
        {
          id: "project-source-layer",
          assetId: image.id,
          x: 10,
          y: 20,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
        },
      ],
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
    };
    const saved = await service.saveWorkspace({
      ...imported,
      activeDocumentId: document.id,
      documents: [document],
    });
    repository.setSetting("image.studio.workspace.v1", {
      ...saved,
      assets: [],
      documents: saved.documents,
    });

    await expect(service.loadWorkspace()).resolves.toMatchObject({
      assets: [{ id: image.id }],
      documents: [{ id: document.id, layers: [{ id: "project-source-layer", assetId: image.id }] }],
    });
    expect(repository.getSetting("image.studio.workspace.v1")).toMatchObject({
      assets: [{ id: image.id }],
      documents: [{ layers: [{ id: "project-source-layer", assetId: image.id }] }],
    });
    await service.dispose();
  });

  it("recovers an old SQLite-only workspace into the local canvas library", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-migration-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const imported = await service.importAssets([
      { name: "fixture.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing imported fixture asset");
    const document: ImageStudioCanvas = {
      id: "legacy-canvas",
      name: "Legacy canvas",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 0.7,
      offsetX: 0,
      offsetY: 0,
      layers: [],
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
    };
    repository.setSetting("image.studio.workspace.v1", {
      ...imported,
      activeDocumentId: document.id,
      documents: [document],
    });
    repository.setSetting("image.studio.workspace.v1.canvas-library-migrated", false);
    await rm(join(root, "image-studio", "canvases", `${document.id}.mingcanvas.json`), {
      force: true,
    });
    await service.dispose();

    const migrated = new ImageStudioService(repository, {} as ProviderService, root);
    await expect(migrated.loadWorkspace()).resolves.toMatchObject({
      activeDocumentId: document.id,
      documents: [{ id: document.id, name: "Legacy canvas" }],
    });
    await expect(
      readFile(join(root, "image-studio", "canvases", `${document.id}.mingcanvas.json`), "utf8"),
    ).resolves.toContain("Legacy canvas");
    expect(repository.getSetting("image.studio.workspace.v1.canvas-library-backup")).toMatchObject({
      activeDocumentId: document.id,
      assets: [{ id: image.id }],
    });

    repository.removeSetting("image.studio.workspace.v1.canvas-library-backup");
    await migrated.importAssets([
      { name: "later.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    expect(repository.hasSetting("image.studio.workspace.v1.canvas-library-backup")).toBe(false);
    await migrated.loadWorkspace();
    expect(repository.getSetting("image.studio.workspace.v1.canvas-library-backup")).toMatchObject({
      assets: [{ id: image.id }, { name: "later.png" }],
    });
    await migrated.dispose();
  });

  it("restores a referenced canvas left in trash after an interrupted delete", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-trash-recovery-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const document: ImageStudioCanvas = {
      id: "canvas-interrupted-delete",
      name: "SQLite snapshot",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [],
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
    };
    await service.saveWorkspace({
      ...emptyImageStudioWorkspace(),
      activeDocumentId: document.id,
      documents: [document],
    });
    const projectPath = join(root, "image-studio", "canvases", `${document.id}.mingcanvas.json`);
    const project = JSON.parse(await readFile(projectPath, "utf8")) as {
      canvas: ImageStudioCanvas;
    };
    project.canvas.name = "Newest on-disk project";
    await writeFile(projectPath, JSON.stringify(project), "utf8");
    const trashDirectory = join(root, "image-studio", "canvases", ".trash");
    const trashPath = join(
      trashDirectory,
      `${document.id}.00000000-0000-0000-0000-000000000000.json`,
    );
    await rename(projectPath, trashPath);
    await service.dispose();

    const restarted = new ImageStudioService(repository, {} as ProviderService, root);
    await expect(restarted.loadWorkspace()).resolves.toMatchObject({
      documents: [{ id: document.id, name: "Newest on-disk project" }],
    });
    await expect(readFile(projectPath, "utf8")).resolves.toContain("Newest on-disk project");
    await expect(readdir(trashDirectory)).resolves.toEqual([]);
    await restarted.dispose();
  });

  it("fails closed when a referenced trash project cannot be restored", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-trash-locked-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const document: ImageStudioCanvas = {
      id: "canvas-locked-recovery",
      name: "Preserve this project",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [],
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
    };
    await service.saveWorkspace({
      ...emptyImageStudioWorkspace(),
      activeDocumentId: document.id,
      documents: [document],
    });
    const projectPath = join(root, "image-studio", "canvases", `${document.id}.mingcanvas.json`);
    const trashDirectory = join(root, "image-studio", "canvases", ".trash");
    const trashPath = join(
      trashDirectory,
      `${document.id}.00000000-0000-0000-0000-000000000000.json`,
    );
    await rename(projectPath, trashPath);
    await service.dispose();

    const restarted = new ImageStudioService(repository, {} as ProviderService, root);
    fsFailure.renameSource = trashPath;
    await expect(restarted.loadWorkspace()).rejects.toThrow("工程仍保留在回收区");
    await expect(readFile(trashPath, "utf8")).resolves.toContain("Preserve this project");
    await expect(readFile(projectPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(restarted.getWorkspace().documents).toMatchObject([{ id: document.id }]);
    await restarted.dispose();
  });

  it("removes deleted asset prompt metadata from the legacy workspace backup", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-prompt-backup-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const imported = await service.importAssets([
      { name: "prompted.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing prompt backup fixture asset");
    const promptedAsset = {
      ...image,
      source: "generated" as const,
      prompt: "DELETE_PROMPT_CANARY",
      negativePrompt: "DELETE_NEGATIVE_CANARY",
      revisedPrompt: "DELETE_REVISED_CANARY",
      promptOrigin: "mingshen_generated" as const,
      promptMetadataVersion: 1 as const,
    };
    repository.setSetting("image.studio.workspace.v1", {
      ...service.getWorkspace(),
      assets: [promptedAsset],
    });
    repository.removeSetting("image.studio.workspace.v1.canvas-library-backup");
    repository.setSetting("image.studio.workspace.v1.canvas-library-migrated", false);

    await service.loadWorkspace();
    expect(
      JSON.stringify(repository.getSetting("image.studio.workspace.v1.canvas-library-backup")),
    ).toContain("DELETE_PROMPT_CANARY");
    await service.removeAsset(image.id);

    const backup = repository.getSetting("image.studio.workspace.v1.canvas-library-backup");
    expect(backup).toMatchObject({ assets: [], selectedAssetIds: [] });
    expect(JSON.stringify(backup)).not.toContain("DELETE_PROMPT_CANARY");
    expect(JSON.stringify(backup)).not.toContain("DELETE_NEGATIVE_CANARY");
    expect(JSON.stringify(backup)).not.toContain("DELETE_REVISED_CANARY");
    await service.dispose();
  });

  it("retries stale canvas trash cleanup and refuses asset deletion while prompt-bearing trash is locked", async () => {
    const { service, root, importedAsset } = await visionFixture();
    const trashDirectory = join(root, "image-studio", "canvases", ".trash");
    const trashPath = join(
      trashDirectory,
      "deleted-canvas.00000000-0000-0000-0000-000000000000.json",
    );
    await writeFile(trashPath, "TRASHED_PROMPT_CANARY", "utf8");
    fsFailure.unlinkSources = [trashPath];

    await expect(service.removeAsset(importedAsset.id)).rejects.toThrow("素材删除已取消");
    expect(service.getWorkspace().assets.map((item) => item.id)).toEqual([importedAsset.id]);
    await expect(readFile(trashPath, "utf8")).resolves.toBe("TRASHED_PROMPT_CANARY");

    await expect(service.removeAsset(importedAsset.id)).resolves.toMatchObject({ assets: [] });
    await expect(readFile(trashPath)).rejects.toMatchObject({ code: "ENOENT" });
    await service.dispose();
  });

  it("renames and duplicates projects with new layer identifiers while protecting shared assets", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-copy-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const imported = await service.importAssets([
      { name: "fixture.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing imported fixture asset");
    const document: ImageStudioCanvas = {
      id: "canvas-copy-source",
      name: "Source",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [
        {
          id: "source-layer",
          assetId: image.id,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
        },
      ],
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
    };
    await service.saveWorkspace({
      ...imported,
      activeDocumentId: document.id,
      documents: [document],
    });
    await service.renameCanvas(document.id, "Renamed source");
    const duplicate = await service.duplicateCanvas(document.id);
    const copy = duplicate.documents.find((item) => item.id !== document.id);
    expect(copy).toMatchObject({ name: "Renamed source（副本）", layers: [{ assetId: image.id }] });
    expect(copy?.id).not.toBe(document.id);
    expect(copy?.layers[0]?.id).not.toBe(document.layers[0]?.id);
    expect(duplicate.assets).toHaveLength(1);
    const projects = await service.listCanvases();
    expect(projects).toHaveLength(2);
    expect(projects.every((project) => project.available)).toBe(true);
    await service.dispose();
  });

  it("does not close a canvas when deleting its project file fails", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-delete-lock-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const document: ImageStudioCanvas = {
      id: "canvas-delete-lock",
      name: "Delete lock",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [],
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
    };
    await service.saveWorkspace({
      ...emptyImageStudioWorkspace(),
      activeDocumentId: document.id,
      documents: [document],
    });
    const projectPath = join(root, "image-studio", "canvases", `${document.id}.mingcanvas.json`);
    fsFailure.renameSource = projectPath;

    await expect(service.deleteCanvas(document.id)).rejects.toThrow("project file is locked");
    expect(fsFailure.renameSource).toBeNull();
    expect(service.getWorkspace().documents).toMatchObject([{ id: document.id }]);
    await expect(readFile(projectPath)).resolves.toBeInstanceOf(Buffer);
    await expect(service.deleteCanvas(document.id)).resolves.toMatchObject({ documents: [] });
    await service.dispose();
  });

  it("restores the project file when deleting a canvas fails to commit", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-delete-rollback-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const document: ImageStudioCanvas = {
      id: "canvas-delete-rollback",
      name: "Delete rollback",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [],
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
    };
    await service.saveWorkspace({
      ...emptyImageStudioWorkspace(),
      activeDocumentId: document.id,
      documents: [document],
    });
    const projectPath = join(root, "image-studio", "canvases", `${document.id}.mingcanvas.json`);
    const before = await readFile(projectPath, "utf8");
    const setSetting = vi.spyOn(repository, "setSetting").mockImplementationOnce(() => {
      throw new Error("database delete failed");
    });

    await expect(service.deleteCanvas(document.id)).rejects.toThrow("database delete failed");
    setSetting.mockRestore();
    expect(service.getWorkspace().documents).toMatchObject([{ id: document.id }]);
    await expect(readFile(projectPath, "utf8")).resolves.toBe(before);
    await expect(readdir(join(root, "image-studio", "canvases", ".trash"))).resolves.toEqual([]);
    await service.dispose();
  });

  it("refuses to remove an asset referenced by a closed canvas", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-refs-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const imported = await service.importAssets([
      { name: "fixture.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing imported fixture asset");
    const document: ImageStudioCanvas = {
      id: "canvas-closed-reference",
      name: "Closed reference",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [
        {
          id: "reference-layer",
          assetId: image.id,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
        },
      ],
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
    };
    await service.saveWorkspace({
      ...imported,
      activeDocumentId: document.id,
      documents: [document],
    });
    await service.closeCanvas(document.id);

    await expect(service.removeAsset(image.id)).rejects.toThrow("仍被画布");
    await expect(service.openCanvas(document.id)).resolves.toMatchObject({
      documents: [{ layers: [{ assetId: image.id }] }],
    });
    await service.dispose();
  });

  it("rejects the entire batch removal when any selected asset is referenced by a closed canvas", async () => {
    const { service, root } = await imageOutputFixture();
    const imported = await service.importAssets([
      { name: "unused.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
      { name: "referenced.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const unused = imported.assets[0];
    const referenced = imported.assets[1];
    if (!unused || !referenced) throw new Error("Missing batch removal fixture assets");
    const document: ImageStudioCanvas = {
      id: "batch-removal-reference",
      name: "Batch removal reference",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [
        {
          id: "batch-removal-layer",
          assetId: referenced.id,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
        },
      ],
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
    };
    await service.saveWorkspace({
      ...imported,
      activeDocumentId: document.id,
      documents: [document],
    });
    await service.closeCanvas(document.id);

    await expect(service.removeAssets([unused.id, referenced.id])).rejects.toThrow(
      "批量删除已取消",
    );
    expect(service.getWorkspace().assets.map((item) => item.id)).toEqual([
      unused.id,
      referenced.id,
    ]);
    await expect(
      readFile(join(root, "image-studio", "assets", `${unused.id}.png`)),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      readFile(join(root, "image-studio", "assets", `${referenced.id}.png`)),
    ).resolves.toBeInstanceOf(Buffer);
    await service.dispose();
  });

  it("rejects batch removal when any closed canvas project is unreadable", async () => {
    const { service, root } = await imageOutputFixture();
    const imported = await service.importAssets([
      { name: "unreadable-project.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing unreadable-project removal fixture");
    await writeFile(
      join(root, "image-studio", "canvases", "broken-project.mingcanvas.json"),
      "{",
      "utf8",
    );

    await expect(service.removeAssets([image.id])).rejects.toThrow("不可读取");
    expect(service.getWorkspace().assets.map((item) => item.id)).toEqual([image.id]);
    await expect(
      readFile(join(root, "image-studio", "assets", `${image.id}.png`)),
    ).resolves.toBeInstanceOf(Buffer);
    await service.dispose();
  });

  it("commits one logical deletion, preserves workspace prompts and canvas layers, then reports cleanup failures", async () => {
    const { service, root } = await imageOutputFixture();
    const imported = await service.importAssets([
      { name: "first.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
      { name: "locked.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const first = imported.assets[0];
    const locked = imported.assets[1];
    if (!first || !locked) throw new Error("Missing logical removal fixture assets");
    const saved = await service.saveWorkspace({
      ...imported,
      prompt: "Keep positive workspace prompt",
      negativePrompt: "Keep negative workspace prompt",
      selectedAssetIds: [first.id, locked.id],
    });
    const lockedPath = join(root, "image-studio", "assets", `${locked.id}.png`);
    fsFailure.unlinkSources = [lockedPath];

    const result = await service.removeAssets([first.id, first.id, locked.id]);

    expect(result.removedAssetIds).toEqual([first.id, locked.id]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("磁盘文件清理失败");
    expect(result.workspace.prompt).toBe("Keep positive workspace prompt");
    expect(result.workspace.negativePrompt).toBe("Keep negative workspace prompt");
    expect(result.workspace.selectedAssetIds).toEqual([]);
    expect(result.workspace.documents).toEqual(saved.documents);
    expect(result.workspace.assets).toEqual([]);
    await expect(readFile(lockedPath)).resolves.toBeInstanceOf(Buffer);
    await expect(service.loadWorkspace()).resolves.toMatchObject({
      prompt: "Keep positive workspace prompt",
      negativePrompt: "Keep negative workspace prompt",
      selectedAssetIds: [],
      assets: [],
    });
    await service.dispose();
  });

  it("keeps single removal logically committed when file cleanup fails and never resurrects the asset", async () => {
    const { service, root } = await imageOutputFixture();
    const imported = await service.importAssets([
      { name: "single-locked.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing single-removal cleanup fixture");
    const path = join(root, "image-studio", "assets", `${image.id}.png`);
    fsFailure.unlinkSources = [path];

    await expect(service.removeAsset(image.id)).resolves.toMatchObject({ assets: [] });
    await expect(readFile(path)).resolves.toBeInstanceOf(Buffer);
    await expect(service.loadWorkspace()).resolves.toMatchObject({ assets: [] });
    await service.dispose();
  });

  it("does not delete asset files when the logical batch removal commit fails", async () => {
    const { service, repository, root } = await imageOutputFixture();
    const imported = await service.importAssets([
      { name: "commit-failure.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing batch commit failure fixture");
    const path = join(root, "image-studio", "assets", `${image.id}.png`);
    const backup = { ...imported, assets: [{ ...image, prompt: "ROLLBACK_PROMPT_CANARY" }] };
    repository.setSetting("image.studio.workspace.v1.canvas-library-backup", backup);
    const originalSetSetting = repository.setSetting.bind(repository);
    const setSetting = vi.spyOn(repository, "setSetting").mockImplementation((key, value) => {
      if (key === "image.studio.workspace.v1.canvas-library-backup")
        throw new Error("batch removal commit failed");
      originalSetSetting(key, value);
    });

    await expect(service.removeAssets([image.id])).rejects.toThrow("batch removal commit failed");
    expect(service.getWorkspace().assets.map((item) => item.id)).toEqual([image.id]);
    expect(repository.getSetting("image.studio.workspace.v1.canvas-library-backup")).toEqual(
      backup,
    );
    await expect(readFile(path)).resolves.toBeInstanceOf(Buffer);
    setSetting.mockRestore();
    await service.dispose();
  });

  it("does not replace a canvas project when one of its image assets is missing", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-missing-asset-save-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const imported = await service.importAssets([
      { name: "fixture.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing imported fixture asset");
    const document: ImageStudioCanvas = {
      id: "canvas-with-missing-asset",
      name: "Original project",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [
        {
          id: "missing-asset-layer",
          assetId: image.id,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
        },
      ],
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
    };
    await service.saveWorkspace({
      ...imported,
      activeDocumentId: document.id,
      documents: [document],
    });
    const projectPath = join(root, "image-studio", "canvases", `${document.id}.mingcanvas.json`);
    const before = await readFile(projectPath, "utf8");
    await rm(join(root, "image-studio", "assets", `${image.id}.png`));

    await expect(
      service.saveWorkspace({
        ...service.getWorkspace(),
        documents: [{ ...document, name: "Must not overwrite broken project" }],
      }),
    ).rejects.toThrow("画布引用的素材文件缺失");
    await expect(readFile(projectPath, "utf8")).resolves.toBe(before);
    await service.dispose();
  });

  it("surfaces corrupt local projects and allows deleting the broken project", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-corrupt-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    await service.saveWorkspace({
      ...emptyImageStudioWorkspace(),
      activeDocumentId: "broken-canvas",
      documents: [
        {
          id: "broken-canvas",
          name: "Broken canvas",
          width: 640,
          height: 480,
          background: "#101619",
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
          layers: [],
          createdAt: "2026-11-23T00:00:00.000Z",
          updatedAt: "2026-11-23T00:00:00.000Z",
        },
      ],
    });
    const projectPath = join(root, "image-studio", "canvases", "broken-canvas.mingcanvas.json");
    await writeFile(projectPath, "{broken", "utf8");
    const projects = await service.listCanvases();
    expect(projects).toMatchObject([{ id: "broken-canvas", available: false }]);
    await expect(service.loadWorkspace()).resolves.toMatchObject({ documents: [] });
    await expect(service.deleteCanvas("broken-canvas")).resolves.toMatchObject({ documents: [] });
    await expect(readdir(join(root, "image-studio", "canvases", ".trash"))).resolves.toEqual([]);
    await service.dispose();
  });

  it("rejects a linked canvas storage directory before reading project files", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-linked-root-"));
    const outside = await mkdtemp(join(tmpdir(), "mingshen-image-studio-outside-"));
    temporaryRoots.push(root, outside);
    const studio = join(root, "image-studio");
    await mkdir(studio, { recursive: true });
    await symlink(outside, join(studio, "canvases"), "junction");
    const service = new ImageStudioService(repository, {} as ProviderService, root);

    await expect(service.loadWorkspace()).rejects.toThrow("存储目录不安全");
    await service.dispose();
  });

  it("rejects workspace and project identifiers beyond their limits instead of truncating", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-limits-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const tooMany = Array.from({ length: 41 }, (_, index) => ({
      id: `canvas-${index}`,
      name: `Canvas ${index}`,
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [],
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
    }));
    await expect(
      service.saveWorkspace({ ...emptyImageStudioWorkspace(), documents: tooMany }),
    ).rejects.toThrow("最多同时打开 40 张");
    await expect(
      service.saveWorkspace({
        ...emptyImageStudioWorkspace(),
        documents: [tooMany[0], tooMany[0]],
      }),
    ).rejects.toThrow("重复的画布标识");
    await expect(service.openCanvas("../outside")).rejects.toThrow("画布标识无效");
    await service.dispose();
  });

  it("restores the last saved canvas file when the SQLite workspace commit fails", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-rollback-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    const initial = {
      ...emptyImageStudioWorkspace(),
      activeDocumentId: "rollback-canvas",
      documents: [
        {
          id: "rollback-canvas",
          name: "Before save",
          width: 640,
          height: 480,
          background: "#101619",
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
          layers: [],
          createdAt: "2026-11-23T00:00:00.000Z",
          updatedAt: "2026-11-23T00:00:00.000Z",
        },
      ],
    };
    await service.saveWorkspace(initial);
    const projectPath = join(root, "image-studio", "canvases", "rollback-canvas.mingcanvas.json");
    const before = await readFile(projectPath, "utf8");
    const setSetting = vi.spyOn(repository, "setSetting").mockImplementationOnce(() => {
      throw new Error("database write failed");
    });

    await expect(
      service.saveWorkspace({
        ...initial,
        documents: [{ ...initial.documents[0], name: "Uncommitted" }],
      }),
    ).rejects.toThrow("database write failed");
    expect(await readFile(projectPath, "utf8")).toBe(before);
    setSetting.mockRestore();
    await service.dispose();
  });

  it("exports the original validated asset bytes to the selected local destination", async () => {
    const { service, root, importedAsset } = await visionFixture();
    const destination = join(root, "saved-original.png");

    await service.exportAsset(importedAsset.id, destination);

    await expect(readFile(destination)).resolves.toEqual(Buffer.from(TINY_PNG_BASE64, "base64"));
    await expect(service.exportAsset(importedAsset.id, "relative.png")).rejects.toThrow(
      "图片导出位置无效",
    );
    await service.dispose();
  });

  it("streams multiple validated assets into a ZIP with safe unique entry names", async () => {
    const { service, root } = await imageOutputFixture();
    const red = colorPngDataUrl("#d23b32");
    const blue = colorPngDataUrl("#2468b4");
    const imported = await service.importAssets([
      { name: "duplicate.png", dataUrl: red },
      { name: "duplicate.png", dataUrl: blue },
    ]);
    const first = imported.assets[0];
    const second = imported.assets[1];
    if (!first || !second) throw new Error("Missing batch export fixture assets");
    const destination = join(root, "batch-images.zip");
    const progress: Array<{
      requestId: string;
      completedAssets: number;
      totalAssets: number;
      completedBytes: number;
      totalBytes: number;
      phase: "packing" | "finalizing" | "complete";
    }> = [];

    await service.exportAssets([second.id, first.id, second.id], destination, (update) =>
      progress.push(update),
    );

    const archive = unzipSync(new Uint8Array(await readFile(destination)));
    expect(Object.keys(archive).sort()).toEqual(["duplicate (2).png", "duplicate.png"]);
    expect(Buffer.from(archive["duplicate.png"] ?? [])).toEqual(bytesFromDataUrl(blue));
    expect(Buffer.from(archive["duplicate (2).png"] ?? [])).toEqual(bytesFromDataUrl(red));
    expect(progress[0]).toMatchObject({
      completedAssets: 0,
      totalAssets: 2,
      completedBytes: 0,
      phase: "packing",
    });
    expect(progress.map((update) => update.phase)).toEqual([
      "packing",
      "packing",
      "packing",
      "finalizing",
      "complete",
    ]);
    expect(progress.at(-1)).toMatchObject({
      requestId: expect.any(String),
      completedAssets: 2,
      totalAssets: 2,
      completedBytes: first.size + second.size,
      totalBytes: first.size + second.size,
      phase: "complete",
    });
    await service.dispose();
  });

  it("does not embed generated prompt metadata in a batch ZIP", async () => {
    const { service, root, model } = await imageOutputFixture();
    const promptCanary = "PROMPT_CANARY_MUST_NOT_APPEAR_IN_ZIP";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              b64_json: TINY_PNG_BASE64,
              revised_prompt: "REVISED_CANARY_MUST_NOT_APPEAR_IN_ZIP",
            },
          ],
        }),
      ),
    );
    const generated = await service.generate({
      requestId: "generate-zip-prompt-privacy",
      model,
      prompt: promptCanary,
      negativePrompt: "NEGATIVE_CANARY_MUST_NOT_APPEAR_IN_ZIP",
      generation: { ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS },
      addToActiveCanvas: false,
    });
    const generatedAsset = generated.generatedAssets[0];
    if (!generatedAsset) throw new Error("Missing ZIP prompt privacy asset");
    const destination = join(root, "prompt-private.zip");

    await service.exportAssets([generatedAsset.id], destination);

    const archiveBytes = await readFile(destination);
    expect(archiveBytes.includes(Buffer.from(promptCanary))).toBe(false);
    expect(archiveBytes.includes(Buffer.from("NEGATIVE_CANARY_MUST_NOT_APPEAR_IN_ZIP"))).toBe(
      false,
    );
    expect(archiveBytes.includes(Buffer.from("REVISED_CANARY_MUST_NOT_APPEAR_IN_ZIP"))).toBe(false);
    await service.dispose();
  });

  it("validates batch ZIP limits before writing and cleans the temporary target on replacement failure", async () => {
    const { service, repository, root } = await imageOutputFixture();
    const destination = join(root, "failed-batch.zip");
    const imported = await service.importAssets([
      { name: "fixture.png", dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    ]);
    const image = imported.assets[0];
    if (!image) throw new Error("Missing ZIP failure fixture asset");

    fsFailure.renameDestinations = [destination];
    await expect(service.exportAssets([image.id], destination)).rejects.toMatchObject({
      code: "EPERM",
    });
    await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(root)).some((name) => name.startsWith(".mingshen-images-"))).toBe(false);

    const oversizedAssets = Array.from({ length: 21 }, (_, index) => ({
      ...asset(`batch-size-${index}`),
      size: IMAGE_STUDIO_MAX_SINGLE_BYTES,
    }));
    repository.setSetting("image.studio.workspace.v1", {
      ...emptyImageStudioWorkspace(),
      assets: oversizedAssets,
    });
    await expect(
      service.exportAssets(
        oversizedAssets.map((item) => item.id),
        join(root, "too-large.zip"),
      ),
    ).rejects.toThrow("合计不能超过 500 MiB");
    expect(IMAGE_STUDIO_MAX_EXPORT_BYTES).toBe(500 * 1024 * 1024);
    await expect(
      service.exportAssets(
        Array.from({ length: 201 }, (_, index) => `batch-limit-${index}`),
        join(root, "too-many.zip"),
      ),
    ).rejects.toThrow("1 到 200");
    await service.dispose();
  });

  it("sends configured quality and count, then persists every validated returned image", async () => {
    const { service, root, model } = await imageOutputFixture();
    const image = createCanvas(1_024, 1_024).toBuffer("image/png").toString("base64");
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ data: [{ b64_json: image }, { b64_json: image }] }),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await service.generate({
      requestId: "generate-two-images",
      model,
      prompt: "Generate two fixture images",
      generation: {
        ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
        quality: "high",
        imageCount: 2,
        transparentBackground: true,
      },
      addToActiveCanvas: false,
    });

    expect(result.generatedAssets).toHaveLength(2);
    expect(result.warnings).toEqual([]);
    expect(result.workspace.assets.map((asset) => asset.id)).toEqual(
      result.generatedAssets.map((asset) => asset.id),
    );
    const requestBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(requestBody).toMatchObject({
      model: "image-model",
      n: 2,
      size: "1024x1024",
      quality: "high",
      background: "transparent",
      output_format: "png",
    });
    expect(requestBody).not.toHaveProperty("response_format");
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toHaveLength(2);
    await service.dispose();
  });

  it("persists original prompts separately from the provider revision across canvas reopen and restart", async () => {
    const { service, repository, root, model } = await imageOutputFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            {
              b64_json: TINY_PNG_BASE64,
              revised_prompt: "Provider-revised prompt",
            },
          ],
        }),
      ),
    );

    const generated = await service.generate({
      requestId: "generate-prompt-roundtrip",
      model,
      prompt: "Original positive prompt",
      negativePrompt: "Original negative prompt",
      generation: { ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS },
      addToActiveCanvas: false,
    });
    const generatedAsset = generated.generatedAssets[0];
    if (!generatedAsset) throw new Error("Missing generated prompt fixture asset");
    expect(generatedAsset).toMatchObject({
      source: "generated",
      prompt: "Original positive prompt",
      negativePrompt: "Original negative prompt",
      revisedPrompt: "Provider-revised prompt",
      promptOrigin: "mingshen_generated",
      promptMetadataVersion: 1,
    });

    const document: ImageStudioCanvas = {
      id: "canvas-prompt-roundtrip",
      name: "Prompt roundtrip",
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [
        {
          id: "prompt-roundtrip-layer",
          assetId: generatedAsset.id,
          x: 10,
          y: 20,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
        },
      ],
      createdAt: "2026-11-24T00:00:00.000Z",
      updatedAt: "2026-11-24T00:00:00.000Z",
    };
    await service.saveWorkspace({
      ...generated.workspace,
      activeDocumentId: document.id,
      documents: [document],
    });

    const projectPath = join(root, "image-studio", "canvases", `${document.id}.mingcanvas.json`);
    const project = JSON.parse(await readFile(projectPath, "utf8")) as {
      assets: ImageStudioAsset[];
    };
    expect(project.assets[0]).toMatchObject({
      id: generatedAsset.id,
      prompt: "Original positive prompt",
      negativePrompt: "Original negative prompt",
      revisedPrompt: "Provider-revised prompt",
      promptOrigin: "mingshen_generated",
      promptMetadataVersion: 1,
    });

    await service.closeCanvas(document.id);
    const reopened = await service.openCanvas(document.id);
    expect(reopened.assets.find((item) => item.id === generatedAsset.id)).toMatchObject({
      prompt: "Original positive prompt",
      negativePrompt: "Original negative prompt",
      revisedPrompt: "Provider-revised prompt",
      promptOrigin: "mingshen_generated",
      promptMetadataVersion: 1,
    });
    await service.dispose();

    const restarted = new ImageStudioService(repository, {} as ProviderService, root);
    const loaded = await restarted.loadWorkspace();
    expect(loaded.assets.find((item) => item.id === generatedAsset.id)).toMatchObject({
      prompt: "Original positive prompt",
      negativePrompt: "Original negative prompt",
      revisedPrompt: "Provider-revised prompt",
      promptOrigin: "mingshen_generated",
      promptMetadataVersion: 1,
    });
    await restarted.dispose();
  });

  it("stores an explicitly empty negative prompt instead of confusing it with unknown null", async () => {
    const { service, model } = await imageOutputFixture();
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const generated = await service.generate({
      requestId: "generate-empty-negative",
      model,
      prompt: "Positive prompt without an avoidance list",
      generation: { ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS },
      addToActiveCanvas: false,
    });
    const generatedAsset = generated.generatedAssets[0];
    if (!generatedAsset) throw new Error("Missing empty-negative fixture asset");
    expect(generatedAsset).toMatchObject({
      prompt: "Positive prompt without an avoidance list",
      negativePrompt: "",
      promptOrigin: "mingshen_generated",
      promptMetadataVersion: 1,
    });
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { prompt: string },
    ).toMatchObject({
      prompt: "Positive prompt without an avoidance list",
    });
    await service.dispose();
  });

  it("normalizes a legacy generated asset without prompt metadata to null fields", async () => {
    const { service, repository } = await imageOutputFixture();
    repository.setSetting("image.studio.workspace.v1", {
      ...emptyImageStudioWorkspace(),
      prompt: "Keep this draft prompt",
      negativePrompt: "Keep this draft negative prompt",
      assets: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "legacy-generated.png",
          mimeType: "image/png",
          size: Buffer.from(TINY_PNG_BASE64, "base64").length,
          width: 1,
          height: 1,
          source: "generated",
          createdAt: "2026-11-20T00:00:00.000Z",
          prompt: "Legacy generated prompt",
          model: null,
        },
      ],
    });

    const loaded = service.getWorkspace();
    expect(loaded.prompt).toBe("Keep this draft prompt");
    expect(loaded.negativePrompt).toBe("Keep this draft negative prompt");
    expect(loaded.assets[0]).toMatchObject({
      prompt: "Legacy generated prompt",
      negativePrompt: null,
      revisedPrompt: null,
      promptOrigin: null,
      promptMetadataVersion: null,
    });
    await service.dispose();
  });

  it("ignores forged generated sources and prompt metadata from external imports without changing prompts", async () => {
    const { service, repository } = await imageOutputFixture();
    repository.setSetting("image.studio.workspace.v1", {
      ...emptyImageStudioWorkspace(),
      prompt: "Keep the current positive draft",
      negativePrompt: "Keep the current negative draft",
    });

    const imported = await service.importAssets([
      {
        name: "forged-generated.png",
        dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}`,
        source: "generated",
        promptMetadata: {
          version: 1,
          origin: "mingshen_generated",
          prompt: "Forged generated prompt",
          negativePrompt: "Forged negative prompt",
        },
      },
      {
        name: "forged-metadata.png",
        dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}`,
        source: "imported",
        promptMetadata: {
          version: 1,
          origin: "mingshen_generated",
          prompt: "Forged imported prompt",
          negativePrompt: "",
        },
        revisedPrompt: "Forged provider revision",
      },
    ]);

    expect(imported.prompt).toBe("Keep the current positive draft");
    expect(imported.negativePrompt).toBe("Keep the current negative draft");
    expect(imported.assets).toHaveLength(2);
    expect(imported.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "imported",
          prompt: null,
          negativePrompt: null,
          revisedPrompt: null,
          promptOrigin: null,
          promptMetadataVersion: null,
        }),
        expect.objectContaining({
          source: "imported",
          prompt: null,
          negativePrompt: null,
          revisedPrompt: null,
          promptOrigin: null,
          promptMetadataVersion: null,
        }),
      ]),
    );
    await service.dispose();
  });

  it("ignores reference ids and uses the JSON generations endpoint when reference mode is off", async () => {
    const { service, model } = await imageOutputFixture();
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await service.generate({
      requestId: "generate-with-references-off",
      model,
      prompt: "Generate without references",
      generation: {
        ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
        resolution: "auto",
        aspectRatio: "auto",
        referenceEnabled: false,
      },
      referenceAssetIds: ["../outside"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://images.invalid/v1/images/generations",
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "image-model",
      prompt: "Generate without references",
      size: "auto",
    });
    await service.dispose();
  });

  it("requires a validated reference when reference mode is enabled and never calls the provider first", async () => {
    const { service, model } = await imageOutputFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const generation = {
      ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
      resolution: "auto" as const,
      aspectRatio: "auto" as const,
      referenceEnabled: true,
    };

    await expect(
      service.generate({
        requestId: "generate-missing-references",
        model,
        prompt: "Require a reference",
        generation,
      }),
    ).rejects.toThrow("请先勾选素材或上传参考图");
    await expect(
      service.generate({
        requestId: "generate-unknown-reference",
        model,
        prompt: "Require a reference",
        generation,
        referenceAssetIds: ["missing-reference"],
      }),
    ).rejects.toThrow("图片素材不存在");
    expect(fetchMock).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("sends only the first three unique references as ordered multipart images", async () => {
    const { service, model } = await imageOutputFixture();
    const dataUrls = ["red", "green", "blue", "white"].map(colorPngDataUrl);
    const imported = await service.importAssets(
      dataUrls.map((dataUrl, index) => ({
        name: `reference-${index + 1}.png`,
        dataUrl,
      })),
    );
    const referenceIds = imported.assets.map((item) => item.id);
    expect(referenceIds).toHaveLength(4);
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await service.generate({
      requestId: "generate-three-references",
      model,
      prompt: "Use three ordered references",
      generation: {
        ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
        resolution: "auto",
        aspectRatio: "auto",
        referenceEnabled: true,
      },
      referenceAssetIds: [
        referenceIds[0] as string,
        referenceIds[1] as string,
        referenceIds[0] as string,
        referenceIds[2] as string,
        referenceIds[3] as string,
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://images.invalid/v1/images/edits");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).not.toHaveProperty("content-type");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("model")).toBe("image-model");
    expect(form.get("prompt")).toBe("Use three ordered references");
    expect(form.get("size")).toBe("auto");
    expect(form.get("n")).toBe("1");
    expect(form.getAll("image")).toEqual([]);
    const images = form.getAll("image[]");
    expect(images).toHaveLength(3);
    for (const [index, image] of images.entries()) {
      expect(image).not.toBeTypeOf("string");
      const blob = image as Blob;
      expect(blob.type).toBe("image/png");
      expect(Buffer.from(await blob.arrayBuffer())).toEqual(
        bytesFromDataUrl(dataUrls[index] as string),
      );
    }
    await service.dispose();
  });

  it("uses the singular image field for one reference", async () => {
    const { service, model } = await imageOutputFixture();
    const dataUrl = colorPngDataUrl("red");
    const imported = await service.importAssets([{ name: "single.png", dataUrl }]);
    const referenceId = imported.assets[0]?.id;
    if (!referenceId) throw new Error("Missing imported reference");
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await service.generate({
      requestId: "generate-single-reference",
      model,
      prompt: "Use one reference",
      generation: {
        ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
        resolution: "auto",
        aspectRatio: "auto",
        referenceEnabled: true,
      },
      referenceAssetIds: [referenceId],
    });

    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.getAll("image[]")).toEqual([]);
    const images = form.getAll("image");
    expect(images).toHaveLength(1);
    expect((images[0] as Blob).type).toBe("image/png");
    await service.dispose();
  });

  it("converts a GIF reference to its first PNG frame without changing the stored asset", async () => {
    const { service, model } = await imageOutputFixture();
    const imported = await service.importAssets([
      { name: "animation.gif", dataUrl: `data:image/gif;base64,${TINY_GIF_BASE64}` },
    ]);
    const referenceId = imported.assets[0]?.id;
    if (!referenceId) throw new Error("Missing imported GIF reference");
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await service.generate({
      requestId: "generate-gif-reference",
      model,
      prompt: "Use a GIF reference",
      generation: {
        ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
        resolution: "auto",
        aspectRatio: "auto",
        referenceEnabled: true,
      },
      referenceAssetIds: [referenceId],
    });

    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const upload = form.get("image") as Blob;
    expect(upload.type).toBe("image/png");
    expect(Buffer.from(await upload.arrayBuffer()).subarray(0, 8)).toEqual(
      Buffer.from("89504e470d0a1a0a", "hex"),
    );
    await expect(service.getAssetData(referenceId)).resolves.toMatchObject({
      dataUrl: `data:image/gif;base64,${TINY_GIF_BASE64}`,
    });
    await service.dispose();
  });

  it("converts a real WebP reference to its first PNG frame without changing the stored asset", async () => {
    const { service, model } = await imageOutputFixture();
    const webp = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 28, g: 96, b: 144, alpha: 1 },
      },
    })
      .webp()
      .toBuffer();
    const imported = await service.importAssets([
      { name: "reference.webp", dataUrl: `data:image/webp;base64,${webp.toString("base64")}` },
    ]);
    const referenceId = imported.assets[0]?.id;
    if (!referenceId) throw new Error("Missing imported WebP reference");
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await service.generate({
      requestId: "generate-webp-reference",
      model,
      prompt: "Use a WebP reference",
      generation: {
        ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
        resolution: "auto",
        aspectRatio: "auto",
        referenceEnabled: true,
      },
      referenceAssetIds: [referenceId],
    });

    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const upload = form.get("image") as Blob;
    expect(upload.type).toBe("image/png");
    const uploaded = Buffer.from(await upload.arrayBuffer());
    expect(uploaded.subarray(0, 8)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));
    await expect(sharp(uploaded).metadata()).resolves.toMatchObject({
      format: "png",
      width: 2,
      height: 2,
    });
    await expect(service.getAssetData(referenceId)).resolves.toMatchObject({
      dataUrl: `data:image/webp;base64,${webp.toString("base64")}`,
    });
    await service.dispose();
  });

  it("rejects corrupted or changed references before contacting the provider", async () => {
    const { service, root, model } = await imageOutputFixture();
    const original = bytesFromDataUrl(colorPngDataUrl("red"));
    const imported = await service.importAssets([
      { name: "reference.png", dataUrl: `data:image/png;base64,${original.toString("base64")}` },
    ]);
    const referenceId = imported.assets[0]?.id;
    if (!referenceId) throw new Error("Missing imported reference");
    const referencePath = join(root, "image-studio", "assets", `${referenceId}.png`);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const generation = {
      ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
      resolution: "auto" as const,
      aspectRatio: "auto" as const,
      referenceEnabled: true,
    };

    await writeFile(referencePath, Buffer.alloc(original.byteLength));
    await expect(
      service.generate({
        requestId: "generate-corrupted-reference",
        model,
        prompt: "Reject a corrupted reference",
        generation,
        referenceAssetIds: [referenceId],
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();

    await writeFile(referencePath, Buffer.concat([original, Buffer.from([0])]));
    await expect(
      service.generate({
        requestId: "generate-changed-reference",
        model,
        prompt: "Reject a changed reference",
        generation,
        referenceAssetIds: [referenceId],
      }),
    ).rejects.toThrow("变化或损坏");
    expect(fetchMock).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("cancels a reference request during validation without contacting the provider", async () => {
    const { service, model } = await imageOutputFixture();
    const imported = await service.importAssets([
      { name: "reference.png", dataUrl: colorPngDataUrl("red") },
    ]);
    const referenceId = imported.assets[0]?.id;
    if (!referenceId) throw new Error("Missing imported reference");
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
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const generating = service.generate({
      requestId: "cancel-reference-validation",
      model,
      prompt: "Cancel while validating a reference",
      generation: {
        ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
        resolution: "auto",
        aspectRatio: "auto",
        referenceEnabled: true,
      },
      referenceAssetIds: [referenceId],
    });
    const generatingResult = expect(generating).rejects.toThrow("已取消");
    await started;
    service.cancelRequest("cancel-reference-validation");
    release();
    await generatingResult;
    expect(fetchMock).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("rejects a converted reference above 25 MiB before contacting the provider", async () => {
    const { service, model } = await imageOutputFixture();
    const imported = await service.importAssets([
      { name: "animation.gif", dataUrl: `data:image/gif;base64,${TINY_GIF_BASE64}` },
    ]);
    const referenceId = imported.assets[0]?.id;
    if (!referenceId) throw new Error("Missing imported GIF reference");
    sharpFailure.pngOutput = Buffer.allocUnsafe(IMAGE_STUDIO_MAX_SINGLE_BYTES + 1);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      service.generate({
        requestId: "generate-oversize-reference",
        model,
        prompt: "Reject an oversized converted reference",
        generation: {
          ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
          resolution: "auto",
          aspectRatio: "auto",
          referenceEnabled: true,
        },
        referenceAssetIds: [referenceId],
      }),
    ).rejects.toThrow("参考图转换为 PNG 后超过单图 25 MiB 限制");
    expect(fetchMock).not.toHaveBeenCalled();
    await service.dispose();
  });

  it("surfaces an edit-endpoint rejection without falling back to plain generation", async () => {
    const { service, model } = await imageOutputFixture();
    const imported = await service.importAssets([
      { name: "reference.png", dataUrl: colorPngDataUrl("red") },
    ]);
    const referenceId = imported.assets[0]?.id;
    if (!referenceId) throw new Error("Missing imported reference");
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> =>
        new Response("reference images unsupported", {
          status: 400,
          statusText: "Bad Request",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      service.generate({
        requestId: "generate-reference-rejected",
        model,
        prompt: "Use an unsupported reference",
        generation: {
          ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
          resolution: "auto",
          aspectRatio: "auto",
          referenceEnabled: true,
        },
        referenceAssetIds: [referenceId],
      }),
    ).rejects.toThrow("HTTP 400 Bad Request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://images.invalid/v1/images/edits");
    await service.dispose();
  });

  it("saves a valid provider image when its dimensions differ and returns a warning", async () => {
    const { service, root, model } = await imageOutputFixture();
    const image = createCanvas(2_880, 2_880).toBuffer("image/png").toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ b64_json: image }] })),
    );

    const result = await service.generate({
      requestId: "generate-size-mismatch",
      model,
      prompt: "Generate a size mismatch fixture",
      generation: {
        ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
        resolution: "custom",
        aspectRatio: "custom",
        width: 3_840,
        height: 3_840,
        alignTo16: true,
      },
      addToActiveCanvas: false,
    });

    expect(result.warnings).toEqual([
      {
        code: "size_mismatch",
        imageIndex: 1,
        requestedWidth: 3_840,
        requestedHeight: 3_840,
        actualWidth: 2_880,
        actualHeight: 2_880,
      },
    ]);
    expect(result.generatedAssets).toHaveLength(1);
    expect(result.generatedAssets[0]).toMatchObject({ width: 2_880, height: 2_880 });
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toHaveLength(1);
    await expect(service.getAssetData(result.generatedAssets[0]?.id)).resolves.toMatchObject({
      dataUrl: `data:image/png;base64,${image}`,
    });
    await service.dispose();
  });

  it("accepts any validated dimensions without a mismatch warning in automatic size mode", async () => {
    const { service, root, model } = await imageOutputFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] })),
    );

    const result = await service.generate({
      requestId: "generate-auto-size",
      model,
      prompt: "Generate an automatic size fixture",
      generation: {
        ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
        resolution: "auto",
        aspectRatio: "auto",
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.generatedAssets).toMatchObject([{ width: 1, height: 1 }]);
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toHaveLength(1);
    await service.dispose();
  });

  it("still rejects excess provider images even when their dimensions would only cause warnings", async () => {
    const { service, root, model } = await imageOutputFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }, { b64_json: TINY_PNG_BASE64 }] }),
      ),
    );

    await expect(
      service.generate({
        requestId: "generate-excess-images",
        model,
        prompt: "Generate one fixture image",
        generation: { ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS },
      }),
    ).rejects.toThrow("图片数量超过本次请求数量");
    expect(service.getWorkspace().assets).toEqual([]);
    await expect(readdir(join(root, "image-studio", "assets"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await service.dispose();
  });

  it("retains generated assets for recovery if a partial canvas write cannot be rolled back", async () => {
    const { service, root, model } = await imageOutputFixture();
    const documents: ImageStudioCanvas[] = ["first-canvas", "second-canvas"].map((id) => ({
      id,
      name: id,
      width: 640,
      height: 480,
      background: "#101619",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      layers: [],
      createdAt: "2026-11-23T00:00:00.000Z",
      updatedAt: "2026-11-23T00:00:00.000Z",
    }));
    const initial = await service.saveWorkspace({
      ...emptyImageStudioWorkspace(),
      documents,
      activeDocumentId: "first-canvas",
    });
    const firstPath = join(root, "image-studio", "canvases", "first-canvas.mingcanvas.json");
    const secondPath = join(root, "image-studio", "canvases", "second-canvas.mingcanvas.json");
    const secondProject = JSON.parse(await readFile(secondPath, "utf8"));
    secondProject.canvas.name = "An older valid project revision";
    await writeFile(secondPath, JSON.stringify(secondProject), "utf8");
    fsFailure.renameDestinations = [secondPath, firstPath];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ b64_json: TINY_PNG_BASE64 }] })),
    );

    await expect(
      service.generate({
        requestId: "generate-rollback-failure",
        model,
        prompt: "Generate a recoverable fixture",
        generation: { ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS },
        addToActiveCanvas: true,
      }),
    ).rejects.toThrow(/无法完整恢复.*新素材已保留/);

    expect(fsFailure.renameDestinations).toEqual([]);
    expect(service.getWorkspace()).toEqual(initial);
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toHaveLength(1);
    const recovered = await service.loadWorkspace();
    expect(recovered.assets).toHaveLength(1);
    expect(recovered.documents[0]?.layers).toMatchObject([{ assetId: recovered.assets[0]?.id }]);
    await expect(service.getAssetData(recovered.assets[0]?.id)).resolves.toMatchObject({
      dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}`,
    });
    await service.dispose();
  });

  it("never accepts caller-supplied assets or restores removed layer references", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-injected-assets-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
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

    await expect(
      service.saveWorkspace({
        ...workspace,
        assets: [valid, asset("../outside")],
      }),
    ).rejects.toThrow("图层会丢失");

    expect(service.getWorkspace().assets).toEqual([]);
    expect(service.getWorkspace().documents).toEqual([]);
    await service.dispose();
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
    const latestSave = service.saveWorkspace({
      ...emptyImageStudioWorkspace(),
      prompt: "Latest canvas",
    });
    await Promise.all([first, second, latestSave]);
    expect(service.getWorkspace().assets).toHaveLength(2);
    expect(service.getWorkspace().prompt).toBe("Latest canvas");
    const stale = service.getWorkspace();
    await service.removeAsset(stale.assets[0]?.id);
    const savedStale = await service.saveWorkspace(stale);
    expect(savedStale.assets).toHaveLength(1);
    await service.dispose();
  });

  it("waits for an in-flight import, discards its files and prevents writes after disposal", async () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const root = await mkdtemp(join(tmpdir(), "mingshen-image-studio-"));
    temporaryRoots.push(root);
    const service = new ImageStudioService(repository, {} as ProviderService, root);
    await service.loadWorkspace();
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
    // Migration may backfill the legacy backup before image decoding begins; only writes after
    // disposal starts are forbidden.
    setSetting.mockClear();
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
    await expect(service.saveWorkspace(emptyImageStudioWorkspace())).rejects.toThrow("正在关闭");
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
      generation: { ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS },
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
        generation: {
          ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
          resolution: "auto",
          aspectRatio: "auto",
        },
      }),
    ).rejects.toThrow("workspace save failed");

    expect(repository.getSetting("image.studio.workspace.v1")).toEqual(previousWorkspace);
    await expect(readdir(join(root, "image-studio", "assets"))).resolves.toEqual([]);
  });
});
