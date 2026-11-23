import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
  emptyImageStudioWorkspace,
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
  };
});

const databases: ReturnType<typeof openDatabase>[] = [];
const temporaryRoots: string[] = [];
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

afterEach(async () => {
  fsFailure.renameSource = null;
  fsFailure.renameDestinations = [];
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
    await migrated.dispose();
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
