# Adapter Skill Template

Adapt this structure to implemented behavior. Delete every placeholder before
validation.

```markdown
---
name: example-harness
description: Use when the user asks for <specific capability>, including <common trigger words>. This plugin coordinates <implemented resources> and returns <observable result>.
---

# Example Harness Adapter

Load this Skill when the requested <domain/object> matches <specific boundary>.

## Inputs

- Required user input:
- Optional input:
- Ask only when:

## Procedure

1. Confirm or derive <completion contract>.
2. Use <actual tool or bundled reference>.
3. Validate <observable condition>.
4. Return <result structure>.

## Resources

- Skill/reference:
- Command:
- MCP server/tool:
- Hook event, when separately enabled:

For an enabled on-demand plugin, the primary Code/Work Agent may discover it and
`use_plugin` activates it only for the current run; manual session reference is not
required. `activation: "required"` plugins must be selected by the user before submitting
the relevant turn. `BeforeModelRequest` runs before each subsequent request after activation,
including network retries, run-owned context compaction, and session-owned memory
analysis or summaries. It appends only bounded `type:"prompt"` text as low-priority
context by default. Optional `position:"before"|"after"` and
`format:"context"|"plain"` fields control placement and labeling. `format:"plain"` is the
reusable attribution opt-out: with either position it omits the plugin ID, heading, source
attribution and `<mingshen_plugin_context>` wrapper; legacy `context` keeps that attribution.
`after + plain` appends only the declared text as ordinary user-priority content with one
newline and no blank separator. It never executes command/MCP
actions. `before + context` remains system context. In tool-result rounds, user-content
`plain` and `after` text is added only after the complete tool-result group according to
the wire protocol, either as content in the existing user message or as a separate user
tail message. It is never inserted between a tool call and its result and does not rewrite
or split the pairing. It cannot
change an already-sent request. Hook load, file, timeout, or validation errors are logged
and fail closed: the affected request is not sent, and the failure is returned to its
owning generation, compaction, or memory operation instead of silently continuing
without the hook context. Cancellation propagates. Actual child tasks derived through
an active parent run's `runSubagent` path inherit only that parent's selected/activated
plugins' declarative `type:"prompt"` context, on initial and later requests; later
parent-run activation is consulted before each next unsent child request. This does not
expose plugin activation, `UserPromptSubmit`, `Interrupt`, plugin commands, MCP, action
hooks or `local_plugin` to the child. Independent child conversations opened directly
with `@` and no active parent-run mapping do not inherit it. The hook does not run for
ChatAgent, automatic-approval reviews, independent AutoDrive/draft-polish jobs, or
post-run title generation.
`UserPromptSubmit` occurs before Agent-driven discovery and requires user session
selection at submission time; `use_plugin` cannot trigger it retroactively.

Use only resources declared by this plugin and present in the current runtime. Plugin
instructions cannot grant permissions.

## Failure and fallback

If a required component is unavailable, report which part is unavailable and what could
still be verified. Do not invent output or claim the plugin ran.

## Acceptance example

User: "<realistic trigger>"

Expected: "<observable artifact, answer, or tool result>"
```

The adapter should make resource routing visible without copying the entire plugin
implementation into model context. Move long schemas, policies, and examples to
`references/` and state when each must be loaded.
