import { createHash } from "node:crypto";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { SessionMessage } from "../../shared/domain";
import type { TokenSaverChange, TokenSaverSettings } from "../../shared/token-saver";
import { codeOutline } from "../agents/code-index-service";
import { estimateTextTokens } from "../providers/model-stream";

export function recentTurnBoundary(messages: SessionMessage[], turns: number): number {
  const users = messages.flatMap((message, index) =>
    message.role === "user" && message.seq !== 0 ? [index] : [],
  );
  return users.length <= turns ? 0 : (users.at(-turns) ?? 0);
}

export function requiresExactInput(message: SessionMessage): boolean {
  return message.parts.some(
    (part) =>
      part.type === "responses_state" ||
      part.type === "provider_state" ||
      (part.type === "tool_result" && Boolean(part.images?.length)),
  );
}

export function historySummaryCut(
  messages: SessionMessage[],
  settings: TokenSaverSettings,
): number {
  if (!settings.enabled || !settings.historySummaries) return 0;
  if (
    messages.filter((message) => message.role === "user" && message.seq !== 0).length <
    settings.summarizeAfterTurns
  )
    return 0;
  const boundary = recentTurnBoundary(messages, settings.keepRecentTurns);
  const pending = new Set<string>();
  for (const message of messages.slice(0, boundary))
    for (const part of message.parts) {
      if (part.type === "tool_call") pending.add(part.callId);
      if (part.type === "tool_result") pending.delete(part.callId);
    }
  if (pending.size) return 0;
  const cost = messages.slice(0, boundary).reduce(
    (total, message) =>
      total +
      message.parts.reduce((sum, part) => {
        if (part.type === "text") return sum + estimateTextTokens(part.text);
        if (part.type === "tool_call")
          return sum + estimateTextTokens(part.name) + estimateTextTokens(part.arguments) + 8;
        if (part.type === "tool_result")
          return sum + estimateTextTokens(part.output) + (part.images?.length ?? 0) * 1600;
        if (part.type === "attachment")
          return (
            sum +
            estimateTextTokens(part.attachment.name) +
            estimateTextTokens(part.attachment.extractedContent?.text ?? "") +
            1600
          );
        // Native text/calls already have ordinary parts; opaque bytes and UI-only
        // reasoning are not semantic text available to a proactive summarizer.
        return sum + (part.type === "responses_state" || part.type === "provider_state" ? 16 : 0);
      }, 8),
    0,
  );
  return cost >= settings.minimumSummaryTokens ? boundary : 0;
}

