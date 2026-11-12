import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { ProviderProtocol } from "../../shared/domain";
import type { PromptCacheDiagnostic } from "../../shared/prompt-cache-diagnostics";
import type { TokenUsageKind } from "../../shared/token-saver";
import type { Repository } from "../storage/repository";

const FINGERPRINT_LIMIT = 2048;
const processKey = randomBytes(32);
const processEpoch = randomBytes(16).toString("hex");
const usageKinds = ["agent", "compaction", "approval", "memory", "title"] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const fingerprintSchema = z.object({
  version: z.literal(1),
  epoch: z.string().regex(/^[a-f0-9]{32}$/),
  provider: digest,
  protocol: z.enum([
    "anthropic_messages",
    "openai_responses",
    "openai_chat_completions",
    "gemini_generate_content",
  ]),
  endpoint: digest,
  model: digest,
  authentication: digest,
  tools: digest,
  system: digest,
  settings: digest,
  cachePolicy: digest,
  history: z.array(digest).max(FINGERPRINT_LIMIT),
  historyBlocks: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  overflow: digest.nullable(),
});
const diagnosticSchema = z.object({
  change: z.enum([
    "first_observation",
    "process_restart",
    "provider",
    "protocol",
    "endpoint",
    "model",
    "authentication",
    "tools",
    "system",
    "history",
    "history_truncated",
    "append_only",
    "unchanged",
    "comparison_limit",
  ]),
  matchedBlocks: z.number().int().nonnegative(),
  previousBlocks: z.number().int().nonnegative(),
  currentBlocks: z.number().int().nonnegative(),
  settingsChanged: z.boolean(),
  cachePolicyChanged: z.boolean(),
  cacheOutcome: z.enum(["unknown", "none", "partial", "full"]),
  inputTokens: z.number().nonnegative().nullable(),
  cachedInputTokens: z.number().nonnegative().nullable(),
  updatedAt: z.string().max(40),
});
const ledgerSchema = z.object({
  version: z.literal(1),
  fingerprints: z.partialRecord(z.enum(usageKinds), fingerprintSchema),
  diagnostics: z.partialRecord(z.enum(usageKinds), diagnosticSchema),
});

export type WireCacheFingerprint = z.infer<typeof fingerprintSchema>;

