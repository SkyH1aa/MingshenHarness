import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderView } from "../../../shared/domain";
import {
  type EffectiveManagedPolicy,
  MANAGED_POLICY_CAPABILITIES,
  type ManagedCapability,
  type ManagedOfficeDeliveryStatus,
  type ManagedPolicyExecutionMode,
  type ManagedPolicyLayer,
  type ManagedPolicyPermissionMode,
} from "../../../shared/managed-policy";
import { isVisionTextModel } from "../../../shared/model-capabilities";
import type { ModelWatchdogSettings } from "../../../shared/model-watchdog";
import {
  DEFAULT_OFFICE_DELIVERY_SETTINGS,
  normalizeOfficeDeliverySettings,
  type OfficeDeliverySettings,
} from "../../../shared/office-delivery";
import { getLocale } from "../i18n";
import {
  defaultWatchdogDraft,
  type ManagedCapabilityDraft,
  type ManagedPolicyDraft,
  managedPolicyDraftFromLayer,
  managedPolicyLayerFromDraft,
  managedPolicyLayerHasRules,
  timeoutDraftFromMs,
  type WatchdogDraft,
  watchdogSettingsFromDraft,
} from "../lib/runtime-governance";
import { useDialog } from "./DialogProvider";
import { ExpandableText } from "./ExpandableText";
import "./runtime-governance-settings.css";

export interface RuntimeGovernanceSnapshot {
  watchdog: ModelWatchdogSettings;
  managedPolicy: {
    effective: EffectiveManagedPolicy;
    user: ManagedPolicyLayer | null;
  };
  office: OfficeDeliverySettings;
}

export interface RuntimeGovernanceAdapter {
  load(): Promise<RuntimeGovernanceSnapshot>;
  saveWatchdog(settings: ModelWatchdogSettings): Promise<ModelWatchdogSettings>;
  saveManagedUserPolicy(layer: ManagedPolicyLayer | null): Promise<void>;
  saveOfficeDelivery(settings: OfficeDeliverySettings): Promise<OfficeDeliverySettings>;
}

export interface RuntimeGovernanceSettingsProps {
  adapter: RuntimeGovernanceAdapter;
  providers: ProviderView[];
  onPendingChange?: (pending: boolean) => void;
}

type BusyOperation = "load" | "watchdog" | "policy" | "office" | null;
type Notice = { error: boolean; text: string } | null;

const CAPABILITY_LABELS: Record<ManagedCapability, string> = {
  "provider.request": "供应商请求",
  "image.generate": "图片生成",
  "network.request": "网络请求",
  "web.search": "网页搜索",
  "web.fetch": "网页读取",
  "browser.use": "内嵌浏览器",
  "file.read": "读取文件",
  "file.write": "写入文件",
  "tool.execute": "工具执行",
  "command.execute": "命令执行",
  "terminal.interactive": "交互终端",
  "mcp.connect": "MCP 连接",
  "mcp.call": "MCP 调用",
  "skill.install": "安装 Skill",
  "skill.use": "使用 Skill",
  "plugin.install": "安装插件",
  "plugin.use": "使用插件",
  "plugin.hooks": "插件 Hook",
  "marketplace.update": "扩展市场更新",
  "subagent.spawn": "创建子 Agent",
  "office.verify": "Office 验证",
  "developer.api": "开发者接口",
};

const OFFICE_STATUS_LABELS: Record<
  ManagedOfficeDeliveryStatus | "inherit",
  { zh: string; en: string }
> = {
  inherit: { zh: "不额外要求", en: "No extra requirement" },
  unverified: { zh: "允许未验证交付", en: "Allow unverified delivery" },
  structurally_valid: { zh: "至少结构正确", en: "At least structurally valid" },
  recalculated: { zh: "至少完成重算", en: "At least recalculated" },
  rendered: { zh: "至少完成渲染", en: "At least rendered" },
  visually_verified: { zh: "必须完成视觉复核", en: "Require visual verification" },
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function localized(zh: string, en: string): string {
  return getLocale() === "en" ? en : zh;
}

function policyStateLabel(state: "missing" | "valid" | "invalid"): string {
  if (state === "valid") return localized("已加载", "Loaded");
  if (state === "invalid") return localized("配置无效", "Invalid");
  return localized("未配置", "Not configured");
}

function revisionLabel(revision: string | undefined): string {
  if (!revision || revision === "missing") return localized("无", "None");
  if (revision === "invalid") return localized("无效", "Invalid");
  return revision.slice(0, 12);
}

function PolicyListField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field runtime-governance__list-field">
      <span>{label}</span>
      <textarea
        id={id}
        value={value}
        disabled={disabled}
        spellCheck={false}
        placeholder={localized(
          "每行一项；留空表示不通过此列表限制",
          "One item per line; leave empty for no list restriction",
        )}
        onChange={(event) => onChange(event.target.value)}
      />
      <small>{hint}</small>
    </label>
  );
}

