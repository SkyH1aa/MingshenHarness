import {
  MANAGED_POLICY_VERSION,
  type ManagedCapability,
  type ManagedOfficeDeliveryStatus,
  type ManagedPolicyDecision,
  type ManagedPolicyExecutionMode,
  type ManagedPolicyLayer,
  type ManagedPolicyPermissionMode,
} from "../../../shared/managed-policy";
import {
  DEFAULT_MODEL_FIRST_RESPONSE_TIMEOUT_MS,
  DEFAULT_MODEL_IDLE_TIMEOUT_MS,
  MAX_MODEL_WATCHDOG_TIMEOUT_MS,
  normalizeModelWatchdogSettings,
} from "../../../shared/model-watchdog";

export type ManagedCapabilityDraft = ManagedPolicyDecision | "inherit";

export interface ManagedPolicyDraft {
  capabilities: Partial<Record<ManagedCapability, ManagedCapabilityDraft>>;
  allowedProviders: string;
  allowedModels: string;
  deniedTools: string;
  approvalRequiredTools: string;
  allowedPermissionModes: ManagedPolicyPermissionMode[];
  allowedExecutionModes: ManagedPolicyExecutionMode[];
  officeMinimumStatus: ManagedOfficeDeliveryStatus | "inherit";
  officeMaxVisualPages: string;
  officeMaxVisualMiB: string;
  officeMaxRepairRounds: string;
}

export interface WatchdogDraft {
  firstResponseMinutes: string;
  idleMinutes: string;
}

export const EMPTY_MANAGED_POLICY_DRAFT: Readonly<ManagedPolicyDraft> = {
  capabilities: {},
  allowedProviders: "",
  allowedModels: "",
  deniedTools: "",
  approvalRequiredTools: "",
  allowedPermissionModes: [],
  allowedExecutionModes: [],
  officeMinimumStatus: "inherit",
  officeMaxVisualPages: "",
  officeMaxVisualMiB: "",
  officeMaxRepairRounds: "",
};

export function policyListFromText(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry) return false;
      const key = entry.toLocaleLowerCase("en-US");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function policyListToText(values: readonly string[] | undefined): string {
  return (values ?? []).join("\n");
}

export function managedPolicyDraftFromLayer(
  layer: ManagedPolicyLayer | null | undefined,
): ManagedPolicyDraft {
  if (!layer) {
    return {
      ...EMPTY_MANAGED_POLICY_DRAFT,
      capabilities: {},
      allowedPermissionModes: [],
      allowedExecutionModes: [],
    };
  }
  return {
    capabilities: { ...(layer.capabilities ?? {}) },
    allowedProviders: policyListToText(layer.allowedProviders),
    allowedModels: policyListToText(layer.allowedModels),
    deniedTools: policyListToText(layer.deniedTools),
    approvalRequiredTools: policyListToText(layer.approvalRequiredTools),
    allowedPermissionModes: [...(layer.allowedPermissionModes ?? [])],
    allowedExecutionModes: [...(layer.allowedExecutionModes ?? [])],
    officeMinimumStatus: layer.office?.minimumStatus ?? "inherit",
    officeMaxVisualPages: layer.office?.maxVisualPages ? String(layer.office.maxVisualPages) : "",
    officeMaxVisualMiB: layer.office?.maxVisualBytes
      ? String(Math.round((layer.office.maxVisualBytes / (1024 * 1024)) * 100) / 100)
      : "",
    officeMaxRepairRounds:
      layer.office?.maxRepairRounds === undefined ? "" : String(layer.office.maxRepairRounds),
  };
}

function optionalInteger(value: string, label: string, minimum: number, maximum: number): number {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label}不能为空`);
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label}必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return parsed;
}

function optionalPositiveNumber(value: string, label: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label}必须是正数`);
  return parsed;
}

