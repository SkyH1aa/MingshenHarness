export const MANAGED_POLICY_VERSION = 1 as const;
export const MANAGED_POLICY_USER_SETTING = "managedPolicy.user.v1";

export const MANAGED_POLICY_CAPABILITIES = [
  "provider.request",
  "image.generate",
  "network.request",
  "web.search",
  "web.fetch",
  "browser.use",
  "file.read",
  "file.write",
  "tool.execute",
  "command.execute",
  "terminal.interactive",
  "mcp.connect",
  "mcp.call",
  "skill.install",
  "skill.use",
  "plugin.install",
  "plugin.use",
  "plugin.hooks",
  "marketplace.update",
  "subagent.spawn",
  "office.verify",
  "developer.api",
] as const;

export type ManagedCapability = (typeof MANAGED_POLICY_CAPABILITIES)[number];
export type ManagedPolicyDecision = "allow" | "ask" | "deny";
export type ManagedPolicySourceLayer = "machine" | "user";
export type ManagedPolicyPermissionMode = "request_approval" | "full_access";
export type ManagedPolicyExecutionMode = "host" | "worktree" | "docker";
export type ManagedOfficeDeliveryStatus =
  | "unverified"
  | "structurally_valid"
  | "recalculated"
  | "rendered"
  | "visually_verified";

export interface ManagedPolicyOffice {
  minimumStatus?: ManagedOfficeDeliveryStatus;
  maxVisualPages?: number;
  maxVisualBytes?: number;
  maxRepairRounds?: number;
}

/**
 * A policy document can only restrict the capabilities already provided by
 * Mingshen. Tool patterns are exact identifiers or simple `*` glob patterns.
 * Provider/model allowlists accept stable ids first; names are supported for
 * machine deployment convenience and should not be used when ids are unique.
 */
export interface ManagedPolicyLayer {
  version: typeof MANAGED_POLICY_VERSION;
  capabilities?: Partial<Record<ManagedCapability, ManagedPolicyDecision>>;
  allowedProviders?: string[];
  allowedModels?: string[];
  deniedTools?: string[];
  approvalRequiredTools?: string[];
  allowedPermissionModes?: ManagedPolicyPermissionMode[];
  allowedExecutionModes?: ManagedPolicyExecutionMode[];
  office?: ManagedPolicyOffice;
}

export interface ManagedPolicyLayerStatus {
  state: "missing" | "valid" | "invalid";
  revision: string;
  path?: string;
  error?: string;
}

export interface ManagedPolicyStatus {
  state: "ok" | "invalid";
  machine: ManagedPolicyLayerStatus;
  user: ManagedPolicyLayerStatus;
  revision: string;
}

export interface ManagedPolicySource {
  layer: ManagedPolicySourceLayer;
  revision: string;
  decision: ManagedPolicyDecision;
  reason: string;
  path?: string;
}

export interface EffectiveManagedPolicy {
  status: ManagedPolicyStatus;
  capabilities: Record<ManagedCapability, ManagedPolicyDecision>;
  capabilityDecisionsByLayer?: Record<
    ManagedPolicySourceLayer,
    Partial<Record<ManagedCapability, ManagedPolicyDecision>>
  >;
  allowedProvidersByLayer: string[][];
  allowedModelsByLayer: string[][];
  deniedTools: string[];
  approvalRequiredTools: string[];
  permissionModes: ManagedPolicyPermissionMode[];
  executionModes: ManagedPolicyExecutionMode[];
  office: ManagedPolicyOffice;
}

export interface ManagedPolicyEvaluation {
  decision: ManagedPolicyDecision;
  capability: ManagedCapability;
  policyDecision: ManagedPolicyDecision;
  approved: boolean;
  revision: string;
  reason: string;
  sources?: ManagedPolicySource[];
}

export interface OfficePolicyEvaluation {
  allowed: boolean;
  actual: ManagedOfficeDeliveryStatus;
  required: ManagedOfficeDeliveryStatus | null;
  maxVisualPages: number | null;
  maxVisualBytes: number | null;
  maxRepairRounds: number | null;
  revision: string;
  sources?: ManagedPolicySource[];
}

export const MANAGED_POLICY_CAPABILITY_SET = new Set<string>(MANAGED_POLICY_CAPABILITIES);
export const MANAGED_OFFICE_STATUS_ORDER: Record<ManagedOfficeDeliveryStatus, number> = {
  unverified: 0,
  structurally_valid: 1,
  recalculated: 2,
  rendered: 3,
  visually_verified: 4,
};
