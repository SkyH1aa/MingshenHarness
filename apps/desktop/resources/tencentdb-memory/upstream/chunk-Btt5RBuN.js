import { createHash } from "node:crypto";
// ../../third_party/tencentdb-agent-memory/src/core/memory-generation-log/types.ts
function buildMemoryGenerationRefId(layer, memoryId) {
	return `mgr:${layer}:${createHash("sha256").update(memoryId).digest("hex").slice(0, 40)}`;
}
export { buildMemoryGenerationRefId as t };
