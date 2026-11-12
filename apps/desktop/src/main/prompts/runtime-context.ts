import { z } from "zod";

const reasoningLevelSchema = z.string().trim().min(1).max(32);

export const runtimeContextSchema = z.object({
  app_version: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/),
  session_id: z.uuid(),
  turn_id: z.uuid(),
  agent_depth: z.number().int().min(0).max(1),
  locale: z.enum(["zh-CN", "en"]),
  os: z.string().min(1).max(128),
  shell: z.string().min(1).max(128),
  workspace_path: z.string().min(1).max(32_767),
  workspace_trusted: z.boolean(),
  permission_mode: z.enum(["request_approval", "full_access"]),
  execution_isolation: z.enum(["native_windows", "docker", "host"]).default("host"),
  model: z.object({
    id: z.string().min(1).max(256),
    context_window: z.number().int().positive(),
    max_output_tokens: z.number().int().positive(),
    input_modalities: z.array(z.enum(["text", "image", "audio", "video", "file"])).min(1),
    tool_calls: z.boolean(),
    parallel_tool_calls: z.boolean(),
    reasoning_level: reasoningLevelSchema.nullable(),
  }),
  available_tools: z.array(z.string().min(1).max(128)).max(256),
  subagents: z
    .object({
      max_concurrent: z.number().int().min(1).max(8),
      profiles: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          read_only: z.boolean(),
        }),
      ),
    })
    .optional(),
  enabled_skills: z.array(z.string().min(1).max(256)).max(256),
  enabled_mcp_servers: z.array(z.string().min(1).max(256)).max(256),
  agent_profile: z
    .object({
      id: z.string().min(1).max(128),
      name: z.string().min(1).max(120),
      role: z.enum(["primary", "plan", "subagent", "all"]),
      read_only: z.boolean(),
    })
    .nullable(),
});

export type RuntimeContext = z.infer<typeof runtimeContextSchema>;
