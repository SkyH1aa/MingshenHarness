import { createHash } from "node:crypto";
import type { SessionMessage } from "../../shared/domain";
import type { PreparedModelRequest } from "../providers/model-stream";

interface CachedRequest {
  request: PreparedModelRequest;
  source: Array<{ id: string; hash: string }>;
  configuration: string;
  bytes: number;
}

export function isTextCompactionRequest(request: PreparedModelRequest): boolean {
  return !request.messages.some((message) =>
    message.parts.some(
      (part) => part.type === "attachment" || (part.type === "tool_result" && part.images?.length),
    ),
  );
}

export function compactionSourceHash(message: SessionMessage): string {
  const parts = message.parts.flatMap<unknown>((part) => {
    if (part.type === "text") return [{ type: part.type, text: part.text }];
    if (part.type === "tool_call")
      return [
        {
          type: part.type,
          callId: part.callId,
          name: part.name,
          arguments: part.arguments,
        },
      ];
    if (part.type === "tool_result")
      return [
        {
          type: part.type,
          callId: part.callId,
          output: part.output,
          isError: part.isError,
          ...(part.images?.length
            ? {
                images: part.images.map((image) => ({
                  mimeType: image.mimeType,
                  alt: image.alt,
                  contentHash: createHash("sha256").update(image.dataUrl).digest("hex"),
                })),
              }
            : {}),
        },
      ];
    if (part.type === "responses_state")
      return [
        {
          type: part.type,
          providerId: part.providerId,
          modelId: part.modelId,
          endpointKey: part.endpointKey,
          contentHash: createHash("sha256").update(JSON.stringify(part.items)).digest("hex"),
        },
      ];
    if (part.type === "provider_state")
      return [
        {
          type: part.type,
          contentHash: createHash("sha256").update(JSON.stringify(part.state)).digest("hex"),
        },
      ];
    if (part.type === "attachment") return [{ type: part.type, attachment: part.attachment }];
    return [];
  });
  return createHash("sha256")
    .update(JSON.stringify([message.role, message.seq === 0, parts]))
    .digest("hex");
}

/** Only recent text requests are held in memory; no transcript or credentials are persisted. */
export class CompactionRequestCache {
  private readonly requests = new Map<string, CachedRequest>();
  private bytes = 0;

  capture(
    sessionId: string,
    request: PreparedModelRequest,
    source: SessionMessage[],
    configuration: string,
  ): void {
    this.delete(sessionId);
    if (
      request.messages.length !== source.length ||
      request.messages.some(
        (message, index) => message.sessionId !== sessionId || message.id !== source[index]?.id,
      ) ||
      !isTextCompactionRequest(request)
    )
      return;
    const baseSystemPrompt = request.baseSystemPrompt ?? request.systemPrompt;
    const safeRequest: PreparedModelRequest = {
      provider: request.provider,
      model: request.model,
      systemPrompt: baseSystemPrompt,
      baseSystemPrompt,
      messages: request.messages,
      tools: request.tools,
      reasoningLevel: request.reasoningLevel,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { topP: request.topP } : {}),
    };
    const sourceHashes = source.map((message) => ({
      id: message.id,
      hash: compactionSourceHash(message),
    }));
    const serialized = JSON.stringify({
      request: safeRequest,
      source: sourceHashes,
      configuration,
    });
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > 2 * 1024 * 1024) return;
    while (this.requests.size >= 8 || this.bytes + bytes > 2 * 1024 * 1024) {
      const oldest = this.requests.keys().next().value;
      if (!oldest) break;
      this.delete(oldest);
    }
    this.requests.set(sessionId, {
      request: structuredClone(safeRequest),
      source: sourceHashes,
      configuration,
      bytes,
    });
    this.bytes += bytes;
  }

  matching(
    sessionId: string,
    source: SessionMessage[],
    configuration: string,
  ): { request: PreparedModelRequest; prefixLength: number } | null {
    const cached = this.requests.get(sessionId);
    if (!cached || cached.configuration !== configuration) return null;
    const prefixLength = Math.min(cached.source.length, source.length);
    if (
      !prefixLength ||
      cached.source
        .slice(0, prefixLength)
        .some(
          (entry, index) =>
            entry.id !== source[index]?.id || entry.hash !== compactionSourceHash(source[index]),
        )
    )
      return null;
    return {
      request: structuredClone(cached.request),
      prefixLength,
    };
  }

  delete(sessionId: string): void {
    const previous = this.requests.get(sessionId);
    if (previous) this.bytes -= previous.bytes;
    this.requests.delete(sessionId);
  }
}
