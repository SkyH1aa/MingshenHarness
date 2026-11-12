import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceService } from "./workspace-service";

const { spawn, actualSpawn } = vi.hoisted(() => ({
  spawn: vi.fn(),
  actualSpawn: { current: null as typeof import("node:child_process").spawn | null },
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  actualSpawn.current = actual.spawn;
  return { ...actual, spawn };
});

const roots: string[] = [];
const content = "Unicode \u4e2d\u6587 \u{1f680}\r\nsecond line";

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mingshen-workspace-"));
  roots.push(root);
  return root;
}

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 123,
    exitCode: null,
    kill: vi.fn(),
    unref: vi.fn(),
  });
}

beforeEach(() => {
  spawn.mockReset();
  if (!actualSpawn.current) throw new Error("The real child-process spawn was not initialized.");
  spawn.mockImplementation(actualSpawn.current);
});

afterEach(async () => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("WorkspaceService file reads", () => {
  it.each([
    ["utf8", Buffer.from(content)],
    ["utf8-bom", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content)])],
    ["utf16-le", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, "utf16le")])],
    [
      "utf16-be",
      Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(content, "utf16le").swap16()]),
    ],
  ])("reads %s through relative and absolute paths", async (name, bytes) => {
    const root = await temporaryRoot();
    const filename = `${name}.txt`;
    const path = join(root, filename);
    await writeFile(path, bytes);
    const service = new WorkspaceService();
    for (const result of [
      await service.readFile(root, filename),
      await service.readAbsoluteFile(path),
    ]) {
      expect(result).toEqual({
        path,
        relativePath: filename,
        content,
        size: bytes.length,
      });
    }
  });

  it.each([
    ["binary", Buffer.from([0x50, 0x4b, 0x00, 0x01])],
    ["odd-utf16", Buffer.from([0xff, 0xfe, 0x61])],
    ["null-utf16", Buffer.from([0xff, 0xfe, 0x00, 0x00])],
  ])("rejects %s with an actionable binary error", async (name, bytes) => {
    const root = await temporaryRoot();
    const filename = `${name}.bin`;
    const path = join(root, filename);
    await writeFile(path, bytes);
    const service = new WorkspaceService();
    await expect(service.readFile(root, filename)).rejects.toThrow("Office/PDF");
    await expect(service.readAbsoluteFile(path)).rejects.toThrow("Office/PDF");
  });

  it("lists a single file without a directory scan error", async () => {
    const root = await temporaryRoot();
    const path = join(root, "file.txt");
    await writeFile(path, "hello");
    await expect(new WorkspaceService().list(root, "file.txt")).resolves.toEqual([
      { name: "file.txt", path, relativePath: "file.txt", directory: false, size: 5 },
    ]);
  });

  it("lists directories first and keeps file sizes", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "alpha.txt"), "hello");
    await mkdir(join(root, "z-directory"));
    const entries = await new WorkspaceService().list(root, ".");
    expect(entries.map((entry) => [entry.name, entry.directory, entry.size])).toEqual([
      ["z-directory", true, 0],
      ["alpha.txt", false, 5],
    ]);
  });

  it("explains missing targets and invalid file or directory selections", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "file.txt"), "hello");
    const service = new WorkspaceService();
    await expect(service.list(root, "missing")).rejects.toThrow("\u8bf7\u68c0\u67e5");
    await expect(service.readFile(root, "missing")).rejects.toThrow("\u8bf7\u68c0\u67e5");
    await expect(service.readAbsoluteFile(join(root, "missing"))).rejects.toThrow(
      "\u8bf7\u68c0\u67e5",
    );
    await expect(service.readFile(root, ".")).rejects.toThrow(
      "\u9009\u62e9\u5177\u4f53\u6587\u4ef6",
    );
    await expect(service.readAbsoluteFile(root)).rejects.toThrow(
      "\u9009\u62e9\u5177\u4f53\u6587\u4ef6",
    );
    await expect(service.list(root, "file.txt/child")).rejects.toThrow("\u8bf7\u68c0\u67e5");
    await expect(service.readFile(root, "file.txt/child")).rejects.toThrow("\u8bf7\u68c0\u67e5");
  });

  it("preserves path boundaries and the editor size limit", async () => {
    const root = await temporaryRoot();
    const service = new WorkspaceService();
    await expect(service.list(root, "../outside")).rejects.toThrow("\u8d85\u51fa");
    await expect(service.readFile(root, "../outside.txt")).rejects.toThrow("\u8d85\u51fa");
    await expect(service.readAbsoluteFile("relative.txt")).rejects.toThrow("\u7edd\u5bf9");
    await writeFile(join(root, "large.txt"), Buffer.alloc(2_000_001, 0x61));
    await expect(service.readFile(root, "large.txt")).rejects.toThrow("2 MB");
    await expect(service.readAbsoluteFile(join(root, "large.txt"))).rejects.toThrow("2 MB");
  });
});

