import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";
import type { SessionView } from "../../shared/domain";
import type { ExtensionService } from "../extensions/extension-service";

const MAX_BUILTIN_RESOURCE_BYTES = 2 * 1024 * 1024;
const MAX_WORK_SOURCE_CATALOG_BYTES = 4 * 1024 * 1024;
const BUILTIN_SKILL_PAGE_CHARS = 32_000;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export const skillRequestSchema = z
  .object({
    name: z.string().min(1).max(1000),
    resource: z.string().min(1).max(1000).optional(),
    char_offset: z.number().int().min(0).max(2_000_000).optional(),
  })
  .strict();

export const capabilityDiscoverySchema = z
  .object({
    query: z.string().trim().max(500).optional(),
    kind: z.enum(["all", "skill", "plugin"]).default("all"),
    offset: z.number().int().min(0).max(100_000).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export type CapabilityDiscoveryInput = z.infer<typeof capabilityDiscoverySchema>;

export interface CapabilityDiscoveryRecord {
  type: "skill" | "plugin";
  id: string;
  name: string;
  description: string;
  session_selected: boolean;
  source: "builtin" | "installed";
  searchable?: string;
  [key: string]: unknown;
}

const safeCatalogPath = (label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .refine(
      (value) =>
        !value.includes("\0") &&
        !value.includes("\\") &&
        !isAbsolute(value) &&
        !/^[a-z]:/i.test(value) &&
        value.split("/").every((part) => Boolean(part) && part !== "." && part !== ".."),
      `${label} must be a normalized relative path without links or traversal`,
    );

const workSourceCatalogEntrySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(160)
      .regex(/^builtin:work-source-[a-z0-9][a-z0-9-]*$/),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(4000),
    family: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    version: z.string().trim().min(1).max(100).nullable(),
    sourcePath: safeCatalogPath("sourcePath"),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    entry: safeCatalogPath("entry").refine(
      (value) => /(?:^|\/)SKILL\.md$/i.test(value),
      "entry must reference a SKILL.md file",
    ),
    resourceRoot: safeCatalogPath("resourceRoot"),
    compatibility: z.enum(["native", "adapted", "resource", "reference"]),
    licenseDisposition: z.enum(["verbatim", "adapted", "reference-only"]),
    tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    aliases: z.array(safeCatalogPath("aliases")).max(30).default([]),
  })
  .strict();

export const MAX_WORK_SOURCE_CATALOG_ENTRIES = 2_000;

const workSourceCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceArchiveSha256: z
      .string()
      .regex(/^[A-Fa-f0-9]{64}$/)
      .optional(),
    entries: z.array(workSourceCatalogEntrySchema).min(1).max(MAX_WORK_SOURCE_CATALOG_ENTRIES),
  })
  .passthrough();

type WorkSourceCatalogEntry = z.infer<typeof workSourceCatalogEntrySchema>;

interface SemanticVersion {
  core: readonly [string, string, string];
  prerelease: string[] | null;
}

function semanticVersion(value: string): SemanticVersion | null {
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined)
    return null;
  const prerelease = match[4]?.split(".") ?? null;
  if (prerelease?.some((part) => /^0\d+$/.test(part))) return null;
  return { core: [match[1], match[2], match[3]], prerelease };
}

function compareNumericIdentifiers(left: string, right: string): number {
  return left.length - right.length || stableTextCompare(left, right);
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  const coreComparison =
    compareNumericIdentifiers(left.core[0], right.core[0]) ||
    compareNumericIdentifiers(left.core[1], right.core[1]) ||
    compareNumericIdentifiers(left.core[2], right.core[2]);
  if (coreComparison) return coreComparison;
  if (!left.prerelease || !right.prerelease)
    return Number(!left.prerelease) - Number(!right.prerelease);
  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index += 1
  ) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined)
      return Number(a !== undefined) - Number(b !== undefined);
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    const comparison =
      aNumeric && bNumeric
        ? compareNumericIdentifiers(a, b)
        : aNumeric !== bNumeric
          ? Number(bNumeric) - Number(aNumeric)
          : stableTextCompare(a, b);
    if (comparison) return comparison;
  }
  return 0;
}

