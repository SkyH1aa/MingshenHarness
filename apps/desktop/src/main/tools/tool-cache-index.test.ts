import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import type { NativeSandboxService } from "../workspace/native-sandbox-service";
import { type ToolExecutionContext, ToolRegistry } from "./tool-registry";
import {
  cacheableCommand,
  contentCacheKey,
  readonlyCommand,
  ToolResultCache,
} from "./tool-result-cache";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(protectedMode = false) {
  const root = await mkdtemp(join(tmpdir(), "mingshen-cache-"));
  roots.push(root);
  await writeFile(join(root, "a.ts"), "export const value=1;");
  const requestApproval = vi.fn(async (request) => ({
    approvalId: request.id,
    decision: "allow_once" as const,
  }));
  const context: ToolExecutionContext = {
    session: {
      id: "s",
      title: "Fixture",
      workspacePath: root,
      permissionMode: protectedMode ? "request_approval" : "full_access",
      executionMode: "host",
    } as SessionView,
    runId: "run",
    toolCallId: "call",
    toolName: "read_file",
    signal: new AbortController().signal,
    permissions: new PermissionStore(),
    requestApproval,
  };
  return { root, context, requestApproval };
}

describe("approval-preserving tool cache and index", () => {
  it.each(["run_command", "read_file"])(
    "reports missing %s arguments without approval or execution",
    async (name) => {
      const f = await fixture(true);
      const run = vi.fn(),
        fileOperation = vi.fn();
      const registry = new ToolRegistry({ run, fileOperation } as unknown as NativeSandboxService);
      const result = await registry.execute(name, {}, { ...f.context, toolName: name });
      expect(result.isError).toBe(true);
      expect(result.output).toContain(`TOOL_ARGUMENTS_INVALID: ${name}`);
      expect(result.output).toContain(
        `Required fields: ${name === "run_command" ? "command" : "path"}`,
      );
      expect(f.requestApproval).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(fileOperation).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["search_files", { path: "." }],
    ["glob_files", { path: "." }],
    ["list_files", { depth: 99 }],
  ])("validates isolated %s before approval or listing", async (name, args) => {
    const f = await fixture(true);
    const fileOperation = vi.fn();
    const registry = new ToolRegistry({ fileOperation } as unknown as NativeSandboxService);
    const result = await registry.execute(String(name), args, f.context);
    expect(result.output).toContain("TOOL_ARGUMENTS_INVALID");
    expect(result.isError).toBe(true);
    expect(f.requestApproval).not.toHaveBeenCalled();
    expect(fileOperation).not.toHaveBeenCalled();
  });
  it("accepts a single file for search, glob, listing and literal directory commands", async () => {
    const f = await fixture();
    const registry = new ToolRegistry();
    const search = await registry.execute(
      "search_files",
      { path: "a.ts", query: "value" },
      f.context,
    );
    expect(search).toMatchObject({ isError: false });
    expect(search.output).toContain("a.ts:1:");
    const glob = await registry.execute("glob_files", { path: "a.ts", pattern: "*.ts" }, f.context);
    expect(glob).toMatchObject({ isError: false, output: "a.ts" });
    const list = await registry.execute("list_files", { path: "a.ts" }, f.context);
    expect(list.isError).toBe(false);
    expect(list.output).toContain("file  a.ts");
    expect(
      await registry.execute(
        "run_command",
        { command: "Get-ChildItem -LiteralPath 'a.ts' -Name" },
        f.context,
      ),
    ).toMatchObject({ isError: false, output: "exit_code: 0\na.ts" });
    const directory = await registry.execute("read_file", { path: "." }, f.context);
    expect(directory.isError).toBe(true);
    expect(directory.output).toContain("list_files");
  });
  it.each(["utf8-bom", "utf16le", "utf16be"])(
    "reads and searches %s text without classifying it as binary",
    async (encoding) => {
      const f = await fixture();
      const text = "Title\n中文 user preference";
      const utf16 = Buffer.from(text, "utf16le");
      const buffer =
        encoding === "utf8-bom"
          ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])
          : encoding === "utf16le"
            ? Buffer.concat([Buffer.from([0xff, 0xfe]), utf16])
            : Buffer.concat([Buffer.from([0xfe, 0xff]), utf16.swap16()]);
      await writeFile(join(f.root, "encoded.txt"), buffer);
      const registry = new ToolRegistry();
      const read = await registry.execute("read_file", { path: "encoded.txt" }, f.context);
      expect(read.isError).toBe(false);
      expect(read.output).toContain("1 | Title");
      expect(read.output).toContain("中文 user preference");
      const search = await registry.execute(
        "search_files",
        { path: "encoded.txt", query: "中文" },
        f.context,
      );
      expect(search.isError).toBe(false);
      expect(search.output).toContain("encoded.txt:2: 中文 user preference");
      const command = await registry.execute(
        "run_command",
        { command: "Get-Content -LiteralPath 'encoded.txt'" },
        f.context,
      );
      expect(command).toMatchObject({ isError: false, output: `exit_code: 0\n${text}` });
    },
  );
  it("rejects binary text reads with actionable guidance in host and protected modes", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
    const host = await new ToolRegistry().execute("read_file", { path: "image.png" }, f.context);
    expect(host.isError).toBe(true);
    expect(host.output).toContain("BINARY_FILE_UNSUPPORTED");
    expect(host.output).toContain("image-capable model");
    const protectedContext = {
      ...f.context,
      session: { ...f.context.session, permissionMode: "request_approval" as const },
    };
    const native = new ToolRegistry({
      fileOperation: async () => "\uFFFDPNG\0\u0001",
    } as unknown as NativeSandboxService);
    const protectedRead = await native.execute(
      "read_file",
      { path: "image.png" },
      protectedContext,
    );
    expect(protectedRead.isError).toBe(true);
    expect(protectedRead.output).toContain("BINARY_FILE_UNSUPPORTED");
  });
  it.each([
    { names: [".harness-tencent-memory"] },
    { names: [".harness-memory", ".harness-tencent-memory"] },
    { names: [] },
  ])("protects only existing memory paths for subagent commands: $names", async ({ names }) => {
    const f = await fixture();
    for (const name of names) await mkdir(join(f.root, name), { recursive: true });
    const run = vi.fn(async () => ({ exitCode: 0, output: "ok" }));
    const registry = new ToolRegistry({ run } as unknown as NativeSandboxService);
    const result = await registry.execute(
      "run_command",
      { command: "Write-Output hello" },
      { ...f.context, session: { ...f.context.session, parentSessionId: "parent" } },
    );
    expect(result.isError).toBe(false);
    expect(run).toHaveBeenCalledWith(
      f.root,
      "Write-Output hello",
      f.context.signal,
      expect.objectContaining({ readOnlyPaths: names.map((name) => join(f.root, name)) }),
    );
    if (!names.includes(".harness-memory"))
      await expect(access(join(f.root, ".harness-memory"))).rejects.toThrow("ENOENT");
  });
  it.runIf(process.platform === "win32")(
    "preserves Unicode PowerShell stdout and error text",
    async () => {
      const f = await fixture();
      const registry = new ToolRegistry();
      const output = await registry.execute(
        "run_command",
        { command: "Write-Output '中文输出与 emoji 🚀'" },
        f.context,
      );
      expect(output.isError).toBe(false);
      expect(output.output).toContain("中文输出与 emoji 🚀");
      const failure = await registry.execute(
        "run_command",
        { command: "Write-Error '中文失败'" },
        f.context,
      );
      expect(failure.isError).toBe(true);
      expect(failure.output).toContain("中文失败");
      expect(failure.output).not.toContain("#< CLIXML");
    },
  );
  it("records command side effects only after approval and before execution", async () => {
    const f = await fixture(true),
      effect = vi.fn(),
      run = vi.fn(async () => ({ exitCode: 0, output: "ok" }));
    const registry = new ToolRegistry({ run } as unknown as NativeSandboxService);
    f.requestApproval.mockImplementationOnce(async (request) => ({
      approvalId: request.id,
      decision: "deny" as "allow_once",
    }));
    const context = { ...f.context, toolName: "run_command", onEffectStart: effect };
    expect(
      (await registry.execute("run_command", { command: "Write-Output hello" }, context)).isError,
    ).toBe(true);
    expect(effect).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(
      (await registry.execute("run_command", { command: "Write-Output hello" }, context)).isError,
    ).toBe(false);
    expect(effect).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(effect.mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[0] as number,
    );
  });
  it("deduplicates unchanged contents, refreshes after external edits, does not cross run/compaction boundaries", async () => {
    const f = await fixture();
    const registry = new ToolRegistry();
    expect((await registry.execute("read_file", { path: "a.ts" }, f.context)).output).toContain(
      "value=1",
    );
    expect((await registry.execute("read_file", { path: "a.ts" }, f.context)).output).toContain(
      "Cache hit",
    );
    expect(
      (await registry.execute("read_file", { path: "a.ts", refresh: true }, f.context)).output,
    ).toContain("value=1");
    await writeFile(join(f.root, "a.ts"), "export const value=2;");
    expect((await registry.execute("read_file", { path: "a.ts" }, f.context)).output).toContain(
      "value=2",
    );
    expect(
      (
        await registry.execute(
          "read_file",
          { path: "a.ts" },
          { ...f.context, contextEpoch: "new-summary" },
        )
      ).output,
    ).toContain("value=2");
    expect(
      (await registry.execute("read_file", { path: "a.ts" }, { ...f.context, runId: "next-run" }))
        .output,
    ).toContain("value=2");
  });
  it("always rechecks protected approval and performs isolated content verification before a cache hit", async () => {
    const f = await fixture(true);
    const isolatedRead = vi.fn(async () => "export const value=1;");
    const registry = new ToolRegistry({
      fileOperation: isolatedRead,
    } as unknown as NativeSandboxService);
    await registry.execute("read_file", { path: "a.ts" }, f.context);
    const second = await registry.execute("read_file", { path: "a.ts" }, f.context);
    expect(second.output).toContain("Cache hit");
    expect(isolatedRead).toHaveBeenCalledTimes(2);
    expect(f.requestApproval).toHaveBeenCalledTimes(2);
    f.requestApproval.mockImplementationOnce(async (request) => ({
      approvalId: request.id,
      decision: "deny" as "allow_once",
    }));
    expect((await registry.execute("read_file", { path: "a.ts" }, f.context)).isError).toBe(true);
    expect(isolatedRead).toHaveBeenCalledTimes(2);
  });
  it("indexes only approved workspace data and prevents path traversal even with full access", async () => {
    const f = await fixture();
    const registry = new ToolRegistry();
    const result = await registry.execute(
      "code_index",
      { query: "value" },
      { ...f.context, toolName: "code_index" },
    );
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output).symbols[0]).toMatchObject({ name: "value", path: "a.ts" });
    expect((await registry.execute("code_index", { path: "../private" }, f.context)).isError).toBe(
      true,
    );
    await expect(readFile(join(f.root, "a.ts"), "utf8")).resolves.toBe("export const value=1;");
  });
  it("keeps explicit profile confirmations manual and cannot remember them as session grants", async () => {
    const f = await fixture(true);
    f.context.forceApproval = true;
    f.requestApproval.mockImplementation(async (request) => ({
      approvalId: request.id,
      decision: "allow_session" as "allow_once",
    }));
    const registry = new ToolRegistry({
      fileOperation: async () => "export const value=1;",
    } as unknown as NativeSandboxService);
    await registry.execute("read_file", { path: "a.ts" }, f.context);
    await registry.execute("read_file", { path: "a.ts" }, f.context);
    expect(f.requestApproval).toHaveBeenCalledTimes(2);
    expect(f.requestApproval.mock.calls[0]?.[0]).toMatchObject({ manualOnly: true });
    expect(f.context.permissions.hasPath("s", join(f.root, "a.ts"), "read")).toBe(false);
  });
  it("restricts command skipping to exact runtime probes and bounds/invalidates cached results", () => {
    expect(cacheableCommand("node --version")).toBe(true);
    for (const command of [
      "npm test",
      "git status",
      "git --version; Remove-Item x",
      "node --version > x",
      "node -e 'write()'",
    ])
      expect(cacheableCommand(command)).toBe(false);
    const cache = new ToolResultCache();
    cache.put("key", "first");
    expect(cache.get("key")).toBe("first");
    cache.clear();
    expect(cache.get("key")).toBeNull();
    expect(contentCacheKey("scope", "a", "one")).not.toBe(contentCacheKey("scope", "a", "two"));
  });
  it("uses deduplication only for in-flight reads without evicting verified content entries", async () => {
    const cache = new ToolResultCache();
    for (let index = 0; index < 128; index++)
      cache.put(`content-${index}`, `value-${index}`, 60_000);

    await expect(
      cache.deduplicate("read-flight", async () => "fresh content", new AbortController().signal),
    ).resolves.toBe("fresh content");

    for (let index = 0; index < 128; index++)
      expect(cache.get(`content-${index}`)).toBe(`value-${index}`);
  });
  it("isolates cleared in-flight reads and retries failed reads", async () => {
    const cache = new ToolResultCache();
    const signal = new AbortController().signal;
    let resolveOld!: (value: string) => void;
    let resolveNew!: (value: string) => void;
    const execute = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveNew = resolve;
          }),
      );

    const oldRead = cache.deduplicate("same-read", execute, signal);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    cache.clear();
    const newRead = cache.deduplicate("same-read", execute, signal);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));

    resolveOld("old generation");
    resolveNew("new generation");
    await expect(oldRead).resolves.toBe("old generation");
    await expect(newRead).resolves.toBe("new generation");
    await expect(
      cache.deduplicate("same-read", async () => "after completion", signal),
    ).resolves.toBe("after completion");
    expect(execute).toHaveBeenCalledTimes(2);

    let attempts = 0;
    await expect(
      cache.deduplicate(
        "retry-read",
        async () => {
          attempts++;
          throw new Error("temporary read failure");
        },
        signal,
      ),
    ).rejects.toThrow("temporary read failure");
    await expect(
      cache.deduplicate(
        "retry-read",
        async () => {
          attempts++;
          return "recovered";
        },
        signal,
      ),
    ).resolves.toBe("recovered");
    expect(attempts).toBe(2);
  });
  it("waits for the command process tree to stop before cancellation resolves", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const registry = new ToolRegistry();
    const running = registry.execute(
      "run_command",
      {
        command:
          "Set-Content -LiteralPath started.txt -Value started; Start-Sleep -Seconds 30; Set-Content -LiteralPath late.txt -Value unsafe",
        timeout_ms: 60000,
      },
      { ...f.context, toolName: "run_command", signal: controller.signal },
    );
    await vi.waitFor(
      async () => expect(await readFile(join(f.root, "started.txt"), "utf8")).toContain("started"),
      { timeout: 10000 },
    );
    controller.abort();
    const result = await running;
    expect(result.isError).toBe(true);
    expect(result.output).toContain("取消");
    await expect(readFile(join(f.root, "late.txt"))).rejects.toThrow("ENOENT");
  }, 20000);
  it("caches verified literal read commands, rejects shell syntax and invalidates on external edits", async () => {
    const f = await fixture();
    const registry = new ToolRegistry();
    const context = { ...f.context, toolName: "run_command" };
    const command = "Get-Content -LiteralPath 'a.ts'";
    expect((await registry.execute("run_command", { command }, context)).output).toContain(
      "value=1",
    );
    expect((await registry.execute("run_command", { command }, context)).output).toContain(
      "cached read-only command",
    );
    await writeFile(join(f.root, "a.ts"), "export const value=7;");
    const changed = await registry.execute("run_command", { command }, context);
    expect(changed.output).toContain("value=7");
    expect(changed.output).not.toContain("cached read-only command");
    const missing = await registry.execute(
      "run_command",
      { command: "Test-Path -LiteralPath absent.txt" },
      context,
    );
    expect(missing).toMatchObject({ isError: false, output: "exit_code: 0\nFalse" });
    for (const unsafe of [
      "Get-Content -LiteralPath x; shutdown /s",
      "Get-Content -LiteralPath $secret",
      "Get-Content -LiteralPath x > out.txt",
      "Get-ChildItem -LiteralPath x -Recurse",
      "Get-Content -LiteralPath x | Invoke-Expression",
    ])
      expect(readonlyCommand(unsafe)).toBeNull();
    expect(readonlyCommand("Get-ChildItem -LiteralPath . -Name")).toMatchObject({
      operation: "list",
      path: ".",
      nameOnly: true,
    });
  });
  it("merges concurrent approved reads but never reuses unverified dependency content", async () => {
    const f = await fixture(true);
    let done!: () => void;
    const isolated = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        done = resolve;
      });
      return "const x=1;";
    });
    const registry = new ToolRegistry({
      fileOperation: isolated,
    } as unknown as NativeSandboxService);
    const a = registry.execute("read_file", { path: "a.ts" }, f.context),
      b = registry.execute("read_file", { path: "a.ts" }, { ...f.context, toolCallId: "b" });
    await vi.waitFor(() => expect(isolated).toHaveBeenCalledOnce());
    done();
    await Promise.all([a, b]);
    expect(f.requestApproval).toHaveBeenCalledTimes(2);
    isolated.mockResolvedValue("const x=2;");
    expect((await registry.execute("read_file", { path: "a.ts" }, f.context)).output).toContain(
      "x=2",
    );
  });
});
