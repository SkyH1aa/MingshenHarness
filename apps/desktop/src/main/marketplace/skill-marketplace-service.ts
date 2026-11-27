import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { MarketplaceInstallResult, MarketplaceSkill } from "../../shared/domain";
import { recordRuntimeError } from "../diagnostics/runtime-log";
import type { ExtensionService } from "../extensions/extension-service";
import type { ManagedPolicyService } from "../policy/managed-policy-service";

interface GitHubTreeEntry {
  path?: string;
  mode?: string;
  type?: "blob" | "tree" | "commit";
  sha?: string;
  size?: number;
  url?: string;
}

interface GitHubTreeResponse {
  sha?: string;
  tree?: GitHubTreeEntry[];
  truncated?: boolean;
}

interface MarketCache {
  fetchedAt: string;
  treeSha: string;
  tree: GitHubTreeEntry[];
  skills: MarketplaceSkill[];
}

const CACHE_TTL_MS = 6 * 60 * 60_000;
const MAX_SKILL_FILES = 20_000;
const MAX_SKILL_BYTES = 64 * 1024 * 1024;

type MarketplaceSource = MarketplaceSkill["source"];

const SOURCES: Record<
  MarketplaceSource,
  {
    repository: string;
    branch: string;
    cacheName: string;
    match: (path: string) => boolean;
    category: (path: string) => MarketplaceSkill["category"];
  }
