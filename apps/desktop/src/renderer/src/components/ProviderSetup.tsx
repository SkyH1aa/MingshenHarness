import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import type {
  AnthropicNoneBehavior,
  ConnectionTestResult,
  InputModality,
  ModelConfig,
  ProviderAuthMode,
  ProviderKeySummary,
  ProviderProtocol,
  ProviderView,
} from "../../../shared/domain";
import {
  applyModelPresetOnce,
  isGpt6ModelId,
  type ModelPresetDraft,
  parseModelTokenCount,
  setNewModelLongContextBilling,
} from "../../../shared/model-settings-input";
import {
  DEFAULT_PROMPT_CACHING_SETTINGS,
  type PromptCachingSettings,
} from "../../../shared/prompt-caching";
import { useLocale } from "../i18n";
import { tr } from "../i18n/index";
import { runtimeText } from "../i18n/runtime";
import { PROTOCOL_LABELS } from "../lib/format";
import { orderCatalogProviders } from "../lib/model-catalog";
import { useProviderOrderDrag } from "../lib/use-provider-order-drag";
import { useDialog } from "./DialogProvider";
import { ModelCatalogFeedback, useModelCatalog } from "./ModelCatalogPreferences";
import { ProviderCacheFields, ProviderCacheSettings } from "./ProviderCacheSettings";

interface ProviderSetupProps {
  providers: ProviderView[];
  onChanged: () => Promise<void>;
  compact?: boolean;
}

interface ModelDraft extends ModelPresetDraft {
  displayName: string;
  toolCalls: boolean;
  parallelToolCalls: boolean;
  anthropicNoneBehavior: AnthropicNoneBehavior;
}

function defaultModelDraft(modelId = "", protocol?: ProviderProtocol): ModelDraft {
  return applyModelPresetOnce({
    editingId: null,
    modelId,
    displayName: modelId,
    contextWindow: "128000",
    maxOutputTokens: "8192",
    inputModalities: ["text", "image"],
    toolCalls: true,
    parallelToolCalls: true,
    reasoningLevels:
      protocol === "gemini_generate_content" ? "auto" : "none,low,medium,high,xhigh,max",
    anthropicNoneBehavior: "disabled",
    presetApplied: false,
    gptLongContextBilling: false,
  } satisfies ModelDraft);
}

function modelToDraft(model: ModelConfig): ModelDraft {
  return {
    editingId: model.id,
    modelId: model.modelId,
    displayName: model.displayName,
    contextWindow: String(model.contextWindow),
    maxOutputTokens: String(model.maxOutputTokens),
    inputModalities: model.inputModalities,
    toolCalls: model.toolCalls,
    parallelToolCalls: model.parallelToolCalls,
    reasoningLevels: model.reasoningLevels.join(","),
    anthropicNoneBehavior: model.anthropicNoneBehavior,
    presetApplied: true,
    gptLongContextBilling: false,
  };
}

function errorMessage(error: unknown): string {
  return runtimeText(error instanceof Error ? error.message : String(error));
}

function authLabel(authMode: ProviderAuthMode): string {
  switch (authMode) {
    case "bearer":
      return "Authorization: Bearer";
    case "x_api_key":
      return "x-api-key";
    case "api_key":
      return "api-key";
    case "x_goog_api_key":
      return "x-goog-api-key";
    case "custom":
      return tr("\u81EA\u5B9A\u4E49\u9274\u6743\u5934");
  }
}

