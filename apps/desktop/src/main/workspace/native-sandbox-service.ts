import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const MAX_CAPTURE = 2 * 1024 * 1024;
const MAX_BINARY_BYTES = 25 * 1024 * 1024;
const MAX_BINARY_BASE64_LENGTH = Math.ceil(MAX_BINARY_BYTES / 3) * 4;
export const NATIVE_RUNTIME_VERSION = "0.166.0";
const NATIVE_EXECUTABLE_SHA256 = "9d563ee4e0441ff9d59d612013e0460ddf8e5709735c2d9f6b98b7ef8ca4eb42";

export interface NativeCommandOptions {
  stdin?: string;
  timeoutMs?: number;
  readOnly?: boolean;
  cwd?: string;
  maxCapture?: number;
  readOnlyPaths?: string[];
}

export interface NativeCommandLaunch {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  initialInput: string;
}

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

export function nativeSandboxExecutable(): string {
  return resolve(process.cwd(), "resources/native/codex-sandbox.exe");
}
export function nativeSandboxRoot(): string {
  return join(process.env.LOCALAPPDATA || homedir(), "MingshenHarness", "native-sandbox");
}
export function sandboxEnvironment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATH",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "PROGRAMDATA",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS",
  ])
    if (process.env[key]) environment[key] = process.env[key];
  environment.CODEX_HOME = home;
  environment.CODEX_DISABLE_CLOUD_REQUIREMENTS = "1";
  return environment;
}

export class NativeSandboxService {
  private readonly profiles = new Map<string, Promise<void>>();
  constructor(
    private readonly executable = nativeSandboxExecutable(),
    private readonly root = nativeSandboxRoot(),
  ) {}

