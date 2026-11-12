import type { TokenUsageKind, TokenUsageTotals } from "../../shared/token-saver";
import { recordCacheDiagnostic, type WireCacheFingerprint } from "../providers/cache-diagnostics";
import type { Repository } from "../storage/repository";

export interface RequestUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  completed: boolean;
  cacheRequest?: WireCacheFingerprint;
}

export function usageRecorder(
  repository: Repository,
  sessionId: string,
  kind: TokenUsageKind,
): (usage: RequestUsage) => void {
  return (usage) => {
    if (!repository.getSession(sessionId)) return;
    const key = `tokenSaver.usage.${sessionId}`;
    const stored = (repository.getSetting(key) ?? {}) as Partial<
      Record<TokenUsageKind, TokenUsageTotals>
    >;
    const old = stored[kind];
    const count = (value: number | null | undefined) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    const valid = (value: number | null | undefined): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0;
    const measured =
      valid(usage.inputTokens) || valid(usage.outputTokens) || valid(usage.totalTokens);
    const cacheMeasured =
      valid(usage.inputTokens) &&
      valid(usage.cachedInputTokens) &&
      usage.cachedInputTokens <= usage.inputTokens;
    stored[kind] = {
      requests: count(old?.requests) + 1,
      inputTokens: count(old?.inputTokens) + count(usage.inputTokens),
      outputTokens: count(old?.outputTokens) + count(usage.outputTokens),
      totalTokens:
        count(old?.totalTokens) +
        (valid(usage.totalTokens)
          ? usage.totalTokens
          : count(usage.inputTokens) + count(usage.outputTokens)),
      unmeasuredRequests: count(old?.unmeasuredRequests) + (measured ? 0 : 1),
      partialRequests:
        count(old?.partialRequests) +
        (measured && (!valid(usage.inputTokens) || !valid(usage.outputTokens)) ? 1 : 0),
      failedRequests: count(old?.failedRequests) + (usage.completed ? 0 : 1),
      cachedInputTokens:
        count(old?.cachedInputTokens) + (cacheMeasured ? count(usage.cachedInputTokens) : 0),
      cacheCreationInputTokens:
        count(old?.cacheCreationInputTokens) + count(usage.cacheCreationInputTokens),
      cacheMeasuredRequests: count(old?.cacheMeasuredRequests) + (cacheMeasured ? 1 : 0),
      cacheMeasuredInputTokens:
        count(old?.cacheMeasuredInputTokens) + (cacheMeasured ? count(usage.inputTokens) : 0),
      cacheCreationMeasuredRequests:
        count(old?.cacheCreationMeasuredRequests) + (valid(usage.cacheCreationInputTokens) ? 1 : 0),
    };
    repository.setSetting(key, stored);
    if (usage.cacheRequest)
      recordCacheDiagnostic(repository, sessionId, kind, usage.cacheRequest, usage);
  };
}