function workSourceIdentity(entry: WorkSourceCatalogEntry): string | null {
  if (!entry.version || !semanticVersion(entry.version)) return null;
  const parts = entry.sourcePath.split("/");
  const positions = parts.flatMap((part, index) => (part === entry.version ? [index] : []));
  const position = positions[0];
  if (
    positions.length !== 1 ||
    position === undefined ||
    position === 0 ||
    position === parts.length - 1
  )
    return null;
  parts.splice(position, 1);
  return parts.join("/");
}

function latestWorkSourceCatalog(entries: readonly WorkSourceCatalogEntry[]): {
  active: WorkSourceCatalogEntry[];
  canonicalIds: Map<string, string>;
} {
  const latest = new Map<string, WorkSourceCatalogEntry>();
  for (const entry of entries) {
    const identity = workSourceIdentity(entry);
    if (!identity) continue;
    const current = latest.get(identity);
    const version = entry.version ? semanticVersion(entry.version) : null;
    const currentVersion = current?.version ? semanticVersion(current.version) : null;
    if (
      !current ||
      (version && currentVersion && compareSemanticVersions(version, currentVersion) > 0)
    )
      latest.set(identity, entry);
  }
  const canonicalIds = new Map<string, string>();
  for (const entry of entries) {
    const identity = workSourceIdentity(entry);
    canonicalIds.set(entry.id, (identity && latest.get(identity)?.id) || entry.id);
  }
  return {
    active: entries.filter((entry) => canonicalIds.get(entry.id) === entry.id),
    canonicalIds,
  };
}

export async function canonicalBuiltinCapabilityIds(
  promptDirectory: string,
  ids: readonly string[],
): Promise<string[]> {
  if (!ids.some((id) => id.startsWith("builtin:work-source-"))) return [...ids];
  const { canonicalIds } = latestWorkSourceCatalog(await readWorkSourceCatalog(promptDirectory));
  return ids.map((id) => canonicalIds.get(id) ?? id);
}

export async function legacyBuiltinCapabilityIds(
  promptDirectory: string,
  canonicalId: string,
): Promise<string[]> {
  if (!canonicalId.startsWith("builtin:work-source-")) return [];
  const { canonicalIds } = latestWorkSourceCatalog(await readWorkSourceCatalog(promptDirectory));
  return [...canonicalIds].flatMap(([id, activeId]) =>
    id !== canonicalId && activeId === canonicalId ? [id] : [],
  );
}

