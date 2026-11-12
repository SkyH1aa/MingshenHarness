import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { DockerService } from "../workspace/docker-service";
import type { NativeSandboxService } from "../workspace/native-sandbox-service";
import { type ToolExecutionContext, ToolRegistry } from "./tool-registry";

const { spawn, execFile } = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn,
  execFile,
}));

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const roots: string[] = [];
const registries: ToolRegistry[] = [];
let processFixture: ReturnType<typeof fakeProcess> | undefined;

function fakeProcess() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    pid: 123,
    exitCode: null as number | null,
    signalCode: null,
  });
}

beforeEach(() => {
  spawn.mockReset();
  execFile.mockReset();
  processFixture = undefined;
  spawn.mockImplementation(() => {
    processFixture = fakeProcess();
    return processFixture;
  });
  execFile.mockImplementation(
    (
      executable: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      queueMicrotask(() => {
        if (executable.toLowerCase().endsWith("taskkill.exe")) {
          processFixture?.emit("close", null);
        }
        callback(null, "", "");
      });
      return new EventEmitter();
    },
  );
});

afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.shutdown().catch(() => undefined);
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

async function fixture(options: Partial<SessionView> = {}, native?: Partial<NativeSandboxService>) {
  const root = await mkdtemp(join(tmpdir(), "mingshen-enhanced-tools-"));
  roots.push(root);
  const context: ToolExecutionContext = {
    session: {
      id: "session",
      workspacePath: root,
      permissionMode: "full_access",
      executionMode: "host",
      parentSessionId: null,
      ...options,
    } as SessionView,
    runId: "run",
    toolCallId: "call",
    toolName: "exec_command",
    signal: new AbortController().signal,
    permissions: new PermissionStore(),
    requestApproval: vi.fn(async () => ({
      approvalId: "fixture",
      decision: "allow_session" as const,
    })),
  };
  const registry = native ? new ToolRegistry(native as NativeSandboxService) : new ToolRegistry();
  registries.push(registry);
  return { root, context, registry };
}

