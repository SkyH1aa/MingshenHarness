import { createHash } from "node:crypto";
import type {
  ModelConfig,
  ProviderNativeState,
  ProviderView,
  ResponsesStateItem,
  SessionMessage,
} from "../../shared/domain";
import { safeGeminiPayload } from "./gemini-format";
import { resolveProviderModelFamily } from "./prompt-caching";
import { responsesItemText, safeResponsesItem } from "./responses-state";

const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_FIELD_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 512;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, empty = true): value is string {
  return (
    typeof value === "string" &&
    (empty || value.length > 0) &&
    Buffer.byteLength(value, "utf8") <= MAX_FIELD_BYTES
  );
}

export function providerStateEndpointKey(provider: ProviderView): string {
  let endpoint = provider.baseUrl;
  try {
    endpoint = new URL(endpoint).href;
  } catch {
    // Invalid endpoints are rejected by the request path.
  }
  return createHash("sha256")
    .update(JSON.stringify([endpoint, provider.authMode, provider.customHeaderName ?? null]))
    .digest("hex");
}

export function providerStateScope(
  provider: ProviderView,
  model: ModelConfig,
): Omit<ProviderNativeState, "payload"> | null {
  const family = resolveProviderModelFamily(provider);
  if (
    family !== "deepseek" &&
    !(
      family === "gemini" &&
      ["openai_chat_completions", "gemini_generate_content"].includes(provider.protocol)
    )
  )
    return null;
  return {
    family,
    protocol: provider.protocol,
    providerId: provider.id,
    modelId: model.modelId,
    endpointKey: providerStateEndpointKey(provider),
  };
}

function safeChatPayload(
  value: Record<string, unknown>,
  family: ProviderNativeState["family"],
): Record<string, unknown> | null {
  if (value.role !== "assistant" || !(value.content === null || text(value.content))) return null;
  const calls: Array<Record<string, unknown>> = [];
  let signatureFound = false;
  let extraContent: Record<string, unknown> | undefined;
  if (family === "gemini" && value.extra_content !== undefined) {
    const google = record(record(value.extra_content)?.google);
    if (google?.thought_signature !== undefined) {
      if (!text(google.thought_signature, false)) return null;
      extraContent = { google: { thought_signature: google.thought_signature } };
      signatureFound = true;
    }
  }
  if (value.tool_calls !== undefined) {
    if (!Array.isArray(value.tool_calls) || value.tool_calls.length > MAX_ITEMS) return null;
    const ids = new Set<string>();
    for (const item of value.tool_calls) {
      const call = record(item);
      const fn = record(call?.function);
      if (
        call?.type !== "function" ||
        !text(call.id, false) ||
        ids.has(call.id) ||
        !fn ||
        !text(fn.name, false) ||
        !text(fn.arguments)
      )
        return null;
      ids.add(call.id);
      const result: Record<string, unknown> = {
        id: call.id,
        type: "function",
        function: { name: fn.name, arguments: fn.arguments },
      };
      if (family === "gemini" && call.extra_content !== undefined) {
        const extra = record(call.extra_content);
        const google = record(extra?.google);
        if (google?.thought_signature !== undefined) {
          if (!text(google.thought_signature, false)) return null;
          result.extra_content = { google: { thought_signature: google.thought_signature } };
          signatureFound = true;
        }
      }
      calls.push(result);
    }
  }
  if (family === "gemini" && !signatureFound) return null;
  if (family === "deepseek" && !text(value.reasoning_content)) return null;
  return {
    role: "assistant",
    content: value.content,
    ...(extraContent ? { extra_content: extraContent } : {}),
    ...(family === "deepseek" ? { reasoning_content: value.reasoning_content } : {}),
    ...(calls.length ? { tool_calls: calls } : {}),
  };
}

function safeResponsesPayload(value: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > MAX_ITEMS)
    return null;
  const items: Array<Record<string, unknown>> = [];
  let reasoningFound = false;
  for (const item of value.items) {
    const source = record(item);
    if (!source) return null;
    if (source.type === "reasoning") {
      if (
        (source.status !== undefined && source.status !== "completed") ||
        source.encrypted_content !== undefined ||
        !Array.isArray(source.content) ||
        !source.content.every((part) => {
          const content = record(part);
          return content?.type === "reasoning_text" && text(content.text);
        })
      )
        return null;
      const reasoning: Record<string, unknown> = {
        type: "reasoning",
        content: source.content.map((part) => ({
          type: "reasoning_text",
          text: (part as Record<string, unknown>).text,
        })),
      };
      if (text(source.id, false)) reasoning.id = source.id;
      if (text(source.status, false)) reasoning.status = source.status;
      items.push(reasoning);
      reasoningFound = true;
    } else {
      const safe = safeResponsesItem(source);
      if (!safe || !["message", "function_call"].includes(safe.type)) return null;
      if (Array.isArray(source.content))
        for (const [index, part] of (safe.content ?? []).entries())
          if (record(source.content[index])?.annotations === undefined) delete part.annotations;
      items.push({ ...safe });
    }
  }
  return reasoningFound ? { items } : null;
}

