import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EffectiveManagedPolicy,
  ManagedCapability,
  ManagedOfficeDeliveryStatus,
  ManagedPolicyDecision,
  ManagedPolicyEvaluation,
  ManagedPolicyExecutionMode,
  ManagedPolicyLayer,
  ManagedPolicyLayerStatus,
  ManagedPolicyPermissionMode,
  ManagedPolicySource,
  ManagedPolicySourceLayer,
  ManagedPolicyStatus,
  OfficePolicyEvaluation,
} from "../../shared/managed-policy";
import {
  MANAGED_OFFICE_STATUS_ORDER,
  MANAGED_POLICY_CAPABILITIES,
  MANAGED_POLICY_CAPABILITY_SET,
  MANAGED_POLICY_USER_SETTING,
  MANAGED_POLICY_VERSION,
} from "../../shared/managed-policy";
import type { Repository } from "../storage/repository";

const MAX_MACHINE_POLICY_BYTES = 256 * 1024;
const MAX_POLICY_ITEMS = 1_000;
const MAX_POLICY_VALUE_LENGTH = 512;
const DECISIONS = new Set<ManagedPolicyDecision>(["allow", "ask", "deny"]);
const PERMISSION_MODES = new Set<ManagedPolicyPermissionMode>(["request_approval", "full_access"]);
const EXECUTION_MODES = new Set<ManagedPolicyExecutionMode>(["host", "worktree", "docker"]);
const OFFICE_STATUSES = new Set<ManagedOfficeDeliveryStatus>(
  Object.keys(MANAGED_OFFICE_STATUS_ORDER) as ManagedOfficeDeliveryStatus[],
);

type PolicyRepository = Pick<Repository, "getSetting" | "getProvider" | "getModel">;

interface ManagedPolicyServiceOptions {
  machinePolicyPath?: string;
}

interface ReadLayer {
  status: ManagedPolicyLayerStatus;
  layer: ManagedPolicyLayer | null;
}

interface ReadLayers {
  machine: ReadLayer;
  user: ReadLayer;
  revision: string;
}

interface PolicySnapshot {
  layers: ReadLayers;
  policy: EffectiveManagedPolicy;
}

interface ParsedOperationOptions {
  approved?: boolean;
}

export class ManagedPolicyError extends Error {
  constructor(
    readonly code: "POLICY_BLOCKED" | "POLICY_INVALID" | "POLICY_APPROVAL_REQUIRED",
    message: string,
    readonly revision: string,
    readonly sources: readonly ManagedPolicySource[] = [],
  ) {
    super(message);
    this.name = "ManagedPolicyError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !allowedSet.has(key));
  if (unknown) throw new Error(`${label}包含未知字段：${unknown}`);
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_POLICY_ITEMS) {
    throw new Error(`${label}必须是数组，且最多 ${MAX_POLICY_ITEMS} 项`);
  }
  const values = value.map((entry, index) => {
    if (
      typeof entry !== "string" ||
      !entry.trim() ||
      entry.length > MAX_POLICY_VALUE_LENGTH ||
      entry.includes("\0")
    ) {
      throw new Error(`${label}[${index}]格式无效`);
    }
    return entry.trim();
  });
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = entry.toLocaleLowerCase("en-US");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label}必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return Number(value);
}

