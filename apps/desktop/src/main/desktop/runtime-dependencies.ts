import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { DependencyProgress } from "../../shared/desktop";
import type { McpService } from "../mcp/mcp-service";
import { dockerExecutable } from "../workspace/docker-path";
import { NativeSandboxService } from "../workspace/native-sandbox-service";

const exec = promisify(execFile);
async function download(
  response: Response,
  destination: string,
  report: (received: number, total: number | null) => void,
): Promise<void> {
  if (!response.body) throw new Error("Empty runtime download.");
  let received = 0;
  const total = Number(response.headers.get("content-length")) || null;
  let lastReport = 0;
  const source = Readable.from(response.body);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (Date.now() - lastReport > 300) {
      report(received, total);
      lastReport = Date.now();
    }
  });
  await pipeline(source, createWriteStream(destination));
  report(received, total);
}
async function embiodyInstallation(): Promise<string> {
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\embiody.exe";
  const { stdout } = await exec("reg.exe", ["query", key, "/ve"], {
    windowsHide: true,
    timeout: 5000,
  });
  const executable = /REG_SZ\s+(.+)/.exec(stdout)?.[1]?.trim().replaceAll('"', "");
  if (!executable)
    throw new Error("Embiody is not installed. Use the official installation button.");
  await access(executable);
  return executable;
}
export class RuntimeDependencies {
  private readonly pending = new Map<string, Promise<string>>();
  constructor(
    private readonly root: string,
    private readonly mcp: McpService,
    private readonly nativeExecutable: string,
    private readonly emit: (progress: DependencyProgress) => void = () => undefined,
  ) {}
  async ensureInstalled(): Promise<void> {
    const marker = join(this.root, "runtime-install-attempts.json");
    const attempts = await readFile(marker, "utf8").then(
      (value) => {
        try {
          const parsed: unknown = JSON.parse(value);
          return Array.isArray(parsed)
            ? parsed.filter((entry): entry is string => typeof entry === "string")
            : [];
        } catch {
          return [];
        }
      },
      () => [] as string[],
    );
    const missing: Array<"wsl" | "docker" | "embiody"> = [];
    const wsl = await exec("wsl.exe", ["--version"], { windowsHide: true, timeout: 15_000 }).then(
      () => true,
      () => false,
    );
    if (!wsl) missing.push("wsl");
    if (
      !(await exec(dockerExecutable(), ["--version"], { windowsHide: true, timeout: 10_000 }).then(
        () => true,
        () => false,
      ))
    )
      missing.push("docker");
    if (
      !(await embiodyInstallation().then(
        () => true,
        () => false,
      ))
    )
      missing.push("embiody");
    for (const name of missing) {
      if (attempts.includes(name)) continue;
      attempts.push(name);
      await writeFile(marker, JSON.stringify(attempts), "utf8");
      await this.install(name).catch(() => undefined);
    }
  }
  install(name: "docker" | "embiody" | "wsl"): Promise<string> {
    const existing = this.pending.get(name);
    if (existing) return existing;
    const work = (async () => {
      this.emit({
        name,
        stage: "checking",
        received: 0,
        total: null,
        detail: "Preparing official runtime installation.",
      });
      try {
        const detail =
          name === "docker"
            ? await this.installDocker()
            : name === "embiody"
              ? await this.installEmbiody()
              : await this.installWsl();
        this.emit({ name, stage: "ready", received: 0, total: null, detail });
        return detail;
      } catch (cause) {
        this.emit({ name, stage: "error", received: 0, total: null, detail: String(cause) });
        throw cause;
      }
    })().finally(() => this.pending.delete(name));
    this.pending.set(name, work);
    return work;
  }
  private async installWsl(): Promise<string> {
    this.emit({
      name: "wsl",
      stage: "installing",
      received: 0,
      total: null,
      detail:
        "Installing WSL without starting a distribution. Windows may require administrator approval; restart manually if requested.",
    });
    const result = await exec(
      "wsl.exe",
      ["--install", "--no-distribution", "--no-launch", "--web-download"],
      { windowsHide: true, timeout: 20 * 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    return `${result.stdout}\n${result.stderr}\nIf Windows requests a restart, save your work and restart manually. No automatic restart is performed.`;
  }
  async status(): Promise<{
    native: boolean;
    nativeDetail: string;
    wsl: boolean;
    wslDetail: string;
    docker: boolean;
    dockerDetail: string;
    browserdo: boolean;
    browserDetail: string;
  }> {
    const nativeDirectory = join(this.root, "runtime-probe");
    await mkdir(nativeDirectory, { recursive: true });
    const native = await new NativeSandboxService(
      this.nativeExecutable,
      join(this.root, "native-sandbox"),
    ).status(nativeDirectory);
    const wsl = await exec("wsl.exe", ["--version"], {
      windowsHide: true,
      timeout: 15_000,
      encoding: "buffer",
    }).then(
      (result) => ({ ok: true, detail: result.stdout.toString("utf16le").replaceAll("\0", "") }),
      (cause) => ({ ok: false, detail: String(cause) }),
    );
    const docker = await exec(dockerExecutable(), ["info", "--format", "{{.ServerVersion}}"], {
      windowsHide: true,
      timeout: 15_000,
    }).then(
      (result) => ({ ok: true, detail: result.stdout.trim() }),
      (error) => ({ ok: false, detail: String(error).slice(0, 2000) }),
    );
    let result: { output: string; isError: boolean };
    try {
      await embiodyInstallation();
      const browser = await this.mcp.test("builtin-browserdo");
      result = browser.ok
        ? await this.mcp.callTool("builtin-browserdo", "browser_get_window_info", {})
        : { output: browser.error ?? "Unavailable", isError: true };
    } catch (cause) {
      result = { output: String(cause), isError: true };
    }
    return {
      native: native.ready,
      nativeDetail: native.detail,
      wsl: wsl.ok,
      wslDetail: wsl.detail,
      docker: docker.ok,
      dockerDetail: docker.detail,
      browserdo: !result.isError,
      browserDetail: result.output,
    };
  }
  async installDocker(): Promise<string> {
    const directory = join(this.root, "runtime-installers");
    await mkdir(directory, { recursive: true });
    const feed = await fetch("https://desktop.docker.com/win/main/amd64/appcast.xml", {
      signal: AbortSignal.timeout(30_000),
    });
    if (!feed.ok) throw new Error(`Docker download metadata: HTTP ${feed.status}`);
    const xml = await feed.text();
    const rawUrl = /<enclosure\s+url="([^"]+Docker Desktop Installer\.exe)"/.exec(xml)?.[1];
    if (
      !rawUrl ||
      new URL(rawUrl).hostname !== "desktop.docker.com" ||
      new URL(rawUrl).protocol !== "https:"
    )
      throw new Error("Invalid Docker download metadata.");
    const response = await fetch(rawUrl, { signal: AbortSignal.timeout(20 * 60_000) });
    if (!response.ok) throw new Error(`Docker download: HTTP ${response.status}`);
    const file = join(directory, "DockerDesktopInstaller.exe");
    await download(response, file, (received, total) =>
      this.emit({
        name: "docker",
        stage: "downloading",
        received,
        total,
        detail: "Downloading Docker Desktop from its official distribution.",
      }),
    );
    const signature = await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$s=Get-AuthenticodeSignature -LiteralPath $env:MSH_INSTALLER; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Docker Inc'){exit 1}",
      ],
      { env: { ...process.env, MSH_INSTALLER: file }, windowsHide: true, timeout: 30_000 },
    );
    void signature;
    this.emit({
      name: "docker",
      stage: "installing",
      received: 0,
      total: null,
      detail:
        "Installing the verified Docker Desktop package. Windows may request system approval.",
    });
    await exec(file, ["install", "--user", "--quiet", "--accept-license", "--backend=wsl-2"], {
      windowsHide: true,
      timeout: 15 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    await exec(dockerExecutable(), ["--version"], { windowsHide: true, timeout: 10_000 });
    const desktop = join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "DockerDesktop",
      "Docker Desktop.exe",
    );
    const { spawn } = await import("node:child_process");
    const child = spawn(desktop, [], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
    return "Docker Desktop installed. Windows virtualization or WSL setup may require administrator approval or a restart. Docker Desktop has its own subscription terms.";
  }
  async installEmbiody(): Promise<string> {
    const directory = join(this.root, "runtime-installers");
    await mkdir(directory, { recursive: true });
    const base = "https://github.com/zhaijunlong/embiody-dist/releases/latest/download";
    const name = "EmbiodySetup-Offline-NPMX.exe";
    const sums = await fetch(`${base}/SHA256SUMS.txt`, {
      signal: AbortSignal.timeout(30_000),
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    });
    const expected = sums
      .split(/\r?\n/)
      .find((line) => line.endsWith(name))
      ?.split(/\s+/)[0];
    if (!expected || !/^[a-f0-9]{64}$/i.test(expected))
      throw new Error("Embiody checksum unavailable.");
    const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!response.ok) throw new Error(`Embiody download: HTTP ${response.status}`);
    const file = join(directory, name);
    await download(response, file, (received, total) =>
      this.emit({
        name: "embiody",
        stage: "downloading",
        received,
        total,
        detail: "Downloading Embiody from its official distribution.",
      }),
    );
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest("hex") !== expected.toLowerCase())
      throw new Error("Embiody checksum mismatch.");
    await exec(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$s=Get-AuthenticodeSignature -LiteralPath $env:MSH_INSTALLER; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=SELECTIOUS PTY LTD'){exit 1}",
      ],
      { env: { ...process.env, MSH_INSTALLER: file }, windowsHide: true, timeout: 30_000 },
    );
    try {
      this.emit({
        name: "embiody",
        stage: "installing",
        received: 0,
        total: null,
        detail: "Installing the verified Embiody package.",
      });
      await exec(file, ["--silent"], { windowsHide: true, timeout: 10 * 60_000 });
    } catch (cause) {
      throw new Error(
        `Official Embiody installer failed. The browser is not ready. ${String(cause)}`,
      );
    }
    await embiodyInstallation();
    const operational = await this.mcp.callTool("builtin-browserdo", "browser_get_window_info", {});
    if (operational.isError)
      throw new Error(`Embiody was installed but is not operational. ${operational.output}`);
    return "Embiody installed from its official distribution. It is separately licensed and is not redistributed in Mingshen Harness.";
  }
}
