import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeContext } from "./runtime-context";
import { runtimeContextSchema } from "./runtime-context";

const CORE_PROMPT_ORDER = ["safety", "core", "tools", "coding"] as const;
const RUNTIME_PLACEHOLDER = "{{RUNTIME_CONTEXT_JSON}}";

export interface PromptAssemblyInput {
  promptDirectory: string;
  runtime: RuntimeContext;
  userSystemPrompt?: string;
  projectInstructions?: string;
  extensionContext?: string;
  agentDepth: 0 | 1;
  compactRuntime?: boolean;
  includeCoding?: boolean;
}

export interface PromptBundle {
  system: string;
  safety: string;
  core: string;
  runtime: string;
}

function normalizePrompt(value: string, filename: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Prompt file is empty: ${filename}`);
  }

  return normalized;
}

export async function readPromptFile(promptDirectory: string, name: string): Promise<string> {
  const filename = `${name}.md`;
  const content = await readFile(join(promptDirectory, filename), "utf8");
  return normalizePrompt(content, filename);
}

function renderRuntimePrompt(template: string, runtime: RuntimeContext, compact = false): string {
  if (!template.includes(RUNTIME_PLACEHOLDER)) {
    throw new Error("Runtime prompt is missing the runtime context placeholder");
  }

  // Tracing IDs stay in the host. A fresh turn ID here invalidates every history cache prefix.
  const { session_id: _sessionId, turn_id: _turnId, ...modelFacts } = runtime;
  const serialized = JSON.stringify(modelFacts, null, compact ? undefined : 2).replaceAll(
    "<",
    "\\u003c",
  );
  return template.replace(RUNTIME_PLACEHOLDER, serialized);
}

function optionalSection(title: string, body: string | undefined): string | null {
  if (!body?.trim()) {
    return null;
  }

  return `# ${title}\n\n${body.trim()}`;
}

export async function assembleSystemPrompt(input: PromptAssemblyInput): Promise<PromptBundle> {
  const runtime = runtimeContextSchema.parse(input.runtime);

  if (runtime.agent_depth !== input.agentDepth) {
    throw new Error("Runtime agent depth does not match the requested prompt mode");
  }

  const [safety, core, tools, coding, runtimeTemplate] = await Promise.all([
    readPromptFile(input.promptDirectory, "safety"),
    readPromptFile(input.promptDirectory, "core"),
    readPromptFile(input.promptDirectory, "tools"),
    readPromptFile(input.promptDirectory, "coding"),
    readPromptFile(input.promptDirectory, "runtime"),
  ]);

  const rolePrompt =
    input.agentDepth === 1 ? await readPromptFile(input.promptDirectory, "subagent") : null;
  const runtimePrompt = renderRuntimePrompt(runtimeTemplate, runtime, input.compactRuntime);

  const sections = [
    safety,
    core,
    tools,
    input.includeCoding === false ? null : coding,
    rolePrompt,
    optionalSection("用户的会话系统提示", input.userSystemPrompt),
    optionalSection("项目指令", input.projectInstructions),
    optionalSection("当前会话选择的 Skills 与 Plugins", input.extensionContext),
    runtimePrompt,
  ].filter((section): section is string => Boolean(section));

  return {
    system: sections.join("\n\n---\n\n"),
    safety,
    core,
    runtime: runtimePrompt,
  };
}

export const promptOrder = CORE_PROMPT_ORDER;
