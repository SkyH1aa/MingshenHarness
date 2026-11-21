import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { explicitPreferences, isMemoryPath, ProjectMemoryService } from "./project-memory-service";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mingshen-memory-"));
  roots.push(root);
  return { root, memory: new ProjectMemoryService() };
}

async function blockNextWrite(memory: ProjectMemoryService) {
  const internal = memory as unknown as {
    write: (root: string, file: string, text: string, expected?: string) => Promise<void>;
  };
  const original = internal.write.bind(memory);
  let release: () => void = () => undefined;
  let started: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    started = resolve;
  });
  let first = true;
  vi.spyOn(internal, "write").mockImplementation(async (...args) => {
    if (first) {
      first = false;
      started();
      await gate;
    }
    await original(...args);
  });
  return { blocked, release };
}

describe("project memory service", () => {
  it("creates the bounded memory layout and deduplicates equivalent entries", async () => {
    const { root, memory } = await fixture();
    await memory.ensure(root);
    const first = await memory.add(
      root,
      "preferences",
      "以后都使用 TypeScript，并保留严格类型检查。",
      "user",
    );
    const second = await memory.add(
      root,
      "preferences",
      "以后都使用 TypeScript，并保留严格类型检查。",
      "user",
    );
    expect(second).toBe(first);
    const view = await memory.view(root, true);
    expect(view.enabled).toBe(true);
    expect(view.documents.preferences).toContain(first);
    expect(view.documents.index).toContain("preferences.md");
    expect(view.preferences).toBe(1);
    expect(await readFile(join(root, ".harness-memory", "memory.md"), "utf8")).toContain(
      "# Project diary",
    );
  });

  it("rejects stale edits instead of overwriting a newer disk revision", async () => {
    const { root, memory } = await fixture();
    await memory.ensure(root);
    const before = await memory.view(root, true);
    await memory.add(root, "memory", "本轮任务完成后需要运行单元测试并记录结果。", "decision");
    await expect(
      memory.edit(root, "memory", "# Project diary\n\n用户手动修改\n", before.revisions.memory),
    ).rejects.toThrow("changed on disk");
  });

  it("searches diary entries and validates destructive queries", async () => {
    const { root, memory } = await fixture();
    await memory.add(
      root,
      "memory",
      "支付模块使用本地缓存，网络异常时需要保留重试提示。",
      "lesson",
    );
    const matches = await memory.search(root, "支付 网络");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source).toContain(".harness-memory/memory.md");
    await expect(memory.forget(root, "!!!")).rejects.toThrow("at least two characters");
  });

  it("serializes concurrent appends and refreshes the derived index after a manual edit", async () => {
    const { root, memory } = await fixture();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        memory.add(root, "memory", `Payment-module decision ${i}: keep a separate receipt.`),
      ),
    );
    expect((await memory.view(root, true)).memories).toBe(12);
    await writeFile(
      join(root, ".harness-memory", "preferences.md"),
      "# Preferences\n\nManual payment rule\n",
    );
    const view = await memory.view(root, true);
    expect(view.documents.index).toContain("manual-preferences");
    expect(view.documents.index).toContain("payment");
  });

  it.each(["disabled", "backend changed"] as const)(
    "does not commit a queued append after the target becomes %s",
    async (change) => {
      const { root, memory } = await fixture();
      const writer = await blockNextWrite(memory);
      const first = memory.add(root, "memory", "Queue blocker decision.");
      await writer.blocked;
      let state = "enabled";
      let checks = 0;
      const second = memory.add(
        root,
        "memory",
        "Queued memory must not be committed after the target changes.",
        "decision",
        undefined,
        () => {
          checks++;
          return state === "enabled";
        },
      );
      state = change === "disabled" ? "disabled" : "tencentdb";
      writer.release();

      await expect(second).resolves.toBeNull();
      await first;
      expect(checks).toBeGreaterThanOrEqual(2);
      expect((await memory.view(root, true)).documents.memory).not.toContain(
        "Queued memory must not be committed",
      );
    },
  );

  it.each(["timeout", "cancellation"] as const)(
    "does not commit a queued append after %s",
    async (stop) => {
      const { root, memory } = await fixture();
      const writer = await blockNextWrite(memory);
      const first = memory.add(root, "memory", "Queue blocker decision.");
      await writer.blocked;
      const controller = new AbortController();
      const signal =
        stop === "timeout"
          ? AbortSignal.any([controller.signal, AbortSignal.timeout(30)])
          : controller.signal;
      const second = memory.add(
        root,
        "memory",
        "Queued memory must not be committed after the deadline.",
        "decision",
        signal,
      );
      try {
        if (stop === "timeout") await delay(60);
        else controller.abort();
      } finally {
        writer.release();
      }

      await expect(second).rejects.toMatchObject({
        name: stop === "timeout" ? "TimeoutError" : "AbortError",
      });
      await first;
      expect((await memory.view(root, true)).documents.memory).not.toContain(
        "Queued memory must not be committed after the deadline.",
      );
    },
  );

  it("rechecks commit eligibility immediately before atomic replacement", async () => {
    const { root, memory } = await fixture();
    await memory.ensure(root);
    const internal = memory as unknown as {
      write: (
        root: string,
        file: string,
        text: string,
        expected?: string,
        beforeCommit?: () => boolean,
      ) => Promise<boolean>;
    };
    let checks = 0;
    const pending = internal.write(
      root,
      "memory.md",
      "# Project diary\n\nThis replacement must not commit.\n",
      undefined,
      () => ++checks < 2,
    );

    await expect(pending).resolves.toBe(false);
    expect(checks).toBe(2);
    expect(await readFile(join(root, ".harness-memory", "memory.md"), "utf8")).not.toContain(
      "This replacement must not commit",
    );
  });

  it("archives older summaries without truncating their conclusions", async () => {
    const { root, memory } = await fixture();
    const body = `${"A long but bounded conclusion. ".repeat(30)}UNIQUE-END-OF-CONCLUSION`;
    await memory.add(root, "memory", body);
    const before = await memory.view(root, true);
    await memory.edit(
      root,
      "memory",
      before.documents.memory.padEnd(50 * 1024 - 1, "x"),
      before.revisions.memory,
    );
    await memory.add(
      root,
      "memory",
      `Next entry after the archive threshold. ${"detail ".repeat(40)}`,
    );
    const view = await memory.view(root, true);
    expect(view.archives).toBe(1);
    const matches = await memory.search(root, "UNIQUE-END-OF-CONCLUSION");
    expect(matches[0]?.source).toContain("archive/");
    const file = join(root, matches[0]?.source ?? "");
    expect(await readFile(file, "utf8")).toContain("UNIQUE-END-OF-CONCLUSION");
  });

  it("redacts manual-file secrets in retrieved excerpts and never writes after prior cancellation", async () => {
    const { root, memory } = await fixture();
    await memory.ensure(root);
    await writeFile(
      join(root, ".harness-memory", "memory.md"),
      "# Diary\n\nPayment service api_key=private-fixture-secret",
    );
    expect(JSON.stringify(await memory.search(root, "Payment"))).not.toContain(
      "private-fixture-secret",
    );
    const signal = AbortSignal.abort();
    await expect(
      memory.add(root, "memory", "Cancelled memory", "decision", signal),
    ).rejects.toThrow();
    expect((await memory.view(root, true)).documents.memory).not.toContain("Cancelled memory");
  });

  it("preserves metadata-like body lines when later appending or removing other entries", async () => {
    const { root, memory } = await fixture();
    const content =
      "Keep these literal labels:\nDate: user-visible\nCategory: example\nKeywords: intact";
    await memory.add(root, "memory", content);
    const other = await memory.add(root, "memory", "A separate removable decision.");
    expect((await memory.search(root, "user-visible"))[0]?.text).toBe(content);
    await memory.forget(root, other);
    expect((await memory.view(root, true)).documents.memory).toContain(content);
  });

  it("bounds a large derived index without excluding later entries from search", async () => {
    const { root, memory } = await fixture();
    await memory.ensure(root);
    const content = `# Archive\n\n${Array.from({ length: 1800 }, (_, i) => {
      const id = `${(i + 1).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
      return `## m-${id}\nDate: 2026-11-07\nCategory: decision\nKeywords: payment\n\nIndex row ${i} payment stable`;
    }).join("\n\n")}\n`;
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(256 * 1024);
    await writeFile(
      join(root, ".harness-memory", "archive", "00000000-0000-4000-8000-000000000001.md"),
      content,
    );
    const view = await memory.view(root, true);
    expect(view.memories).toBe(1800);
    expect(Buffer.byteLength(view.documents.index)).toBeLessThanOrEqual(256 * 1024);
    expect(view.documents.index).toContain("Index preview limited");
    expect((await memory.search(root, "1799"))[0]?.text).toContain("Index row 1799");
  });
});

describe("project memory helpers", () => {
  it("only captures explicit durable preference language", () => {
    expect(explicitPreferences("以后都使用 pnpm，始终先运行类型检查。")).toHaveLength(1);
    expect(explicitPreferences("不要记住这句话，以后仅作为本轮临时要求。")).toHaveLength(0);
    expect(
      explicitPreferences("示例：以后都使用 Python\n> 以后都使用 Ruby\n```\n以后都使用 Go\n```"),
    ).toHaveLength(0);
    expect(isMemoryPath("src/.harness-memory/preferences.md")).toBe(true);
    expect(isMemoryPath("src/memory.md")).toBe(false);
  });
});
