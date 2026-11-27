import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuntimeService } from "../runtime/runtime-service";
import { openDatabase } from "./database";
import { Repository } from "./repository";

function createSession(repository: Repository, title = "Runtime fixture") {
  return repository.insertSession({
    title,
    providerId: null,
    modelId: null,
    agentProfileId: "primary",
    workspacePath: "C:\\Fixture",
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
}

describe("schema 11 repository integration", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;

  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
  });

  afterEach(() => database.close());

  it("preserves MCP outputSchema through status persistence and reload", () => {
    const outputSchema = {
      type: "object",
      properties: {
        value: { type: "number" },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["value"],
      additionalProperties: false,
    };
    const server = repository.insertMcpServer({
      name: "Structured fixture",
      description: "",
      transport: "stdio",
      command: "node",
      args: [],
      cwd: "C:\\Fixture",
      url: "",
      timeoutMs: 30_000,
      enabled: true,
      builtin: false,
      headerKeys: [],
      envKeys: [],
      secretRef: null,
    });

    repository.updateMcpServerStatus(server.id, {
      status: "connected",
      tools: [
        {
          name: "structured_tool",
          title: "Structured tool",
          description: "Fixture",
          readOnly: true,
          parameters: { type: "object", properties: {} },
          outputSchema,
        },
      ],
    });

    expect(repository.getMcpServer(server.id)?.tools).toEqual([
      expect.objectContaining({ name: "structured_tool", outputSchema }),
    ]);
  });

  it("prefers a runtime run snapshot and falls back to legacy trajectory state", () => {
    const session = createSession(repository);
    repository.appendTrajectoryEvent({
      sessionId: session.id,
      runId: "legacy-run",
      type: "run_started",
      summary: "Legacy run",
      payload: {},
    });
    database
      .prepare(
        `insert into runtime_runs (
           id, session_id, status, source, created_at, started_at, completed_at, updated_at
         ) values (?, ?, 'completed', 'desktop', ?, ?, ?, ?)`,
      )
      .run(
        "runtime-run",
        session.id,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:01.000Z",
        "2026-01-01T00:00:09.000Z",
        "2026-01-01T00:00:10.000Z",
      );

    expect(repository.latestSessionRun(session.id)).toEqual({
      sessionId: session.id,
      runId: "runtime-run",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: "2026-01-01T00:00:09.000Z",
      status: "completed",
    });

    database.prepare("delete from runtime_runs where id = ?").run("runtime-run");
    expect(repository.latestSessionRun(session.id)).toMatchObject({
      sessionId: session.id,
      runId: "legacy-run",
      status: "running",
    });
  });

  it("forks a plan without live claims, resets running steps and advances generation", () => {
    const source = createSession(repository, "Plan source");
    repository.appendMessage({
      sessionId: source.id,
      role: "user",
      parts: [{ type: "text", text: "Continue the plan" }],
    });
    const timestamp = "2026-01-01T00:00:00.000Z";
    repository.replaceSessionTodos(
      source.id,
      [
        {
          id: "pending",
          content: "Pending step",
          status: "pending",
          priority: "high",
          updatedAt: timestamp,
        },
        {
          id: "running",
          content: "Running step",
          status: "in_progress",
          priority: "medium",
          updatedAt: timestamp,
        },
        {
          id: "done",
          content: "Finished step",
          status: "completed",
          priority: "low",
          updatedAt: timestamp,
        },
      ],
      {
        revision: 7,
        generation: 4,
        paused: false,
        reviewRequired: true,
        order: ["pending", "running", "done"],
        dependencies: { running: ["pending"], done: ["running"] },
        breakpoints: ["running"],
        updatedAt: timestamp,
        activeClaims: [{ id: "leased-claim" }],
      },
    );
    database
      .prepare("insert into plan_generations (session_id, generation, updated_at) values (?, ?, ?)")
      .run(source.id, 4, timestamp);
    database
      .prepare(
        `insert into plan_step_claims (
           id, session_id, generation, step_id, owner_session_id, owner_run_id,
           agent_profile_id, status, lease_until, heartbeat_at, attempt, revision,
           claim_version, summary, evidence_json, created_at, updated_at, completed_at
         ) values (?, ?, 4, 'running', ?, 'run-source', 'primary', 'active', ?, ?, 1, 7,
           1, '', '[]', ?, ?, null)`,
      )
      .run(
        "leased-claim",
        source.id,
        source.id,
        "2026-01-01T00:05:00.000Z",
        timestamp,
        timestamp,
        timestamp,
      );

    const fork = repository.forkSession(source.id);

    expect(repository.listSessionTodos(fork.id)).toEqual([
      expect.objectContaining({ id: "pending", status: "pending" }),
      expect.objectContaining({ id: "running", status: "pending" }),
      expect.objectContaining({ id: "done", status: "completed" }),
    ]);
    expect(repository.getSetting(`workbench.plan.${fork.id}`)).toMatchObject({
      revision: 7,
      generation: 5,
      reviewRequired: true,
      order: ["pending", "running", "done"],
      dependencies: { running: ["pending"], done: ["running"] },
      breakpoints: ["running"],
    });
    expect(repository.getSetting(`workbench.plan.${fork.id}`)).not.toHaveProperty("activeClaims");
    expect(
      database.prepare("select generation from plan_generations where session_id = ?").get(fork.id)
        ?.generation,
    ).toBe(5);
    expect(
      database
        .prepare("select count(*) as count from plan_step_claims where session_id = ?")
        .get(fork.id)?.count,
    ).toBe(0);
    expect(
      database
        .prepare("select count(*) as count from plan_step_claims where session_id = ?")
        .get(source.id)?.count,
    ).toBe(1);
  });

  it("persists a deleted-session tombstone without recreating the session or a late run", () => {
    const session = createSession(repository);
    const runtime = new RuntimeService(database, repository);
    repository.removeSession(session.id);

    expect(() =>
      runtime.recordEvent({ type: "session_removed", sessionId: session.id }),
    ).not.toThrow();

    const tombstone = database
      .prepare("select session_id, payload_json from runtime_events where type = 'session_removed'")
      .get() as { session_id: string | null; payload_json: string } | undefined;
    expect(tombstone?.session_id).toBeNull();
    expect(JSON.parse(tombstone?.payload_json ?? "{}")).toMatchObject({
      type: "session_removed",
      sessionId: session.id,
    });

    expect(() =>
      runtime.recordEvent({
        type: "run_started",
        sessionId: session.id,
        runId: "late-run",
      }),
    ).toThrow("Session was not found.");
    expect(database.prepare("select 1 from sessions where id = ?").get(session.id)).toBeUndefined();
    expect(
      database.prepare("select 1 from runtime_runs where id = ?").get("late-run"),
    ).toBeUndefined();
  });
});
