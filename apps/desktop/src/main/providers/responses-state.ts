import { createHash } from "node:crypto";
import type { ResponsesStateItem, SessionMessage } from "../../shared/domain";

const MAX_ITEM_TEXT = 8 * 1024 * 1024;
const MAX_STATE_TEXT = 16 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, limit = MAX_ITEM_TEXT): string | undefined {
  return typeof value === "string" && value.length <= limit ? value : undefined;
}

export function responsesEndpointKey(baseUrl: string): string {
  try {
    const endpoint = new URL(baseUrl);
    return createHash("sha256")
      .update(`${endpoint.origin}${endpoint.pathname.replace(/\/+$/, "") || "/"}`)
      .digest("hex");
  } catch {
    return "";
  }
}

function safeAnnotations(value: unknown): Array<Record<string, unknown>> | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1000) return null;
  const allowed = new Set([
    "type",
    "url",
    "title",
    "start_index",
    "end_index",
    "file_id",
    "filename",
    "index",
    "container_id",
  ]);
  const annotations: Array<Record<string, unknown>> = [];
  for (const entry of value) {
    const annotation = record(entry);
    if (
      !annotation ||
      !["url_citation", "file_citation", "container_file_citation", "file_path"].includes(
        String(annotation.type),
      )
    )
      return null;
    const safe: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(annotation)) {
      if (!allowed.has(key)) return null;
      if (typeof raw === "string" && raw.length <= 16_000) safe[key] = raw;
      else if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) safe[key] = raw;
      else return null;
    }
    annotations.push(safe);
  }
  return annotations;
}

export function safeResponsesItem(value: unknown): ResponsesStateItem | null {
  const item = record(value);
  if (!item) return null;
  if (item.status !== undefined && item.status !== "completed") return null;
  const id = text(item.id, 1024);
  const base = {
    ...(id ? { id } : {}),
    ...(item.status === "completed" ? { status: "completed" } : {}),
  };
  if (item.type === "reasoning" || item.type === "compaction") {
    const encrypted = text(item.encrypted_content);
    if (!encrypted) return null;
    return {
      ...base,
      type: item.type,
      encrypted_content: encrypted,
      ...(item.type === "reasoning"
        ? {
            summary: Array.isArray(item.summary)
              ? item.summary.flatMap((value) => {
                  const entry = record(value);
                  const summary = text(entry?.text);
                  return entry?.type === "summary_text" && summary !== undefined
                    ? [{ type: "summary_text", text: summary }]
                    : [];
                })
              : [],
          }
        : {}),
    };
  }
  if (item.type === "function_call") {
    const callId = text(item.call_id, 1024);
    const name = text(item.name, 256);
    const args = text(item.arguments);
    if (!callId || !name || args === undefined) return null;
    return { ...base, type: "function_call", call_id: callId, name, arguments: args };
  }
  if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content))
    return null;
  const content: NonNullable<ResponsesStateItem["content"]> = [];
  for (const value of item.content) {
    const entry = record(value);
    if (entry?.type === "output_text") {
      const output = text(entry.text);
      const annotations = safeAnnotations(entry.annotations);
      if (output === undefined || !annotations) return null;
      content.push({ type: "output_text", text: output, annotations });
    } else if (entry?.type === "refusal") {
      const refusal = text(entry.refusal);
      if (refusal === undefined) return null;
      content.push({ type: "refusal", refusal });
    } else return null;
  }
  return {
    ...base,
    type: "message",
    role: "assistant",
    ...(item.phase === "commentary" || item.phase === "final_answer" ? { phase: item.phase } : {}),
    content,
  };
}

export function safeResponsesItems(value: unknown): ResponsesStateItem[] {
  if (!Array.isArray(value) || value.length > 512) return [];
  const items = value.flatMap((entry) => {
    const item = safeResponsesItem(entry);
    return item ? [item] : [];
  });
  return JSON.stringify(items).length <= MAX_STATE_TEXT ? items : [];
}

export function responsesItemText(item: ResponsesStateItem): string {
  return item.type === "message"
    ? (item.content ?? []).map((entry) => entry.text ?? entry.refusal ?? "").join("")
    : "";
}

export function hasEncryptedResponsesState(items: readonly unknown[]): boolean {
  return items.some((value) => {
    const item = record(value);
    return (
      (item?.type === "reasoning" || item?.type === "compaction") && Boolean(item.encrypted_content)
    );
  });
}

export function replayResponsesState(
  message: SessionMessage,
  providerId: string,
  modelId: string,
  endpointKey: string,
): ResponsesStateItem[] | null {
  const state = message.parts.findLast(
    (part) =>
      part.type === "responses_state" &&
      part.providerId === providerId &&
      part.modelId === modelId &&
      Boolean(endpointKey) &&
      part.endpointKey === endpointKey,
  );
  if (state?.type !== "responses_state") return null;
  const items = safeResponsesItems(state.items);
  if (!items.length) return null;
  // Fall back to ordinary history if a legacy edit or incomplete gateway snapshot
  // no longer matches the visible text and tool identities.
  const calls = message.parts.flatMap((part) =>
    part.type === "tool_call"
      ? [{ call_id: part.callId, name: part.name, arguments: part.arguments }]
      : [],
  );
  const nativeCalls = items
    .filter((item) => item.type === "function_call")
    .map(({ call_id, name, arguments: args }) => ({ call_id, name, arguments: args }));
  const byCallId = (
    left: { call_id: string | undefined },
    right: { call_id: string | undefined },
  ) => (left.call_id ?? "").localeCompare(right.call_id ?? "");
  if (JSON.stringify(calls.toSorted(byCallId)) !== JSON.stringify(nativeCalls.toSorted(byCallId)))
    return null;
  const visible = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
  if (visible !== items.map(responsesItemText).join("").trim()) return null;
  return items;
}
