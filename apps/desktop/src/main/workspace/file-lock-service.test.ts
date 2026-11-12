import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileLockService } from "./file-lock-service";

describe("cross-agent file leases", () => {
  it("keeps another process in the same run locked when one acquisition releases", async () => {
    const service = new FileLockService();
    const root = resolve(".tmp-shared-command");
    const signal = new AbortController().signal;
    const owner = { runId: "a", sessionId: "a", label: "A" };
    const first = await service.acquire([root], true, owner, signal, async () => false);
    const second = await service.acquire([root], true, owner, signal, async () => false);
    first();
    await expect(
      service.acquire([root], true, { ...owner, runId: "b" }, signal, async () => false),
    ).rejects.toThrow("Writer retained");
    second();
    await expect(
      service.acquire([root], true, { ...owner, runId: "b" }, signal, async () => false),
    ).resolves.toBeTypeOf("function");
  });
  it("atomically locks patch targets, preserves a chosen incumbent and transfers only after release", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-lock-"));
    const service = new FileLockService();
    const signal = new AbortController().signal;
    const owner = { runId: "a", sessionId: "a", label: "A" };
    const contender = { runId: "b", sessionId: "b", label: "B" };
    const choose = vi.fn(async () => false);
    try {
      await service.acquire([join(root, "x.ts"), join(root, "y.ts")], false, owner, signal, choose);
      await expect(
        service.acquire([join(root, "x.ts").toUpperCase()], false, contender, signal, choose),
      ).rejects.toThrow("conflict");
      expect(choose).toHaveBeenCalledOnce();
      await expect(
        service.acquire([root], true, contender, signal, async () => true),
      ).rejects.toThrow("still active");
      await service.acquire([join(root, "x.ts")], false, contender, signal, async () => {
        service.releaseRun("a");
        return true;
      });
      const denied = vi.fn(async () => false);
      await expect(
        service.acquire([join(root, "x.ts")], false, owner, signal, denied),
      ).rejects.toThrow("conflict");
      service.releaseRun("b");
      await service.acquire([join(root, "x.ts")], false, owner, signal, denied);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("releases temporary command directory leases, supports disjoint writers and aborts before locking", async () => {
    const service = new FileLockService();
    const signal = new AbortController().signal;
    const owner = { runId: "a", sessionId: "a", label: "A" };
    const release = await service.acquire(
      [resolve(".tmp-lock-fixture")],
      true,
      owner,
      signal,
      async () => false,
    );
    release();
    await service.acquire(
      [resolve(".tmp-lock-fixture/a.ts")],
      false,
      { ...owner, runId: "b" },
      signal,
      async () => false,
    );
    await service.acquire(
      [resolve(".tmp-lock-other/a.ts")],
      false,
      owner,
      signal,
      async () => false,
    );
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      service.acquire(
        [resolve(".tmp-lock-fixture")],
        true,
        owner,
        aborted.signal,
        async () => true,
      ),
    ).rejects.toThrow();
  });
});