export function normalizeManagedPolicyLayer(value: unknown): ManagedPolicyLayer {
  if (!isRecord(value)) throw new Error("策略必须是 JSON 对象");
  assertKeys(
    value,
    [
      "version",
      "capabilities",
      "allowedProviders",
      "allowedModels",
      "deniedTools",
      "approvalRequiredTools",
      "allowedPermissionModes",
      "allowedExecutionModes",
      "office",
    ],
    "策略",
  );
  if (value.version !== MANAGED_POLICY_VERSION) {
    throw new Error(`不支持策略版本 ${String(value.version)}`);
  }

  const normalized: ManagedPolicyLayer = { version: MANAGED_POLICY_VERSION };
  if (value.capabilities !== undefined) {
    if (!isRecord(value.capabilities)) throw new Error("capabilities 必须是对象");
    const capabilities: Partial<Record<ManagedCapability, ManagedPolicyDecision>> = {};
    for (const [name, decision] of Object.entries(value.capabilities)) {
      if (!MANAGED_POLICY_CAPABILITY_SET.has(name)) {
        throw new Error(`capabilities 包含未知能力：${name}`);
      }
      if (typeof decision !== "string" || !DECISIONS.has(decision as ManagedPolicyDecision)) {
        throw new Error(`能力 ${name} 的策略必须是 allow、ask 或 deny`);
      }
      capabilities[name as ManagedCapability] = decision as ManagedPolicyDecision;
    }
    normalized.capabilities = capabilities;
  }
  if (value.allowedProviders !== undefined) {
    normalized.allowedProviders = stringList(value.allowedProviders, "allowedProviders");
  }
  if (value.allowedModels !== undefined) {
    normalized.allowedModels = stringList(value.allowedModels, "allowedModels");
  }
  if (value.deniedTools !== undefined) {
    normalized.deniedTools = stringList(value.deniedTools, "deniedTools");
  }
  if (value.approvalRequiredTools !== undefined) {
    normalized.approvalRequiredTools = stringList(
      value.approvalRequiredTools,
      "approvalRequiredTools",
    );
  }
  if (value.allowedPermissionModes !== undefined) {
    const modes = stringList(value.allowedPermissionModes, "allowedPermissionModes");
    if (modes.some((mode) => !PERMISSION_MODES.has(mode as ManagedPolicyPermissionMode))) {
      throw new Error("allowedPermissionModes 包含未知权限模式");
    }
    normalized.allowedPermissionModes = modes as ManagedPolicyPermissionMode[];
  }
  if (value.allowedExecutionModes !== undefined) {
    const modes = stringList(value.allowedExecutionModes, "allowedExecutionModes");
    if (modes.some((mode) => !EXECUTION_MODES.has(mode as ManagedPolicyExecutionMode))) {
      throw new Error("allowedExecutionModes 包含未知执行模式");
    }
    normalized.allowedExecutionModes = modes as ManagedPolicyExecutionMode[];
  }
  if (value.office !== undefined) {
    if (!isRecord(value.office)) throw new Error("office 必须是对象");
    assertKeys(
      value.office,
      ["minimumStatus", "maxVisualPages", "maxVisualBytes", "maxRepairRounds"],
      "office",
    );
    const office: NonNullable<ManagedPolicyLayer["office"]> = {};
    if (value.office.minimumStatus !== undefined) {
      if (
        typeof value.office.minimumStatus !== "string" ||
        !OFFICE_STATUSES.has(value.office.minimumStatus as ManagedOfficeDeliveryStatus)
      ) {
        throw new Error("office.minimumStatus 无效");
      }
      office.minimumStatus = value.office.minimumStatus as ManagedOfficeDeliveryStatus;
    }
    if (value.office.maxVisualPages !== undefined) {
      office.maxVisualPages = boundedInteger(
        value.office.maxVisualPages,
        "office.maxVisualPages",
        1,
        5_000,
      );
    }
    if (value.office.maxVisualBytes !== undefined) {
      office.maxVisualBytes = boundedInteger(
        value.office.maxVisualBytes,
        "office.maxVisualBytes",
        1,
        50 * 1024 * 1024 * 1024,
      );
    }
    if (value.office.maxRepairRounds !== undefined) {
      office.maxRepairRounds = boundedInteger(
        value.office.maxRepairRounds,
        "office.maxRepairRounds",
        0,
        3,
      );
    }
    normalized.office = office;
  }
  return normalized;
}