describe("paged file reads", () => {
  it("reads after line 2500, reports continuation and uses separate cache entries per range", async () => {
    const f = await fixture();
    const text = Array.from({ length: 5002 }, (_, index) => `value_${index + 1}`).join("\n");
    await writeFile(join(f.root, "long.ts"), text);
    const observe = vi.fn();
    f.context.observeFile = observe;
    const first = await f.registry.execute(
      "read_file",
      {
        path: "long.ts",
        start_line: 2501,
        limit: 2,
      },
      f.context,
    );
    expect(first.isError).toBe(false);
    expect(first.output).toContain("2501 | value_2501");
    expect(first.output).toContain("2502 | value_2502");
    expect(first.output).not.toContain("value_2503\n");
    expect(first.output).toContain('"start_line":2503');
    expect(observe).toHaveBeenCalledWith(
      join(f.root, "long.ts"),
      createHash("sha256").update(text).digest("hex"),
    );
    const next = await f.registry.execute(
      "read_file",
      {
        path: "long.ts",
        start_line: 5001,
        end_line: 5002,
      },
      f.context,
    );
    expect(next.output).toContain("5002 | value_5002");
    expect(next.output).not.toContain("Cache hit");
    expect(next.output).not.toContain("Next read_file");
    const again = await f.registry.execute(
      "read_file",
      {
        path: "long.ts",
        start_line: 2501,
        limit: 2,
      },
      f.context,
    );
    expect(again.output).toContain("Cache hit");
    const fresh = await f.registry.execute(
      "read_file",
      {
        path: "long.ts",
        start_line: 2501,
        limit: 2,
        refresh: true,
      },
      f.context,
    );
    expect(fresh.output).toContain("2502 | value_2502");
  });

  it("pages a long single line without losing characters", async () => {
    const f = await fixture();
    const text = "0123456789".repeat(100);
    await writeFile(join(f.root, "long.json"), text);
    const pieces: string[] = [];
    let args: Record<string, unknown> = { path: "long.json", max_chars: 100 };
    for (let index = 0; index < 20; index++) {
      const result = await f.registry.execute("read_file", args, f.context);
      expect(result.isError).toBe(false);
      const line = result.output.split("\n").find((value) => /^\s*1 \| /.test(value));
      pieces.push(line?.replace(/^\s*1 \| /, "") || "");
      const cursor = /^Next read_file: (.*)$/m.exec(result.output)?.[1];
      if (!cursor) break;
      args = JSON.parse(cursor);
    }
    expect(pieces.join("")).toBe(text);
    const invalid = await f.registry.execute(
      "read_file",
      {
        path: "long.json",
        start_line: 5,
        end_line: 3,
      },
      f.context,
    );
    expect(invalid.output).toContain("TOOL_ARGUMENTS_INVALID");
  });

  it("retains approval and isolated reads for a later page", async () => {
    const text = "first\nsecond\nthird";
    const fileOperation = vi.fn(async () => text);
    const f = await fixture({ permissionMode: "request_approval" }, { fileOperation });
    const result = await f.registry.execute(
      "read_file",
      {
        path: "source.ts",
        start_line: 2,
        end_line: 2,
      },
      { ...f.context, toolName: "read_file" },
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("2 | second");
    expect(result.output).not.toContain("1 | first");
    expect(f.context.requestApproval).toHaveBeenCalledOnce();
    expect(fileOperation).toHaveBeenCalledWith(
      f.root,
      { operation: "read", path: "source.ts" },
      f.context.signal,
    );
  });

  it("keeps UTF-16 pairs intact at a page boundary and rejects a split offset", async () => {
    const f = await fixture();
    const text = `${"a".repeat(94)}\uD83D\uDE80${"b".repeat(120)}`;
    await writeFile(join(f.root, "unicode.txt"), text);
    const pieces: string[] = [];
    let args: Record<string, unknown> = { path: "unicode.txt", max_chars: 100 };
    for (let page = 0; page < 5; page++) {
      const result = await f.registry.execute("read_file", args, f.context);
      const line = result.output.split("\n").find((value) => /^\s*1 \| /.test(value));
      const piece = line?.replace(/^\s*1 \| /, "") ?? "";
      expect(Buffer.from(piece).toString("utf8")).toBe(piece);
      pieces.push(piece);
      const cursor = /^Next read_file: (.*)$/m.exec(result.output)?.[1];
      if (!cursor) break;
      args = JSON.parse(cursor);
    }
    expect(pieces.join("")).toBe(text);
    const invalid = await f.registry.execute(
      "read_file",
      { path: "unicode.txt", char_offset: 95 },
      f.context,
    );
    expect(invalid.isError).toBe(true);
    expect(invalid.output).toContain("READ_RANGE_INVALID");
  });
});

describe("image tool feedback", () => {
  it("returns local image pixels and rejects non-images and paths outside the workspace", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "capture.png"), png);
    await writeFile(join(f.root, "fake.png"), "<script>not an image</script>");
    const result = await f.registry.execute("view_image", { path: "capture.png" }, f.context);
    expect(result.isError).toBe(false);
    expect(result.images).toEqual([
      {
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
        mimeType: "image/png",
        alt: "capture.png",
      },
    ]);
    const fake = await f.registry.execute("view_image", { path: "fake.png" }, f.context);
    expect(fake.isError).toBe(true);
    expect(fake.images).toBeUndefined();
    const outside = await f.registry.execute("view_image", { path: "../outside.png" }, f.context);
    expect(outside.isError).toBe(true);
  });

  it.each(["host", "docker"] as const)(
    "uses the approved %s binary gateway for child image reads",
    async (executionMode) => {
      const fileOperation = vi.fn<NativeSandboxService["fileOperation"]>(async () =>
        png.toString("base64"),
      );
      const f = await fixture(
        {
          executionMode,
          parentSessionId: "parent",
          permissionMode: "request_approval",
        },
        { fileOperation },
      );
      await writeFile(join(f.root, "capture.png"), "gateway only");
      if (executionMode === "docker")
        vi.spyOn(DockerService.prototype, "fileOperation").mockImplementation(
          (_image, root, request, signal) => fileOperation(root, request, signal),
        );
      const result = await f.registry.execute(
        "view_image",
        { path: "capture.png" },
        {
          ...f.context,
          toolName: "view_image",
        },
      );
      expect(result.isError, result.output).toBe(false);
      expect(result.images?.[0]?.dataUrl).toBe(`data:image/png;base64,${png.toString("base64")}`);
      expect(f.context.requestApproval).toHaveBeenCalledOnce();
      expect(fileOperation).toHaveBeenCalledWith(
        f.root,
        { operation: "read_binary", path: "capture.png" },
        f.context.signal,
      );
    },
  );
});

