import { z } from "zod";
import type { StreamToolDefinition } from "../providers/model-stream";
import { type ToolExecutionResult, validateChainToolArguments } from "../tools/tool-registry";

const ELIGIBLE = new Set([
  "read_file",
  "read_document",
  "list_files",
  "search_files",
  "glob_files",
  "code_index",
  "write_file",
  "replace_in_file",
  "apply_patch",
  "delete_file",
  "create_document",
  "run_command",
]);
const chainSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
            tool: z.string().min(1),
            arguments: z.record(z.string(), z.unknown()),
            after: z.array(z.string()).max(8).default([]),
            when: z
              .object({
                step: z.string(),
                contains: z.string().min(1).max(1000),
              })
              .optional(),
          })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();

export type ToolChainStep = z.infer<typeof chainSchema>["steps"][number];
export function compileToolChain(args: unknown, tools: StreamToolDefinition[]): ToolChainStep[] {
  const serialized = JSON.stringify(args);
  if (!serialized || serialized.length > 120_000)
    throw new Error("Execution chain is empty or too large.");
  const { steps } = chainSchema.parse(args);
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) throw new Error("Execution chain has duplicate step IDs.");
    if (!ELIGIBLE.has(step.tool) || !tools.some((tool) => tool.name === step.tool))
      throw new Error(`Execution chain tool is unavailable: ${step.tool}`);
    validateChainToolArguments(step.tool, step.arguments);
    if (step.after.some((id) => !seen.has(id)) || (step.when && !seen.has(step.when.step)))
      throw new Error("Execution chain dependencies must refer to earlier steps.");
    seen.add(step.id);
  }
  return steps;
}
export function chainMayContinue(
  step: ToolChainStep,
  results: Map<string, ToolExecutionResult>,
): boolean {
  if ([...results.values()].some((result) => result.isError)) return false;
  if (step.after.some((id) => !results.has(id) || results.get(id)?.isError)) return false;
  return !step.when || Boolean(results.get(step.when.step)?.output.includes(step.when.contains));
}
export const TOOL_CHAIN_DESCRIPTOR: StreamToolDefinition = {
  name: "execute_tool_chain",
  description:
    "Compile 2-8 already-decided local tool actions into a bounded execution chain, saving model round trips. Use only when ALL arguments and success conditions are known now. Static arguments only; no code, templates or output interpolation. Actions run sequentially through normal approvals, isolation, locks and checkpoints. Any failure, false guard, cancellation, plan change or edit diagnostic stops the remaining actions and returns control to you. Not a cross-task replay cache. Each executed action and result remains in history.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["steps"],
    properties: {
      steps: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "tool", "arguments"],
          properties: {
            id: { type: "string", description: "Unique short step ID." },
            tool: { type: "string", enum: [...ELIGIBLE] },
            arguments: { type: "object", additionalProperties: true },
            after: {
              type: "array",
              items: { type: "string" },
              description: "Earlier step IDs that must succeed.",
            },
            when: {
              type: "object",
              additionalProperties: false,
              required: ["step", "contains"],
              properties: {
                step: { type: "string" },
                contains: {
                  type: "string",
                  description: "Literal required substring of an earlier result.",
                },
              },
            },
          },
        },
      },
    },
  },
};
