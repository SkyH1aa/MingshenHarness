# Security Policy and Threat Model

## Public Materials and Hosted Services

本仓库完整公开 Supabase 后端数据库的[建库与迁移 SQL](supabase/migrations/)及[部署说明](docs/SUPABASE_DEPLOY.md)，并公开[智能体工作交接协议](AGENT.md)及其[入口](AGENTS.md)。公开这些资料不构成对作者线上服务的安全测试授权。未经作者事先明确授权，请勿通过逆向分析、漏洞利用、渗透测试、网络扫描或其他网络安全手段攻击、探测、干扰或越权访问作者的服务器、Supabase 项目、数据库及其他线上基础设施。安全验证请在自行部署且拥有权限的环境中进行；发现潜在漏洞请按下方 Reporting 说明私下报告。

This repository publishes the Supabase database creation and migration SQL,
deployment instructions, and agent work handoff protocol linked above. Publication
does not authorize security testing of the author's hosted services. Without the
author's prior explicit authorization, do not use reverse engineering,
vulnerability exploitation, penetration testing, network scanning or other security
techniques to attack, probe, disrupt or gain unauthorized access to the author's
servers, Supabase projects, databases or other hosted infrastructure. Perform
security validation in your own authorized deployment and privately report
suspected vulnerabilities as described under Reporting below.

## Verified ZIP updates (1.2.6+)

Explicit confirmation authorizes downloading and launching a newer version. Metadata comes from the fixed Supabase latest-release RPC; the original RPC stays available to older clients. ZIP downloads use public HTTPS, validate up to five redirects, omit app/model credentials and browser cookies, and support system proxies in an isolated Chromium session. Direct connections revalidate the actual socket DNS lookup; a configured proxy remains a trusted DNS/network boundary. ZIPs require a metadata SHA-256, bounded byte counts (2 GiB) and one root installer matching the version and x64 artifact name. Traversal, duplicate paths, links, additional scripts/executables and excessive extraction ratios are rejected. The installer is hashed again before handoff. Active tasks drain first; handoff blocks new runs and closes services and SQLite before Electron relaunches the installer. Failure/cancellation does not execute it. Hashes are not publisher signing or protection against a compromised release account/Windows user. SmartScreen and installer policy remain in force.

Local database migrations are permanent and transaction-based, with every historical step included. Future schemas fail closed, without downgrade or history wipe. Back up complete data before important upgrades. Migration tests are not formal NSIS installation/rollback certification.

Mingshen Harness 1.3.4 is a local desktop agent, not a certified
enterprise security product. An approval prompt is authorization, not proof that a
command or extension is harmless.

In-run guidance is ordinary user text bound to a specific active primary run.
It cannot change the provider, model, Agent mode, tool catalog, internet policy,
approval or isolation settings, and it does not execute slash-command or `@`
preprocessing. The current request and tool batch are not aborted. Pending updates
enter only a later model-request context, outside open tool call/result pairs;
failed, stopped or restarted runs do not silently dispatch them as new tasks.
Quick Chat accepts guidance IPC only for its own Chat session.

## Agent Modes (1.3.3)

- CodeAgent and WorkAgent share conversation history, drafts, attachments and a
  workspace. Switching is rejected while the conversation or its child tasks are
  busy, and applies to the next run. WorkAgent uses the same execution and approval
  engine as CodeAgent. A mode name does not grant additional filesystem rights.
  Custom profiles can apply to Code, Work or both; existing profiles default to both.
- ChatAgent has a separate conversation catalog and no workspace or custom agent
  profile. Its discovered tools and actual dispatch paths allow only `web_search`
  and `web_fetch`. It skips repository instructions, workspace memory, Skills,
  extensions, MCP discovery, hooks, commands, browser operations and subagents.
  A forged tool call is rejected even if a provider emits a tool absent from its
  advertised catalog. Shared providers and context compaction remain available.
- Chat uploads accept PNG/JPEG/WebP/GIF/BMP/TIFF/AVIF images, PDF, DOC/DOCX,
  XLS/XLSX and PPTX as bounded bytes, with exact encoded-size validation, a
  25 MiB per-file limit and raster signature checks that reject SVG or mismatched
  image payloads. Caller-supplied paths and pre-extracted content are discarded
  again at send and draft persistence boundaries. The trusted parser extracts only
  uploaded bytes; it does not expose arbitrary local-path read or modification
  tools. Legacy binary PPT is unsupported. Attachment content is untrusted and may
  be sent to the selected model or summary provider under the shared settings.
- CodeAgent and WorkAgent index installed, enabled Skills/plugins as metadata.
  Session-selected extensions are expanded first; other enabled items are
  searchable through `discover_capabilities`, and a relevant Skill can then be
  loaded by exact ID. Disabled extensions are excluded, and ChatAgent rejects
  discovery and loading at its dedicated policy boundary. Reading a Skill does
  not execute its scripts or authorize its instructions. MCP tools exposed by an
  enabled plugin still require their own server, approval and isolation checks.
  Retained large tool outputs are scoped to their conversation, with up to 40
  entries / 16 million UTF-16 characters per conversation. Individual captures
  retain a bounded head and tail with an explicit gap after 4 million characters;
  the omitted middle cannot be recovered. Conversation deletion removes its archive.
- Work Office creation and controlled editing use the normal profile, asset-read,
  approval, isolation, writer-lock, source-hash and conflict checks. Supported
  outputs use controlled per-file commit and failure recovery, not a multi-file
  transaction; the Windows rename steps retain a short non-atomic gap and may leave
  an explicit recovery backup if automatic recovery is unavailable.
  Unsupported macros, signatures, external connections and executable/complex
  Office parts are rejected where the controlled editor cannot preserve them.
  Package validation is not proof of lossless compatibility with arbitrary Office
  files, accurate formulas or correct visual layout.
