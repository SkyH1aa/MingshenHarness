import { z } from "zod";

export function containsUnsupportedControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });
}

const boundedText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !containsUnsupportedControlCharacters(value), {
      message: "AutoDrive text contains unsupported control characters.",
    });

const autoDriveSuggestionSchema = z
  .object({
    title: boundedText(4, 100),
    summary: boundedText(20, 800),
    rationale: boundedText(20, 1200),
    steps: z.array(boundedText(4, 600)).min(2).max(10),
    risks: z.array(boundedText(4, 500)).min(1).max(8),
    verification: z.array(boundedText(4, 500)).min(1).max(8),
  })
  .strict();

const autoDrivePayloadSchema = z
  .object({
    suggestions: z.array(autoDriveSuggestionSchema).min(3).max(5),
  })
  .strict();

export interface AutoDriveSuggestion {
  id: string;
  title: string;
  summary: string;
  rationale: string;
  steps: string[];
  risks: string[];
  verification: string[];
}

export interface AutoDriveResult {
  sessionId: string;
  modelId: string;
  generatedAt: string;
  suggestions: AutoDriveSuggestion[];
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function jsonCandidate(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  return objectStart >= 0 && objectEnd > objectStart
    ? trimmed.slice(objectStart, objectEnd + 1)
    : trimmed;
}

export function parseAutoDriveResult(
  raw: string,
  input: { sessionId: string; modelId: string; generatedAt?: string },
): AutoDriveResult {
  if (typeof raw !== "string" || raw.length > 80_000)
    throw new Error("AutoDrive returned an invalid or oversized response.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(jsonCandidate(raw));
  } catch {
    throw new Error("AutoDrive did not return valid JSON.");
  }
  const parsed = autoDrivePayloadSchema.safeParse(decoded);
  if (!parsed.success)
    throw new Error(
      `AutoDrive returned an invalid proposal payload: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
    );
  const titles = new Set<string>();
  for (const suggestion of parsed.data.suggestions) {
    const title = normalizedText(suggestion.title);
    if (titles.has(title)) throw new Error("AutoDrive proposals must have distinct titles.");
    titles.add(title);
  }
  return {
    sessionId: input.sessionId,
    modelId: input.modelId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    suggestions: parsed.data.suggestions.map((suggestion, index) => ({
      id: `suggestion-${index + 1}`,
      ...suggestion,
    })),
  };
}

export function autoDriveChoicePrompt(result: AutoDriveResult, suggestionId: string): string {
  const suggestion = result.suggestions.find((item) => item.id === suggestionId);
  if (!suggestion) throw new Error("AutoDrive proposal not found.");
  return [
    "采用 AutoDrive 的后续方案，并先复核当前仓库与历史记录，再执行：",
    `方案：${suggestion.title}`,
    `目标：${suggestion.summary}`,
    `选择理由：${suggestion.rationale}`,
    "建议步骤：",
    ...suggestion.steps.map((step, index) => `${index + 1}. ${step}`),
    "风险与控制：",
    ...suggestion.risks.map((risk) => `- ${risk}`),
    "完成标准：",
    ...suggestion.verification.map((item) => `- ${item}`),
    "执行要求：先核对实际代码和现有计划；若方案与仓库事实冲突，先说明并调整，不得虚构完成或验证结果。",
  ].join("\n");
}
