import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent, SessionMessage, SessionView } from "../../shared/domain";
import * as runtimeLog from "../diagnostics/runtime-log";
import type { Repository } from "../storage/repository";
import {
  MIGRATION_RUNTIME_V11,
  RuntimeCursorExpiredError,
  RuntimeIdempotencyConflictError,
  RuntimeNotFoundError,
  RuntimeService,
} from "./runtime-service";

const databases: DatabaseSync[] = [];

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(
  options: { now?: () => Date; messages?: SessionMessage[]; eventRetentionDays?: number } = {},
): {
  database: DatabaseSync;
  repository: Repository;
  runtime: RuntimeService;
} {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(`
    create table sessions (id text primary key);
    insert into sessions(id) values ('session-1'), ('session-2');
  `);
  database.exec(MIGRATION_RUNTIME_V11);
  database.exec("pragma user_version = 11;");
  const sessions = new Map(
    ["session-1", "session-2"].map((id) => [
      id,
      {
        id,
        title: "Runtime fixture",
      } as SessionView,
    ]),
  );
  const repository = {
    getSession: (id: string) => sessions.get(id) ?? null,
    getMessages: () => options.messages ?? [],
    listSessionTodos: () => [],
  } as unknown as Repository;
  return {
    database,
    repository,
    runtime: new RuntimeService(database, repository, options),
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("RuntimeService", () => {
  it("records a safe diagnostic when a persisted event is unreadable", () => {
    const { database, runtime } = fixture();
    const report = vi.spyOn(runtimeLog, "recordRuntimeError").mockImplementation(() => undefined);
    try {
      const accepted = runtime.admitTurn({
        sessionId: "session-1",
        idempotencyKey: "damaged-event",
        requestHash: hash("damaged-event"),
        source: "test",
      });
      database
        .prepare("update runtime_events set payload_json = ? where run_id = ?")
        .run("{private fixture content", accepted.runId);
      const page = runtime.listEvents({ runId: accepted.runId });
      expect(page.events[0]?.event).toMatchObject({
        type: "runtime.status",
        status: "failed",
        reason: "Stored runtime event payload was unreadable.",
      });
      expect(report).toHaveBeenCalledWith(
        "runtime.events",
        "Stored runtime event payload was unreadable.",
        { operation: "event-read", code: "RUNTIME_EVENT_PAYLOAD_INVALID" },
      );
      expect(JSON.stringify(report.mock.calls)).not.toContain("private fixture content");
    } finally {
      report.mockRestore();
    }
  });

  it("admits a turn once and conflicts when a key is reused for different input", () => {
    const { database, runtime } = fixture();
    const notifications: Array<{ type: string; status?: string }> = [];
    const unsubscribe = runtime.subscribe((event) => notifications.push(event.event));
    const requestHash = hash("hello");
    try {
      const first = runtime.admitTurn({
        sessionId: "session-1",
        idempotencyKey: "turn-1",
        requestHash,
        source: "test",
        policyRevision: "policy-sha",
      });
      const duplicate = runtime.admitTurn({
        sessionId: "session-1",
        idempotencyKey: "turn-1",
        requestHash,
        source: "test",
      });

      expect(first.duplicate).toBe(false);
      expect(runtime.getRun(first.runId).policyRevision).toBe("policy-sha");
      expect(duplicate).toMatchObject({
        duplicate: true,
        runId: first.runId,
        turnId: first.turnId,
      });
      expect(() =>
        runtime.admitTurn({
          sessionId: "session-1",
          idempotencyKey: "turn-1",
          requestHash: hash("different"),
          source: "test",
        }),
      ).toThrow(RuntimeIdempotencyConflictError);
      expect(notifications).toEqual([
        expect.objectContaining({ type: "runtime.status", status: "accepted" }),
      ]);
      expect(runtime.listEvents({ runId: first.runId }).events).toEqual([
        expect.objectContaining({ type: "runtime.status" }),
      ]);
      expect(
        database
          .prepare("select count(*) as count from runtime_events where run_id = ?")
          .get(first.runId)?.count,
      ).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it("commits the accepted event with the run and acceptance or rolls all of them back", () => {
    const { database, runtime } = fixture();
    const notifications: string[] = [];
    const unsubscribe = runtime.subscribe((event) => notifications.push(event.type));
    database.exec(`
      create trigger fail_runtime_event
      before insert on runtime_events
      begin
        select raise(abort, 'fixture runtime event failure');
      end;
    `);
    try {
      expect(() =>
        runtime.admitTurn({
          sessionId: "session-1",
          idempotencyKey: "atomic-turn",
          requestHash: hash("atomic"),
          source: "test",
        }),
      ).toThrow("fixture runtime event failure");
      expect(database.prepare("select count(*) as count from runtime_runs").get()?.count).toBe(0);
      expect(database.prepare("select count(*) as count from accepted_turns").get()?.count).toBe(0);
      expect(database.prepare("select count(*) as count from runtime_events").get()?.count).toBe(0);
      expect(notifications).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it("persists lifecycle events, assigns per-run sequence numbers and infers terminal state", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "turn-1",
      requestHash: hash("hello"),
      source: "test",
    });
    runtime.markPreparing(accepted.runId);
    runtime.recordEvent({
      type: "run_started",
      sessionId: "session-1",
      runId: accepted.runId,
    });
    runtime.recordEvent({
      type: "run_completed",
      sessionId: "session-1",
      runId: accepted.runId,
    });

    const run = runtime.getRun(accepted.runId);
    expect(run.status).toBe("completed");
    expect(run.completedAt).not.toBeNull();
    const page = runtime.listEvents({ sessionId: "session-1" });
    expect(page.events.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
    expect(page.events.map((entry) => entry.event.type)).toEqual([
      "runtime.status",
      "runtime.status",
      "run_started",
      "run_completed",
    ]);
  });

  it("rolls back a lifecycle transition when its event cannot be persisted", () => {
    const { database, runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "atomic-transition",
      requestHash: hash("atomic-transition"),
      source: "test",
    });
    const before = runtime.getRun(accepted.runId);
    const notifications: string[] = [];
    const unsubscribe = runtime.subscribe((event) => notifications.push(event.type));
    database.exec(`
      create trigger fail_transition_event
      before insert on runtime_events
      begin
        select raise(abort, 'fixture transition event failure');
      end;
    `);
    try {
      expect(() => runtime.markPreparing(accepted.runId)).toThrow(
        "fixture transition event failure",
      );
      expect(runtime.getRun(accepted.runId)).toEqual(before);
      expect(runtime.listEvents({ runId: accepted.runId }).events).toHaveLength(1);
      expect(notifications).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it("does not duplicate a lifecycle event when a terminal run is transitioned again", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "terminal-no-duplicate",
      requestHash: hash("terminal-no-duplicate"),
      source: "test",
    });
    const completed = runtime.transitionRun(accepted.runId, "completed", "Completed.");
    const notificationCount = runtime.listEvents({ runId: accepted.runId }).events.length;
    const notifications: string[] = [];
    const unsubscribe = runtime.subscribe((event) => notifications.push(event.type));
    try {
      expect(runtime.transitionRun(accepted.runId, "failed", "Late failure.")).toEqual(completed);
      expect(runtime.listEvents({ runId: accepted.runId }).events).toHaveLength(notificationCount);
      expect(notifications).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it("bounds an oversized lifecycle event without changing the terminal run state", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "oversized-transition",
      requestHash: hash("oversized-transition"),
      source: "test",
    });
    const reason = "x".repeat(1024 * 1024 + 1);
    const completed = runtime.transitionRun(accepted.runId, "completed", reason);
    const event = runtime.listEvents({ runId: accepted.runId }).events.at(-1);

    expect(completed).toMatchObject({ status: "completed", terminalReason: reason });
    expect(event?.event).toMatchObject({
      type: "runtime.status",
      status: "completed",
      reason:
        "Oversized runtime.status event omitted from runtime replay; use the session snapshot.",
    });
    expect((JSON.stringify(event?.event) ?? "").length).toBeLessThan(1024 * 1024);
  });

  it("persists bounded policy denial metadata without replacing the admission revision", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "policy-denial-turn",
      requestHash: hash("policy-denial"),
      source: "test",
      policyRevision: "admission-policy-revision",
    });
    runtime.transitionRun(accepted.runId, "running", null);
    const run = runtime.recordPolicyDenial(accepted.runId, {
      revision: "r".repeat(300),
      code: "c".repeat(180),
      reason: "reason".repeat(1_000),
      scope: "s".repeat(300),
      sources: Array.from({ length: 20 }, (_, index) => ({
        layer: index % 2 ? "user" : "machine",
        revision: "source-revision",
        decision: "deny",
        reason: "source-reason".repeat(200),
        path: `C:\\policies\\${index}\\`.padEnd(1_500, "x"),
      })),
    });

    expect(run.status).toBe("running");
    expect(run.policyRevision).toBe("admission-policy-revision");
    expect(run.lastPolicyDenial).toMatchObject({
      revision: "r".repeat(240),
      code: "c".repeat(120),
      scope: "s".repeat(240),
    });
    expect(run.lastPolicyDenial?.reason).toHaveLength(4_096);
    expect(run.lastPolicyDenial?.sources).toHaveLength(16);
    expect(run.lastPolicyDenial?.sources[0]?.reason).toHaveLength(1_024);
    expect(run.lastPolicyDenial?.sources[0]?.path).toHaveLength(1_024);

    const event = runtime.listEvents({ runId: accepted.runId }).events.at(-1);
    expect(event).toMatchObject({
      type: "runtime.policy_denied",
      event: {
        type: "runtime.policy_denied",
        sessionId: "session-1",
        runId: accepted.runId,
        denial: run.lastPolicyDenial,
      },
    });
  });

  it("keeps the latest policy denial in the run snapshot after event retention removes its event", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const { runtime } = fixture({ now: () => now, eventRetentionDays: 1 });
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "retained-policy-denial",
      requestHash: hash("retained-policy-denial"),
      source: "test",
    });
    runtime.recordPolicyDenial(accepted.runId, {
      revision: "policy-revision",
      code: "POLICY_BLOCKED",
      reason: "Managed policy denied the operation.",
      scope: "tool.execute",
      sources: [],
    });
    const persisted = runtime.getRun(accepted.runId).lastPolicyDenial;

    now = new Date("2026-01-03T00:00:00.000Z");
    runtime.cleanup();

    expect(runtime.listEvents().events).toEqual([]);
    expect(runtime.getRun(accepted.runId).lastPolicyDenial).toEqual(persisted);
  });

  it("rejects policy denial metadata for a missing run without recreating it", () => {
    const { database, runtime } = fixture();

    expect(() =>
      runtime.recordPolicyDenial("missing-run", {
        revision: "policy-revision",
        code: "POLICY_BLOCKED",
        reason: "Managed policy denied the operation.",
        scope: "tool.execute",
      }),
    ).toThrow(RuntimeNotFoundError);
    expect(
      database.prepare("select 1 from runtime_runs where id = ?").get("missing-run"),
    ).toBeUndefined();
    expect(
      database.prepare("select 1 from runtime_events where run_id = ?").get("missing-run"),
    ).toBeUndefined();
  });

  it("adds the policy denial column to an existing schema 11 database in place", () => {
    const { database, repository } = fixture();
    database.exec("alter table runtime_runs drop column policy_denial_json");
    expect(
      (
        database.prepare("pragma table_info(runtime_runs)").all() as Array<Record<string, unknown>>
      ).some((column) => column.name === "policy_denial_json"),
    ).toBe(false);

    const repaired = new RuntimeService(database, repository);

    expect(
      (
        database.prepare("pragma table_info(runtime_runs)").all() as Array<Record<string, unknown>>
      ).some((column) => column.name === "policy_denial_json"),
    ).toBe(true);
    expect(database.prepare("pragma user_version").get()?.user_version).toBe(11);
    repaired.recordPolicyDenial(
      repaired.admitTurn({
        sessionId: "session-1",
        idempotencyKey: "repaired-schema-turn",
        requestHash: hash("repaired-schema"),
        source: "test",
      }).runId,
      {
        revision: "policy-revision",
        code: "POLICY_BLOCKED",
        reason: "Managed policy denied the operation.",
        scope: "tool.execute",
      },
    );
  });

  it("keeps the first terminal state and does not revive it from late events", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const { runtime } = fixture({ now: () => now });
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "terminal-turn",
      requestHash: hash("terminal"),
      source: "test",
    });
    runtime.markPreparing(accepted.runId);
    runtime.recordControl(accepted.sessionId, accepted.runId, "waiting_user", "Need input");
    expect(runtime.getRun(accepted.runId).status).toBe("waiting_user");

    runtime.recordEvent({
      type: "run_completed",
      sessionId: "session-1",
      runId: accepted.runId,
    });
    const completedAt = runtime.getRun(accepted.runId).completedAt;
    now = new Date("2026-01-01T00:05:00.000Z");
    runtime.recordEvent({
      type: "run_started",
      sessionId: "session-1",
      runId: accepted.runId,
    });
    runtime.recordEvent({
      type: "run_failed",
      sessionId: "session-1",
      runId: accepted.runId,
      error: "late failure",
    });
    runtime.recordControl(accepted.sessionId, accepted.runId, "running", "late resume");

    expect(runtime.getRun(accepted.runId)).toMatchObject({
      status: "completed",
      completedAt,
    });
  });

  it("keeps blocked_policy terminal when cleanup later emits run_failed", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "blocked-turn",
      requestHash: hash("blocked"),
      source: "test",
    });
    runtime.transitionRun(accepted.runId, "running", null);
    const blocked = runtime.transitionRun(
      accepted.runId,
      "blocked_policy",
      "Managed policy denied the request.",
    );
    runtime.recordEvent({
      type: "run_failed",
      sessionId: accepted.sessionId,
      runId: accepted.runId,
      error: "Cleanup failed after policy denial.",
    });

    expect(runtime.getRun(accepted.runId)).toMatchObject({
      status: "blocked_policy",
      terminalReason: "Managed policy denied the request.",
      completedAt: blocked.completedAt,
    });
  });

  it("does not regress a running run back to accepted or preparing", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "monotonic-turn",
      requestHash: hash("monotonic"),
      source: "test",
    });
    runtime.markPreparing(accepted.runId);
    runtime.transitionRun(accepted.runId, "running", null);
    runtime.markPreparing(accepted.runId);
    runtime.recordControl(accepted.sessionId, accepted.runId, "accepted", "late admission");

    expect(runtime.getRun(accepted.runId).status).toBe("running");
  });

  it("keeps waiting states until an explicit control transition", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "waiting-state-turn",
      requestHash: hash("waiting-state"),
      source: "test",
    });
    runtime.markPreparing(accepted.runId);
    runtime.transitionRun(accepted.runId, "waiting_approval", "Approval required.");

    runtime.recordEvent({
      type: "activity",
      activity: {
        id: "parallel-activity",
        sessionId: accepted.sessionId,
        runId: accepted.runId,
        toolName: "read_file",
        kind: "read",
        title: "Parallel read",
        detail: "Another tool remains active.",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: null,
        durationMs: null,
        fileChange: null,
      },
    });
    expect(runtime.getRun(accepted.runId).status).toBe("waiting_approval");

    runtime.recordControl(accepted.sessionId, accepted.runId, "waiting_user", "Need input.");
    runtime.recordEvent({
      type: "assistant_delta",
      sessionId: accepted.sessionId,
      runId: accepted.runId,
      text: "temporary output",
    });
    expect(runtime.getRun(accepted.runId).status).toBe("waiting_user");

    runtime.transitionRun(accepted.runId, "running", null);
    expect(runtime.getRun(accepted.runId).status).toBe("running");
  });

  it("preserves terminal state when an oversized late event falls back to control replay", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "oversized-turn",
      requestHash: hash("oversized"),
      source: "test",
    });
    runtime.recordEvent({
      type: "run_completed",
      sessionId: "session-1",
      runId: accepted.runId,
    });

    runtime.recordEvent({
      type: "run_failed",
      sessionId: "session-1",
      runId: accepted.runId,
      error: "x".repeat(1_100_000),
    });

    expect(runtime.getRun(accepted.runId).status).toBe("completed");
    expect(runtime.listEvents({ runId: accepted.runId }).events.at(-1)?.event).toMatchObject({
      type: "runtime.status",
      status: "completed",
    });
  });

  it("keeps token deltas transient while preserving replayable committed messages", () => {
    const { runtime } = fixture();
    const notifications: Array<{ eventId: number | null; type: string }> = [];
    const unsubscribe = runtime.subscribe((event) =>
      notifications.push({ eventId: event.eventId, type: event.type }),
    );
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "turn-1",
      requestHash: hash("hello"),
      source: "test",
    });
    const delta = runtime.recordEvent({
      type: "assistant_delta",
      sessionId: "session-1",
      runId: accepted.runId,
      text: "temporary",
    });
    try {
      expect(delta.eventId).toBeNull();
      expect(notifications).toContainEqual({ eventId: null, type: "assistant_delta" });
      expect(runtime.listEvents().events).toEqual([
        expect.objectContaining({
          runId: accepted.runId,
          type: "runtime.status",
          event: expect.objectContaining({ status: "accepted" }),
        }),
      ]);
    } finally {
      unsubscribe();
    }
  });

  it("derives session and run identity from activity events", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "activity-turn",
      requestHash: hash("activity"),
      source: "test",
    });
    const envelope = runtime.recordEvent({
      type: "activity",
      activity: {
        id: "activity-1",
        sessionId: "session-1",
        runId: accepted.runId,
        toolName: "read_file",
        kind: "read",
        title: "Read fixture",
        detail: "Fixture detail",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1_000,
        fileChange: null,
      },
    });

    expect(envelope).toMatchObject({
      sessionId: "session-1",
      runId: accepted.runId,
      type: "activity",
    });
    expect(runtime.listEvents({ runId: accepted.runId }).events).toContainEqual(envelope);
  });

  it("reports an expired cursor after retention removes the beginning of the log", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const { runtime } = fixture({ now: () => now });
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "turn-1",
      requestHash: hash("hello"),
      source: "test",
    });
    runtime.recordEvent({
      type: "run_started",
      sessionId: "session-1",
      runId: accepted.runId,
    });
    const firstCursor = runtime.listEvents().events[0]?.eventId ?? 0;
    runtime.recordEvent({
      type: "usage",
      sessionId: "session-1",
      runId: accepted.runId,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });
    now = new Date("2026-03-01T00:00:00.000Z");
    runtime.recordEvent({
      type: "run_completed",
      sessionId: "session-1",
      runId: accepted.runId,
    });
    runtime.cleanup();

    expect(firstCursor).toBeGreaterThan(0);
    expect(runtime.listEvents().events.map((entry) => [entry.eventId, entry.createdAt])).toEqual([
      [4, now.toISOString()],
    ]);
    expect(() => runtime.listEvents({ after: firstCursor })).toThrow(RuntimeCursorExpiredError);
  });

  it("reports an expired cursor when retention removes the complete event log", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const { runtime } = fixture({ now: () => now });
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "turn-1",
      requestHash: hash("hello"),
      source: "test",
    });
    runtime.recordEvent({
      type: "run_started",
      sessionId: "session-1",
      runId: accepted.runId,
    });
    const cursor = runtime.listEvents().cursor;

    now = new Date("2026-03-01T00:00:00.000Z");
    runtime.cleanup();

    expect(runtime.listEvents().events).toEqual([]);
    expect(() => runtime.listEvents({ after: cursor })).toThrow(RuntimeCursorExpiredError);
  });

  it("reports an expired filtered cursor when one run's events are removed", () => {
    const { database, runtime } = fixture();
    const first = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "filtered-first",
      requestHash: hash("filtered-first"),
      source: "test",
    });
    const second = runtime.admitTurn({
      sessionId: "session-2",
      idempotencyKey: "filtered-second",
      requestHash: hash("filtered-second"),
      source: "test",
    });
    runtime.recordEvent({
      type: "run_started",
      sessionId: first.sessionId,
      runId: first.runId,
    });
    const secondStarted = runtime.recordEvent({
      type: "run_started",
      sessionId: second.sessionId,
      runId: second.runId,
    });
    runtime.recordEvent({
      type: "run_completed",
      sessionId: first.sessionId,
      runId: first.runId,
    });

    database.prepare("delete from runtime_events where run_id = ?").run(first.runId);

    expect(() => runtime.listEvents({ runId: first.runId, after: 2 })).toThrow(
      RuntimeCursorExpiredError,
    );
    expect(() => runtime.listEvents({ sessionId: first.sessionId, after: 2 })).toThrow(
      RuntimeCursorExpiredError,
    );
    expect(runtime.listEvents({ runId: second.runId, after: 2 }).events).toEqual([secondStarted]);
  });

  it("accepts a filtered cursor after the latest run event", () => {
    const { runtime } = fixture();
    const first = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "filtered-latest-first",
      requestHash: hash("filtered-latest-first"),
      source: "test",
    });
    const second = runtime.admitTurn({
      sessionId: "session-2",
      idempotencyKey: "filtered-latest-second",
      requestHash: hash("filtered-latest-second"),
      source: "test",
    });
    runtime.recordEvent({
      type: "run_started",
      sessionId: first.sessionId,
      runId: first.runId,
    });
    runtime.recordEvent({
      type: "run_started",
      sessionId: second.sessionId,
      runId: second.runId,
    });
    const latest = runtime.recordEvent({
      type: "run_completed",
      sessionId: first.sessionId,
      runId: first.runId,
    });

    expect(runtime.listEvents({ runId: first.runId, after: latest.eventId ?? 0 })).toEqual({
      events: [],
      cursor: latest.eventId,
      hasMore: false,
    });
  });

  it("reports an expired filtered cursor when an earlier run event was removed", () => {
    const { database, runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "filtered-middle",
      requestHash: hash("filtered-middle"),
      source: "test",
    });
    const first = runtime.recordEvent({
      type: "run_started",
      sessionId: accepted.sessionId,
      runId: accepted.runId,
    });
    runtime.recordEvent({
      type: "run_completed",
      sessionId: accepted.sessionId,
      runId: accepted.runId,
    });

    database.prepare("delete from runtime_events where event_id = ?").run(first.eventId);

    expect(() => runtime.listEvents({ runId: accepted.runId, after: 0 })).toThrow(
      RuntimeCursorExpiredError,
    );
  });

  it("recovers unfinished runs as interrupted without replaying them", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "turn-1",
      requestHash: hash("hello"),
      source: "test",
    });
    runtime.markPreparing(accepted.runId);

    expect(runtime.recoverInterruptedRuns()).toBe(1);
    expect(runtime.getRun(accepted.runId)).toMatchObject({
      status: "interrupted",
      terminalReason: "Application restarted before the run settled.",
    });
    expect(runtime.recoverInterruptedRuns()).toBe(0);
  });

  it("persists the delegated child run on its accepted parent run", () => {
    const { runtime } = fixture();
    const parent = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "parent-turn",
      requestHash: hash("parent"),
      source: "coordination",
    });
    expect(runtime.linkDelegatedRun(parent.runId, "child-run")).toMatchObject({
      runId: parent.runId,
      delegatedRunId: "child-run",
    });
    expect(runtime.getRun(parent.runId).delegatedRunId).toBe("child-run");
    expect(runtime.linkDelegatedRun(parent.runId, "child-run").delegatedRunId).toBe("child-run");
    expect(() => runtime.linkDelegatedRun(parent.runId, "different-child")).toThrow(
      /already linked/,
    );
  });

  it("persists UI-only runtime updates without changing the run state", () => {
    const { runtime } = fixture();
    const accepted = runtime.admitTurn({
      sessionId: "session-1",
      idempotencyKey: "ui-turn",
      requestHash: hash("ui"),
      source: "test",
    });
    runtime.recordEvent({
      type: "run_started",
      sessionId: "session-1",
      runId: accepted.runId,
    });
    runtime.recordEvent({
      type: "runtime_run_updated",
      sessionId: "session-1",
      runId: accepted.runId,
      run: runtime.getRun(accepted.runId),
    } as unknown as ChatStreamEvent);

    expect(runtime.getRun(accepted.runId).status).toBe("running");
    expect(runtime.listEvents({ runId: accepted.runId }).events.at(-1)?.type).toBe(
      "runtime_run_updated",
    );
  });

  it("returns the final persisted message and provider references in a snapshot", () => {
    const finalMessage: SessionMessage = {
      id: "final-message",
      sessionId: "session-1",
      seq: 1,
      role: "assistant",
      parts: [
        { type: "text", text: "Final answer" },
        {
          type: "responses_state",
          providerId: "provider-1",
          modelId: "model-1",
          endpointKey: "responses-primary",
          items: [
            {
              type: "reasoning",
              id: "reasoning-1",
              encrypted_content: "opaque-provider-reference",
            },
          ],
        },
        {
          type: "tool_result",
          callId: "call-1",
          output: "[large output retained separately]",
          isError: false,
          outcome: {
            status: "success",
            effect: "confirmed",
            retryable: false,
            codes: [],
            validation: { status: "validated", source: "builtin" },
            evidence: [
              {
                kind: "recovery",
                summary: "Full output is available through the host recovery reference.",
                digest: "sha256:fixture",
              },
            ],
          },
        },
      ],
      createdAt: "2026-01-01T00:00:02.000Z",
    };
    const { runtime } = fixture({ messages: [finalMessage] });

    expect(runtime.snapshot("session-1").messages).toEqual([finalMessage]);
  });

  it("reports host capability availability injected after construction", () => {
    const { runtime } = fixture();
    expect(runtime.capabilities()).toMatchObject({
      policy: false,
      taskClaims: false,
      officeReceipts: false,
    });
    runtime.setCapabilities({
      policy: true,
      taskClaims: true,
      officeReceipts: true,
    });
    expect(runtime.capabilities()).toMatchObject({
      policy: true,
      taskClaims: true,
      officeReceipts: true,
    });
  });
});