- Optional Microsoft Office COM verification operates on isolated temporary copies
  only for a full-access host Work main session. It does not install Office, does
  not fall back to the host from protected or Docker sessions, and skips a file
  type when its Office application is already running. Macro automation is disabled.
  Timeout/cancellation cleanup targets a recorded exact Automation process identity,
  not every process with an Office executable name. COM and document parsers remain
  trusted host components. Unavailable, failed or incomplete recalculation/rendering
  must be reported; exporting a PDF does not establish visual approval.
- The existing run-start snapshot is supplemented by scoped file checkpoints for
  main-session full-access host file writes. Restore touches only recorded paths
  and first creates a safety checkpoint of that scope. Per-file, per-run byte and
  checkpoint-count budgets apply; reaching them is visible. Shell commands,
  external MCP side effects and other execution modes do not receive a universal
  per-file rollback guarantee. Snapshots can contain project data and are local
  application storage, not a substitute for independent backups.

## Workstations and Project Assistance (1.3.4)

- Creative templates and editable outlines do not execute tools. Sending a template
  to WorkAgent appends a draft; the user still sends the turn, and normal model,
  workspace, profile, approval, isolation and document-validation rules apply.
- Image Studio uses the user's selected image provider and a separately selected
  language/vision provider. Refinement sends the entered prompt; reverse prompting
  sends the explicitly selected image. Generated and imported image bytes are kept
  in the application's fixed asset store. Canvas metadata cannot select arbitrary
  filesystem write destinations. Imports, image dimensions, decoded pixels, layer
  counts, response bytes and GIF frames have separate bounds. PNG, JPEG, WebP and
  GIF assets must pass a bounded complete pixel decode; APNG is unsupported.
  Animated GIF/WebP validation checks every frame within the frame/pixel budget.
- Image requests use the configured OpenAI Images-compatible endpoint and accept
  Base64 output. URL-only image responses are rejected; model credentials are not
  forwarded to arbitrary image-download targets. Text-only application flows reject
  image-output-only model configurations. This separation does not establish that
  every third-party image gateway is compatible or trustworthy.
- AutoDrive uses the current conversation's model with an empty tool catalog and
  bounded, read-only project/history evidence. It proposes alternatives without
  writing files or sending a new execution turn. Selecting a proposal appends a
  draft. A worktree session must already have an established worktree; AutoDrive
  does not create it or fall back to the host checkout. Profile read policies are
  rechecked after evidence loading and before the model request. Repository text
  is untrusted input; it cannot grant permissions.
- Coordination creates ordinary bounded-concurrency child tasks with explicit
  scopes and profiles. Workers inherit the normal approval/isolation restrictions,
  cannot recursively delegate, and share the existing writer-lease rules. Worker
  completion, command verification and independent QA are separate states. A model
  QA verdict is an evidence-bearing review, not proof that all behavior is correct.
- Draft refinement advertises no tools, sends only the submitted text and project
  wording guidance, and requires preview acceptance before replacing the draft.
  A revision check rejects stale replacements. Temporary instructions apply to one
  accepted turn or queue item and cannot grant tools, file access or networking.
  Project tone is local workspace-scoped presentation guidance, not a permission.
- Command-palette file search is scoped to the selected Code/Work workspace.
  ChatAgent has no workspace-file result or local-command capability. Branch labels
  record session context and are not a mechanism for checking out branches. Local
  review reads bounded Git/session evidence, checks the diff version again before
  formatting comments and never sends a message automatically.

## User Interactive Shell (1.3.4)

Interactive terminal tabs are distinct from the Agent's `run_command` and retained
execution records. The user explicitly creates a tab in the main application
window. It requires a trusted project, a root CodeAgent/WorkAgent session, Full
Access, and host execution or an already created worktree. ChatAgent, Quick Chat,
SubAgents, Docker and patch-only sessions cannot create this host Shell. IPC binds
each terminal to its owning main-window WebContents and session.

The Shell runs as the current Windows user using ConPTY. Input is a direct user
action, not a model tool request, and does not show an Agent approval for each
keystroke. Full Access does not turn the Shell into a filesystem sandbox; entered
commands can affect locations accessible to that Windows user. Terminal tabs have
bounded retained output, dimensions and input chunks. Closing tabs, removing
sessions and application shutdown attempt bounded process cleanup; unconfirmed
cleanup retains a retryable record and must be reported rather than represented
as a successful process exit. Directory identity checks cannot eliminate every
check/spawn race. A Shell that exits independently may leave detached descendants;
this host terminal is not a process or filesystem isolation boundary.

## Local Plugin Interface (1.3.3)

- Native local plugins use `.mingshen-plugin/plugin.json`; imports also recognize
  `.codex-plugin/plugin.json`, `.zcode-plugin/plugin.json` and a legacy root
  `plugin.json`. Compatibility parsing does not emulate another host's private
  viewer, canvas, authentication or host APIs. New distributable plugins should use
  the native manifest and a focused Harness adapter Skill.
- Validation is bounded static inspection of manifest fields, declared and bundled
  Skills, Markdown command declarations, MCP declarations, hooks, relative paths,
  sizes and a content hash. It does not execute plugin scripts, start a declared MCP
  server or run a hook. SDK preflight is a separate file-and-path check and explicitly
  reports `authoritative:false`; the in-app validator is authoritative for host
  compatibility.
