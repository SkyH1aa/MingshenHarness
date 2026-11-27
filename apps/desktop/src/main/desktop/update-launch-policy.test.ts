import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ManagedPolicyLayer } from "../../shared/managed-policy";
import { assertUpdateInstallerLaunch } from "./update-launch-policy";

const roots: string[] = [];
async function policyPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mingshen-update-policy-"));
  roots.push(root);
  return join(root, "managed-policy.json");
}
function policy(command: "allow" | "ask" | "deny"): ManagedPolicyLayer {
  return { version: 1, capabilities: { "command.execute": command } };
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("update installer launch policy", () => {
  it("requires approval for a user ask policy without querying a repository", async () => {
    const machinePolicyPath = await policyPath();

    expect(() => assertUpdateInstallerLaunch(policy("ask"), false, machinePolicyPath)).toThrow(
      "command.execute",
    );
    expect(() => assertUpdateInstallerLaunch(policy("ask"), true, machinePolicyPath)).not.toThrow();
  });

  it("rereads machine policy at the final launch boundary and never lets approval override deny", async () => {
    const machinePolicyPath = await policyPath();

    expect(() =>
      assertUpdateInstallerLaunch(policy("allow"), false, machinePolicyPath),
    ).not.toThrow();

    await writeFile(machinePolicyPath, JSON.stringify(policy("deny")), "utf8");
    expect(() => assertUpdateInstallerLaunch(policy("ask"), true, machinePolicyPath)).toThrow(
      "command.execute",
    );
  });

  it("blocks both user and machine policy corruption", async () => {
    const machinePolicyPath = await policyPath();

    expect(() =>
      assertUpdateInstallerLaunch(
        { version: 1, capabilities: { "command.execute": "unknown" } },
        true,
        machinePolicyPath,
      ),
    ).toThrow("管理策略无效");

    await writeFile(machinePolicyPath, "{", "utf8");
    expect(() => assertUpdateInstallerLaunch(policy("allow"), true, machinePolicyPath)).toThrow(
      "管理策略无效",
    );
  });
});
