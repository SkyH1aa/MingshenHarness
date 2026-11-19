import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { SnapshotRestoreResult, SnapshotView } from "../../shared/domain";
import { safeFilePath } from "./safe-file-path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "release",
  ".next",
  ".turbo",
  ".cache",
]);
export const SNAPSHOT_MAX_BYTES = 1024 * 1024 * 1024;
export const PARTIAL_CHECKPOINT_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PARTIAL_CHECKPOINT_MAX_BYTES = 128 * 1024 * 1024;
export const PARTIAL_CHECKPOINT_MAX_BYTES_PER_RUN = 128 * 1024 * 1024;
export const MAX_PARTIAL_CHECKPOINTS_PER_RUN = 128;
const MAX_FILES = 100_000;

interface SnapshotManifestBase {
  id: string;
  sessionId: string;
  runId: string;
  workspacePath: string;
  files: string[];
  fileCount: number;
  totalBytes: number;
  createdAt: string;
}

interface FullSnapshotManifest extends SnapshotManifestBase {
  kind?: "full";
}

interface PartialSnapshotManifest extends SnapshotManifestBase {
  kind: "partial";
  missingPaths: string[];
}

type SnapshotManifest = FullSnapshotManifest | PartialSnapshotManifest;

interface CheckpointPath {
  absolutePath: string;
  relativePath: string;
  key: string;
}

function pathKey(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertNoOverlappingPaths(paths: CheckpointPath[], label: string): void {
  const keys = new Set<string>();
  for (const path of paths) {
    if (keys.has(path.key)) {
      throw new Error(`${label}包含重复或相互重叠的路径：${path.relativePath}`);
    }
    keys.add(path.key);
  }
  for (const path of paths) {
    let separator = path.key.lastIndexOf("/");
    while (separator > 0) {
      const ancestor = path.key.slice(0, separator);
      if (keys.has(ancestor)) {
        throw new Error(`${label}包含重复或相互重叠的路径：${path.relativePath}`);
      }
      separator = ancestor.lastIndexOf("/");
    }
  }
}

function assertSnapshotStorageOutsideWorkspace(workspacePath: string, snapshotRoot: string): void {
  const snapshotLocal = relative(workspacePath, snapshotRoot);
  if (!snapshotLocal || (!snapshotLocal.startsWith("..") && !isAbsolute(snapshotLocal))) {
    throw new Error("快照存储目录不能位于工作区内部。");
  }
}

async function resolveCheckpointPaths(
  workspacePath: string,
  paths: string[],
): Promise<CheckpointPath[]> {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("文件检查点至少需要一个目标路径。");
  }
  if (paths.length > MAX_FILES) {
    throw new Error(`单个文件检查点不能超过 ${MAX_FILES} 个目标路径。`);
  }

  const scopedPaths: CheckpointPath[] = [];
  for (const inputPath of paths) {
    if (typeof inputPath !== "string" || !isAbsolute(inputPath)) {
      throw new Error("文件检查点目标必须是工作区内的绝对路径。");
    }
    const localPath = relative(workspacePath, resolve(inputPath));
    const absolutePath = await safeFilePath(workspacePath, localPath);
    const relativePath = relative(workspacePath, absolutePath);
    scopedPaths.push({
      absolutePath,
      relativePath,
      key: pathKey(relativePath),
    });
  }
  assertNoOverlappingPaths(scopedPaths, "文件检查点");
  return scopedPaths;
}

async function validateManifestPaths(
  workspacePath: string,
  paths: string[],
  label: string,
): Promise<CheckpointPath[]> {
  if (!Array.isArray(paths)) throw new Error(`${label}清单损坏。`);
  const scopedPaths: CheckpointPath[] = [];
  for (const path of paths) {
    if (typeof path !== "string" || !path || isAbsolute(path)) {
      throw new Error(`${label}包含无效的相对路径。`);
    }
    const absolutePath = await safeFilePath(workspacePath, path);
    const relativePath = relative(workspacePath, absolutePath);
    scopedPaths.push({
      absolutePath,
      relativePath,
      key: pathKey(relativePath),
    });
  }
  assertNoOverlappingPaths(scopedPaths, label);
  return scopedPaths;
}

