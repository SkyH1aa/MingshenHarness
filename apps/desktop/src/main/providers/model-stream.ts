import type {
  ModelConfig,
  ProviderNativeState,
  ProviderProtocol,
  ProviderView,
  ResponsesStateItem,
  SessionMessage,
  ToolResultImage,
} from "../../shared/domain";
import { normalizeModelRetrySettings } from "../../shared/model-retry";
import { recordRuntimeError } from "../diagnostics/runtime-log";
import {
  extractedAttachmentText,
  pdfReadMode,
  prepareMessageAttachments,
} from "../documents/attachment-content";
import { redactSecrets } from "../security/redact";
import type { RequestUsage } from "../token-saver/usage";
import { createWireCacheFingerprint, type WireCacheFingerprint } from "./cache-diagnostics";
import { geminiModelPath, geminiThinkingConfig } from "./gemini-format";
import { decodeGemini } from "./gemini-stream";
import {
  ModelOutputLimitError,
  ModelRequestError,
  retryAfterMs,
  retryableStatus,
  retryDelayMs,
  upstreamError,
  waitForRetry,
} from "./model-request-error";
import {
  resolveProviderModelFamily,
  stableToolDefinitions,
  withPromptCachingHints,
} from "./prompt-caching";
import {
  createProviderState,
  providerStateScope,
  replayProviderState,
} from "./provider-native-state";
import { buildAuthHeaders, extractUsage } from "./provider-service";
import {
  hasEncryptedResponsesState,
  replayResponsesState,
  responsesEndpointKey,
  responsesItemText,
  safeResponsesItem,
  safeResponsesItems,
} from "./responses-state";
import { parseServerSentEvents } from "./sse";

export interface StreamToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ModelStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "provider_state"; state: ProviderNativeState }
  | {
      type: "responses_state";
      providerId: string;
      modelId: string;
      endpointKey: string;
      items: ResponsesStateItem[];
    }
  | {
      type: "tool_call_started";
      index: number;
      callId: string;
      name: string;
    }
  | {
      type: "tool_call_arguments_delta";
      index: number;
      delta: string;
    }
  | {
      type: "tool_call_arguments";
      index: number;
      arguments: string;
    }
  | {
      type: "usage";
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      cachedInputTokens: number | null;
      cacheCreationInputTokens: number | null;
    };

export interface StreamTurnInput {
  provider: ProviderView;
  model: ModelConfig;
  apiKey: string;
  systemPrompt: string;
  messages: SessionMessage[];
  reasoningLevel: string | null;
  tools: StreamToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  toolChoice?: "none";
  signal: AbortSignal;
  onRequestUsage?: (usage: RequestUsage) => void;
  onRequestPrepared?: (request: PreparedModelRequest) => void;
  onBeforeRequest?: () => void;
  retry?: {
    maxRetries: number;
    onRetry: (state: {
      attempt: number;
      maxRetries: number;
      delayMs: number;
      error: string;
    }) => void;
    onRecovered?: () => void;
  };
}

export type PreparedModelRequest = Pick<
  StreamTurnInput,
  | "provider"
  | "model"
  | "systemPrompt"
  | "messages"
  | "tools"
  | "reasoningLevel"
  | "temperature"
  | "topP"
>;

interface WireRequest {
  path: string;
  body: Record<string, unknown>;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
}

function messageText(message: SessionMessage): string {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function messageAttachments(message: SessionMessage) {
  return message.parts
    .filter(
      (part): part is Extract<(typeof message.parts)[number], { type: "attachment" }> =>
        part.type === "attachment",
    )
    .map((part) => part.attachment);
}

function attachmentFallback(name: string, mimeType: string, path?: string): string {
  return [
    `附件：${name}`,
    `类型：${mimeType}`,
    path
      ? `路径：${path}。可使用内置 read_document/read_file 读取。`
      : "该二进制格式没有可用的原生输入或内置文本解析。请如实说明具体限制，不要声称已阅读。",
  ].join("\n");
}

function attachmentBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : "";
}

function isTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    /(?:json|xml|yaml|javascript|typescript|sql|markdown|csv)/i.test(mimeType)
  );
}

function supports(model: ModelConfig, modality: ModelConfig["inputModalities"][number]): boolean {
  return (model.inputModalities ?? ["text"]).includes(modality);
}

function decodeTextAttachment(dataUrl: string): string {
  try {
    return Buffer.from(attachmentBase64(dataUrl), "base64").toString("utf8").slice(0, 120_000);
  } catch {
    return "";
  }
}

function messageToolCalls(message: SessionMessage) {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "tool_call" }> => {
      return part.type === "tool_call";
    })
    .map((part) => ({
      callId: part.callId,
      name: part.name,
      arguments: part.arguments,
      synthetic: part.synthetic === true,
      chainRootCallId: part.chainRootCallId,
    }));
}

function messageToolResults(message: SessionMessage) {
  return message.parts.filter(
    (part): part is Extract<(typeof message.parts)[number], { type: "tool_result" }> =>
      part.type === "tool_result",
  );
}

function toolResultVisuals(
  result: Extract<SessionMessage["parts"][number], { type: "tool_result" }>,
  model: ModelConfig,
): { text: string; images: ToolResultImage[] } {
  const images: ToolResultImage[] = [];
  let bytes = 0;
  let omitted = 0;
  for (const image of result.images ?? []) {
    const match =
      typeof image?.dataUrl === "string"
        ? /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl)
        : null;
    const size = match?.[2] ? Math.floor((match[2].length * 3) / 4) : 0;
    if (
      !match ||
      match[1] !== image.mimeType ||
      !size ||
      images.length >= 20 ||
      bytes + size > 25 * 1024 * 1024
    ) {
      omitted++;
      continue;
    }
    bytes += size;
    images.push({
      dataUrl: image.dataUrl,
      mimeType: image.mimeType,
      ...(typeof image.alt === "string" ? { alt: image.alt.slice(0, 1000) } : {}),
    });
  }
  const notices: string[] = [];
  if (images.length && !supports(model, "image")) {
    notices.push(
      `[${images.length} tool image(s) were not transmitted: the current model does not support image input. Do not claim to have inspected their pixels.]`,
    );
    images.length = 0;
  }
  if (omitted)
    notices.push(`[${omitted} invalid or oversized tool image(s) omitted; no pixels transmitted.]`);
  return { text: [result.output, ...notices].filter(Boolean).join("\n\n"), images };
}

function parsedToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function appendAnthropicContent(
  messages: AnthropicMessage[],
  role: "user" | "assistant",
  content: Array<Record<string, unknown>>,
): void {
  if (content.length === 0) {
    return;
  }
  const previous = messages.at(-1);
  if (previous?.role === role) {
    previous.content.push(...content);
  } else {
    messages.push({ role, content });
  }
}

