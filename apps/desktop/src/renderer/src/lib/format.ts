import type { ActivityEvent, ProviderProtocol, SessionMessage } from "../../../shared/domain";
import { formatDuration as duration } from "../../../shared/duration";
import type { RuntimeRunStatus } from "../../../shared/runtime";
import type { ToolOutcome } from "../../../shared/tool-outcome";
import { getLocale, tr } from "../i18n/index";

export function formatDuration(seconds: number): string {
  return duration(seconds, getLocale());
}

const ACTIVE_RUNTIME_RUN_STATUSES: ReadonlySet<RuntimeRunStatus> = new Set([
  "accepted",
  "preparing",
  "running",
  "waiting_approval",
  "waiting_user",
]);

export function isActiveRuntimeRunStatus(status: RuntimeRunStatus | null | undefined): boolean {
  return status !== null && status !== undefined && ACTIVE_RUNTIME_RUN_STATUSES.has(status);
}

export function runtimeRunStatusLabel(status: RuntimeRunStatus): string {
  switch (status) {
    case "accepted":
      return tr("\u5DF2\u63A5\u7EB3");
    case "preparing":
      return tr("\u51C6\u5907\u4E2D");
    case "running":
      return tr("\u8FD0\u884C\u4E2D");
    case "waiting_approval":
      return tr("\u7B49\u5F85\u5BA1\u6279");
    case "waiting_user":
      return tr("\u7B49\u5F85\u7528\u6237");
    case "completed":
      return tr("\u5DF2\u5B8C\u6210");
    case "failed":
      return tr("\u6267\u884C\u5931\u8D25");
    case "interrupted":
      return tr("\u5DF2\u4E2D\u65AD");
    case "blocked_policy":
      return tr("\u5DF2\u88AB\u7B56\u7565\u963B\u6B62");
  }
}

export function failedRuntimeRunStatus(status: RuntimeRunStatus | null | undefined): boolean {
  return status === "failed" || status === "blocked_policy";
}

type ToolOutcomeView = Omit<ToolOutcome, "output" | "isError">;

function toolOutcomeCandidates(
  messages: SessionMessage[],
  sessionId: string,
  callId: string,
): Array<{ createdAt: number; seq: number; outcome: ToolOutcomeView }> {
  return [...messages]
    .filter((message) => message.sessionId === sessionId)
    .sort((left, right) => left.seq - right.seq)
    .flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool_result" || part.callId !== callId || !part.outcome) return [];
        return [
          {
            createdAt: Date.parse(message.createdAt),
            seq: message.seq,
            outcome: part.outcome,
          },
        ];
      }),
    );
}

function boundedToolOutcome(
  candidates: Array<{ createdAt: number; seq: number; outcome: ToolOutcomeView }>,
  startedAt: number,
  nextUserAt: number,
): ToolOutcomeView | undefined {
  if (!candidates.length) return undefined;
  const bounded = candidates.filter(
    (candidate) =>
      !Number.isFinite(startedAt) ||
      (candidate.createdAt >= startedAt - 5_000 && candidate.createdAt < nextUserAt),
  );
  if (bounded.length) {
    return bounded
      .sort((left, right) => left.createdAt - right.createdAt || left.seq - right.seq)
      .at(-1)?.outcome;
  }
  return candidates.length === 1 ? candidates[0]?.outcome : undefined;
}

export function toolOutcomeStatusLabel(outcome: ToolOutcomeView): string {
  switch (outcome.status) {
    case "success":
      return tr("\u6210\u529F");
    case "partial":
      return tr("\u90E8\u5206\u5B8C\u6210");
    case "failed":
      return tr("\u5931\u8D25");
    case "denied":
      return tr("\u5DF2\u62D2\u7EDD");
    case "cancelled":
      return tr("\u5DF2\u53D6\u6D88");
    case "unverified":
      return tr("\u672A\u9A8C\u8BC1");
  }
}

export function toolOutcomeEffectLabel(outcome: ToolOutcomeView): string {
  switch (outcome.effect) {
    case "none":
      return tr("\u672A\u6267\u884C\u526F\u4F5C\u7528");
    case "confirmed":
      return tr("\u526F\u4F5C\u7528\u5DF2\u786E\u8BA4");
    case "uncertain":
      return tr("\u526F\u4F5C\u7528\u4E0D\u786E\u5B9A");
  }
}

export function toolOutcomeValidationLabel(outcome: ToolOutcomeView): string {
  switch (outcome.validation.status) {
    case "validated":
      return tr("\u7ED3\u6784\u6821\u9A8C\u901A\u8FC7");
    case "not_declared":
      return tr("\u672A\u58F0\u660E\u7ED3\u6784");
    case "invalid":
      return tr("\u7ED3\u6784\u6821\u9A8C\u5931\u8D25");
    case "unverified":
      return tr("\u672A\u9A8C\u8BC1\u7ED3\u6784");
  }
}

