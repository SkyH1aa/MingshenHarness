# Native Plugin Manifest and Lifecycle Notes

## Minimal plugin

```json
{
  "name": "report-tools",
  "version": "0.1.0",
  "description": "Review a report package and return a checked edit plan.",
  "skills": ["skills/report-tools-harness"]
}
```

The referenced Skill is the Harness adapter. Additional Skills may cover reusable
sub-workflows. Paths are relative to the plugin root and must not escape it.

Omitting manifest `activation` defaults to `on-demand`. Enabled plugins with this policy
are discoverable and the primary Code/Work Agent can activate them with `use_plugin` for
the current run. `activation: "required"` means the user must select the plugin in the
session first. Activation is temporary and does not modify installation, enabled state,
or persistent session selection.

## Inline declarations

```json
{
  "commands": {
    "review": {
      "file": "commands/review.md",
      "description": "Review the current deliverable."
    }
  },
  "hooks": {
    "Stop": [
      {
        "type": "mcp_tool",
        "server": "report-verifier",
        "tool": "verify_latest",
        "input": {}
      }
    ]
  },
  "mcpServers": {
    "report-verifier": {
      "command": "node",
      "args": ["${MINGSHEN_PLUGIN_ROOT}/mcp/server.mjs"]
    }
  }
}
```

These are shapes, not proof that a command exists or a hook is enabled. Command values
must identify a Markdown file inside the plugin root; the file must be valid UTF-8 and
no larger than 1 MiB. A command may also be declared as a Markdown path, a command
directory, or a JSON declaration file. Verify the exact component contract in the
current source/runtime. Never copy a command or server merely because a reference says
it is supported.

Declarative JSON files may be used instead:

```json
{
  "hooks": "hooks/hooks.json",
  "mcpServers": "mcp/servers.json"
}
```

The file itself may contain the server map directly or a top-level `mcpServers` object.
Every declaration file must be a regular JSON file inside the plugin root and no larger
than the host limit.

## Hook safety

`UserPromptSubmit`, `BeforeModelRequest`, `PreToolUse`, `PostToolUse`, `Stop`,
`SubagentStop`, and `Interrupt` are supported event names. Once an enabled on-demand
plugin has been discovered and selected with `use_plugin`, `BeforeModelRequest` runs
before each subsequent model request in the active primary Code/Work run, including
network retries and run-owned context compaction or memory analysis/summaries. It only
handles bounded `type:"prompt"` text. Optional `position:"before"|"after"` and
`format:"context"|"plain"` fields control placement and labeling. The default
before/context preserves the existing wrapped low-priority context.
`position:"after", format:"plain"` appends only the declared text as ordinary
user-visible content with one newline and no blank separator. `format:"plain"` is the
reusable attribution opt-out: with either position it removes the plugin ID, heading,
source attribution and `<mingshen_plugin_context>` wrapper. Legacy `format:"context"`
keeps that attribution. Plain text remains user-priority text and cannot override higher-priority safety rules.
`before + context` remains system context. When a request ends with tool results, other
user-content additions go after the complete tool-result group in the protocol-valid
form: a content block in the existing user message or a separate user tail message. They
must not split a tool call from its result or rewrite their pairing. Declared command/MCP
actions are skipped. An initial request already sent before the
plugin is selected is not replayed. Hook load, file, timeout, or validation errors are
logged and fail closed: the affected request is not sent, and the failure is returned to
its owning generation, compaction, or memory operation rather than silently proceeding
without the hook context. Cancellation propagates. Actual children derived through an
active parent run's `runSubagent` path inherit only the parent's selected/activated
plugins' declarative `type:"prompt"` context from the initial request. Later parent
activation is consulted before each subsequent unsent child request. This does not
expose plugin activation, `UserPromptSubmit`, `Interrupt`, plugin commands, MCP, action
hooks or `local_plugin` to the child. Independent child conversations opened directly
with `@` and no active parent-run mapping do not inherit it. The hook does not run for
ChatAgent, automatic-approval reviews, independent AutoDrive/draft-polish jobs, or
post-run titles.

`UserPromptSubmit` only sees plugins selected when the user submits the turn; it cannot
be triggered retroactively by `use_plugin`. Other event hooks from an enabled on-demand
plugin selected with `use_plugin` are available for subsequent events in the primary
Code/Work run, subject to the same host security checks as session-selected plugins;
this does not enable child action hooks or plugin tools. Hook commands are not implicitly
trusted or silently run:
shell hooks require an explicit enablement plus trust and per-action approval as
implemented by the host. Use MCP actions when the capability fits the MCP boundary.

Avoid hooks that rewrite user messages, hide tool results, alter trust/approval state,
or run during validation. Such behavior is hard to audit and conflicts with host security.

## Marketplace reconciliation

For each plugin entry, require:

- marketplace object with `name` and `plugins` array;
- entry `name` equal to the manifest `name`;
- `source` an inside-root relative directory, not an absolute path or URL;
- semantic `version` synchronized from the validated manifest;
- description synchronized from the manifest when present.

When a same-name plugin points to another source, stop and ask for a deliberate source
decision. Do not silently replace a user's market or installed extension.

Prefer `marketplace.json` at the market root. The host also accepts compatible hidden
catalogs under `.mingshen-plugin`, `.zcode-plugin`, and `.claude-plugin`; use one catalog
consistently rather than creating overlapping files that disagree.

The `local_plugin` validator supports primary CodeAgent/WorkAgent host sessions whose
plugin source is inside the session workspace. Request Approval / native protected
sessions use the existing read approval and Profile rules; Full Access remains subject
to explicit Profile denials. ChatAgent, actual SubAgents, Docker and worktree sessions
validate through **Settings → Skills 与插件 → 本地插件开发市场**.

Authoritative validation does not need Node, a shell command, or access to the host's
installed SDK directory. Create source/catalog files with managed workspace tools and
call `local_plugin validate`. Keep SDK CLI commands as an optional manual developer
workflow. Never switch to host command execution or retry a denied SDK path as a
substitute for this read-only broker.

Install and update require all Agent tasks to finish or be manually stopped. After
source edits, refresh the existing development market so its catalog and validation
reflect the new files. A changed semantic version exposes the update action; source
edits never hot-reload an installed copy. Removing a source does not uninstall the
plugin. If the action reports incomplete MCP synchronization, use
**重试 MCP 同步** on the installed plugin row to retry that import.

Read-only checks rotate through at most 10 registered markets per check and 200 entries
per market. They offer only strictly newer semantic versions with a rechecked matching
source path. A plugin with missing or untraceable installed-source records is not
automatically claimed by a same-name entry; the user must confirm its original source.
Checks do not install or execute an update.

## Status vocabulary

Use precise states:

- **source created**: editable files exist;
- **preflight passed**: the SDK or file checker found no covered errors;
- **runtime validation passed**: `local_plugin validate` returned `ok`;
- **market awaiting addition**: catalog exists but user has not registered it;
- **plugin awaiting installation/update**: the market is visible but host inventory is
  unchanged;
- **installed/disabled**: host inventory shows the plugin but capability still needs a
  trial;
- **trial passed**: representative prompt produced the stated observable result.

Do not collapse these states into "done".

After a successful source validation and catalog preparation, finish the Agent turn
with the absolute source/market paths and the user's next installation action. The
absence of model-side lifecycle tools is expected; it does not mean the source cannot
be installed. Do not leave a running Agent task waiting for an installation that the
host intentionally blocks while tasks are active.
