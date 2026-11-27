import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagedCapability, ManagedPolicyDecision } from "../../shared/managed-policy";
import type { McpService } from "../mcp/mcp-service";
import type { ManagedPolicyService } from "../policy/managed-policy-service";
import { RuntimeDependencies } from "./runtime-dependencies";

const fake = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: fake.execFile,
  spawn: fake.spawn,
}));

interface PolicyOptions {
  invalid?: boolean;
  decisions?: Partial<Record<ManagedCapability, ManagedPolicyDecision>>;
  networkSequence?: ManagedPolicyDecision[];
}

function policy(options: PolicyOptions = {}) {
  let networkChecks = 0;
  const assertOperational = vi.fn(() => {
    if (options.invalid) throw new Error("managed policy is invalid");
  });
  const assertCapability = vi.fn(
    (capability: ManagedCapability, context: { approved?: boolean } = {}) => {
      const decision =
        capability === "network.request" && options.networkSequence
          ? (options.networkSequence[networkChecks++] ?? "deny")
          : (options.decisions?.[capability] ?? "allow");
      if (decision === "deny" || (decision === "ask" && context.approved !== true)) {
        throw new Error(`${capability} ${decision}`);
      }
    },
  );
  return {
    service: { assertOperational, assertCapability } as unknown as ManagedPolicyService,
    assertOperational,
    assertCapability,
  };
}

const roots: string[] = [];
async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mingshen-runtime-policy-"));
  roots.push(root);
  return root;
}

function dependencies(root: string, managedPolicy: ManagedPolicyService): RuntimeDependencies {
  return new RuntimeDependencies(
    root,
    {} as McpService,
    "native.exe",
    () => undefined,
    managedPolicy,
  );
}

function successfulExec(): void {
  fake.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as
      | ((error: Error | null, value: { stdout: string; stderr: string }) => void)
      | undefined;
    callback?.(null, { stdout: "", stderr: "" });
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("runtime dependency managed policy", () => {
  it("fails closed for an automatic ask decision before spawning a probe", async () => {
    fake.execFile.mockReset();
    const root = await directory();
    const managed = policy({ decisions: { "command.execute": "ask" } });

    await expect(dependencies(root, managed.service).ensureInstalled()).rejects.toThrow(
      "command.execute ask",
    );

    expect(fake.execFile).not.toHaveBeenCalled();
    expect(managed.assertOperational).toHaveBeenCalled();
    expect(managed.assertCapability).toHaveBeenCalledWith("command.execute");
  });

  it("allows an explicit UI action to satisfy ask but never overrides deny", async () => {
    fake.execFile.mockReset();
    successfulExec();
    const root = await directory();
    const asked = policy({ decisions: { "command.execute": "ask" } });

    await expect(
      dependencies(root, asked.service).install("wsl", { approved: true }),
    ).resolves.toContain("restart manually");

    expect(asked.assertCapability).toHaveBeenCalledWith("command.execute", { approved: true });
    expect(fake.execFile).toHaveBeenCalledWith(
      "wsl.exe",
      ["--install", "--no-distribution", "--no-launch", "--web-download"],
      expect.any(Object),
      expect.any(Function),
    );

    fake.execFile.mockClear();
    const denied = policy({ decisions: { "command.execute": "deny" } });
    await expect(
      dependencies(root, denied.service).install("wsl", { approved: true }),
    ).rejects.toThrow("command.execute deny");
    expect(fake.execFile).not.toHaveBeenCalled();
  });

  it("blocks invalid policy before installer metadata or commands", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    fake.execFile.mockReset();
    const root = await directory();
    const managed = policy({ invalid: true });

    await expect(dependencies(root, managed.service).installDocker()).rejects.toThrow(
      "managed policy is invalid",
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(fake.execFile).not.toHaveBeenCalled();
  });

  it("rechecks network policy before the later installer download phase", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<enclosure url="https://desktop.docker.com/win/main/amd64/Docker Desktop Installer.exe">',
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    fake.execFile.mockReset();
    const root = await directory();
    const managed = policy({ networkSequence: ["allow", "deny"] });

    await expect(dependencies(root, managed.service).install("docker")).rejects.toThrow(
      "network.request deny",
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      managed.assertCapability.mock.calls.filter(([name]) => name === "network.request"),
    ).toHaveLength(2);
    expect(fake.execFile).not.toHaveBeenCalled();
  });
});
