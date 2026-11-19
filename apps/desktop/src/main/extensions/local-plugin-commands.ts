import { readFile, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { safeFilePath } from "../workspace/safe-file-path";
import { expandPluginRootTokens, PLUGIN_ROOT_TOKENS } from "./local-plugin-manifest";

const MAX_COMMAND_BYTES = 1024 * 1024;
const COMMAND_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface PluginCommandFile {
  name: string;
  relativePath: string;
  description: string;
  content: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readUtf8File(path: string, label: string): Promise<string> {
  const bytes = await readFile(path);
  if (bytes.includes(0)) throw new Error(`${label} is not UTF-8 text.`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/u.exec(markdown);
  if (!match?.[1]) return {};
  try {
    return asRecord(parseYaml(match[1]));
  } catch {
    return {};
  }
}

function commandFileName(value: string): string {
  return basename(value, ".md")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function commandFileValue(
  value: unknown,
  fallbackName: string,
): { name: string; file: string; description: string } | null {
  if (typeof value === "string") {
    return {
      name: fallbackName,
      file: value,
      description: "",
    };
  }
  const record = asRecord(value);
  const file = typeof record.file === "string" ? record.file.trim() : record.path;
  if (typeof file !== "string" || !file.trim()) return null;
  return {
    name: typeof record.name === "string" ? record.name.trim() : fallbackName,
    file: file.trim(),
    description: typeof record.description === "string" ? record.description.trim() : "",
  };
}

export async function loadLocalPluginCommandDeclarations(
  pluginRoot: string,
  value: unknown,
): Promise<PluginCommandFile[]> {
  let declaration = value;
  if (typeof declaration === "string") {
    if (/\.json$/iu.test(declaration.trim())) {
      const declarationPath = await safeFilePath(pluginRoot, declaration.trim());
      const metadata = await stat(declarationPath);
      if (!metadata.isFile() || metadata.size > MAX_COMMAND_BYTES) {
        throw new Error("commands declaration must be a regular JSON file no larger than 1 MiB.");
      }
      declaration = JSON.parse(
        await readUtf8File(declarationPath, "commands declaration"),
      ) as unknown;
    } else if (/\.md$/iu.test(declaration.trim())) {
      declaration = [{ file: declaration.trim() }];
    } else {
      return [];
    }
  }
  if (declaration === undefined || declaration === null) return [];
  if (typeof declaration !== "object") {
    throw new Error("commands declaration must be an object, array, or JSON file path.");
  }

  const record = asRecord(declaration);
  const unwrapped = record.commands ?? declaration;
  const entries: Array<[string, unknown]> = Array.isArray(unwrapped)
    ? unwrapped.map((entry) => ["", entry] as const)
    : Object.entries(asRecord(unwrapped));
  const output: PluginCommandFile[] = [];
  const names = new Set<string>();
  for (const [fallbackName, raw] of entries) {
    const parsed = commandFileValue(raw, fallbackName);
    if (!parsed) {
      throw new Error("Plugin command declarations require a valid lower-case command name.");
    }
    if (!/\.md$/iu.test(parsed.file)) {
      throw new Error(
        `Plugin command ${parsed.name || parsed.file} must reference a Markdown file.`,
      );
    }
    const expandedFile = expandPluginRootTokens(parsed.file, resolve(pluginRoot));
    const localFile = PLUGIN_ROOT_TOKENS.some((token) => parsed.file.includes(token))
      ? relative(resolve(pluginRoot), resolve(expandedFile))
      : parsed.file;
    const commandPath = await safeFilePath(pluginRoot, localFile);
    const metadata = await stat(commandPath);
    if (!metadata.isFile() || metadata.size > MAX_COMMAND_BYTES) {
      throw new Error(`Plugin command ${parsed.name} must be a regular file no larger than 1 MiB.`);
    }
    const content = await readUtf8File(commandPath, `Plugin command ${parsed.file}`);
    const frontmatter = parseFrontmatter(content);
    const name = parsed.name || asString(frontmatter.name) || commandFileName(parsed.file);
    if (!COMMAND_NAME.test(name)) {
      throw new Error(`Plugin command ${parsed.file} has an invalid name.`);
    }
    if (names.has(name)) throw new Error(`Duplicate plugin command: ${name}`);
    names.add(name);
    output.push({
      name,
      relativePath: relative(resolve(pluginRoot), commandPath).replaceAll("\\", "/"),
      description: parsed.description || asString(frontmatter.description),
      content,
    });
  }
  return output;
}
