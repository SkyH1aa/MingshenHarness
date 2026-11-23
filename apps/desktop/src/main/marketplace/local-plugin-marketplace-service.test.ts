import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionService } from "../extensions/extension-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { LocalPluginMarketplaceService } from "./local-plugin-marketplace-service";

const copyRaceFixture = vi.hoisted(() => ({
  beforeCopy: null as (() => Promise<void>) | null,
  realpathRedirects: new Map<string, string>(),
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
    realpath: async (path: Parameters<typeof actual.realpath>[0]) =>
      copyRaceFixture.realpathRedirects.get(String(path)) ?? actual.realpath(path),
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

async function writePlugin(
  root: string,
  version = "0.1.0",
  pluginName = "dev-notes",
): Promise<string> {
  const pluginRoot = join(root, "plugins", pluginName);
  await mkdir(join(pluginRoot, ".mingshen-plugin"), { recursive: true });
  await mkdir(join(pluginRoot, "skills", `${pluginName}-harness`), { recursive: true });
  await mkdir(join(pluginRoot, "hooks"), { recursive: true });
  await writeFile(
    join(pluginRoot, ".mingshen-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: pluginName,
        version,
        description: "Local development notes workflow.",
        skills: [`./skills/${pluginName}-harness`],
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
    join(pluginRoot, "skills", `${pluginName}-harness`, "SKILL.md"),
    [
      "---",
      `name: ${pluginName}-harness`,
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

async function writeCatalog(
  root: string,
  version = "0.1.0",
  pluginName = "dev-notes",
): Promise<string> {
  const marketRoot = join(root, "plugins");
  await mkdir(marketRoot, { recursive: true });
  await writeFile(
    join(marketRoot, "marketplace.json"),
    JSON.stringify(
      {
        name: "dev-local-workspace",
        displayName: "Local development",
        plugins: [
          {
            name: pluginName,
            source: `./${pluginName}`,
            version,
            description: "Local development notes workflow.",
            displayName: pluginName,
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
  copyRaceFixture.realpathRedirects.clear();
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("LocalPluginMarketplaceService", () => {
  it("keeps selecting a single plugin directory on the plugin validation path", async () => {
    const workspace = await makeWorkspace();
    const pluginRoot = await writePlugin(workspace.root);

    const inspection = await workspace.marketplace.inspectDirectory(pluginRoot);

    expect(inspection.kind).toBe("plugin");
    if (inspection.kind !== "plugin") throw new Error("Expected plugin inspection.");
    expect(inspection.validation).toMatchObject({
      ok: true,
      name: "dev-notes",
      version: "0.1.0",
      rootPath: pluginRoot,
    });
  });

  it("validates every plugin when the selected directory is a marketplace root", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root, "0.1.0", "route-marker");
    const marketRoot = await writeCatalog(workspace.root, "0.1.0", "route-marker");

    const inspection = await workspace.marketplace.inspectDirectory(marketRoot);

    expect(inspection.kind).toBe("marketplace");
    if (inspection.kind !== "marketplace") throw new Error("Expected marketplace inspection.");
    expect(inspection.validation).toMatchObject({
      ok: true,
      name: "dev-local-workspace",
      catalogPath: join(marketRoot, "marketplace.json"),
      plugins: [
        {
          name: "route-marker",
          source: "./route-marker",
          sourcePath: join(marketRoot, "route-marker"),
          version: "0.1.0",
          validation: { ok: true, name: "route-marker", version: "0.1.0" },
        },
      ],
      errors: [],
    });
    expect(workspace.extensionService.list()).toEqual([]);
    expect(workspace.marketplace.listSources()).toEqual([]);
  });

  it("reports a broken marketplace entry against its source without an unnamed-plugin result", async () => {
    const workspace = await makeWorkspace();
    const marketRoot = await writeCatalog(workspace.root);
    await mkdir(join(marketRoot, "dev-notes"), { recursive: true });

    const inspection = await workspace.marketplace.inspectDirectory(marketRoot);

    expect(inspection.kind).toBe("marketplace");
    if (inspection.kind !== "marketplace") throw new Error("Expected marketplace inspection.");
    expect(inspection.validation.ok).toBe(false);
    expect(inspection.validation.errors).toContainEqual(
      expect.objectContaining({ code: "marketplace-plugin-invalid", path: "./dev-notes" }),
    );
    expect(inspection.validation.plugins[0]?.validation.errors[0]?.message).toContain(
      "没有找到支持的 plugin.json",
    );
  });

  it("reports catalog/manifest version mismatches without importing the plugin", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root, "0.1.0");
    const marketRoot = await writeCatalog(workspace.root, "0.2.0");

    const inspection = await workspace.marketplace.inspectDirectory(marketRoot);

    expect(inspection.kind).toBe("marketplace");
    if (inspection.kind !== "marketplace") throw new Error("Expected marketplace inspection.");
    expect(inspection.validation.ok).toBe(false);
    expect(inspection.validation.plugins[0]?.validation.errors).toContainEqual(
      expect.objectContaining({ code: "manifest-version-mismatch" }),
    );
    expect(workspace.extensionService.list()).toEqual([]);
  });

  it.runIf(process.platform !== "win32")(
    "rejects a plugin source linked outside the marketplace",
    async () => {
      const workspace = await makeWorkspace();
      const marketRoot = await writeCatalog(workspace.root);
      const sourcePath = join(marketRoot, "dev-notes");
      const outsidePath = join(workspace.root, "outside-plugin");
      await mkdir(outsidePath);
      await symlink(outsidePath, sourcePath, "dir");

      const inspection = await workspace.marketplace.inspectDirectory(marketRoot);

      expect(inspection.kind).toBe("marketplace");
      if (inspection.kind !== "marketplace") throw new Error("Expected marketplace inspection.");
      expect(inspection.validation.plugins[0]?.validation.errors[0]?.message).toContain(
        "Plugin source must be a real directory",
      );
      expect(workspace.extensionService.list()).toEqual([]);
    },
    20_000,
  );

  it("reports malformed marketplace JSON at the selected catalog path", async () => {
    const workspace = await makeWorkspace();
    const marketRoot = await writeCatalog(workspace.root);
    const catalogPath = join(marketRoot, "marketplace.json");
    await writeFile(catalogPath, "{broken", "utf8");

    const inspection = await workspace.marketplace.inspectDirectory(marketRoot);

    expect(inspection.kind).toBe("marketplace");
    if (inspection.kind !== "marketplace") throw new Error("Expected marketplace inspection.");
    expect(inspection.validation).toMatchObject({
      ok: false,
      catalogPath,
      plugins: [],
      errors: [expect.objectContaining({ code: "marketplace-catalog-invalid", path: catalogPath })],
    });
  });

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
        join(updated.extension.installedPath, "skills", "dev-notes-harness", "SKILL.md"),
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

  it("detects only newer plugin versions without changing installed files, then updates on explicit request", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root, "1.2.0-beta.2");
    const marketRoot = await writeCatalog(workspace.root, "1.2.0-beta.2");
    const market = await workspace.marketplace.addMarket(marketRoot);
    const installed = await workspace.marketplace.installPlugin(market.market.id, "dev-notes");
    const installedManifest = workspace.repository.getExtensionManifest(installed.extension.id);
    const installedFile = join(
      installed.extension.installedPath,
      "skills",
      "dev-notes-harness",
      "SKILL.md",
    );

    await writePlugin(workspace.root, "1.2.0-beta.10");
    await writeCatalog(workspace.root, "1.2.0-beta.10");
    const detected = await workspace.marketplace.checkForUpdates();

    expect(detected).toMatchObject({
      checkedMarkets: 1,
      skippedMarkets: 0,
      updates: [
        {
          marketId: market.market.id,
          pluginName: "dev-notes",
          installedVersion: "1.2.0-beta.2",
          availableVersion: "1.2.0-beta.10",
        },
      ],
    });
    expect(workspace.repository.getExtensionManifest(installed.extension.id)).toEqual(
      installedManifest,
    );
    await expect(readFile(installedFile, "utf8")).resolves.toContain(
      "Development notes 1.2.0-beta.2",
    );

    const updated = await workspace.marketplace.updatePlugin(market.market.id, "dev-notes");
    expect(updated.action).toBe("updated");
    expect(await workspace.marketplace.checkForUpdates()).toMatchObject({ updates: [] });
  });

  it("does not report or apply a downgrade", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root, "0.2.0");
    const marketRoot = await writeCatalog(workspace.root, "0.2.0");
    const market = await workspace.marketplace.addMarket(marketRoot);
    await workspace.marketplace.installPlugin(market.market.id, "dev-notes");

    await writePlugin(workspace.root, "0.1.0");
    await writeCatalog(workspace.root, "0.1.0");

    expect((await workspace.marketplace.checkForUpdates()).updates).toEqual([]);
    await expect(workspace.marketplace.updatePlugin(market.market.id, "dev-notes")).rejects.toThrow(
      "不是已安装版本的更新版本",
    );
  });

  it("retains updates across rotating batches and prunes uninstalled or removed sources", async () => {
    const workspace = await makeWorkspace();
    const installed: Array<{ extensionId: string }> = [];
    const updateMarketIds: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const root = join(workspace.root, `market-${index}`);
      const pluginName = `dev-notes-${index}`;
      if (index === 0 || index === 10) {
        await writePlugin(root, "0.1.0", pluginName);
        const marketRoot = await writeCatalog(root, "0.1.0", pluginName);
        const catalogPath = join(marketRoot, "marketplace.json");
        const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as Record<string, unknown>;
        catalog.name = `dev-market-${String(index).padStart(2, "0")}`;
        await writeFile(catalogPath, JSON.stringify(catalog), "utf8");
        const market = await workspace.marketplace.addMarket(marketRoot);
        const result = await workspace.marketplace.installPlugin(market.market.id, pluginName);
        installed.push({ extensionId: result.extension.id });
        updateMarketIds[index === 0 ? 0 : 1] = market.market.id;

        await writePlugin(root, "0.2.0", pluginName);
        const upgradedCatalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
          plugins: Array<Record<string, unknown>>;
        };
        upgradedCatalog.plugins[0] = { ...upgradedCatalog.plugins[0], version: "0.2.0" };
        await writeFile(catalogPath, JSON.stringify(upgradedCatalog), "utf8");
      } else {
        await mkdir(root, { recursive: true });
        await writeFile(
          join(root, "marketplace.json"),
          JSON.stringify({ name: `dev-market-${String(index).padStart(2, "0")}`, plugins: [] }),
          "utf8",
        );
        await workspace.marketplace.addMarket(root);
      }
    }

    const first = await workspace.marketplace.checkForUpdates();
    const second = await workspace.marketplace.checkForUpdates();

    expect(first.checkedMarkets).toBe(10);
    expect(first.skippedMarkets).toBe(10);
    expect(first.updates).toEqual([
      expect.objectContaining({ marketId: updateMarketIds[0], availableVersion: "0.2.0" }),
    ]);
    expect(first.warnings[0]).toContain("轮换检查最多 10 个本地市场");
    expect(second.checkedMarkets).toBe(10);
    expect(second.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ marketId: updateMarketIds[0], availableVersion: "0.2.0" }),
        expect.objectContaining({ marketId: updateMarketIds[1], availableVersion: "0.2.0" }),
      ]),
    );

    const firstInstalled = installed[0];
    if (!firstInstalled) throw new Error("Expected the first update fixture to be installed.");
    await workspace.extensionService.remove(firstInstalled.extensionId);
    const afterUninstall = await workspace.marketplace.checkForUpdates();
    expect(afterUninstall.updates).toEqual([
      expect.objectContaining({ marketId: updateMarketIds[1], availableVersion: "0.2.0" }),
    ]);

    const secondUpdateMarketId = updateMarketIds[1];
    if (!secondUpdateMarketId) throw new Error("Expected the second update market fixture.");
    workspace.marketplace.removeMarketSource(secondUpdateMarketId);
    const afterMarketRemoval = await workspace.marketplace.checkForUpdates();
    expect(afterMarketRemoval.updates).toEqual([]);
  });

  it("uses the source version field instead of installed-only metadata when detecting updates", async () => {
    const workspace = await makeWorkspace();
    const pluginRoot = await writePlugin(workspace.root);
    const marketRoot = await writeCatalog(workspace.root);
    const market = await workspace.marketplace.addMarket(marketRoot);
    await workspace.marketplace.installPlugin(market.market.id, "dev-notes");
    await writePlugin(workspace.root, "0.2.0");
    await writeCatalog(workspace.root, "0.2.0");
    const manifestPath = join(pluginRoot, ".mingshen-plugin", "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest._mingshen = { manifestVersion: "9.9.9" };
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    expect((await workspace.marketplace.checkForUpdates()).updates).toEqual([
      expect.objectContaining({ availableVersion: "0.2.0" }),
    ]);
  });

  it("skips a registered market whose root now resolves to another directory", async () => {
    const workspace = await makeWorkspace();
    await writePlugin(workspace.root);
    const marketRoot = await writeCatalog(workspace.root);
    const market = await workspace.marketplace.addMarket(marketRoot);
    const installed = await workspace.marketplace.installPlugin(market.market.id, "dev-notes");
    const movedRoot = join(workspace.root, "moved-market");
    copyRaceFixture.realpathRedirects.set(marketRoot, movedRoot);

    const result = await workspace.marketplace.checkForUpdates();

    expect(result).toMatchObject({ checkedMarkets: 0, skippedMarkets: 1, updates: [] });
    expect(result.warnings[0]).toContain("市场根路径发生变化");
    expect(workspace.repository.getExtension(installed.extension.id)?.installedPath).toBe(
      installed.extension.installedPath,
    );

    copyRaceFixture.realpathRedirects.clear();
    await writePlugin(movedRoot, "0.2.0");
    const redirectedMarket = await writeCatalog(movedRoot, "0.2.0");
    copyRaceFixture.realpathRedirects.set(
      join(marketRoot, "marketplace.json"),
      join(redirectedMarket, "marketplace.json"),
    );
    const changedCatalog = await workspace.marketplace.checkForUpdates();
    expect(changedCatalog).toMatchObject({ checkedMarkets: 0, skippedMarkets: 1, updates: [] });
    expect(changedCatalog.warnings[0]).toContain("市场根或清单解析到了其他位置");
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
