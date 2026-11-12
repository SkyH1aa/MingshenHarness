import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ExtensionService } from "./extension-service";

const temporaryDirectories: string[] = [];
const openDatabases: Array<ReturnType<typeof openDatabase>> = [];

async function makeWorkspace(): Promise<{
  root: string;
  repository: Repository;
  service: ExtensionService;
  database: ReturnType<typeof openDatabase>;
}> {
  const root = await mkdtemp(join(tmpdir(), "mingshen-extension-"));
  temporaryDirectories.push(root);
  const database = openDatabase(join(root, "test.db"));
  openDatabases.push(database);
  const repository = new Repository(database);
  return {
    root,
    repository,
    service: new ExtensionService(repository, join(root, "installed")),
    database,
  };
}

afterEach(async () => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ExtensionService", () => {
  it("imports SKILL.md with folded frontmatter descriptions and bundled resources", async () => {
    const workspace = await makeWorkspace();
    const source = join(workspace.root, "taste-skill");
    await mkdir(join(source, "scripts"), { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      [
        "---",
        "name: taste-skill",
        "description: >",
        "  A design skill that keeps",
        "  the interface precise.",
        "---",
        "",
        "# Taste Skill",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(source, "scripts", "check.ps1"), "Write-Output ok", "utf8");

    const result = await workspace.service.importDirectory(source);

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]).toMatchObject({
      type: "skill",
      name: "taste-skill",
      description: "A design skill that keeps the interface precise.",
      skillCount: 1,
    });
    await expect(
      access(join(result.imported[0]?.installedPath ?? "", "scripts", "check.ps1")),
    ).resolves.toBeUndefined();

    const session = workspace.repository.insertSession({
      title: "Extension context",
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      workspacePath: rootPath(workspace.root),
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    });
    workspace.repository.setSessionExtension(session.id, result.imported[0]?.id ?? "", true);
    const context = await workspace.service.buildSessionContext(session.id);
    expect(context.skills).toContain("taste-skill");
    expect(context.text).toContain("# Taste Skill");

    const duplicate = await workspace.service.importDirectory(source);
    expect(duplicate.imported).toHaveLength(0);
    expect(duplicate.skipped).toBe(1);
  });

  it("reads Codex plugin manifests and records MCP and hook declarations", async () => {
    const workspace = await makeWorkspace();
    const source = join(workspace.root, "demo-plugin");
    await mkdir(join(source, ".codex-plugin"), { recursive: true });
    await writeFile(
      join(source, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "demo-plugin",
        description: "Plugin description",
        skills: ["./skills/demo"],
        mcpServers: {
          demo: { command: "node", args: ["server.js"] },
        },
        hooks: {
          "tool.after": ["node", "hook.js"],
        },
        interface: {
          display_name: "Demo Plugin",
        },
      }),
      "utf8",
    );

    const result = await workspace.service.importDirectory(source);

    expect(result.imported[0]).toMatchObject({
      type: "plugin",
      name: "Demo Plugin",
      description: "Plugin description",
      skillCount: 1,
      mcpServerCount: 1,
      hookCount: 1,
      mcpServerNames: ["demo"],
    });
  });
});

function rootPath(root: string): string {
  return join(root, "workspace");
}