function buildAnthropicMessages(
  messages: SessionMessage[],
  model: ModelConfig,
  provider: ProviderView,
): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text = messageText(message);
      const content: Array<Record<string, unknown>> = text ? [{ type: "text", text }] : [];
      for (const attachment of messageAttachments(message)) {
        if (attachment.kind === "image" && supports(model, "image")) {
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: attachment.mimeType,
              data: attachmentBase64(attachment.dataUrl),
            },
          });
          continue;
        }
        const extracted = extractedAttachmentText(attachment);
        if (
          attachment.documentPageImages?.length &&
          supports(model, "image") &&
          !supports(model, "file")
        ) {
          if (extracted) content.push({ type: "text", text: extracted });
          for (const page of attachment.documentPageImages)
            content.push(
              { type: "text", text: `${attachment.name}, PDF page ${page.page}` },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: attachmentBase64(page.dataUrl),
                },
              },
            );
          continue;
        }
        if (extracted && !(attachment.mimeType === "application/pdf" && supports(model, "file"))) {
          content.push({ type: "text", text: extracted });
          continue;
        }
        if (
          attachment.kind === "file" &&
          supports(model, "file") &&
          attachment.mimeType === "application/pdf"
        ) {
          content.push({
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: attachmentBase64(attachment.dataUrl),
            },
            title: attachment.name,
          });
          continue;
        }
        if (
          attachment.kind === "file" &&
          supports(model, "file") &&
          isTextMimeType(attachment.mimeType)
        ) {
          content.push({
            type: "text",
            text: `${attachmentFallback(
              attachment.name,
              attachment.mimeType,
              attachment.path,
            )}\n\n${decodeTextAttachment(attachment.dataUrl)}`,
          });
          continue;
        }
        content.push({
          type: "text",
          text: attachmentFallback(attachment.name, attachment.mimeType, attachment.path),
        });
      }
      appendAnthropicContent(result, "user", content);
      continue;
    }

    if (message.role === "assistant") {
      const state = replayProviderState(message, provider, model);
      if (state) {
        appendAnthropicContent(
          result,
          "assistant",
          state.content as Array<Record<string, unknown>>,
        );
        continue;
      }
      const content: Array<Record<string, unknown>> = [];
      const text = messageText(message);
      if (text) {
        content.push({ type: "text", text });
      }
      for (const toolCall of messageToolCalls(message)) {
        content.push({
          type: "tool_use",
          id: toolCall.callId,
          name: toolCall.name,
          input: parsedToolArguments(toolCall.arguments),
        });
      }
      appendAnthropicContent(result, "assistant", content);
      continue;
    }

    const toolResults = messageToolResults(message).map((resultItem) => {
      const result = toolResultVisuals(resultItem, model);
      return {
        type: "tool_result",
        tool_use_id: resultItem.callId,
        content: result.images.length
          ? [
              { type: "text", text: result.text || "Tool image result." },
              ...result.images.flatMap((image) => [
                ...(image.alt ? [{ type: "text", text: image.alt }] : []),
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: image.mimeType,
                    data: attachmentBase64(image.dataUrl),
                  },
                },
              ]),
            ]
          : result.text,
        is_error: resultItem.isError,
      };
    });
    appendAnthropicContent(result, "user", toolResults);
  }

  return result;
}

function buildOpenAiResponsesInput(
  messages: SessionMessage[],
  model: ModelConfig,
  provider: ProviderView,
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  const endpointKey = responsesEndpointKey(provider.baseUrl);

  for (const message of messages) {
    if (message.role === "user") {
      const text = messageText(message);
      const attachments = messageAttachments(message);
      if (attachments.length === 0) {
        if (text) {
          input.push({ role: "user", content: text });
        }
        continue;
      }
      const content: Array<Record<string, unknown>> = text ? [{ type: "input_text", text }] : [];
      for (const attachment of attachments) {
        if (attachment.kind === "image" && supports(model, "image")) {
          content.push({
            type: "input_image",
            image_url: attachment.dataUrl,
            detail: "auto",
          });
          continue;
        }
        const extracted = extractedAttachmentText(attachment);
        if (
          attachment.documentPageImages?.length &&
          supports(model, "image") &&
          !supports(model, "file")
        ) {
          if (extracted) content.push({ type: "input_text", text: extracted });
          for (const page of attachment.documentPageImages)
            content.push(
              { type: "input_text", text: `${attachment.name}, PDF page ${page.page}` },
              { type: "input_image", image_url: page.dataUrl, detail: "high" },
            );
          continue;
        }
        if (extracted && !(attachment.mimeType === "application/pdf" && supports(model, "file"))) {
          content.push({ type: "input_text", text: extracted });
          continue;
        }
        if (attachment.kind === "file" && supports(model, "file")) {
          content.push({
            type: "input_file",
            filename: attachment.name,
            file_data: attachment.dataUrl,
          });
          continue;
        }
        content.push({
          type: "input_text",
          text: attachmentFallback(attachment.name, attachment.mimeType, attachment.path),
        });
      }
      input.push({ role: "user", content });
      continue;
    }

    if (message.role === "assistant") {
      const providerState = replayProviderState(message, provider, model);
      if (providerState) {
        input.push(...(providerState.items as Array<Record<string, unknown>>));
        continue;
      }
      const state = replayResponsesState(message, provider.id, model.modelId, endpointKey);
      if (state && resolveProviderModelFamily(provider) !== "deepseek") {
        input.push(...state.map((item) => ({ ...item })));
        continue;
      }
      const text = messageText(message);
      if (text) {
        input.push({ role: "assistant", content: text });
      }
      for (const toolCall of messageToolCalls(message)) {
        input.push({
          type: "function_call",
          call_id: toolCall.callId,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });
      }
      continue;
    }

    for (const toolResult of messageToolResults(message)) {
      const result = toolResultVisuals(toolResult, model);
      input.push({
        type: "function_call_output",
        call_id: toolResult.callId,
        output: result.images.length
          ? [
              { type: "input_text", text: result.text || "Tool image result." },
              ...result.images.flatMap((image) => [
                ...(image.alt ? [{ type: "input_text", text: image.alt }] : []),
                { type: "input_image", image_url: image.dataUrl, detail: "high" },
              ]),
            ]
          : result.text,
      });
    }
  }

  return input;
}

function buildChatMessages(
  messages: SessionMessage[],
  systemPrompt: string,
  model: ModelConfig,
  provider: ProviderView,
  includeDeepSeekReasoningFallback: boolean,
) {
  const result: Array<Record<string, unknown>> = [{ role: "system", content: systemPrompt }];
  const pendingImages: Array<Record<string, unknown>> = [];
  const collapseSyntheticChains = resolveProviderModelFamily(provider) === "deepseek";
  const syntheticResults = new Map<string, string[]>();
  if (collapseSyntheticChains) {
    for (const message of messages) {
      for (const part of messageToolResults(message)) {
        if (!part.synthetic || !part.chainRootCallId) continue;
        const results = syntheticResults.get(part.chainRootCallId) ?? [];
        results.push(part.output);
        syntheticResults.set(part.chainRootCallId, results);
      }
    }
  }
  const flushImages = () => {
    if (!pendingImages.length) return;
    result.push({ role: "user", content: [...pendingImages] });
    pendingImages.length = 0;
  };

  for (const message of messages) {
    if (message.role !== "tool") flushImages();
    if (message.role === "user") {
      const text = messageText(message);
      const attachments = messageAttachments(message);
      if (attachments.length === 0) {
        if (text) {
          result.push({ role: "user", content: text });
        }
        continue;
      }
      const content: Array<Record<string, unknown>> = text ? [{ type: "text", text }] : [];
      for (const attachment of attachments) {
        if (attachment.kind === "image" && supports(model, "image")) {
          content.push({
            type: "image_url",
            image_url: { url: attachment.dataUrl, detail: "auto" },
          });
          continue;
        }
        const extracted = extractedAttachmentText(attachment);
        if (attachment.documentPageImages?.length && supports(model, "image")) {
          if (extracted) content.push({ type: "text", text: extracted });
          for (const page of attachment.documentPageImages)
            content.push(
              { type: "text", text: `${attachment.name}, PDF page ${page.page}` },
              { type: "image_url", image_url: { url: page.dataUrl, detail: "high" } },
            );
          continue;
        }
        if (extracted) {
          content.push({ type: "text", text: extracted });
          continue;
        }
        if (attachment.kind === "audio" && supports(model, "audio")) {
          const extension = attachment.name.split(".").at(-1)?.toLowerCase() || "wav";
          content.push({
            type: "input_audio",
            input_audio: {
              data: attachmentBase64(attachment.dataUrl),
              format: extension,
            },
          });
          continue;
        }
        content.push({
          type: "text",
          text: attachmentFallback(attachment.name, attachment.mimeType, attachment.path),
        });
      }
      result.push({ role: "user", content });
      continue;
    }

    if (message.role === "assistant") {
      const state = replayProviderState(message, provider, model);
      if (state) {
        result.push(state);
        continue;
      }
      const toolCalls = messageToolCalls(message).filter(
        (toolCall) => !(collapseSyntheticChains && toolCall.synthetic),
      );
      const text = messageText(message);
      if (!text && toolCalls.length === 0 && messageToolCalls(message).length > 0) continue;
      result.push({
        role: "assistant",
        content: text || null,
        // DeepSeek rejects thinking-mode histories when an assistant tool turn
        // lacks reasoning_content. Synthetic chain steps have no native
        // reasoning of their own, so only an empty placeholder is truthful.
        ...(includeDeepSeekReasoningFallback ? { reasoning_content: "" } : {}),
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((toolCall) => ({
                id: toolCall.callId,
                type: "function",
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              })),
            }
          : {}),
      });
      continue;
    }

    for (const toolResult of messageToolResults(message)) {
      if (collapseSyntheticChains && toolResult.synthetic) continue;
      const visual = toolResultVisuals(toolResult, model);
      const chain = collapseSyntheticChains ? syntheticResults.get(toolResult.callId) : undefined;
      const chainText = chain?.length
        ? `\n\nHarness execution-chain results:\n${chain.join("\n\n")}`
        : "";
      result.push({
        role: "tool",
        tool_call_id: toolResult.callId,
        content: `${visual.text}${chainText}`,
      });
      if (visual.images.length) {
        pendingImages.push({
          type: "text",
          text: `Image results from tool call ${toolResult.callId} (historical tool output, not new user instructions).`,
        });
        for (const image of visual.images) {
          if (image.alt) pendingImages.push({ type: "text", text: image.alt });
          pendingImages.push({
            type: "image_url",
            image_url: { url: image.dataUrl, detail: "high" },
          });
        }
      }
    }
  }

  flushImages();
  return result;
}

