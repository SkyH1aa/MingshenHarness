import { createHash } from "node:crypto";
import { lstat, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionView } from "../../shared/domain";
import type {
  LocalPluginCatalogValidation,
  LocalPluginCleanupResult,
  LocalPluginDirectoryInspection,
  LocalPluginInstallResult,
  LocalPluginMarketPlugin,
  LocalPluginMarketSource,
  LocalPluginMarketView,
  LocalPluginUpdateCandidate,
  LocalPluginUpdateCheckResult,
  LocalPluginValidation,
  LocalPluginValidationIssue,
} from "../../shared/local-plugins";
import type { ExtensionService } from "../extensions/extension-service";
import type { ManagedPolicyService } from "../policy/managed-policy-service";
import type { Repository } from "../storage/repository";

const MARKETS_SETTING = "localPluginMarkets" + ".v1";
const PROVENANCE_SETTING = "localPluginProvenance.v1";
const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_CATALOG_PLUGINS = 200;
const MAX_UPDATE_CHECK_MARKETS = 10;
const MARKET_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SEMANTIC_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const CATALOG_CANDIDATES = [
  "marketplace.json",
  ".mingshen-plugin/marketplace.json",
  ".zcode-plugin/marketplace.json",
  ".claude-plugin/marketplace.json",
] as const;

const HIDDEN_CATALOG_DIRECTORIES = new Set(["mingshen-plugin", "zcode-plugin", "claude-plugin"]);

interface CatalogEntry {
  name: string;
  source: string;
  version: string;
  description: string;
  displayName: string;
  category: string;
}

interface ParsedCatalog {
  rootPath: string;
  catalogPath: string;
  name: string;
  displayName: string;
  description: string;
  plugins: CatalogEntry[];
}

interface StoredPluginProvenance {
  marketId: string;
  pluginName: string;
  extensionId: string;
  sourcePath: string;
  installedVersion: string;
  contentHash: string;
  oldInstalledPaths: string[];
  updatedAt: string;
}

interface CachedMarketUpdates {
  rootPath: string;
  catalogPath: string;
  updates: LocalPluginUpdateCandidate[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function issue(code: string, message: string, path?: string): LocalPluginValidationIssue {
  return { code, message, ...(path ? { path } : {}) };
}

function invalidValidation(rootPath: string, message: string): LocalPluginValidation {
  return {
    ok: false,
    rootPath,
    manifestPath: null,
    manifestKind: null,
    name: "",
    version: "",
    description: "",
    contentHash: "",
    skills: [],
    commands: [],
    hookEvents: [],
    mcpServers: [],
    errors: [issue("plugin-validation-failed", message)],
    warnings: [],
  };
}

function isInside(root: string, target: string): boolean {
  const local = relative(resolve(root), resolve(target));
  return Boolean(local) && !local.startsWith(`..${sep}`) && local !== ".." && !isAbsolute(local);
}

function normalizeStoredMarket(value: unknown): LocalPluginMarketSource | null {
  const record = asRecord(value);
  const id = asString(record.id);
  const name = asString(record.name);
  const rootPath = asString(record.rootPath);
  const catalogPath = asString(record.catalogPath);
  const createdAt = asString(record.createdAt);
  const updatedAt = asString(record.updatedAt);
  if (!id || !name || !rootPath || !catalogPath || !createdAt || !updatedAt) return null;
  return {
    id,
    name,
    displayName: asString(record.displayName) || name,
    description: asString(record.description),
    rootPath,
    catalogPath,
    createdAt,
    updatedAt,
  };
}

function normalizeProvenance(value: unknown): StoredPluginProvenance | null {
  const record = asRecord(value);
  const marketId = asString(record.marketId);
  const pluginName = asString(record.pluginName);
  const extensionId = asString(record.extensionId);
  const sourcePath = asString(record.sourcePath);
  const installedVersion = asString(record.installedVersion);
  const contentHash = asString(record.contentHash);
  const updatedAt = asString(record.updatedAt);
  if (!marketId || !pluginName || !extensionId || !sourcePath || !contentHash || !updatedAt) {
    return null;
  }
  return {
    marketId,
    pluginName,
    extensionId,
    sourcePath,
    installedVersion,
    contentHash,
    oldInstalledPaths: Array.isArray(record.oldInstalledPaths)
      ? record.oldInstalledPaths.filter(
          (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
        )
      : [],
    updatedAt,
  };
}

function manifestVersion(manifest: Record<string, unknown> | null): string {
  const metadata = asRecord(manifest?._mingshen);
  return asString(metadata.manifestVersion) || asString(manifest?.version);
}

function manifestName(manifest: Record<string, unknown> | null): string {
  return asString(manifest?.name);
}

function compareSemanticVersions(left: string, right: string): number | null {
  const parse = (version: string) => {
    const match =
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
        version,
      );
    if (!match) return null;
    const prerelease = match[4] ? match[4].split(".") : null;
    if (
      prerelease?.some(
        (part) => !part || (/^\d+$/u.test(part) && part.length > 1 && part.startsWith("0")),
      )
    ) {
      return null;
    }
    return {
      core: [match[1] ?? "", match[2] ?? "", match[3] ?? ""],
      prerelease,
    };
  };
  const compareNumeric = (a: string, b: string) =>
    a.length === b.length ? (a === b ? 0 : a > b ? 1 : -1) : a.length > b.length ? 1 : -1;
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    const comparison = compareNumeric(a.core[index] ?? "0", b.core[index] ?? "0");
    if (comparison) return comparison;
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumeric = /^(0|[1-9]\d*)$/u.test(aPart);
    const bNumeric = /^(0|[1-9]\d*)$/u.test(bPart);
    if (aNumeric && bNumeric) return compareNumeric(aPart, bPart);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart > bPart ? 1 : -1;
  }
  return 0;
}

export class LocalPluginMarketplaceService {
  private nextUpdateMarketIndex = 0;
  private readonly cachedUpdates = new Map<string, CachedMarketUpdates>();
  private managedPolicy: ManagedPolicyService | null;

