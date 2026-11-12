import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MemoryDocument, MemoryMatch, ProjectMemoryView } from "../../shared/project-memory";
import { redactSecrets } from "../security/redact";
import { safeFilePath } from "../workspace/safe-file-path";
import { canonicalProjectMemoryRoot, TENCENT_MEMORY_DIRECTORY } from "./project-memory-config";
import {
  type ExtractedScene,
  MAX_EXTRACTED_MEMORIES,
  type MemoryDecision,
  TencentMemoryAnalysisError,
  type TencentMemoryExtractionInput,
  type TencentMemoryModelRequest,
  validateMemoryDecisions,
  validateMemoryExtraction,
} from "./tencent-memory-model";

interface MemoryRecord {
  id: string;
  content: string;
  type: string;
  priority: number;
  scene_name: string;
  source_message_ids: string[];
  metadata: Record<string, unknown>;
  timestamps: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
  sessionKey: string;
  sessionId?: string;
}
interface MemoryStore {
  init(): unknown;
  isFtsAvailable(): boolean;
  upsertL1(record: MemoryRecord, vector?: Float32Array): boolean;
  queryL1Records(): Array<{ record_id: string }>;
  close(): void;
}
interface TencentRuntime {
  VectorStore: new (file: string, dimensions: number) => MemoryStore;
  extractL1Memories(input: Record<string, unknown>): Promise<{
    success: boolean;
    extractedCount: number;
    storedCount: number;
    records: MemoryRecord[];
  }>;
  writeMemory(input: Record<string, unknown>): Promise<MemoryRecord | null>;
  executeMemorySearch(input: Record<string, unknown>): Promise<{
    strategy: string;
    results: Array<{ id: string; content: string }>;
  }>;
}
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 2000;
const TYPES = new Set(["persona", "instruction", "episodic"]);
const LEGACY_WORK_TYPES = new Set(["work_fact", "work_task", "work_method", "work_artifact"]);
const isPreference = (record: Pick<MemoryRecord, "type">) =>
  ["persona", "instruction"].includes(record.type);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const normalized = (text: string) => text.toLowerCase().replace(/[\s\p{P}]+/gu, "");
let runtime: Promise<TencentRuntime> | undefined;
function loadRuntime(): Promise<TencentRuntime> {
  if (!runtime) {
    runtime = (async () => {
      const resource = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
      const roots =
        resource && existsSync(join(resource, "app.asar"))
          ? [join(resource, "tencentdb-memory")]
          : [
              resolve(__dirname, "../../resources/tencentdb-memory"),
              resolve(process.cwd(), "resources/tencentdb-memory"),
              resolve(process.cwd(), "apps/desktop/resources/tencentdb-memory"),
            ];
      const root = roots.find((candidate) =>
        existsSync(join(candidate, "upstream/l1-extractor.js")),
      );
      if (!root) throw new Error("Bundled TencentDB memory core is missing. Rebuild Harness.");
      const modules = [];
      for (const name of ["memory-store", "l1-extractor", "l1-writer", "memory-search"])
        modules.push(
          await import(/* @vite-ignore */ pathToFileURL(join(root, `upstream/${name}.js`)).href),
        );
      return Object.assign({}, ...modules) as TencentRuntime;
    })().catch((cause) => {
      runtime = undefined;
      throw cause;
    });
  }
  return runtime;
}
function validateRecord(value: unknown, allowLegacyWorkType = false): MemoryRecord {
  if (!value || typeof value !== "object") throw new Error("Invalid TencentDB memory record.");
  const record = value as MemoryRecord;
  if (
    typeof record.id !== "string" ||
    !/^m_[a-zA-Z0-9_-]{1,100}$/.test(record.id) ||
    typeof record.content !== "string" ||
    !record.content.trim() ||
    record.content.length > 1200 ||
    !(TYPES.has(record.type) || (allowLegacyWorkType && LEGACY_WORK_TYPES.has(record.type))) ||
    !Number.isInteger(record.priority) ||
    record.priority < -1 ||
    record.priority > 100 ||
    !Number.isInteger(record.version) ||
    record.version < 0 ||
    !Array.isArray(record.timestamps) ||
    record.timestamps.length === 0 ||
    !record.timestamps.every(
      (date) => typeof date === "string" && Number.isFinite(Date.parse(date)),
    ) ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !Number.isFinite(Date.parse(record.updatedAt))
  )
    throw new Error("Invalid TencentDB memory record. Correct the project memory snapshot.");
  const sources = record.source_message_ids ?? [];
  const metadata = record.metadata ?? {};
  if (
    !Array.isArray(sources) ||
    sources.length > 100 ||
    sources.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) ||
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    JSON.stringify(metadata).length > 2000
  )
    throw new Error("Invalid TencentDB memory provenance.");
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata)
      .filter(([key, value]) =>
        key === "harness_origin"
          ? value === "analysis" || value === "user"
          : ["activity_start_time", "activity_end_time"].includes(key) &&
            typeof value === "string" &&
            Number.isFinite(Date.parse(value)),
      )
      .map(([key, value]) => [key, value]),
  );
  return {
    id: record.id,
    content: redactSecrets(record.content).replace(/\0/g, "").trim(),
    // Earlier experimental snapshots used Tencent's work_* labels. Preserve
    // their text as generic episodes; every subsequent save uses this schema.
    type: LEGACY_WORK_TYPES.has(record.type) ? "episodic" : record.type,
    priority: record.priority,
    scene_name:
      typeof record.scene_name === "string" ? redactSecrets(record.scene_name).slice(0, 100) : "",
    source_message_ids: [...new Set(sources)],
    metadata: safeMetadata,
    sessionKey: "project",
    ...(typeof record.sessionId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(record.sessionId)
      ? { sessionId: record.sessionId }
      : {}),
    timestamps: record.timestamps.slice(-20),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
  };
}