- A local market catalog and every plugin source must resolve inside the selected
  market root. Absolute sources, `..` escapes, linked roots and linked sources that
  escape the root are rejected. Catalogs are bounded to 1 MiB and 200 entries;
  plugins are bounded to 20,000 files and 64 MiB, with additional limits for
  manifests, Skill files and loaded text.
- Installing a validated market plugin copies its current source into application
  storage. It does not enable a remote synchronization path, continuously follow
  source edits or hot-reload a changed plugin. Updates keep the stable extension ID,
  conversation references and the user's enabled/disabled choice. A failed update
  preserves the previous installation; active tasks block installation and updates.
- The model-facing `local_plugin` tool is read-only and limited to `inspect`,
  `validate` and `list_markets`. It is available only to a main CodeAgent/WorkAgent
  conversation with a workspace, host Windows execution and no parent SubAgent, in
  either Request Approval or Full Access mode. ChatAgent, SubAgents, Docker and
  worktree sessions must use the UI. `inspect` and `validate` inherit `read_file`
  Profile rules, require an absolute real directory inside the workspace and reject
  link, traversal, protected Git and unsafe Windows path escapes. Request Approval
  additionally uses a path-scoped read decision after those checks; Full Access does
  not override a Profile deny or ask rule. `list_markets` only returns registered
  market metadata and does not scan a market directory. Inspecting or validating a
  plugin never installs it.
- `skill-creator`, `plugin-creator` and `harness-plugin-api` can generate and check
  source, marketplace entries and manual handoff instructions. Generated files are
  not evidence of installation, enablement or a successful trial. Lifecycle changes
  remain explicit user actions in Settings.
- Host plugin validation calls the Electron main-process validator directly. It does
  not require system Node.js, read the system PATH or launch the bundled SDK CLI as a
  subprocess. `resources/sdk/plugin-dev/` remains an optional developer preflight for
  users who choose to run it, reports `authoritative:false`, and cannot install,
  update or enable a plugin.
- Plugin content is untrusted input and cannot expand permissions. Installed commands,
  MCP servers and hooks still obey the active profile, approval, isolation, writer
  lease and network rules. A declared component that is disabled, unavailable or
  rejected must be reported as unavailable rather than simulated.
- Installing or enabling a plugin exposes capabilities for discovery; it does not
  activate hooks globally. Hook-capable plugins must also be explicitly referenced by
  the current CodeAgent/WorkAgent conversation. Action hooks then run only in a
  primary, non-read-only CodeAgent/WorkAgent session using host execution, Full Access
  and a trusted project. Request Approval, Docker, ChatAgent, actual SubAgents, child
  sessions and untrusted projects never execute those actions. MCP hooks additionally
  require an enabled/configured server and per-action approval; Shell hooks remain
  disabled by default and require project trust, the Shell setting and per-action
  approval when enabled.
- Declarative `UserPromptSubmit` prompts are injected only from currently referenced,
  enabled plugins as bounded, low-priority context, not system instructions; command
  and MCP actions in that event are not executed. `Interrupt` is a separate
  explicit-stop cleanup notification using an independent fire-and-forget signal
  capped at about 1.5 seconds. It permits only `prompt` activity text; Command/MCP
  actions are skipped without approval, process launch or tool recovery. It is not
  dispatched for ChatAgent, actual SubAgents, Request Approval, Docker, application
  shutdown or sessions without a selected enabled plugin. Static validation cannot
  prove that an enabled hook, command or MCP service is safe or correct.

## Quick Chat and Global Shortcuts (1.3.3)

- By default, `Ctrl+M` toggles Quick Chat: it opens the window when hidden and
  hides it when already visible. `Ctrl+Alt+L` toggles the main interface/tray.
  A titlebar pin persists the native always-on-top preference and can be toggled
  independently. Windows secure desktops, system dialogs and other topmost windows
  may still take precedence; the pin is not a security boundary.
  While Mingshen is running, `Ctrl+M` opens a dedicated ChatAgent window from
  another application. It uses a separate renderer surface and only receives
  runtime events and IPC operations for its current Chat conversation. A quick
  session is created with an empty workspace, the built-in primary profile,
  Request Approval, host execution and no patch-only mode. The normal Chat policy
  still limits it to `web_search`, `web_fetch` and read-only parsing of files the
  user deliberately uploads. The quick window cannot promote itself into Code or
  Work, read a local path, or use MCP, Skills, hooks, commands or subagents.
- Every activation inside the ten-minute lease reuses the same quick conversation
  and resets the lease to ten minutes. Once the lease expires, the next activation
  creates a new Chat conversation; the previous conversation remains in the local
  Chat catalog and is not silently deleted. Hiding or closing the window is not a
  destructive action and does not discard a draft. Both windows participate in
  normal draft flushing, interface reload and shutdown checks, but late events or
  IPC from the quick window are accepted only for its current Chat session.
- Both global shortcuts can be recorded and customized in Settings. Each
  combination must include at least one Ctrl, Shift or Alt modifier and one
  primary key, and the two shortcuts cannot conflict. Three- and four-part chords
  using combinations of Ctrl, Shift and Alt are supported; the default two-part
  `Ctrl+M` and `Ctrl+Alt+L` bindings remain valid. Saving registers the new bindings
  immediately. If a combination is occupied or registration fails, the application
  keeps the previous valid bindings, shows an error and allows the defaults to be
  restored. The shortcut handlers only delegate to the existing window controller
  and do not execute a model request, tool or permission change. Global shortcuts
  work only while the process remains running.