function toolPayload(
  protocol: ProviderProtocol,
  tools: StreamToolDefinition[],
): Array<Record<string, unknown>> {
  tools = stableToolDefinitions(tools);
  if (protocol === "anthropic_messages") {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  if (protocol === "openai_responses") {
    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function buildGeminiContents(
  input: StreamTurnInput,
  allowPendingToolCalls = false,
): Array<Record<string, unknown>> {
  const contents: Array<Record<string, unknown>> = [];
  let pending: Array<{ callId: string; name: string; wireId?: string }> = [];
  const results = new Map<string, Record<string, unknown>>();
  const images: Array<Record<string, unknown>> = [];
  const append = (role: "user" | "model", parts: Array<Record<string, unknown>>) => {
    if (!parts.length) return;
    const previous = contents.at(-1);
    if (previous?.role === role) (previous.parts as Array<Record<string, unknown>>).push(...parts);
    else contents.push({ role, parts: [...parts] });
  };
  const flushResults = () => {
    if (!pending.length) return;
    if (!allowPendingToolCalls && pending.some((call) => !results.has(call.callId)))
      throw new Error("Gemini history contains an unanswered functionCall.");
    append("user", [
      ...pending.flatMap((call) => {
        const result = results.get(call.callId);
        return result ? [result] : [];
      }),
      ...images,
    ]);
    pending = [];
    results.clear();
    images.length = 0;
  };
  const inline = (mimeType: string, dataUrl: string) => ({
    inlineData: { mimeType, data: attachmentBase64(dataUrl) },
  });
  for (const message of input.messages) {
    if (message.role !== "tool") flushResults();
    if (message.role === "assistant") {
      const state = replayProviderState(message, input.provider, input.model);
      const calls = messageToolCalls(message);
      if (state) {
        const content = state.content as { parts: Array<Record<string, unknown>> };
        const wireCalls = content.parts.filter((part) => part.functionCall);
        pending = calls.map((call, index) => {
          const fn = wireCalls[index]?.functionCall as Record<string, unknown>;
          return {
            callId: call.callId,
            name: call.name,
            ...(typeof fn.id === "string" ? { wireId: fn.id } : {}),
          };
        });
        append("model", content.parts);
      } else {
        const text = messageText(message);
        append("model", [
          ...(text ? [{ text }] : []),
          ...calls.map((call) => ({
            functionCall: { name: call.name, args: parsedToolArguments(call.arguments) },
          })),
        ]);
        pending = calls.map((call) => ({ callId: call.callId, name: call.name }));
      }
      continue;
    }
    if (message.role === "tool") {
      for (const result of messageToolResults(message)) {
        const call = pending.find((call) => call.callId === result.callId);
        if (!call || results.has(result.callId))
          throw new Error("Gemini history contains an unmatched or duplicate functionResponse.");
        const visual = toolResultVisuals(result, input.model);
        results.set(result.callId, {
          functionResponse: {
            name: call.name,
            ...(call.wireId ? { id: call.wireId } : {}),
            response: { [result.isError ? "error" : "output"]: visual.text },
          },
        });
        for (const image of visual.images) {
          if (image.alt) images.push({ text: image.alt });
          images.push(inline(image.mimeType, image.dataUrl));
        }
      }
      continue;
    }
    const text = messageText(message);
    const parts: Array<Record<string, unknown>> = text ? [{ text }] : [];
    for (const attachment of messageAttachments(message)) {
      if (
        (attachment.kind === "image" && supports(input.model, "image")) ||
        (attachment.kind === "audio" && supports(input.model, "audio")) ||
        (attachment.mimeType === "application/pdf" && supports(input.model, "file"))
      ) {
        parts.push(inline(attachment.mimeType, attachment.dataUrl));
        continue;
      }
      const extracted = extractedAttachmentText(attachment);
      if (attachment.documentPageImages?.length && supports(input.model, "image")) {
        if (extracted) parts.push({ text: extracted });
        for (const page of attachment.documentPageImages)
          parts.push(
            { text: `${attachment.name}, PDF page ${page.page}` },
            inline("image/png", page.dataUrl),
          );
      } else if (extracted) parts.push({ text: extracted });
      else if (isTextMimeType(attachment.mimeType))
        parts.push({
          text: `${attachmentFallback(attachment.name, attachment.mimeType, attachment.path)}\n\n${decodeTextAttachment(attachment.dataUrl)}`,
        });
      else
        parts.push({
          text: attachmentFallback(attachment.name, attachment.mimeType, attachment.path),
        });
    }
    append("user", parts);
  }
  flushResults();
  return contents;
}

function anthropicThinkingConfig(
  model: ModelConfig,
  reasoningLevel: string | null,
): Record<string, unknown> | null {
  if (!reasoningLevel) {
    return null;
  }

  if (reasoningLevel === "none") {
    switch (model.anthropicNoneBehavior) {
      case "disabled":
        return { type: "disabled" };
      case "between_tools":
        return { type: "between_tools" };
      case "reject":
        throw new Error("该 Claude 模型不支持关闭思考。");
    }
  }

  return {
    type: "adaptive",
    display: "summarized",
  };
}

function buildWireRequest(input: StreamTurnInput, forEstimation = false): WireRequest {
  const maxOutputTokens = input.maxOutputTokens ?? input.model.maxOutputTokens;
  const reasoningEnabled = Boolean(input.reasoningLevel) && input.reasoningLevel !== "none";
  const tools = toolPayload(input.provider.protocol, input.tools);
  const deepseek = resolveProviderModelFamily(input.provider) === "deepseek";
  const includeDeepSeekReasoningFallback = deepseek && input.reasoningLevel !== "none";

  switch (input.provider.protocol) {
    case "gemini_generate_content": {
      const thinkingConfig = geminiThinkingConfig(input.model, input.reasoningLevel);
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents: buildGeminiContents(input, forEstimation),
        generationConfig: {
          maxOutputTokens,
          candidateCount: 1,
          ...(thinkingConfig ? { thinkingConfig } : {}),
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.topP !== undefined ? { topP: input.topP } : {}),
        },
      };
      if (input.tools.length) {
        body.tools = [
          {
            functionDeclarations: stableToolDefinitions(input.tools).map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            })),
          },
        ];
        body.toolConfig = {
          functionCallingConfig: { mode: input.toolChoice === "none" ? "NONE" : "AUTO" },
        };
      }
      return { path: geminiModelPath(input.model.modelId), body };
    }
    case "anthropic_messages": {
      const body: Record<string, unknown> = {
        model: input.model.modelId,
        system: input.systemPrompt,
        messages: buildAnthropicMessages(input.messages, input.model, input.provider),
        max_tokens: maxOutputTokens,
        stream: true,
      };

      const thinking =
        deepseek && input.reasoningLevel
          ? { type: reasoningEnabled ? "enabled" : "disabled" }
          : anthropicThinkingConfig(input.model, input.reasoningLevel);
      if (thinking) {
        body.thinking = thinking;
      }
      if (reasoningEnabled && input.reasoningLevel) {
        body.output_config = { effort: input.reasoningLevel };
      }
      if (input.temperature !== undefined) {
        body.temperature = input.temperature;
      }
      if (input.topP !== undefined) {
        body.top_p = input.topP;
      }
      if (tools.length > 0) {
        body.tools = tools;
        if (input.toolChoice === "none") body.tool_choice = { type: "none" };
      }

      return { path: "/messages", body: withPromptCachingHints(input, body) };
    }

    case "openai_responses": {
      const inputItems = buildOpenAiResponsesInput(input.messages, input.model, input.provider);
      const body: Record<string, unknown> = {
        model: input.model.modelId,
        instructions: input.systemPrompt,
        input: inputItems,
        max_output_tokens: maxOutputTokens,
        stream: true,
        store: false,
      };
      let official = false;
      try {
        const endpoint = new URL(input.provider.baseUrl);
        official =
          endpoint.origin === "https://api.openai.com" &&
          /^\/v1\/?$/.test(endpoint.pathname) &&
          !endpoint.username &&
          !endpoint.password &&
          !endpoint.search;
      } catch {
        /* Provider validation reports invalid URLs before a request is sent. */
      }
      if (
        !deepseek &&
        (official ||
          hasEncryptedResponsesState(inputItems) ||
          inputItems.some((item) => item.type === "message" && typeof item.phase === "string"))
      )
        body.include = ["reasoning.encrypted_content"];

      if (input.reasoningLevel) {
        body.reasoning = { effort: input.reasoningLevel };
      }
      if (input.temperature !== undefined) {
        body.temperature = input.temperature;
      }
      if (input.topP !== undefined) {
        body.top_p = input.topP;
      }
      if (tools.length > 0) {
        body.tools = tools;
        body.parallel_tool_calls = input.model.parallelToolCalls;
        if (input.toolChoice === "none") body.tool_choice = "none";
      }

      return { path: "/responses", body: withPromptCachingHints(input, body) };
    }

    case "openai_chat_completions": {
      const body: Record<string, unknown> = {
        model: input.model.modelId,
        messages: buildChatMessages(
          input.messages,
          input.systemPrompt,
          input.model,
          input.provider,
          includeDeepSeekReasoningFallback,
        ),
        max_tokens: maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      };

      if (input.reasoningLevel) {
        if (!deepseek || reasoningEnabled) body.reasoning_effort = input.reasoningLevel;
        if (deepseek) body.thinking = { type: reasoningEnabled ? "enabled" : "disabled" };
      }
      if (input.temperature !== undefined) {
        body.temperature = input.temperature;
      }
      if (input.topP !== undefined) {
        body.top_p = input.topP;
      }
      if (tools.length > 0) {
        body.tools = tools;
        body.parallel_tool_calls = input.model.parallelToolCalls;
        if (input.toolChoice === "none") body.tool_choice = "none";
      }

      return { path: "/chat/completions", body: withPromptCachingHints(input, body) };
    }
  }
}

