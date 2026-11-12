import type { MingshenDesktopApi } from "../../../shared/ipc";
import type { ModelCatalogPreferences } from "../../../shared/model-catalog";

type CatalogApi = Pick<
  MingshenDesktopApi,
  "getModelCatalogPreferences" | "moveCatalogProvider" | "setCatalogModelStar"
>;
type CatalogMutation = (api: CatalogApi) => Promise<ModelCatalogPreferences>;
interface CatalogSnapshot {
  preferences: ModelCatalogPreferences;
  ready: boolean;
  saving: boolean;
  error: string | null;
}

export class ModelCatalogStore {
  private snapshot: CatalogSnapshot = {
    preferences: { providerOrder: [], starredModelIds: [] },
    ready: false,
    saving: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private revision = 0;
  private failed: CatalogMutation | null = null;

  constructor(private readonly api: () => CatalogApi) {}

  getSnapshot = (): CatalogSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(change: Partial<CatalogSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }

  load = (): Promise<void> => {
    if (this.loading) return this.loading;
    const revision = this.revision;
    const task = this.queue
      .then(() => this.api().getModelCatalogPreferences())
      .then((preferences) => {
        if (revision !== this.revision) return;
        this.failed = null;
        this.update({ preferences, ready: true, error: null });
      })
      .catch((cause) => {
        if (revision === this.revision) {
          this.failed = null;
          this.update({ error: String(cause) });
        }
        throw cause;
      })
      .finally(() => {
        if (this.loading === task) this.loading = null;
      });
    this.loading = task;
    return task;
  };

  refresh = (): Promise<void> => {
    // Catalog deletion can invalidate an earlier failed operation's target.
    this.revision++;
    this.loading = null;
    this.failed = null;
    return this.load();
  };

  private mutate(change: CatalogMutation): Promise<void> {
    if (!this.snapshot.ready) return Promise.reject(new Error("Model catalog is not ready."));
    this.revision++;
    this.pending++;
    this.update({ saving: true, error: null });
    const task = this.queue
      .then(async () => {
        try {
          const preferences = await change(this.api());
          this.failed = null;
          this.update({ preferences, error: null });
        } catch (cause) {
          this.failed = change;
          this.update({ error: String(cause) });
          throw cause;
        }
      })
      .finally(() => {
        this.pending--;
        this.update({ saving: this.pending > 0 });
      });
    this.queue = task.catch(() => undefined);
    return task;
  }

  moveProvider = (providerId: string, beforeProviderId: string | null): Promise<void> =>
    this.mutate((api) => api.moveCatalogProvider({ providerId, beforeProviderId }));

  setStar = (modelConfigId: string, starred: boolean): Promise<void> =>
    this.mutate((api) => api.setCatalogModelStar({ modelConfigId, starred }));

  retry = (): Promise<void> => (this.failed ? this.mutate(this.failed) : this.load());
}
