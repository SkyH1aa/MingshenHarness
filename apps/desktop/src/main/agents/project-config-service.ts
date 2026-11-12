import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DockerRuntimeSettings } from "../../shared/domain";

export interface LspServerConfig {
  id: string;
  command: string[];
  extensions: string[];
  disabled: boolean;
  environment: Record<string, string>;
  initialization: Record<string, unknown>;
}

export interface FormatterConfig {
  id: string;
  command: string[];
  extensions: string[];
  disabled: boolean;
  environment: Record<string, string>;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  cwd: string;
  url: string;
  enabled: boolean;
  timeoutMs: number;
  headers: Record<string, string>;
  env: Record<string, string>;
  oauthEnabled: boolean;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
}

export interface LoadedProjectConfig {
  files: string[];
  instructions: string[];
  lspServers: LspServerConfig[];
  formatters: FormatterConfig[];
  mcpServers: McpServerConfig[];
  docker: DockerRuntimeSettings;
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([key, entry]) => [key, entry]),
      )
    : {};
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readConfig(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(stripJsonComments(await readFile(path, "utf8")));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export class ProjectConfigService {
  constructor(private readonly userConfigDirectory: string) {}

  async load(workspacePath: string | null): Promise<LoadedProjectConfig> {
    const result: LoadedProjectConfig = {
      files: [],
      instructions: [],
      lspServers: [],
      formatters: [],
      mcpServers: [],
      docker: {
        image: "mcr.microsoft.com/powershell:lts-alpine",
        dockerfile: "",
        buildContext: ".",
      },
    };
    const candidates = [
      join(this.userConfigDirectory, "config.json"),
      ...(workspacePath
        ? [
            join(workspacePath, "opencode.json"),
            join(workspacePath, "opencode.jsonc"),
            join(workspacePath, ".opencode", "opencode.json"),
            join(workspacePath, ".mingshen", "config.json"),
            join(workspacePath, ".mingshen", "config.jsonc"),
          ]
        : []),
    ];
    for (const file of candidates) {
      const config = await readConfig(file);
      if (!config) {
        continue;
      }
      result.files.push(file);
      result.instructions.push(...stringArray(config.instructions));
      const lsp = objectRecord(config.lsp);
      for (const [id, value] of Object.entries(lsp)) {
        const entry = objectRecord(value);
        const command = stringArray(entry.command);
        const extensions = stringArray(entry.extensions);
        if (command.length > 0 && extensions.length > 0) {
          result.lspServers.push({
            id,
            command,
            extensions,
            disabled: entry.disabled === true,
            environment: stringRecord(entry.env ?? entry.environment),
            initialization: objectRecord(entry.initialization),
          });
        }
      }
      const formatter = objectRecord(config.formatter);
      for (const [id, value] of Object.entries(formatter)) {
        const entry = objectRecord(value);
        const command = stringArray(entry.command);
        const extensions = stringArray(entry.extensions);
        if (command.length > 0 && extensions.length > 0) {
          result.formatters.push({
            id,
            command,
            extensions,
            disabled: entry.disabled === true,
            environment: stringRecord(entry.environment),
          });
        }
      }
      const mcp = objectRecord(config.mcp);
      for (const [id, value] of Object.entries(mcp)) {
        const entry = objectRecord(value);
        const remote = entry.type === "remote" || Boolean(entry.url);
        const command = stringArray(entry.command);
        const url = typeof entry.url === "string" ? entry.url.trim() : "";
        if ((!remote && command.length === 0) || (remote && !url)) {
          continue;
        }
        const oauth =
          entry.oauth && typeof entry.oauth === "object" ? objectRecord(entry.oauth) : {};
        result.mcpServers.push({
          id,
          name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
          transport: remote ? "http" : "stdio",
          command: command[0] ?? "",
          args: command.slice(1),
          cwd: typeof entry.cwd === "string" ? entry.cwd.trim() : "",
          url,
          enabled: entry.enabled !== false,
          timeoutMs: typeof entry.timeout === "number" ? entry.timeout : 30_000,
          headers: stringRecord(entry.headers),
          env: stringRecord(entry.environment ?? entry.env),
          oauthEnabled: entry.oauth !== false && entry.oauth !== undefined,
          oauthClientId: typeof oauth.clientId === "string" ? oauth.clientId.trim() : "",
          oauthClientSecret:
            typeof oauth.clientSecret === "string" ? oauth.clientSecret.trim() : "",
          oauthScope: typeof oauth.scope === "string" ? oauth.scope.trim() : "",
        });
      }
      const docker = objectRecord(config.docker);
      if (typeof docker.image === "string" && docker.image.trim()) {
        result.docker.image = docker.image.trim();
      }
      if (typeof docker.dockerfile === "string") {
        result.docker.dockerfile = docker.dockerfile.trim();
      }
      if (typeof docker.buildContext === "string" && docker.buildContext.trim()) {
        result.docker.buildContext = docker.buildContext.trim();
      }
    }
    result.instructions = [...new Set(result.instructions)];
    const mcpById = new Map(result.mcpServers.map((server) => [server.id, server]));
    result.mcpServers = [...mcpById.values()];
    return result;
  }
}