  constructor(
    private readonly repository: Repository,
    private readonly extensionService: ExtensionService,
    private readonly extensionRoot: string,
    options: { managedPolicy?: ManagedPolicyService } = {},
  ) {
    this.managedPolicy = options.managedPolicy ?? null;
  }

  setManagedPolicy(policy: ManagedPolicyService | null): void {
    this.managedPolicy = policy;
  }

  listSources(): LocalPluginMarketSource[] {
    return this.loadMarkets().sort((left, right) => left.name.localeCompare(right.name));
  }

  async checkForUpdates(): Promise<LocalPluginUpdateCheckResult> {
    this.managedPolicy?.assertOperational("本地插件市场更新检查");
    this.managedPolicy?.assertCapability("marketplace.update");
    const markets = this.listSources();
    const start = markets.length ? this.nextUpdateMarketIndex % markets.length : 0;
    const scanCount = Math.min(markets.length, MAX_UPDATE_CHECK_MARKETS);
    const scannedMarkets = Array.from(
      { length: scanCount },
      (_, index) => markets[(start + index) % markets.length],
    ).filter((market): market is LocalPluginMarketSource => Boolean(market));
    this.nextUpdateMarketIndex = markets.length ? (start + scanCount) % markets.length : 0;
    const result: LocalPluginUpdateCheckResult = {
      checkedMarkets: 0,
      skippedMarkets: Math.max(0, markets.length - scannedMarkets.length),
      updates: [],
      warnings: [],
    };
    if (result.skippedMarkets) {
      result.warnings.push(
        `本次轮换检查最多 ${MAX_UPDATE_CHECK_MARKETS} 个本地市场；其余 ${result.skippedMarkets} 个市场将在后续检查中轮到。`,
      );
    }

    const provenanceEntries = this.loadProvenance();
    for (const market of scannedMarkets) {
      const marketUpdates: LocalPluginUpdateCandidate[] = [];
      try {
        const rootMetadata = await lstat(market.rootPath);
        const canonicalRoot = await realpath(market.rootPath);
        if (
          !rootMetadata.isDirectory() ||
          rootMetadata.isSymbolicLink() ||
          canonicalRoot !== resolve(market.rootPath)
        ) {
          throw new Error("已登记的市场根路径发生变化，已跳过更新检测。");
        }
        const parsed = await this.parseCatalog(market.catalogPath);
        if (
          parsed.rootPath !== canonicalRoot ||
          parsed.catalogPath !== resolve(market.catalogPath) ||
          this.marketId(parsed.rootPath) !== market.id
        ) {
          throw new Error("已登记的市场根或清单解析到了其他位置，已跳过更新检测。");
        }
        result.checkedMarkets += 1;
        for (const entry of parsed.plugins) {
          const provenance = this.findInstalledProvenance(provenanceEntries, market.id, entry.name);
          if (!provenance) continue;
          const installed = this.repository.getExtension(provenance.extensionId);
          const installedManifest = this.repository.getExtensionManifest(provenance.extensionId);
          const installedVersion =
            manifestVersion(installedManifest) || provenance.installedVersion;
          if (installed?.type !== "plugin" || manifestName(installedManifest) !== entry.name) {
            result.warnings.push(
              `${market.displayName} / ${entry.name}：安装来源记录与插件不匹配，已跳过。`,
            );
            continue;
          }

          const sourcePath = resolve(parsed.rootPath, entry.source);
          if (!isInside(parsed.rootPath, sourcePath)) continue;
          const sourceStat = await lstat(sourcePath).catch(() => null);
          if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) continue;
          const canonicalSource = await realpath(sourcePath);
          if (!isInside(parsed.rootPath, canonicalSource)) continue;
          const recordedSource = await realpath(provenance.sourcePath).catch(() => null);
          if (!recordedSource || recordedSource !== canonicalSource) {
            result.warnings.push(
              `${market.displayName} / ${entry.name}：插件来源路径已变化，已跳过自动更新检测。`,
            );
            continue;
          }

          const manifestPath = await this.findPluginManifestPath(canonicalSource);
          if (!manifestPath) continue;
          const manifest = asRecord(JSON.parse(await readFile(manifestPath, "utf8")));
          const availableVersion = asString(manifest.version);
          if (manifestName(manifest) !== entry.name || availableVersion !== entry.version) {
            result.warnings.push(
              `${market.displayName} / ${entry.name}：市场条目与插件清单不一致，已跳过更新检测。`,
            );
            continue;
          }
          if (compareSemanticVersions(availableVersion, installedVersion) !== 1) continue;
          marketUpdates.push({
            marketId: market.id,
            marketName: market.displayName || market.name,
            pluginName: entry.name,
            extensionId: installed.id,
            installedVersion,
            availableVersion,
          });
        }
        this.cachedUpdates.set(market.id, {
          rootPath: market.rootPath,
          catalogPath: market.catalogPath,
          updates: marketUpdates,
        });
      } catch (error) {
        this.cachedUpdates.delete(market.id);
        result.skippedMarkets += 1;
        result.warnings.push(
          `${market.displayName || market.name}：无法检查（${error instanceof Error ? error.message : String(error)}）。`,
        );
      }
    }
    result.updates = await this.collectCachedUpdates();
    return result;
  }

