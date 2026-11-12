import type { ProviderProtocol } from "../../../shared/domain";
import { formatDuration as duration } from "../../../shared/duration";
import { getLocale, tr } from "../i18n/index";

export function formatDuration(seconds: number): string {
  return duration(seconds, getLocale());
}

export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  anthropic_messages: "Anthropic Messages",
  openai_responses: "OpenAI Responses",
  openai_chat_completions: "OpenAI Chat Completions",
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
