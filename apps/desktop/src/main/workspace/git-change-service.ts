import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { safeFilePath } from "./safe-file-path";
import { SNAPSHOT_MAX_BYTES } from "./snapshot-service";

const exec = promisify(execFile);
interface UndoManifest {
  root: string;
  indexPath: string;
  indexExisted?: boolean;
  head?: string | null;
  createdAt?: string;
  files: Array<{ path: string; existed: boolean }>;
}

export class GitChangeService {
  private readonly busy = new Set<string>();
  constructor(private readonly backupRoot: string) {}

  private async git(root: string, args: string[]): Promise<string> {
    return (
      await exec(
        "git.exe",
        ["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", "--literal-pathspecs", ...args],
        {
          cwd: root,
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 16 * 1024 * 1024,
        },
      )
    ).stdout;
  }

  async changes(workspace: string): Promise<{ root: string; paths: string[] }> {
    const root = (await this.git(workspace, ["rev-parse", "--show-toplevel"])).trim();
    const head = await this.git(root, ["rev-parse", "--verify", "HEAD"]).catch(() => null);
    const tracked = await this.git(
      root,
      head ? ["diff", "--no-renames", "--name-only", "-z", "HEAD"] : ["ls-files", "-z"],
    );
    const untracked = await this.git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
    return {
      root,
      paths: [...new Set([...tracked.split("\0"), ...untracked.split("\0")].filter(Boolean))],
    };
  }

