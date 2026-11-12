import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitChangeService } from "./git-change-service";
import { WorktreeService } from "./worktree-service";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mingshen-git-undo-"));
  roots.push(root);
  const workspace = join(root, "repo");
  await mkdir(workspace);
  const git = async (...args: string[]) =>
    (await exec("git.exe", args, { cwd: workspace, windowsHide: true })).stdout;
  await git("init");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(workspace, "tracked.txt"), "original\n");
  await git("add", ".");
  await git("commit", "-m", "fixture");
  return { root, workspace, git, service: new GitChangeService(join(root, "undo")) };
}
describe("Git discard and managed worktrees", () => {
  it("supports repositories without a first commit and persists recovery across restart", async () => {
    const { root, workspace, git } = await fixture();
    await git("checkout", "--orphan", "empty");
    const service = new GitChangeService(join(root, "undo-new"));
    const status = await git("status", "--porcelain");
    const result = await service.discard(workspace);
    expect(await git("status", "--porcelain")).toBe("");
    const restarted = new GitChangeService(join(root, "undo-new"));
    expect(await restarted.latestBackup(workspace)).toBe(result.backupId);
    await restarted.restore(result.backupId, workspace);
    expect(await git("status", "--porcelain")).toBe(status);
  }, 20_000);
  it("discards staged, unstaged, added, deleted and untracked files and restores exact index state", async () => {
    const { workspace, git, service } = await fixture();
    await writeFile(join(workspace, "tracked.txt"), "staged\n");
    await git("add", "tracked.txt");
    await writeFile(join(workspace, "tracked.txt"), "unstaged\n");
    await writeFile(join(workspace, "added.txt"), "added\n");
    await git("add", "added.txt");
    await writeFile(join(workspace, "untracked.txt"), "untracked\n");
    const status = await git("status", "--porcelain");
    const staged = await git("diff", "--cached");
    const result = await service.discard(workspace);
    expect(await git("status", "--porcelain")).toBe("");
    expect(await readFile(join(workspace, "tracked.txt"), "utf8")).toBe("original\n");
    await service.restore(result.backupId, workspace);
    expect(await git("status", "--porcelain")).toBe(status);
    expect(await git("diff", "--cached")).toBe(staged);
    expect(await readFile(join(workspace, "tracked.txt"), "utf8")).toBe("unstaged\n");
  }, 20_000);
  it("handles selected deletion and refuses unrelated or forged backup paths", async () => {
    const { root, workspace, git, service } = await fixture();
    await rm(join(workspace, "tracked.txt"));
    await writeFile(join(workspace, "keep.txt"), "keep");
    const { backupId } = await service.discard(workspace, ["tracked.txt"]);
    expect(await git("status", "--porcelain")).toContain("keep.txt");
    await service.restore(backupId, workspace);
    await expect(readFile(join(workspace, "tracked.txt"))).rejects.toThrow();
    await expect(service.discard(workspace, ["../other"])).rejects.toThrow();
    const manifestPath = join(root, "undo", backupId, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files = [{ path: ".git/config", existed: false }];
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(service.restore(backupId, workspace)).rejects.toThrow();
  }, 20_000);
  it("reuses an existing dirty worktree after restart and refuses deletion", async () => {
    const { root, workspace } = await fixture();
    const first = new WorktreeService(join(root, "worktrees"));
    const path = await first.ensure("child-1", workspace);
    await writeFile(join(path, "tracked.txt"), "valuable edits");
    const restarted = new WorktreeService(join(root, "worktrees"));
    expect(await restarted.ensure("child-1", workspace)).toBe(path);
    expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("valuable edits");
    await expect(restarted.remove("child-1", workspace)).rejects.toThrow("未提交");
  }, 20_000);
  it("rejects reusing a cached worktree for a different repository", async () => {
    const { root, workspace } = await fixture();
    const second = await fixture();
    const service = new WorktreeService(join(root, "worktrees"));
    const path = await service.ensure("child-1", workspace);
    await writeFile(join(path, "tracked.txt"), "valuable edits");
    await expect(service.ensure("child-1", second.workspace)).rejects.toThrow("不属于此仓库");
    expect(await readFile(join(path, "tracked.txt"), "utf8")).toBe("valuable edits");
    expect(await service.ensure("child-1", workspace)).toBe(path);
  }, 20_000);
});
