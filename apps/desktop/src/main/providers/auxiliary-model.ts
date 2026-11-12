import type { ModelConfig, ModelReference } from "../../shared/domain";

export function sameModel(left: ModelReference | null, right: ModelReference | null): boolean {
  return Boolean(
    left && right && left.providerId === right.providerId && left.modelId === right.modelId,
  );
}

export function auxiliaryReasoning(model: ModelConfig): string | null {
  const levels = model.reasoningLevels.filter(
    (level) => !(level.toLowerCase() === "none" && model.anthropicNoneBehavior === "reject"),
  );
  return (
    levels.find((level) => level.toLowerCase() === "none") ??
    levels.find((level) => ["minimal", "low"].includes(level.toLowerCase())) ??
    levels[0] ??
    null
  );
}
