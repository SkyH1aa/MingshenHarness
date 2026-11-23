# Create and Update Native Mingshen Plugins

Use this workflow when a reusable capability needs more than one standalone Skill:
packaged Skills, commands, MCP declarations, or hooks must be developed, validated,
distributed through a local marketplace, manually installed, tried, and updated inside
Mingshen Harness.

Load `builtin:harness-plugin-api` before choosing the manifest shape or writing install
instructions. For a single instruction-only Skill, use `builtin:skill-creator` instead.

## Define the distribution contract

Identify the user-visible capability, representative input, observable result, target
workspace, plugin identity, and which components genuinely need to ship:

- a Skill for a repeatable model workflow;
- commands only if the host contract supports the exact command behavior requested;
- MCP only when an external tool boundary is required;
- hooks only when an event-driven action is necessary and the security cost is accepted;
- scripts or assets only when referenced by a Skill or runtime component.

Do not add empty components to look complete. Keep secrets in user configuration or the
credential store, never in source, marketplace metadata, examples, or logs.

Preserve an existing plugin's stable `name` and edit its implemented source. For a new
plugin, use an explicit path or default to:

```text
<workspace>/plugin-dev/
  marketplace.json
  plugins/<plugin-name>/
```

The marketplace root and plugin source are separate from the installed cache.

## Scaffold and implement

Use managed workspace file tools to create the native manifest, implemented adapter
Skill, any referenced components, and marketplace JSON. These files do not require a
Node executable or access to the application installation directory.

The bundled SDK is an optional CLI for a user's development environment:

```powershell
node <mingshen-sdk>\plugin-dev\mingshen-plugin.mjs create <plugin-dir> `
  --name <slug> `
  --description "<implemented capability>" `
  --display-name "<display name>"
```

Use that CLI only if Node and the SDK are actually accessible in the current execution
environment. A host SDK path returned by `use_skill` is a manual-development reference,
not a sandbox mount or execution grant. Do not probe guessed installation paths, retry
a sandbox denial, change permissions, or require Node before using the native file
tools and `local_plugin` validator.

Replace the generated `TODO` content. Implement the actual behavior before preparing a
marketplace entry. The plugin must include a focused adapter Skill that maps its real
Skills, commands, MCP tools, and hooks to user intents. Do not leave a generic
"plugin wrapper" that cannot tell the Agent when or how to use the capability.

For a new plugin start at `0.1.0`. On update, increment semantic `version`, preserve
identity, and retain unrelated marketplace entries.

Omitting manifest `activation` defaults to `on-demand`. Enabled on-demand plugins are
discoverable and may be selected by the primary Code/Work Agent with `use_plugin` for
the current run. Use `activation: "required"` only when a user must explicitly add the
plugin to the session first. Activation is temporary and never changes installation,
enabled state, or persistent session selection.

If the plugin needs a marker on child-model requests, use only a declarative
`BeforeModelRequest` `type:"prompt"` hook. Set `position:"after"` and `format:"plain"`
when the declared text must appear at the end of each request without
`<mingshen_plugin_context>`, a `Plugin N` header or attribution labels; omitted fields
retain the existing before/context behavior. Plain text is ordinary user-priority
request content, not a system-instruction upgrade. Actual children derived through an active
parent run's `runSubagent` path inherit the parent's selected/activated context from
their initial request; later parent activation is consulted before later unsent child
requests. Children do not gain plugin activation, `UserPromptSubmit`, `Interrupt`,
plugin commands, MCP, action hooks or `local_plugin`. An independent child conversation
opened directly with `@` and no active parent-run mapping does not inherit it. ChatAgent,
approval-safety reviews, independent AutoDrive/draft-polishing and post-run-title jobs
remain outside the hook scope. Load `references/hooks.md` from `builtin:harness-plugin-api`
for the full failure and budget contract.

## Validate before distribution

Call the actual `local_plugin` tool on the workspace source:

```json
{"action":"validate","rootPath":"<absolute plugin path>"}
```

Treat `local_plugin` as authoritative. The tool supports primary CodeAgent/WorkAgent
host sessions with a workspace, including Request Approval / native protected sessions.
Approve the normal read request when required; validation reads source without executing
plugin code. Profile denials and workspace path boundaries still apply. ChatAgent,
actual SubAgents, Docker and worktree sessions use **Settings → Skills 与插件 → 本地插件开发市场**
instead. If the tool is absent, report that specific runtime limitation and provide
the Settings validation path; do not substitute a sandbox-denied Node command.

The optional user CLI preflight remains available:

```powershell
node <mingshen-sdk>\plugin-dev\mingshen-plugin.mjs validate <plugin-dir> --json
```

Its success is a file/path preflight, not authoritative host validation. An empty
installed-plugin search does not mean built-in creators are absent: capability discovery
also exposes built-in Skills, while `list_markets` only lists registered user markets.

Check manifest JSON, stable identity, semantic version, every declared root-relative
path, `SKILL.md` frontmatter, plugin-root tokens, hook event names, MCP declarations,
resource size limits, and unresolved placeholders. Do not launch declared hooks just to
prove that validation works.

## Prepare the local market

Use `marketplace.json` at the market root and a source inside that root:

```json
{
  "name": "dev-example",
  "plugins": [
    {
      "name": "example",
      "source": "./plugins/example",
      "version": "0.1.0",
      "description": "Reviewed example capability."
    }
  ]
}
```

The catalog entries require `name`, an inside-root relative `source`, and a semantic
`version`; a concise `description` is strongly recommended. The entry must agree with
the plugin manifest.

Create or update the catalog with managed workspace file tools, preserving unrelated
entries. When the user's development environment has Node and the SDK, the optional
marketplace command can perform the same upsert:

```powershell
node <mingshen-sdk>\plugin-dev\mingshen-plugin.mjs marketplace <market-root> `
  --name <market-name> `
  --add <plugin-dir>
