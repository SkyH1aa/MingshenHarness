import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { MAX_TOOL_ROUNDS } from "../../shared/agent-limits";
import { ADDITIONAL_BUILTIN_AGENTS } from "../../shared/builtin-agents";
import type {
  AgentPermissionMap,
  AgentProfileRole,
  AgentProfileSaveInput,
  AgentProfileView,
} from "../../shared/domain";
import type { Repository } from "../storage/repository";

const AGENT_DIRECTORIES = [".mingshen/agents", ".opencode/agents"];
const AGENT_ALIAS_DIRECTORIES = [".mingshen/agent", ".opencode/agent"];

async function exists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

async function markdownFiles(root: string, output: string[] = []): Promise<string[]> {
  if (!(await exists(root))) {
    return output;
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      await markdownFiles(fullPath, output);
    } else if (entry.isFile() && /\.(?:md|mdx)$/i.test(entry.name)) {
      output.push(fullPath);
    }
  }
  return output.sort((left, right) => left.localeCompare(right, "en"));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];
    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        output += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (!inString && current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!inString && current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    output += current;
    if (escaped) {
      escaped = false;
    } else if (current === "\\" && inString) {
      escaped = true;
    } else if (current === '"') {
      inString = !inString;
    }
  }
  return output;
}

async function readJsonConfig(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(stripJsonComments(await readFile(path, "utf8")));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function configRole(value: unknown): AgentProfileRole {
  if (value === "primary" || value === "plan" || value === "subagent" || value === "all") {
    return value;
  }
  return "all";
}

async function configPrompt(value: unknown, configPath: string): Promise<string> {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const fileMatch = /^\{file:([^}]+)\}$/.exec(value.trim());
  if (!fileMatch?.[1]) {
    return value.trim();
  }
  const path = isAbsolute(fileMatch[1]) ? fileMatch[1] : resolve(dirname(configPath), fileMatch[1]);
  try {
    return (await readFile(path, "utf8")).trim().slice(0, 40_000);
  } catch {
    return "";
  }
}

function frontmatter(markdown: string): {
  metadata: Record<string, unknown>;
  instructions: string;
} {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/.exec(markdown);
  if (!match?.[1]) {
    return { metadata: {}, instructions: markdown.trim() };
  }
  try {
    const parsed: unknown = parseYaml(match[1]);
    return {
      metadata:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
      instructions: markdown.slice(match[0].length).trim(),
    };
  } catch {
    return { metadata: {}, instructions: markdown.trim() };
  }
}

