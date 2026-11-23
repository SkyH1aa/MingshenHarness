import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPlugin,
  upsertMarketplace,
  validatePlugin,
} from "../apps/desktop/resources/sdk/plugin-dev/mingshen-plugin.mjs";

const temporary = await mkdtemp(join(tmpdir(), "mingshen-plugin-sdk-"));
const pluginSdkPath = fileURLToPath(
  new URL(
    "../apps/desktop/resources/sdk/plugin-dev/mingshen-plugin.mjs",
    import.meta.url,
  ),
);

function runMarketplaceProcess(marketRoot, pluginRoot) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(
      process.execPath,
      [pluginSdkPath, "marketplace", marketRoot, "--name", "dev-example", "--add", pluginRoot],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectProcess);
    child.once("close", (code) => {
      if (code === 0) {
        resolveProcess(stdout);
      } else {
        rejectProcess(new Error(`Plugin marketplace child exited ${code}: ${stderr}`));
      }
    });
  });
}

try {
  const marketRoot = join(temporary, "market");
  const pluginRoot = join(marketRoot, "plugins", "example");
  await createPlugin({
    pluginRoot,
    name: "example",
    version: "0.1.0",
    description: "Validate an example capability.",
    displayName: "Example Plugin",
  });

  const scaffold = await validatePlugin(pluginRoot);
  assert.equal(scaffold.ok, false);
  assert.ok(scaffold.errors.some((entry) => entry.code === "SCAFFOLD_PLACEHOLDER"));

  const skillPath = join(pluginRoot, "skills", "example-harness", "SKILL.md");
  await writeFile(
    skillPath,
    `---\nname: example-harness\ndescription: Use when the user asks to validate an example capability.\n---\n\n# Example Harness Interface\n\nReturn the concrete validation result without inventing evidence.\n`,
    "utf8",
  );
  const manifestPath = join(pluginRoot, ".mingshen-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const commandDirectory = join(pluginRoot, "commands");
  await mkdir(commandDirectory, { recursive: true });
  const commandPath = join(commandDirectory, "review.md");
  const reviewCommand = `---\nname: review\ndescription: Review the current example.\n---\n\nReturn a bounded review result.\n`;
  await writeFile(
    commandPath,
    reviewCommand,
    "utf8",
  );
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, commands: "commands" }, null, 2)}\n`,
    "utf8",
  );
  const validV1 = await validatePlugin(pluginRoot);
  assert.equal(validV1.ok, true);
  assert.deepEqual(validV1.errors, []);
  assert.equal(validV1.authoritative, false);
  assert.equal(validV1.name, "example");
  assert.equal(validV1.version, "0.1.0");
  assert.equal(validV1.skills.length, 1);
  assert.deepEqual(validV1.commands, ["commands/review.md"]);

  const baseManifest = { ...manifest, commands: "commands" };
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...baseManifest,
        hooks: {
          BeforeModelRequest: [
            {
              hooks: [
                {
                  type: "prompt",
                  text: "Prefix marker.",
                  position: "before",
                  format: "plain",
                },
                {
                  type: "prompt",
                  text: "Suffix marker.",
                  position: "after",
                  format: "plain",
                },
                {
                  type: "prompt",
                  text: "Wrapped default context.",
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const validHookOptions = await validatePlugin(pluginRoot);
  assert.equal(validHookOptions.ok, true);
  assert.deepEqual(validHookOptions.errors, []);

  for (const invalidPrompt of [
    { type: "prompt", text: "Invalid position.", position: "middle" },
    { type: "prompt", text: "Invalid format.", format: "html" },
    { type: "prompt", text: "Invalid null position.", position: null },
    { type: "prompt", text: "Invalid null format.", format: null },
    { type: "prompt", position: "after", format: "plain" },
    { type: "prompt", text: "x".repeat(4_001) },
    Array.from({ length: 6 }, () => ({ type: "prompt", text: "x".repeat(2_001) })),
  ]) {
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...baseManifest,
          hooks: {
            BeforeModelRequest: [{ hooks: [invalidPrompt] }],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const invalidHookOptions = await validatePlugin(pluginRoot);
    assert.equal(invalidHookOptions.ok, false);
    assert.ok(
      invalidHookOptions.errors.some(
        (entry) => entry.code === "BEFORE_MODEL_REQUEST_PROMPT_INVALID",
      ),
    );
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify(baseManifest, null, 2)}\n`,
    "utf8",
  );

  const marketV1 = await upsertMarketplace(marketRoot, "dev-example", [pluginRoot]);
  assert.equal(marketV1.plugins[0]?.source, "./plugins/example");
  const catalog = JSON.parse(await readFile(marketV1.catalogPath, "utf8"));
  assert.equal(catalog.name, "dev-example");
  assert.equal(catalog.plugins[0].version, "0.1.0");
  assert.equal(
    (await readdir(marketRoot)).some((entry) => entry.startsWith(".marketplace.json.")),
    false,
  );

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        version: "0.1.1",
        commands: {
          review: {
            file: "commands/review.md",
            description: "Review the current example.",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const validV2 = await validatePlugin(pluginRoot);
  assert.equal(validV2.ok, true);
  assert.equal(validV2.version, "0.1.1");
  assert.deepEqual(validV2.commands, ["commands/review.md"]);

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        version: "0.1.2",
        commands: {
          review: {
            file: "../outside-command.md",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const escapedCommand = await validatePlugin(pluginRoot);
  assert.equal(escapedCommand.ok, false);
  assert.ok(escapedCommand.errors.some((entry) => entry.code === "COMMAND_INVALID"));

  await writeFile(commandPath, Buffer.from([0xff, 0xfe, 0x00]));
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        version: "0.1.2",
        commands: {
          review: {
            file: "commands/review.md",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const invalidEncoding = await validatePlugin(pluginRoot);
  assert.equal(invalidEncoding.ok, false);
  assert.ok(invalidEncoding.errors.some((entry) => entry.code === "COMMAND_INVALID"));

  await writeFile(commandPath, "a".repeat(1024 * 1024 + 1), "utf8");
  const oversizedCommand = await validatePlugin(pluginRoot);
  assert.equal(oversizedCommand.ok, false);
  assert.ok(oversizedCommand.errors.some((entry) => entry.code === "COMMAND_INVALID"));

  await writeFile(commandPath, reviewCommand, "utf8");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        version: "0.1.1",
        commands: {
          review: {
            file: "commands/review.md",
            description: "Review the current example.",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await upsertMarketplace(marketRoot, "dev-example", [pluginRoot]);
  const updatedCatalog = JSON.parse(await readFile(marketV1.catalogPath, "utf8"));
  assert.equal(updatedCatalog.plugins.length, 1);
  assert.equal(updatedCatalog.plugins[0].version, "0.1.1");

  const concurrentNames = ["alpha", "beta"];
  const concurrentRoots = [];
  for (const name of concurrentNames) {
    const concurrentRoot = join(marketRoot, "plugins", name);
    concurrentRoots.push(concurrentRoot);
    await createPlugin({
      pluginRoot: concurrentRoot,
      name,
      version: "1.0.0",
      description: `Validate the ${name} concurrent marketplace entry.`,
      displayName: `${name} Plugin`,
    });
    await writeFile(
      join(concurrentRoot, "skills", `${name}-harness`, "SKILL.md"),
      `---\nname: ${name}-harness\ndescription: Use when validating ${name} marketplace concurrency.\n---\n\n# ${name} Plugin\n\nReturn a bounded result.\n`,
      "utf8",
    );
  }
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      upsertMarketplace(marketRoot, "dev-example", [
        concurrentRoots[index % concurrentRoots.length],
      ]),
    ),
  );
  const concurrentCatalog = JSON.parse(await readFile(marketV1.catalogPath, "utf8"));
  assert.deepEqual(
    concurrentCatalog.plugins.map((entry) => entry.name),
    ["alpha", "beta", "example"],
  );
  assert.equal(
    (await readdir(marketRoot)).some(
      (entry) => entry.startsWith(".marketplace.json.") || entry === ".marketplace.json.lock",
    ),
    false,
  );

  const crossProcessRoots = [];
  for (const name of ["cross-alpha", "cross-beta"]) {
    const crossProcessRoot = join(marketRoot, "plugins", name);
    crossProcessRoots.push(crossProcessRoot);
    await createPlugin({
      pluginRoot: crossProcessRoot,
      name,
      version: "1.0.0",
      description: `Validate the ${name} cross-process marketplace entry.`,
      displayName: `${name} Plugin`,
    });
    await writeFile(
      join(crossProcessRoot, "skills", `${name}-harness`, "SKILL.md"),
      `---\nname: ${name}-harness\ndescription: Use when validating ${name} cross-process marketplace concurrency.\n---\n\n# ${name} Plugin\n\nReturn a bounded result.\n`,
      "utf8",
    );
  }
  await Promise.all(
    crossProcessRoots.map((pluginRoot) => runMarketplaceProcess(marketRoot, pluginRoot)),
  );
  const crossProcessCatalog = JSON.parse(await readFile(marketV1.catalogPath, "utf8"));
  assert.ok(
    crossProcessCatalog.plugins.some((entry) => entry.name === "cross-alpha"),
  );
  assert.ok(
    crossProcessCatalog.plugins.some((entry) => entry.name === "cross-beta"),
  );

  const staleMarketRoot = join(temporary, "stale-market");
  const stalePluginRoot = join(staleMarketRoot, "plugins", "staged");
  await createPlugin({
    pluginRoot: stalePluginRoot,
    name: "staged",
    version: "1.0.0",
    description: "Validate stale marketplace lock handling.",
    displayName: "Staged Plugin",
  });
  await writeFile(
    join(stalePluginRoot, "skills", "staged-harness", "SKILL.md"),
    `---\nname: staged-harness\ndescription: Use when validating stale marketplace locks.\n---\n\n# Staged Plugin\n\nReturn a bounded result.\n`,
    "utf8",
  );
  const staleCatalogPath = join(staleMarketRoot, "marketplace.json");
  const staleLockPath = `${staleCatalogPath}.lock`;
  const staleCatalog =
    `${JSON.stringify({ name: "stale-market", plugins: [] }, null, 2)}\n`;
  const staleLock = `${JSON.stringify(
    {
      pid: 999999,
      createdAt: "2020-01-01T00:00:00.000Z",
      token: "stale-fixture",
    },
    null,
    2,
  )}\n`;
  await writeFile(staleCatalogPath, staleCatalog, "utf8");
  await writeFile(staleLockPath, staleLock, "utf8");
  const staleTime = new Date(Date.now() - 61_000);
  await utimes(staleLockPath, staleTime, staleTime);
  await assert.rejects(
    () => upsertMarketplace(staleMarketRoot, "stale-market", [stalePluginRoot]),
    (error) => {
      assert.match(error.message, /stale after 60 seconds/);
      assert.ok(error.message.includes(staleLockPath));
      assert.match(error.message, /catalog was not modified/);
      return true;
    },
  );
  assert.equal(await readFile(staleCatalogPath, "utf8"), staleCatalog);
  assert.equal(await readFile(staleLockPath, "utf8"), staleLock);

  await rm(marketV1.catalogPath, { force: true });
  await mkdir(marketV1.catalogPath, { recursive: true });
  await assert.rejects(() => upsertMarketplace(marketRoot, "dev-example", [pluginRoot]));
  assert.equal(
    (await readdir(marketRoot)).some((entry) => entry.startsWith(".marketplace.json.")),
    false,
  );

  const escapedSource = resolve(temporary, "outside-plugin");
  await createPlugin({
    pluginRoot: escapedSource,
    name: "outside-plugin",
    version: "0.1.0",
    description: "A valid plugin outside the intended marketplace root.",
    displayName: "Outside Plugin",
  });
  await writeFile(
    join(escapedSource, "skills", "outside-plugin-harness", "SKILL.md"),
    `---\nname: outside-plugin-harness\ndescription: Use when testing marketplace source containment.\n---\n\n# Outside Plugin\n\nReturn a bounded result.\n`,
    "utf8",
  );
  await assert.rejects(
    () => upsertMarketplace(join(temporary, "market-2"), "dev-invalid", [escapedSource]),
    /Marketplace source must stay inside the market root/,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        passed: [
          "scaffold writes the native manifest and Harness adapter Skill",
          "TODO placeholders are rejected by SDK preflight",
          "completed plugin validates and reports authoritative:false",
          "Markdown command directories and inline command declarations are checked",
          "BeforeModelRequest position and format options accept before/after and context/plain",
          "BeforeModelRequest rejects invalid position/format values and missing text",
          "command references outside the plugin root are rejected",
          "non-UTF-8 and oversized command files are rejected",
          "visible marketplace catalog uses an inside-root relative source",
          "version update reconciles the existing marketplace entry",
          "concurrent marketplace updates preserve every plugin entry",
          "cross-process marketplace updates preserve both plugin entries",
          "stale locks fail explicitly without deleting the lock or changing the catalog",
        ],
        authoritativeRuntimeValidation: "pending local_plugin validate after backend integration",
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
