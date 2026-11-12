import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import type { CustomToolView, SessionView } from "../../shared/domain";
import type { StreamToolDefinition } from "../providers/model-stream";
import type { Repository } from "../storage/repository";

const MAX_TOOL_FILE_BYTES = 500_000;
const MAX_TOOLS = 100;
const MAX_CUSTOM_TOOL_OUTPUT = 100_000;
const TOOL_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
const PROJECT_TOOL_DIRECTORIES = [
  ".opencode/tools",
  ".opencode/tool",
  ".mingshen/tools",
  ".mingshen/tool",
];
const GLOBAL_TOOL_DIRECTORIES = [
  ".config/opencode/tools",
  ".config/opencode/tool",
  ".mingshen/tools",
  ".mingshen/tool",
];

interface CustomToolContext {
  session: SessionView;
  messageId: string;
  signal?: AbortSignal;
}

interface LoadedCustomTool {
  name: string;
  description: string;
  sourcePath: string;
  exportName?: string | null;
  schema: z.ZodType;
  execute: (args: Record<string, unknown>, context: Record<string, unknown>) => unknown;
}

interface LoadedToolFile {
  hash: string;
  tools: LoadedCustomTool[];
  error: string | null;
}

const runtimeRequire = createRequire(join(process.cwd(), "mingshen-runtime.cjs"));

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function customToolName(file: string, exportName?: string): string {
  const stem = basename(file, extname(file))
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const exportPart = exportName
    ?.toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return [stem || "tool", exportPart].filter(Boolean).join("_").slice(0, 48);
}

async function toolFiles(root: string, output: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 12 || output.length >= MAX_TOOLS) return output;
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (output.length >= MAX_TOOLS) break;
      if (
        entry.name === ".mingshen-runtime-cache" ||
        entry.name === "node_modules" ||
        entry.isSymbolicLink()
      )
        continue;
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        await toolFiles(path, output, depth + 1);
      } else if (
        entry.isFile() &&
        TOOL_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase("en-US"))
      ) {
        output.push(path);
      }
    }
  } catch {
    return output;
  }
  return output.sort((left, right) => left.localeCompare(right, "en"));
}

async function loadModule(
  source: string,
  file: string,
  hash: string,
): Promise<Record<string, unknown>> {
  const zodUrl = pathToFileURL(runtimeRequire.resolve("zod")).href;
  const transformed = stripTypeScriptTypes(source, {
    mode: "strip",
    sourceUrl: file,
  })
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*["']@opencode-ai\/plugin["'];?/g,
      (_match, names: string) =>
        `const { ${names.replace(/\bas\b/g, ":")} } = globalThis.__mingshenCustomToolRuntime;`,
    )
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*["']zod["'];?/g,
      `import { $1 } from ${JSON.stringify(zodUrl)};`,
    )
    .replace(/import\s+z\s+from\s*["']zod["'];?/g, `import z from ${JSON.stringify(zodUrl)};`);
  const cacheDirectory = join(dirname(file), ".mingshen-runtime-cache");
  await mkdir(cacheDirectory, { recursive: true });
  const modulePath = join(cacheDirectory, `${hash.slice(0, 24)}-${randomUUID()}.mjs`);
  await writeFile(modulePath, transformed, "utf8");
  try {
    return await new Promise<Record<string, unknown>>((done, reject) => {
      const worker = new Worker(
        `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {z}=await import(workerData.zodUrl);const tool=Object.assign(x=>x,{schema:z});globalThis.__mingshenCustomToolRuntime={tool,z};const exports=await import(workerData.url);const out={};for(const [key,value]of Object.entries(exports)){if(value&&typeof value==='object'&&typeof value.execute==='function')out[key]={description:value.description,parameters:z.toJSONSchema(z.object(value.args||{}))};}parentPort.postMessage(out);})().catch(error=>{throw error});`,
        { eval: true, workerData: { url: pathToFileURL(modulePath).href, zodUrl } },
      );
      let settled = false;
      const finish = async (error: unknown, value?: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await worker.terminate();
        if (error) reject(error);
        else done(value ?? {});
      };
      const timer = setTimeout(
        () => void finish(new Error("Custom tool metadata worker timed out.")),
        10000,
      );
      worker.once(
        "message",
        (value) =>
          void finish(
            null,
            Object.fromEntries(
              Object.entries(value as Record<string, object>).map(([key, item]) => [
                key,
                {
                  ...item,
                  execute: () => {
                    throw new Error("Custom tools must execute in a managed worker.");
                  },
                },
              ]),
            ),
          ),
      );
      worker.once("error", (error) => void finish(error));
      worker.once("exit", (code) => {
        if (!settled) void finish(new Error(`Custom metadata worker exited (${code}).`));
      });
    });
  } finally {
    await unlink(modulePath).catch(() => undefined);
  }
}

function normalizeTool(
  file: string,
  exportName: string | null,
  value: unknown,
): LoadedCustomTool | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.execute !== "function") {
    return null;
  }
  const args = record.parameters
    ? z.fromJSONSchema(record.parameters as z.core.JSONSchema.JSONSchema)
    : record.args && typeof record.args === "object" && !Array.isArray(record.args)
      ? z.object(record.args as z.ZodRawShape)
      : z.object({});
  return {
    name: customToolName(file, exportName ?? undefined),
    description:
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : "OpenCode-compatible custom tool",
    sourcePath: file,
    exportName,
    schema: args,
    execute: record.execute as LoadedCustomTool["execute"],
  };
}

