import type { ProviderView } from "./domain";

export const MODEL_CATALOG_PREFERENCES_KEY = "ui.modelCatalogPreferences";

export interface ModelCatalogPreferences {
  providerOrder: string[];
  starredModelIds: string[];
}

export interface MoveCatalogProviderInput {
  providerId: string;
  beforeProviderId: string | null;
}

export interface SetCatalogModelStarInput {
  modelConfigId: string;
  starred: boolean;
}

export function normalizeModelCatalogPreferences(
  input: unknown,
  providers: ProviderView[],
): ModelCatalogPreferences {
  const stored =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const providerIds = new Set(providers.map((provider) => provider.id));
  const modelIds = new Set(
    providers.flatMap((provider) => provider.models.map((model) => model.id)),
  );
  const normalizeIds = (value: unknown, knownIds: Set<string>): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string" && knownIds.has(id)))]
      : [];
  const providerOrder = normalizeIds(stored.providerOrder, providerIds);
  const ordered = new Set(providerOrder);
  for (const provider of providers) if (!ordered.has(provider.id)) providerOrder.push(provider.id);
  return {
    providerOrder,
    starredModelIds: normalizeIds(stored.starredModelIds, modelIds),
  };
}
