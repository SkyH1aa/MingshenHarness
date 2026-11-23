import { access, mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ExtensionService } from "./extension-service";

const directoryFixture = vi.hoisted(() => ({ path: "", names: [] as string[] }));
const fileReadFixture = vi.hoisted(() => ({
  abortAfterPath: "",
  controller: null as AbortController | null,
  reason: undefined as unknown,
  paths: [] as string[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const value = await actual.readFile(...args);
      const path = String(args[0]);
      fileReadFixture.paths.push(path);
      if (path === fileReadFixture.abortAfterPath) {
        fileReadFixture.controller?.abort(fileReadFixture.reason);
      }
      return value;
    },
    readdir: (
      path: Parameters<typeof actual.readdir>[0],
      options: Parameters<typeof actual.readdir>[1],
    ) => {
      if (String(path) === directoryFixture.path && options?.withFileTypes) {
        return Promise.resolve(
          directoryFixture.names.map((name) => ({
            name,
            isDirectory: () => false,
            isFile: () => true,
          })),
        );
      }
      return actual.readdir(path, options);
    },
  };
});

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
  directoryFixture.path = "";
  directoryFixture.names = [];
  fileReadFixture.abortAfterPath = "";
  fileReadFixture.controller = null;
  fileReadFixture.reason = undefined;
  fileReadFixture.paths = [];
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ExtensionService", () => {
  it.each([
    { files: 20_000, expectedError: "64 MiB" },
    { files: 20_001, expectedError: "20000" },
  ])(
    "checks $files files before copying or recording an extension",
    async ({ files, expectedError }) => {
      const workspace = await makeWorkspace();
      const source = join(workspace.root, "large-skill");
      const resources = join(source, "resources");
      await mkdir(resources, { recursive: true });
      await writeFile(join(source, "SKILL.md"), "---\nname: large-skill\n---\n# Large skill");
      await mkdir(join(source, "zz-extra", "node_modules"), { recursive: true });
      await writeFile(join(source, "zz-extra", "node_modules", "ignored.txt"), "ignored");
      await mkdir(join(source, "zz-empty"));

      // Virtual directory entries exercise the real scanner without copying 20,000 files.
      // The first real resource reaches the next guard, proving the count was accepted.
      const firstResource = join(resources, "asset-00000.txt");
      await writeFile(firstResource, "");
      await truncate(firstResource, 64 * 1024 * 1024 + 1);
      directoryFixture.path = resources;
      directoryFixture.names = Array.from(
        { length: files - 1 },
        (_, index) => `asset-${String(index).padStart(5, "0")}.txt`,
      );

      await expect(workspace.service.importDirectory(source)).rejects.toThrow(expectedError);
      expect(workspace.service.list()).toEqual([]);
      await expect(access(join(workspace.root, "installed"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

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
    await mkdir(join(source, "node_modules"));
    await writeFile(join(source, "node_modules", "ignored.txt"), "ignored");

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
    await expect(
      access(join(result.imported[0]?.installedPath ?? "", "node_modules")),
    ).rejects.toMatchObject({ code: "ENOENT" });

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
    expect(context.text).not.toContain("# Taste Skill");
    expect(context.text).toContain("Only metadata is loaded");
    const skills = await workspace.service.listSessionSkills(session.id);
    expect(skills).toHaveLength(1);
    const skillId = skills[0]?.id ?? "";
    expect(await workspace.service.readSessionSkill(session.id, skillId)).toContain(
      "# Taste Skill",
    );
    expect(
      await workspace.service.readSessionSkill(session.id, skillId, "scripts/check.ps1"),
    ).toContain("Write-Output ok");
    await expect(
      workspace.service.readSessionSkill(session.id, skillId, "../outside.txt"),
    ).rejects.toThrow();
    await writeFile(join(result.imported[0]?.installedPath ?? "", "large.txt"), "x".repeat(40_000));
    const firstPage = await workspace.service.readSessionSkill(session.id, skillId, "large.txt");
    expect(firstPage).toContain("Continue use_skill with char_offset:32000");
    const secondPage = await workspace.service.readSessionSkill(
      session.id,
      skillId,
      "large.txt",
      32000,
    );
    expect(secondPage).toContain("32000-40000/40000");

    const duplicate = await workspace.service.importDirectory(source);
    expect(duplicate.imported).toHaveLength(0);
    expect(duplicate.skipped).toBe(1);

    const chat = workspace.repository.insertSession({
      title: "Chat",
      agentMode: "chat",
      providerId: null,
      modelId: null,
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
    });
    expect(await workspace.service.buildSessionContext(chat.id)).toEqual({
      text: "",
      skills: [],
      mcpServers: [],
    });
    expect(await workspace.service.listSessionSkills(chat.id)).toEqual([]);
    expect(() =>
      workspace.service.setSessionExtension(chat.id, result.imported[0]?.id ?? "", true),
    ).toThrow("ChatAgent");
    await expect(workspace.service.readSessionSkill(chat.id, skillId)).rejects.toThrow();
  });

  it("discovers every enabled installed skill without expanding unrelated bodies", async () => {
    const workspace = await makeWorkspace();
    const standAlone = join(workspace.root, "spreadsheet-audit");
    const plugin = join(workspace.root, "slide-plugin");
    await mkdir(standAlone, { recursive: true });
    await mkdir(join(plugin, ".codex-plugin"), { recursive: true });
    await mkdir(join(plugin, "skills", "executive-slides"), { recursive: true });
    await writeFile(
      join(standAlone, "SKILL.md"),
      "---\nname: spreadsheet-audit\ndescription: Reconcile formulas and ledger totals.\n---\n# Spreadsheet audit\nUNLOADED-BODY",
      "utf8",
    );
    await writeFile(
      join(plugin, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "slide-plugin",
        description: "Presentation production plugin",
        skills: ["./skills/executive-slides"],
        mcpServers: {
          renderer: { command: "node", args: ["render.js"] },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(plugin, "skills", "executive-slides", "SKILL.md"),
      "---\nname: executive-slides\ndescription: Build board-ready PowerPoint narratives.\n---\n# Executive slides\nPLUGIN-BODY",
      "utf8",
    );
    await workspace.service.importDirectory(standAlone);
    const importedPlugin = await workspace.service.importDirectory(plugin);
    expect(importedPlugin.imported).toHaveLength(1);

    const session = workspace.repository.insertSession({
      title: "Automatic discovery",
      agentMode: "work",
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

    const context = await workspace.service.buildSessionContext(session.id);
    expect(context.text).toContain("Automatic capability index");
    expect(context.text).toContain("2 additional installed enabled extensions");
    expect(context.text).not.toContain("UNLOADED-BODY");
    expect(context.text).not.toContain("PLUGIN-BODY");

    const resources = await workspace.service.listSessionSkills(session.id);
    expect(resources.map((entry) => entry.name).sort()).toEqual([
      "executive-slides",
      "spreadsheet-audit",
    ]);
    const spreadsheet = resources.find((entry) => entry.name === "spreadsheet-audit");
    expect(await workspace.service.readSessionSkill(session.id, spreadsheet?.id ?? "")).toContain(
      "UNLOADED-BODY",
    );

    const firstPage = await workspace.service.discoverCapabilities(session.id, {
      query: "",
      kind: "skill",
      offset: 0,
      limit: 1,
    });
    expect(firstPage).toContain('"total": 2');
    expect(firstPage).toContain('"returned": 1');
    expect(firstPage).toContain('"next_offset": 1');

    const spreadsheetMatches = await workspace.service.discoverCapabilities(session.id, {
      query: "ledger formula",
      kind: "skill",
      offset: 0,
      limit: 10,
    });
    expect(spreadsheetMatches).toContain('"name": "spreadsheet-audit"');
    expect(spreadsheetMatches).toContain('"type": "skill"');
    expect(spreadsheetMatches).not.toContain("executive-slides");

    const pluginMatches = await workspace.service.discoverCapabilities(session.id, {
      query: "presentation renderer",
      kind: "plugin",
      offset: 0,
      limit: 10,
    });
    expect(pluginMatches).toContain('"name": "slide-plugin"');
    expect(pluginMatches).toContain('"mcp_servers"');
    expect(pluginMatches).toContain("renderer");
    expect(pluginMatches).not.toContain('"type": "skill"');

    const pluginExtension = workspace.service.list().find((entry) => entry.name === "slide-plugin");
    workspace.service.setEnabled(pluginExtension?.id ?? "", false);
    const afterDisable = await workspace.service.discoverCapabilities(session.id, {
      query: "",
      kind: "all",
      offset: 0,
      limit: 50,
    });
    expect(afterDisable).toContain("spreadsheet-audit");
    expect(afterDisable).not.toContain("slide-plugin");

    const builtinPage = await workspace.service.discoverCapabilities(
      session.id,
      {
        query: "packaged source",
        kind: "skill",
        offset: 0,
        limit: 10,
      },
      [
        {
          type: "skill",
          id: "builtin:work-source-pdf-editor",
          name: "pdf",
          description: "Packaged PDF production workflow.",
          session_selected: false,
          source: "builtin",
          searchable: "packaged source pdf editor",
        },
      ],
    );
    expect(builtinPage).toContain('"total": 1');
    expect(builtinPage).toContain('"id": "builtin:work-source-pdf-editor"');
    expect(builtinPage).toContain('"source": "builtin"');

    const chat = workspace.repository.insertSession({
      title: "Chat",
      agentMode: "chat",
      providerId: null,
      modelId: null,
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
    });
    await expect(
      workspace.service.discoverCapabilities(chat.id, {
        query: "",
        kind: "all",
        offset: 0,
        limit: 20,
      }),
    ).rejects.toThrow("CHAT_TOOL_DENIED");
  });

  it("allows on-demand plugin selection per run but keeps required plugins behind explicit session reference", async () => {
    const workspace = await makeWorkspace();
    const optionalRoot = join(workspace.root, "optional-plugin");
    const requiredRoot = join(workspace.root, "required-plugin");
    for (const root of [optionalRoot, requiredRoot]) {
      await mkdir(join(root, ".mingshen-plugin"), { recursive: true });
      await mkdir(join(root, "skills", "plugin-skill"), { recursive: true });
      await writeFile(
        join(root, "skills", "plugin-skill", "SKILL.md"),
        "---\nname: plugin-skill\ndescription: Plugin skill summary.\n---\nPrivate skill body.",
        "utf8",
      );
    }
    await writeFile(
      join(optionalRoot, ".mingshen-plugin", "plugin.json"),
      JSON.stringify({
        name: "optional-plugin",
        version: "1.0.0",
        description: "Select only when useful.",
        mcpServers: { "optional-server": { url: "https://example.invalid/mcp" } },
      }),
      "utf8",
    );
    await writeFile(
      join(requiredRoot, ".mingshen-plugin", "plugin.json"),
      JSON.stringify({
        name: "required-plugin",
        version: "1.0.0",
        description: "Always-on session context.",
        activation: "required",
        mcpServers: { "required-server": { url: "https://example.invalid/mcp" } },
      }),
      "utf8",
    );
    const optional = await workspace.service.importDirectory(optionalRoot);
    const required = await workspace.service.importDirectory(requiredRoot);
    const session = workspace.repository.insertSession({
      title: "Plugin activation",
      agentMode: "code",
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
    const optionalExtension = optional.imported[0];
    const requiredExtension = required.imported[0];
    expect(optionalExtension?.type).toBe("plugin");
    expect(requiredExtension?.type).toBe("plugin");
    if (!optionalExtension || !requiredExtension) throw new Error("plugin fixture import failed");

    const discovered = await workspace.service.discoverCapabilities(session.id, {
      query: "plugin",
      kind: "plugin",
      offset: 0,
      limit: 20,
    });
    expect(discovered).toContain('"activation_policy": "on-demand"');
    expect(discovered).toContain('"activation_policy": "required"');
    expect(discovered).toContain('"selectable_by_agent": false');

    const optionalContext = await workspace.service.getPluginUseContext(
      session.id,
      optionalExtension.id,
    );
    expect(optionalContext).toMatchObject({
      id: optionalExtension.id,
      activationPolicy: "on-demand",
      sessionSelected: false,
    });
    expect(optionalContext.skills[0]).toMatchObject({
      id: `${optionalExtension.id}/skills/plugin-skill/SKILL.md`,
      name: "plugin-skill",
    });
    expect(workspace.repository.listSessionExtensionIds(session.id)).toEqual([]);
    const optionalServerId = `plugin-${optionalExtension.id.slice(0, 8)}-optional_server`;
    const requiredServerId = `plugin-${requiredExtension.id.slice(0, 8)}-required_server`;
    expect(
      workspace.service.getAvailablePluginMcpServerIds(session.id, [
        optionalExtension.id,
        requiredExtension.id,
      ]),
    ).toEqual(new Set([optionalServerId]));
    expect(workspace.service.getPluginMcpServerOwnerExtensionId(optionalServerId)).toBe(
      optionalExtension.id,
    );
    expect(workspace.service.getPluginMcpServerOwnerExtensionId(requiredServerId)).toBe(
      requiredExtension.id,
    );
    await expect(
      workspace.service.getPluginUseContext(session.id, requiredExtension.id),
    ).rejects.toThrow("PLUGIN_REQUIRES_EXPLICIT_REFERENCE");
    expect(
      await workspace.service.getEnabledPluginExtensionIdForSkill(
        session.id,
        `${requiredExtension.id}/skills/plugin-skill/SKILL.md`,
      ),
    ).toBeNull();

    workspace.repository.setSessionExtension(session.id, requiredExtension.id, true);
    expect(
      workspace.service.getAvailablePluginMcpServerIds(session.id, [optionalExtension.id]),
    ).toEqual(new Set([optionalServerId, requiredServerId]));
    await expect(
      workspace.service.getPluginUseContext(session.id, requiredExtension.id),
    ).resolves.toMatchObject({ activationPolicy: "required", sessionSelected: true });
    expect(
      await workspace.service.getEnabledPluginExtensionIdForSkill(
        session.id,
        `${requiredExtension.id}/skills/plugin-skill/SKILL.md`,
      ),
    ).toBe(requiredExtension.id);
  });

  it("reads Codex plugin manifests and records MCP and hook declarations", async () => {
    const workspace = await makeWorkspace();
    const source = join(workspace.root, "demo-plugin");
    await mkdir(join(source, ".codex-plugin"), { recursive: true });
    await mkdir(join(source, "skills", "demo"), { recursive: true });
    await writeFile(
      join(source, "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: Demo skill.\n---\n# Demo skill\n",
      "utf8",
    );
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
          PostToolUse: ["node", "hook.js"],
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

  it("stops a plugin scan with the original cancellation reason", async () => {
    const workspace = await makeWorkspace();
    const source = join(workspace.root, "cancellable-plugin");
    const manifestPath = join(source, ".mingshen-plugin", "plugin.json");
    const resources = join(source, "resources");
    await mkdir(join(source, ".mingshen-plugin"), { recursive: true });
    await mkdir(resources, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        name: "cancellable-plugin",
        version: "0.1.0",
        description: "Cancellation fixture",
      }),
      "utf8",
    );
    const assetPaths = Array.from({ length: 8 }, (_, index) =>
      join(resources, `asset-${String(index).padStart(2, "0")}.txt`),
    );
    await Promise.all(assetPaths.map((path, index) => writeFile(path, `asset ${index}`, "utf8")));

    const controller = new AbortController();
    const reason = new Error("PLUGIN_SCAN_CANCELLED");
    fileReadFixture.abortAfterPath = assetPaths[3] ?? "";
    fileReadFixture.controller = controller;
    fileReadFixture.reason = reason;

    await expect(workspace.service.inspectPluginDirectory(source, controller.signal)).rejects.toBe(
      reason,
    );

    const resourceReads = fileReadFixture.paths.filter((path) => path.startsWith(resources));
    expect(resourceReads).toEqual(assetPaths.slice(0, 4));
    expect(fileReadFixture.paths).not.toContain(assetPaths[4]);
    expect(fileReadFixture.paths).not.toContain(assetPaths.at(-1));
  });

  it("rejects hook events that the host runtime does not support", async () => {
    const workspace = await makeWorkspace();
    const source = join(workspace.root, "unsupported-hook-plugin");
    await mkdir(join(source, ".mingshen-plugin"), { recursive: true });
    await writeFile(
      join(source, ".mingshen-plugin", "plugin.json"),
      JSON.stringify({
        name: "unsupported-hook-plugin",
        version: "0.1.0",
        description: "Unsupported hook fixture",
        hooks: {
          SessionStart: [{ hooks: [{ type: "prompt", text: "unsupported" }] }],
        },
      }),
      "utf8",
    );

    const validation = await workspace.service.inspectPluginDirectory(source);
    expect(validation.ok).toBe(false);
    expect(validation.errors).toContainEqual(
      expect.objectContaining({ code: "unsupported-hook-event" }),
    );
    await expect(workspace.service.importDirectory(source)).rejects.toThrow(
      "unsupported-hook-event",
    );
    expect(workspace.service.list()).toEqual([]);
  });

  it("warns that non-prompt prompt-event and Interrupt actions are skipped", async () => {
    const workspace = await makeWorkspace();
    const source = join(workspace.root, "declarative-hook-plugin");
    await mkdir(join(source, ".mingshen-plugin"), { recursive: true });
    await writeFile(
      join(source, ".mingshen-plugin", "plugin.json"),
      JSON.stringify({
        name: "declarative-hook-plugin",
        version: "0.1.0",
        description: "Declarative hook warnings",
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "prompt", text: "allowed" }] },
            { hooks: [{ type: "command", command: "Write-Output skipped" }] },
          ],
          BeforeModelRequest: [
            { hooks: [{ type: "prompt", text: "per-request context" }] },
            { hooks: [{ type: "command", command: "Write-Output skipped" }] },
            { hooks: [{ type: "mcp_tool", server: "demo", tool: "notify", input: {} }] },
          ],
          Interrupt: [
            { hooks: [{ type: "command", command: "Write-Output skipped" }] },
            { hooks: [{ type: "mcp", server: "demo", input: {} }] },
            { hooks: [{ type: "mcp_tool", server: "demo", tool: "notify", input: {} }] },
          ],
        },
      }),
      "utf8",
    );

    const validation = await workspace.service.inspectPluginDirectory(source);

    expect(validation.ok).toBe(true);
    expect(validation.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "hook-action-will-be-skipped",
          path: "hooks.UserPromptSubmit",
          message: expect.stringContaining('type:"prompt"'),
        }),
        expect.objectContaining({
          code: "hook-action-will-be-skipped",
          path: "hooks.BeforeModelRequest",
          message: expect.stringMatching(/type:"command".*type:"mcp_tool"/u),
        }),
        expect.objectContaining({
          code: "hook-action-will-be-skipped",
          path: "hooks.Interrupt",
          message: expect.stringMatching(
            /type:"command".*type:"mcp".*type:"mcp_tool".*不请求批准/u,
          ),
        }),
      ]),
    );
  });

  it.each([
    { prompt: "legacy prompt field" },
    { text: 123 },
    { text: " \n \t " },
    { text: "invalid position", position: "middle" },
    { text: "invalid position", position: null },
    { text: "invalid format", format: "system" },
    { text: "invalid format", format: "" },
  ])("rejects malformed BeforeModelRequest prompt declarations: %o", async (prompt) => {
    const workspace = await makeWorkspace();
    const source = join(workspace.root, "invalid-before-model-prompt");
    await mkdir(join(source, ".mingshen-plugin"), { recursive: true });
    await writeFile(
      join(source, ".mingshen-plugin", "plugin.json"),
      JSON.stringify({
        name: "invalid-before-model-prompt",
        version: "0.1.0",
        description: "Invalid per-model prompt fixture",
        hooks: {
          BeforeModelRequest: [{ hooks: [{ type: "prompt", ...prompt }] }],
        },
      }),
      "utf8",
    );

    const validation = await workspace.service.inspectPluginDirectory(source);

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContainEqual(
      expect.objectContaining({
        code: "before-model-request-prompt-invalid",
        path: expect.stringContaining("hooks.BeforeModelRequest"),
      }),
    );
    await expect(workspace.service.importDirectory(source)).rejects.toThrow(
      "before-model-request-prompt-invalid",
    );
    expect(workspace.service.list()).toEqual([]);
  });
});

function rootPath(root: string): string {
  return join(root, "workspace");
}