  private async collectCachedUpdates(): Promise<LocalPluginUpdateCandidate[]> {
    const markets = this.listSources();
    const currentMarkets = new Map(markets.map((market) => [market.id, market]));
    const provenanceEntries = this.loadProvenance();
    const updates: LocalPluginUpdateCandidate[] = [];
    for (const [marketId, cached] of this.cachedUpdates) {
      const market = currentMarkets.get(marketId);
      if (
        !market ||
        market.rootPath !== cached.rootPath ||
        market.catalogPath !== cached.catalogPath
      ) {
        this.cachedUpdates.delete(marketId);
        continue;
      }
      try {
        const [canonicalRoot, canonicalCatalog] = await Promise.all([
          realpath(market.rootPath),
          realpath(market.catalogPath),
        ]);
        if (
          canonicalRoot !== resolve(market.rootPath) ||
          canonicalCatalog !== resolve(market.catalogPath) ||
          !isInside(canonicalRoot, canonicalCatalog)
        ) {
          this.cachedUpdates.delete(marketId);
          continue;
        }
      } catch {
        this.cachedUpdates.delete(marketId);
        continue;
      }

      const stillAvailable: LocalPluginUpdateCandidate[] = [];
      for (const candidate of cached.updates) {
        const provenance = this.findInstalledProvenance(
          provenanceEntries,
          marketId,
          candidate.pluginName,
        );
        const extension = provenance ? this.repository.getExtension(provenance.extensionId) : null;
        const manifest = provenance
          ? this.repository.getExtensionManifest(provenance.extensionId)
          : null;
        const installedVersion = manifestVersion(manifest) || provenance?.installedVersion || "";
        if (
          !provenance ||
          provenance.extensionId !== candidate.extensionId ||
          extension?.type !== "plugin" ||
          manifestName(manifest) !== candidate.pluginName ||
          compareSemanticVersions(candidate.availableVersion, installedVersion) !== 1
        ) {
          continue;
        }
        stillAvailable.push({
          ...candidate,
          installedVersion,
          marketName: market.displayName || market.name,
        });
      }
      cached.updates = stillAvailable;
      updates.push(...stillAvailable);
    }
    return updates.sort((left, right) =>
      `${left.marketName}:${left.pluginName}`.localeCompare(
        `${right.marketName}:${right.pluginName}`,
        "en",
      ),
    );
  }

  async getMarket(marketId: string): Promise<LocalPluginMarketView> {
    const market = this.requireMarket(marketId);
    return this.scanMarket(market);
  }

