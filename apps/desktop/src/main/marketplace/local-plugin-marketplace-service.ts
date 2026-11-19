import { createHash } from "node:crypto";
import { lstat, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionView } from "../../shared/domain";
import type {
  LocalPluginCleanupResult,
  LocalPluginInstallResult,
  LocalPluginMarketPlugin,
  LocalPluginMarketSource,
  LocalPluginMarketView,
  LocalPluginValidation,
  LocalPluginValidationIssue,
} from "../../shared/local-plugins";
import type { ExtensionService } from "../extensions/extension-service";
import type { Repository } from "../storage/repository";

const MARKETS_SETTING = "localPluginMarkets" + ".v1";
const PROVENANCE_SETTING = "localPluginProvenance.v1";
const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_CATALOG_PLUGINS = 200;
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

export class LocalPluginMarketplaceService {
  constructor(
    private readonly repository: Repository,
    private readonly extensionService: ExtensionService,
    private readonly extensionRoot: string,
  ) {}

  listSources(): LocalPluginMarketSource[] {
    return this.loadMarkets().sort((left, right) => left.name.localeCompare(right.name));
  }

  async getMarket(marketId: string): Promise<LocalPluginMarketView> {
    const market = this.requireMarket(marketId);
    return this.scanMarket(market);
  }

  async addMarket(rootOrCatalogPath: string): Promise<LocalPluginMarketView> {
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
  }

  validatePlugin(rootPath: string, signal?: AbortSignal): Promise<LocalPluginValidation> {
    return this.extensionService.inspectPluginDirectory(rootPath, signal);
  }

  async installPlugin(marketId: string, pluginName: string): Promise<LocalPluginInstallResult> {
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
    const view = await this.refreshMarket(marketId);
    const plugin = view.plugins.find((entry) => entry.name === pluginName);
    if (!plugin) throw new Error("市场中不存在该插件，请刷新后重试。");
    this.assertValidForInstall(plugin);
    const provenanceEntries = this.loadProvenance();
    const provenance = this.findInstalledProvenance(provenanceEntries, marketId, pluginName);
    if (!provenance) {
      throw new Error("该市场插件没有安装来源记录，不能按同名自动更新。");
    }
    if (resolve(provenance.sourcePath) !== resolve(plugin.sourcePath)) {
      throw new Error("插件源路径已变化，拒绝更新已有安装；请先确认来源或重新安装。");
    }
    const previous = this.repository.getExtension(provenance.extensionId);
    const previousManifest = previous
      ? this.repository.getExtensionManifest(provenance.extensionId)
      : null;
    if (previous?.type !== "plugin" || manifestName(previousManifest) !== plugin.name) {
      throw new Error("安装来源记录与现有插件不一致，拒绝更新。");
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
          installed && validation.version !== (installedProvenance?.installedVersion ?? ""),
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
