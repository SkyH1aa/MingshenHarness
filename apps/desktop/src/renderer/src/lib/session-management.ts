import type { SessionView } from "../../../shared/domain";
import type { MingshenDesktopApi } from "../../../shared/ipc";

export type SessionManagementApi = Pick<
  MingshenDesktopApi,
  "listSessionPage" | "getSession" | "updateSession" | "removeSession"
>;
export type SessionBatchAction = "archive" | "restore" | "delete";
export interface SessionBatchPlan {
  action: SessionBatchAction;
  roots: SessionView[];
  sessions: SessionView[];
}
export interface SessionBatchFailure {
  sessionId: string;
  title: string;
  message: string;
}
export interface SessionBatchResult {
  succeeded: string[];
  failures: SessionBatchFailure[];
  removedIds: string[];
}
export interface SessionBatchProgress {
  completed: number;
  total: number;
  sessionId: string;
  title: string;
  succeeded: boolean;
}

const changedMessage = "会话的工作文件夹或归档状态已变化，请刷新后重试。";
const catalogChangedMessage = "会话目录发生变化，请刷新后重试。";
class CatalogRevisionChanged extends Error {}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("会话列表加载已取消。", "AbortError");
}

async function loadChildrenSnapshot(
  api: SessionManagementApi,
  parentId: string | null,
  signal?: AbortSignal,
): Promise<SessionView[]> {
  const sessions = new Map<string, SessionView>();
  let revision: number | null = null;
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    let total: number | null = null;
    const cursors = new Set<string>();
    const scopedIds = new Set<string>();
    do {
      checkAborted(signal);
      const page = await api.listSessionPage({ parentId, archived, limit: 200, cursor });
      checkAborted(signal);
      if (total !== null && total !== page.total) throw new Error(catalogChangedMessage);
      total = page.total;
      for (const session of page.sessions) {
        if (session.parentSessionId !== parentId || session.archived !== archived)
          throw new Error(catalogChangedMessage);
        const previous = sessions.get(session.id);
        if (previous && !sameIdentity(previous, session)) throw new Error(catalogChangedMessage);
        sessions.set(session.id, session);
        scopedIds.add(session.id);
      }
      cursor = page.nextCursor;
      if (cursor) {
        if (cursors.has(cursor)) throw new Error(catalogChangedMessage);
        cursors.add(cursor);
      }
      if (revision !== null && revision !== page.revision)
        throw new CatalogRevisionChanged(catalogChangedMessage);
      revision = page.revision;
      if (!cursor && scopedIds.size !== total) throw new Error(catalogChangedMessage);
    } while (cursor);
  }
  return [...sessions.values()];
}

async function loadChildren(
  api: SessionManagementApi,
  parentId: string | null,
  signal?: AbortSignal,
): Promise<SessionView[]> {
  // Opening another conversation updates the global revision without changing this family.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await loadChildrenSnapshot(api, parentId, signal);
    } catch (cause) {
      if (!(cause instanceof CatalogRevisionChanged) || attempt === 2) throw cause;
    }
  }
  throw new Error(catalogChangedMessage);
}

function sameIdentity(expected: SessionView, current: SessionView): boolean {
  return (
    expected.id === current.id &&
    expected.parentSessionId === current.parentSessionId &&
    expected.workspacePath === current.workspacePath &&
    expected.archived === current.archived
  );
}

async function verifyRoot(api: SessionManagementApi, root: SessionView): Promise<SessionView> {
  const current = await api.getSession(root.id);
  if (!current) throw new Error("会话已删除或不存在，请刷新后重试。");
  if (root.parentSessionId !== null || !sameIdentity(root, current))
    throw new Error(changedMessage);
  return current;
}

async function loadFamily(api: SessionManagementApi, root: SessionView): Promise<SessionView[]> {
  const family = new Map<string, SessionView>([[root.id, root]]);
  const pending = [root];
  for (let index = 0; index < pending.length; index += 1) {
    const parent = pending[index];
    if (!parent) continue;
    for (const child of await loadChildren(api, parent.id)) {
      if (family.has(child.id)) throw new Error(catalogChangedMessage);
      family.set(child.id, child);
      pending.push(child);
    }
  }
  return [...family.values()];
}