## Trust Boundaries

- The Electron main process is trusted and has current-user filesystem rights.
- The renderer uses context isolation, sandboxing, no Node integration, CSP, and IPC
  checks requiring the main application's top-level WebContents.
- Embedded pages must not receive the desktop IPC bridge, preload, or Node APIs.
- Model output, repository instructions, website content, and skills are untrusted
  input. They do not grant permission.
- Native Responses state is provider-issued opaque data stored with local messages,
  not application-readable raw hidden chain of thought or safeStorage credentials.
  Only bounded completed item shapes are retained; replay requires matching provider,
  model, endpoint and visible text/tool identities. Assistant phases preserve progress
  versus final output. Missing or unsupported gateway state is not invented.
  This is not a claim of provider compatibility or unlimited context.
- Gemini native GenerateContent Parts (including returned thought summaries,
  optional function-call IDs and signatures), Chat Completions message/tool signatures and DeepSeek Chat reasoning,
  Responses plain-text reasoning items and Anthropic thinking blocks are retained
  only when actually returned by the API and within validated shape, size and
  completion limits. DeepSeek's returned plain text is local conversation data,
  not encrypted credentials; opaque Gemini signatures are also separate from
  safeStorage encryption. The app does not request or reconstruct hidden reasoning
  absent from the response. Replay is scoped to the same provider configuration,
  model, protocol and endpoint, with matching visible text and ordered tool
  identities/arguments. Unknown, malformed or missing native state is not invented.
  Independent text summaries exclude `provider_state` and opaque signatures.
  Conversation exports and database copies should be reviewed before sharing.
- `view_image` reads approved workspace PNG/JPEG/WebP/GIF bytes through the existing
  path and native MXC/Docker gateways, bounded to 20 MiB. Image-bearing tool results
  remain local history and can reach the selected image-capable model. URLs/SVG are
  rejected; delivered pixels do not certify a model's visual interpretation.
- `browser_screenshot` saves the embedded browser's visible page as a local PNG
  and returns pixels in tool history for the next image-capable model request.
  Screenshots have separate limits of 2048 pixels on the longest edge and 8 MiB
  of PNG data. A model without configured image input receives an explicit notice
  instead of image bytes; a saved path does not prove the model inspected pixels.
- Context compaction sends historical messages, tool content and text attachments
  to the selected summary provider, which can differ from the conversation provider.
  Summaries are untrusted historical data, not new permissions. No execution tools
  are provided to the summary model; empty/tool-calling/nonshrinking results are
  rejected and partial summaries are not saved on cancellation. Original local
  messages remain intact. Redaction and summaries cannot guarantee full secrecy or
  retention of every important detail; verify provider authorization and results.
- Full Access intentionally permits powerful operations. Command pattern checks are
  safeguards, not a malware detector.
- Approval decisions clear only their exact request ID. The main-process broker
  publishes revisioned pending snapshots, and reload/focus reconciliation restores
  pending prompts. Session grants remain scoped to paths, command prefixes or MCP
  server IDs; they do not grant project Full Access.
- Windows question/conflict reminders route only to the exact pending request's
  conversation. Clicking consumes the temporary notification route, never supplies
  an answer, transfers a writer lease or changes permissions. Resolved/cancelled
  requests and ended runs invalidate their routes. Preview text is bounded and
  redacted; disabling previews hides session titles, question text and file paths.
  Windows notification history is local OS state, not a new cloud service.
- Automatic approval is explicit and off by default. A configured reviewer receives
  proposed operation data, not the entire conversation, with no executable tools.
  Invalid verdicts, timeout, provider errors or oversized arguments leave manual
  approval pending. Manual decisions/cancellation abort the reviewer; late verdicts
  cannot authorize a resolved operation. Model judgments are fallible. Sandboxing,
  Plan restrictions and catastrophic-command checks remain independent; shell hooks
  and explicit manual-only profile rules are not automatically approved.
- Explicit project Full Access is persisted by normalized workspace path and applies
  to ongoing, existing and future project conversations. No-workspace conversations
  change individually. This is deliberate user authorization, never a model tool.
- Protected file tools and commands default to Windows MXC through a pinned,
  hash-verified upstream Codex executor with a separate credential-free CODEX_HOME.
  Minimal system reads and workspace-only access are configured, command children
  inherit containment, networking is disabled and unavailable isolation fails closed.
  MXC needs recent Windows 11 builds; older systems can select Docker.
- Docker is selectable. Only the workspace is mounted; root is read-only,
  capabilities are dropped, resource limits apply, and protected commands have no
  container network or Docker socket. Native and Docker are alternative backends,
  both combined with approvals; they are not nested execution environments.
- The trusted broker, model requests, snapshots and user terminal are outside
  command containment. This is not an OS sandbox around the entire Electron app.
- PDF and legacy DOC parsing use bounded, cancellable workers with bundled parsers,
  native canvas and local Chinese/English OCR assets. A worker thread is not OS
  containment. Approved workspace bytes are read through MXC/Docker before the
  trusted parser runs; uploaded attachments already arrive as bytes. Macros and
  external document commands are not executed. Rasterization/page/text/time limits
  reduce resource exposure but do not certify every malformed-document parser safe.
  OCR is local; native PDF or rendered pages can be sent to the configured model.
- Document authoring accepts only bounded structured inputs. DOCX/PPTX are built with
  bundled Office Open XML authoring libraries; PDF is laid out by the local Chromium
  renderer. Images are read as approved workspace bytes, never fetched from URLs.
  Generated output is written through the normal approval, isolation, writer-lease and
  external-change gateways, with overwrite disabled unless the user explicitly requests
  it. Authoring libraries and Chromium are trusted application components, not an OS
  sandbox; malformed input, font substitution and renderer defects remain possible.
