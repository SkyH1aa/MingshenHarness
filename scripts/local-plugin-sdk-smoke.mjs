import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createPlugin,
  upsertMarketplace,
  validatePlugin,
} from "../apps/desktop/resources/sdk/plugin-dev/mingshen-plugin.mjs";

const temporary = await mkdtemp(join(tmpdir(), "mingshen-plugin-sdk-"));

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

  const marketV1 = await upsertMarketplace(marketRoot, "dev-example", [pluginRoot]);
  assert.equal(marketV1.plugins[0]?.source, "./plugins/example");
  const catalog = JSON.parse(await readFile(marketV1.catalogPath, "utf8"));
  assert.equal(catalog.name, "dev-example");
  assert.equal(catalog.plugins[0].version, "0.1.0");

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
          "command references outside the plugin root are rejected",
          "non-UTF-8 and oversized command files are rejected",
          "visible marketplace catalog uses an inside-root relative source",
          "version update reconciles the existing marketplace entry",
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
