# Mingshen Harness Local SDK

```js
import { MingshenClient } from "./mingshen-client.mjs";

const client = new MingshenClient({
  baseUrl: "http://127.0.0.1:4096",
  token: "<token shown in Mingshen Settings>",
});

await client.health();
const sessions = await client.sessions();
```

The server binds to loopback by default. It exposes health, agents, sessions,
messages, child sessions, todos, trajectories, MCP/LSP/formatter status and SSE
events. Share links are local read-only URLs and expire after 24 hours.

## Runtime v1

The versioned `/v1` API is the recovery-safe interface for new integrations. It
keeps the loopback and Bearer-token boundary, adds persisted runtime runs,
idempotent turn admission and replayable events.

The API and every model, tool, extension or Office action it can reach remain
subject to the effective managed policy. Machine and application policy can only
tighten built-in safety, mode, project and isolation boundaries. If
`%ProgramData%\MingshenHarness\managed-policy.json` exists but is invalid, new
dispatch pauses while an exact-run stop and existing diagnostics remain available.
Authenticated reads of existing history, session snapshots, runs and effective
policy remain available for diagnosis; they do not authorize mutations, claims
or Office checks.

```js
const accepted = await client.createTurn(sessionId, "Inspect the current project.");
const run = await client.run(accepted.runId);
const snapshot = await client.snapshot(sessionId);

for await (const envelope of client.runtimeEvents({
  after: snapshot.eventCursor,
  sessionId,
  signal: abortController.signal,
})) {
  console.log(envelope.event);
}
```

Send every turn with a unique `Idempotency-Key`; reuse the same key only when
retrying the same request body. A reused key returns the original run, while the
same key with different content is rejected. The SDK's `runtimeEvents` method
reconnects from the last received persistent event id; text and reasoning deltas
have no SSE `id` and do not advance that cursor. A restart rotates the local API
token, so clients must obtain the current token again. An expired server-side
cursor throws `MingshenCursorExpiredError`; fetch a new session snapshot before
continuing. Token deltas are live only. The persisted assistant/tool message and
session snapshot are authoritative after reconnect, including final
`responses_state`, `provider_state`, tool-result outcome/evidence and large-output
recovery references. Use the snapshot transcript instead of reconstructing a
completed turn from transient deltas. An exact-run cancellation returns HTTP 202
when the stop request is accepted, not when the run is stopped; keep observing
that run until it reaches a terminal state.

`GET /v1/capabilities` and `GET /v1/policy/effective` expose the available host
services and the effective non-secret policy. Task claims and office receipt
operations are available only when the desktop integration has configured their
handlers and managed policy permits `developer.api`. A run keeps its admission
`policyRevision` unchanged while `lastPolicyDenial` stores the latest bounded
`revision`, `code`, `reason`, `scope`, `sources` and timestamp. That latest denial
remains on the run and in snapshots after replay events are pruned.

`GET|POST /v1/tasks/claims` uses the canonical session plan as its source of
truth. Query with `sessionId` and optional `includeTerminal=true`, or with
`claimId`. POST actions are `claim`, `heartbeat`, `settle` and `recover`:

```json
{
  "action": "claim",
  "sessionId": "<plan session>",
  "runId": "<authorized run>",
  "ownerSessionId": "<executing session>",
  "stepId": "<plan step>",
  "revision": 1
}
```

`claim` atomically reserves one plan-step revision for the exact owner. A
`heartbeat` renews only the supplied `claimId` and `ownerRunId`, and advances
the claim version. Direct external `settle` accepts only `completed` or
`released`, and requires the caller-read claim version as a positive safe
integer `expectedVersion`; omitting it or sending a malformed value returns
`400 PLAN_CLAIM_INVALID`. A heartbeat or another mutation makes an older value
stale and returns `409 PLAN_CLAIM_CLAIM_VERSION_CONFLICT`. Settlement also
requires the claim to be active and leased, the exact owner run to remain live,
and no tool, command, cleanup, file lease, execution-safety or workspace-write
barrier to remain. Internal automatic settlement may omit the field for legacy
compatibility; the external API may not.
`stale` and `cancel_requested` claims must use `recover`; owner mismatch, stale
generation and duplicate active claims fail explicitly rather than silently
replacing the current owner. `recover` requires `sessionId`, `claimId`, an
integer `expectedVersion` and a factual `summary`. The host internally confirms
that the exact owner run is stopped. If uncertainty remains, every effect needs
a distinct successful read-only inspection call completed after the final
uncertain effect; `inspectionCallIds` supplies those real call IDs as evidence.
Recovery does not reassign or replay the write.

