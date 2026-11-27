import { appendFile, type FileHandle, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBoundedOfficeFile } from "./office-bounded-file";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn(original.open) };
});

const roots: string[] = [];

async function fixture(contents: string) {
  const root = await mkdtemp(join(tmpdir(), "mingshen-office-bounded-"));
  roots.push(root);
  const path = join(root, "fixture.bin");
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const absolute = resolve(root);
    if (!absolute.startsWith(`${resolve(tmpdir())}${sep}mingshen-office-bounded-`))
      throw new Error("Unsafe Office reader fixture cleanup.");
    await rm(absolute, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe("bounded Office file reads", () => {
  it("reads an exact-limit file and rejects an initially oversized file", async () => {
    const path = await fixture("12345678");
    await expect(readBoundedOfficeFile(path, "Fixture", 8)).resolves.toEqual(
      Buffer.from("12345678"),
    );
    await expect(readBoundedOfficeFile(path, "Fixture", 7)).rejects.toThrow("read limit");
  });

  it("does not read a newly enlarged file beyond its original size plus one byte", async () => {
    const path = await fixture("12345678");
    const handle = await open(path, "r");
    const read = handle.read.bind(handle);
    const requests: number[] = [];
    let changed = false;
    vi.spyOn(handle, "read").mockImplementation((async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      requests.push(length);
      if (!changed) {
        changed = true;
        await appendFile(path, "x".repeat(4096));
      }
      return await read(buffer, offset, length, position);
    }) as FileHandle["read"]);
    vi.mocked(open).mockResolvedValueOnce(handle);

    await expect(readBoundedOfficeFile(path, "Fixture", 64)).rejects.toThrow("changed");
    expect(requests.reduce((total, length) => total + length, 0)).toBeLessThanOrEqual(9);
  });

  it("rejects a same-size rewrite detected by final handle metadata", async () => {
    const path = await fixture("12345678");
    const handle = await open(path, "r");
    const stat = handle.stat.bind(handle);
    let calls = 0;
    vi.spyOn(handle, "stat").mockImplementation((async (options: { bigint?: boolean }) => {
      const value = await stat(options as { bigint: true });
      calls += 1;
      return calls === 1 ? value : { ...value, mtimeNs: value.mtimeNs + 1n };
    }) as FileHandle["stat"]);
    vi.mocked(open).mockResolvedValueOnce(handle);

    await expect(readBoundedOfficeFile(path, "Fixture", 64)).rejects.toThrow("changed");
  });

  it("rejects invalid budgets before opening a file", async () => {
    vi.mocked(open).mockClear();
    await expect(readBoundedOfficeFile("unused", "Fixture", -1)).rejects.toThrow("read limit");
    expect(open).not.toHaveBeenCalled();
  });
});
