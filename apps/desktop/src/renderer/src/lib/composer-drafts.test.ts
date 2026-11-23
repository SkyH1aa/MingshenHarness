import { describe, expect, it, vi } from "vitest";
import {
  COMPOSER_DRAFT_CONFLICT_CODE,
  COMPOSER_DRAFT_CONFLICT_MESSAGE,
  type ComposerDraft,
  type SaveComposerDraftInput,
} from "../../../shared/composer-draft";
import { ComposerDraftStore } from "./composer-drafts";

function fixture() {
  const records = new Map<string, ComposerDraft>();
  const api = {
    getComposerDraft: vi.fn(async (id: string) => records.get(id) ?? null),
    saveComposerDraft: vi.fn(async (input: SaveComposerDraftInput) => {
      const existing = records.get(input.sessionId);
      if (input.baseRevision !== undefined && input.baseRevision !== (existing?.revision ?? null))
        throw new Error(COMPOSER_DRAFT_CONFLICT_MESSAGE);
      const attachments = [...(existing?.attachments ?? []), ...(input.addedAttachments ?? [])];
      if (input.text.length || input.attachmentIds.length || input.notificationDraftIds.length)
        records.set(input.sessionId, {
          sessionId: input.sessionId,
          revision: input.revision,
          text: input.text,
          formatted: input.formatted,
          attachments: input.attachmentIds.map((id) => {
            const attachment = attachments.find((item) => item.id === id);
            if (!attachment) throw new Error("Missing attachment");
            return attachment;
          }),
          notificationDraftIds: input.notificationDraftIds,
        });
      else records.delete(input.sessionId);
    }),
    clearComposerDraft: vi.fn(async (id: string, revision: string) => {
      const existing = records.get(id);
      if (existing?.revision !== revision) return false;
      if (existing.notificationDraftIds.length)
        records.set(id, {
          ...existing,
          text: "",
          formatted: false,
          attachments: [],
        });
      else records.delete(id);
      return true;
    }),
  };
  const readAttachment = vi.fn(async () => "data:text/plain;base64,aGVsbG8=");
  return { api, records, readAttachment, store: new ComposerDraftStore(api, readAttachment) };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("composer draft persistence", () => {
  it("does not load or decode an unknown session when it is targeted for flush", async () => {
    const { store, api, readAttachment } = fixture();
    await store.flushIfPresent("not-opened");
    await store.flushAll();
    expect(api.getComposerDraft).not.toHaveBeenCalled();
    expect(api.saveComposerDraft).not.toHaveBeenCalled();
    expect(readAttachment).not.toHaveBeenCalled();
  });

  it("waits for an existing pending draft and reports its revision conflict", async () => {
    const { store, api } = fixture();
    await store.load("target");
    const blocked = deferred();
    api.saveComposerDraft.mockImplementationOnce(async () => {
      await blocked.promise;
      throw new Error(COMPOSER_DRAFT_CONFLICT_MESSAGE);
    });
    store.update("target", (value) => ({ ...value, text: "local edits" }));
    const pending = store.flushIfPresent("target");
    const result = expect(pending).rejects.toThrow(COMPOSER_DRAFT_CONFLICT_MESSAGE);
    blocked.resolve();
    await result;
    expect(store.state("target")).toMatchObject({
      conflict: true,
      value: { text: "local edits" },
    });
    await expect(store.flushIfPresent("target")).rejects.toThrow(COMPOSER_DRAFT_CONFLICT_MESSAGE);
    expect(api.getComposerDraft).toHaveBeenCalledTimes(1);
  });

  it("does not restore a consumed draft from a delayed load snapshot", async () => {
    const { store, api } = fixture();
    const blocked = deferred();
    api.getComposerDraft.mockImplementationOnce(async () => {
      await blocked.promise;
      return {
        sessionId: "a",
        revision: "consumed",
        text: "already sent",
        formatted: false,
        attachments: [],
        notificationDraftIds: [],
      };
    });
    const loading = store.load("a");
    const accepting = store.accepted("a", "consumed");
    blocked.resolve();
    await Promise.all([loading, accepting]);
    expect(store.state("a").value.text).toBe("");
    expect(api.saveComposerDraft).not.toHaveBeenCalled();
  });

  it("restores exact whitespace, formatting and attachments into an independent session", async () => {
    const { store, api, records } = fixture();
    records.set("a", {
      sessionId: "a",
      revision: "stored-a",
      text: "  # 中文\n\n$x^2$  \n ",
      formatted: true,
      attachments: [
        {
          id: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          size: 5,
          kind: "file",
          dataUrl: "data:text/plain;base64,aGVsbG8=",
          path: "C:\\temporary\\notes.txt",
        },
      ],
      notificationDraftIds: ["notification-a"],
    });
    await Promise.all([store.load("a"), store.load("b")]);
    expect(store.state("a").value).toMatchObject({
      text: "  # 中文\n\n$x^2$  \n ",
      formatted: true,
      notificationDraftIds: ["notification-a"],
    });
    expect(await store.state("a").value.attachments[0]?.file.text()).toBe("hello");
    expect(store.state("a").value.attachments[0]?.path).toBe("C:\\temporary\\notes.txt");
    expect(store.state("b").value.text).toBe("");
    expect(api.saveComposerDraft).not.toHaveBeenCalled();
  });

  it("coalesces edits in order and never overwrites the latest text with an older response", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    const blocked = deferred();
    const save = api.saveComposerDraft.getMockImplementation();
    api.saveComposerDraft.mockImplementationOnce(async (input) => {
      await blocked.promise;
      await save?.(input);
    });
    store.update("a", (value) => ({ ...value, text: "first" }));
    store.update("a", (value) => ({ ...value, text: "second" }));
    store.update("a", (value) => ({ ...value, text: "last" }));
    expect(store.hasPending()).toBe(true);
    blocked.resolve();
    await store.flushAll();
    expect(store.state("a").value.text).toBe("last");
    expect(records.get("a")?.text).toBe("last");
    expect(api.saveComposerDraft).toHaveBeenCalledTimes(2);
    expect(api.saveComposerDraft.mock.calls[0]?.[0].baseRevision).toBeNull();
    expect(api.saveComposerDraft.mock.calls[1]?.[0].baseRevision).toBe(
      api.saveComposerDraft.mock.calls[0]?.[0].revision,
    );
    expect(store.hasPending()).toBe(false);
  });

  it("stores attachment bytes once while saving later text and attachment removal", async () => {
    const { store, api, readAttachment, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({
      ...value,
      attachments: [
        {
          id: "file",
          file: new File(["hello"], "notes.txt", { type: "text/plain" }),
          kind: "file",
        },
      ],
    }));
    await store.flush("a");
    store.update("a", (value) => ({ ...value, text: "with attachment" }));
    await store.flush("a");
    expect(readAttachment).toHaveBeenCalledTimes(1);
    expect(api.saveComposerDraft.mock.calls[0]?.[0].addedAttachments).toHaveLength(1);
    expect(api.saveComposerDraft.mock.calls[1]?.[0].addedAttachments).toBeUndefined();
    store.update("a", (value) => ({ ...value, attachments: [] }));
    await store.flush("a");
    expect(records.get("a")?.attachments).toEqual([]);
    expect(records.get("a")?.text).toBe("with attachment");
  });

  it("uses a null base revision after clearing all text before the next draft", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({ ...value, text: "A" }));
    await store.flush("a");
    expect(records.get("a")?.text).toBe("A");

    store.update("a", (value) => ({ ...value, text: "" }));
    await store.flush("a");
    expect(records.has("a")).toBe(false);
    expect(store.hasPending()).toBe(false);

    store.update("a", (value) => ({ ...value, text: "B" }));
    await store.flush("a");

    expect(records.get("a")?.text).toBe("B");
    expect(api.saveComposerDraft.mock.calls[2]?.[0].baseRevision).toBeNull();
    expect(store.state("a")).toMatchObject({ conflict: false, error: null });
  });

  it("uses a null base revision after removing the last attachment before new text", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({
      ...value,
      attachments: [{ id: "file", file: new File(["hello"], "notes.txt"), kind: "file" }],
    }));
    await store.flush("a");
    expect(records.get("a")?.attachments).toHaveLength(1);

    store.update("a", (value) => ({ ...value, attachments: [] }));
    await store.flush("a");
    expect(records.has("a")).toBe(false);
    expect(store.hasPending()).toBe(false);

    store.update("a", (value) => ({ ...value, text: "after attachment" }));
    await store.flush("a");

    expect(records.get("a")?.text).toBe("after attachment");
    expect(api.saveComposerDraft.mock.calls[2]?.[0].baseRevision).toBeNull();
    expect(store.state("a")).toMatchObject({ conflict: false, error: null });
  });

  it("flushes in-flight attachment reads before reporting all drafts saved", async () => {
    const { api } = fixture();
    const blocked = deferred();
    const store = new ComposerDraftStore(api, async () => {
      await blocked.promise;
      return "data:text/plain;base64,aGVsbG8=";
    });
    await store.load("a");
    store.update("a", (value) => ({
      ...value,
      attachments: [{ id: "file", file: new File(["hello"], "notes.txt"), kind: "file" }],
    }));
    let finished = false;
    const flushed = store.flushAll().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(api.saveComposerDraft).not.toHaveBeenCalled();
    blocked.resolve();
    await flushed;
    expect(finished).toBe(true);
    expect(api.saveComposerDraft.mock.calls[0]?.[0].addedAttachments?.[0]?.size).toBe(5);
  });

  it("preserves newer drafts when an older send finishes after switching back", async () => {
    const { store, api } = fixture();
    await Promise.all([store.load("a"), store.load("b")]);
    store.update("a", (value) => ({ ...value, text: "submitted" }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    store.update("b", (value) => ({ ...value, text: "other chat" }));
    store.update("a", (value) => ({ ...value, text: "new after send" }));
    await store.accepted("a", submitted);
    expect(store.state("a").value.text).toBe("new after send");
    expect(store.state("b").value.text).toBe("other chat");
    await store.flushAll();
    const latest = store.state("a").value.revision;
    await api.clearComposerDraft("a", latest);
    await store.accepted("a", latest);
    expect(store.state("a").value.text).toBe("");
    expect(store.state("b").value.text).toBe("other chat");
  });

  it("retains the input and retries after a save failure", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    api.saveComposerDraft.mockRejectedValueOnce(new Error("disk full"));
    store.update("a", (value) => ({ ...value, text: "retain this" }));
    await expect(store.flush("a")).rejects.toThrow("disk full");
    expect(store.state("a").value.text).toBe("retain this");
    expect(store.state("a").error).toBe("disk full");
    expect(store.hasPending()).toBe(true);
    await store.flush("a");
    expect(records.get("a")?.text).toBe("retain this");
    expect(store.state("a").error).toBeNull();
  });

  it("retains newer text after a clear until an ambiguous conflict is explicitly resolved", async () => {
    const { store, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({
      ...value,
      text: "submitted",
      attachments: [{ id: "file", file: new File(["hello"], "notes.txt"), kind: "file" }],
    }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    records.delete("a");
    store.update("a", (value) => ({ ...value, text: "newer text with the same attachment" }));
    await expect(store.flush("a")).rejects.toThrow(COMPOSER_DRAFT_CONFLICT_CODE);
    await store.accepted("a", submitted);
    expect(store.state("a")).toMatchObject({ conflict: true });
    expect(records.has("a")).toBe(false);
    await store.resolveConflict("a", "overwrite");
    expect(store.state("a").error).toBeNull();
    expect(records.get("a")?.text).toBe("newer text with the same attachment");
    expect(records.get("a")?.attachments[0]?.dataUrl).toBe("data:text/plain;base64,aGVsbG8=");
  });

  it("keeps the saved newer revision and attachment cache after an older acceptance", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({
      ...value,
      text: "submitted",
      attachments: [{ id: "file", file: new File(["hello"], "notes.txt"), kind: "file" }],
    }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    store.update("a", (value) => ({ ...value, text: "newer" }));
    await store.flush("a");
    const newer = store.state("a").value.revision;

    expect(await api.clearComposerDraft("a", submitted)).toBe(false);
    await store.accepted("a", submitted);
    store.update("a", (value) => ({ ...value, text: "newest" }));
    await store.flush("a");

    expect(api.saveComposerDraft.mock.calls[2]?.[0]).toMatchObject({ baseRevision: newer });
    expect(api.saveComposerDraft.mock.calls[2]?.[0].addedAttachments).toBeUndefined();
    expect(records.get("a")?.text).toBe("newest");
    expect(records.get("a")?.attachments).toHaveLength(1);
    expect(store.state("a")).toMatchObject({ conflict: false, error: null });
  });

  it("uses the retained notification record revision after an accepted send", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({
      ...value,
      text: "submitted",
      notificationDraftIds: ["notification"],
    }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    expect(await api.clearComposerDraft("a", submitted)).toBe(true);
    expect(records.get("a")).toMatchObject({ revision: submitted, text: "" });

    await store.accepted("a", submitted);
    expect(store.state("a").value).toMatchObject({
      text: "",
      notificationDraftIds: ["notification"],
    });
    store.update("a", (value) => ({ ...value, text: "after send" }));
    await store.flush("a");

    expect(api.saveComposerDraft.mock.calls[1]?.[0].baseRevision).toBe(submitted);
    expect(records.get("a")).toMatchObject({
      text: "after send",
      notificationDraftIds: ["notification"],
    });
  });

  it.each([{ notificationDraftIds: [] }, { notificationDraftIds: ["notification"] }])(
    "reconciles a pending attachment save after clear with notification IDs $notificationDraftIds",
    async ({ notificationDraftIds }) => {
      const { store, api, records } = fixture();
      await store.load("a");
      store.update("a", (value) => ({
        ...value,
        text: "submitted",
        attachments: [{ id: "file", file: new File(["hello"], "notes.txt"), kind: "file" }],
        notificationDraftIds,
      }));
      await store.flush("a");
      const submitted = store.state("a").value.revision;
      const blocked = deferred();
      const started = deferred();
      const save = api.saveComposerDraft.getMockImplementation();
      api.saveComposerDraft.mockImplementationOnce(async (input) => {
        started.resolve();
        await blocked.promise;
        await save?.(input);
      });
      store.update("a", (value) => ({ ...value, text: "newer" }));
      await started.promise;
      expect(await api.clearComposerDraft("a", submitted)).toBe(true);
      const accepting = store.accepted("a", submitted);
      blocked.resolve();
      await accepting;

      if (!notificationDraftIds.length) {
        expect(store.state("a")).toMatchObject({ conflict: true, value: { text: "newer" } });
        expect(records.has("a")).toBe(false);
        await store.resolveConflict("a", "overwrite");
      }

      expect(api.saveComposerDraft.mock.calls[2]?.[0]).toMatchObject({
        baseRevision: notificationDraftIds.length ? submitted : null,
        addedAttachments: [expect.objectContaining({ id: "file" })],
      });
      expect(records.get("a")).toMatchObject({
        text: "newer",
        notificationDraftIds,
        attachments: [expect.objectContaining({ id: "file" })],
      });
      expect(store.state("a")).toMatchObject({ conflict: false, error: null });
    },
  );

  it("keeps a conflicting local edit when another window has a newer revision", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({ ...value, text: "submitted" }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    const blocked = deferred();
    const started = deferred();
    const save = api.saveComposerDraft.getMockImplementation();
    api.saveComposerDraft.mockImplementationOnce(async (input) => {
      started.resolve();
      await blocked.promise;
      await save?.(input);
    });
    store.update("a", (value) => ({ ...value, text: "local edit" }));
    await started.promise;
    records.set("a", {
      sessionId: "a",
      revision: "remote-newer",
      text: "other window",
      formatted: false,
      attachments: [],
      notificationDraftIds: [],
    });
    const accepting = store.accepted("a", submitted);
    blocked.resolve();
    await accepting;

    expect(store.state("a")).toMatchObject({
      conflict: true,
      error: expect.stringContaining(COMPOSER_DRAFT_CONFLICT_CODE),
      value: { text: "local edit" },
    });
    expect(records.get("a")).toMatchObject({ revision: "remote-newer", text: "other window" });
    expect(api.saveComposerDraft).toHaveBeenCalledTimes(2);
    await expect(store.flush("a")).rejects.toThrow(COMPOSER_DRAFT_CONFLICT_CODE);
  });

  it("does not resurrect a draft after another window writes and deletes a newer revision", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({ ...value, text: "submitted" }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    const blocked = deferred();
    const started = deferred();
    const save = api.saveComposerDraft.getMockImplementation();
    api.saveComposerDraft.mockImplementationOnce(async (input) => {
      started.resolve();
      await blocked.promise;
      await save?.(input);
    });
    store.update("a", (value) => ({ ...value, text: "local edit" }));
    await started.promise;
    records.set("a", {
      sessionId: "a",
      revision: "other-window",
      text: "newer then deleted",
      formatted: false,
      attachments: [],
      notificationDraftIds: [],
    });
    expect(await api.clearComposerDraft("a", submitted)).toBe(false);
    blocked.resolve();
    await expect(store.flush("a")).rejects.toThrow(COMPOSER_DRAFT_CONFLICT_CODE);
    records.delete("a");

    await store.accepted("a", submitted);
    await store.accepted("a", submitted);
    expect(records.has("a")).toBe(false);
    expect(api.saveComposerDraft).toHaveBeenCalledTimes(2);
    expect(store.state("a")).toMatchObject({ conflict: true, value: { text: "local edit" } });
  });

  it("preserves a newer saved edit that arrives while acceptance reads the cleared draft", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({
      ...value,
      text: "submitted",
      notificationDraftIds: ["notification"],
    }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    await api.clearComposerDraft("a", submitted);
    const blocked = deferred();
    const started = deferred();
    api.getComposerDraft.mockImplementationOnce(async (id) => {
      const snapshot = records.get(id) ?? null;
      started.resolve();
      await blocked.promise;
      return snapshot;
    });
    const accepting = store.accepted("a", submitted);
    await started.promise;
    store.update("a", (value) => ({ ...value, text: "newer" }));
    await api.saveComposerDraft.mock.results[1]?.value;
    const newer = store.state("a").value.revision;
    blocked.resolve();
    await accepting;
    store.update("a", (value) => ({ ...value, text: "newest" }));
    await store.flush("a");

    expect(api.saveComposerDraft.mock.calls[2]?.[0].baseRevision).toBe(newer);
    expect(records.get("a")?.text).toBe("newest");
  });

  it("uses CAS if another window writes after the acceptance read", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({
      ...value,
      text: "submitted",
      attachments: [{ id: "file", file: new File(["hello"], "notes.txt"), kind: "file" }],
      notificationDraftIds: ["notification"],
    }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    await api.clearComposerDraft("a", submitted);
    store.update("a", (value) => ({ ...value, text: "local edit" }));
    await expect(store.flush("a")).rejects.toThrow("Missing attachment");
    api.getComposerDraft.mockImplementationOnce(async () => {
      const snapshot = records.get("a") ?? null;
      records.set("a", {
        sessionId: "a",
        revision: "remote-after-read",
        text: "other window",
        formatted: false,
        attachments: [],
        notificationDraftIds: [],
      });
      return snapshot;
    });

    await expect(store.accepted("a", submitted)).rejects.toThrow(COMPOSER_DRAFT_CONFLICT_CODE);
    expect(records.get("a")).toMatchObject({ revision: "remote-after-read", text: "other window" });
    expect(store.state("a")).toMatchObject({ conflict: true, value: { text: "local edit" } });
  });

  it("handles duplicate consumed events and a response without resetting a later edit", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({
      ...value,
      text: "submitted",
      notificationDraftIds: ["notification"],
    }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    await api.clearComposerDraft("a", submitted);
    const blocked = deferred();
    const started = deferred();
    api.getComposerDraft.mockImplementationOnce(async (id) => {
      const snapshot = records.get(id) ?? null;
      started.resolve();
      await blocked.promise;
      return snapshot;
    });
    const first = store.accepted("a", submitted);
    await started.promise;
    const duplicate = store.accepted("a", submitted);
    blocked.resolve();
    await Promise.all([first, duplicate]);
    store.update("a", (value) => ({ ...value, text: "newer" }));
    await store.flush("a");
    const newer = store.state("a").value.revision;
    await store.accepted("a", submitted);
    store.update("a", (value) => ({ ...value, text: "newest" }));
    await store.flush("a");

    expect(api.getComposerDraft).toHaveBeenCalledTimes(2);
    expect(api.saveComposerDraft.mock.calls[2]?.[0].baseRevision).toBe(newer);
    expect(records.get("a")?.text).toBe("newest");
  });

  it("retains the submitted draft when the acceptance read fails and allows retry", async () => {
    const { store, api } = fixture();
    await store.load("a");
    store.update("a", (value) => ({ ...value, text: "submitted" }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    await api.clearComposerDraft("a", submitted);
    api.getComposerDraft.mockRejectedValueOnce(new Error("read failed"));

    await expect(store.accepted("a", submitted)).rejects.toThrow("read failed");
    expect(store.state("a")).toMatchObject({ error: "read failed", value: { text: "submitted" } });
    expect(store.hasPending()).toBe(true);
    api.getComposerDraft.mockRejectedValueOnce(new Error("still unavailable"));
    await expect(store.flush("a")).rejects.toThrow("still unavailable");
    expect(store.state("a").value.text).toBe("submitted");
    await store.flush("a");
    expect(store.state("a")).toMatchObject({ error: null, value: { text: "" } });
    expect(store.hasPending()).toBe(false);
  });

  it("ignores a failed acceptance read made stale by a newer saved edit", async () => {
    const { store, api } = fixture();
    await store.load("a");
    store.update("a", (value) => ({
      ...value,
      text: "submitted",
      notificationDraftIds: ["notification"],
    }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    await api.clearComposerDraft("a", submitted);
    const blocked = deferred();
    const started = deferred();
    api.getComposerDraft.mockImplementationOnce(async () => {
      started.resolve();
      await blocked.promise;
      throw new Error("stale read failed");
    });
    const accepting = store.accepted("a", submitted);
    await started.promise;
    store.update("a", (value) => ({ ...value, text: "newer" }));
    await api.saveComposerDraft.mock.results[1]?.value;
    blocked.resolve();
    await accepting;
    expect(store.state("a")).toMatchObject({ error: null, value: { text: "newer" } });
  });

  it("loads another window's newer draft when the accepted local draft is clean", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({ ...value, text: "submitted" }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;
    records.set("a", {
      sessionId: "a",
      revision: "other-window",
      text: "new remote draft",
      formatted: true,
      attachments: [],
      notificationDraftIds: [],
    });

    await store.accepted("a", submitted);
    expect(store.state("a")).toMatchObject({
      conflict: false,
      value: { revision: "other-window", text: "new remote draft", formatted: true },
    });
    store.update("a", (value) => ({ ...value, text: "continued" }));
    await store.flush("a");
    expect(api.saveComposerDraft.mock.calls[1]?.[0].baseRevision).toBe("other-window");
    expect(records.get("a")?.text).toBe("continued");
  });

  it("does not erase a submitted revision if the stored draft was not consumed", async () => {
    const { store } = fixture();
    await store.load("a");
    store.update("a", (value) => ({ ...value, text: "still stored" }));
    await store.flush("a");
    const submitted = store.state("a").value.revision;

    await store.accepted("a", submitted);
    expect(store.state("a")).toMatchObject({
      conflict: true,
      value: { revision: submitted, text: "still stored" },
    });
  });

  it("does not recreate a forgotten entry while its acceptance is queued", async () => {
    const { store, api } = fixture();
    store.state("a");
    const accepting = store.accepted("a", "submitted");
    store.forget(["a"]);
    await accepting;

    expect(api.getComposerDraft).not.toHaveBeenCalled();
    expect(store.hasPending()).toBe(false);
  });

  it("waits for an acceptance added to another session during flushAll", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    const blockedSave = deferred();
    const startedSave = deferred();
    const save = api.saveComposerDraft.getMockImplementation();
    api.saveComposerDraft.mockImplementationOnce(async (input) => {
      startedSave.resolve();
      await blockedSave.promise;
      await save?.(input);
    });
    store.update("a", (value) => ({ ...value, text: "pending a" }));
    await startedSave.promise;
    let finished = false;
    const flushing = store.flushAll().then(() => {
      finished = true;
    });
    await store.load("b");
    store.update("b", (value) => ({ ...value, text: "submitted b" }));
    await store.flush("b");
    const submitted = store.state("b").value.revision;
    await api.clearComposerDraft("b", submitted);
    const blockedRead = deferred();
    const startedRead = deferred();
    api.getComposerDraft.mockImplementationOnce(async (id) => {
      const snapshot = records.get(id) ?? null;
      startedRead.resolve();
      await blockedRead.promise;
      return snapshot;
    });
    const accepting = store.accepted("b", submitted);
    await startedRead.promise;
    blockedSave.resolve();
    await api.saveComposerDraft.mock.results[0]?.value;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finished).toBe(false);
    blockedRead.resolve();
    await Promise.all([flushing, accepting]);
    expect(store.state("b").value.text).toBe("");
    expect(store.hasPending()).toBe(false);
  });

  it("waits for new session entries created while a previous session is flushing", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    const first = deferred();
    const second = deferred();
    const save = api.saveComposerDraft.getMockImplementation();
    api.saveComposerDraft.mockImplementation(async (input) => {
      await (input.sessionId === "a" ? first.promise : second.promise);
      await save?.(input);
    });
    store.update("a", (value) => ({ ...value, text: "first session" }));
    const settled = vi.fn();
    const flush = store.flushAll().then(settled);
    await store.load("b");
    store.update("b", (value) => ({ ...value, text: "second session" }));
    first.resolve();
    await vi.waitFor(() => expect(records.get("a")?.text).toBe("first session"));
    expect(settled).not.toHaveBeenCalled();
    second.resolve();
    await flush;
    expect(records.get("b")?.text).toBe("second session");
    expect(settled).toHaveBeenCalledOnce();
  });

  it("waits for delayed saves before throwing the first rejected draft", async () => {
    const { store, api, records } = fixture();
    await Promise.all([store.load("a"), store.load("b")]);
    const delayedSave = deferred();
    const save = api.saveComposerDraft.getMockImplementation();
    api.saveComposerDraft.mockImplementation(async (input) => {
      if (input.sessionId === "a") throw new Error("first draft failed");
      await delayedSave.promise;
      await save?.(input);
    });
    store.update("a", (value) => ({ ...value, text: "failing draft" }));
    store.update("b", (value) => ({ ...value, text: "delayed draft" }));
    await vi.waitFor(() => expect(store.state("a").error).toBe("first draft failed"));
    let failure: unknown;
    const flushing = store.flushAll().catch((cause: unknown) => {
      failure = cause;
    });
    await vi.waitFor(() => expect(api.saveComposerDraft).toHaveBeenCalledTimes(3));
    expect(failure).toBeUndefined();
    expect(records.has("b")).toBe(false);

    delayedSave.resolve();
    await flushing;

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("first draft failed");
    expect(records.get("b")?.text).toBe("delayed draft");
    expect(store.state("a")).toMatchObject({ error: "first draft failed", conflict: false });
  });

  it("does not write blank state over an unreadable saved draft and permits retry", async () => {
    const { store, api, records } = fixture();
    api.getComposerDraft.mockRejectedValueOnce(new Error("read failed"));
    await expect(store.load("a")).rejects.toThrow("read failed");
    store.update("a", (value) => ({ ...value, text: "too early" }));
    expect(api.saveComposerDraft).not.toHaveBeenCalled();
    expect(store.state("a").ready).toBe(false);
    records.set("a", {
      sessionId: "a",
      revision: "recovered",
      text: "saved",
      formatted: false,
      attachments: [],
      notificationDraftIds: [],
    });
    await store.flush("a");
    expect(store.state("a").value.text).toBe("saved");
    expect(api.saveComposerDraft).not.toHaveBeenCalled();
  });

  it("clears only the matching submitted revision for local commands", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    store.update("a", (value) => ({ ...value, text: "/status" }));
    const revision = store.state("a").value.revision;
    await store.clearIfCurrent("a", revision);
    expect(records.has("a")).toBe(false);
    expect(store.state("a").value.text).toBe("");
    store.update("a", (value) => ({ ...value, text: "new" }));
    await store.clearIfCurrent("a", revision);
    expect(api.clearComposerDraft).toHaveBeenCalledTimes(1);
    expect(store.state("a").value.text).toBe("new");
    await store.flush("a");
  });

  it("forgets manually deleted chats without recreating them during shutdown", async () => {
    const { store, api } = fixture();
    await store.load("a");
    const blocked = deferred();
    const save = api.saveComposerDraft.getMockImplementation();
    api.saveComposerDraft.mockImplementationOnce(async (input) => {
      await blocked.promise;
      await save?.(input);
    });
    store.update("a", (value) => ({ ...value, text: "before delete" }));
    store.forget(["a"]);
    blocked.resolve();
    await store.flushAll();
    expect(store.hasPending()).toBe(false);
    await store.accepted("a", "late-send-response");
    expect(api.getComposerDraft).toHaveBeenCalledTimes(1);
  });

  it("finishes a flush when deletion arrives during an in-flight rejected save", async () => {
    const { store, api } = fixture();
    await store.load("a");
    const blocked = deferred();
    api.saveComposerDraft.mockImplementationOnce(async () => {
      await blocked.promise;
      throw new Error("session was removed");
    });
    store.update("a", (value) => ({ ...value, text: "pending deletion" }));
    const flushing = store.flushAll();
    await Promise.resolve();
    store.forget(["a"]);
    blocked.resolve();
    await expect(flushing).resolves.toBeUndefined();
    await expect(store.flushAll()).resolves.toBeUndefined();
    expect(store.hasPending()).toBe(false);
    expect(api.getComposerDraft).toHaveBeenCalledTimes(1);
  });

  it("does not recreate a forgotten entry when a delayed load rejects during flush", async () => {
    const { store, api } = fixture();
    const blocked = deferred();
    api.getComposerDraft.mockImplementationOnce(async () => {
      await blocked.promise;
      throw new Error("session was removed");
    });
    store.state("a");
    const flushing = store.flushAll();
    store.forget(["a"]);
    blocked.resolve();
    await expect(flushing).resolves.toBeUndefined();
    await expect(store.flushAll()).resolves.toBeUndefined();
    expect(store.hasPending()).toBe(false);
    expect(api.getComposerDraft).toHaveBeenCalledTimes(1);
  });

  it("reloads a clean draft saved by another window without creating unevaluated entries", async () => {
    const { store, api, records } = fixture();
    await store.refreshIfClean("not-loaded");
    expect(api.getComposerDraft).not.toHaveBeenCalled();
    await store.load("a");
    records.set("a", {
      sessionId: "a",
      revision: "from-other-window",
      text: "shared text",
      formatted: true,
      attachments: [],
      notificationDraftIds: [],
    });
    await store.refreshIfClean("a", "from-other-window");
    expect(store.state("a").value).toMatchObject({
      revision: "from-other-window",
      text: "shared text",
      formatted: true,
    });
    expect(api.saveComposerDraft).not.toHaveBeenCalled();
  });

  it("rechecks a remote save that arrives while the first local load is still delayed", async () => {
    const { store, api, records } = fixture();
    const blocked = deferred();
    api.getComposerDraft.mockImplementationOnce(async () => {
      await blocked.promise;
      return null;
    });
    const loading = store.load("a");
    records.set("a", {
      sessionId: "a",
      revision: "saved-during-load",
      text: "later remote value",
      formatted: false,
      attachments: [],
      notificationDraftIds: [],
    });
    const refreshing = store.refreshIfClean("a");
    blocked.resolve();
    await Promise.all([loading, refreshing]);
    expect(store.state("a").value).toMatchObject({
      revision: "saved-during-load",
      text: "later remote value",
    });
    expect(api.getComposerDraft).toHaveBeenCalledTimes(2);
    expect(api.saveComposerDraft).not.toHaveBeenCalled();
  });

  it("does not let a delayed remote snapshot overwrite local edits or accepted clears", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    const blocked = deferred();
    api.getComposerDraft.mockImplementationOnce(async () => {
      await blocked.promise;
      return {
        sessionId: "a",
        revision: "remote-stale",
        text: "remote stale",
        formatted: false,
        attachments: [],
        notificationDraftIds: [],
      };
    });
    const refreshing = store.refreshIfClean("a");
    store.update("a", (value) => ({ ...value, text: "local newer" }));
    blocked.resolve();
    await refreshing;
    expect(store.state("a").value.text).toBe("local newer");
    await store.flush("a");
    const submittedRevision = store.state("a").value.revision;
    records.delete("a");
    await store.accepted("a", submittedRevision);
    expect(store.state("a").value.text).toBe("");
    expect(records.has("a")).toBe(false);
  });

  it("only applies the newest remote refresh when save and clear notifications overlap", async () => {
    const { store, api, records } = fixture();
    await store.load("a");
    const first = deferred();
    const second = deferred();
    api.getComposerDraft
      .mockImplementationOnce(async () => {
        await first.promise;
        return {
          sessionId: "a",
          revision: "saved-first",
          text: "older saved value",
          formatted: false,
          attachments: [],
          notificationDraftIds: [],
        };
      })
      .mockImplementationOnce(async () => {
        await second.promise;
        return null;
      });
    const older = store.refreshIfClean("a");
    const newer = store.refreshIfClean("a", null);
    second.resolve();
    await newer;
    first.resolve();
    await older;
    expect(store.state("a").value.text).toBe("");
    expect(records.has("a")).toBe(false);
  });

  it("keeps a stale local draft and attachments until the user explicitly overwrites", async () => {
    const { api, records } = fixture();
    records.set("a", {
      sessionId: "a",
      revision: "shared-base",
      text: "shared",
      formatted: false,
      attachments: [],
      notificationDraftIds: [],
    });
    const blockedRead = deferred();
    const slowerStore = new ComposerDraftStore(api, async () => {
      await blockedRead.promise;
      return "data:text/plain;base64,aGVsbG8=";
    });
    const newerStore = new ComposerDraftStore(api, async () => "data:text/plain;base64,aGVsbG8=");
    await Promise.all([slowerStore.load("a"), newerStore.load("a")]);
    slowerStore.update("a", (value) => ({
      ...value,
      text: "local attachment",
      attachments: [{ id: "file", file: new File(["hello"], "notes.txt"), kind: "file" }],
    }));
    newerStore.update("a", (value) => ({
      ...value,
      text: "newer from another window",
      attachments: [{ id: "remote-file", file: new File(["hello"], "remote.txt"), kind: "file" }],
    }));
    await newerStore.flush("a");
    expect(records.get("a")?.text).toBe("newer from another window");
    expect(records.get("a")?.attachments).toEqual([expect.objectContaining({ id: "remote-file" })]);
    blockedRead.resolve();
    await expect(slowerStore.flush("a")).rejects.toThrow(COMPOSER_DRAFT_CONFLICT_CODE);
    expect(slowerStore.state("a")).toMatchObject({
      conflict: true,
      error: expect.stringContaining(COMPOSER_DRAFT_CONFLICT_CODE),
    });
    expect(slowerStore.state("a").value.text).toBe("local attachment");
    expect(slowerStore.state("a").value.attachments).toHaveLength(1);
    expect(records.get("a")?.text).toBe("newer from another window");
    expect(records.get("a")?.attachments).toEqual([expect.objectContaining({ id: "remote-file" })]);
    await expect(slowerStore.flush("a")).rejects.toThrow(COMPOSER_DRAFT_CONFLICT_CODE);
    expect(api.saveComposerDraft).toHaveBeenCalledTimes(2);

    await slowerStore.resolveConflict("a", "overwrite");

    expect(records.get("a")).toMatchObject({
      text: "local attachment",
      attachments: [expect.objectContaining({ id: "file" })],
    });
    expect(slowerStore.state("a")).toMatchObject({
      conflict: false,
      error: null,
      saving: false,
    });
    expect(slowerStore.hasPending()).toBe(false);
  });

  it("can discard a conflicted local draft only when explicitly reloading the latest version", async () => {
    const { store, api, records } = fixture();
    records.set("a", {
      sessionId: "a",
      revision: "shared-base",
      text: "shared",
      formatted: false,
      attachments: [],
      notificationDraftIds: [],
    });
    await store.load("a");
    api.saveComposerDraft.mockImplementationOnce(async () => {
      throw new Error(COMPOSER_DRAFT_CONFLICT_MESSAGE);
    });
    store.update("a", (value) => ({ ...value, text: "local" }));
    await expect(store.flush("a")).rejects.toThrow(COMPOSER_DRAFT_CONFLICT_CODE);
    records.set("a", {
      sessionId: "a",
      revision: "latest",
      text: "latest from another window",
      formatted: true,
      attachments: [],
      notificationDraftIds: ["notification"],
    });
    await store.resolveConflict("a", "reload");
    expect(store.state("a")).toMatchObject({
      conflict: false,
      error: null,
      value: {
        revision: "latest",
        text: "latest from another window",
        formatted: true,
        notificationDraftIds: ["notification"],
      },
    });
  });

  it("stops after one explicit overwrite attempt if the server changes again", async () => {
    const { store, api, records } = fixture();
    records.set("a", {
      sessionId: "a",
      revision: "shared-base",
      text: "shared",
      formatted: false,
      attachments: [],
      notificationDraftIds: [],
    });
    await store.load("a");
    api.saveComposerDraft.mockImplementationOnce(async () => {
      throw new Error(COMPOSER_DRAFT_CONFLICT_MESSAGE);
    });
    store.update("a", (value) => ({ ...value, text: "local" }));
    await expect(store.flush("a")).rejects.toThrow(COMPOSER_DRAFT_CONFLICT_CODE);
    records.set("a", {
      sessionId: "a",
      revision: "latest-before-resolve",
      text: "latest before resolve",
      formatted: false,
      attachments: [],
      notificationDraftIds: [],
    });
    const latestBeforeResolve: ComposerDraft = {
      sessionId: "a",
      revision: "latest-before-resolve",
      text: "latest before resolve",
      formatted: false,
      attachments: [],
      notificationDraftIds: [],
    };
    api.getComposerDraft.mockImplementationOnce(async () => latestBeforeResolve);
    records.set("a", {
      sessionId: "a",
      revision: "changed-during-resolve",
      text: "changed during resolve",
      formatted: false,
      attachments: [],
      notificationDraftIds: [],
    });

    await expect(store.resolveConflict("a", "overwrite")).rejects.toThrow(
      COMPOSER_DRAFT_CONFLICT_CODE,
    );

    expect(api.saveComposerDraft).toHaveBeenCalledTimes(2);
    expect(store.state("a")).toMatchObject({
      conflict: true,
      error: expect.stringContaining(COMPOSER_DRAFT_CONFLICT_CODE),
    });
    expect(store.state("a").value.text).toBe("local");
  });
});
