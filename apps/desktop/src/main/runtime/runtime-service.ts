import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ChatStreamEvent, MessagePart } from "../../shared/domain";
import type { ManagedPolicySource } from "../../shared/managed-policy";
import {
  RUNTIME_TERMINAL_STATUSES,
  type RuntimeAdmitTurnInput,
  type RuntimeCapabilities,
  type RuntimeControlEvent,
  type RuntimeEventEnvelope,
  type RuntimeEventPage,
  type RuntimePolicyDenial,
  type RuntimePolicyDenialInput,
  type RuntimeRunStatus,
  type RuntimeRunView,
  type RuntimeSessionSnapshot,
  type RuntimeTurnAcceptance,
} from "../../shared/runtime";
import { recordRuntimeError } from "../diagnostics/runtime-log";
import type { Repository } from "../storage/repository";

type RuntimeDatabaseRow = Record<string, unknown>;

const DEFAULT_EVENT_RETENTION_DAYS = 30;
const DEFAULT_EVENT_RETENTION_BYTES = 256 * 1024 * 1024;
const DEFAULT_EVENT_PAGE_SIZE = 500;
const MAX_EVENT_PAGE_SIZE = 2_000;
const MAX_EVENT_PAYLOAD_CHARS = 1024 * 1024;
const TRANSIENT_EVENT_LIMIT = 2_048;
const CLEANUP_INTERVAL = 100;
const MAX_POLICY_DENIAL_SOURCES = 16;
const MAX_POLICY_DENIAL_REVISION_CHARS = 240;
const MAX_POLICY_DENIAL_CODE_CHARS = 120;
const MAX_POLICY_DENIAL_REASON_CHARS = 4_096;
const MAX_POLICY_DENIAL_SCOPE_CHARS = 240;
const MAX_POLICY_SOURCE_REASON_CHARS = 1_024;
const MAX_POLICY_SOURCE_PATH_CHARS = 1_024;

export const MIGRATION_RUNTIME_V11 = `
  create table runtime_runs (
    id text primary key,
    session_id text not null references sessions(id) on delete cascade,
    status text not null check (
      status in (
        'accepted', 'preparing', 'running', 'waiting_approval',
        'waiting_user', 'completed', 'failed', 'interrupted', 'blocked_policy'
      )
    ),
    source text not null,
    created_at text not null,
    started_at text,
    updated_at text not null,
    completed_at text,
    terminal_reason text,
    policy_revision text not null default '',
    policy_denial_json text not null default 'null',
    delegated_run_id text,
    next_seq integer not null default 0,
    last_event_id integer not null default 0
  );

  create index runtime_runs_session_idx
    on runtime_runs(session_id, updated_at desc);
  create index runtime_runs_status_idx
    on runtime_runs(status, updated_at);

  create table runtime_events (
    event_id integer primary key autoincrement,
    session_id text references sessions(id) on delete cascade,
    run_id text references runtime_runs(id) on delete cascade,
    seq integer not null,
    type text not null,
    payload_json text not null,
    byte_size integer not null,
    created_at text not null
  );

  create index runtime_events_session_idx
    on runtime_events(session_id, event_id);
  create index runtime_events_run_idx
    on runtime_events(run_id, seq);
  create index runtime_events_created_idx
    on runtime_events(created_at);

  create table accepted_turns (
    id text primary key,
    session_id text not null references sessions(id) on delete cascade,
    run_id text not null unique references runtime_runs(id) on delete cascade,
    idempotency_key text not null,
    request_hash text not null,
    source text not null,
    created_at text not null,
    updated_at text not null,
    unique(session_id, idempotency_key)
  );

  create index accepted_turns_session_idx
    on accepted_turns(session_id, created_at desc);
`;

export class RuntimeIdempotencyConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "IDEMPOTENCY_CONFLICT";

  constructor() {
    super("The idempotency key was already used with a different request.");
    this.name = "RuntimeIdempotencyConflictError";
  }
}

export class RuntimeValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "RUNTIME_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "RuntimeValidationError";
  }
}

export class RuntimeCursorExpiredError extends Error {
  readonly statusCode = 410;
  readonly code = "CURSOR_EXPIRED";

  constructor(
    readonly requestedCursor: number,
    readonly earliestCursor: number,
  ) {
    super("The requested event cursor has expired; fetch a new session snapshot.");
    this.name = "RuntimeCursorExpiredError";
  }
}

export class RuntimeNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "RUNTIME_NOT_FOUND";

  constructor(resource: string) {
    super(`${resource} was not found.`);
    this.name = "RuntimeNotFoundError";
  }
}

interface RuntimeServiceOptions {
  eventRetentionDays?: number;
  eventRetentionBytes?: number;
  now?: () => Date;
}

