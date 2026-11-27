import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyImageStudioWorkspace,
  type ImageStudioAsset,
  type ImageStudioCanvas,
  type ImageStudioWorkspace,
} from "../../../shared/image-studio";
import {
  ImageStudioUrlCache,
  ImageStudioWorkspaceQueue,
  mergeAssetResult,
  mergeCanvasMutationResult,
  mergeConcurrentGenerationResult,
  mergeGeneratedResult,
  mergeRemovedAsset,
  shouldDispatchImageGeneration,
} from "./image-studio-workspace";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function workspace(prompt: string): ImageStudioWorkspace {
  return { ...emptyImageStudioWorkspace(), prompt };
}

function asset(id: string): ImageStudioAsset {
  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    size: 1,
    width: 10,
    height: 10,
    source: "imported",
    createdAt: "2026-01-01",
    prompt: null,
    negativePrompt: null,
    revisedPrompt: null,
    promptOrigin: null,
    promptMetadataVersion: null,
    model: null,
  };
}

function canvas(): ImageStudioCanvas {
  return {
    id: "canvas",
    name: "Edited canvas",
    width: 100,
    height: 100,
    background: "#000000",
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    layers: [
      {
        id: "old-layer",
        assetId: "old",
        x: 8,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
      },
    ],
  };
}

function layer(id: string, assetId: string, zIndex = 0) {
  return {
    id,
    assetId,
    x: zIndex * 10,
    y: zIndex * 10,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    zIndex,
  };
}

afterEach(() => vi.useRealTimers());

