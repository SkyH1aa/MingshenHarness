import { describe, expect, it } from "vitest";
import type { ModelConfig, ProviderView } from "../../../shared/domain";
import {
  catalogMoveBefore,
  orderCatalogProviders,
  starredCatalogModels,
  starredModelLabel,
} from "./model-catalog";

function provider(id: string, modelIds: string[]): ProviderView {
  return {
    id,
    name: `Provider ${id}`,
    baseUrl: "https://catalog.invalid/v1",
    protocol: "openai_responses",
    authMode: "bearer",
    customHeaderName: null,
    activeKeyId: null,
    keys: [],
    createdAt: "",
    updatedAt: "",
    models: modelIds.map(
      (modelId): ModelConfig => ({
        id: modelId,
        providerId: id,
        modelId: "same-wire-id",
        displayName: `Model ${modelId}`,
        contextWindow: 100000,
        maxOutputTokens: 1000,
        inputModalities: ["text"],
        outputModalities: ["text"],
        toolCalls: true,
        parallelToolCalls: true,
        reasoningLevels: [],
        anthropicNoneBehavior: "disabled",
        enabled: true,
      }),
    ),
  };
}

describe("visible model catalog", () => {
  it("applies saved order once, ignores removed suppliers and appends newly created ones", () => {
    const providers = [provider("a", []), provider("b", []), provider("new", [])];
    const order = ["missing", "b", "b", "a"];
    expect(orderCatalogProviders(providers, order).map((item) => item.id)).toEqual([
      "b",
      "a",
      "new",
    ]);
    expect(providers.map((item) => item.id)).toEqual(["a", "b", "new"]);
    expect(order).toEqual(["missing", "b", "b", "a"]);
  });

  it("applies the same order to a filtered picker without restoring hidden providers", () => {
    expect(
      orderCatalogProviders([provider("a", []), provider("c", [])], ["b", "c", "a"]).map(
        (item) => item.id,
      ),
    ).toEqual(["c", "a"]);
  });

  it("matches configuration IDs, preserving two providers that share the same wire model ID", () => {
    const providers = [provider("a", ["a-config"]), provider("b", ["b-config"])];
    const favorites = starredCatalogModels(providers, ["b-config", "a-config", "missing"]);
    expect(
      favorites.map(({ provider: item, model }) => [item.id, model.id, model.modelId]),
    ).toEqual([
      ["a", "a-config", "same-wire-id"],
      ["b", "b-config", "same-wire-id"],
    ]);
    expect(starredCatalogModels(providers, ["same-wire-id"])).toEqual([]);
  });

  it("only includes stars allowed by each entry point's already-filtered model catalog", () => {
    const visible = [provider("a", ["enabled"]), provider("b", [])];
    expect(
      starredCatalogModels(visible, ["disabled", "removed", "enabled"]).map(
        ({ model }) => model.id,
      ),
    ).toEqual(["enabled"]);
  });

  it.each([
    ["a", "c", "before", "c"],
    ["a", "c", "after", "d"],
    ["d", "a", "before", "a"],
    ["d", "a", "after", "b"],
    ["b", "d", "after", null],
    ["a", "b", "before", undefined],
    ["b", "a", "after", undefined],
    ["d", "c", "after", undefined],
    ["b", "b", "before", undefined],
    ["missing", "a", "before", undefined],
    ["a", "missing", "after", undefined],
  ] as const)(
    "resolves drag placement %s / %s / %s without redundant saves",
    (source, target, position, expected) => {
      const ids = ["a", "b", "c", "d"];
      expect(catalogMoveBefore(ids, source, target, position)).toBe(expected);
      expect(ids).toEqual(["a", "b", "c", "d"]);
    },
  );

  it("uses the wire model ID and provider name in localized starred labels", () => {
    expect(starredModelLabel("model-v1", "Alpha", "en")).toBe("model-v1 (Alpha)");
    expect(starredModelLabel("model-v1", "Alpha", "zh-CN")).toBe("model-v1\uFF08Alpha\uFF09");
  });
});
