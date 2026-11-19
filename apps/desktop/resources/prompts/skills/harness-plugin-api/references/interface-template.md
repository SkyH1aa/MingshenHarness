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
