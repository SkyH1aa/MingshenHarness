import { randomUUID } from "node:crypto";
import { geminiRecord, safeGeminiPart } from "./gemini-format";
import { ModelOutputLimitError, ModelRequestError } from "./model-request-error";
import type { ModelStreamEvent, StreamTurnInput } from "./model-stream";
import { createProviderState } from "./provider-native-state";
import { extractUsage } from "./provider-service";
import { parseServerSentEvents } from "./sse";

export async function* decodeGemini(
  response: Response,
  scope: Pick<StreamTurnInput, "provider" | "model" | "signal">,
): AsyncGenerator<ModelStreamEvent> {
  if (!response.body) throw new ModelRequestError("Gemini response has no readable stream.", true);
  const parts: Array<Record<string, unknown>> = [];
  const callIds: string[] = [];
  const wireIds = new Set<string>();
  let completed = false;
  let bytes = 0;
  for await (const event of parseServerSentEvents(response.body)) {
    scope.signal.throwIfAborted();
    let payload: Record<string, unknown> | null;
    try {
      payload = geminiRecord(JSON.parse(event.data));
    } catch {
      throw new Error("Invalid Gemini stream JSON; no tools were executed.");
    }
    if (!payload) throw new Error("Invalid Gemini stream payload.");
    const usage = extractUsage(payload, "gemini_generate_content");
    if (usage)
      yield {
        type: "usage",
        ...usage,
        cachedInputTokens: usage.cachedInputTokens ?? null,
        cacheCreationInputTokens: usage.cacheCreationInputTokens ?? null,
      };
    if (payload.error) {
      const error = geminiRecord(payload.error);
      const status = Number(error?.code);
      throw new ModelRequestError(
        `Gemini API error: ${JSON.stringify(payload.error)}`,
        [408, 429].includes(status) || status >= 500,
      );
    }
    const feedback = geminiRecord(payload.promptFeedback);
    if (feedback?.blockReason && feedback.blockReason !== "BLOCK_REASON_UNSPECIFIED")
      throw new Error(`Gemini prompt blocked: ${String(feedback.blockReason)}`);
    if (payload.candidates === undefined) continue;
    if (!Array.isArray(payload.candidates) || payload.candidates.length > 1)
      throw new Error("Gemini stream must contain at most one candidate.");
    const candidate = geminiRecord(payload.candidates[0]);
    if (!candidate) continue;
    if (candidate.index !== undefined && candidate.index !== 0)
      throw new Error("Unexpected Gemini candidate index.");
    const finish = candidate.finishReason;
    if (finish === "MAX_TOKENS")
      throw new ModelOutputLimitError(
        "Gemini response reached maxOutputTokens; the turn is incomplete.",
      );
    if (finish !== undefined && finish !== "STOP" && finish !== "FINISH_REASON_UNSPECIFIED")
      throw new Error(`Gemini response incomplete: ${String(finish)}`);
    const content = geminiRecord(candidate.content);
    if (
      candidate.content !== undefined &&
      (!content ||
        (content.role !== undefined && content.role !== "model") ||
        !Array.isArray(content.parts))
    )
      throw new Error("Invalid Gemini candidate content.");
    for (const value of (content?.parts ?? []) as unknown[]) {
      const part = safeGeminiPart(value);
      if (!part)
        throw new Error("Unsupported or malformed Gemini Part; expected text or functionCall.");
      // Signatures may arrive in an otherwise empty trailing Part after STOP.
      if (completed && (part.functionCall || (typeof part.text === "string" && part.text)))
        throw new Error("Gemini stream returned new content after completion.");
      bytes += Buffer.byteLength(JSON.stringify(part), "utf8");
      if (bytes > 16 * 1024 * 1024 || parts.length >= 8192)
        throw new Error("Gemini native state exceeds the response limit.");
      parts.push(part);
      if (typeof part.text === "string" && part.text)
        yield { type: part.thought === true ? "reasoning_delta" : "text_delta", text: part.text };
      if (part.functionCall) {
        const call = part.functionCall as Record<string, unknown>;
        const wireId = typeof call.id === "string" ? call.id : null;
        if (wireId && wireIds.has(wireId)) throw new Error("Duplicate Gemini functionCall id.");
        if (wireId) wireIds.add(wireId);
        if (callIds.length >= 512) throw new Error("Gemini returned too many function calls.");
        const index = callIds.length;
        // Internal IDs pair persisted results; never add invented IDs to Google's Parts.
        const callId = `gemini_${randomUUID()}`;
        callIds.push(callId);
        yield { type: "tool_call_started", index, callId, name: call.name as string };
        yield { type: "tool_call_arguments", index, arguments: JSON.stringify(call.args ?? {}) };
      }
    }
    if (finish === "STOP") completed = true;
  }
  scope.signal.throwIfAborted();
  if (!completed)
    throw new ModelRequestError(
      "Gemini stream ended before finishReason STOP; the response may be incomplete.",
      true,
    );
  if (
    !parts.some(
      (part) =>
        part.functionCall ||
        (part.thought !== true && typeof part.text === "string" && part.text.trim()),
    )
  )
    throw new Error("Gemini completed without text or function calls.");
  const state = createProviderState(scope.provider, scope.model, {
    content: { role: "model", parts },
    callIds,
  });
  if (!state) throw new Error("Gemini native state is invalid; no tools were executed.");
  yield { type: "provider_state", state };
}
