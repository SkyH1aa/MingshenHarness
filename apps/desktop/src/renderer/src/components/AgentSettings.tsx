import { Bot, Pencil, Plus, Save, ShieldCheck, Trash2, X } from "lucide-react";
import { useState } from "react";
import { DEFAULT_TOOL_ROUNDS, MAX_TOOL_ROUNDS } from "../../../shared/agent-limits";
import { supportsSubagentModel } from "../../../shared/agent-profile-model";
import type {
  AgentProfileRole,
  AgentProfileSaveInput,
  AgentProfileView,
  ProviderView,
} from "../../../shared/domain";
import { tr } from "../i18n/index";
import { useDialog } from "./DialogProvider";
import { ModelPicker } from "./ModelPicker";

interface AgentSettingsProps {
  profiles: AgentProfileView[];
  providers: ProviderView[];
  onChanged: () => Promise<void>;
}

function emptyDraft(): AgentProfileSaveInput {
  return {
    name: "",
    description: "",
    role: "subagent",
    instructions: "",
    modelId: null,
    readOnly: false,
    enabled: true,
    hidden: false,
    permissions: {
      read: "allow",
      edit: "allow",
      bash: "ask",
      task: "allow",
      webfetch: "ask",
      websearch: "ask",
      lsp: "allow",
    },
    toolAllowlist: [],
    temperature: null,
    topP: null,
    maxSteps: DEFAULT_TOOL_ROUNDS,
    color: null,
  };
}

function profileToDraft(profile: AgentProfileView): AgentProfileSaveInput {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    role: profile.role,
    instructions: profile.instructions,
    modelId: profile.modelId ?? null,
    readOnly: profile.readOnly,
    enabled: profile.enabled,
    hidden: profile.hidden,
    sourcePath: profile.sourcePath,
    permissions: profile.permissions,
    toolAllowlist: profile.toolAllowlist,
    temperature: profile.temperature,
    topP: profile.topP,
    maxSteps: profile.maxSteps,
    color: profile.color,
  };
}