describe("image studio workspace queue", () => {
  it("serializes saves and flushes the latest edit before a mutation", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const started = deferred();
    const saved: string[] = [];
    const queue = new ImageStudioWorkspaceQueue(async (draft) => {
      if (!saved.length) {
        started.resolve();
        await gate.promise;
      }
      saved.push(draft.prompt);
    });
    queue.schedule(workspace("first"), vi.fn());
    const first = queue.flush();
    await started.promise;
    queue.schedule(workspace("latest"), vi.fn());
    const mutation = queue.run(async () => {
      expect(saved).toEqual(["first", "latest"]);
      saved.push("mutation");
    });
    gate.resolve();
    await Promise.all([first, mutation]);
    expect(saved).toEqual(["first", "latest", "mutation"]);
  });

  it("flushes edits and mutation results before a subsequent mount reads", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const started = deferred();
    let stored = workspace("original");
    let latest = workspace("original");
    const queue = new ImageStudioWorkspaceQueue(async (draft) => {
      stored = draft;
    });
    const mutation = queue.run(async () => {
      started.resolve();
      await gate.promise;
      latest = { ...latest, assets: [asset("imported")] };
      queue.schedule(latest, vi.fn());
    });
    await started.promise;
    latest = { ...latest, prompt: "edited while importing" };
    queue.schedule(latest, vi.fn());
    const unmountFlush = queue.flush();
    const remount = queue.run(async () => stored);
    gate.resolve();
    await mutation;
    await unmountFlush;
    expect(await remount).toMatchObject({
      prompt: "edited while importing",
      assets: [{ id: "imported" }],
    });
  });

  it("retains a failed write and retries before allowing a read or mutation", async () => {
    vi.useFakeTimers();
    const failure = new Error("disk unavailable");
    const onResult = vi.fn();
    const save = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const queue = new ImageStudioWorkspaceQueue(save);
    queue.schedule(workspace("unsaved"), onResult);
    await expect(queue.flush()).rejects.toThrow("disk unavailable");
    expect(onResult).toHaveBeenCalledWith({ status: "error", error: failure });
    const read = vi.fn(async () => "read");
    await expect(queue.run(read)).resolves.toBe("read");
    expect(save).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledOnce();
  });

  it("serializes a generation merge behind a deferred canvas close without restoring it", async () => {
    const persisted: ImageStudioWorkspace[] = [];
    const queue = new ImageStudioWorkspaceQueue(async (draft) => {
      persisted.push(draft);
    });
    let live: ImageStudioWorkspace = {
      ...workspace("before generation"),
      activeDocumentId: "canvas",
      assets: [asset("old")],
      documents: [{ ...canvas(), layers: [layer("old-layer", "old")] }],
    };
    const closeStarted = deferred();
    const releaseClose = deferred();
    const close = queue.run(async () => {
      closeStarted.resolve();
      await releaseClose.promise;
      live = { ...live, activeDocumentId: null, documents: [] };
      return live;
    });
    await closeStarted.promise;
    let generationApplied = false;
    const generationResult = {
      generatedAssets: [asset("generated")],
      workspace: {
        ...workspace("stale provider prompt"),
        activeDocumentId: "canvas",
        assets: [asset("old"), asset("generated")],
        documents: [
          {
            ...canvas(),
            layers: [layer("old-layer", "old"), layer("generated-layer", "generated")],
          },
        ],
      },
      warnings: [],
    };
    const generation = queue.commit(
      () => live,
      (current) => mergeConcurrentGenerationResult(current, generationResult, "canvas"),
      (next) => {
        generationApplied = true;
        live = next;
      },
    );

    await Promise.resolve();
    expect(generationApplied).toBe(false);
    releaseClose.resolve();
    await Promise.all([close, generation]);

    expect(live.assets.map((item) => item.id)).toEqual(["old", "generated"]);
    expect(live.documents).toEqual([]);
    expect(persisted.at(-1)).toMatchObject({
      assets: [{ id: "old" }, { id: "generated" }],
      documents: [],
    });
  });

  it("preserves draft preferences while a deferred deletion reconciles canonical documents", async () => {
    const persisted: ImageStudioWorkspace[] = [];
    const queue = new ImageStudioWorkspaceQueue(async (draft) => {
      persisted.push(draft);
    });
    let live: ImageStudioWorkspace = {
      ...workspace("before deletion"),
      activeDocumentId: "canvas",
      assets: [asset("old"), asset("keep")],
      selectedAssetIds: ["old", "keep"],
      documents: [{ ...canvas(), layers: [layer("old-layer", "old")] }],
    };
    const deletionStarted = deferred();
    const releaseDeletion = deferred();
    const deletion = queue.commitCanonical(
      () => live,
      async () => {
        deletionStarted.resolve();
        await releaseDeletion.promise;
        return {
          ...workspace("canonical server snapshot"),
          activeDocumentId: null,
          assets: [asset("keep")],
          selectedAssetIds: [],
          documents: [],
        };
      },
      mergeCanvasMutationResult,
      (next) => {
        live = next;
      },
    );
    await deletionStarted.promise;

    live = {
      ...live,
      prompt: "typed during deletion",
      negativePrompt: "negative typed during deletion",
      imageModel: { providerId: "image-provider", modelId: "latest-image" },
      textModel: { providerId: "text-provider", modelId: "latest-text" },
      generation: { ...live.generation, quality: "high" },
      selectedAssetIds: ["old", "keep"],
    };
    queue.schedule(live, vi.fn());

    const generationResult = {
      generatedAssets: [asset("generated")],
      workspace: {
        ...workspace("stale generation prompt"),
        activeDocumentId: "canvas",
        assets: [asset("keep"), asset("generated")],
        documents: [canvas()],
      },
      warnings: [],
    };
    const generation = queue.commit(
      () => live,
      (current) => mergeConcurrentGenerationResult(current, generationResult, null),
      (next) => {
        live = next;
      },
    );

    releaseDeletion.resolve();
    await Promise.all([deletion, generation]);

    expect(live).toMatchObject({
      activeDocumentId: null,
      prompt: "typed during deletion",
      negativePrompt: "negative typed during deletion",
      imageModel: { providerId: "image-provider", modelId: "latest-image" },
      textModel: { providerId: "text-provider", modelId: "latest-text" },
      generation: { quality: "high" },
      selectedAssetIds: ["keep"],
      documents: [],
    });
    expect(live.assets.map((item) => item.id)).toEqual(["keep", "generated"]);
    expect(persisted.at(-1)).toMatchObject({
      activeDocumentId: null,
      prompt: "typed during deletion",
      negativePrompt: "negative typed during deletion",
      generation: { quality: "high" },
      selectedAssetIds: ["keep"],
      documents: [],
    });
  });

  it("serializes a remote-save merge behind a deferred canvas update without restoring it", async () => {
    const persisted: ImageStudioWorkspace[] = [];
    const queue = new ImageStudioWorkspaceQueue(async (draft) => {
      persisted.push(draft);
    });
    let live: ImageStudioWorkspace = {
      ...workspace("before remote save"),
      activeDocumentId: "canvas",
      assets: [asset("old")],
      documents: [{ ...canvas(), layers: [layer("old-layer", "old")] }],
    };
    const mutationStarted = deferred();
    const releaseMutation = deferred();
    const mutation = queue.run(async () => {
      mutationStarted.resolve();
      await releaseMutation.promise;
      live = { ...live, activeDocumentId: null, documents: [] };
      return live;
    });
    await mutationStarted.promise;
    let remoteApplied = false;
    const remoteResult = {
      generatedAssets: [asset("remote")],
      workspace: {
        ...workspace("stale remote prompt"),
        activeDocumentId: "canvas",
        assets: [asset("old"), asset("remote")],
        documents: [
          {
            ...canvas(),
            layers: [layer("old-layer", "old"), layer("remote-layer", "remote")],
          },
        ],
      },
      warnings: [],
    };
    const remoteSave = queue.commit(
      () => live,
      (current) => mergeGeneratedResult(current, remoteResult),
      (next) => {
        remoteApplied = true;
        live = next;
      },
    );

    await Promise.resolve();
    expect(remoteApplied).toBe(false);
    releaseMutation.resolve();
    await Promise.all([mutation, remoteSave]);

    expect(live.assets.map((item) => item.id)).toEqual(["old", "remote"]);
    expect(live.documents).toEqual([]);
    expect(persisted.at(-1)).toMatchObject({
      assets: [{ id: "old" }, { id: "remote" }],
      documents: [],
    });
  });

  it("does not dispatch a queued generation cancelled during a deferred workspace flush", async () => {
    const flushGate = deferred();
    const flushStarted = deferred();
    const queue = new ImageStudioWorkspaceQueue(async () => {
      flushStarted.resolve();
      await flushGate.promise;
    });
    queue.schedule(workspace("pending edit"), vi.fn());
    const active = new Set(["queued-request"]);
    const cancelling = new Set<string>();
    let dispatched = false;
    const queuedGeneration = (async () => {
      await queue.flush();
      if (!shouldDispatchImageGeneration(active, cancelling, "queued-request")) return;
      dispatched = true;
    })();

    await flushStarted.promise;
    active.delete("queued-request");
    flushGate.resolve();
    await queuedGeneration;

    expect(dispatched).toBe(false);
  });

  it("does not write when an initial load fails", async () => {
    const save = vi.fn();
    const queue = new ImageStudioWorkspaceQueue(save);
    await expect(
      queue.run(async () => {
        throw new Error("read failed");
      }),
    ).rejects.toThrow("read failed");
    await queue.flush();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("image studio results and cache", () => {
  it("merges imported and generated assets without replacing later edits", () => {
    const current = {
      ...workspace("new prompt"),
      activeDocumentId: "canvas",
      documents: [canvas()],
      assets: [asset("old")],
    };
    const serverCanvas = {
      ...canvas(),
      name: "old canvas",
      layers: [
        ...canvas().layers,
        {
          id: "new-layer",
          assetId: "new",
          x: 1,
          y: 2,
          width: 10,
          height: 10,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
        },
      ],
    };
    const server = {
      ...workspace("old prompt"),
      documents: [serverCanvas],
      assets: [asset("old"), asset("new")],
    };
    expect(mergeAssetResult(current, server)).toMatchObject({
      prompt: "new prompt",
      documents: [{ name: "Edited canvas" }],
      assets: [{ id: "old" }, { id: "new" }],
    });
    const merged = mergeGeneratedResult(current, {
      generatedAssets: [asset("new")],
      workspace: server,
      warnings: [],
    });
    expect(merged).toMatchObject({
      prompt: "new prompt",
      documents: [
        { name: "Edited canvas", layers: [{ id: "old-layer", x: 8 }, { id: "new-layer" }] },
      ],
    });
    expect(
      mergeGeneratedResult(
        { ...current, documents: [] },
        { generatedAssets: [asset("new")], workspace: server, warnings: [] },
      ).documents,
    ).toEqual([]);
  });

  it("removes only the deleted asset and references from the latest local draft", () => {
    const current = {
      ...workspace("latest"),
      selectedAssetIds: ["old", "keep"],
      documents: [canvas()],
      assets: [asset("old"), asset("keep")],
    };
    const result = mergeRemovedAsset(
      current,
      { ...workspace("stale"), assets: [asset("keep")] },
      "old",
    );
    expect(result).toMatchObject({
      prompt: "latest",
      selectedAssetIds: ["keep"],
      documents: [{ name: "Edited canvas", layers: [] }],
      assets: [{ id: "keep" }],
    });
  });

  it("merges out-of-order concurrent assets and layers without losing either result", () => {
    const current = {
      ...workspace("latest prompt"),
      activeDocumentId: "canvas",
      assets: [asset("old")],
      documents: [{ ...canvas(), layers: [layer("old-layer", "old")] }],
    };
    const resultA = {
      generatedAssets: [asset("a")],
      workspace: {
        ...workspace("stale prompt A"),
        activeDocumentId: "other-canvas",
        assets: [asset("old"), asset("a")],
        documents: [{ ...canvas(), layers: [layer("old-layer", "old"), layer("a-layer", "a")] }],
      },
      warnings: [],
    };
    const resultB = {
      generatedAssets: [asset("b")],
      workspace: {
        ...workspace("stale prompt B"),
        activeDocumentId: "other-canvas",
        assets: [asset("old"), asset("b")],
        documents: [{ ...canvas(), layers: [layer("old-layer", "old"), layer("b-layer", "b")] }],
      },
      warnings: [],
    };

    const afterA = mergeConcurrentGenerationResult(current, resultA, "canvas");
    const merged = mergeConcurrentGenerationResult(afterA, resultB, "canvas");

    expect(merged.assets.map((item) => item.id)).toEqual(["old", "a", "b"]);
    expect(merged.documents[0]?.layers).toMatchObject([
      { id: "old-layer", assetId: "old", zIndex: 0 },
      { id: "a-layer", assetId: "a", zIndex: 1 },
      { id: "b-layer", assetId: "b", zIndex: 2 },
    ]);
  });

  it("keeps the live prompt and active canvas while merging a target result", () => {
    const current = {
      ...workspace("live prompt"),
      negativePrompt: "live negative",
      activeDocumentId: "second",
      assets: [asset("old")],
      documents: [canvas(), { ...canvas(), id: "second", name: "Second canvas", layers: [] }],
    };
    const result = {
      generatedAssets: [asset("generated")],
      workspace: {
        ...workspace("stale prompt"),
        negativePrompt: "stale negative",
        activeDocumentId: "canvas",
        assets: [asset("old"), asset("generated")],
        documents: [{ ...canvas(), layers: [layer("generated-layer", "generated")] }],
      },
      warnings: [],
    };

    const merged = mergeConcurrentGenerationResult(current, result, "canvas");

    expect(merged).toMatchObject({
      prompt: "live prompt",
      negativePrompt: "live negative",
      activeDocumentId: "second",
      documents: [
        { id: "canvas", name: "Edited canvas" },
        { id: "second", name: "Second canvas", layers: [] },
      ],
    });
    expect(merged.documents[0]?.layers.map((item) => item.id)).toEqual([
      "old-layer",
      "generated-layer",
    ]);
  });

  it("does not resurrect a server asset removed after the request started", () => {
    const current = {
      ...workspace("live prompt"),
      assets: [asset("keep")],
      documents: [],
    };
    const result = {
      generatedAssets: [asset("generated")],
      workspace: {
        ...workspace("stale prompt"),
        assets: [asset("keep"), asset("deleted"), asset("generated")],
        documents: [],
      },
      warnings: [],
    };

    const merged = mergeConcurrentGenerationResult(current, result, null);

    expect(merged.assets.map((item) => item.id)).toEqual(["keep", "generated"]);
  });

  it("does not recreate a target canvas closed before the response arrived", () => {
    const current = {
      ...workspace("live prompt"),
      assets: [],
      documents: [],
    };
    const result = {
      generatedAssets: [asset("generated")],
      workspace: {
        ...workspace("stale prompt"),
        assets: [asset("generated")],
        documents: [canvas()],
      },
      warnings: [],
    };

    const merged = mergeConcurrentGenerationResult(current, result, "canvas");

    expect(merged.assets.map((item) => item.id)).toEqual(["generated"]);
    expect(merged.documents).toEqual([]);
  });

  it("evicts least recently used entries within a byte budget", () => {
    const cache = new ImageStudioUrlCache(12);
    cache.set("a", "aa");
    cache.set("b", "bb");
    cache.get("a");
    cache.set("c", "ccc");
    expect(cache.get("a")).toBe("aa");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("ccc");
    cache.set("huge", "1234567");
    expect(cache.get("huge")).toBeUndefined();
    cache.delete("a");
    expect([...cache.keys()]).toEqual(["c"]);
  });
});
