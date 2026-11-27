import { describe, expect, it, vi } from "vitest";
import type { SessionTodo } from "../../shared/domain";
import { SessionWorkbenchService } from "../chat/session-workbench-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { PLAN_CLAIMS_MIGRATION_SQL } from "./plan-claim-schema";
import { PlanClaimError, PlanClaimService } from "./plan-claim-service";

function fixture() {
  const db = openDatabase(":memory:");
  db.exec(PLAN_CLAIMS_MIGRATION_SQL);
  const repository = new Repository(db);
  const session = repository.insertSession({
    title: "Claimed plan",
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
  const emit = vi.fn();
  const claims = new PlanClaimService(db, repository);
  const service = new SessionWorkbenchService(repository, emit, claims);
  return { db, repository, session, emit, claims, service };
}

const step = (
  id: string,
  status: SessionTodo["status"] = "pending",
  dependsOn: string[] = [],
): SessionTodo => ({
  id,
  content: `Step ${id}`,
  status,
  priority: "medium",
  updatedAt: "",
  dependsOn,
});

function childSession(repository: Repository, parentSessionId: string) {
  return repository.insertSession({
    title: "Plan worker",
    parentSessionId,
    providerId: null,
    modelId: null,
    agentProfileId: "general",
    workspacePath: null,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
}

describe("persistent plan claims", () => {
  it("atomically claims an eligible canonical step and rejects another owner", () => {
    const f = fixture();
    try {
      const plan = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("a"), step("b", "pending", ["a"])],
      });
      expect(plan).toMatchObject({ generation: 1, revision: 1 });
      const unrelated = f.repository.insertSession({
        title: "Unrelated root",
        providerId: null,
        modelId: null,
        agentProfileId: "general",
        workspacePath: null,
        systemPrompt: "",
        reasoningLevel: null,
        permissionMode: "request_approval",
        executionMode: "host",
        patchOnly: false,
      });
      expect(() =>
        f.claims.begin({
          sessionId: f.session.id,
          runId: "foreign",
          ownerSessionId: unrelated.id,
          agentProfileId: "general",
          stepId: "a",
          revision: plan.revision,
        }),
      ).toThrowError(/direct child/);

      const claimed = f.claims.begin({
        sessionId: f.session.id,
        runId: "run-a",
        ownerSessionId: f.session.id,
        agentProfileId: "primary",
        stepId: "a",
        revision: plan.revision,
      });
      expect(claimed.claim).toMatchObject({
        stepId: "a",
        ownerRunId: "run-a",
        status: "active",
        attempt: 1,
      });
      expect(claimed.plan.steps.find((item) => item.id === "a")?.status).toBe("in_progress");
      const child = childSession(f.repository, f.session.id);
      expect(() =>
        f.claims.begin({
          sessionId: f.session.id,
          runId: "run-b",
          ownerSessionId: child.id,
          agentProfileId: child.agentProfileId,
          stepId: "a",
          revision: plan.revision,
        }),
      ).toThrowError(/already claimed/);
      expect(() =>
        f.claims.begin({
          sessionId: f.session.id,
          runId: "run-b",
          ownerSessionId: child.id,
          agentProfileId: child.agentProfileId,
          stepId: "b",
          revision: plan.revision,
        }),
      ).toThrowError(/dependency/);
    } finally {
      f.db.close();
    }
  });

  it("blocks at breakpoints without changing the plan and renews only a live owner lease", () => {
    const f = fixture();
    try {
      const plan = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("review")],
        breakpoints: ["review"],
      });
      let error: unknown;
      try {
        f.claims.begin({
          sessionId: f.session.id,
          runId: "run",
          ownerSessionId: f.session.id,
          stepId: "review",
          revision: plan.revision,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(PlanClaimError);
      expect((error as PlanClaimError).code).toBe("breakpoint");
      expect(f.claims.listClaims(f.session.id)).toEqual([]);
      expect(f.claims.plan(f.session.id).steps[0]?.status).toBe("pending");
    } finally {
      f.db.close();
    }
  });

  it("marks an expired lease stale, never auto-releases it, and requires explicit recovery", () => {
    const f = fixture();
    try {
      const plan = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("a")],
      });
      const claimed = f.claims.begin({
        sessionId: f.session.id,
        runId: "run",
        ownerSessionId: f.session.id,
        stepId: "a",
        revision: plan.revision,
      });
      f.db
        .prepare("update plan_step_claims set lease_until = ?, heartbeat_at = ? where id = ?")
        .run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z", claimed.claim.id);
      expect(f.claims.listClaims(f.session.id)[0]?.status).toBe("stale");
      expect(() =>
        f.claims.heartbeat({ claimId: claimed.claim.id, ownerRunId: "run" }),
      ).toThrowError(/lease expired/);
      expect(() =>
        f.claims.begin({
          sessionId: f.session.id,
          runId: "new",
          ownerSessionId: childSession(f.repository, f.session.id).id,
          agentProfileId: "general",
          stepId: "a",
          revision: plan.revision,
        }),
      ).toThrowError(/already claimed/);
      expect(f.claims.listOwnerRunClaims("run")).toEqual([
        expect.objectContaining({ id: claimed.claim.id, status: "stale" }),
      ]);
      expect(() =>
        f.claims.settle({
          claimId: claimed.claim.id,
          ownerRunId: "run",
          status: "released",
          summary: "Verified the old run stopped and its effects are known.",
        }),
      ).toThrowError(/claim version/i);
      const recovered = f.claims.recover({
        sessionId: f.session.id,
        claimId: claimed.claim.id,
        expectedVersion: f.claims.getClaim(claimed.claim.id)?.claimVersion ?? 0,
        summary: "Verified the old run stopped and its effects are known.",
        evidence: ["runtime:interrupted", "inspection:read-session-files"],
      });
      expect(recovered.claim).toMatchObject({
        status: "released",
        evidence: ["runtime:interrupted", "inspection:read-session-files"],
      });
      expect(recovered.plan.steps[0]?.status).toBe("pending");
      expect(f.claims.listOwnerRunClaims("run")).toEqual([]);
    } finally {
      f.db.close();
    }
  });

  it("detects an expired lease on direct claim access so heartbeat and settle cannot revive it", () => {
    const f = fixture();
    try {
      const plan = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("a")],
      });
      const claimed = f.claims.begin({
        sessionId: f.session.id,
        runId: "run",
        ownerSessionId: f.session.id,
        stepId: "a",
        revision: plan.revision,
      });
      f.db
        .prepare("update plan_step_claims set lease_until = ? where id = ?")
        .run("2000-01-01T00:00:00.000Z", claimed.claim.id);
      const current = f.claims.getClaim(claimed.claim.id);
      expect(current).toMatchObject({ status: "stale" });
      expect(() =>
        f.claims.heartbeat({ claimId: claimed.claim.id, ownerRunId: "run" }),
      ).toThrowError(/lease expired/i);
      expect(() =>
        f.claims.settleLive({
          claimId: claimed.claim.id,
          ownerRunId: "run",
          status: "released",
          expectedVersion: current?.claimVersion ?? 0,
        }),
      ).toThrowError(/expired or no longer active/i);
    } finally {
      f.db.close();
    }
  });

  it("requires the inspected claim version for recovery and rejects a stale CAS", () => {
    const f = fixture();
    try {
      const plan = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("a")],
      });
      const claimed = f.claims.begin({
        sessionId: f.session.id,
        runId: "run",
        ownerSessionId: f.session.id,
        stepId: "a",
        revision: plan.revision,
      });
      f.db
        .prepare("update plan_step_claims set status = 'cancel_requested' where id = ?")
        .run(claimed.claim.id);
      const inspected = f.claims.getClaim(claimed.claim.id);
      expect(inspected?.status).toBe("cancel_requested");
      f.db
        .prepare("update plan_step_claims set claim_version = claim_version + 1 where id = ?")
        .run(claimed.claim.id);
      expect(() =>
        f.claims.recover({
          sessionId: f.session.id,
          claimId: claimed.claim.id,
          expectedVersion: inspected?.claimVersion ?? 0,
          summary: "Inspected the stopped run and its effects.",
        }),
      ).toThrowError(/claim changed/i);
      const current = f.claims.getClaim(claimed.claim.id);
      const recovered = f.claims.recover({
        sessionId: f.session.id,
        claimId: claimed.claim.id,
        expectedVersion: current?.claimVersion ?? 0,
        summary: "Inspected the stopped run and its effects.",
      });
      expect(recovered.claim.status).toBe("released");
    } finally {
      f.db.close();
    }
  });

  it("lets a legacy update_todos call complete only its own untouched claimed step", () => {
    const f = fixture();
    try {
      const plan = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("a"), step("b")],
      });
      expect(() =>
        f.service.updateWithOwner(
          {
            sessionId: f.session.id,
            revision: plan.revision,
            steps: [step("a", "in_progress"), step("b")],
          },
          "run",
        ),
      ).toThrowError(/begin_plan_step|active claim/i);
      f.claims.begin({
        sessionId: f.session.id,
        runId: "run",
        ownerSessionId: f.session.id,
        stepId: "a",
        revision: plan.revision,
      });
      const current = f.service.state(f.session.id).plan;
      expect(() =>
        f.service.updateWithOwner(
          {
            sessionId: f.session.id,
            revision: current.revision,
            steps: current.steps.map((item) =>
              item.id === "a" ? { ...item, content: "Changed under owner" } : item,
            ),
          },
          "run",
        ),
      ).toThrowError(/cannot change content/);
      const completed = f.service.updateWithOwner(
        {
          sessionId: f.session.id,
          revision: current.revision,
          steps: current.steps.map((item) =>
            item.id === "a" ? { ...item, status: "completed" as const } : item,
          ),
        },
        "run",
      );
      expect(completed.activeClaims).toEqual([]);
      expect(completed.steps.find((item) => item.id === "a")?.status).toBe("completed");
    } finally {
      f.db.close();
    }
  });

  it("does not let another run complete a step whose previous claim is stale", () => {
    const f = fixture();
    try {
      const plan = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("a")],
      });
      const claim = f.claims.begin({
        sessionId: f.session.id,
        runId: "old-run",
        ownerSessionId: f.session.id,
        stepId: "a",
        revision: plan.revision,
      }).claim;
      f.db
        .prepare("update plan_step_claims set lease_until = ? where id = ?")
        .run("2000-01-01T00:00:00.000Z", claim.id);
      const current = f.service.state(f.session.id).plan;
      const currentStep = current.steps.find((item) => item.id === "a");
      expect(currentStep?.status).toBe("in_progress");
      if (!currentStep) throw new Error("Expected the claimed step to remain present.");
      expect(() =>
        f.service.updateWithOwner(
          {
            sessionId: f.session.id,
            revision: current.revision,
            steps: [{ ...currentStep, status: "completed" }],
          },
          "new-run",
        ),
      ).toThrowError(/active claim|stale|inspect|recover/i);
      expect(f.service.state(f.session.id).plan.steps[0]?.status).toBe("in_progress");
      expect(f.claims.getClaim(claim.id)?.status).toBe("stale");
    } finally {
      f.db.close();
    }
  });

  it("does not report settlement when the active claim CAS update is lost", () => {
    const f = fixture();
    try {
      const plan = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("a")],
      });
      const claimed = f.claims.begin({
        sessionId: f.session.id,
        runId: "run",
        ownerSessionId: f.session.id,
        stepId: "a",
        revision: plan.revision,
      });
      f.db.exec(`
        create trigger ignore_claim_settlement
        before update on plan_step_claims
        when new.status = 'released'
        begin
          select raise(ignore);
        end;
      `);
      expect(() =>
        f.claims.settle({
          claimId: claimed.claim.id,
          ownerRunId: "run",
          status: "released",
          summary: "This update must be rejected when CAS changes are lost.",
        }),
      ).toThrowError(/changed while it was being settled/i);
      expect(f.claims.getClaim(claimed.claim.id)).toMatchObject({
        status: "active",
        claimVersion: claimed.claim.claimVersion,
      });
    } finally {
      f.db.close();
    }
  });

  it("settles with the caller version after a heartbeat advances the claim", () => {
    const f = fixture();
    try {
      const plan = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("a")],
      });
      const claimed = f.claims.begin({
        sessionId: f.session.id,
        runId: "run",
        ownerSessionId: f.session.id,
        stepId: "a",
        revision: plan.revision,
      }).claim;
      const inspectedVersion = claimed.claimVersion;
      const heartbeat = f.claims.heartbeat({
        claimId: claimed.id,
        ownerRunId: "run",
      });
      expect(heartbeat.claimVersion).toBeGreaterThan(inspectedVersion);
      expect(() =>
        f.claims.settle({
          claimId: claimed.id,
          ownerRunId: "run",
          status: "completed",
          expectedVersion: inspectedVersion,
          summary: "A stale caller must not settle after heartbeat.",
        }),
      ).toThrowError(/changed while it was being settled/i);
      expect(f.claims.getClaim(claimed.id)).toMatchObject({
        status: "active",
        claimVersion: heartbeat.claimVersion,
      });

      expect(
        f.claims.settle({
          claimId: claimed.id,
          ownerRunId: "run",
          status: "completed",
          expectedVersion: heartbeat.claimVersion,
          summary: "The caller refreshed the claim version before settling.",
        }).claim,
      ).toMatchObject({ status: "completed" });
    } finally {
      f.db.close();
    }
  });

  it("advances generation on reset, strips live ownership from saved plans and rejects stale work", () => {
    const f = fixture();
    try {
      const plan = f.service.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [step("a")],
      });
      f.claims.begin({
        sessionId: f.session.id,
        runId: "run",
        ownerSessionId: f.session.id,
        stepId: "a",
        revision: plan.revision,
      });
      const snapshot = f.service.saveProjectPlan(f.session.id, "Clean snapshot");
      expect(snapshot.plan.activeClaims).toBeUndefined();
      expect(() =>
        f.service.update({
          sessionId: f.session.id,
          revision: plan.revision,
          steps: [],
        }),
      ).toThrowError(/unresolved/);
      f.claims.settleOwnerRun("run", "released");
      const cleared = f.service.update({
        sessionId: f.session.id,
        revision: f.service.state(f.session.id).plan.revision,
        steps: [],
      });
      expect(cleared.generation).toBe(2);
      const bound = f.service.applyProjectPlan(f.session.id, snapshot.id, cleared.revision);
      expect(bound.generation).toBe(3);
      const rebuilt = f.service.update({
        sessionId: f.session.id,
        revision: bound.revision,
        steps: [step("replacement")],
      });
      expect(rebuilt.generation).toBe(4);
    } finally {
      f.db.close();
    }
  });
});
