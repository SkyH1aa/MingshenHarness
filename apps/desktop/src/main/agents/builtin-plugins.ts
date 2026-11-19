import type { SessionView } from "../../shared/domain";
import type { CapabilityDiscoveryRecord } from "./domain-skills";

export interface BuiltinPluginDefinition {
  id: `builtin:plugin-${string}`;
  name: string;
  description: string;
  toolPrefix: string;
  connectionBoundary: string;
  approvalBoundary: string;
  modes: readonly ("code" | "work")[];
  aliases: string;
}

export const BUILTIN_PLUGINS: readonly BuiltinPluginDefinition[] = [
  {
    id: "builtin:plugin-github",
    name: "GitHub API",
    description:
      "Connected GitHub API tools for repository search, pull requests, issues and Actions inspection, with explicit issue and pull-request comment writes. Requires an existing GitHub connection and never starts sign-in or grants credentials.",
    toolPrefix: "github_",
    connectionBoundary:
      "Requires an existing GitHub connection. Missing credentials or connection failures stop the tool call; no login or token setup is automatic.",
    approvalBoundary:
      "Read tools follow the active Profile and session approval policy. Issue creation and PR comments require their existing write-tool policy and request-approval gate.",
    modes: ["code", "work"],
    aliases: "github repository pull request issue actions 仓库 拉取请求 议题 工作流 github api",
  },
  {
    id: "builtin:plugin-browser",
    name: "Embedded Browser",
    description:
      "Embedded Chrome/Edge browser tools for opening pages, navigating, inspecting snapshots, interacting with controls and taking screenshots. Requires an existing session and never launches, logs in or authenticates automatically.",
    toolPrefix: "browser_",
    connectionBoundary:
      "Uses the app's isolated Chrome/Edge browser. Opening or navigating remains an explicit tool action and is not performed merely by selecting the plugin.",
    approvalBoundary:
      "Browser tools follow the active Profile allowlist and existing browser approval gate, including elevated request-approval for interactions.",
    modes: ["code", "work"],
    aliases:
      "chrome edge embedded browser webpage website web app 浏览器 网页 自动化 click navigate screenshot",
  },
] as const;

export function builtinPluginsForSession(session: SessionView): readonly BuiltinPluginDefinition[] {
  if (session.agentMode === "chat") return [];
  const mode = session.agentMode === "work" ? "work" : "code";
  return BUILTIN_PLUGINS.filter((plugin) => plugin.modes.includes(mode));
}

export function isBuiltinPluginId(id: string): boolean {
  return BUILTIN_PLUGINS.some((plugin) => plugin.id === id);
}

export function builtinPluginToolNames(
  plugin: BuiltinPluginDefinition,
  availableToolNames: ReadonlySet<string>,
): string[] {
  return [...availableToolNames]
    .filter((name) => name.startsWith(plugin.toolPrefix))
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function builtinPluginDiscoveryRecords(
  session: SessionView,
  availableToolNames: ReadonlySet<string>,
  selectedIds: ReadonlySet<string> = new Set(),
  includeUnavailable = false,
): CapabilityDiscoveryRecord[] {
  return builtinPluginsForSession(session)
    .map((plugin) => {
      const toolNames = builtinPluginToolNames(plugin, availableToolNames);
      return {
        type: "plugin" as const,
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        session_selected: selectedIds.has(plugin.id),
        source: "builtin" as const,
        builtin_kind: "plugin",
        tool_names: toolNames,
        connection_boundary: plugin.connectionBoundary,
        approval_boundary: plugin.approvalBoundary,
        available: toolNames.length > 0,
        searchable: `${plugin.name} ${plugin.description} ${plugin.aliases} plugin 插件 builtin 内置 ${toolNames.join(" ")}`,
      };
    })
    .filter((record) => includeUnavailable || record.available);
}
