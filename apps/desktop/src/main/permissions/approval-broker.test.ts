import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "../../shared/domain";
import { ApprovalBroker } from "./approval-broker";

const request: ApprovalRequest = {
  id: "approval-test-1",
  sessionId: "session-1",
  runId: "run-1",
  toolCallId: "call-1",
  toolName: "run_command",
  summary: "Run test",
  detail: "npm test",
  pathScope: null,
  commandPrefix: "npm test",
  risk: "elevated",
  createdAt: new Date().toISOString(),
};

describe("ApprovalBroker", () => {
  it("publishes monotonic authoritative snapshots before decisions and on cancellation", async () => {
    const changed = vi.fn();
    const broker = new ApprovalBroker(changed);
    const controller = new AbortController();
    const first = broker.request(request, controller.signal);
    const second = broker.request(
      { ...request, id: "second", sessionId: "parallel" },
      controller.signal,
    );
    expect(broker.state()).toMatchObject({
      revision: 2,
      requests: [{ id: request.id }, { id: "second" }],
    });
    broker.decide({ approvalId: request.id, decision: "allow_session" });
    await expect(first).resolves.toMatchObject({ decision: "allow_session" });
    expect(broker.state().requests).toHaveLength(1);
    broker.update("second", { state: "manual", reason: "Offline" });
    expect(broker.get("second")?.review?.reason).toBe("Offline");
    const failure = expect(second).rejects.toThrow("取消");
    controller.abort();
    await failure;
    expect(broker.state()).toEqual({ revision: 5, requests: [] });
    expect(changed.mock.calls.map(([state]) => state.revision)).toEqual([1, 2, 3, 4, 5]);
  });
  it("treats duplicate decisions as idempotent", async () => {
    const broker = new ApprovalBroker();
    const controller = new AbortController();
    const decisionPromise = broker.request(request, controller.signal);

    broker.decide({ approvalId: request.id, decision: "allow_once" });
    expect(() => broker.decide({ approvalId: request.id, decision: "allow_once" })).not.toThrow();
    await expect(decisionPromise).resolves.toMatchObject({
      approvalId: request.id,
      decision: "allow_once",
    });
  });
});