function plannedFamily(plan: SessionBatchPlan, root: SessionView): SessionView[] {
  const children = new Map<string, SessionView[]>();
  for (const session of plan.sessions) {
    if (session.parentSessionId === null) continue;
    const siblings = children.get(session.parentSessionId) ?? [];
    siblings.push(session);
    children.set(session.parentSessionId, siblings);
  }
  const family = new Map<string, SessionView>([[root.id, root]]);
  const pending = [root];
  for (let index = 0; index < pending.length; index += 1) {
    const parent = pending[index];
    if (!parent) continue;
    for (const child of children.get(parent.id) ?? []) {
      if (family.has(child.id)) continue;
      family.set(child.id, child);
      pending.push(child);
    }
  }
  return [...family.values()];
}

export function loadManagedSessions(
  api: SessionManagementApi,
  signal?: AbortSignal,
): Promise<SessionView[]> {
  return loadChildren(api, null, signal);
}

export async function planSessionBatch(
  api: SessionManagementApi,
  selected: SessionView[],
  action: SessionBatchAction,
): Promise<SessionBatchPlan> {
  if (selected.length === 0) throw new Error("请选择要管理的会话。");
  const unique = [...new Map(selected.map((session) => [session.id, session])).values()];
  const roots: SessionView[] = [];
  const sessions = new Map<string, SessionView>();
  for (const candidate of unique.filter((session) => session.parentSessionId === null)) {
    const root = await verifyRoot(api, candidate);
    if ((action === "archive" && root.archived) || (action === "restore" && !root.archived))
      throw new Error(changedMessage);
    roots.push(root);
    for (const session of await loadFamily(api, root)) {
      if (sessions.has(session.id)) throw new Error(catalogChangedMessage);
      sessions.set(session.id, session);
    }
  }
  if (roots.length === 0 || unique.some((session) => !sessions.has(session.id)))
    throw new Error("请从工作文件夹列表中选择主会话。");
  return { action, roots, sessions: [...sessions.values()] };
}

export async function runSessionBatch(
  api: SessionManagementApi,
  plan: SessionBatchPlan,
  onProgress?: (progress: SessionBatchProgress) => void,
): Promise<SessionBatchResult> {
  const result: SessionBatchResult = { succeeded: [], failures: [], removedIds: [] };
  const removedIds = new Set<string>();
  const roots = [...new Map(plan.roots.map((root) => [root.id, root])).values()];
  for (const root of roots) {
    const expected = plannedFamily(plan, root);
    let succeeded = false;
    try {
      const current = await verifyRoot(api, root);
      const family = await loadFamily(api, current);
      const currentById = new Map(family.map((session) => [session.id, session]));
      if (
        family.length !== expected.length ||
        expected.some((session) => {
          const actual = currentById.get(session.id);
          return !actual || !sameIdentity(session, actual);
        })
      )
        throw new Error(catalogChangedMessage);
      const targets = expected.map(({ id, parentSessionId, workspacePath, archived }) => ({
        id,
        parentSessionId,
        workspacePath,
        archived,
      }));
      if (plan.action === "delete") {
        await api.removeSession(root.id, targets);
        for (const session of expected) removedIds.add(session.id);
      } else {
        const archived = plan.action === "archive";
        const updated = await api.updateSession({ sessionId: root.id, archived }, targets);
        if (!updated || updated.id !== root.id || updated.archived !== archived)
          throw new Error(catalogChangedMessage);
      }
      succeeded = true;
      result.succeeded.push(root.id);
    } catch (cause) {
      result.failures.push({
        sessionId: root.id,
        title: root.title,
        message: cause instanceof Error ? cause.message : String(cause),
      });
      if (plan.action === "delete") {
        // A recursive delete can remove children before a later snapshot deletion fails.
        for (const session of expected) {
          try {
            if ((await api.getSession(session.id)) === null) removedIds.add(session.id);
          } catch {
            // An unavailable record is not evidence that it was deleted.
          }
        }
      }
    }
    onProgress?.({
      completed: result.succeeded.length + result.failures.length,
      total: roots.length,
      sessionId: root.id,
      title: root.title,
      succeeded,
    });
  }
  result.removedIds = [...removedIds];
  return result;
}