// Remove JSON whitespace lexically, preserving large numbers, duplicate keys and string bytes.
export function compactStructuredText(text: string, language = ""): string {
  if (text.length > 256000) return text;
  try {
    const json = language === "json" || /^\s*[[{]/.test(text);
    if (!json && !["yaml", "yml"].includes(language)) return text;
    const parsed = parseDocument(text, { uniqueKeys: true });
    if (parsed.errors.length || parsed.warnings.length) return text;
    if (!json) {
      // JSON is a YAML subset; retain scalars, tags and aliases exactly when conversion is unsafe.
      if (/[#!&*]|(?:^|\s)[^\s:]+:\s*[>|]|(?:^|\s)[+-]?(?:\.inf|\.nan)\b/i.test(text)) return text;
      // YAML allows non-string mapping keys that JSON would silently coerce.
      const stringKeys = (node: unknown): boolean => {
        if (isMap(node))
          return node.items.every(
            (pair) =>
              isScalar(pair.key) && typeof pair.key.value === "string" && stringKeys(pair.value),
          );
        if (isSeq(node)) return node.items.every(stringKeys);
        return isScalar(node) || node === null;
      };
      if (!stringKeys(parsed.contents)) return text;
      const value = parsed.toJS({ maxAliasCount: 20 });
      const safe = (item: unknown): boolean => {
        if (typeof item === "number") return Number.isSafeInteger(item) && !Object.is(item, -0);
        if (item === null || typeof item === "string" || typeof item === "boolean") return true;
        if (Array.isArray(item)) return item.every(safe);
        return (
          typeof item === "object" &&
          Object.getPrototypeOf(item) === Object.prototype &&
          Object.values(item).every(safe)
        );
      };
      if (!safe(value)) return text;
      const result = JSON.stringify(value);
      if (!result || typeof value !== "object" || value === null) return text;
      const roundtrip = parseDocument(result).toJS();
      return JSON.stringify(roundtrip) === JSON.stringify(value) && result.length < text.length
        ? result
        : text;
    }
    JSON.parse(text);
    let quoted = false;
    let escaped = false;
    let result = "";
    for (const char of text) {
      if (quoted || !/\s/.test(char)) result += char;
      if (escaped) escaped = false;
      else if (quoted && char === "\\") escaped = true;
      else if (char === '"') quoted = !quoted;
    }
    return result;
  } catch {
    return text;
  }
}

export function importance(message: SessionMessage): "high" | "medium" | "low" {
  if (
    message.role === "user" ||
    message.parts.some(
      (part) =>
        part.type === "tool_call" ||
        (part.type === "tool_result" && part.isError) ||
        part.type === "attachment",
    )
  )
    return "high";
  const text = message.parts.map((part) => ("text" in part ? part.text : "")).join("\n");
  if (
    /(?:must|never|constraint|decision|failed|error|warning|todo|permission|approval|recovery|必须|禁止|约束|决定|失败|错误|待办|审批|恢复|偏好)/i.test(
      text,
    ) ||
    /(?:[/\\][\w.-]+|\b\d+\b|```)/.test(text)
  )
    return "high";
  return /^(?:ok|okay|thanks|done|好的|谢谢|收到|明白)[.!。\s]*$/i.test(text) ? "low" : "medium";
}

function keywords(text: string): string[] {
  const terms = text.toLowerCase().match(/[a-z_][\w.-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  return [
    ...new Set(
      terms.flatMap((word) =>
        /[\u4e00-\u9fff]/.test(word)
          ? Array.from({ length: Math.max(0, word.length - 1) }, (_, index) =>
              word.slice(index, index + 2),
            )
          : [word],
      ),
    ),
  ].slice(0, 64);
}

export function compressInput(
  messages: SessionMessage[],
  settings: TokenSaverSettings,
  canRecall: boolean,
  preserved?: ReadonlyMap<string, SessionMessage>,
): { messages: SessionMessage[]; changes: TokenSaverChange[] } {
  if (!settings.enabled) return { messages, changes: [] };
  const boundary = recentTurnBoundary(messages, settings.keepRecentTurns);
  const changes: TokenSaverChange[] = [];
  const latest = messages.findLast((message) => message.role === "user" && message.seq !== 0);
  const query = keywords(
    latest?.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n") ?? "",
  );
  const originals = new Map<string, string>();
  const duplicates = new Map<string, string>();
  const fingerprint = (role: string, text: string) =>
    `${role}:${createHash("sha256").update(text).digest("hex")}`;
  const duplicateTargets = new Set<string>();
  for (const message of messages)
    for (const [partIndex, part] of message.parts.entries()) {
      if (part.type !== "text" || part.text.length < 512) continue;
      const key = fingerprint(message.role, part.text);
      const target = originals.get(key);
      if (target && target !== message.id) {
        duplicates.set(`${message.id}:${partIndex}`, target);
        duplicateTargets.add(target);
      }
      const sentPart = preserved?.get(message.id)?.parts[partIndex];
      if (!target && (!sentPart || (sentPart.type === "text" && sentPart.text === part.text)))
        originals.set(key, message.id);
    }
  const transformed = messages.map((message, index) => {
    if (requiresExactInput(message)) return message;
    const previous = preserved?.get(message.id);
    if (previous) return previous;
    if (index >= boundary || message.seq === 0 || duplicateTargets.has(message.id)) return message;
    const score = importance(message);
    const parts = message.parts.map((part, partIndex) => {
      if (part.type !== "text" && part.type !== "tool_result") return part;
      if (part.type === "tool_result" && part.isError) return part;
      if (message.parts.some((item) => item.type === "tool_call")) return part;
      let text = part.type === "text" ? part.text : part.output;
      const before = text;
      let strategy: TokenSaverChange["strategy"] | null = null;
      const source = `message ${message.id}, part ${partIndex}`;
      const recall = `Original retained locally; use recall_context with message_id="${message.id}", part_index=${partIndex} before relying on omitted details.`;
      if (settings.deduplicate && part.type === "text" && text.length >= 512) {
        const duplicate = duplicates.get(`${message.id}:${partIndex}`);
        if (duplicate) {
          text = `[Exact duplicate of retained message ${duplicate}; same ${message.role} source.]`;
          strategy = "duplicate";
        }
      }
      if (!strategy && settings.compactStructured) {
        const compact = compactStructuredText(text);
        if (compact !== text) {
          text = compact;
          strategy = "structured";
        }
        text = text.replace(
          /```(json|yaml|yml)\r?\n([\s\S]*?)\r?\n```/gi,
          (block, lang: string, body: string) => {
            const result = compactStructuredText(body, lang.toLowerCase());
            if (result === body) return block;
            strategy = "structured";
            return `\`\`\`${lang}\n${result}\n\`\`\``;
          },
        );
      }
      if (
        canRecall &&
        part.type === "text" &&
        message.role === "assistant" &&
        settings.codeOutlines
      ) {
        text = text.replace(
          /```(typescript|javascript|tsx|jsx|ts|js)\r?\n([\s\S]*?)\r?\n```/gi,
          (block, lang: string, body: string) => {
            if (body.length < 3000) return block;
            const outline = codeOutline(lang, body);
            if (!outline || outline.length + recall.length >= body.length) return block;
            strategy = "code";
            return `\`\`\`${lang}\n${outline}\n\`\`\`\n[Code outline from ${source}. ${recall}]`;
          },
        );
      }
      if (
        !strategy &&
        canRecall &&
        settings.filterHistory &&
        message.role === "assistant" &&
        part.type === "text" &&
        score !== "high"
      ) {
        if (score === "low") {
          text = `[Low-importance acknowledgement omitted from ${source}. ${recall}]`;
          strategy = "relevance";
        } else if (
          text.length > 2000 &&
          query.length &&
          !query.some((word) => text.toLowerCase().includes(word))
        ) {
          text = `${text.slice(0, 300)}\n[Older low-relevance prose excerpt from ${source}. ${recall}]`;
          strategy = "relevance";
        }
      }
      if (
        !strategy &&
        canRecall &&
        settings.trimToolResults &&
        part.type === "tool_result" &&
        text.length > settings.maxToolResultChars &&
        !/(?:error|fail|denied|warning|uncertain|required|错误|失败|拒绝|警告)/i.test(text)
      ) {
        const cap = settings.maxToolResultChars;
        text = `${text.slice(0, Math.floor(cap * 0.7))}\n[Middle omitted from ${source}. ${recall}]\n${text.slice(-Math.floor(cap * 0.3))}`;
        strategy = "tool";
      }
      if (
        !strategy ||
        text.length >= before.length ||
        estimateTextTokens(text) >= estimateTextTokens(before)
      )
        return part;
      changes.push({
        messageId: message.id,
        partIndex,
        importance: score,
        strategy,
        beforeTokens: estimateTextTokens(before),
        afterTokens: estimateTextTokens(text),
      });
      return part.type === "text" ? { ...part, text } : { ...part, output: text };
    });
    return { ...message, parts };
  });
  return { messages: transformed, changes };
}
