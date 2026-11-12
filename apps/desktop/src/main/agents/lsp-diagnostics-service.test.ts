import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LspDiagnosticsService } from "./lsp-diagnostics-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
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
  });

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
});
