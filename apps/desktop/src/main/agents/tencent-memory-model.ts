import { redactSecrets } from "../security/redact";

export class TencentMemoryAnalysisError extends Error {
  constructor(cause: unknown) {
    super(
      redactSecrets(
        `TencentDB memory analysis failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
    this.name = "TencentMemoryAnalysisError";
  }
}

export interface TencentMemoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface TencentMemoryModelRequest {
  systemPrompt: string;
  prompt: string;
  taskId: string;
  timeoutMs: number;
}

export interface TencentMemoryExtractionInput {
  messages: TencentMemoryMessage[];
  newMessageIds: string[];
  sessionId: string;
  runModel: (request: TencentMemoryModelRequest) => Promise<string>;
}

export interface ExtractedMemory {
  content: string;
  type: "persona" | "episodic" | "instruction";
  priority: number;
  source_message_ids: string[];
  metadata: Record<string, unknown>;
}

export interface ExtractedScene {
  scene_name: string;
  message_ids: string[];
  memories: ExtractedMemory[];
}

export interface MemoryDecision {
  record_id: string;
  action: "store" | "skip" | "update" | "merge";
  target_ids: string[];
  merged_content?: string;
  merged_type?: ExtractedMemory["type"];
  merged_priority?: number;
  merged_timestamps?: string[];
}

interface CandidateRecord {
  id: string;
  timestamps: string[];
}

const TYPES = new Set(["persona", "episodic", "instruction"]);
export const MAX_EXTRACTED_MEMORIES = 10;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Memory analysis must return structured JSON objects.");
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new Error(`Invalid memory analysis ${field}.`);
  return redactSecrets(value).replace(/\0/g, "").trim();
}

function priority(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < -1 || (value as number) > 100)
    throw new Error("Invalid memory analysis priority.");
  return value as number;
}

function memoryType(value: unknown): ExtractedMemory["type"] {
  if (typeof value !== "string" || !TYPES.has(value))
    throw new Error("Invalid memory analysis type.");
  return value as ExtractedMemory["type"];
}

function ids(value: unknown, allowed: Set<string>, required = false): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    (required && value.length === 0) ||
    value.some((id) => typeof id !== "string" || !allowed.has(id)) ||
    new Set(value).size !== value.length
  )
    throw new Error("Memory analysis referenced an invalid source or target.");
  return value as string[];
}

export function parseMemoryArray(raw: string): unknown[] {
  if (typeof raw !== "string" || raw.length > 64_000)
    throw new Error("Memory analysis response exceeds its limit.");
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .trim()
    .replace(/^```(?:json)?\s*\r?\n?/, "")
    .replace(/\r?\n?```\s*$/, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Memory analysis must return a JSON array.");
  return parsed;
}

export function validateMemoryExtraction(
  raw: string,
  newMessageIds: Set<string>,
): ExtractedScene[] {
  const scenes = parseMemoryArray(raw);
  if (scenes.length > MAX_EXTRACTED_MEMORIES)
    throw new Error("Memory analysis returned too many scenes.");
  let count = 0;
  return scenes.map((value) => {
    const scene = object(value);
    if (!Array.isArray(scene.memories))
      throw new Error("Memory analysis scene is missing its memories array.");
    count += scene.memories.length;
    if (count > MAX_EXTRACTED_MEMORIES)
      throw new Error("Memory analysis returned too many memories.");
    const messageIds = ids(scene.message_ids, newMessageIds);
    return {
      scene_name: text(scene.scene_name, 100, "scene name"),
      message_ids: messageIds,
      memories: scene.memories.map((value): ExtractedMemory => {
        const memory = object(value);
        const metadata = object(memory.metadata ?? {});
        if (
          Object.keys(metadata).some(
            (key) => !["activity_start_time", "activity_end_time"].includes(key),
          ) ||
          Object.values(metadata).some(
            (value) => typeof value !== "string" || !Number.isFinite(Date.parse(value)),
          )
        )
          throw new Error("Memory analysis returned invalid activity metadata.");
        if (
          typeof metadata.activity_start_time === "string" &&
          typeof metadata.activity_end_time === "string" &&
          Date.parse(metadata.activity_start_time) > Date.parse(metadata.activity_end_time)
        )
          throw new Error("Memory analysis returned an inverted activity range.");
        const sourceIds = ids(memory.source_message_ids, newMessageIds, true);
        if (sourceIds.some((id) => !messageIds.includes(id)))
          throw new Error("Memory analysis sources must belong to their scene.");
        return {
          content: text(memory.content, 1200, "content"),
          type: memoryType(memory.type),
          priority: priority(memory.priority),
          source_message_ids: sourceIds,
          metadata: { ...metadata, harness_origin: "analysis" },
        };
      }),
    };
  });
}

export function validateMemoryDecisions(
  raw: string,
  prompt: string,
  originals: CandidateRecord[],
  protectedIds: Set<string>,
): MemoryDecision[] {
  // The pinned upstream formatter escapes all data inside these JSON sections.
  const sections = [
    ...prompt.matchAll(
      /^### 第 \d+ 条新记忆 \(record_id: (m_[a-zA-Z0-9_-]+)\)\r?\n([\s\S]*?)\r?\n\r?\n【关联候选 ID】(\[[^\r\n]*\])/gm,
    ),
  ];
  const candidates = new Map(
    sections.map((section) => [
      section[1] as string,
      new Set(JSON.parse(section[3] as string) as string[]),
    ]),
  );
  const decisions = parseMemoryArray(raw);
  if (!sections.length || sections.length !== decisions.length)
    throw new Error("Memory analysis must decide every new memory exactly once.");
  const known = new Map(originals.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const removed = new Set<string>();
  return decisions.map((value): MemoryDecision => {
    const decision = object(value);
    const id = decision.record_id;
    if (typeof id !== "string" || !candidates.has(id) || seen.has(id))
      throw new Error("Memory analysis returned an invalid decision ID.");
    seen.add(id);
    const action = decision.action;
    if (!["store", "skip", "update", "merge"].includes(String(action)))
      throw new Error("Memory analysis returned an invalid decision action.");
    const targets = ids(decision.target_ids ?? [], candidates.get(id) as Set<string>);
    const replacement = action === "update" || action === "merge";
    if (
      replacement !== targets.length > 0 ||
      targets.some(
        (target) => !known.has(target) || protectedIds.has(target) || removed.has(target),
      )
    )
      throw new Error("Memory analysis cannot replace protected or unrelated memories.");
    for (const target of targets) removed.add(target);
    const result: MemoryDecision = {
      record_id: id,
      action: action as MemoryDecision["action"],
      target_ids: targets,
    };
    if (replacement) {
      const timestamps = decision.merged_timestamps;
      if (
        !Array.isArray(timestamps) ||
        !timestamps.length ||
        timestamps.length > 20 ||
        timestamps.some((value) => typeof value !== "string" || !Number.isFinite(Date.parse(value)))
      )
        throw new Error("Memory analysis returned invalid merged timestamps.");
      result.merged_content = text(decision.merged_content, 1200, "merged content");
      result.merged_type = memoryType(decision.merged_type);
      result.merged_priority = priority(decision.merged_priority);
      result.merged_timestamps = [
        ...new Set([
          ...(timestamps as string[]),
          ...targets.flatMap((target) => known.get(target)?.timestamps ?? []),
        ]),
      ]
        .sort()
        .slice(-20);
    }
    return result;
  });
}
