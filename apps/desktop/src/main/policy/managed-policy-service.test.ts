import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderView } from "../../shared/domain";
import { MANAGED_POLICY_USER_SETTING } from "../../shared/managed-policy";
import type { Repository } from "../storage/repository";
import {
  ManagedPolicyError,
  ManagedPolicyService,
  normalizeManagedPolicyLayer,
} from "./managed-policy-service";

function capturePolicyError(action: () => void): ManagedPolicyError {
  try {
    action();
  } catch (error) {
    if (error instanceof ManagedPolicyError) return error;
    throw error;
  }
  throw new Error("Expected a ManagedPolicyError");
}

describe("ManagedPolicyService", () => {
  let root: string;
  let machinePolicyPath: string;
  let userPolicy: unknown;

  const provider = {
    id: "provider-a",
    name: "Company AI",
    models: [
      {
        id: "model-config-a",
        providerId: "provider-a",
        modelId: "model-a",
        displayName: "Model A",
      },
      {
        id: "model-config-b",
        providerId: "provider-a",
        modelId: "model-b",
        displayName: "Model B",
      },
    ],
  } as unknown as ProviderView;

  function service(): ManagedPolicyService {
    const repository = {
      getSetting: (key: string) => (key === MANAGED_POLICY_USER_SETTING ? userPolicy : null),
      getProvider: (id: string) => (id === provider.id ? provider : null),
      getModel: (id: string) => provider.models.find((model) => model.id === id) ?? null,
    } as unknown as Repository;
    return new ManagedPolicyService(repository, { machinePolicyPath });
  }

  async function writeMachine(layer: unknown): Promise<void> {
    await writeFile(machinePolicyPath, JSON.stringify(layer), "utf8");
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mingshen-policy-"));
    machinePolicyPath = join(root, "managed-policy.json");
    userPolicy = null;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps the existing behavior when neither policy layer is configured", () => {
    const policy = service();
    expect(policy.status().state).toBe("ok");
    expect(policy.status().machine.state).toBe("missing");
    expect(policy.evaluateCapability("provider.request").decision).toBe("allow");
    expect(policy.evaluateTool("read_file").decision).toBe("allow");
  });

  it("combines restrictions with deny over ask and ask over allow", () => {
    userPolicy = {
      version: 1,
      capabilities: {
        "provider.request": "allow",
        "network.request": "ask",
      },
    };
    const policy = service();
    expect(policy.evaluateCapability("network.request").decision).toBe("ask");
    expect(() => policy.assertCapability("network.request")).toThrow(ManagedPolicyError);
    expect(() => policy.assertCapability("network.request", { approved: true })).not.toThrow();
    expect(() => policy.assertProvider("provider-a")).toThrow(/network.request/);
    expect(() => policy.assertProvider("provider-a", undefined, { approved: true })).not.toThrow();

    userPolicy = {
      version: 1,
      capabilities: {
        "provider.request": "deny",
        "network.request": "ask",
      },
    };
    const denied = service();
    expect(denied.evaluateCapability("provider.request").decision).toBe("deny");
    expect(denied.evaluateCapability("network.request").decision).toBe("ask");
  });

  it("fails closed when the machine policy is malformed and recovers after repair", async () => {
    await writeFile(machinePolicyPath, "{ not json", "utf8");
    const policy = service();
    expect(policy.status().state).toBe("invalid");
    const error = capturePolicyError(() => policy.assertOperational("模型请求"));
    expect(error.message).toMatch(/管理策略无效/);
    expect(error.sources).toEqual([
      expect.objectContaining({
        layer: "machine",
        decision: "deny",
        path: machinePolicyPath,
      }),
    ]);
    expect(policy.status().machine.path).toBe(machinePolicyPath);

    await writeMachine({ version: 1, capabilities: { "provider.request": "deny" } });
    expect(policy.status().state).toBe("ok");
    expect(() => policy.assertProvider("provider-a")).toThrow(/禁止 provider.request/);
    expect(policy.evaluateCapability("provider.request").decision).toBe("deny");
  });

  it("detects live policy tightening without reconstructing the service", async () => {
    const policy = service();
    await writeMachine({ version: 1, capabilities: { "command.execute": "deny" } });
    expect(policy.evaluateCapability("command.execute").decision).toBe("deny");
    await writeMachine({ version: 1, capabilities: { "command.execute": "allow" } });
    expect(policy.evaluateCapability("command.execute").decision).toBe("allow");
  });

  it("attributes denials to the exact machine or user policy layer", async () => {
    await writeMachine({
      version: 1,
      capabilities: { "provider.request": "deny" },
    });
    userPolicy = {
      version: 1,
      capabilities: { "network.request": "ask" },
    };
    const policy = service();
    const status = policy.status();
    const evaluation = policy.evaluateCapability("provider.request");
    expect(evaluation.sources).toEqual([
      {
        layer: "machine",
        revision: status.machine.revision,
        decision: "deny",
        reason: "机器策略将 provider.request 设为 deny",
        path: machinePolicyPath,
      },
    ]);
    expect(evaluation.reason).toContain(`机器策略（${machinePolicyPath}）`);
    expect(policy.evaluateCapability("network.request").sources).toEqual([
      {
        layer: "user",
        revision: status.user.revision,
        decision: "ask",
        reason: "应用策略将 network.request 设为 ask",
      },
    ]);

    const error = capturePolicyError(() => policy.assertCapability("provider.request"));
    expect(error.revision).toBe(status.revision);
    expect(error.sources).toEqual(evaluation.sources);
    expect(error.message).toContain(machinePolicyPath);

    const effective = policy.effectivePolicy();
    expect(effective.capabilityDecisionsByLayer?.machine["provider.request"]).toBe("deny");
    expect(effective.capabilityDecisionsByLayer?.user["network.request"]).toBe("ask");
    expect(status.user.revision).toBe(effective.status.user.revision);
  });

  it("intersects provider and model allowlists", async () => {
    await writeMachine({
      version: 1,
      allowedProviders: ["provider-a"],
      allowedModels: ["provider-a/model-a"],
    });
    userPolicy = { version: 1, allowedModels: ["company ai:model-a"] };
    const policy = service();
    expect(() => policy.assertProvider("provider-a", "model-config-a")).not.toThrow();
    expect(() => policy.assertProvider("provider-a", "model-config-b")).toThrow(/未允许模型/);
    expect(() => policy.assertProvider("provider-other")).toThrow(/未允许供应商/);
  });

  it("applies denied tools before approval-required patterns", async () => {
    await writeMachine({
      version: 1,
      capabilities: { "tool.execute": "allow" },
      approvalRequiredTools: ["write_*"],
      deniedTools: ["write_secret*"],
    });
    const policy = service();
    expect(policy.evaluateTool("write_file").decision).toBe("ask");
    expect(policy.evaluateTool("write_secret_file").decision).toBe("deny");
    expect(policy.evaluateTool("read_file").decision).toBe("allow");
    expect(() => policy.assertToolAllowed("write_file", { approved: true })).not.toThrow();

    const denied = policy.evaluateTool("write_secret_file");
    expect(denied.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: "machine",
          decision: "deny",
          reason: "机器策略的 deniedTools 匹配 write_secret_file",
        }),
      ]),
    );
    const error = capturePolicyError(() => policy.assertToolAllowed("write_secret_file"));
    expect(error.revision).toBe(denied.revision);
    expect(error.sources).toEqual(denied.sources);
    expect(error.message).toContain(machinePolicyPath);
  });

  it("intersects permission and execution modes", async () => {
    await writeMachine({
      version: 1,
      allowedPermissionModes: ["request_approval", "full_access"],
      allowedExecutionModes: ["docker", "host"],
    });
    userPolicy = {
      version: 1,
      allowedPermissionModes: ["request_approval"],
      allowedExecutionModes: ["docker"],
    };
    const policy = service();
    expect(() => policy.assertPermissionMode("request_approval")).not.toThrow();
    expect(() => policy.assertPermissionMode("full_access")).toThrow(/不允许权限模式/);
    expect(() => policy.assertExecutionMode("docker")).not.toThrow();
    expect(() => policy.assertExecutionMode("host")).toThrow(/不允许执行模式/);
  });

  it("uses the strictest office verification and budget requirement", async () => {
    await writeMachine({
      version: 1,
      office: {
        minimumStatus: "rendered",
        maxVisualPages: 200,
        maxVisualBytes: 200 * 1024 * 1024,
        maxRepairRounds: 3,
      },
    });
    userPolicy = {
      version: 1,
      office: {
        minimumStatus: "visually_verified",
        maxVisualPages: 100,
        maxVisualBytes: 100 * 1024 * 1024,
        maxRepairRounds: 2,
      },
    };
    const policy = service();
    const evaluation = policy.evaluateOfficeDelivery("rendered");
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.required).toBe("visually_verified");
    expect(evaluation.maxVisualPages).toBe(100);
    expect(evaluation.maxVisualBytes).toBe(100 * 1024 * 1024);
    expect(evaluation.maxRepairRounds).toBe(2);
    expect(() => policy.assertOfficeMinimum("visually_verified")).not.toThrow();
  });

  it("rejects unknown fields and unsupported versions instead of ignoring them", () => {
    expect(() =>
      normalizeManagedPolicyLayer({ version: 1, capabilities: { typo: "deny" } }),
    ).toThrow(/未知能力/);
    expect(() => normalizeManagedPolicyLayer({ version: 2, capabilities: {} })).toThrow(
      /不支持策略版本/,
    );
    expect(() => normalizeManagedPolicyLayer({ version: 1, deniedTool: ["shell"] })).toThrow(
      /未知字段/,
    );
  });

  it("treats malformed user settings as invalid instead of silently dropping them", () => {
    userPolicy = { version: 1, deniedTools: "run_*" };
    const policy = service();
    expect(policy.status().state).toBe("invalid");
    expect(policy.status().user.error).toMatch(/用户策略格式无效/);
    expect(() => policy.assertCapability("provider.request")).toThrow(/管理策略无效/);
  });
});