interface DerivedEventIdentity {
  sessionId: string | null;
  runId: string | null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function runtimeStatusFromEvent(
  event: ChatStreamEvent | RuntimeControlEvent,
  current: RuntimeRunStatus | null,
): RuntimeRunStatus {
  if (current && RUNTIME_TERMINAL_STATUSES.has(current)) return current;
  if (event.type === "run_completed") return "completed";
  if (event.type === "run_failed") return "failed";
  if (event.type === "run_interrupted") return "interrupted";
  if (event.type === "run_started") return "running";
  if (event.type === "approval_required") return "waiting_approval";
  if (event.type === "question_required") return "waiting_user";
  return current ?? "running";
}

function resolveRuntimeTransition(
  current: RuntimeRunStatus | null,
  requested: RuntimeRunStatus,
): RuntimeRunStatus {
  if (!current || current === requested) return requested;
  if (RUNTIME_TERMINAL_STATUSES.has(current)) return current;
  if (RUNTIME_TERMINAL_STATUSES.has(requested)) return requested;
  if (current === "accepted") {
    return ["preparing", "running", "waiting_approval", "waiting_user"].includes(requested)
      ? requested
      : current;
  }
  if (current === "preparing") {
    return ["running", "waiting_approval", "waiting_user"].includes(requested)
      ? requested
      : current;
  }
  if (current === "running") {
    return requested === "waiting_approval" || requested === "waiting_user" ? requested : current;
  }
  if (current === "waiting_approval") {
    return requested === "running" || requested === "waiting_user" ? requested : current;
  }
  if (current === "waiting_user") {
    return requested === "running" || requested === "waiting_approval" ? requested : current;
  }
  return current;
}

function deriveEventIdentity(event: ChatStreamEvent): DerivedEventIdentity {
  if ("runId" in event && typeof event.runId === "string") {
    return {
      sessionId:
        "sessionId" in event && typeof event.sessionId === "string" ? event.sessionId : null,
      runId: event.runId,
    };
  }
  if (event.type === "activity") {
    return {
      sessionId: event.activity.sessionId,
      runId: event.activity.runId,
    };
  }
  if (event.type === "session_updated") {
    return { sessionId: event.session.id, runId: null };
  }
  if (event.type === "session_removed") {
    // ChatService deletes the session row before emitting this tombstone.
    // Preserve the ID in the payload without writing a dangling foreign key.
    return { sessionId: null, runId: null };
  }
  if ("sessionId" in event && typeof event.sessionId === "string") {
    return { sessionId: event.sessionId, runId: null };
  }
  if (event.type === "approval_state") {
    const request = event.state.requests[0];
    return request
      ? { sessionId: request.sessionId, runId: request.runId }
      : {
          sessionId: null,
          runId: null,
        };
  }
  if (event.type === "question_state") {
    const request = event.state.requests[0];
    return request
      ? { sessionId: request.sessionId, runId: request.runId }
      : {
          sessionId: null,
          runId: null,
        };
  }
  return { sessionId: null, runId: null };
}

function isTransientEvent(event: ChatStreamEvent): boolean {
  return (
    event.type === "assistant_delta" ||
    event.type === "reasoning_delta" ||
    event.type === "model_attempt_reset" ||
    event.type === "context_updated"
  );
}

function truncateReplayText(value: string, limit = 32_768): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n\n[Runtime replay payload truncated; use the session snapshot or retained tool output.]`;
}

function boundedMessageParts(parts: MessagePart[]): MessagePart[] {
  if (parts.length <= 256) return parts;
  return [
    ...parts.slice(0, 128),
    {
      type: "text",
      text: `[${parts.length - 255} runtime message parts omitted from replay; use the session snapshot.]`,
    },
    ...parts.slice(-127),
  ];
}

function boundedPolicyText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replaceAll("\0", "").trim().slice(0, limit) : "";
}

function requiredPolicyText(value: unknown, field: string, limit: number): string {
  const normalized = boundedPolicyText(value, limit);
  if (!normalized) throw new RuntimeValidationError(`${field} must contain 1-${limit} characters.`);
  return normalized;
}

function sanitizePolicySources(value: unknown): ManagedPolicySource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new RuntimeValidationError("sources must be an array when provided.");
  const sources: ManagedPolicySource[] = [];
  for (const candidate of value.slice(0, MAX_POLICY_DENIAL_SOURCES)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const source = candidate as Record<string, unknown>;
    const layer = source.layer;
    const decision = source.decision;
    if (
      (layer !== "machine" && layer !== "user") ||
      (decision !== "allow" && decision !== "ask" && decision !== "deny")
    )
      continue;
    const revision = boundedPolicyText(source.revision, MAX_POLICY_DENIAL_REVISION_CHARS);
    const reason = boundedPolicyText(source.reason, MAX_POLICY_SOURCE_REASON_CHARS);
    if (!revision || !reason) continue;
    const path = boundedPolicyText(source.path, MAX_POLICY_SOURCE_PATH_CHARS);
    sources.push({
      layer,
      revision,
      decision,
      reason,
      ...(path ? { path } : {}),
    });
  }
  return sources;
}

function sanitizePolicyDenial(input: RuntimePolicyDenialInput, at: string): RuntimePolicyDenial {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new RuntimeValidationError("Policy denial metadata must be an object.");
  return {
    revision: requiredPolicyText(input.revision, "revision", MAX_POLICY_DENIAL_REVISION_CHARS),
    code: requiredPolicyText(input.code, "code", MAX_POLICY_DENIAL_CODE_CHARS),
    reason: requiredPolicyText(input.reason, "reason", MAX_POLICY_DENIAL_REASON_CHARS),
    sources: sanitizePolicySources(input.sources),
    scope: requiredPolicyText(input.scope, "scope", MAX_POLICY_DENIAL_SCOPE_CHARS),
    at,
  };
}

function policyDenialFromJson(value: unknown): RuntimePolicyDenial | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const denial = parsed as Record<string, unknown>;
    const revision = boundedPolicyText(denial.revision, MAX_POLICY_DENIAL_REVISION_CHARS);
    const code = boundedPolicyText(denial.code, MAX_POLICY_DENIAL_CODE_CHARS);
    const reason = boundedPolicyText(denial.reason, MAX_POLICY_DENIAL_REASON_CHARS);
    const scope = boundedPolicyText(denial.scope, MAX_POLICY_DENIAL_SCOPE_CHARS);
    const at = boundedPolicyText(denial.at, 64);
    if (!revision || !code || !reason || !scope || !at) return undefined;
    return {
      revision,
      code,
      reason,
      sources: sanitizePolicySources(denial.sources),
      scope,
      at,
    };
  } catch {
    return undefined;
  }
}

function sanitizeEvent(value: ChatStreamEvent): ChatStreamEvent {
  if (value.type === "assistant_message") {
    return {
      ...value,
      message: {
        ...value.message,
        parts: boundedMessageParts(
          value.message.parts.map((part): MessagePart => {
            if (part.type === "tool_result") {
              return {
                ...part,
                output: truncateReplayText(part.output),
                ...(part.images ? { images: [] } : {}),
              };
            }
            if (part.type === "text") {
              return { ...part, text: truncateReplayText(part.text) };
            }
            if (part.type === "reasoning") {
              return { ...part, text: truncateReplayText(part.text) };
            }
            return part;
          }),
        ),
      },
    };
  }
  if (value.type === "user_message") {
    return {
      ...value,
      message: {
        ...value.message,
        parts: boundedMessageParts(
          value.message.parts.map(
            (part): MessagePart =>
              part.type === "attachment"
                ? {
                    ...part,
                    attachment: {
                      ...part.attachment,
                      dataUrl: "[attachment data omitted from runtime replay]",
                      ...(part.attachment.extractedContent
                        ? {
                            extractedContent: {
                              ...part.attachment.extractedContent,
                              text: truncateReplayText(part.attachment.extractedContent.text),
                            },
                          }
                        : {}),
                    },
                  }
                : part,
          ),
        ),
      },
    };
  }
  if (value.type === "activity") {
    return {
      ...value,
      activity: {
        ...value.activity,
        detail: truncateReplayText(value.activity.detail, 65_536),
      },
    };
  }
  if (value.type === "approval_required") {
    return {
      ...value,
      approval: {
        ...value.approval,
        detail: truncateReplayText(value.approval.detail, 65_536),
        ...(value.approval.reviewInput
          ? { reviewInput: truncateReplayText(value.approval.reviewInput, 65_536) }
          : {}),
      },
    };
  }
  if (value.type === "session_updated") {
    return {
      ...value,
      session: {
        ...value.session,
        systemPrompt: truncateReplayText(value.session.systemPrompt, 65_536),
      },
    };
  }
  return value;
}

export class RuntimeService {
  private readonly eventRetentionDays: number;
  private readonly eventRetentionBytes: number;
  private readonly now: () => Date;
  private readonly listeners = new Set<
    (event: RuntimeEventEnvelope, sessionId: string | null, runId: string | null) => void
  >();
  private transientEvents = 0;
  private writesSinceCleanup = 0;
  private capabilityOverrides: Partial<
    Pick<RuntimeCapabilities, "policy" | "taskClaims" | "officeReceipts">
  > = {};

  constructor(
    private readonly database: DatabaseSync,
    private readonly repository: Repository,
    options: RuntimeServiceOptions = {},
  ) {
    this.eventRetentionDays = Math.max(
      1,
      Math.floor(options.eventRetentionDays ?? DEFAULT_EVENT_RETENTION_DAYS),
    );
    this.eventRetentionBytes = Math.max(
      8 * 1024 * 1024,
      Math.floor(options.eventRetentionBytes ?? DEFAULT_EVENT_RETENTION_BYTES),
    );
    this.now = options.now ?? (() => new Date());
    this.ensureCurrentV11Schema();
    this.cleanup();
  }

  admitTurn(input: RuntimeAdmitTurnInput): RuntimeTurnAcceptance {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 240) {
      throw new RuntimeValidationError("idempotencyKey must contain 1-240 characters.");
    }
    if (!/^[a-f0-9]{64}$/i.test(input.requestHash)) {
      throw new RuntimeValidationError("requestHash must be a SHA-256 hex digest.");
    }
    if (!this.repository.getSession(input.sessionId)) {
      throw new RuntimeNotFoundError("Session");
    }
    const existing = this.database
      .prepare(
        `select t.*, r.status, r.created_at as run_created_at
         from accepted_turns t
         join runtime_runs r on r.id = t.run_id
         where t.session_id = ? and t.idempotency_key = ?`,
      )
      .get(input.sessionId, idempotencyKey) as RuntimeDatabaseRow | undefined;
    if (existing) {
      if (String(existing.request_hash) !== input.requestHash.toLowerCase()) {
        throw new RuntimeIdempotencyConflictError();
      }
      return this.acceptanceFromRow(existing, true);
    }

    const runId = randomUUID();
    const turnId = randomUUID();
    const createdAt = this.now().toISOString();
    const acceptedControl: RuntimeControlEvent = {
      type: "runtime.status",
      sessionId: input.sessionId,
      runId,
      status: "accepted",
      reason: null,
    };
    let acceptedEvent: RuntimeEventEnvelope;
    this.database.exec("savepoint admit_runtime_turn");
    try {
      this.database
        .prepare(
          `insert into runtime_runs (
             id, session_id, status, source, created_at, updated_at, policy_revision
           ) values (?, ?, 'accepted', ?, ?, ?, ?)`,
        )
        .run(
          runId,
          input.sessionId,
          input.source,
          createdAt,
          createdAt,
          input.policyRevision ?? "",
        );
      this.database
        .prepare(
          `insert into accepted_turns (
             id, session_id, run_id, idempotency_key, request_hash,
             source, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          turnId,
          input.sessionId,
          runId,
          idempotencyKey,
          input.requestHash.toLowerCase(),
          input.source,
          createdAt,
          createdAt,
        );
      acceptedEvent = this.insertEnvelope(acceptedControl, input.sessionId, runId, createdAt);
      this.database.exec("release admit_runtime_turn");
    } catch (cause) {
      this.database.exec("rollback to admit_runtime_turn; release admit_runtime_turn");
      const raced = this.database
        .prepare(
          `select t.*, r.status, r.created_at as run_created_at
           from accepted_turns t
           join runtime_runs r on r.id = t.run_id
           where t.session_id = ? and t.idempotency_key = ?`,
        )
        .get(input.sessionId, idempotencyKey) as RuntimeDatabaseRow | undefined;
      if (raced) {
        if (String(raced.request_hash) !== input.requestHash.toLowerCase()) {
          throw new RuntimeIdempotencyConflictError();
        }
        return this.acceptanceFromRow(raced, true);
      }
      throw cause;
    }
    this.publishCommittedEnvelope(acceptedEvent, input.sessionId, runId);
    return {
      turnId,
      runId,
      sessionId: input.sessionId,
      idempotencyKey,
      requestHash: input.requestHash.toLowerCase(),
      source: input.source,
      createdAt,
      duplicate: false,
    };
  }

  markPreparing(runId: string): RuntimeRunView {
    return this.transitionRun(runId, "preparing", null);
  }

  linkDelegatedRun(parentRunId: string, childRunId: string): RuntimeRunView {
    const parent = this.getRun(parentRunId);
    if (parent.delegatedRunId && parent.delegatedRunId !== childRunId) {
      throw new Error(
        `Parent run ${parentRunId} is already linked to delegated run ${parent.delegatedRunId}.`,
      );
    }
    const now = this.now().toISOString();
    this.database
      .prepare("update runtime_runs set delegated_run_id = ?, updated_at = ? where id = ?")
      .run(childRunId, now, parentRunId);
    return this.getRun(parentRunId);
  }

  transitionRun(runId: string, status: RuntimeRunStatus, reason: string | null): RuntimeRunView {
    const current = this.getRun(runId);
    if (RUNTIME_TERMINAL_STATUSES.has(current.status)) return current;
    const nextStatus = resolveRuntimeTransition(current.status, status);
    if (nextStatus === current.status && status !== current.status) return current;
    const now = this.now().toISOString();
    const terminal = RUNTIME_TERMINAL_STATUSES.has(nextStatus);
    const control: RuntimeControlEvent = {
      type: "runtime.status",
      sessionId: current.sessionId,
      runId,
      status: nextStatus,
      reason,
    };
    let envelope: RuntimeEventEnvelope;
    this.database.exec("savepoint transition_runtime_run");
    try {
      this.database
        .prepare(
          `update runtime_runs
           set status = ?, updated_at = ?, terminal_reason = ?,
               started_at = case
                 when ? = 'running' and started_at is null then ?
                 else started_at
               end,
               completed_at = case when ? = 1 then ? else completed_at end
           where id = ?`,
        )
        .run(nextStatus, now, reason, nextStatus, now, terminal ? 1 : 0, now, runId);
      envelope = this.insertBoundedEnvelope(control, current.sessionId, runId, now);
      this.database.exec("release transition_runtime_run");
    } catch (cause) {
      this.database.exec("rollback to transition_runtime_run; release transition_runtime_run");
      throw cause;
    }
    this.publishCommittedEnvelope(envelope, current.sessionId, runId);
    return this.getRun(runId);
  }

  recordEvent(event: ChatStreamEvent): RuntimeEventEnvelope {
    const identity = deriveEventIdentity(event);
    const createdAt = this.now().toISOString();
    if (isTransientEvent(event)) {
      this.transientEvents += 1;
      if (this.transientEvents > TRANSIENT_EVENT_LIMIT) {
        this.transientEvents = 0;
      }
      const envelope: RuntimeEventEnvelope = {
        eventId: null,
        seq: 0,
        sessionId: identity.sessionId,
        runId: identity.runId,
        type: event.type,
        event: sanitizeEvent(event),
        createdAt,
      };
      this.emitToListeners(envelope, identity.sessionId, identity.runId);
      return envelope;
    }
    return this.recordEnvelope(sanitizeEvent(event), identity.sessionId, identity.runId, createdAt);
  }

  recordControl(
    sessionId: string,
    runId: string,
    status: RuntimeRunStatus,
    reason: string | null,
  ): RuntimeEventEnvelope {
    const control: RuntimeControlEvent = {
      type: "runtime.status",
      sessionId,
      runId,
      status,
      reason,
    };
    return this.recordEnvelope(control, sessionId, runId, this.now().toISOString());
  }

  recordPolicyDenial(runId: string, input: RuntimePolicyDenialInput): RuntimeRunView {
    const current = this.getRun(runId);
    const now = this.now().toISOString();
    const denial = sanitizePolicyDenial(input, now);
    const control: RuntimeControlEvent = {
      type: "runtime.policy_denied",
      sessionId: current.sessionId,
      runId,
      denial,
    };

    let envelope: RuntimeEventEnvelope;
    this.database.exec("savepoint record_runtime_policy_denial");
    try {
      this.database
        .prepare("update runtime_runs set policy_denial_json = ?, updated_at = ? where id = ?")
        .run(JSON.stringify(denial), now, runId);
      envelope = this.insertEnvelope(control, current.sessionId, runId, now, false);
      this.database.exec("release record_runtime_policy_denial");
    } catch (cause) {
      this.database.exec(
        "rollback to record_runtime_policy_denial; release record_runtime_policy_denial",
      );
      throw cause;
    }
    this.publishCommittedEnvelope(envelope, current.sessionId, runId);
    return this.getRun(runId);
  }

  getRun(runId: string): RuntimeRunView {
    const row = this.database.prepare("select * from runtime_runs where id = ?").get(runId) as
      | RuntimeDatabaseRow
      | undefined;
    if (!row) throw new RuntimeNotFoundError("Run");
    return this.runFromRow(row);
  }

  listRuns(sessionId: string): RuntimeRunView[] {
    const rows = this.database
      .prepare(
        `select * from runtime_runs
         where session_id = ?
         order by created_at desc`,
      )
      .all(sessionId) as RuntimeDatabaseRow[];
    return rows.map((row) => this.runFromRow(row));
  }

  snapshot(sessionId: string): RuntimeSessionSnapshot {
    const session = this.repository.getSession(sessionId);
    if (!session) throw new RuntimeNotFoundError("Session");
    const cursor = this.latestCursor();
    const turns = this.database
      .prepare(
        `select * from accepted_turns
         where session_id = ?
         order by created_at desc
         limit 100`,
      )
      .all(sessionId) as RuntimeDatabaseRow[];
    return {
      session,
      messages: this.repository.getMessages(sessionId),
      todos: this.repository.listSessionTodos(sessionId),
      runs: this.listRuns(sessionId),
      acceptances: turns.map((row) => {
        const accepted = this.acceptanceFromRow(row, false);
        const { duplicate: _duplicate, ...view } = accepted;
        return view;
      }),
      eventCursor: cursor,
      cursorExpired: false,
      capabilities: this.capabilities(),
    };
  }

  listEvents(
    input: {
      after?: number;
      sessionId?: string | null;
      runId?: string | null;
      limit?: number;
    } = {},
  ): RuntimeEventPage {
    const after = Math.max(0, Math.floor(input.after ?? 0));
    this.assertCursor(after, input.sessionId, input.runId);
    const limit = Math.max(
      1,
      Math.min(MAX_EVENT_PAGE_SIZE, Math.floor(input.limit ?? DEFAULT_EVENT_PAGE_SIZE)),
    );
    const conditions = ["event_id > ?"];
    const values: Array<string | number> = [after];
    if (input.sessionId) {
      conditions.push("session_id = ?");
      values.push(input.sessionId);
    }
    if (input.runId) {
      conditions.push("run_id = ?");
      values.push(input.runId);
    }
    values.push(limit + 1);
    const rows = this.database
      .prepare(
        `select * from runtime_events
         where ${conditions.join(" and ")}
         order by event_id asc
         limit ?`,
      )
      .all(...values) as RuntimeDatabaseRow[];
    const hasMore = rows.length > limit;
    const selected = hasMore ? rows.slice(0, limit) : rows;
    const events = selected.map((row) => this.envelopeFromRow(row));
    return {
      events,
      cursor: events.at(-1)?.eventId ?? after,
      hasMore,
    };
  }

  subscribe(
    listener: (event: RuntimeEventEnvelope, sessionId: string | null, runId: string | null) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recoverInterruptedRuns(): number {
    const rows = this.database
      .prepare(
        `select id, session_id from runtime_runs
         where status in ('accepted', 'preparing', 'running', 'waiting_approval', 'waiting_user')`,
      )
      .all() as RuntimeDatabaseRow[];
    if (!rows.length) return 0;
    const now = this.now().toISOString();
    this.database.exec("savepoint recover_runtime_runs");
    try {
      for (const row of rows) {
        const runId = String(row.id);
        const sessionId = String(row.session_id);
        this.database
          .prepare(
            `update runtime_runs
             set status = 'interrupted', updated_at = ?, completed_at = ?,
                 terminal_reason = 'Application restarted before the run settled.'
             where id = ?`,
          )
          .run(now, now, runId);
        const control: RuntimeControlEvent = {
          type: "runtime.recovered",
          sessionId,
          runId,
          status: "interrupted",
          reason: "Application restarted before the run settled.",
        };
        this.insertEnvelope(control, sessionId, runId, now);
      }
      this.database.exec("release recover_runtime_runs");
    } catch (cause) {
      this.database.exec("rollback to recover_runtime_runs; release recover_runtime_runs");
      throw cause;
    }
    return rows.length;
  }

  capabilities(): RuntimeCapabilities {
    return {
      apiVersion: "v1",
      runtimeEvents: true,
      eventReplay: true,
      idempotentTurns: true,
      exactRunCancellation: true,
      policy: this.capabilityOverrides.policy ?? false,
      taskClaims: this.capabilityOverrides.taskClaims ?? false,
      officeReceipts: this.capabilityOverrides.officeReceipts ?? false,
      eventRetentionDays: this.eventRetentionDays,
      eventRetentionBytes: this.eventRetentionBytes,
    };
  }

  setCapabilities(
    capabilities: Partial<Pick<RuntimeCapabilities, "policy" | "taskClaims" | "officeReceipts">>,
  ): void {
    this.capabilityOverrides = {
      ...this.capabilityOverrides,
      ...capabilities,
    };
  }

  cleanup(): void {
    const cutoff = new Date(
      this.now().getTime() - this.eventRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.database.prepare("delete from runtime_events where created_at < ?").run(cutoff);
    let usage = asNumber(
      (
        this.database
          .prepare("select coalesce(sum(byte_size), 0) as total from runtime_events")
          .get() as RuntimeDatabaseRow
      ).total,
    );
    while (usage > this.eventRetentionBytes) {
      const batch = Math.max(64, Math.ceil((usage - this.eventRetentionBytes) / 8_192));
      const rows = this.database
        .prepare(
          `select event_id, byte_size from runtime_events
           order by event_id asc limit ?`,
        )
        .all(Math.min(10_000, batch)) as RuntimeDatabaseRow[];
      if (!rows.length) break;
      const last = asNumber(rows.at(-1)?.event_id);
      this.database.prepare("delete from runtime_events where event_id <= ?").run(last);
      usage -= rows.reduce((sum, row) => sum + asNumber(row.byte_size), 0);
    }
  }

  private ensureCurrentV11Schema(): void {
    const version = asNumber(
      (this.database.prepare("pragma user_version").get() as RuntimeDatabaseRow | undefined)
        ?.user_version,
    );
    if (version !== 11) {
      throw new Error(`RuntimeService requires database schema 11; received ${version}.`);
    }
    const table = this.database
      .prepare("select name from sqlite_master where type = 'table' and name = 'runtime_runs'")
      .get();
    if (!table) throw new Error("RuntimeService requires the runtime_runs table.");
    const columns = this.database
      .prepare("pragma table_info(runtime_runs)")
      .all() as RuntimeDatabaseRow[];
    if (columns.some((column) => String(column.name) === "policy_denial_json")) return;

    this.database.exec("savepoint ensure_runtime_policy_denial");
    try {
      this.database.exec(
        "alter table runtime_runs add column policy_denial_json text not null default 'null'",
      );
      this.database.exec("release ensure_runtime_policy_denial");
    } catch (cause) {
      this.database.exec(
        "rollback to ensure_runtime_policy_denial; release ensure_runtime_policy_denial",
      );
      throw cause;
    }
  }

  private insertBoundedEnvelope(
    event: ChatStreamEvent | RuntimeControlEvent,
    sessionId: string | null,
    runId: string | null,
    createdAt: string,
  ): RuntimeEventEnvelope {
    const currentStatus = runId ? this.runStatus(runId) : null;
    const bounded =
      JSON.stringify(event).length <= MAX_EVENT_PAYLOAD_CHARS
        ? event
        : ({
            type: "runtime.status",
            sessionId: sessionId ?? "",
            runId: runId ?? "",
            status: currentStatus ?? "running",
            reason: `Oversized ${event.type} event omitted from runtime replay; use the session snapshot.`,
          } satisfies RuntimeControlEvent);
    return this.insertEnvelope(bounded, sessionId, runId, createdAt);
  }

  private recordEnvelope(
    event: ChatStreamEvent | RuntimeControlEvent,
    sessionId: string | null,
    runId: string | null,
    createdAt: string,
  ): RuntimeEventEnvelope {
    const envelope = this.insertBoundedEnvelope(event, sessionId, runId, createdAt);
    this.publishCommittedEnvelope(envelope, sessionId, runId);
    return envelope;
  }

  private publishCommittedEnvelope(
    envelope: RuntimeEventEnvelope,
    sessionId: string | null,
    runId: string | null,
  ): void {
    this.emitToListeners(envelope, sessionId, runId);
    this.writesSinceCleanup += 1;
    if (this.writesSinceCleanup >= CLEANUP_INTERVAL) {
      this.writesSinceCleanup = 0;
      this.cleanup();
    }
  }

  private insertEnvelope(
    event: ChatStreamEvent | RuntimeControlEvent,
    sessionId: string | null,
    runId: string | null,
    createdAt: string,
    createMissingRun = true,
  ): RuntimeEventEnvelope {
    const payload = JSON.stringify(event);
    const bytes = Buffer.byteLength(payload, "utf8");
    this.database.exec("savepoint insert_runtime_event");
    try {
      if (runId && !this.database.prepare("select 1 from runtime_runs where id = ?").get(runId)) {
        if (!createMissingRun) throw new RuntimeNotFoundError("Run");
        if (!sessionId || !this.repository.getSession(sessionId)) {
          throw new RuntimeNotFoundError("Session");
        }
        this.database
          .prepare(
            `insert into runtime_runs (
               id, session_id, status, source, created_at, started_at, updated_at
             ) values (?, ?, 'running', 'event', ?, ?, ?)`,
          )
          .run(runId, sessionId, createdAt, createdAt, createdAt);
      }
      let seq = 0;
      if (runId) {
        const row = this.database
          .prepare("select next_seq from runtime_runs where id = ?")
          .get(runId) as RuntimeDatabaseRow | undefined;
        seq = asNumber(row?.next_seq) + 1;
        this.database
          .prepare("update runtime_runs set next_seq = ?, updated_at = ? where id = ?")
          .run(seq, createdAt, runId);
      }
      const result = this.database
        .prepare(
          `insert into runtime_events (
             session_id, run_id, seq, type, payload_json, byte_size, created_at
           ) values (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(sessionId, runId, seq, event.type, payload, bytes, createdAt);
      const eventId = asNumber(result.lastInsertRowid);
      if (runId) {
        const current = this.runStatus(runId);
        const requestedStatus =
          event.type === "runtime.status" || event.type === "runtime.recovered"
            ? event.status
            : runtimeStatusFromEvent(event, current);
        const status = resolveRuntimeTransition(current, requestedStatus);
        const terminal = RUNTIME_TERMINAL_STATUSES.has(status);
        const enteringTerminal = terminal && (!current || !RUNTIME_TERMINAL_STATUSES.has(current));
        this.database
          .prepare(
            `update runtime_runs
             set status = ?, last_event_id = ?, updated_at = ?,
                 started_at = case when ? = 'running' and started_at is null then ? else started_at end,
                 completed_at = case when ? = 1 then ? else completed_at end
             where id = ?`,
          )
          .run(
            status,
            eventId,
            createdAt,
            status,
            createdAt,
            enteringTerminal ? 1 : 0,
            createdAt,
            runId,
          );
      }
      this.database.exec("release insert_runtime_event");
      return {
        eventId,
        seq,
        sessionId,
        runId,
        type: event.type,
        event,
        createdAt,
      };
    } catch (cause) {
      this.database.exec("rollback to insert_runtime_event; release insert_runtime_event");
      throw cause;
    }
  }

  private emitToListeners(
    envelope: RuntimeEventEnvelope,
    sessionId: string | null,
    runId: string | null,
  ): void {
    for (const listener of this.listeners) {
      try {
        listener(envelope, sessionId, runId);
      } catch {
        // A disconnected SSE client cannot roll back a committed runtime event.
      }
    }
  }

  private latestCursor(): number {
    const row = this.database
      .prepare("select coalesce(max(event_id), 0) as cursor from runtime_events")
      .get() as RuntimeDatabaseRow;
    return asNumber(row.cursor);
  }

  private runStatus(runId: string): RuntimeRunStatus | null {
    const row = this.database.prepare("select status from runtime_runs where id = ?").get(runId) as
      | RuntimeDatabaseRow
      | undefined;
    return row ? (String(row.status) as RuntimeRunStatus) : null;
  }

  private assertCursor(after: number, sessionId?: string | null, runId?: string | null): void {
    const row = this.database
      .prepare(
        `select
           coalesce(min(event_id), 0) as earliest,
           coalesce(max(event_id), 0) as latest
         from runtime_events`,
      )
      .get() as RuntimeDatabaseRow;
    const earliest = asNumber(row.earliest);
    const latest = asNumber(row.latest);
    if (after > 0 && (latest === 0 || after > latest || (earliest > 0 && after < earliest - 1))) {
      throw new RuntimeCursorExpiredError(after, earliest);
    }
    if (!sessionId && !runId) return;

    const conditions = ["r.last_event_id > ?"];
    const values: Array<string | number> = [after, after];
    if (runId) {
      conditions.push("r.id = ?");
      values.push(runId);
    } else {
      conditions.push("r.session_id = ?");
      values.push(sessionId as string);
    }
    const runs = this.database
      .prepare(
        `select
           r.id,
           r.next_seq,
           r.last_event_id,
           count(e.event_id) as retained_events,
           coalesce(min(e.event_id), 0) as earliest_event,
           sum(case when e.event_id > ? then 1 else 0 end) as retained_after
         from runtime_runs r
         left join runtime_events e on e.run_id = r.id
         where ${conditions.join(" and ")}
         group by r.id`,
      )
      .all(...values) as RuntimeDatabaseRow[];
    for (const run of runs) {
      const retainedAfter = asNumber(run.retained_after);
      const retainedEvents = asNumber(run.retained_events);
      const earliestEvent = asNumber(run.earliest_event);
      const hasLostHistory = retainedEvents < asNumber(run.next_seq);
      const cursorNeedsLostHistory =
        retainedEvents === 0 || (retainedAfter > 0 && after < earliestEvent);
      if (hasLostHistory && cursorNeedsLostHistory) {
        const cursorCandidates = [earliest, earliestEvent].filter((value) => value > 0);
        throw new RuntimeCursorExpiredError(
          after,
          cursorCandidates.length ? Math.min(...cursorCandidates) : 0,
        );
      }
    }
  }

  private runFromRow(row: RuntimeDatabaseRow): RuntimeRunView {
    const lastPolicyDenial = policyDenialFromJson(row.policy_denial_json);
    return {
      runId: String(row.id),
      sessionId: String(row.session_id),
      status: String(row.status) as RuntimeRunStatus,
      source: String(row.source),
      createdAt: String(row.created_at),
      startedAt: asNullableString(row.started_at),
      updatedAt: String(row.updated_at),
      completedAt: asNullableString(row.completed_at),
      terminalReason: asNullableString(row.terminal_reason),
      policyRevision: String(row.policy_revision ?? ""),
      ...(lastPolicyDenial ? { lastPolicyDenial } : {}),
      delegatedRunId: asNullableString(row.delegated_run_id),
      lastEventId: asNumber(row.last_event_id),
    };
  }

  private acceptanceFromRow(row: RuntimeDatabaseRow, duplicate: boolean): RuntimeTurnAcceptance {
    return {
      turnId: String(row.id),
      runId: String(row.run_id),
      sessionId: String(row.session_id),
      idempotencyKey: String(row.idempotency_key),
      requestHash: String(row.request_hash),
      source: String(row.source),
      createdAt: String(row.created_at),
      duplicate,
    };
  }

  private envelopeFromRow(row: RuntimeDatabaseRow): RuntimeEventEnvelope {
    let event: ChatStreamEvent | RuntimeControlEvent;
    try {
      event = JSON.parse(String(row.payload_json)) as ChatStreamEvent | RuntimeControlEvent;
    } catch {
      recordRuntimeError("runtime.events", "Stored runtime event payload was unreadable.", {
        operation: "event-read",
        code: "RUNTIME_EVENT_PAYLOAD_INVALID",
      });
      event = {
        type: "runtime.status",
        sessionId: String(row.session_id ?? ""),
        runId: String(row.run_id ?? ""),
        status: "failed",
        reason: "Stored runtime event payload was unreadable.",
      };
    }
    return {
      eventId: asNumber(row.event_id),
      seq: asNumber(row.seq),
      sessionId: asNullableString(row.session_id),
      runId: asNullableString(row.run_id),
      type: String(row.type),
      event,
      createdAt: String(row.created_at),
    };
  }
}