`GET|POST /v1/office/receipts` lists receipts with `sessionId` and optional
`limit`, or inspects one with `deliveryId`. External POST actions are only
`prepare` and `check`; both use the same unarchived main CodeAgent/WorkAgent,
host, Full Access and workspace-governed ChatService closure as the in-app host
workflow, with stage-by-stage policy and mandatory-delivery checks. `prepare`
accepts only a relative path that resolves inside the declared session
workspace; absolute paths, traversal and symlink escapes are rejected. The host
binds receipts to the final file hash, reports unverified checks separately, and
invalidates a receipt after that file changes. External `visual-batch` and
`record-visual` calls are rejected with
`OFFICE_EXTERNAL_VISUAL_EVIDENCE_UNTRUSTED`; clients cannot submit untrusted
pages or mark host verification complete. Use `check` so MingshenHarness
performs its own bounded render and vision inspection. The desktop task
workbench retains its separate internal visual-continuation path. No secret or
arbitrary local-path read endpoint is introduced.

## Local CLI

The CLI attaches to an already running desktop or tray process. It does not
start a server or keep an independent background service.

```powershell
$env:MINGSHEN_SERVER_URL="http://127.0.0.1:4096"
$env:MINGSHEN_SERVER_TOKEN="<current token from Settings>"
node "<Mingshen install directory>\resources\sdk\mingshen-cli.mjs" capabilities
node "...\mingshen-cli.mjs" prompt <session-id> "Inspect the project"
node "...\mingshen-cli.mjs" watch <run-id> --events
```

`mingshen-cli health|capabilities|sessions|session|snapshot|new|prompt|run|watch|cancel|policy|claims|claim|heartbeat|settle|recover|receipts|receipt`
prints readable text by default. Add `--json` for a JSON document or `--ndjson`
for newline-delimited event/result output. The CLI requires Node.js 24 or newer,
the same major runtime version used by the project. If the desktop process is not
running or the token is stale, it fails explicitly rather than launching another
service.

The packaged SDK and CLI have been exercised against a real temporary
HeadlessServerService/Runtime/SQLite loopback process: capabilities, two admitted
turns, run lookup, exact first-run stop while preserving the second, completed
snapshot, token rotation after restart, typed SDK authentication failure, CLI
authentication exit code 1, and single-line NDJSON output for
`capabilities`/`snapshot`/`run`. That fixture uses an `admitTurn` ChatService
contract stub, so it does not cover a real model request or complete chat loop.

```powershell
node "...\mingshen-cli.mjs" claims sessionId=<session-id> includeTerminal=true
node "...\mingshen-cli.mjs" claim '{"sessionId":"...","runId":"...","stepId":"...","revision":1}'
node "...\mingshen-cli.mjs" heartbeat <claim-id> <owner-run-id>
node "...\mingshen-cli.mjs" settle '{"claimId":"...","ownerRunId":"...","status":"completed","expectedVersion":7,"summary":"Done"}'
node "...\mingshen-cli.mjs" receipts sessionId=<session-id>
node "...\mingshen-cli.mjs" receipt '{"action":"check","deliveryId":"..."}'
```

`POST /session` only creates a new root session. A non-empty `parentSessionId`
or `forkedFromMessageId` is rejected with HTTP 400. Use
`POST /session/{id}/fork` to branch an existing session; the local API does not
create child Agent sessions.

## ACP bridge

Start the local server from `Settings > Runtime & Integrations`, copy its token,
then configure an ACP-compatible editor to launch:

```powershell
$env:MINGSHEN_SERVER_URL="http://127.0.0.1:4096"
$env:MINGSHEN_SERVER_TOKEN="<token shown in Settings>"
node "<Mingshen install directory>\resources\sdk\mingshen-acp.mjs"
```

The bridge uses JSON-RPC over newline-delimited stdio and maps Mingshen chat,
reasoning, tool and completion events into ACP `session/update` notifications.
It resumes `/v1/events` with the persisted `after` query cursor (the server also
supports `Last-Event-ID` for other clients), queries the exact run after a
prompt response, and fetches a fresh snapshot when the server reports an expired
cursor. The bridge advances its cursor for every persisted global event before
filtering it to sessions created by that ACP process; irrelevant session events
therefore still move the restart position, while nondurable deltas do not.
`session_added` handling is ownership-bounded and cannot adopt an external
session ID. Each session accepts one active prompt. `session/cancel` targets the
exact run id, with a bounded timeout of 10 seconds by default;
`MINGSHEN_ABORT_TIMEOUT_MS` may set an override from 50 to 60000 milliseconds.
An HTTP error, network failure or timeout rejects the active prompt with an
explicit "remote stop is not confirmed" error. The bridge advertises only the
permission modes returned by `/v1/capabilities`; it never promotes a session to
`full_access` merely because an ACP client requests it.