export function toolOutcomeHasRisk(outcome: ToolOutcomeView): boolean {
  return (
    outcome.status === "failed" ||
    outcome.status === "denied" ||
    outcome.effect === "uncertain" ||
    outcome.validation.status === "invalid" ||
    outcome.validation.status === "unverified"
  );
}

export function toolOutcomeInlineLabel(outcome: ToolOutcomeView): string {
  if (outcome.effect === "uncertain" || outcome.validation.status === "invalid") {
    return `${toolOutcomeStatusLabel(outcome)} \u00B7 ${
      outcome.effect === "uncertain"
        ? toolOutcomeEffectLabel(outcome)
        : toolOutcomeValidationLabel(outcome)
    }`;
  }
  return toolOutcomeStatusLabel(outcome);
}

export function toolOutcomeDetailLines(outcome: ToolOutcomeView): string[] {
  const lines = [
    `${tr("\u7ED3\u679C\u72B6\u6001")}: ${toolOutcomeStatusLabel(outcome)}`,
    `${tr("\u526F\u4F5C\u7528")}: ${toolOutcomeEffectLabel(outcome)}`,
    `${tr("\u7ED3\u6784\u6821\u9A8C")}: ${toolOutcomeValidationLabel(outcome)}`,
  ];
  if (outcome.retryable)
    lines.push(tr("\u8BE5\u7ED3\u679C\u6807\u8BB0\u4E3A\u53EF\u91CD\u8BD5\u3002"));
  if (outcome.codes.length) {
    lines.push(`${tr("\u539F\u56E0\u7801")}: ${outcome.codes.join(", ")}`);
  }
  for (const evidence of outcome.evidence) {
    lines.push(`${tr("\u8BC1\u636E")} [${evidence.kind}]: ${evidence.summary}`);
  }
  return lines;
}

export function toolOutcomeForActivity(
  activity: ActivityEvent,
  messages: SessionMessage[],
): ToolOutcomeView | undefined {
  const prefix = `${activity.runId}:`;
  const callId = activity.id.startsWith(prefix) ? activity.id.slice(prefix.length) : activity.id;
  const ordered = [...messages]
    .filter((message) => message.sessionId === activity.sessionId)
    .sort((left, right) => left.seq - right.seq);
  const startedAt = Date.parse(activity.startedAt);
  const nextUser = Number.isFinite(startedAt)
    ? ordered.find(
        (message) => message.role === "user" && Date.parse(message.createdAt) > startedAt,
      )
    : undefined;
  const nextUserAt = nextUser ? Date.parse(nextUser.createdAt) : Number.POSITIVE_INFINITY;
  return boundedToolOutcome(
    toolOutcomeCandidates(messages, activity.sessionId, callId),
    startedAt,
    nextUserAt,
  );
}

export function toolOutcomeForToolCall(
  messages: SessionMessage[],
  callMessage: SessionMessage,
  callId: string,
): ToolOutcomeView | undefined {
  const ordered = [...messages]
    .filter((message) => message.sessionId === callMessage.sessionId)
    .sort((left, right) => left.seq - right.seq);
  const startedAt = Date.parse(callMessage.createdAt);
  const nextUser = ordered.find(
    (message) => message.role === "user" && message.seq > callMessage.seq,
  );
  const nextUserAt = nextUser ? Date.parse(nextUser.createdAt) : Number.POSITIVE_INFINITY;
  return boundedToolOutcome(
    toolOutcomeCandidates(messages, callMessage.sessionId, callId).filter(
      (candidate) => candidate.seq >= callMessage.seq,
    ),
    startedAt,
    nextUserAt,
  );
}

export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  anthropic_messages: "Anthropic Messages",
  openai_responses: "OpenAI Responses",
  openai_chat_completions: "OpenAI Chat Completions",
  openai_images: "OpenAI Images",
  gemini_generate_content: "Google Gemini",
};

export function formatRelativeTime(value: string): string {
  const time = new Date(value).getTime();
  const deltaSeconds = Math.max(0, Math.round((Date.now() - time) / 1000));

  if (deltaSeconds < 60) {
    return tr("\u521A\u521A");
  }
  if (deltaSeconds < 3600) {
    return tr("{0} \u5206\u949F\u524D", [Math.floor(deltaSeconds / 60)]);
  }
  if (deltaSeconds < 86_400) {
    return tr("{0} \u5C0F\u65F6\u524D", [Math.floor(deltaSeconds / 3600)]);
  }
  if (deltaSeconds < 604_800) {
    return tr("{0} \u5929\u524D", [Math.floor(deltaSeconds / 86_400)]);
  }

  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
  }).format(new Date(time));
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return new Intl.NumberFormat(getLocale()).format(value);
}

export function formatPath(value: string | null): string {
  if (!value) {
    return tr("\u672A\u9009\u62E9\u5DE5\u4F5C\u76EE\u5F55");
  }
  return value;
}