  async addMarket(rootOrCatalogPath: string): Promise<LocalPluginMarketView> {
    this.managedPolicy?.assertOperational("本地插件市场添加");
    this.managedPolicy?.assertCapability("marketplace.update", { approved: true });
    const parsed = await this.parseCatalog(rootOrCatalogPath);
    const id = this.marketId(parsed.rootPath);
    const now = new Date().toISOString();
    const previous = this.loadMarkets().find((market) => market.id === id);
    const market: LocalPluginMarketSource = {
      id,
      name: parsed.name,
      displayName: parsed.displayName,
      description: parsed.description,
      rootPath: parsed.rootPath,
      catalogPath: parsed.catalogPath,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.writeMarkets([...this.loadMarkets().filter((entry) => entry.id !== id), market]);
    return this.scanMarket(market, parsed);
  }

  async refreshMarket(marketId: string): Promise<LocalPluginMarketView> {
    this.managedPolicy?.assertOperational("本地插件市场刷新");
    this.managedPolicy?.assertCapability("marketplace.update", { approved: true });
    const current = this.requireMarket(marketId);
    const parsed = await this.parseCatalog(current.catalogPath);
    const market: LocalPluginMarketSource = {
      ...current,
      name: parsed.name,
      displayName: parsed.displayName,
      description: parsed.description,
      rootPath: parsed.rootPath,
      catalogPath: parsed.catalogPath,
      updatedAt: new Date().toISOString(),
    };
    this.writeMarkets(this.loadMarkets().map((entry) => (entry.id === marketId ? market : entry)));
    return this.scanMarket(market, parsed);
  }

  removeMarketSource(marketId: string): void {
    const markets = this.loadMarkets();
    if (!markets.some((market) => market.id === marketId)) throw new Error("本地插件市场不存在。");
    this.writeMarkets(markets.filter((market) => market.id !== marketId));
    this.cachedUpdates.delete(marketId);
  }

  validatePlugin(rootPath: string, signal?: AbortSignal): Promise<LocalPluginValidation> {
    return this.extensionService.inspectPluginDirectory(rootPath, signal);
  }

  async inspectDirectory(rootPath: string): Promise<LocalPluginDirectoryInspection> {
    const catalogPath = await this.catalogPathForInspection(rootPath);
    if (!catalogPath) {
      return {
        kind: "plugin",
        validation: await this.extensionService.inspectPluginDirectory(rootPath),
      };
    }

    let parsed: ParsedCatalog;
    try {
      parsed = await this.parseCatalog(rootPath);
    } catch (error) {
      const requested = resolve(rootPath.trim());
      const rootPathForError = await stat(requested)
        .then((metadata) => (metadata.isDirectory() ? requested : dirname(catalogPath)))
        .catch(() => dirname(catalogPath));
      return {
        kind: "marketplace",
        validation: {
          ok: false,
          rootPath: rootPathForError,
          catalogPath,
          name: "",
          displayName: "",
          plugins: [],
          errors: [
            issue(
              "marketplace-catalog-invalid",
              error instanceof Error ? error.message : String(error),
              catalogPath,
            ),
          ],
          warnings: [],
        },
      };
    }

    const errors: LocalPluginValidationIssue[] = [];
    const warnings: LocalPluginValidationIssue[] = [];
    const plugins: LocalPluginCatalogValidation["plugins"] = [];
    for (const entry of parsed.plugins) {
      const sourcePath = resolve(parsed.rootPath, entry.source);
      let validation: LocalPluginValidation;
      try {
        if (!isInside(parsed.rootPath, sourcePath))
          throw new Error("Plugin source escapes the marketplace root.");
        const sourceStat = await lstat(sourcePath);
        if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory())
          throw new Error("Plugin source must be a real directory inside the marketplace.");
        const canonicalSource = await realpath(sourcePath);
        if (!isInside(parsed.rootPath, canonicalSource))
          throw new Error("Plugin source resolves outside the marketplace root.");
        validation = await this.extensionService.inspectPluginDirectory(canonicalSource);
      } catch (error) {
        validation = invalidValidation(
          sourcePath,
          error instanceof Error ? error.message : String(error),
        );
      }

      const pluginErrors = [...validation.errors];
      if (validation.name !== entry.name) {
        pluginErrors.push(
          issue(
            "manifest-name-mismatch",
            `市场条目 name=${entry.name}，manifest name=${validation.name || "(missing)"}。`,
          ),
        );
      }
      if (validation.version !== entry.version) {
        pluginErrors.push(
          issue(
            "manifest-version-mismatch",
            `市场条目 version=${entry.version}，manifest version=${validation.version || "(missing)"}。`,
          ),
        );
      }
      validation = { ...validation, ok: pluginErrors.length === 0, errors: pluginErrors };
      if (
        entry.description &&
        validation.description &&
        entry.description !== validation.description
      ) {
        warnings.push(
          issue(
            "marketplace-description-mismatch",
            `插件 ${entry.name} 的市场描述与 manifest 描述不同。`,
            entry.source,
          ),
        );
      }
      if (!validation.ok) {
        errors.push(
          issue(
            "marketplace-plugin-invalid",
            `插件 ${entry.name} 校验失败（${pluginErrors.length} 项）；展开该条目查看详情。`,
            entry.source,
          ),
        );
      }
      warnings.push(
        ...validation.warnings.map((warning) => ({
          ...warning,
          path: warning.path ?? entry.source,
        })),
      );
      plugins.push({
        name: entry.name,
        source: entry.source,
        sourcePath,
        version: entry.version,
        validation,
      });
    }

    return {
      kind: "marketplace",
      validation: {
        ok: errors.length === 0,
        rootPath: parsed.rootPath,
        catalogPath: parsed.catalogPath,
        name: parsed.name,
        displayName: parsed.displayName,
        plugins,
        errors,
        warnings,
      },
    };
  }

