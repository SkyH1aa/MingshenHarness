# Local Plugin Development

## Source layout

```text
market-root/
  marketplace.json
  plugins/example/.mingshen-plugin/plugin.json
  plugins/example/skills/example-harness/SKILL.md
```

`marketplace.json` is a catalog of source directories. The market root is not itself a plugin directory. The **Validate development folder** action accepts either a single plugin directory or a market root/catalog; the latter validates every plugin declared by that catalog. When validating a single plugin, select the directory containing `.mingshen-plugin/plugin.json` (or another supported plugin manifest), not its parent market folder.

## Validate and install

Use `local_plugin validate` for an authoritative read-only host validation when available. It does not execute plugin code. Register the market and install/enable the plugin through **Settings > Skills and plugins > Local plugin development marketplace**. Lifecycle changes remain explicit user actions and are blocked while Agent tasks are active.

## Update

Edit the original source, keep the plugin `name` stable, increment its semantic version and update the matching market entry. Refresh the existing market, then choose **Update**. Do not delete or replace the installed copy manually. An incomplete MCP synchronization can be retried from the installed plugin row without reinstalling the source.

Update checks are read-only and rotate across at most 10 registered markets per check, with at most 200 entries per market. A strictly newer semantic version and a rechecked matching source are required. A plugin with no source record or an untraceable source is not automatically claimed by a same-name entry; preserve the installed copy and let the user confirm the original source. A check never installs or executes an update.

## Common validation errors

- **No manifest / unnamed plugin:** the selected folder may be the market root. Use the market validation path or select the specific plugin source directory.
- **Manifest cannot be parsed:** inspect the exact file and line reported. JSON must use double-quoted property names and strings, contain no trailing commas, and be valid UTF-8. In PowerShell, use a UTF-8 JSON writer rather than shell redirection with a legacy encoding.
- **Hook declaration unavailable:** the `hooks` path is relative to the plugin root, and its JSON must parse. A prompt-only `BeforeModelRequest` requires a `BeforeModelRequest` event containing `type:"prompt"` with non-empty `text`. Optional `position` must be `"before"` or `"after"`, and optional `format` must be `"context"` or `"plain"`; omitted values default to before/context.
- **Skill resource unavailable:** use the exact resource path returned by the Skill entry. Built-in Harness API resource paths are listed in `harness-plugin-api.md`; they are not inferred from manifest filenames.

Validation does not prove install, enablement or runtime execution. After installation, start a new CodeAgent or WorkAgent run and test the implemented capability.

For child-task tests, only actual `runSubagent` children with an active parent-run mapping inherit the parent's selected/activated plugins' declarative `BeforeModelRequest` text, from their initial request and on later requests after parent activation. This inheritance never enables child plugin actions, `UserPromptSubmit`, `Interrupt`, plugin commands, MCP or `local_plugin`. A directly opened independent `@` child without that mapping, ChatAgent and independent AutoDrive/draft-polishing or post-run-title jobs are outside this inheritance. See `references/hooks.md` for full timing and failure limits.
