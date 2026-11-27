import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ManagedCapability } from "../../shared/managed-policy";
import type { ManagedPolicyService } from "../policy/managed-policy-service";
import { CustomCommandService } from "./custom-command-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("CustomCommandService managed policy", () => {
  it("defers ask decisions while avoiding unapproved inline file reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-command-policy-"));
    temporaryDirectories.push(root);
    const commands = join(root, ".mingshen", "commands");
    await mkdir(commands, { recursive: true });
    await writeFile(join(root, "secret.txt"), "TOP SECRET", "utf8");
    await writeFile(
      join(commands, "demo.md"),
      ["---", "description: policy test", "---", "Run !`echo ready`", "Read @secret.txt"].join(
        "\n",
      ),
      "utf8",
    );
    const evaluated: ManagedCapability[] = [];
    const asserted: ManagedCapability[] = [];
    const managedPolicy = {
      assertOperational() {},
      evaluateCapability(capability: ManagedCapability) {
        evaluated.push(capability);
        return {
          decision: "ask",
          capability,
          policyDecision: "ask",
          approved: false,
          revision: "revision",
          reason: `approval required for ${capability}`,
        };
      },
      assertCapability(capability: ManagedCapability) {
        asserted.push(capability);
      },
    } as unknown as ManagedPolicyService;
    const service = new CustomCommandService(undefined, { managedPolicy });

    const prepared = await service.prepare(root, "/demo", true);

    expect(prepared).not.toBeNull();
    expect(prepared?.shellCommands).toEqual([
      { placeholder: "[[MINGSHEN_SHELL_1]]", command: "echo ready" },
    ]);
    expect(prepared?.prompt).toContain("[[MINGSHEN_SHELL_1]]");
    expect(prepared?.prompt).toContain(
      "[Reference secret.txt: use the approved read_file tool to read this file.]",
    );
    expect(prepared?.prompt).not.toContain("TOP SECRET");
    expect(evaluated).toEqual(["file.read", "command.execute"]);
    expect(asserted).toEqual([]);
  });
});