  async installPlugin(marketId: string, pluginName: string): Promise<LocalPluginInstallResult> {
    this.managedPolicy?.assertOperational("本地插件安装");
    this.managedPolicy?.assertCapability("marketplace.update", { approved: true });
    this.managedPolicy?.assertCapability("plugin.install", { approved: true });
    const view = await this.refreshMarket(marketId);
    const plugin = view.plugins.find((entry) => entry.name === pluginName);
    if (!plugin) throw new Error("市场中不存在该插件，请刷新后重试。");
    this.assertValidForInstall(plugin);
    const provenance = this.findInstalledProvenance(this.loadProvenance(), marketId, pluginName);
    if (provenance) {
      const existing = this.repository.getExtension(provenance.extensionId);
      if (existing) {
        if (existing.contentHash === plugin.validation.contentHash) {
          return {
            action: "unchanged",
            marketId,
            plugin: this.withExtension(plugin, existing),
            extension: existing,
            warnings: [],
          };
        }
        throw new Error("该插件已有已安装版本，请使用更新操作。");
      }
    }

    const imported = await this.extensionService.importDirectory(
      plugin.sourcePath,
      plugin.validation,
    );
    const extension = imported.imported[0];
    if (extension?.type !== "plugin") {
      throw new Error(
        imported.warnings.join("\n") || "插件内容已在其他位置安装，未自动按同名认领。",
      );
    }
    try {
      this.assertInstalledPluginMatches(extension.id, plugin);
      const provenanceEntry: StoredPluginProvenance = {
        marketId,
        pluginName,
        extensionId: extension.id,
        sourcePath: plugin.sourcePath,
        installedVersion: plugin.version,
        contentHash: extension.contentHash,
        oldInstalledPaths: [],
        updatedAt: new Date().toISOString(),
      };
      this.writeProvenance([
        ...this.loadProvenance().filter(
          (entry) => entry.marketId !== marketId || entry.pluginName !== pluginName,
        ),
        provenanceEntry,
      ]);
    } catch (error) {
      await this.extensionService.remove(extension.id);
      throw error;
    }
    return {
      action: "installed",
      marketId,
      plugin: this.withExtension(plugin, extension),
      extension,
      warnings: plugin.validation.warnings.map((entry) => entry.message),
    };
  }

