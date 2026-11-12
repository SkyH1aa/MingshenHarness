import { describe, expect, it } from "vitest";
import type { ApprovalRequest, QuestionRequest } from "../../../shared/domain";
import { approvalsFromSnapshot, newerPendingState, questionsFromSnapshot } from "./approval-state";

const request = (id: string, sessionId = "s") => ({ id, sessionId }) as ApprovalRequest;

describe("approval renderer state", () => {
  it("does not remove a new pending approval when an older IPC decision finishes", () => {
    const next = { revision: 4, requests: [request("next"), request("parallel", "other")] };
    const oldReply = { revision: 2, requests: [request("previous")] };
    const state = approvalsFromSnapshot(newerPendingState(next, oldReply));
    expect(state.s?.id).toBe("next");
    expect(state.other?.id).toBe("parallel");
  });
  it("rehydrates all sessions and keeps the first approval for the selected session", () => {
    const state = approvalsFromSnapshot({
      revision: 5,
      requests: [request("a"), request("b"), request("c", "other")],
    });
    expect(state.s?.id).toBe("a");
    expect(state.other?.id).toBe("c");
    expect(approvalsFromSnapshot({ revision: 6, requests: [] })).toEqual({});
  });
  it("ignores old and duplicate replies without overwriting a newer pending snapshot", () => {
    const current = { revision: 4, requests: [request("next")] };
    expect(newerPendingState(current, { revision: 3, requests: [] })).toBe(current);
    expect(newerPendingState(current, { revision: 4, requests: [] })).toBe(current);
    expect(newerPendingState(current, { revision: 5, requests: [] }).requests).toEqual([]);
  });
  it("recovers questions across sessions and preserves the first item in the same-session queue", () => {
    const first = { id: "q1", sessionId: "s" } as QuestionRequest;
    const second = { id: "q2", sessionId: "s" } as QuestionRequest;
    const parallel = { id: "q3", sessionId: "other" } as QuestionRequest;
    expect(questionsFromSnapshot({ revision: 3, requests: [first, second, parallel] })).toEqual({
      s: first,
      other: parallel,
    });
    expect(questionsFromSnapshot({ revision: 4, requests: [] })).toEqual({});
  });
});
