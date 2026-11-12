import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import type { DockerRuntimeSettings } from "../../shared/domain";
import { dockerExecutable } from "./docker-path";

const execFileAsync = promisify(execFile);
const MAX_BINARY_BYTES = 25 * 1024 * 1024;
const MAX_BINARY_BASE64_LENGTH = Math.ceil(MAX_BINARY_BYTES / 3) * 4;

type FileOperationRequest = {
  operation:
    | "read"
    | "read_binary"
    | "write"
    | "write_binary"
    | "delete"
    | "list"
    | "exists"
    | "hash";
  path: string;
  content?: string;
  expectedHash?: string;
  depth?: number;
  maxEntries?: number;
};

function normalizeFileOperationRequest(request: FileOperationRequest): FileOperationRequest {
  if (!request || typeof request.path !== "string" || request.path.length === 0)
    throw new Error("File operation path is required.");
  if (request.operation !== "write_binary" && request.expectedHash !== undefined)
    throw new Error("expectedHash is only valid for write_binary.");
  if (request.operation !== "write_binary") return request;
  if (typeof request.content !== "string") throw new Error("write_binary requires base64 content.");
  if (request.content.length > MAX_BINARY_BASE64_LENGTH)
    throw new Error("Binary content exceeds the 25 MiB limit.");
  if (request.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.content))
    throw new Error("write_binary content must be canonical base64.");
  const bytes = Buffer.from(request.content, "base64");
  if (bytes.length > MAX_BINARY_BYTES) throw new Error("Binary content exceeds the 25 MiB limit.");
  if (bytes.toString("base64") !== request.content)
    throw new Error("write_binary content must be canonical base64.");
  if (
    typeof request.expectedHash !== "string" ||
    !(request.expectedHash === "missing" || /^[0-9a-f]{64}$/i.test(request.expectedHash))
  )
    throw new Error("write_binary requires expectedHash=missing or a SHA-256 hash.");
  return { ...request, expectedHash: request.expectedHash.toLowerCase() };
}

export const DOCKER_SECURITY_ARGS = [
  "--read-only",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--pids-limit=256",
  "--memory=2g",
  "--cpus=2",
  "--tmpfs=/tmp:rw,nosuid,size=134217728",
];