function parametersFor(schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema) as Record<string, unknown>;
  } catch {
    return { type: "object", additionalProperties: true };
  }
}

function outputText(value: unknown): string {
  if (typeof value === "string") {
    return value.slice(0, MAX_CUSTOM_TOOL_OUTPUT);
  }
  if (value === undefined || value === null) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2).slice(0, MAX_CUSTOM_TOOL_OUTPUT);
  } catch {
    return String(value).slice(0, MAX_CUSTOM_TOOL_OUTPUT);
  }
}

export class CustomToolService {
  private readonly cache = new Map<string, LoadedToolFile>();

  constructor(private readonly repository: Repository) {}

  async list(workspacePath: string | null): Promise<CustomToolView[]> {
    const loaded = await this.load(workspacePath, false);
    return loaded.flatMap((entry) =>
      entry.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        sourcePath: tool.sourcePath,
        available: !entry.error,
        error: entry.error,
      })),
    );
  }

  async descriptors(workspacePath: string | null): Promise<StreamToolDefinition[]> {
    const loaded = await this.load(workspacePath, true);
    return loaded.flatMap((entry) =>
      entry.tools.map((tool) => ({
        name: tool.name,
        description: `[Custom tool] ${tool.description}`,
        parameters: parametersFor(tool.schema),
      })),
    );
  }

  async has(name: string, workspacePath: string | null): Promise<boolean> {
    // Discovery already loaded authorized descriptors. Never execute changed modules just to test membership.
    const files = new Set((await this.list(workspacePath)).map((tool) => tool.sourcePath));
    return [...this.cache.entries()].some(
      ([path, entry]) => files.has(path) && entry.tools.some((tool) => tool.name === name),
    );
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: CustomToolContext,
  ): Promise<{ output: string; isError: boolean }> {
    const loaded = await this.load(context.session.workspacePath, true);
    const tool = loaded
      .flatMap((entry) => entry.tools)
      .find((candidate) => candidate.name === name);
    if (!tool) {
      return { output: `自定义工具不存在或不可用：${name}`, isError: true };
    }
    try {
      const parsed = tool.schema.parse(args);
      context.signal?.throwIfAborted();
      const source = await readFile(tool.sourcePath, "utf8");
      const zodUrl = pathToFileURL(runtimeRequire.resolve("zod")).href;
      const transformed = stripTypeScriptTypes(source, {
        mode: "strip",
        sourceUrl: tool.sourcePath,
      })
        .replace(
          /import\s*\{([^}]*)\}\s*from\s*["']@opencode-ai\/plugin["'];?/g,
          (_match, names: string) =>
            `const { ${names.replace(/\bas\b/g, ":")} } = globalThis.__mingshenCustomToolRuntime;`,
        )
        .replace(
          /import\s*\{([^}]*)\}\s*from\s*["']zod["'];?/g,
          `import { $1 } from ${JSON.stringify(zodUrl)};`,
        )
        .replace(/import\s+z\s+from\s*["']zod["'];?/g, `import z from ${JSON.stringify(zodUrl)};`);
      const directory = join(dirname(tool.sourcePath), ".mingshen-runtime-cache");
      await mkdir(directory, { recursive: true });
      const modulePath = join(
        directory,
        `${createHash("sha256").update(source).digest("hex").slice(0, 24)}-${randomUUID()}-execute.mjs`,
      );
      await writeFile(modulePath, transformed, "utf8");
      const result = await new Promise<unknown>((done, reject) => {
        const worker = new Worker(
          `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {z}=await import(workerData.zodUrl);const tool=Object.assign(x=>x,{schema:z});globalThis.__mingshenCustomToolRuntime={tool,z};const exports=await import(workerData.url);const definition=exports[workerData.exportName||'default'];const result=await definition.execute(workerData.args,workerData.context);parentPort.postMessage({ok:true,result});})().catch(error=>parentPort.postMessage({ok:false,error:String(error?.stack||error)}));`,
          {
            eval: true,
            workerData: {
              url: pathToFileURL(modulePath).href,
              zodUrl,
              exportName: tool.exportName,
              args: parsed,
              context: {
                agent: context.session.agentProfileId,
                sessionID: context.session.id,
                messageID: context.messageId,
                directory: context.session.workspacePath ?? process.cwd(),
                worktree: context.session.workspacePath ?? process.cwd(),
              },
            },
          },
        );
        let settled = false;
        const finish = async (error: unknown, value?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          context.signal?.removeEventListener("abort", abort);
          await worker.terminate();
          await unlink(modulePath).catch(() => undefined);
          if (error) reject(error);
          else done(value);
        };
        const abort = () =>
          void finish(
            new Error(
              "EXTENSION_OUTCOME_UNCERTAIN: Custom tool cancelled; worker terminated. Inspect any external effects before retrying.",
            ),
          );
        const timer = setTimeout(
          () =>
            void finish(
              new Error(
                "EXTENSION_OUTCOME_UNCERTAIN: Custom tool timed out (120 seconds); inspect any external effects before retrying.",
              ),
            ),
          120000,
        );
        worker.once(
          "message",
          (message) => void finish(message.ok ? null : new Error(message.error), message.result),
        );
        worker.once(
          "error",
          (error) => void finish(new Error(`EXTENSION_OUTCOME_UNCERTAIN: ${errorText(error)}`)),
        );
        worker.once("exit", (code) => {
          if (!settled) void finish(new Error(`Custom tool worker exited (${code}).`));
        });
        context.signal?.addEventListener("abort", abort, { once: true });
        if (context.signal?.aborted) abort();
      });
      return { output: outputText(result), isError: false };
    } catch (error) {
      return { output: errorText(error), isError: true };
    }
  }

  private async load(
    workspacePath: string | null,
    trustedOnly: boolean,
  ): Promise<LoadedToolFile[]> {
    const projectTrusted = workspacePath ? this.repository.isProjectTrusted(workspacePath) : false;
    const roots = [
      ...GLOBAL_TOOL_DIRECTORIES.map((directory) => ({
        path: join(homedir(), directory),
        trusted: true,
      })),
      ...(workspacePath
        ? PROJECT_TOOL_DIRECTORIES.map((directory) => ({
            path: join(workspacePath, directory),
            trusted: projectTrusted,
          }))
        : []),
    ];
    const files = (
      await Promise.all(
        roots.map(async (root) => {
          const discovered = await toolFiles(root.path);
          return discovered.map((file) => ({
            file,
            trusted: root.trusted,
          }));
        }),
      )
    ).flat();
    const loaded: LoadedToolFile[] = [];
    for (const item of files.slice(0, MAX_TOOLS)) {
      if (!item.trusted) {
        if (!trustedOnly) {
          loaded.push({
            hash: "",
            tools: [],
            error: "项目未信任，未加载自定义工具。",
          });
        }
        continue;
      }
      try {
        if (!trustedOnly) {
          loaded.push({
            hash: "",
            error: null,
            tools: [
              {
                name: customToolName(item.file),
                description: "Custom tool (loaded only during an authorized Full Access run)",
                sourcePath: item.file,
                schema: z.object({}),
                execute: async () => "",
              },
            ],
          });
          continue;
        }
        const source = await readFile(item.file, "utf8");
        if (Buffer.byteLength(source, "utf8") > MAX_TOOL_FILE_BYTES) {
          throw new Error("自定义工具文件超过 500 KB。");
        }
        const hash = createHash("sha256").update(source).digest("hex");
        const cached = this.cache.get(item.file);
        if (cached?.hash === hash) {
          loaded.push(cached);
          continue;
        }
        const exported = await loadModule(source, item.file, hash);
        const tools: LoadedCustomTool[] = [];
        const defaultTool = normalizeTool(item.file, null, exported.default);
        if (defaultTool) {
          tools.push(defaultTool);
        }
        for (const [exportName, value] of Object.entries(exported)) {
          if (exportName === "default" || exportName === "__esModule") {
            continue;
          }
          const named = normalizeTool(item.file, exportName, value);
          if (named) {
            tools.push(named);
          }
        }
        const entry = { hash, tools, error: null };
        this.cache.set(item.file, entry);
        loaded.push(entry);
      } catch (error) {
        loaded.push({ hash: "", tools: [], error: errorText(error) });
      }
    }
    return loaded;
  }
}
