import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  NormalizedToolResult,
  ToolEffectState,
  ToolOutcome,
  ToolOutcomeStatus,
  ToolOutputValidation,
} from "../../shared/tool-outcome";
import { withToolOutcome } from "../../shared/tool-outcome";

const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_SCHEMA_DEPTH = 64;
const MAX_EXTERNAL_VALUE_BYTES = 2 * 1024 * 1024;
const MAX_EXTERNAL_VALUE_COUNT = 100_000;
const MAX_BUILTIN_VALUE_BYTES = 64 * 1024 * 1024;
const MAX_BUILTIN_VALUE_COUNT = 250_000;
const SCHEMA_VALIDATION_TIMEOUT_MS = 3_000;
const MAX_VALIDATION_WORKERS = 2;
const MAX_VALIDATION_QUEUE = 32;
const MAX_COMPILED_SCHEMA_CACHE = 32;
const runtimeRequire = createRequire(__filename);

const positiveLineSchema = {
  anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
};
const nullablePositiveLineSchema = {
  anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
};
const fileDiffLineSchema = {
  type: "object",
  required: ["type", "oldLine", "newLine", "text"],
  properties: {
    type: { enum: ["context", "added", "removed"] },
    oldLine: positiveLineSchema,
    newLine: nullablePositiveLineSchema,
    text: { type: "string" },
  },
  additionalProperties: true,
  allOf: [
    {
      if: { properties: { type: { const: "context" } } },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the standard JSON Schema keyword.
      then: {
        properties: {
          oldLine: { type: "integer", minimum: 1 },
          newLine: { type: "integer", minimum: 1 },
        },
      },
    },
    {
      if: { properties: { type: { const: "added" } } },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the standard JSON Schema keyword.
      then: {
        properties: {
          oldLine: { type: "null" },
          newLine: { type: "integer", minimum: 1 },
        },
      },
    },
    {
      if: { properties: { type: { const: "removed" } } },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the standard JSON Schema keyword.
      then: {
        properties: {
          oldLine: { type: "integer", minimum: 1 },
          newLine: { type: "null" },
        },
      },
    },
  ],
};
const fileDiffSchema = {
  type: "object",
  required: ["lines", "truncated"],
  properties: {
    lines: {
      type: "array",
      maxItems: 20_000,
      items: fileDiffLineSchema,
    },
    truncated: { type: "boolean" },
  },
  additionalProperties: true,
};
const fileChangeSchema = {
  type: "object",
  required: ["path", "changeType", "additions", "deletions"],
  properties: {
    path: { type: "string", minLength: 1, maxLength: 32_767 },
    changeType: { enum: ["created", "modified", "deleted"] },
    additions: { type: "integer", minimum: 0 },
    deletions: { type: "integer", minimum: 0 },
    diff: fileDiffSchema,
  },
  additionalProperties: true,
};
const base64DataUrlPattern = (mimeType: string) =>
  `^data:${mimeType.replace("/", "\\/")};base64,(?=[A-Za-z0-9+/])(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$`;
const toolResultImageSchema = {
  type: "object",
  required: ["dataUrl", "mimeType"],
  properties: {
    dataUrl: { type: "string", maxLength: 30 * 1024 * 1024 },
    mimeType: { enum: ["image/png", "image/jpeg", "image/webp", "image/gif"] },
    alt: { type: "string" },
  },
  additionalProperties: true,
  allOf: ["image/png", "image/jpeg", "image/webp", "image/gif"].map((mimeType) => ({
    if: { properties: { mimeType: { const: mimeType } } },
    // biome-ignore lint/suspicious/noThenProperty: `then` is the standard JSON Schema keyword.
    then: {
      properties: {
        dataUrl: { pattern: base64DataUrlPattern(mimeType) },
      },
    },
  })),
};
const officeVerificationSchema = {
  type: "object",
  required: ["status", "render", "recalculation"],
  properties: {
    status: { enum: ["verified", "partial", "unavailable", "failed"] },
    render: { enum: ["verified", "not_requested", "unavailable", "failed"] },
    recalculation: {
      enum: ["verified", "not_requested", "unavailable", "failed", "partial"],
    },
  },
  additionalProperties: true,
};

/**
 * Fixed, JSON-Schema-expressible host envelope validation. Built-in tools share
 * this schema; arbitrary MCP/custom declarations remain data and never execute
 * on the Electron main thread.
 */
