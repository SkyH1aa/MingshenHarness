# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The shipped product is a Windows desktop application. Its interface is a Chromium-rendered Electron surface, while filesystem access, process execution, credentials, permissions, browser automation, and OS integration remain in the trusted main process.

## Stack

Electron, React, TypeScript, Vite and SQLite. Protected commands use an external Docker Desktop engine. Host file tools enforce approvals and paths in trusted main-process code; no native Windows sandbox helper is shipped. The experimental editor and terminal are lightweight application panels.

## Users

Primary users are internal staff who already have access to custom OpenAI-compatible or Anthropic-compatible model endpoints. They use the product for software engineering, technical operations, research, and other computer-based knowledge work.

The interface is Chinese-first, defaults to Simplified Chinese, and can switch to English. No hosted account or model marketplace is required.

## Product Purpose

Mingshen Harness is a local-first desktop AI coding and work agent. A user connects a custom provider, configures one or more models under that provider, selects the model's modalities and reasoning levels, and works with an agent that can inspect repositories, edit code, run commands, use Git, research in an in-app browser, and call approved tools.

Success means a user can complete a real coding task, review every change, recover a long-running session later, and keep all conversation and workspace data on the local machine unless they explicitly allow anonymous diagnostic upload.

## Positioning

The provider connection is a first-class object: one Base URL and one protocol can own multiple models and multiple API keys. Every model has its own context window, output limit, supported modalities, tool capabilities, and manually defined reasoning levels.

The product is not tied to free hosted models. It is local-first, supports OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages directly, and imports Codex-compatible Skills and plugin directories while preserving their on-disk meaning.

## Operating Context

- Windows 10 and Windows 11 x64 are the first-release platforms.
- A workspace is a local directory, normally a Git repository. Agents may operate across the disk in Full Access mode, subject to fixed catastrophic-command protection.
- Provider endpoints may be remote gateways or localhost services and must end at `/v1`.
- Sessions can be long-running, concurrent, compacted, exported, archived, and resumed.
- Users may work with text, images, existing audio files, video, PDFs, Office documents, and source files up to 25 MiB per attachment.
- Users import Skills and Codex-compatible plugins from local directories.
- Browser automation runs inside the Harness desktop window through separate embedded
  Chrome-compatible and Edge-compatible Chromium profiles.
- The GitHub plugin is an API-native integration for repository search, PR and issue triage,
  Actions status and review/publish actions. It does not route GitHub work through the browser.

## Capabilities and Constraints

- A provider connection uses exactly one wire protocol: Anthropic Messages, OpenAI Responses, or OpenAI Chat Completions.
- Base URLs end at `/v1`. The app calls `/models`, `/messages`, `/responses`, or `/chat/completions` as appropriate.
- Authentication supports `Authorization: Bearer`, `x-api-key`, `api-key`, and configured custom headers.
- Multiple API keys can belong to one provider, with visible selection, priority, cooldown, and failover.
- Model list retrieval is automatic, with manual model creation as fallback.
- Each model independently stores its ID, context window, maximum output tokens, input modalities, tool-call support, parallel-tool-call support, and ordered reasoning levels.
- Reasoning levels are user-defined strings for each model. The standard vocabulary is `none`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Anthropic reasoning uses adaptive thinking and effort levels. It does not use manual token budgets.
- Connection tests send a real minimal model request and expose the status, response, timing, and redacted diagnostics.
- Sessions retain their complete local history even when context compaction is applied.
- Multiple sessions can run concurrently. Subagents inherit the parent model and policy and cannot create further subagents.
- Two permission modes exist: Full Access and Request Approval.
- Request Approval gates Agent file reads, writes, commands and MCP operations. Protected commands run in Docker; explicit Docker sessions also route file tools through container workers. Host file tools are not an OS filesystem sandbox. Local stdio MCP startup requires separate authorization.
- Full Access bypasses approvals but retains fixed protection against catastrophic system commands.
- Users can approve once, for an exact command prefix or path within a time window, for the session, or for the project. They can deny with feedback.
- Workspace trust is recorded by path. Untrusted repository assets do not execute automatically.
- Skills use `SKILL.md` and YAML frontmatter, including multiline descriptions. Plugins use `.codex-plugin/plugin.json` and can expose Skills, MCP servers, commands, and MCP-type hooks.
- Shell hooks are disabled by default and require explicit approval.
- Browser automation supports navigation, clicking, typing, scrolling, screenshots, and
  accessibility-tree inspection in real Chrome or Edge windows.
- Web search supports Google, Bing, DuckDuckGo, and provider-native search where available.
- Scheduled tasks run while the application is alive, including in the tray. Fully quitting stops schedules and active background work. Closed-application scheduling is not implemented.
- User data and sessions stay local. Anonymous diagnostic upload is opt-in and must be redacted.
- No cost estimates or billing calculations are displayed. Usage metrics are limited to tokens, context use, elapsed time, and tool duration.
- API keys are encrypted with Electron safeStorage and Windows platform protection, with ciphertext stored in local SQLite. Full values are never returned to the renderer.
- The first release is unsigned and distributed through a standard per-user NSIS installer.
- Updates are discovered through Supabase and the download page opens in the system default browser.

Open decisions:

- A real Anthropic-compatible `/v1/messages` endpoint is still needed for final protocol acceptance.
- Code signing and organization-wide deployment controls are outside the first release.

## Brand Commitments

The product name is Mingshen Harness. The agent identifies itself as Mingshen.

The product should feel precise, calm, inspectable, and under the user's control. It should not copy the visual identity, wording, or information architecture of Codex, ZCode, OpenCode, or another agent product. Chinese typography leads the interface.

The user explicitly chose a white day theme and a true-black graphite night theme. The product mark is an aqua atom on a dark rounded square. Detailed visual decisions belong in `DESIGN.md`.

## Evidence on Hand

There are no customer claims, benchmarks, testimonials, production screenshots, or public pricing. Future work must not fabricate them.

The only confirmed real provider test target during development is an OpenAI-compatible gateway supporting Responses and Chat Completions with the model `gpt-6.1-sol`. Credentials must remain outside source control and documentation.

## Product Principles

1. The user owns the endpoint, keys, models, workspace, and local history.
2. Privileged actions remain visible, auditable, and revocable.
3. Agent state is legible: what is running, what changed, what failed, and what needs approval.
4. Safety boundaries survive Full Access and cannot be bypassed through tools, extensions, or untrusted content.
5. Local operation and provider independence outrank hosted convenience.

## Accessibility & Inclusion

Primary workflows must be keyboard reachable. Status cannot rely on color alone. Controls and text must remain usable at 200% zoom and at compact desktop widths. Reduced-motion preferences must be respected.