> = {
  openai: {
    repository: "openai/skills",
    branch: "main",
    cacheName: "openai-skills-cache.json",
    match: (path) => /^skills\/(?:\.curated|\.experimental|\.system)\/[^/]+\/SKILL\.md$/.test(path),
    category: categoryFromPath,
  },
  composio: {
    repository: "ComposioHQ/awesome-claude-skills",
    branch: "master",
    cacheName: "composio-skills-cache.json",
    match: (path) => /^[^/]+(?:\/[^/]+)*\/SKILL\.md$/.test(path),
    category: () => "curated",
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/.exec(markdown);
  if (!match?.[1]) {
    return {};
  }
  try {
    return asRecord(parseYaml(match[1]));
  } catch {
    return {};
  }
}

function categoryFromPath(path: string): MarketplaceSkill["category"] {
  if (path.includes("/.experimental/")) {
    return "experimental";
  }
  if (path.includes("/.system/")) {
    return "system";
  }
  return "curated";
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Mingshen-Harness",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub 请求失败：HTTP ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mingshen-Harness" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`下载失败：HTTP ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const current = index++;
      const value = values[current];
      if (value !== undefined) {
        output[current] = await mapper(value);
      }
    }
  });
  await Promise.all(workers);
  return output;
}

export class SkillMarketplaceService {
  private managedPolicy: ManagedPolicyService | null;

  constructor(
    private readonly cacheRoot: string,
    private readonly extensionService: ExtensionService,
    options: { managedPolicy?: ManagedPolicyService } = {},
  ) {
    this.managedPolicy = options.managedPolicy ?? null;
  }

  setManagedPolicy(policy: ManagedPolicyService | null): void {
    this.managedPolicy = policy;
  }

  async list(source: MarketplaceSource, forceRefresh = false): Promise<MarketplaceSkill[]> {
    if (forceRefresh) this.assertMarketplaceOperation("技能市场刷新", true);
    const cache = await this.loadCache(source, forceRefresh, forceRefresh);
    const installedNames = new Set(
      this.extensionService.list().map((extension) => extension.name.toLocaleLowerCase("en-US")),
    );
    return cache.skills
      .map((skill) => ({
        ...skill,
        installed: installedNames.has(skill.name.toLocaleLowerCase("en-US")),
      }))
      .sort((left, right) => {
        if (left.category !== right.category) {
          return left.category.localeCompare(right.category);
        }
        return left.name.localeCompare(right.name);
      });
  }

  async install(source: MarketplaceSource, skillPath: string): Promise<MarketplaceInstallResult> {
    this.assertMarketplaceOperation("技能市场安装", true);
    this.managedPolicy?.assertCapability("skill.install", { approved: true });
    const sourceConfig = SOURCES[source];
    const normalizedPath = skillPath.trim().replaceAll("\\", "/").replace(/\/+$/, "");
    if (normalizedPath.split("/").includes("..")) {
      throw new Error("无效的技能路径。");
    }
    const cache = await this.loadCache(source, false, true);
    const skill = cache.skills.find((item) => item.path === normalizedPath);
    if (!skill) {
      throw new Error("技能市场中没有找到该技能，请刷新后重试。");
    }
    const existing = this.extensionService
      .list()
      .find(
        (extension) =>
          extension.name.toLocaleLowerCase("en-US") === skill.name.toLocaleLowerCase("en-US"),
      );
    if (existing) {
      return { skill: { ...skill, installed: true }, extension: existing };
    }

    const files = cache.tree.filter(
      (entry) =>
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        (entry.path === `${normalizedPath}/SKILL.md` ||
          entry.path.startsWith(`${normalizedPath}/`)),
    );
    if (files.length === 0) {
      throw new Error("该技能目录没有任何可安装文件。");
    }
    if (files.length > MAX_SKILL_FILES) {
      throw new Error(`技能文件数量超过 ${MAX_SKILL_FILES} 个，已停止安装。`);
    }
    const totalBytes = files.reduce(
      (total, entry) => total + (typeof entry.size === "number" ? entry.size : 0),
      0,
    );
    if (totalBytes > MAX_SKILL_BYTES) {
      throw new Error("技能大小超过 64 MiB，已停止安装。");
    }

    await mkdir(this.cacheRoot, { recursive: true });
    const temporaryRoot = join(this.cacheRoot, `install-${randomUUID()}`);
    const skillRoot = join(temporaryRoot, skill.name);
    try {
      await mapWithConcurrency(files, 6, async (entry) => {
        const relativePath = entry.path?.slice(normalizedPath.length + 1) ?? "";
        if (
          !relativePath ||
          relativePath.startsWith("/") ||
          relativePath.split("/").includes("..")
        ) {
          throw new Error(`技能包含不安全路径：${entry.path ?? ""}`);
        }
        const target = resolve(skillRoot, ...relativePath.split("/"));
        const relativeTarget = relative(temporaryRoot, target);
        if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
          throw new Error("技能路径越过了安装目录。");
        }
        const rawUrl = `https://raw.githubusercontent.com/${sourceConfig.repository}/${sourceConfig.branch}/${entry.path}`;
        const response = await fetch(rawUrl, {
          headers: { "User-Agent": "Mingshen-Harness" },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          throw new Error(`下载 ${entry.path} 失败：HTTP ${response.status}`);
        }
        const content = Buffer.from(await response.arrayBuffer());
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      });

      const result = await this.extensionService.importDirectory(skillRoot);
      const extension =
        result.imported[0] ??
        this.extensionService
          .list()
          .find(
            (item) =>
              item.name.toLocaleLowerCase("en-US") === skill.name.toLocaleLowerCase("en-US"),
          );
      if (!extension) {
        throw new Error(result.warnings.join("\n") || "技能导入失败。");
      }
      return {
        skill: { ...skill, installed: true },
        extension,
      };
    } finally {
      const resolvedRoot = resolve(this.cacheRoot);
      const resolvedTemporary = resolve(temporaryRoot);
      const relativeTemporary = relative(resolvedRoot, resolvedTemporary);
      if (
        relativeTemporary &&
        !relativeTemporary.startsWith("..") &&
        !isAbsolute(relativeTemporary)
      ) {
        await rm(resolvedTemporary, { recursive: true, force: true });
      }
    }
  }

  private async loadCache(
    source: MarketplaceSource,
    forceRefresh: boolean,
    policyApproved = false,
  ): Promise<MarketCache> {
    const sourceConfig = SOURCES[source];
    const cachePath = join(this.cacheRoot, sourceConfig.cacheName);
    let cached: MarketCache | null = null;
    try {
      cached = JSON.parse(await readFile(cachePath, "utf8")) as MarketCache;
    } catch {
      cached = null;
    }
    const cacheIsFresh =
      cached &&
      Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS &&
      Array.isArray(cached.skills) &&
      Array.isArray(cached.tree);
    if (!forceRefresh && cached && cacheIsFresh) {
      return cached;
    }

    try {
      this.assertMarketplaceOperation("技能市场更新", policyApproved);
      const treeResponse = await fetchJson<GitHubTreeResponse>(
        `https://api.github.com/repos/${sourceConfig.repository}/git/trees/${sourceConfig.branch}?recursive=1`,
      );
      const tree = treeResponse.tree ?? [];
      if (treeResponse.truncated) {
        throw new Error("GitHub 技能目录过大，返回结果被截断。");
      }
      const skillFiles = tree.filter(
        (entry) =>
          entry.type === "blob" && typeof entry.path === "string" && sourceConfig.match(entry.path),
      );
      const skills = await mapWithConcurrency(
        skillFiles,
        6,
        async (entry): Promise<MarketplaceSkill> => {
          const path = entry.path ?? "";
          const skillDirectory = dirname(path).replaceAll("\\", "/");
          const folderName = skillDirectory.split("/").at(-1) ?? skillDirectory;
          const markdown = await fetchText(
            `https://raw.githubusercontent.com/${sourceConfig.repository}/${sourceConfig.branch}/${path}`,
          );
          const frontmatter = parseFrontmatter(markdown);
          return {
            id: skillDirectory,
            name: asString(frontmatter.name) || folderName,
            description: asString(frontmatter.description),
            category: sourceConfig.category(skillDirectory),
            source,
            path: skillDirectory,
            sourceUrl: `https://github.com/${sourceConfig.repository}/tree/${sourceConfig.branch}/${skillDirectory}`,
            installed: false,
          };
        },
      );
      const cache: MarketCache = {
        fetchedAt: new Date().toISOString(),
        treeSha: treeResponse.sha ?? "",
        tree,
        skills,
      };
      await mkdir(this.cacheRoot, { recursive: true });
      await writeFile(cachePath, JSON.stringify(cache, null, 2), "utf8");
      return cache;
    } catch (error) {
      recordRuntimeError("marketplace.refresh", error, { operation: source });
      if (cached) {
        return cached;
      }
      throw error;
    }
  }

  private assertMarketplaceOperation(operation: string, approved: boolean): void {
    this.managedPolicy?.assertOperational(operation);
    this.managedPolicy?.assertCapability("marketplace.update", { approved });
    this.managedPolicy?.assertCapability("network.request", { approved });
  }
}