- External MCP, OAuth apps, browser runtimes, and plugins retain their own privileges.
  Local MCP processes are not automatically contained by Docker.
- Automatic, manually invoked and resumed child agents share an application-wide
  concurrency cap. Children inherit the parent's permission and isolation mode;
  read-only parents can delegate only to read-only profiles. Tool discovery and
  dispatch both reject recursive delegation. Stopping a parent cancels its running
  and queued children. A concurrency limit does not isolate shared file edits.
- GitHub Device Flow exposes only the short user code to the renderer. The private
  device code stays in the main process, tokens are encrypted, and cancellation
  aborts polling. Users confirm authorization on GitHub's HTTPS device page.
- The optional API binds only to 127.0.0.1, checks Host/Origin/Fetch Metadata and uses
  a random bearer token. Shares are separate expiring read-only capabilities. Port
  forwarding and hostile same-user processes are outside this isolation boundary.
- There is no hosted tenant/account service. External account takeover and tenant
  authorization belong to the external service's own threat model.

## 1.3.4 Reliability Hardening

- DeepSeek `execute_tool_chain` keeps its expanded steps for local history and UI
  inspection, but folds them into the original chain-root result for DeepSeek Chat
  continuation. Provider-returned native state remains authoritative; synthetic
  call/result pairs are not sent as independent model history.
- Native Memory summaries use a bounded recovery budget and a shared cancellation
  deadline. If Memory is disabled, its backend changes, the request is cancelled,
  or the queued write times out, the summary is discarded. The final atomic replace
  checks the active backend and cancellation state again before committing.
- Native Sandbox termination has bounded task-tree and close waits. An unconfirmed
  cleanup writes a typed tombstone and retains the workspace barrier and leases;
  read-only recovery inspection cannot execute commands, write files or clear the
  tombstone. Explicit user confirmation is required after current evidence is
  checked. Tombstones have no TTL within the current process; the separate
  workspace barrier and recovery settings persist across restarts.
- Guarded workspace I/O fixes ancestor handles, rejects junctions, reparse points
  and NTFS hard links, and writes through a same-directory temporary file with
  flush and SHA-256 checks before a guarded commit. The commit keeps a same-directory
  backup for failure recovery; its Windows rename steps are not presented as a
  gap-free atomic swap. Git and snapshot restore use the guarded path instead of a
  later raw path write. Multi-file restore remains recoverable but is not a database
  transaction.
- Shutdown uses settled cleanup for every service. A failure in one stop step does
  not skip Guarded I/O, plugin cleanup or database close; all failures are recorded
  and surfaced together. Interrupted recovery rechecks evidence, barriers, active
  writers and leases before releasing any command or file ownership.
- Chat Completions accepts only a provider-issued non-empty `finish_reason` as a
  successful terminal state. Receiving `[DONE]` alone is treated as a retryable
  incomplete response, and tools from that stream are not executed.
- A workspace OpenCode/Mingshen JSON configuration is synchronized only after that
  project is trusted, and project-origin Markdown Agents are ignored before trust.
  Its `{file:...}` prompt references use guarded workspace reads and cannot follow
  links or resolve outside the workspace. A project `build` produces a separate
  project Profile instead of replacing the built-in `primary`; removing trust also
  removes the corresponding project-origin Profile. LSP requests resolve through
  the same workspace boundary, so an absolute or relative path cannot select an
  out-of-workspace source file.
- Attachment batches are limited to at most 10 files, 25 MiB per file and 50 MiB
  total. The renderer checks count and declared sizes before file reads and IPC, and
  the main process checks both declarations and encoded bytes again before parsing.
  DOCX/XLSX/XLS/PPTX/ODT/PDF extraction runs in a worker pool
  with two concurrent workers, bounded resource use, a 180-second deadline and
  cancellation. ZIPs reject traversal, absolute/ADS/NUL paths, duplicate entries,
  Unix symlinks and unsafe XML declarations. PPTX requires a presentation part and
  at least one slide; spreadsheet extraction has sheet/row/column/cell/text limits.
- Office structured editing uses a request-wide 100,000-cell work budget, rejects
  active/external formulas and preserves only explicitly supported package parts.
  Host document replacement is a guarded commit rather than a gap-free atomic swap:
  the old target handle is locked, its hash is checked, the old target is renamed to
  a same-directory backup, the new temporary file is installed and the requested
  path is reopened for identity/size/hash verification. Normal abort or timeout
  attempts `recover-write`; during application shutdown the worker is deliberately
  unavailable, so automatic recovery is not claimed and the error retains the backup
  path. A short gap remains between the two renames, and abrupt power loss or
  processes bypassing the protected handle are outside the guaranteed recovery
  boundary. Embedded workbooks are
  scanned before decompression and share a maximum of 64 archives, 4,000 entries,
  100 MiB declared uncompressed data and four recursion levels.
  DOCX controlled editing rejects external non-hyperlink relationships, attached
  templates, subdocuments, OLE/ActiveX packages, `altChunk` and active field types;
  generated PNG/JPEG assets are structurally validated before package creation.
- Verification has separate authoritative states for the overall result, rendering
  and recalculation. `verified`, `partial`, `unavailable` and `failed` are not
  interchangeable; a tool result carrying a non-verified Office state is an error.
  More than 2,000 inspected spreadsheet cells makes formula inspection `partial`.
  Exporting or opening a document is not page-by-page visual approval, and no Office
  application is installed or reused when unavailable.
