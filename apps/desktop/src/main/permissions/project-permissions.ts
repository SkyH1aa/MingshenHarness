import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { ApprovalMode, PermissionMode, SessionView } from "../../shared/domain";
import type { Repository } from "../storage/repository";

function projectKey(path: string): string {
  const normalized = resolve(path).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return `permissions.project.${createHash("sha256").update(normalized).digest("hex")}`;
}

export function projectPermission(
  repository: Repository,
  path: string | null,
): PermissionMode | null {
  if (!path) return null;
  const mode = repository.getSetting(projectKey(path));
  return mode === "full_access" || mode === "request_approval" ? mode : null;
}

export function setProjectPermission(
  repository: Repository,
  session: SessionView,
  mode: PermissionMode,
): SessionView[] {
  if (!session.workspacePath)
    return [repository.updateSession(session.id, { permissionMode: mode })];
  const key = projectKey(session.workspacePath);
  repository.setSetting(key, mode);
  const sessions = repository.listSessions();
  const ids = new Set(
    sessions
      .filter((candidate) => candidate.workspacePath && projectKey(candidate.workspacePath) === key)
      .map((candidate) => candidate.id),
  );
  // Worktree children can store their isolated checkout path; they still inherit this project grant.
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of sessions) {
      if (
        !ids.has(candidate.id) &&
        candidate.parentSessionId &&
        ids.has(candidate.parentSessionId)
      ) {
        ids.add(candidate.id);
        changed = true;
      }
    }
  }
  return sessions
    .filter((candidate) => ids.has(candidate.id))
    .map((candidate) => repository.updateSession(candidate.id, { permissionMode: mode }));
}

export function setApprovalMode(
  repository: Repository,
  sessionId: string,
  mode: ApprovalMode,
): void {
  repository.setSetting(`permissions.approval.${sessionId}`, mode);
}