export const BUILTIN_TOOL_ENVELOPE_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["output", "isError"],
  properties: {
    output: { type: "string" },
    isError: { type: "boolean" },
    fullOutput: { type: "string" },
    cleanupUnconfirmed: { type: "boolean" },
    officeVerification: officeVerificationSchema,
    fileChange: fileChangeSchema,
    fileChanges: {
      type: "array",
      maxItems: 1_000,
      items: fileChangeSchema,
    },
    images: {
      type: "array",
      maxItems: 30,
      items: toolResultImageSchema,
    },
    commandSession: {
      type: "object",
      required: ["id", "running"],
      properties: {
        id: { type: "string", minLength: 1 },
        running: { type: "boolean" },
        unreadOutputChars: { type: "integer", minimum: 0 },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

export interface ToolOutcomeSource {
  output: string;
  isError: boolean;
  cleanupUnconfirmed?: boolean;
  fullOutput?: string;
  commandSession?: unknown;
}

export interface JsonSchemaValidationResult {
  valid: boolean;
  error?: string;
}

export type JsonSchemaValueValidator = (
  schema: Record<string, unknown>,
  value: unknown,
  signal?: AbortSignal,
) => Promise<JsonSchemaValidationResult>;

export type BuiltinToolEnvelopeValidator = (
  value: unknown,
  signal?: AbortSignal,
) => Promise<JsonSchemaValidationResult>;

export interface ToolOutcomeValidationOptions {
  source: "builtin" | "mcp" | "custom";
  toolName: string;
  status?: ToolOutcomeStatus | undefined;
  schema?: Record<string, unknown> | undefined;
  structuredContent?: unknown;
  mayHaveSideEffect?: boolean | undefined;
  effect?: ToolEffectState | undefined;
  retryable?: boolean | undefined;
  codes?: string[] | undefined;
  signal?: AbortSignal | undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

interface StructuralLimits {
  maxBytes: number;
  maxValues: number;
  maxDepth: number;
}

function structuralValueProblem(
  value: unknown,
  label: string,
  limits: StructuralLimits,
): string | null {
  const activeAncestors = new WeakSet<object>();
  const serializedSizes = new WeakMap<object, number>();
  let visited = 0;
  let problem: string | null = null;
  const inspect = (item: unknown, depth: number): number => {
    if (problem) return 0;
    if (depth > limits.maxDepth) {
      problem = `${label} exceeds ${limits.maxDepth} levels.`;
      return 0;
    }
    if (item === null || typeof item === "boolean") {
      return 5;
    }
    if (typeof item === "string") {
      if (item.length > limits.maxBytes) {
        problem = `${label} exceeds ${limits.maxBytes} bytes.`;
        return 0;
      }
      return Buffer.byteLength(item, "utf8") + 2;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        problem = `${label} contains a non-finite number.`;
        return 0;
      }
      return String(item).length;
    }
    if (typeof item !== "object") {
      problem = `${label} contains a non-JSON value.`;
      return 0;
    }
    const cached = serializedSizes.get(item);
    if (cached !== undefined) return cached;
    if (activeAncestors.has(item)) {
      problem = `${label} contains a cycle.`;
      return 0;
    }
    visited += 1;
    if (visited > limits.maxValues) {
      problem = `${label} contains too many values.`;
      return 0;
    }
    activeAncestors.add(item);
    try {
      let size = 2;
      if (Array.isArray(item)) {
        size += Math.max(0, item.length - 1);
        for (const child of item) {
          size += inspect(child, depth + 1);
          if (problem || size > limits.maxBytes) {
            problem ??= `${label} exceeds ${limits.maxBytes} bytes.`;
            return 0;
          }
        }
      } else {
        if (!isPlainRecord(item)) {
          problem = `${label} contains a non-plain object.`;
          return 0;
        }
        const entries = Object.entries(item);
        for (const [key, child] of entries) {
          size += Buffer.byteLength(key, "utf8") + 4;
          size += inspect(child, depth + 1);
          if (problem || size > limits.maxBytes) {
            problem ??= `${label} exceeds ${limits.maxBytes} bytes.`;
            return 0;
          }
        }
      }
      serializedSizes.set(item, size);
      return size;
    } finally {
      activeAncestors.delete(item);
    }
  };
  const size = inspect(value, 0);
  return problem ?? (size > limits.maxBytes ? `${label} exceeds ${limits.maxBytes} bytes.` : null);
}

function schemaProblem(schema: unknown): string | null {
  if (!isPlainRecord(schema)) return "Output schema must be a JSON object.";
  if (
    structuralValueProblem(schema, "Output schema", {
      maxBytes: MAX_SCHEMA_BYTES,
      maxValues: MAX_EXTERNAL_VALUE_COUNT,
      maxDepth: MAX_SCHEMA_DEPTH,
    })
  )
    return "Output schema is not valid bounded JSON.";
  const pending: unknown[] = [schema];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!isPlainRecord(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    for (const referenceKey of ["$ref", "$dynamicRef", "$recursiveRef"]) {
      const reference = value[referenceKey];
      if (
        typeof reference === "string" &&
        !reference.startsWith("#") &&
        !reference.startsWith("#/")
      )
        return "Remote or external JSON Schema references are not allowed.";
    }
    for (const [key, item] of Object.entries(value)) {
      if (
        (key === "$id" || key === "$schema") &&
        typeof item === "string" &&
        /^[a-z][a-z0-9+.-]*:/i.test(item) &&
        !item.startsWith("https://json-schema.org/")
      )
        return "Remote JSON Schema identifiers are not allowed.";
      pending.push(item);
    }
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(schema), "utf8");
  if (serializedBytes > MAX_SCHEMA_BYTES) return `Output schema exceeds ${MAX_SCHEMA_BYTES} bytes.`;
  return null;
}

function schemaDigest(schema: Record<string, unknown>): string | null {
  try {
    return createHash("sha256").update(JSON.stringify(schema)).digest("hex");
  } catch {
    return null;
  }
}

interface SchemaValidationJob {
  id: number;
  digest: string;
  schema: Record<string, unknown>;
  value: unknown;
  signal?: AbortSignal | undefined;
  deadline: number;
  timer?: NodeJS.Timeout | undefined;
  abort?: (() => void) | undefined;
  settled: boolean;
  resolve: (result: JsonSchemaValidationResult) => void;
  reject: (error: Error) => void;
}

interface SchemaValidationWorkerSlot {
  worker: Worker;
  job: SchemaValidationJob | null;
  disposed: boolean;
}

const schemaValidationWorkerSource = `
const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
  const {AjvJsonSchemaValidator}=await import(workerData.validatorUrl);
  const validator=new AjvJsonSchemaValidator();
  const compiled=new Map();
  parentPort.on('message',async(message)=>{
    try{
      let validate=compiled.get(message.digest);
      if(!validate){
        validate=validator.getValidator(message.schema);
        compiled.set(message.digest,validate);
        if(compiled.size>workerData.maxCompiledSchemas){
          compiled.delete(compiled.keys().next().value);
        }
      }
      const result=await validate(message.value);
      parentPort.postMessage({
        id:message.id,
        result:{
          valid:result?.valid===true,
          ...(result?.errorMessage?{error:String(result.errorMessage)}:{})
        }
      });
    }catch(error){
      parentPort.postMessage({
        id:message.id,
        result:{valid:false,error:String(error?.stack||error)}
      });
    }
  });
})().catch(error=>parentPort.postMessage({fatal:String(error?.stack||error)}));
`;

class SchemaValidationWorkerPool {
  private nextId = 1;
  private readonly waiting: SchemaValidationJob[] = [];
  private readonly workers: SchemaValidationWorkerSlot[] = [];

  validate(
    schema: Record<string, unknown>,
    value: unknown,
    signal?: AbortSignal,
  ): Promise<JsonSchemaValidationResult> {
    signal?.throwIfAborted();
    const digest = schemaDigest(schema);
    if (!digest) return Promise.reject(new Error("Output schema cannot be serialized."));
    if (this.waiting.length >= MAX_VALIDATION_QUEUE && !this.hasAvailableWorker())
      return Promise.reject(new Error("Output schema validation queue is full."));
    return new Promise<JsonSchemaValidationResult>((resolve, reject) => {
      const job: SchemaValidationJob = {
        id: this.nextId++,
        digest,
        schema,
        value,
        signal,
        deadline: Date.now() + SCHEMA_VALIDATION_TIMEOUT_MS,
        settled: false,
        resolve,
        reject,
      };
      if (signal) {
        job.abort = () => {
          if (job.settled) return;
          const slot = this.workers.find((candidate) => candidate.job === job);
          if (slot) {
            this.failSlot(slot, new Error("Output schema validation was cancelled."));
            return;
          }
          const index = this.waiting.indexOf(job);
          if (index >= 0) this.waiting.splice(index, 1);
          this.finish(job, new Error("Output schema validation was cancelled."));
        };
        signal.addEventListener("abort", job.abort, { once: true });
      }
      job.timer = setTimeout(() => this.expire(job), Math.max(0, job.deadline - Date.now()));
      this.waiting.push(job);
      this.dispatch();
    });
  }

  private hasAvailableWorker(): boolean {
    return (
      this.workers.some((slot) => !slot.disposed && slot.job === null) ||
      this.workers.filter((slot) => !slot.disposed).length < MAX_VALIDATION_WORKERS
    );
  }

  private dispatch(): void {
    while (this.waiting.length) {
      let slot = this.workers.find((candidate) => !candidate.disposed && candidate.job === null);
      if (
        !slot &&
        this.workers.filter((candidate) => !candidate.disposed).length < MAX_VALIDATION_WORKERS
      )
        slot = this.createSlot();
      if (!slot) return;
      const job = this.waiting.shift();
      if (!job) return;
      if (job.settled) continue;
      if (job.signal?.aborted) {
        this.finish(job, new Error("Output schema validation was cancelled."));
        continue;
      }
      if (Date.now() >= job.deadline) {
        this.finish(job, new Error("Output schema validation timed out."));
        continue;
      }
      slot.job = job;
      try {
        slot.worker.postMessage({
          id: job.id,
          digest: job.digest,
          schema: job.schema,
          value: job.value,
        });
      } catch (error) {
        this.failSlot(
          slot,
          new Error(`Output schema validator could not accept the task: ${errorText(error)}`),
        );
      }
    }
  }

  private createSlot(): SchemaValidationWorkerSlot | undefined {
    try {
      const worker = new Worker(schemaValidationWorkerSource, {
        eval: true,
        workerData: {
          validatorUrl: pathToFileURL(
            runtimeRequire.resolve("@modelcontextprotocol/sdk/validation/ajv"),
          ).href,
          maxCompiledSchemas: MAX_COMPILED_SCHEMA_CACHE,
        },
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      });
      worker.unref();
      const slot: SchemaValidationWorkerSlot = { worker, job: null, disposed: false };
      worker.on("message", (message) => this.handleMessage(slot, message));
      worker.on("error", (error) =>
        this.failSlot(slot, new Error(`Output schema validator failed: ${errorText(error)}`)),
      );
      worker.on("exit", (code) => {
        if (slot.disposed) return;
        this.failSlot(slot, new Error(`Output schema validator exited (${code}).`));
      });
      this.workers.push(slot);
      return slot;
    } catch (error) {
      const job = this.waiting.shift();
      if (job)
        this.finish(job, new Error(`Output schema validator unavailable: ${errorText(error)}`));
      return undefined;
    }
  }

  private handleMessage(slot: SchemaValidationWorkerSlot, message: unknown): void {
    if (!isPlainRecord(message)) {
      this.failSlot(slot, new Error("Output schema validator returned an invalid message."));
      return;
    }
    if (typeof message.fatal === "string") {
      this.failSlot(slot, new Error(boundedValidationError(message.fatal)));
      return;
    }
    const job = slot.job;
    if (!job || message.id !== job.id) return;
    const result = isPlainRecord(message.result) ? message.result : null;
    this.releaseSlot(slot);
    if (!result) {
      this.finish(job, new Error("Output schema validator returned no result."));
      return;
    }
    const boundedError = boundedValidationError(
      typeof result.error === "string" ? result.error : undefined,
    );
    this.finish(job, undefined, {
      valid: result.valid === true,
      ...(boundedError === undefined ? {} : { error: boundedError }),
    });
  }

  private expire(job: SchemaValidationJob): void {
    if (job.settled) return;
    const slot = this.workers.find((candidate) => candidate.job === job);
    const error = new Error("Output schema validation timed out.");
    if (slot) {
      this.failSlot(slot, error);
      return;
    }
    const index = this.waiting.indexOf(job);
    if (index >= 0) this.waiting.splice(index, 1);
    this.finish(job, error);
  }

  private failSlot(slot: SchemaValidationWorkerSlot, error: Error): void {
    if (slot.disposed) return;
    slot.disposed = true;
    const job = slot.job;
    slot.job = null;
    const index = this.workers.indexOf(slot);
    if (index >= 0) this.workers.splice(index, 1);
    void slot.worker.terminate().catch(() => undefined);
    if (job) this.finish(job, error);
    this.dispatch();
  }

  private releaseSlot(slot: SchemaValidationWorkerSlot): void {
    slot.job = null;
    this.dispatch();
  }

  private finish(
    job: SchemaValidationJob,
    error?: Error,
    result?: JsonSchemaValidationResult,
  ): void {
    if (job.settled) return;
    job.settled = true;
    if (job.timer) clearTimeout(job.timer);
    if (job.abort && job.signal) job.signal.removeEventListener("abort", job.abort);
    const slot = this.workers.find((candidate) => candidate.job === job);
    if (slot) slot.job = null;
    if (error) job.reject(error);
    else
      job.resolve(result ?? { valid: false, error: "Output schema validator returned no result." });
    this.dispatch();
  }
}

const schemaValidationPool = new SchemaValidationWorkerPool();

export async function validateJsonSchemaValue(
  schema: Record<string, unknown>,
  value: unknown,
  signal?: AbortSignal,
): Promise<JsonSchemaValidationResult> {
  signal?.throwIfAborted();
  const problem = schemaProblem(schema);
  if (problem) return { valid: false, error: problem };
  const valueProblem = structuralValueProblem(value, "Structured output", {
    maxBytes: MAX_EXTERNAL_VALUE_BYTES,
    maxValues: MAX_EXTERNAL_VALUE_COUNT,
    maxDepth: MAX_SCHEMA_DEPTH,
  });
  if (valueProblem) return { valid: false, error: valueProblem };
  return await schemaValidationPool.validate(schema, value, signal);
}

export async function validateBuiltinToolEnvelope(
  value: unknown,
  signal?: AbortSignal,
): Promise<JsonSchemaValidationResult> {
  signal?.throwIfAborted();
  const problem = structuralValueProblem(value, "Built-in tool result", {
    maxBytes: MAX_BUILTIN_VALUE_BYTES,
    maxValues: MAX_BUILTIN_VALUE_COUNT,
    maxDepth: MAX_SCHEMA_DEPTH,
  });
  if (problem) return { valid: false, error: problem };
  return await schemaValidationPool.validate(BUILTIN_TOOL_ENVELOPE_SCHEMA, value, signal);
}

function boundedValidationError(error: string | undefined): string | undefined {
  return error?.slice(0, 4_000);
}

function fallbackStatus(result: ToolOutcomeSource): ToolOutcomeStatus {
  if (result.cleanupUnconfirmed) return "unverified";
  if (result.isError && /\b(?:denied|cancelled|aborted)\b/i.test(result.output))
    return /cancel|abort/i.test(result.output) ? "cancelled" : "denied";
  return result.isError ? "failed" : "success";
}

function fallbackEffect(
  result: ToolOutcomeSource,
  options: ToolOutcomeValidationOptions,
): ToolEffectState {
  if (options.effect) return options.effect;
  if (result.cleanupUnconfirmed) return "uncertain";
  if (!options.mayHaveSideEffect) return "none";
  return result.isError ? "uncertain" : "confirmed";
}

function reportedHashes(result: unknown): string[] {
  const hashes = new Set<string>();
  const pending: unknown[] = [result];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") {
      if (typeof value === "string" && /^[a-f0-9]{64}$/i.test(value))
        hashes.add(value.toLowerCase());
      continue;
    }
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      pending.push(...value.slice(0, 1_000));
      continue;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
      if (
        /(?:^|_)(?:hash|sha256)$/i.test(key) ||
        /(?:fileHash|artifactHash|finalHash|fileHashes)$/i.test(key)
      )
        pending.push(item);
    }
  }
  return [...hashes];
}