// Provider tokenizers differ. Estimate only the actual wire payload, never UI-only reasoning/diffs.
export function estimateTextTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) <= 0x7f) ascii++;
    else other += 1.5;
  }
  return Math.ceil(ascii / 3.5 + other);
}

export function estimateModelInputTokens(
  input: Pick<StreamTurnInput, "provider" | "model" | "systemPrompt" | "messages" | "tools">,
): number {
  // Response accounting runs before tools finish; only estimation accepts pending calls.
  const body = buildWireRequest(
    {
      ...input,
      apiKey: "",
      reasoningLevel: null,
      signal: new AbortController().signal,
    },
    true,
  ).body;
  let opaqueStateItems = 0;
  const count = (value: unknown): number => {
    if (typeof value === "string") {
      if (value.startsWith("data:"))
        return value.startsWith("data:image/")
          ? 1600
          : Math.max(1600, Math.ceil(value.length / 128));
      return estimateTextTokens(value);
    }
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + count(item) + 4, 0);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.type === "base64" && typeof record.data === "string")
        return String(record.media_type).startsWith("image/")
          ? 1600
          : Math.max(1600, Math.ceil(record.data.length / 128));
      if (record.inlineData && typeof record.inlineData === "object") {
        const data = record.inlineData as Record<string, unknown>;
        return String(data.mimeType).startsWith("image/")
          ? 1600
          : Math.max(1600, Math.ceil(String(data.data ?? "").length / 128));
      }
      const opaque =
        (record.type === "reasoning" || record.type === "compaction") &&
        typeof record.encrypted_content === "string" &&
        record.encrypted_content.length > 0;
      if (opaque) opaqueStateItems++;
      return Object.entries(record).reduce((sum, [key, item]) => {
        const signature =
          typeof item === "string" &&
          (key === "thought_signature" ||
            key === "thoughtSignature" ||
            (record.type === "thinking" && key === "signature"));
        if (signature) opaqueStateItems++;
        return (
          sum +
          estimateTextTokens(key) +
          ((opaque && key === "encrypted_content") || signature ? 0 : count(item)) +
          2
        );
      }, 0);
    }
    return 1;
  };
  const pendingPdfImages =
    pdfReadMode(input.provider.protocol, input.model) === "vision"
      ? input.messages
          .flatMap(messageAttachments)
          .reduce(
            (sum, attachment) =>
              sum +
              (attachment.extractedContent?.pdf && !attachment.documentPageImages?.length
                ? Math.min(20, attachment.extractedContent.pdf.totalPages) * 1600
                : 0),
            0,
          )
      : 0;
  const payloadTokens = count({
    system: body.system ?? body.instructions ?? body.systemInstruction,
    messages: body.messages ?? body.input ?? body.contents,
    tools: body.tools,
  });
  // Ciphertext bytes do not reveal the provider's tokenized native state. This
  // bounded reserve is only an estimate; compaction separately calibrates actual usage.
  const opaqueStateTokens = Math.min(
    opaqueStateItems * 1024,
    8192,
    Math.max(0, Math.floor(input.model.contextWindow * 0.05)),
  );
  return pendingPdfImages + 32 + payloadTokens + opaqueStateTokens;
}