- Full-access host command cancellation now settles even when process-tree cleanup
  rejects or the child never emits `close`. An unconfirmed cleanup retains the run
  tombstone, writer barrier and lease rather than pretending the process stopped.
  Startup failure performs bounded cleanup and exits before the single-instance lock
  can leave a windowless process alive.
- MCP credential edits preserve existing secrets only for keys still declared by
  the server, delete values for removed declarations and reject undeclared secret
  input. OAuth token POST requests refuse redirects so authorization codes, refresh
  tokens and client secrets are not forwarded to another origin. Embedded browser
  `file:` preview requires a per-session workspace-bound approval token; arbitrary
  `file:` URLs are not globally allowed. Headless session creation uses the same
  model/profile/workspace validation as the normal session service.
- ACP prompt requests settle on `run_completed`, `run_failed` and `run_interrupted`,
  reject a concurrent prompt for the same session and cannot overwrite a newer
  pending run. `session/cancel` has a bounded abort request; an HTTP error, network
  failure or timeout rejects the active prompt as “remote stop is not confirmed”
  and clears the local waiter instead of reporting a false cancellation. The
  experimental launcher verifies the pinned native sandbox on each run and builds
  the current source before launch. Plugin SDK marketplace updates
  use an in-process queue, a cross-process lock, a random same-directory temporary
  file, rename and read-back verification. Normal writers wait at most 15 seconds.
  A lock older than 60 seconds is never removed automatically by mtime; the SDK
  reports the lock path and leaves the catalog unchanged. Recovery requires
  confirming no writer is active and manually deleting only the lock file. This
  prevents concurrent read-modify-write loss and release races with automatic stale
  cleanup and reduces partial-write exposure, but is not an `fsync` durability
  guarantee.

## ChatAgent Internet Control

- Each ChatAgent conversation has a persisted `Allow internet` / `Block internet`
  setting. Existing conversations default to allowed for compatibility. The setting
  is locked while a send is being prepared, a task is running, or an approval is
  pending; the main process rechecks this state before accepting a change.
- When allowed, ChatAgent may use only `web_search` and `web_fetch`. These tools do
  not request per-call approval, but webpage fetch still enforces HTTP(S), public
  destination and response limits. When blocked, both tools are omitted from the
  model request and are rejected again by the main process if a forged or stale
  call reaches execution.
- A fork, grouped conversation created from an existing Chat, or renewed Quick Chat
  preserves a source conversation's blocked setting. A Chat without a source
  conversation defaults to allowed.
- This is a control on ChatAgent's web-search and webpage-fetch tools, not a network
  sandbox or application-wide offline mode. It does not block the configured model
  provider connection, application update checks, or network use needed to submit
  user-uploaded attachments to that provider. Users who require offline processing
  must use an appropriately configured local model and control other application
  network paths separately.

## Workbench Boundaries

- Controlled tool chains contain 2–8 static, already-decided local actions. Every
  action still uses the normal schema, profile, approval, isolation, writer lease,
  plan-revision, diagnostic and checkpoint gateways. A failed action, false literal
  guard, denial, cancellation or changed plan stops the remaining chain. Chains
  consume the existing tool budget and are not cross-task replay caches or a way
  to run arbitrary generated control-flow code.
- When the configured model permits parallel tool calls, adjacent independent
  built-in reads may run in batches of at most three. Each call retains schema,
  permission, approval, containment and budget checks. Commands, writes, chain
  steps, browser/MCP operations and custom tools are excluded.
  Paged reads retain full-source hashes and external-change checks.
- Managed command sessions use pipes, not a PTY. IDs are bound to their originating
  conversation/run and security scope. Polling cannot access another run's session;
  input is checked under current policy. Run cleanup stops still-managed processes
  and awaits close/container cleanup before releasing coordination leases.
  Unconfirmed cleanup retains both the workspace write barrier and the lease.
  A later termination request or run cleanup can clear a previous command cleanup
  error when termination is confirmed; an ordinary output poll does not retry it.
  Native Sandbox tombstones require current evidence and explicit user
  confirmation. Clearing a barrier by itself does not establish that a process
  or container has stopped.
  A full-access host command can deliberately detach descendants and exit its
  original parent; Node handles/task-tree termination do not guarantee tracking
  every detached daemon. TTY-only programs and OS-wide process containment are
  not provided by a pipe session.
- Writable managed children may queue at most six project checks. Queuing is not
  execution or approval. `wait_subagents` collects the requests; only after all
  tool results from that model turn are saved does the parent run checks
  sequentially through its own profile, plan, approval, containment and writer
  leases. Checks produce separate tool results, preserving Chat/Anthropic call
  and result pairing. Read-only child profiles cannot request this relay, and child shells
  retain their read-only workspace. Failed, denied or unexecuted checks are not passes.