function canonicalPolicy(layer: ManagedPolicyLayer): string {
  const capabilities = Object.fromEntries(
    MANAGED_POLICY_CAPABILITIES.flatMap((name) =>
      layer.capabilities?.[name] ? [[name, layer.capabilities[name]]] : [],
    ),
  );
  return JSON.stringify({
    version: layer.version,
    capabilities,
    allowedProviders: layer.allowedProviders,
    allowedModels: layer.allowedModels,
    deniedTools: layer.deniedTools,
    approvalRequiredTools: layer.approvalRequiredTools,
    allowedPermissionModes: layer.allowedPermissionModes,
    allowedExecutionModes: layer.allowedExecutionModes,
    office: layer.office,
  });
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function policySource(
  layer: ManagedPolicySourceLayer,
  status: ManagedPolicyLayerStatus,
  decision: ManagedPolicyDecision,
  reason: string,
): ManagedPolicySource {
  return {
    layer,
    revision: status.revision,
    decision,
    reason,
    ...(status.path ? { path: status.path } : {}),
  };
}

function sourceLabel(source: ManagedPolicySource): string {
  return source.layer === "machine"
    ? `机器策略（${source.path ?? "%ProgramData%\\MingshenHarness\\managed-policy.json"}）`
    : "应用策略（当前用户）";
}

function reasonWithSources(reason: string, sources: readonly ManagedPolicySource[]): string {
  if (!sources.length) return reason;
  const labels = [...new Set(sources.map(sourceLabel))];
  return `${reason}。来源：${labels.join("、")}`;
}

function wildcardMatches(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.toLocaleLowerCase("en-US");
  const normalizedValue = value.toLocaleLowerCase("en-US");
  if (!normalizedPattern.includes("*")) return normalizedPattern === normalizedValue;
  const expression = normalizedPattern
    .split("*")
    .map((part) => part.replaceAll(/[\\^$.*+?()[\]{}|]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`, "u").test(normalizedValue);
}

function matchAny(patterns: readonly string[], value: string): boolean {
  return patterns.some((pattern) => wildcardMatches(pattern, value));
}

function defaultMachinePolicyPath(): string {
  const root =
    process.env.ProgramData?.trim() || process.env.ALLUSERSPROFILE?.trim() || "C:\\ProgramData";
  return join(root, "MingshenHarness", "managed-policy.json");
}

export class ManagedPolicyService {
  private readonly machinePolicyPath: string;

  constructor(
    private readonly repository: PolicyRepository,
    options: ManagedPolicyServiceOptions = {},
  ) {
    this.machinePolicyPath = options.machinePolicyPath ?? defaultMachinePolicyPath();
  }

  private readMachinePolicy(): ReadLayer {
    let metadata: ReturnType<typeof lstatSync>;
    try {
      metadata = lstatSync(this.machinePolicyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          layer: null,
          status: { state: "missing", revision: "missing", path: this.machinePolicyPath },
        };
      }
      return {
        layer: null,
        status: {
          state: "invalid",
          revision: "invalid",
          path: this.machinePolicyPath,
          error: `无法读取机器策略：${safeError(error)}`,
        },
      };
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return {
        layer: null,
        status: {
          state: "invalid",
          revision: "invalid",
          path: this.machinePolicyPath,
          error: "机器策略必须是非符号链接的普通文件",
        },
      };
    }
    if (metadata.size > MAX_MACHINE_POLICY_BYTES) {
      return {
        layer: null,
        status: {
          state: "invalid",
          revision: "invalid",
          path: this.machinePolicyPath,
          error: `机器策略超过 ${MAX_MACHINE_POLICY_BYTES} 字节上限`,
        },
      };
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(this.machinePolicyPath);
    } catch (error) {
      return {
        layer: null,
        status: {
          state: "invalid",
          revision: "invalid",
          path: this.machinePolicyPath,
          error: `无法读取机器策略：${safeError(error)}`,
        },
      };
    }
    const revision = hash(bytes);
    try {
      const layer = normalizeManagedPolicyLayer(JSON.parse(bytes.toString("utf8")));
      return {
        layer,
        status: { state: "valid", revision, path: this.machinePolicyPath },
      };
    } catch (error) {
      return {
        layer: null,
        status: {
          state: "invalid",
          revision,
          path: this.machinePolicyPath,
          error: `机器策略格式无效：${safeError(error)}`,
        },
      };
    }
  }

  private readUserPolicy(): ReadLayer {
    let stored: unknown;
    try {
      stored = this.repository.getSetting(MANAGED_POLICY_USER_SETTING);
    } catch (error) {
      return {
        layer: null,
        status: {
          state: "invalid",
          revision: "invalid",
          error: `无法读取用户策略：${safeError(error)}`,
        },
      };
    }
    if (stored === null) {
      return { layer: null, status: { state: "missing", revision: "missing" } };
    }
    try {
      const layer = normalizeManagedPolicyLayer(stored);
      const revision = hash(canonicalPolicy(layer));
      return { layer, status: { state: "valid", revision } };
    } catch (error) {
      return {
        layer: null,
        status: {
          state: "invalid",
          revision: hash(JSON.stringify(stored)),
          error: `用户策略格式无效：${safeError(error)}`,
        },
      };
    }
  }

  private readLayers(): ReadLayers {
    const machine = this.readMachinePolicy();
    const user = this.readUserPolicy();
    return {
      machine,
      user,
      revision: hash(`${machine.status.revision}\n${user.status.revision}`),
    };
  }

  status(): ManagedPolicyStatus {
    const layers = this.readLayers();
    return {
      state:
        layers.machine.status.state === "invalid" || layers.user.status.state === "invalid"
          ? "invalid"
          : "ok",
      machine: layers.machine.status,
      user: layers.user.status,
      revision: layers.revision,
    };
  }

  userLayer(): ManagedPolicyLayer | null {
    return this.readUserPolicy().layer;
  }

  private snapshot(): PolicySnapshot {
    const layers = this.readLayers();
    return { layers, policy: this.buildEffectivePolicy(layers) };
  }

  private buildEffectivePolicy(layers: ReadLayers): EffectiveManagedPolicy {
    const active = [layers.machine.layer, layers.user.layer].filter(
      (layer): layer is ManagedPolicyLayer => layer !== null,
    );
    const capabilities = Object.fromEntries(
      MANAGED_POLICY_CAPABILITIES.map((capability) => {
        let decision: ManagedPolicyDecision = "allow";
        for (const layer of active) {
          const candidate = layer.capabilities?.[capability];
          if (candidate === "deny") decision = "deny";
          else if (candidate === "ask" && decision !== "deny") decision = "ask";
        }
        return [capability, decision];
      }),
    ) as Record<ManagedCapability, ManagedPolicyDecision>;
    const capabilityDecisionsByLayer: NonNullable<
      EffectiveManagedPolicy["capabilityDecisionsByLayer"]
    > = {
      machine: { ...(layers.machine.layer?.capabilities ?? {}) },
      user: { ...(layers.user.layer?.capabilities ?? {}) },
    };
    const allPermissionModes: ManagedPolicyPermissionMode[] = ["request_approval", "full_access"];
    const allExecutionModes: ManagedPolicyExecutionMode[] = ["host", "worktree", "docker"];
    let permissionModes = allPermissionModes;
    let executionModes = allExecutionModes;
    const office: NonNullable<ManagedPolicyLayer["office"]> = {};
    for (const layer of active) {
      if (layer.allowedPermissionModes) {
        const allowed = new Set(layer.allowedPermissionModes);
        permissionModes = permissionModes.filter((mode) => allowed.has(mode));
      }
      if (layer.allowedExecutionModes) {
        const allowed = new Set(layer.allowedExecutionModes);
        executionModes = executionModes.filter((mode) => allowed.has(mode));
      }
      if (layer.office?.minimumStatus) {
        const current = office.minimumStatus;
        if (
          !current ||
          MANAGED_OFFICE_STATUS_ORDER[layer.office.minimumStatus] >
            MANAGED_OFFICE_STATUS_ORDER[current]
        ) {
          office.minimumStatus = layer.office.minimumStatus;
        }
      }
      for (const key of ["maxVisualPages", "maxVisualBytes", "maxRepairRounds"] as const) {
        const value = layer.office?.[key];
        if (value === undefined) continue;
        office[key] = Math.min(office[key] ?? Number.MAX_SAFE_INTEGER, value);
      }
    }
    return {
      status: {
        state:
          layers.machine.status.state === "invalid" || layers.user.status.state === "invalid"
            ? "invalid"
            : "ok",
        machine: layers.machine.status,
        user: layers.user.status,
        revision: layers.revision,
      },
      capabilities,
      capabilityDecisionsByLayer,
      allowedProvidersByLayer: active.flatMap((layer) =>
        layer.allowedProviders ? [layer.allowedProviders] : [],
      ),
      allowedModelsByLayer: active.flatMap((layer) =>
        layer.allowedModels ? [layer.allowedModels] : [],
      ),
      deniedTools: active.flatMap((layer) => layer.deniedTools ?? []),
      approvalRequiredTools: active.flatMap((layer) => layer.approvalRequiredTools ?? []),
      permissionModes,
      executionModes,
      office,
    };
  }

  effectivePolicy(): EffectiveManagedPolicy {
    return this.snapshot().policy;
  }

  private capabilitySources(
    policy: EffectiveManagedPolicy,
    capability: ManagedCapability,
    decision: ManagedPolicyDecision,
  ): ManagedPolicySource[] {
    const sources: ManagedPolicySource[] = [];
    for (const layer of ["machine", "user"] as const) {
      const layerDecision = policy.capabilityDecisionsByLayer?.[layer][capability];
      if (layerDecision !== decision) continue;
      sources.push(
        policySource(
          layer,
          policy.status[layer],
          decision,
          `${layer === "machine" ? "机器" : "应用"}策略将 ${capability} 设为 ${decision}`,
        ),
      );
    }
    return sources;
  }

  private invalidPolicySources(status: ManagedPolicyStatus): ManagedPolicySource[] {
    return (["machine", "user"] as const).flatMap((layer) => {
      const layerStatus = status[layer];
      if (layerStatus.state !== "invalid") return [];
      return [
        policySource(
          layer,
          layerStatus,
          "deny",
          layerStatus.error ?? `${layer === "machine" ? "机器" : "应用"}策略配置无效`,
        ),
      ];
    });
  }

  assertOperational(operation: string): void {
    const status = this.status();
    if (status.state === "ok") return;
    const errors = [status.machine, status.user].flatMap((layer) =>
      layer.state === "invalid" ? [layer.error ?? "策略配置无效"] : [],
    );
    const sources = this.invalidPolicySources(status);
    throw new ManagedPolicyError(
      "POLICY_INVALID",
      reasonWithSources(
        `管理策略无效，已暂停${operation}。请由管理员修复策略文件或用户策略配置。${errors.join("；")}`,
        sources,
      ),
      status.revision,
      sources,
    );
  }

  evaluateCapability(
    capability: ManagedCapability,
    options: ParsedOperationOptions = {},
  ): ManagedPolicyEvaluation {
    const { policy } = this.snapshot();
    this.throwIfInvalid(policy, `能力 ${capability}`);
    const policyDecision = policy.capabilities[capability];
    const approved = options.approved === true;
    const decision = policyDecision === "ask" && approved ? "allow" : policyDecision;
    const sources =
      policyDecision === "allow" ? [] : this.capabilitySources(policy, capability, policyDecision);
    const reason =
      policyDecision === "deny"
        ? `管理策略禁止 ${capability}`
        : policyDecision === "ask" && !approved
          ? `管理策略要求 ${capability} 先获得批准`
          : policyDecision === "ask"
            ? `管理策略允许 ${capability}（本操作已获批准）`
            : `管理策略允许 ${capability}`;
    return {
      decision,
      capability,
      policyDecision,
      approved,
      revision: policy.status.revision,
      reason: reasonWithSources(reason, sources),
      sources,
    };
  }

  assertCapability(capability: ManagedCapability, options: ParsedOperationOptions = {}): void {
    const evaluation = this.evaluateCapability(capability, options);
    if (evaluation.decision === "allow") return;
    throw new ManagedPolicyError(
      evaluation.decision === "ask" ? "POLICY_APPROVAL_REQUIRED" : "POLICY_BLOCKED",
      evaluation.reason,
      evaluation.revision,
      evaluation.sources,
    );
  }

  evaluateTool(toolName: string): ManagedPolicyEvaluation {
    if (!toolName.trim() || toolName.length > MAX_POLICY_VALUE_LENGTH || toolName.includes("\0")) {
      throw new Error("工具名称无效");
    }
    const { layers, policy } = this.snapshot();
    this.throwIfInvalid(policy, `工具 ${toolName}`);
    const capability = policy.capabilities["tool.execute"];
    const denied = matchAny(policy.deniedTools, toolName);
    const approval = denied ? false : matchAny(policy.approvalRequiredTools, toolName);
    const deniedToolSources = (["machine", "user"] as const).flatMap((layer) => {
      const candidate = layers[layer];
      if (!candidate.layer?.deniedTools?.some((pattern) => wildcardMatches(pattern, toolName))) {
        return [];
      }
      return [
        policySource(
          layer,
          candidate.status,
          "deny",
          `${layer === "machine" ? "机器" : "应用"}策略的 deniedTools 匹配 ${toolName}`,
        ),
      ];
    });
    const approvalToolSources = (["machine", "user"] as const).flatMap((layer) => {
      const candidate = layers[layer];
      if (
        !candidate.layer?.approvalRequiredTools?.some((pattern) =>
          wildcardMatches(pattern, toolName),
        )
      ) {
        return [];
      }
      return [
        policySource(
          layer,
          candidate.status,
          "ask",
          `${layer === "machine" ? "机器" : "应用"}策略的 approvalRequiredTools 匹配 ${toolName}`,
        ),
      ];
    });
    const policyDecision: ManagedPolicyDecision = denied
      ? "deny"
      : capability === "deny"
        ? "deny"
        : capability === "ask" || approval
          ? "ask"
          : "allow";
    const capabilityDecision = denied ? "deny" : capability;
    const sources =
      policyDecision === "allow"
        ? []
        : policyDecision === "deny"
          ? [
              ...deniedToolSources,
              ...this.capabilitySources(policy, "tool.execute", capabilityDecision),
            ]
          : [...approvalToolSources, ...this.capabilitySources(policy, "tool.execute", "ask")];
    const reason =
      denied && deniedToolSources.length
        ? `管理策略禁止工具 ${toolName}`
        : approval && approvalToolSources.length
          ? `管理策略要求工具 ${toolName} 先获得批准`
          : policyDecision === "deny"
            ? "管理策略禁止工具执行"
            : policyDecision === "ask"
              ? "管理策略要求工具执行前获得批准"
              : `管理策略允许工具 ${toolName}`;
    return {
      decision: policyDecision,
      capability: "tool.execute",
      policyDecision,
      approved: false,
      revision: policy.status.revision,
      reason: reasonWithSources(reason, sources),
      sources,
    };
  }

  assertToolAllowed(toolName: string, options: ParsedOperationOptions = {}): void {
    const evaluation = this.evaluateTool(toolName);
    if (evaluation.decision === "allow" || (evaluation.decision === "ask" && options.approved)) {
      return;
    }
    throw new ManagedPolicyError(
      evaluation.decision === "ask" ? "POLICY_APPROVAL_REQUIRED" : "POLICY_BLOCKED",
      evaluation.reason,
      evaluation.revision,
      evaluation.sources,
    );
  }

  assertProvider(
    providerId: string,
    modelConfigId?: string,
    options: ParsedOperationOptions = {},
  ): void {
    const snapshot = this.snapshot();
    const { layers, policy } = snapshot;
    this.throwIfInvalid(policy, "模型或供应商请求");
    const provider = this.repository.getProvider(providerId);
    const model = modelConfigId ? this.repository.getModel(modelConfigId) : null;
    if (modelConfigId && (!model || model.providerId !== providerId)) {
      throw new ManagedPolicyError(
        "POLICY_BLOCKED",
        "无法确认模型所属供应商，管理策略已阻止请求。",
        policy.status.revision,
      );
    }
    const layerEntries = (["machine", "user"] as const).flatMap((name) => {
      const candidate = layers[name];
      return candidate.layer ? [{ name, status: candidate.status, layer: candidate.layer }] : [];
    });
    const providerSelectors = new Set(
      [providerId, provider?.id, provider?.name]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLocaleLowerCase("en-US")),
    );
    for (const entry of layerEntries) {
      const allowed = entry.layer.allowedProviders;
      if (!allowed) continue;
      if (!allowed.some((entry) => providerSelectors.has(entry.toLocaleLowerCase("en-US")))) {
        const source = policySource(
          entry.name,
          entry.status,
          "deny",
          `${entry.name === "machine" ? "机器" : "应用"}策略的 allowedProviders 未包含 ${provider?.name ?? providerId}`,
        );
        throw new ManagedPolicyError(
          "POLICY_BLOCKED",
          reasonWithSources(`管理策略未允许供应商 ${provider?.name ?? providerId}`, [source]),
          policy.status.revision,
          [source],
        );
      }
    }
    const modelLimitSources = layerEntries.flatMap((entry) =>
      entry.layer.allowedModels
        ? [
            policySource(
              entry.name,
              entry.status,
              "deny",
              `${entry.name === "machine" ? "机器" : "应用"}策略通过 allowedModels 限定模型`,
            ),
          ]
        : [],
    );
    if (modelLimitSources.length && !model) {
      throw new ManagedPolicyError(
        "POLICY_BLOCKED",
        reasonWithSources(
          modelConfigId
            ? "管理策略限定了模型，当前模型无法核验"
            : "管理策略限定了模型，当前请求未提供可核验的模型",
          modelLimitSources,
        ),
        policy.status.revision,
        modelLimitSources,
      );
    }
    if (model && modelLimitSources.length) {
      const modelSelectors = new Set(
        [
          model.id,
          model.modelId,
          `${providerId}/${model.modelId}`,
          `${providerId}:${model.modelId}`,
          provider ? `${provider.name}/${model.modelId}` : "",
          provider ? `${provider.name}:${model.modelId}` : "",
          provider ? `${provider.name}/${model.displayName}` : "",
        ]
          .filter(Boolean)
          .map((value) => value.toLocaleLowerCase("en-US")),
      );
      for (const entry of layerEntries) {
        const allowed = entry.layer.allowedModels;
        if (!allowed) continue;
        if (!allowed.some((entry) => modelSelectors.has(entry.toLocaleLowerCase("en-US")))) {
          const source = policySource(
            entry.name,
            entry.status,
            "deny",
            `${entry.name === "machine" ? "机器" : "应用"}策略的 allowedModels 未包含 ${provider?.name ?? providerId} / ${model.displayName}`,
          );
          throw new ManagedPolicyError(
            "POLICY_BLOCKED",
            reasonWithSources(
              `管理策略未允许模型 ${provider?.name ?? providerId} / ${model.displayName}`,
              [source],
            ),
            policy.status.revision,
            [source],
          );
        }
      }
    }
    this.managedCapabilityCheck("provider.request", options, snapshot);
    this.managedCapabilityCheck("network.request", options, snapshot);
  }

  assertPermissionMode(mode: ManagedPolicyPermissionMode): void {
    const { layers, policy } = this.snapshot();
    this.throwIfInvalid(policy, "会话权限");
    if (!policy.permissionModes.includes(mode)) {
      const sources = (["machine", "user"] as const).flatMap((layer) => {
        const candidate = layers[layer];
        if (!candidate.layer?.allowedPermissionModes?.includes(mode)) {
          if (!candidate.layer?.allowedPermissionModes) return [];
          return [
            policySource(
              layer,
              candidate.status,
              "deny",
              `${layer === "machine" ? "机器" : "应用"}策略不允许权限模式 ${mode}`,
            ),
          ];
        }
        return [];
      });
      throw new ManagedPolicyError(
        "POLICY_BLOCKED",
        reasonWithSources(`管理策略不允许权限模式 ${mode}`, sources),
        policy.status.revision,
        sources,
      );
    }
  }

  assertExecutionMode(mode: ManagedPolicyExecutionMode): void {
    const { layers, policy } = this.snapshot();
    this.throwIfInvalid(policy, "会话执行模式");
    if (!policy.executionModes.includes(mode)) {
      const sources = (["machine", "user"] as const).flatMap((layer) => {
        const candidate = layers[layer];
        if (candidate.layer?.allowedExecutionModes) {
          if (candidate.layer.allowedExecutionModes.includes(mode)) return [];
          return [
            policySource(
              layer,
              candidate.status,
              "deny",
              `${layer === "machine" ? "机器" : "应用"}策略不允许执行模式 ${mode}`,
            ),
          ];
        }
        return [];
      });
      throw new ManagedPolicyError(
        "POLICY_BLOCKED",
        reasonWithSources(`管理策略不允许执行模式 ${mode}`, sources),
        policy.status.revision,
        sources,
      );
    }
  }

  evaluateOfficeDelivery(actual: ManagedOfficeDeliveryStatus): OfficePolicyEvaluation {
    const { layers, policy } = this.snapshot();
    this.throwIfInvalid(policy, "办公交付验证");
    const required = policy.office.minimumStatus ?? null;
    const allowed =
      required === null ||
      MANAGED_OFFICE_STATUS_ORDER[actual] >= MANAGED_OFFICE_STATUS_ORDER[required];
    const sources =
      required === null
        ? []
        : (["machine", "user"] as const).flatMap((layer) => {
            const candidate = layers[layer];
            if (candidate.layer?.office?.minimumStatus !== required) return [];
            return [
              policySource(
                layer,
                candidate.status,
                "deny",
                `${layer === "machine" ? "机器" : "应用"}策略要求办公交付至少达到 ${required}`,
              ),
            ];
          });
    return {
      allowed,
      actual,
      required,
      maxVisualPages: policy.office.maxVisualPages ?? null,
      maxVisualBytes: policy.office.maxVisualBytes ?? null,
      maxRepairRounds: policy.office.maxRepairRounds ?? null,
      revision: policy.status.revision,
      sources,
    };
  }

  assertOfficeMinimum(actual: ManagedOfficeDeliveryStatus): void {
    const evaluation = this.evaluateOfficeDelivery(actual);
    if (evaluation.allowed) return;
    throw new ManagedPolicyError(
      "POLICY_BLOCKED",
      reasonWithSources(
        `办公交付验证状态 ${actual} 未达到管理策略要求 ${evaluation.required}`,
        evaluation.sources ?? [],
      ),
      evaluation.revision,
      evaluation.sources,
    );
  }

  private throwIfInvalid(policy: EffectiveManagedPolicy, operation: string): void {
    if (policy.status.state === "ok") return;
    const errors = [policy.status.machine, policy.status.user].flatMap((layer) =>
      layer.state === "invalid" ? [layer.error ?? "策略配置无效"] : [],
    );
    const sources = this.invalidPolicySources(policy.status);
    throw new ManagedPolicyError(
      "POLICY_INVALID",
      reasonWithSources(`管理策略无效，已暂停${operation}。${errors.join("；")}`, sources),
      policy.status.revision,
      sources,
    );
  }

  private managedCapabilityCheck(
    capability: ManagedCapability,
    options: ParsedOperationOptions,
    existingSnapshot?: PolicySnapshot,
  ): void {
    const { policy } = existingSnapshot ?? this.snapshot();
    this.throwIfInvalid(policy, `能力 ${capability}`);
    const policyDecision = policy.capabilities[capability];
    if (policyDecision === "allow" || (policyDecision === "ask" && options.approved)) return;
    const sources = this.capabilitySources(policy, capability, policyDecision);
    throw new ManagedPolicyError(
      policyDecision === "ask" ? "POLICY_APPROVAL_REQUIRED" : "POLICY_BLOCKED",
      reasonWithSources(
        policyDecision === "ask"
          ? `管理策略要求 ${capability} 先获得批准`
          : `管理策略禁止 ${capability}`,
        sources,
      ),
      policy.status.revision,
      sources,
    );
  }
}