function validationFor(options: ToolOutcomeValidationOptions): ToolOutputValidation {
  if (options.source !== "builtin" && !options.schema) {
    return { status: "not_declared", source: options.source };
  }
  return { status: "unverified", source: options.source };
}

export class ToolOutcomeService {
  constructor(
    private readonly schemaValidator: JsonSchemaValueValidator = validateJsonSchemaValue,
    private readonly builtinValidator: BuiltinToolEnvelopeValidator = validateBuiltinToolEnvelope,
  ) {}

  async normalize<T extends ToolOutcomeSource>(
    result: T,
    options: ToolOutcomeValidationOptions,
  ): Promise<NormalizedToolResult> {
    const codes = [...new Set(options.codes ?? [])];
    const evidence: ToolOutcome["evidence"] = [];
    let validation = validationFor(options);
    let builtinValidationExpected = false;
    let declaredValidationExpected = false;
    const normalized = result;

    if (options.source === "builtin") {
      builtinValidationExpected = true;
      try {
        const checked = await this.builtinValidator(result, options.signal);
        validation = checked.valid
          ? { status: "validated", source: "builtin" }
          : {
              status: "invalid",
              source: "builtin",
              error: boundedValidationError(
                checked.error ?? "Built-in tool result did not match the host execution envelope.",
              ),
            };
        if (checked.valid) {
          evidence.push({
            kind: "tool-envelope",
            summary: "Built-in tool result matched the host execution envelope.",
          });
        } else {
          codes.push("INVALID_TOOL_ENVELOPE");
          evidence.push({
            kind: "tool-envelope",
            summary: "Built-in tool result did not match the host execution envelope.",
          });
        }
      } catch (error) {
        validation = {
          status: "unverified",
          source: "builtin",
          error: errorText(error).slice(0, 4_000),
        };
        codes.push(
          options.signal?.aborted
            ? "OUTPUT_VALIDATION_CANCELLED"
            : "TOOL_ENVELOPE_VALIDATION_UNAVAILABLE",
        );
        evidence.push({
          kind: "tool-envelope",
          summary: "Built-in tool result could not be checked by the bounded host validator.",
        });
      }
    } else if (options.schema) {
      declaredValidationExpected = true;
      if (options.structuredContent === undefined) {
        validation = {
          status: "invalid",
          source: options.source,
          error: "A structured output schema was declared but structuredContent was missing.",
        };
        codes.push("INVALID_OUTPUT");
      } else {
        try {
          const checked = await this.schemaValidator(
            options.schema,
            options.structuredContent,
            options.signal,
          );
          validation = checked.valid
            ? { status: "validated", source: options.source }
            : {
                status: "invalid",
                source: options.source,
                error: boundedValidationError(
                  checked.error ?? "Structured output did not match schema.",
                ),
              };
          if (!checked.valid) codes.push("INVALID_OUTPUT");
          const digest = schemaDigest(options.schema);
          evidence.push({
            kind: "output-schema",
            summary: checked.valid
              ? "Structured output matched the declared schema."
              : "Structured output did not match the declared schema.",
            ...(digest ? { digest } : {}),
          });
        } catch (error) {
          validation = {
            status: "unverified",
            source: options.source,
            error: errorText(error).slice(0, 4_000),
          };
          codes.push(
            options.signal?.aborted
              ? "OUTPUT_VALIDATION_CANCELLED"
              : "OUTPUT_VALIDATION_UNAVAILABLE",
          );
        }
      }
    }

    const invalid = validation.status === "invalid";
    const validationUnavailable =
      (builtinValidationExpected || declaredValidationExpected) &&
      validation.status === "unverified";
    const commandRunning =
      isPlainRecord(result.commandSession) && result.commandSession.running === true;
    const status = invalid
      ? "failed"
      : validationUnavailable
        ? options.signal?.aborted
          ? "cancelled"
          : "unverified"
        : options.signal?.aborted && options.status === undefined
          ? "cancelled"
          : (options.status ?? (commandRunning ? "partial" : fallbackStatus(result)));
    const reportedEffect = fallbackEffect(normalized, options);
    const effect =
      (invalid || validationUnavailable || status === "cancelled") &&
      reportedEffect !== "none" &&
      options.mayHaveSideEffect
        ? "uncertain"
        : reportedEffect;
    if (effect === "uncertain") codes.push("SIDE_EFFECT_UNCERTAIN");
    evidence.push({
      kind: "side-effect",
      summary:
        effect === "none"
          ? "No side effect was expected for this execution."
          : effect === "confirmed"
            ? "The tool reported completion; external state was not independently certified."
            : "Side effects may have occurred and require inspection before retrying.",
    });
    for (const digest of reportedHashes(result)) {
      evidence.push({
        kind: "artifact-hash",
        summary:
          "The tool reported an artifact digest; this is evidence, not an independent file check.",
        digest,
      });
    }
    if (typeof result.fullOutput === "string")
      evidence.push({
        kind: "recovery",
        summary:
          "A larger internal output capture is available for bounded host-side retention and recovery.",
      });
    if (result.cleanupUnconfirmed) codes.push("CLEANUP_UNCONFIRMED");
    const outcome: ToolOutcome = {
      output: normalized.output,
      isError: invalid || validationUnavailable || status === "cancelled" || result.isError,
      status,
      effect,
      retryable: options.retryable === true,
      codes: [...new Set(codes)],
      validation,
      evidence,
    };
    return withToolOutcome(outcome);
  }
}