export const DOMAIN_SKILLS = [
  {
    id: "code-engineering",
    modes: ["code"],
    description:
      "Software delivery: architecture, repository discovery, scoped implementation, code ownership, APIs and migrations.",
  },
  {
    id: "code-debugging",
    modes: ["code"],
    description:
      "Reproduce failures, instrument hypotheses, diagnose concurrency/performance, repair root causes and avoid repeated failed strategies.",
  },
  {
    id: "code-verification",
    modes: ["code"],
    description:
      "Risk-based tests, build/type/lint verification, regression triage, security review and factual delivery evidence.",
  },
  {
    id: "code-frontend",
    modes: ["code"],
    description:
      "Accessible responsive UI, design systems, interaction states, browser inspection, performance and visual regression.",
  },
  {
    id: "code-platform",
    modes: ["code"],
    description:
      "Backend contracts, databases, CI/CD, packaging, Windows operations, secrets and deployment readiness.",
  },
  {
    id: "work-word",
    modes: ["work"],
    description:
      "Professional Word reports: content hierarchy, styles, typography, tables, pagination, citations, templates and safe old-draft editing.",
  },
  {
    id: "work-spreadsheets",
    modes: ["work"],
    description:
      "Native Excel workbooks, typed inputs, formulas, tables, validation, formatting, financial models and verified recalculation.",
  },
  {
    id: "work-presentations",
    modes: ["work"],
    description:
      "Polished editable PowerPoint: audience/storyboard, varied layouts, grids, typography, native charts, evidence and slide-by-slide QA.",
  },
  {
    id: "work-ppt-master",
    modes: ["work"],
    description:
      "PPT Master v6.9 workflow: routed deck generation, image-to-PPTX reconstruction, beautification, template creation, native editing, design references, templates and visual acceptance. WorkAgent only.",
  },
  {
    id: "work-pdf",
    modes: ["work"],
    description:
      "Professional selectable-text PDF reports, proposals, resumes and one-pagers; controlled Office exports, print layout and page-by-page preflight.",
  },
  {
    id: "work-visual-design",
    modes: ["work"],
    description:
      "Workspace web and product design: briefs, redesign boundaries, responsive UI, visual systems and browser QA. The on-demand catalog exposes 74 design skeletons, 8 subordinate design skills, craft guidance and design systems.",
  },
  {
    id: "work-visualization",
    modes: ["work"],
    description:
      "Standalone interactive HTML charts, explainers, timelines, simulations and data stories with accessible controls, truthful scales and browser verification.",
  },
  {
    id: "work-image-sourcing",
    modes: ["work"],
    description:
      "Evidence-led image discovery and rights review through web search/fetch, with source, license, attribution, resolution, crop, file-integrity and asset-ledger checks.",
  },
  {
    id: "work-analysis",
    modes: ["work"],
    description:
      "Data analysis: profile inputs, preserve grain, reconcile totals, compare scenarios, choose charts and disclose uncertainty.",
  },
  {
    id: "work-research",
    modes: ["work"],
    description:
      "Research and executive reports: source ledger, claim verification, concise recommendations, quotations and decision-ready structure.",
  },
  {
    id: "work-operations",
    modes: ["work"],
    description:
      "Meeting notes, project plans, SOPs, proposals, schedules, owner/action tracking and consistent multi-file office delivery.",
  },
  {
    id: "work-asd-ste100",
    modes: ["work"],
    description:
      "Controlled English for unambiguous agent output, procedures, prompts, errors and status reports using ASD-STE100-inspired structural rules without the redistributed official dictionary. WorkAgent only.",
  },
  {
    id: "skill-creator",
    modes: ["code", "work"],
    description:
      "Create and validate local skills with a compact trigger, executable workflow, on-demand resources, provenance and acceptance tests.",
  },
  {
    id: "plugin-creator",
    modes: ["code", "work"],
    description:
      "Design and validate installable local Mingshen plugins, manifests, contributions, capabilities, compatibility and end-to-end package checks.",
  },
  {
    id: "harness-plugin-api",
    modes: ["code", "work"],
    description:
      "Use the Mingshen local plugin API contract safely: manifests, lifecycle, contribution boundaries, schemas, validation and compatible tool integration.",
  },
  {
    id: "artifact-quality",
    modes: ["code", "work"],
    description:
      "Final artifact review: source integrity, content accuracy, readability, visual inspection, accessibility and honest validation status.",
  },
] as const;

export interface CapabilityDiscoveryPage {
  query: string;
  kind: CapabilityDiscoveryInput["kind"];
  total: number;
  offset: number;
  returned: number;
  next_offset: number | null;
  matches: Array<Omit<CapabilityDiscoveryRecord, "searchable">>;
}

function catalogSkillsRoot(promptDirectory: string): string {
  return resolve(promptDirectory, "skills");
}