export function RuntimeGovernanceSettings({
  adapter,
  providers,
  onPendingChange,
}: RuntimeGovernanceSettingsProps) {
  const { confirm } = useDialog();
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const [snapshot, setSnapshot] = useState<RuntimeGovernanceSnapshot | null>(null);
  const [watchdogDraft, setWatchdogDraft] = useState<WatchdogDraft>(defaultWatchdogDraft);
  const [policyDraft, setPolicyDraft] = useState<ManagedPolicyDraft>(() =>
    managedPolicyDraftFromLayer(null),
  );
  const [officeDraft, setOfficeDraft] = useState<OfficeDeliverySettings>(() => ({
    ...DEFAULT_OFFICE_DELIVERY_SETTINGS,
  }));
  const [busy, setBusy] = useState<BusyOperation>("load");
  const [loadError, setLoadError] = useState("");
  const [watchdogNotice, setWatchdogNotice] = useState<Notice>(null);
  const [policyNotice, setPolicyNotice] = useState<Notice>(null);
  const [officeNotice, setOfficeNotice] = useState<Notice>(null);

  const applySnapshot = useCallback((next: RuntimeGovernanceSnapshot) => {
    setSnapshot(next);
    setWatchdogDraft({
      firstResponseMinutes: timeoutDraftFromMs(next.watchdog.firstResponseTimeoutMs),
      idleMinutes: timeoutDraftFromMs(next.watchdog.idleTimeoutMs),
    });
    setPolicyDraft(managedPolicyDraftFromLayer(next.managedPolicy.user));
    setOfficeDraft(normalizeOfficeDeliverySettings(next.office));
  }, []);

  const load = useCallback(async () => {
    setBusy("load");
    setLoadError("");
    try {
      applySnapshot(await adapterRef.current.load());
    } catch (cause) {
      setLoadError(message(cause));
    } finally {
      setBusy(null);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onPendingChange?.(busy === "watchdog" || busy === "policy" || busy === "office");
  }, [busy, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);

  const saveWatchdog = async () => {
    setBusy("watchdog");
    setWatchdogNotice(null);
    try {
      const saved = await adapterRef.current.saveWatchdog(watchdogSettingsFromDraft(watchdogDraft));
      setWatchdogDraft({
        firstResponseMinutes: timeoutDraftFromMs(saved.firstResponseTimeoutMs),
        idleMinutes: timeoutDraftFromMs(saved.idleTimeoutMs),
      });
      setSnapshot((current) => (current ? { ...current, watchdog: saved } : current));
      setWatchdogNotice({
        error: false,
        text: localized(
          "连接等待设置已保存，从下一次模型请求开始生效。",
          "Connection timeouts saved. They apply to the next model request.",
        ),
      });
    } catch (cause) {
      setWatchdogNotice({ error: true, text: message(cause) });
    } finally {
      setBusy(null);
    }
  };

  const savePolicy = async (clear = false) => {
    let layer: ManagedPolicyLayer | null = null;
    if (!clear) {
      try {
        const candidate = managedPolicyLayerFromDraft(policyDraft);
        layer = managedPolicyLayerHasRules(candidate) ? candidate : null;
      } catch (cause) {
        setPolicyNotice({ error: true, text: message(cause) });
        return;
      }
    }
    if (
      clear &&
      !(await confirm({
        title: localized("清除应用策略？", "Clear application policy?"),
        description: localized(
          "这会删除当前 Windows 用户配置的所有限制。机器管理员策略和内置安全边界仍然生效。",
          "This removes restrictions configured for the current Windows user. Machine policy and built-in safety limits still apply.",
        ),
        confirmLabel: localized("清除应用策略", "Clear policy"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy("policy");
    setPolicyNotice(null);
    try {
      await adapterRef.current.saveManagedUserPolicy(layer);
      const refreshed = await adapterRef.current.load();
      applySnapshot(refreshed);
      setPolicyNotice({
        error: false,
        text: clear
          ? localized("应用策略已清除。", "Application policy cleared.")
          : localized(
              "应用策略已保存；下一次模型、工具或扩展调用前会重新检查。",
              "Application policy saved. It is checked again before the next model, tool or extension call.",
            ),
      });
    } catch (cause) {
      setPolicyNotice({ error: true, text: message(cause) });
    } finally {
      setBusy(null);
    }
  };

  const saveOffice = async () => {
    setBusy("office");
    setOfficeNotice(null);
    try {
      const saved = await adapterRef.current.saveOfficeDelivery(
        normalizeOfficeDeliverySettings(officeDraft),
      );
      setOfficeDraft(saved);
      setSnapshot((current) => (current ? { ...current, office: saved } : current));
      setOfficeNotice({
        error: false,
        text: localized(
          "Office 交付检查设置已保存。未安装渲染器或未配置视觉模型时，结果会明确标为未验证。",
          "Office delivery checks saved. Missing renderers or vision models will be reported as unverified.",
        ),
      });
    } catch (cause) {
      setOfficeNotice({ error: true, text: message(cause) });
    } finally {
      setBusy(null);
    }
  };

  const setPolicy = <K extends keyof ManagedPolicyDraft>(key: K, value: ManagedPolicyDraft[K]) => {
    setPolicyDraft((current) => ({ ...current, [key]: value }));
    setPolicyNotice(null);
  };

  const setCapability = (capability: ManagedCapability, value: ManagedCapabilityDraft) => {
    setPolicyDraft((current) => ({
      ...current,
      capabilities: { ...current.capabilities, [capability]: value },
    }));
    setPolicyNotice(null);
  };

  const togglePermissionMode = (mode: ManagedPolicyPermissionMode) => {
    setPolicy(
      "allowedPermissionModes",
      policyDraft.allowedPermissionModes.includes(mode)
        ? policyDraft.allowedPermissionModes.filter((item) => item !== mode)
        : [...policyDraft.allowedPermissionModes, mode],
    );
  };

  const toggleExecutionMode = (mode: ManagedPolicyExecutionMode) => {
    setPolicy(
      "allowedExecutionModes",
      policyDraft.allowedExecutionModes.includes(mode)
        ? policyDraft.allowedExecutionModes.filter((item) => item !== mode)
        : [...policyDraft.allowedExecutionModes, mode],
    );
  };

  const effective = snapshot?.managedPolicy.effective;
  const policyInvalid = effective?.status.state === "invalid";
  const visionModels = providers.flatMap((provider) =>
    provider.models
      .filter((model) => model.enabled && isVisionTextModel(model))
      .map((model) => ({ provider, model })),
  );
  const selectedVisionModelAvailable =
    !officeDraft.visionModelId ||
    visionModels.some(({ model }) => model.id === officeDraft.visionModelId);
  const disabled = busy !== null;

  if (!snapshot && busy === "load") {
    return (
      <section className="settings-block runtime-governance">
        <div className="runtime-governance__loading" role="status">
          <LoaderCircle className="spin" size={16} />
          {localized("正在读取运行治理配置…", "Loading runtime governance…")}
        </div>
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section className="settings-block runtime-governance">
        <div className="runtime-governance__load-error" role="alert">
          <ShieldX aria-hidden="true" size={18} />
          <div>
            <strong>
              {localized("无法读取运行治理配置", "Unable to load runtime governance")}
            </strong>
            <ExpandableText text={loadError} tone="error" />
          </div>
          <button className="btn btn--secondary" type="button" onClick={() => void load()}>
            <RefreshCw size={14} />
            {localized("重试", "Retry")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <section
        className="settings-block runtime-governance"
        aria-labelledby="runtime-policy-heading"
      >
        <div className="settings-block__heading">
          <div>
            <h3 id="runtime-policy-heading">{localized("运行治理", "Runtime governance")}</h3>
            <p>
              {localized(
                "机器策略与应用策略只能收紧宿主能力。项目文件、Agent 指令和完全访问不会放宽这里的限制。",
                "Machine and application policy can only tighten host capabilities. Project files, agent instructions and Full Access cannot relax these limits.",
              )}
            </p>
          </div>
          <button
            className="btn btn--ghost"
            type="button"
            disabled={disabled}
            aria-label={localized("刷新策略状态", "Refresh policy status")}
            title={localized("刷新策略状态", "Refresh policy status")}
            onClick={() => void load()}
          >
            <RefreshCw size={14} />
            {localized("刷新", "Refresh")}
          </button>
        </div>
        {loadError ? (
          <div className="runtime-governance__refresh-error" role="alert">
            <AlertTriangle aria-hidden="true" size={15} />
            <div>
              <strong>{localized("策略状态刷新失败", "Policy status refresh failed")}</strong>
              <ExpandableText text={loadError} tone="error" />
            </div>
          </div>
        ) : null}

        <div
          className={`runtime-governance__state ${policyInvalid ? "runtime-governance__state--blocked" : ""}`}
          role={policyInvalid ? "alert" : "status"}
        >
          {policyInvalid ? (
            <ShieldX aria-hidden="true" size={20} />
          ) : (
            <ShieldCheck aria-hidden="true" size={20} />
          )}
          <div>
            <strong>
              {policyInvalid
                ? localized("策略异常，新执行已暂停", "Policy invalid; new execution is paused")
                : localized("策略已生效", "Policy active")}
            </strong>
            <span>
              {policyInvalid
                ? localized(
                    "历史记录、停止和诊断仍可使用。修复无效策略后再开始新请求。",
                    "History, stopping and diagnostics remain available. Fix the invalid policy before starting new work.",
                  )
                : localized(
                    `有效策略 revision ${revisionLabel(effective?.status.revision)}`,
                    `Effective policy revision ${revisionLabel(effective?.status.revision)}`,
                  )}
            </span>
          </div>
        </div>

        <fieldset className="runtime-governance__authority">
          <legend className="visually-hidden">{localized("策略来源", "Policy sources")}</legend>
          <div className="runtime-governance__authority-row">
            <span className="runtime-governance__authority-icon">
              <ShieldCheck aria-hidden="true" size={15} />
            </span>
            <div>
              <strong>{localized("机器管理员策略", "Machine administrator policy")}</strong>
              <small>
                {localized("只读", "Read only")} ·{" "}
                {policyStateLabel(effective?.status.machine.state ?? "missing")}
                {" · "}
                {revisionLabel(effective?.status.machine.revision)}
              </small>
              {effective?.status.machine.path ? <code>{effective.status.machine.path}</code> : null}
              {effective?.status.machine.error ? (
                <ExpandableText text={effective.status.machine.error} tone="error" />
              ) : null}
            </div>
          </div>
          <div className="runtime-governance__authority-row">
            <span className="runtime-governance__authority-icon">
              <ShieldCheck aria-hidden="true" size={15} />
            </span>
            <div>
              <strong>{localized("当前用户应用策略", "Current user application policy")}</strong>
              <small>
                {policyStateLabel(effective?.status.user.state ?? "missing")}
                {" · "}
                {revisionLabel(effective?.status.user.revision)}
              </small>
              {effective?.status.user.error ? (
                <ExpandableText text={effective.status.user.error} tone="error" />
              ) : null}
            </div>
          </div>
        </fieldset>

        <p className="runtime-governance__boundary">
          {localized(
            "这些设置控制 Mingshen 是否启动宿主能力，不属于 Windows 沙箱。已经发出的请求、命令或远程操作不会被撤回。",
            "These settings control whether Mingshen starts host capabilities. They are not a Windows sandbox and do not undo requests, commands or remote operations already sent.",
          )}
        </p>
      </section>

      <section className="settings-block runtime-governance" aria-labelledby="watchdog-heading">
        <div className="settings-block__heading">
          <div>
            <h3 id="watchdog-heading">
              <Clock3 aria-hidden="true" size={14} />
              {localized("模型连接等待", "Model connection watchdog")}
            </h3>
            <p>
              {localized(
                "只限制一次模型请求的网络等待，不限制工具执行、审批、子 Agent 或整个任务的总时长。",
                "Limits network waiting for one model request only, not tool execution, approvals, subagents or the whole task.",
              )}
            </p>
          </div>
        </div>
        <div className="settings-form-grid">
          <label className="field">
            <span>{localized("首个有效响应（分钟）", "First meaningful response (minutes)")}</span>
            <input
              type="number"
              min={0}
              max={1440}
              step={0.5}
              value={watchdogDraft.firstResponseMinutes}
              disabled={disabled}
              onChange={(event) => {
                setWatchdogDraft((current) => ({
                  ...current,
                  firstResponseMinutes: event.target.value,
                }));
                setWatchdogNotice(null);
              }}
            />
            <small>
              {watchdogDraft.firstResponseMinutes === "0"
                ? localized("0 表示关闭此等待检测", "0 disables this timeout")
                : localized("默认 5 分钟", "Default: 5 minutes")}
            </small>
          </label>
          <label className="field">
            <span>{localized("流空闲等待（分钟）", "Idle stream timeout (minutes)")}</span>
            <input
              type="number"
              min={0}
              max={1440}
              step={0.5}
              value={watchdogDraft.idleMinutes}
              disabled={disabled}
              onChange={(event) => {
                setWatchdogDraft((current) => ({
                  ...current,
                  idleMinutes: event.target.value,
                }));
                setWatchdogNotice(null);
              }}
            />
            <small>
              {watchdogDraft.idleMinutes === "0"
                ? localized("0 表示关闭此等待检测", "0 disables this timeout")
                : localized("默认 15 分钟", "Default: 15 minutes")}
            </small>
          </label>
        </div>
        <p className="form-note">
          {localized(
            "正文、思考和工具参数的有效进展会重置空闲计时；心跳和用量事件不会。超时沿用现有重试预算，用户主动停止不重试，未完成的工具调用不会执行。",
            "Meaningful text, reasoning and tool-argument progress resets idle time; heartbeats and usage events do not. Timeouts use the existing retry budget. User stops are not retried and incomplete tool calls never execute.",
          )}
        </p>
        <div className="settings-actions">
          <button
            className="btn btn--primary"
            type="button"
            disabled={disabled}
            onClick={() => void saveWatchdog()}
          >
            {busy === "watchdog" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
            {localized("保存连接等待", "Save timeouts")}
          </button>
        </div>
        {watchdogNotice ? (
          watchdogNotice.error ? (
            <ExpandableText text={watchdogNotice.text} tone="error" />
          ) : (
            <p className="form-note" role="status">
              {watchdogNotice.text}
            </p>
          )
        ) : null}
      </section>

      <section
        className="settings-block runtime-governance"
        aria-labelledby="application-policy-heading"
      >
        <div className="settings-block__heading">
          <div>
            <h3 id="application-policy-heading">
              <CheckCircle2 aria-hidden="true" size={14} />
              {localized("应用策略", "Application policy")}
            </h3>
            <p>
              {localized(
                "这些规则只约束当前 Windows 用户。留空不会放宽机器策略；机器策略的拒绝和审批要求始终优先。",
                "These rules apply to the current Windows user. Leaving a field empty never relaxes machine policy; machine denials and approval requirements always take precedence.",
              )}
            </p>
          </div>
        </div>

        <details className="runtime-governance__details">
          <summary>{localized("能力与网络", "Capabilities and network")}</summary>
          <div className="runtime-governance__capability-grid">
            {MANAGED_POLICY_CAPABILITIES.map((capability) => (
              <label key={capability} className="runtime-governance__capability-row">
                <span>
                  <strong>{CAPABILITY_LABELS[capability]}</strong>
                  <code>{capability}</code>
                </span>
                <select
                  value={policyDraft.capabilities[capability] ?? "inherit"}
                  disabled={disabled}
                  onChange={(event) =>
                    setCapability(capability, event.target.value as ManagedCapabilityDraft)
                  }
                >
                  <option value="inherit">{localized("不额外限制", "No extra restriction")}</option>
                  <option value="allow">{localized("允许", "Allow")}</option>
                  <option value="ask">{localized("每次审批", "Require approval")}</option>
                  <option value="deny">{localized("禁止", "Deny")}</option>
                </select>
              </label>
            ))}
          </div>
        </details>

        <div className="settings-form-grid runtime-governance__policy-lists">
          <PolicyListField
            id="policy-denied-tools"
            label={localized("禁止的工具", "Denied tools")}
            hint={localized(
              "支持精确名称或 * 通配符，例如 shell、mcp__github__*。",
              "Exact names or * wildcards, for example shell or mcp__github__*.",
            )}
            value={policyDraft.deniedTools}
            disabled={disabled}
            onChange={(value) => setPolicy("deniedTools", value)}
          />
          <PolicyListField
            id="policy-approval-tools"
            label={localized("强制审批的工具", "Approval-required tools")}
            hint={localized(
              "命中的工具每次都需要审批，不能被完全访问跳过。",
              "Matching tools always require approval and cannot be bypassed by Full Access.",
            )}
            value={policyDraft.approvalRequiredTools}
            disabled={disabled}
            onChange={(value) => setPolicy("approvalRequiredTools", value)}
          />
          <PolicyListField
            id="policy-allowed-providers"
            label={localized("仅允许的供应商", "Allowed providers")}
            hint={localized(
              "填写供应商 ID 或名称；留空表示不增加供应商白名单。",
              "Provider IDs or names; empty adds no provider allowlist.",
            )}
            value={policyDraft.allowedProviders}
            disabled={disabled}
            onChange={(value) => setPolicy("allowedProviders", value)}
          />
          <PolicyListField
            id="policy-allowed-models"
            label={localized("仅允许的模型", "Allowed models")}
            hint={localized(
              "可填写模型配置 ID、model ID 或 provider/model；留空不增加模型白名单。",
              "Model config IDs, model IDs or provider/model; empty adds no model allowlist.",
            )}
            value={policyDraft.allowedModels}
            disabled={disabled}
            onChange={(value) => setPolicy("allowedModels", value)}
          />
        </div>

        <div className="runtime-governance__mode-groups">
          <fieldset>
            <legend>{localized("允许的会话权限", "Allowed session permissions")}</legend>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={policyDraft.allowedPermissionModes.includes("request_approval")}
                disabled={disabled}
                onChange={() => togglePermissionMode("request_approval")}
              />
              {localized("请求批准", "Request approval")}
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={policyDraft.allowedPermissionModes.includes("full_access")}
                disabled={disabled}
                onChange={() => togglePermissionMode("full_access")}
              />
              {localized("完全访问", "Full Access")}
            </label>
            <small>
              {localized(
                "全不选表示不增加限制；只选一项会形成允许列表。",
                "None selected adds no restriction; selecting one creates an allowlist.",
              )}
            </small>
          </fieldset>
          <fieldset>
            <legend>{localized("允许的执行模式", "Allowed execution modes")}</legend>
            {(
              [
                ["host", localized("本机", "Host")],
                ["worktree", "Git worktree"],
                ["docker", "Docker"],
              ] as const
            ).map(([mode, label]) => (
              <label key={mode} className="checkbox-line">
                <input
                  type="checkbox"
                  checked={policyDraft.allowedExecutionModes.includes(mode)}
                  disabled={disabled}
                  onChange={() => toggleExecutionMode(mode)}
                />
                {label}
              </label>
            ))}
            <small>
              {localized(
                "全不选表示不增加限制；隔离不可用时不会回退为本机执行。",
                "None selected adds no restriction; unavailable isolation never falls back to Host.",
              )}
            </small>
          </fieldset>
        </div>

        <details className="runtime-governance__details">
          <summary>
            {localized("Office 交付最低要求", "Minimum Office delivery requirements")}
          </summary>
          <div className="settings-form-grid">
            <label className="field">
              <span>{localized("最低交付状态", "Minimum delivery status")}</span>
              <select
                value={policyDraft.officeMinimumStatus}
                disabled={disabled}
                onChange={(event) =>
                  setPolicy(
                    "officeMinimumStatus",
                    event.target.value as ManagedPolicyDraft["officeMinimumStatus"],
                  )
                }
              >
                {Object.entries(OFFICE_STATUS_LABELS).map(([status, labels]) => (
                  <option key={status} value={status}>
                    {localized(labels.zh, labels.en)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{localized("最大视觉检查页数", "Maximum visual pages")}</span>
              <input
                type="number"
                min={1}
                max={5000}
                value={policyDraft.officeMaxVisualPages}
                disabled={disabled}
                placeholder={localized("不限", "Unlimited")}
                onChange={(event) => setPolicy("officeMaxVisualPages", event.target.value)}
              />
            </label>
            <label className="field">
              <span>
                {localized("最大视觉图片预算（MiB）", "Maximum visual image budget (MiB)")}
              </span>
              <input
                type="number"
                min={0.01}
                value={policyDraft.officeMaxVisualMiB}
                disabled={disabled}
                placeholder={localized("不限", "Unlimited")}
                onChange={(event) => setPolicy("officeMaxVisualMiB", event.target.value)}
              />
            </label>
            <label className="field">
              <span>{localized("最大自动修复轮数", "Maximum repair rounds")}</span>
              <input
                type="number"
                min={0}
                max={3}
                value={policyDraft.officeMaxRepairRounds}
                disabled={disabled}
                placeholder={localized("不额外限制", "No extra limit")}
                onChange={(event) => setPolicy("officeMaxRepairRounds", event.target.value)}
              />
            </label>
          </div>
        </details>

        <div className="settings-actions">
          <button
            className="btn btn--ghost"
            type="button"
            disabled={disabled}
            onClick={() => void savePolicy(true)}
          >
            {localized("清除应用策略", "Clear application policy")}
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={disabled}
            onClick={() => void savePolicy()}
          >
            {busy === "policy" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
            {localized("保存应用策略", "Save application policy")}
          </button>
        </div>
        {policyNotice ? (
          policyNotice.error ? (
            <ExpandableText text={policyNotice.text} tone="error" />
          ) : (
            <p className="form-note" role="status">
              {policyNotice.text}
            </p>
          )
        ) : null}
      </section>

      <section
        className="settings-block runtime-governance"
        aria-labelledby="office-delivery-heading"
      >
        <div className="settings-block__heading">
          <div>
            <h3 id="office-delivery-heading">
              <FileCheck2 aria-hidden="true" size={14} />
              {localized("Office 交付检查", "Office delivery checks")}
            </h3>
            <p>
              {localized(
                "检测已安装的 Microsoft Office 或 LibreOffice，并在受控副本上重算、渲染和逐页复核。不会自动安装 Office 或覆盖源文件。",
                "Uses installed Microsoft Office or LibreOffice to recalculate, render and inspect controlled copies. It never installs Office or overwrites the source file.",
              )}
            </p>
          </div>
        </div>

        <label className="setting-row setting-row--interactive">
          <span className="setting-row__label">
            <span>
              <strong>{localized("启用视觉复核", "Enable visual review")}</strong>
              <small>
                {localized(
                  "视觉模型不可用或超出预算时，仍可交付文件，但会列出未验证项。",
                  "If the vision model is unavailable or over budget, the file may still be delivered with explicit unverified items.",
                )}
              </small>
            </span>
          </span>
          <input
            type="checkbox"
            checked={officeDraft.visualEnabled}
            disabled={disabled}
            onChange={(event) => {
              setOfficeDraft({ ...officeDraft, visualEnabled: event.target.checked });
              setOfficeNotice(null);
            }}
          />
        </label>

        <div className="settings-form-grid">
          <label className="field settings-form-grid__full">
            <span>{localized("视觉检查模型", "Vision review model")}</span>
            <select
              value={officeDraft.visionModelId ?? ""}
              disabled={disabled || !officeDraft.visualEnabled}
              onChange={(event) => {
                setOfficeDraft({
                  ...officeDraft,
                  visionModelId: event.target.value || null,
                });
                setOfficeNotice(null);
              }}
            >
              <option value="">{localized("使用当前会话模型", "Use current session model")}</option>
              {!selectedVisionModelAvailable ? (
                <option value={officeDraft.visionModelId ?? ""}>
                  {localized(
                    `已配置但当前不可用：${officeDraft.visionModelId}`,
                    `Configured but unavailable: ${officeDraft.visionModelId}`,
                  )}
                </option>
              ) : null}
              {visionModels.map(({ provider, model }) => (
                <option key={model.id} value={model.id}>
                  {provider.name} / {model.displayName}
                </option>
              ))}
            </select>
            <small>
              {visionModels.length
                ? localized(
                    "只列出已启用且支持图片输入、文本输出的模型。",
                    "Only enabled models with image input and text output are listed.",
                  )
                : localized(
                    "当前没有可用的视觉文本模型；Office 仍会做结构、重算和渲染检查，但视觉项保持未验证。",
                    "No vision text model is available. Office still checks structure, recalculation and rendering, but visual items remain unverified.",
                  )}
            </small>
          </label>
          <label className="field">
            <span>{localized("自动修复轮数", "Automatic repair rounds")}</span>
            <select
              value={officeDraft.maxRepairRounds}
              disabled={disabled}
              onChange={(event) => {
                setOfficeDraft({ ...officeDraft, maxRepairRounds: Number(event.target.value) });
                setOfficeNotice(null);
              }}
            >
              <option value={0}>{localized("不自动修复", "No automatic repair")}</option>
              <option value={1}>{localized("最多 1 轮", "Up to 1 round")}</option>
              <option value={2}>{localized("最多 2 轮", "Up to 2 rounds")}</option>
              <option value={3}>
                {localized("最多 3 轮（默认）", "Up to 3 rounds (default)")}
              </option>
            </select>
          </label>
          <label className="field">
            <span>{localized("每批页数", "Pages per batch")}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={officeDraft.batchPages}
              disabled={disabled}
              onChange={(event) =>
                setOfficeDraft({ ...officeDraft, batchPages: Number(event.target.value) })
              }
            />
            <small>{localized("默认 12，硬上限 20", "Default 12, hard limit 20")}</small>
          </label>
          <label className="field">
            <span>{localized("每批图片预算（MiB）", "Image bytes per batch (MiB)")}</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={Math.round((officeDraft.batchMaxBytes / (1024 * 1024)) * 100) / 100}
              disabled={disabled}
              onChange={(event) =>
                setOfficeDraft({
                  ...officeDraft,
                  batchMaxBytes: Math.round(event.target.valueAsNumber * 1024 * 1024),
                })
              }
            />
            <small>
              {localized("默认 12 MiB，硬上限 20 MiB", "Default 12 MiB, hard limit 20 MiB")}
            </small>
          </label>
          <label className="field">
            <span>{localized("每轮最大页数", "Maximum pages per round")}</span>
            <input
              type="number"
              min={1}
              max={200}
              value={officeDraft.maxPages}
              disabled={disabled}
              onChange={(event) =>
                setOfficeDraft({ ...officeDraft, maxPages: Number(event.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>{localized("每轮图片预算（MiB）", "Image bytes per round (MiB)")}</span>
            <input
              type="number"
              min={1}
              max={200}
              value={Math.round((officeDraft.maxImageBytes / (1024 * 1024)) * 100) / 100}
              disabled={disabled}
              onChange={(event) =>
                setOfficeDraft({
                  ...officeDraft,
                  maxImageBytes: Math.round(event.target.valueAsNumber * 1024 * 1024),
                })
              }
            />
          </label>
        </div>
        <p className="form-note">
          {localized(
            "PDF 成功导出不等于视觉验收。只有实际完成逐页检查并保存证据时，交付状态才会显示为已验证；环境缺失、模型不可用或预算截断都会明确列出。",
            "A successful PDF export is not visual approval. Delivery is verified only after actual page-by-page evidence; missing environments, models or truncated budgets are reported explicitly.",
          )}
        </p>
        <div className="settings-actions">
          <button
            className="btn btn--primary"
            type="button"
            disabled={disabled}
            onClick={() => void saveOffice()}
          >
            {busy === "office" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
            {localized("保存 Office 检查", "Save Office checks")}
          </button>
        </div>
        {officeNotice ? (
          officeNotice.error ? (
            <ExpandableText text={officeNotice.text} tone="error" />
          ) : (
            <p className="form-note" role="status">
              {officeNotice.text}
            </p>
          )
        ) : null}
        {policyInvalid ? (
          <p className="runtime-governance__blocked-note" role="alert">
            <AlertTriangle aria-hidden="true" size={15} />
            {localized(
              "策略异常期间可以查看和修复设置，但新的 Office 检查会被阻止。",
              "Settings can be inspected and repaired while policy is invalid, but new Office checks are blocked.",
            )}
          </p>
        ) : null}
      </section>
    </>
  );
}