describe("WorkspaceService command lifecycle", () => {
  it("cleans the timeout after a spawn failure", async () => {
    const root = await temporaryRoot();
    vi.useFakeTimers();
    const child = fakeChild();
    spawn.mockReturnValueOnce(child);
    const result = new WorkspaceService().runCommand(root, "Write-Output hello");
    const failure = expect(result).rejects.toThrow("spawn failed");
    child.emit("error", new Error("spawn failed"));
    await failure;
    expect(vi.getTimerCount()).toBe(0);
    child.emit("close", -1);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("waits for process close after a timeout and retains its output", async () => {
    const root = await temporaryRoot();
    vi.useFakeTimers();
    const child = fakeChild();
    const killer = fakeChild();
    spawn.mockReturnValueOnce(child).mockReturnValueOnce(killer);
    let settled = false;
    const result = new WorkspaceService().runCommand(root, "Write-Output hello").then((value) => {
      settled = true;
      return value;
    });
    child.stdout.write("before timeout\n");
    child.stderr.write("x".repeat(100_001));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);
    expect(spawn.mock.calls[1]?.slice(0, 2)).toEqual(["taskkill.exe", ["/PID", "123", "/T", "/F"]]);
    child.stdout.end("after timeout\n");
    await Promise.resolve();
    child.emit("close", 1);
    const value = await result;
    expect(value.exitCode).toBeNull();
    expect(value.stdout).toBe("before timeout\nafter timeout\n");
    expect(value.stderr).toContain("output truncated");
    expect(value.stderr).toContain("Process timed out.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back to killing the child when taskkill cannot start", async () => {
    const root = await temporaryRoot();
    vi.useFakeTimers();
    const child = fakeChild();
    const killer = fakeChild();
    spawn.mockReturnValueOnce(child).mockReturnValueOnce(killer);
    const result = new WorkspaceService().runCommand(root, "Write-Output hello");
    await vi.advanceTimersByTimeAsync(120_000);
    killer.emit("error", new Error("taskkill unavailable"));
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit("close", null);
    expect((await result).exitCode).toBeNull();
  });

  it("decodes split UTF-8 chunks and configures textual PowerShell output", async () => {
    const root = await temporaryRoot();
    const child = fakeChild();
    spawn.mockReturnValueOnce(child);
    const result = new WorkspaceService().runCommand(root, "Write-Output hello");
    const bytes = Buffer.from("\u4e2d\u6587");
    child.stdout.write(bytes.subarray(0, 1));
    child.stdout.write(bytes.subarray(1));
    child.emit("close", 0);
    expect((await result).stdout).toBe("\u4e2d\u6587");
    const [executable, args] = spawn.mock.calls[0] as [string, string[]];
    expect(executable).toBe(
      process.env.SystemRoot
        ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        : "powershell.exe",
    );
    expect(args).toContain("-OutputFormat");
    expect(args).toContain("Text");
    expect(args).not.toContain("-ExecutionPolicy");
    expect(args.at(-1)).toContain("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)");
  });

  it("preserves the dangerous-command guard", async () => {
    const root = await temporaryRoot();
    await expect(new WorkspaceService().runCommand(root, "git reset --hard")).rejects.toThrow(
      "\u7981\u6b62",
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "win32")(
    "preserves Unicode, harmless stderr and real nonzero exits in Windows PowerShell",
    async () => {
      const root = await temporaryRoot();
      const service = new WorkspaceService();
      const text = "result \u4e2d\u6587 \u{1f680}";
      const success = await service.runCommand(
        root,
        `[Console]::WriteLine('${text}');[Console]::Error.WriteLine('warning');exit 0`,
      );
      expect(success.exitCode).toBe(0);
      expect(success.stdout.trim()).toBe(text);
      expect(success.stderr.trim()).toBe("warning");
      const failure = await service.runCommand(
        root,
        "[Console]::Error.WriteLine('intentional failure');exit 7",
      );
      expect(failure.exitCode).toBe(7);
      expect(failure.stderr.trim()).toBe("intentional failure");
    },
    20_000,
  );
});
