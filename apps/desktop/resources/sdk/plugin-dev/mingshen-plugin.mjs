#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST_DIRECTORY = ".mingshen-plugin";
const MANIFEST_FILE = "plugin.json";
const MARKETPLACE_FILE = "marketplace.json";
const MAX_FILES = 20_000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_DECLARATION_BYTES = 1024 * 1024;
const MAX_COMMAND_BYTES = 1024 * 1024;
const PLUGIN_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const COMMAND_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HOOK_EVENTS = new Set([
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "Interrupt",
]);
const ROOT_TOKENS = [
  "${MINGSHEN_PLUGIN_ROOT}",
  "${CLAUDE_PLUGIN_ROOT}",
  "${ZCODE_PLUGIN_ROOT}",
];
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".cache", "dist", "out"]);
const UNRESOLVED_PLACEHOLDER = /\bTODO\b|\bFIXME\b|<your[-_ ][^>]+>|YOUR_API_KEY/iu;

function issue(code, message, path) {
  return path ? { code, message, path } : { code, message };
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function containsUnresolvedPlaceholder(value) {
  if (typeof value === "string") return UNRESOLVED_PLACEHOLDER.test(value);
  if (Array.isArray(value)) return value.some(containsUnresolvedPlaceholder);
  if (value && typeof value === "object")
    return Object.values(value).some(containsUnresolvedPlaceholder);
  return false;
}

function pathInside(root, target) {
  const local = relative(root, target);
  return Boolean(local) && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

async function canonicalRoot(value, label) {
  const absolute = resolve(value);
  const metadata = await lstat(absolute).catch(() => null);
  if (!metadata || !metadata.isDirectory()) throw new Error(`${label} is not a directory: ${absolute}`);
  if (metadata.isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link.`);
  return realpath(absolute);
}

async function safePath(root, relativePath, label, expected) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.trim() ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath) ||
    /^[a-z]:/i.test(relativePath)
  )
    throw new Error(`${label} must be a non-empty path relative to the plugin root.`);
  const lexical = resolve(root, relativePath);
  if (!pathInside(root, lexical)) throw new Error(`${label} escapes the plugin root.`);
  let current = root;
  for (const part of relative(root, lexical).split(sep)) {
    current = join(current, part);
    const metadata = await lstat(current).catch(() => null);
    if (!metadata) throw new Error(`${label} does not exist: ${relativePath}`);
    if (metadata.isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link.`);
  }
  const canonical = await realpath(lexical);
  if (!pathInsideOrRoot(root, canonical)) throw new Error(`${label} leaves the plugin root.`);
  const metadata = await stat(canonical);
  if (expected === "file" && !metadata.isFile())
    throw new Error(`${label} must point to a regular file.`);
  if (expected === "directory" && !metadata.isDirectory())
    throw new Error(`${label} must point to a directory.`);
  return canonical;
}

function pathInsideOrRoot(root, target) {
  const local = relative(root, target);
  return !local || (local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local));
}

function simpleScalar(raw) {
  const value = raw.trim();
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value);
      } catch {
        return value.slice(1, -1);
      }
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function frontmatter(content) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/.exec(content);
  if (!match?.[1]) return {};
  const lines = match[1].split(/\r?\n/);
  const values = {};
  for (let index = 0; index < lines.length; index += 1) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(lines[index]);
    if (!field) continue;
    const key = field[1];
    const raw = field[2].trim();
    if (raw === "|" || raw === ">") {
      const continuation = [];
      while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]) || !lines[index + 1])) {
        continuation.push(lines[index + 1].trim());
        index += 1;
      }
      values[key] = continuation.join(raw === ">" ? " " : "\n").trim();
    } else {
      values[key] = simpleScalar(raw);
    }
  }
  return values;
}

async function hashDirectory(root) {
  const hash = createHash("sha256");
  let files = 0;
  let bytes = 0;
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw new Error(
          `Symbolic links are not allowed in a plugin: ${relative(root, join(directory, entry.name))}`,
        );
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const filePath = join(directory, entry.name);
      const metadata = await stat(filePath);
      files += 1;
      bytes += metadata.size;
      if (files > MAX_FILES) throw new Error(`Plugin exceeds the ${MAX_FILES}-file limit.`);
      if (bytes > MAX_TOTAL_BYTES) throw new Error("Plugin exceeds the 64 MiB limit.");
      hash.update(relative(root, filePath).replaceAll("\\", "/"));
      hash.update("\0");
      hash.update(await readFile(filePath));
      hash.update("\0");
    }
  };
  await walk(root);
  return { hash: hash.digest("hex"), files, bytes };
}

