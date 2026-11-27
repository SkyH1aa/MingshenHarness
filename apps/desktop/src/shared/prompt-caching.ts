import { z } from "zod";
import type { ProviderProtocol } from "./domain";

export const promptCachingSettingsSchema = z
  .object({
    mode: z.enum(["auto", "off", "openai", "anthropic_auto", "anthropic_breakpoints"]),
    ttl: z.enum(["5m", "1h"]),
    modelFamily: z.enum(["auto", "openai", "claude", "gemini", "deepseek", "other"]).optional(),
  })
  .strict();

export type PromptCachingSettings = z.infer<typeof promptCachingSettingsSchema>;
export type ProviderModelFamily = NonNullable<PromptCachingSettings["modelFamily"]>;
export const DEFAULT_PROMPT_CACHING_SETTINGS: PromptCachingSettings = {
  mode: "auto",
  ttl: "5m",
};

export function providerPromptCachingKey(providerId: string): string {
  return `providers.promptCaching.${providerId}`;
}

export function normalizePromptCachingSettings(value: unknown): PromptCachingSettings {
  const result = promptCachingSettingsSchema.safeParse(value);
  return result.success ? result.data : { ...DEFAULT_PROMPT_CACHING_SETTINGS };
}

export function validatePromptCachingSettings(
  value: unknown,
  protocol: ProviderProtocol,
): PromptCachingSettings {
  if (protocol === "openai_images") {
    throw new Error("OpenAI Images 协议不支持提示缓存。");
  }
  const result = promptCachingSettingsSchema.safeParse(value);
  if (!result.success) throw new Error("缓存配置无效，请重新选择缓存方式和保留时间。");
  if (
    (result.data.mode === "openai" &&
      !["openai_responses", "openai_chat_completions"].includes(protocol)) ||
    (result.data.mode.startsWith("anthropic_") && protocol !== "anthropic_messages")
  ) {
    throw new Error("缓存方式与供应商协议不匹配。");
  }
  if (result.data.ttl === "1h" && protocol !== "anthropic_messages")
    throw new Error("一小时缓存保留仅适用于已确认支持的 Anthropic 协议。");
  return result.data;
}