- A project has exactly one active memory backend: Native Memory in
  `.harness-memory/` or the TencentDB local L1 preset in
  `.harness-tencent-memory/records.jsonl`. Existing projects retain native memory;
  conversations, forks, actual children and associated worktrees inherit the selection.
  Settings can explicitly select or switch the backend for a workspace, retaining
  both directories without deletion, renaming, merging or migration. Only the
  selected backend is read. Ambiguous legacy directories or conflicting saved
  configuration still fail visibly until an explicit selection is saved.
  Child/worktree settings resolve to the top-level owner's workspace. Changes
  require affected conversations, children and memory maintenance to be idle.
  Selected-path and initialization failures are visible. Memory
  is ordinary workspace text, not a credential store or trusted system instruction.
  Only bounded preferences are preloaded and historical entries are retrieved in
  bounded slices. Native Memory may request a successful-task summary from the
  current model, with a 30-second deadline. If Memory is disabled, the backend is
  changed, the request is cancelled or the write waits past its deadline, the
  summary is discarded. The final atomic replace checks the active backend and
  cancellation signal again. TencentDB semantic analysis sends
  necessary conversation text and candidate memories to its configured analysis
  provider. The per-workspace primary defaults to the current primary conversation
  model; an optional fallback can introduce another data recipient and API usage.
  A failed call or invalid result restarts the entire extraction/conflict operation
  with the fallback. Valid empty results do not trigger fallback. Inferred
  preferences saved through main-chat memory tools and model-initiated deletion
  require confirmation; independent analysis can create automatic records.
  Recognizable secrets are redacted, but neither
  redaction nor model-generated memories guarantee secrecy or accuracy. Git,
  synchronization and backups may include memory; review before publication.
- The pinned TencentDB v2.0.3 source subset provides generic conversation extraction
  prompts, quality filtering, conflict deduplication, the L1 writer and SQLite
  full-text retrieval.
  Runtime prompt adapters omit Tencent work/team prompts. The preset excludes
  Tencent/OpenClaw business adapters and runtime, cloud/team services,
  telemetry, L0 transcript capture, the full L0–L3 pipeline and vector/embedding
  APIs. A host model runner uses pinned upstream generic conversation prompts for
  structured extraction and `store/skip/update/merge` decisions. Results have strict
  type, size, source-ID and target-ID checks, with no raw-answer excerpt fallback.
  Analysis records may be `persona`, `episodic` or `instruction`; confirmed preference
  records remain immutable to automatic updates and merges, while automatic
  analysis records may change. No Tencent account, Tencent service or OpenClaw
  runtime is required, but the selected model provider and credentials are used.
  This is an embedded L1 preset, not the full upstream product or a guarantee of
  semantic quality. Normal chat still sends selected preferences and retrieved
  excerpts to its configured model. Host-committed atomic
  JSONL snapshots are authoritative, bounded to 2000 records / 2 MiB. Upstream
  product-storage fallback is disabled; the host supplies snapshot storage.
  The disposable FTS index is rebuilt in memory through Node's built-in SQLite,
  without loading optional external vector extensions. There is no persisted
  index database or automatic archive. Analysis and decisions remain in memory
  until the entire operation validates. Invalid results, cancellation, disabled or
  changed configuration and failed revision checks do not replace committed data.
  The settings editor protects existing record IDs/types; content changes and
  deletion are explicit, and new records use memory commands/tools.
- Actual child sessions cannot use memory writes or edit the directory through
  built-in file tools. Their commands require MXC or Docker with the whole workspace
  read-only, including when memory directories do not yet exist. Approved managed
  file tools may still modify ordinary project files, excluding memory directories.
  Primary-session command policy remains unchanged. Host custom tools, hooks, LSP
  execution and stdio MCP are unavailable to children.
  Remote MCP tools declared read-only remain trusted third-party services, not an
  OS-enforced guarantee. Direct external editors and malicious same-user processes
  are outside the memory broker's boundary. Atomic per-file replacement, in-process
  serialization and revision checks reduce accidental overwrites, not cross-process
  malicious link/rename races.
- Local code indexing uses bundled TypeScript and ast-grep/tree-sitter parsers, never a module loaded
  from the project. Protected enumeration/reads still use the selected isolation
  backend after workspace approval. Persisted symbols/imports and bounded scans
  include JS/TS, Python, Go, Rust, Java, C/C++ and C# syntax candidates, not a complete or authoritative semantic call graph. Native grammar packages are production dependencies and unpacked from ASAR.
- File-result deduplication verifies content through the approved read gateway.
  Approval occurs before cache use; cache references are scoped to the session,
  run and compaction boundary. Concurrent approved reads may share one actual read.
  Literal runtime version probes can skip repeated commands briefly; strict literal
  PowerShell read/list/exists commands verify structured dependencies first. Tests,
  builds, installs and mutations are not cached.
- Similar-operation approval is an in-memory grant for this conversation and
  workspace/read-write category or simple literal command prefix. Manual-only
  policies, hooks and destructive operations are excluded. It does not change
  permission mode or survive restart.
- Writer leases coordinate built-in tools, command execution, writable MCP, host
  custom tools/metadata and plugin hooks. Conflict
  transfer requires a human decision, cancellation and termination of the old
  task, then an enforced fresh file read or directory inspection. Built-in writes
  detect changed content since the run's last read. Leases do not stop external
  editors or arbitrary processes, nor constrain extensions to workspace paths.
  Workers/custom host code are trusted Full Access extensions, not OS containment;
  worker termination does not undo child processes or remote operations.
  Uncertain extension transport/cleanup outcomes persist a workspace write barrier.
  Cancellation notifications are best effort; remote MCP may keep executing.
  Confirm server-side termination and inspect effects before human recovery approval.
- Verification commands execute project code through the normal command gateway,
  including approvals, profile rules and isolation. They may fail because of the
  environment; failures and unconfigured checks must not be reported as passing.
- Plans/checkpoints and the independent project plan library are local state. Revisions prevent concurrent plan overwrites,
  and dependency validation rejects cycles. Resume does not replay unfinished
  tools automatically; confirmed fingerprints are blocked on recovery and uncertain
  effects block new mutations until successful read evidence and human confirmation.
  The workspace recovery barriers persist through retries/restarts. Native Sandbox
  tombstones themselves are scoped to the current process. No exactly-once
  guarantee exists for arbitrary commands or remote services.