const FILE_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $path = [IO.Path]::GetFullPath('/workspace/' + $request.path)
  if ($path -ne '/workspace' -and -not $path.StartsWith('/workspace/')) { throw 'Path outside workspace' }
  $cursor = $path
  while ($cursor -and $cursor -ne '/') {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if ($item.LinkType) { throw 'Symbolic links are not allowed in sandbox file tools' }
    }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
  $result = $null
  switch ($request.operation) {
    'exists' { $result = [IO.File]::Exists($path) -or [IO.Directory]::Exists($path) }
    'read' { if (-not [IO.File]::Exists($path)) { throw 'FILE_NOT_FOUND' }; if ((Get-Item -LiteralPath $path).Length -gt 25000000) { throw 'File too large' }; $result = [IO.File]::ReadAllText($path) }
    'read_binary' { if (-not [IO.File]::Exists($path)) { throw 'FILE_NOT_FOUND' }; if ((Get-Item -LiteralPath $path).Length -gt 26214400) { throw 'Document too large' }; $result = [Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) }
    'write' { [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null; [IO.File]::WriteAllText($path, [string]$request.content, [Text.UTF8Encoding]::new($false)) }
    'write_binary' {
      if ($null -eq $request.content -or $request.content -isnot [string]) { throw 'Binary content is required' }
      if ($request.content.Length -gt 34952536) { throw 'Binary content too large' }
      try { $bytes = [Convert]::FromBase64String([string]$request.content) } catch { throw 'Invalid base64 content' }
      if ($bytes.Length -gt 26214400) { throw 'Binary content too large' }
      if ([Convert]::ToBase64String($bytes) -cne [string]$request.content) { throw 'Invalid base64 content' }
      $expected = [string]$request.expectedHash
      if ($expected -ne 'missing' -and $expected -notmatch '^[0-9a-fA-F]{64}$') { throw 'Expected SHA-256 hash is required' }
      if ([IO.Directory]::Exists($path)) { throw 'Target is not a regular file' }
      $exists = [IO.File]::Exists($path)
      if ($expected -eq 'missing' -and $exists) { throw 'Target changed before binary write' }
      if ($expected -ne 'missing' -and -not $exists) { throw 'Target is missing before binary write' }
      if ($exists) {
        $current = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($current -cne $expected.ToLowerInvariant()) { throw 'Target changed before binary write' }
      }
      $parent = [IO.Path]::GetDirectoryName($path)
      if ($parent -and -not [IO.Directory]::Exists($parent)) { [IO.Directory]::CreateDirectory($parent) | Out-Null }
      $temp = [IO.Path]::Combine($parent, '.mingshen-write-' + [IO.Path]::GetRandomFileName() + '.tmp')
      try {
        [IO.File]::WriteAllBytes($temp, $bytes)
        if ([IO.File]::Exists($path)) {
          if ($expected -eq 'missing') { throw 'Target changed before binary write' }
          $current = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($current -cne $expected.ToLowerInvariant()) { throw 'Target changed before binary write' }
          [IO.File]::Replace($temp, $path, $null)
        } else {
          if ($expected -ne 'missing') { throw 'Target changed before binary write' }
          [IO.File]::Move($temp, $path)
        }
      } finally {
        if ([IO.File]::Exists($temp)) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
      }
    }
    'hash' {
      if ([IO.Directory]::Exists($path)) { throw 'Target is not a regular file' }
      if (-not [IO.File]::Exists($path)) { $result = 'missing' }
      else {
        if ((Get-Item -LiteralPath $path).Length -gt 26214400) { throw 'Binary file too large' }
        $result = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    }
    'delete' { if (-not [IO.File]::Exists($path)) { throw 'Not a regular file' }; [IO.File]::Delete($path) }
    'list' {
      $queue = [Collections.Generic.Queue[object]]::new()
      $queue.Enqueue(@{ path = $path; depth = 0 })
      $items = [Collections.Generic.List[object]]::new()
      $limit=if($request.maxEntries){[Math]::Min(25000,[Math]::Max(1,$request.maxEntries))}else{2000}
      while ($queue.Count -gt 0 -and $items.Count -lt $limit) {
        $current = $queue.Dequeue()
        foreach ($item in Get-ChildItem -LiteralPath $current.path -Force) {
          if ($item.LinkType -or $item.Name -in @('node_modules', '.git', 'dist', 'out')) { continue }
          $items.Add(@{ path = $item.FullName.Substring(11); directory = $item.PSIsContainer; fingerprint = ([string]$item.Length + ':' + $item.LastWriteTimeUtc.Ticks + ':' + $item.CreationTimeUtc.Ticks) })
          if ($items.Count -ge $limit) { break }
          if ($item.PSIsContainer -and $current.depth + 1 -lt [Math]::Min(64, [Math]::Max(1, $request.depth))) { $queue.Enqueue(@{ path = $item.FullName; depth = $current.depth + 1 }) }
        }
      }
      $result = @($items.ToArray())
    }
    default { throw 'Unsupported file operation' }
  }
  @{ ok = $true; value = $result } | ConvertTo-Json -Depth 12 -Compress
} catch { @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress; exit 1 }
`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class DockerService {
  private readonly images = new Map<string, string>();

  getImage(sessionId: string): string | null {
    return this.images.get(sessionId) ?? null;
  }

  async prepare(
    sessionId: string,
    workspacePath: string,
    settings: DockerRuntimeSettings,
    signal: AbortSignal,
  ): Promise<string> {
    await execFileAsync(dockerExecutable(), ["info", "--format", "{{.ServerVersion}}"], {
      windowsHide: true,
      signal,
      timeout: 15_000,
    });
    if (!settings.dockerfile.trim()) {
      const image = settings.image.trim() || "mcr.microsoft.com/powershell:lts-alpine";
      this.images.set(sessionId, image);
      return image;
    }
    const dockerfile = isAbsolute(settings.dockerfile)
      ? settings.dockerfile
      : resolve(workspacePath, settings.dockerfile);
    const context = isAbsolute(settings.buildContext)
      ? settings.buildContext
      : resolve(workspacePath, settings.buildContext || ".");
    if (!(await exists(dockerfile))) {
      throw new Error(`Dockerfile 不存在：${dockerfile}`);
    }
    const image = `mingshen-session-${createHash("sha1")
      .update(`${sessionId}\0${dockerfile}\0${Date.now()}`)
      .digest("hex")
      .slice(0, 12)}`;
    const result = await execFileAsync(
      dockerExecutable(),
      ["build", "-f", dockerfile, "-t", `${image}:latest`, context],
      {
        cwd: workspacePath,
        windowsHide: true,
        signal,
        timeout: 10 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    if (!result.stdout.trim() && !result.stderr.trim()) {
      throw new Error("Docker 构建没有返回结果。");
    }
    const resolved = `${image}:latest`;
    this.images.set(sessionId, resolved);
    return resolved;
  }

  async fileOperation(
    image: string,
    workspace: string,
    request: FileOperationRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    const normalizedRequest = normalizeFileOperationRequest(request);
    signal.throwIfAborted();
    const { spawn } = await import("node:child_process");
    const containerName = `mingshen-files-${randomUUID()}`;
    return await new Promise((resolveResult, reject) => {
      const child = spawn(
        dockerExecutable(),
        [
          "run",
          "--name",
          containerName,
          "--rm",
          ...DOCKER_SECURITY_ARGS,
          "--network=none",
          "-i",
          "--mount",
          `type=bind,source=${workspace},target=/workspace`,
          "-w",
          "/workspace",
          "--entrypoint",
          "pwsh",
          image,
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(FILE_SCRIPT, "utf16le").toString("base64"),
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      let error = "";
      let cleanupPromise: Promise<unknown> | undefined;
      const cleanup = () => {
        cleanupPromise ??= execFileAsync(dockerExecutable(), ["rm", "-f", containerName], {
          windowsHide: true,
          timeout: 15_000,
        }).catch((cause) => {
          if (!String(cause).includes("No such container"))
            throw new Error(
              `CONTAINER_CLEANUP_UNCONFIRMED: ${containerName}: ${String(cause)}. Verify the container has stopped before new writes.`,
            );
        });
        return cleanupPromise;
      };
      let timedOut = false;
      let failure: unknown;
      const abort = () => {
        child.kill();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        abort();
      }, 30_000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      child.stdin.on("error", () => undefined);
      child.stdout.on("data", (chunk: Buffer) => {
        if (output.length + chunk.length > 64 * 1024 * 1024) {
          failure = new Error("Docker file result exceeded 64 MiB.");
          abort();
        } else output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        error = (error + chunk.toString()).slice(-12000);
      });
      child.once("error", (cause) => {
        failure = cause;
      });
      child.once("close", async (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        try {
          if (signal.aborted || timedOut || failure) {
            await cleanup();
            throw (
              failure ??
              new Error(
                timedOut
                  ? "Docker file tool timed out; container stopped."
                  : "Docker file tool cancelled; container stopped.",
              )
            );
          }
          if (!output.trim())
            throw new Error(`Docker returned no file result (exit ${code ?? "unknown"}).`);
          const result = JSON.parse(output.trim()) as {
            ok: boolean;
            value: unknown;
            error?: string;
          };
          if (!result.ok) throw new Error(result.error);
          if (code !== 0)
            throw new Error(`Docker exited with code ${code ?? "unknown"}; result not accepted.`);
          resolveResult(result.value);
        } catch (cause) {
          reject(new Error(`Docker 文件工具失败：${String(cause)}${error ? `\n${error}` : ""}`));
        }
      });
      child.stdin.end(JSON.stringify(normalizedRequest));
    });
  }
}
