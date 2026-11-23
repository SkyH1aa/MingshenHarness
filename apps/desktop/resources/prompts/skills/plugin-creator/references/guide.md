# Plugin Creator Guide

Use this reference as the route map for the built-in plugin creation workflow. The full
end-to-end lifecycle is in `references/local-plugin-development.md`.

Before designing a manifest, load `builtin:harness-plugin-api` and use its exact resource
paths:

- `references/manifest.md` for manifest fields and paths;
- `references/manifest-schema.md` for a complete example and checks;
- `references/hooks.md` for event timing and security limits;
- `references/plugin-api.md` for discovery, activation and lifecycle boundaries;
- `references/interface-template.md` for a plugin-specific adapter Skill template.

The `plugin-creator` skill does not imply that a plugin is installed or running. Create
and validate source, prepare a marketplace entry, then hand off installation to the user
through Settings. After installation, test a representative request before claiming the
plugin works in the application.

For child-task coverage, only actual `runSubagent` children with an active parent-run
mapping inherit the parent's selected/activated plugins' declarative `BeforeModelRequest`
text, on initial and later requests; later parent activation is read before the child's
next unsent request. This never enables child plugin actions,
`UserPromptSubmit`, `Interrupt`, plugin commands, MCP or `local_plugin`; independent
`@` children without that mapping do not inherit it. Use `references/hooks.md` for the
complete request and auxiliary-job boundaries.
