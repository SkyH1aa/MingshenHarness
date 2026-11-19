import type {
  ComposerDraft,
  ComposerDraftAttachment,
  SaveComposerDraftInput,
} from "../../../shared/composer-draft";
import {
  COMPOSER_DRAFT_CONFLICT_MESSAGE,
  isComposerDraftConflict,
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
  conflict: boolean;
}

export type ComposerDraftConflictResolution = "overwrite" | "reload";

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
  refreshEpoch: number;
  baseRevision: string | null;
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

export function hasComposerDraftContent(
  value: Pick<ComposerDraftValue, "text" | "attachments" | "notificationDraftIds">,
): boolean {
  return Boolean(
    value.text.length || value.attachments.length || value.notificationDraftIds.length,
  );
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
        state: { value, ready: false, saving: false, error: null, conflict: false },
        listeners: new Set(),
        loaded: null,
        pending: null,
        refreshEpoch: 0,
        baseRevision: null,
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
        entry.baseRevision = saved?.revision ?? null;
        entry.persistedRevision = value.revision;
        entry.storedAttachments = new Set(value.attachments.map((item) => item.id));
        this.publish(entry, { value, ready: true, error: null, conflict: false });
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

  /**
   * Applies draft changes written by another window only while this cache is
   * clean. Never creates an entry just because another window saved a draft.
   */
  refreshIfClean(sessionId: string, changedRevision?: string | null): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.removed) return Promise.resolve();
    if (!entry.state.ready) {
      const loading = entry.loaded;
      if (!loading) return Promise.resolve();
      return loading.then(
        () => this.refreshIfClean(sessionId, changedRevision),
        () => undefined,
      );
    }
    if (
      entry.pending !== null ||
      entry.persistedRevision !== entry.state.value.revision ||
      (changedRevision !== undefined &&
        changedRevision !== null &&
        changedRevision === entry.state.value.revision)
    )
      return Promise.resolve();
    const valueAtRequest = entry.state.value.revision;
    const epoch = ++entry.refreshEpoch;
    return this.api
      .getComposerDraft(sessionId)
      .then((saved) => {
        if (
          entry.removed ||
          epoch !== entry.refreshEpoch ||
          !entry.state.ready ||
          entry.pending !== null ||
          entry.persistedRevision !== valueAtRequest ||
          entry.state.value.revision !== valueAtRequest
        )
          return;
        const value: ComposerDraftValue = saved
          ? {
              revision: saved.revision,
              text: saved.text,
              formatted: saved.formatted,
              attachments: saved.attachments.map(restoredAttachment),
              notificationDraftIds: saved.notificationDraftIds,
            }
          : emptyDraft();
        entry.baseRevision = saved?.revision ?? null;
        entry.persistedRevision = value.revision;
        entry.storedAttachments = new Set(value.attachments.map((item) => item.id));
        this.publish(entry, { value, ready: true, error: null, conflict: false });
      })
      .catch((cause: unknown) => {
        if (
          !entry.removed &&
          epoch === entry.refreshEpoch &&
          entry.persistedRevision === entry.state.value.revision
        )
          this.publish(entry, {
            error: cause instanceof Error ? cause.message : String(cause),
          });
      });
  }

  update(sessionId: string, change: (current: ComposerDraftValue) => ComposerDraftValue): void {
    const entry = this.entry(sessionId);
    if (!entry.state.ready || entry.removed) return;
    const value = change(entry.state.value);
    if (value === entry.state.value) return;
    this.publish(entry, {
      value: { ...value, revision: crypto.randomUUID() },
      ...(entry.state.conflict ? {} : { error: null }),
    });
    if (!entry.state.conflict) void this.save(sessionId).catch(() => undefined);
  }

  private save(sessionId: string, resolvingConflict = false): Promise<void> {
    const entry = this.entry(sessionId);
    if (entry.pending) return entry.pending;
    if (entry.state.conflict && !resolvingConflict)
      return Promise.reject(new Error(entry.state.error ?? COMPOSER_DRAFT_CONFLICT_MESSAGE));
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
          baseRevision: entry.baseRevision,
          revision: value.revision,
          text: value.text,
          formatted: value.formatted,
          attachmentIds: value.attachments.map((item) => item.id),
          ...(addedAttachments.length ? { addedAttachments } : {}),
          notificationDraftIds: value.notificationDraftIds,
        });
        entry.baseRevision = hasComposerDraftContent(value) ? value.revision : null;
        entry.storedAttachments = new Set(value.attachments.map((item) => item.id));
        entry.persistedRevision = value.revision;
      }
      this.publish(entry, { error: null, conflict: false });
    })()
      .catch((cause: unknown) => {
        this.publish(entry, {
          error: cause instanceof Error ? cause.message : String(cause),
          conflict: isComposerDraftConflict(cause),
        });
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
    const failed = new Set<string>();
    const pendingEntries = () =>
      [...this.entries.entries()].filter(
        ([id, entry]) =>
          !entry.removed &&
          !failed.has(id) &&
          (entry.pending !== null ||
            !entry.state.ready ||
            (entry.state.ready && entry.persistedRevision !== entry.state.value.revision)),
      );
    let targets = [...this.entries.entries()].filter(([, entry]) => !entry.removed);
    let firstFailure: unknown;
    let failedAny = false;
    while (targets.length) {
      const results = await Promise.allSettled(targets.map(([id]) => this.flush(id)));
      for (const [index, result] of results.entries()) {
        const target = targets[index];
        if (!target) continue;
        if (result.status !== "rejected") continue;
        failed.add(target[0]);
        if (!failedAny) {
          firstFailure = result.reason;
          failedAny = true;
        }
      }
      targets = pendingEntries();
    }
    if (failedAny) throw firstFailure;
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
      entry.baseRevision = null;
      entry.storedAttachments.clear();
      this.publish(entry, { error: null, conflict: false });
      await this.save(sessionId);
      return;
    }
    const value = {
      ...emptyDraft(),
      notificationDraftIds: entry.state.value.notificationDraftIds,
    };
    entry.baseRevision = null;
    entry.persistedRevision = value.revision;
    entry.storedAttachments.clear();
    this.publish(entry, { value, error: null, conflict: false });
  }

  async resolveConflict(
    sessionId: string,
    resolution: ComposerDraftConflictResolution,
  ): Promise<void> {
    const entry = this.entry(sessionId);
    if (!entry.state.ready) await this.load(sessionId);
    await entry.pending?.catch(() => undefined);
    if (entry.removed || !entry.state.conflict) return;
    const latest = await this.api.getComposerDraft(sessionId);
    if (entry.removed || !entry.state.conflict) return;
    if (resolution === "reload") {
      const value: ComposerDraftValue = latest
        ? {
            revision: latest.revision,
            text: latest.text,
            formatted: latest.formatted,
            attachments: latest.attachments.map(restoredAttachment),
            notificationDraftIds: latest.notificationDraftIds,
          }
        : emptyDraft();
      entry.baseRevision = latest?.revision ?? null;
      entry.persistedRevision = value.revision;
      entry.storedAttachments = new Set(value.attachments.map((item) => item.id));
      this.publish(entry, { value, error: null, conflict: false });
      return;
    }
    entry.baseRevision = latest?.revision ?? null;
    entry.storedAttachments = new Set(latest?.attachments.map((item) => item.id) ?? []);
    await this.save(sessionId, true);
  }

  async clearIfCurrent(sessionId: string, revision: string): Promise<void> {
    const entry = this.entry(sessionId);
    if (entry.state.value.revision !== revision) return;
    await this.flush(sessionId);
    if (await this.api.clearComposerDraft(sessionId, revision))
      await this.accepted(sessionId, revision);
  }
}
