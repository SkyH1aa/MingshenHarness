import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
const MAX_FILES = 100_000;

interface SnapshotManifest {
  id: string;
  sessionId: string;
  runId: string;
  workspacePath: string;
  files: string[];
  fileCount: number;
  totalBytes: number;
  createdAt: string;
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
    const snapshotLocal = relative(workspacePath, resolve(this.snapshotRoot));
    if (!snapshotLocal || (!snapshotLocal.startsWith("..") && !isAbsolute(snapshotLocal)))
      throw new Error("快照存储目录不能位于工作区内部。");
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

  async list(sessionId: string): Promise<SnapshotView[]> {
    await mkdir(this.snapshotRoot, { recursive: true });
    const entries = await readdir(this.snapshotRoot, { withFileTypes: true });
    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readManifest(join(this.snapshotRoot, entry.name, "manifest.json"))),
    );
    return manifests
      .filter((manifest): manifest is SnapshotManifest => Boolean(manifest))
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
    for (const file of manifest.files) {
      await safeFilePath(workspacePath, file);
      if (!(await stat(await safeFilePath(join(root, "files"), file))).isFile())
        throw new Error("快照文件损坏。");
    }
    const safety = await this.create({
      sessionId: manifest.sessionId,
      runId: `redo:${manifest.runId}`,
      workspacePath,
    });

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
