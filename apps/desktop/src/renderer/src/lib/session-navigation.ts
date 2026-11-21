import type { SessionView } from "../../../shared/domain";
import type { SessionProjectContexts } from "../../../shared/project-navigation";
import { sessionRecency } from "./recent-sessions";

export interface NavigationGroup {
  key: string;
  workspaceKey: string;
  path: string | null;
  label: string;
  branch: string | null;
  branchRecorded: boolean;
  worktree: boolean;
  roots: SessionView[];
  children: Map<string, SessionView[]>;
  sessions: SessionView[];
  updatedAt: number;
}

export function workspaceKey(path: string | null): string {
  return path ? path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() : "__none__";
}

interface NavigationEntry {
  signature: string;
  title: string;
  grams: Set<string>;
  session: SessionView;
}

function searchGrams(value: string): Set<string> {
  const characters = Array.from(value);
  return new Set(
    characters.flatMap((character, index) => [
      `c:${character}`,
      ...(index + 1 < characters.length ? [`p:${character}${characters[index + 1]}`] : []),
    ]),
  );
}

// Maintain postings and reuse grouped results across background polls with unchanged metadata.
export class SessionNavigationIndex {
  private readonly entries = new Map<string, NavigationEntry>();
  private readonly postings = new Map<string, Set<string>>();
  private readonly cached = new Map<string, NavigationGroup[]>();
  private lastSessions: SessionView[] | null = null;

  private unindex(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    for (const gram of entry.grams) {
      const posting = this.postings.get(gram);
      posting?.delete(id);
      if (!posting?.size) this.postings.delete(gram);
    }
    this.entries.delete(id);
  }

