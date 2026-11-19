import type { ExtensionType, SessionBuiltinCapabilityView } from "../../../shared/domain";

export type CapabilitySource = "builtin" | "installed";

export interface CapabilityGroupDefinition {
  key: `${CapabilitySource}-${ExtensionType}`;
  source: CapabilitySource;
  type: ExtensionType;
  label: string;
}

export const CAPABILITY_GROUPS: CapabilityGroupDefinition[] = [
  {
    key: "builtin-skill",
    source: "builtin",
    type: "skill",
    label: "内置 Skills",
  },
  {
    key: "builtin-plugin",
    source: "builtin",
    type: "plugin",
    label: "内置 Plugins",
  },
  {
    key: "installed-skill",
    source: "installed",
    type: "skill",
    label: "已安装 Skills",
  },
  {
    key: "installed-plugin",
    source: "installed",
    type: "plugin",
    label: "已安装 Plugins",
  },
];

export interface CapabilitySearchFields {
  id?: string;
  name: string;
  description: string;
  family?: string | null;
  version?: string | null;
  compatibility?: string | null;
  sourcePath?: string | null;
  sourceSha256?: string | null;
}

export function capabilitySearchText(capability: CapabilitySearchFields): string {
  return [
    capability.id,
    capability.name,
    capability.description,
    capability.family,
    capability.version,
    capability.compatibility,
    capability.sourcePath,
    capability.sourceSha256,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("zh-CN");
}

export function capabilityMatchesQuery(capability: CapabilitySearchFields, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase("zh-CN").split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const searchText = capabilitySearchText(capability);
  const compactSearchText = searchText.replace(/[\s._:-]+/g, "");
  return terms.every((term) => {
    if (searchText.includes(term)) return true;
    const compactTerm = term.replace(/[\s._:-]+/g, "");
    return Boolean(compactTerm) && compactSearchText.includes(compactTerm);
  });
}

export function builtinCapabilityMeta(
  capability: Pick<SessionBuiltinCapabilityView, "family" | "version" | "compatibility">,
): string | null {
  if (capability.version) return `v${capability.version}`;
  return capability.compatibility ?? capability.family;
}

export function builtinCapabilitySourceDetail(
  capability: Pick<SessionBuiltinCapabilityView, "sourcePath" | "sourceSha256">,
): string | null {
  const sha = capability.sourceSha256?.slice(0, 12);
  return [capability.sourcePath, sha].filter(Boolean).join(" · ") || null;
}

export function capabilitySelectionCounts(
  builtinCapabilities: readonly Pick<SessionBuiltinCapabilityView, "selected">[],
  installedSelectedIds: readonly string[],
): { builtin: number; installed: number; total: number } {
  const builtin = builtinCapabilities.filter((capability) => capability.selected).length;
  const installed = new Set(installedSelectedIds).size;
  return { builtin, installed, total: builtin + installed };
}
