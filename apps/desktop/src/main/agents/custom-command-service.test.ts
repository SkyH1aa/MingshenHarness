import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionView } from "../../shared/domain";
import { CustomCommandService } from "./custom-command-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

function pluginExtension(id: string, installedPath: string, enabled = true): ExtensionView {
  return {
    id,
    type: "plugin",
    name: id,
    description: id,
    sourcePath: installedPath,
    installedPath,
    contentHash: `${id}-hash`,
    enabled,
    createdAt: "2026-11-18T00:00:00.000Z",
    skillCount: 0,
    mcpServerCount: 0,
    mcpServerNames: [],
    hookCount: 0,
  };
}

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

  it("loads enabled plugin Markdown directories and JSON or inline declarations under stable names", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-plugin-command-"));
    temporaryDirectories.push(root);
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    await mkdir(join(firstRoot, "commands"), { recursive: true });
    await mkdir(join(secondRoot, "commands"), { recursive: true });
    await writeFile(
      join(firstRoot, "commands", "review.md"),
      [
        "---",
        "name: review",
        "description: Review from frontmatter",
        "agent: plan",
        "---",
        "Review $ARGUMENTS",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(firstRoot, "commands", "explain.md"),
      "---\ndescription: Explain code\n---\nExplain $ARGUMENTS",
      "utf8",
    );
    await writeFile(join(firstRoot, "commands", "summary.md"), "Summarize $ARGUMENTS", "utf8");
    await writeFile(
      join(firstRoot, "commands.json"),
      JSON.stringify({
        commands: {
          review: {
            file: "./commands/review.md",
            description: "Review declaration override",
          },
          digest: {
            path: "./commands/summary.md",
            name: "digest",
            description: "Digest a result",
          },
        },
      }),
      "utf8",
    );
    await writeFile(join(secondRoot, "commands", "audit.md"), "Audit $ARGUMENTS", "utf8");

    const extensions = [
      pluginExtension("first-extension", firstRoot),
      pluginExtension("second-extension", secondRoot),
    ];
    const manifests = new Map<string, Record<string, unknown>>([
      [
        "first-extension",
        {
          name: "acme-tools",
          commands: ["./commands.json", "./commands"],
        },
      ],
      [
        "second-extension",
        {
          name: "quality-tools",
          commands: {
            commands: {
              audit: {
                file: "./commands/audit.md",
                description: "Inline audit declaration",
              },
            },
          },
        },
      ],
    ]);
    const service = new CustomCommandService({
      listExtensions: () => extensions,
      getExtensionManifest: (id) => manifests.get(id) ?? null,
    });

    const listed = (await service.list(null)).filter((command) =>
      /^(?:acme|quality)-tools:/u.test(command.name),
    );
    expect(listed.map((command) => command.name)).toEqual([
      "acme-tools:digest",
      "acme-tools:explain",
      "acme-tools:review",
      "acme-tools:summary",
      "quality-tools:audit",
    ]);
    expect(listed.find((command) => command.name === "acme-tools:review")).toMatchObject({
      description: "Review declaration override",
      agent: "plan",
    });

    const prepared = await service.prepare(null, "/acme-tools:review Button extra");
    expect(prepared?.command).toMatchObject({
      name: "acme-tools:review",
      description: "Review declaration override",
    });
    expect(prepared?.prompt).toContain("Review Button extra");
  });

  it("reloads enabled, updated and removed plugin commands on the next list or prepare", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-plugin-command-refresh-"));
    temporaryDirectories.push(root);
    const versionOne = join(root, "version-one");
    const versionTwo = join(root, "version-two");
    await mkdir(versionOne);
    await mkdir(versionTwo);
    await writeFile(join(versionOne, "release.md"), "Version one: $ARGUMENTS", "utf8");
    await writeFile(join(versionTwo, "release.md"), "Version two: $ARGUMENTS", "utf8");

    const state: {
      extensions: ExtensionView[];
      manifest: Record<string, unknown>;
    } = {
      extensions: [pluginExtension("versioned", versionOne)],
      manifest: { name: "versioned-plugin", commands: "./release.md" },
    };
    const service = new CustomCommandService({
      listExtensions: () => state.extensions,
      getExtensionManifest: () => state.manifest,
    });

    expect((await service.prepare(null, "/versioned-plugin:release one"))?.prompt).toContain(
      "Version one: one",
    );

    state.extensions = [pluginExtension("versioned", versionOne, false)];
    expect(
      (await service.list(null)).filter((command) => command.name.startsWith("versioned-plugin:")),
    ).toEqual([]);

    state.extensions = [pluginExtension("versioned", versionTwo)];
    expect((await service.prepare(null, "/versioned-plugin:release two"))?.prompt).toContain(
      "Version two: two",
    );

    state.extensions = [];
    expect(
      (await service.list(null)).filter((command) => command.name.startsWith("versioned-plugin:")),
    ).toEqual([]);
  });

  it("rejects plugin command files outside the plugin root or with invalid UTF-8 without hiding user commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-plugin-command-safety-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    const pluginRoot = join(root, "plugin");
    await mkdir(join(workspace, ".mingshen", "commands"), { recursive: true });
    await mkdir(pluginRoot);
    await writeFile(
      join(workspace, ".mingshen", "commands", "local.md"),
      "Local user command",
      "utf8",
    );
    await writeFile(join(root, "outside.md"), "Outside secret", "utf8");
    await writeFile(join(pluginRoot, "invalid.md"), Buffer.from([0xff, 0xfe, 0xfd]));

    const manifests = new Map<string, Record<string, unknown>>([
      ["outside", { name: "outside-plugin", commands: "../outside.md" }],
      ["invalid", { name: "invalid-plugin", commands: "./invalid.md" }],
    ]);
    const service = new CustomCommandService({
      listExtensions: () => [
        pluginExtension("outside", pluginRoot),
        pluginExtension("invalid", pluginRoot),
      ],
      getExtensionManifest: (id) => manifests.get(id) ?? null,
    });

    const listed = await service.list(workspace);
    expect(listed.filter((command) => /^(?:outside|invalid)-plugin:/u.test(command.name))).toEqual(
      [],
    );
    expect(listed.find((command) => command.name === "local")?.template).toBe("Local user command");
  });
});