```

Verify that the catalog name, plugin name, source directory, and manifest version agree.
Creating the file does not register the market or install the plugin.

## Hand off manual installation

Give the actual absolute market root and these real UI steps:

1. Open **Settings → Skills 与插件 → 本地插件开发市场**
   (**设置 → Skills 与插件 → 本地插件开发市场**).
2. Choose **添加市场**, paste or select the market root or `marketplace.json`, and
   choose **添加**.
3. Select the added source in the **开发市场** dropdown and check the plugin's
   validation state. The **校验开发目录** control can validate the plugin source
   directly.
4. Wait for every Agent task to finish, or stop the running task manually. The host
   rejects local plugin installation and update while any Agent task is active.
5. Choose **安装** on the validated plugin row.
6. Use the row switch to enable or disable the installed plugin. Removing the market
   source later does not uninstall the plugin.
7. Start or open a CodeAgent/WorkAgent conversation. An enabled `on-demand` plugin can
   be discovered with `discover_capabilities` and activated for this run with
   `use_plugin`; the user may also reference it from the composer **+** menu or
   `/plugins`. A plugin with `activation: "required"`, or one whose `UserPromptSubmit`
   hook must run on the first message, must be referenced before that message is sent.
   `use_plugin` does not retroactively run `UserPromptSubmit`.
8. Run the concrete acceptance prompt and report actual approval/execution evidence.
   Action hooks require host execution, Full Access and a trusted project; Request
   Approval, Docker, ChatAgent, actual SubAgents and read-only profiles do not execute
   them. `Interrupt` is only a bounded prompt cleanup notification; its Command/MCP
   actions are skipped and must never be described as executing.

After validating and preparing the catalog, finish the current Agent turn so the user
can install it. A missing model-side install/enable tool is the manual lifecycle
boundary, not a failure to build an installable plugin. State "source validated;
manual installation pending" with the real market path and next UI action, instead of
ending with a generic "cannot install" blocker. Do not poll for installation while
keeping an Agent task active.

If installation reports that MCP synchronization was incomplete, use the
**重试 MCP 同步** icon on the installed plugin row. The host reuses the unchanged
plugin version while retrying the MCP import.

Respect an existing disabled choice. Source existence, catalog creation, and validation
do not mean the market was added or the plugin installed.

After installation, create a new task and use a concrete trial prompt based on the
implemented capability. State the observable expected result. If the user has not run
the trial, mark it pending rather than claiming runtime success.

## Update without replacing identity

Edit the original source, increase its version, and synchronize the same marketplace
entry using the existing market name. Then direct the user to:

1. Open **Settings → Skills 与插件 → 本地插件开发市场**.
2. Select the existing source and choose **刷新** rather than adding the market again.
3. Wait for every Agent task to finish, or stop it manually.
4. When the new version is detected, choose **更新** on that plugin row.
5. Confirm the expected version, then run the acceptance prompt in a new task or the
   next round.

Source edits are not hot reload. Do not edit the installed copy or remove same-name
markets automatically. On a validation or installation error, preserve the source,
inspect the actual message, fix the source/catalog mismatch, and repeat authoritative
validation. If update reports incomplete MCP synchronization, use
**重试 MCP 同步** on the installed plugin row to retry that import.

Read-only checks rotate through at most 10 registered markets per check and 200 entries
per market. Only strictly newer semantic versions with a rechecked matching source can
offer an update. Missing or untraceable installed-source records are not automatically
matched by name; ask the user to confirm the original source instead of adopting an
unrelated entry. Checks never install or execute a version.

## Delivery

Report the absolute source directory, manifest path, market root, marketplace path,
stable plugin ID, source version, adapter Skill, component inventory, authoritative
validation result, manual installation/update state, trial prompt, and pending checks.
Never describe a generated plugin as installed or working before the host and user path
have produced that evidence.

For manifest examples and lifecycle failure handling, load
[local-plugin-development.md](plugin-creator/references/local-plugin-development.md)
with `resource:"references/local-plugin-development.md"`.
