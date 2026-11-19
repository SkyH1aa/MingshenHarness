import { z } from "zod";
import type { LocalPluginMarketSource, LocalPluginValidation } from "../../shared/local-plugins";

const pluginRootSchema = z
  .string()
  .trim()
  .min(1)
  .max(32_767)
  .describe("Absolute path to a plugin source directory inside the current workspace.");

export const localPluginRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("inspect"),
      rootPath: pluginRootSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("validate"),
      rootPath: pluginRootSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("list_markets"),
    })
    .strict(),
]);

export type LocalPluginRequest = z.infer<typeof localPluginRequestSchema>;

export interface LocalPluginReadService {
  listSources(): LocalPluginMarketSource[];
  validatePlugin(rootPath: string, signal?: AbortSignal): Promise<LocalPluginValidation>;
}

export const LOCAL_PLUGIN_TOOL = {
  name: "local_plugin",
  description:
    "Read-only local-plugin development interface for primary CodeAgent and WorkAgent sessions. Use inspect or validate on an absolute plugin source directory inside the current workspace, or list registered local development markets. The host validates the manifest, Skills, declarations, paths, limits and content hash. In a protected session the host asks for read approval before scanning the plugin source; use this authoritative validator instead of invoking the Node SDK CLI, which is unavailable in native_windows. It never installs, updates, enables, uninstalls or executes plugin code, hooks, MCP servers or commands. Installation and lifecycle changes remain explicit user actions in Settings > Skills and plugins > Local plugin development marketplace.",
  parameters: z.toJSONSchema(localPluginRequestSchema, { target: "draft-7" }),
};
