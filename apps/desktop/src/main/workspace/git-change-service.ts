import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { applyGuardedOperations, inspectGuardedPaths } from "./guarded-workspace-io";
import { safeFilePath } from "./safe-file-path";
import { SNAPSHOT_MAX_BYTES } from "./snapshot-service";

const exec = promisify(execFile);
const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const GIT_PROCESS_TERMINATION_TIMEOUT_MS = 5_000;

function gitTaskkillExecutable(): string {
  return join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
}

async function terminateGitProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveTermination, rejectTermination) => {
    const killer = spawn(gitTaskkillExecutable(), ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectTermination(error);
      else resolveTermination();
    };
    const timer = setTimeout(() => {
      killer.kill();
      finish(new Error("Git 子进程树清理超过期限。"));
    }, GIT_PROCESS_TERMINATION_TIMEOUT_MS);
    timer.unref();
    killer.once("error", (error) => finish(error));
    killer.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`taskkill 退出码 ${code ?? "unknown"}`));
    });
  });
}

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
  constructor(
    private readonly backupRoot: string,
    private readonly gitTimeoutMs = DEFAULT_GIT_TIMEOUT_MS,
    private readonly contentTimeoutMs = gitTimeoutMs,
  ) {}

  private async git(
    root: string,
    args: string[],
    extraEnv: NodeJS.ProcessEnv = {},
  ): Promise<string> {
    return (
      await exec(
        "git.exe",
        ["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", "--literal-pathspecs", ...args],
        {
          cwd: root,
          env: { ...process.env, ...extraEnv },
          windowsHide: true,
          timeout: this.gitTimeoutMs,
          maxBuffer: 16 * 1024 * 1024,
        },
      )
    ).stdout;
  }

  private async guardedCopy(
    sourceRoot: string,
    sourcePath: string,
    targetRoot: string,
    targetPath: string,
  ): Promise<void> {
    await applyGuardedOperations({
      root: targetRoot,
      sourceRoot,
      operations: [
        {
          kind: "copy",
          sourcePath,
          targetPath,
          createParents: true,
        },
      ],
    });
  }

  private async indexExists(indexPath: string): Promise<boolean> {
    const [inspection] = await inspectGuardedPaths(dirname(indexPath), [basename(indexPath)]);
    return inspection?.state === "file";
  }

  private async backupIndex(indexPath: string, destination: string): Promise<boolean> {
    await mkdir(dirname(destination), { recursive: true });
    if (!(await this.indexExists(indexPath))) return false;
    await this.guardedCopy(
      dirname(indexPath),
      basename(indexPath),
      dirname(destination),
      basename(destination),
    );
    return true;
  }

  private async restoreIndex(indexPath: string, source: string, existed: boolean): Promise<void> {
    if (existed) {
      await this.guardedCopy(
        dirname(source),
        basename(source),
        dirname(indexPath),
        basename(indexPath),
      );
      return;
    }
    await applyGuardedOperations({
      root: dirname(indexPath),
      operations: [{ kind: "delete", path: basename(indexPath), allowMissing: true }],
    });
  }

  private async writeGitBlob(
    root: string,
    path: string,
    destination: string,
    maxBytes: number,
  ): Promise<number> {
    await mkdir(dirname(destination), { recursive: true });
    const child = spawn(
      "git.exe",
      [
        "-c",
        "core.hooksPath=NUL",
        "-c",
        "core.fsmonitor=false",
        "--literal-pathspecs",
        "cat-file",
        "--filters",
        `--path=${path}`,
        `HEAD:${path}`,
      ],
      {
        cwd: root,
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    let bytes = 0;
    let stderr = "";
    let timedOut = false;
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16 * 1024);
    });
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          callback(new Error("Git 恢复内容超过 1 GiB 上限。"));
          return;
        }
        callback(null, chunk);
      },
    });
    const exited = new Promise<void>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("close", (code) => {
        if (timedOut) rejectExit(new Error("Git 内容读取超过期限。"));
        else if (code === 0) resolveExit();
        else rejectExit(new Error(stderr.trim() || `git cat-file 退出码 ${code ?? "unknown"}`));
      });
    });
    let timeout: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_resolveExpired, rejectExpired) => {
      timeout = setTimeout(() => {
        timedOut = true;
        void terminateGitProcessTree(child).then(
          () => rejectExpired(new Error("Git 内容读取超过期限。")),
          (error: unknown) =>
            rejectExpired(
              new Error(`Git 内容读取超过期限，且无法确认子进程树已清理：${String(error)}`),
            ),
        );
      }, this.contentTimeoutMs);
      timeout.unref();
    });
    try {
      await Promise.race([Promise.all([pipeline(child.stdout, limiter, output), exited]), expired]);
      return bytes;
    } catch (error) {
      if (!timedOut) await terminateGitProcessTree(child).catch(() => child.kill());
      await Promise.race([
        exited.catch(() => undefined),
        new Promise<void>((resolveWait) => {
          const wait = setTimeout(resolveWait, 1_000);
          wait.unref();
        }),
      ]);
      await rm(destination, { force: true });
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async stageHeadFiles(
    root: string,
    backup: string,
    paths: string[],
    headFiles: Set<string>,
  ): Promise<{ root: string; files: Map<string, string> }> {
    const headRoot = join(backup, "head");
    await mkdir(headRoot, { recursive: true });
    const files = new Map<string, string>();
    let bytes = 0;
    for (const path of paths) {
      if (!headFiles.has(path)) continue;
      const destination = await safeFilePath(headRoot, path);
      bytes += await this.writeGitBlob(root, path, destination, SNAPSHOT_MAX_BYTES - bytes);
      if (bytes > SNAPSHOT_MAX_BYTES) throw new Error("Git 恢复内容超过 1 GiB，未执行撤销。");
      files.set(path, relative(headRoot, destination));
    }
    return { root: headRoot, files };
  }

  private async updateDiscardedIndex(
    root: string,
    indexPath: string,
    backup: string,
    paths: string[],
    indexed: Set<string>,
    headFiles: Set<string>,
    indexExisted: boolean,
  ): Promise<void> {
    const temporary = join(backup, "discard-index");
    if (indexExisted) {
      await this.guardedCopy(dirname(indexPath), basename(indexPath), backup, "discard-index");
    } else {
      await this.git(root, ["read-tree", "--empty"], { GIT_INDEX_FILE: temporary });
    }
    const env = { GIT_INDEX_FILE: temporary };
    for (const path of paths) {
      if (headFiles.has(path)) {
        await this.git(root, ["restore", "--staged", "--source=HEAD", "--", path], env);
      } else if (indexed.has(path)) {
        await this.git(root, ["rm", "--cached", "--force", "--", path], env);
      }
    }
    const [inspection] = await inspectGuardedPaths(backup, ["discard-index"]);
    if (inspection?.state !== "file") throw new Error("Git 暂存区更新未生成可验证的索引文件。");
    await this.guardedCopy(backup, "discard-index", dirname(indexPath), basename(indexPath));
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
      if (process.platform === "win32") await mkdir(join(backup, "files"), { recursive: true });
      if (process.platform === "win32") {
        manifest.indexExisted = await this.backupIndex(manifest.indexPath, join(backup, "index"));
      } else {
        manifest.indexExisted = await lstat(manifest.indexPath).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
            return false;
          },
        );
        if (manifest.indexExisted) await copyFile(manifest.indexPath, join(backup, "index"));
      }
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
        if (process.platform === "win32") {
          const [inspection] = await inspectGuardedPaths(root, [local]);
          if (!inspection) throw new Error("Git 文件路径检查失败。");
          manifest.files.push({ path, existed: inspection.state === "file" });
          if (inspection.state === "file") {
            const copied = await applyGuardedOperations({
              root: join(backup, "files"),
              sourceRoot: root,
              operations: [
                {
                  kind: "copy",
                  sourcePath: local,
                  targetPath: local,
                  createParents: true,
                },
              ],
            });
            bytes += copied.bytes;
            if (bytes > SNAPSHOT_MAX_BYTES) throw new Error("Git 恢复备份超过 1 GiB，未执行撤销。");
          }
        } else {
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
      }
      await writeFile(join(backup, "manifest.json"), JSON.stringify(manifest), "utf8");
      const indexed = new Set((await this.git(root, ["ls-files", "-z"])).split("\0"));
      const headFiles = new Set(
        manifest.head
          ? (await this.git(root, ["ls-tree", "-r", "--name-only", "-z", "HEAD"])).split("\0")
          : [],
      );
      if (process.platform === "win32") {
        const head = await this.stageHeadFiles(root, backup, paths, headFiles);
        await applyGuardedOperations({
          root,
          sourceRoot: head.root,
          operations: paths.map((path) => {
            const sourcePath = head.files.get(path);
            return sourcePath
              ? {
                  kind: "copy" as const,
                  sourcePath,
                  targetPath: path,
                  createParents: true,
                }
              : { kind: "delete" as const, path, allowMissing: true };
          }),
        });
        await this.updateDiscardedIndex(
          root,
          manifest.indexPath,
          backup,
          paths,
          indexed,
          headFiles,
          manifest.indexExisted === true,
        );
      } else {
        for (const path of paths) {
          if (headFiles.has(path)) {
            await this.git(root, [
              "restore",
              "--source=HEAD",
              "--staged",
              "--worktree",
              "--",
              path,
            ]);
          } else {
            if (indexed.has(path)) await this.git(root, ["rm", "--cached", "--force", "--", path]);
            await rm(resolve(root, path), { force: true });
          }
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
      if (process.platform === "win32") {
        const [inspection] = await inspectGuardedPaths(join(backup, "files"), [file.path]);
        if (file.existed && inspection?.state !== "file") throw new Error("Git 备份文件损坏。");
      } else if (
        file.existed &&
        !(await lstat(await safeFilePath(join(backup, "files"), file.path))).isFile()
      )
        throw new Error("Git 备份文件损坏。");
    }
    if (manifest.indexExisted !== false) {
      if (process.platform === "win32") {
        const [inspection] = await inspectGuardedPaths(backup, ["index"]);
        if (inspection?.state !== "file") throw new Error("Git 索引备份损坏。");
      } else {
        await lstat(join(backup, "index"));
      }
    }
    if (backupCurrent) {
      const safetyId = randomUUID();
      const safetyRoot = join(this.backupRoot, safetyId);
      const safety: UndoManifest = {
        root,
        indexPath,
        head,
        createdAt: new Date().toISOString(),
        files: [],
        indexExisted:
          process.platform === "win32"
            ? await this.indexExists(indexPath)
            : await lstat(indexPath).then(
                () => true,
                () => false,
              ),
      };
      await mkdir(safetyRoot, { recursive: true });
      let bytes = 0;
      try {
        if (safety.indexExisted) {
          if (process.platform === "win32") {
            if (!(await this.backupIndex(indexPath, join(safetyRoot, "index"))))
              throw new Error("恢复期间 Git 索引消失，未执行恢复。");
          } else {
            await copyFile(indexPath, join(safetyRoot, "index"));
          }
        }
        if (process.platform === "win32")
          await mkdir(join(safetyRoot, "files"), { recursive: true });
        for (const file of manifest.files) {
          if (process.platform === "win32") {
            const [inspection] = await inspectGuardedPaths(root, [file.path]);
            if (!inspection) throw new Error("恢复目标检查失败。");
            safety.files.push({ path: file.path, existed: inspection.state === "file" });
            if (inspection.state === "file") {
              const copied = await applyGuardedOperations({
                root: join(safetyRoot, "files"),
                sourceRoot: root,
                operations: [
                  {
                    kind: "copy",
                    sourcePath: file.path,
                    targetPath: file.path,
                    createParents: true,
                  },
                ],
              });
              bytes += copied.bytes;
              if (bytes > SNAPSHOT_MAX_BYTES) throw new Error("恢复前的安全备份超过 1 GiB。");
            }
          } else {
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
        }
        await writeFile(join(safetyRoot, "manifest.json"), JSON.stringify(safety), "utf8");
      } catch (error) {
        await rm(safetyRoot, { recursive: true, force: true });
        throw error;
      }
    }
    if (process.platform === "win32") {
      await applyGuardedOperations({
        root,
        sourceRoot: join(backup, "files"),
        operations: manifest.files.map((file) =>
          file.existed
            ? {
                kind: "copy" as const,
                sourcePath: file.path,
                targetPath: file.path,
                createParents: true,
              }
            : { kind: "delete" as const, path: file.path, allowMissing: true },
        ),
      });
    } else {
      for (const file of manifest.files) {
        const target = await safeFilePath(root, file.path);
        if (file.existed) {
          await mkdir(dirname(target), { recursive: true });
          await copyFile(join(backup, "files", file.path), target);
        } else await rm(target, { force: true });
      }
    }
    if (process.platform === "win32") {
      await this.restoreIndex(indexPath, join(backup, "index"), manifest.indexExisted !== false);
    } else if (manifest.indexExisted !== false) {
      await copyFile(join(backup, "index"), indexPath);
    } else {
      await rm(indexPath, { force: true });
    }
  }
}
