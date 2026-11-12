import "./chunk-Bnagl06m.js";
import crypto from "node:crypto";
// ../../third_party/tencentdb-agent-memory/src/core/storage/types.ts
/**
* Storage path conventions.
*
* COS full path: {pathPrefix}/{key}
*
* key directory structure:
*   conversations/{YYYY-MM-DD}.jsonl   — L0 conversation records
*   records/{YYYY-MM-DD}.jsonl         — L1 memory records
*   scene_blocks/{name}.md             — L2 scene blocks
*   persona.md                         — L3 user persona
*   .metadata/scene_index.json         — scene index
*   .metadata/checkpoint.json          — pipeline checkpoint
*   .metadata/manifest.json            — metadata manifest
*   .metadata/instance_id              — instance ID
*   .backup/persona/                   — persona backups
*   .backup/scene_blocks/              — scene block backups
*/
const StoragePaths = {
	/** L3 core memory. Chat mode stores persona; code mode stores Team Operating Doctrine in the same file. */
	persona: "persona.md",
	/** L2 scene blocks directory */
	sceneBlocksDir: "scene_blocks/",
	/** L0 conversations directory */
	conversationsDir: "conversations/",
	/** L1 memory records directory */
	recordsDir: "records/",
	/** Metadata directory */
	metadataDir: ".metadata/",
	/** Scene index */
	sceneIndex: ".metadata/scene_index.json",
	/** Pipeline checkpoint */
	checkpoint: ".metadata/checkpoint.json",
	/** Metadata manifest */
	manifest: ".metadata/manifest.json",
	/** Instance ID */
	instanceId: ".metadata/instance_id",
	/** Backup directory */
	backupDir: ".backup/",
	/** Build scene block path */
	sceneBlock: (name) => `scene_blocks/${name}.md`,
	/** Build conversation JSONL path */
	conversation: (date) => `conversations/${date}.jsonl`,
	/** Build memory record JSONL path */
	record: (date) => `records/${date}.jsonl`,
	/** Build persona backup path */
	personaBackup: (index) => `.backup/persona/persona.${index}.md`,
	/** Build scene block backup path */
	sceneBlockBackup: (index, name) => `.backup/scene_blocks/${index}/${name}.md`
};
// ../../third_party/tencentdb-agent-memory/src/core/record/l1-writer.ts
/**
* L1 Memory Writer: writes extracted memories to JSONL files.
*
* File naming: records/YYYY-MM-DD.jsonl (daily shards, all sessions merged).
* Each record includes sessionKey for traceability.
*
* Write strategy:
* - JSONL is the append-only persistent store (source of truth for backup/recovery).
* - VectorStore (SQLite) is the primary retrieval engine.
* - On update/merge, old records are deleted from VectorStore in real-time;
*   JSONL is append-only and cleaned up periodically by memory-cleaner.
*
* Supports store (append), update, merge, and skip operations.
*
* v3: Aligned with Kenty's prompt output format — 3 memory types (persona/episodic/instruction),
* numeric priority, scene_name, source_message_ids, metadata, timestamps.
*/
const TAG = "[memory-tdai][l1-writer]";
/**
* Generate a unique memory ID.
*/
function generateMemoryId() {
	return `m_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}
/**
* Write a memory record according to the dedup decision.
*
* - store: append new record
* - update: remove target records + append updated record
* - merge: remove target records + append merged record
* - skip: do nothing
*
* v3: supports multi-target removal for update/merge.
* v3.1: optional VectorStore + EmbeddingService for dual-write (JSONL + vector).
*/
async function writeMemory(params) {
	const { memory, decision, baseDir, sessionKey, sessionId, taskId, teamId, userId, agentId, logger, vectorStore, embeddingService, storage } = params;
	if (decision.action === "skip") {
		logger?.debug?.(`${TAG} Skipping memory: ${memory.content.slice(0, 50)}...`);
		return null;
	}
	const now = (/* @__PURE__ */ new Date()).toISOString();
	let nextVersion = 0;
	if ((decision.action === "update" || decision.action === "merge") && decision.target_ids.length > 0 && vectorStore) try {
		nextVersion = (await vectorStore.queryL1Records({ recordIds: decision.target_ids })).reduce((max, row) => Math.max(max, row.version ?? 0), 0) + 1;
	} catch (err) {
		logger?.warn?.(`${TAG} Failed to read existing memory version, defaulting to v0: ${err instanceof Error ? err.message : String(err)}`);
	}
	let finalContent;
	let finalType;
	let finalPriority;
	let finalTimestamps;
	if (decision.action === "merge" || decision.action === "update") {
		finalContent = decision.merged_content ?? memory.content;
		finalType = decision.merged_type ?? memory.type;
		finalPriority = decision.merged_priority ?? memory.priority;
		finalTimestamps = decision.merged_timestamps ?? [now];
	} else {
		finalContent = memory.content;
		finalType = memory.type;
		finalPriority = memory.priority;
		finalTimestamps = [now];
	}
	const record = {
		id: decision.record_id || generateMemoryId(),
		content: finalContent,
		type: finalType,
		priority: finalPriority,
		scene_name: memory.scene_name,
		source_message_ids: memory.source_message_ids,
		metadata: memory.metadata,
		timestamps: finalTimestamps,
		createdAt: now,
		updatedAt: now,
		version: nextVersion,
		sessionKey,
		sessionId: sessionId || "default",
		taskId,
		teamId,
		userId: userId || "default",
		agentId: agentId || "default"
	};
	const shardDate = formatLocalDate(/* @__PURE__ */ new Date());
	const recordKey = StoragePaths.record(shardDate);
	const appendRecord = async (line) => {
		if (storage) await storage.appendFile(recordKey, line);
		else {
			logger?.warn?.(`${TAG} [CR-2 guard] writeMemory called without storage adapter; falling back to local fs at ${baseDir}/records/${shardDate}.jsonl. In service mode this means JSONL is written to ephemeral pod fs and will be lost on restart. Caller must pass 'storage' to writeMemory.`);
			const fs = await import("node:fs/promises");
			const path = await import("node:path");
			const recordsDir = path.default.join(baseDir, "records");
			await fs.default.mkdir(recordsDir, { recursive: true });
			await fs.default.appendFile(path.default.join(recordsDir, `${shardDate}.jsonl`), line, "utf-8");
		}
	};
	if ((decision.action === "update" || decision.action === "merge") && decision.target_ids.length > 0) {
		if (vectorStore) try {
			const deleteFilter = teamId || userId || agentId || sessionId ? {
				teamId,
				userId,
				agentId,
				sessionId: sessionId || void 0,
				sessionKey
			} : void 0;
			if (deleteFilter) await vectorStore.deleteL1Batch(decision.target_ids, deleteFilter);
			else await vectorStore.deleteL1Batch(decision.target_ids);
			logger?.debug?.(`${TAG} VectorStore: deleted ${decision.target_ids.length} target record(s) for ${decision.action}`);
		} catch (err) {
			logger?.warn?.(`${TAG} VectorStore delete failed for ${decision.action}: ${err instanceof Error ? err.message : String(err)}`);
		}
		try {
			await appendRecord(JSON.stringify(record) + "\n");
		} catch (err) {
			logger?.warn?.(`${TAG} JSONL append failed (non-fatal, VDB write continues): ${err instanceof Error ? err.message : String(err)}`);
		}
		logger?.debug?.(`${TAG} ${decision.action} memory: removed [${decision.target_ids.join(",")}] from VectorStore → ${record.id}: ${finalContent.slice(0, 80)}...`);
	} else {
		try {
			await appendRecord(JSON.stringify(record) + "\n");
		} catch (err) {
			logger?.warn?.(`${TAG} JSONL append failed (non-fatal, VDB write continues): ${err instanceof Error ? err.message : String(err)}`);
		}
		logger?.debug?.(`${TAG} Stored memory ${record.id}: ${finalContent.slice(0, 80)}...`);
	}
	if (vectorStore) try {
		logger?.debug?.(`${TAG} [vec-dual-write] START id=${record.id}, contentLen=${record.content.length}, content="${record.content.slice(0, 80)}..."`);
		let embedding;
		if (embeddingService) try {
			embedding = await embeddingService.embed(record.content);
			logger?.debug?.(`${TAG} [vec-dual-write] Embedding OK: dims=${embedding.length}, norm=${Math.sqrt(Array.from(embedding).reduce((s, v) => s + v * v, 0)).toFixed(4)}`);
		} catch (embedErr) {
			logger?.warn(`${TAG} [vec-dual-write] Embedding FAILED for id=${record.id}, will write metadata only: ${embedErr instanceof Error ? embedErr.message : String(embedErr)}`);
		}
		const upsertOk = await vectorStore.upsertL1(record, embedding);
		logger?.debug?.(`${TAG} [vec-dual-write] upsert result=${upsertOk} id=${record.id}`);
	} catch (err) {
		logger?.warn?.(`${TAG} [vec-dual-write] FAILED (JSONL already written) id=${record.id}: ${err instanceof Error ? err.message : String(err)}`);
	}
	else logger?.debug?.(`${TAG} [vec-dual-write] SKIPPED id=${record.id}: vectorStore=${!!vectorStore}`);
	return record;
}
function formatLocalDate(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export { writeMemory as n, generateMemoryId as t };
