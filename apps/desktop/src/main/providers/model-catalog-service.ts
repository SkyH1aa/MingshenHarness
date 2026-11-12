import {
  MODEL_CATALOG_PREFERENCES_KEY,
  type ModelCatalogPreferences,
  type MoveCatalogProviderInput,
  normalizeModelCatalogPreferences,
  type SetCatalogModelStarInput,
} from "../../shared/model-catalog";
import type { Repository } from "../storage/repository";

function validateInput(input: unknown, fields: string[]): asserts input is Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Reflect.ownKeys(input).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(input, field))
  )
    throw new Error("模型目录设置无效。");
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 128 && value === value.trim()
  );
}

export class ModelCatalogService {
  constructor(private readonly repository: Repository) {}

  getPreferences(): ModelCatalogPreferences {
    return normalizeModelCatalogPreferences(
      this.repository.getSetting(MODEL_CATALOG_PREFERENCES_KEY),
      this.repository.listProviders(),
    );
  }

  moveProvider(input: MoveCatalogProviderInput): ModelCatalogPreferences {
    validateInput(input, ["providerId", "beforeProviderId"]);
    if (
      !validId(input.providerId) ||
      (input.beforeProviderId !== null && !validId(input.beforeProviderId))
    )
      throw new Error("供应商标识无效。");
    const current = this.getPreferences();
    if (
      !current.providerOrder.includes(input.providerId) ||
      (input.beforeProviderId !== null && !current.providerOrder.includes(input.beforeProviderId))
    )
      throw new Error("供应商不存在。");
    if (input.providerId === input.beforeProviderId) return current;
    const order = current.providerOrder.filter((id) => id !== input.providerId);
    const before =
      input.beforeProviderId === null ? order.length : order.indexOf(input.beforeProviderId);
    order.splice(before, 0, input.providerId);
    return this.save({ ...current, providerOrder: order });
  }

  setModelStar(input: SetCatalogModelStarInput): ModelCatalogPreferences {
    validateInput(input, ["modelConfigId", "starred"]);
    if (!validId(input.modelConfigId) || typeof input.starred !== "boolean")
      throw new Error("模型星标设置无效。");
    if (!this.repository.getModel(input.modelConfigId)) throw new Error("模型配置不存在。");
    const current = this.getPreferences();
    const stars = current.starredModelIds.filter((id) => id !== input.modelConfigId);
    if (input.starred) {
      if (current.starredModelIds.includes(input.modelConfigId)) return current;
      stars.push(input.modelConfigId);
    }
    return this.save({ ...current, starredModelIds: stars });
  }

  private save(preferences: ModelCatalogPreferences): ModelCatalogPreferences {
    if (
      JSON.stringify(this.repository.getSetting(MODEL_CATALOG_PREFERENCES_KEY)) !==
      JSON.stringify(preferences)
    )
      this.repository.setSetting(MODEL_CATALOG_PREFERENCES_KEY, preferences);
    return preferences;
  }
}