  async updatePlugin(marketId: string, pluginName: string): Promise<LocalPluginInstallResult> {
    this.managedPolicy?.assertOperational("本地插件更新");
    this.managedPolicy?.assertCapability("marketplace.update", { approved: true });
    this.managedPolicy?.assertCapability("plugin.install", { approved: true });
    const view = await this.refreshMarket(marketId);
    const plugin = view.plugins.find((entry) => entry.name === pluginName);
    if (!plugin) throw new Error("市场中不存在该插件，请刷新后重试。");
    this.assertValidForInstall(plugin);
    const provenanceEntries = this.loadProvenance();
    const provenance = this.findInstalledProvenance(provenanceEntries, marketId, pluginName);
    if (!provenance) {
      throw new Error("该市场插件没有安装来源记录，不能按同名自动更新。");
    }
    const [recordedSource, currentSource] = await Promise.all([
      realpath(provenance.sourcePath).catch(() => null),
      realpath(plugin.sourcePath).catch(() => null),
    ]);
    if (!recordedSource || !currentSource || recordedSource !== currentSource) {
      throw new Error("插件源路径已变化，拒绝更新已有安装；请先确认来源或重新安装。");
    }
    const previous = this.repository.getExtension(provenance.extensionId);
    const previousManifest = previous
      ? this.repository.getExtensionManifest(provenance.extensionId)
      : null;
    if (previous?.type !== "plugin" || manifestName(previousManifest) !== plugin.name) {
      throw new Error("安装来源记录与现有插件不一致，拒绝更新。");
    }
    const previousVersion = manifestVersion(previousManifest) || provenance.installedVersion;
    if (compareSemanticVersions(plugin.version, previousVersion) !== 1) {
      throw new Error("市场插件版本不是已安装版本的更新版本，已拒绝替换。");
    }
    if (previous.contentHash === plugin.validation.contentHash) {
      return {
        action: "unchanged",
        marketId,
        plugin: this.withExtension(plugin, previous),
        extension: previous,
        warnings: [],
      };
    }

    const updated = await this.extensionService.replacePluginDirectory(
      previous.id,
      plugin.sourcePath,
      plugin.validation,
    );
    try {
      this.assertInstalledPluginMatches(updated.id, plugin);
      this.writeProvenance([
        ...provenanceEntries.filter(
          (entry) => entry.marketId !== marketId || entry.pluginName !== pluginName,
        ),
        {
          ...provenance,
          installedVersion: plugin.version,
          contentHash: updated.contentHash,
          oldInstalledPaths: [
            ...provenance.oldInstalledPaths.filter(
              (path) => resolve(path) !== resolve(previous.installedPath),
            ),
            previous.installedPath,
          ],
          updatedAt: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      this.repository.updateExtensionInstall({
        id: previous.id,
        name: previous.name,
        description: previous.description,
        sourcePath: previous.sourcePath,
        installedPath: previous.installedPath,
        manifestJson: JSON.stringify(previousManifest ?? {}),
        contentHash: previous.contentHash,
      });
      await this.removeOwnedPath(updated.installedPath).catch(() => undefined);
      throw error;
    }
    return {
      action: "updated",
      marketId,
      plugin: this.withExtension(plugin, updated),
      extension: updated,
      warnings: [
        "插件更新将在下一轮或新任务生效；旧版本资源暂时保留。",
        ...plugin.validation.warnings.map((entry) => entry.message),
      ],
    };
  }

  async cleanupStaleVersions(): Promise<LocalPluginCleanupResult> {
    const result: LocalPluginCleanupResult = { removed: [], kept: [], errors: [] };
    const provenanceEntries = this.loadProvenance();
    const activePaths = new Set(
      provenanceEntries
        .map((entry) => this.repository.getExtension(entry.extensionId)?.installedPath)
        .filter((path): path is string => Boolean(path))
        .map((path) => resolve(path).toLocaleLowerCase("en-US")),
    );
    let changed = false;
    const next: StoredPluginProvenance[] = [];
    for (const entry of provenanceEntries) {
      const remaining: string[] = [];
      for (const path of entry.oldInstalledPaths) {
        if (activePaths.has(resolve(path).toLocaleLowerCase("en-US"))) {
          result.kept.push(path);
          remaining.push(path);
          continue;
        }
        try {
          await this.removeOwnedPath(path);
          result.removed.push(path);
          changed = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push(`${path}: ${message}`);
          remaining.push(path);
        }
      }
      next.push({ ...entry, oldInstalledPaths: remaining });
    }
    if (changed) this.writeProvenance(next);
    return result;
  }

  private async parseCatalog(rootOrCatalogPath: string): Promise<ParsedCatalog> {
    const requested = resolve(rootOrCatalogPath.trim());
    if (!rootOrCatalogPath.trim()) throw new Error("请选择或输入本地插件市场目录。");
    const requestedStat = await lstat(requested);
    if (requestedStat.isSymbolicLink()) {
      throw new Error("本地插件市场根目录或清单不能是符号链接。");
    }
    let rootPath: string;
    let catalogPath: string;
    if (requestedStat.isFile()) {
      if (basename(requested).toLocaleLowerCase("en-US") !== "marketplace.json") {
        throw new Error("所选文件必须命名为 marketplace.json。");
      }
      catalogPath = await realpath(requested);
      const catalogDirectory = dirname(catalogPath);
      const catalogDirectoryName = basename(catalogDirectory)
        .toLocaleLowerCase("en-US")
        .replace(/^\./u, "");
      rootPath = await realpath(
        HIDDEN_CATALOG_DIRECTORIES.has(catalogDirectoryName)
          ? dirname(catalogDirectory)
          : catalogDirectory,
      );
    } else if (requestedStat.isDirectory()) {
      rootPath = await realpath(requested);
      let found: string | null = null;
      for (const candidate of CATALOG_CANDIDATES) {
        const path = join(rootPath, ...candidate.split("/"));
        try {
          if ((await stat(path)).isFile()) {
            found = await realpath(path);
            break;
          }
        } catch {
          // Try the next supported hidden catalog path.
        }
      }
      if (!found) {
        throw new Error(`市场目录中缺少 ${CATALOG_CANDIDATES.join("、")} 之一。`);
      }
      catalogPath = found;
    } else {
      throw new Error("本地插件市场路径不是目录或 marketplace.json。");
    }
    if (!isInside(rootPath, catalogPath)) {
      throw new Error("插件市场清单必须位于所选市场目录内。");
    }
    const catalogStat = await stat(catalogPath);
    if (!catalogStat.isFile() || catalogStat.size > MAX_CATALOG_BYTES) {
      throw new Error("marketplace.json 必须是普通文件且不超过 1 MiB。");
    }
    const raw = JSON.parse(await readFile(catalogPath, "utf8")) as unknown;
    const record = asRecord(raw);
    const name = asString(record.name);
    if (!name || !MARKET_NAME.test(name)) {
      throw new Error("marketplace.json 的 name 必须是稳定的小写连字符标识。");
    }
    if (!Array.isArray(record.plugins)) {
      throw new Error("marketplace.json 缺少 plugins 数组。");
    }
    if (record.plugins.length > MAX_CATALOG_PLUGINS) {
      throw new Error(`本地插件市场最多允许 ${MAX_CATALOG_PLUGINS} 个条目。`);
    }
    const plugins: CatalogEntry[] = [];
    const seen = new Set<string>();
    for (const manifestPlugin of record.plugins) {
      const entry = asRecord(manifestPlugin);
      const pluginName = asString(entry.name);
      const source = asString(entry.source);
      const version = asString(entry.version);
      if (!pluginName || !PLUGIN_ENTRY_NAME.test(pluginName)) {
        throw new Error("marketplace.json 的插件 name 无效。");
      }
      if (seen.has(pluginName)) throw new Error(`marketplace.json 存在重复插件：${pluginName}`);
      seen.add(pluginName);
      if (!source || isAbsolute(source) || source.split(/[\\/]/).includes("..")) {
        throw new Error(`插件 ${pluginName} 的 source 必须是市场根内相对目录。`);
      }
      if (!SEMANTIC_VERSION.test(version)) {
        throw new Error(`插件 ${pluginName} 的 catalog version 无效。`);
      }
      plugins.push({
        name: pluginName,
        source,
        version,
        description: asString(entry.description),
        displayName: asString(entry.displayName) || pluginName,
        category: asString(entry.category) || "other",
      });
    }
    return {
      rootPath,
      catalogPath,
      name,
      displayName: asString(record.displayName) || name,
      description: asString(record.description),
      plugins,
    };
  }

  private async findPluginManifestPath(pluginRoot: string): Promise<string | null> {
    const candidates = [
      ".mingshen-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      ".zcode-plugin/plugin.json",
      "plugin.json",
    ];
    for (const candidate of candidates) {
      const path = join(pluginRoot, ...candidate.split("/"));
      const metadata = await lstat(path).catch(() => null);
      if (!metadata) continue;
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 1024 * 1024) {
        return null;
      }
      const canonicalPath = await realpath(path);
      if (!isInside(pluginRoot, canonicalPath)) return null;
      return canonicalPath;
    }
    return null;
  }

  private async catalogPathForInspection(rootOrCatalogPath: string): Promise<string | null> {
    const input = rootOrCatalogPath.trim();
    if (!input) return null;
    const requested = resolve(input);
    const requestedStat = await lstat(requested).catch(() => null);
    if (!requestedStat) return null;
    if (basename(requested).toLocaleLowerCase("en-US") === "marketplace.json") return requested;
    if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) return null;

    for (const candidate of CATALOG_CANDIDATES) {
      const path = join(requested, ...candidate.split("/"));
      const metadata = await lstat(path).catch(() => null);
      if (metadata) return path;
    }
    return null;
  }

  private async scanMarket(
    market: LocalPluginMarketSource,
    parsedCatalog?: ParsedCatalog,
  ): Promise<LocalPluginMarketView> {
    const parsed = parsedCatalog ?? (await this.parseCatalog(market.catalogPath));
    const provenance = this.loadProvenance();
    const warnings: string[] = [];
    const plugins: LocalPluginMarketPlugin[] = [];
    for (const entry of parsed.plugins) {
      const sourcePath = resolve(parsed.rootPath, entry.source);
      let validation: LocalPluginValidation;
      try {
        if (!isInside(parsed.rootPath, sourcePath)) {
          throw new Error("Plugin source escapes the marketplace root.");
        }
        const sourceStat = await lstat(sourcePath);
        if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
          throw new Error("Plugin source must be a real directory inside the marketplace.");
        }
        const canonicalSource = await realpath(sourcePath);
        if (!isInside(parsed.rootPath, canonicalSource)) {
          throw new Error("Plugin source resolves outside the marketplace root.");
        }
        validation = await this.extensionService.inspectPluginDirectory(canonicalSource);
      } catch (error) {
        validation = invalidValidation(
          sourcePath,
          error instanceof Error ? error.message : String(error),
        );
      }
      const catalogErrors = [...validation.errors];
      if (validation.name !== entry.name) {
        catalogErrors.push(
          issue(
            "manifest-name-mismatch",
            `市场条目 name=${entry.name}，manifest name=${validation.name || "(missing)"}。`,
          ),
        );
      }
      if (validation.version !== entry.version) {
        catalogErrors.push(
          issue(
            "manifest-version-mismatch",
            `市场条目 version=${entry.version}，manifest version=${validation.version || "(missing)"}。`,
          ),
        );
      }
      if (
        entry.description &&
        validation.description &&
        entry.description !== validation.description
      ) {
        warnings.push(`插件 ${entry.name} 的市场描述与 manifest 描述不同。`);
      }
      validation = { ...validation, ok: catalogErrors.length === 0, errors: catalogErrors };
      const installedProvenance = this.findInstalledProvenance(provenance, market.id, entry.name);
      const extension = installedProvenance
        ? this.repository.getExtension(installedProvenance.extensionId)
        : null;
      const installed = Boolean(
        extension &&
          extension.type === "plugin" &&
          resolve(installedProvenance?.sourcePath ?? "") === resolve(sourcePath),
      );
      plugins.push({
        id: entry.name,
        name: entry.name,
        displayName: entry.displayName,
        version: entry.version,
        description: entry.description || validation.description,
        category: entry.category,
        source: entry.source.replaceAll("\\", "/"),
        sourcePath,
        manifestPath: validation.manifestPath,
        installed,
        installedVersion: installed
          ? manifestVersion(this.repository.getExtensionManifest(extension?.id ?? ""))
          : null,
        extensionId: installed ? (extension?.id ?? null) : null,
        enabled: installed ? Boolean(extension?.enabled) : false,
        updateAvailable:
          installed &&
          Boolean(installedProvenance) &&
          compareSemanticVersions(
            validation.version,
            manifestVersion(this.repository.getExtensionManifest(extension?.id ?? "")) ||
              installedProvenance?.installedVersion ||
              "",
          ) === 1,
        validation,
      });
    }
    return { market, plugins, warnings };
  }

