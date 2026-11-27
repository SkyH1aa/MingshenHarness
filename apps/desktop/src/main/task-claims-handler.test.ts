import { describe, expect, it, vi } from "vitest";
import type { AgentProfileService } from "./agents/agent-profile-service";
import type { CustomCommandService } from "./agents/custom-command-service";
import type { ProjectToolingService } from "./agents/project-tooling-service";
import { createTaskClaimsHandler } from "./app-services";
import type { ChatService } from "./chat/chat-service";
import { SessionWorkbenchService } from "./chat/session-workbench-service";
import type { McpService } from "./mcp/mcp-service";
import { ApprovalBroker } from "./permissions/approval-broker";
import { QuestionBroker } from "./permissions/question-broker";
import { RuntimeService } from "./runtime/runtime-service";
import { HeadlessServerService } from "./server/headless-server-service";
import { SessionService } from "./sessions/session-service";
import { openDatabase } from "./storage/database";
import { Repository } from "./storage/repository";
import { TrajectoryService } from "./trajectories/trajectory-service";
import { PlanClaimError, PlanClaimService } from "./workbench/plan-claim-service";

describe("task claims HTTP handler", () => {
  it("requires the exact live ChatService executor for claim and heartbeat", () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const session = repository.insertSession({
      title: "Claims executor fixture",
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
    const runtime = new RuntimeService(database, repository);
    const accepted = runtime.admitTurn({
      sessionId: session.id,
      idempotencyKey: "claims-http-live-executor",
      requestHash: "c".repeat(64),
      source: "desktop",
    });
    runtime.transitionRun(accepted.runId, "running", null);
    const planClaims = new PlanClaimService(database, repository);
    const workbench = new SessionWorkbenchService(repository, () => undefined, planClaims);
    const plan = workbench.update({
      sessionId: session.id,
      revision: 0,
      steps: [
        {
          id: "live-step",
          content: "Require a live executor",
          status: "pending",
          priority: "medium",
          updatedAt: new Date().toISOString(),
        },
        {
          id: "heartbeat-step",
          content: "Require a live heartbeat owner",
          status: "pending",
          priority: "medium",
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const isPlanClaimRunActive = vi.fn(() => false);
    const chatService = { isPlanClaimRunActive } as unknown as ChatService;
    const handler = createTaskClaimsHandler({
      planClaims,
      chatService,
      runtimeService: runtime,
      repository,
    });
    const request = { method: "POST" } as import("node:http").IncomingMessage;
    const url = new URL("http://127.0.0.1/v1/tasks/claims");
    try {
      const claimInput = {
        action: "claim",
        sessionId: session.id,
        ownerSessionId: session.id,
        runId: accepted.runId,
        stepId: "live-step",
        revision: plan.revision,
      };
      expect(handler(request, url, claimInput)).toMatchObject({
        httpStatus: 409,
        json: { code: "PLAN_CLAIM_RUN_NOT_ACTIVE" },
      });
      expect(planClaims.listClaims(session.id)).toEqual([]);
      expect(isPlanClaimRunActive).toHaveBeenCalledWith(session.id, accepted.runId);

      const claim = planClaims.begin({
        sessionId: session.id,
        runId: accepted.runId,
        ownerSessionId: session.id,
        stepId: "heartbeat-step",
        revision: plan.revision,
      }).claim;
      const before = claim.claimVersion;
      expect(
        handler(request, url, {
          action: "heartbeat",
          claimId: claim.id,
          ownerRunId: accepted.runId,
        }),
      ).toMatchObject({
        httpStatus: 409,
        json: { code: "PLAN_CLAIM_RUN_NOT_ACTIVE" },
      });
      expect(planClaims.getClaim(claim.id)?.claimVersion).toBe(before);

      isPlanClaimRunActive.mockReturnValue(true);
      expect(
        handler(request, url, {
          action: "heartbeat",
          claimId: claim.id,
          ownerRunId: accepted.runId,
        }),
      ).toMatchObject({ httpStatus: 200 });
      expect(isPlanClaimRunActive).toHaveBeenLastCalledWith(session.id, accepted.runId);
    } finally {
      database.close();
    }
  });

  it("routes guarded settlement and recovery through ChatService", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const session = repository.insertSession({
      title: "Claims API fixture",
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
    const runtime = new RuntimeService(database, repository);
    const accepted = runtime.admitTurn({
      sessionId: session.id,
      idempotencyKey: "claims-http-settle",
      requestHash: "e".repeat(64),
      source: "desktop",
    });
    runtime.transitionRun(accepted.runId, "running", null);
    const planClaims = new PlanClaimService(database, repository);
    const workbench = new SessionWorkbenchService(repository, () => undefined, planClaims);
    const plan = workbench.update({
      sessionId: session.id,
      revision: 0,
      steps: [
        {
          id: "http-step",
          content: "Exercise the guarded claims HTTP route",
          status: "pending",
          priority: "medium",
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const claim = planClaims.begin({
      sessionId: session.id,
      runId: accepted.runId,
      ownerSessionId: session.id,
      stepId: "http-step",
      revision: plan.revision,
    }).claim;
    const settlePlanClaim = vi.fn((input: Parameters<ChatService["settlePlanClaim"]>[0]) => {
      const current = planClaims.getClaim(input.claimId);
      if (input.expectedVersion !== undefined && current?.claimVersion !== input.expectedVersion)
        throw new PlanClaimError(
          "claim_version_conflict",
          "The plan step claim changed after the caller read its version.",
        );
      return {
        plan: workbench.state(session.id).plan,
        claim: {
          ...claim,
          ...input,
          status: input.status,
        },
      };
    });
    const recoverPlanClaim = vi.fn((input: Parameters<ChatService["recoverPlanClaim"]>[0]) => ({
      plan: workbench.state(session.id).plan,
      claim: {
        ...claim,
        status: "cancelled" as const,
        expectedVersion: input.expectedVersion,
        recoverySummary: input.summary,
      },
    }));
    const chatService = {
      settlePlanClaim,
      recoverPlanClaim,
      isPlanClaimRunActive: vi.fn(() => true),
    } as unknown as ChatService;
    const service = new HeadlessServerService(
      repository,
      new SessionService(repository),
      chatService,
      { list: vi.fn().mockResolvedValue([]) } as unknown as AgentProfileService,
      { list: vi.fn().mockResolvedValue([]) } as unknown as CustomCommandService,
      { status: vi.fn().mockResolvedValue([]) } as unknown as ProjectToolingService,
      { list: vi.fn().mockReturnValue([]) } as unknown as McpService,
      new TrajectoryService(repository),
      new ApprovalBroker(),
      new QuestionBroker(),
    );
    service.setRuntimeService(runtime);
    service.setDeveloperHandlers({
      taskClaims: createTaskClaimsHandler({
        planClaims,
        chatService,
        runtimeService: runtime,
        repository,
      }),
    });
    try {
      const status = await service.start("127.0.0.1", 0);
      const route = `${status.url}/v1/tasks/claims`;
      const settle = (claimStatus: string, expectedVersion?: unknown) =>
        fetch(route, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${status.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "settle",
            claimId: claim.id,
            ownerRunId: accepted.runId,
            status: claimStatus,
            ...(expectedVersion === undefined ? {} : { expectedVersion }),
          }),
        });

      const missingVersion = await settle("completed");
      expect(missingVersion.status).toBe(400);
      expect(await missingVersion.json()).toMatchObject({ code: "PLAN_CLAIM_INVALID" });
      for (const invalidVersion of [0, -1, 1.5, "1", null]) {
        const invalid = await settle("completed", invalidVersion);
        expect(invalid.status).toBe(400);
        expect(await invalid.json()).toMatchObject({ code: "PLAN_CLAIM_INVALID" });
      }
      const invalidStatus = await settle("stale", claim.claimVersion);
      expect(invalidStatus.status).toBe(400);
      expect(await invalidStatus.json()).toMatchObject({ code: "PLAN_CLAIM_INVALID" });
      expect(settlePlanClaim).not.toHaveBeenCalled();

      const staleVersion = claim.claimVersion;
      const heartbeat = await fetch(route, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${status.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "heartbeat",
          claimId: claim.id,
          ownerRunId: accepted.runId,
        }),
      });
      expect(heartbeat.status).toBe(200);
      expect((await heartbeat.json()).claimVersion).toBeGreaterThan(staleVersion);

      const stale = await settle("completed", staleVersion);
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({
        code: "PLAN_CLAIM_CLAIM_VERSION_CONFLICT",
      });
      expect(settlePlanClaim).toHaveBeenCalledOnce();

      const currentVersion = planClaims.getClaim(claim.id)?.claimVersion;
      if (currentVersion === undefined) throw new Error("Expected the claim to remain active.");
      const completed = await settle("completed", currentVersion);
      expect(completed.status).toBe(200);
      expect(await completed.json()).toMatchObject({
        claim: { id: claim.id, status: "completed" },
      });
      expect(settlePlanClaim).toHaveBeenCalledTimes(2);
      expect(settlePlanClaim).toHaveBeenLastCalledWith(
        expect.objectContaining({
          claimId: claim.id,
          ownerRunId: accepted.runId,
          status: "completed",
          expectedVersion: currentVersion,
        }),
      );

      const recover = (payload: Record<string, unknown>) =>
        fetch(route, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${status.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "recover", ...payload }),
        });

      const invalidRecovery = await recover({
        sessionId: session.id,
        claimId: claim.id,
        summary: "Recovered after inspection.",
      });
      expect(invalidRecovery.status).toBe(400);
      expect(await invalidRecovery.json()).toMatchObject({ code: "PLAN_CLAIM_INVALID" });
      expect(recoverPlanClaim).not.toHaveBeenCalled();

      const recovered = await recover({
        sessionId: session.id,
        claimId: claim.id,
        expectedVersion: plan.revision,
        summary: "Read-only inspection completed after the interruption.",
        inspectionCallIds: ["inspection-1", "inspection-2"],
      });
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({
        claim: {
          id: claim.id,
          status: "cancelled",
          expectedVersion: plan.revision,
          recoverySummary: "Read-only inspection completed after the interruption.",
        },
      });
      expect(recoverPlanClaim).toHaveBeenCalledOnce();
      expect(recoverPlanClaim).toHaveBeenCalledWith({
        sessionId: session.id,
        claimId: claim.id,
        expectedVersion: plan.revision,
        summary: "Read-only inspection completed after the interruption.",
        inspectionCallIds: ["inspection-1", "inspection-2"],
      });
    } finally {
      await service.stop();
      database.close();
    }
  });
});