export function AgentSettings({ profiles, providers, onChanged }: AgentSettingsProps) {
  const { confirm } = useDialog();
  const [draft, setDraft] = useState<AgentProfileSaveInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modelProviders = providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.enabled),
    }))
    .filter((provider) => provider.models.length > 0);
  const selectedModelProvider = modelProviders.find((provider) =>
    provider.models.some((model) => model.id === draft?.modelId),
  );

  const save = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await window.mingshen.saveAgentProfile(draft);
      await onChanged();
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (profile: AgentProfileView) => {
    const accepted = await confirm({
      title: tr("\u5220\u9664 Agent \u914D\u7F6E"),
      description: tr(
        "\u5220\u9664\u300C{0}\u300D\uFF1F\u5DF2\u521B\u5EFA\u7684\u4F1A\u8BDD\u4F1A\u56DE\u9000\u5230\u4E3B Agent\u3002",
        [profile.name],
      ),
      confirmLabel: tr("\u5220\u9664 Agent"),
      tone: "danger",
    });
    if (!accepted) {
      return;
    }
    await window.mingshen.removeAgentProfile(profile.id);
    await onChanged();
  };

  if (draft) {
    return (
      <div className="settings-page">
        <section className="settings-block">
          <div className="settings-block__heading">
            <div>
              <h3>{draft.id ? tr("\u7F16\u8F91 Agent") : tr("\u65B0\u5EFA Agent")}</h3>
              <p>
                {tr(
                  "Agent \u914D\u7F6E\u4F1A\u6CE8\u5165\u7CFB\u7EDF\u63D0\u793A\uFF1B\u53EF\u4F5C\u4E3A\u5B50 Agent \u8C03\u7528\u7684\u914D\u7F6E\u8FD8\u53EF\u5355\u72EC\u9009\u62E9\u5B50 Agent \u6A21\u578B\u3002",
                )}
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={tr("\u5173\u95ED Agent \u7F16\u8F91")}
              onClick={() => setDraft(null)}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
          <div className="settings-form-grid">
            <label className="field">
              <span>{tr("\u540D\u79F0")}</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder={tr("\u4F8B\u5982\uFF1A\u4EE3\u7801\u5BA1\u67E5")}
              />
            </label>
            <label className="field">
              <span>{tr("\u7C7B\u578B")}</span>
              <select
                value={draft.role}
                disabled={Boolean(draft.id)}
                onChange={(event) => {
                  const role = event.target.value as AgentProfileRole;
                  setDraft({
                    ...draft,
                    role,
                    modelId: supportsSubagentModel(role) ? (draft.modelId ?? null) : null,
                  });
                }}
              >
                <option value="primary">{tr("\u4E3B Agent")}</option>
                <option value="plan">{tr("\u53EA\u8BFB Plan")}</option>
                <option value="subagent">Subagent</option>
                <option value="all">{tr("\u4E3B Agent + Subagent")}</option>
              </select>
            </label>
            <label className="field settings-form-grid__full">
              <span>{tr("\u63CF\u8FF0")}</span>
              <input
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder={tr("\u8FD9\u4E2A Agent \u8D1F\u8D23\u4EC0\u4E48")}
              />
            </label>
            {supportsSubagentModel(draft.role) ? (
              <div className="field">
                <span>{tr("\u5B50 Agent \u6A21\u578B")}</span>
                <ModelPicker
                  providers={modelProviders}
                  value={
                    selectedModelProvider && draft.modelId
                      ? { providerId: selectedModelProvider.id, configId: draft.modelId }
                      : null
                  }
                  onChange={({ configId }) => setDraft({ ...draft, modelId: configId })}
                  disabled={saving}
                  ariaLabel={tr("\u5B50 Agent \u6A21\u578B")}
                  placeholder={tr("\u4F7F\u7528\u4E3B\u4F1A\u8BDD\u6A21\u578B")}
                  onClear={() => setDraft({ ...draft, modelId: null })}
                />
              </div>
            ) : null}
            <div className="field">
              <span>{tr("\u80FD\u529B\u8FB9\u754C")}</span>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={draft.readOnly}
                  onChange={(event) => setDraft({ ...draft, readOnly: event.target.checked })}
                />
                {tr("只读：禁止写入、删除和命令；仅允许委派给只读子 Agent")}
              </label>
            </div>
            <label className="field">
              <span>{tr("\u6E29\u5EA6")}</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    temperature: event.target.value ? Number(event.target.value) : null,
                  })
                }
                placeholder={tr("\u7EE7\u627F\u6A21\u578B\u9ED8\u8BA4\u503C")}
              />
            </label>
            <label className="field">
              <span>Top P</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.topP ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    topP: event.target.value ? Number(event.target.value) : null,
                  })
                }
                placeholder={tr("\u7EE7\u627F\u6A21\u578B\u9ED8\u8BA4\u503C")}
              />
            </label>
            <label className="field">
              <span>{tr("\u6700\u5927\u5DE5\u5177\u8F6E\u6B21")}</span>
              <input
                type="number"
                min={1}
                max={MAX_TOOL_ROUNDS}
                placeholder={String(DEFAULT_TOOL_ROUNDS)}
                value={draft.maxSteps ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    maxSteps: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </label>
            <label className="field">
              <span>{tr("\u989C\u8272")}</span>
              <input
                value={draft.color ?? ""}
                onChange={(event) => setDraft({ ...draft, color: event.target.value || null })}
                placeholder="#c44d42"
              />
            </label>
            <label className="field settings-form-grid__full">
              <span>{tr("\u5DE5\u5177\u5141\u8BB8\u5217\u8868")}</span>
              <input
                value={(draft.toolAllowlist ?? []).join(", ")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    toolAllowlist: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                placeholder={tr(
                  "\u7559\u7A7A\u8868\u793A\u5168\u90E8\u5141\u8BB8\uFF1B\u652F\u6301 read_*\u3001mcp__wikipedia__* \u7B49\u901A\u914D\u7B26",
                )}
              />
            </label>
            <div className="field settings-form-grid__full">
              <span>{tr("\u7EC6\u7C92\u5EA6\u6743\u9650")}</span>
              <div className="agent-permission-grid">
                {(["read", "edit", "bash", "task", "webfetch", "websearch", "lsp"] as const).map(
                  (permission) => (
                    <label key={permission}>
                      <code>{permission}</code>
                      <select
                        value={draft.permissions?.[permission] ?? "allow"}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            permissions: {
                              ...draft.permissions,
                              [permission]: event.target.value as "allow" | "ask" | "deny",
                            },
                          })
                        }
                      >
                        <option value="allow">{tr("\u5141\u8BB8")}</option>
                        <option value="ask">{tr("\u8BF7\u6C42\u6279\u51C6")}</option>
                        <option value="deny">{tr("\u7981\u6B62")}</option>
                      </select>
                    </label>
                  ),
                )}
              </div>
            </div>
            <div className="field settings-form-grid__full">
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={draft.hidden ?? false}
                  onChange={(event) => setDraft({ ...draft, hidden: event.target.checked })}
                />
                {tr(
                  "\u5728 @ \u5F15\u7528\u83DC\u5355\u4E2D\u9690\u85CF\uFF08\u4ECD\u53EF\u7531\u6A21\u578B\u81EA\u52A8\u8C03\u7528\uFF09",
                )}
              </label>
            </div>
            <label className="field settings-form-grid__full">
              <span>{tr("\u7CFB\u7EDF\u6307\u4EE4")}</span>
              <textarea
                rows={9}
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                placeholder={tr(
                  "\u63CF\u8FF0\u804C\u8D23\u3001\u5DE5\u4F5C\u65B9\u5F0F\u3001\u8F93\u51FA\u683C\u5F0F\u548C\u4E0D\u53EF\u8D8A\u8FC7\u7684\u8FB9\u754C\u3002",
                )}
              />
            </label>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="settings-actions">
            <button className="btn btn--ghost" type="button" onClick={() => setDraft(null)}>
              {tr("\u53D6\u6D88")}
            </button>
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void save()}
              disabled={saving || !draft.name.trim()}
            >
              <Save aria-hidden="true" size={15} />
              {saving ? tr("\u4FDD\u5B58\u4E2D") : tr("\u4FDD\u5B58 Agent")}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("Agent \u914D\u7F6E")}</h3>
            <p>
              {tr(
                "\u4F1A\u8BDD\u5185\u53EF\u76F4\u63A5\u5207\u6362\u4E3B Agent\uFF0C\u4E5F\u53EF\u4EE5\u5728\u6D88\u606F\u5F00\u5934\u7528 @\u540D\u79F0 \u4E34\u65F6\u8C03\u7528\u3002",
              )}
            </p>
          </div>
          <button className="btn btn--primary" type="button" onClick={() => setDraft(emptyDraft())}>
            <Plus aria-hidden="true" size={15} />
            {tr("\u65B0\u5EFA Agent")}
          </button>
        </div>
        <div className="agent-profile-list">
          {profiles.map((profile) => (
            <article className="agent-profile-row" key={profile.id}>
              <span className="agent-profile-row__icon" aria-hidden="true">
                {profile.readOnly ? <ShieldCheck size={17} /> : <Bot size={17} />}
              </span>
              <div className="agent-profile-row__copy">
                <div>
                  <strong>{profile.name}</strong>
                  <span>{profile.role}</span>
                  {profile.readOnly ? <span>{tr("\u53EA\u8BFB")}</span> : null}
                  {profile.builtin ? <span>{tr("\u5185\u7F6E")}</span> : null}
                  {profile.sourcePath ? <span>{tr("\u6587\u4EF6")}</span> : null}
                </div>
                <p>
                  {(profile.builtin ? tr(profile.description) : profile.description) ||
                    tr("\u672A\u586B\u5199\u63CF\u8FF0")}
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={tr("\u7F16\u8F91 {0}", [profile.name])}
                onClick={() => setDraft(profileToDraft(profile))}
              >
                <Pencil aria-hidden="true" size={14} />
              </button>
              {!profile.builtin ? (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={tr("\u5220\u9664 {0}", [profile.name])}
                  onClick={() => void remove(profile)}
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