describe("persistent command tool boundaries", () => {
  it("routes protected commands through the native launcher and preserves child read-only scope", async () => {
    const prepareCommand = vi.fn(async () => ({
      executable: "trusted-executor",
      args: ["sandbox"],
      cwd: tmpdir(),
      initialInput: '"fixture"\n',
      env: {},
    }));
    const f = await fixture(
      {
        permissionMode: "request_approval",
        parentSessionId: "parent",
      },
      { prepareCommand },
    );
    const started = await f.registry.execute(
      "exec_command",
      {
        command: "Write-Output ready",
        yield_time_ms: 0,
      },
      f.context,
    );
    expect(started.commandSession?.running).toBe(true);
    expect(started.output).toContain("not a PTY");
    expect(prepareCommand).toHaveBeenCalledWith(
      f.root,
      "Write-Output ready",
      f.context.signal,
      expect.objectContaining({ readOnly: true }),
    );
    expect(spawn.mock.calls[0]?.[0]).toBe("trusted-executor");
    expect(f.registry.hasRunningCommands("run")).toBe(true);
    const process = processFixture;
    process?.stdout.write("ready\n");
    const poll = await f.registry.execute(
      "write_stdin",
      {
        session_id: started.commandSession?.id,
        yield_time_ms: 0,
      },
      { ...f.context, toolName: "write_stdin" },
    );
    expect(poll.output).toContain("ready");
    expect(f.context.requestApproval).toHaveBeenCalledOnce();
    await f.registry.cancelRun("run");
    expect(f.registry.hasRunningCommands("run")).toBe(false);
    expect(f.registry.commandSessions("run")).toEqual([]);
  });

  it("checks each stdin operation, denies dangerous input and rejects another run's handle", async () => {
    const prepareCommand = vi.fn(async () => ({
      executable: "trusted-executor",
      args: [],
      cwd: tmpdir(),
      env: {},
      initialInput: "",
    }));
    const f = await fixture({ permissionMode: "request_approval" }, { prepareCommand });
    const started = await f.registry.execute(
      "exec_command",
      {
        command: "node ./interactive.cjs",
        yield_time_ms: 0,
      },
      f.context,
    );
    const stdin = vi.fn();
    processFixture?.stdin.on("data", stdin);
    const args = { session_id: started.commandSession?.id, chars: "hello\n", yield_time_ms: 0 };
    await f.registry.execute("write_stdin", args, { ...f.context, toolName: "write_stdin" });
    await f.registry.execute("write_stdin", args, { ...f.context, toolName: "write_stdin" });
    expect(f.context.requestApproval).toHaveBeenCalledTimes(3);
    expect(stdin).toHaveBeenCalledTimes(2);
    const request = vi.mocked(f.context.requestApproval).mock.calls.at(-1)?.[0];
    expect(request?.commandPrefix).toBeNull();
    const danger = await f.registry.execute(
      "write_stdin",
      {
        ...args,
        chars: "format.com C: /q",
      },
      f.context,
    );
    expect(danger.isError).toBe(true);
    expect(stdin).toHaveBeenCalledTimes(2);
    const other = await f.registry.execute("write_stdin", args, {
      ...f.context,
      runId: "other",
    });
    expect(other.output).toContain("COMMAND_SESSION_NOT_FOUND");
    expect(stdin).toHaveBeenCalledTimes(2);
  });

  it("stops a handle if its permission scope changes", async () => {
    const f = await fixture();
    const started = await f.registry.execute(
      "exec_command",
      {
        command: "Write-Output fixture",
        yield_time_ms: 0,
      },
      f.context,
    );
    f.context.session.permissionMode = "request_approval";
    const result = await f.registry.execute(
      "write_stdin",
      {
        session_id: started.commandSession?.id,
        yield_time_ms: 0,
      },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("COMMAND_SCOPE_CHANGED");
    expect(f.registry.hasRunningCommands("run")).toBe(false);
  });

  it("checks scope again after an input approval resolves", async () => {
    const prepareCommand = vi.fn(async () => ({
      executable: "trusted-executor",
      args: [],
      cwd: tmpdir(),
      env: {},
      initialInput: "",
    }));
    const f = await fixture({ permissionMode: "request_approval" }, { prepareCommand });
    const started = await f.registry.execute(
      "exec_command",
      { command: "node ./interactive.cjs", yield_time_ms: 0 },
      f.context,
    );
    let resolveApproval!: () => void;
    let notifyApproval!: () => void;
    const approved = new Promise<void>((resolve) => {
      resolveApproval = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      notifyApproval = resolve;
    });
    f.context.requestApproval = vi.fn(async () => {
      notifyApproval();
      await approved;
      return { approvalId: "input", decision: "allow_once" as const };
    });
    const stdin = vi.fn();
    processFixture?.stdin.on("data", stdin);
    const pending = f.registry.execute(
      "write_stdin",
      { session_id: started.commandSession?.id, chars: "untrusted\n", yield_time_ms: 0 },
      { ...f.context, toolName: "write_stdin" },
    );
    await requested;
    f.context.session.executionMode = "docker";
    resolveApproval();
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.output).toContain("COMMAND_SCOPE_CHANGED");
    expect(stdin).not.toHaveBeenCalled();
    expect(f.registry.hasRunningCommands("run")).toBe(false);
  });

  it("keeps Docker child mounts read-only and cleans its named container before completion", async () => {
    const f = await fixture({ executionMode: "docker", parentSessionId: "parent" });
    const started = await f.registry.execute(
      "exec_command",
      {
        command: "Write-Output fixture",
        yield_time_ms: 0,
      },
      f.context,
    );
    const args = spawn.mock.calls[0]?.[1] as string[];
    expect(args).toContain(`type=bind,source=${f.root},target=/workspace,readonly`);
    expect(args).toContain("-i");
    processFixture?.emit("close", 0);
    const result = await f.registry.execute(
      "write_stdin",
      {
        session_id: started.commandSession?.id,
        yield_time_ms: 1000,
      },
      f.context,
    );
    expect(result.commandSession?.running).toBe(false);
    expect(execFile).toHaveBeenCalledWith(
      expect.any(String),
      ["rm", "-f", expect.stringMatching(/^mingshen-command-/)],
      expect.any(Object),
      expect.any(Function),
    );
  });
});
