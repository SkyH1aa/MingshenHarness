# Mingshen Local Plugin SDK

Version 1.3.7.

`mingshen-plugin.mjs` is a dependency-free scaffolding and preflight helper for
Mingshen's native local-plugin format.

```powershell
node mingshen-plugin.mjs create .\market\plugins\example `
  --name example `
  --description "An implemented workflow."

node mingshen-plugin.mjs validate .\market\plugins\example --json

node mingshen-plugin.mjs marketplace .\market `
  --name dev-example `
  --add .\market\plugins\example
```

The native source layout is:

```text
market/
  marketplace.json
  plugins/
    example/
      .mingshen-plugin/
        plugin.json
      skills/
        example-harness/
          SKILL.md
```

The `create` command writes intentionally obvious `TODO` content. Complete the
capability before validation; placeholder text is rejected. Command declarations may
point to root-relative Markdown files or directories; preflight verifies containment,
the 1 MiB limit, UTF-8 decoding, command names, and duplicate names.

This CLI is an optional, strict SDK preflight, not the application's authoritative
validator. In a primary CodeAgent or WorkAgent host Windows conversation, call the
visible `local_plugin` tool with
`{"action":"validate","rootPath":"<absolute path>"}` and treat its result as final.
The tool is available in Request Approval and Full Access modes, with an absolute
real directory inside the current workspace. It inherits `read_file` Profile rules
and, in Request Approval, asks for a path-scoped read decision. Docker, worktree,
ChatAgent, actual SubAgents and other unsupported sessions validate in
**Settings → Skills 与插件 → 本地插件开发市场**.

The host validator runs directly in the Electron main process. It does not require
system Node.js, read PATH or launch this CLI. Only users who choose to run this CLI
need a compatible Node.js environment; its result cannot replace host validation.

Plugin execution is subordinate to the managed host policy described in
**Settings → Runtime & Integrations → Runtime governance**. Built-in safety limits,
machine policy, application policy, Agent mode, project trust and execution
environment are layered with deny precedence. A manifest, project file, Agent
prompt or Full Access choice cannot relax them. If the machine policy file exists
but is unreadable, malformed or uses an unsupported version, new plugin, Skill,
command, MCP and Hook execution pauses; installed metadata and diagnostics remain
available. Static validation never executes plugin code and does not authorize a
later action.

Marketplace add, install, update and enable/disable remain explicit user actions in
that settings page. Install and update require all Agent tasks to finish or be manually
stopped. After source edits, refresh the existing market; a changed semantic version
exposes the update action. Removing a source does not uninstall plugins. If the host
reports incomplete MCP synchronization, use **重试 MCP 同步** on the installed plugin
row to retry it without changing the installed version.

Marketplace catalog updates are serialized per root and protected by a short-lived
lock file across CLI processes. The catalog is replaced atomically from a random
temporary file, so concurrent adds do not overwrite each other's entries.
Normal writers wait up to 15 seconds. If the lock is older than 60 seconds, the
SDK stops without deleting the lock or changing the catalog. Verify that no
writer is active, then remove only the reported `.marketplace.json.lock` and
retry; do not delete `marketplace.json` as recovery.

Installing and enabling a plugin does not activate hooks globally. Omitted manifest
`activation` defaults to `on-demand`; the primary Code/Work Agent can discover an
enabled plugin and call `use_plugin` to activate it for the current run, so manual
session reference is not required for this policy. `activation:"required"` must be
selected in the session by the user. `UserPromptSubmit` only sees plugins selected when
that turn was submitted and cannot be triggered retroactively by `use_plugin`.

After activation, `BeforeModelRequest` runs before each subsequent model request in that
primary run, including network retry requests, run-owned context compaction, and
session-owned memory analysis or summaries. It handles only bounded `type:"prompt"`
text for that request. Each prompt accepts optional `position` (`"before"` or `"after"`,
default `"before"`) and `format` (`"context"` or `"plain"`, default `"context"`).
The defaults retain the existing wrapped system-context format. `format:"plain"` is the
reusable attribution opt-out: with either `position` value it omits `Plugin N`, the plugin
heading, source attribution and the `<mingshen_plugin_context>` wrapper. Legacy
`format:"context"` keeps that attribution. `plain` sends only the declared text as
ordinary user-visible request text; `position:"after"` places it at the end of the current
request rather than before the original input. This does not make the text a
higher-priority system instruction. `before + context` remains system context. In
a tool-result round, user-content `plain` or `after` text is never inserted between a
tool call and its result: the host preserves the full call/result group, then adds the
text in the protocol-valid position, either as a content block in the existing user
message or as a separate user tail message. It cannot change a request already sent and
never executes command/MCP actions. Hook load, file, timeout, or
validation errors are logged and fail closed: the affected model request is not sent and
the failure is returned to its owning generation, compaction, or memory operation
rather than silently continuing without the hook context. Cancellation propagates. Actual
child tasks derived through an active parent run's `runSubagent` path inherit only the
parent's selected/activated plugins' declarative `type:"prompt"` context on initial and
later requests. Later parent activation is consulted before the next unsent child
request; it does not change requests already sent. This does not expose plugin
activation, `UserPromptSubmit`, `Interrupt`, plugin commands, MCP, action hooks or
`local_plugin` to the child. Independent child conversations opened directly with `@`
without an active parent-run mapping do not inherit it. The hook does not run for
ChatAgent, automatic-approval reviews, independent AutoDrive/draft-polish jobs,
or post-run title generation. Action hooks require host execution, Full Access and a
trusted project; Request Approval, Docker, ChatAgent, actual SubAgents and read-only
profiles do not execute them. MCP hooks still require per-action approval. `Interrupt`
is an explicit-stop, fire-and-forget cleanup notification capped at about 1.5 seconds;
only prompt activity text is supported, while its Command/MCP actions are always skipped.

To append hidden-marker-free text at the end of each request:

```json
{
  "hooks": {
    "BeforeModelRequest": [
      {
        "hooks": [
          {
            "type": "prompt",
            "text": "123abc",
            "position": "after",
            "format": "plain"
          }
        ]
      }
    ]
  }
}
```

For a user request `xxxx`, the host adds the text as ordinary request content:

```text
xxxx
123abc
```

The wire join is a single newline: `xxxx\n123abc`. It does not add
`<mingshen_plugin_context>`, a `Plugin N` heading, source attribution, a separate
untrusted-context explanation or a blank separator. Plain text remains subject to normal
message priority and cannot override system policy, user instructions, approvals or tool
boundaries.

Read-only update checks rotate through at most 10 registered markets per check and 200
entries per market. Updates require a strictly newer semantic version and rechecked
matching source path. An installed plugin with no source record or an untraceable source
is not automatically matched by name. The user must choose **Update**; update checks
never install or execute new versions.