  private assertValidForInstall(plugin: LocalPluginMarketPlugin): void {
    if (!plugin.validation.ok) {
      throw new Error(
        plugin.validation.errors.map((entry) => `${entry.code}: ${entry.message}`).join("\n"),
      );
    }
  }

  private findInstalledProvenance(
    entries: StoredPluginProvenance[],
    marketId: string,
    pluginName: string,
  ): StoredPluginProvenance | undefined {
    return entries.find(
      (entry) =>
        entry.marketId === marketId &&
        entry.pluginName === pluginName &&
        Boolean(this.repository.getExtension(entry.extensionId)),
    );
  }

  private assertInstalledPluginMatches(extensionId: string, plugin: LocalPluginMarketPlugin): void {
    const extension = this.repository.getExtension(extensionId);
    const manifest = this.repository.getExtensionManifest(extensionId);
    if (
      extension?.type !== "plugin" ||
      extension.contentHash !== plugin.validation.contentHash ||
      manifestName(manifest) !== plugin.name ||
      manifestVersion(manifest) !== plugin.version
    ) {
      throw new Error(
        "PLUGIN_INSTALL_MISMATCH: 安装副本与市场校验快照不一致，已拒绝登记安装来源。",
      );
    }
  }

  private withExtension(
    plugin: LocalPluginMarketPlugin,
    extension: ExtensionView,
  ): LocalPluginMarketPlugin {
    return {
      ...plugin,
      installed: true,
      installedVersion:
        manifestVersion(this.repository.getExtensionManifest(extension.id)) || plugin.version,
      extensionId: extension.id,
      enabled: extension.enabled,
      updateAvailable: false,
      validation: plugin.validation,
    };
  }

