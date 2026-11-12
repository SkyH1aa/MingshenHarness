import type {
  ConnectionTestResult,
  InputModality,
  ModelConfig,
  ModelCreateInput,
  ModelDiscoveryResult,
  ModelUpdateInput,
  ProviderAddKeyInput,
  ProviderAuthMode,
  ProviderCreateInput,
  ProviderProtocol,
  ProviderUpdateInput,
  ProviderUpdateKeyInput,
  ProviderView,
} from "../../shared/domain";
import {
  normalizePromptCachingSettings,
  providerPromptCachingKey,
  validatePromptCachingSettings,
} from "../../shared/prompt-caching";
import { recordRuntimeError } from "../diagnostics/runtime-log";
import { redactSecrets as redactDiagnostic } from "../security/redact";
import type { Repository } from "../storage/repository";
import type { SecretStore } from "../storage/secret-store";
import { geminiModelPath, geminiRecord } from "./gemini-format";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_DIAGNOSTIC_BODY = 50_000;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const PROTOCOLS = [
  "anthropic_messages",
  "openai_responses",
  "openai_chat_completions",
  "gemini_generate_content",
];
const AUTH_MODES = ["bearer", "x_api_key", "api_key", "x_goog_api_key", "custom"];

interface ProviderWireContext {
  baseUrl: string;
  protocol: ProviderProtocol;
  authMode: ProviderAuthMode;
  customHeaderName: string | null;
  apiKey: string;
}

interface NormalizedModelInput {
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputModalities: InputModality[];
  outputModalities: InputModality[];
  toolCalls: boolean;
  parallelToolCalls: boolean;
  reasoningLevels: string[];
  anthropicNoneBehavior: ModelCreateInput["anthropicNoneBehavior"];
}

export function normalizeBaseUrl(input: string, protocol?: ProviderProtocol): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Base URL 不能为空。");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Base URL 格式无效。");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Base URL 只支持 HTTP 或 HTTPS。");
  }

  if (url.username || url.password) {
    throw new Error("Base URL 不能包含用户名或密码。");
  }

  if (url.search || url.hash) {
    throw new Error("Base URL 不能包含查询参数或锚点。");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (protocol === "gemini_generate_content") {
    if (!/\/v1(?:beta)?$/.test(pathname))
      throw new Error("Gemini 原生 Base URL 必须以 /v1beta 或 /v1 结尾，不含 /openai 或模型端点。");
    return `${url.origin}${pathname}`;
  }
  const nativeEndpoint =
    (url.origin === "https://generativelanguage.googleapis.com" && pathname === "/v1beta/openai") ||
    (url.origin === "https://api.deepseek.com" && (pathname === "" || pathname === "/beta"));
  if (!pathname.endsWith("/v1") && !nativeEndpoint) {
    throw new Error(
      "Base URL 必须以 /v1 结尾，或使用 Gemini /v1beta/openai、DeepSeek 官方 API 地址。",
    );
  }

  return `${url.origin}${pathname}`;
}

export function buildAuthHeaders(context: ProviderWireContext): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  switch (context.authMode) {
    case "bearer":
      headers.authorization = `Bearer ${context.apiKey}`;
      break;
    case "x_api_key":
      headers["x-api-key"] = context.apiKey;
      break;
    case "api_key":
      headers["api-key"] = context.apiKey;
      break;
    case "x_goog_api_key":
      headers["x-goog-api-key"] = context.apiKey;
      break;
    case "custom": {
      const headerName = context.customHeaderName?.trim();
      if (!headerName || !HEADER_NAME_PATTERN.test(headerName)) {
        throw new Error("自定义鉴权头名称无效。");
      }
      headers[headerName.toLowerCase()] = context.apiKey;
      break;
    }
    default:
      throw new Error("鉴权方式无效。");
  }

  if (context.protocol === "anthropic_messages") {
    headers["anthropic-version"] = "2023-06-01";
  }

  return headers;
}

