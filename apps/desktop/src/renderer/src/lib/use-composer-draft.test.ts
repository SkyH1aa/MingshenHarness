import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerDraft } from "../../../shared/composer-draft";
import type { ComposerDraftFlushPurpose, MingshenDesktopApi } from "../../../shared/ipc";
import {
  composerDrafts,
  registerComposerDraftLifecycle,
  requestInterfaceReload,
} from "./use-composer-draft";

const cleanups: (() => void)[] = [];

function deferred() {
  let resolve = () => {};
  let reject = (_cause: unknown) => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const surface = new EventTarget();
  let flushListener: Parameters<MingshenDesktopApi["onComposerDraftFlush"]>[0] = () => {};
  let changeListener: Parameters<MingshenDesktopApi["onComposerDraftChanged"]>[0] = () => {};
  let draft: ComposerDraft | null = null;
  const unsubscribeChanges = vi.fn();
  const api = {
    reloadInterface: vi.fn(async () => {}),
    getComposerDraft: vi.fn(async () => draft),
    onComposerDraftFlush: vi.fn(
      (listener: Parameters<MingshenDesktopApi["onComposerDraftFlush"]>[0]) => {
        flushListener = listener;
        return vi.fn();
      },
    ),
    onComposerDraftChanged: vi.fn(
      (listener: Parameters<MingshenDesktopApi["onComposerDraftChanged"]>[0]) => {
        changeListener = listener;
        return unsubscribeChanges;
      },
    ),
    acknowledgeComposerDraftFlush: vi.fn(),
  };
  const reload = vi.fn();
  const state = { dirty: false };
  vi.stubGlobal("window", {
    mingshen: api,
    location: { reload },
    addEventListener: surface.addEventListener.bind(surface),
    removeEventListener: surface.removeEventListener.bind(surface),
  });
  vi.stubGlobal("document", {
    querySelector: vi.fn(() => (state.dirty ? {} : null)),
  });
  const flushAll = vi.spyOn(composerDrafts, "flushAll").mockResolvedValue();
  const hasPending = vi.spyOn(composerDrafts, "hasPending").mockReturnValue(false);
  const lifecycleCleanup = registerComposerDraftLifecycle();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    lifecycleCleanup();
  };
  cleanups.push(dispose);
  return {
    api,
    reload,
    state,
    flushAll,
    hasPending,
    unsubscribeChanges,
    flush: (purpose: ComposerDraftFlushPurpose) => flushListener("request-id", purpose),
    changeDraft: (sessionId: string, revision: string | null) =>
      changeListener({ sessionId, revision }),
    setDraft: (next: ComposerDraft | null) => {
      draft = next;
    },
    dispose,
    unload: () => {
      const event = new Event("beforeunload", { cancelable: true });
      surface.dispatchEvent(event);
      return event;
    },
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("composer lifecycle during interface reload", () => {
  it("refreshes a loaded clean draft from change notifications and unsubscribes on cleanup", async () => {
    const f = fixture();
    const sessionId = "draft-change-session";
    await composerDrafts.load(sessionId);
    const remote: ComposerDraft = {
      sessionId,
      revision: "remote-revision",
      text: "updated by another window",
      formatted: true,
      attachments: [],
      notificationDraftIds: [],
    };
    f.setDraft(remote);
    f.changeDraft(sessionId, remote.revision);
    await vi.waitFor(() =>
      expect(composerDrafts.state(sessionId).value).toMatchObject({
        revision: remote.revision,
        text: remote.text,
        formatted: true,
      }),
    );
    expect(f.api.getComposerDraft).toHaveBeenCalledTimes(2);
    f.dispose();
    expect(f.unsubscribeChanges).toHaveBeenCalledOnce();
    composerDrafts.forget([sessionId]);
  });

  it("blocks non-composer edits made while the main process waits for draft persistence", async () => {
    const f = fixture();
    const saving = deferred();
    f.flushAll.mockReturnValue(saving.promise);
    const blocked = vi.fn();
    await requestInterfaceReload(blocked);
    f.flush("interface-reload");
    expect(f.api.acknowledgeComposerDraftFlush).not.toHaveBeenCalled();
    f.state.dirty = true;
    saving.resolve();
    await vi.waitFor(() =>
      expect(f.api.acknowledgeComposerDraftFlush).toHaveBeenCalledWith("request-id"),
    );
    expect(f.unload().defaultPrevented).toBe(true);
    expect(blocked).toHaveBeenCalledOnce();
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.unload().defaultPrevented).toBe(false);
  });

  it("also blocks a non-composer edit arriving after the successful flush acknowledgement", async () => {
    const f = fixture();
    const blocked = vi.fn();
    await requestInterfaceReload(blocked);
    f.flush("interface-reload");
    await vi.waitFor(() =>
      expect(f.api.acknowledgeComposerDraftFlush).toHaveBeenCalledWith("request-id"),
    );
    f.state.dirty = true;
    expect(f.unload().defaultPrevented).toBe(true);
    expect(blocked).toHaveBeenCalledOnce();
  });

  it("retains the reload guard while late composer input is saved before another unload", async () => {
    const f = fixture();
    const saving = deferred();
    f.flushAll.mockReturnValue(saving.promise);
    f.hasPending.mockReturnValue(true);
    const blocked = vi.fn();
    await requestInterfaceReload(blocked);
    expect(f.unload().defaultPrevented).toBe(true);
    expect(f.reload).not.toHaveBeenCalled();
    f.state.dirty = true;
    f.hasPending.mockReturnValue(false);
    const retriedUnload = vi.fn(() => f.unload().defaultPrevented);
    f.api.reloadInterface.mockImplementationOnce(async () => {
      retriedUnload();
    });
    saving.resolve();
    await vi.waitFor(() => expect(f.api.reloadInterface).toHaveBeenCalledTimes(2));
    expect(retriedUnload).toHaveReturnedWith(true);
    expect(f.reload).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalledOnce();
  });

  it("clears a completed intent so a later ordinary unload keeps its existing behavior", async () => {
    const f = fixture();
    const blocked = vi.fn();
    await requestInterfaceReload(blocked);
    expect(f.unload().defaultPrevented).toBe(false);
    f.state.dirty = true;
    expect(f.unload().defaultPrevented).toBe(false);
    expect(blocked).not.toHaveBeenCalled();
  });

  it("clears the intent when the reload IPC or main-process guard rejects and allows retry", async () => {
    const f = fixture();
    f.api.reloadInterface.mockRejectedValueOnce(new Error("active task"));
    const blocked = vi.fn();
    await expect(requestInterfaceReload(blocked)).rejects.toThrow("active task");
    f.state.dirty = true;
    expect(f.unload().defaultPrevented).toBe(false);
    expect(blocked).toHaveBeenCalledWith(new Error("active task"));
    await requestInterfaceReload(blocked);
    expect(f.unload().defaultPrevented).toBe(true);
    expect(blocked).toHaveBeenCalledTimes(2);
  });

  it("does not start a second navigation while a request from another picker is pending", async () => {
    const f = fixture();
    const firstReply = deferred();
    f.api.reloadInterface.mockReturnValueOnce(firstReply.promise);
    const firstBlocked = vi.fn();
    const first = requestInterfaceReload(firstBlocked);
    const latestBlocked = vi.fn();
    await requestInterfaceReload(latestBlocked);
    expect(f.api.reloadInterface).toHaveBeenCalledOnce();
    firstReply.resolve();
    await first;
    f.state.dirty = true;
    expect(f.unload().defaultPrevented).toBe(true);
    expect(firstBlocked).not.toHaveBeenCalled();
    expect(latestBlocked).toHaveBeenCalledOnce();
  });

  it("reports a failed in-flight request to a picker reopened while it was waiting", async () => {
    const f = fixture();
    const reply = deferred();
    f.api.reloadInterface.mockReturnValueOnce(reply.promise);
    const previous = vi.fn();
    const request = requestInterfaceReload(previous);
    const rejected = expect(request).rejects.toThrow("storage full");
    const latest = vi.fn();
    await requestInterfaceReload(latest);
    reply.reject(new Error("storage full"));
    await rejected;
    expect(previous).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(new Error("storage full"));
    expect(f.api.reloadInterface).toHaveBeenCalledOnce();
  });

  it("clears the interface intent for normal exit, including an update's committed shutdown", async () => {
    const f = fixture();
    const blocked = vi.fn();
    await requestInterfaceReload(blocked);
    f.flush("shutdown");
    f.state.dirty = true;
    expect(f.unload().defaultPrevented).toBe(false);
    expect(blocked).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(f.api.acknowledgeComposerDraftFlush).toHaveBeenCalledWith("request-id"),
    );
  });

  it("keeps the guard during an update preflight that has not committed to shutdown", async () => {
    const f = fixture();
    const blocked = vi.fn();
    await requestInterfaceReload(blocked);
    f.flush("save");
    await vi.waitFor(() =>
      expect(f.api.acknowledgeComposerDraftFlush).toHaveBeenCalledWith("request-id"),
    );
    f.state.dirty = true;
    expect(f.unload().defaultPrevented).toBe(true);
    expect(blocked).toHaveBeenCalledOnce();
  });

  it("retains failed-save acknowledgement details for the pending reload IPC", async () => {
    const f = fixture();
    f.flushAll.mockRejectedValueOnce(new Error("storage full"));
    f.flush("interface-reload");
    await vi.waitFor(() =>
      expect(f.api.acknowledgeComposerDraftFlush).toHaveBeenCalledWith(
        "request-id",
        "storage full",
      ),
    );
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("clears the intent after a late composer save fails and allows a fresh attempt", async () => {
    const f = fixture();
    f.hasPending.mockReturnValue(true);
    f.flushAll.mockRejectedValueOnce(new Error("storage full"));
    const blocked = vi.fn();
    await requestInterfaceReload(blocked);
    expect(f.unload().defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledWith(new Error("storage full")));
    f.hasPending.mockReturnValue(false);
    f.state.dirty = true;
    expect(f.unload().defaultPrevented).toBe(false);
    expect(f.reload).not.toHaveBeenCalled();
    await requestInterfaceReload(blocked);
    expect(f.unload().defaultPrevented).toBe(true);
    expect(blocked).toHaveBeenCalledTimes(2);
  });

  it("does not run an older late-input reload after its IPC fails", async () => {
    const f = fixture();
    const saving = deferred();
    const reply = deferred();
    f.api.reloadInterface.mockReturnValueOnce(reply.promise);
    f.flushAll.mockReturnValue(saving.promise);
    f.hasPending.mockReturnValue(true);
    const request = requestInterfaceReload(vi.fn());
    const rejected = expect(request).rejects.toThrow("reload refused");
    expect(f.unload().defaultPrevented).toBe(true);
    reply.reject(new Error("reload refused"));
    await rejected;
    saving.resolve();
    await Promise.resolve();
    expect(f.api.reloadInterface).toHaveBeenCalledOnce();
    expect(f.reload).not.toHaveBeenCalled();
  });

  it("respects a main-process rejection when retrying after late composer persistence", async () => {
    const f = fixture();
    const saving = deferred();
    f.flushAll.mockReturnValue(saving.promise);
    f.hasPending.mockReturnValue(true);
    const failure = vi.fn();
    await requestInterfaceReload(failure);
    expect(f.unload().defaultPrevented).toBe(true);
    f.api.reloadInterface.mockRejectedValueOnce(new Error("task started during save"));
    saving.resolve();
    await vi.waitFor(() =>
      expect(failure).toHaveBeenCalledWith(new Error("task started during save")),
    );
    expect(f.api.reloadInterface).toHaveBeenCalledTimes(2);
    expect(f.reload).not.toHaveBeenCalled();
    f.hasPending.mockReturnValue(false);
    f.state.dirty = true;
    expect(f.unload().defaultPrevented).toBe(false);
  });

  it("does not run an older late-input reload after shutdown begins", async () => {
    const f = fixture();
    const saving = deferred();
    f.flushAll.mockReturnValue(saving.promise);
    f.hasPending.mockReturnValue(true);
    await requestInterfaceReload(vi.fn());
    expect(f.unload().defaultPrevented).toBe(true);
    f.flush("shutdown");
    saving.resolve();
    await vi.waitFor(() =>
      expect(f.api.acknowledgeComposerDraftFlush).toHaveBeenCalledWith("request-id"),
    );
    expect(f.api.reloadInterface).toHaveBeenCalledOnce();
    expect(f.reload).not.toHaveBeenCalled();
  });
});