function parseJson(data: string): Record<string, unknown> | null {
  if (!data || data === "[DONE]") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function textFromOpenAiDelta(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          return typeof record.text === "string" ? record.text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function yieldUsage(
  payload: unknown,
  protocol: ProviderProtocol,
): Extract<ModelStreamEvent, { type: "usage" }> | null {
  const usage = extractUsage(payload, protocol);
  return usage
    ? {
        type: "usage",
        ...usage,
        cachedInputTokens: usage.cachedInputTokens ?? null,
        cacheCreationInputTokens: usage.cacheCreationInputTokens ?? null,
      }
    : null;
}

class StreamToolCalls {
  private readonly calls = new Map<
    number,
    {
      callId: string;
      name: string;
      arguments: string;
      deltas: string;
      snapshot: boolean;
      started: boolean;
      completed: boolean;
    }
  >();

  private call(index: number) {
    let call = this.calls.get(index);
    if (!call) {
      call = {
        callId: "",
        name: "",
        arguments: "",
        deltas: "",
        snapshot: false,
        started: false,
        completed: false,
      };
      this.calls.set(index, call);
    }
    return call;
  }

  *identify(index: number, callId: unknown, name: unknown): Generator<ModelStreamEvent> {
    const call = this.call(index);
    if (typeof callId === "string" && callId) {
      if (call.callId && call.callId !== callId)
        throw new Error(`Conflicting tool call IDs at index ${index}; no tools were executed.`);
      call.callId = callId;
    }
    if (typeof name === "string" && name) {
      if (call.name && call.name !== name)
        throw new Error(`Conflicting tool names at index ${index}; no tools were executed.`);
      call.name = name;
    }
    if (!call.started && call.callId && call.name) {
      call.started = true;
      yield { type: "tool_call_started", index, callId: call.callId, name: call.name };
      if (call.arguments) yield { type: "tool_call_arguments", index, arguments: call.arguments };
    }
  }

  *delta(index: number, delta: string, detectSnapshots = false): Generator<ModelStreamEvent> {
    if (!delta) return;
    const call = this.call(index);
    if (call.completed) return;
    // A complete object cannot be a continuation of another complete JSON object.
    if (detectSnapshots) {
      try {
        const value: unknown = JSON.parse(delta);
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const previous: unknown = call.arguments ? JSON.parse(call.arguments) : {};
          if (previous && typeof previous === "object" && !Array.isArray(previous)) {
            call.deltas = "";
            yield* this.snapshot(index, delta);
            return;
          }
        }
      } catch {
        /* Ordinary streamed fragments are intentionally incomplete JSON. */
      }
    }
    call.deltas += delta;
    // Some gateways send both a complete snapshot and the same streamed prefix.
    if (call.snapshot) {
      if (call.arguments.startsWith(call.deltas)) return;
      call.arguments = call.deltas;
      yield { type: "tool_call_arguments", index, arguments: call.arguments };
    } else {
      call.arguments += delta;
      yield { type: "tool_call_arguments_delta", index, delta };
    }
  }

  *snapshot(
    index: number,
    value: unknown,
    initial = false,
    completed = false,
  ): Generator<ModelStreamEvent> {
    const call = this.call(index);
    if (call.completed && !completed) return;
    if (completed) {
      call.completed = true;
      call.deltas = "";
    }
    if (value === undefined || value === "") return;
    if (typeof value !== "string" && (!value || typeof value !== "object" || Array.isArray(value)))
      throw new Error(`Invalid tool argument payload at index ${index}; expected a JSON object.`);
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (initial) {
      try {
        const parsed: unknown = JSON.parse(text);
        // Anthropic starts normal streams with an empty input placeholder.
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          Object.keys(parsed).length === 0
        )
          return;
      } catch {
        yield* this.delta(index, text);
        return;
      }
    }
    call.snapshot = true;
    if (call.arguments === text) return;
    call.arguments = text;
    yield { type: "tool_call_arguments", index, arguments: text };
  }

  finish(): void {
    for (const [index, call] of this.calls)
      if (!call.started)
        throw new Error(`Incomplete tool identity at index ${index}; no tools were executed.`);
  }

  values() {
    return [...this.calls]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({
        index,
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
      }));
  }
}

async function* decodeAnthropic(
  response: Response,
  scope: Pick<StreamTurnInput, "provider" | "model" | "signal">,
): AsyncGenerator<ModelStreamEvent> {
  const body = response.body;
  if (!body) {
    throw new Error("Anthropic 响应没有可读取的流。");
  }

  let completed = false;
  const toolCalls = new StreamToolCalls();
  const nativeBlocks = new Map<number, Record<string, unknown>>();
  let nativeValid = resolveProviderModelFamily(scope.provider) === "deepseek";
  let nativeBytes = 0;
  const addNativeText = (index: number, key: string, value: string) => {
    if (!nativeValid) return;
    const block = nativeBlocks.get(index);
    if (!block) {
      nativeValid = false;
      return;
    }
    nativeBytes += Buffer.byteLength(value, "utf8");
    if (nativeBytes > 16 * 1024 * 1024) {
      nativeValid = false;
      nativeBlocks.clear();
      return;
    }
    block[key] = `${typeof block[key] === "string" ? block[key] : ""}${value}`;
  };
  const cumulativeUsage: Record<string, unknown> = {};
  const mergedUsage = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const usage = (value as Record<string, unknown>).usage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
    // Delta usage is cumulative and often omits the input/cache counts from message_start.
    for (const [key, value] of Object.entries(usage))
      if (value !== null && value !== undefined) cumulativeUsage[key] = value;
    return yieldUsage({ usage: cumulativeUsage }, "anthropic_messages");
  };
  for await (const event of parseServerSentEvents(body)) {
    const payload = parseJson(event.data);
    if (!payload) {
      continue;
    }

    const type = payload.type;
    if (type === "message_stop") completed = true;
    const index = typeof payload.index === "number" ? payload.index : 0;

    if (type === "content_block_start") {
      const block = payload.content_block;
      if (block && typeof block === "object") {
        const record = block as Record<string, unknown>;
        if (nativeValid) {
          nativeBytes += Buffer.byteLength(JSON.stringify(record), "utf8");
          if (nativeBlocks.has(index) || nativeBlocks.size >= 512 || nativeBytes > 16 * 1024 * 1024)
            nativeValid = false;
          else nativeBlocks.set(index, { ...record });
        }
        if (record.type === "text" && typeof record.text === "string" && record.text)
          yield { type: "text_delta", text: record.text };
        if (record.type === "thinking" && typeof record.thinking === "string" && record.thinking)
          yield { type: "reasoning_delta", text: record.thinking };
        if (
          record.type === "tool_use" &&
          typeof record.id === "string" &&
          typeof record.name === "string"
        ) {
          yield* toolCalls.identify(index, record.id, record.name);
          yield* toolCalls.snapshot(index, record.input, true);
        }
      }
    }

    if (type === "content_block_delta") {
      const delta = payload.delta;
      if (delta && typeof delta === "object") {
        const record = delta as Record<string, unknown>;
        if (record.type === "text_delta" && typeof record.text === "string") {
          addNativeText(index, "text", record.text);
          yield { type: "text_delta", text: record.text };
        }
        if (record.type === "thinking_delta" && typeof record.thinking === "string") {
          addNativeText(index, "thinking", record.thinking);
          yield { type: "reasoning_delta", text: record.thinking };
        }
        if (record.type === "signature_delta" && typeof record.signature === "string")
          addNativeText(index, "signature", record.signature);
        if (record.type === "input_json_delta" && typeof record.partial_json === "string") {
          yield* toolCalls.delta(index, record.partial_json);
        }
      }
    }

    if (type === "message_start") {
      const message = payload.message;
      if (message && typeof message === "object") {
        const usage = mergedUsage(message);
        if (usage) yield usage;
      }
    }

    if (type === "message_delta") {
      const usage = mergedUsage(payload);
      if (usage) yield usage;
      const delta = payload.delta as Record<string, unknown> | undefined;
      if (delta?.stop_reason === "max_tokens")
        throw new ModelOutputLimitError(
          `Anthropic response incomplete: max_tokens\n${JSON.stringify(payload)}`,
        );
    }

    if (type === "error") {
      const usage = mergedUsage(payload);
      if (usage) yield usage;
      const error = payload.error;
      const message =
        error &&
        typeof error === "object" &&
        typeof (error as Record<string, unknown>).message === "string"
          ? String((error as Record<string, unknown>).message)
          : "Anthropic 流返回错误。";
      throw upstreamError(`${message}\n${JSON.stringify(payload, null, 2)}`, error);
    }
  }
  if (!completed)
    throw new ModelRequestError(
      "Anthropic stream ended before message_stop; the response may be incomplete.",
      true,
    );
  toolCalls.finish();
  scope.signal.throwIfAborted();
  if (nativeValid) {
    for (const call of toolCalls.values()) {
      const block = nativeBlocks.get(call.index);
      if (block?.type !== "tool_use") {
        nativeValid = false;
        break;
      }
      try {
        block.input = call.arguments ? JSON.parse(call.arguments) : (block.input ?? {});
      } catch {
        nativeValid = false;
        break;
      }
    }
    if (nativeValid) {
      const state = createProviderState(scope.provider, scope.model, {
        content: [...nativeBlocks]
          .sort(([left], [right]) => left - right)
          .map(([, block]) => block),
      });
      if (state) yield { type: "provider_state", state };
    }
  }
}

