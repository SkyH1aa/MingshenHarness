import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import type { CustomCommandView, ExtensionView } from "../../shared/domain";
import {
  loadLocalPluginCommandDeclarations,
  type PluginCommandFile,
} from "../extensions/local-plugin-commands";
import type { Repository } from "../storage/repository";
import { safeFilePath } from "../workspace/safe-file-path";

const COMMAND_DIRECTORIES = [".mingshen/commands", ".opencode/commands"];
const MAX_COMMAND_FILE = 120_000;
const MAX_PLUGIN_COMMAND_FILE = 1024 * 1024;
const MAX_PLUGIN_COMMANDS = 500;
const MAX_PLUGIN_COMMAND_DEPTH = 16;
const PLUGIN_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const IGNORED_PLUGIN_DIRECTORIES = new Set([".git", ".hg", ".svn", "node_modules"]);

interface CommandCandidate {
  path: string;
  command: CustomCommandView;
}

type PluginCommandRepository = Pick<Repository, "getExtensionManifest" | "listExtensions">;

export interface PreparedCustomCommand {
  command: CustomCommandView;
  prompt: string;
  shellCommands: Array<{ placeholder: string; command: string }>;
}

async function markdownFiles(root: string, output: string[] = []): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        await markdownFiles(path, output);
      } else if (entry.isFile() && /\.(?:md|mdx)$/i.test(entry.name)) {
        output.push(path);
      }
    }
  } catch {
    return output;
  }
  return output.sort((left, right) => left.localeCompare(right, "en"));
}

function parseCommand(
  content: string,
  path: string,
  maxTemplateChars = MAX_COMMAND_FILE,
): CustomCommandView {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/.exec(content);
  let metadata: Record<string, unknown> = {};
  if (match?.[1]) {
    try {
      const parsed: unknown = parseYaml(match[1]);
      metadata =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      metadata = {};
    }
  }
  const name = basename(path).replace(/\.(?:md|mdx)$/i, "");
  return {
    id: createHash("sha256").update(`${path}\0${content}`).digest("hex"),
    name,
    description: typeof metadata.description === "string" ? metadata.description.trim() : "",
    agent: typeof metadata.agent === "string" ? metadata.agent.trim() : null,
    model: typeof metadata.model === "string" ? metadata.model.trim() : null,
    template: (match ? content.slice(match[0].length) : content).trim().slice(0, maxTemplateChars),
    sourcePath: path,
  };
}

function commandDeclaration(manifest: Record<string, unknown>): unknown {
  const paths =
    manifest.paths && typeof manifest.paths === "object" && !Array.isArray(manifest.paths)
      ? (manifest.paths as Record<string, unknown>)
      : {};
  return paths.commands ?? manifest.commands;
}

async function pluginMarkdownFiles(
  pluginRoot: string,
  declaration: string,
  output: string[],
  depth = 0,
): Promise<void> {
  if (output.length >= MAX_PLUGIN_COMMANDS || depth > MAX_PLUGIN_COMMAND_DEPTH) return;
  const target = await safeFilePath(pluginRoot, declaration);
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink()) return;
  if (metadata.isFile()) {
    if (/\.md$/iu.test(target)) {
      output.push(relative(pluginRoot, target).replaceAll("\\", "/"));
    }
    return;
  }
  if (!metadata.isDirectory()) return;
  const entries = await readdir(target, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    if (output.length >= MAX_PLUGIN_COMMANDS) break;
    if (entry.isSymbolicLink()) continue;
    if (
      entry.isDirectory() &&
      IGNORED_PLUGIN_DIRECTORIES.has(entry.name.toLocaleLowerCase("en-US"))
    )
      continue;
    const local = relative(pluginRoot, join(target, entry.name)).replaceAll("\\", "/");
    await pluginMarkdownFiles(pluginRoot, local, output, depth + 1);
  }
}

async function loadPluginCommandFiles(
  pluginRoot: string,
  declaration: unknown,
): Promise<PluginCommandFile[]> {
  const output: PluginCommandFile[] = [];
  const add = (files: PluginCommandFile[]): void => {
    for (const file of files) {
      if (output.length >= MAX_PLUGIN_COMMANDS) return;
      output.push(file);
    }
  };
  const addResources = async (value: string): Promise<void> => {
    const files: string[] = [];
    await pluginMarkdownFiles(pluginRoot, value, files);
    for (const file of files) {
      if (output.length >= MAX_PLUGIN_COMMANDS) return;
      add(await loadLocalPluginCommandDeclarations(pluginRoot, file));
    }
  };

  if (Array.isArray(declaration)) {
    for (const value of declaration) {
      if (typeof value === "string") {
        add(await loadLocalPluginCommandDeclarations(pluginRoot, value));
        if (!/\.(?:json|md)$/iu.test(value)) await addResources(value);
      } else {
        add(await loadLocalPluginCommandDeclarations(pluginRoot, value));
      }
    }
    return output;
  }
  if (typeof declaration === "string") {
    add(await loadLocalPluginCommandDeclarations(pluginRoot, declaration));
    if (!/\.(?:json|md)$/iu.test(declaration)) await addResources(declaration);
    return output;
  }
  if (declaration && typeof declaration === "object") {
    add(await loadLocalPluginCommandDeclarations(pluginRoot, declaration));
  }
  return output;
}

