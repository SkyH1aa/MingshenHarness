import { type ChildProcess, execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { spawn } from "cross-spawn";
import type { DiagnosticsReport, LspDiagnostic, ToolingServerStatus } from "../../shared/domain";
import { APP_VERSION } from "../../shared/release";
import type { LspServerConfig } from "./project-config-service";

interface LspMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type LspCodeIntelligenceOperation =
  | "definition"
  | "references"
  | "hover"
  | "documentSymbol"
  | "workspaceSymbol"
  | "implementation";

export interface LspCodeIntelligenceInput {
  operation: LspCodeIntelligenceOperation;
  path: string;
  line?: number;
  column?: number;
  query?: string;
}

interface RuntimeServer {
  id: string;
  command: string[];
  extensions: string[];
  environment: Record<string, string>;
  initialization: Record<string, unknown>;
  source: "builtin" | "project";
}

const execFileAsync = promisify(execFile);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("where.exe", [command], {
      windowsHide: true,
      timeout: 3_000,
    });
    return true;
  } catch {
    return false;
  }
}

function severity(value: unknown): LspDiagnostic["severity"] {
  if (value === 2) {
    return "warning";
  }
  if (value === 3) {
    return "info";
  }
  if (value === 4) {
    return "hint";
  }
  return "error";
}

function uriToPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

function messageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class LspProcessClient {
  private readonly child: ChildProcess;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly diagnosticsByUri = new Map<string, LspDiagnostic[]>();
  private stderr = "";
  private initialized = false;
  private lastDiagnosticsAt = 0;

  constructor(
    private readonly server: RuntimeServer,
    private readonly workspacePath: string,
  ) {
    const [command, ...args] = server.command;
    if (!command) {
      throw new Error(`LSP ${server.id} 缺少启动命令。`);
    }
    this.child = spawn(command, args, {
      cwd: workspacePath,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...server.environment },
    });
    this.child.stdout?.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.consume();
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-12_000);
    });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) =>
      this.fail(new Error(`LSP ${server.id} 已退出 (${code})：${this.stderr}`)),
    );
    this.child.stdin?.on("error", (error) => this.fail(error));
  }

  private fail(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  async waitForDiagnostics(paths: string[]): Promise<void> {
    const normalizePath = (path: string) =>
      process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    const expected = paths.map(normalizePath);
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const received = new Set(
        [...this.diagnosticsByUri.keys()].map((uri) => normalizePath(uriToPath(uri))),
      );
      if (
        expected.every((path) => received.has(path)) &&
        Date.now() - this.lastDiagnosticsAt >= 600
      )
        return;
      if (this.child.exitCode !== null) throw new Error(`LSP 已退出：${this.stderr}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`LSP ${this.server.id} 未在 8 秒内发布所有文件诊断，不能确认检查通过。`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(resolve(this.workspacePath)).toString(),
      workspaceFolders: [
        {
          uri: pathToFileURL(resolve(this.workspacePath)).toString(),
          name: this.workspacePath.split(/[\\/]/).at(-1) ?? "workspace",
        },
      ],
      capabilities: {
        workspace: { workspaceFolders: true },
        textDocument: { publishDiagnostics: {} },
        window: { workDoneProgress: false },
      },
      initializationOptions: this.server.initialization,
      clientInfo: { name: "Mingshen Harness", version: APP_VERSION },
    });
    this.notify("initialized", {});
    this.initialized = true;
  }

  async openFiles(paths: string[]): Promise<void> {
    await this.initialize();
    for (const path of paths) {
      const content = await readFile(path, "utf8");
      this.notify("textDocument/didOpen", {
        textDocument: {
          uri: pathToFileURL(path).toString(),
          languageId: languageId(path),
          version: 1,
          text: content,
        },
      });
    }
  }

  diagnostics(): LspDiagnostic[] {
    return [...this.diagnosticsByUri.values()].flat().slice(0, 200);
  }

  async query(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.initialize();
    return await this.request(method, params);
  }

  stderrText(): string {
    return this.stderr;
  }

  async close(): Promise<void> {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("LSP connection closed."));
    }
    this.pending.clear();
    const stopped =
      this.child.exitCode !== null || this.child.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((done) => this.child.once("close", () => done()));
    this.child.stdin?.end();
    let killed = Promise.resolve();
    if (process.platform === "win32" && this.child.pid) {
      const killer = spawn("taskkill.exe", ["/PID", String(this.child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killed = new Promise<void>((done) => {
        killer.once("error", () => {
          this.child.kill();
          done();
        });
        killer.once("close", () => done());
      });
    } else {
      this.child.kill();
    }
    await Promise.all([stopped, killed]);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`LSP ${this.server.id} 请求 ${method} 超时。`));
      }, 15_000);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(payload: LspMessage): void {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    this.child.stdin?.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin?.write(body);
  }

  private consume(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
      if (!Number.isFinite(length)) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) {
        return;
      }
      const body = this.buffer.slice(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.slice(bodyStart + length);
      try {
        const message = JSON.parse(body) as LspMessage;
        this.consumeMessage(message);
      } catch {
        // Ignore malformed output from third-party language servers.
      }
    }
  }

  private consumeMessage(message: LspMessage): void {
    if (message.id !== undefined && message.method) {
      let result: unknown = null;
      if (message.method === "workspace/configuration") {
        const items =
          (message.params as { items?: Array<{ section?: string }> } | undefined)?.items ?? [];
        result = items.map((item) =>
          item.section
            ? (item.section
                .split(".")
                .reduce<unknown>(
                  (value, key) =>
                    value && typeof value === "object"
                      ? (value as Record<string, unknown>)[key]
                      : undefined,
                  this.server.initialization,
                ) ?? null)
            : this.server.initialization,
        );
      } else if (message.method === "workspace/workspaceFolders")
        result = [
          { uri: pathToFileURL(resolve(this.workspacePath)).toString(), name: "workspace" },
        ];
      else if (
        ![
          "client/registerCapability",
          "client/unregisterCapability",
          "window/workDoneProgress/create",
        ].includes(message.method)
      ) {
        this.send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Unsupported client request" },
        });
        return;
      }
      this.send({ jsonrpc: "2.0", id: message.id, result });
      return;
    }
    if (message.id !== undefined) {
      const request = this.pending.get(message.id);
      if (request) {
        clearTimeout(request.timer);
        this.pending.delete(message.id);
        if (message.error) {
          request.reject(new Error(JSON.stringify(message.error)));
        } else {
          request.resolve(message.result);
        }
      }
    }
    if (message.method !== "textDocument/publishDiagnostics") {
      return;
    }
    const params = message.params as
      | { uri?: string; diagnostics?: Array<Record<string, unknown>> }
      | undefined;
    if (!params?.uri) {
      return;
    }
    this.lastDiagnosticsAt = Date.now();
    this.diagnosticsByUri.set(
      params.uri,
      (params.diagnostics ?? []).map((item) => {
        const range =
          item.range && typeof item.range === "object"
            ? (item.range as Record<string, unknown>)
            : {};
        const start =
          range.start && typeof range.start === "object"
            ? (range.start as Record<string, unknown>)
            : {};
        return {
          path: uriToPath(params.uri as string),
          line: Number(start.line ?? 0) + 1,
          column: Number(start.character ?? 0) + 1,
          severity: severity(item.severity),
          message: String(item.message ?? ""),
          source: String(item.source ?? this.server.id),
        };
      }),
    );
  }
}

function languageId(path: string): string {
  const extension = extname(path).toLowerCase();
  if ([".ts", ".mts", ".cts"].includes(extension)) {
    return "typescript";
  }
  if ([".tsx"].includes(extension)) {
    return "typescriptreact";
  }
  if ([".js", ".mjs", ".cjs"].includes(extension)) {
    return "javascript";
  }
  if (extension === ".jsx") {
    return "javascriptreact";
  }
  if (extension === ".py") {
    return "python";
  }
  if (extension === ".rs") {
    return "rust";
  }
  if (extension === ".go") {
    return "go";
  }
  const languageIds: Record<string, string> = {
    ".pyi": "python",
    ".h": "c",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".hh": "cpp",
    ".hxx": "cpp",
    ".cs": "csharp",
    ".sh": "shellscript",
    ".bash": "shellscript",
    ".zsh": "shellscript",
    ".yml": "yaml",
    ".htm": "html",
  };
  if (languageIds[extension]) return languageIds[extension];
  return extension.replace(/^\./, "") || "plaintext";
}

function matchesExtension(path: string, extensions: string[]): boolean {
  const extension = extname(path).toLowerCase();
  return extensions.some((entry) => {
    const normalized = entry.toLowerCase();
    return normalized === extension || normalized === `*${extension}`;
  });
}

export class LspDiagnosticsService {
  constructor(private readonly bundledRuntimeDirectory: string) {}

  async status(
    workspacePath: string,
    configured: LspServerConfig[],
  ): Promise<ToolingServerStatus[]> {
    const servers = await this.configuredRuntimeServers(workspacePath, configured);
    const result: ToolingServerStatus[] = [];
    for (const server of servers) {
      const command = server.command[0] ?? "";
      const available = command
        ? command.includes("/") || command.includes("\\")
          ? await exists(command)
          : await commandAvailable(command)
        : false;
      result.push({
        id: server.id,
        name: server.id,
        kind: "lsp",
        command: server.command,
        extensions: server.extensions,
        available,
        source: server.source,
        error: available ? null : "未找到语言服务器启动命令。",
      });
    }
    for (const server of configured.filter((item) => item.disabled))
      result.push({
        id: server.id,
        name: server.id,
        kind: "lsp",
        command: server.command,
        extensions: server.extensions,
        available: false,
        source: "project",
        error: "已在项目配置中禁用。",
      });
    return result;
  }

  async diagnostics(
    workspacePath: string,
    changedPaths: string[],
    configuredServers: LspServerConfig[] = [],
    onStart?: () => void,
  ): Promise<DiagnosticsReport | null> {
    const servers = await this.configuredRuntimeServers(workspacePath, configuredServers);
    const reports: Array<{
      server: RuntimeServer;
      diagnostics: LspDiagnostic[];
      error: string | null;
    }> = [];
    const startedAt = Date.now();

    for (const server of servers) {
      const files = changedPaths.filter((path) => matchesExtension(path, server.extensions));
      if (files.length === 0) {
        continue;
      }
      if (reports.length === 0) onStart?.();
      const client = new LspProcessClient(server, workspacePath);
      try {
        await client.openFiles(files);
        await client.waitForDiagnostics(files);
        reports.push({ server, diagnostics: client.diagnostics(), error: null });
      } catch (error) {
        reports.push({
          server,
          diagnostics: [],
          error: messageText(error) || client.stderrText(),
        });
      } finally {
        await client.close();
      }
    }

    if (reports.length === 0) {
      return null;
    }
    const diagnostics = reports.flatMap((report) => report.diagnostics).slice(0, 200);
    const errors = reports
      .map((report) => report.error)
      .filter((error): error is string => Boolean(error));
    return {
      ok: !diagnostics.some((item) => item.severity === "error") && errors.length === 0,
      engine: reports.map((report) => report.server.id).join(", "),
      servers: reports.map((report) => report.server.id),
      durationMs: Date.now() - startedAt,
      diagnostics,
      error: errors.length > 0 ? errors.join("\n").slice(0, 12_000) : null,
    };
  }

  async codeIntelligence(
    workspacePath: string,
    input: LspCodeIntelligenceInput,
    configuredServers: LspServerConfig[] = [],
  ): Promise<{ engine: string; result: unknown }> {
    const servers = await this.configuredRuntimeServers(workspacePath, configuredServers);
    const target = resolve(workspacePath, input.path);
    const server =
      input.operation === "workspaceSymbol"
        ? servers[0]
        : servers.find((candidate) => matchesExtension(target, candidate.extensions));
    if (!server) {
      throw new Error(`没有可用于 ${target} 的 LSP Server。`);
    }
    const client = new LspProcessClient(server, workspacePath);
    try {
      if (input.operation !== "workspaceSymbol") await client.openFiles([target]);
      const position = {
        line: Math.max(0, (input.line ?? 1) - 1),
        character: Math.max(0, (input.column ?? 1) - 1),
      };
      const textDocument = {
        uri: pathToFileURL(target).toString(),
      };
      let result: unknown;
      switch (input.operation) {
        case "definition":
          result = await client.query("textDocument/definition", {
            textDocument,
            position,
          });
          break;
        case "references":
          result = await client.query("textDocument/references", {
            textDocument,
            position,
            context: { includeDeclaration: true },
          });
          break;
        case "hover":
          result = await client.query("textDocument/hover", {
            textDocument,
            position,
          });
          break;
        case "documentSymbol":
          result = await client.query("textDocument/documentSymbol", {
            textDocument,
          });
          break;
        case "workspaceSymbol":
          result = await client.query("workspace/symbol", {
            query: input.query ?? "",
          });
          break;
        case "implementation":
          result = await client.query("textDocument/implementation", {
            textDocument,
            position,
          });
          break;
      }
      return { engine: server.id, result };
    } finally {
      await client.close();
    }
  }

  private async configuredRuntimeServers(
    workspacePath: string,
    configuredServers: LspServerConfig[],
  ): Promise<RuntimeServer[]> {
    const overridden = new Set(configuredServers.map((server) => server.id));
    return [
      ...configuredServers
        .filter((server) => !server.disabled)
        .map(
          (server): RuntimeServer => ({
            id: server.id,
            command: server.command,
            extensions: server.extensions,
            environment: server.environment,
            initialization: server.initialization,
            source: "project",
          }),
        ),
      ...[await this.typescriptServer(workspacePath), ...(await this.extraBuiltinServers())].filter(
        (server) => server && !overridden.has(server.id),
      ),
    ].filter((server): server is RuntimeServer => Boolean(server));
  }

  private async typescriptServer(workspacePath: string): Promise<RuntimeServer | null> {
    const serverCandidates = [
      join(workspacePath, "node_modules", "typescript-language-server", "lib", "cli.mjs"),
      join(process.cwd(), "node_modules", "typescript-language-server", "lib", "cli.mjs"),
      join(this.bundledRuntimeDirectory, "typescript-language-server", "lib", "cli.mjs"),
    ];
    const serverIndex = (await Promise.all(serverCandidates.map(exists))).findIndex(Boolean);
    if (serverIndex === -1) {
      return null;
    }
    const server = serverCandidates[serverIndex] as string;
    const tsserverCandidates = [
      join(workspacePath, "node_modules", "typescript", "lib", "tsserver.js"),
      join(process.cwd(), "node_modules", "typescript", "lib", "tsserver.js"),
      join(this.bundledRuntimeDirectory, "typescript", "lib", "tsserver.js"),
    ];
    const tsserverIndex = (await Promise.all(tsserverCandidates.map(exists))).findIndex(Boolean);
    const tsserver = tsserverIndex === -1 ? null : tsserverCandidates[tsserverIndex];
    return {
      id: "typescript",
      command: [process.execPath, server, "--stdio"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
      environment: { ELECTRON_RUN_AS_NODE: "1" },
      initialization: tsserver ? { tsserver: { path: tsserver } } : {},
      source: "builtin",
    };
  }

  private async extraBuiltinServers(): Promise<RuntimeServer[]> {
    const definitions = [
      {
        id: "intelephense",
        command: ["intelephense", "--stdio"],
        executable: "intelephense",
        extensions: [".php"],
      },
      {
        id: "vscode-json",
        command: ["vscode-json-language-server", "--stdio"],
        executable: "vscode-json-language-server",
        extensions: [".json", ".jsonc"],
      },
      {
        id: "vscode-html",
        command: ["vscode-html-language-server", "--stdio"],
        executable: "vscode-html-language-server",
        extensions: [".html", ".htm"],
      },
      {
        id: "vscode-css",
        command: ["vscode-css-language-server", "--stdio"],
        executable: "vscode-css-language-server",
        extensions: [".css", ".scss", ".less"],
      },
      { id: "jdtls", command: ["jdtls"], executable: "jdtls", extensions: [".java"] },
      { id: "csharp", command: ["csharp-ls"], executable: "csharp-ls", extensions: [".cs"] },
      {
        id: "pyright",
        command: ["pyright-langserver", "--stdio"],
        executable: "pyright-langserver",
        extensions: [".py", ".pyi"],
      },
      {
        id: "gopls",
        command: ["gopls"],
        executable: "gopls",
        extensions: [".go"],
      },
      {
        id: "rust-analyzer",
        command: ["rust-analyzer"],
        executable: "rust-analyzer",
        extensions: [".rs"],
      },
      {
        id: "clangd",
        command: ["clangd"],
        executable: "clangd",
        extensions: [".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".hh", ".hxx"],
      },
      {
        id: "bash-language-server",
        command: ["bash-language-server", "start"],
        executable: "bash-language-server",
        extensions: [".sh", ".bash", ".zsh", ".ksh"],
      },
      {
        id: "yaml-language-server",
        command: ["yaml-language-server", "--stdio"],
        executable: "yaml-language-server",
        extensions: [".yaml", ".yml"],
      },
    ];
    const available = await Promise.all(
      definitions.map((definition) => commandAvailable(definition.executable)),
    );
    return definitions
      .filter((_definition, index) => available[index])
      .map((definition) => ({
        id: definition.id,
        command: definition.command,
        extensions: definition.extensions,
        environment: {},
        initialization: {},
        source: "builtin" as const,
      }));
  }
}
