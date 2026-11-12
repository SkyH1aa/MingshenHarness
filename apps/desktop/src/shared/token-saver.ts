import { z } from "zod";
import type { PromptCacheDiagnostic } from "./prompt-cache-diagnostics";

export const TOKEN_SAVER_SETTING = "plugins.tokenSaver";
export const TOKEN_SAVER_ID = "builtin-token-saver";
export const tokenSaverSettingsSchema = z
  .object({
    enabled: z.boolean(),
    historySummaries: z.boolean(),
    keepRecentTurns: z.number().int().min(1).max(20),
    summarizeAfterTurns: z.number().int().min(6).max(100),
    minimumSummaryTokens: z.number().int().min(1024).max(32000),
    deduplicate: z.boolean(),
    compactStructured: z.boolean(),
    filterHistory: z.boolean(),
    codeOutlines: z.boolean(),
    trimToolResults: z.boolean(),
    maxToolResultChars: z.number().int().min(4000).max(64000),
    promptModules: z.boolean(),
    outputMode: z.enum(["auto", "minimal", "standard", "detailed"]),
  })
  .strict()
  .refine((value) => value.summarizeAfterTurns > value.keepRecentTurns, {
    message: "Summary threshold must exceed the number of preserved turns.",
    path: ["summarizeAfterTurns"],
  });

export type TokenSaverSettings = z.infer<typeof tokenSaverSettingsSchema>;
export const DEFAULT_TOKEN_SAVER_SETTINGS: TokenSaverSettings = {
  enabled: true,
  // Keep lossless, local transformations on by default, but do not ask an
  // auxiliary model to rewrite history until the user opts into that tradeoff.
  historySummaries: false,
  keepRecentTurns: 5,
  summarizeAfterTurns: 12,
  minimumSummaryTokens: 2048,
  deduplicate: true,
  compactStructured: true,
  filterHistory: false,
  codeOutlines: false,
  trimToolResults: false,
  maxToolResultChars: 12000,
  promptModules: true,
  outputMode: "auto",
};

export function normalizeTokenSaverSettings(value: unknown): TokenSaverSettings {
  const result = tokenSaverSettingsSchema.safeParse({
    ...DEFAULT_TOKEN_SAVER_SETTINGS,
    ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
  });
  return result.success ? result.data : { ...DEFAULT_TOKEN_SAVER_SETTINGS };
}

export type TokenUsageKind = "agent" | "compaction" | "approval" | "memory" | "title";
export interface TokenUsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  unmeasuredRequests: number;
  partialRequests: number;
  failedRequests: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheMeasuredRequests?: number;
  cacheMeasuredInputTokens?: number;
  cacheCreationMeasuredRequests?: number;
}
export interface TokenSaverChange {
  messageId: string;
  partIndex: number;
  importance: "high" | "medium" | "low";
  strategy: "duplicate" | "structured" | "relevance" | "code" | "tool";
  beforeTokens: number;
  afterTokens: number;
}
export interface TokenSaverReport {
  sessionId: string;
  runId: string;
  providerId: string;
  modelId: string;
  enabled: boolean;
  beforeTokens: number;
  afterTokens: number;
  savedTokens: number;
  savedPercent: number;
  outputMode: TokenSaverSettings["outputMode"];
  changes: TokenSaverChange[];
  omittedChangeCount: number;
  updatedAt: string;
}
export interface TokenSaverSnapshot {
  settings: TokenSaverSettings;
  report: TokenSaverReport | null;
  usage: Partial<Record<TokenUsageKind, TokenUsageTotals>>;
  cacheDiagnostics?: Partial<Record<TokenUsageKind, PromptCacheDiagnostic>>;
  historySummary: {
    beforeTokens: number;
    afterTokens: number;
    throughMessageId: string;
    keptTurns: number;
    updatedAt: string;
  } | null;
}