export function ProviderSetup({ providers, onChanged, compact = false }: ProviderSetupProps) {
  const en = useLocale() === "en";
  const catalog = useModelCatalog();
  const [showForm, setShowForm] = useState(providers.length === 0);
  const [selectedId, setSelectedId] = useState(providers[0]?.id ?? "");
  const selected = providers.some((item) => item.id === selectedId) ? selectedId : providers[0]?.id;
  const orderedProviders = orderCatalogProviders(providers, catalog.preferences.providerOrder);
  const drag = useProviderOrderDrag({
    providerIds: orderedProviders.map((provider) => provider.id),
    onMove: catalog.moveProvider,
    disabled: !catalog.ready || catalog.saving || orderedProviders.length < 2,
  });

  return (
    <section className={compact ? "provider-setup provider-setup--compact" : "provider-setup"}>
      {compact ? (
        <div className="provider-toolbar">
          <span>
            <strong>
              {providers.length}
              {tr("\u4E2A\u4F9B\u5E94\u5546")}
            </strong>
            <small>{tr("\u5C55\u5F00\u9700\u8981\u914D\u7F6E\u7684\u8FDE\u63A5")}</small>
          </span>
          {!showForm ? (
            <button className="btn btn--secondary" type="button" onClick={() => setShowForm(true)}>
              <Plus aria-hidden="true" size={16} />
              {tr("\u6DFB\u52A0\u4F9B\u5E94\u5546")}
            </button>
          ) : null}
        </div>
      ) : (
        <header className="section-heading">
          <div>
            <h1>{tr("\u8FDE\u63A5\u6A21\u578B\u4F9B\u5E94\u5546")}</h1>
            <p>
              {tr(
                "\u6BCF\u4E2A\u8FDE\u63A5\u4F7F\u7528\u4E00\u79CD\u534F\u8BAE\u3002\u6A21\u578B\u80FD\u529B\u3001\u4E0A\u4E0B\u6587\u548C\u8F93\u51FA\u4E0A\u9650\u7531\u4F60\u660E\u786E\u914D\u7F6E\u3002",
              )}
            </p>
          </div>
          {!showForm ? (
            <button className="btn btn--secondary" type="button" onClick={() => setShowForm(true)}>
              <Plus aria-hidden="true" size={16} />
              {tr("\u6DFB\u52A0\u4F9B\u5E94\u5546")}
            </button>
          ) : null}
        </header>
      )}

      {showForm ? (
        <ProviderForm
          onCancel={
            providers.length > 0
              ? () => {
                  setShowForm(false);
                }
              : undefined
          }
          onCreated={async () => {
            await onChanged();
            setShowForm(false);
          }}
        />
      ) : null}

      <ModelCatalogFeedback />
      <div className="provider-workspace">
        <nav ref={drag.containerRef} className="provider-master" aria-label={tr("供应商与模型")}>
          {orderedProviders.map((provider) => (
            <div
              className="provider-master__row provider-order-row"
              key={provider.id}
              {...drag.rowProps(provider.id)}
            >
              <button
                type="button"
                aria-current={selected === provider.id ? "true" : undefined}
                onClick={() => setSelectedId(provider.id)}
              >
                <Server aria-hidden="true" size={16} />
                <span>
                  <strong>{provider.name}</strong>
                  <small>
                    {provider.models.length} {tr("模型")} · {provider.keys.length} Key
                  </small>
                </span>
              </button>
              <button
                {...drag.handleProps(provider.id)}
                className="provider-order-handle"
                type="button"
                disabled={!catalog.ready || orderedProviders.length < 2}
                aria-label={
                  en ? `Reorder provider ${provider.name}` : `调整供应商 ${provider.name} 的顺序`
                }
                title={
                  en ? "Hold to drag; Alt+Up/Down to reorder" : "长按拖动排序；Alt+↑/↓ 调整位置"
                }
              >
                <GripVertical aria-hidden="true" size={14} />
              </button>
            </div>
          ))}
        </nav>
        <div className="provider-list">
          {providers.map((provider) => (
            <div key={provider.id} hidden={selected !== provider.id}>
              <ProviderSection
                key={provider.id}
                provider={provider}
                onChanged={onChanged}
                defaultExpanded={true}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProviderForm({
  onCancel,
  onCreated,
}: {
  onCancel?: (() => void) | undefined;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("Chatgpt Pro");
  const [baseUrl, setBaseUrl] = useState("");
  const [protocol, setProtocol] = useState<ProviderProtocol>("openai_responses");
  const [authMode, setAuthMode] = useState<ProviderAuthMode>("bearer");
  const [customHeaderName, setCustomHeaderName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyLabel, setKeyLabel] = useState(tr("\u4E3B\u8D26\u53F7"));
  const [neverReveal, setNeverReveal] = useState(true);
  const [promptCaching, setPromptCaching] = useState<PromptCachingSettings>({
    ...DEFAULT_PROMPT_CACHING_SETTINGS,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await window.mingshen.createProvider({
        name,
        baseUrl,
        protocol,
        authMode,
        ...(authMode === "custom" ? { customHeaderName } : {}),
        apiKey,
        keyLabel,
        neverReveal,
        promptCaching,
      });
      setApiKey("");
      await onCreated();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-panel provider-form" onSubmit={submit}>
      <div className="form-grid form-grid--two">
        <label className="field">
          <span>{tr("\u540D\u79F0")}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Chatgpt Pro"
            required
          />
        </label>
        <label className="field">
          <span>{tr("API Key \u6807\u7B7E")}</span>
          <input
            value={keyLabel}
            onChange={(event) => setKeyLabel(event.target.value)}
            placeholder={tr("\u4E3B\u8D26\u53F7")}
            required
          />
        </label>
      </div>

      <label className="field">
        <span>Base URL</span>
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.your-domain.com/v1"
          spellCheck={false}
          required
        />

        <small>
          {tr(
            "通用地址以 /v1 结尾；Gemini 原生使用 /v1beta，兼容接口使用 /v1beta/openai；DeepSeek 按手册填写。",
          )}
        </small>
      </label>

      <div className="form-grid form-grid--two">
        <label className="field">
          <span>{tr("\u534F\u8BAE")}</span>
          <select
            value={protocol}
            onChange={(event) => {
              const next = event.target.value as ProviderProtocol;
              setProtocol(next);
              setPromptCaching((current) => ({ ...current, mode: "auto", ttl: "5m" }));
              if (next === "anthropic_messages" && authMode === "bearer") {
                setAuthMode("x_api_key");
              }
              if (next === "gemini_generate_content") {
                if (
                  !baseUrl ||
                  baseUrl === "https://generativelanguage.googleapis.com/v1beta/openai"
                )
                  setBaseUrl("https://generativelanguage.googleapis.com/v1beta");
                if (authMode !== "custom") setAuthMode("x_goog_api_key");
              } else if (authMode === "x_goog_api_key") {
                setAuthMode(next === "anthropic_messages" ? "x_api_key" : "bearer");
                if (
                  next === "openai_chat_completions" &&
                  baseUrl === "https://generativelanguage.googleapis.com/v1beta"
                )
                  setBaseUrl("https://generativelanguage.googleapis.com/v1beta/openai");
              }
            }}
          >
            <option value="anthropic_messages">Anthropic /v1/messages</option>
            <option value="openai_responses">OpenAI /v1/responses</option>
            <option value="openai_chat_completions">OpenAI /v1/chat/completions</option>
            <option value="gemini_generate_content">Google Gemini /v1beta/models</option>
          </select>
        </label>

        <label className="field">
          <span>{tr("\u9274\u6743\u65B9\u5F0F")}</span>
          <select
            value={authMode}
            onChange={(event) => setAuthMode(event.target.value as ProviderAuthMode)}
          >
            <option value="bearer">Authorization: Bearer</option>
            <option value="x_api_key">x-api-key</option>
            <option value="api_key">api-key</option>
            <option value="x_goog_api_key">x-goog-api-key</option>
            <option value="custom">{tr("\u81EA\u5B9A\u4E49")}</option>
          </select>
        </label>
      </div>

      {authMode === "custom" ? (
        <label className="field">
          <span>{tr("\u81EA\u5B9A\u4E49\u9274\u6743\u5934")}</span>
          <input
            value={customHeaderName}
            onChange={(event) => setCustomHeaderName(event.target.value)}
            placeholder="x-gateway-key"
            spellCheck={false}
            required
          />
        </label>
      ) : null}

      <label className="field">
        <span>API Key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          spellCheck={false}
          required
        />

        <small>
          {tr(
            "\u4FDD\u5B58\u540E\u53EA\u663E\u793A\u5C3E\u53F7\uFF0C\u5B8C\u6574\u503C\u4E0D\u4F1A\u8FD4\u56DE\u6E32\u67D3\u5C42\u3002",
          )}
        </small>
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={neverReveal}
          onChange={(event) => setNeverReveal(event.target.checked)}
        />

        <span>
          {tr(
            "\u4FDD\u5B58\u540E\u4E0D\u53EF\u518D\u6B21\u67E5\u770B\uFF0C\u53EA\u80FD\u66FF\u6362",
          )}
        </span>
      </label>

      <ProviderCacheFields
        draft={promptCaching}
        protocol={protocol}
        baseUrl={baseUrl}
        disabled={busy}
        onChange={(change) => setPromptCaching((current) => ({ ...current, ...change }))}
      />
      {error ? <p className="form-error">{error}</p> : null}

      <div className="form-actions">
        {onCancel ? (
          <button className="btn btn--ghost" type="button" onClick={onCancel}>
            {tr("\u53D6\u6D88")}
          </button>
        ) : null}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" aria-hidden="true" size={16} />
          ) : (
            <KeyRound aria-hidden="true" size={16} />
          )}
          {tr("\u4FDD\u5B58\u8FDE\u63A5")}
        </button>
      </div>
    </form>
  );
}

function ProviderSection({
  provider,
  onChanged,
  defaultExpanded,
}: {
  provider: ProviderView;
  onChanged: () => Promise<void>;
  defaultExpanded: boolean;
}) {
  const { confirm } = useDialog();
  const en = useLocale() === "en";
  const catalog = useModelCatalog();
  const [tab, setTab] = useState<"connection" | "keys" | "models">("models");
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyLabel, setKeyLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [neverReveal, setNeverReveal] = useState(true);
  const [editingKey, setEditingKey] = useState<ProviderKeySummary | null>(null);
  const [editingKeyLabel, setEditingKeyLabel] = useState("");
  const [editingApiKey, setEditingApiKey] = useState("");
  const [editingNeverReveal, setEditingNeverReveal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});

  const addKey = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await window.mingshen.addProviderKey({
        providerId: provider.id,
        label: keyLabel,
        apiKey,
        neverReveal,
      });
      setApiKey("");
      setKeyLabel("");
      setShowKeyForm(false);
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const beginEditKey = (key: ProviderKeySummary) => {
    setEditingKey(key);
    setEditingKeyLabel(key.label);
    setEditingApiKey("");
    setEditingNeverReveal(key.neverReveal);
    setShowKeyForm(false);
    setError(null);
  };

  const updateKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingKey) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.mingshen.updateProviderKey({
        providerId: provider.id,
        keyId: editingKey.id,
        label: editingKeyLabel,
        ...(editingApiKey.trim() ? { apiKey: editingApiKey } : {}),
        neverReveal: editingNeverReveal,
      });
      setEditingKey(null);
      setEditingApiKey("");
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const deleteKey = async (key: ProviderKeySummary) => {
    const confirmed = await confirm({
      title: tr("\u5220\u9664 API Key"),
      description: tr(
        "\u5C06\u5220\u9664\u300C{0}\u300D\u53CA\u5176\u7CFB\u7EDF\u51ED\u636E\u3002\u4F7F\u7528\u8BE5 Key \u7684\u4F1A\u8BDD\u4F1A\u5207\u6362\u5230\u5176\u4ED6\u53EF\u7528 Key\u3002",
        [key.label],
      ),
      confirmLabel: tr("\u5220\u9664 Key"),
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.mingshen.removeProviderKey(provider.id, key.id);
      if (editingKey?.id === key.id) {
        setEditingKey(null);
      }
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const discover = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.mingshen.fetchProviderModels(provider.id);
      setDiscovered(result.modelIds);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const testModel = async (model: ModelConfig) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.mingshen.testProvider(provider.id, model.id);
      setTestResults((current) => ({ ...current, [model.id]: result }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeProvider = async () => {
    const confirmed = await confirm({
      title: tr("\u5220\u9664\u4F9B\u5E94\u5546"),
      description: tr(
        "\u5220\u9664\u300C{0}\u300D\u540E\uFF0C\u8BE5\u8FDE\u63A5\u4E0B\u7684\u6A21\u578B\u548C API Key \u5F15\u7528\u4F1A\u4E00\u8D77\u5220\u9664\u3002",
        [provider.name],
      ),
      confirmLabel: tr("\u5220\u9664\u4F9B\u5E94\u5546"),
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await window.mingshen.removeProvider(provider.id);
      await catalog.refresh().catch(() => undefined);
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeModel = async (model: ModelConfig) => {
    const confirmed = await confirm({
      title: tr("\u5220\u9664\u6A21\u578B\u914D\u7F6E"),
      description: tr(
        "\u786E\u5B9A\u5220\u9664\u300C{0}\u300D\uFF1F\u5DF2\u6709\u4F1A\u8BDD\u4E0D\u4F1A\u81EA\u52A8\u66F4\u6362\u6A21\u578B\u3002",
        [model.displayName],
      ),
      confirmLabel: tr("\u5220\u9664\u6A21\u578B"),
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await window.mingshen.removeModel(model.id);
      await catalog.refresh().catch(() => undefined);
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={expanded ? "provider-section" : "provider-section provider-section--collapsed"}
      data-provider-tab={tab}
    >
      <header className="provider-section__header">
        <div className="provider-identity">
          <button
            className="provider-collapse-button"
            type="button"
            aria-label={
              expanded ? tr("\u6298\u53E0\u4F9B\u5E94\u5546") : tr("\u5C55\u5F00\u4F9B\u5E94\u5546")
            }
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronDown aria-hidden="true" size={16} />
            ) : (
              <ChevronRight aria-hidden="true" size={16} />
            )}
          </button>
          <span className="provider-identity__icon" aria-hidden="true">
            <Server size={17} />
          </span>
          <div>
            <h2>{provider.name}</h2>
            <p>
              {PROTOCOL_LABELS[provider.protocol]}
              <span aria-hidden="true"> / </span>
              {authLabel(provider.authMode)}
              <span aria-hidden="true"> · </span>
              {provider.keys.length} Key
              <span aria-hidden="true"> · </span>
              {provider.models.length}
              {tr("\u6A21\u578B")}
            </p>
          </div>
        </div>
        {expanded ? (
          <div className="provider-actions">
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => {
                setTab("keys");
                setShowKeyForm((value) => !value);
              }}
            >
              <KeyRound aria-hidden="true" size={15} />
              API Key
            </button>
            <button
              className="btn btn--ghost btn--danger"
              type="button"
              onClick={removeProvider}
              disabled={busy || catalog.saving}
            >
              <Trash2 aria-hidden="true" size={15} />
              {tr("\u5220\u9664")}
            </button>
          </div>
        ) : null}
      </header>

      <div className="provider-section__body">
        <div
          className="provider-detail-tabs"
          role="tablist"
          aria-label={en ? "Provider details" : "供应商详情"}
        >
          {(
            [
              ["connection", en ? "Connection" : "连接"],
              ["keys", "API Keys"],
              ["models", en ? "Models" : "模型"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === id}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="provider-meta">
          <code>{provider.baseUrl}</code>
          <span>
            {provider.keys.length}
            {tr("\u4E2A Key")}
          </span>
          <span>
            {provider.models.length}
            {tr("\u4E2A\u6A21\u578B")}
          </span>
        </div>
        {tab === "connection" ? (
          <>
            <ProviderConnectionSettings
              provider={provider}
              onChanged={async () => {
                setDiscovered([]);
                setTestResults({});
                await onChanged();
              }}
            />
            <ProviderCacheSettings
              key={`${provider.baseUrl}:${provider.protocol}`}
              provider={provider}
              onChanged={onChanged}
            />
          </>
        ) : null}

        <div className="key-list">
          {provider.keys.map((key) => (
            <div className={key.isActive ? "key-row key-row--active" : "key-row"} key={key.id}>
              <span className="key-row__dot" aria-hidden="true" />
              <span>{key.label}</span>
              <code>{key.maskedHint}</code>
              {key.isActive ? <span className="state-label">{tr("\u5F53\u524D")}</span> : null}
              <div className="key-row__actions">
                {!key.isActive ? (
                  <button
                    className="link-button"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await window.mingshen.setActiveProviderKey(provider.id, key.id);
                        await onChanged();
                      } catch (cause) {
                        setError(errorMessage(cause));
                      }
                    }}
                  >
                    {tr("\u5207\u6362")}
                  </button>
                ) : null}
                <button
                  className="icon-button icon-button--small"
                  type="button"
                  aria-label={tr("\u7F16\u8F91 {0}", [key.label])}
                  title={tr("\u7F16\u8F91 API Key")}
                  disabled={busy}
                  onClick={() => beginEditKey(key)}
                >
                  <Pencil aria-hidden="true" size={13} />
                </button>
                <button
                  className="icon-button icon-button--small icon-button--danger"
                  type="button"
                  aria-label={tr("\u5220\u9664 {0}", [key.label])}
                  title={tr("\u5220\u9664 API Key")}
                  disabled={busy}
                  onClick={() => void deleteKey(key)}
                >
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {editingKey ? (
          <form className="inline-form key-edit-form" onSubmit={updateKey}>
            <label className="field">
              <span>{tr("Key \u6807\u7B7E")}</span>
              <input
                value={editingKeyLabel}
                onChange={(event) => setEditingKeyLabel(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>{tr("\u66FF\u6362 API Key")}</span>
              <input
                type="password"
                value={editingApiKey}
                onChange={(event) => setEditingApiKey(event.target.value)}
                placeholder={tr("\u7559\u7A7A\u5219\u4FDD\u7559\u539F Key")}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={editingNeverReveal}
                onChange={(event) => setEditingNeverReveal(event.target.checked)}
              />

              <span>{tr("\u4FDD\u5B58\u540E\u4E0D\u53EF\u518D\u6B21\u67E5\u770B")}</span>
            </label>
            <div className="key-edit-form__actions">
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => setEditingKey(null)}
                disabled={busy}
              >
                {tr("\u53D6\u6D88")}
              </button>
              <button className="btn btn--primary" type="submit" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={15} />
                ) : (
                  <Pencil aria-hidden="true" size={15} />
                )}
                {tr("\u4FDD\u5B58\u4FEE\u6539")}
              </button>
            </div>
          </form>
        ) : null}

        {showKeyForm ? (
          <form className="inline-form" onSubmit={addKey}>
            <label className="field">
              <span>{tr("\u6807\u7B7E")}</span>
              <input
                value={keyLabel}
                onChange={(event) => setKeyLabel(event.target.value)}
                placeholder={tr("\u5907\u7528\u989D\u5EA6")}
                required
              />
            </label>
            <label className="field">
              <span>API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={neverReveal}
                onChange={(event) => setNeverReveal(event.target.checked)}
              />

              <span>{tr("\u4E0D\u53EF\u518D\u6B21\u67E5\u770B")}</span>
            </label>
            <button className="btn btn--primary" type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" aria-hidden="true" size={16} />
              ) : (
                <Plus aria-hidden="true" size={16} />
              )}
              {tr("\u6DFB\u52A0")}
            </button>
          </form>
        ) : null}

        <div className="provider-models">
          <div className="provider-models__heading">
            <h3>{tr("\u6A21\u578B")}</h3>
            <div className="provider-actions">
              <button
                className="btn btn--secondary"
                type="button"
                onClick={discover}
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={15} />
                ) : (
                  <RefreshCw aria-hidden="true" size={15} />
                )}
                {tr("\u62C9\u53D6\u6A21\u578B\u5217\u8868")}
              </button>
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => setModelDraft(defaultModelDraft("", provider.protocol))}
              >
                <Plus aria-hidden="true" size={15} />
                {tr("\u624B\u52A8\u6DFB\u52A0")}
              </button>
            </div>
          </div>

          {discovered.length > 0 ? (
            <fieldset
              className="discovered-models"
              aria-label={tr("\u5DF2\u53D1\u73B0\u6A21\u578B")}
            >
              <legend className="visually-hidden">{tr("\u5DF2\u53D1\u73B0\u6A21\u578B")}</legend>
              {discovered.map((modelId) => {
                const configured = provider.models.some((model) => model.modelId === modelId);
                return (
                  <button
                    className="model-chip"
                    type="button"
                    key={modelId}
                    disabled={configured}
                    onClick={() => setModelDraft(defaultModelDraft(modelId, provider.protocol))}
                  >
                    {configured ? (
                      <Check aria-hidden="true" size={13} />
                    ) : (
                      <Plus aria-hidden="true" size={13} />
                    )}
                    {modelId}
                  </button>
                );
              })}
            </fieldset>
          ) : null}

          {provider.models.length > 0 ? (
            <div className="model-table">
              {provider.models.map((model) => {
                const starred = catalog.preferences.starredModelIds.includes(model.id);
                const starLabel = en
                  ? `${starred ? "Unstar" : "Star"} model ${model.modelId}`
                  : `${starred ? "取消星标" : "星标收藏"}模型 ${model.modelId}`;
                return (
                  <div className="model-row" key={model.id}>
                    <div className="model-row__identity">
                      <strong>{model.displayName}</strong>
                      <code>{model.modelId}</code>
                    </div>
                    <span className="model-row__limits">
                      {(model.contextWindow / 1000).toLocaleString("zh-CN")}K /{" "}
                      {(model.maxOutputTokens / 1000).toLocaleString("zh-CN")}K
                    </span>
                    <span className="model-row__modalities">
                      {model.inputModalities.join(" · ")}
                    </span>
                    <div className="model-row__actions">
                      <button
                        className="icon-button model-star-button"
                        type="button"
                        aria-label={starLabel}
                        title={starLabel}
                        aria-pressed={starred}
                        data-starred={starred}
                        data-star-model-id={model.id}
                        onClick={() => {
                          if (!catalog.ready || catalog.saving || busy) return;
                          void catalog.setStar(model.id, !starred).catch(() => undefined);
                        }}
                        disabled={!catalog.ready || busy}
                        aria-disabled={!catalog.ready || catalog.saving || busy}
                      >
                        <Star
                          aria-hidden="true"
                          size={15}
                          fill={starred ? "currentColor" : "none"}
                        />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={tr("\u6D4B\u8BD5 {0}", [model.displayName])}
                        title={tr("\u6D4B\u8BD5\u8FDE\u63A5")}
                        onClick={() => testModel(model)}
                        disabled={busy}
                      >
                        <RefreshCw aria-hidden="true" size={15} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={tr("\u7F16\u8F91 {0}", [model.displayName])}
                        title={tr("\u7F16\u8F91\u6A21\u578B")}
                        onClick={() => setModelDraft(modelToDraft(model))}
                      >
                        <Pencil aria-hidden="true" size={15} />
                      </button>
                      <button
                        className="icon-button icon-button--danger"
                        type="button"
                        aria-label={tr("\u5220\u9664 {0}", [model.displayName])}
                        title={tr("\u5220\u9664\u6A21\u578B")}
                        onClick={() => removeModel(model)}
                        disabled={busy || catalog.saving}
                      >
                        <Trash2 aria-hidden="true" size={15} />
                      </button>
                    </div>
                    {(() => {
                      const result = testResults[model.id];
                      return result ? (
                        <ConnectionResult
                          result={result}
                          onClose={() => {
                            setTestResults((current) => {
                              const next = { ...current };
                              delete next[model.id];
                              return next;
                            });
                          }}
                        />
                      ) : null;
                    })()}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="quiet-copy">
              {tr(
                "\u5C1A\u672A\u914D\u7F6E\u6A21\u578B\u3002\u53EF\u4EE5\u5148\u62C9\u53D6\u6A21\u578B ID\uFF0C\u518D\u8865\u9F50\u4E0A\u4E0B\u6587\u548C\u8F93\u51FA\u4E0A\u9650\u3002",
              )}
            </p>
          )}

          {modelDraft ? (
            <ModelForm
              provider={provider}
              draft={modelDraft}
              setDraft={setModelDraft}
              onCancel={() => setModelDraft(null)}
              onSaved={async () => {
                setModelDraft(null);
                await onChanged();
              }}
            />
          ) : null}
        </div>

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </article>
  );
}

function ProviderConnectionSettings({
  provider,
  onChanged,
}: {
  provider: ProviderView;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [protocol, setProtocol] = useState(provider.protocol);
  const [authMode, setAuthMode] = useState(provider.authMode);
  const [customHeaderName, setCustomHeaderName] = useState(provider.customHeaderName ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearStatus = () => {
    setSaved(false);
    setError(null);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    clearStatus();
    try {
      const updated = await window.mingshen.updateProvider({
        providerId: provider.id,
        name,
        baseUrl,
        protocol,
        authMode,
        customHeaderName: authMode === "custom" ? customHeaderName : null,
      });
      setName(updated.name);
      setBaseUrl(updated.baseUrl);
      setProtocol(updated.protocol);
      setAuthMode(updated.authMode);
      setCustomHeaderName(updated.customHeaderName ?? "");
      await onChanged();
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="settings-block provider-connection-settings"
      aria-label={tr("编辑供应商连接")}
      aria-busy={busy}
      onSubmit={submit}
    >
      <div className="form-grid form-grid--two">
        <label className="field">
          <span>{tr("名称")}</span>
          <input
            name="providerName"
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              clearStatus();
            }}
            required
          />
        </label>
        <label className="field">
          <span>{tr("协议")}</span>
          <select
            name="providerProtocol"
            value={protocol}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value as ProviderProtocol;
              setProtocol(next);
              if (next === "gemini_generate_content") {
                if (baseUrl === "https://generativelanguage.googleapis.com/v1beta/openai")
                  setBaseUrl("https://generativelanguage.googleapis.com/v1beta");
                if (authMode !== "custom") setAuthMode("x_goog_api_key");
              } else if (authMode === "x_goog_api_key") {
                setAuthMode(next === "anthropic_messages" ? "x_api_key" : "bearer");
                if (
                  next === "openai_chat_completions" &&
                  baseUrl === "https://generativelanguage.googleapis.com/v1beta"
                )
                  setBaseUrl("https://generativelanguage.googleapis.com/v1beta/openai");
              }
              clearStatus();
            }}
          >
            <option value="anthropic_messages">Anthropic /v1/messages</option>
            <option value="openai_responses">OpenAI /v1/responses</option>
            <option value="openai_chat_completions">OpenAI /v1/chat/completions</option>
            <option value="gemini_generate_content">Google Gemini /v1beta/models</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Base URL</span>
        <input
          name="providerBaseUrl"
          value={baseUrl}
          disabled={busy}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            clearStatus();
          }}
          spellCheck={false}
          placeholder="https://api.your-domain.com/v1"
          required
        />
        <small>
          {tr(
            "通用地址以 /v1 结尾；Gemini 原生使用 /v1beta，兼容接口使用 /v1beta/openai；DeepSeek 按手册填写。",
          )}
        </small>
      </label>
      <label className="field">
        <span>{tr("鉴权方式")}</span>
        <select
          name="providerAuthMode"
          value={authMode}
          disabled={busy}
          onChange={(event) => {
            setAuthMode(event.target.value as ProviderAuthMode);
            clearStatus();
          }}
        >
          <option value="bearer">Authorization: Bearer</option>
          <option value="x_api_key">x-api-key</option>
          <option value="api_key">api-key</option>
          <option value="x_goog_api_key">x-goog-api-key</option>
          <option value="custom">{tr("自定义")}</option>
        </select>
      </label>
      {authMode === "custom" ? (
        <label className="field">
          <span>{tr("自定义鉴权头")}</span>
          <input
            name="providerCustomHeaderName"
            value={customHeaderName}
            disabled={busy}
            onChange={(event) => {
              setCustomHeaderName(event.target.value);
              clearStatus();
            }}
            spellCheck={false}
            required
          />
        </label>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        {saved ? <span role="status">{tr("连接配置已保存")}</span> : null}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" aria-hidden="true" size={16} />
          ) : (
            <Check aria-hidden="true" size={16} />
          )}
          {tr("保存连接")}
        </button>
      </div>
    </form>
  );
}

function ConnectionResult({
  result,
  onClose,
}: {
  result: ConnectionTestResult;
  onClose: () => void;
}) {
  return (
    <div
      className={
        result.ok
          ? "connection-result connection-result--ok"
          : "connection-result connection-result--error"
      }
    >
      <div className="connection-result__header">
        <span className="connection-result__state">
          {result.ok ? (
            <Check aria-hidden="true" size={14} />
          ) : (
            <AlertTriangle aria-hidden="true" size={14} />
          )}
          {result.ok ? tr("\u8FDE\u63A5\u6210\u529F") : tr("\u8FDE\u63A5\u5931\u8D25")}
        </span>
        <code>
          {result.status ?? "ERR"} · {result.latencyMs} ms
        </code>
        <button
          className="icon-button"
          type="button"
          aria-label={tr("\u5173\u95ED\u6D4B\u8BD5\u7ED3\u679C")}
          onClick={onClose}
        >
          <X aria-hidden="true" size={14} />
        </button>
      </div>
      {result.responseText ? <p>{result.responseText}</p> : null}
      {result.error ? <p className="form-error">{runtimeText(result.error)}</p> : null}
      {result.responseBody ? (
        <details>
          <summary>{tr("\u67E5\u770B\u5B8C\u6574\u54CD\u5E94")}</summary>
          <pre>{result.responseBody}</pre>
        </details>
      ) : null}
    </div>
  );
}

function ModelForm({
  provider,
  draft,
  setDraft,
  onCancel,
  onSaved,
}: {
  provider: ProviderView;
  draft: ModelDraft;
  setDraft: (draft: ModelDraft) => void;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validateTokenInputs, setValidateTokenInputs] = useState(false);
  const contextInput = useRef<HTMLInputElement>(null);
  const outputInput = useRef<HTMLInputElement>(null);
  const contextHintId = useId();
  const contextErrorId = useId();
  const outputHintId = useId();
  const outputErrorId = useId();
  const contextWindow = parseModelTokenCount(draft.contextWindow);
  const maxOutputTokens = parseModelTokenCount(draft.maxOutputTokens);
  const invalidContext = validateTokenInputs && contextWindow === null;
  const invalidOutput = validateTokenInputs && maxOutputTokens === null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setError(null);
    setValidateTokenInputs(true);
    if (contextWindow === null || maxOutputTokens === null) {
      (contextWindow === null ? contextInput : outputInput).current?.focus();
      return;
    }
    setBusy(true);
    const reasoningLevels = draft.reasoningLevels
      .split(",")
      .map((level) => level.trim())
      .filter(Boolean);

    try {
      if (draft.editingId) {
        await window.mingshen.updateModel({
          id: draft.editingId,
          modelId: draft.modelId,
          displayName: draft.displayName,
          contextWindow,
          maxOutputTokens,
          inputModalities: draft.inputModalities,
          outputModalities: ["text"],
          toolCalls: draft.toolCalls,
          parallelToolCalls: draft.parallelToolCalls,
          reasoningLevels,
          anthropicNoneBehavior: draft.anthropicNoneBehavior,
        });
      } else {
        await window.mingshen.createModel({
          providerId: provider.id,
          modelId: draft.modelId,
          displayName: draft.displayName,
          contextWindow,
          maxOutputTokens,
          inputModalities: draft.inputModalities,
          outputModalities: ["text"],
          toolCalls: draft.toolCalls,
          parallelToolCalls: draft.parallelToolCalls,
          reasoningLevels,
          anthropicNoneBehavior: draft.anthropicNoneBehavior,
        });
      }
      await onSaved();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleModality = (modality: InputModality) => {
    if (modality === "text") {
      return;
    }
    const has = draft.inputModalities.includes(modality);
    setDraft({
      ...draft,
      inputModalities: has
        ? draft.inputModalities.filter((item) => item !== modality)
        : [...draft.inputModalities, modality],
    });
  };

  return (
    <form className="form-panel model-form" onSubmit={submit}>
      <div className="model-form__heading">
        <h3>
          {draft.editingId
            ? tr("\u7F16\u8F91\u6A21\u578B\u914D\u7F6E")
            : tr("\u914D\u7F6E\u6A21\u578B")}
        </h3>
        <button
          className="icon-button"
          type="button"
          aria-label={tr("\u5173\u95ED\u6A21\u578B\u914D\u7F6E")}
          onClick={onCancel}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>

      <div className="form-grid form-grid--two">
        <label className="field">
          <span>Model ID</span>
          <input
            value={draft.modelId}
            onChange={(event) =>
              setDraft(
                applyModelPresetOnce({
                  ...draft,
                  modelId: event.target.value,
                  displayName:
                    !draft.displayName || draft.displayName === draft.modelId
                      ? event.target.value
                      : draft.displayName,
                }),
              )
            }
            placeholder="gpt-6.1-sol"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          <span>{tr("\u663E\u793A\u540D\u79F0")}</span>
          <input
            value={draft.displayName}
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            placeholder={tr("\u6A21\u578B\u663E\u793A\u540D\u79F0")}
          />
        </label>
        <label className="field">
          <span>{tr("\u4E0A\u4E0B\u6587\u957F\u5EA6")}</span>
          <input
            ref={contextInput}
            name="contextWindow"
            type="text"
            value={draft.contextWindow}
            onChange={(event) => setDraft({ ...draft, contextWindow: event.target.value })}
            aria-invalid={invalidContext || undefined}
            aria-describedby={`${contextHintId}${invalidContext ? ` ${contextErrorId}` : ""}`}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            required
          />
          <small id={contextHintId}>
            {tr("支持 K/k（1000）、M/m（1000000），例如 100K、1M。")}
          </small>
          {invalidContext ? (
            <small className="form-error" id={contextErrorId} role="alert">
              {tr("请输入正整数，或使用 K/M 单位；换算后须为安全范围内的正整数。")}
            </small>
          ) : null}
        </label>
        <label className="field">
          <span>{tr("\u6700\u5927\u8F93\u51FA token")}</span>
          <input
            ref={outputInput}
            name="maxOutputTokens"
            type="text"
            value={draft.maxOutputTokens}
            onChange={(event) => setDraft({ ...draft, maxOutputTokens: event.target.value })}
            aria-invalid={invalidOutput || undefined}
            aria-describedby={`${outputHintId}${invalidOutput ? ` ${outputErrorId}` : ""}`}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            required
          />
          <small id={outputHintId}>{tr("支持 K/k（1000）、M/m（1000000），例如 100K、1M。")}</small>
          {invalidOutput ? (
            <small className="form-error" id={outputErrorId} role="alert">
              {tr("请输入正整数，或使用 K/M 单位；换算后须为安全范围内的正整数。")}
            </small>
          ) : null}
        </label>
      </div>

      {!draft.editingId && isGpt6ModelId(draft.modelId) ? (
        <div className="field-group">
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.gptLongContextBilling}
              disabled={busy}
              onChange={(event) =>
                setDraft(setNewModelLongContextBilling(draft, event.target.checked))
              }
            />
            <span>{tr("GPT厂商是否开启了长上下文计费？")}</span>
          </label>
        </div>
      ) : null}

      <fieldset className="field-group">
        <legend>{tr("\u8F93\u5165\u6A21\u6001")}</legend>
        <div className="check-grid">
          {(["text", "image", "audio", "video", "file"] as const).map((modality) => (
            <label className="check-row" key={modality}>
              <input
                type="checkbox"
                checked={draft.inputModalities.includes(modality)}
                disabled={modality === "text"}
                onChange={() => toggleModality(modality)}
              />

              <span>{modality}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="form-grid form-grid--two">
        <label className="field">
          <span>{tr("\u601D\u8003\u7B49\u7EA7")}</span>
          <input
            value={draft.reasoningLevels}
            onChange={(event) => setDraft({ ...draft, reasoningLevels: event.target.value })}
            placeholder="none,low,medium,high,xhigh,max"
            spellCheck={false}
          />

          <small>
            {provider.protocol === "gemini_generate_content"
              ? tr(
                  "Gemini 3 及以上按模型填写 minimal、low、medium、high；Gemini 2.5 使用 auto，Flash 可加 none。留空使用 API 默认值。",
                )
              : tr(
                  "\u6309\u987A\u5E8F\u7528\u9017\u53F7\u5206\u9694\uFF0C\u804A\u5929\u65F6\u6309\u6B64\u751F\u6210\u5F3A\u5EA6\u62D6\u52A8\u6761\u3002",
                )}
          </small>
        </label>

        {provider.protocol === "anthropic_messages" ? (
          <label className="field">
            <span>{tr("none \u7684 Claude \u6620\u5C04")}</span>
            <select
              value={draft.anthropicNoneBehavior}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  anthropicNoneBehavior: event.target.value as AnthropicNoneBehavior,
                })
              }
            >
              <option value="disabled">thinking disabled</option>
              <option value="between_tools">thinking between_tools</option>
              <option value="reject">{tr("\u4E0D\u652F\u6301 none")}</option>
            </select>
          </label>
        ) : (
          <div className="field">
            <span>{tr("\u5DE5\u5177\u80FD\u529B")}</span>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.toolCalls}
                onChange={(event) => setDraft({ ...draft, toolCalls: event.target.checked })}
              />

              <span>{tr("\u652F\u6301\u5DE5\u5177\u8C03\u7528")}</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.parallelToolCalls}
                onChange={(event) =>
                  setDraft({ ...draft, parallelToolCalls: event.target.checked })
                }
              />

              <span>{tr("\u652F\u6301\u5E76\u884C\u5DE5\u5177\u8C03\u7528")}</span>
            </label>
          </div>
        )}
      </div>

      {provider.protocol === "anthropic_messages" ? (
        <div className="check-grid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.toolCalls}
              onChange={(event) => setDraft({ ...draft, toolCalls: event.target.checked })}
            />

            <span>{tr("\u652F\u6301\u5DE5\u5177\u8C03\u7528")}</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.parallelToolCalls}
              onChange={(event) => setDraft({ ...draft, parallelToolCalls: event.target.checked })}
            />

            <span>{tr("\u652F\u6301\u5E76\u884C\u5DE5\u5177\u8C03\u7528")}</span>
          </label>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions">
        <button className="btn btn--ghost" type="button" onClick={onCancel}>
          {tr("\u53D6\u6D88")}
        </button>
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" aria-hidden="true" size={16} />
          ) : (
            <Check aria-hidden="true" size={16} />
          )}
          {draft.editingId ? tr("\u4FDD\u5B58\u6A21\u578B") : tr("\u6DFB\u52A0\u6A21\u578B")}
        </button>
      </div>
    </form>
  );
}