async function readWorkSourceCatalog(promptDirectory: string): Promise<WorkSourceCatalogEntry[]> {
  const skillsRoot = catalogSkillsRoot(promptDirectory);
  const catalogPath = resolve(skillsRoot, "work-sources", "catalog.json");
  const catalogMetadata = await lstat(catalogPath).catch(() => null);
  if (!catalogMetadata) return [];
  await assertNoLinkedPath(skillsRoot, catalogPath);
  const metadata = await stat(catalogPath).catch(() => null);
  if (!metadata?.isFile()) return [];
  if (metadata.size > MAX_WORK_SOURCE_CATALOG_BYTES)
    throw new Error("WORK_SOURCE_CATALOG_TOO_LARGE: catalog must not exceed 4 MiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch (error) {
    throw new Error(
      `WORK_SOURCE_CATALOG_INVALID: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = workSourceCatalogSchema.safeParse(parsed);
  if (!result.success)
    throw new Error(`WORK_SOURCE_CATALOG_INVALID: ${result.error.issues[0]?.message ?? "invalid"}`);
  const ids = new Set<string>();
  const sourcePaths = new Set<string>();
  for (const entry of result.data.entries) {
    if (ids.has(entry.id)) throw new Error(`WORK_SOURCE_CATALOG_INVALID: duplicate id ${entry.id}`);
    if (sourcePaths.has(entry.sourcePath))
      throw new Error(`WORK_SOURCE_CATALOG_INVALID: duplicate sourcePath ${entry.sourcePath}`);
    ids.add(entry.id);
    sourcePaths.add(entry.sourcePath);
  }
  return result.data.entries;
}

function capabilitySearchText(record: CapabilityDiscoveryRecord): string {
  return (
    record.searchable ??
    [
      record.type,
      record.id,
      record.name,
      record.description,
      record.family,
      record.version,
      record.source_path,
      ...(Array.isArray(record.tags) ? record.tags : []),
      ...(Array.isArray(record.aliases) ? record.aliases : []),
    ]
      .filter((part) => typeof part === "string")
      .join(" ")
  ).toLocaleLowerCase("zh-CN");
}

function stableTextCompare(left: unknown, right: unknown): number {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

const FOUNDATION_SEARCH_ALIASES: Record<string, string> = {
  "skill-creator": "创建技能 制作技能 技能创建 create skill",
  "plugin-creator": "创建插件 制作插件 插件创建 create plugin",
  "work-pdf": "pdf阅读 阅读pdf pdf文档 文档制作",
  "work-ppt-master": "pptmaster ppt master pptm pptx 演示文稿 幻灯片 slide deck presentation",
  "work-asd-ste100":
    "asdste100 asd-ste100 ste100 simplified technical english 受控英语 简化技术英语",
};

export function mergeCapabilityDiscoveryRecords(
  installedRecords: readonly CapabilityDiscoveryRecord[],
  builtinRecords: readonly CapabilityDiscoveryRecord[],
  input: CapabilityDiscoveryInput,
): string {
  const records = [...installedRecords, ...builtinRecords].filter(
    (record) =>
      input.kind === "all" ||
      (input.kind === "skill" && record.type === "skill") ||
      (input.kind === "plugin" && record.type === "plugin"),
  );
  const query = input.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
  const terms = query.split(/\s+/).filter(Boolean);
  const pageRecords = records
    .filter(
      (record) =>
        terms.length === 0 || terms.every((term) => capabilitySearchText(record).includes(term)),
    )
    .sort((left, right) => {
      const selectedDelta =
        Number(Boolean(right.session_selected)) - Number(Boolean(left.session_selected));
      if (selectedDelta) return selectedDelta;
      return (
        stableTextCompare(left.type, right.type) ||
        stableTextCompare(left.name, right.name) ||
        stableTextCompare(left.id, right.id)
      );
    })
    .map(({ searchable: _searchable, ...record }) => record);
  const page = pageRecords.slice(input.offset, input.offset + input.limit);
  const nextOffset =
    input.offset + page.length < pageRecords.length ? input.offset + page.length : null;
  return [
    "Local capability index. Search covers packaged built-in Skills and installed enabled extensions. Disabled extensions are excluded.",
    "Use use_skill only with a returned skill id. Built-in Work sources are available only to WorkAgent. MCP tools appear separately only when their server is enabled/configured and still follow normal permissions and approvals. This result did not execute extension code.",
    JSON.stringify(
      {
        query: input.query?.trim() ?? "",
        kind: input.kind,
        total: pageRecords.length,
        offset: input.offset,
        returned: page.length,
        next_offset: nextOffset,
        matches: page,
      } satisfies CapabilityDiscoveryPage,
      null,
      2,
    ),
  ].join("\n\n");
}

export async function builtinCapabilityDiscoveryRecords(
  session: SessionView,
  promptDirectory: string,
  selectedIds: ReadonlySet<string> = new Set(),
): Promise<CapabilityDiscoveryRecord[]> {
  if (session.agentMode === "chat") return [];
  const mode = session.agentMode ?? "code";
  const records: CapabilityDiscoveryRecord[] = DOMAIN_SKILLS.filter((skill) =>
    (skill.modes as readonly string[]).includes(mode),
  ).map((skill) => ({
    type: "skill",
    id: `builtin:${skill.id}`,
    name: skill.id,
    description: skill.description,
    session_selected: selectedIds.has(`builtin:${skill.id}`),
    source: "builtin",
    builtin_kind: "foundation",
    searchable: `${skill.id} ${skill.description} skill 技能 builtin 内置 foundation 基础 workflow 工作流 ${
      FOUNDATION_SEARCH_ALIASES[skill.id] ?? ""
    }`,
  }));
  if (mode !== "work") return records;

  const { active, canonicalIds } = latestWorkSourceCatalog(
    await readWorkSourceCatalog(promptDirectory),
  );
  const selectedCanonicalIds = new Set([...selectedIds].map((id) => canonicalIds.get(id) ?? id));
  for (const entry of active) {
    records.push({
      type: "skill",
      id: entry.id,
      name: entry.name,
      description: entry.description,
      session_selected: selectedCanonicalIds.has(entry.id),
      source: "builtin",
      builtin_kind: "work-source",
      family: entry.family,
      version: entry.version,
      source_path: entry.sourcePath,
      source_sha256: entry.sourceSha256,
      compatibility: entry.compatibility,
      license_disposition: entry.licenseDisposition,
      tags: entry.tags,
      aliases: entry.aliases,
      searchable: capabilitySearchText({
        type: "skill",
        id: entry.id,
        name: entry.name,
        description: entry.description,
        session_selected: false,
        source: "builtin",
        family: entry.family,
        version: entry.version,
        source_path: entry.sourcePath,
        tags: entry.tags,
        aliases: entry.aliases,
      }).concat(
        ` skill 技能 builtin 内置 work-source 工作来源 source 来源 family ${entry.family} version ${
          entry.version ?? "loose"
        }`,
      ),
    });
  }
  return records;
}

function isInside(root: string, target: string): boolean {
  const local = relative(root, target);
  return Boolean(local) && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

async function assertNoLinkedPath(root: string, target: string): Promise<void> {
  const local = relative(root, target);
  if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error("SKILL_RESOURCE_PATH_INVALID: resource must stay inside references/.");

  let current = root;
  const rootMetadata = await lstat(current).catch(() => null);
  if (!rootMetadata || rootMetadata.isSymbolicLink())
    throw new Error("SKILL_RESOURCE_ESCAPE: linked resource roots are blocked.");
  for (const part of local.split(sep)) {
    current = join(current, part);
    const metadata = await lstat(current).catch(() => null);
    if (!metadata) throw new Error("SKILL_RESOURCE_NOT_FOUND: referenced resource is unavailable.");
    if (metadata.isSymbolicLink())
      throw new Error(
        "SKILL_RESOURCE_ESCAPE: linked resources cannot leave their references root.",
      );
  }
}

function normalizeBuiltinResource(skillId: string, resource: string): string {
  const normalized = resource.replaceAll("\\", "/").trim();
  if (
    !normalized ||
    normalized.includes("\0") ||
    isAbsolute(normalized) ||
    /^[a-z]:/i.test(normalized)
  )
    throw new Error("SKILL_RESOURCE_PATH_INVALID: use a relative path inside references/.");

  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    throw new Error(
      "SKILL_RESOURCE_PATH_INVALID: dot segments and absolute paths are not allowed.",
    );

  const skillPrefix = `${skillId}/references/`;
  const referencePrefix = "references/";
  const local = normalized.startsWith(skillPrefix)
    ? normalized.slice(skillPrefix.length)
    : normalized.startsWith(referencePrefix)
      ? normalized.slice(referencePrefix.length)
      : normalized;
  if (!local || local.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("SKILL_RESOURCE_PATH_INVALID: use a file path inside references/.");
  return local;
}

async function readBuiltinText(path: string): Promise<string> {
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isFile()) throw new Error("SKILL_RESOURCE_NOT_FOUND: resource is unavailable.");
  if (metadata.size > MAX_BUILTIN_RESOURCE_BYTES)
    throw new Error("SKILL_RESOURCE_TOO_LARGE: resources must not exceed 2 MiB.");
  const bytes = await readFile(path);
  if (bytes.includes(0)) throw new Error("SKILL_RESOURCE_NOT_TEXT: binary resources are blocked.");
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    throw new Error("SKILL_RESOURCE_NOT_TEXT: resource must be valid UTF-8 text.");
  }
}

async function readBuiltinSkillResource(
  skillsDirectory: string,
  skillId: string,
  resource: string | undefined,
): Promise<{ content: string; displayPath: string }> {
  let skillsRoot: string;
  try {
    skillsRoot = await realpath(skillsDirectory);
  } catch {
    throw new Error("SKILL_RESOURCE_NOT_FOUND: packaged skills directory is unavailable.");
  }

  if (!resource || resource === "SKILL.md") {
    const entry = resolve(skillsDirectory, `${skillId}.md`);
    await assertNoLinkedPath(skillsDirectory, entry);
    const entryReal = await realpath(entry).catch(() => null);
    if (!entryReal || !isInside(skillsRoot, entryReal))
      throw new Error("SKILL_RESOURCE_NOT_FOUND: skill entry is unavailable.");
    return { content: await readBuiltinText(entryReal), displayPath: "SKILL.md" };
  }

  const local = normalizeBuiltinResource(skillId, resource);
  const skillRoot = resolve(skillsDirectory, skillId);
  const referencesRoot = resolve(skillRoot, "references");
  const lexicalTarget = resolve(referencesRoot, local);
  if (!isInside(referencesRoot, lexicalTarget))
    throw new Error("SKILL_RESOURCE_PATH_INVALID: resource must stay inside references/.");

  await assertNoLinkedPath(skillsRoot, referencesRoot);
  await assertNoLinkedPath(referencesRoot, lexicalTarget);
  const skillRootReal = await realpath(skillRoot).catch(() => null);
  const referencesRootReal = await realpath(referencesRoot).catch(() => null);
  if (!skillRootReal || !referencesRootReal || !isInside(skillsRoot, skillRootReal))
    throw new Error("SKILL_RESOURCE_NOT_FOUND: skill references are unavailable.");
  if (!isInside(skillRootReal, referencesRootReal))
    throw new Error("SKILL_RESOURCE_ESCAPE: references root must stay inside its skill.");

  const targetReal = await realpath(lexicalTarget).catch(() => null);
  if (!targetReal) throw new Error("SKILL_RESOURCE_NOT_FOUND: referenced resource is unavailable.");
  if (!isInside(referencesRootReal, targetReal))
    throw new Error("SKILL_RESOURCE_ESCAPE: referenced resource leaves its skill references root.");
  return {
    content: await readBuiltinText(targetReal),
    displayPath: `references/${local.replaceAll("\\", "/")}`,
  };
}

function normalizeSourceResource(resource: string): string {
  const normalized = resource.replaceAll("\\", "/").trim();
  if (
    !normalized ||
    normalized.includes("\0") ||
    isAbsolute(normalized) ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("SKILL_RESOURCE_PATH_INVALID: use a relative path inside the source skill.");
  return normalized;
}

async function readWorkSourceSkillResource(
  promptDirectory: string,
  entry: WorkSourceCatalogEntry,
  resource: string | undefined,
): Promise<{ content: string; displayPath: string }> {
  const skillsRoot = catalogSkillsRoot(promptDirectory);
  const skillsRootReal = await realpath(skillsRoot).catch(() => null);
  if (!skillsRootReal)
    throw new Error("SKILL_RESOURCE_NOT_FOUND: packaged skills directory is unavailable.");
  const entryPath = resolve(skillsRoot, entry.entry);
  if (!isInside(skillsRoot, entryPath))
    throw new Error("WORK_SOURCE_CATALOG_INVALID: entry leaves the packaged skills directory.");
  await assertNoLinkedPath(skillsRoot, entryPath);
  const entryReal = await realpath(entryPath).catch(() => null);
  if (!entryReal || !isInside(skillsRootReal, entryReal))
    throw new Error("SKILL_RESOURCE_NOT_FOUND: work source entry is unavailable.");

  if (!resource || resource === "SKILL.md")
    return { content: await readBuiltinText(entryReal), displayPath: "SKILL.md" };

  const normalized = normalizeSourceResource(resource);
  const resourceRoot = resolve(skillsRoot, entry.resourceRoot);
  if (!isInside(skillsRoot, resourceRoot))
    throw new Error(
      "WORK_SOURCE_CATALOG_INVALID: resourceRoot leaves the packaged skills directory.",
    );
  const resourceRootReal = await realpath(resourceRoot).catch(() => null);
  const metadata = await lstat(resourceRoot).catch(() => null);
  if (!resourceRootReal || !metadata?.isDirectory() || metadata.isSymbolicLink())
    throw new Error("SKILL_RESOURCE_NOT_FOUND: work source resources are unavailable.");
  if (!isInside(skillsRootReal, resourceRootReal))
    throw new Error(
      "SKILL_RESOURCE_ESCAPE: work source resources leave the packaged skills directory.",
    );

  const target = resolve(resourceRoot, normalized);
  if (!isInside(resourceRoot, target))
    throw new Error("SKILL_RESOURCE_PATH_INVALID: resource must stay inside its source skill.");
  await assertNoLinkedPath(resourceRoot, target);
  const targetReal = await realpath(target).catch(() => null);
  if (!targetReal || !isInside(resourceRootReal, targetReal))
    throw new Error("SKILL_RESOURCE_ESCAPE: resource leaves its source skill.");
  return {
    content: await readBuiltinText(targetReal),
    displayPath: `references/${normalized}`,
  };
}

function pageBuiltinSkill(content: string, requestedOffset: number) {
  const offset = Math.min(requestedOffset, content.length);
  if (
    offset > 0 &&
    /[\uD800-\uDBFF]/.test(content[offset - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(content[offset] ?? "")
  )
    throw new Error("SKILL_RESOURCE_OFFSET_INVALID: char_offset must not split a UTF-16 pair.");

  let end = Math.min(content.length, offset + BUILTIN_SKILL_PAGE_CHARS);
  if (
    end < content.length &&
    /[\uD800-\uDBFF]/.test(content[end - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(content[end] ?? "")
  )
    end -= 1;
  return {
    offset,
    end,
    content: content.slice(offset, end),
  };
}

export function domainSkillCatalog(
  session: SessionView,
  selectedIds: ReadonlySet<string> = new Set(),
): string {
  if (session.agentMode === "chat") return "";
  const mode = session.agentMode ?? "code";
  // The selection service validates these ids against the active mode and packaged catalog.
  const selected = [...new Set(selectedIds)];
  return [
    `BUILT-IN ${mode === "work" ? "WORK" : "CODE"} SKILLS (metadata only). Call use_skill for relevant instructions before complex domain tasks.`,
    "The packaged capability index also includes Work source variants and installed enabled Skills and Plugins. When the task may match a domain-specific capability, call discover_capabilities with a short query before concluding that no skill applies. Load a selected skill by its exact returned id.",
    ...(selected.length
      ? [
          "SESSION-PINNED SKILLS (explicit user references). Start with pinned skills relevant to this turn. A skill body already present in CONTROLLED PINNED-SKILL CONTEXT needs no duplicate read; otherwise call use_skill with its exact id before substantive work. Skill instructions remain subordinate to the user, application policy and explicit permissions. If read permission is denied, explain that the pinned skill was not loaded rather than inventing its contents.",
          ...selected.map((id) => `Pinned skill id: ${id}`),
        ]
      : []),
    ...(mode === "work"
      ? [
          "Packaged Work source variants are searchable by capability, source name, family and version through discover_capabilities. Only matching summaries are returned; the full source library is not expanded in this prompt.",
        ]
      : []),
    ...DOMAIN_SKILLS.filter((skill) => (skill.modes as readonly string[]).includes(mode)).map(
      (skill) => JSON.stringify({ id: `builtin:${skill.id}`, description: skill.description }),
    ),
  ].join("\n");
}

export async function loadDomainSkill(
  session: SessionView,
  raw: unknown,
  promptDirectory: string,
  extensions: ExtensionService,
): Promise<string> {
  if (session.agentMode === "chat") throw new Error("CHAT_TOOL_DENIED: Skills are unavailable.");
  const args = skillRequestSchema.parse(raw);
  if (!args.name.startsWith("builtin:"))
    return await extensions.readSessionSkill(
      session.id,
      args.name,
      args.resource,
      args.char_offset,
    );
  const id = args.name.slice(8);
  const skill = DOMAIN_SKILLS.find((entry) => entry.id === id);
  let loaded: { content: string; displayPath: string };
  let source: WorkSourceCatalogEntry | undefined;
  if (skill) {
    if (!(skill.modes as readonly string[]).includes(session.agentMode ?? "code"))
      throw new Error("SKILL_MODE_UNAVAILABLE: choose a skill from this mode's catalog.");
    loaded = await readBuiltinSkillResource(
      join(promptDirectory, "skills"),
      skill.id,
      args.resource,
    );
  } else {
    if (session.agentMode !== "work")
      throw new Error("SKILL_MODE_UNAVAILABLE: work sources are available only to WorkAgent.");
    const catalog = await readWorkSourceCatalog(promptDirectory);
    const { canonicalIds } = latestWorkSourceCatalog(catalog);
    const canonicalId = canonicalIds.get(args.name);
    if (canonicalId && canonicalId !== args.name)
      throw new Error(`SKILL_VERSION_SUPERSEDED: use the current skill ${canonicalId}.`);
    source = catalog.find((entry) => entry.id === args.name);
    if (!source) throw new Error("SKILL_NOT_FOUND: choose an exact id from discover_capabilities.");
    loaded = await readWorkSourceSkillResource(promptDirectory, source, args.resource);
  }
  const page = pageBuiltinSkill(loaded.content, args.char_offset ?? 0);
  const sourceDetails = source
    ? [
        `Source path: ${source.sourcePath}`,
        `Variant: ${source.family} / ${source.version ?? "unversioned"}`,
        `Source SHA-256: ${source.sourceSha256}`,
        `Compatibility: ${source.compatibility}`,
        `License disposition: ${source.licenseDisposition}`,
        ...(source.family === "design"
          ? [
              "Shared design systems and craft references remain available through builtin:work-visual-design.",
            ]
          : []),
      ].join("\n")
    : "";
  const developerSdk =
    skill && ["skill-creator", "plugin-creator", "harness-plugin-api"].includes(id)
      ? `\nOptional user-only SDK CLI reference: ${resolve(promptDirectory, "..", "sdk", "plugin-dev", "mingshen-plugin.mjs")}\nThis host path may be unavailable to sandboxed commands or PATH, and the Agent must not rely on node/run_command to read it. For plugin source inside the current workspace, use local_plugin inspect/validate as the authoritative runtime preflight. SDK output is advisory and does not replace local_plugin validation. Installation and lifecycle changes remain explicit user actions in Settings.`
      : "";
  return `Built-in skill: ${args.name}\nResource: ${loaded.displayPath}\nCharacters: ${page.offset}-${page.end}/${loaded.content.length}${sourceDetails ? `\n${sourceDetails}` : ""}${developerSdk}\n\n${page.content}${page.end < loaded.content.length ? `\nContinue with char_offset:${page.end}.` : ""}`;
}

export const USE_SKILL_TOOL = {
  name: "use_skill",
  description:
    "Load a relevant built-in or installed enabled Skill on demand. Use an exact id from the built-in catalog or discover_capabilities. Optional resource is a text path relative to that Skill; built-in references use paths such as references/guide.md inside that skill's own references folder. char_offset pages large resources. Loading text never executes scripts or grants additional permissions.",
  parameters: z.toJSONSchema(skillRequestSchema, { target: "draft-7" }),
};

export const CAPABILITY_DISCOVERY_TOOL = {
  name: "discover_capabilities",
  description:
    "Search built-in and installed Skills/Plugins in one metadata index for CodeAgent/WorkAgent. Search built-in and installed capabilities by name, description, family, version, tags or source. Results include exact Skill ids for use_skill plus source, variant, version and contextual MCP metadata. Search is paginated, does not execute extension code, and never grants permissions; ChatAgent cannot use it.",
  parameters: z.toJSONSchema(capabilityDiscoverySchema, { target: "draft-7" }),
};
