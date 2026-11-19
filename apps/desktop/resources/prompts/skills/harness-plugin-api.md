# Mingshen Local Plugin Interface

Use this reference before creating, validating, explaining, or updating a native
Mingshen plugin. It defines the host boundary; it does not grant installation or
execution permission.

## Host actions and authority

CodeAgent and WorkAgent expose the read-only `local_plugin` tool in primary host
sessions with a workspace. Full Access and Request Approval / native protected sessions
are supported; normal read approval and Profile permissions apply. ChatAgent, actual
SubAgents, Docker and worktree sessions use **Settings → Skills 与插件 → 本地插件开发市场**
without this Agent-side validator. Its actions are:

```json
{"action":"inspect","rootPath":"<absolute plugin directory>"}
{"action":"validate","rootPath":"<absolute plugin directory>"}
{"action":"list_markets"}
```

Use `validate` before every manual installation or update handoff and use the returned
validation as the authoritative runtime check. `inspect` may show the recognized
capabilities and metadata. `list_markets` reads the user's registered local markets.
`rootPath` must be an absolute real plugin directory inside the current workspace.
If the tool is absent, plugin runtime validation is unavailable; a file-only check must
be reported as a preflight, not as successful installation or execution.

This validator runs inside the trusted host without starting plugin scripts, hooks,
MCP servers or the SDK CLI. The Agent does not need Node on PATH or filesystem access
to the application resources directory. A displayed SDK path is an optional manual
developer reference and must not be used to bypass the workspace sandbox.

Marketplace add/remove/refresh, plugin install/update, and enable/disable are deliberate
UI actions. The Agent does not receive tools to perform those lifecycle mutations, and
must not edit user settings or installed caches to simulate them.

After source validation and marketplace preparation, finish the Agent turn and hand off
the absolute market path and next Settings action. Report the source as ready for manual
installation; do not describe the absence of lifecycle tools as a plugin-build failure.

## Native source contract

The native manifest path is:

```text
<plugin>/.mingshen-plugin/plugin.json
```

Required fields:

```json
{
  "name": "lowercase-plugin-name",
  "version": "0.1.0",
  "description": "The concrete capability provided by this plugin.",
  "skills": ["skills/example-harness"]
}
```

`skills` contains plugin-root-relative Skill directories, not `SKILL.md` filenames.
Every referenced directory needs a `SKILL.md`. `commands` may be an inline map/array, a
root-relative Markdown file or directory, or a JSON declaration file. Every command
entry references a Markdown file no larger than 1 MiB with a valid command name.
`hooks` and `mcpServers` may be inline objects or root-relative JSON file paths. All
declared paths must resolve inside the plugin root without symbolic-link escape.

Use `${MINGSHEN_PLUGIN_ROOT}` for the installed plugin root in MCP arguments and hook
commands. The compatibility tokens `${CLAUDE_PLUGIN_ROOT}` and
`${ZCODE_PLUGIN_ROOT}` are recognized but should not be used in new native source.

Supported hook events are `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`,
`SubagentStop`, and `Interrupt`. Installing or enabling a plugin does not run hooks
globally: the plugin must also be referenced in the current primary CodeAgent/WorkAgent
conversation. Action hooks then require host execution, Full Access and a trusted
project; Request Approval, Docker, ChatAgent, actual SubAgents and read-only profiles
do not execute them. Shell hooks additionally require the explicit application setting
and approval for each action. MCP hooks still require an enabled/configured server and
per-action approval.

`UserPromptSubmit` contributes only bounded declarative prompt context; its Command/MCP
actions are ignored. `Interrupt` is an explicit-stop cleanup notification with an
independent fire-and-forget signal capped at about 1.5 seconds. It supports only prompt
activity text, while Command/MCP actions are skipped without approval, process launch
or tool recovery. Never describe a declared hook as executed until the host returns an
execution result.

## Local development market

Use this layout:

```text
market-root/
  marketplace.json
  plugins/
    example/
      .mingshen-plugin/plugin.json
      skills/
        example-harness/
          SKILL.md
```

The preferred catalog is `market-root/marketplace.json`. The host also recognizes
compatible hidden catalogs at `.mingshen-plugin/marketplace.json`,
`.zcode-plugin/marketplace.json`, and `.claude-plugin/marketplace.json`. The catalog
contains a stable lower-case market name and plugin entries. Each entry requires
`name`, `source`, and semantic `version`; a description is recommended. Each `source`
is a root-relative directory such as `./plugins/example`; sources outside the market
root are invalid. Preserve unrelated entries and the existing market identity when
updating one plugin.

The editable source, catalog entry, and host-managed installed copy are three different
locations. Updating source does not hot-reload an installed plugin.

Marketplace registration, install, update, enable/disable, and source removal are UI
actions in **Settings → Skills 与插件 → 本地插件开发市场**. Install and update require
all Agent tasks to finish or be manually stopped. After editing source, refresh the
existing source; a changed semantic version exposes the update action. Removing a
source does not uninstall installed plugins. If an install/update warning says MCP
synchronization is incomplete, use **重试 MCP 同步** on the installed plugin row to
retry the import without changing the installed version.

## Required Harness interface Skill

A generated plugin should include one focused adapter Skill so the model can select and
use its capabilities without guessing. Give it a stable `<plugin>-harness` style name and
write:

- the concrete user requests that should trigger the plugin;
- exact Skills, commands, MCP tools, and hook events that actually exist;
- input prerequisites and safe fallback when a component is unavailable;
- the final result and verification evidence expected from the user;
- a statement that plugin resources cannot expand host permissions.

Do not add a generic skill that merely restates the manifest. The adapter must explain
how this particular plugin cooperates with Harness.

## Versioning and installed state

Keep the plugin `name` stable. Increment the semantic `version` when the distributable
content changes, update the matching marketplace entry, and leave unrelated plugins
untouched. Installed/enabled state belongs to the application, not the source manifest.
An update preserves the user's enable/disable choice unless the UI explicitly says
otherwise.

For a handoff, report the absolute source directory, manifest, marketplace root,
version, validation result, manual add/install step, trial prompt, expected result, and
checks still pending. Source existence and a successful preflight never prove market
registration, installation, enablement, or runtime execution.

Load [interface-template.md](harness-plugin-api/references/interface-template.md) with
`resource:"references/interface-template.md"` when creating the plugin's adapter Skill.