export function parseModelIds(payload: unknown): string[] {
  const candidates: unknown[] = [];

  if (Array.isArray(payload)) {
    candidates.push(...payload);
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      candidates.push(...record.data);
    }
    if (Array.isArray(record.models)) {
      candidates.push(...record.models);
    }
  }

  const ids = candidates
    .map((candidate) => {
      if (typeof candidate === "string") {
        return candidate.trim();
      }
      if (!candidate || typeof candidate !== "object") {
        return "";
      }
      const record = candidate as Record<string, unknown>;
      const value = record.id ?? record.name ?? record.model;
      return typeof value === "string" ? value.trim() : "";
    })
    .filter(Boolean);

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.candidates)) {
    const content = geminiRecord(geminiRecord(record.candidates[0])?.content);
    if (Array.isArray(content?.parts))
      return content.parts
        .filter((part) => geminiRecord(part)?.thought !== true)
        .map((part) => geminiRecord(part)?.text)
        .filter((value) => typeof value === "string")
        .join("");
  }

  if (Array.isArray(record.content)) {
    const blocks = record.content
      .filter(
        (item): item is { type?: unknown; text?: unknown } =>
          Boolean(item) && typeof item === "object",
      )
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => String(item.text));
    if (blocks.length > 0) {
      return blocks.join("\n");
    }
  }

  if (Array.isArray(record.output)) {
    const text = record.output
      .flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const outputItem = item as Record<string, unknown>;
        if (!Array.isArray(outputItem.content)) {
          return [];
        }
        return outputItem.content
          .filter(
            (part): part is { type?: unknown; text?: unknown } =>
              Boolean(part) && typeof part === "object",
          )
          .filter((part) => part.type === "output_text" && typeof part.text === "string")
          .map((part) => String(part.text));
      })
      .join("\n");
    if (text) {
      return text;
    }
  }

  if (Array.isArray(record.choices)) {
    const first = record.choices[0];
    if (first && typeof first === "object") {
      const choice = first as Record<string, unknown>;
      const message = choice.message;
      if (message && typeof message === "object") {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === "string") {
          return content;
        }
      }
      if (typeof choice.text === "string") {
        return choice.text;
      }
    }
  }

  return typeof record.output_text === "string" ? record.output_text : "";
}

