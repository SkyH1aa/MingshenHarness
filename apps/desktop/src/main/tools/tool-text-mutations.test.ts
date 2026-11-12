import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { type ToolExecutionContext, ToolRegistry } from "./tool-registry";

const roots: string[] = [];
const original = "title\n\u4e2d\u6587 first\n";
const updated = "title\n\u4e2d\u6587 second\n";
const operations = ["write_file", "replace_in_file", "apply_patch", "delete_file"] as const;

function encoded(text: string, encoding: "utf16le" | "utf16be"): Buffer {
  const bytes = Buffer.from(text, "utf16le");
  return encoding === "utf16le"
    ? Buffer.concat([Buffer.from([0xff, 0xfe]), bytes])
    : Buffer.concat([Buffer.from([0xfe, 0xff]), bytes.swap16()]);
}

function argumentsFor(name: (typeof operations)[number]): Record<string, unknown> {
  if (name === "write_file") return { path: "encoded.txt", content: updated };
  if (name === "replace_in_file")
    return { path: "encoded.txt", old_text: "\u4e2d\u6587 first", new_text: "\u4e2d\u6587 second" };
  if (name === "apply_patch")
    return {
      patch:
        "*** Begin Patch\n*** Update File: encoded.txt\n@@\n-\u4e2d\u6587 first\n+\u4e2d\u6587 second\n*** End Patch",
    };
  return { path: "encoded.txt" };
}

async function fixture(bytes: Buffer) {
  const root = await mkdtemp(join(tmpdir(), "mingshen-text-mutations-"));
  roots.push(root);
  const path = join(root, "encoded.txt");
  await writeFile(path, bytes);
  const versions = new Map<string, string>();
  const beforeFileWrite = vi.fn(async (target: string, version: string) => {
    if (versions.has(target) && versions.get(target) !== version)
      throw new Error("EXTERNAL_FILE_CHANGED: this write was not executed.");
  });
  const context: ToolExecutionContext = {
    session: {
      id: "session",
      workspacePath: root,
      permissionMode: "full_access",
      executionMode: "host",
    } as SessionView,
    runId: "run",
    toolCallId: "call",
    toolName: "read_file",
    signal: new AbortController().signal,
    permissions: new PermissionStore(),
    observeFile: (target, version) => {
      versions.set(target, version);
    },
    beforeFileWrite,
    requestApproval: async () => {
      throw new Error("Full access must not request approval.");
    },
  };
  return { path, context, versions, beforeFileWrite, registry: new ToolRegistry() };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("host text mutation encoding and version checks", () => {
  for (const encoding of ["utf16le", "utf16be"] as const) {
    it.each(operations)(`reads then applies %s to unchanged ${encoding}`, async (operation) => {
      const bytes = encoded(original, encoding);
      const f = await fixture(bytes);
      const initialVersion = createHash("sha256").update(bytes).digest("hex");
      const read = await f.registry.execute("read_file", { path: "encoded.txt" }, f.context);
      expect(read.isError).toBe(false);
      expect(read.output).toContain("\u4e2d\u6587 first");
      expect(f.versions.get(f.path)).toBe(initialVersion);
      const result = await f.registry.execute(operation, argumentsFor(operation), f.context);
      expect(result.isError).toBe(false);
      expect(f.beforeFileWrite).toHaveBeenCalledExactlyOnceWith(f.path, initialVersion);
      if (operation === "delete_file") {
        await expect(readFile(f.path)).rejects.toThrow("ENOENT");
        expect(f.versions.get(f.path)).toBe("missing");
      } else {
        const saved = await readFile(f.path);
        expect(saved.toString("utf8")).toBe(updated);
        expect(f.versions.get(f.path)).toBe(createHash("sha256").update(saved).digest("hex"));
      }
    });
  }

  it("applies a delete patch using the observed raw-byte version", async () => {
    const bytes = encoded(original, "utf16be");
    const f = await fixture(bytes);
    await f.registry.execute("read_file", { path: "encoded.txt" }, f.context);
    const result = await f.registry.execute(
      "apply_patch",
      { patch: "*** Begin Patch\n*** Delete File: encoded.txt\n*** End Patch" },
      f.context,
    );
    expect(result.isError).toBe(false);
    expect(f.beforeFileWrite).toHaveBeenCalledExactlyOnceWith(
      f.path,
      createHash("sha256").update(bytes).digest("hex"),
    );
    await expect(readFile(f.path)).rejects.toThrow("ENOENT");
  });

  it.each(operations)("blocks %s after an actual external byte change", async (operation) => {
    const f = await fixture(encoded(original, "utf16le"));
    await f.registry.execute("read_file", { path: "encoded.txt" }, f.context);
    const externalBytes = encoded(original, "utf16be");
    await writeFile(f.path, externalBytes);
    const result = await f.registry.execute(operation, argumentsFor(operation), f.context);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("EXTERNAL_FILE_CHANGED");
    expect(await readFile(f.path)).toEqual(externalBytes);
  });

  it.each(["write_file", "replace_in_file", "apply_patch"] as const)(
    "rejects binary data before %s without changing the file",
    async (operation) => {
      const bytes = Buffer.from([0x50, 0x4b, 0x00, 0x01]);
      const f = await fixture(bytes);
      const result = await f.registry.execute(operation, argumentsFor(operation), f.context);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("BINARY_FILE_UNSUPPORTED");
      expect(f.beforeFileWrite).not.toHaveBeenCalled();
      expect(await readFile(f.path)).toEqual(bytes);
    },
  );
});
