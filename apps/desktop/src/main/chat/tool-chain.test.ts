import { describe, expect, it } from "vitest";
import type { StreamToolDefinition } from "../providers/model-stream";
import { chainMayContinue, compileToolChain } from "./tool-chain";

const tools: StreamToolDefinition[] = [
  {
    name: "read_file",
    description: "read",
    parameters: { type: "object", required: ["path"] },
  },
  {
    name: "code_index",
    description: "index",
    parameters: { type: "object" },
  },
  {
    name: "run_command",
    description: "run",
    parameters: { type: "object", required: ["command"] },
  },
];

describe("controlled tool chains", () => {
  it("compiles only static, ordered, schema-valid actions", () => {
    const steps = compileToolChain(
      {
        steps: [
          { id: "read", tool: "read_file", arguments: { path: "src/index.ts" } },
          {
            id: "inspect",
            tool: "code_index",
            arguments: { operation: "symbols", query: "main" },
            after: ["read"],
            when: { step: "read", contains: "ok" },
          },
        ],
      },
      tools,
    );
    expect(steps).toHaveLength(2);
    expect(() =>
      compileToolChain(
        {
          steps: [
            { id: "bad", tool: "code_index", arguments: { limit: 0 } },
            { id: "next", tool: "read_file", arguments: { path: "a" } },
          ],
        },
        tools,
      ),
    ).toThrow();
  });

  it("stops after failed prerequisites or a false literal guard", () => {
    const step = {
      id: "next",
      tool: "run_command",
      arguments: { command: "pnpm test" },
      after: ["read"],
      when: { step: "read", contains: "ready" },
    };
    expect(chainMayContinue(step, new Map([["read", { output: "waiting", isError: false }]]))).toBe(
      false,
    );
    expect(chainMayContinue(step, new Map([["read", { output: "ready", isError: false }]]))).toBe(
      true,
    );
    expect(chainMayContinue(step, new Map([["read", { output: "ready", isError: true }]]))).toBe(
      false,
    );
  });
});