export function managedPolicyLayerFromDraft(draft: ManagedPolicyDraft): ManagedPolicyLayer {
  const layer: ManagedPolicyLayer = { version: MANAGED_POLICY_VERSION };
  const capabilities = Object.fromEntries(
    Object.entries(draft.capabilities).filter(
      ([, decision]) => decision === "allow" || decision === "ask" || decision === "deny",
    ),
  ) as Partial<Record<ManagedCapability, ManagedPolicyDecision>>;
  if (Object.keys(capabilities).length > 0) layer.capabilities = capabilities;

  const allowedProviders = policyListFromText(draft.allowedProviders);
  const allowedModels = policyListFromText(draft.allowedModels);
  const deniedTools = policyListFromText(draft.deniedTools);
  const approvalRequiredTools = policyListFromText(draft.approvalRequiredTools);
  if (allowedProviders.length) layer.allowedProviders = allowedProviders;
  if (allowedModels.length) layer.allowedModels = allowedModels;
  if (deniedTools.length) layer.deniedTools = deniedTools;
  if (approvalRequiredTools.length) layer.approvalRequiredTools = approvalRequiredTools;
  if (draft.allowedPermissionModes.length) {
    layer.allowedPermissionModes = [...new Set(draft.allowedPermissionModes)];
  }
  if (draft.allowedExecutionModes.length) {
    layer.allowedExecutionModes = [...new Set(draft.allowedExecutionModes)];
  }

  const office: NonNullable<ManagedPolicyLayer["office"]> = {};
  if (draft.officeMinimumStatus !== "inherit") {
    office.minimumStatus = draft.officeMinimumStatus;
  }
  if (draft.officeMaxVisualPages.trim()) {
    office.maxVisualPages = optionalInteger(
      draft.officeMaxVisualPages,
      "Office 最大视觉检查页数",
      1,
      5_000,
    );
  }
  if (draft.officeMaxVisualMiB.trim()) {
    const mebibytes = optionalPositiveNumber(draft.officeMaxVisualMiB, "Office 最大视觉检查 MiB");
    office.maxVisualBytes = Math.round(mebibytes * 1024 * 1024);
  }
  if (draft.officeMaxRepairRounds.trim()) {
    office.maxRepairRounds = optionalInteger(
      draft.officeMaxRepairRounds,
      "Office 最大修复轮数",
      0,
      3,
    );
  }
  if (Object.keys(office).length) layer.office = office;
  return layer;
}

export function managedPolicyLayerHasRules(layer: ManagedPolicyLayer): boolean {
  return (
    Boolean(layer.capabilities && Object.keys(layer.capabilities).length) ||
    Boolean(layer.allowedProviders?.length) ||
    Boolean(layer.allowedModels?.length) ||
    Boolean(layer.deniedTools?.length) ||
    Boolean(layer.approvalRequiredTools?.length) ||
    Boolean(layer.allowedPermissionModes?.length) ||
    Boolean(layer.allowedExecutionModes?.length) ||
    Boolean(layer.office && Object.keys(layer.office).length)
  );
}

export function timeoutDraftFromMs(value: number): string {
  if (value === 0) return "0";
  return String(Math.round((value / 60_000) * 100) / 100);
}

export function timeoutMsFromDraft(value: string, label: string): number {
  const minutes = Number(value.trim());
  const maximumMinutes = MAX_MODEL_WATCHDOG_TIMEOUT_MS / 60_000;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > maximumMinutes) {
    throw new Error(`${label}必须是 0 到 ${maximumMinutes} 分钟之间的数值`);
  }
  return Math.round(minutes * 60_000);
}

export function watchdogSettingsFromDraft(draft: WatchdogDraft) {
  return normalizeModelWatchdogSettings({
    firstResponseTimeoutMs: timeoutMsFromDraft(draft.firstResponseMinutes, "首个有效响应等待时间"),
    idleTimeoutMs: timeoutMsFromDraft(draft.idleMinutes, "模型流空闲等待时间"),
  });
}

export function defaultWatchdogDraft(): WatchdogDraft {
  return {
    firstResponseMinutes: timeoutDraftFromMs(DEFAULT_MODEL_FIRST_RESPONSE_TIMEOUT_MS),
    idleMinutes: timeoutDraftFromMs(DEFAULT_MODEL_IDLE_TIMEOUT_MS),
  };
}
