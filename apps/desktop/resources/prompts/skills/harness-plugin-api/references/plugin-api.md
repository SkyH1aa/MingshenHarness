# Local Plugin API

## Capability lifecycle

1. Create a plugin source directory with `.mingshen-plugin/plugin.json` and the resources it declares.
2. Validate the plugin directory with the read-only `local_plugin` host tool, or validate its marketplace root to check every catalog entry.
3. Register the local marketplace in **Settings > Skills and plugins > Local plugin development marketplace**.
4. Install and enable the plugin through that UI. Validation never installs or executes plugin code.
5. Enabled plugins are indexed for CodeAgent and WorkAgent. The Agent can call `discover_capabilities` and then `use_plugin` for an on-demand plugin. `activation:"required"` plugins must be referenced by the user before submission.
6. `use_skill` loads an exact Skill id. Plugin MCP tools and later action hooks become eligible from the next model round, subject to normal execution, trust, approval and isolation checks.
7. To update, edit the source, increment its semantic version, refresh the same market and choose **Update**. Source edits do not change an installed copy.

An active parent run's actual `runSubagent` children inherit only `BeforeModelRequest` declarative `type:"prompt"` text from the parent's selected/activated plugins, beginning with their initial request and reflecting later parent activation on the next unsent request. Prompt options preserve their meaning: the default is wrapped before-context, while `position:"after", format:"plain"` appends unwrapped ordinary request text without `mingshen_plugin_context` or plugin labels. Plain text is not promoted to a system instruction. Children do not gain plugin activation, `UserPromptSubmit`, `Interrupt`, plugin commands, MCP, action hooks or `local_plugin`. An independent child conversation opened directly with `@` without an active parent-run mapping is not connected to this inheritance. ChatAgent, approval-safety reviews, independent AutoDrive/draft-polishing calls and post-run title generation remain outside the hook scope.

Read-only update checks rotate across at most 10 registered markets per check and 200 entries per market. They offer only strictly newer semantic versions with a rechecked matching source; installed plugins with missing or untraceable source records are not automatically matched by name. The user chooses **Update**; a check does not install or execute the version.

## Read-only validation actions

Primary CodeAgent and WorkAgent host sessions may use:

```json
{"action":"inspect","rootPath":"<absolute plugin directory>"}
{"action":"validate","rootPath":"<absolute plugin directory or marketplace root>"}
{"action":"list_markets"}
```

The validator reads manifests, Skills and declarations and checks paths, limits and content hashes. It does not run hooks, commands, MCP servers, or the optional SDK CLI. ChatAgent, actual SubAgents, Docker and worktree sessions must use the Settings validator.

## Authority boundary

The plugin API does not grant host permissions. It cannot read arbitrary paths, change approval policy, silently run commands, or install/update/enable plugins. MCP and action-hook calls remain subject to the host's current execution mode, trust state, approval policy and isolation. A successful source validation is not proof of installation or runtime execution.
