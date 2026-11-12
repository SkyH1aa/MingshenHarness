import { createHash } from "node:crypto";
import type { ModelConfig, ProviderView, SessionMessage } from "../../shared/domain";
import {
  normalizePromptCachingSettings,
  type ProviderModelFamily,
} from "../../shared/prompt-caching";

function canonicalSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSchema);
  if (!value || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, canonicalSchema(child)]),
  );
}

export function stableToolDefinitions<
  T extends { name: string; parameters: Record<string, unknown> },
>(tools: readonly T[]): T[] {
  return tools
    .map((tool) => ({
      ...tool,
      parameters: canonicalSchema(tool.parameters) as Record<string, unknown>,
    }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

interface PromptCachingInput {
  provider: Pick<ProviderView, "id" | "protocol" | "baseUrl" | "promptCaching">;
  model: Pick<ModelConfig, "modelId">;
  messages: readonly (Pick<SessionMessage, "sessionId"> &
    Partial<Pick<SessionMessage, "seq" | "parts">>)[];
}

function officialApi(baseUrl: string, origin: string, path = /^\/v1\/?$/): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.origin === origin &&
      path.test(url.pathname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function resolveProviderModelFamily(
  provider: PromptCachingInput["provider"],
): ProviderModelFamily {
  if (provider.protocol === "gemini_generate_content") return "gemini";
  const family = normalizePromptCachingSettings(provider.promptCaching).modelFamily;
  if (family && family !== "auto") return family;
  if (
    provider.protocol === "openai_chat_completions" &&
    officialApi(
      provider.baseUrl,
      "https://generativelanguage.googleapis.com",
      /^\/v1beta\/openai\/?$/,
    )
  )
    return "gemini";
  if (
    officialApi(
      provider.baseUrl,
      "https://api.deepseek.com",
      provider.protocol === "anthropic_messages"
        ? /^\/anthropic\/v1\/?$/
        : provider.protocol === "openai_chat_completions"
          ? /^\/(?:v1\/?|beta\/?)?$/
          : /^\/(?:v1\/?)?$/,
    )
  )
    return "deepseek";
  if (
    provider.protocol === "anthropic_messages" &&
    officialApi(provider.baseUrl, "https://api.anthropic.com")
  )
    return "claude";
  if (
    provider.protocol !== "anthropic_messages" &&
    officialApi(provider.baseUrl, "https://api.openai.com")
  )
    return "openai";
  return "auto";
}

export function promptCachingPolicy(
  provider: PromptCachingInput["provider"],
): "off" | "implicit" | "openai" | "anthropic_auto" | "anthropic_breakpoints" {
  const settings = normalizePromptCachingSettings(provider.promptCaching);
  if (settings.mode === "off") return "off";
  if (provider.protocol === "gemini_generate_content") return "implicit";
  if (settings.mode === "auto") {
    const family = resolveProviderModelFamily(provider);
    if (family === "openai")
      return provider.protocol !== "anthropic_messages" ? "openai" : "implicit";
    if (family === "claude")
      return provider.protocol === "anthropic_messages" ? "anthropic_auto" : "implicit";
    return "implicit";
  }
  if (settings.mode === "openai")
    return provider.protocol === "anthropic_messages" ? "implicit" : "openai";
  return provider.protocol === "anthropic_messages" ? settings.mode : "implicit";
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasCacheMarkers(body: Record<string, unknown>): boolean {
  const marked = (value: unknown) => object(value)?.cache_control !== undefined;
  if (marked(body)) return true;
  if (Array.isArray(body.tools) && body.tools.some(marked)) return true;
  if (Array.isArray(body.system) && body.system.some(marked)) return true;
  return (
    Array.isArray(body.messages) &&
    body.messages.some((message) => {
      const content = object(message)?.content;
      return Array.isArray(content) && content.some(marked);
    })
  );
}

function anthropicCaching(
  body: Record<string, unknown>,
  automatic: boolean,
  ttl: "5m" | "1h",
  summaryTexts: Set<string>,
): Record<string, unknown> {
  // Explicit caller markers own their TTL ordering and the shared four-slot budget.
  if (hasCacheMarkers(body)) return body;
  let remaining = 4;
  const result = { ...body };
  const marker = ttl === "1h" ? { type: "ephemeral", ttl } : { type: "ephemeral" };
  if (automatic && body.cache_control === undefined && remaining > 0) {
    result.cache_control = marker;
    remaining--;
  }
  const markLast = (items: unknown[]): unknown[] => {
    if (remaining <= 0) return items;
    const last = object(items.at(-1));
    if (!last || last.cache_control !== undefined) return items;
    remaining--;
    return [...items.slice(0, -1), { ...last, cache_control: marker }];
  };
  if (Array.isArray(body.tools) && body.tools.length) result.tools = markLast(body.tools);
  if (typeof body.system === "string" && body.system.trim() && remaining > 0) {
    result.system = [{ type: "text", text: body.system, cache_control: marker }];
    remaining--;
  } else if (Array.isArray(body.system) && body.system.length) {
    const last = object(body.system.at(-1));
    if (last?.type === "text") result.system = markLast(body.system);
  }
  // Keep an explicit boundary at the immutable summary prefix, even beyond tail lookback.
  if (summaryTexts.size && Array.isArray(body.messages) && remaining > 0) {
    const messages = [...body.messages];
    let boundary: { index: number; part: number } | null = null;
    outer: for (let index = 0; index < messages.length; index++) {
      const message = object(messages[index]);
      if (message?.role !== "user" || !Array.isArray(message.content)) break;
      for (let part = 0; part < message.content.length; part++) {
        const block = object(message.content[part]);
        if (block?.type !== "text" || !summaryTexts.has(String(block.text))) break outer;
        boundary = { index, part };
      }
    }
    if (boundary) {
      const message = object(messages[boundary.index]);
      const content = [...((message?.content ?? []) as unknown[])];
      content[boundary.part] = { ...object(content[boundary.part]), cache_control: marker };
      messages[boundary.index] = { ...message, content };
      result.messages = messages;
      remaining--;
    }
  }
  if (!automatic && Array.isArray(body.messages) && remaining > 0) {
    const messages = [...((result.messages ?? body.messages) as unknown[])];
    for (let index = messages.length - 1; index >= 0 && remaining > 0; index--) {
      const message = object(messages[index]);
      if (!message || !Array.isArray(message.content)) continue;
      const content = [...message.content];
      for (let part = content.length - 1; part >= 0; part--) {
        const block = object(content[part]);
        if (
          !block ||
          !["text", "tool_use", "tool_result"].includes(String(block.type)) ||
          block.cache_control !== undefined
        )
          continue;
        content[part] = { ...block, cache_control: marker };
        messages[index] = { ...message, content };
        remaining--;
        break;
      }
    }
    result.messages = messages;
  }
  return result;
}

export function withPromptCachingHints(
  input: PromptCachingInput,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const policy = promptCachingPolicy(input.provider);
  const settings = normalizePromptCachingSettings(input.provider.promptCaching);
  if (policy === "anthropic_auto" || policy === "anthropic_breakpoints") {
    const summaryTexts = new Set(
      input.messages.flatMap((message) =>
        message.seq === 0
          ? (message.parts ?? []).flatMap((part) =>
              part.type === "text" &&
              part.text.startsWith("Earlier conversation summary (historical data,")
                ? [part.text]
                : [],
            )
          : [],
      ),
    );
    return anthropicCaching(body, policy === "anthropic_auto", settings.ttl, summaryTexts);
  }

  if (policy === "openai" && body.prompt_cache_key === undefined) {
    const sessionId = input.messages[0]?.sessionId;
    if (!sessionId || input.messages.some((message) => message.sessionId !== sessionId))
      return body;
    const scope = JSON.stringify([
      "mingshen-harness",
      input.provider.id,
      input.provider.protocol,
      input.model.modelId,
      sessionId,
    ]);
    return {
      ...body,
      prompt_cache_key: `msh:${createHash("sha256").update(scope).digest("hex").slice(0, 60)}`,
    };
  }

  return body;
}