async function readUtf8File(root, relativePath, label, maxBytes) {
  const filePath = await safePath(root, relativePath, label, "file");
  const metadata = await stat(filePath);
  if (metadata.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes / (1024 * 1024)} MiB limit.`);
  }
  const bytes = await readFile(filePath);
  if (bytes.includes(0)) throw new Error(`${label} is not UTF-8 text.`);
  try {
    return {
      filePath,
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

function commandFileName(value) {
  return basename(value, ".md")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function commandLocalPath(root, value) {
  let expanded = value;
  for (const token of ROOT_TOKENS) expanded = expanded.split(token).join(root);
  if (expanded === value) return value;
  const local = relative(root, resolve(expanded));
  if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`Command file escapes the plugin root: ${value}`);
  }
  return local;
}

async function commandMarkdownFiles(root, relativeDirectory) {
  const directory = await safePath(
    root,
    relativeDirectory,
    "commands directory",
    "directory",
  );
  const output = [];
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Commands cannot traverse a symbolic link: ${relative(root, join(current, entry.name))}`,
        );
      }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(join(current, entry.name));
      } else if (entry.isFile() && /\.md$/iu.test(entry.name)) {
        output.push(relative(root, join(current, entry.name)));
      }
    }
  };
  await walk(directory);
  return output;
}

async function validateCommands(root, value) {
  const errors = [];
  const warnings = [];
  const commands = new Set();
  const names = new Set();

  const addMarkdownCommand = async (
    file,
    fallbackName = "",
    declaredName = "",
    declaredDescription = "",
  ) => {
    try {
      if (typeof file !== "string" || !file.trim() || !/\.md$/iu.test(file.trim())) {
        throw new Error("Plugin commands must reference a Markdown file.");
      }
      const localFile = commandLocalPath(root, file.trim());
      const loaded = await readUtf8File(
        root,
        localFile,
        `Plugin command ${file.trim()}`,
        MAX_COMMAND_BYTES,
      );
      const metadata = frontmatter(loaded.content);
      const frontmatterName =
        typeof metadata.name === "string" ? metadata.name.trim() : "";
      const name =
        declaredName.trim() ||
        frontmatterName ||
        (fallbackName ? fallbackName.trim() : "") ||
        commandFileName(file);
      if (!COMMAND_NAME.test(name)) {
        throw new Error(`Plugin command ${file} has an invalid name.`);
      }
      if (names.has(name)) throw new Error(`Duplicate plugin command: ${name}`);
      if (containsUnresolvedPlaceholder(loaded.content)) {
        throw new Error(`Plugin command ${file} still contains an unresolved placeholder.`);
      }
      const frontmatterDescription =
        typeof metadata.description === "string"
          ? metadata.description.replace(/\s+/g, " ").trim()
          : "";
      void (declaredDescription || frontmatterDescription);
      names.add(name);
      commands.add(relative(root, loaded.filePath).replaceAll("\\", "/"));
    } catch (error) {
      errors.push(
        issue(
          "COMMAND_INVALID",
          error instanceof Error ? error.message : String(error),
          typeof file === "string" ? file : undefined,
        ),
      );
    }
  };

  const collectReference = async (reference) => {
    const trimmed = reference.trim();
    if (/\.json$/iu.test(trimmed)) {
      try {
        const loaded = await readUtf8File(
          root,
          trimmed,
          "commands declaration",
          MAX_DECLARATION_BYTES,
        );
        const parsed = JSON.parse(loaded.content);
        await collectDeclaration(parsed);
      } catch (error) {
        errors.push(
          issue(
            "COMMANDS_DECLARATION_INVALID",
            error instanceof Error ? error.message : String(error),
            trimmed,
          ),
        );
      }
      return;
    }
    if (/\.md$/iu.test(trimmed)) {
      await addMarkdownCommand(trimmed);
      return;
    }
    try {
      const files = await commandMarkdownFiles(root, trimmed);
      if (!files.length) {
        warnings.push(
          issue("COMMANDS_DIRECTORY_EMPTY", "Commands directory contains no Markdown files.", trimmed),
        );
      }
      for (const file of files) await addMarkdownCommand(file);
    } catch (error) {
      errors.push(
        issue(
          "COMMANDS_DIRECTORY_INVALID",
          error instanceof Error ? error.message : String(error),
          trimmed,
        ),
      );
    }
  };

  const collectDeclaration = async (declaration) => {
    if (typeof declaration === "string") {
      await collectReference(declaration);
      return;
    }
    if (!declaration || typeof declaration !== "object") {
      errors.push(
        issue(
          "COMMANDS_DECLARATION_INVALID",
          "commands declaration must be an object, array, Markdown/directory path, or JSON path.",
        ),
      );
      return;
    }
    const record = asRecord(declaration);
    const unwrapped = record.commands ?? declaration;
    if (typeof unwrapped === "string") {
      await collectReference(unwrapped);
      return;
    }
    const entries = Array.isArray(unwrapped)
      ? unwrapped.map((entry) => ["", entry])
      : Object.entries(asRecord(unwrapped));
    for (const [fallbackName, raw] of entries) {
      if (typeof raw === "string") {
        await addMarkdownCommand(raw, fallbackName);
        continue;
      }
      const command = asRecord(raw);
      const file = typeof command.file === "string" ? command.file : command.path;
      if (typeof file !== "string" || !file.trim()) {
        errors.push(
          issue(
            "COMMAND_DECLARATION_INVALID",
            "Every command declaration needs a root-relative Markdown file or path.",
            fallbackName || "commands",
          ),
        );
        continue;
      }
      await addMarkdownCommand(
        file,
        fallbackName,
        typeof command.name === "string" ? command.name : "",
        typeof command.description === "string" ? command.description : "",
      );
    }
  };

  if (value !== undefined && value !== null) await collectDeclaration(value);
  return { commands: [...commands].sort((left, right) => left.localeCompare(right, "en")), errors, warnings };
}

