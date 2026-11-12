import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { CustomCommandView } from "../../shared/domain";
import { safeFilePath } from "../workspace/safe-file-path";

const COMMAND_DIRECTORIES = [".mingshen/commands", ".opencode/commands"];
const MAX_COMMAND_FILE = 120_000;

interface CommandCandidate {
  path: string;
  command: CustomCommandView;
}

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

function parseCommand(content: string, path: string): CustomCommandView {
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
    template: (match ? content.slice(match[0].length) : content).trim().slice(0, MAX_COMMAND_FILE),
    sourcePath: path,
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