function normalizePermissions(value: unknown): AgentPermissionMap {
  if (typeof value === "string") {
    return ["allow", "ask", "deny"].includes(value)
      ? { "*": value as AgentPermissionMap[string] }
      : {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const output: AgentPermissionMap = {};
  const walk = (prefix: string, entry: unknown) => {
    if (entry === "allow" || entry === "ask" || entry === "deny") {
      output[prefix || "*"] = entry;
      return;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    for (const [key, child] of Object.entries(entry as Record<string, unknown>)) {
      walk(prefix ? `${prefix}:${key}` : key, child);
    }
  };
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    walk(key, entry);
  }
  return output;
}

function normalize(input: AgentProfileSaveInput): AgentProfileSaveInput {
  const name = input.name.trim();
  const description = input.description.trim();
  const instructions = input.instructions.trim();
  if (!name || name.length > 80) {
    throw new Error("Agent 名称长度必须为 1 到 80 个字符。");
  }
  if (description.length > 500) {
    throw new Error("Agent 描述不能超过 500 个字符。");
  }
  if (instructions.length > 40_000) {
    throw new Error("Agent 指令不能超过 40,000 个字符。");
  }
  if (
    input.maxSteps != null &&
    (!Number.isInteger(input.maxSteps) || input.maxSteps < 1 || input.maxSteps > MAX_TOOL_ROUNDS)
  )
    throw new Error("最大工具轮次必须为 1 到 10000 的整数。");
  return {
    ...input,
    name,
    description,
    instructions,
    modelId: input.modelId?.trim() || null,
  };
}

export class AgentProfileService {
  constructor(private readonly repository: Repository) {
    for (const profile of ADDITIONAL_BUILTIN_AGENTS) {
      if (!repository.getAgentProfile(profile.id)) {
        repository.saveAgentProfile({ ...profile, modelId: null, builtin: true });
      }
    }
  }

  list(): AgentProfileView[] {
    return this.repository.listAgentProfiles();
  }

  async syncWorkspace(workspacePath: string | null): Promise<void> {
    if (!workspacePath) {
      return;
    }
    const roots = [
      join(homedir(), ".config", "opencode", "agents"),
      join(homedir(), ".config", "opencode", "agent"),
      join(homedir(), ".mingshen", "agents"),
      join(homedir(), ".mingshen", "agent"),
      ...[...AGENT_DIRECTORIES, ...AGENT_ALIAS_DIRECTORIES].map((directory) =>
        join(workspacePath, directory),
      ),
    ];
    const files = (await Promise.all(roots.map((root) => markdownFiles(root)))).flat();
    const models = this.repository.listProviders().flatMap((provider) => provider.models);
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const parsed = frontmatter(content);
      const metadata = parsed.metadata;
      const mode = typeof metadata.mode === "string" ? metadata.mode : "subagent";
      const role: AgentProfileRole = mode === "primary" ? "primary" : "subagent";
      const permissions = normalizePermissions(metadata.permission);
      const tools =
        metadata.tools && typeof metadata.tools === "object" && !Array.isArray(metadata.tools)
          ? Object.fromEntries(
              Object.entries(metadata.tools as Record<string, unknown>).filter(
                (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
              ),
            )
          : {};
      const toolAllowlist = Object.entries(tools)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
      const modelValue = typeof metadata.model === "string" ? metadata.model.trim() : "";
      const model = models.find(
        (item) =>
          item.id === modelValue ||
          item.modelId === modelValue ||
          modelValue.endsWith(`/${item.modelId}`),
      );
      const hash = createHash("sha256").update(content).digest("hex");
      const existing = this.repository.findAgentProfileBySource(file);
      this.repository.saveAgentProfile({
        ...(existing ? { id: existing.id } : {}),
        name:
          (typeof metadata.name === "string" && metadata.name.trim()) ||
          file
            .split(/[\\/]/)
            .at(-1)
            ?.replace(/\.(?:md|mdx)$/i, "") ||
          "Agent",
        description: typeof metadata.description === "string" ? metadata.description.trim() : "",
        role,
        instructions: parsed.instructions,
        modelId: model?.id ?? existing?.modelId ?? null,
        readOnly:
          permissions.edit === "deny" ||
          permissions.write === "deny" ||
          permissions["*"] === "deny",
        enabled: metadata.disable !== true,
        hidden: metadata.hidden === true,
        sourcePath: file,
        contentHash: hash,
        permissions,
        toolAllowlist,
        temperature: typeof metadata.temperature === "number" ? metadata.temperature : null,
        topP: typeof metadata.top_p === "number" ? metadata.top_p : null,
        maxSteps: typeof metadata.steps === "number" ? metadata.steps : null,
        color: typeof metadata.color === "string" ? metadata.color : null,
      });
    }

    const configCandidates = [
      join(homedir(), ".config", "opencode", "opencode.json"),
      join(homedir(), ".config", "opencode", "opencode.jsonc"),
      join(homedir(), ".config", "opencode", "config.json"),
      join(homedir(), ".config", "opencode", "config.jsonc"),
      join(homedir(), ".mingshen", "config.json"),
      join(homedir(), ".mingshen", "config.jsonc"),
      join(workspacePath, "opencode.json"),
      join(workspacePath, "opencode.jsonc"),
      join(workspacePath, ".opencode", "opencode.json"),
      join(workspacePath, ".opencode", "opencode.jsonc"),
      join(workspacePath, ".mingshen", "config.json"),
      join(workspacePath, ".mingshen", "config.jsonc"),
    ];
    for (const file of configCandidates) {
      if (!(await fileExists(file))) {
        continue;
      }
      const config = await readJsonConfig(file);
      const agentMap =
        config?.agent && typeof config.agent === "object" && !Array.isArray(config.agent)
          ? (config.agent as Record<string, unknown>)
          : {};
      for (const [name, raw] of Object.entries(agentMap)) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          continue;
        }
        const entry = raw as Record<string, unknown>;
        const sourcePath = `${file}#agent:${name}`;
        const permissions = normalizePermissions(entry.permission);
        if (entry.tools && typeof entry.tools === "object" && !Array.isArray(entry.tools)) {
          for (const [toolName, enabled] of Object.entries(
            entry.tools as Record<string, unknown>,
          )) {
            if (typeof enabled === "boolean") {
              permissions[toolName] = enabled ? "allow" : "deny";
            }
          }
        }
        const toolAllowlist = Object.entries(
          entry.tools && typeof entry.tools === "object" && !Array.isArray(entry.tools)
            ? (entry.tools as Record<string, unknown>)
            : {},
        )
          .filter(([, enabled]) => enabled === true)
          .map(([toolName]) => toolName);
        const modelValue = typeof entry.model === "string" ? entry.model.trim() : "";
        const model = models.find(
          (item) =>
            item.id === modelValue ||
            item.modelId === modelValue ||
            modelValue.endsWith(`/${item.modelId}`),
        );
        const instructions = await configPrompt(entry.prompt, file);
        const contentHash = createHash("sha256")
          .update(JSON.stringify(entry))
          .update(instructions)
          .digest("hex");
        const builtin =
          name === "build"
            ? this.repository.getAgentProfile("primary")
            : this.repository.getAgentProfile(name);
        const existing = this.repository.findAgentProfileBySource(sourcePath) ?? builtin;
        this.repository.saveAgentProfile({
          ...(existing ? { id: existing.id } : {}),
          name,
          description: typeof entry.description === "string" ? entry.description.trim() : "",
          role: entry.mode === undefined && builtin ? builtin.role : configRole(entry.mode),
          instructions,
          modelId: model?.id ?? existing?.modelId ?? null,
          readOnly:
            permissions.edit === "deny" ||
            permissions.write === "deny" ||
            permissions["*"] === "deny",
          enabled: entry.disable !== true,
          hidden: entry.hidden === true,
          sourcePath,
          contentHash,
          permissions,
          toolAllowlist,
          temperature: typeof entry.temperature === "number" ? entry.temperature : null,
          topP: typeof entry.top_p === "number" ? entry.top_p : null,
          maxSteps:
            typeof entry.steps === "number"
              ? entry.steps
              : typeof entry.maxSteps === "number"
                ? entry.maxSteps
                : null,
          color: typeof entry.color === "string" ? entry.color : null,
        });
      }
    }
  }

  save(input: AgentProfileSaveInput): AgentProfileView {
    const normalized = normalize(input);
    return this.repository.saveAgentProfile({
      ...normalized,
      modelId: normalized.modelId ?? null,
    });
  }

  remove(id: string): void {
    this.repository.removeAgentProfile(id);
  }
}
