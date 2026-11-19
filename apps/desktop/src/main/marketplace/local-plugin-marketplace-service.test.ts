import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionService } from "../extensions/extension-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { LocalPluginMarketplaceService } from "./local-plugin-marketplace-service";

const copyRaceFixture = vi.hoisted(() => ({
  beforeCopy: null as (() => Promise<void>) | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    cp: async (...args: Parameters<typeof actual.cp>) => {
      const beforeCopy = copyRaceFixture.beforeCopy;
      copyRaceFixture.beforeCopy = null;
      if (beforeCopy) await beforeCopy();
      return actual.cp(...args);
    },
  };
});

const temporaryDirectories: string[] = [];
const openDatabases: Array<ReturnType<typeof openDatabase>> = [];

async function makeWorkspace(): Promise<{
  root: string;
  repository: Repository;
  extensionService: ExtensionService;
  marketplace: LocalPluginMarketplaceService;
}> {
  const root = await mkdtemp(join(tmpdir(), "mingshen-local-plugin-market-"));
  temporaryDirectories.push(root);
  const database = openDatabase(join(root, "test.db"));
  openDatabases.push(database);
  const repository = new Repository(database);
  const installedRoot = join(root, "installed");
  const extensionService = new ExtensionService(repository, installedRoot);
  return {
    root,
    repository,
    extensionService,
    marketplace: new LocalPluginMarketplaceService(repository, extensionService, installedRoot),
  };
}

async function writePlugin(root: string, version = "0.1.0"): Promise<string> {
  const pluginRoot = join(root, "plugins", "dev-notes");
  await mkdir(join(pluginRoot, ".mingshen-plugin"), { recursive: true });
  await mkdir(join(pluginRoot, "skills", "dev-notes"), { recursive: true });
  await mkdir(join(pluginRoot, "hooks"), { recursive: true });
  await writeFile(
    join(pluginRoot, ".mingshen-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: "dev-notes",
        version,
        description: "Local development notes workflow.",
        skills: ["./skills/dev-notes"],
        commands: ["./commands"],
        hooks: "./hooks/hooks.json",
        mcpServers: "./mcp.json",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    join(pluginRoot, "skills", "dev-notes", "SKILL.md"),
    [
      "---",
      "name: dev-notes",
      `description: Local notes version ${version}.`,
      "---",
      "",
      `# Development notes ${version}`,
    ].join("\n"),
    "utf8",
  );
  await mkdir(join(pluginRoot, "commands"), { recursive: true });
  await writeFile(join(pluginRoot, "commands", "notes.md"), "# Notes\n", "utf8");
  await writeFile(
    join(pluginRoot, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [{ type: "command", command: "node hook.mjs" }],
          },
        ],
      },
    }),
    "utf8",
  );
  await writeFile(
    join(pluginRoot, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        notes: {
          command: "node",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: Fixture exercises installed-root expansion.
          args: ["${MINGSHEN_PLUGIN_ROOT}/server.mjs"],
        },
      },
    }),
    "utf8",
  );
  await writeFile(join(pluginRoot, "server.mjs"), "process.exit(0);\n", "utf8");
  return pluginRoot;
}

