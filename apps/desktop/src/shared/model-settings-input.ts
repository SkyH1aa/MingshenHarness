import type { InputModality } from "./domain";

export interface ModelPresetDraft {
  editingId: string | null;
  modelId: string;
  contextWindow: string;
  maxOutputTokens: string;
  inputModalities: InputModality[];
  reasoningLevels: string;
  presetApplied: boolean;
  gptLongContextBilling: boolean;
}

export function isGpt6ModelId(modelId: string): boolean {
  return modelId.trim().startsWith("gpt-6");
}

// These are editable creation presets, not detected provider capabilities.
export function applyModelPresetOnce<T extends ModelPresetDraft>(draft: T): T {
  if (draft.editingId || draft.presetApplied) {
    return draft;
  }
  const gpt = isGpt6ModelId(draft.modelId);
  if (!gpt && !draft.modelId.trim().startsWith("deepseek-")) {
    return draft;
  }
  return {
    ...draft,
    contextWindow: "1000000",
    maxOutputTokens: gpt ? "128000" : "384000",
    inputModalities: ["text", "image", "file"],
    reasoningLevels: gpt ? "none,low,medium,high,xhigh,max" : "low,high,max",
    presetApplied: true,
    gptLongContextBilling: false,
  };
}

export function setNewModelLongContextBilling<T extends ModelPresetDraft>(
  draft: T,
  enabled: boolean,
): T {
  if (draft.editingId || !isGpt6ModelId(draft.modelId)) {
    return draft;
  }
  return {
    ...draft,
    gptLongContextBilling: enabled,
    contextWindow: enabled ? "200000" : "1000000",
  };
}

export function parseModelTokenCount(input: string): number | null {
  const match = /^(\d+)(?:\.(\d+))?([km])?$/i.exec(input.trim());
  if (!match) {
    return null;
  }
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  const unit = match[3]?.toLowerCase();
  const shift = unit === "m" ? 6 : unit === "k" ? 3 : 0;
  if (/[1-9]/.test(fraction.slice(shift))) {
    return null;
  }
  // Expand decimal digits before conversion so inputs such as 1.001k stay exact.
  const digits = `${whole}${fraction.slice(0, shift).padEnd(shift, "0")}`.replace(/^0+/, "");
  if (digits.length > 16) {
    return null;
  }
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
