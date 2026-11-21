import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "../../shared/domain";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { RunSteeringService } from "./run-steering-service";

describe("run steering persistence", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;
  let sessionId: string;
  let events: ChatStreamEvent[];
  let steering: RunSteeringService;

  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
    sessionId = repository.insertSession({
      title: "Steering fixture",
      providerId: null,
      modelId: null,
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    }).id;
    events = [];
    steering = new RunSteeringService(repository, (event) => events.push(event));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  it("rejects corrupted JSON without overwriting its original bytes", () => {
    const key = `runSteering.v1.${sessionId}`;
    const raw = "{ corrupt steering record";
    database
      .prepare("insert into app_settings (key, value_json, updated_at) values (?, ?, ?)")
      .run(key, raw, new Date().toISOString());

    expect(() => steering.get(sessionId)).toThrow(/损坏/);
    expect(() => steering.register(sessionId, "run-1", new AbortController().signal)).toThrow(
      /损坏/,
    );
    expect(() =>
      steering.enqueue({ sessionId, runId: "run-1", requestId: "request-1", text: "Keep" }),
    ).toThrow(/损坏/);
    expect(database.prepare("select value_json from app_settings where key = ?").get(key)).toEqual({
      value_json: raw,
    });
  });

  it("recovers orphaned pending guidance and retains it alongside the next run", () => {
    steering.register(sessionId, "run-1", new AbortController().signal);
    const previous = steering.enqueue({
      sessionId,
      runId: "run-1",
      requestId: "request-1",
      text: "Recover me",
    });
    const restarted = new RunSteeringService(repository, (event) => events.push(event));
    expect(restarted.get(sessionId)).toMatchObject({
      runId: "run-1",
      accepting: false,
      messages: [{ id: previous.messageId, text: "Recover me", status: "unapplied" }],
    });
    expect(restarted.get(sessionId)?.messages[0]?.reason).toBeTruthy();

    restarted.register(sessionId, "run-2", new AbortController().signal);
    expect(restarted.get(sessionId)).toMatchObject({
      runId: "run-2",
      accepting: true,
      messages: [{ id: previous.messageId, text: "Recover me", status: "unapplied" }],
    });
    expect(restarted.pending(sessionId, "run-2")).toEqual([]);
  });

  it("closes the acceptance gate even when final persistence fails", () => {
    steering.register(sessionId, "run-1", new AbortController().signal);
    steering.enqueue({ sessionId, runId: "run-1", requestId: "request-1", text: "Pending" });
    const failure = vi.spyOn(repository, "setSetting").mockImplementation(() => {
      throw new Error("injected storage failure");
    });
    expect(() => steering.close(sessionId, "run-1", "stopped")).toThrow("injected storage failure");
    failure.mockRestore();
    expect(() =>
      steering.enqueue({ sessionId, runId: "run-1", requestId: "request-2", text: "Too late" }),
    ).toThrow();
    expect(steering.get(sessionId)).toMatchObject({
      accepting: false,
      messages: [{ text: "Pending", status: "unapplied" }],
    });
  });

  it("rolls back message history and steering status together on delivery failure", () => {
    steering.register(sessionId, "run-1", new AbortController().signal);
    const receipt = steering.enqueue({
      sessionId,
      runId: "run-1",
      requestId: "request-1",
      text: "Do not lose this",
    });
    const failure = vi.spyOn(repository, "setSetting").mockImplementation(() => {
      throw new Error("injected storage failure");
    });
    expect(() => steering.deliver(sessionId, "run-1", [receipt.messageId])).toThrow(
      "injected storage failure",
    );
    failure.mockRestore();
    expect(repository.getMessages(sessionId)).toEqual([]);
    expect(steering.pending(sessionId, "run-1")).toMatchObject([
      { id: receipt.messageId, status: "pending" },
    ]);
    expect(events.filter((event) => event.type === "user_message")).toEqual([]);
  });
});
