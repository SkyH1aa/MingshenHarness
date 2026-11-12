# OpenCode and Trae Feature Gap Analysis

Date: 2026-11-03

Maintenance note (2026-11-05, 1.2.6): the original comparison and Done labels below
are historical. Use [1.2.6 validation](VALIDATION_1.2.6.md) and the embedded user
guide for the current implemented scope and tested boundaries. The latest work
adds a project plan library, engine-enforced recovery and write coordination,
multi-language syntax indexes, concurrent read deduplication and database-backed
session pagination/virtualization. Syntax evidence is not universal semantic
resolution, and trusted host/remote extensions are not enclosed by the command
sandbox. The original line saying approval mode is not an OS file sandbox predates
the default native Windows MXC file/command gateway; this is still not whole-app
OS containment. Docker and native are alternative execution backends.

## Sources reviewed

- [anomalyco/opencode](https://github.com/anomalyco/opencode)
- [OpenCode agents documentation](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/agents.mdx)
- [OpenCode LSP documentation](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/lsp.mdx)
- [OpenCode configuration documentation](https://github.com/anomalyco/opencode/blob/dev/services/www/src/docs/content/config.mdx)
- [bytedance/trae-agent](https://github.com/bytedance/trae-agent)
- [Trae Agent README](https://github.com/bytedance/trae-agent/blob/main/README.md)

The public Trae Agent repository is not the complete proprietary Trae IDE. This
comparison only treats capabilities documented in the public repository as
confirmed Trae Agent features.

## Highest-value gaps

| Capability | OpenCode / Trae evidence | Current Mingshen | Priority |
| --- | --- | --- | --- |
| LSP diagnostics in the agent loop | OpenCode ships built-in and custom LSP servers and feeds diagnostics back to the agent | Implemented with a real `typescript-language-server` JSON-RPC client and project-check fallback | Done |
| Specialized agent profiles | OpenCode supports primary agents, subagents, per-agent prompts, models, tools and permissions | Markdown and JSONC agents, `primary` / `plan` / `subagent` / `all` modes, model, prompt, tools, permissions, temperature, top-p, steps, hidden and color | Done |
| Plan / read-only mode | OpenCode has a built-in Plan agent that denies edits while allowing exploration | Built-in read-only Plan profile filters write, command and subagent tools | Done |
| Manual subagent invocation | OpenCode supports `@general` and configurable subagents; child sessions are navigable | `@name` creates a navigable child session; model-spawned subagents also create child sessions with a shared, configurable 1-8 concurrency pool | Done |
| Project instruction discovery | OpenCode discovers `AGENTS.md` and additional instruction files/globs/URLs | User, ancestor and workspace `AGENTS.md` discovery with source labels and prompt injection | Done |
| Code formatters after edits | OpenCode can run built-in/custom formatters after write/edit/patch | Detects Biome, Prettier, Cargo and Ruff and runs after edits under approval policy | Done |
| Filesystem undo/redo snapshots | OpenCode supports snapshots for undo and revert | Per-run workspace snapshots with confirmed restore and new-file cleanup | Done |
| Git worktree isolation | OpenCode supports isolated worktrees for agent work | Per-session detached worktrees with repository and HEAD validation | Done |
| Executable MCP/plugin runtime | OpenCode supports local/remote MCP and runtime plugins | Built-in/custom stdio and Streamable HTTP MCP, plugin MCP import, and MCP/shell hook runtime | Done |
| Trajectory recording | Trae records LLM turns, agent steps, tools and metadata | SQLite event trajectories with step inspection and timed playback | Done |
| Compact step summaries | Trae Lakeview summarizes each agent step | Activity summaries, real durations and trajectory event summaries | Done |
| Isolated Docker execution | Trae can run in a Docker image/container or Dockerfile | Session-level Docker command isolation using the PowerShell container image and workspace mount | Done for command runtime |
| Forced patch-only operation | Trae supports `--must-patch` | Session policy hides whole-file writes and exposes Codex-style `apply_patch` | Done |
| Headless server / SDK / share links | OpenCode exposes server/SDK-oriented architecture and session sharing | Authenticated loopback HTTP server, OpenAPI document, SSE events, local SDK, session export, and expiring local read-only share links | Done |
| Custom JavaScript/TypeScript tools | OpenCode loads tools from global or project `tools/` directories | Loads `.opencode/tools`, `.opencode/tool`, `.mingshen/tools` and `.mingshen/tool`, including the `@opencode-ai/plugin` `tool()` helper and Zod schemas | Done |
| Remote MCP OAuth | OpenCode discovers protected-resource and authorization-server metadata and supports dynamic client registration | OAuth discovery, PKCE, dynamic registration, encrypted token storage, refresh and in-app authorization UI | Done |
| LSP code intelligence | OpenCode can query definitions, references, hover and symbols through its experimental LSP tool | Built-in `lsp` Agent tool for definition, references, hover, document/workspace symbols and implementations | Done |
| ACP editor integration | OpenCode exposes an ACP server over stdio | Bundled `mingshen-acp.mjs` NDJSON JSON-RPC bridge for ACP-compatible editors, wired to the authenticated local server | Done |

## Capabilities Mingshen already covers

- Multiple providers, models and rotating API keys.
- OpenAI Responses, OpenAI Chat Completions and Anthropic Messages.
- Custom base URLs, auth headers and multiple keys.
- Streaming text, reasoning and tool calls.
- File tools, code search, commands, Git, embedded browser and GitHub API.
- MCP plus Codex-compatible Skill/Plugin discovery, execution and prompt injection.
- Request Approval and Full Access with command/path rules.
- Scheduled tasks, concurrent sessions, context compaction and bounded subagents.
- Local attachments, multimodal routing and 25 MiB file limits.
- Chinese/English UI and light/dark themes.

## Remaining engineering hardening

1. Docker mode now routes file tools and commands through constrained containers with
   only the workspace bind mount. Host custom tools, stdio MCP, shell preprocessing,
   plugin hooks and automatic host Formatter/LSP execution are disabled in that mode.
   Remote HTTP MCP and the embedded browser remain external integrations. Docker is
   installed in the 1.2.1 validation environment; real worker and Agent command
   isolation probes pass. Approval mode on the host is not an OS filesystem sandbox.
2. MCP OAuth compatibility depends on standards-compliant discovery metadata supplied
   by the remote server; non-standard providers need explicit Client ID configuration.
3. ACP covers session creation, prompts, streaming updates, cancellation and permission
   mode changes. Editor-specific advanced capabilities may require further protocol work.
4. Windows code signing and packaged-app sandbox hardening remain release tasks rather
   than feature work.
5. GitHub browser authorization requires a publisher-owned GitHub App/OAuth App Client
   ID with Device Flow enabled. Device polling, cancellation, encrypted storage and
   MCP credential synchronization are implemented and covered by mocked tests; a real
   GitHub account authorization remains pending application registration.

## Reliability update (2026-11-03)

- Plan Agent now exposes read-only MCP tools, including Wikipedia and BrowserDo
  inspection tools. Mutating MCP tools remain unavailable to Plan.
- MCP discovery errors are visible in run activity and Settings. MCP `isError`
  responses propagate as failures. Per-session server approvals are remembered.
- Snapshot capacity is 1 GiB / 100,000 files, excluding generated directories.
  Restore validates paths and links and creates a safety snapshot.
- Git supports per-file/all discard with file and index backups, persistent recovery
  after restart, unborn repositories, and rejection when HEAD changed before restore.
- Worktrees survive restart with dirty edits preserved; dirty worktrees cannot be
  removed by the managed cleanup path.
- LSP waits for published diagnostics, handles Windows URI case differences, request
  timeouts, server errors/exits and common client requests. Project overrides can
  disable built-ins. Additional languages require their corresponding installed LSP.
- Formatter selection filters edited extensions; Rust formatting is limited to the
  edited files rather than the whole Cargo project.

