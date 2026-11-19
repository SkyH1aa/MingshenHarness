import { readFile, stat } from "node:fs/promises";
import { safeFilePath } from "../workspace/safe-file-path";

const MAX_DECLARATION_BYTES = 1024 * 1024;

export const PLUGIN_ROOT_TOKENS = [
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal protocol token expanded by the host.
  "${MINGSHEN_PLUGIN_ROOT}",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal compatibility token expanded by the host.
  "${CLAUDE_PLUGIN_ROOT}",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal compatibility token expanded by the host.
  "${ZCODE_PLUGIN_ROOT}",
] as const;

export type PluginDeclarationKey = "hooks" | "mcpServers";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function pluginDeclarationMap(
  parsed: unknown,
  containerKey: PluginDeclarationKey,
): Record<string, unknown> {
  const record = asRecord(parsed);
  const wrapped = record[containerKey];
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
    return wrapped as Record<string, unknown>;
  }
  if (
    containerKey === "mcpServers" &&
    record.mcp_servers &&
    typeof record.mcp_servers === "object" &&
    !Array.isArray(record.mcp_servers)
  ) {
    return record.mcp_servers as Record<string, unknown>;
  }
  return record;
}

export async function loadLocalPluginJsonDeclaration(
  pluginRoot: string,
  value: unknown,
  containerKey: PluginDeclarationKey,
): Promise<Record<string, unknown>> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return pluginDeclarationMap(value, containerKey);
  }
  if (typeof value !== "string" || !value.trim()) return {};

  const declarationPath = await safeFilePath(pluginRoot, value.trim());
  const metadata = await stat(declarationPath);
  if (!metadata.isFile()) {
    throw new Error(`${containerKey} declaration must point to a regular JSON file.`);
  }
  if (metadata.size > MAX_DECLARATION_BYTES) {
    throw new Error(`${containerKey} declaration exceeds the 1 MiB limit.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(declarationPath, "utf8"));
  } catch (error) {
    throw new Error(
      `${containerKey} declaration is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${containerKey} declaration must contain a JSON object.`);
  }
  return pluginDeclarationMap(parsed, containerKey);
}

export function expandPluginRootTokens(value: string, pluginRoot: string): string {
  let expanded = value;
  for (const token of PLUGIN_ROOT_TOKENS) expanded = expanded.split(token).join(pluginRoot);
  return expanded;
}
