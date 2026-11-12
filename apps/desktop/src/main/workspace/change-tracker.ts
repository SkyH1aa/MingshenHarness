import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FileChange } from "../../shared/domain";

const execFileAsync = promisify(execFile);

interface ChangeSnapshot {
  status: string;
  additions: number;
  deletions: number;
}

async function git(workspacePath: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync(
      "git.exe",
      ["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", "-c", "diff.external=", ...args],
      {
        cwd: workspacePath,
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 2_000_000,
      },
    );
    return result.stdout;
  } catch {
    return null;
  }
}

async function countFileLines(path: string): Promise<number> {
  try {
    const content = await readFile(path, "utf8");
    return content ? content.split(/\r?\n/).length : 0;
  } catch {
    return 0;
  }
}

export async function snapshotWorkspaceChanges(
  workspacePath: string | null,
): Promise<Map<string, ChangeSnapshot>> {
  const snapshot = new Map<string, ChangeSnapshot>();
  if (!workspacePath) {
    return snapshot;
  }

  const statusText = await git(workspacePath, ["status", "--porcelain=v1", "-uall"]);
  if (!statusText) {
    return snapshot;
  }
  for (const line of statusText.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const status = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const path = rawPath.includes(" -> ") ? (rawPath.split(" -> ").at(-1) ?? rawPath) : rawPath;
    snapshot.set(path.replaceAll("\\", "/"), {
      status,
      additions: 0,
      deletions: 0,
    });
  }

  const diffTexts = await Promise.all([
    git(workspacePath, ["diff", "--numstat", "--"]),
    git(workspacePath, ["diff", "--cached", "--numstat", "--"]),
  ]);
  for (const diffText of diffTexts) {
    if (!diffText) {
      continue;
    }
    for (const line of diffText.split(/\r?\n/)) {
      const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t").trim().replaceAll("\\", "/");
      if (!path) {
        continue;
      }
      const current = snapshot.get(path) ?? {
        status: " M",
        additions: 0,
        deletions: 0,
      };
      current.additions += Number(addedRaw) || 0;
      current.deletions += Number(deletedRaw) || 0;
      snapshot.set(path, current);
    }
  }

  for (const [path, value] of snapshot) {
    if (value.status === "??" && value.additions === 0 && value.deletions === 0) {
      value.additions = await countFileLines(join(workspacePath, path));
    }
  }
  return snapshot;
}

export function changedFiles(
  before: Map<string, ChangeSnapshot>,
  after: Map<string, ChangeSnapshot>,
): FileChange[] {
  const changes: FileChange[] = [];
  for (const [path, next] of after) {
    const previous = before.get(path);
    if (
      previous &&
      previous.status === next.status &&
      previous.additions === next.additions &&
      previous.deletions === next.deletions
    ) {
      continue;
    }
    const changeType = next.status.includes("D")
      ? "deleted"
      : !previous || next.status === "??"
        ? "created"
        : "modified";
    changes.push({
      path,
      changeType,
      additions: Math.max(0, next.additions - (previous?.additions ?? 0)),
      deletions: Math.max(0, next.deletions - (previous?.deletions ?? 0)),
    });
  }
  for (const [path, previous] of before) {
    if (!after.has(path) && previous.status !== "??") {
      changes.push({
        path,
        changeType: "deleted",
        additions: 0,
        deletions: previous.additions,
      });
    }
  }
  return changes;
}