  groups(sessions: SessionView[], search: string): NavigationGroup[] {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    if (sessions !== this.lastSessions) {
      const ids = new Set<string>();
      let changed = false;
      for (const session of sessions) {
        if (session.archived) continue;
        ids.add(session.id);
        const signature = JSON.stringify([
          session.title,
          session.workspacePath,
          session.parentSessionId,
          session.status,
          session.pinned,
          session.updatedAt,
          session.lastOpenedAt,
          session.createdAt,
          session.childCount,
        ]);
        const old = this.entries.get(session.id);
        if (old?.signature === signature) continue;
        changed = true;
        const title =
          old?.session.title === session.title
            ? old.title
            : session.title.toLocaleLowerCase("zh-CN");
        const grams = old?.title === title ? old.grams : searchGrams(title);
        if (old?.title !== title) {
          this.unindex(session.id);
          for (const gram of grams) {
            const posting = this.postings.get(gram) ?? new Set<string>();
            posting.add(session.id);
            this.postings.set(gram, posting);
          }
        }
        this.entries.set(session.id, { signature, title, grams, session });
      }
      for (const id of this.entries.keys())
        if (!ids.has(id)) {
          changed = true;
          this.unindex(id);
        }
      if (changed) this.cached.clear();
      this.lastSessions = sessions;
    }
    const cached = this.cached.get(query);
    if (cached) return cached;
    const active = new Map([...this.entries].map(([id, entry]) => [id, entry.session]));
    let candidates: Iterable<string> = active.keys();
    if (query) {
      const postings = [...searchGrams(query)]
        .map((gram) => this.postings.get(gram) ?? new Set<string>())
        .sort((a, b) => a.size - b.size);
      candidates = [...(postings[0] ?? [])].filter((id) =>
        postings.every((posting) => posting.has(id)),
      );
    }
    const included = new Set<string>();
    for (const id of candidates) {
      const entry = this.entries.get(id);
      if (!entry || (query && !entry.title.includes(query))) continue;
      const session = entry.session;
      included.add(session.id);
      let parent = session.parentSessionId;
      const visited = new Set([session.id]);
      while (parent && active.has(parent) && !visited.has(parent)) {
        visited.add(parent);
        included.add(parent);
        parent = active.get(parent)?.parentSessionId ?? null;
      }
    }
    const groups = new Map<string, NavigationGroup>();
    for (const id of included) {
      const session = active.get(id);
      if (!session) continue;
      let root = session;
      const seen = new Set([session.id]);
      while (
        root.parentSessionId &&
        active.has(root.parentSessionId) &&
        !seen.has(root.parentSessionId)
      ) {
        seen.add(root.parentSessionId);
        root = active.get(root.parentSessionId) as SessionView;
      }
      const key = workspaceKey(root.workspacePath);
      const group: NavigationGroup = groups.get(key) ?? {
        key,
        workspaceKey: key,
        path: root.workspacePath,
        label:
          root.workspacePath
            ?.replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .at(-1) || "",
        branch: null,
        branchRecorded: false,
        worktree: false,
        roots: [],
        children: new Map(),
        sessions: [],
        updatedAt: 0,
      };
      group.sessions.push(session);
      if (
        session.parentSessionId &&
        included.has(session.parentSessionId) &&
        session.id !== root.id
      ) {
        const children = group.children.get(session.parentSessionId) ?? [];
        children.push(session);
        group.children.set(session.parentSessionId, children);
      } else group.roots.push(session);
      group.updatedAt = Math.max(group.updatedAt, sessionRecency(session));
      groups.set(key, group);
    }
    const compare = (a: SessionView, b: SessionView) =>
      Number(b.pinned) - Number(a.pinned) || sessionRecency(b) - sessionRecency(a);
    for (const group of groups.values()) {
      group.roots.sort(compare);
      for (const children of group.children.values()) children.sort(compare);
    }
    const result = [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    this.cached.set(query, result);
    if (this.cached.size > 12) this.cached.delete(this.cached.keys().next().value as string);
    return result;
  }
}

export function branchNavigationGroups(
  workspaceGroups: NavigationGroup[],
  contexts: SessionProjectContexts["contexts"],
): NavigationGroup[] {
  const result: NavigationGroup[] = [];
  for (const workspaceGroup of workspaceGroups) {
    type BranchBucket = NavigationGroup & { familySeen: Set<string> };
    const buckets = new Map<string, BranchBucket>();
    for (const root of workspaceGroup.roots) {
      const context = contexts[root.id] ?? null;
      const branchKey = `${context?.worktree ? "worktree" : "host"}:${context?.branch ?? ""}`;
      const key = `${workspaceGroup.key}::branch:${branchKey}`;
      const bucket: BranchBucket = buckets.get(key) ?? {
        key,
        workspaceKey: workspaceGroup.workspaceKey,
        path: workspaceGroup.path,
        label: workspaceGroup.label,
        branch: context?.branch ?? null,
        branchRecorded: Boolean(context),
        worktree: Boolean(context?.worktree),
        roots: [],
        children: new Map(),
        sessions: [],
        updatedAt: workspaceGroup.updatedAt,
        familySeen: new Set<string>(),
      };
      if (bucket.familySeen.has(root.id)) continue;
      const visit = (session: SessionView) => {
        if (bucket.familySeen.has(session.id)) return;
        bucket.familySeen.add(session.id);
        bucket.sessions.push(session);
        bucket.updatedAt = Math.max(bucket.updatedAt, sessionRecency(session));
        const children = workspaceGroup.children.get(session.id) ?? [];
        if (children.length) bucket.children.set(session.id, children);
        for (const child of children) visit(child);
      };
      bucket.roots.push(root);
      visit(root);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) {
      const { familySeen: _familySeen, ...group } = bucket;
      result.push(group);
    }
    if (!workspaceGroup.roots.length) {
      result.push({
        ...workspaceGroup,
        key: `${workspaceGroup.key}::branch:empty`,
        branch: null,
        branchRecorded: false,
        worktree: false,
      });
    }
  }
  return result.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function visibleSessionRows(
  group: NavigationGroup,
  expanded: Set<string>,
  showAll: boolean,
  searching: boolean,
): SessionView[] {
  const recent = new Set(
    [...group.roots]
      .sort((a, b) => sessionRecency(b) - sessionRecency(a))
      .slice(0, 3)
      .map((s) => s.id),
  );
  const rows: SessionView[] = [];
  const seen = new Set<string>();
  const visit = (session: SessionView) => {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    rows.push(session);
    if (searching || expanded.has(session.id))
      for (const child of group.children.get(session.id) ?? []) visit(child);
  };
  for (const root of group.roots) if (showAll || recent.has(root.id)) visit(root);
  return rows;
}
