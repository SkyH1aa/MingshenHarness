import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../../shared/release";
import type { ManagedPolicyService } from "../policy/managed-policy-service";
import { isNewerVersion, parseRelease, UpdateService } from "./update-service";

const metadata = [
  {
    version: "8.8.8",
    download_page_url: "https://example.com/",
    notes: "Test release",
    published_at: "2026-11-03T00:00:00Z",
  },
];
const roots: string[] = [];
const services: UpdateService[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mingshen-update-policy-test-"));
  roots.push(root);
  return root;
}

function policyHarness(): {
  service: ManagedPolicyService;
  assertOperational: ReturnType<typeof vi.fn>;
  assertCapability: ReturnType<typeof vi.fn>;
} {
  const assertOperational = vi.fn();
  const assertCapability = vi.fn();
  return {
    service: { assertOperational, assertCapability } as unknown as ManagedPolicyService,
    assertOperational,
    assertCapability,
  };
}

async function preparedInstaller(
  managedPolicy: ManagedPolicyService,
  active: () => number,
): Promise<{
  service: UpdateService;
  installer: string;
  handoff: ReturnType<typeof vi.fn>;
}> {
  const root = await temporaryDirectory();
  const installer = join(root, "installer-fixture.exe");
  const contents = Buffer.from("verified installer fixture, not executable");
  await writeFile(installer, contents);
  const handoff = vi.fn(async () => true);
  const service = new UpdateService(
    () => undefined,
    vi.fn(async () => Response.json(metadata)),
    {
      cacheDirectory: root,
      fetchPackage: vi.fn(),
      activeTasks: active,
      handoff,
    },
    managedPolicy,
  );
  Object.assign(service, {
    installer: {
      path: installer,
      sha256: createHash("sha256").update(contents).digest("hex"),
    },
  });
  services.push(service);
  return { service, installer, handoff };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const service of services.splice(0)) service.stop();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("Release checks", () => {
  it("compares numeric components and rejects invalid versions and download schemes", () => {
    expect(isNewerVersion("1.10.0", "1.9.999")).toBe(true);
    expect(isNewerVersion("1.2.1", "1.2.1")).toBe(false);
    expect(() => isNewerVersion("1.1000.0", "1.2.1")).toThrow();
    expect(() =>
      parseRelease([{ ...metadata[0], download_page_url: "javascript:alert(1)" }]),
    ).toThrow();
    expect(() => parseRelease([...metadata, ...metadata])).toThrow("latest");
  });
  it("checks at startup and every 24 hours, deduplicates notices and keeps errors visible", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(metadata)));
    const events: Array<{ state: string; notify: boolean }> = [];
    const service = new UpdateService(
      (status, notify) => events.push({ state: status.state, notify }),
      fetcher,
    );
    service.start();
    await service.check();
    expect(service.status()).toMatchObject({
      state: "available",
      currentVersion: APP_VERSION,
      release: { version: "8.8.8", downloadUrl: "https://example.com/" },
    });
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.notify)).toHaveLength(1);
    fetcher.mockResolvedValueOnce(new Response("failed", { status: 503 }));
    expect((await service.check()).error).toContain("503");
    service.stop();
  });
  it("returns current without notifying when the installed version is latest", async () => {
    const emit = vi.fn();
    const service = new UpdateService(
      emit,
      vi.fn(async () => new Response(JSON.stringify([{ ...metadata[0], version: APP_VERSION }]))),
    );
    expect((await service.check()).state).toBe("current");
    expect(emit.mock.calls.every(([, notify]) => !notify)).toBe(true);
  });
});

