import type { SessionBatchTarget } from "../../shared/session-catalog";
import type { Repository } from "../storage/repository";

type SessionBatchRepository = Pick<Repository, "getSession" | "listChildSessions">;
const changedMessage = "会话目录发生变化，请刷新后重试。";

function sameTarget(expected: SessionBatchTarget, current: SessionBatchTarget): boolean {
  return (
    expected.id === current.id &&
    expected.parentSessionId === current.parentSessionId &&
    expected.workspacePath === current.workspacePath &&
    expected.archived === current.archived
  );
}

function expectedTargets(
  sessionId: string,
  input: SessionBatchTarget[],
): Map<string, SessionBatchTarget> {
  if (!Array.isArray(input) || !input.length || input.length > 100000)
    throw new Error(changedMessage);
  const expected = new Map<string, SessionBatchTarget>();
  for (const item of input) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      (item.parentSessionId !== null && typeof item.parentSessionId !== "string") ||
      (item.workspacePath !== null && typeof item.workspacePath !== "string") ||
      typeof item.archived !== "boolean" ||
      expected.has(item.id)
    )
      throw new Error(changedMessage);
    expected.set(item.id, {
      id: item.id,
      parentSessionId: item.parentSessionId,
      workspacePath: item.workspacePath,
      archived: item.archived,
    });
  }
  if (expected.get(sessionId)?.parentSessionId !== null) throw new Error(changedMessage);
  const included = new Set([sessionId]);
  const children = new Map<string, string[]>();
  for (const item of expected.values()) {
    if (item.id === sessionId) continue;
    if (item.parentSessionId === null || !expected.has(item.parentSessionId))
      throw new Error(changedMessage);
    const siblings = children.get(item.parentSessionId) ?? [];
    siblings.push(item.id);
    children.set(item.parentSessionId, siblings);
  }
  const pending = [sessionId];
  for (let index = 0; index < pending.length; index += 1) {
    const id = pending[index];
    if (!id) continue;
    for (const child of children.get(id) ?? []) {
      if (included.has(child)) throw new Error(changedMessage);
      included.add(child);
      pending.push(child);
    }
  }
  if (included.size !== expected.size) throw new Error(changedMessage);
  return expected;
}

export function createSessionBatchGuard(
  repository: SessionBatchRepository,
  sessionId: string,
  input?: SessionBatchTarget[],
): (() => boolean) | undefined {
  if (input === undefined) return undefined;
  const expected = expectedTargets(sessionId, input);
  const check = (allowRemoved: boolean): boolean => {
    const root = repository.getSession(sessionId);
    if (!root) throw new Error(changedMessage);
    const pending = [root];
    const found = new Set<string>();
    for (let index = 0; index < pending.length; index += 1) {
      const current = pending[index];
      if (!current) continue;
      const target = expected.get(current.id);
      if (!target || !sameTarget(target, current) || found.has(current.id))
        throw new Error(changedMessage);
      found.add(current.id);
      for (const child of repository.listChildSessions(current.id)) pending.push(child);
    }
    if (!allowRemoved && found.size !== expected.size) throw new Error(changedMessage);
    // Missing children are allowed only after this deletion has begun removing its family.
    if (allowRemoved)
      for (const id of expected.keys())
        if (!found.has(id) && repository.getSession(id)) throw new Error(changedMessage);
    return true;
  };
  check(false);
  return () => check(true);
}
