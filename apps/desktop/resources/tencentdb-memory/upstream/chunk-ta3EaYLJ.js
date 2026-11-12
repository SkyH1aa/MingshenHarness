import { i as buildFtsQuery } from "./chunk-Cn-07ziM.js";
// resources/tencentdb-memory/upstream/adapters/disabled-embedding.js
function hasClientEmbedding() {
	return false;
}
// ../../third_party/tencentdb-agent-memory/src/core/tools/l1-candidate-recall.ts
const DEFAULT_TAG = "[memory-tdai][l1-candidate-recall]";
/** Standard RRF constant from the original RRF paper. */
const RRF_K = 60;
async function recallL1Candidates(params) {
	const { query, topK, vectorStore, embeddingService, logger, filter, queryEmbedding, embeddingTimeoutMs } = params;
	const tag = params.logTag ?? DEFAULT_TAG;
	if (!query || query.trim().length === 0 || topK <= 0) return {
		hits: [],
		strategy: "none"
	};
	if (vectorStore.getCapabilities?.().nativeBm25Search) return {
		hits: (filter ? await vectorStore.searchL1Fts(query, topK, filter) : await vectorStore.searchL1Fts(query, topK)).map(toL1Hit),
		strategy: "fts"
	};
	if (hasNativeL1Hybrid(vectorStore)) {
		logger?.debug?.(`${tag} [native-hybrid] Single-call hybrid search...`);
		return {
			hits: await vectorStore.searchL1Hybrid(filter ? {
				query,
				topK,
				filter
			} : {
				query,
				topK
			}),
			strategy: "hybrid"
		};
	}
	const hasEmbedding = hasClientEmbedding(embeddingService);
	const hasFts = vectorStore.isFtsAvailable();
	if (!hasEmbedding && !hasFts) return {
		hits: [],
		strategy: "none"
	};
	const [ftsHits, vecHits] = await Promise.all([recallFts(query, topK, vectorStore, hasFts, filter, logger, tag), recallVector(query, topK, vectorStore, hasEmbedding ? embeddingService : void 0, filter, queryEmbedding, embeddingTimeoutMs, logger, tag)]);
	const ftsOk = ftsHits.length > 0;
	const vecOk = vecHits.length > 0;
	let strategy;
	if (ftsOk && vecOk) strategy = "hybrid";
	else if (vecOk) strategy = "embedding";
	else if (ftsOk) strategy = "fts";
	else {
		logger?.debug?.(`${tag} Both search paths returned 0 results`);
		return {
			hits: [],
			strategy: hasEmbedding ? "embedding" : "fts"
		};
	}
	if (strategy === "hybrid") {
		const merged = rrfMergeL1Hits(ftsHits, vecHits);
		logger?.debug?.(`${tag} [hybrid] RRF merged: fts=${ftsHits.length}, vec=${vecHits.length} → ${merged.length} unique`);
		return {
			hits: merged,
			strategy
		};
	}
	return {
		hits: ftsOk ? ftsHits : vecHits,
		strategy
	};
}
function hasNativeL1Hybrid(store) {
	return typeof store.getCapabilities === "function" && !!store.getCapabilities().nativeHybridSearch && typeof store.searchL1Hybrid === "function";
}
function toL1Hit(r) {
	return {
		record_id: r.record_id,
		content: r.content,
		type: r.type,
		priority: r.priority,
		scene_name: r.scene_name,
		score: r.score,
		timestamp_str: r.timestamp_str,
		timestamp_start: r.timestamp_start,
		timestamp_end: r.timestamp_end,
		version: r.version ?? 0,
		session_key: r.session_key,
		session_id: r.session_id,
		team_id: r.team_id,
		task_id: r.task_id,
		user_id: r.user_id,
		agent_id: r.agent_id,
		metadata_json: r.metadata_json
	};
}
function rrfMergeL1Hits(...lists) {
	const map = /* @__PURE__ */ new Map();
	for (const list of lists) for (let rank = 0; rank < list.length; rank++) {
		const item = list[rank];
		const score = 1 / (RRF_K + rank + 1);
		const existing = map.get(item.record_id);
		if (existing) existing.rrfScore += score;
		else map.set(item.record_id, {
			item,
			rrfScore: score
		});
	}
	return [...map.values()].sort((a, b) => b.rrfScore - a.rrfScore).map(({ item, rrfScore }) => ({
		...item,
		score: rrfScore
	}));
}
async function recallFts(query, topK, vectorStore, hasFts, filter, logger, tag) {
	if (!hasFts) return [];
	try {
		const ftsQuery = buildFtsQuery(query);
		if (!ftsQuery) {
			logger?.debug?.(`${tag} [hybrid-fts] No usable FTS tokens from query`);
			return [];
		}
		logger?.debug?.(`${tag} [hybrid-fts] FTS5 query: "${ftsQuery}"`);
		const ftsResults = filter ? await vectorStore.searchL1Fts(ftsQuery, topK, filter) : await vectorStore.searchL1Fts(ftsQuery, topK);
		logger?.debug?.(`${tag} [hybrid-fts] FTS5 returned ${ftsResults.length} candidates`);
		return ftsResults.map(toL1Hit);
	} catch (err) {
		logger?.warn?.(`${tag} [hybrid-fts] FTS5 search failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
		return [];
	}
}
async function recallVector(query, topK, vectorStore, embeddingService, filter, queryEmbedding, embeddingTimeoutMs, logger, tag) {
	if (!hasClientEmbedding(embeddingService) && !(queryEmbedding && queryEmbedding.length > 0)) return [];
	try {
		let vec = queryEmbedding && queryEmbedding.length > 0 ? queryEmbedding : void 0;
		if (!vec) {
			logger?.debug?.(`${tag} [hybrid-vec] Generating query embedding...`);
			vec = embeddingTimeoutMs != null ? await embeddingService.embed(query, { timeoutMs: embeddingTimeoutMs }) : await embeddingService.embed(query);
		}
		if (!vec || vec.length === 0) {
			logger?.debug?.(`${tag} [hybrid-vec] Empty query embedding, skipping vector path`);
			return [];
		}
		logger?.debug?.(`${tag} [hybrid-vec] Embedding OK, dims=${vec.length}, searching top-${topK}...`);
		const vecResults = filter ? await vectorStore.searchL1Vector(vec, topK, query, filter) : await vectorStore.searchL1Vector(vec, topK, query);
		logger?.debug?.(`${tag} [hybrid-vec] Vector search returned ${vecResults.length} candidates`);
		return vecResults.map(toL1Hit);
	} catch (err) {
		logger?.warn?.(`${tag} [hybrid-vec] Embedding search failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
		return [];
	}
}
export { hasClientEmbedding as n, recallL1Candidates as t };
