import { describe, expect, it, vi } from "vitest";
import type { ComposerDraft, SaveComposerDraftInput } from "../../../shared/composer-draft";
import { ComposerDraftStore } from "./composer-drafts";

function fixture() {
  const records = new Map<string, ComposerDraft>();
  const api = {
    getComposerDraft: vi.fn(async (id: string) => records.get(id) ?? null),
    saveComposerDraft: vi.fn(async (input: SaveComposerDraftInput) => {
      const existing = records.get(input.sessionId);
      const attachments = [...(existing?.attachments ?? []), ...(input.addedAttachments ?? [])];
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
    await expect(store.flush("a")).rejects.toThrow("Missing attachment");
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
});
