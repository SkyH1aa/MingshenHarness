import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync(
    "git.exe",
    ["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", ...args],
    {
      cwd,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 2_000_000,
    },
  );
  return result.stdout.trim();
}

export class WorktreeService {
  private readonly active = new Map<string, string>();

  constructor(private readonly worktreeRoot: string) {}

  async ensure(sessionId: string, repositoryPath: string): Promise<string> {
    const root = resolve(repositoryPath);
    await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
    await runGit(root, ["rev-parse", "--verify", "HEAD"]);
    await mkdir(this.worktreeRoot, { recursive: true });
    if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new Error("无效的 worktree 会话 ID。");
    const worktreePath = join(this.worktreeRoot, sessionId);
    try {
      await access(worktreePath);
      const actual = await runGit(worktreePath, ["rev-parse", "--show-toplevel"]);
      if (resolve(actual).toLowerCase() !== resolve(worktreePath).toLowerCase())
        throw new Error("worktree 路径校验失败。");
      const sourceCommon = await runGit(root, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      const targetCommon = await runGit(worktreePath, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      if (resolve(sourceCommon).toLowerCase() !== resolve(targetCommon).toLowerCase())
        throw new Error("worktree 不属于此仓库。");
      this.active.set(sessionId, worktreePath);
      return worktreePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await runGit(root, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
    this.active.set(sessionId, worktreePath);
    return worktreePath;
  }

  get(sessionId: string): string | null {
    return this.active.get(sessionId) ?? null;
  }

  async remove(sessionId: string, repositoryPath: string): Promise<void> {
    const worktreePath = this.active.get(sessionId);
    if (!worktreePath) {
      return;
    }
    const local = relative(resolve(this.worktreeRoot), resolve(worktreePath));
    if (!local || local.startsWith("..") || isAbsolute(local))
      throw new Error("worktree 清理路径无效。");
    const status = await runGit(worktreePath, ["status", "--porcelain"]);
    if (status) throw new Error("worktree 含有未提交修改，不能删除。");
    await runGit(resolve(repositoryPath), ["worktree", "remove", worktreePath]);
    this.active.delete(sessionId);
  }
}
