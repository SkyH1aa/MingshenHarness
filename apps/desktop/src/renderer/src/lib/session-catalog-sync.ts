import type { SessionView } from "../../../shared/domain";
import type {
  SessionCatalogDelta,
  SessionPage,
  SessionPageInput,
} from "../../../shared/session-catalog";
import type { SessionBatchAction, SessionBatchResult } from "./session-management";

const catalogChangedMessage = "会话目录发生变化，请刷新后重试。";
class ChatCatalogRevisionChanged extends Error {}

export async function loadChatSessionSnapshot(
  listPage: (input: SessionPageInput) => Promise<SessionPage>,
  archived: boolean,
): Promise<SessionView[]> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const rows: SessionView[] = [];
      const ids = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | null = null;
      let revision: number | null = null;
      let total: number | null = null;
      do {
        const page = await listPage({ agentMode: "chat", archived, limit: 100, cursor });
        if (revision !== null && revision !== page.revision)
          throw new ChatCatalogRevisionChanged(catalogChangedMessage);
        if (
          !Number.isSafeInteger(page.revision) ||
          page.revision < 0 ||
          !Number.isSafeInteger(page.total) ||
          page.total < 0 ||
          (total !== null && total !== page.total)
        )
          throw new Error(catalogChangedMessage);
        revision = page.revision;
        total = page.total;
        for (const session of page.sessions) {
          if (
            session.agentMode !== "chat" ||
            session.parentSessionId !== null ||
            session.archived !== archived ||
            ids.has(session.id)
          )
            throw new Error(catalogChangedMessage);
          ids.add(session.id);
          rows.push(session);
        }
        cursor = page.nextCursor;
        if (rows.length > total || (cursor && (!page.sessions.length || cursors.has(cursor))))
          throw new Error(catalogChangedMessage);
        if (cursor) cursors.add(cursor);
        else if (rows.length !== total) throw new Error(catalogChangedMessage);
      } while (cursor);
      return rows;
    } catch (cause) {
      if (!(cause instanceof ChatCatalogRevisionChanged) || attempt === 2) throw cause;
    }
  }
  throw new Error(catalogChangedMessage);
}

interface SessionCatalogSnapshot {
  sessionCatalog?: {
    revision: number;
  };
}

export interface SessionCatalogRefresh<T extends SessionCatalogSnapshot> {
  data: T;
  delta: SessionCatalogDelta | null;
  appliedRevision: number | null;
}

export async function loadSessionCatalogRefresh<T extends SessionCatalogSnapshot>(input: {
  priorRevision: number;
  loadedIds: readonly string[];
  bootstrap: () => Promise<T>;
  getDelta: (after: number, ids: readonly string[]) => Promise<SessionCatalogDelta>;
}): Promise<SessionCatalogRefresh<T>> {
  const data = await input.bootstrap();
  if (!data.sessionCatalog) return { data, delta: null, appliedRevision: null };
  if (input.loadedIds.length === 0 || input.priorRevision < 0)
    return { data, delta: null, appliedRevision: data.sessionCatalog.revision };

  const delta = await input.getDelta(input.priorRevision, input.loadedIds);
  return {
    data,
    delta,
    appliedRevision: delta.reset ? data.sessionCatalog.revision : delta.revision,
  };
}

export function replaceWorkspaceCatalogPreservingChat(
  current: readonly SessionView[],
  workspaceSessions: readonly SessionView[],
): SessionView[] {
  const next = new Map(workspaceSessions.map((session) => [session.id, session]));
  for (const session of current)
    if (session.agentMode === "chat" && !next.has(session.id)) next.set(session.id, session);
  return [...next.values()];
}

export function replaceActiveChatSessions(
  current: readonly SessionView[],
  activeChatSessions: readonly SessionView[],
): SessionView[] {
  const active = new Map(activeChatSessions.map((session) => [session.id, session]));
  const archived = current.filter(
    (session) => session.agentMode === "chat" && session.archived && !active.has(session.id),
  );
  return [
    ...current.filter((session) => session.agentMode !== "chat"),
    ...archived,
    ...active.values(),
  ];
}

export function applyChatBatchResult(
  current: readonly SessionView[],
  action: SessionBatchAction,
  result: SessionBatchResult,
): SessionView[] {
  const removed = new Set(result.removedIds);
  const succeeded = new Set(result.succeeded);
  return current
    .filter((session) => !removed.has(session.id))
    .map((session) =>
      session.agentMode === "chat" && succeeded.has(session.id) && action !== "delete"
        ? { ...session, archived: action === "archive" }
        : session,
    );
}
