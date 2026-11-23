import { describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../../shared/domain";
import type { SessionCatalogDelta, SessionPageInput } from "../../../shared/session-catalog";
import {
  applyChatBatchResult,
  loadChatSessionSnapshot,
  loadSessionCatalogRefresh,
  replaceActiveChatSessions,
  replaceWorkspaceCatalogPreservingChat,
} from "./session-catalog-sync";

const session = (id: string, agentMode: SessionView["agentMode"], archived = false): SessionView =>
  ({
    id,
    title: id,
    agentMode,
    archived,
    parentSessionId: null,
  }) as SessionView;

describe("ChatAgent catalog snapshots", () => {
  it.each([false, true])("loads every matching page for archived=%s", async (archived) => {
    const rows = Array.from({ length: 101 }, (_, index) =>
      session(`chat-${index}`, "chat", archived),
    );
    const listPage = vi.fn(async (input: SessionPageInput) => ({
      sessions: input.cursor ? rows.slice(100) : rows.slice(0, 100),
      nextCursor: input.cursor ? null : "anchor",
      total: rows.length,
      revision: 7,
    }));
    expect(await loadChatSessionSnapshot(listPage, archived)).toEqual(rows);
    expect(listPage.mock.calls.map(([input]) => input)).toEqual([
      { agentMode: "chat", archived, limit: 100, cursor: null },
      { agentMode: "chat", archived, limit: 100, cursor: "anchor" },
    ]);
  });

  it("restarts the entire snapshot when a later conversation moves before the cursor", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => session(`chat-${index}`, "chat"));
    const moved = rows[100] as SessionView;
    const last = rows[99] as SessionView;
    const listPage = vi
      .fn()
      .mockResolvedValueOnce({
        sessions: rows.slice(0, 100),
        nextCursor: "old",
        total: 101,
        revision: 7,
      })
      .mockResolvedValueOnce({ sessions: [], nextCursor: null, total: 101, revision: 8 })
      .mockResolvedValueOnce({
        sessions: [moved, ...rows.slice(0, 99)],
        nextCursor: "new",
        total: 101,
        revision: 8,
      })
      .mockResolvedValueOnce({ sessions: [last], nextCursor: null, total: 101, revision: 8 });

    const result = await loadChatSessionSnapshot(listPage, false);
    expect(result).toHaveLength(101);
    expect(result[0]).toBe(moved);
    expect(new Set(result.map((value) => value.id))).toEqual(
      new Set(rows.map((value) => value.id)),
    );
    expect(listPage.mock.calls.map(([input]) => input.cursor)).toEqual([null, "old", null, "new"]);
  });

  it("fails after three unstable attempts without publishing partial results", async () => {
    const listPage = vi.fn(async (input: SessionPageInput) => ({
      sessions: input.cursor ? [] : [session("first", "chat")],
      nextCursor: input.cursor ? null : "next",
      total: 2,
      revision: input.cursor ? 8 : 7,
    }));
    await expect(loadChatSessionSnapshot(listPage, false)).rejects.toThrow("会话目录发生变化");
    expect(listPage).toHaveBeenCalledTimes(6);
  });

  it.each([
    {
      name: "a repeated cursor",
      pages: [
        { sessions: [session("a", "chat")], nextCursor: "same", total: 3, revision: 1 },
        { sessions: [session("b", "chat")], nextCursor: "same", total: 3, revision: 1 },
      ],
    },
    {
      name: "duplicate records",
      pages: [
        { sessions: [session("a", "chat")], nextCursor: "next", total: 2, revision: 1 },
        { sessions: [session("a", "chat")], nextCursor: null, total: 2, revision: 1 },
      ],
    },
    {
      name: "a changing total at one revision",
      pages: [
        { sessions: [session("a", "chat")], nextCursor: "next", total: 2, revision: 1 },
        { sessions: [session("b", "chat")], nextCursor: null, total: 3, revision: 1 },
      ],
    },
    {
      name: "an incomplete terminal page",
      pages: [{ sessions: [], nextCursor: null, total: 1, revision: 1 }],
    },
    {
      name: "a session from another scope",
      pages: [{ sessions: [session("a", "work")], nextCursor: null, total: 1, revision: 1 }],
    },
    {
      name: "a non-root session",
      pages: [
        {
          sessions: [{ ...session("a", "chat"), parentSessionId: "parent" }],
          nextCursor: null,
          total: 1,
          revision: 1,
        },
      ],
    },
  ])("rejects $name", async ({ pages }) => {
    const listPage = vi.fn();
    for (const page of pages) listPage.mockResolvedValueOnce(page);
    await expect(loadChatSessionSnapshot(listPage, false)).rejects.toThrow("会话目录发生变化");
    expect(listPage).toHaveBeenCalledTimes(pages.length);
  });
});

