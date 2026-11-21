import type { ModelConfig, ProviderView } from "./domain";

export function isTextOutputModel(model: Pick<ModelConfig, "outputModalities">): boolean {
  return model.outputModalities.includes("text");
}

export function isTextModel(
  model: Pick<ModelConfig, "inputModalities" | "outputModalities">,
): boolean {
  return model.inputModalities.includes("text") && isTextOutputModel(model);
}

export function isImageOutputModel(model: Pick<ModelConfig, "outputModalities">): boolean {
  return model.outputModalities.includes("image") && !model.outputModalities.includes("text");
}

export function isVisionTextModel(
  model: Pick<ModelConfig, "inputModalities" | "outputModalities">,
): boolean {
  return isTextModel(model) && model.inputModalities.includes("image");
}

export function textOutputProviders(providers: ProviderView[]): ProviderView[] {
  return providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.enabled && isTextModel(model)),
    }))
    .filter((provider) => provider.models.length > 0);
}

export function imageOutputProviders(providers: ProviderView[]): ProviderView[] {
  return providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.enabled && isImageOutputModel(model)),
    }))
    .filter((provider) => provider.models.length > 0);
}
