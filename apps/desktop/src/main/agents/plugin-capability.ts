import { z } from "zod";

export const usePluginSchema = z
  .object({
    plugin_id: z.string().trim().min(1).max(200),
  })
  .strict();

export const USE_PLUGIN_TOOL = {
  name: "use_plugin",
  description:
    "Select one exact installed enabled local plugin by its id from discover_capabilities for this run. This makes its metadata and Skills available, adds its declared BeforeModelRequest prompt context before subsequent model requests, exposes its exact MCP tools on the next model round, and makes later action hooks eligible under normal trust, approval and execution checks. It does not execute plugin scripts or slash commands immediately, grant permissions, or alter persistent session references. UserPromptSubmit is not retroactive. Each MCP call still follows normal execution isolation and approval policy. Plugins marked activation=required must already be explicitly referenced by the user in this session.",
  parameters: z.toJSONSchema(usePluginSchema, { target: "draft-7" }),
};