  private marketId(rootPath: string): string {
    return `local-${createHash("sha256")
      .update(resolve(rootPath).toLocaleLowerCase("en-US"))
      .digest("hex")
      .slice(0, 16)}`;
  }

  private loadMarkets(): LocalPluginMarketSource[] {
    const raw = this.repository.getSetting(MARKETS_SETTING);
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeStoredMarket)
      .filter((market): market is LocalPluginMarketSource => Boolean(market));
  }

  private writeMarkets(markets: LocalPluginMarketSource[]): void {
    this.repository.setSetting(MARKETS_SETTING, markets);
  }

  private requireMarket(marketId: string): LocalPluginMarketSource {
    const market = this.loadMarkets().find((entry) => entry.id === marketId);
    if (!market) throw new Error("本地插件市场不存在。");
    return market;
  }

  private loadProvenance(): StoredPluginProvenance[] {
    const raw = this.repository.getSetting(PROVENANCE_SETTING);
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeProvenance)
      .filter((entry): entry is StoredPluginProvenance => Boolean(entry));
  }

  private writeProvenance(provenance: StoredPluginProvenance[]): void {
    this.repository.setSetting(PROVENANCE_SETTING, provenance);
  }

  private async removeOwnedPath(path: string): Promise<void> {
    const target = resolve(path);
    if (!isInside(this.extensionRoot, target)) {
      throw new Error("Refusing to remove a path outside the extension root.");
    }
    const local = relative(resolve(this.extensionRoot), target);
    const parts = local.split(sep);
    if (parts.length !== 3 || parts[0] !== "plugin" || parts[2] !== "content") {
      throw new Error("Refusing to remove an unrecognized extension version path.");
    }
    const metadata = await lstat(target);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Only a real installed plugin directory can be removed.");
    }
    await rm(target, { recursive: true, force: false });
  }
}

const PLUGIN_ENTRY_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
