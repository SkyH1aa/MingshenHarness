import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectConfigService } from "./project-config-service";
import { ProjectInstructionService } from "./project-instruction-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ProjectInstructionService", () => {
  it("never includes files outside the workspace from project instructions configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-instruction-boundary-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "repo");
    await mkdir(workspace);
    await writeFile(join(root, "private.txt"), "PRIVATE_SENTINEL");
    await writeFile(
      join(workspace, "opencode.json"),
      JSON.stringify({ instructions: ["../private.txt", join(root, "private.txt")] }),
    );
    const service = new ProjectInstructionService(
      join(root, "user"),
      new ProjectConfigService(join(root, "user")),
    );
    expect(
      (await service.discover(workspace)).some((item) => item.content.includes("PRIVATE_SENTINEL")),
    ).toBe(false);
  });
  it("loads user, ancestor and workspace instructions in stable order", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-instructions-"));
    temporaryDirectories.push(root);
    const userDirectory = join(root, "user");
    const workspace = join(root, "repo", "packages", "app");
    await mkdir(userDirectory, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(userDirectory, "AGENTS.md"), "用户级规则", "utf8");
    await writeFile(join(root, "repo", "AGENTS.md"), "仓库规则", "utf8");
    await writeFile(join(workspace, "AGENTS.md"), "应用规则", "utf8");
    await mkdir(join(workspace, ".mingshen"), { recursive: true });
    await mkdir(join(workspace, "docs"), { recursive: true });
    await writeFile(join(workspace, "docs", "style.md"), "文档规则", "utf8");
    await writeFile(
      join(workspace, ".mingshen", "config.json"),
      JSON.stringify({ instructions: ["docs/*.md"] }),
      "utf8",
    );

    const service = new ProjectInstructionService(
      userDirectory,
      new ProjectConfigService(userDirectory),
    );
    const instructions = await service.discover(workspace);

    expect(instructions.map((item) => item.content)).toEqual([
      "用户级规则",
      "仓库规则",
      "应用规则",
      "文档规则",
    ]);
    expect(service.render(instructions)).toContain("不能覆盖安全规则");
  });
});
