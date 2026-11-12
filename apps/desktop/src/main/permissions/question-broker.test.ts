import { describe, expect, it, vi } from "vitest";
import type { QuestionRequest } from "../../shared/domain";
import { QuestionBroker } from "./question-broker";

const request = (id: string, sessionId = "session"): QuestionRequest => ({
  id,
  sessionId,
  runId: "run",
  header: "Choose",
  question: "Continue?",
  options: [],
  createdAt: new Date().toISOString(),
});

describe("QuestionBroker recovery", () => {
  it("publishes complete revisioned state before delivery, on answer and on cancellation", async () => {
    const resolved = vi.fn();
    const changed = vi.fn();
    const broker = new QuestionBroker(resolved, changed);
    const controller = new AbortController();
    const first = broker.ask(request("first"), controller.signal);
    const second = broker.ask(request("second", "parallel"), controller.signal);
    expect(broker.state()).toMatchObject({
      revision: 2,
      requests: [{ id: "first" }, { id: "second" }],
    });
    broker.answer({ questionId: "first", answer: "Yes" });
    await expect(first).resolves.toMatchObject({ answer: "Yes" });
    expect(broker.state()).toMatchObject({ revision: 3, requests: [{ id: "second" }] });
    const cancelled = expect(second).rejects.toThrow("取消");
    controller.abort();
    await cancelled;
    expect(broker.state()).toEqual({ revision: 4, requests: [] });
    expect(changed.mock.calls.map(([state]) => state.revision)).toEqual([1, 2, 3, 4]);
    expect(resolved.mock.calls.map(([item]) => item.id)).toEqual(["first", "second"]);
  });

  it("does not register an already cancelled question", async () => {
    const broker = new QuestionBroker();
    await expect(broker.ask(request("cancelled"), AbortSignal.abort())).rejects.toThrow("取消");
    expect(broker.state()).toEqual({ revision: 0, requests: [] });
  });
  it("keeps invalid answers pending and ignores a duplicate acknowledgement without touching the next request", async () => {
    const broker = new QuestionBroker();
    const first = broker.ask(
      {
        ...request("first"),
        options: [{ label: "A", description: "Choice A" }],
        multiSelect: false,
      },
      new AbortController().signal,
    );
    expect(() => broker.answer({ questionId: "first", answer: " " })).toThrow();
    expect(broker.list()).toHaveLength(1);
    expect(() =>
      broker.answer({
        questionId: "first",
        answers: [{ id: "question_1", selectedOptions: ["Unknown"], otherText: null }],
      }),
    ).toThrow();
    broker.answer({ questionId: "first", answer: "A" });
    await expect(first).resolves.toMatchObject({
      answers: [{ selectedOptions: ["A"], otherText: null }],
    });
    const controller = new AbortController();
    const second = broker.ask(request("second"), controller.signal);
    expect(() =>
      broker.answer({ questionId: "first", answer: "Different stale answer" }),
    ).not.toThrow();
    expect(broker.list()[0]?.id).toBe("second");
    const cancelled = expect(second).rejects.toThrow("取消");
    controller.abort();
    await cancelled;
  });
});