function pluginCommandView(
  extension: ExtensionView,
  manifestName: string,
  file: PluginCommandFile,
  sourcePath: string,
): CustomCommandView {
  const command = parseCommand(file.content, sourcePath, MAX_PLUGIN_COMMAND_FILE);
  const name = `${manifestName}:${file.name}`;
  return {
    ...command,
    id: createHash("sha256").update(`${extension.id}\0${name}\0${file.content}`).digest("hex"),
    name,
    description: file.description || command.description,
  };
}

function commandArguments(value: string): string[] {
  const output: string[] = [];
  for (const match of value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    output.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return output;
}

export class CustomCommandService {
  constructor(private readonly repository?: PluginCommandRepository) {}

  private async pluginCommands(): Promise<CommandCandidate[]> {
    if (!this.repository) return [];
    let extensions: ExtensionView[];
    try {
      extensions = this.repository
        .listExtensions()
        .filter((extension) => extension.type === "plugin" && extension.enabled);
    } catch {
      return [];
    }
    const candidates: CommandCandidate[] = [];
    for (const extension of extensions) {
      if (candidates.length >= MAX_PLUGIN_COMMANDS) break;
      const pluginRoot = extension.installedPath;
      let manifest: Record<string, unknown> | null;
      try {
        manifest = this.repository.getExtensionManifest(extension.id);
      } catch {
        continue;
      }
      const manifestName = typeof manifest?.name === "string" ? manifest.name.trim() : "";
      if (!isAbsolute(pluginRoot) || !PLUGIN_NAME.test(manifestName)) continue;
      try {
        const rootMetadata = await lstat(pluginRoot);
        if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) continue;
        const files = await loadPluginCommandFiles(pluginRoot, commandDeclaration(manifest ?? {}));
        const names = new Set<string>();
        for (const file of files) {
          if (candidates.length >= MAX_PLUGIN_COMMANDS) break;
          if (names.has(file.name)) continue;
          names.add(file.name);
          const sourcePath = await safeFilePath(pluginRoot, file.relativePath);
          const command = pluginCommandView(extension, manifestName, file, sourcePath);
          if (command.template) candidates.push({ path: sourcePath, command });
        }
      } catch {
        // A broken or unsafe plugin command declaration must not disable user commands.
      }
    }
    return candidates;
  }

  async list(workspacePath: string | null): Promise<CustomCommandView[]> {
    const roots = [
      join(homedir(), ".config", "opencode", "commands"),
      join(homedir(), ".mingshen", "commands"),
      ...(workspacePath
        ? COMMAND_DIRECTORIES.map((directory) => join(workspacePath, directory))
        : []),
    ];
    const files = (await Promise.all(roots.map((root) => markdownFiles(root)))).flat();
    const candidates: CommandCandidate[] = [];
    for (const path of files) {
      try {
        candidates.push({ path, command: parseCommand(await readFile(path, "utf8"), path) });
      } catch {
        // Invalid local commands are ignored; the source path remains available to the user.
      }
    }
    const byName = new Map<string, CommandCandidate>();
    for (const candidate of candidates) {
      byName.set(candidate.command.name.toLocaleLowerCase("en-US"), candidate);
    }
    for (const candidate of await this.pluginCommands()) {
      const key = candidate.command.name.toLocaleLowerCase("en-US");
      if (!byName.has(key)) byName.set(key, candidate);
    }
    return [...byName.values()]
      .map((candidate) => candidate.command)
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
  }

  async prepare(
    workspacePath: string | null,
    text: string,
    allowFileReferences = true,
  ): Promise<PreparedCustomCommand | null> {
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (!match?.[1]) {
      return null;
    }
    const name = match[1].toLocaleLowerCase("en-US");
    const command = (await this.list(workspacePath)).find(
      (candidate) => candidate.name.toLocaleLowerCase("en-US") === name,
    );
    if (!command) {
      return null;
    }
    const isolated = commandArguments(match[2] ?? "");
    let prompt = command.template
      .replaceAll("$ARGUMENTS", match[2] ?? "")
      .replace(/\$(\d+)/g, (_match, index: string) => isolated[Number(index) - 1] ?? "");
    const shellCommands: Array<{ placeholder: string; command: string }> = [];
    prompt = prompt.replace(/!`([^`]+)`/g, (_match, shell: string) => {
      const placeholder = `[[MINGSHEN_SHELL_${shellCommands.length + 1}]]`;
      shellCommands.push({ placeholder, command: shell.trim() });
      return placeholder;
    });
    const fileReferences = [...prompt.matchAll(/(?:^|\s)@([^\s]+)/g)]
      .map((entry) => entry[1]?.trim())
      .filter((entry): entry is string => Boolean(entry));
    for (const reference of [...new Set(fileReferences)]) {
      if (!allowFileReferences || !workspacePath) {
        prompt += `\n\n[Reference ${reference}: use the approved read_file tool to read this file.]`;
        continue;
      }
      try {
        const path = await safeFilePath(workspacePath, reference);
        const content = (await readFile(path, "utf8")).slice(0, 40_000);
        prompt += `\n\n## Referenced file: ${reference}\n\n${content}`;
      } catch {
        prompt += `\n\n[Reference not found: ${reference}]`;
      }
    }
    return { command, prompt, shellCommands };
  }
}
