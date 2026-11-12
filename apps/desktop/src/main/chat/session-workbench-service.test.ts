import { describe, expect, it, vi } from "vitest";
import type { SessionTodo } from "../../shared/domain";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { SessionWorkbenchService } from "./session-workbench-service";

function fixture() {
  const db = openDatabase(":memory:");
  const repository = new Repository(db);
  const session = repository.insertSession({
    title: "Plan",
    providerId: null,
    modelId: null,
    agentProfileId: "plan",
    workspacePath: null,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
  const emit = vi.fn();
  return { db, repository, session, emit, service: new SessionWorkbenchService(repository, emit) };
}
const step = (id: string, dependsOn: string[] = []): SessionTodo => ({
  id,
  content: `Step ${id}`,
  status: "pending",
  priority: "medium",
  updatedAt: "",
  dependsOn,
});

describe("persistent structured plans", () => {
  it("clears only terminal active plans on the next turn and retains saved project plans and recovery", () => {
    const f = fixture();
    try {
      f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [
          { ...step("done"), status: "completed" },
          { ...step("old"), status: "cancelled" },
        ],
        paused: true,
        breakpoints: ["done"],
      });
      const saved = f.service.saveProjectPlan(f.session.id, "History");
      f.repository.setSetting(`workbench.recovery.${f.session.id}`, { uncertain: ["write"] });
      const cleared = f.service.prepareTurn(f.session.id);
      expect(cleared).toMatchObject({
        steps: [],
        paused: false,
        breakpoints: [],
        reviewRequired: false,
        revision: 2,
      });
      expect(f.service.listProjectPlans(null)[0]?.id).toBe(saved.id);
      expect(f.repository.getSetting(`workbench.recovery.${f.session.id}`)).toEqual({
        uncertain: ["write"],
      });
      expect(f.service.prepareTurn(f.session.id).revision).toBe(2);
      const fresh = f.service.update({
        sessionId: f.session.id,
        revision: 2,
        steps: [step("new")],
      });
      expect(fresh.steps.map((item) => item.id)).toEqual(["new"]);
    } finally {
      f.db.close();
    }
  });
  it("requires model review on ordinary new turns, preserves paused progress and rejects stale decisions", () => {
    const f = fixture();
    try {
      const original = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [
          { ...step("done"), status: "completed" },
          { ...step("active", ["done"]), status: "in_progress" },
        ],
        paused: true,
        breakpoints: ["active"],
      });
      const reviewing = f.service.prepareTurn(f.session.id);
      const withoutTime = (plan: typeof original) =>
        plan.steps.map(({ updatedAt: _time, ...item }) => item);
      expect(reviewing).toMatchObject({ paused: true, reviewRequired: true });
      expect(withoutTime(reviewing)).toEqual(withoutTime(original));
      expect(() =>
        f.service.review(f.session.id, original.revision, "discard", "Unrelated request"),
      ).toThrow("已更新");
      const kept = f.service.review(
        f.session.id,
        reviewing.revision,
        "keep",
        "Continue unfinished work",
      );
      expect(kept).toMatchObject({ paused: false, reviewRequired: false, breakpoints: ["active"] });
      expect(withoutTime(kept)).toEqual(withoutTime(original));
      const resumed = f.service.prepareTurn(f.session.id, true);
      expect(resumed).toEqual(kept);
      const pendingReview = f.service.prepareTurn(f.session.id);
      expect(pendingReview.reviewRequired).toBe(true);
      const explicitResume = f.service.prepareTurn(f.session.id, true);
      expect(explicitResume.reviewRequired).toBe(false);
      expect(withoutTime(explicitResume)).toEqual(withoutTime(original));
      const changed = f.service.prepareTurn(f.session.id);
      const cleared = f.service.review(
        f.session.id,
        changed.revision,
        "discard",
        "User starts a different task",
      );
      expect(cleared).toMatchObject({
        steps: [],
        paused: false,
        breakpoints: [],
        reviewRequired: false,
      });
      expect(() => f.service.review(f.session.id, cleared.revision, "maybe", "unclear")).toThrow();
      expect(() =>
        f.service.review(f.session.id, cleared.revision, ["discard"], "Task changed"),
      ).toThrow();
      expect(() => f.service.review(f.session.id, cleared.revision, "keep", "")).toThrow();
    } finally {
      f.db.close();
    }
  });
  it("retains order, user edits, dependencies, breakpoints and pause state across service restart and fork", () => {
    const f = fixture();
    try {
      f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("a"), step("b", ["a"])],
        breakpoints: ["b"],
      });
      const restarted = new SessionWorkbenchService(f.repository, f.emit);
      const next = restarted.update(
        {
          sessionId: f.session.id,
          revision: 1,
          steps: [
            { ...step("a"), status: "completed" },
            { ...step("b", ["a"]), status: "in_progress" },
          ],
        },
        true,
      );
      expect(next.paused).toBe(true);
      expect(next.steps.map((s) => s.id)).toEqual(["a", "b"]);
      expect(() => restarted.update({ sessionId: f.session.id, revision: 0, steps: [] })).toThrow(
        "已更新",
      );
      const fork = f.repository.forkSession(f.session.id);
      expect(restarted.state(fork.id).plan).toEqual(next);
      restarted.update({ sessionId: f.session.id, revision: 2, paused: false });
      expect(restarted.state(fork.id).plan.paused).toBe(true);
      f.repository.removeSession(f.session.id);
      expect(f.repository.getSetting(`workbench.plan.${f.session.id}`)).toBeNull();
    } finally {
      f.db.close();
    }
  });
  it("rejects cyclic, missing or unfinished dependencies and duplicate step IDs without altering the saved plan", () => {
    const f = fixture();
    try {
      for (const steps of [
        [step("a", ["b"]), step("b", ["a"])],
        [step("a", ["missing"])],
        [step("a"), step("a")],
        [step("a"), { ...step("b", ["a"]), status: "in_progress" as const }],
      ])
        expect(() => f.service.update({ sessionId: f.session.id, revision: 0, steps })).toThrow();
      expect(f.service.state(f.session.id).plan.steps).toEqual([]);
    } finally {
      f.db.close();
    }
  });
  it("saves project plans independently and attaches preserved or reset progress to a different same-project conversation", () => {
    const f = fixture();
    try {
      f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [{ ...step("a"), status: "completed" }, step("b", ["a"])],
        breakpoints: ["b"],
      });
      const saved = f.service.saveProjectPlan(f.session.id, "Reusable delivery");
      const target = f.repository.insertSession({
        title: "Other conversation",
        providerId: null,
        modelId: null,
        agentProfileId: "primary",
        workspacePath: null,
        systemPrompt: "",
        reasoningLevel: null,
        permissionMode: "request_approval",
        executionMode: "host",
        patchOnly: false,
      });
      f.repository.removeSession(f.session.id);
      expect(new SessionWorkbenchService(f.repository, f.emit).listProjectPlans(null)).toHaveLength(
        1,
      );
      const bound = f.service.applyProjectPlan(target.id, saved.id, 0);
      expect(bound.steps[0]?.status).toBe("completed");
      expect(bound.breakpoints).toEqual(["b"]);
      const reset = f.service.applyProjectPlan(target.id, saved.id, 1, true);
      expect(reset.steps.every((item) => item.status === "pending")).toBe(true);
      expect(() => f.service.applyProjectPlan(target.id, saved.id, 0)).toThrow();
      f.repository.updateSession(target.id, { workspacePath: "C:\\Other" });
      expect(() => f.service.applyProjectPlan(target.id, saved.id, 2)).toThrow("同一项目");
      f.service.removeProjectPlan(saved.id);
      expect(f.service.listProjectPlans(null)).toEqual([]);
    } finally {
      f.db.close();
    }
  });
});
