import type { ModelConfig } from "../../shared/domain";

export function geminiModelPath(modelId: string, stream = true): string {
  const name = modelId.replace(/^models\//, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(name))
    throw new Error("Gemini Model ID must be a model name, optionally prefixed with models/.");
  return `/models/${encodeURIComponent(name)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
}

export function geminiThinkingConfig(
  model: Pick<ModelConfig, "modelId">,
  level: string | null,
): Record<string, unknown> | undefined {
  if (!level) return undefined;
  const name = model.modelId.replace(/^models\//, "").toLowerCase();
  if (level === "auto") return undefined;
  if (/^gemini-2\.5-/.test(name)) {
    if (level === "none" && !/^gemini-2\.5-pro(?:-|$)/.test(name)) return { thinkingBudget: 0 };
    throw new Error("Gemini 2.5 原生协议请使用默认思考；Flash 可选择 none，Pro 不支持关闭思考。");
  }
  if (!["minimal", "low", "medium", "high"].includes(level))
    throw new Error("Gemini 原生思考等级支持 minimal、low、medium、high；可用等级由具体模型决定。");
  return { thinkingLevel: level.toUpperCase(), includeThoughts: true };
}

export function geminiRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Retain every signed Part boundary, including empty text and signature-only Parts.
export function safeGeminiPart(value: unknown): Record<string, unknown> | null {
  const part = geminiRecord(value);
  if (
    !part ||
    Object.keys(part).some(
      (key) => !["text", "thought", "thoughtSignature", "functionCall"].includes(key),
    )
  )
    return null;
  if (part.text !== undefined && typeof part.text !== "string") return null;
  if (part.thought !== undefined && typeof part.thought !== "boolean") return null;
  if (
    part.thoughtSignature !== undefined &&
    (typeof part.thoughtSignature !== "string" ||
      !part.thoughtSignature ||
      Buffer.byteLength(part.thoughtSignature, "utf8") > 8 * 1024 * 1024)
  )
    return null;
  if (part.text !== undefined && part.functionCall !== undefined) return null;
  if (part.functionCall !== undefined) {
    const call = geminiRecord(part.functionCall);
    if (
      !call ||
      Object.keys(call).some((key) => !["id", "name", "args"].includes(key)) ||
      typeof call.name !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(call.name) ||
      (call.id !== undefined &&
        (typeof call.id !== "string" || !call.id || call.id.length > 512)) ||
      (call.args !== undefined && !geminiRecord(call.args)) ||
      part.thought === true
    )
      return null;
  }
  if (
    part.text === undefined &&
    part.functionCall === undefined &&
    part.thoughtSignature === undefined
  )
    return null;
  return structuredClone(part);
}

export function safeGeminiPayload(value: Record<string, unknown>): Record<string, unknown> | null {
  const content = geminiRecord(value.content);
  if (
    content?.role !== "model" ||
    !Array.isArray(content.parts) ||
    !content.parts.length ||
    content.parts.length > 8192 ||
    !Array.isArray(value.callIds)
  )
    return null;
  const parts: Record<string, unknown>[] = [];
  const wireIds = new Set<string>();
  let callCount = 0;
  for (const value of content.parts) {
    const part = safeGeminiPart(value);
    if (!part) return null;
    if (part.functionCall) {
      const call = part.functionCall as Record<string, unknown>;
      if (typeof call.id === "string") {
        if (wireIds.has(call.id)) return null;
        wireIds.add(call.id);
      }
      callCount++;
    }
    parts.push(part);
  }
  const ids = value.callIds;
  if (
    callCount > 512 ||
    ids.length !== callCount ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 512)
  )
    return null;
  return { content: { role: "model", parts }, callIds: [...ids] };
}
