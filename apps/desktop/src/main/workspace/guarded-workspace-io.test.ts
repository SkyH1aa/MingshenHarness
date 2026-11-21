import { createHash } from "node:crypto";
import {
  access,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyGuardedOperations,
  inspectGuardedPaths,
  listGuardedDirectory,
  listGuardedWorkspaceFiles,
  readGuardedFile,
  statGuardedPath,
  stopGuardedWorkspaceIo,
  writeGuardedFile,
} from "./guarded-workspace-io";

const temporaryRoots: string[] = [];

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function expectNoWriteArtifacts(directory: string): Promise<void> {
  const entries = await readdir(directory);
  expect(entries.filter((entry) => entry.includes("cas-"))).toEqual([]);
}

afterEach(async () => {
  await stopGuardedWorkspaceIo();
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

describe("guarded workspace IO", () => {
  it.skipIf(process.platform !== "win32")(
    "pins file handles for copy, delete, inspection and reads",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-io-"));
      temporaryRoots.push(root);
      const source = join(root, "source");
      const target = join(root, "target");
      await mkdir(source);
      await mkdir(target);
      await writeFile(join(source, "incoming.txt"), "new content");
      await writeFile(join(target, "old.txt"), "old content");
      await writeFile(join(target, "existing.txt"), "before");

      await expect(inspectGuardedPaths(target, ["existing.txt", "missing.txt"])).resolves.toEqual([
        { path: "existing.txt", state: "file", size: 6 },
        { path: "missing.txt", state: "missing", size: 0 },
      ]);

      const result = await applyGuardedOperations({
        root: target,
        sourceRoot: source,
        operations: [
          {
            kind: "copy",
            sourcePath: "incoming.txt",
            targetPath: "nested/existing.txt",
            createParents: true,
          },
          { kind: "delete", path: "old.txt", allowMissing: true },
        ],
      });
      expect(result.copied).toBe(1);
      expect(result.deleted).toBe(1);
      expect(result.copies[0]?.sourceSha256).toBe(result.copies[0]?.targetSha256);
      await expect(readFile(join(target, "nested", "existing.txt"), "utf8")).resolves.toBe(
        "new content",
      );
      await expect(access(join(target, "old.txt"))).rejects.toThrow();
      await expect(readGuardedFile(target, "nested/existing.txt", 1024)).resolves.toMatchObject({
        size: 11,
        buffer: Buffer.from("new content"),
      });
      await expect(statGuardedPath(target, "nested/existing.txt")).resolves.toEqual({
        state: "file",
        directory: false,
        size: 11,
      });
      await expect(listGuardedDirectory(target, "nested")).resolves.toEqual([
        { name: "existing.txt", directory: false, reparse: false, size: 11 },
      ]);
      await expect(listGuardedWorkspaceFiles(target, { ignoredDirectories: [] })).resolves.toEqual({
        files: [
          { path: "existing.txt", size: 6 },
          { path: "nested\\existing.txt", size: 11 },
        ],
        totalBytes: 17,
      });
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "commits a hash-guarded replacement while the old target stays pinned",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-cas-"));
      temporaryRoots.push(root);
      const targetPath = join(root, "existing.txt");
      const before = "before";
      const after = Buffer.from("replacement content");
      await writeFile(targetPath, before);
      await inspectGuardedPaths(root, ["existing.txt"]);

      const pending = writeGuardedFile(root, "existing.txt", after, sha256(before), {
        holdMilliseconds: 2_000,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await expect(writeFile(targetPath, "external write")).rejects.toThrow();
      await expect(rm(targetPath)).rejects.toThrow();

      await expect(pending).resolves.toEqual({
        size: after.length,
        sha256: sha256(after),
      });
      await expect(readFile(targetPath, "utf8")).resolves.toBe(after.toString());
      await expectNoWriteArtifacts(root);
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "creates only a missing target and preserves a racing external creator",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-create-"));
      temporaryRoots.push(root);
      await expect(
        writeGuardedFile(root, "nested/new.txt", Buffer.from("new"), "missing", {
          createParents: true,
        }),
      ).resolves.toEqual({ size: 3, sha256: sha256("new") });
      await expect(readFile(join(root, "nested", "new.txt"), "utf8")).resolves.toBe("new");
      await expectNoWriteArtifacts(join(root, "nested"));

      const racing = writeGuardedFile(
        root,
        "racing.txt",
        Buffer.from("guarded content"),
        "missing",
        { holdMilliseconds: 1_000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await writeFile(join(root, "racing.txt"), "external content");
      await expect(racing).rejects.toThrow(/已存在|拒绝访问/);
      await expect(readFile(join(root, "racing.txt"), "utf8")).resolves.toBe("external content");
      await expectNoWriteArtifacts(root);
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "rejects stale hashes and leaves the old file intact after cancellation or timeout",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-cas-abort-"));
      temporaryRoots.push(root);
      const targetPath = join(root, "existing.txt");
      const before = "before";
      const expected = sha256(before);
      await writeFile(targetPath, before);

      await expect(
        writeGuardedFile(root, "existing.txt", Buffer.from("stale"), "0".repeat(64)),
      ).rejects.toThrow("期望哈希");
      await expect(readFile(targetPath, "utf8")).resolves.toBe(before);

      const controller = new AbortController();
      const aborted = writeGuardedFile(root, "existing.txt", Buffer.from("cancelled"), expected, {
        holdMilliseconds: 5_000,
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 250);
      await expect(aborted).rejects.toThrow("已取消");
      await expect(readFile(targetPath, "utf8")).resolves.toBe(before);
      await expectNoWriteArtifacts(root);

      await expect(
        writeGuardedFile(root, "existing.txt", Buffer.from("timed out"), expected, {
          holdMilliseconds: 5_000,
          timeoutMs: 300,
        }),
      ).rejects.toThrow("整体期限");
      await expect(readFile(targetPath, "utf8")).resolves.toBe(before);
      await expectNoWriteArtifacts(root);
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "restores the old target when the worker is killed between commit renames",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-recovery-"));
      temporaryRoots.push(root);
      const targetPath = join(root, "existing.txt");
      const before = "before";
      const expected = sha256(before);
      await writeFile(targetPath, before);
      const environmentKey = "MINGSHEN_GUARDED_WRITE_TEST_GAP_MS";
      const previous = process.env[environmentKey];
      process.env[environmentKey] = "5000";
      try {
        await inspectGuardedPaths(root, ["existing.txt"]);
        const controller = new AbortController();
        const pending = writeGuardedFile(
          root,
          "existing.txt",
          Buffer.from("replacement"),
          expected,
          { signal: controller.signal },
        );
        let targetMoved = false;
        for (let attempt = 0; attempt < 160; attempt++) {
          try {
            await access(targetPath);
          } catch {
            targetMoved = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(targetMoved).toBe(true);
        controller.abort();
        await expect(pending).rejects.toThrow("已取消");
        await expect(readFile(targetPath, "utf8")).resolves.toBe(before);
        await expectNoWriteArtifacts(root);
      } finally {
        if (previous === undefined) delete process.env[environmentKey];
        else process.env[environmentKey] = previous;
      }
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "restores the old target when the worker is killed after the new target rename",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-post-commit-"));
      temporaryRoots.push(root);
      const targetPath = join(root, "existing.txt");
      const before = "before";
      const replacement = "replacement";
      const expected = sha256(before);
      await writeFile(targetPath, before);
      const environmentKey = "MINGSHEN_GUARDED_WRITE_TEST_AFTER_COMMIT_GAP_MS";
      const previous = process.env[environmentKey];
      process.env[environmentKey] = "5000";
      try {
        await inspectGuardedPaths(root, ["existing.txt"]);
        const controller = new AbortController();
        const pending = writeGuardedFile(root, "existing.txt", Buffer.from(replacement), expected, {
          signal: controller.signal,
        });
        let targetCommitted = false;
        for (let attempt = 0; attempt < 160; attempt++) {
          try {
            if ((await readFile(targetPath, "utf8")) === replacement) {
              targetCommitted = true;
              break;
            }
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(targetCommitted).toBe(true);
        controller.abort();
        await expect(pending).rejects.toThrow("已取消");
        await expect(readFile(targetPath, "utf8")).resolves.toBe(before);
        await expectNoWriteArtifacts(root);
      } finally {
        if (previous === undefined) delete process.env[environmentKey];
        else process.env[environmentKey] = previous;
      }
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "fails closed with a recovery backup path when shutdown interrupts the commit gap",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-shutdown-gap-"));
      temporaryRoots.push(root);
      const targetPath = join(root, "existing.txt");
      const before = "before";
      const expected = sha256(before);
      await writeFile(targetPath, before);
      const environmentKey = "MINGSHEN_GUARDED_WRITE_TEST_GAP_MS";
      const previous = process.env[environmentKey];
      process.env[environmentKey] = "5000";
      try {
        await inspectGuardedPaths(root, ["existing.txt"]);
        const pending = writeGuardedFile(
          root,
          "existing.txt",
          Buffer.from("replacement"),
          expected,
        );
        const outcome = pending.then(
          () => null,
          (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
        );
        let targetMoved = false;
        for (let attempt = 0; attempt < 160; attempt++) {
          try {
            await access(targetPath);
          } catch {
            targetMoved = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(targetMoved).toBe(true);
        await stopGuardedWorkspaceIo();
        const error = await outcome;
        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toContain("RECOVERY_STATE: unavailable");
        const backup = error?.message.match(/RECOVERY_BACKUP: (.+)/)?.[1]?.trim();
        expect(backup).toBeTruthy();
        expect(backup).toMatch(/^\.mh-cas-.+\.bak$/);
        await expect(readFile(join(root, backup as string), "utf8")).resolves.toBe(before);
        await expect(access(targetPath)).rejects.toThrow();
      } finally {
        if (previous === undefined) delete process.env[environmentKey];
        else process.env[environmentKey] = previous;
      }
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "rejects hard-link writes and reparse-point traversal",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-write-links-"));
      temporaryRoots.push(root);
      const outsideFile = join(root, "outside.txt");
      const outsideDirectory = join(root, "outside");
      await writeFile(outsideFile, "outside sentinel");
      await mkdir(outsideDirectory);
      const outsideHash = sha256("outside sentinel");
      await link(outsideFile, join(root, "hard.txt"));
      await symlink(outsideDirectory, join(root, "link"), "junction");

      await expect(
        writeGuardedFile(root, "hard.txt", Buffer.from("replacement"), outsideHash),
      ).rejects.toThrow("硬链接");
      await expect(
        writeGuardedFile(root, "link/new.txt", Buffer.from("blocked"), "missing", {
          createParents: true,
        }),
      ).rejects.toThrow("符号链接或目录链接");
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside sentinel");
      await expect(access(join(outsideDirectory, "new.txt"))).rejects.toThrow();
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "rejects static junctions and keeps a pinned ancestor from being renamed",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-race-"));
      temporaryRoots.push(root);
      const source = join(root, "source");
      const target = join(root, "target");
      const outside = join(root, "outside");
      const safe = join(target, "safe");
      await mkdir(source);
      await mkdir(target);
      await mkdir(outside);
      await mkdir(safe);
      await writeFile(join(source, "incoming.txt"), "pinned content");
      await writeFile(join(safe, "existing.txt"), "before");
      await writeFile(join(outside, "secret.txt"), "outside sentinel");
      await symlink(outside, join(target, "link"), "junction");

      await expect(
        applyGuardedOperations({
          root: target,
          sourceRoot: source,
          operations: [
            {
              kind: "copy",
              sourcePath: "incoming.txt",
              targetPath: "link/secret.txt",
              createParents: true,
            },
          ],
        }),
      ).rejects.toThrow("符号链接或目录链接");
      await expect(readFile(join(outside, "secret.txt"), "utf8")).resolves.toBe("outside sentinel");

      const copy = applyGuardedOperations({
        root: target,
        sourceRoot: source,
        operations: [
          {
            kind: "copy",
            sourcePath: "incoming.txt",
            targetPath: "safe/existing.txt",
            holdMilliseconds: 1_000,
          },
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await expect(rename(safe, join(target, "safe-old"))).rejects.toThrow();
      await copy;
      await expect(readFile(join(safe, "existing.txt"), "utf8")).resolves.toBe("pinned content");
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "waits for the guarded process to exit before rejecting an aborted write",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-abort-"));
      temporaryRoots.push(root);
      const source = join(root, "source");
      const target = join(root, "target");
      await mkdir(source);
      await mkdir(target);
      await writeFile(join(source, "incoming.txt"), "new content");
      await writeFile(join(target, "existing.txt"), "before");
      await inspectGuardedPaths(target, ["existing.txt"]);

      const controller = new AbortController();
      const pending = applyGuardedOperations(
        {
          root: target,
          sourceRoot: source,
          operations: [
            {
              kind: "copy",
              sourcePath: "incoming.txt",
              targetPath: "existing.txt",
              holdMilliseconds: 5_000,
            },
          ],
        },
        { signal: controller.signal },
      );
      setTimeout(() => controller.abort(), 250);
      await expect(pending).rejects.toThrow("已取消");
      await expect(readFile(join(target, "existing.txt"), "utf8")).resolves.toBe("before");
      await expect(inspectGuardedPaths(target, ["existing.txt"])).resolves.toEqual([
        { path: "existing.txt", state: "file", size: 6 },
      ]);

      await expect(
        applyGuardedOperations(
          {
            root: target,
            sourceRoot: source,
            operations: [
              {
                kind: "copy",
                sourcePath: "incoming.txt",
                targetPath: "existing.txt",
                holdMilliseconds: 5_000,
              },
            ],
          },
          { timeoutMs: 300 },
        ),
      ).rejects.toThrow("整体期限");
      await expect(readFile(join(target, "existing.txt"), "utf8")).resolves.toBe("before");
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "rejects NTFS hard links before reading, listing or overwriting them",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-hardlink-"));
      temporaryRoots.push(root);
      const source = join(root, "source");
      const target = join(root, "target");
      const outside = join(root, "outside.txt");
      await mkdir(source);
      await mkdir(target);
      await writeFile(join(source, "incoming.txt"), "new content");
      await writeFile(outside, "outside sentinel");
      await link(outside, join(target, "hard.txt"));

      await expect(readGuardedFile(target, "hard.txt", 1024)).rejects.toThrow("硬链接");
      await expect(inspectGuardedPaths(target, ["hard.txt"])).rejects.toThrow("硬链接");
      await expect(listGuardedWorkspaceFiles(target, { ignoredDirectories: [] })).rejects.toThrow(
        "硬链接",
      );
      await expect(
        applyGuardedOperations({
          root: target,
          sourceRoot: source,
          operations: [
            {
              kind: "copy",
              sourcePath: "incoming.txt",
              targetPath: "hard.txt",
            },
          ],
        }),
      ).rejects.toThrow("硬链接");
      await expect(readFile(outside, "utf8")).resolves.toBe("outside sentinel");
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "clears an idle stop while a later request is active and can restart after idle exit",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-idle-"));
      temporaryRoots.push(root);
      const source = join(root, "source");
      const target = join(root, "target");
      await mkdir(source);
      await mkdir(target);
      await writeFile(join(source, "incoming.txt"), "new content");
      await writeFile(join(target, "existing.txt"), "before");

      await inspectGuardedPaths(target, ["existing.txt"], { idleTimeoutMs: 150 });
      await applyGuardedOperations(
        {
          root: target,
          sourceRoot: source,
          operations: [
            {
              kind: "copy",
              sourcePath: "incoming.txt",
              targetPath: "existing.txt",
              holdMilliseconds: 350,
            },
          ],
        },
        { idleTimeoutMs: 150 },
      );
      await expect(readFile(join(target, "existing.txt"), "utf8")).resolves.toBe("new content");

      await new Promise((resolve) => setTimeout(resolve, 250));
      await expect(
        inspectGuardedPaths(target, ["existing.txt"], { idleTimeoutMs: 500 }),
      ).resolves.toEqual([{ path: "existing.txt", state: "file", size: 11 }]);
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "rejects queued writes when stopped and can start a fresh worker afterward",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-guarded-stop-"));
      temporaryRoots.push(root);
      const source = join(root, "source");
      const target = join(root, "target");
      await mkdir(source);
      await mkdir(target);
      await writeFile(join(source, "incoming.txt"), "new content");
      await writeFile(join(target, "first.txt"), "first before");
      await writeFile(join(target, "second.txt"), "second before");
      await inspectGuardedPaths(target, ["first.txt", "second.txt"]);

      const first = applyGuardedOperations({
        root: target,
        sourceRoot: source,
        operations: [
          {
            kind: "copy",
            sourcePath: "incoming.txt",
            targetPath: "first.txt",
            holdMilliseconds: 5_000,
          },
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const second = applyGuardedOperations({
        root: target,
        sourceRoot: source,
        operations: [
          {
            kind: "copy",
            sourcePath: "incoming.txt",
            targetPath: "second.txt",
          },
        ],
      });
      const firstRejected = expect(first).rejects.toThrow();
      const secondRejected = expect(second).rejects.toThrow("受保护文件服务");
      const stopping = stopGuardedWorkspaceIo();

      await firstRejected;
      await secondRejected;
      await stopping;
      await expect(readFile(join(target, "first.txt"), "utf8")).resolves.toBe("first before");
      await expect(readFile(join(target, "second.txt"), "utf8")).resolves.toBe("second before");
      await expect(inspectGuardedPaths(target, ["first.txt", "second.txt"])).resolves.toEqual([
        { path: "first.txt", state: "file", size: 12 },
        { path: "second.txt", state: "file", size: 13 },
      ]);
    },
    20_000,
  );
});