describe("Managed update policy boundaries", () => {
  it("keeps automatic checks unapproved and gates the v2 and legacy requests separately", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([]));
    const policy = policyHarness();
    const service = new UpdateService(() => undefined, fetcher, undefined, policy.service);
    services.push(service);

    expect((await service.check()).state).toBe("current");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(policy.assertCapability.mock.calls).toEqual([
      ["network.request", { approved: false }],
      ["network.request", { approved: false }],
    ]);

    expect((await service.check({ approved: true })).state).toBe("current");
    expect(policy.assertCapability).toHaveBeenLastCalledWith("network.request", {
      approved: true,
    });
  });

  it("does not silently approve an automatic check that policy marks as ask", async () => {
    const fetcher = vi.fn(async () => Response.json(metadata));
    const policy = policyHarness();
    policy.assertCapability.mockImplementation(
      (capability: string, options?: { approved?: boolean }) => {
        if (capability === "network.request" && options?.approved !== true)
          throw new Error("POLICY_APPROVAL_REQUIRED");
      },
    );
    const service = new UpdateService(() => undefined, fetcher, undefined, policy.service);
    services.push(service);

    service.start();
    expect(await service.check()).toMatchObject({
      state: "error",
      error: "POLICY_APPROVAL_REQUIRED",
    });
    expect(fetcher).not.toHaveBeenCalled();
    service.stop();

    expect((await service.check({ approved: true })).state).toBe("available");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rechecks download network policy immediately before the package fetch", async () => {
    const root = await temporaryDirectory();
    const release = [
      {
        ...metadata[0],
        package_format: "zip",
        package_sha256: "a".repeat(64),
        package_size: 1,
      },
    ];
    const releaseFetcher = vi.fn(async () => Response.json(release));
    const packageFetcher = vi.fn();
    const policy = policyHarness();
    let approvedNetworkChecks = 0;
    policy.assertCapability.mockImplementation(
      (capability: string, options?: { approved?: boolean }) => {
        if (capability !== "network.request") return;
        if (options?.approved !== true) throw new Error("POLICY_APPROVAL_REQUIRED");
        approvedNetworkChecks += 1;
        if (approvedNetworkChecks === 3) throw new Error("POLICY_INVALID");
      },
    );
    const service = new UpdateService(
      () => undefined,
      releaseFetcher,
      {
        cacheDirectory: root,
        fetchPackage: packageFetcher,
        activeTasks: () => 0,
        handoff: vi.fn(async () => true),
      },
      policy.service,
    );
    services.push(service);

    await service.check({ approved: true });
    await expect(service.download()).rejects.toThrow("POLICY_APPROVAL_REQUIRED");
    expect(packageFetcher).not.toHaveBeenCalled();
    await service.download({ approved: true });
    await vi.waitFor(() =>
      expect(service.status()).toMatchObject({ state: "error", error: "POLICY_INVALID" }),
    );
    expect(packageFetcher).not.toHaveBeenCalled();
  });

  it("carries explicit install approval through the waiting-for-idle flow", async () => {
    let active = 1;
    const policy = policyHarness();
    const { service, installer, handoff } = await preparedInstaller(policy.service, () => active);

    await service.install({ approved: true });
    expect(policy.assertCapability).not.toHaveBeenCalledWith("command.execute", expect.anything());

    active = 0;
    await service.install();
    expect(policy.assertCapability).toHaveBeenCalledWith("command.execute", { approved: true });
    expect(handoff).toHaveBeenCalledOnce();
    expect(handoff).toHaveBeenCalledWith(installer, { approved: true });
  });

  it("rechecks command policy for the scheduled handoff and cannot bypass deny or invalid state", async () => {
    let active = 1;
    let policyBlocked = false;
    const policy = policyHarness();
    policy.assertCapability.mockImplementation((capability: string) => {
      if (capability === "command.execute" && policyBlocked) throw new Error("POLICY_INVALID");
    });
    const { service, handoff } = await preparedInstaller(policy.service, () => active);

    await service.install({ approved: true });
    expect(policy.assertCapability).not.toHaveBeenCalledWith("command.execute", expect.anything());

    active = 0;
    policyBlocked = true;
    await service.install();
    expect(policy.assertCapability).toHaveBeenCalledWith("command.execute", { approved: true });
    expect(handoff).not.toHaveBeenCalled();
    expect(service.status()).toMatchObject({ state: "error", error: "POLICY_INVALID" });
  });
});
