import { describe, expect, it, vi } from "vitest";
import type { ModelCatalogPreferences } from "../../../shared/model-catalog";
import { ModelCatalogStore } from "./model-catalog-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  let saved: ModelCatalogPreferences = { providerOrder: ["a", "b", "c"], starredModelIds: [] };
  const copy = () => structuredClone(saved);
  const api = {
    getModelCatalogPreferences: vi.fn(async () => copy()),
    moveCatalogProvider: vi.fn(
      async (input: { providerId: string; beforeProviderId: string | null }) => {
        const order = saved.providerOrder.filter((id) => id !== input.providerId);
        const index =
          input.beforeProviderId === null ? order.length : order.indexOf(input.beforeProviderId);
        order.splice(index, 0, input.providerId);
        saved = { ...saved, providerOrder: order };
        return copy();
      },
    ),
    setCatalogModelStar: vi.fn(async (input: { modelConfigId: string; starred: boolean }) => {
      saved = {
        ...saved,
        starredModelIds: [
          ...saved.starredModelIds.filter((id) => id !== input.modelConfigId),
          ...(input.starred ? [input.modelConfigId] : []),
        ],
      };
      return copy();
    }),
  };
  return {
    api,
    store: new ModelCatalogStore(() => api),
    read: copy,
    remote: (preferences: ModelCatalogPreferences) => {
      saved = structuredClone(preferences);
    },
  };
}

