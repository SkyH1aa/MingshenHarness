import type { ModelReference } from "./domain";

export const MAX_TEMPORARY_INSTRUCTION_CHARS = 4_000;
export const MAX_PROJECT_TONE_INSTRUCTION_CHARS = 2_000;
export const MAX_DRAFT_POLISH_CHARS = 120_000;

export const PROJECT_TONE_PRESETS = [
  "default",
  "professional",
  "concise",
  "friendly",
  "direct",
  "academic",
  "custom",
] as const;

export type ProjectTonePreset = (typeof PROJECT_TONE_PRESETS)[number];

export interface DraftAssistSettings {
  providerId: string | null;
  modelId: string | null;
}

export interface DraftPolishInput {
  requestId?: string;
  sessionId: string;
  text: string;
  draftRevision: string;
}

export interface DraftPolishResult {
  text: string;
  draftRevision: string;
  model: ModelReference;
  modelDisplayName: string;
}

export interface ProjectToneView {
  preset: ProjectTonePreset;
  customInstruction: string | null;
  configured: boolean;
  updatedAt: string | null;
}

export interface ProjectToneInput {
  sessionId: string;
  preset: ProjectTonePreset;
  customInstruction?: string | null;
}

export interface DraftTurnContext {
  projectTone: ProjectToneView;
  projectToneInstruction?: string;
  temporaryInstruction?: string;
}

export function normalizeTemporaryInstruction(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("临时指令格式无效。");
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > MAX_TEMPORARY_INSTRUCTION_CHARS)
    throw new Error(`临时指令不能超过 ${MAX_TEMPORARY_INSTRUCTION_CHARS} 个字符。`);
  if (normalized.includes("\u0000")) throw new Error("临时指令包含无效字符。");
  return normalized;
}

export function normalizeProjectToneInput(value: unknown): {
  preset: ProjectTonePreset;
  customInstruction: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("项目语气配置无效。");
  const record = value as Record<string, unknown>;
  if (
    typeof record.preset !== "string" ||
    !PROJECT_TONE_PRESETS.includes(record.preset as ProjectTonePreset)
  )
    throw new Error("项目语气预设无效。");
  const preset = record.preset as ProjectTonePreset;
  if (
    record.customInstruction !== undefined &&
    record.customInstruction !== null &&
    typeof record.customInstruction !== "string"
  )
    throw new Error("项目语气说明格式无效。");
  const customInstruction =
    typeof record.customInstruction === "string" ? record.customInstruction.trim() : "";
  if (customInstruction.length > MAX_PROJECT_TONE_INSTRUCTION_CHARS)
    throw new Error(`项目语气说明不能超过 ${MAX_PROJECT_TONE_INSTRUCTION_CHARS} 个字符。`);
  if (customInstruction.includes("\u0000")) throw new Error("项目语气说明包含无效字符。");
  if (preset === "custom" && !customInstruction)
    throw new Error("选择自定义项目语气时，请填写语气说明。");
  return {
    preset,
    customInstruction: preset === "custom" ? customInstruction : null,
  };
}

export function hasDraftAssistModel(
  value: DraftAssistSettings | null | undefined,
): value is ModelReference & DraftAssistSettings {
  return Boolean(value?.providerId && value.modelId);
}
