import type {
  ComposerDraft,
  ComposerDraftAttachment,
  SaveComposerDraftInput,
} from "../../../shared/composer-draft";
import type { AttachmentKind } from "../../../shared/domain";

export interface DraftAttachment {
  id: string;
  file: File;
  kind: AttachmentKind;
  dataUrl?: string;
  path?: string;
}

export interface ComposerDraftValue {
  revision: string;
  text: string;
  formatted: boolean;
  attachments: DraftAttachment[];
  notificationDraftIds: string[];
}

export interface ComposerDraftState {
  value: ComposerDraftValue;
  ready: boolean;
  saving: boolean;
  error: string | null;
}

interface DraftApi {
  getComposerDraft(sessionId: string): Promise<ComposerDraft | null>;
  saveComposerDraft(input: SaveComposerDraftInput): Promise<void>;
  clearComposerDraft(sessionId: string, revision: string): Promise<boolean>;
}

interface DraftEntry {
  state: ComposerDraftState;
  listeners: Set<() => void>;
  loaded: Promise<void> | null;
  pending: Promise<void> | null;
  persistedRevision: string;
  storedAttachments: Set<string>;
  removed: boolean;
}

function emptyDraft(): ComposerDraftValue {
  return {
    revision: crypto.randomUUID(),
    text: "",
    formatted: false,
    attachments: [],
    notificationDraftIds: [],
  };
}

function restoredAttachment(attachment: ComposerDraftAttachment): DraftAttachment {
  const comma = attachment.dataUrl.indexOf(",");
  const bytes = Uint8Array.from(atob(attachment.dataUrl.slice(comma + 1)), (char) =>
    char.charCodeAt(0),
  );
  return {
    id: attachment.id,
    kind: attachment.kind,
    file: new File([bytes], attachment.name, { type: attachment.mimeType }),
    dataUrl: attachment.dataUrl,
    ...(attachment.path ? { path: attachment.path } : {}),
  };
}

export function readDraftAttachment(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Cannot read ${file.name}`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was interrupted`));
    reader.readAsDataURL(file);
  });
}

// Entries outlive ChatView mounts. Saving and accepted sends always target their original session.
export class ComposerDraftStore {
  private readonly entries = new Map<string, DraftEntry>();

  constructor(
    private readonly api: DraftApi,
    private readonly readAttachment = readDraftAttachment,
  ) {}