async function collectFiles(
  root: string,
  current = root,
  result: string[] = [],
  budget = { bytes: 0 },
): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, fullPath, result, budget);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const metadata = await stat(fullPath);
    budget.bytes += metadata.size;
    if (budget.bytes > SNAPSHOT_MAX_BYTES) {
      throw new Error("工作区可快照文件超过 1 GiB，无法创建完整文件快照。");
    }
    result.push(relative(root, fullPath));
    if (result.length > MAX_FILES) {
      throw new Error(`工作区文件超过 ${MAX_FILES} 个，无法创建完整文件快照。`);
    }
  }
  return result;
}

async function readManifest(path: string): Promise<SnapshotManifest | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SnapshotManifest;
  } catch {
    return null;
  }
}

export class SnapshotService {
  private partialCreateTail: Promise<void> = Promise.resolve();

  constructor(private readonly snapshotRoot: string) {}

  async removeForSession(sessionId: string): Promise<void> {
    for (const snapshot of await this.list(sessionId)) await this.remove(snapshot.id);
  }

  async create(input: {
    sessionId: string;
    runId: string;
    workspacePath: string;
  }): Promise<SnapshotView> {
    const id = randomUUID();
    const root = join(this.snapshotRoot, id);
    const filesRoot = join(root, "files");
    const workspacePath = resolve(input.workspacePath);
    assertSnapshotStorageOutsideWorkspace(workspacePath, resolve(this.snapshotRoot));
    const files = await collectFiles(workspacePath);
    await mkdir(filesRoot, { recursive: true });

    let totalBytes = 0;
    try {
      for (const file of files) {
        const source = await safeFilePath(workspacePath, file);
        const target = join(filesRoot, file);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
        totalBytes += (await stat(source)).size;
        if (totalBytes > SNAPSHOT_MAX_BYTES) throw new Error("快照期间文件增长超过 1 GiB。");
      }

      const manifest: SnapshotManifest = {
        id,
        sessionId: input.sessionId,
        runId: input.runId,
        workspacePath,
        files,
        fileCount: files.length,
        totalBytes,
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(root, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
      return this.toView(manifest);
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  async createFileCheckpoint(input: {
    sessionId: string;
    runId: string;
    workspacePath: string;
    paths: string[];
  }): Promise<SnapshotView> {
    const previous = this.partialCreateTail;
    let release!: () => void;
    this.partialCreateTail = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await this.createFileCheckpointLocked(input);
    } finally {
      release();
    }
  }

  private async createFileCheckpointLocked(input: {
    sessionId: string;
    runId: string;
    workspacePath: string;
    paths: string[];
  }): Promise<SnapshotView> {
    const workspacePath = resolve(input.workspacePath);
    assertSnapshotStorageOutsideWorkspace(workspacePath, resolve(this.snapshotRoot));
    const scopedPaths = await resolveCheckpointPaths(workspacePath, input.paths);

    const files: string[] = [];
    const missingPaths: string[] = [];
    let totalBytes = 0;
    for (const scopedPath of scopedPaths) {
      let metadata: Awaited<ReturnType<typeof lstat>>;
      try {
        metadata = await lstat(scopedPath.absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          missingPaths.push(scopedPath.relativePath);
          continue;
        }
        throw error;
      }
      if (metadata.isSymbolicLink()) {
        throw new Error("文件检查点目标不能是符号链接。");
      }
      if (!metadata.isFile()) {
        throw new Error(`文件检查点目标必须是普通文件：${scopedPath.relativePath}`);
      }
      if (metadata.size > PARTIAL_CHECKPOINT_MAX_FILE_BYTES) {
        throw new Error("单个文件超过 25 MiB，无法创建文件检查点。");
      }
      totalBytes += metadata.size;
      if (totalBytes > PARTIAL_CHECKPOINT_MAX_BYTES) {
        throw new Error("文件检查点超过 128 MiB，未创建检查点。");
      }
      files.push(scopedPath.relativePath);
    }

    const runCheckpoints = (await this.readAllManifests()).filter(
      (manifest) => manifest.kind === "partial" && manifest.runId === input.runId,
    );
    if (runCheckpoints.length >= MAX_PARTIAL_CHECKPOINTS_PER_RUN) {
      throw new Error(
        `SNAPSHOT_CHECKPOINT_LIMIT: 同一运行最多创建 ${MAX_PARTIAL_CHECKPOINTS_PER_RUN} 个文件检查点，请结束当前轮次后继续。`,
      );
    }
    const checkpointBytes = runCheckpoints.reduce(
      (total, manifest) =>
        total +
        (Number.isFinite(manifest.totalBytes) && manifest.totalBytes > 0 ? manifest.totalBytes : 0),
      0,
    );
    if (checkpointBytes + totalBytes > PARTIAL_CHECKPOINT_MAX_BYTES_PER_RUN) {
      throw new Error(
        "SNAPSHOT_CHECKPOINT_LIMIT: 本轮局部文件检查点累计超过 128 MiB，未创建新的检查点。",
      );
    }

    const id = randomUUID();
    const root = join(this.snapshotRoot, id);
    const filesRoot = join(root, "files");
    try {
      await mkdir(filesRoot, { recursive: true });
      let copiedBytes = 0;
      for (const file of files) {
        const source = await safeFilePath(workspacePath, file);
        const target = join(filesRoot, file);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
        const copiedSize = (await stat(target)).size;
        if (copiedSize > PARTIAL_CHECKPOINT_MAX_FILE_BYTES) {
          throw new Error("检查点创建期间单个文件增长超过 25 MiB。");
        }
        copiedBytes += copiedSize;
        if (copiedBytes > PARTIAL_CHECKPOINT_MAX_BYTES) {
          throw new Error("检查点创建期间文件总量增长超过 128 MiB。");
        }
        if (checkpointBytes + copiedBytes > PARTIAL_CHECKPOINT_MAX_BYTES_PER_RUN) {
          throw new Error(
            "SNAPSHOT_CHECKPOINT_LIMIT: 检查点创建期间本轮累计超过 128 MiB，未保留检查点。",
          );
        }
      }

      for (const missingPath of missingPaths) {
        try {
          await lstat(await safeFilePath(workspacePath, missingPath));
          throw new Error(`检查点目标在创建期间出现：${missingPath}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }

      const manifest: PartialSnapshotManifest = {
        id,
        sessionId: input.sessionId,
        runId: input.runId,
        workspacePath,
        kind: "partial",
        files,
        missingPaths,
        fileCount: files.length,
        totalBytes: copiedBytes,
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(root, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
      return this.toView(manifest);
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  async list(sessionId: string): Promise<SnapshotView[]> {
    return (await this.readAllManifests())
      .filter((manifest) => manifest.sessionId === sessionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((manifest) => this.toView(manifest));
  }

  async restore(snapshotId: string, workspacePath: string): Promise<SnapshotRestoreResult> {
    const root = resolve(this.snapshotRoot, snapshotId);
    const relativeRoot = relative(resolve(this.snapshotRoot), root);
    if (!relativeRoot || relativeRoot.startsWith("..") || isAbsolute(relativeRoot)) {
      throw new Error("快照路径无效。");
    }
    const manifest = await readManifest(join(root, "manifest.json"));
    if (!manifest) {
      throw new Error("快照不存在或已损坏。");
    }
    if (resolve(manifest.workspacePath).toLowerCase() !== resolve(workspacePath).toLowerCase()) {
      throw new Error("快照与当前工作目录不匹配。");
    }
    if (manifest.kind !== undefined && manifest.kind !== "full" && manifest.kind !== "partial") {
      throw new Error("快照类型无效。");
    }
    if (!Array.isArray(manifest.files)) {
      throw new Error("快照文件清单损坏。");
    }
    const isPartial = manifest.kind === "partial";
    const validatedFiles = await validateManifestPaths(workspacePath, manifest.files, "快照文件");
    let validatedMissingPaths: CheckpointPath[] = [];
    if (isPartial) {
      if (!Array.isArray(manifest.missingPaths)) {
        throw new Error("部分文件检查点清单损坏。");
      }
      validatedMissingPaths = await validateManifestPaths(
        workspacePath,
        manifest.missingPaths,
        "检查点缺失文件",
      );
      const combined = [...validatedFiles, ...validatedMissingPaths];
      if (combined.length === 0) throw new Error("部分文件检查点不包含目标路径。");
      assertNoOverlappingPaths(combined, "部分文件检查点");
      await this.assertRestoreTargetsAreFilesOrMissing(workspacePath, [
        ...manifest.files,
        ...manifest.missingPaths,
      ]);
    }

    for (const file of validatedFiles) {
      if (!(await stat(await safeFilePath(join(root, "files"), file.relativePath))).isFile())
        throw new Error("快照文件损坏。");
    }

    let safety: SnapshotView;
    if (isPartial) {
      await this.assertRestoreTargetsAreFilesOrMissing(workspacePath, [
        ...manifest.files,
        ...manifest.missingPaths,
      ]);
      safety = await this.createFileCheckpoint({
        sessionId: manifest.sessionId,
        runId: `redo:${manifest.runId}:${manifest.id}:${randomUUID()}`,
        workspacePath,
        paths: [...validatedFiles, ...validatedMissingPaths].map((path) => path.absolutePath),
      });
    } else {
      safety = await this.create({
        sessionId: manifest.sessionId,
        runId: `redo:${manifest.runId}`,
        workspacePath,
      });
    }

    if (isPartial) {
      let removed = 0;
      let restored = 0;
      await this.assertRestoreTargetsAreFilesOrMissing(workspacePath, [
        ...manifest.files,
        ...manifest.missingPaths,
      ]);
      for (const missingPath of manifest.missingPaths) {
        const target = await safeFilePath(workspacePath, missingPath);
        try {
          if (!(await lstat(target)).isFile()) throw new Error("部分文件检查点恢复目标不是文件。");
          await rm(target);
          removed += 1;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      for (const file of manifest.files) {
        const source = await safeFilePath(join(root, "files"), file);
        const target = await safeFilePath(workspacePath, file);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
        restored += 1;
      }
      return { restored, removed, safetySnapshotId: safety.id };
    }

    const expected = new Set(manifest.files.map((file) => file.replaceAll("\\", "/")));
    const currentFiles = await collectFiles(resolve(workspacePath));
    let removed = 0;
    for (const currentFile of currentFiles) {
      const normalized = currentFile.replaceAll("\\", "/");
      if (!expected.has(normalized)) {
        await rm(join(workspacePath, currentFile), { force: true });
        removed += 1;
      }
    }

    let restored = 0;
    for (const file of manifest.files) {
      const source = join(root, "files", file);
      const target = await safeFilePath(workspacePath, file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      restored += 1;
    }
    return { restored, removed, safetySnapshotId: safety.id };
  }

  private async assertRestoreTargetsAreFilesOrMissing(
    workspacePath: string,
    paths: string[],
  ): Promise<void> {
    for (const path of paths) {
      const target = await safeFilePath(workspacePath, path);
      try {
        if (!(await lstat(target)).isFile()) {
          throw new Error(`文件检查点恢复目标不是普通文件：${path}`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async readAllManifests(): Promise<SnapshotManifest[]> {
    await mkdir(this.snapshotRoot, { recursive: true });
    const entries = await readdir(this.snapshotRoot, { withFileTypes: true });
    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readManifest(join(this.snapshotRoot, entry.name, "manifest.json"))),
    );
    return manifests.filter((manifest): manifest is SnapshotManifest => Boolean(manifest));
  }

  async remove(snapshotId: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(snapshotId)) throw new Error("快照 ID 无效。");
    const target = resolve(this.snapshotRoot, snapshotId);
    const root = resolve(this.snapshotRoot);
    if (!basename(target) || relative(root, target).startsWith("..")) {
      return;
    }
    await rm(target, { recursive: true, force: true });
  }

  private toView(manifest: SnapshotManifest): SnapshotView {
    return {
      id: manifest.id,
      sessionId: manifest.sessionId,
      runId: manifest.runId,
      workspacePath: manifest.workspacePath,
      fileCount: manifest.fileCount,
      createdAt: manifest.createdAt,
    };
  }
}