export function extractUsage(
  payload: unknown,
  protocol?: ProviderProtocol,
): ConnectionTestResult["usage"] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const usageRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const usage = usageRecord(record.usage);
  const nativeRecords = [
    usageRecord(record.usageMetadata),
    usageRecord(record.usage_metadata),
  ].filter((value) => value !== null);
  if (!usage && nativeRecords.length === 0) return null;
  const value = usage ?? {};
  const count = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const detailsCount = (details: unknown, key: string) => count(usageRecord(details)?.[key]);
  const nativeUsage =
    nativeRecords.find(
      (metadata) =>
        (count(metadata.promptTokenCount) ?? count(metadata.prompt_token_count)) !== null,
    ) ?? nativeRecords[0];
  const nativeCount = (camel: string, snake: string): number | null =>
    count(nativeUsage?.[camel]) ?? count(nativeUsage?.[snake]);
  // Anthropic input excludes cache reads/writes; OpenAI and Gemini prompt totals include reads.
  const anthropic =
    protocol === "anthropic_messages" ||
    (!protocol &&
      (count(value.cache_read_input_tokens) !== null ||
        count(value.cache_creation_input_tokens) !== null));
  const cacheHits = count(value.prompt_cache_hit_tokens);
  const cacheMisses = count(value.prompt_cache_miss_tokens);
  const directInput = count(value.input_tokens) ?? count(value.prompt_tokens);
  const standardInput =
    directInput ??
    (cacheHits !== null && cacheMisses !== null ? count(cacheHits + cacheMisses) : null);
  const nativeInput = nativeCount("promptTokenCount", "prompt_token_count");
  // A gateway may expose both formats; do not mix metadata from conflicting prompt totals.
  const useNative =
    !anthropic && (standardInput === null || nativeInput === null || standardInput === nativeInput);
  const rawInput = standardInput ?? (useNative ? nativeInput : null);
  let cachedInputTokens =
    count(value.cache_read_input_tokens) ??
    detailsCount(value.input_tokens_details, "cached_tokens") ??
    detailsCount(value.prompt_tokens_details, "cached_tokens") ??
    cacheHits ??
    (useNative ? nativeCount("cachedContentTokenCount", "cached_content_token_count") : null);
  let cacheCreationInputTokens =
    count(value.cache_creation_input_tokens) ??
    detailsCount(value.input_tokens_details, "cache_creation_tokens") ??
    detailsCount(value.prompt_tokens_details, "cache_creation_tokens");
  const input =
    rawInput !== null
      ? count(
          rawInput +
            (anthropic && directInput !== null
              ? (cachedInputTokens ?? 0) + (cacheCreationInputTokens ?? 0)
              : 0),
        )
      : null;
  if (input !== null && cachedInputTokens !== null && cachedInputTokens > input)
    cachedInputTokens = null;
  if (input !== null && cacheCreationInputTokens !== null && cacheCreationInputTokens > input)
    cacheCreationInputTokens = null;
  const candidates = useNative
    ? nativeCount("candidatesTokenCount", "candidates_token_count")
    : null;
  const thoughts = useNative ? nativeCount("thoughtsTokenCount", "thoughts_token_count") : null;
  const nativeOutput =
    candidates !== null &&
    (thoughts !== null ||
      (nativeUsage?.thoughtsTokenCount === undefined &&
        nativeUsage?.thoughts_token_count === undefined))
      ? count(candidates + (thoughts ?? 0))
      : null;
  const output = count(value.output_tokens) ?? count(value.completion_tokens) ?? nativeOutput;
  const computedTotal = input !== null && output !== null ? count(input + output) : null;
  const rawTotal =
    count(value.total_tokens) ??
    (useNative ? nativeCount("totalTokenCount", "total_token_count") : null);
  const reportedTotal =
    rawTotal !== null &&
    (input === null || rawTotal >= input) &&
    (output === null || rawTotal >= output) &&
    (computedTotal === null || rawTotal >= computedTotal)
      ? rawTotal
      : null;
  const total = anthropic ? (computedTotal ?? reportedTotal) : (reportedTotal ?? computedTotal);

  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    cachedInputTokens,
    cacheCreationInputTokens,
  };
}

function redactSecrets(value: string, apiKey: string): string {
  const safe = redactDiagnostic(value, [apiKey]);
  return (
    safe.slice(0, MAX_DIAGNOSTIC_BODY) +
    (safe.length > MAX_DIAGNOSTIC_BODY ? "\n[Response truncated at 50,000 characters]" : "")
  );
}

function validateProviderName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) {
    throw new Error("供应商名称长度必须为 1 到 80 个字符。");
  }
  return normalized;
}

function validateKeyLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) {
    throw new Error("API Key 标签长度必须为 1 到 80 个字符。");
  }
  return normalized;
}

function assertPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field}必须是正整数。`);
  }
  return value;
}

function validateModelInput(input: ModelCreateInput | ModelUpdateInput): NormalizedModelInput {
  if (!input.modelId.trim() || input.modelId.length > 256) {
    throw new Error("Model ID 长度必须为 1 到 256 个字符。");
  }
  if (!input.inputModalities.includes("text")) {
    throw new Error("模型必须至少支持文字输入。");
  }
  if (input.maxOutputTokens > input.contextWindow) {
    throw new Error("最大输出 token 不能超过上下文长度。");
  }

  return {
    providerId: "providerId" in input ? input.providerId : "",
    modelId: input.modelId.trim(),
    displayName: input.displayName?.trim() || input.modelId.trim(),
    contextWindow: assertPositiveInteger(input.contextWindow, "上下文长度"),
    maxOutputTokens: assertPositiveInteger(input.maxOutputTokens, "最大输出 token"),
    inputModalities: [...new Set(input.inputModalities)],
    outputModalities: [...new Set(input.outputModalities ?? (["text"] as InputModality[]))],
    toolCalls: input.toolCalls,
    parallelToolCalls: input.parallelToolCalls,
    reasoningLevels: [
      ...new Set(input.reasoningLevels.map((level) => level.trim()).filter(Boolean)),
    ],
    anthropicNoneBehavior: input.anthropicNoneBehavior,
  };
}

function buildConnectionTestRequest(
  protocol: ProviderProtocol,
  model: ModelConfig,
): { path: string; body: Record<string, unknown> } {
  switch (protocol) {
    case "gemini_generate_content":
      return {
        path: geminiModelPath(model.modelId, false),
        body: {
          contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
          generationConfig: { maxOutputTokens: Math.min(1024, model.maxOutputTokens) },
        },
      };
    case "anthropic_messages":
      return {
        path: "/messages",
        body: {
          model: model.modelId,
          max_tokens: Math.min(16, model.maxOutputTokens),
          messages: [{ role: "user", content: "Reply with OK." }],
        },
      };
    case "openai_responses":
      return {
        path: "/responses",
        body: {
          model: model.modelId,
          input: "Reply with OK.",
          max_output_tokens: Math.min(16, model.maxOutputTokens),
        },
      };
    case "openai_chat_completions":
      return {
        path: "/chat/completions",
        body: {
          model: model.modelId,
          messages: [{ role: "user", content: "Reply with OK." }],
          max_tokens: Math.min(16, model.maxOutputTokens),
        },
      };
  }
}

export class ProviderService {
  constructor(
    private readonly repository: Repository,
    private readonly secretStore: SecretStore,
  ) {}

  createProvider(input: ProviderCreateInput): ProviderView {
    if (!PROTOCOLS.includes(input.protocol)) throw new Error("API 协议无效。");
    if (!AUTH_MODES.includes(input.authMode)) throw new Error("鉴权方式无效。");
    const name = validateProviderName(input.name);
    const baseUrl = normalizeBaseUrl(input.baseUrl, input.protocol);
    const keyLabel = validateKeyLabel(input.keyLabel);
    const customHeaderName = input.authMode === "custom" ? input.customHeaderName?.trim() : null;
    buildAuthHeaders({ ...input, baseUrl, customHeaderName: customHeaderName ?? null, apiKey: "" });
    const promptCaching =
      input.promptCaching !== undefined
        ? validatePromptCachingSettings(input.promptCaching, input.protocol)
        : null;
    const stored = this.secretStore.store(input.apiKey);

    const provider = this.repository.insertProvider({
      name,
      baseUrl,
      protocol: input.protocol,
      authMode: input.authMode,
      customHeaderName: customHeaderName ?? null,
    });

    try {
      if (promptCaching)
        this.repository.setSetting(providerPromptCachingKey(provider.id), promptCaching);
      this.repository.insertProviderKey({
        providerId: provider.id,
        label: keyLabel,
        secretRef: stored.secretRef,
        maskedHint: stored.maskedHint,
        neverReveal: input.neverReveal,
        priority: 0,
      });
    } catch (error) {
      this.repository.deleteProvider(provider.id);
      this.secretStore.remove(stored.secretRef);
      throw error;
    }

    const created = this.repository.getProvider(provider.id);
    if (!created) {
      throw new Error("创建供应商失败。");
    }

    return created;
  }

  updateProvider(input: ProviderUpdateInput, hasActiveConversations = false): ProviderView {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) =>
          !["providerId", "name", "baseUrl", "protocol", "authMode", "customHeaderName"].includes(
            key,
          ),
      ) ||
      typeof input.name !== "string" ||
      typeof input.baseUrl !== "string" ||
      input.baseUrl.length > 2048
    )
      throw new Error("供应商配置无效。");
    if (
      typeof input.providerId !== "string" ||
      !input.providerId.trim() ||
      input.providerId.length > 128
    )
      throw new Error("供应商标识无效。");
    if (!PROTOCOLS.includes(input.protocol)) throw new Error("API 协议无效。");
    const provider = this.requireProvider(input.providerId);
    const name = validateProviderName(input.name);
    const baseUrl = normalizeBaseUrl(input.baseUrl, input.protocol);
    if (input.authMode !== undefined && !AUTH_MODES.includes(input.authMode))
      throw new Error("鉴权方式无效。");
    const authMode = input.authMode ?? provider.authMode;
    if (!AUTH_MODES.includes(authMode)) throw new Error("鉴权方式无效。");
    if (
      input.customHeaderName !== undefined &&
      input.customHeaderName !== null &&
      typeof input.customHeaderName !== "string"
    )
      throw new Error("自定义鉴权头名称无效。");
    const customHeaderName =
      authMode === "custom"
        ? ((input.customHeaderName === undefined
            ? provider.customHeaderName
            : input.customHeaderName
          )?.trim() ?? null)
        : null;
    buildAuthHeaders({ baseUrl, protocol: input.protocol, authMode, customHeaderName, apiKey: "" });
    if (
      hasActiveConversations &&
      (baseUrl !== provider.baseUrl ||
        input.protocol !== provider.protocol ||
        authMode !== provider.authMode ||
        customHeaderName !== provider.customHeaderName)
    )
      throw new Error("请先等待所有会话结束或停止任务，再修改供应商地址或协议。");

    const currentPromptCaching = normalizePromptCachingSettings(provider.promptCaching);
    let promptCaching = currentPromptCaching;
    if (input.protocol !== provider.protocol) {
      try {
        validatePromptCachingSettings(promptCaching, input.protocol);
      } catch {
        promptCaching = { ...promptCaching, mode: "auto", ttl: "5m" };
      }
    }
    return this.repository.updateProvider({
      providerId: provider.id,
      name,
      baseUrl,
      protocol: input.protocol,
      authMode,
      customHeaderName,
      ...(JSON.stringify(promptCaching) !== JSON.stringify(currentPromptCaching)
        ? { promptCaching }
        : {}),
    });
  }

  removeProvider(providerId: string): void {
    const secretRefs = this.repository.deleteProvider(providerId);
    for (const secretRef of secretRefs) {
      this.secretStore.remove(secretRef);
    }
  }

  setPromptCaching(providerId: string, input: unknown): ProviderView {
    if (typeof providerId !== "string" || !providerId || providerId.length > 128)
      throw new Error("供应商标识无效。");
    const provider = this.requireProvider(providerId);
    const settings = validatePromptCachingSettings(input, provider.protocol);
    this.repository.setSetting(providerPromptCachingKey(providerId), settings);
    return this.requireProvider(providerId);
  }

  addKey(input: ProviderAddKeyInput): ProviderView {
    const provider = this.repository.getProvider(input.providerId);
    if (!provider) {
      throw new Error("供应商不存在。");
    }

    const stored = this.secretStore.store(input.apiKey);
    try {
      this.repository.insertProviderKey({
        providerId: input.providerId,
        label: validateKeyLabel(input.label),
        secretRef: stored.secretRef,
        maskedHint: stored.maskedHint,
        neverReveal: input.neverReveal,
        priority: provider.keys.length,
      });
    } catch (error) {
      this.secretStore.remove(stored.secretRef);
      throw error;
    }

    return this.requireProvider(input.providerId);
  }

  updateKey(input: ProviderUpdateKeyInput): ProviderView {
    this.requireProvider(input.providerId);
    const replacement = input.apiKey?.trim() ? this.secretStore.store(input.apiKey) : null;
    let previousSecretRef: string | null = null;
    try {
      previousSecretRef = this.repository.updateProviderKey({
        providerId: input.providerId,
        keyId: input.keyId,
        label: validateKeyLabel(input.label),
        neverReveal: input.neverReveal,
        ...(replacement
          ? { secretRef: replacement.secretRef, maskedHint: replacement.maskedHint }
          : {}),
      });
      if (!previousSecretRef) {
        throw new Error("API Key 不存在。");
      }
    } catch (error) {
      if (replacement) {
        this.secretStore.remove(replacement.secretRef);
      }
      throw error;
    }

    if (replacement && previousSecretRef !== replacement.secretRef) {
      this.secretStore.remove(previousSecretRef);
    }
    return this.requireProvider(input.providerId);
  }

  removeKey(providerId: string, keyId: string): ProviderView {
    const secretRef = this.repository.removeProviderKey(providerId, keyId);
    if (!secretRef) {
      throw new Error("API Key 不存在。");
    }
    this.secretStore.remove(secretRef);
    return this.requireProvider(providerId);
  }

  setActiveKey(providerId: string, keyId: string): ProviderView {
    this.repository.setActiveKey(providerId, keyId);
    return this.requireProvider(providerId);
  }

  createModel(input: ModelCreateInput): ProviderView {
    const provider = this.requireProvider(input.providerId);
    const normalized = validateModelInput(input);
    this.repository.insertModel({
      ...normalized,
      providerId: provider.id,
    });
    return this.requireProvider(provider.id);
  }

  updateModel(input: ModelUpdateInput): ProviderView {
    const normalized = validateModelInput(input);
    const providerId = this.repository.updateModel(input.id, normalized);
    return this.requireProvider(providerId);
  }

  removeModel(modelConfigId: string): ProviderView {
    const providerId = this.repository.removeModel(modelConfigId);
    return this.requireProvider(providerId);
  }

  async fetchModels(providerId: string): Promise<ModelDiscoveryResult> {
    try {
      return await this.fetchModelList(providerId);
    } catch (cause) {
      const secrets: string[] = [];
      try {
        secrets.push(this.getActiveApiKey(providerId));
      } catch {
        /* Preserve the original configuration error. */
      }
      recordRuntimeError("provider.models", cause, { providerId }, secrets);
      throw cause;
    }
  }

  private async fetchModelList(providerId: string): Promise<ModelDiscoveryResult> {
    const provider = this.requireProvider(providerId);
    const apiKey = this.readActiveKey(provider);
    const headers = this.wireContext(provider, apiKey);
    const startedAt = performance.now();
    const native = provider.protocol === "gemini_generate_content";
    const signal = AbortSignal.timeout(30_000);
    const found = new Set<string>();
    const seenTokens = new Set<string>();
    let pageToken = "";
    let pages = 0;
    do {
      const query = native
        ? `?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
        : "";
      const response = await fetch(`${provider.baseUrl}/models${query}`, {
        method: "GET",
        redirect: "error",
        headers: buildAuthHeaders(headers),
        signal,
      });
      const raw = await response.text();

      if (!response.ok) {
        throw new Error(
          `拉取模型失败：HTTP ${response.status}\n${redactSecrets(raw || response.statusText, apiKey)}`,
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw) as unknown;
      } catch {
        throw new Error("模型列表不是有效 JSON。");
      }

      if (native) {
        const record = geminiRecord(payload);
        if (!Array.isArray(record?.models)) throw new Error("模型列表不是有效 Gemini JSON。");
        for (const value of record.models) {
          const model = geminiRecord(value);
          if (
            typeof model?.name === "string" &&
            Array.isArray(model.supportedGenerationMethods) &&
            model.supportedGenerationMethods.includes("generateContent")
          ) {
            const id = model.name.replace(/^models\//, "");
            geminiModelPath(id);
            found.add(id);
          }
        }
        const next = record.nextPageToken;
        if (next !== undefined && (typeof next !== "string" || next.length > 4096))
          throw new Error("Gemini 模型列表分页标识无效。");
        pageToken = typeof next === "string" ? next : "";
        if (pageToken && seenTokens.has(pageToken)) throw new Error("Gemini 模型列表分页重复。");
        seenTokens.add(pageToken);
      } else for (const id of parseModelIds(payload)) found.add(id);
      if (++pages >= 100 || found.size > 10000) throw new Error("模型列表超过读取上限。");
    } while (native && pageToken);
    const modelIds = [...found].sort((a, b) => a.localeCompare(b));
    if (modelIds.length === 0) {
      throw new Error("供应商返回的模型列表为空或格式不受支持。");
    }

    return {
      modelIds,
      latencyMs: Math.round(performance.now() - startedAt),
      rawCount: modelIds.length,
    };
  }

  async testConnection(providerId: string, modelConfigId: string): Promise<ConnectionTestResult> {
    const provider = this.requireProvider(providerId);
    const model = this.repository.getModel(modelConfigId);
    if (!model || model.providerId !== providerId) {
      throw new Error("模型配置不存在或不属于该供应商。");
    }

    const apiKey = this.readActiveKey(provider);
    const request = buildConnectionTestRequest(provider.protocol, model);
    const url = `${provider.baseUrl}${request.path}`;
    const startedAt = performance.now();

    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: buildAuthHeaders(this.wireContext(provider, apiKey)),
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      const raw = await response.text();
      const latencyMs = Math.round(performance.now() - startedAt);
      let payload: unknown = null;
      let body = raw;

      try {
        payload = JSON.parse(raw) as unknown;
        body = JSON.stringify(payload, null, 2);
      } catch {
        payload = null;
      }

      const safeBody = redactSecrets(body || response.statusText, apiKey);
      const responseText = extractResponseText(payload);
      const candidates = geminiRecord(payload)?.candidates;
      const candidate = geminiRecord(Array.isArray(candidates) ? candidates[0] : null);
      const nativeError =
        provider.protocol === "gemini_generate_content" &&
        (!responseText.trim() || candidate?.finishReason !== "STOP")
          ? "Gemini 连接测试未返回完整文字，请检查安全拦截、模型输出预算和响应详情。"
          : null;
      if (!response.ok)
        recordRuntimeError(
          "provider.test",
          `${response.status} ${response.statusText}\n${safeBody}`,
          { providerId, modelId: modelConfigId, status: response.status },
          [apiKey],
        );

      return {
        ok: response.ok && !nativeError,
        status: response.status,
        latencyMs,
        requestUrl: url,
        modelId: model.modelId,
        responseText: redactSecrets(responseText, apiKey),
        responseBody: safeBody,
        error: response.ok ? nativeError : `HTTP ${response.status} ${response.statusText}`.trim(),
        usage: extractUsage(payload, provider.protocol),
      };
    } catch (error) {
      recordRuntimeError("provider.test", error, { providerId, modelId: modelConfigId }, [apiKey]);
      return {
        ok: false,
        status: null,
        latencyMs: Math.round(performance.now() - startedAt),
        requestUrl: url,
        modelId: model.modelId,
        responseText: "",
        responseBody: "",
        error: redactSecrets(error instanceof Error ? error.message : String(error), apiKey),
        usage: null,
      };
    }
  }

  getProvider(providerId: string): ProviderView {
    return this.requireProvider(providerId);
  }

  getActiveApiKey(providerId: string): string {
    return this.readActiveKey(this.requireProvider(providerId));
  }

  private requireProvider(providerId: string): ProviderView {
    const provider = this.repository.getProvider(providerId);
    if (!provider) {
      throw new Error("供应商不存在。");
    }
    return provider;
  }

  private readActiveKey(provider: ProviderView): string {
    const activeKey = this.repository.getActiveKey(provider.id);
    if (!activeKey) {
      throw new Error("该供应商没有可用的 API Key。");
    }
    return this.secretStore.read(activeKey.secretRef);
  }

  private wireContext(provider: ProviderView, apiKey: string): ProviderWireContext {
    return {
      baseUrl: provider.baseUrl,
      protocol: provider.protocol,
      authMode: provider.authMode,
      customHeaderName: provider.customHeaderName,
      apiKey,
    };
  }
}