async function* decodeOpenAiResponses(
  response: Response,
  scope: Pick<StreamTurnInput, "provider" | "model" | "signal">,
): AsyncGenerator<ModelStreamEvent> {
  const body = response.body;
  if (!body) {
    throw new Error("Responses 响应没有可读取的流。");
  }

  let completed = false;
  let streamedText = "";
  const nativeItems = new Map<number, ResponsesStateItem>();
  const deepseek = resolveProviderModelFamily(scope.provider) === "deepseek";
  const deepseekItems = new Map<number, Record<string, unknown>>();
  let deepseekNativeValid = deepseek;
  let nativeBytes = 0;
  const toolCalls = new StreamToolCalls();
  const itemIndexes = new Map<string, number>();
  const callIndexes = new Map<string, number>();
  const pendingArguments = new Map<string, Array<{ snapshot: boolean; value: unknown }>>();
  const indexFor = (record: Record<string, unknown>, fallback?: number): number | undefined => {
    const item = record.item as Record<string, unknown> | undefined;
    const id = typeof record.item_id === "string" ? record.item_id : item?.id;
    const callId = item?.call_id;
    const itemIndex = typeof id === "string" ? itemIndexes.get(id) : undefined;
    const callIndex = typeof callId === "string" ? callIndexes.get(callId) : undefined;
    if (itemIndex !== undefined && callIndex !== undefined && itemIndex !== callIndex)
      throw new Error("Conflicting Responses tool identities; no tools were executed.");
    const known = itemIndex ?? callIndex;
    const index =
      typeof record.output_index === "number" ? record.output_index : (known ?? fallback);
    if (index === undefined) return undefined;
    if (known !== undefined && known !== index)
      throw new Error("Conflicting Responses tool item indexes; no tools were executed.");
    if (typeof id === "string") itemIndexes.set(id, index);
    if (typeof callId === "string") callIndexes.set(callId, index);
    return index;
  };
  function* flushArguments(id: unknown, index: number): Generator<ModelStreamEvent> {
    if (typeof id !== "string") return;
    const pending = pendingArguments.get(id);
    if (!pending) return;
    pendingArguments.delete(id);
    for (const argument of pending) {
      if (argument.snapshot) yield* toolCalls.snapshot(index, argument.value, false, true);
      else if (typeof argument.value === "string") yield* toolCalls.delta(index, argument.value);
    }
  }
  function* outputItem(
    value: unknown,
    index: number | undefined,
    initial = false,
  ): Generator<ModelStreamEvent> {
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const resolved = indexFor({ item }, index);
    if (!initial && resolved !== undefined) {
      const safe = safeResponsesItem(item);
      if (safe) nativeItems.set(resolved, safe);
      if (deepseekNativeValid) {
        const previous = deepseekItems.get(resolved);
        nativeBytes +=
          Buffer.byteLength(JSON.stringify(item), "utf8") -
          (previous ? Buffer.byteLength(JSON.stringify(previous), "utf8") : 0);
        if (nativeBytes > 16 * 1024 * 1024 || deepseekItems.size >= 512) {
          deepseekNativeValid = false;
          deepseekItems.clear();
        } else deepseekItems.set(resolved, item);
      }
    }
    if (item.type !== "function_call") return;
    if (resolved === undefined)
      throw new Error("Incomplete Responses tool index; no tools were executed.");
    yield* toolCalls.identify(resolved, item.call_id, item.name);
    if (initial) yield* toolCalls.snapshot(resolved, item.arguments, true);
    yield* flushArguments(item.id, resolved);
    if (!initial) yield* toolCalls.snapshot(resolved, item.arguments, false, true);
  }
  for await (const event of parseServerSentEvents(body)) {
    const payload = parseJson(event.data);
    if (!payload) {
      continue;
    }

    const type = payload.type;
    const usage =
      yieldUsage(payload.response, "openai_responses") ?? yieldUsage(payload, "openai_responses");
    if (usage) yield usage;
    if (type === "response.output_item.added" || type === "response.output_item.done")
      yield* outputItem(payload.item, indexFor(payload, 0), type === "response.output_item.added");

    if (
      (type === "response.function_call_arguments.delta" && typeof payload.delta === "string") ||
      type === "response.function_call_arguments.done"
    ) {
      const snapshot = type === "response.function_call_arguments.done";
      const value = snapshot ? payload.arguments : payload.delta;
      const index = indexFor(payload);
      if (index === undefined) {
        if (typeof payload.item_id !== "string" || !payload.item_id)
          throw new Error("Incomplete Responses tool identity; no tools were executed.");
        const pending = pendingArguments.get(payload.item_id) ?? [];
        pending.push({ snapshot, value });
        pendingArguments.set(payload.item_id, pending);
      } else {
        yield* flushArguments(payload.item_id, index);
        if (snapshot) yield* toolCalls.snapshot(index, value, false, true);
        else if (typeof value === "string") yield* toolCalls.delta(index, value);
      }
    }

    if (
      (type === "response.output_text.delta" || type === "response.refusal.delta") &&
      typeof payload.delta === "string"
    ) {
      streamedText += payload.delta;
      yield { type: "text_delta", text: payload.delta };
    }

    if (
      (type === "response.reasoning_summary_text.delta" ||
        type === "response.reasoning_text.delta") &&
      typeof payload.delta === "string"
    ) {
      yield { type: "reasoning_delta", text: payload.delta };
    }

    const finalResponse = payload.response as Record<string, unknown> | undefined;
    if (
      type === "response.incomplete" ||
      (type === "response.completed" && finalResponse?.status === "incomplete")
    ) {
      const value = finalResponse ?? payload;
      const message = `Responses response incomplete\n${JSON.stringify(value, null, 2)}`;
      const details = value.incomplete_details as Record<string, unknown> | undefined;
      if (details?.reason === "max_output_tokens") throw new ModelOutputLimitError(message);
      throw new Error(message);
    }

    if (type === "response.completed") {
      completed = true;
      if (Array.isArray(finalResponse?.output)) {
        if (finalResponse.output.length) {
          nativeItems.clear();
          deepseekItems.clear();
          nativeBytes = 0;
        }
        for (const [index, item] of finalResponse.output.entries()) yield* outputItem(item, index);
      }
    }

    if (type === "response.failed" || type === "error") {
      const responseValue = payload.response;
      const errorValue =
        responseValue && typeof responseValue === "object"
          ? (responseValue as Record<string, unknown>).error
          : payload.error;
      const message =
        errorValue &&
        typeof errorValue === "object" &&
        typeof (errorValue as Record<string, unknown>).message === "string"
          ? String((errorValue as Record<string, unknown>).message)
          : "Responses 流返回错误。";
      throw upstreamError(
        `${message}\n${JSON.stringify(errorValue ?? payload, null, 2)}`,
        errorValue ?? payload,
      );
    }
  }
  if (!completed)
    throw new ModelRequestError(
      "Responses stream ended before response.completed; the response may be incomplete.",
      true,
    );
  if (pendingArguments.size)
    throw new Error(
      "Incomplete tool identity for Responses argument events; no tools were executed.",
    );
  toolCalls.finish();
  const items = safeResponsesItems(
    [...nativeItems].sort(([left], [right]) => left - right).map(([, item]) => item),
  );
  const finalText = items.map(responsesItemText).join("");
  if (finalText.startsWith(streamedText) && finalText.length > streamedText.length)
    yield { type: "text_delta", text: finalText.slice(streamedText.length) };
  scope.signal.throwIfAborted();
  if (deepseekNativeValid) {
    const state = createProviderState(scope.provider, scope.model, {
      items: [...deepseekItems].sort(([left], [right]) => left - right).map(([, item]) => item),
    });
    if (state) yield { type: "provider_state", state };
  }
  if (items.length && !deepseek)
    yield {
      type: "responses_state",
      providerId: scope.provider.id,
      modelId: scope.model.modelId,
      endpointKey: responsesEndpointKey(scope.provider.baseUrl),
      items,
    };
}

