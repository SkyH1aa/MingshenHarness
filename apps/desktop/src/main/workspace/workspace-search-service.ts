import { join, resolve } from "node:path";
import type {
  WorkspaceFileSearchInput,
  WorkspaceFileSearchItem,
  WorkspaceFileSearchResult,
} from "../../shared/project-navigation";
import type { Repository } from "../storage/repository";
import { listGuardedDirectory, statGuardedPath } from "./guarded-workspace-io";

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);
const MAX_ENTRIES = 20_000;
const MAX_DEPTH = 16;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const SEARCH_BUDGET_MS = 1_500;
const GUARD_STARTUP_ALLOWANCE_MS = 20_000;

function score(relativePath: string, name: string, query: string): number {
  const normalizedPath = relativePath.replaceAll("\\", "/").toLocaleLowerCase();
  const normalizedName = name.toLocaleLowerCase();
  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;
  if (normalizedName.includes(query)) return 2;
  if (normalizedPath.startsWith(query)) return 3;
  return 4;
}

export class WorkspaceSearchService {
  constructor(private readonly resolveWorktreeRoot?: (sessionId: string) => string | null) {}

  async findSessionFiles(
    repository: Pick<Repository, "getSession">,
    input: WorkspaceFileSearchInput,
  ): Promise<WorkspaceFileSearchResult> {
    const session = repository.getSession(input.sessionId);
    if (!session) throw new Error("会话不存在。");
    if (session.agentMode === "chat") throw new Error("ChatAgent 不开放工作区文件搜索。");
    if (!session.workspacePath) throw new Error("当前会话没有工作目录。");
    const root =
      session.executionMode === "worktree"
        ? this.resolveWorktreeRoot?.(session.id)
        : session.workspacePath;
    if (!root) throw new Error("当前会话的工作树尚未建立，无法搜索文件。");
    return this.findFiles(root, input);
  }

  async findFiles(
    rootInput: string,
    input: WorkspaceFileSearchInput,
  ): Promise<WorkspaceFileSearchResult> {
    const root = resolve(rootInput);
    const query = input.query.trim().toLocaleLowerCase("zh-CN");
    if (!query || query.length > 120) throw new Error("文件搜索词需要 1–120 个字符。");
    const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT));
    const rootEntries = await listGuardedDirectory(root, "", {
      timeoutMs: GUARD_STARTUP_ALLOWANCE_MS + SEARCH_BUDGET_MS,
    });
    const started = Date.now();
    const matches: Array<WorkspaceFileSearchItem & { rank: number }> = [];
    const pending: Array<{ path: string; depth: number }> = [{ path: "", depth: 0 }];
    let visited = 0;
    let truncated = false;

    while (pending.length) {
      if (visited >= MAX_ENTRIES || Date.now() - started > SEARCH_BUDGET_MS) {
        truncated = true;
        break;
      }
      const current = pending.pop();
      if (!current) break;
      let entries: Awaited<ReturnType<typeof listGuardedDirectory>>;
      try {
        entries = current.path
          ? await listGuardedDirectory(root, current.path, {
              timeoutMs: Math.max(1, SEARCH_BUDGET_MS - (Date.now() - started)),
            })
          : rootEntries;
      } catch {
        if (Date.now() - started >= SEARCH_BUDGET_MS) truncated = true;
        if (truncated) break;
        continue;
      }
      for (const entry of entries) {
        visited += 1;
        if (visited >= MAX_ENTRIES || Date.now() - started > SEARCH_BUDGET_MS) {
          truncated = true;
          break;
        }
        if (entry.reparse) continue;
        const relativePath = join(current.path, entry.name);
        if (entry.directory) {
          if (current.depth < MAX_DEPTH && !SKIPPED_DIRECTORIES.has(entry.name.toLocaleLowerCase()))
            pending.push({ path: relativePath, depth: current.depth + 1 });
          continue;
        }
        if (!relativePath.toLocaleLowerCase("zh-CN").includes(query)) continue;
        try {
          const stat = await statGuardedPath(root, relativePath, {
            timeoutMs: Math.max(1, SEARCH_BUDGET_MS - (Date.now() - started)),
          });
          if (stat.state !== "file" || stat.directory) continue;
        } catch {
          if (Date.now() - started >= SEARCH_BUDGET_MS) truncated = true;
          if (truncated) break;
          continue;
        }
        matches.push({
          name: entry.name,
          path: join(root, relativePath),
          relativePath,
          rank: score(relativePath, entry.name, query),
        });
      }
      if (truncated) break;
    }

    matches.sort(
      (left, right) =>
        left.rank - right.rank ||
        left.relativePath.length - right.relativePath.length ||
        left.relativePath.localeCompare(right.relativePath, "zh-CN"),
    );
    return {
      root,
      items: matches.slice(0, limit).map(({ rank: _rank, ...item }) => item),
      truncated: truncated || matches.length > limit,
    };
  }
}
