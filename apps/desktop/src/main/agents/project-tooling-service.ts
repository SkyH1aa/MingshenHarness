import { spawn } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { DiagnosticsReport, LspDiagnostic, ToolingServerStatus } from "../../shared/domain";
import type { LspDiagnosticsService } from "./lsp-diagnostics-service";
import type { FormatterConfig, ProjectConfigService } from "./project-config-service";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_DIAGNOSTICS = 200;
const COMMAND_TIMEOUT = 120_000;
const DIAGNOSTIC_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".pyi",
  ".rs",
  ".go",
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hpp",
  ".hh",
  ".hxx",
  ".java",
  ".cs",
  ".php",
  ".rb",
  ".swift",
  ".kt",
  ".kts",
  ".vue",
  ".svelte",
  ".json",
  ".jsonc",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".yaml",
  ".yml",
  ".sh",
  ".bash",
  ".zsh",
  ".ksh",
  ".ps1",
  ".sql",
  ".lua",
  ".dart",
]);
const PRETTIER_EXTENSIONS =
  /\.(?:[cm]?[jt]sx?|jsonc?|css|scss|less|md|mdx|html?|vue|svelte|ya?ml|graphql|gql)$/i;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  environment: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<CommandResult> {
  signal?.throwIfAborted();
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        ...environment,
      },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let termination: Promise<void> | undefined;
    const terminate = () => {
      if (termination) return;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        termination = new Promise<void>((done) => {
          killer.once("error", () => {
            child.kill();
            done();
          });
          killer.once("close", () => done());
        });
      } else child.kill();
    };
    const abort = () => {
      cancelled = true;
      terminate();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, COMMAND_TIMEOUT);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-100000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-100000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolveResult({ code: 1, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
    });
    child.on("close", async (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      await termination;
      resolveResult({
        code: cancelled ? 1 : code,
        stdout,
        stderr: cancelled ? `${stderr}\nProject tool cancelled; process tree terminated.` : stderr,
        timedOut,
      });
    });
  });
}

export interface DetectedFormatter {
  id: string;
  label: string;
  command: string[];
  extensions: string[];
  environment: Record<string, string>;
  files: string[];
}

function parseTscDiagnostics(workspacePath: string, text: string): LspDiagnostic[] {
  const diagnostics: LspDiagnostic[] = [];
  const pattern = /^(.*?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.+)$/gim;
  for (const match of text.matchAll(pattern)) {
    diagnostics.push({
      path: resolve(workspacePath, match[1] ?? ""),
      line: Number(match[2]),
      column: Number(match[3]),
      severity: (match[4]?.toLowerCase() ?? "error") as LspDiagnostic["severity"],
      message: `${match[5] ?? "TypeScript"} ${match[6] ?? ""}`.trim(),
      source: "typescript",
    });
    if (diagnostics.length >= MAX_DIAGNOSTICS) {
      break;
    }
  }
  return diagnostics;
}

function parseGenericDiagnostics(workspacePath: string, text: string): LspDiagnostic[] {
  const diagnostics: LspDiagnostic[] = [];
  const pattern = /^(.+?):(\d+):(\d+)(?::\s*(error|warning|info|hint))?\s*[-:]?\s*(.+)$/gim;
  for (const match of text.matchAll(pattern)) {
    const rawPath = match[1]?.trim() ?? "";
    if (!rawPath || rawPath.includes("\n")) {
      continue;
    }
    diagnostics.push({
      path: resolve(workspacePath, rawPath),
      line: Number(match[2]),
      column: Number(match[3]),
      severity: (match[4]?.toLowerCase() ?? "error") as LspDiagnostic["severity"],
      message: match[5]?.trim() ?? "",
      source: "project",
    });
    if (diagnostics.length >= MAX_DIAGNOSTICS) {
      break;
    }
  }
  return diagnostics;
}

export class ProjectToolingService {
  constructor(
    private readonly lspDiagnosticsService: LspDiagnosticsService,
    private readonly configService: ProjectConfigService,
  ) {}

  async diagnosticPaths(workspacePath: string, changedPaths: string[]): Promise<string[]> {
    const config = await this.configService.load(workspacePath);
    const candidates = changedPaths.filter(
      (path) =>
        DIAGNOSTIC_EXTENSIONS.has(extname(path).toLowerCase()) ||
        config.lspServers.some(
          (server) => !server.disabled && matchesExtensions(path, server.extensions),
        ),
    );
    return await this.existingWorkspaceFiles(workspacePath, candidates);
  }

  private async existingWorkspaceFiles(workspacePath: string, paths: string[]): Promise<string[]> {
    const files = await Promise.all(
      [...new Set(paths)].map(async (path) => {
        const absolute = resolve(workspacePath, path);
        const local = relative(workspacePath, absolute);
        if (
          !local ||
          isAbsolute(local) ||
          local === ".." ||
          local.startsWith("..\\") ||
          local.startsWith("../")
        )
          return null;
        try {
          return (await stat(absolute)).isFile() ? absolute : null;
        } catch {
          return null;
        }
      }),
    );
    return files.filter((path): path is string => path !== null);
  }

