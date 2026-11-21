import {
  type CreativeWorkspaceDraft,
  parseCreativeWorkspaceDraft,
} from "../../../shared/creative-templates";

type DraftStorage = Pick<Storage, "getItem" | "setItem">;

export type CreativeDraftLoad =
  | { status: "missing" }
  | { status: "restored"; draft: CreativeWorkspaceDraft }
  | { status: "blocked"; reason: "invalid" | "unreadable" };

export function loadCreativeDraft(getStorage: () => DraftStorage, key: string): CreativeDraftLoad {
  try {
    const raw = getStorage().getItem(key);
    if (raw === null) return { status: "missing" };
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { status: "blocked", reason: "invalid" };
    }
    const draft = parseCreativeWorkspaceDraft(value);
    return draft ? { status: "restored", draft } : { status: "blocked", reason: "invalid" };
  } catch {
    return { status: "blocked", reason: "unreadable" };
  }
}

export type CreativeSaveResult = { status: "saved" } | { status: "error"; error: unknown };

interface FailedCreativeDraft {
  draft: CreativeWorkspaceDraft;
  error: unknown;
}

// Keep failed writes reachable when switching surfaces within the same renderer.
const failedDrafts = new Map<string, FailedCreativeDraft>();

class CreativeDraftAutosave {
  private pending: CreativeWorkspaceDraft | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly getStorage: () => DraftStorage,
    private readonly key: string,
    private readonly writable: boolean,
    private readonly onResult: (result: CreativeSaveResult) => void,
    recovered: FailedCreativeDraft | null,
    private readonly delay = 240,
  ) {
    this.pending = recovered?.draft ?? null;
  }

  schedule(draft: CreativeWorkspaceDraft): void {
    if (!this.writable && !this.pending) return;
    this.pending = draft;
    const failed = failedDrafts.get(this.key);
    if (failed) failedDrafts.set(this.key, { ...failed, draft });
    if (!this.writable) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const result = this.flush();
      if (result) this.onResult(result);
    }, this.delay);
  }

  flush(): CreativeSaveResult | null {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.writable || !this.pending) return null;
    const draft = this.pending;
    try {
      this.getStorage().setItem(this.key, JSON.stringify(draft));
      this.pending = null;
      if (failedDrafts.get(this.key)?.draft === draft) failedDrafts.delete(this.key);
      return { status: "saved" };
    } catch (error) {
      failedDrafts.set(this.key, { draft, error });
      return { status: "error", error };
    }
  }
}

export function openCreativeDraftStorage(
  getStorage: () => DraftStorage,
  key: string,
  onResult: (result: CreativeSaveResult) => void,
) {
  const load = loadCreativeDraft(getStorage, key);
  const recovered = failedDrafts.get(key) ?? null;
  return {
    load,
    recovered,
    autosave: new CreativeDraftAutosave(
      getStorage,
      key,
      load.status !== "blocked",
      onResult,
      recovered,
    ),
  };
}
