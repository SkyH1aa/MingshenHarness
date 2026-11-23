import { describe, expect, it, vi } from "vitest";
import { ComposerDraftStore } from "./composer-drafts";
import { QuickChatTransitionWork, quickChatTransitionReady } from "./quick-chat-transition-work";

describe("quick chat transition work", () => {
  it("waits for every already-started operation, including concurrent recoveries", async () => {
    const work = new QuickChatTransitionWork();
    const finishSend = work.begin();
    const finishRecovery = work.begin();
    const signal = new AbortController().signal;
    let ready = false;
    const waiting = work.waitForIdle(signal).then(() => {
      ready = true;
    });
    finishSend();
    finishSend();
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(work.idle).toBe(false);
    finishRecovery();
    await waiting;
    expect(ready).toBe(true);
    expect(work.idle).toBe(true);
  });

  it("cancels an obsolete waiter without affecting a later transition", async () => {
    const work = new QuickChatTransitionWork();
    const finish = work.begin();
    const old = new AbortController();
    const oldWait = work.waitForIdle(old.signal);
    old.abort();
    await expect(oldWait).rejects.toThrow("Transition cancelled.");

    const current = new AbortController();
    const currentWait = work.waitForIdle(current.signal);
    finish();
    await expect(currentWait).resolves.toBeUndefined();
    await expect(work.waitForIdle(old.signal)).rejects.toThrow("Transition cancelled.");
  });

  it("rechecks idleness when more work starts before a waiting continuation runs", async () => {
    const work = new QuickChatTransitionWork();
    const finishFirst = work.begin();
    const signal = new AbortController().signal;
    let acknowledged = false;
    const waiting = (async () => {
      do {
        await work.waitForIdle(signal);
      } while (!work.idle);
      acknowledged = true;
    })();

    finishFirst();
    const finishSecond = work.begin();
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    finishSecond();
    await waiting;
    expect(acknowledged).toBe(true);
  });

  it("does not acknowledge while a send is saving or reconciling its accepted draft", async () => {
    let finishSave!: () => void;
    const saveBlocked = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    let startAcceptedRead!: () => void;
    const acceptedReadStarted = new Promise<void>((resolve) => {
      startAcceptedRead = resolve;
    });
    let finishAcceptedRead!: () => void;
    const acceptedReadBlocked = new Promise<null>((resolve) => {
      finishAcceptedRead = () => resolve(null);
    });
    const drafts = new ComposerDraftStore({
      getComposerDraft: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockImplementation(() => {
          startAcceptedRead();
          return acceptedReadBlocked;
        }),
      saveComposerDraft: async () => saveBlocked,
      clearComposerDraft: async () => true,
    });
    await drafts.load("old-session");
    drafts.update("old-session", (draft) => ({ ...draft, text: "Draft before switching" }));
    const revision = drafts.state("old-session").value.revision;

    const work = new QuickChatTransitionWork();
    const finish = work.begin();
    const sending = (async () => {
      try {
        await drafts.flush("old-session");
        await drafts.accepted("old-session", revision);
      } finally {
        finish();
      }
    })();
    let acknowledged = false;
    const waiting = work.waitForIdle(new AbortController().signal).then(() => {
      acknowledged = true;
    });
    await Promise.resolve();
    expect(acknowledged).toBe(false);

    finishSave();
    await acceptedReadStarted;
    expect(acknowledged).toBe(false);
    finishAcceptedRead();
    await sending;
    await waiting;
    expect(acknowledged).toBe(true);
    expect(drafts.hasPending()).toBe(false);
  });

  it("rejects a transition when a history edit remains unsaved after in-flight work", async () => {
    const work = new QuickChatTransitionWork();
    const finish = work.begin();
    let unsaved = false;
    const ready = quickChatTransitionReady(work, new AbortController().signal, () => unsaved);
    unsaved = true;
    finish();
    await expect(ready).resolves.toBe(false);
    unsaved = false;
    await expect(
      quickChatTransitionReady(work, new AbortController().signal, () => unsaved),
    ).resolves.toBe(true);
  });
});
