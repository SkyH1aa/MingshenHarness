# Mingshen Local Plugin SDK

Version 1.3.3.

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

Marketplace add, install, update and enable/disable remain explicit user actions in
that settings page. Install and update require all Agent tasks to finish or be manually
stopped. After source edits, refresh the existing market; a changed semantic version
exposes the update action. Removing a source does not uninstall plugins. If the host
reports incomplete MCP synchronization, use **重试 MCP 同步** on the installed plugin
row to retry it without changing the installed version.

Installing and enabling a plugin does not activate hooks globally. Reference the
plugin from the current primary CodeAgent/WorkAgent composer **+** menu or `/plugins`.
Action hooks require host execution, Full Access and a trusted project; Request
Approval, Docker, ChatAgent, actual SubAgents and read-only profiles do not execute
them. MCP hooks still require per-action approval. `Interrupt` is an explicit-stop,
fire-and-forget cleanup notification capped at about 1.5 seconds; only prompt activity
text is supported, while its Command/MCP actions are always skipped.