  private verify(): Promise<void> {
    return (async () => {
      if ((await lstat(this.executable)).isSymbolicLink())
        throw new Error("Linked sandbox executables are not allowed.");
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(this.executable)) hash.update(chunk);
      if (hash.digest("hex") !== NATIVE_EXECUTABLE_SHA256)
        throw new Error("Native sandbox runtime integrity check failed. Execution blocked.");
    })();
  }

  async prepareCommand(
    workspace: string,
    command: string,
    signal: AbortSignal,
    options: NativeCommandOptions = {},
  ): Promise<NativeCommandLaunch> {
    signal.throwIfAborted();
    if (process.platform !== "win32")
      throw new Error("Native Windows sandbox is only available on Windows.");
    await access(this.executable).catch(() => {
      throw new Error(
        "Native sandbox runtime is missing. Execution was blocked; no host fallback.",
      );
    });
    await this.verify();
    const root = resolve(workspace);
    if ((await lstat(root)).isSymbolicLink())
      throw new Error("Linked workspace roots are not allowed.");
    if (
      root.length <= 3 ||
      root.toLowerCase() === (process.env.SystemRoot || "C:\\Windows").toLowerCase()
    )
      throw new Error("A disk root or Windows directory cannot be a protected workspace.");
    const runtimeRelative = relative(root, resolve(this.root));
    if (!runtimeRelative.startsWith("..") && !isAbsolute(runtimeRelative))
      throw new Error(
        "The protected workspace cannot contain application credentials or sandbox configuration.",
      );
    const cwd = resolve(options.cwd || root);
    const local = relative(root, cwd);
    if (isAbsolute(local) || local === ".." || local.startsWith("..\\"))
      throw new Error("Sandbox working directory must be inside the workspace.");
    const protectedPaths = [...new Set((options.readOnlyPaths ?? []).map((path) => resolve(path)))]
      .sort()
      .map((target) => {
        const local = relative(root, target);
        if (!local || isAbsolute(local) || local === ".." || local.startsWith(`..\\`))
          throw new Error("Protected memory must be inside the workspace.");
        return target;
      });
    const home = join(
      this.root,
      createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 20),
      options.readOnly
        ? "read"
        : protectedPaths.length
          ? `write-protected-${createHash("sha256").update(JSON.stringify(protectedPaths)).digest("hex").slice(0, 20)}`
          : "write",
    );
    let prepared = this.profiles.get(home);
    if (!prepared) {
      prepared = (async () => {
        await mkdir(home, { recursive: true });
        const tomlKey = JSON.stringify(root.replaceAll("\\", "/"));
        const executableKey = JSON.stringify(resolve(this.executable).replaceAll("\\", "/"));
        const protectedRules = protectedPaths
          .map((target) => `${JSON.stringify(target.replaceAll("\\", "/"))} = "read"\n`)
          .join("");
        await writeFile(
          join(home, "config.toml"),
          `default_permissions = "mingshen"\n[windows]\nsandbox = "mxc"\n[permissions.mingshen.filesystem]\n":minimal" = "read"\n${tomlKey} = "${options.readOnly ? "read" : "write"}"\n${protectedRules}${executableKey} = "deny"\n[permissions.mingshen.network]\nenabled = false\n`,
          "utf8",
        );
      })().catch((cause) => {
        this.profiles.delete(home);
        throw cause;
      });
      this.profiles.set(home, prepared);
    }
    await prepared;
    const powershell = join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const bootstrap =
      "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;$ErrorActionPreference='Stop';$global:LASTEXITCODE=0;$source=[Console]::In.ReadLine()|ConvertFrom-Json;& ([ScriptBlock]::Create([string]$source));if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}";
    const args = [
      "-c",
      'windows.sandbox="mxc"',
      "sandbox",
      "-P",
      "mingshen",
      "-C",
      cwd,
      "--",
      powershell,
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-OutputFormat",
      "Text",
      "-EncodedCommand",
      Buffer.from(bootstrap, "utf16le").toString("base64"),
    ];
    signal.throwIfAborted();
    return {
      executable: this.executable,
      args,
      cwd: root,
      env: sandboxEnvironment(home),
      initialInput: `${JSON.stringify(command)}\n`,
    };
  }

  async run(
    workspace: string,
    command: string,
    signal: AbortSignal,
    options: NativeCommandOptions = {},
  ): Promise<{ output: string; exitCode: number | null }> {
    const launch = await this.prepareCommand(workspace, command, signal, options);
    return await new Promise((resolveRun, reject) => {
      const child = spawn(launch.executable, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let limited = false;
      let timedOut = false;
      const stop = () => {
        if (child.pid)
          void execute("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            timeout: 5000,
          }).catch(() => undefined);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, options.timeoutMs || 120_000);
      const abort = () => stop();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) stop();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      const collect = (chunk: string, error: boolean) => {
        if (error) stderr += chunk;
        else stdout += chunk;
        if (stdout.length + stderr.length > (options.maxCapture || MAX_CAPTURE)) {
          limited = true;
          stop();
        }
      };
      child.stdout.on("data", (chunk) => collect(chunk, false));
      child.stderr.on("data", (chunk) => collect(chunk, true));
      child.stdin.on("error", () => undefined);
      child.stdin.end(`${launch.initialInput}${options.stdin || ""}`);
      child.once("error", (cause) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(cause);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          reject(new Error("Native sandbox operation canceled."));
          return;
        }
        if (timedOut || limited) {
          reject(
            new Error(
              timedOut
                ? "Native sandbox timed out; its process tree was stopped."
                : "Native sandbox output exceeded 2 MiB.",
            ),
          );
          return;
        }
        resolveRun({
          output: [stdout.trim(), stderr.trim()].filter(Boolean).join("\n"),
          exitCode: code,
        });
      });
    });
  }

  async status(workspace: string): Promise<{ ready: boolean; detail: string }> {
    try {
      const result = await this.run(
        workspace,
        "'MINGSHEN_NATIVE_SANDBOX_OK'",
        AbortSignal.timeout(20_000),
        { readOnly: true, timeoutMs: 15_000 },
      );
      return {
        ready: result.exitCode === 0 && result.output.includes("MINGSHEN_NATIVE_SANDBOX_OK"),
        detail: result.output,
      };
    } catch (cause) {
      return { ready: false, detail: String(cause) };
    }
  }

  async fileOperation(
    workspace: string,
    request: FileOperationRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    const normalizedRequest = normalizeFileOperationRequest(request);
    const script = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
  $r=[Console]::In.ReadToEnd() | ConvertFrom-Json
  $root=[IO.Path]::GetFullPath($r.root).TrimEnd('\\')
  $path=[IO.Path]::GetFullPath([IO.Path]::Combine($root,$r.path))
  if($path -ne $root -and -not $path.StartsWith($root+'\\',[StringComparison]::OrdinalIgnoreCase)){throw 'Path outside workspace'}
  $cursor=$path
  while($cursor -and $cursor.Length -ge $root.Length){
    if(Test-Path -LiteralPath $cursor){
      $item=Get-Item -LiteralPath $cursor -Force
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse points are not allowed'}
    }
    $cursor=[IO.Path]::GetDirectoryName($cursor)
  }
  $value=$null
  switch($r.operation){
    'exists' {$value=[IO.File]::Exists($path) -or [IO.Directory]::Exists($path)}
    'read' {if(-not [IO.File]::Exists($path)){throw 'FILE_NOT_FOUND'};if((Get-Item -LiteralPath $path).Length -gt 2000000){throw 'Text file too large'};$value=[IO.File]::ReadAllText($path)}
    'read_binary' {if(-not [IO.File]::Exists($path)){throw 'FILE_NOT_FOUND'};if((Get-Item -LiteralPath $path).Length -gt 26214400){throw 'Document too large'};$value=[Convert]::ToBase64String([IO.File]::ReadAllBytes($path))}
    'write' {[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))|Out-Null;[IO.File]::WriteAllText($path,[string]$r.content,[Text.UTF8Encoding]::new($false))}
    'write_binary' {
      if($null -eq $r.content -or $r.content -isnot [string]){throw 'Binary content is required'}
      if($r.content.Length -gt 34952536){throw 'Binary content too large'}
      try{$bytes=[Convert]::FromBase64String([string]$r.content)}catch{throw 'Invalid base64 content'}
      if($bytes.Length -gt 26214400){throw 'Binary content too large'}
      if([Convert]::ToBase64String($bytes) -cne [string]$r.content){throw 'Invalid base64 content'}
      $expected=[string]$r.expectedHash
      if($expected -ne 'missing' -and $expected -notmatch '^[0-9a-fA-F]{64}$'){throw 'Expected SHA-256 hash is required'}
      if([IO.Directory]::Exists($path)){throw 'Target is not a regular file'}
      $exists=[IO.File]::Exists($path)
      if($expected -eq 'missing' -and $exists){throw 'Target changed before binary write'}
      if($expected -ne 'missing' -and -not $exists){throw 'Target is missing before binary write'}
      if($exists){
        $current=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if($current -cne $expected.ToLowerInvariant()){throw 'Target changed before binary write'}
      }
      $parent=[IO.Path]::GetDirectoryName($path)
      if($parent -and -not [IO.Directory]::Exists($parent)){[IO.Directory]::CreateDirectory($parent)|Out-Null}
      $temp=[IO.Path]::Combine($parent,'.mingshen-write-'+[IO.Path]::GetRandomFileName()+'.tmp')
      try{
        [IO.File]::WriteAllBytes($temp,$bytes)
        if([IO.File]::Exists($path)){
          if($expected -eq 'missing'){throw 'Target changed before binary write'}
          $current=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
          if($current -cne $expected.ToLowerInvariant()){throw 'Target changed before binary write'}
          [IO.File]::Replace($temp,$path,$null)
        }else{
          if($expected -ne 'missing'){throw 'Target changed before binary write'}
          [IO.File]::Move($temp,$path)
        }
      }finally{
        if([IO.File]::Exists($temp)){Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
      }
    }
    'hash' {
      if([IO.Directory]::Exists($path)){throw 'Target is not a regular file'}
      if(-not [IO.File]::Exists($path)){$value='missing'}
      else{
        if((Get-Item -LiteralPath $path).Length -gt 26214400){throw 'Binary file too large'}
        $value=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    }
    'delete' {if(-not [IO.File]::Exists($path)){throw 'FILE_NOT_FOUND'};[IO.File]::Delete($path)}
    'list' {
      $items=New-Object 'Collections.Generic.List[object]'
      $q=New-Object 'Collections.Generic.Queue[object]'
      $q.Enqueue(@{path=$path;depth=0})
      $limit=if($r.maxEntries){[Math]::Min(25000,[Math]::Max(1,$r.maxEntries))}else{2000}
      while($q.Count -gt 0 -and $items.Count -lt $limit){
        $current=$q.Dequeue()
        foreach($item in Get-ChildItem -LiteralPath $current.path -Force){
          if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Name -in @('.git','node_modules','dist','out','.next','.turbo','.cache','release')){continue}
          $items.Add(@{path=$item.FullName.Substring($root.Length+1).Replace('\\','/');directory=$item.PSIsContainer;fingerprint=([string]$item.Length+':'+$item.LastWriteTimeUtc.Ticks+':'+$item.CreationTimeUtc.Ticks)})
          if($items.Count -ge $limit){break}
          if($item.PSIsContainer -and $current.depth+1 -lt [Math]::Min(64,[Math]::Max(1,$r.depth))){$q.Enqueue(@{path=$item.FullName;depth=$current.depth+1})}
        }
      }
      $value=@($items.ToArray())
    }
    default {throw 'Unsupported operation'}
  }
  @{ok=$true;value=$value}|ConvertTo-Json -Depth 12 -Compress
} catch {@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress;exit 1}`;
    const result = await this.run(workspace, script, signal, {
      stdin: JSON.stringify({ ...normalizedRequest, root: resolve(workspace) }),
      readOnly: ["read", "read_binary", "list", "exists", "hash"].includes(
        normalizedRequest.operation,
      ),
      maxCapture:
        normalizedRequest.operation === "read_binary" ? 36 * 1024 * 1024 : 14 * 1024 * 1024,
    });
    try {
      const line = result.output.split(/\r?\n/).find((value) => value.startsWith('{"'));
      const parsed = JSON.parse(line || "") as { ok: boolean; value: unknown; error: string };
      if (!parsed.ok) throw new Error(parsed.error);
      if (result.exitCode !== 0) throw new Error(result.output);
      return parsed.value;
    } catch (cause) {
      throw new Error(`Native file operation failed: ${result.output || String(cause)}`);
    }
  }
}
