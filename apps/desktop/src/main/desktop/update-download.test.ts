import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractUpdateInstaller, fetchUpdateArchive } from "./update-package";
import { parseRelease, UpdateService } from "./update-service";

const version = "998.998.998";
const name = `MingshenHarness-${version}-x64.exe`;
function executable(): Uint8Array {
  const file = Buffer.alloc(2048);
  file.write("MZ");
  file.writeUInt32LE(128, 0x3c);
  file.writeUInt32LE(0x4550, 128);
  file.writeUInt16LE(0x14c, 132); // The normal NSIS bootstrapper is x86.
  return file;
}
const roots: string[] = [];
const services: UpdateService[] = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "mingshen-update-test-"));
  roots.push(root);
  return root;
}
const validate = vi.fn(async (url: string | URL) => new URL(url));
function metadata(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return [
    {
      version,
      download_page_url: "https://example.com/package.zip",
      published_at: "2026-11-05T00:00:00Z",
      notes: "Fixture",
      package_format: "zip",
      package_sha256: createHash("sha256").update(bytes).digest("hex"),
      package_size: bytes.length,
      ...overrides,
    },
  ];
}
async function waitFor(service: UpdateService, states: string[]) {
  await vi.waitFor(() => expect(states).toContain(service.status().state), { timeout: 5000 });
  return service.status();
}
async function fixture(
  options: {
    bytes?: Uint8Array;
    overrides?: Record<string, unknown>;
    fetcher?: typeof fetch;
    active?: () => number;
    handoff?: (path: string) => Promise<boolean>;
  } = {},
) {
  const root = await directory();
  const bytes = options.bytes ?? zipSync({ [name]: executable() });
  const events: string[] = [];
  const handoff = vi.fn(options.handoff ?? (async () => true));
  const fetcher = options.fetcher ?? vi.fn(async () => new Response(new Uint8Array(bytes).buffer));
  const service = new UpdateService(
    (status) => events.push(status.state),
    vi.fn(async () => Response.json(metadata(bytes, options.overrides))),
    {
      cacheDirectory: root,
      fetchPackage: fetcher,
      validateUrl: validate,
      activeTasks: options.active ?? (() => 0),
      handoff,
    },
  );
  services.push(service);
  await service.check();
  return { service, events, root, bytes, handoff, fetcher };
}
afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop();
    await service.cancel();
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  vi.restoreAllMocks();
});

describe("verified background ZIP updates", () => {
  it("downloads, verifies and extracts the exact installer, then hands it off once without secrets", async () => {
    const { service, events, bytes, handoff, fetcher } = await fixture();
    expect((await service.download()).state).toBe("downloading");
    await waitFor(service, ["installing"]);
    expect(events).toEqual(
      expect.arrayContaining(["downloading", "verifying", "extracting", "ready", "installing"]),
    );
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(await readFile(handoff.mock.calls[0]?.[0] ?? "")).toEqual(Buffer.from(executable()));
    expect(service.status()).toMatchObject({ received: bytes.length, total: bytes.length });
    const call = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[1]).toMatchObject({ credentials: "omit", redirect: "manual" });
    expect(JSON.stringify(call)).not.toMatch(/sb_publishable|Bearer|Cookie/);
    await service.download();
    await service.install();
    expect(handoff).toHaveBeenCalledTimes(1);
  });
  it("waits for live sessions, rechecks the handoff boundary and supports cancellation before installation", async () => {
    let active = 2;
    const { service, handoff, root } = await fixture({ active: () => active });
    await service.download();
    expect(await waitFor(service, ["ready"])).toMatchObject({
      waitingForTasks: 2,
      installWhenIdle: true,
    });
    expect(handoff).not.toHaveBeenCalled();
    expect((await service.check()).state).toBe("ready");
    await service.cancel();
    active = 0;
    await service.install();
    expect(handoff).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
    await service.download();
    await waitFor(service, ["installing"]);
    expect(handoff).toHaveBeenCalledTimes(1);
  });
  it("blocks changes to an extracted installer while waiting for a task", async () => {
    let active = 1;
    const { service, handoff, root } = await fixture({ active: () => active });
    await service.download();
    await waitFor(service, ["ready"]);
    const folder = (await readdir(root))[0] ?? "";
    await writeFile(join(root, folder, name), executable().slice(0, 150));
    active = 0;
    await service.install();
    expect(service.status()).toMatchObject({
      state: "error",
      error: expect.stringContaining("changed"),
    });
    expect(handoff).not.toHaveBeenCalled();
  });
  it("keeps the verified installer retryable when a draft save cancels shutdown", async () => {
    const { service, handoff } = await fixture();
    await service.download();
    await waitFor(service, ["installing"]);
    const installer = handoff.mock.calls[0]?.[0] ?? "";
    service.cancelHandoff("草稿尚未保存");
    expect(service.status()).toMatchObject({
      state: "ready",
      installWhenIdle: false,
      error: "草稿尚未保存",
    });
    expect(await readFile(installer)).toEqual(Buffer.from(executable()));
    await service.install();
    expect(handoff).toHaveBeenCalledTimes(2);
    expect(service.status().state).toBe("installing");
  });
  it.each([
    ["hash mismatch", { overrides: { package_sha256: "0".repeat(64) } }, "SHA-256"],
    ["size mismatch", { overrides: { package_size: 9999 } }, "Incomplete"],
    [
      "HTTP error",
      {
        fetcher: vi.fn(async () => new Response("503", { status: 503, statusText: "Unavailable" })),
      },
      "503",
    ],
    [
      "truncated response",
      {
        fetcher: vi.fn(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array([1]));
                  controller.error(new Error("stream failed"));
                },
              }),
            ),
        ),
      },
      "stream failed",
    ],
    ["invalid ZIP", { bytes: new Uint8Array([1, 2, 3, 4]) }, "End of central directory"],
  ])("retains useful error and never launches on %s", async (_label, options, error) => {
    const { service, handoff, root } = await fixture(options);
    await service.download();
    expect((await waitFor(service, ["error"])).error).toContain(error);
    expect(handoff).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });
  it("deduplicates double clicks and cancels an in-flight fetch without installing", async () => {
    const fetcher = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const { service, handoff } = await fixture({ fetcher });
    await Promise.all([service.download(), service.download()]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect((await service.cancel()).state).toBe("available");
    expect(handoff).not.toHaveBeenCalled();
  });
  it("keeps legacy pages manual and refuses automatic execution without a release hash", async () => {
    const { service, handoff } = await fixture({ overrides: { package_sha256: null } });
    await expect(service.download()).rejects.toThrow("SHA-256");
    expect(handoff).not.toHaveBeenCalled();
    expect(
      parseRelease([
        { version, download_page_url: "https://example.com/page", published_at: "2026-11-05" },
      ]),
    ).toMatchObject({ packageFormat: "page", packageSha256: null });
  });
  it("retries a failed idleness handoff and cancels scheduling when the user quits", async () => {
    const handoff = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { service } = await fixture({ handoff });
    await service.download();
    await vi.waitFor(() => expect(handoff).toHaveBeenCalledTimes(1));
    expect(service.status().state).toBe("ready");
    await service.install();
    expect(handoff).toHaveBeenCalledTimes(2);
    expect(service.status().state).toBe("installing");
    const waiting = await fixture({ active: () => 1 });
    await waiting.service.download();
    await waitFor(waiting.service, ["ready"]);
    await waiting.service.shutdown();
    expect(await readdir(waiting.root)).toEqual([]);
    await waiting.service.install();
    expect(waiting.handoff).not.toHaveBeenCalled();
  });
  it("falls back to the original latest-release RPC only when v2 is not deployed", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(Response.json([]));
    const service = new UpdateService(() => undefined, fetcher);
    services.push(service);
    expect((await service.check()).state).toBe("current");
    expect(fetcher.mock.calls.map((call) => String(call[0]).split("/").at(-1))).toEqual([
      "mingshen_get_latest_release_v2",
      "mingshen_get_latest_release",
    ]);
  });
});