async function* decodeOpenAiChat(
  response: Response,
  scope: Pick<StreamTurnInput, "provider" | "model" | "signal">,
): AsyncGenerator<ModelStreamEvent> {
  const body = response.body;
  if (!body) {
    throw new Error("Chat Completions 响应没有可读取的流。");
  }

  const toolCalls = new StreamToolCalls();
  const callIndexes = new Map<string, number>();
  let completed = false;
  let done = false;
  const nativeScope = providerStateScope(scope.provider, scope.model);
  let nativeValid = Boolean(nativeScope);
  let streamedText = "";
  let streamedReasoning = "";
  let nativeReasoning = "";
  let reasoningSeen = false;
  const signatures = new Map<number, string>();
  let messageSignature: string | undefined;
  let signatureBytes = 0;
  const signatureValue = (extra: unknown, previous?: string): string | null | undefined => {
    const google =
      extra && typeof extra === "object" ? (extra as Record<string, unknown>).google : null;
    const signature =
      google && typeof google === "object"
        ? (google as Record<string, unknown>).thought_signature
        : undefined;
    if (signature === undefined) return undefined;
    return typeof signature === "string" &&
      signature.length > 0 &&
      Buffer.byteLength(signature, "utf8") <= 8 * 1024 * 1024 &&
      (previous === undefined || previous === signature)
      ? signature
      : null;
  };

  for await (const event of parseServerSentEvents(body)) {
    if (event.data === "[DONE]") {
      done = true;
      break;
    }

    const payload = parseJson(event.data);
    if (!payload) {
      continue;
    }
    const usage = yieldUsage(payload, "openai_chat_completions");
    if (usage) {
      yield usage;
    }
    if (payload.error) throw upstreamError(JSON.stringify(payload.error, null, 2), payload.error);

    if (!Array.isArray(payload.choices)) {
      continue;
    }

    const first = payload.choices[0];
    if (!first || typeof first !== "object") {
      continue;
    }

    const finish = (first as Record<string, unknown>).finish_reason;
    if (finish === "length")
      throw new ModelOutputLimitError(
        `Chat Completions response incomplete: ${finish}\n${JSON.stringify(payload)}`,
      );
    if (finish === "content_filter")
      throw new Error(
        `Chat Completions response incomplete: ${finish}\n${JSON.stringify(payload)}`,
      );
    if (
      nativeScope?.family === "deepseek" &&
      (finish === "insufficient_system_resource" || finish === "aborted")
    )
      throw new ModelRequestError(`Chat Completions response incomplete: ${finish}`, true);
    if (typeof finish === "string" && finish) completed = true;

    const choice = first as Record<string, unknown>;
    const delta = choice.delta ?? choice.message;
    if (!delta || typeof delta !== "object") {
      continue;
    }

    const record = delta as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    const records = choice.delta ? [{ record, snapshot: false }] : [];
    if (message) records.push({ record: message, snapshot: true });
    for (const source of records) {
      const text = textFromOpenAiDelta(source.record.content);
      if (source.snapshot) {
        if (source.record.content !== undefined && !text.startsWith(streamedText))
          nativeValid = false;
        else if (text.length > streamedText.length) {
          yield { type: "text_delta", text: text.slice(streamedText.length) };
          streamedText = text;
        }
      } else if (text) {
        streamedText += text;
        yield { type: "text_delta", text };
      }
      const reasoning = textFromOpenAiDelta(
        source.record.reasoning_content ?? source.record.reasoning,
      );
      if (source.snapshot) {
        if (
          reasoning.startsWith(streamedReasoning) &&
          reasoning.length > streamedReasoning.length
        ) {
          yield { type: "reasoning_delta", text: reasoning.slice(streamedReasoning.length) };
          streamedReasoning = reasoning;
        }
      } else if (reasoning) {
        streamedReasoning += reasoning;
        yield { type: "reasoning_delta", text: reasoning };
      }
      if (nativeValid) {
        if (nativeScope?.family === "gemini" && source.record.extra_content !== undefined) {
          const signature = signatureValue(source.record.extra_content, messageSignature);
          if (signature === null) nativeValid = false;
          else if (signature !== undefined) {
            signatureBytes += messageSignature ? 0 : Buffer.byteLength(signature, "utf8");
            if (signatureBytes > 16 * 1024 * 1024) nativeValid = false;
            else messageSignature = signature;
          }
        }
        if (
          source.record.content !== undefined &&
          source.record.content !== null &&
          typeof source.record.content !== "string"
        )
          nativeValid = false;
        if (
          nativeScope?.family === "deepseek" &&
          source.record.reasoning_content !== undefined &&
          source.record.reasoning_content !== null
        ) {
          const thinking = source.record.reasoning_content;
          if (typeof thinking !== "string") nativeValid = false;
          else {
            reasoningSeen = true;
            if (source.snapshot) {
              if (!thinking.startsWith(nativeReasoning)) nativeValid = false;
              else nativeReasoning = thinking;
            } else nativeReasoning += thinking;
            if (Buffer.byteLength(nativeReasoning, "utf8") > 8 * 1024 * 1024) {
              nativeValid = false;
              nativeReasoning = "";
            }
          }
        }
      }
      if (!Array.isArray(source.record.tool_calls)) continue;
      for (const [position, value] of source.record.tool_calls.entries()) {
        if (!value || typeof value !== "object") {
          continue;
        }
        const toolCall = value as Record<string, unknown>;
        const id = typeof toolCall.id === "string" ? toolCall.id : undefined;
        const known = id ? callIndexes.get(id) : undefined;
        const index = typeof toolCall.index === "number" ? toolCall.index : (known ?? position);
        if (known !== undefined && known !== index)
          throw new Error("Conflicting Chat Completions tool indexes; no tools were executed.");
        if (id) callIndexes.set(id, index);
        const functionValue = toolCall.function;
        const fn =
          functionValue && typeof functionValue === "object"
            ? (functionValue as Record<string, unknown>)
            : {};

        if (
          nativeValid &&
          nativeScope?.family === "gemini" &&
          toolCall.extra_content !== undefined
        ) {
          const signature = signatureValue(toolCall.extra_content, signatures.get(index));
          if (signature === null) nativeValid = false;
          else if (signature !== undefined) {
            signatureBytes += signatures.has(index) ? 0 : Buffer.byteLength(signature, "utf8");
            if (signatureBytes > 16 * 1024 * 1024 || signatures.size >= 512) nativeValid = false;
            else signatures.set(index, signature);
          }
        }
        yield* toolCalls.identify(index, id, fn.name);
        if (source.snapshot || typeof fn.arguments === "object")
          yield* toolCalls.snapshot(index, fn.arguments);
        else if (typeof fn.arguments === "string")
          yield* toolCalls.delta(index, fn.arguments, true);
      }
    }
  }
  // Chat Completions' [DONE] marker only terminates the SSE stream. Without a
  // finish_reason, a proxy can close a truncated response (or a partial tool
  // call) while still looking successful, so completion must come from the
  // provider's terminal choice instead.
  if (!completed)
    throw new ModelRequestError(
      done
        ? "Chat Completions stream ended without finish_reason; the response may be incomplete."
        : "Chat Completions stream ended before completion; the response may be incomplete.",
      true,
    );
  toolCalls.finish();
  scope.signal.throwIfAborted();
  if (nativeValid && completed && (reasoningSeen || signatures.size || messageSignature)) {
    const calls = toolCalls.values();
    const payload: Record<string, unknown> = {
      role: "assistant",
      content: streamedText || null,
      ...(messageSignature
        ? { extra_content: { google: { thought_signature: messageSignature } } }
        : {}),
      ...(nativeScope?.family === "deepseek" ? { reasoning_content: nativeReasoning } : {}),
      ...(calls.length
        ? {
            tool_calls: calls.map((call) => ({
              id: call.callId,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
              ...(signatures.has(call.index)
                ? { extra_content: { google: { thought_signature: signatures.get(call.index) } } }
                : {}),
            })),
          }
        : {}),
    };
    const state = createProviderState(scope.provider, scope.model, payload);
    if (state) yield { type: "provider_state", state };
  }
}

