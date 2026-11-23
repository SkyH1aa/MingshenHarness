import { describe, expect, it, vi } from "vitest";
import type { SessionUpdateInput, SessionView } from "../../shared/domain";
import { completeSessionUpdate, prepareSessionArchive } from "./session-update-completion";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("session archive preparation", () => {
  it("waits for the target draft in the main window and then the matching quick chat", async () => {
    const mainPending = deferred();
    const quickPending = deferred();
    const flushMainDraft = vi.fn(() => mainPending.promise);
    const flushQuickDraft = vi.fn(() => quickPending.promise);
    const commit = vi.fn();
    const operation = prepareSessionArchive("chat", {
      quickSessionId: () => "chat",
      isBusy: () => false,
      flushMainDraft,
      flushQuickDraft,
    }).then(commit);
    await Promise.resolve();
    expect(flushMainDraft).toHaveBeenCalledOnce();
    expect(flushQuickDraft).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    mainPending.resolve();
    await vi.waitFor(() => expect(flushQuickDraft).toHaveBeenCalledOnce());
    expect(commit).not.toHaveBeenCalled();
    quickPending.resolve();
    await operation;
    expect(commit).toHaveBeenCalledOnce();
  });

  it("does not commit when either window's draft fails or the session becomes busy", async () => {
    const commit = vi.fn();
    const flushQuickDraft = vi.fn(async () => undefined);
    await expect(
      prepareSessionArchive("chat", {
        quickSessionId: () => "chat",
        isBusy: () => false,
        flushMainDraft: async () => {
          throw new Error("main draft conflict");
        },
        flushQuickDraft,
      }).then(commit),
    ).rejects.toThrow("main draft conflict");
    expect(flushQuickDraft).not.toHaveBeenCalled();
    await expect(
      prepareSessionArchive("chat", {
        quickSessionId: () => "chat",
        isBusy: () => false,
        flushMainDraft: async () => undefined,
        flushQuickDraft: async () => {
          throw new Error("draft save failed");
        },
      }).then(commit),
    ).rejects.toThrow("draft save failed");
    let busy = false;
    await expect(
      prepareSessionArchive("chat", {
        quickSessionId: () => "chat",
        isBusy: () => busy,
        flushMainDraft: async () => undefined,
        flushQuickDraft: async () => {
          busy = true;
        },
      }).then(commit),
    ).rejects.toThrow("请先停止会话");
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not flush an unrelated quick chat and rejects an already busy session", async () => {
    const flushQuickDraft = vi.fn(async () => undefined);
    const flushMainDraft = vi.fn(async () => undefined);
    await prepareSessionArchive("other", {
      quickSessionId: () => "chat",
      isBusy: () => false,
      flushMainDraft,
      flushQuickDraft,
    });
    await expect(
      prepareSessionArchive("chat", {
        quickSessionId: () => "chat",
        isBusy: () => true,
        flushMainDraft,
        flushQuickDraft,
      }),
    ).rejects.toThrow("请先停止会话");
    expect(flushMainDraft).toHaveBeenCalledOnce();
    expect(flushQuickDraft).not.toHaveBeenCalled();
  });

  it("rechecks the active quick session and busy status after the main draft settles", async () => {
    let quickSessionId: string | null = null;
    let busy = false;
    const flushQuickDraft = vi.fn(async () => undefined);
    await prepareSessionArchive("chat", {
      quickSessionId: () => quickSessionId,
      isBusy: () => busy,
      flushMainDraft: async () => {
        quickSessionId = "chat";
      },
      flushQuickDraft,
    });
    expect(flushQuickDraft).toHaveBeenCalledOnce();
    flushQuickDraft.mockClear();
    await expect(
      prepareSessionArchive("chat", {
        quickSessionId: () => quickSessionId,
        isBusy: () => busy,
        flushMainDraft: async () => {
          busy = true;
        },
        flushQuickDraft,
      }),
    ).rejects.toThrow("请先停止会话");
    expect(flushQuickDraft).not.toHaveBeenCalled();
  });
});

describe("session update completion", () => {
  it.each([true, false])(
    "returns and broadcasts a persisted pure archive state %s",
    async (archived) => {
      const session = { id: "chat", archived } as SessionView;
      const restoreContext = vi.fn(async () => {
        throw new Error("context unavailable");
      });
      const emitUpdated = vi.fn();
      const result = await completeSessionUpdate(
        { sessionId: "chat", archived },
        { restoreContext, getSession: () => session, emitUpdated },
      );
      expect(result).toBe(session);
      expect(restoreContext).not.toHaveBeenCalled();
      expect(emitUpdated).toHaveBeenCalledWith(session);
    },
  );

  const mixedInputs: SessionUpdateInput[] = [
    { sessionId: "chat", archived: true, title: "new title" },
    { sessionId: "chat", archived: false, systemPrompt: "new prompt" },
    { sessionId: "chat", title: "new title" },
    { sessionId: "chat", archived: true, title: undefined } as unknown as SessionUpdateInput,
  ];
  it.each(mixedInputs)(
    "keeps context errors visible for composite or ordinary updates: %o",
    async (input) => {
      const restoreContext = vi.fn(async () => {
        throw new Error("context unavailable");
      });
      const getSession = vi.fn();
      const emitUpdated = vi.fn();
      await expect(
        completeSessionUpdate(input, { restoreContext, getSession, emitUpdated }),
      ).rejects.toThrow("context unavailable");
      expect(restoreContext).toHaveBeenCalledWith("chat");
      expect(getSession).not.toHaveBeenCalled();
      expect(emitUpdated).not.toHaveBeenCalled();
    },
  );

  it("does not broadcast when persistence throws before completion", async () => {
    const emitUpdated = vi.fn();
    const update = async () => {
      throw new Error("database update failed");
    };
    const operation = async () => {
      await update();
      return completeSessionUpdate(
        { sessionId: "chat", archived: true },
        { restoreContext: async () => null, getSession: () => null, emitUpdated },
      );
    };
    await expect(operation()).rejects.toThrow("database update failed");
    expect(emitUpdated).not.toHaveBeenCalled();
  });
});
