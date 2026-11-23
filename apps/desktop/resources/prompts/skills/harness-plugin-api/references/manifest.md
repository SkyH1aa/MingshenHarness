# Native Plugin Manifest

The native manifest is `<plugin>/.mingshen-plugin/plugin.json`.

```json
{
  "name": "lowercase-plugin-name",
  "version": "0.1.0",
  "description": "A concise description of the implemented capability.",
  "activation": "on-demand",
  "skills": ["skills/example-harness"],
  "commands": "commands",
  "hooks": "hooks/hooks.json",
  "mcpServers": "mcp/servers.json"
}
```

`name` is a stable lowercase id containing letters, digits and hyphens. `version` must be semantic versioning. `description` should describe behavior that exists. `activation` is optional and defaults to `on-demand`; the only explicit values are `on-demand` and `required`.

`skills`, `commands`, `hooks` and `mcpServers` can also be declared under a top-level `paths` object. All paths are relative to the plugin root and may not escape it. Symbolic-link escapes are rejected. Skill declarations may point to a Skill directory containing `SKILL.md` or directly to a file named `SKILL.md`. Commands must resolve to Markdown command templates. Hooks and MCP declarations can be inline objects or regular JSON files inside the plugin root.

The host recognizes native manifests plus supported Codex, Zcode and legacy plugin manifests. For a new plugin, use the native layout and do not infer support from another product's manifest.

Declaring `BeforeModelRequest` does not grant child plugin execution. Only its bounded `type:"prompt"` text is inherited by actual `runSubagent` children with an active parent-run mapping, from the parent's selected/activated plugins; initial and later child requests reflect that parent state. Prompt `position:"before"|"after"` and `format:"context"|"plain"` options are preserved. `position:"after", format:"plain"` appends only the declared text with no `<mingshen_plugin_context>`, `Plugin N` or attribution wrapper; it remains ordinary user-priority content. Independent `@` child conversations without such a mapping and independent auxiliary jobs do not inherit it. See `references/hooks.md` for timing, exclusions and failure handling.

See `references/manifest-schema.md` for a complete example and preflight checklist.
