import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  UserCommandResult,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceGitStatus,
} from "../../shared/domain";
import { isDangerousCommand } from "../tools/tool-registry";

const MAX_FILE_BYTES = 2_000_000;
const MAX_OUTPUT = 100_000;
const DEFAULT_TIMEOUT = 120_000;
const WINDOWS_POWERSHELL = process.env.SystemRoot
  ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : "powershell.exe";

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function truncate(value: string): string {
  return value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}\n… output truncated` : value;
}

function ensureInside(root: string, target: string): void {
  const relativePath = relative(resolve(root), resolve(target));
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("目标路径超出工作目录。");
  }
}

function throwPathError(error: unknown, target: string): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    throw new Error(`找不到路径：${target}。请检查文件或目录是否存在。`);
  }
  if (code === "ENOTDIR") {
    throw new Error(`路径中的某一项是文件，不能作为目录打开：${target}。请检查路径。`);
  }
  throw error;
}

async function statPath(target: string) {
  try {
    return await stat(target);
  } catch (error) {
    throwPathError(error, target);
  }
}

async function readTextFile(target: string): Promise<Pick<WorkspaceFile, "content" | "size">> {
  const metadata = await statPath(target);
  if (!metadata.isFile()) {
    throw new Error("目标不是普通文件。若选择了目录，请先在文件列表中选择具体文件。");
  }
  if (metadata.size > MAX_FILE_BYTES) {
    throw new Error("文件超过 2 MB，编辑器不直接打开。");
  }
  let buffer: Buffer;
  try {
    buffer = await readFile(target);
  } catch (error) {
    throwPathError(error, target);
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error("文件超过 2 MB，编辑器不直接打开。");
  }
  const utf16 =
    buffer[0] === 0xff && buffer[1] === 0xfe
      ? "utf-16le"
      : buffer[0] === 0xfe && buffer[1] === 0xff
        ? "utf-16be"
        : null;
  const binaryError = () =>
    new Error(
      "二进制文件不能作为文本编辑。请使用对应应用，Office/PDF 文档可使用文档读取工具查看。",
    );
  if (utf16 ? buffer.length % 2 !== 0 : buffer.includes(0)) {
    throw binaryError();
  }
  const content = utf16
    ? new TextDecoder(utf16).decode(buffer)
    : buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (content.includes("\0")) {
    throw binaryError();
  }
  return { content, size: buffer.length };
}

function killTree(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }
  const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  killer.on("error", () => child.kill());
  killer.on("close", (code) => {
    if (code !== 0 && child.exitCode === null) {
      child.kill();
    }
  });
  killer.unref();
}

function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };
    const finish = (result: ProcessResult) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolveResult({
        exitCode: result.exitCode,
        stdout: truncate(result.stdout),
        stderr: `${truncate(result.stderr)}${timedOut ? "\nProcess timed out." : ""}`,
      });
    };

    timeout = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(0, MAX_OUTPUT + 1);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(0, MAX_OUTPUT + 1);
    });
    child.on("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      finish({
        exitCode: timedOut ? null : code,
        stdout,
        stderr,
      });
    });
  });
}

export class WorkspaceService {
  async list(root: string, relativePath: string): Promise<WorkspaceEntry[]> {
    const target = resolve(root, relativePath || ".");
    ensureInside(root, target);
    const metadata = await statPath(target);
    if (metadata.isFile()) {
      return [
        {
          name: basename(target),
          path: target,
          relativePath: relative(root, target),
          directory: false,
          size: metadata.size,
        },
      ];
    }
    if (!metadata.isDirectory()) {
      throw new Error("目标不是普通文件或目录，请选择工作目录中的文件或目录。");
    }
    const entries = await readdir(target, { withFileTypes: true }).catch((error: unknown) =>
      throwPathError(error, target),
    );
    const results = await Promise.all(
      entries.map(async (entry) => {
        const path = join(target, entry.name);
        let size = 0;
        if (entry.isFile()) {
          try {
            size = (await stat(path)).size;
          } catch {
            size = 0;
          }
        }
        return {
          name: entry.name,
          path,
          relativePath: relative(root, path),
          directory: entry.isDirectory(),
          size,
        } satisfies WorkspaceEntry;
      }),
    );

    return results.sort((a, b) =>
      a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1,
    );
  }

  async readFile(root: string, relativePath: string): Promise<WorkspaceFile> {
    const target = resolve(root, relativePath);
    ensureInside(root, target);
    return {
      path: target,
      relativePath: relative(root, target),
      ...(await readTextFile(target)),
    };
  }

  async readAbsoluteFile(path: string): Promise<WorkspaceFile> {
    if (!isAbsolute(path)) {
      throw new Error("文件路径必须是绝对路径。");
    }
    const target = resolve(path);
    return {
      path: target,
      relativePath: basename(target),
      ...(await readTextFile(target)),
    };
  }

  async writeFile(root: string, relativePath: string, content: string): Promise<void> {
    const target = resolve(root, relativePath);
    ensureInside(root, target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  async writeAbsoluteFile(path: string, content: string): Promise<void> {
    if (!isAbsolute(path)) {
      throw new Error("文件路径必须是绝对路径。");
    }
    const target = resolve(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  async gitStatus(root: string): Promise<WorkspaceGitStatus> {
    const status = await runProcess(
      "git",
      ["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", "status", "--short", "--branch"],
      root,
      15_000,
    );
    if (status.exitCode !== 0) {
      return {
        isRepository: false,
        branch: null,
        statusText: status.stdout.trim(),
        diffStat: "",
        error: status.stderr.trim() || "当前目录不是 Git 仓库。",
      };
    }

    const lines = status.stdout.trim().split(/\r?\n/);
    const branchLine = lines.find((line) => line.startsWith("## "));
    const diff = await runProcess(
      "git",
      ["-c", "core.fsmonitor=false", "diff", "--no-ext-diff", "--no-textconv", "--stat"],
      root,
      15_000,
    );

    return {
      isRepository: true,
      branch: branchLine?.replace(/^##\s+/, "").split("...")[0] ?? null,
      statusText: lines.filter((line) => !line.startsWith("## ")).join("\n"),
      diffStat: diff.stdout.trim(),
      error: null,
    };
  }

  async runCommand(root: string, command: string): Promise<UserCommandResult> {
    const dangerous = isDangerousCommand(command);
    if (dangerous) {
      throw new Error(dangerous);
    }

    const startedAt = performance.now();
    const result = await runProcess(
      WINDOWS_POWERSHELL,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-OutputFormat",
        "Text",
        "-Command",
        `[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;${command}`,
      ],
      root,
    );

    return {
      ...result,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}
