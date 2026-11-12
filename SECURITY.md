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

Mingshen Harness 1.3.2 is a local desktop agent, not a certified
enterprise security product. An approval prompt is authorization, not proof that a
command or extension is harmless.

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
  Failed cleanup is not automatically retried for a closed handle, so recovery
  may require restarting the application; clearing a barrier does not establish
  that a process or container has stopped.
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
  current model, with a 30-second deadline. TencentDB semantic analysis sends
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
  These barriers persist through retries/restarts. No exactly-once
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

Packaging preflight checks 33 required resources. TencentDB source/runtime/license
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