async function loadDeclaration(root, value, key, errors) {
  if (value === undefined) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asRecord(value[key] ?? value);
  }
  if (typeof value !== "string" || !value.trim()) {
    errors.push(issue("DECLARATION_INVALID", `${key} must be an object or root-relative JSON path.`));
    return {};
  }
  try {
    const declarationPath = await safePath(root, value.trim(), `${key} declaration`, "file");
    const metadata = await stat(declarationPath);
    if (metadata.size > MAX_DECLARATION_BYTES)
      throw new Error(`${key} declaration exceeds the 1 MiB limit.`);
    const parsed = JSON.parse(await readFile(declarationPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error(`${key} declaration must contain a JSON object.`);
    return asRecord(parsed[key] ?? parsed);
  } catch (error) {
    errors.push(
      issue(
        "DECLARATION_INVALID",
        `${key} declaration is invalid: ${error instanceof Error ? error.message : String(error)}`,
        typeof value === "string" ? value : undefined,
      ),
    );
    return {};
  }
}

async function validateSkill(root, relativePath) {
  const errors = [];
  const warnings = [];
  let directory;
  try {
    directory = await safePath(root, relativePath, "Skill directory", "directory");
  } catch (error) {
    return {
      errors: [
        issue(
          "SKILL_DIRECTORY_INVALID",
          error instanceof Error ? error.message : String(error),
          relativePath,
        ),
      ],
      warnings,
      skill: null,
    };
  }
  let skillPath;
  try {
    const direct = await safePath(directory, "SKILL.md", "SKILL.md", "file");
    skillPath = direct;
  } catch {
    errors.push(issue("SKILL_FILE_MISSING", "Skill directory must contain SKILL.md.", relativePath));
    return { errors, warnings, skill: null };
  }
  const content = await readFile(skillPath, "utf8");
  const skillStat = await stat(skillPath);
  if (skillStat.size > 2 * 1024 * 1024)
    errors.push(issue("SKILL_FILE_TOO_LARGE", "SKILL.md must not exceed 2 MiB.", relativePath));
  const metadata = frontmatter(content);
  const name = typeof metadata.name === "string" ? metadata.name.trim() : "";
  const description =
    typeof metadata.description === "string" ? metadata.description.replace(/\s+/g, " ").trim() : "";
  if (!name) errors.push(issue("SKILL_NAME_MISSING", "SKILL.md needs a name.", relativePath));
  else if (!PLUGIN_NAME.test(name))
    errors.push(
      issue(
        "SKILL_NAME_INVALID",
        "Skill name must be lowercase kebab-case and at most 64 characters.",
        relativePath,
      ),
    );
  if (name && name !== basename(directory))
    errors.push(
      issue("SKILL_NAME_MISMATCH", "Skill name should match its directory name.", relativePath),
    );
  if (!description)
    errors.push(issue("SKILL_DESCRIPTION_MISSING", "SKILL.md needs a description.", relativePath));
  if (containsUnresolvedPlaceholder(content))
    errors.push(
      issue("SCAFFOLD_PLACEHOLDER", "Replace generated TODO placeholders before validation.", relativePath),
    );
  return {
    errors,
    warnings,
    skill: name && description ? { id: name, name, description, relativePath } : null,
  };
}

export async function validatePlugin(pluginRoot) {
  const errors = [];
  const warnings = [];
  let root;
  try {
    root = await canonicalRoot(pluginRoot, "Plugin root");
  } catch (error) {
    return {
      authoritative: false,
      ok: false,
      rootPath: resolve(pluginRoot),
      manifestPath: null,
      name: "",
      version: "",
      description: "",
      contentHash: "",
      fileCount: 0,
      totalBytes: 0,
      skills: [],
      commands: [],
      hookEvents: [],
      mcpServers: [],
      errors: [
        issue(
          "PLUGIN_ROOT_INVALID",
          error instanceof Error ? error.message : String(error),
        ),
      ],
      warnings,
    };
  }

  const manifestRelative = join(MANIFEST_DIRECTORY, MANIFEST_FILE);
  let manifestPath;
  try {
    manifestPath = await safePath(root, manifestRelative, "Mingshen manifest", "file");
  } catch (error) {
    errors.push(
      issue(
        "MANIFEST_MISSING",
        error instanceof Error ? error.message : String(error),
        manifestRelative,
      ),
    );
  }

  let manifest = {};
  if (manifestPath) {
    try {
      const manifestStat = await stat(manifestPath);
      if (manifestStat.size > MAX_DECLARATION_BYTES)
        throw new Error("Manifest must not exceed 1 MiB.");
      const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Manifest must contain a JSON object.");
      manifest = parsed;
    } catch (error) {
      errors.push(
        issue(
          "MANIFEST_INVALID",
          `Cannot parse manifest: ${error instanceof Error ? error.message : String(error)}`,
          manifestRelative,
        ),
      );
    }
  }

  const name = typeof manifest.name === "string" ? manifest.name.trim() : "";
  const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
  const description =
    typeof manifest.description === "string" ? manifest.description.trim() : "";
  if (!name) errors.push(issue("PLUGIN_NAME_MISSING", "Manifest needs a name."));
  else if (!PLUGIN_NAME.test(name))
    errors.push(
      issue(
        "PLUGIN_NAME_INVALID",
        "Plugin name must be lowercase kebab-case and at most 64 characters.",
      ),
    );
  if (!version) errors.push(issue("PLUGIN_VERSION_MISSING", "Manifest needs a semantic version."));
  else if (!SEMVER.test(version))
    errors.push(issue("PLUGIN_VERSION_INVALID", "Manifest version must be semantic versioning."));
  if (!description) errors.push(issue("PLUGIN_DESCRIPTION_MISSING", "Manifest needs a description."));
  for (const key of ["skills", "commands", "hooks", "mcpServers"]) {
    if (containsUnresolvedPlaceholder(manifest[key]))
      errors.push(
        issue(
          "PLUGIN_DECLARATION_PLACEHOLDER",
          `${key} still contains TODO, FIXME or an unresolved placeholder.`,
          key,
        ),
      );
  }

  const skills = [];
  if (!Array.isArray(manifest.skills)) {
    errors.push(issue("PLUGIN_SKILLS_INVALID", "Manifest skills must be an array of skill directories."));
  } else {
    if (manifest.skills.length === 0)
      warnings.push(issue("PLUGIN_SKILLS_EMPTY", "Plugin declares no Skills."));
    for (const relativePath of manifest.skills) {
      if (typeof relativePath !== "string") {
        errors.push(issue("PLUGIN_SKILL_PATH_INVALID", "Every skills entry must be a string."));
        continue;
      }
      const checked = await validateSkill(root, relativePath);
      errors.push(...checked.errors);
      warnings.push(...checked.warnings);
      if (checked.skill) skills.push(checked.skill);
    }
  }

  const hooksRecord = await loadDeclaration(root, manifest.hooks, "hooks", errors);
  const mcpRecord = await loadDeclaration(root, manifest.mcpServers, "mcpServers", errors);
  const hookEvents = Object.keys(hooksRecord);
  for (const event of hookEvents) {
    if (!HOOK_EVENTS.has(event))
      errors.push(
        issue("HOOK_EVENT_INVALID", `Unsupported hook event: ${event}.`, "hooks"),
      );
  }
  const checkedCommands = await validateCommands(root, manifest.commands);
  errors.push(...checkedCommands.errors);
  warnings.push(...checkedCommands.warnings);
  const commands = checkedCommands.commands;
  const mcpServers = Object.keys(mcpRecord);
  for (const [serverName, rawConfig] of Object.entries(mcpRecord)) {
    const config = asRecord(rawConfig);
    if (
      !serverName.trim() ||
      (!String(config.command ?? "").trim() &&
        !String(config.url ?? "").trim() &&
        !String(config.serverUrl ?? "").trim())
    )
      errors.push(
        issue(
          "MCP_SERVER_INVALID",
          `MCP Server ${serverName || "(unnamed)"} must declare command or url.`,
          `mcpServers.${serverName}`,
        ),
      );
  }

  let scan = { hash: "", files: 0, bytes: 0 };
  try {
    scan = await hashDirectory(root);
  } catch (error) {
    errors.push(
      issue("PLUGIN_SCAN_FAILED", error instanceof Error ? error.message : String(error)),
    );
  }
  if (/<[^>]+>/.test(description))
    errors.push(issue("PLUGIN_DESCRIPTION_PLACEHOLDER", "Replace placeholders in description."));

  return {
    authoritative: false,
    ok: errors.length === 0,
    rootPath: root,
    manifestPath,
    name,
    version,
    description,
    contentHash: scan.hash,
    fileCount: scan.files,
    totalBytes: scan.bytes,
    skills,
    commands,
    hookEvents,
    mcpServers,
    errors,
    warnings,
  };
}

function normalizeSource(root, pluginRoot) {
  const absolutePlugin = resolve(pluginRoot);
  if (!pathInside(root, absolutePlugin))
    throw new Error(`Marketplace source must stay inside the market root: ${absolutePlugin}`);
  return `./${relative(root, absolutePlugin).replaceAll("\\", "/")}`;
}

export async function upsertMarketplace(marketRoot, marketName, pluginPaths) {
  if (!PLUGIN_NAME.test(marketName))
    throw new Error("Marketplace name must be lowercase kebab-case and at most 64 characters.");
  const root = await canonicalRoot(marketRoot, "Marketplace root").catch(async (error) => {
    const absolute = resolve(marketRoot);
    await mkdir(absolute, { recursive: true });
    const created = await canonicalRoot(absolute, "Marketplace root");
    if (
      relative(created, absolute) &&
      !pathInsideOrRoot(created, absolute)
    )
      throw error;
    return created;
  });
  const catalogPath = join(root, MARKETPLACE_FILE);
  let catalog = { name: marketName, plugins: [] };
  const existing = await readFile(catalogPath, "utf8").catch(() => null);
  if (existing) {
    const parsed = JSON.parse(existing);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Existing marketplace.json must contain an object.");
    catalog = parsed;
  }
  if (catalog.name !== undefined && catalog.name !== marketName)
    throw new Error(`Existing marketplace name is ${catalog.name}, not ${marketName}.`);
  catalog.name = marketName;
  catalog.plugins = Array.isArray(catalog.plugins) ? catalog.plugins : [];

  const added = [];
  for (const pluginPath of pluginPaths) {
    const plugin = await validatePlugin(pluginPath);
    if (!plugin.ok) throw new Error(`Plugin preflight failed: ${plugin.rootPath}`);
    const source = normalizeSource(root, plugin.rootPath);
    const existingIndex = catalog.plugins.findIndex((entry) => entry?.name === plugin.name);
    const next = {
      name: plugin.name,
      source,
      version: plugin.version,
      description: plugin.description,
    };
    if (existingIndex >= 0) {
      const current = asRecord(catalog.plugins[existingIndex]);
      if (current.source && current.source !== source)
        throw new Error(
          `Marketplace plugin ${plugin.name} already points to ${current.source}, not ${source}.`,
        );
      catalog.plugins[existingIndex] = { ...current, ...next };
    } else {
      catalog.plugins.push(next);
    }
    added.push(next);
  }
  catalog.plugins.sort((left, right) => String(left?.name ?? "").localeCompare(String(right?.name ?? "")));
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return { catalogPath, rootPath: root, marketName, plugins: added };
}

function skillTemplate(pluginName, displayName) {
  return `---\nname: ${pluginName}-harness\ndescription: Use when coordinating the ${displayName} plugin with Mingshen Harness. TODO: replace with concrete user triggers and observable outcomes.\n---\n\n# ${displayName} Harness Interface\n\nTODO: explain the capability this plugin adds and finish this workflow before validating.\n\n1. Confirm the user's requested output and required inputs.\n2. Use only tools and resources declared by this plugin.\n3. Return a concrete result and verification status.\n`;
}

export async function createPlugin({ pluginRoot, name, version = "0.1.0", description, displayName }) {
  if (!PLUGIN_NAME.test(name))
    throw new Error("Plugin name must be lowercase kebab-case and at most 64 characters.");
  if (!SEMVER.test(version)) throw new Error("Version must use semantic versioning.");
  if (!description?.trim()) throw new Error("A non-placeholder description is required.");
  const root = resolve(pluginRoot);
  const existing = await lstat(root).catch(() => null);
  if (existing) {
    const entries = existing.isDirectory() ? await readdir(root) : [];
    if (!existing.isDirectory() || entries.length)
      throw new Error(`Plugin root already exists and is not empty: ${root}`);
  }
  const skillName = `${name}-harness`;
  await mkdir(join(root, MANIFEST_DIRECTORY), { recursive: true });
  await mkdir(join(root, "skills", skillName), { recursive: true });
  const manifest = {
    name,
    version,
    description: description.trim(),
    skills: [`skills/${skillName}`],
  };
  await writeFile(
    join(root, MANIFEST_DIRECTORY, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(root, "skills", skillName, "SKILL.md"),
    skillTemplate(name, displayName?.trim() || name),
    "utf8",
  );
  return { rootPath: root, manifestPath: join(root, MANIFEST_DIRECTORY, MANIFEST_FILE) };
}

function parseArguments(argv) {
  const values = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      values._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

function usage() {
  return `Mingshen plugin development preflight

Usage:
  node mingshen-plugin.mjs create <plugin-dir> --name <slug> --description <text>
       [--version 0.1.0] [--display-name <name>]
  node mingshen-plugin.mjs validate <plugin-dir> [--json]
  node mingshen-plugin.mjs marketplace <market-root> --name <market-name>
       --add <plugin-dir> [--add <plugin-dir> ...] [--json]

This CLI performs a strict local preflight. In Mingshen, call the local_plugin
tool with action "validate" for the authoritative runtime validation.`;
}

async function main(argv) {
  const args = parseArguments(argv);
  const command = args._[0];
  if (!command || args.help) {
    console.log(usage());
    return 0;
  }
  if (command === "create") {
    const pluginRoot = args._[1];
    if (!pluginRoot || typeof args.name !== "string" || typeof args.description !== "string")
      throw new Error("create needs <plugin-dir>, --name and --description.");
    const result = await createPlugin({
      pluginRoot,
      name: args.name,
      version: typeof args.version === "string" ? args.version : "0.1.0",
      description: args.description,
      displayName: typeof args["display-name"] === "string" ? args["display-name"] : args.name,
    });
    console.log(JSON.stringify({ created: result, next: "Complete TODO content, then validate." }, null, 2));
    return 0;
  }
  if (command === "validate") {
    const pluginRoot = args._[1];
    if (!pluginRoot) throw new Error("validate needs <plugin-dir>.");
    const result = await validatePlugin(pluginRoot);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else if (result.ok)
      console.log(
        `SDK preflight passed: ${result.name}@${result.version}, ${result.skills.length} skill(s), ${result.fileCount} file(s). Run Mingshen local_plugin validate for authoritative validation.`,
      );
    else {
      for (const entry of result.errors) console.error(`${entry.code}: ${entry.message}`);
      for (const entry of result.warnings) console.error(`${entry.code}: ${entry.message}`);
    }
    return result.ok ? 0 : 1;
  }
  if (command === "marketplace") {
    const marketRoot = args._[1];
    const pluginPaths = [];
    for (let index = 0; index < argv.length; index += 1) {
      if (argv[index] === "--add" && argv[index + 1] && !argv[index + 1].startsWith("--"))
        pluginPaths.push(argv[index + 1]);
    }
    if (!marketRoot || typeof args.name !== "string" || pluginPaths.length === 0)
      throw new Error("marketplace needs <market-root>, --name and at least one --add <plugin-dir>.");
    const result = await upsertMarketplace(marketRoot, args.name, pluginPaths);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  throw new Error(`Unknown command: ${command}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}
