import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../storage/repository";
import { CoordinationService, type CoordinationStartInput } from "./coordination-service";

function fixture() {
  const values = new Map<string, unknown>();
  const repository = {
    getSetting: vi.fn((key: string) => values.get(key)),
    setSetting: vi.fn((key: string, value: unknown) => values.set(key, value)),
  } as unknown as Repository;
  const events: string[] = [];
  const service = new CoordinationService(repository, (_state, event) => events.push(event.title));
  return { service, events, repository, values };
}

const input: CoordinationStartInput = {
  sessionId: "session",
  runId: "run",
  goal: "Deliver",
  tasks: [
    {
      id: "task",
      label: "Implement",
      agentProfileId: "implementation-worker",
      scope: "Code",
    },
  ],
  qaAgentProfileId: "quality-verifier",
  qaCriteria: "Run tests",
};

describe("CoordinationService", () => {
  it("persists actual phases and never marks QA passed by default", () => {
    const f = fixture();
    const started = f.service.start(input);
    expect(started.phase).toBe("planned");
    expect(started.verification.status).toBe("not_run");
    expect(started.qa.status).toBe("not_run");
    expect(f.service.phase("session", "executing").phase).toBe("executing");
    expect(
      f.service.qa("session", "passed", {
        summary: "Verified",
        evidence: ["pnpm test"],
      }).qa.status,
    ).toBe("passed");
    expect(f.service.phase("session", "completed").phase).toBe("completed");
  });

  it("cancels only unfinished tasks and exposes a blocked QA state", () => {
    const f = fixture();
    f.service.start(input);
    f.service.phase("session", "executing");
    f.service.taskStatus("session", "task", "running");
    f.service.qa("session", "running");
    const cancelled = f.service.cancel("session");
    expect(cancelled?.phase).toBe("cancelled");
    expect(cancelled?.tasks[0]?.status).toBe("cancelled");
    expect(cancelled?.qa.status).toBe("blocked");
    expect(cancelled?.verification.status).toBe("blocked");
  });

  it.each(["planned", "executing", "qa"] as const)(
    "rejects a second run while the session is %s without changing its state",
    (phase) => {
      const f = fixture();
      f.service.start(input);
      if (phase !== "planned") f.service.phase(input.sessionId, phase);
      const original = f.service.state(input.sessionId);
      const eventsBefore = [...f.events];
      expect(f.service.isActive(input.sessionId)).toBe(true);

      expect(() => f.service.start({ ...input, runId: "second", goal: "Another goal" })).toThrow(
        "A coordinated run is already active for this session.",
      );
      expect(f.service.state(input.sessionId)).toEqual(original);
      expect(f.events).toEqual(eventsBefore);
      expect(f.service.start({ ...input, sessionId: "other", runId: "other" }).phase).toBe(
        "planned",
      );

      f.service.phase(input.sessionId, "failed");
      expect(f.service.isActive(input.sessionId)).toBe(false);
      expect(f.service.start({ ...input, runId: "second" }).runId).toBe("second");
    },
  );

  it.each(["planned", "executing", "qa"] as const)(
    "recovers a persisted %s run as cancelled and blocks unfinished checks on restart",
    (phase) => {
      const f = fixture();
      f.service.start({
        ...input,
        tasks: [
          ...input.tasks,
          { id: "finished", label: "Review", agentProfileId: "review", scope: "Review" },
        ],
      });
      if (phase !== "planned") f.service.phase(input.sessionId, phase);
      f.service.taskStatus(input.sessionId, "finished", "completed", { summary: "Done" });
      if (phase === "executing") {
        f.service.taskStatus(input.sessionId, "task", "running", { childSessionId: "worker" });
        f.service.verification(input.sessionId, "running", { commands: ["pnpm test"] });
      }
      if (phase === "qa") {
        f.service.verification(input.sessionId, "passed", {
          commands: ["pnpm test"],
          summary: "Tests passed",
        });
        f.service.qa(input.sessionId, "running", { childSessionId: "qa-child" });
      }

      const restarted = new CoordinationService(f.repository);
      const recovered = restarted.state(input.sessionId);
      expect(recovered?.phase).toBe("cancelled");
      expect(recovered?.runId).toBe("run");
      expect(recovered?.tasks[0]?.status).toBe("cancelled");
      expect(recovered?.tasks[1]).toMatchObject({ status: "completed", summary: "Done" });
      expect(recovered?.qa.status).toBe("blocked");
      expect(recovered?.verification.status).toBe(phase === "qa" ? "passed" : "blocked");
      if (phase === "executing") {
        expect(recovered?.tasks[0]?.childSessionId).toBe("worker");
        expect(recovered?.verification.commands).toEqual(["pnpm test"]);
      }
      if (phase === "qa") {
        expect(recovered?.verification).toMatchObject({
          commands: ["pnpm test"],
          summary: "Tests passed",
        });
        expect(recovered?.qa.childSessionId).toBe("qa-child");
      }
      expect(recovered?.tasks[0]?.completedAt).toBeTruthy();
      expect(recovered?.qa.completedAt).toBeTruthy();
      expect(f.values.get(`coordination.state.${input.sessionId}`)).toEqual(recovered);
      expect(restarted.state(input.sessionId)).toEqual(recovered);
      expect(restarted.isActive(input.sessionId)).toBe(false);
      expect(restarted.start({ ...input, runId: "after-restart" }).runId).toBe("after-restart");
    },
  );

  it("preserves finished state across restart", () => {
    const f = fixture();
    f.service.start(input);
    f.service.verification(input.sessionId, "passed", { summary: "Verified" });
    f.service.qa(input.sessionId, "passed", { summary: "Reviewed", evidence: ["pnpm test"] });
    const finished = f.service.phase(input.sessionId, "completed");

    expect(new CoordinationService(f.repository).state(input.sessionId)).toEqual(finished);
  });

  it("requires canonical plan association and persists the linked step", () => {
    const f = fixture();
    const linked = new CoordinationService(f.repository, undefined, {
      requirePlanAssociation: true,
      linkPlanTasks: () => [
        { taskId: "task", planStepId: "plan-task" },
        { taskId: "qa", planStepId: "plan-qa", kind: "qa" },
      ],
    });
    expect(linked.start(input)).toMatchObject({
      tasks: [
        {
          planStepId: "plan-task",
          status: "queued",
        },
      ],
      qa: {
        planStepId: "plan-qa",
        status: "not_run",
      },
    });
    const missing = new CoordinationService(f.repository, undefined, {
      requirePlanAssociation: true,
    });
    expect(() => missing.start({ ...input, sessionId: "other" })).toThrow("canonical plan step");
  });
});
