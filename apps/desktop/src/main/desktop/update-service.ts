import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ReleaseMetadata, UpdateStatus } from "../../shared/desktop";
import { APP_VERSION } from "../../shared/release";
import { recordRuntimeError } from "../diagnostics/runtime-log";
import {
  extractUpdateInstaller,
  fetchUpdateArchive,
  MAX_UPDATE_BYTES,
  sha256File,
} from "./update-package";

const RELEASE_RPC =
  "https://jgezpvmlnhycxslqbwcx.supabase.co/rest/v1/rpc/mingshen_get_latest_release";
const ZIP_RELEASE_RPC = `${RELEASE_RPC}_v2`;
const PUBLIC_KEY = "sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl";
const PERIOD = 24 * 60 * 60 * 1000;
export function parseVersion(version: string): number[] {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version))
    throw new Error("Invalid release version (expected x.x.x, up to three digits per part).");
  return version.split(".").map(Number);
}
export function isNewerVersion(candidate: string, installed: string): boolean {
  const next = parseVersion(candidate);
  const current = parseVersion(installed);
  for (let i = 0; i < 3; i++) if (next[i] !== current[i]) return (next[i] ?? 0) > (current[i] ?? 0);
  return false;
}
export function parseRelease(input: unknown): ReleaseMetadata | null {
  if (!Array.isArray(input) || input.length > 1)
    throw new Error("Release endpoint must return at most the latest release.");
  if (!input.length) return null;
  const item = input[0] as Record<string, unknown>;
  if (
    !item ||
    typeof item.version !== "string" ||
    typeof item.download_page_url !== "string" ||
    typeof item.published_at !== "string"
  )
    throw new Error("Invalid release metadata.");
  parseVersion(item.version);
  const url = new URL(item.download_page_url);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Update links must use HTTPS without credentials.");
  if (!Number.isFinite(Date.parse(item.published_at))) throw new Error("Invalid release date.");
  const format = item.package_format ?? (/\.zip$/i.test(url.pathname) ? "zip" : "page");
  if (format !== "zip" && format !== "page") throw new Error("Invalid update package format.");
  const hash = item.package_sha256 ?? null;
  if (hash !== null && (typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash)))
    throw new Error("Invalid update ZIP SHA-256.");
  const size = item.package_size ?? null;
  if (
    size !== null &&
    (typeof size !== "number" ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > MAX_UPDATE_BYTES)
  )
    throw new Error("Invalid update package size (maximum 2 GiB).");
  return {
    version: item.version,
    downloadUrl: url.href,
    notes: typeof item.notes === "string" ? item.notes.slice(0, 8000) : "",
    publishedAt: item.published_at,
    packageFormat: format,
    packageSha256: typeof hash === "string" ? hash.toLowerCase() : null,
    packageSize: size as number | null,
  };
}
export interface UpdateRuntime {
  cacheDirectory: string;
  fetchPackage: typeof fetch;
  activeTasks: () => number;
  handoff: (installer: string) => Promise<boolean>;
  validateUrl?: (url: string | URL) => Promise<URL>;
}
export class UpdateService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: Promise<UpdateStatus> | null = null;
  private lastNotified: string | null = null;
  private operation: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private waitTimer: ReturnType<typeof setInterval> | null = null;
  private cache: string | null = null;
  private installer: { path: string; sha256: string } | null = null;
  private installing = false;
  private canceling = false;
  private stopped = false;
  private value: UpdateStatus = {
    state: "idle",
    currentVersion: APP_VERSION,
    checkedAt: null,
    release: null,
    error: null,
  };
  constructor(
    private readonly emit: (status: UpdateStatus, notify: boolean) => void,
    private readonly fetcher: typeof fetch = fetch,
    private readonly runtime?: UpdateRuntime,
  ) {}
  status(): UpdateStatus {
    return { ...this.value };
  }
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    void this.check();
    this.timer = setInterval(() => void this.check(), PERIOD);
    this.timer.unref?.();
  }
  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clearWait();
  }
  cancelHandoff(error: string): void {
    if (this.value.state !== "installing") return;
    this.clearWait();
    this.publish({
      state: "ready",
      installWhenIdle: false,
      waitingForTasks: 0,
      error,
    });
  }
  async shutdown(): Promise<void> {
    this.stop();
    await this.operation;
    if (this.value.state !== "installing") await this.cleanCache();
  }
  check(): Promise<UpdateStatus> {
    if (this.operation || this.installer || this.canceling || this.value.state === "installing")
      return Promise.resolve(this.status());
    this.pending ??= this.perform().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  private publish(patch: Partial<UpdateStatus>, notify = false): void {
    this.value = { ...this.value, ...patch };
    this.emit(this.status(), notify);
  }
  async download(): Promise<UpdateStatus> {
    if (this.pending) await this.pending;
    if (this.operation || this.installer || this.canceling || this.value.state === "installing")
      return this.status();
    const release = this.value.release;
    if (!this.runtime || !release || !isNewerVersion(release.version, APP_VERSION))
      throw new Error("No newer release is available for download.");
    if (release.packageFormat !== "zip" || !release.packageSha256)
      throw new Error(
        "Automatic updates require a ZIP direct URL and its SHA-256 in release metadata.",
      );
    const controller = new AbortController();
    this.controller = controller;
    this.stopped = false;
    this.publish({
      state: "downloading",
      error: null,
      received: 0,
      total: release.packageSize,
      installWhenIdle: true,
    });
    this.operation = this.acquire(release, controller).finally(() => {
      this.operation = null;
      if (this.controller === controller) this.controller = null;
    });
    // The IPC acknowledges immediately; progress and failures arrive through update events.
    void this.operation.then(() => {
      if (this.value.state === "ready" && this.value.installWhenIdle && !this.stopped)
        void this.install();
    });
    return this.status();
  }
  async cancel(): Promise<UpdateStatus> {
    if (this.value.state === "installing" || this.canceling) return this.status();
    this.canceling = true;
    try {
      this.clearWait();
      this.controller?.abort(new Error("Update canceled by user."));
      this.publish({ installWhenIdle: false, waitingForTasks: 0 });
      await this.operation;
      this.installer = null;
      await this.cleanCache();
      this.publish({
        state: this.value.release ? "available" : "idle",
        error: null,
        received: 0,
        total: null,
      });
      return this.status();
    } finally {
      this.canceling = false;
    }
  }
  async install(): Promise<UpdateStatus> {
    if (
      !this.installer ||
      !this.runtime ||
      this.installing ||
      this.stopped ||
      this.canceling ||
      this.value.state === "installing"
    )
      return this.status();
    const count = this.runtime.activeTasks();
    this.publish({ state: "ready", waitingForTasks: count, installWhenIdle: true, error: null });
    if (count) {
      if (!this.waitTimer) {
        this.waitTimer = setInterval(() => void this.install(), 1000);
        this.waitTimer.unref?.();
      }
      return this.status();
    }
    this.installing = true;
    this.clearWait();
    const prepared = this.installer;
    try {
      if ((await sha256File(prepared.path)) !== prepared.sha256)
        throw new Error("Prepared update installer was changed; download it again.");
      if (this.installer !== prepared || !this.value.installWhenIdle || this.stopped)
        return this.status();
      // Handoff rechecks idleness synchronously and blocks new runs before quitting.
      const accepted = await this.runtime.handoff(this.installer.path);
      if (!accepted) {
        if (!this.stopped) {
          this.waitTimer = setInterval(() => void this.install(), 1000);
          this.waitTimer.unref?.();
        }
      } else this.publish({ state: "installing", waitingForTasks: 0 });
    } catch (cause) {
      if (this.installer !== prepared || this.canceling || this.stopped) return this.status();
      recordRuntimeError("updates.install", cause);
      this.publish({
        state: "error",
        error: String(cause instanceof Error ? cause.message : cause),
        installWhenIdle: false,
      });
      this.installer = null;
      await this.cleanCache().catch((error) => recordRuntimeError("updates.cleanup", error));
    } finally {
      this.installing = false;
    }
    return this.status();
  }
  private clearWait(): void {
    if (this.waitTimer) clearInterval(this.waitTimer);
    this.waitTimer = null;
  }
  private async cleanCache(): Promise<void> {
    if (!this.cache || !this.runtime) return;
    const root = resolve(this.runtime.cacheDirectory);
    const path = resolve(this.cache);
    const child = relative(root, path);
    if (
      !child ||
      isAbsolute(child) ||
      child.startsWith(`..${sep}`) ||
      child === ".." ||
      resolve(root, child) !== path
    )
      throw new Error("Unsafe update cache cleanup path.");
    await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    this.cache = null;
  }
  private async acquire(release: ReleaseMetadata, controller: AbortController): Promise<void> {
    const runtime = this.runtime;
    if (!runtime) return;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60 * 1000)]);
    try {
      await this.cleanCache();
      await mkdir(runtime.cacheDirectory, { recursive: true });
      this.cache = await mkdtemp(join(runtime.cacheDirectory, `release-${release.version}-`));
      const archive = join(this.cache, "package.zip");
      const response = await fetchUpdateArchive(
        release.downloadUrl,
        signal,
        runtime.fetchPackage,
        runtime.validateUrl,
      );
      const length = response.headers.get("content-length");
      const size = length && /^\d+$/.test(length) ? Number(length) : null;
      if (
        size !== null &&
        (size <= 0 ||
          size > MAX_UPDATE_BYTES ||
          (release.packageSize !== null && size !== release.packageSize))
      ) {
        await response.body?.cancel();
        throw new Error("Update download size does not match release metadata or exceeds 2 GiB.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty update download.");
      const file = await open(archive, "wx", 0o600);
      let received = 0;
      const hash = createHash("sha256");
      let previous = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          received += part.value.byteLength;
          if (
            received > MAX_UPDATE_BYTES ||
            (release.packageSize && received > release.packageSize)
          )
            throw new Error("Update download exceeds the expected size.");
          hash.update(part.value);
          let offset = 0;
          while (offset < part.value.byteLength) {
            const result = await file.write(part.value, offset, part.value.byteLength - offset);
            if (!result.bytesWritten) throw new Error("Unable to save update download.");
            offset += result.bytesWritten;
          }
          if (Date.now() - previous > 250) {
            previous = Date.now();
            this.publish({ received, total: release.packageSize ?? size });
          }
        }
        await file.sync();
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        await file.close();
      }
      this.publish({ state: "verifying", received, total: release.packageSize ?? size });
      if (
        !received ||
        (release.packageSize && received !== release.packageSize) ||
        (size && received !== size)
      )
        throw new Error("Incomplete update ZIP download.");
      if (hash.digest("hex") !== release.packageSha256)
        throw new Error("Update ZIP SHA-256 mismatch; installation blocked.");
      this.publish({ state: "extracting" });
      const installer = await extractUpdateInstaller(
        archive,
        join(this.cache, `MingshenHarness-${release.version}-x64.exe`),
        release.version,
        signal,
      );
      signal.throwIfAborted();
      this.installer = installer;
      this.publish({ state: "ready", waitingForTasks: runtime.activeTasks(), error: null }, true);
    } catch (cause) {
      this.installer = null;
      await this.cleanCache().catch((error) => recordRuntimeError("updates.cleanup", error));
      if (controller.signal.aborted) {
        this.publish({ state: "available", installWhenIdle: false, error: null });
      } else {
        recordRuntimeError("updates.download", cause);
        this.publish(
          {
            state: "error",
            installWhenIdle: false,
            error: cause instanceof Error ? cause.message : String(cause),
          },
          true,
        );
      }
    }
  }
  private async perform(): Promise<UpdateStatus> {
    this.value = { ...this.value, state: "checking", error: null };
    this.emit(this.status(), false);
    try {
      const request: RequestInit = {
        method: "POST",
        headers: { apikey: PUBLIC_KEY, "Content-Type": "application/json" },
        body: "{}",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      };
      let response = await this.fetcher(ZIP_RELEASE_RPC, request);
      if (response.status === 404) {
        await response.body?.cancel();
        response = await this.fetcher(RELEASE_RPC, request);
      }
      if (!response.ok)
        throw new Error(`Update check: HTTP ${response.status} ${response.statusText}`);
      if (!response.body) throw new Error("Empty release response.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 32_768) {
            await reader.cancel();
            throw new Error("Release metadata exceeds size limit.");
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const text = Buffer.concat(chunks).toString("utf8");
      const release = parseRelease(JSON.parse(text));
      const available = release !== null && isNewerVersion(release.version, APP_VERSION);
      this.value = {
        currentVersion: APP_VERSION,
        state: available ? "available" : "current",
        checkedAt: new Date().toISOString(),
        release,
        error: null,
      };
      const notify = available && release.version !== this.lastNotified;
      if (notify) this.lastNotified = release.version;
      this.emit(this.status(), notify);
    } catch (cause) {
      recordRuntimeError("updates.check", cause);
      this.value = {
        ...this.value,
        state: "error",
        checkedAt: new Date().toISOString(),
        error: cause instanceof Error ? cause.message : String(cause),
      };
      this.emit(this.status(), false);
    }
    return this.status();
  }
}