  async discard(
    workspace: string,
    requestedPaths?: string[],
  ): Promise<{ backupId: string; paths: string[] }> {
    const { root, paths: changed } = await this.changes(workspace);
    const paths = requestedPaths?.length ? [...new Set(requestedPaths)] : changed;
    if (!paths.length) throw new Error("当前没有可撤销的 Git 变更。");
    if (paths.some((path) => !changed.includes(path)))
      throw new Error("文件状态已变化，请刷新 Git 面板后重试。");
    if (this.busy.has(root)) throw new Error("此仓库正在执行恢复操作。");
    this.busy.add(root);
    const backupId = randomUUID();
    const backup = join(this.backupRoot, backupId);
    const manifest: UndoManifest = {
      root,
      head:
        (await this.git(root, ["rev-parse", "--verify", "HEAD"]).catch(() => "")).trim() || null,
      createdAt: new Date().toISOString(),
      indexPath: resolve(root, (await this.git(root, ["rev-parse", "--git-path", "index"])).trim()),
      files: [],
    };
    try {
      await mkdir(backup, { recursive: true });
      manifest.indexExisted = await lstat(manifest.indexPath).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return false;
        },
      );
      if (manifest.indexExisted) await copyFile(manifest.indexPath, join(backup, "index"));
      let bytes = 0;
      for (const path of paths) {
        const target = await safeFilePath(root, path);
        const local = relative(root, target);
        if (
          !local ||
          local.startsWith("..") ||
          isAbsolute(local) ||
          local.split(/[\\/]/)[0] === ".git"
        )
          throw new Error("Git 文件路径无效。");
        let metadata: Awaited<ReturnType<typeof lstat>> | undefined;
        try {
          metadata = await lstat(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (metadata && !metadata.isFile())
          throw new Error(`不支持直接撤销目录或符号链接：${path}`);
        manifest.files.push({ path, existed: Boolean(metadata) });
        if (metadata) {
          bytes += Number(metadata.size);
          if (bytes > SNAPSHOT_MAX_BYTES) throw new Error("Git 恢复备份超过 1 GiB，未执行撤销。");
          await mkdir(dirname(join(backup, "files", path)), { recursive: true });
          await copyFile(target, join(backup, "files", path));
        }
      }
      await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest), "utf8");
      const indexed = new Set((await this.git(root, ["ls-files", "-z"])).split("\0"));
      const headFiles = new Set(
        manifest.head
          ? (await this.git(root, ["ls-tree", "-r", "--name-only", "-z", "HEAD"])).split("\0")
          : [],
      );
      for (const path of paths) {
        if (headFiles.has(path)) {
          await this.git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", path]);
        } else {
          if (indexed.has(path)) await this.git(root, ["rm", "--cached", "--force", "--", path]);
          await rm(resolve(root, path), { force: true });
        }
      }
      return { backupId, paths };
    } catch (error) {
      if (
        manifest.files.length &&
        (await readFile(join(backup, "manifest.json"), "utf8").catch(() => ""))
      ) {
        try {
          await this.restoreFiles(backupId, root);
        } catch (rollbackError) {
          throw new Error(
            `撤销失败且自动恢复未完成。备份 ${backupId}：${String(error)}；${String(rollbackError)}`,
          );
        }
      }
      throw error;
    } finally {
      this.busy.delete(root);
    }
  }

  async restore(backupId: string, workspace: string): Promise<void> {
    const root = (await this.git(workspace, ["rev-parse", "--show-toplevel"])).trim();
    if (this.busy.has(root)) throw new Error("此仓库正在执行恢复操作。");
    this.busy.add(root);
    try {
      await this.restoreFiles(backupId, workspace, true);
    } finally {
      this.busy.delete(root);
    }
  }

  async latestBackup(workspace: string): Promise<string | null> {
    const root = (await this.git(workspace, ["rev-parse", "--show-toplevel"])).trim();
    await mkdir(this.backupRoot, { recursive: true });
    const entries = await readdir(this.backupRoot, { withFileTypes: true });
    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && /^[a-f0-9-]{36}$/i.test(entry.name))
        .map(async (entry) => {
          try {
            const manifest = JSON.parse(
              await readFile(join(this.backupRoot, entry.name, "manifest.json"), "utf8"),
            ) as UndoManifest;
            return { id: entry.name, ...manifest };
          } catch {
            return null;
          }
        }),
    );
    return (
      manifests
        .filter(
          (manifest) =>
            manifest && resolve(manifest.root).toLowerCase() === resolve(root).toLowerCase(),
        )
        .sort((a, b) => (b?.createdAt ?? "").localeCompare(a?.createdAt ?? ""))[0]?.id ?? null
    );
  }

  private async restoreFiles(
    backupId: string,
    workspace: string,
    backupCurrent = false,
  ): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(backupId)) throw new Error("Git 备份 ID 无效。");
    const backup = join(this.backupRoot, backupId);
    const manifest = JSON.parse(
      await readFile(join(backup, "manifest.json"), "utf8"),
    ) as UndoManifest;
    const root = (await this.git(workspace, ["rev-parse", "--show-toplevel"])).trim();
    if (resolve(manifest.root).toLowerCase() !== resolve(root).toLowerCase())
      throw new Error("Git 备份与当前仓库不匹配。");
    const indexPath = resolve(
      root,
      (await this.git(root, ["rev-parse", "--git-path", "index"])).trim(),
    );
    if (indexPath !== manifest.indexPath) throw new Error("Git 索引路径已变化。");
    const head =
      (await this.git(root, ["rev-parse", "--verify", "HEAD"]).catch(() => "")).trim() || null;
    if (manifest.head !== undefined && manifest.head !== head)
      throw new Error("仓库 HEAD 已变化，不能恢复旧暂存区，请从备份中提取文件。");
    for (const file of manifest.files) {
      await safeFilePath(root, file.path);
      if (
        file.existed &&
        !(await lstat(await safeFilePath(join(backup, "files"), file.path))).isFile()
      )
        throw new Error("Git 备份文件损坏。");
    }
    if (manifest.indexExisted !== false) await lstat(join(backup, "index"));
    if (backupCurrent) {
      const safetyId = randomUUID();
      const safetyRoot = join(this.backupRoot, safetyId);
      const safety: UndoManifest = {
        root,
        indexPath,
        head,
        createdAt: new Date().toISOString(),
        files: [],
        indexExisted: await lstat(indexPath).then(
          () => true,
          () => false,
        ),
      };
      await mkdir(safetyRoot, { recursive: true });
      let bytes = 0;
      try {
        if (safety.indexExisted) await copyFile(indexPath, join(safetyRoot, "index"));
        for (const file of manifest.files) {
          const target = await safeFilePath(root, file.path);
          const metadata = await lstat(target).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
            return null;
          });
          if (metadata && !metadata.isFile()) throw new Error("恢复目标不是普通文件。");
          safety.files.push({ path: file.path, existed: Boolean(metadata) });
          if (metadata) {
            bytes += metadata.size;
            if (bytes > SNAPSHOT_MAX_BYTES) throw new Error("恢复前的安全备份超过 1 GiB。");
            const destination = join(safetyRoot, "files", file.path);
            await mkdir(dirname(destination), { recursive: true });
            await copyFile(target, destination);
          }
        }
        await writeFile(join(safetyRoot, "manifest.json"), JSON.stringify(safety), "utf8");
      } catch (error) {
        await rm(safetyRoot, { recursive: true, force: true });
        throw error;
      }
    }
    for (const file of manifest.files) {
      const target = await safeFilePath(root, file.path);
      if (file.existed) {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(backup, "files", file.path), target);
      } else await rm(target, { force: true });
    }
    if (manifest.indexExisted !== false) await copyFile(join(backup, "index"), indexPath);
    else await rm(indexPath, { force: true });
  }
}
