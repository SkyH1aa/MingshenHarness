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
      if (records.get(id)?.revision !== revision) return false;
      records.delete(id);
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
    const { store } = fixture();
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
    await store.accepted("a", store.state("a").value.revision);
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

  it("reuploads attachment bytes for newer text after a delayed accepted-send reply", async () => {
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
    expect(store.state("a").error).toBeNull();
    expect(records.get("a")?.text).toBe("newer text with the same attachment");
    expect(records.get("a")?.attachments[0]?.dataUrl).toBe("data:text/plain;base64,aGVsbG8=");
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
