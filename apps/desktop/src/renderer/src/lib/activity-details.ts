import type { ActivityEvent, SessionMessage } from "../../../shared/domain";
import { tr } from "../i18n/index";
import { runtimeText } from "../i18n/runtime";

interface ToolDetails {
  name?: string;
  arguments?: string;
  output?: string;
  isError?: boolean;
}

interface ToolOccurrence extends ToolDetails {
  messageId?: string;
  sessionId: string;
  createdAt: number;
  resultAt?: number;
  nextUserAt?: number;
}

type ToolDetailsIndex = Map<string, ToolOccurrence[]>;

export function collectToolDetails(messages: SessionMessage[]): ToolDetailsIndex {
  const details: ToolDetailsIndex = new Map();
  const currentTurns = new Map<string, ToolOccurrence[]>();
  for (const message of [...messages].sort((left, right) => left.seq - right.seq)) {
    const createdAt = Date.parse(message.createdAt);
    if (message.role === "user") {
      for (const call of currentTurns.get(message.sessionId) ?? []) call.nextUserAt = createdAt;
      currentTurns.set(message.sessionId, []);
    }
    for (const part of message.parts) {
      if (part.type !== "tool_call" && part.type !== "tool_result") continue;
      const occurrences = details.get(part.callId) ?? [];
      details.set(part.callId, occurrences);
      const previous = occurrences.filter((call) => call.sessionId === message.sessionId);
      if (part.type === "tool_call") {
        // A reversed pair is safe to join only when it is the sole record at the same timestamp.
        const reversed =
          previous.length === 1 && !previous[0]?.messageId && previous[0]?.resultAt === createdAt
            ? previous[0]
            : undefined;
        const call: ToolOccurrence = {
          ...reversed,
          messageId: message.id,
          sessionId: message.sessionId,
          createdAt,
          name: part.name,
          arguments: part.arguments,
        };
        if (reversed) occurrences.splice(occurrences.indexOf(reversed), 1);
        occurrences.push(call);
        const currentTurn = currentTurns.get(message.sessionId) ?? [];
        currentTurn.push(call);
        currentTurns.set(message.sessionId, currentTurn);
      } else {
        const latest = previous.at(-1);
        if (latest?.messageId && latest.output === undefined) {
          latest.output = part.output;
          latest.isError = part.isError;
          latest.resultAt = createdAt;
        } else {
          occurrences.push({
            sessionId: message.sessionId,
            createdAt,
            resultAt: createdAt,
            output: part.output,
            isError: part.isError,
          });
        }
      }
    }
  }
  return details;
}

export function toolDetailsForMessage(
  tools: ToolDetailsIndex,
  messageId: string,
  callId: string,
): ToolDetails | undefined {
  const matches = tools.get(callId)?.filter((call) => call.messageId === messageId) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

function jsonWithoutWhitespace(value: string): string {
  let quoted = false;
  let escaped = false;
  let result = "";
  for (const char of value) {
    if (quoted || !/\s/.test(char)) result += char;
    if (escaped) escaped = false;
    else if (quoted && char === "\\") escaped = true;
    else if (char === '"') quoted = !quoted;
  }
  return result;
}

export function formatToolArguments(value: string): string {
  try {
    const formatted = JSON.stringify(JSON.parse(value), null, 2);
    return jsonWithoutWhitespace(value) === jsonWithoutWhitespace(formatted) ? formatted : value;
  } catch {
    return value;
  }
}

export function toolDetailsForActivity(
  activity: ActivityEvent,
  tools: ToolDetailsIndex,
): ToolDetails | undefined {
  const prefix = `${activity.runId}:`;
  const callId = activity.id.startsWith(prefix) ? activity.id.slice(prefix.length) : activity.id;
  const startedAt = Date.parse(activity.startedAt);
  const matches =
    tools
      .get(callId)
      ?.filter(
        (call) =>
          call.messageId &&
          call.sessionId === activity.sessionId &&
          call.name === activity.toolName &&
          call.createdAt <= startedAt &&
          (call.resultAt === undefined || call.resultAt >= startedAt) &&
          (call.nextUserAt === undefined || call.nextUserAt > startedAt),
      ) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

export function collectActiveToolDetails(
  activities: ActivityEvent[],
  tools: ToolDetailsIndex,
): Set<ToolDetails> {
  const active = new Set<ToolDetails>();
  for (const activity of activities) {
    if (activity.status !== "running") continue;
    const call = toolDetailsForActivity(activity, tools);
    // Once a result is persisted, the normal message card is the source of
    // truth. Keep it visible while a persistent command continues polling.
    if (call && call.output === undefined) active.add(call);
  }
  return active;
}

export function activityDetailsText(activity: ActivityEvent, tools: ToolDetailsIndex): string {
  const call = toolDetailsForActivity(activity, tools);
  return [
    runtimeText(activity.title),
    activity.fileChange?.path,
    activity.detail,
    call?.name ? `${tr("工具")}: ${call.name}` : "",
    call?.arguments ? `${tr("参数")}\n${formatToolArguments(call.arguments)}` : "",
    call?.output !== undefined ? `${tr("输出")}\n${call.output}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
