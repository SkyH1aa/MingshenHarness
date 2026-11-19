import { access, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PARTIAL_CHECKPOINTS_PER_RUN,
  PARTIAL_CHECKPOINT_MAX_BYTES,
  PARTIAL_CHECKPOINT_MAX_BYTES_PER_RUN,
  PARTIAL_CHECKPOINT_MAX_FILE_BYTES,
  SNAPSHOT_MAX_BYTES,
  SnapshotService,
} from "./snapshot-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("SnapshotService", () => {
  it("restores only the paths captured by a partial file checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-partial-snapshot-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    const snapshotRoot = join(root, "snapshots");
    const outside = join(root, "outside.txt");
    await mkdir(workspace);
    const existing = join(workspace, "existing.txt");
    const missing = join(workspace, "missing.txt");
    const unrelated = join(workspace, "unrelated.txt");
    const unrelatedNew = join(workspace, "unrelated-new.txt");
    await writeFile(existing, "checkpoint", "utf8");
    await writeFile(unrelated, "unrelated checkpoint", "utf8");
    await writeFile(outside, "outside checkpoint", "utf8");

    const service = new SnapshotService(snapshotRoot);
    const checkpoint = await service.createFileCheckpoint({
      sessionId: "session",
      runId: "run",
      workspacePath: workspace,
      paths: [existing, missing],
    });
    const manifestPath = join(snapshotRoot, checkpoint.id, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.kind).toBe("partial");
    expect(manifest.files).toEqual(["existing.txt"]);
    expect(manifest.missingPaths).toEqual(["missing.txt"]);
    expect(manifest.fileCount).toBe(1);

    await writeFile(existing, "changed", "utf8");
    await writeFile(missing, "created after checkpoint", "utf8");
    await writeFile(unrelated, "unrelated changed", "utf8");
    await writeFile(unrelatedNew, "created after checkpoint", "utf8");
    await writeFile(outside, "outside changed", "utf8");
    const result = await service.restore(checkpoint.id, workspace);

    expect(result).toEqual({ restored: 1, removed: 1, safetySnapshotId: expect.any(String) });
    await expect(readFile(existing, "utf8")).resolves.toBe("checkpoint");
    await expect(access(missing)).rejects.toThrow();
    await expect(readFile(unrelated, "utf8")).resolves.toBe("unrelated changed");
    await expect(readFile(unrelatedNew, "utf8")).resolves.toBe("created after checkpoint");
    await expect(readFile(outside, "utf8")).resolves.toBe("outside changed");

    const safetyManifestPath = join(snapshotRoot, result.safetySnapshotId, "manifest.json");
    const safetyManifest = JSON.parse(await readFile(safetyManifestPath, "utf8"));
    expect(safetyManifest.kind).toBe("partial");
    expect(safetyManifest.files).toEqual(["existing.txt", "missing.txt"]);
    expect(safetyManifest.missingPaths).toEqual([]);
  });

  it("caps partial checkpoints per run", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-partial-limit-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const file = join(workspace, "file.txt");
    await writeFile(file, "value", "utf8");
    const service = new SnapshotService(join(root, "snapshots"));

    for (let index = 0; index < MAX_PARTIAL_CHECKPOINTS_PER_RUN; index += 1) {
      await service.createFileCheckpoint({
        sessionId: "session",
        runId: "bounded",
        workspacePath: workspace,
        paths: [file],
      });
    }
    await expect(
      service.createFileCheckpoint({
        sessionId: "session",
        runId: "bounded",
        workspacePath: workspace,
        paths: [file],
      }),
    ).rejects.toThrow(
      `SNAPSHOT_CHECKPOINT_LIMIT: 同一运行最多创建 ${MAX_PARTIAL_CHECKPOINTS_PER_RUN} 个文件检查点`,
    );
    await expect(
      service.createFileCheckpoint({
        sessionId: "session",
        runId: "next-run",
        workspacePath: workspace,
        paths: [file],
      }),
    ).resolves.toBeTruthy();
  }, 30_000);

  it("enforces the per-file and per-checkpoint partial snapshot limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-partial-size-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const createSizedFile = async (name: string, size: number) => {
      const path = join(workspace, name);
      const file = await open(path, "w");
      try {
        await file.truncate(size);
      } finally {
        await file.close();
      }
      return path;
    };

    const paths = [];
    for (let index = 0; index < 5; index += 1) {
      paths.push(await createSizedFile(`max-${index}.bin`, PARTIAL_CHECKPOINT_MAX_FILE_BYTES));
    }
    paths.push(await createSizedFile("remaining.bin", 3 * 1024 * 1024));
    const service = new SnapshotService(join(root, "snapshots"));
    await expect(
      service.createFileCheckpoint({
        sessionId: "session",
        runId: "at-limit",
        workspacePath: workspace,
        paths: paths.slice(0, 4),
      }),
    ).resolves.toBeTruthy();
    await expect(
      service.createFileCheckpoint({
        sessionId: "session",
        runId: "at-limit",
        workspacePath: workspace,
        paths: paths.slice(4),
      }),
    ).resolves.toBeTruthy();

    const oneByteOver = await createSizedFile("one-byte-over.bin", 1);
    await expect(
      service.createFileCheckpoint({
        sessionId: "session",
        runId: "at-limit",
        workspacePath: workspace,
        paths: [oneByteOver],
      }),
    ).rejects.toThrow("SNAPSHOT_CHECKPOINT_LIMIT");
    await expect(
      service.createFileCheckpoint({
        sessionId: "session",
        runId: "over-total",
        workspacePath: workspace,
        paths: [...paths, oneByteOver],
      }),
    ).rejects.toThrow("128 MiB");

    const oversizedFile = await createSizedFile(
      "oversized.bin",
      PARTIAL_CHECKPOINT_MAX_FILE_BYTES + 1,
    );
    await expect(
      service.createFileCheckpoint({
        sessionId: "session",
        runId: "over-file",
        workspacePath: workspace,
        paths: [oversizedFile],
      }),
    ).rejects.toThrow("25 MiB");
    expect(PARTIAL_CHECKPOINT_MAX_BYTES).toBe(128 * 1024 * 1024);
    expect(PARTIAL_CHECKPOINT_MAX_BYTES_PER_RUN).toBe(128 * 1024 * 1024);
  }, 60_000);

  it("rejects partial checkpoint paths outside the workspace, directories and overlaps", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-partial-paths-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const file = join(workspace, "file.txt");
    const directory = join(workspace, "directory");
    const outside = join(root, "outside.txt");
    await writeFile(file, "keep", "utf8");
    await mkdir(directory);
    await writeFile(outside, "outside", "utf8");
    const service = new SnapshotService(join(root, "snapshots"));

    await expect(
      service.createFileCheckpoint({
        sessionId: "session",
        runId: "outside",
        workspacePath: workspace,
        paths: [outside],
      }),
    ).rejects.toThrow();
    await expect(
      service.createFileCheckpoint({
        sessionId: "session",
        runId: "directory",
        workspacePath: workspace,
        paths: [directory],
      }),
    ).rejects.toThrow("普通文件");
    await expect(
      service.createFileCheckpoint({
        sessionId: "session",
        runId: "overlap",
        workspacePath: workspace,
        paths: [file, join(file, "child.txt")],
      }),
    ).rejects.toThrow("重叠");
  });

  it("rejects malicious partial manifests before changing scoped or unrelated files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-partial-manifest-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    const snapshotRoot = join(root, "snapshots");
    await mkdir(workspace);
    const scoped = join(workspace, "scoped.txt");
    const outside = join(root, "outside.txt");
    await writeFile(scoped, "scoped", "utf8");
    await writeFile(outside, "outside", "utf8");
    const service = new SnapshotService(snapshotRoot);
    const checkpoint = await service.createFileCheckpoint({
      sessionId: "session",
      runId: "run",
      workspacePath: workspace,
      paths: [scoped],
    });
    const manifestPath = join(snapshotRoot, checkpoint.id, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.missingPaths = ["../outside.txt"];
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    await expect(service.restore(checkpoint.id, workspace)).rejects.toThrow();
    await expect(readFile(scoped, "utf8")).resolves.toBe("scoped");
    await expect(readFile(outside, "utf8")).resolves.toBe("outside");
  });

  it("removes only a deleted conversation's snapshots and preserves project files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-snapshot-cleanup-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, "keep.txt"), "keep");
    const service = new SnapshotService(join(root, "snapshots"));
    await service.create({ sessionId: "deleted", runId: "one", workspacePath: workspace });
    await service.create({ sessionId: "deleted", runId: "two", workspacePath: workspace });
    const retained = await service.create({
      sessionId: "retained",
      runId: "three",
      workspacePath: workspace,
    });
    await service.removeForSession("deleted");
    expect(await service.list("deleted")).toEqual([]);
    expect(await service.list("retained")).toEqual([retained]);
    expect(await readFile(join(workspace, "keep.txt"), "utf8")).toBe("keep");
  });
  it("accepts files above the old 256 MiB limit and rejects above 1 GiB", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-large-snapshot-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const file = await open(join(workspace, "large.bin"), "w");
    try {
      await file.truncate(257 * 1024 * 1024);
    } finally {
      await file.close();
    }
    const service = new SnapshotService(join(root, "snapshots"));
    const snapshot = await service.create({
      sessionId: "large",
      runId: "test",
      workspacePath: workspace,
    });
    expect((await stat(join(root, "snapshots", snapshot.id, "files", "large.bin"))).size).toBe(
      257 * 1024 * 1024,
    );
    const growing = await open(join(workspace, "large.bin"), "r+");
    try {
      await growing.truncate(SNAPSHOT_MAX_BYTES + 1);
    } finally {
      await growing.close();
    }
    await expect(
      service.create({ sessionId: "large", runId: "oversized", workspacePath: workspace }),
    ).rejects.toThrow("1 GiB");
  }, 30_000);

  it("rejects malicious manifests and nested snapshot storage before modifying files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-snapshot-paths-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, "keep.txt"), "keep");
    const service = new SnapshotService(join(root, "snapshots"));
    const snapshot = await service.create({ sessionId: "s", runId: "r", workspacePath: workspace });
    const manifestPath = join(root, "snapshots", snapshot.id, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files = ["../outside.txt"];
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(service.restore(snapshot.id, workspace)).rejects.toThrow();
    expect(await readFile(join(workspace, "keep.txt"), "utf8")).toBe("keep");
    await expect(
      new SnapshotService(join(workspace, "snapshots")).create({
        sessionId: "s",
        runId: "r",
        workspacePath: workspace,
      }),
    ).rejects.toThrow("内部");
    await expect(service.remove(".")).rejects.toThrow();
  });
  it("creates and restores an exact workspace snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-snapshot-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    const snapshotRoot = join(root, "snapshots");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "index.ts"), "export const value = 1;\n", "utf8");

    const service = new SnapshotService(snapshotRoot);
    const snapshot = await service.create({
      sessionId: "session",
      runId: "run",
      workspacePath: workspace,
    });

    await writeFile(join(workspace, "index.ts"), "export const value = 2;\n", "utf8");
    await writeFile(join(workspace, "created.ts"), "temporary\n", "utf8");
    const result = await service.restore(snapshot.id, workspace);

    expect(result.restored).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.safetySnapshotId).toBeTruthy();
    await expect(readFile(join(workspace, "index.ts"), "utf8")).resolves.toBe(
      "export const value = 1;\n",
    );
    await expect(access(join(workspace, "created.ts"))).rejects.toThrow();
  });
});