## Safe Operation

Provider prompt caching defaults to recognized official endpoints only; compatible
gateways require explicit capability selection. Cache hints do not bypass any
authorization. Same-model compaction reuses bounded in-memory text snapshots only
after configuration, source-history, tool-boundary, redaction and window checks.
Tools remain in the request for prefix stability but selection is disabled, and
any returned tool call rejects the summary. Incompatible input retains the
independent segmented summary path. Cache diagnostics persist only bounded
process-keyed digests and safe comparisons, not request bodies, paths or keys;
the random key is not persisted and a restart creates a new baseline.

Provider creation/editing can explicitly select OpenAI, Claude, Gemini or DeepSeek
families for confirmed compatible gateways. Automatic detection matches exact
official endpoints and protocols rather than model/provider names. Unknown
gateways require explicit selection and native-field forwarding. Automatic Gemini
and DeepSeek adaptation uses implicit prefix reuse without foreign cache hints
or billable explicit-cache resource creation. Family selection never translates
protocols or changes authorization. Missing cache usage remains unknown; an
explicit zero is a zero hit, and no hit-rate or per-model eligibility guarantee is
implied. See [provider caching notes](docs/PROVIDER_CACHING.md).
Independent compactors can append at most eight immutable summary segments,
whose combined estimated budget is 15% of the current main model's context
window, reserving room for the new summary and a safety margin. Limits or newly
recognized credentials require a redacted merged baseline. Total generation is
constrained by that 15% limit, the compactor's configured `maxOutputTokens` and
its usable context. Smaller compactor windows reserve space for historical input
and rolling summaries, which can lower the allowance further; actual request
input and a safety margin tighten it again before sending. Reasoning and visible
text share this allowance. Prompts state both the summary limit and the current
summary-body target, reserving space for reasoning. Output exhaustion requests a
shorter summary and a smaller history fragment, with at most four
bounded recovery attempts per compactor. Cancellation, oversized responses and
failures preserve original messages and the previous complete checkpoint;
truncated or partial summaries are not adopted. Latest chronological progress
supersedes stale progress, never user constraints or host permission checks.
Main and compactor caches remain separate. Claude's immutable-summary boundary
shares the existing four-marker budget.

Token Saver reduces request copies, not stored conversation history. Core safety,
project and user instructions remain present; recent turns, tool arguments and
call/result pairing are protected. Optional lossy excerpts are disabled by default
and require an available original-text recall tool. Recall is limited to the
current conversation, including local copies of inherited citations in forks;
it cannot read another conversation or arbitrary workspace files. Summarization
uses the existing configured primary/backup models and retains originals on
failure. Neither compression nor estimated savings certifies model accuracy.
New or missing settings disable early turn-count summaries and select Auto response
guidance, without overwriting explicit choices or disabling the 85% context safeguard.
Native-state and image-result messages keep exact visible content; their source
fingerprints include scope and content hashes rather than copying opaque/image
payloads into replacement ledgers. Proactive-summary thresholds count visible
text and bounded media metadata, not base64/encrypted bytes as ordinary text.
Text-only compaction snapshots exclude image-bearing tool results; independent
text summaries omit image pixels and opaque state.

Optional backup reviewers and summary models are user-configured external data
recipients. Only a failed call or invalid result triggers one backup attempt;
a valid denial is final. Both failures retain human review or original context.
Fixed JSON verdicts accept one explicit allow/deny and a reason, rejecting duplicate
keys and conflicting fields. Errors retain bounded redacted output. Stopping or
manual approval cancels the review chain; a partial verdict or summary is never
adopted. The backup summary restarts from original history and the last valid
checkpoint. These measures do not certify a model's judgment or prevent all prompt
injection; operation data remains untrusted.

Use least-privileged tokens. Review commands, outgoing data, and diffs. Back up work.
Do not trust unknown extensions. Container/VM isolation is advisable for untrusted
code; no container should be described as impossible to escape.

Runtime downloads use official endpoints and integrity checks. Embiody's EULA does
not permit bundling without authorization. Docker Desktop has separate licensing
and Windows prerequisite requirements.

Packaging preflight checks the current source inventory (13,865 resources and
production dependencies in the 1.3.4 preflight). TencentDB source/runtime/license
hashes, complete MIT text and the emitted ESM dependency closure are checked before
packaging and in afterPack. Missing or inconsistent files fail the check. These
checks establish consistency with the pinned inventory, not publisher authenticity
or a security audit of every upstream algorithm.

## Reporting

Before public release, enable GitHub private vulnerability reporting or publish an
effective private contact. Do not publish credentials, cookies, private files, or
conversation dumps. Include version, reproducible steps, expected boundary, and a
harmless minimal proof. Do not test unrelated third-party infrastructure.

## Validation Limits

Regression tests, dependency audits, local API probes, renderer checks and Docker
probes reduce risk. They cannot prove absence of RCE, sandbox escape, escalation,
SSRF, XSS, or leakage. Use the version-specific validation report. No independent
penetration test, packaged-app review, or certification is implied.

The six-task evaluation baseline defaults to synthetic grading fixtures without a
model call. Explicit live mode uses an independently configured evaluation profile
and the existing authenticated loopback API, never provider keys or the user database.
Current API metadata cannot prove provider-internal routing, wire replay or Token
Saver settings. Missing telemetry is unobserved rather than a pass; available main
session usage is not full billing. Synthetic results are not model-quality or paid
A/B certification.
