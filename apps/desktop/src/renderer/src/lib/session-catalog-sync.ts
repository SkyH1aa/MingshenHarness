import type { SessionView } from "../../../shared/domain";
import type { SessionCatalogDelta } from "../../../shared/session-catalog";

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