interface WireCacheInput {
  provider: {
    id: string;
    protocol: ProviderProtocol;
    baseUrl: string;
    authMode?: string;
    customHeaderName?: string | null;
  };
  model: { modelId: string };
  apiKey: string;
  path: string;
  body: Record<string, unknown>;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const hash = (value: unknown): string =>
  createHmac("sha256", processKey)
    .update(JSON.stringify(value) ?? "undefined")
    .digest("hex");

function withoutCacheMarker(value: unknown): unknown {
  const source = object(value);
  if (!Object.hasOwn(source, "cache_control")) return value;
  const { cache_control: _marker, ...content } = source;
  return content;
}

function contentBlocks(value: unknown): unknown[] {
  return Array.isArray(value) ? value.map(withoutCacheMarker) : [value];
}

function messageAtoms(value: unknown): unknown[] {
  const message = object(value);
  if (typeof message.role !== "string") return [message];
  if (Array.isArray(message.parts)) {
    const { parts, ...header } = message;
    return [header, ...parts];
  }
  const { content, cache_control: _marker, ...header } = message;
  return [header, ...contentBlocks(content)];
}

function policyMarkers(body: Record<string, unknown>): unknown[] {
  const markers: unknown[] = [];
  for (const [index, tool] of array(body.tools).entries()) {
    const marker = object(tool).cache_control;
    if (marker !== undefined) markers.push(["tool", index, marker]);
  }
  for (const [index, block] of array(body.system).entries()) {
    const marker = object(block).cache_control;
    if (marker !== undefined) markers.push(["system", index, marker]);
  }
  for (const [index, message] of array(body.messages).entries()) {
    const record = object(message);
    if (record.cache_control !== undefined) markers.push(["message", index, record.cache_control]);
    for (const [part, block] of array(record.content).entries()) {
      const marker = object(block).cache_control;
      if (marker !== undefined) markers.push(["content", index, part, marker]);
    }
  }
  return [body.cache_control, body.prompt_cache_key, body.prompt_cache_retention, markers];
}

export function createWireCacheFingerprint(input: WireCacheInput): WireCacheFingerprint {
  const { body } = input;
  const messages =
    input.provider.protocol === "gemini_generate_content"
      ? array(body.contents)
      : input.provider.protocol === "openai_responses"
        ? array(body.input)
        : array(body.messages);
  const system =
    input.provider.protocol === "gemini_generate_content"
      ? body.systemInstruction
      : input.provider.protocol === "openai_responses"
        ? body.instructions
        : input.provider.protocol === "anthropic_messages"
          ? contentBlocks(body.system)
          : messages.filter((message) =>
              ["system", "developer"].includes(String(object(message).role)),
            );
  const conversation =
    input.provider.protocol === "openai_chat_completions"
      ? messages.filter(
          (message) => !["system", "developer"].includes(String(object(message).role)),
        )
      : messages;
  const history: string[] = [];
  let historyBlocks = 0;
  const overflowHash = createHmac("sha256", processKey);
  for (const message of conversation) {
    for (const atom of messageAtoms(message)) {
      const value = hash(atom);
      if (historyBlocks < FINGERPRINT_LIMIT) history.push(value);
      else overflowHash.update(value);
      historyBlocks++;
    }
  }
  return {
    version: 1,
    epoch: processEpoch,
    provider: hash(input.provider.id),
    protocol: input.provider.protocol,
    endpoint: hash([input.provider.baseUrl, input.path]),
    model: hash(body.model ?? input.model.modelId),
    authentication: hash([input.provider.authMode, input.provider.customHeaderName, input.apiKey]),
    tools: hash(array(body.tools).map(withoutCacheMarker)),
    system: hash(system),
    settings: hash([
      body.reasoning,
      body.reasoning_effort,
      body.thinking,
      body.output_config,
      body.temperature,
      body.top_p,
      body.max_tokens,
      body.max_output_tokens,
      body.tool_choice,
      body.parallel_tool_calls,
      body.generationConfig,
      body.toolConfig,
    ]),
    cachePolicy: hash(policyMarkers(body)),
    history,
    historyBlocks,
    overflow: historyBlocks > FINGERPRINT_LIMIT ? overflowHash.digest("hex") : null,
  };
}

export function compareWireCacheFingerprints(
  previous: WireCacheFingerprint | null,
  current: WireCacheFingerprint,
): Omit<PromptCacheDiagnostic, "cacheOutcome" | "inputTokens" | "cachedInputTokens" | "updatedAt"> {
  const result = {
    change: "first_observation" as PromptCacheDiagnostic["change"],
    matchedBlocks: 0,
    previousBlocks: previous?.historyBlocks ?? 0,
    currentBlocks: current.historyBlocks,
    settingsChanged: false,
    cachePolicyChanged: false,
  };
  if (!previous) return result;
  if (previous.epoch !== current.epoch) return { ...result, change: "process_restart" };
  result.settingsChanged = previous.settings !== current.settings;
  result.cachePolicyChanged = previous.cachePolicy !== current.cachePolicy;
  for (const section of [
    "provider",
    "protocol",
    "endpoint",
    "model",
    "authentication",
    "tools",
    "system",
  ] as const) {
    if (previous[section] !== current[section]) return { ...result, change: section };
  }
  while (
    result.matchedBlocks < Math.min(previous.history.length, current.history.length) &&
    previous.history[result.matchedBlocks] === current.history[result.matchedBlocks]
  )
    result.matchedBlocks++;
  if (result.matchedBlocks < Math.min(previous.history.length, current.history.length))
    return { ...result, change: "history" };
  if (current.historyBlocks < previous.historyBlocks && current.historyBlocks <= FINGERPRINT_LIMIT)
    return { ...result, change: "history_truncated" };
  if (previous.overflow) {
    if (previous.historyBlocks === current.historyBlocks && previous.overflow === current.overflow)
      return { ...result, change: "unchanged", matchedBlocks: current.historyBlocks };
    return { ...result, change: "comparison_limit" };
  }
  return {
    ...result,
    change: current.historyBlocks === previous.historyBlocks ? "unchanged" : "append_only",
  };
}

export function readCacheDiagnostics(
  repository: Pick<Repository, "getSetting">,
  sessionId: string,
): Partial<Record<TokenUsageKind, PromptCacheDiagnostic>> {
  const ledger = ledgerSchema.safeParse(repository.getSetting(`tokenSaver.cache.${sessionId}`));
  return ledger.success ? ledger.data.diagnostics : {};
}

export function recordCacheDiagnostic(
  repository: Pick<Repository, "getSetting" | "setSetting">,
  sessionId: string,
  kind: TokenUsageKind,
  current: WireCacheFingerprint,
  usage: { inputTokens: number | null; cachedInputTokens: number | null },
): void {
  const parsed = fingerprintSchema.safeParse(current);
  if (!parsed.success) return;
  const saved = ledgerSchema.safeParse(repository.getSetting(`tokenSaver.cache.${sessionId}`));
  const ledger = saved.success
    ? saved.data
    : { version: 1 as const, fingerprints: {}, diagnostics: {} };
  const comparison = compareWireCacheFingerprints(ledger.fingerprints[kind] ?? null, current);
  const valid = (value: number | null): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  const inputTokens = valid(usage.inputTokens) ? usage.inputTokens : null;
  const cachedInputTokens =
    inputTokens !== null && valid(usage.cachedInputTokens) && usage.cachedInputTokens <= inputTokens
      ? usage.cachedInputTokens
      : null;
  ledger.fingerprints[kind] = parsed.data;
  ledger.diagnostics[kind] = {
    ...comparison,
    cacheOutcome:
      cachedInputTokens === null
        ? "unknown"
        : cachedInputTokens === 0
          ? "none"
          : cachedInputTokens === inputTokens
            ? "full"
            : "partial",
    inputTokens,
    cachedInputTokens,
    updatedAt: new Date().toISOString(),
  };
  repository.setSetting(`tokenSaver.cache.${sessionId}`, ledger);
}
