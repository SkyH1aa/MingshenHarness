import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomCommandService } from "./custom-command-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("CustomCommandService", () => {
  it("expands global commands without a workspace and leaves file references for approved tools", async () => {
    const service = new CustomCommandService();
    const list = vi.spyOn(service, "list").mockResolvedValue([
      {
        id: "global",
        name: "review",
        description: "Review",
        agent: null,
        model: null,
        sourcePath: "fixture",
        template: "Review $ARGUMENTS @README.md",
      },
    ]);
    const result = await service.prepare(null, "/review the plan");
    expect(list).toHaveBeenCalledWith(null);
    expect(result?.prompt).toContain("Review the plan");
    expect(result?.prompt).toContain("approved read_file tool");
    expect(result?.shellCommands).toEqual([]);
  });
  it("discovers markdown commands and expands arguments, files and shell placeholders", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-command-"));
    temporaryDirectories.push(root);
    const commands = join(root, ".opencode", "commands");
    await mkdir(commands, { recursive: true });
    await writeFile(join(root, "CONTRIBUTING.md"), "Use strict types.", "utf8");
    await writeFile(
      join(commands, "review.md"),
      [
        "---",
        "description: Review a component",
        "agent: plan",
        "---",
        "Review $1 with $ARGUMENTS.",
        "!`git status --short`",
        "@CONTRIBUTING.md",
      ].join("\n"),
      "utf8",
    );

    const service = new CustomCommandService();
    const listed = await service.list(root);
    expect(listed[0]).toMatchObject({
      name: "review",
      description: "Review a component",
      agent: "plan",
    });
    const prepared = await service.prepare(root, "/review Button extra");
    expect(prepared?.prompt).toContain("Review Button with Button extra.");
    expect(prepared?.prompt).toContain("Use strict types.");
    expect(prepared?.shellCommands[0]?.command).toBe("git status --short");
  });
});
