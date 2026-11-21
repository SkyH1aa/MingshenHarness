import { describe, expect, it } from "vitest";
import type { SessionView } from "../../../shared/domain";
import type { SessionCatalogDelta } from "../../../shared/session-catalog";
import {
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
  }) as SessionView;

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
});
