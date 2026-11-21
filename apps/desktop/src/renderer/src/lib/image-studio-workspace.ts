import {
  IMAGE_STUDIO_MAX_LAYERS,
  type ImageStudioGenerateResult,
  type ImageStudioWorkspace,
} from "../../../shared/image-studio";

type SaveResult = { status: "saved" } | { status: "error"; error: unknown };
type PendingSave = { workspace: ImageStudioWorkspace; onResult: (result: SaveResult) => void };

export class ImageStudioWorkspaceQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending: PendingSave | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly save: (workspace: ImageStudioWorkspace) => Promise<unknown>,
    private readonly delay = 320,
  ) {}

  schedule(workspace: ImageStudioWorkspace, onResult: (result: SaveResult) => void): void {
    this.pending = { workspace, onResult };
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, this.delay);
  }

  flush(): Promise<void> {
    this.clearTimer();
    return this.enqueue(() => this.savePending());
  }

  run<T>(action: () => Promise<T>): Promise<T> {
    this.clearTimer();
    return this.enqueue(async () => {
      await this.savePending();
      try {
        return await action();
      } finally {
        await this.savePending();
      }
    });
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action, action);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async savePending(): Promise<void> {
    while (this.pending) {
      const pending = this.pending;
      this.pending = null;
      try {
        await this.save(pending.workspace);
        pending.onResult({ status: "saved" });
      } catch (error) {
        this.pending ??= pending;
        pending.onResult({ status: "error", error });
        throw error;
      }
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

export class ImageStudioUrlCache {
  private readonly values = new Map<string, string>();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  get(id: string): string | undefined {
    const value = this.values.get(id);
    if (value === undefined) return undefined;
    this.values.delete(id);
    this.values.set(id, value);
    return value;
  }

  set(id: string, value: string): void {
    this.delete(id);
    const bytes = value.length * 2;
    if (bytes > this.maxBytes) return;
    while (this.bytes + bytes > this.maxBytes) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.values.set(id, value);
    this.bytes += bytes;
  }

  delete(id: string): void {
    const value = this.values.get(id);
    if (value === undefined) return;
    this.values.delete(id);
    this.bytes -= value.length * 2;
  }

  keys(): IterableIterator<string> {
    return this.values.keys();
  }
}

export function mergeAssetResult(
  current: ImageStudioWorkspace,
  server: ImageStudioWorkspace,
): ImageStudioWorkspace {
  return { ...current, assets: server.assets };
}

export function mergeRemovedAsset(
  current: ImageStudioWorkspace,
  server: ImageStudioWorkspace,
  assetId: string,
): ImageStudioWorkspace {
  return {
    ...current,
    assets: server.assets,
    selectedAssetIds: current.selectedAssetIds.filter((id) => id !== assetId),
    documents: current.documents.map((document) => ({
      ...document,
      layers: document.layers
        .filter((layer) => layer.assetId !== assetId)
        .map((layer, index) => ({ ...layer, zIndex: index })),
    })),
  };
}

export function mergeGeneratedResult(
  current: ImageStudioWorkspace,
  result: ImageStudioGenerateResult,
): ImageStudioWorkspace {
  return {
    ...current,
    assets: result.workspace.assets,
    documents: current.documents.map((document) => {
      const generated = result.workspace.documents
        .find((item) => item.id === document.id)
        ?.layers.filter((layer) => layer.assetId === result.asset.id);
      if (!generated?.length) return document;
      const ids = new Set(document.layers.map((layer) => layer.id));
      const layers = generated
        .filter((layer) => !ids.has(layer.id))
        .slice(0, Math.max(0, IMAGE_STUDIO_MAX_LAYERS - document.layers.length))
        .map((layer, index) => ({ ...layer, zIndex: document.layers.length + index }));
      return layers.length ? { ...document, layers: [...document.layers, ...layers] } : document;
    }),
  };
}
