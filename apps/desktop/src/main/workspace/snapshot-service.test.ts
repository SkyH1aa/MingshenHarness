import { access, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SNAPSHOT_MAX_BYTES, SnapshotService } from "./snapshot-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("SnapshotService", () => {
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