describe("session catalog reset reconciliation", () => {
  it("keeps the cursor at the applied bootstrap snapshot when a root arrives before delta", async () => {
    const oldRoot = session("old-root", "code");
    const newRoot = session("new-root", "code");
    let snapshotRevision = 10;
    let snapshotSessions = [oldRoot];
    let releaseBootstrap = () => {};
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    let deltaCalls = 0;
    const getDelta = async (after: number): Promise<SessionCatalogDelta> => {
      deltaCalls += 1;
      snapshotRevision = 11;
      snapshotSessions = [newRoot, oldRoot];
      return {
        revision: snapshotRevision,
        reset: after < snapshotRevision,
        sessions: [],
        removed: [],
      };
    };
    const bootstrap = async () => {
      await bootstrapGate;
      return {
        sessionCatalog: { revision: snapshotRevision },
        sessions: snapshotSessions,
      };
    };

    const first = loadSessionCatalogRefresh({
      priorRevision: 10,
      loadedIds: [oldRoot.id],
      bootstrap,
      getDelta,
    });
    await Promise.resolve();
    expect(deltaCalls).toBe(0);
    releaseBootstrap();
    const firstResult = await first;

    expect(deltaCalls).toBe(1);
    expect(firstResult.delta).toMatchObject({ revision: 11, reset: true });
    expect(firstResult.appliedRevision).toBe(10);
    expect(firstResult.data.sessions.map((item) => item.id)).toEqual(["old-root"]);

    const next = await loadSessionCatalogRefresh({
      priorRevision: firstResult.appliedRevision ?? -1,
      loadedIds: firstResult.data.sessions.map((item) => item.id),
      bootstrap,
      getDelta,
    });
    expect(next.data.sessions.map((item) => item.id)).toEqual(["new-root", "old-root"]);
    expect(next.delta).toMatchObject({ revision: 11, reset: true });
    expect(next.appliedRevision).toBe(11);
  });

  it("uses the delta revision when its changes were applied after the bootstrap snapshot", async () => {
    const current = session("current", "code");
    const renamed = { ...current, title: "renamed" };
    const result = await loadSessionCatalogRefresh({
      priorRevision: 4,
      loadedIds: [current.id],
      bootstrap: async () => ({
        sessionCatalog: { revision: 4 },
        sessions: [current],
      }),
      getDelta: async () => ({
        revision: 5,
        reset: false,
        sessions: [renamed],
        removed: [],
      }),
    });

    expect(result.appliedRevision).toBe(5);
  });

  it("replaces the workspace page without dropping independently loaded ChatAgent sessions", () => {
    const current = [
      session("stale-workspace", "code"),
      session("active-chat", "chat"),
      session("archived-chat", "chat", true),
    ];
    const page = [session("fresh-workspace", "work")];

    expect(replaceWorkspaceCatalogPreservingChat(current, page).map((item) => item.id)).toEqual([
      "fresh-workspace",
      "active-chat",
      "archived-chat",
    ]);
  });

  it("replaces the active ChatAgent set while preserving archived rows used by settings", () => {
    const current = [
      session("workspace", "code"),
      session("deleted-chat", "chat"),
      session("archived-chat", "chat", true),
    ];
    const active = [session("current-chat", "chat")];

    expect(replaceActiveChatSessions(current, active).map((item) => item.id)).toEqual([
      "workspace",
      "archived-chat",
      "current-chat",
    ]);
  });

  it("applies successful ChatAgent changes and confirmed partial removals without touching failures", () => {
    const current = [
      session("chat-ok", "chat"),
      session("chat-failed", "chat"),
      session("work", "work"),
    ];
    const result = {
      succeeded: ["chat-ok"],
      failures: [{ sessionId: "chat-failed", title: "chat-failed", message: "busy" }],
      removedIds: [],
    };
    expect(applyChatBatchResult(current, "archive", result)).toEqual([
      session("chat-ok", "chat", true),
      session("chat-failed", "chat"),
      session("work", "work"),
    ]);
    expect(
      applyChatBatchResult(current, "delete", { ...result, removedIds: ["chat-ok"] }).map(
        (item) => item.id,
      ),
    ).toEqual(["chat-failed", "work"]);
    expect(
      applyChatBatchResult([session("old", "chat", true)], "restore", {
        succeeded: ["old"],
        failures: [],
        removedIds: [],
      })[0]?.archived,
    ).toBe(false);
  });
});
