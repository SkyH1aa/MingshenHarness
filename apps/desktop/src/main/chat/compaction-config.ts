import type { CompactionModelChoice, ModelReference } from "../../shared/domain";
import { isTextModel } from "../../shared/model-capabilities";
import type { Repository } from "../storage/repository";

export const DEFAULT_COMPACTION_CHOICE: CompactionModelChoice = {
  mode: "default",
  providerId: null,
  modelId: null,
};

export function validateCompactionModel(repository: Repository, input: ModelReference): void {
  if (!input || typeof input.providerId !== "string" || typeof input.modelId !== "string")
    throw new Error("压缩模型配置无效。");
  const provider = repository.getProvider(input.providerId);
  if (
    !provider?.models.some(
      (model) => model.id === input.modelId && model.enabled && isTextModel(model),
    )
  )
    throw new Error("压缩模型不存在、已禁用或不属于所选供应商，请重新配置。");
}

export function validateCompactionChoice(
  repository: Repository,
  input: CompactionModelChoice,
): CompactionModelChoice {
  if (!input || !["default", "current", "custom"].includes(input.mode))
    throw new Error("压缩模型配置无效。");
  if (input.mode !== "custom") return { mode: input.mode, providerId: null, modelId: null };
  validateCompactionModel(repository, input as ModelReference);
  return { mode: "custom", providerId: input.providerId, modelId: input.modelId };
}