// JSONL is authoritative; SQLite is a disposable FTS index. Work stays in memory
// until the complete extraction/dedup operation passes validation and cancellation.
export class TencentMemoryService {
  private readonly queues = new Map<string, Promise<unknown>>();
  isBusy(root: string): boolean {
    return this.queues.has(canonicalProjectMemoryRoot(root));
  }
  private serial<T>(root: string, task: () => Promise<T>): Promise<T> {
    const key = canonicalProjectMemoryRoot(root);
    const next = (this.queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
    this.queues.set(key, next);
    void next
      .finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key);
      })
      .catch(() => undefined);
    return next;
  }
  private path(root: string, name: string) {
    return safeFilePath(root, join(TENCENT_MEMORY_DIRECTORY, name));
  }
  private async read(root: string): Promise<{ text: string; records: MemoryRecord[] }> {
    const target = await this.path(root, "records.jsonl");
    try {
      const metadata = await stat(target);
      if (!metadata.isFile() || metadata.size > MAX_BYTES)
        throw new Error("TencentDB memory snapshot exceeds 2 MiB or is not a regular file.");
      const text = await readFile(target, "utf8");
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length > MAX_RECORDS)
        throw new Error("TencentDB memory exceeds 2000 records. Remove old entries.");
      const records = lines.map((line) => validateRecord(JSON.parse(line), true));
      if (new Set(records.map((record) => record.id)).size !== records.length)
        throw new Error("Duplicate TencentDB memory IDs. Correct the project memory snapshot.");
      return { text, records };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { text: "", records: [] };
      throw cause;
    }
  }
  private async commit(
    root: string,
    records: MemoryRecord[],
    expected: string,
    signal?: AbortSignal,
    canWrite = () => true,
  ) {
    signal?.throwIfAborted();
    if (records.length > MAX_RECORDS) throw new Error("TencentDB memory exceeds 2000 records.");
    const safe = records.map((record) => validateRecord(record));
    const text =
      safe.map((record) => JSON.stringify(record)).join("\n") + (safe.length ? "\n" : "");
    if (Buffer.byteLength(text) > MAX_BYTES)
      throw new Error("TencentDB memory exceeds 2 MiB. Remove old entries.");
    const directory = await this.path(root, ".");
    await mkdir(directory, { recursive: true });
    const lockPath = await this.path(root, "write.lock");
    let lock: Awaited<ReturnType<typeof open>>;
    try {
      lock = await open(lockPath, "wx");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("Project memory is locked by another writer. Retry after it finishes.");
      throw cause;
    }
    const temporary = await this.path(root, `records.${randomUUID()}.tmp`);
    try {
      if (digest((await this.read(root)).text) !== expected)
        throw new Error(
          "Memory changed on disk. Refresh before saving; no content was overwritten.",
        );
      const handle = await open(temporary, "wx");
      try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      const target = await this.path(root, "records.jsonl");
      if (digest((await this.read(root)).text) !== expected)
        throw new Error(
          "Memory changed on disk. Refresh before saving; no content was overwritten.",
        );
      if (!canWrite()) throw new Error("Project memory was disabled; extraction was not saved.");
      signal?.throwIfAborted();
      await rename(temporary, target);
    } finally {
      await lock.close();
      await rm(temporary, { force: true });
      await rm(lockPath, { force: true });
    }
  }
  private async withStore<T>(
    records: MemoryRecord[],
    action: (core: TencentRuntime, store: MemoryStore) => Promise<T>,
  ): Promise<T> {
    const core = await loadRuntime();
    const store = new core.VectorStore(":memory:", 0);
    try {
      await store.init();
      if (!store.isFtsAvailable()) throw new Error("TencentDB memory FTS initialization failed.");
      for (const record of records)
        if (!store.upsertL1(record)) throw new Error("TencentDB memory index write failed.");
      if (store.queryL1Records().length !== records.length)
        throw new Error("TencentDB memory index is incomplete.");
      return await action(core, store);
    } finally {
      store.close();
    }
  }
  async ensure(root: string): Promise<void> {
    await this.serial(root, async () => {
      const before = await this.read(root);
      await this.withStore(before.records, async () => undefined);
      if (!existsSync(await this.path(root, "records.jsonl")))
        await this.commit(root, before.records, digest(before.text));
    });
  }
  async preferences(root: string): Promise<string> {
    const { records } = await this.read(root);
    const text = JSON.stringify(
      records.filter(isPreference).map(({ id, content }) => ({ id, content })),
    );
    if (Buffer.byteLength(text) > 6 * 1024)
      throw new Error("Preferences exceed 6 KiB. Shorten them in project memory settings.");
    return text;
  }
  async view(root: string, enabled: boolean, _rebuildIndex = true): Promise<ProjectMemoryView> {
    return this.serial(root, async () => {
      const { text, records } = await this.read(root);
      const render = (preference: boolean) =>
        JSON.stringify(
          records
            .filter((record) => isPreference(record) === preference)
            .map(({ id, type, content }) => ({ id, type, content })),
          null,
          2,
        );
      const preferences = render(true);
      const memory = render(false);
      return {
        backend: "tencentdb",
        frameworkVersion: "2.0.3",
        root: join(root, TENCENT_MEMORY_DIRECTORY),
        enabled,
        documents: {
          preferences,
          memory,
          index: records
            .map(
              (record, index) =>
                `${record.id} | records.jsonl:${index + 1} | ${record.type} | ${record.scene_name}`,
            )
            .join("\n"),
        },
        revisions: { preferences: digest(text), memory: digest(text) },
        preferences: records.filter(isPreference).length,
        memories: records.filter((record) => !isPreference(record)).length,
        archives: 0,
        bytes: Buffer.byteLength(text),
      };
    });
  }
  async search(root: string, query: string): Promise<MemoryMatch[]> {
    return this.serial(root, async () => {
      if (typeof query !== "string" || query.length > 500)
        throw new Error("Memory query exceeds 500 characters.");
      if (!query.trim()) return [];
      const { records } = await this.read(root);
      return this.withStore(records, async (core, store) => {
        const result = await core.executeMemorySearch({ query, limit: 5, vectorStore: store });
        if (result.strategy === "none") throw new Error("TencentDB memory search is unavailable.");
        let remaining = 3000;
        return result.results
          .map((item) => {
            const text = redactSecrets(item.content).slice(0, Math.min(800, remaining));
            remaining -= text.length;
            return {
              id: item.id,
              source: `${TENCENT_MEMORY_DIRECTORY}/records.jsonl`,
              line: records.findIndex((record) => record.id === item.id) + 1,
              text,
            };
          })
          .filter((item) => item.text.length);
      });
    });
  }
  async add(
    root: string,
    kind: MemoryDocument,
    content: string,
    category = "decision",
    signal?: AbortSignal,
  ): Promise<string> {
    return this.serial(root, async () => {
      signal?.throwIfAborted();
      const text = redactSecrets(content).replace(/\0/g, "").trim();
      if (!text || text.length > (kind === "preferences" ? 400 : 1200))
        throw new Error("Memory must be concise (preference 400 / diary 1200 characters maximum).");
      const before = await this.read(root);
      const duplicate = before.records.find(
        (record) =>
          isPreference(record) === (kind === "preferences") &&
          normalized(record.content) === normalized(text),
      );
      if (duplicate) return duplicate.id;
      return this.withStore(before.records, async (core, store) => {
        const record = await core.writeMemory({
          memory: {
            content: text,
            type: kind === "preferences" ? "persona" : "episodic",
            priority: 80,
            scene_name: category.slice(0, 100),
            source_message_ids: [],
            metadata: {},
          },
          decision: { record_id: `m_${randomUUID()}`, action: "store", target_ids: [] },
          baseDir: "",
          sessionKey: "project",
          vectorStore: store,
          storage: { appendFile: async () => undefined },
        });
        if (!record || !store.queryL1Records().some((row) => row.record_id === record.id))
          throw new Error("TencentDB memory write failed.");
        const next = [...before.records, validateRecord(record)];
        if (
          kind === "preferences" &&
          Buffer.byteLength(JSON.stringify(next.filter(isPreference))) > 6 * 1024
        )
          throw new Error("Preferences exceed 6 KiB. Merge or delete old preferences.");
        await this.commit(root, next, digest(before.text), signal);
        return record.id;
      });
    });
  }
  async edit(root: string, kind: MemoryDocument, text: string, revision: string): Promise<void> {
    await this.serial(root, async () => {
      if (!["preferences", "memory"].includes(kind) || Buffer.byteLength(text) > MAX_BYTES)
        throw new Error("Invalid memory edit.");
      const before = await this.read(root);
      if (digest(before.text) !== revision)
        throw new Error("Memory changed on disk. Refresh before saving.");
      const edits = JSON.parse(text) as unknown;
      if (!Array.isArray(edits))
        throw new Error("Memory editor requires a JSON array of id, type, content.");
      const originals = new Map(
        before.records
          .filter((record) => isPreference(record) === (kind === "preferences"))
          .map((record) => [record.id, record]),
      );
      const updated = edits.map((edit) => {
        if (!edit || typeof edit !== "object") throw new Error("Invalid memory entry.");
        const value = edit as { id?: unknown; type?: unknown; content?: unknown };
        const original = typeof value.id === "string" ? originals.get(value.id) : null;
        if (!original || value.type !== original.type || typeof value.content !== "string")
          throw new Error(
            "Only existing memory content can be edited. Use /remember to add an entry.",
          );
        return validateRecord({
          ...original,
          content: value.content,
          metadata: { ...original.metadata, harness_origin: "user" },
          updatedAt: new Date().toISOString(),
          version: original.version + 1,
        });
      });
      if (new Set(updated.map((record) => record.id)).size !== updated.length)
        throw new Error("Duplicate memory IDs.");
      if (kind === "preferences" && Buffer.byteLength(JSON.stringify(updated)) > 6 * 1024)
        throw new Error("Preferences exceed 6 KiB.");
      await this.commit(
        root,
        [...before.records.filter((record) => !originals.has(record.id)), ...updated],
        revision,
      );
    });
  }
  async forget(root: string, query: string): Promise<number> {
    return this.serial(root, async () => {
      if (normalized(query).length < 2 || query.length > 500)
        throw new Error("Specify a memory ID or at least two characters.");
      const before = await this.read(root);
      const keep = before.records.filter(
        (record) =>
          record.id !== query.trim() && !normalized(record.content).includes(normalized(query)),
      );
      if (keep.length !== before.records.length) await this.commit(root, keep, digest(before.text));
      return before.records.length - keep.length;
    });
  }
  async extract(
    root: string,
    input: TencentMemoryExtractionInput,
    signal: AbortSignal,
    canWrite = () => true,
  ): Promise<number> {
    return this.serial(root, async () => {
      signal.throwIfAborted();
      const before = await this.read(root);
      const newIds = new Set(input.newMessageIds);
      const messages = input.messages
        .filter((message) => newIds.has(message.id))
        .map((message) => ({
          ...message,
          content: redactSecrets(message.content)
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi, "")
            .trim(),
        }));
      if (!messages.length) return 0;
      if (
        messages.length > 20 ||
        newIds.size !== messages.length ||
        new Set(messages.map((message) => message.id)).size !== messages.length ||
        messages.some(
          (message) =>
            !/^[a-zA-Z0-9_-]{1,128}$/.test(message.id) ||
            !["user", "assistant"].includes(message.role) ||
            typeof message.content !== "string" ||
            message.content.length > 12_000 ||
            !Number.isFinite(message.timestamp),
        )
      )
        throw new Error("Invalid memory analysis input.");
      const protectedIds = new Set(
        before.records
          .filter((record) => isPreference(record) && record.metadata.harness_origin !== "analysis")
          .map((record) => record.id),
      );
      return this.withStore(before.records, async (core, store) => {
        let adapterFailure: unknown;
        let extraction: ExtractedScene[] = [];
        let decisions: MemoryDecision[] | undefined;
        const llmRunner = {
          run: async (request: TencentMemoryModelRequest) => {
            try {
              signal.throwIfAborted();
              if (!canWrite()) throw new Error("Project memory was disabled or reconfigured.");
              if (!["l1-extraction", "l1-conflict-detection"].includes(request.taskId))
                throw new Error("Unexpected TencentDB memory analysis task.");
              const raw = await input.runModel(request);
              signal.throwIfAborted();
              if (!canWrite()) throw new Error("Project memory was disabled or reconfigured.");
              if (request.taskId === "l1-extraction") {
                extraction = validateMemoryExtraction(raw, newIds);
                return JSON.stringify(extraction);
              }
              decisions = validateMemoryDecisions(
                raw,
                request.prompt,
                before.records,
                protectedIds,
              );
              return JSON.stringify(decisions);
            } catch (cause) {
              adapterFailure = new TencentMemoryAnalysisError(cause);
              throw adapterFailure;
            }
          },
        };
        const output = await core.extractL1Memories({
          // Each completed round is analyzed once. Omitting older background
          // avoids the upstream quality filter moving it across the new boundary.
          messages,
          sessionKey: "project",
          baseDir: "",
          config: {},
          options: {
            promptMode: "chat",
            llmRunner,
            vectorStore: store,
            enableDedup: true,
            maxMessagesPerExtraction: messages.length,
            maxBackgroundMessages: 0,
            maxMemoriesPerSession: MAX_EXTRACTED_MEMORIES,
          },
          storage: { appendFile: async () => undefined },
        });
        signal.throwIfAborted();
        if (adapterFailure) throw adapterFailure;
        if (!output.success) throw new Error("TencentDB memory extraction failed.");
        const live = new Set(store.queryL1Records().map((row) => row.record_id));
        const expected = extraction.flatMap((scene) =>
          scene.memories.map((memory) => ({ ...memory, scene_name: scene.scene_name })),
        );
        const replaced = new Set(decisions?.flatMap((decision) => decision.target_ids) ?? []);
        const changed = output.records.map((record) => {
          const targets = decisions?.find(
            (decision) => decision.record_id === record.id,
          )?.target_ids;
          const sources = [
            ...record.source_message_ids,
            ...before.records
              .filter((old) => targets?.includes(old.id))
              .flatMap((old) => old.source_message_ids),
          ];
          return validateRecord({
            ...record,
            sessionId: input.sessionId,
            source_message_ids: [...new Set(sources)].slice(-100),
          });
        });
        const survivors = before.records.filter((record) => !replaced.has(record.id));
        const combined = [...survivors, ...changed];
        const expectedWrites = decisions?.filter((decision) => decision.action !== "skip").length;
        if (
          output.extractedCount !== expected.length ||
          output.storedCount !== changed.length ||
          (expectedWrites !== undefined && expectedWrites !== changed.length) ||
          (expectedWrites === undefined && changed.length !== expected.length) ||
          changed.some(
            (record) =>
              before.records.some((old) => old.id === record.id) ||
              !(decisions
                ? decisions.some(
                    (decision) => decision.record_id === record.id && decision.action !== "skip",
                  )
                : expected.some(
                    (entry) => entry.content === record.content && entry.type === record.type,
                  )) ||
              !live.has(record.id),
          ) ||
          survivors.some((record) => !live.has(record.id)) ||
          [...replaced].some((id) => live.has(id) || protectedIds.has(id)) ||
          new Set(combined.map((record) => record.id)).size !== combined.length ||
          live.size !== combined.length
        )
          throw new Error("TencentDB memory extraction did not commit all records.");
        if (!canWrite()) throw new Error("Project memory was disabled; extraction was not saved.");
        signal.throwIfAborted();
        if (changed.length) {
          if (Buffer.byteLength(JSON.stringify(combined.filter(isPreference))) > 6 * 1024)
            throw new Error("Preferences exceed 6 KiB. Merge or delete old preferences.");
          await this.commit(root, combined, digest(before.text), signal, canWrite);
        }
        return changed.length;
      });
    });
  }
}
