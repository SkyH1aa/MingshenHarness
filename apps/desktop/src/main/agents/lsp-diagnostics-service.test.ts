import { EventEmitter } from "node:events";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { spawn } from "cross-spawn";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { readGuardedFile, stopGuardedWorkspaceIo } from "../workspace/guarded-workspace-io";
import { LspDiagnosticsService, MAX_LSP_WORKSPACE_FILE_BYTES } from "./lsp-diagnostics-service";

vi.mock("cross-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cross-spawn")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

vi.mock("../workspace/guarded-workspace-io", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../workspace/guarded-workspace-io")>();
  return { ...actual, readGuardedFile: vi.fn(actual.readGuardedFile) };
});

const temporaryDirectories: string[] = [];

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function controlledLsp() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    pid: undefined as number | undefined,
    kill: vi.fn(() => true),
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  const service = new LspDiagnosticsService(join(process.cwd(), "resources", "lsp"));
  vi.spyOn(
    service as unknown as { configuredRuntimeServers: () => Promise<unknown[]> },
    "configuredRuntimeServers",
  ).mockResolvedValue([
    {
      id: "project-powershell",
      command: ["missing-language-server.exe"],
      extensions: [".ps1"],
      environment: {},
      initialization: {},
      source: "project",
    },
  ]);
  const onStart = vi.fn();
  return {
    child,
    onStart,
    run: () =>
      service.diagnostics(process.cwd(), [join(process.cwd(), "fixture.ps1")], [], onStart),
  };
}

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

afterAll(async () => {
  await stopGuardedWorkspaceIo();
});