describe("update URL and ZIP boundaries", () => {
  it("rejects encrypted, linked and corrupt CRC entries with matching outer ZIP hashes", async () => {
    for (const kind of ["encrypted", "symlink", "crc"]) {
      const root = await directory(),
        archive = join(root, "bad.zip");
      const bytes = Buffer.from(zipSync({ [name]: executable() }));
      const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      expect(central).toBeGreaterThan(0);
      if (kind === "encrypted")
        bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
      if (kind === "symlink") bytes.writeUInt32LE((0xa1ff * 0x10000) >>> 0, central + 38);
      if (kind === "crc") bytes.writeUInt32LE(0, central + 16);
      await writeFile(archive, bytes);
      await expect(
        extractUpdateInstaller(
          archive,
          join(root, "out.exe"),
          version,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    }
  });
  it("validates every redirect, drops authorization and rejects HTTP/private targets", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/update.zip" },
        }),
      )
      .mockResolvedValueOnce(new Response("ZIP"));
    const checked: string[] = [];
    await fetchUpdateArchive(
      "https://example.com/update.zip",
      new AbortController().signal,
      fetcher,
      async (url) => {
        checked.push(String(url));
        return new URL(url);
      },
    );
    expect(checked).toEqual([
      "https://example.com/update.zip",
      "https://cdn.example.com/update.zip",
    ]);
    await expect(
      fetchUpdateArchive(
        "http://example.com/u.zip",
        new AbortController().signal,
        fetcher,
        validate,
      ),
    ).rejects.toThrow("HTTPS");
    await expect(
      fetchUpdateArchive("https://127.0.0.1/u.zip", new AbortController().signal, fetcher),
    ).rejects.toThrow(/Private/);
    await expect(
      fetchUpdateArchive(
        "https://user:password@example.com/u.zip",
        new AbortController().signal,
        fetcher,
        validate,
      ),
    ).rejects.toThrow("credentials");
  });
  it.each([
    ["path traversal", { [`../${name}`]: executable() }],
    ["absolute path", { [`/${name}`]: executable() }],
    ["wrong version", { "MingshenHarness-8.8.8-x64.exe": executable() }],
    ["additional executable", { [name]: executable(), "other.exe": executable() }],
    ["unexpected script", { [name]: executable(), "run.cmd": new Uint8Array([1]) }],
    ["invalid executable", { [name]: new Uint8Array([1, 2, 3]) }],
    ["case alias", { [name]: executable(), [name.toUpperCase()]: executable() }],
    ["ZIP bomb", { [name]: new Uint8Array(2 * 1024 ** 2) }],
  ])("rejects %s before handoff", async (_label, entries) => {
    const root = await directory(),
      archive = join(root, "update.zip"),
      target = join(root, "out.exe");
    await writeFile(archive, zipSync(entries));
    await expect(
      extractUpdateInstaller(archive, target, version, new AbortController().signal),
    ).rejects.toThrow();
  });
});
