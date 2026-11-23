import type { ExtensionView } from "./domain";

export type LocalPluginManifestKind = "mingshen" | "codex" | "zcode" | "legacy";

export interface LocalPluginValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface LocalPluginSkill {
  id: string;
  name: string;
  description: string;
  relativePath: string;
}

export interface LocalPluginValidation {
  ok: boolean;
  rootPath: string;
  manifestPath: string | null;
  manifestKind: LocalPluginManifestKind | null;
  name: string;
  version: string;
  description: string;
  contentHash: string;
  skills: LocalPluginSkill[];
  commands: string[];
  hookEvents: string[];
  mcpServers: string[];
  errors: LocalPluginValidationIssue[];
  warnings: LocalPluginValidationIssue[];
}

export interface LocalPluginCatalogValidationEntry {
  name: string;
  source: string;
  sourcePath: string;
  version: string;
  validation: LocalPluginValidation;
}

export interface LocalPluginCatalogValidation {
  ok: boolean;
  rootPath: string;
  catalogPath: string;
  name: string;
  displayName: string;
  plugins: LocalPluginCatalogValidationEntry[];
  errors: LocalPluginValidationIssue[];
  warnings: LocalPluginValidationIssue[];
}

export type LocalPluginDirectoryInspection =
  | { kind: "plugin"; validation: LocalPluginValidation }
  | { kind: "marketplace"; validation: LocalPluginCatalogValidation };

export interface LocalPluginMarketSource {
  id: string;
  name: string;
  displayName: string;
  description: string;
  rootPath: string;
  catalogPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalPluginMarketPlugin {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  category: string;
  source: string;
  sourcePath: string;
  manifestPath: string | null;
  installed: boolean;
  installedVersion: string | null;
  extensionId: string | null;
  enabled: boolean;
  updateAvailable: boolean;
  validation: LocalPluginValidation;
}

export interface LocalPluginMarketView {
  market: LocalPluginMarketSource;
  plugins: LocalPluginMarketPlugin[];
  warnings: string[];
}

export interface LocalPluginUpdateCandidate {
  marketId: string;
  marketName: string;
  pluginName: string;
  extensionId: string;
  installedVersion: string;
  availableVersion: string;
}

export interface LocalPluginUpdateCheckResult {
  checkedMarkets: number;
  skippedMarkets: number;
  updates: LocalPluginUpdateCandidate[];
  warnings: string[];
}

export type LocalPluginInstallAction = "installed" | "updated" | "unchanged";

export interface LocalPluginInstallResult {
  action: LocalPluginInstallAction;
  marketId: string;
  plugin: LocalPluginMarketPlugin;
  extension: ExtensionView;
  warnings: string[];
}

export interface LocalPluginCleanupResult {
  removed: string[];
  kept: string[];
  errors: string[];
}
