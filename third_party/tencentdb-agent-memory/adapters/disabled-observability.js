export function report() {}
export function reportL1LatencyMetrics() {}
export class MemoryGenerationLogStore { async write() {} }
export function buildGenerationLogIdentity(layer, time, anchor) {
  const id = `local-${layer}-${time}-${anchor || "none"}`;
  return { generationId: id, logId: id, key: id };
}
export function buildGenerationProvenance(identity, prompt) {
  return { generation_id: identity.generationId, prompt };
}
export function buildPromptGenerationRef() { return { memory_prompt_id: "builtin:l1", version: 1, source: "system", prompt_sha256: "" }; }
export function buildMemoryGenerationRefId() { return ""; }
export async function writeGenerationProvenanceBestEffort() {}
export const metricProducer = { send() {} };
