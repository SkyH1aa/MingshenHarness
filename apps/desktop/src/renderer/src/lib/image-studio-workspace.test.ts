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
  mergeGeneratedResult,
  mergeRemovedAsset,
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