  async detectFormatter(
    workspacePath: string,
    changedPaths: string[],
  ): Promise<DetectedFormatter | null> {
    const files = (await this.existingWorkspaceFiles(workspacePath, changedPaths))
      .map((path) => relative(workspacePath, path).replaceAll("\\", "/"))
      .filter((path) => path && !path.startsWith("../"));
    const config = await this.configService.load(workspacePath);
    const configured = config.formatters
      .filter(
        (formatter) =>
          !formatter.disabled &&
          files.some((path) => matchesExtensions(path, formatter.extensions)),
      )
      .at(-1);
    if (configured) {
      return this.formatterFromConfig(configured, files);
    }
    const configs = await Promise.all([
      exists(join(workspacePath, "biome.json")),
      exists(join(workspacePath, "biome.jsonc")),
      exists(join(workspacePath, ".prettierrc")),
      exists(join(workspacePath, ".prettierrc.json")),
      exists(join(workspacePath, "Cargo.toml")),
      exists(join(workspacePath, "pyproject.toml")),
      exists(join(workspacePath, "go.mod")),
      exists(join(workspacePath, ".clang-format")),
      exists(join(workspacePath, ".editorconfig")),
    ]);
    if (
      (configs[0] || configs[1]) &&
      files.some((file) => /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql)$/i.test(file)) &&
      (await exists(join(workspacePath, "node_modules", "@biomejs", "biome", "bin", "biome")))
    ) {
      return {
        id: "biome",
        label: "Biome",
        command: [
          process.execPath,
          join(workspacePath, "node_modules", "@biomejs", "biome", "bin", "biome"),
          "format",
          "--write",
          "$FILES",
        ],
        extensions: [".js", ".jsx", ".ts", ".tsx", ".json", ".css", ".graphql"],
        environment: {},
        files: files.filter((file) => /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql)$/i.test(file)),
      };
    }
    if (
      (configs[2] || configs[3]) &&
      files.some((file) => PRETTIER_EXTENSIONS.test(file)) &&
      (await exists(join(workspacePath, "node_modules", "prettier", "bin", "prettier.cjs")))
    ) {
      return {
        id: "prettier",
        label: "Prettier",
        command: [
          process.execPath,
          join(workspacePath, "node_modules", "prettier", "bin", "prettier.cjs"),
          "--write",
          "$FILES",
        ],
        extensions: [".js", ".jsx", ".ts", ".tsx", ".json", ".css", ".md"],
        environment: {},
        files: files.filter((file) => PRETTIER_EXTENSIONS.test(file)),
      };
    }
    if (configs[4] && files.some((file) => extname(file) === ".rs")) {
      return {
        id: "rustfmt",
        label: "rustfmt",
        command: ["rustfmt.exe", "$FILES"],
        extensions: [".rs"],
        environment: {},
        files: files.filter((file) => extname(file) === ".rs"),
      };
    }
    if (configs[5] && files.some((file) => /\.pyi?$/i.test(file))) {
      return {
        id: "ruff",
        label: "Ruff",
        command: ["ruff.exe", "format", "$FILES"],
        extensions: [".py", ".pyi"],
        environment: {},
        files: files.filter((file) => /\.pyi?$/i.test(file)),
      };
    }
    if (configs[6] && files.some((file) => extname(file) === ".go")) {
      return {
        id: "gofmt",
        label: "gofmt",
        command: ["gofmt.exe", "-w", "$FILES"],
        extensions: [".go"],
        environment: {},
        files: files.filter((file) => extname(file) === ".go"),
      };
    }
    if (
      configs[7] &&
      files.some((file) => [".c", ".cc", ".cpp", ".h", ".hpp"].includes(extname(file)))
    ) {
      return {
        id: "clang-format",
        label: "clang-format",
        command: ["clang-format.exe", "-i", "$FILES"],
        extensions: [".c", ".cc", ".cpp", ".h", ".hpp"],
        environment: {},
        files: files.filter((file) => [".c", ".cc", ".cpp", ".h", ".hpp"].includes(extname(file))),
      };
    }
    return null;
  }

  async format(
    workspacePath: string,
    formatter: DetectedFormatter,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; output: string }> {
    const [command, ...baseArgs] = formatter.command;
    if (!command) {
      return { ok: false, output: "格式化器缺少启动命令。" };
    }
    const expanded = baseArgs.flatMap((arg) =>
      arg === "$FILES" ? formatter.files : arg.replaceAll("$FILE", formatter.files[0] ?? ""),
    );
    const result = await runCommand(
      command,
      expanded,
      workspacePath,
      formatter.environment,
      signal,
    );
    return {
      ok: result.code === 0 && !result.timedOut,
      output: [result.stdout.trim(), result.stderr.trim()]
        .filter(Boolean)
        .join("\n")
        .slice(0, 20_000),
    };
  }

  async diagnostics(
    workspacePath: string,
    changedPaths: string[],
    onStart?: () => void,
  ): Promise<DiagnosticsReport> {
    const applicablePaths = await this.diagnosticPaths(workspacePath, changedPaths);
    if (applicablePaths.length === 0) {
      return {
        ok: true,
        engine: "not-applicable",
        servers: [],
        durationMs: 0,
        diagnostics: [],
        error: null,
      };
    }
    const config = await this.configService.load(workspacePath);
    const lspReport = await this.lspDiagnosticsService.diagnostics(
      workspacePath,
      applicablePaths,
      config.lspServers,
      onStart,
    );
    if (lspReport) {
      return lspReport;
    }
    const startedAt = Date.now();
    const hasTypeScript = applicablePaths.some((path) => /\.[cm]?[jt]sx?$/i.test(path));
    if (hasTypeScript) {
      const candidates = [
        join(workspacePath, "node_modules", "typescript", "bin", "tsc"),
        join(process.cwd(), "node_modules", "typescript", "bin", "tsc"),
      ];
      const compiler = (await Promise.all(candidates.map(exists))).findIndex(Boolean);
      if (compiler !== -1) {
        onStart?.();
        const result = await runCommand(
          process.execPath,
          [candidates[compiler] as string, "--noEmit", "--pretty", "false"],
          workspacePath,
        );
        const text = [result.stdout, result.stderr].filter(Boolean).join("\n");
        return {
          ok: result.code === 0 && !result.timedOut,
          engine: "TypeScript Language Service",
          servers: ["typescript"],
          durationMs: Date.now() - startedAt,
          diagnostics: parseTscDiagnostics(workspacePath, text),
          error: result.timedOut
            ? "类型检查超时。"
            : result.code === 0
              ? null
              : text.slice(0, 12_000),
        };
      }
    }

    if (
      applicablePaths.some((path) => extname(path).toLowerCase() === ".rs") &&
      (await exists(join(workspacePath, "Cargo.toml")))
    ) {
      onStart?.();
      const result = await runCommand(
        "cargo.exe",
        ["check", "--message-format=short"],
        workspacePath,
      );
      const text = [result.stdout, result.stderr].filter(Boolean).join("\n");
      return {
        ok: result.code === 0 && !result.timedOut,
        engine: "Rust compiler",
        servers: ["rustc"],
        durationMs: Date.now() - startedAt,
        diagnostics: parseGenericDiagnostics(workspacePath, text),
        error: result.timedOut
          ? "Rust 检查超时。"
          : result.code === 0
            ? null
            : text.slice(0, 12_000),
      };
    }

    if (await exists(join(workspacePath, "package.json"))) {
      const packageJson = JSON.parse(
        await readFile(join(workspacePath, "package.json"), "utf8"),
      ) as { scripts?: Record<string, string> };
      if (packageJson.scripts?.typecheck) {
        onStart?.();
        const result = await runCommand("npm.cmd", ["run", "typecheck"], workspacePath);
        const text = [result.stdout, result.stderr].filter(Boolean).join("\n");
        return {
          ok: result.code === 0 && !result.timedOut,
          engine: "package typecheck",
          servers: ["package-typecheck"],
          durationMs: Date.now() - startedAt,
          diagnostics: parseGenericDiagnostics(workspacePath, text),
          error: result.timedOut
            ? "项目检查超时。"
            : result.code === 0
              ? null
              : text.slice(0, 12_000),
        };
      }
    }

    return {
      ok: true,
      engine: "not-configured",
      servers: [],
      durationMs: Date.now() - startedAt,
      diagnostics: [],
      error: null,
    };
  }

  async status(workspacePath: string): Promise<ToolingServerStatus[]> {
    const config = await this.configService.load(workspacePath);
    return [
      ...(await this.lspDiagnosticsService.status(workspacePath, config.lspServers)),
      ...config.formatters.map((formatter) => ({
        id: formatter.id,
        name: formatter.id,
        kind: "formatter" as const,
        command: formatter.command,
        extensions: formatter.extensions,
        available: !formatter.disabled,
        source: "project" as const,
        error: null,
      })),
    ];
  }

  private formatterFromConfig(formatter: FormatterConfig, files: string[]): DetectedFormatter {
    return {
      id: formatter.id,
      label: formatter.id,
      command: formatter.command,
      extensions: formatter.extensions,
      environment: formatter.environment,
      files: files.filter((file) => matchesExtensions(file, formatter.extensions)),
    };
  }
}

function matchesExtensions(path: string, extensions: string[]): boolean {
  const extension = extname(path).toLowerCase();
  return extensions.some((entry) => {
    const normalized = entry.toLowerCase();
    return normalized === extension || normalized === `*${extension}`;
  });
}
