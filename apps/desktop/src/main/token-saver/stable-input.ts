import { createHash } from "node:crypto";
import { z } from "zod";
import type { SessionMessage } from "../../shared/domain";
import type { TokenSaverChange, TokenSaverSettings } from "../../shared/token-saver";
import type { Repository } from "../storage/repository";
import { compressInput, requiresExactInput } from "./input-compressor";

const changeSchema = z.object({
  messageId: z.string(),
  partIndex: z.number().int().nonnegative(),
  importance: z.enum(["high", "medium", "low"]),
  strategy: z.enum(["duplicate", "structured", "relevance", "code", "tool"]),
  beforeTokens: z.number().nonnegative(),
  afterTokens: z.number().nonnegative(),
});
const entrySchema = z.object({
  id: z.string(),
  sourceHash: z.string(),
  replacements: z.array(
    z.object({
      partIndex: z.number().int().nonnegative(),
      text: z.string(),
      change: changeSchema,
    }),
  ),
});
const ledgerSchema = z.object({
  version: z.literal(1),
  configHash: z.string(),
  entries: z.array(entrySchema),
});
type Entry = z.infer<typeof entrySchema>;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceHash(message: SessionMessage): string {
  const parts = message.parts.flatMap<unknown>((part) => {
    switch (part.type) {
      case "text":
        return [{ type: part.type, text: part.text }];
      case "tool_call":
        return [
          {
            type: part.type,
            callId: part.callId,
            name: part.name,
            arguments: part.arguments,
          },
        ];
      case "tool_result":
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
                    contentHash: hash(image.dataUrl),
                  })),
                }
              : {}),
          },
        ];
      case "responses_state":
        return [
          {
            type: part.type,
            providerId: part.providerId,
            modelId: part.modelId,
            endpointKey: part.endpointKey,
            contentHash: hash(part.items),
          },
        ];
      case "provider_state":
        return [{ type: part.type, contentHash: hash(part.state) }];
      case "attachment":
        return [{ type: part.type, attachment: part.attachment }];
      default:
        return [];
    }
  });
  // Display-only reasoning summaries and UI status are separate from replayable
  // Responses items, whose opaque payload must invalidate the emitted prefix.
  return hash([message.role, message.seq === 0, parts]);
}

function restore(message: SessionMessage, entry: Entry): SessionMessage | null {
  if (requiresExactInput(message) && entry.replacements.length) return null;
  const parts = [...message.parts];
  for (const replacement of entry.replacements) {
    const part = parts[replacement.partIndex];
    if (
      !part ||
      !["text", "tool_result"].includes(part.type) ||
      replacement.change.messageId !== message.id ||
      replacement.change.partIndex !== replacement.partIndex
    )
      return null;
    if (part.type === "text") parts[replacement.partIndex] = { ...part, text: replacement.text };
    else if (part.type === "tool_result")
      parts[replacement.partIndex] = { ...part, output: replacement.text };
  }
  return { ...message, parts };
}

export function stableInput(
  repository: Pick<Repository, "getSetting" | "setSetting">,
  sessionId: string,
  messages: SessionMessage[],
  settings: TokenSaverSettings,
  canRecall: boolean,
  persist: boolean,
): { messages: SessionMessage[]; changes: TokenSaverChange[] } {
  const key = `tokenSaver.input.${sessionId}`;
  const configHash = hash([settings, canRecall]);
  const saved = ledgerSchema.safeParse(repository.getSetting(key));
  const hashes = messages.map(sourceHash);
  let ledger = saved.success && saved.data.configHash === configHash ? saved.data : null;
  if (ledger) {
    let matched = 0;
    while (matched < Math.min(ledger.entries.length, messages.length)) {
      const entry = ledger.entries[matched];
      if (entry?.id !== messages[matched]?.id || entry?.sourceHash !== hashes[matched]) break;
      matched++;
    }
    // Compaction may replace only the tail: earlier immutable summaries keep their sent form.
    ledger = { ...ledger, entries: ledger.entries.slice(0, matched) };
  }
  const preserved = new Map<string, SessionMessage>();
  if (ledger) {
    for (const [index, entry] of ledger.entries.entries()) {
      const source = messages[index];
      const message = source ? restore(source, entry) : null;
      if (!message) {
        preserved.clear();
        break;
      }
      preserved.set(message.id, message);
    }
  }
  const validLedger = ledger && preserved.size === ledger.entries.length ? ledger : null;
  const result = compressInput(messages, settings, canRecall, validLedger ? preserved : undefined);
  const changes = [
    ...(validLedger?.entries.flatMap((entry) =>
      entry.replacements.map((replacement) => replacement.change),
    ) ?? []),
    ...result.changes,
  ];
  if (persist && (!validLedger || validLedger.entries.length !== messages.length)) {
    const changesByMessage = new Map<string, TokenSaverChange[]>();
    for (const change of changes) {
      const list = changesByMessage.get(change.messageId) ?? [];
      list.push(change);
      changesByMessage.set(change.messageId, list);
    }
    const entries = messages.map((message, index): Entry => {
      const oldEntry = validLedger?.entries[index];
      if (oldEntry) return oldEntry;
      return {
        id: message.id,
        sourceHash: hashes[index] ?? sourceHash(message),
        replacements: (changesByMessage.get(message.id) ?? []).flatMap((change) => {
          const part = result.messages[index]?.parts[change.partIndex];
          return part?.type === "text"
            ? [{ partIndex: change.partIndex, text: part.text, change }]
            : part?.type === "tool_result"
              ? [{ partIndex: change.partIndex, text: part.output, change }]
              : [];
        }),
      };
    });
    // Store only hashes and replacements; unchanged source text stays in the messages table.
    repository.setSetting(key, { version: 1, configHash, entries });
  }
  return { messages: result.messages, changes };
}