async function writeCatalog(root: string, version = "0.1.0"): Promise<string> {
  const marketRoot = join(root, "plugins");
  await writeFile(
    join(marketRoot, "marketplace.json"),
    JSON.stringify(
      {
        name: "dev-local-workspace",
        displayName: "Local development",
        plugins: [
          {
            name: "dev-notes",
            source: "./dev-notes",
            version,
            description: "Local development notes workflow.",
            displayName: "Dev Notes",
            category: "developer-tools",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  return marketRoot;
}

afterEach(async () => {
  copyRaceFixture.beforeCopy = null;
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("LocalPluginMarketplaceService", () => {
  it("registers a local catalog, validates native declarations and installs a plugin", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root);
    const marketRoot = await writeCatalog(workspace.root);

    const market = await workspace.marketplace.addMarket(marketRoot);
    expect(market.market).toMatchObject({
      name: "dev-local-workspace",
      displayName: "Local development",
    });
    expect(market.plugins).toHaveLength(1);
    expect(market.plugins[0]).toMatchObject({
      name: "dev-notes",
      version: "0.1.0",
      installed: false,
      validation: {
        ok: true,
        manifestKind: "mingshen",
        hookEvents: ["UserPromptSubmit"],
        mcpServers: ["notes"],
      },
    });
    expect(market.plugins[0]?.validation.commands).toEqual(["commands/notes.md"]);

    const installed = await workspace.marketplace.installPlugin(market.market.id, "dev-notes");
    expect(installed.action).toBe("installed");
    expect(installed.extension.type).toBe("plugin");
    const manifest = workspace.repository.getExtensionManifest(installed.extension.id);
    expect(manifest?.hooks).toMatchObject({ UserPromptSubmit: expect.any(Array) });
    expect(manifest?.mcpServers).toMatchObject({ notes: expect.any(Object) });
    expect(manifest?._mingshen).toMatchObject({
      manifestKind: "mingshen",
      manifestVersion: "0.1.0",
    });

    const refreshed = await workspace.marketplace.refreshMarket(market.market.id);
    expect(refreshed.plugins[0]).toMatchObject({
      installed: true,
      installedVersion: "0.1.0",
      extensionId: installed.extension.id,
      enabled: true,
    });
  });

  it("updates in place, preserves enabled and session references, and retains old files until cleanup", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root);
    const marketRoot = await writeCatalog(workspace.root);
    const market = await workspace.marketplace.addMarket(marketRoot);
    const installed = await workspace.marketplace.installPlugin(market.market.id, "dev-notes");
    const oldPath = installed.extension.installedPath;
    const session = workspace.repository.insertSession({
      title: "Plugin session",
      agentMode: "work",
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      workspacePath: join(workspace.root, "workspace"),
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    });
    workspace.repository.setSessionExtension(session.id, installed.extension.id, true);
    workspace.extensionService.setEnabled(installed.extension.id, false);

    await writePlugin(workspace.root, "0.2.0");
    await writeCatalog(workspace.root, "0.2.0");
    const updated = await workspace.marketplace.updatePlugin(market.market.id, "dev-notes");

    expect(updated.action).toBe("updated");
    expect(updated.extension.id).toBe(installed.extension.id);
    expect(updated.extension.enabled).toBe(false);
    expect(updated.extension.installedPath).not.toBe(oldPath);
    expect(
      await readFile(
        join(updated.extension.installedPath, "skills", "dev-notes", "SKILL.md"),
        "utf8",
      ),
    ).toContain("Development notes 0.2.0");
    await expect(access(oldPath)).resolves.toBeUndefined();

    workspace.extensionService.setEnabled(installed.extension.id, true);
    expect(workspace.repository.listSessionExtensionIds(session.id)).toContain(
      installed.extension.id,
    );

    const cleanup = await workspace.marketplace.cleanupStaleVersions();
    expect(cleanup.removed).toContain(oldPath);
    expect(cleanup.errors).toEqual([]);
    await expect(access(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(updated.extension.installedPath)).resolves.toBeUndefined();
  });

  it("replaces stale provenance after deletion so reinstalled plugins can update normally", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root);
    const marketRoot = await writeCatalog(workspace.root);
    const market = await workspace.marketplace.addMarket(marketRoot);
    const first = await workspace.marketplace.installPlugin(market.market.id, "dev-notes");

    await workspace.extensionService.remove(first.extension.id);
    const reinstalled = await workspace.marketplace.installPlugin(market.market.id, "dev-notes");
    expect(reinstalled.extension.id).not.toBe(first.extension.id);
    expect((await workspace.marketplace.refreshMarket(market.market.id)).plugins[0]).toMatchObject({
      installed: true,
      extensionId: reinstalled.extension.id,
    });

    await writePlugin(workspace.root, "0.2.0");
    await writeCatalog(workspace.root, "0.2.0");
    const updated = await workspace.marketplace.updatePlugin(market.market.id, "dev-notes");

    expect(updated.action).toBe("updated");
    expect(updated.extension.id).toBe(reinstalled.extension.id);
    const provenance = workspace.repository.getSetting("localPluginProvenance.v1") as Array<{
      marketId: string;
      pluginName: string;
      extensionId: string;
      contentHash: string;
    }>;
    expect(
      provenance.filter(
        (entry) => entry.marketId === market.market.id && entry.pluginName === "dev-notes",
      ),
    ).toEqual([
      expect.objectContaining({
        extensionId: reinstalled.extension.id,
        contentHash: updated.extension.contentHash,
      }),
    ]);
  });

  it("rejects a source change between market refresh and copy without recording an install", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root);
    const marketRoot = await writeCatalog(workspace.root);
    const market = await workspace.marketplace.addMarket(marketRoot);

    copyRaceFixture.beforeCopy = async () => {
      await writePlugin(workspace.root, "0.1.1");
    };
    await expect(
      workspace.marketplace.installPlugin(market.market.id, "dev-notes"),
    ).rejects.toThrow("PLUGIN_SOURCE_CHANGED");

    expect(workspace.repository.listExtensions()).toEqual([]);
    expect(workspace.repository.getSetting("localPluginProvenance.v1")).toBeNull();
    expect(await readdir(join(workspace.root, "installed", "plugin"))).toEqual([]);
  });

  it("does not switch the database when an invalid update fails, and removes only the source registration", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root);
    const marketRoot = await writeCatalog(workspace.root);
    const market = await workspace.marketplace.addMarket(marketRoot);
    const installed = await workspace.marketplace.installPlugin(market.market.id, "dev-notes");

    const manifestPath = join(
      workspace.root,
      "plugins",
      "dev-notes",
      ".mingshen-plugin",
      "plugin.json",
    );
    const invalidManifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete invalidManifest.version;
    await writeFile(manifestPath, JSON.stringify(invalidManifest), "utf8");
    await expect(workspace.marketplace.updatePlugin(market.market.id, "dev-notes")).rejects.toThrow(
      "manifest-version-missing",
    );
    expect(workspace.repository.getExtension(installed.extension.id)).toMatchObject({
      installedPath: installed.extension.installedPath,
      contentHash: installed.extension.contentHash,
      enabled: true,
    });

    workspace.marketplace.removeMarketSource(market.market.id);
    expect(workspace.repository.getExtension(installed.extension.id)).not.toBeNull();
    expect(workspace.marketplace.listSources()).toEqual([]);
  });

  it("rejects catalog path escape, name/version mismatch and does not auto-claim manual installs", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root);
    const marketRoot = await writeCatalog(workspace.root);
    const catalogPath = join(marketRoot, "marketplace.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      plugins: Array<Record<string, unknown>>;
    };
    catalog.plugins[0] = { ...catalog.plugins[0], source: "../outside" };
    await writeFile(catalogPath, JSON.stringify(catalog), "utf8");
    await expect(workspace.marketplace.addMarket(marketRoot)).rejects.toThrow("相对目录");

    catalog.plugins[0] = {
      ...catalog.plugins[0],
      source: "./dev-notes",
      name: "different-name",
    };
    await writeFile(catalogPath, JSON.stringify(catalog), "utf8");
    const mismatch = await workspace.marketplace.addMarket(marketRoot);
    expect(mismatch.plugins[0]?.validation.ok).toBe(false);
    expect(mismatch.plugins[0]?.validation.errors).toContainEqual(
      expect.objectContaining({ code: "manifest-name-mismatch" }),
    );

    const manual = await workspace.extensionService.importDirectory(
      join(workspace.root, "plugins", "dev-notes"),
    );
    expect(manual.imported).toHaveLength(1);
    await writeCatalog(workspace.root);
    const validMarket = await workspace.marketplace.addMarket(marketRoot);
    await expect(
      workspace.marketplace.installPlugin(validMarket.market.id, "dev-notes"),
    ).rejects.toThrow();
    expect(workspace.extensionService.list()).toHaveLength(1);
  });
});