  private entry(sessionId: string): DraftEntry {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      const value = emptyDraft();
      entry = {
        state: { value, ready: false, saving: false, error: null },
        listeners: new Set(),
        loaded: null,
        pending: null,
        persistedRevision: value.revision,
        storedAttachments: new Set(),
        removed: false,
      };
      this.entries.set(sessionId, entry);
    }
    return entry;
  }

  private publish(entry: DraftEntry, update: Partial<ComposerDraftState>): void {
    entry.state = { ...entry.state, ...update };
    for (const listener of entry.listeners) listener();
  }

  state(sessionId: string): ComposerDraftState {
    return this.entry(sessionId).state;
  }

  subscribe(sessionId: string, listener: () => void): () => void {
    const entry = this.entry(sessionId);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  load(sessionId: string): Promise<void> {
    const entry = this.entry(sessionId);
    if (entry.state.ready) return Promise.resolve();
    if (entry.loaded) return entry.loaded;
    entry.loaded = this.api
      .getComposerDraft(sessionId)
      .then((saved) => {
        if (entry.removed) return;
        const value: ComposerDraftValue = saved
          ? {
              revision: saved.revision,
              text: saved.text,
              formatted: saved.formatted,
              attachments: saved.attachments.map(restoredAttachment),
              notificationDraftIds: saved.notificationDraftIds,
            }
          : emptyDraft();
        entry.persistedRevision = value.revision;
        entry.storedAttachments = new Set(value.attachments.map((item) => item.id));
        this.publish(entry, { value, ready: true, error: null });
      })
      .catch((cause: unknown) => {
        this.publish(entry, { error: cause instanceof Error ? cause.message : String(cause) });
        throw cause;
      })
      .finally(() => {
        entry.loaded = null;
      });
    return entry.loaded;
  }

  update(sessionId: string, change: (current: ComposerDraftValue) => ComposerDraftValue): void {
    const entry = this.entry(sessionId);
    if (!entry.state.ready || entry.removed) return;
    const value = change(entry.state.value);
    if (value === entry.state.value) return;
    this.publish(entry, {
      value: { ...value, revision: crypto.randomUUID() },
      error: null,
    });
    void this.save(sessionId).catch(() => undefined);
  }

  private save(sessionId: string): Promise<void> {
    const entry = this.entry(sessionId);
    if (entry.pending) return entry.pending;
    if (entry.persistedRevision === entry.state.value.revision) return Promise.resolve();
    this.publish(entry, { saving: true });
    entry.pending = (async () => {
      while (!entry.removed && entry.persistedRevision !== entry.state.value.revision) {
        const value = entry.state.value;
        const addedAttachments: ComposerDraftAttachment[] = [];
        for (const attachment of value.attachments) {
          if (entry.storedAttachments.has(attachment.id)) continue;
          const dataUrl = attachment.dataUrl ?? (await this.readAttachment(attachment.file));
          // Cache the byte encoding once, including when the user keeps editing during a read.
          attachment.dataUrl = dataUrl;
          const filePath = attachment.path ?? (attachment.file as File & { path?: string }).path;
          addedAttachments.push({
            id: attachment.id,
            name: attachment.file.name,
            mimeType: attachment.file.type || "application/octet-stream",
            size: attachment.file.size,
            kind: attachment.kind,
            dataUrl,
            ...(filePath ? { path: filePath } : {}),
          });
        }
        if (entry.removed) return;
        await this.api.saveComposerDraft({
          sessionId,
          revision: value.revision,
          text: value.text,
          formatted: value.formatted,
          attachmentIds: value.attachments.map((item) => item.id),
          ...(addedAttachments.length ? { addedAttachments } : {}),
          notificationDraftIds: value.notificationDraftIds,
        });
        entry.storedAttachments = new Set(value.attachments.map((item) => item.id));
        entry.persistedRevision = value.revision;
      }
      this.publish(entry, { error: null });
    })()
      .catch((cause: unknown) => {
        this.publish(entry, { error: cause instanceof Error ? cause.message : String(cause) });
        throw cause;
      })
      .finally(() => {
        entry.pending = null;
        this.publish(entry, { saving: false });
      });
    return entry.pending;
  }

  async flush(sessionId: string): Promise<void> {
    await this.load(sessionId);
    await this.save(sessionId);
  }

  async flushAll(): Promise<void> {
    do {
      await Promise.all(
        [...this.entries.entries()]
          .filter(([, entry]) => !entry.removed)
          .map(([id]) => this.flush(id)),
      );
    } while (
      this.hasPending() ||
      [...this.entries.values()].some((entry) => !entry.removed && !entry.state.ready)
    );
  }

  hasPending(): boolean {
    return [...this.entries.values()].some(
      (entry) =>
        !entry.removed &&
        (entry.pending !== null ||
          (entry.state.ready && entry.persistedRevision !== entry.state.value.revision)),
    );
  }

  forget(sessionIds: string[]): void {
    for (const sessionId of sessionIds) {
      const entry = this.entries.get(sessionId);
      if (entry) {
        entry.removed = true;
        this.entries.delete(sessionId);
      }
    }
  }

  async accepted(sessionId: string, revision: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.removed) return;
    if (!entry.state.ready) await this.load(sessionId);
    if (entry.removed) return;
    if (entry.state.value.revision !== revision) {
      // Acceptance may have removed attachment bytes before its IPC reply arrived.
      await entry.pending?.catch(() => undefined);
      if (entry.removed) return;
      entry.storedAttachments.clear();
      await this.save(sessionId);
      return;
    }
    const value = {
      ...emptyDraft(),
      notificationDraftIds: entry.state.value.notificationDraftIds,
    };
    entry.persistedRevision = value.revision;
    entry.storedAttachments.clear();
    this.publish(entry, { value, error: null });
  }

  async clearIfCurrent(sessionId: string, revision: string): Promise<void> {
    const entry = this.entry(sessionId);
    if (entry.state.value.revision !== revision) return;
    await this.flush(sessionId);
    if (await this.api.clearComposerDraft(sessionId, revision))
      await this.accepted(sessionId, revision);
  }
}
