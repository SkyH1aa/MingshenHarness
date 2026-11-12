import type { ModelConfig, ProviderView } from "../../../shared/domain";

export function orderCatalogProviders<T extends { id: string }>(
  providers: readonly T[],
  providerOrder: readonly string[],
): T[] {
  const remaining = new Map(providers.map((provider) => [provider.id, provider]));
  const ordered: T[] = [];
  for (const id of providerOrder) {
    const provider = remaining.get(id);
    if (!provider) continue;
    ordered.push(provider);
    remaining.delete(id);
  }
  return [...ordered, ...remaining.values()];
}

export function starredCatalogModels(
  providers: readonly ProviderView[],
  starredModelIds: readonly string[],
): { provider: ProviderView; model: ModelConfig }[] {
  const starred = new Set(starredModelIds);
  return providers.flatMap((provider) =>
    provider.models.filter((model) => starred.has(model.id)).map((model) => ({ provider, model })),
  );
}

export function catalogMoveBefore(
  providerIds: readonly string[],
  sourceId: string,
  targetId: string,
  position: "before" | "after",
): string | null | undefined {
  const remaining = providerIds.filter((id) => id !== sourceId);
  const target = remaining.indexOf(targetId);
  if (!providerIds.includes(sourceId) || target < 0) return undefined;
  const beforeId = remaining[target + (position === "after" ? 1 : 0)] ?? null;
  const source = providerIds.indexOf(sourceId);
  return (providerIds[source + 1] ?? null) === beforeId ? undefined : beforeId;
}

export function starredModelLabel(modelId: string, providerName: string, locale: string): string {
  return locale === "en" ? `${modelId} (${providerName})` : `${modelId}\uFF08${providerName}\uFF09`;
}