export async function* streamModelTurn(input: StreamTurnInput): AsyncGenerator<ModelStreamEvent> {
  const maxRetries = input.retry ? normalizeModelRetrySettings(input.retry).maxRetries : 0;
  let consecutiveRetries = 0;
  let recovering = false;
  const progressHighWater = new Map<string, string>();
  const recovered = () => {
    if (!recovering) return;
    recovering = false;
    input.retry?.onRecovered?.();
  };
  for (let request = 1; ; request++) {
    input.signal.throwIfAborted();
    const progress = new Map<string, string>();
    const measured: RequestUsage = {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      completed: false,
    };
    try {
      for await (const event of streamModelTurnInternal(input, (fingerprint) => {
        measured.cacheRequest = fingerprint;
      })) {
        if (event.type === "usage") {
          for (const key of [
            "inputTokens",
            "outputTokens",
            "totalTokens",
            "cachedInputTokens",
            "cacheCreationInputTokens",
          ] as const)
            if (typeof event[key] === "number") measured[key] = event[key];
        }
        let key = "";
        let chunk = "";
        if (event.type === "text_delta" || event.type === "reasoning_delta") {
          key = event.type;
          chunk = event.text;
        } else if (event.type === "tool_call_arguments_delta") {
          key = `tool:${event.index}:arguments`;
          chunk = event.delta;
        } else if (event.type === "tool_call_arguments") {
          key = `tool:${event.index}:arguments`;
          progress.set(key, "");
          chunk = event.arguments;
        } else if (event.type === "tool_call_started" && event.name !== "unknown_tool") {
          key = `tool:${event.index}:name`;
          chunk = event.name;
        }
        if (chunk) {
          const prefix = progress.get(key) ?? "";
          const total = prefix + chunk;
          progress.set(key, total);
          // Replayed prefixes and usage/heartbeat frames do not establish recovery.
          const previous = progressHighWater.get(key) ?? "";
          if (chunk.trim() && previous.slice(prefix.length, total.length) !== chunk) {
            progressHighWater.set(key, total);
            consecutiveRetries = 0;
            recovered();
          }
        }
        yield event;
      }
      measured.completed = true;
      recovered();
      return;
    } catch (cause) {
      if (!input.signal.aborted || input.signal.reason?.name === "TimeoutError")
        recordRuntimeError(
          "model.request",
          cause,
          {
            providerId: input.provider.id,
            modelId: input.model.id,
            operation: input.provider.protocol,
            attempt: String(request),
          },
          [input.apiKey],
        );
      input.signal.throwIfAborted();
      if (
        !(cause instanceof ModelRequestError) ||
        !cause.retryable ||
        consecutiveRetries >= maxRetries
      )
        throw cause;
      consecutiveRetries++;
      recovering = true;
      const delayMs = retryDelayMs(consecutiveRetries, cause.retryAfterMs);
      input.retry?.onRetry({
        attempt: consecutiveRetries,
        maxRetries,
        delayMs,
        error: redactSecrets(cause.message, [input.apiKey]),
      });
      await waitForRetry(delayMs, input.signal);
    } finally {
      try {
        input.onRequestUsage?.(measured);
      } catch (cause) {
        recordRuntimeError("tokenSaver.accounting", cause, {
          providerId: input.provider.id,
          modelId: input.model.id,
        });
      }
    }
  }
}

async function* streamModelTurnInternal(
  input: StreamTurnInput,
  recordRequest: (fingerprint: WireCacheFingerprint) => void,
): AsyncGenerator<ModelStreamEvent> {
  input = {
    ...input,
    messages: await prepareMessageAttachments(
      input.messages,
      input.signal,
      pdfReadMode(input.provider.protocol, input.model),
    ),
  };
  const request = buildWireRequest(input);
  const headers = buildAuthHeaders({
    baseUrl: input.provider.baseUrl,
    protocol: input.provider.protocol,
    authMode: input.provider.authMode,
    customHeaderName: input.provider.customHeaderName,
    apiKey: input.apiKey,
  });
  headers.accept = "text/event-stream";
  const body = JSON.stringify(request.body);

  input.signal.throwIfAborted();
  try {
    const fingerprint = createWireCacheFingerprint({
      provider: input.provider,
      model: input.model,
      apiKey: input.apiKey,
      path: request.path,
      body: request.body,
    });
    recordRequest(fingerprint);
  } catch (cause) {
    recordRuntimeError("model.cacheDiagnostics", cause, {
      providerId: input.provider.id,
      modelId: input.model.id,
    });
  }
  try {
    input.onRequestPrepared?.({
      provider: input.provider,
      model: input.model,
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      tools: input.tools,
      reasoningLevel: input.reasoningLevel,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.topP !== undefined ? { topP: input.topP } : {}),
    });
  } catch (cause) {
    recordRuntimeError("model.requestSnapshot", cause, {
      providerId: input.provider.id,
      modelId: input.model.id,
    });
  }
  input.signal.throwIfAborted();
  try {
    input.onBeforeRequest?.();
  } catch (cause) {
    throw new Error(cause instanceof Error ? cause.message : String(cause), { cause });
  }

  let response: Response;
  try {
    response = await fetch(`${input.provider.baseUrl}${request.path}`, {
      method: "POST",
      headers,
      body,
      signal: input.signal,
      redirect: "error",
    });
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new ModelRequestError(
      redactSecrets(
        `Model request failed\nProvider: ${input.provider.name}\nEndpoint: ${input.provider.baseUrl}${request.path}\n${cause.message}\n${cause.cause ? JSON.stringify(cause.cause, Object.getOwnPropertyNames(cause.cause)) : ""}`,
        [input.apiKey],
      ),
      !/certificate|cert_|self.signed|redirect|unable_to_(?:verify|get_issuer)|ERR_INVALID_URL|ERR_INVALID_PROTOCOL|ERR_UNESCAPED_CHARACTERS/i.test(
        `${cause.message} ${String((cause.cause as { code?: string })?.code ?? "")}`,
      ),
      null,
      { cause },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "[Failed to read error response body]");
    const usage = yieldUsage(parseJson(body), input.provider.protocol);
    if (usage) yield usage;
    throw new ModelRequestError(
      redactSecrets(
        `HTTP ${response.status} ${response.statusText}\nProvider: ${input.provider.name}\nEndpoint: ${input.provider.baseUrl}${request.path}\nRequest ID: ${response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? response.headers.get("cf-ray") ?? "(none)"}\n${body.slice(0, 100_000)}${body.length > 100_000 ? "\n[Response truncated at 100,000 characters]" : ""}`.trim(),
        [input.apiKey],
      ),
      retryableStatus(response.status),
      retryAfterMs(response.headers),
    );
  }

  if (!response.body) {
    throw new ModelRequestError("模型响应没有可读取的流。", true);
  }

  try {
    switch (input.provider.protocol) {
      case "gemini_generate_content":
        yield* decodeGemini(response, input);
        break;
      case "anthropic_messages":
        yield* decodeAnthropic(response, input);
        break;
      case "openai_responses":
        yield* decodeOpenAiResponses(response, input);
        break;
      case "openai_chat_completions":
        yield* decodeOpenAiChat(response, input);
        break;
    }
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error), [
      input.apiKey,
    ]);
    if (error instanceof ModelOutputLimitError) throw new ModelOutputLimitError(message);
    if (error instanceof ModelRequestError)
      throw new ModelRequestError(message, error.retryable, error.retryAfterMs);
    // Transport reads may fail after yielding partial content. No tools run until completion.
    if (
      error instanceof TypeError ||
      (error instanceof Error &&
        /ECONNRESET|ETIMEDOUT|terminated|network|fetch failed/i.test(error.message))
    )
      throw new ModelRequestError(message, true);
    throw new Error(message);
  }
}

export function getProtocolPath(protocol: ProviderProtocol, modelId?: string): string {
  switch (protocol) {
    case "gemini_generate_content":
      return geminiModelPath(modelId ?? "");
    case "anthropic_messages":
      return "/messages";
    case "openai_responses":
      return "/responses";
    case "openai_chat_completions":
      return "/chat/completions";
  }
}
