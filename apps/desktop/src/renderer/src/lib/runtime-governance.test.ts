import { describe, expect, it } from "vitest";
import {
  managedPolicyDraftFromLayer,
  managedPolicyLayerFromDraft,
  managedPolicyLayerHasRules,
  policyListFromText,
  timeoutDraftFromMs,
  timeoutMsFromDraft,
  watchdogSettingsFromDraft,
} from "./runtime-governance";

describe("runtime governance policy editor", () => {
  it("normalizes multiline identifiers without changing their order", () => {
    expect(policyListFromText(" shell \r\nshell\npowershell.exe\nmcp__github__* ")).toEqual([
      "shell",
      "powershell.exe",
      "mcp__github__*",
    ]);
  });

  it("round-trips supported policy fields and omits empty sections", () => {
    const layer = managedPolicyLayerFromDraft({
      capabilities: {
        "web.fetch": "deny",
        "tool.execute": "inherit",
      },
      allowedProviders: "provider-a",
      allowedModels: "provider-a/model-a",
      deniedTools: "shell\nmcp__danger__*",
      approvalRequiredTools: "write_file",
      allowedPermissionModes: ["request_approval"],
      allowedExecutionModes: ["docker", "worktree"],
      officeMinimumStatus: "rendered",
      officeMaxVisualPages: "120",
      officeMaxVisualMiB: "64",
      officeMaxRepairRounds: "3",
    });

    expect(layer).toEqual({
      version: 1,
      capabilities: { "web.fetch": "deny" },
      allowedProviders: ["provider-a"],
      allowedModels: ["provider-a/model-a"],
      deniedTools: ["shell", "mcp__danger__*"],
      approvalRequiredTools: ["write_file"],
      allowedPermissionModes: ["request_approval"],
      allowedExecutionModes: ["docker", "worktree"],
      office: {
        minimumStatus: "rendered",
        maxVisualPages: 120,
        maxVisualBytes: 64 * 1024 * 1024,
        maxRepairRounds: 3,
      },
    });

    const restored = managedPolicyDraftFromLayer(layer);
    expect(restored.allowedProviders).toBe("provider-a");
    expect(restored.deniedTools).toBe("shell\nmcp__danger__*");
    expect(restored.officeMaxVisualMiB).toBe("64");
    expect(managedPolicyLayerHasRules(managedPolicyLayerFromDraft(restored))).toBe(true);
  });

  it("treats an empty editor as clearing project-agnostic user restrictions", () => {
    const layer = managedPolicyLayerFromDraft(managedPolicyDraftFromLayer(null));
    expect(layer).toEqual({ version: 1 });
    expect(managedPolicyLayerHasRules(layer)).toBe(false);
  });

  it("rejects invalid office bounds before the main process receives them", () => {
    const base = managedPolicyDraftFromLayer(null);
    expect(() =>
      managedPolicyLayerFromDraft({
        ...base,
        officeMaxVisualPages: "0",
      }),
    ).toThrow(/1 到 5000/);
    expect(() =>
      managedPolicyLayerFromDraft({
        ...base,
        officeMaxRepairRounds: "4",
      }),
    ).toThrow(/0 到 3/);
  });
});

describe("model watchdog settings draft", () => {
  it("uses minutes in the UI while storing milliseconds", () => {
    expect(timeoutDraftFromMs(300_000)).toBe("5");
    expect(timeoutMsFromDraft("15", "空闲")).toBe(900_000);
    expect(
      watchdogSettingsFromDraft({
        firstResponseMinutes: "5",
        idleMinutes: "0",
      }),
    ).toEqual({
      firstResponseTimeoutMs: 300_000,
      idleTimeoutMs: 0,
    });
  });

  it("rejects negative durations", () => {
    expect(() => timeoutMsFromDraft("-1", "空闲")).toThrow(/0 到 1440/);
    expect(() => timeoutMsFromDraft("1441", "空闲")).toThrow(/0 到 1440/);
  });
});
