# Manifest Example and Validation

```json
{
  "name": "report-tools",
  "version": "0.1.0",
  "description": "Prepare and verify a decision-ready report package.",
  "activation": "on-demand",
  "skills": ["skills/report-tools-harness"],
  "commands": {
    "review": {
      "file": "commands/review.md",
      "description": "Review the current report package."
    }
  },
  "hooks": {
    "BeforeModelRequest": [
      {
        "hooks": [
          {"type": "prompt", "text": "Use the report-tools workflow when relevant."},
          {
            "type": "prompt",
            "text": "123abc",
            "position": "after",
            "format": "plain"
          }
        ]
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

Before validation, check:

- Every Skill directory contains valid UTF-8 `SKILL.md` with useful frontmatter and real workflow instructions.
- Every declared path exists, is a regular file or directory of the expected type, stays within the plugin root, and respects host size/count limits.
- Command Markdown references resolve and have valid command names.
- Hook event names are supported. Prompt-only events do not execute declared command or MCP actions. `BeforeModelRequest` prompts accept only `position:"before"|"after"` and `format:"context"|"plain"` when those fields are present; omitted values retain the compatible before/context behavior.
- `format:"plain"` adds only the prompt text as ordinary request content. `position:"after"` appends it at the end; together they avoid `<mingshen_plugin_context>`, `Plugin N` and attribution labels. This is still ordinary user-priority text and cannot elevate itself to system instructions.
- Only declarative `BeforeModelRequest` text can be inherited by actual `runSubagent` children of an active parent run, using the parent's selected/activated plugins on initial and later requests. Parent activations after child creation are reflected before the child's next unsent request. This never exposes plugin actions or lifecycle tools to a child; direct independent `@` children without an active parent-run mapping do not inherit it. See `references/hooks.md` for all exclusions and failure handling.
- Each MCP server has a command or URL. Secrets are not embedded in source, examples or marketplace metadata.
- Marketplace entry name and semantic version match the manifest, and its relative source resolves inside the market root.
- No `TODO`, `FIXME`, unresolved credential placeholders or behavior claims without an implementation remain.

Use `local_plugin validate` as the authoritative host validator. Do not execute hook or MCP code just to prove validation succeeds.
