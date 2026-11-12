export type PromptCacheChange =
  | "first_observation"
  | "process_restart"
  | "provider"
  | "protocol"
  | "endpoint"
  | "model"
  | "authentication"
  | "tools"
  | "system"
  | "history"
  | "history_truncated"
  | "append_only"
  | "unchanged"
  | "comparison_limit";

export interface PromptCacheDiagnostic {
  change: PromptCacheChange;
  matchedBlocks: number;
  previousBlocks: number;
  currentBlocks: number;
  settingsChanged: boolean;
  cachePolicyChanged: boolean;
  cacheOutcome: "unknown" | "none" | "partial" | "full";
  inputTokens: number | null;
  cachedInputTokens: number | null;
  updatedAt: string;
}
