import { describe, expect, it } from "vitest";
import type { ModelConfig, ProviderView } from "./domain";
import { isTextModel, textOutputProviders } from "./model-capabilities";

function model(
  id: string,
  inputModalities: ModelConfig["inputModalities"],
  outputModalities: ModelConfig["outputModalities"],
  enabled = true,
): ModelConfig {
  return {
    id,
    providerId: "provider",
    modelId: id,
    displayName: id,
    contextWindow: 1000,
    maxOutputTokens: 100,
    inputModalities,
    outputModalities,
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
    enabled,
  };
}

describe("text model selection", () => {
  it("requires text input and output, and skips ineligible providers and models", () => {
    const image = model("image", ["text"], ["image"]);
    const noTextInput = model("vision-only-input", ["image"], ["text"]);
    const text = model("text", ["text", "image"], ["text"]);
    const mixed = model("mixed", ["text"], ["text", "image"]);
    const providers: ProviderView[] = [
      { id: "images", models: [image] } as ProviderView,
      {
        id: "provider",
        models: [noTextInput, model("disabled", ["text"], ["text"], false), text, mixed],
      } as ProviderView,
    ];

    expect(isTextModel(image)).toBe(false);
    expect(isTextModel(noTextInput)).toBe(false);
    expect(isTextModel(text)).toBe(true);
    const eligible = textOutputProviders(providers);
    expect(eligible.map((provider) => provider.id)).toEqual(["provider"]);
    expect(eligible[0]?.models.map((candidate) => candidate.id)).toEqual(["text", "mixed"]);
    expect(providers[0]?.models).toEqual([image]);
  });
});
