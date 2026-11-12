import type { SessionView } from "../../../shared/domain";

export function sessionRecency(session: SessionView): number {
  const time = (value: string) => (Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0);
  return Math.max(time(session.lastOpenedAt), time(session.updatedAt), time(session.createdAt));
}

export function recentSessionIds(sessions: SessionView[], limit = 3): Set<string> {
  return new Set(
    [...sessions]
      .sort((left, right) => sessionRecency(right) - sessionRecency(left))
      .slice(0, limit)
      .map((session) => session.id),
  );
}