describe("shared model catalog store", () => {
  it("deduplicates the initial load and notifies every mounted entry point", async () => {
    const { store, api } = fixture();
    const pending = deferred<ModelCatalogPreferences>();
    api.getModelCatalogPreferences.mockReturnValueOnce(pending.promise);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = store.subscribe(first);
    store.subscribe(second);
    const loading = store.load();
    expect(store.load()).toBe(loading);
    pending.resolve({ providerOrder: ["b", "a", "c"], starredModelIds: ["model-b"] });
    await loading;
    expect(api.getModelCatalogPreferences).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribe();
    await store.setStar("model-a", true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second.mock.calls.length).toBeGreaterThan(1);
    expect(store.getSnapshot().ready).toBe(true);
  });

  it("blocks mutations until the initial preferences have loaded", async () => {
    const { store, api } = fixture();
    await expect(store.setStar("model-a", true)).rejects.toThrow("not ready");
    expect(api.setCatalogModelStar).not.toHaveBeenCalled();
    expect(store.getSnapshot().saving).toBe(false);
  });

  it("serializes different operations and preserves both the order and stars", async () => {
    const { store, api, read } = fixture();
    await store.load();
    const blocked = deferred<void>();
    const original = api.moveCatalogProvider.getMockImplementation();
    api.moveCatalogProvider.mockImplementationOnce(async (input) => {
      await blocked.promise;
      if (!original) throw new Error("Missing fixture implementation.");
      return original(input);
    });
    const moving = store.moveProvider("c", "a");
    const starring = store.setStar("model-a", true);
    await Promise.resolve();
    expect(api.moveCatalogProvider).toHaveBeenCalledTimes(1);
    expect(api.setCatalogModelStar).not.toHaveBeenCalled();
    expect(store.getSnapshot().saving).toBe(true);
    blocked.resolve();
    await Promise.all([moving, starring]);
    expect(store.getSnapshot()).toMatchObject({
      preferences: { providerOrder: ["c", "a", "b"], starredModelIds: ["model-a"] },
      saving: false,
      error: null,
    });
    expect(store.getSnapshot().preferences).toEqual(read());
  });

  it("keeps the last saved value on failure and retries the precise operation on current server data", async () => {
    const { store, api, remote } = fixture();
    await store.load();
    api.setCatalogModelStar.mockRejectedValueOnce(new Error("Disk write failed"));
    await expect(store.setStar("model-b", true)).rejects.toThrow("Disk write failed");
    expect(store.getSnapshot()).toMatchObject({
      preferences: { providerOrder: ["a", "b", "c"], starredModelIds: [] },
      error: "Error: Disk write failed",
      saving: false,
    });
    remote({ providerOrder: ["c", "b", "a"], starredModelIds: ["model-a"] });
    await store.retry();
    expect(api.setCatalogModelStar).toHaveBeenLastCalledWith({
      modelConfigId: "model-b",
      starred: true,
    });
    expect(store.getSnapshot()).toMatchObject({
      preferences: { providerOrder: ["c", "b", "a"], starredModelIds: ["model-a", "model-b"] },
      error: null,
    });
  });

  it("recovers a failed initial load without enabling edits before the retry succeeds", async () => {
    const { store, api } = fixture();
    api.getModelCatalogPreferences.mockRejectedValueOnce(new Error("Read failed"));
    await expect(store.load()).rejects.toThrow("Read failed");
    expect(store.getSnapshot()).toMatchObject({ ready: false, error: "Error: Read failed" });
    await store.retry();
    expect(store.getSnapshot()).toMatchObject({ ready: true, error: null });
    expect(api.getModelCatalogPreferences).toHaveBeenCalledTimes(2);
  });

  it("refreshes after target deletion without retrying the obsolete failed operation", async () => {
    const { store, api, remote } = fixture();
    await store.load();
    api.setCatalogModelStar.mockRejectedValueOnce(new Error("Disk write failed"));
    await expect(store.setStar("deleted-model", true)).rejects.toThrow("Disk write failed");
    remote({ providerOrder: ["a", "c"], starredModelIds: ["model-c"] });
    await store.refresh();
    await store.retry();
    expect(api.setCatalogModelStar).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({
      preferences: { providerOrder: ["a", "c"], starredModelIds: ["model-c"] },
      error: null,
    });
  });

  it("retries a failed refresh as a read instead of replaying a deleted provider move", async () => {
    const { store, api, remote } = fixture();
    await store.load();
    api.moveCatalogProvider.mockRejectedValueOnce(new Error("Move failed"));
    await expect(store.moveProvider("b", "a")).rejects.toThrow("Move failed");
    remote({ providerOrder: ["a", "c"], starredModelIds: [] });
    api.getModelCatalogPreferences.mockRejectedValueOnce(new Error("Refresh failed"));
    await expect(store.refresh()).rejects.toThrow("Refresh failed");
    expect(store.getSnapshot().error).toBe("Error: Refresh failed");
    await store.retry();
    expect(api.moveCatalogProvider).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({
      preferences: { providerOrder: ["a", "c"], starredModelIds: [] },
      error: null,
    });
  });

  it("supersedes a pending read when the catalog changes", async () => {
    const { store, api, remote } = fixture();
    await store.load();
    const stale = deferred<ModelCatalogPreferences>();
    api.getModelCatalogPreferences.mockReturnValueOnce(stale.promise);
    const loading = store.load();
    await Promise.resolve();
    remote({ providerOrder: ["c", "a"], starredModelIds: ["model-c"] });
    await store.refresh();
    stale.resolve({ providerOrder: ["a", "b", "c"], starredModelIds: ["deleted-model"] });
    await loading;
    expect(store.getSnapshot().preferences).toEqual({
      providerOrder: ["c", "a"],
      starredModelIds: ["model-c"],
    });
  });

  it("discards a queued failure that settles after a catalog refresh begins", async () => {
    const { store, api, remote } = fixture();
    await store.load();
    const pending = deferred<ModelCatalogPreferences>();
    api.setCatalogModelStar.mockReturnValueOnce(pending.promise);
    const starring = store.setStar("deleted-model", true);
    const refreshing = store.refresh();
    remote({ providerOrder: ["a", "c"], starredModelIds: [] });
    pending.reject(new Error("Deleted target"));
    await expect(starring).rejects.toThrow("Deleted target");
    await refreshing;
    await store.retry();
    expect(api.setCatalogModelStar).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({
      preferences: { providerOrder: ["a", "c"], starredModelIds: [] },
      saving: false,
      error: null,
    });
  });

  it("allows another operation after a rejected queued mutation", async () => {
    const { store, api } = fixture();
    await store.load();
    api.moveCatalogProvider.mockRejectedValueOnce(new Error("Move failed"));
    const first = store.moveProvider("c", "a");
    const second = store.setStar("model-b", true);
    await expect(first).rejects.toThrow("Move failed");
    await second;
    expect(store.getSnapshot()).toMatchObject({
      preferences: { providerOrder: ["a", "b", "c"], starredModelIds: ["model-b"] },
      saving: false,
      error: null,
    });
  });

  it("ignores an old read that returns after a successful mutation", async () => {
    const { store, api } = fixture();
    await store.load();
    const stale = deferred<ModelCatalogPreferences>();
    api.getModelCatalogPreferences.mockReturnValueOnce(stale.promise);
    const loading = store.load();
    await Promise.resolve();
    await store.moveProvider("c", "a");
    stale.resolve({ providerOrder: ["a", "b", "c"], starredModelIds: [] });
    await loading;
    expect(store.getSnapshot().preferences.providerOrder).toEqual(["c", "a", "b"]);
  });

  it("ignores an old read error after newer preferences have been saved", async () => {
    const { store, api } = fixture();
    await store.load();
    const stale = deferred<ModelCatalogPreferences>();
    api.getModelCatalogPreferences.mockReturnValueOnce(stale.promise);
    const loading = store.load();
    await Promise.resolve();
    await store.setStar("model-a", true);
    stale.reject(new Error("Late old read error"));
    await expect(loading).rejects.toThrow("Late old read error");
    expect(store.getSnapshot()).toMatchObject({
      preferences: { starredModelIds: ["model-a"] },
      error: null,
    });
  });
});