function safeAnthropicPayload(value: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(value.content) || !value.content.length || value.content.length > MAX_ITEMS)
    return null;
  const content: Array<Record<string, unknown>> = [];
  let thinkingFound = false;
  for (const item of value.content) {
    const block = record(item);
    if (!block) return null;
    if (block.type === "thinking" && text(block.thinking)) {
      if (block.signature !== undefined && !text(block.signature)) return null;
      content.push({
        type: "thinking",
        thinking: block.thinking,
        ...(block.signature !== undefined ? { signature: block.signature } : {}),
      });
      thinkingFound = true;
    } else if (block.type === "text" && text(block.text)) {
      content.push({ type: "text", text: block.text });
    } else if (
      block.type === "tool_use" &&
      text(block.id, false) &&
      text(block.name, false) &&
      record(block.input)
    ) {
      content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
    } else return null;
  }
  return thinkingFound ? { content } : null;
}

export function safeProviderState(state: ProviderNativeState): ProviderNativeState | null {
  try {
    if (
      !["gemini", "deepseek"].includes(state.family) ||
      !text(state.providerId, false) ||
      !text(state.modelId, false) ||
      !/^[a-f0-9]{64}$/.test(state.endpointKey)
    )
      return null;
    const value = record(state.payload);
    if (!value) return null;
    const payload =
      state.protocol === "gemini_generate_content" && state.family === "gemini"
        ? safeGeminiPayload(value)
        : state.protocol === "openai_chat_completions"
          ? safeChatPayload(value, state.family)
          : state.family === "deepseek" && state.protocol === "openai_responses"
            ? safeResponsesPayload(value)
            : state.family === "deepseek" && state.protocol === "anthropic_messages"
              ? safeAnthropicPayload(value)
              : null;
    if (!payload || Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_STATE_BYTES)
      return null;
    return { ...state, payload };
  } catch {
    return null;
  }
}

export function createProviderState(
  provider: ProviderView,
  model: ModelConfig,
  payload: Record<string, unknown>,
): ProviderNativeState | null {
  const scope = providerStateScope(provider, model);
  return scope ? safeProviderState({ ...scope, payload }) : null;
}

function payloadIdentity(state: ProviderNativeState): {
  text: string;
  calls: Array<{ callId: unknown; name: unknown; arguments: unknown }>;
} {
  const payload = state.payload;
  if (state.protocol === "gemini_generate_content") {
    const parts = (payload.content as { parts: Array<Record<string, unknown>> }).parts;
    const ids = payload.callIds as string[];
    return {
      text: parts
        .filter((part) => part.thought !== true && typeof part.text === "string")
        .map((part) => part.text)
        .join(""),
      calls: parts
        .filter((part) => part.functionCall)
        .map((part, index) => {
          const call = part.functionCall as Record<string, unknown>;
          return {
            callId: ids[index],
            name: call.name,
            arguments: JSON.stringify(call.args ?? {}),
          };
        }),
    };
  }
  if (state.protocol === "openai_chat_completions")
    return {
      text: typeof payload.content === "string" ? payload.content : "",
      calls: ((payload.tool_calls ?? []) as Array<Record<string, unknown>>).map((call) => {
        const fn = call.function as Record<string, unknown>;
        return { callId: call.id, name: fn.name, arguments: fn.arguments };
      }),
    };
  if (state.protocol === "openai_responses") {
    const items = payload.items as Array<Record<string, unknown>>;
    return {
      text: items.map((item) => responsesItemText(item as unknown as ResponsesStateItem)).join(""),
      calls: items
        .filter((item) => item.type === "function_call")
        .map((item) => ({ callId: item.call_id, name: item.name, arguments: item.arguments })),
    };
  }
  const content = payload.content as Array<Record<string, unknown>>;
  return {
    text: content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(""),
    calls: content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        callId: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
      })),
  };
}

export function replayProviderState(
  message: SessionMessage,
  provider: ProviderView,
  model: ModelConfig,
): Record<string, unknown> | null {
  if (message.role !== "assistant") return null;
  const scope = providerStateScope(provider, model);
  if (!scope) return null;
  const states = message.parts.filter((part) => part.type === "provider_state");
  if (states.length !== 1) return null;
  const state = states[0]?.state;
  if (
    !state ||
    Object.entries(scope).some(([key, value]) => state[key as keyof typeof scope] !== value)
  )
    return null;
  const safe = safeProviderState(state);
  if (!safe) return null;
  const native = payloadIdentity(safe);
  const visible = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  const calls = message.parts
    .filter((part) => part.type === "tool_call")
    .map((part) => ({
      callId: part.callId,
      name: part.name,
      arguments: part.arguments,
    }));
  if (native.text !== visible || calls.length !== native.calls.length) return null;
  for (const [index, call] of calls.entries()) {
    const original = native.calls[index];
    if (!original || call.callId !== original.callId || call.name !== original.name) return null;
    if (call.arguments !== original.arguments) {
      if (safe.protocol !== "anthropic_messages" && safe.protocol !== "gemini_generate_content")
        return null;
      try {
        if (JSON.stringify(JSON.parse(call.arguments)) !== original.arguments) return null;
      } catch {
        return null;
      }
    }
  }
  return safe.payload;
}