describe("LspDiagnosticsService", () => {
  it("receives TypeScript diagnostics over LSP JSON-RPC", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-lsp-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true },
        include: ["src/**/*.ts"],
      }),
      "utf8",
    );
    const source = join(root, "src", "index.ts");
    await writeFile(source, "const value: string = 1;\n", "utf8");

    const report = await new LspDiagnosticsService(
      join(process.cwd(), "resources", "lsp"),
    ).diagnostics(root, [source]);
    expect(report?.engine).toContain("typescript");
    expect(
      report?.diagnostics.some((item) => item.severity === "error"),
      JSON.stringify(report),
    ).toBe(true);
    expect(report?.diagnostics[0]?.path.toLowerCase()).toBe(resolve(source).toLowerCase());
  }, 20_000);

  it("runs a project-configured custom stdio LSP server", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-lsp-"));
    temporaryDirectories.push(root);
    const source = join(root, "sample.demo");
    await writeFile(source, "broken\n", "utf8");
    const server = join(root, "server.mjs");
    await writeFile(
      server,
      `
        let buffer = Buffer.alloc(0);
        const send = (payload) => {
          const body = Buffer.from(JSON.stringify(payload));
          process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n");
          process.stdout.write(body);
        };
        process.stdin.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (true) {
            const end = buffer.indexOf("\\r\\n\\r\\n");
            if (end < 0) return;
            const header = buffer.slice(0, end).toString();
            const length = Number(/Content-Length: (\\d+)/.exec(header)[1]);
            if (buffer.length < end + 4 + length) return;
            const message = JSON.parse(buffer.slice(end + 4, end + 4 + length).toString());
            buffer = buffer.slice(end + 4 + length);
            if (message.id) send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
            if (message.method === "textDocument/didOpen") {
              send({
                jsonrpc: "2.0",
                method: "textDocument/publishDiagnostics",
                params: {
                  uri: message.params.textDocument.uri,
                  diagnostics: [{
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    severity: 1,
                    source: "custom-demo",
                    message: "custom diagnostic"
                  }]
                }
              });
            }
          }
        });
      `,
      "utf8",
    );
    const onStart = vi.fn();
    const report = await new LspDiagnosticsService(
      join(process.cwd(), "resources", "lsp"),
    ).diagnostics(
      root,
      [source],
      [
        {
          id: "custom-demo",
          command: [process.execPath, server],
          extensions: [".demo"],
          disabled: false,
          environment: {},
          initialization: {},
        },
      ],
      onStart,
    );

    expect(report?.servers).toContain("custom-demo");
    expect(report?.diagnostics[0]?.message).toBe("custom diagnostic");
    expect(onStart).toHaveBeenCalledOnce();
  }, 20_000);
  it("announces and reports a missing explicitly configured language server", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-missing-lsp-"));
    temporaryDirectories.push(root);
    const source = join(root, "setup.ps1");
    await writeFile(source, "Write-Output 'ok'\n", "utf8");
    const onStart = vi.fn();
    const report = await new LspDiagnosticsService(
      join(process.cwd(), "resources", "lsp"),
    ).diagnostics(
      root,
      [source],
      [
        {
          id: "project-powershell",
          command: [join(root, "missing-language-server.exe")],
          extensions: [".ps1"],
          disabled: false,
          environment: {},
          initialization: {},
        },
      ],
      onStart,
    );
    expect(onStart).toHaveBeenCalledOnce();
    expect(report).toMatchObject({
      ok: false,
      engine: "project-powershell",
      servers: ["project-powershell"],
      error: expect.stringContaining("missing-language-server.exe"),
    });
  }, 20_000);

  it("preserves a startup error and an earlier close while a guarded read is pending", async () => {
    const readStarted = deferred<void>();
    const readSignal = deferred<AbortSignal>();
    const read = deferred<Awaited<ReturnType<typeof readGuardedFile>>>();
    vi.mocked(readGuardedFile).mockImplementationOnce((_root, _path, _maxBytes, options) => {
      readSignal.resolve(options?.signal as AbortSignal);
      readStarted.resolve();
      return read.promise;
    });
    const { child, onStart, run } = controlledLsp();
    const writes = vi.spyOn(child.stdin, "write");
    const reportPromise = run();
    const startupError = new Error("spawn missing-language-server.exe ENOENT");
    try {
      await readStarted.promise;
      child.emit("error", startupError);
      child.emit("close", null, null);

      const report = await reportPromise;
      expect(onStart).toHaveBeenCalledOnce();
      expect(report).toMatchObject({
        ok: false,
        engine: "project-powershell",
        error: startupError.message,
      });
      expect(writes).not.toHaveBeenCalled();
      expect(child.kill).not.toHaveBeenCalled();
      expect((await readSignal.promise).aborted).toBe(true);
    } finally {
      read.resolve({ buffer: Buffer.from("content"), size: 7, sha256: "fixture" });
      child.emit("close", null, null);
      vi.mocked(readGuardedFile).mockReset();
      vi.mocked(spawn).mockReset();
    }
  }, 20_000);

  it("reports an early pipe error without inventing a missing executable error", async () => {
    const readStarted = deferred<void>();
    const read = deferred<Awaited<ReturnType<typeof readGuardedFile>>>();
    vi.mocked(readGuardedFile).mockImplementationOnce(() => {
      readStarted.resolve();
      return read.promise;
    });
    const { child, run } = controlledLsp();
    const closeRequested = deferred<void>();
    child.kill.mockImplementation(() => {
      closeRequested.resolve();
      return true;
    });
    const reportPromise = run();
    try {
      await readStarted.promise;
      child.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      await closeRequested.promise;
      child.emit("close", null, null);

      const report = await reportPromise;
      expect(report?.error).toContain("missing-language-server.exe");
      expect(report?.error).toContain("write EPIPE");
      expect(report?.error).not.toContain("ENOENT");
    } finally {
      read.resolve({ buffer: Buffer.from("content"), size: 7, sha256: "fixture" });
      child.emit("close", null, null);
      vi.mocked(readGuardedFile).mockReset();
      vi.mocked(spawn).mockReset();
    }
  }, 20_000);

  it("reports both an early pipe error and a later observed spawn error", async () => {
    const readStarted = deferred<void>();
    const read = deferred<Awaited<ReturnType<typeof readGuardedFile>>>();
    vi.mocked(readGuardedFile).mockImplementationOnce(() => {
      readStarted.resolve();
      return read.promise;
    });
    const { child, run } = controlledLsp();
    const closeRequested = deferred<void>();
    child.kill.mockImplementation(() => {
      closeRequested.resolve();
      return true;
    });
    const reportPromise = run();
    try {
      await readStarted.promise;
      child.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      await closeRequested.promise;
      child.emit("error", new Error("spawn missing-language-server.exe ENOENT"));
      child.emit("close", null, null);

      const report = await reportPromise;
      expect(report?.error).toContain("write EPIPE");
      expect(report?.error).toContain("spawn missing-language-server.exe ENOENT");
    } finally {
      read.resolve({ buffer: Buffer.from("content"), size: 7, sha256: "fixture" });
      child.emit("close", null, null);
      vi.mocked(readGuardedFile).mockReset();
      vi.mocked(spawn).mockReset();
    }
  }, 20_000);

  it("rejects pending requests with the original error and waits for the child to close", async () => {
    const requestStarted = deferred<void>();
    const closeRequested = deferred<void>();
    vi.mocked(readGuardedFile).mockResolvedValueOnce({
      buffer: Buffer.from("content"),
      size: 7,
      sha256: "fixture",
    });
    const { child, run } = controlledLsp();
    child.stdin.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes('"method":"initialize"')) requestStarted.resolve();
    });
    child.kill.mockImplementation(() => {
      closeRequested.resolve();
      return true;
    });
    const settled = vi.fn();
    const reportPromise = run();
    void reportPromise.then(settled, settled);
    const startupError = new Error("spawn missing-language-server.exe ENOENT");
    try {
      await requestStarted.promise;
      child.emit("error", startupError);
      child.stdin.emit("error", new Error("write EPIPE"));
      await closeRequested.promise;
      expect(settled).not.toHaveBeenCalled();
      child.emit("close", null, null);

      expect(await reportPromise).toMatchObject({ ok: false, error: startupError.message });
    } finally {
      child.emit("close", null, null);
      vi.mocked(readGuardedFile).mockReset();
      vi.mocked(spawn).mockReset();
    }
  }, 20_000);

  it("waits for close even when the child already has an exit code", async () => {
    const readStarted = deferred<void>();
    const read = deferred<Awaited<ReturnType<typeof readGuardedFile>>>();
    vi.mocked(readGuardedFile).mockImplementationOnce(() => {
      readStarted.resolve();
      return read.promise;
    });
    const { child, run } = controlledLsp();
    const inputFinished = deferred<void>();
    child.stdin.once("finish", () => inputFinished.resolve());
    const settled = vi.fn();
    const reportPromise = run();
    void reportPromise.then(settled, settled);
    try {
      await readStarted.promise;
      child.exitCode = 1;
      child.emit("error", new Error("spawn missing-language-server.exe ENOENT"));
      await inputFinished.promise;
      expect(settled).not.toHaveBeenCalled();
      expect(child.kill).not.toHaveBeenCalled();
      child.emit("close", 1, null);

      expect(await reportPromise).toMatchObject({
        ok: false,
        error: "spawn missing-language-server.exe ENOENT",
      });
    } finally {
      read.resolve({ buffer: Buffer.from("content"), size: 7, sha256: "fixture" });
      child.emit("close", 1, null);
      vi.mocked(readGuardedFile).mockReset();
      vi.mocked(spawn).mockReset();
    }
  }, 20_000);

  it("reports unconfirmed cleanup instead of waiting forever for close", async () => {
    const readStarted = deferred<void>();
    const read = deferred<Awaited<ReturnType<typeof readGuardedFile>>>();
    vi.mocked(readGuardedFile).mockImplementationOnce(() => {
      readStarted.resolve();
      return read.promise;
    });
    const { child, run } = controlledLsp();
    const closeRequested = deferred<void>();
    child.kill.mockImplementation(() => {
      closeRequested.resolve();
      return true;
    });
    const reportPromise = run();
    try {
      await readStarted.promise;
      vi.useFakeTimers();
      child.emit("error", new Error("spawn missing-language-server.exe ENOENT"));
      await closeRequested.promise;
      await vi.advanceTimersByTimeAsync(5_000);

      const report = await reportPromise;
      expect(report?.error).toContain("spawn missing-language-server.exe ENOENT");
      expect(report?.error).toContain("清理未确认");
    } finally {
      vi.useRealTimers();
      read.resolve({ buffer: Buffer.from("content"), size: 7, sha256: "fixture" });
      child.emit("close", null, null);
      vi.mocked(readGuardedFile).mockReset();
      vi.mocked(spawn).mockReset();
    }
  }, 20_000);

  it("queries hover information through a custom stdio LSP server", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-lsp-query-"));
    temporaryDirectories.push(root);
    const source = join(root, "sample.demo");
    await writeFile(source, "value\n", "utf8");
    const server = join(root, "server.mjs");
    await writeFile(
      server,
      `
        let buffer = Buffer.alloc(0);
        const send = (payload) => {
          const body = Buffer.from(JSON.stringify(payload));
          process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n");
          process.stdout.write(body);
        };
        process.stdin.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (true) {
            const end = buffer.indexOf("\\r\\n\\r\\n");
            if (end < 0) return;
            const header = buffer.slice(0, end).toString();
            const length = Number(/Content-Length: (\\d+)/.exec(header)[1]);
            if (buffer.length < end + 4 + length) return;
            const message = JSON.parse(buffer.slice(end + 4, end + 4 + length).toString());
            buffer = buffer.slice(end + 4 + length);
            if (message.method === "textDocument/hover") {
              send({
                jsonrpc: "2.0",
                id: message.id,
                result: { contents: { kind: "plaintext", value: "demo hover" } }
              });
            } else if (message.id) {
              send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
            }
          }
        });
      `,
      "utf8",
    );
    const result = await new LspDiagnosticsService(
      join(process.cwd(), "resources", "lsp"),
    ).codeIntelligence(root, { operation: "hover", path: source, line: 1, column: 1 }, [
      {
        id: "custom-query",
        command: [process.execPath, server],
        extensions: [".demo"],
        disabled: false,
        environment: {},
        initialization: {},
      },
    ]);
    expect(result.engine).toBe("custom-query");
    expect(JSON.stringify(result.result)).toContain("demo hover");
  }, 20_000);

  it("rejects files outside the workspace before starting a language server", async () => {
    const base = await mkdtemp(join(tmpdir(), "mingshen-lsp-boundary-"));
    temporaryDirectories.push(base);
    const workspace = join(base, "workspace");
    const outside = join(base, "outside.demo");
    await mkdir(workspace);
    await writeFile(outside, "outside sentinel", "utf8");
    const onStart = vi.fn();
    const service = new LspDiagnosticsService(join(process.cwd(), "resources", "lsp"));
    const configured = [
      {
        id: "boundary-demo",
        command: [join(workspace, "must-not-start.exe")],
        extensions: [".demo"],
        disabled: false,
        environment: {},
        initialization: {},
      },
    ];

    const report = await service.diagnostics(workspace, [outside], configured, onStart);
    expect(onStart).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      ok: false,
      engine: "workspace-path-guard",
      servers: [],
      diagnostics: [],
      error: expect.stringContaining("超出工作区"),
    });
    await expect(
      service.codeIntelligence(
        workspace,
        { operation: "hover", path: outside, line: 1, column: 1 },
        configured,
      ),
    ).rejects.toThrow("超出工作区");
  });

  it("rejects source files larger than the LSP read budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-lsp-size-"));
    temporaryDirectories.push(root);
    const source = join(root, "large.demo");
    await writeFile(source, Buffer.alloc(MAX_LSP_WORKSPACE_FILE_BYTES + 1));
    const onStart = vi.fn();

    const report = await new LspDiagnosticsService(
      join(process.cwd(), "resources", "lsp"),
    ).diagnostics(
      root,
      [source],
      [
        {
          id: "size-demo",
          command: [process.execPath, "-e", "process.stdin.resume()"],
          extensions: [".demo"],
          disabled: false,
          environment: {},
          initialization: {},
        },
      ],
      onStart,
    );

    expect(onStart).toHaveBeenCalledOnce();
    expect(report).toMatchObject({
      ok: false,
      engine: "size-demo",
      servers: ["size-demo"],
      diagnostics: [],
      error: expect.stringMatching(/1 MiB|上限/),
    });
  }, 20_000);

  it.skipIf(process.platform !== "win32")(
    "rejects junctions and hard links before exposing content to a language server",
    async () => {
      const base = await mkdtemp(join(tmpdir(), "mingshen-lsp-links-"));
      temporaryDirectories.push(base);
      const root = join(base, "workspace");
      const outsideDirectory = join(base, "outside");
      await mkdir(root);
      await mkdir(outsideDirectory);
      const outsideFile = join(outsideDirectory, "secret.demo");
      await writeFile(outsideFile, "outside sentinel", "utf8");
      await link(outsideFile, join(root, "hard.demo"));
      await symlink(outsideDirectory, join(root, "linked"), "junction");
      const configured = [
        {
          id: "links-demo",
          command: [process.execPath, "-e", "process.stdin.resume()"],
          extensions: [".demo"],
          disabled: false,
          environment: {},
          initialization: {},
        },
      ];
      const service = new LspDiagnosticsService(join(process.cwd(), "resources", "lsp"));

      const hardLink = await service.diagnostics(root, [join(root, "hard.demo")], configured);
      expect(hardLink).toMatchObject({
        ok: false,
        error: expect.stringContaining("硬链接"),
      });
      const junction = await service.diagnostics(
        root,
        [join(root, "linked", "secret.demo")],
        configured,
      );
      expect(junction).toMatchObject({
        ok: false,
        error: expect.stringMatching(/符号链接|目录链接/),
      });
    },
    20_000,
  );
});
