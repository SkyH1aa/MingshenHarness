import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  respondToCompanionNavigation,
  SessionSelectionSequence,
} from "../../renderer/src/lib/companion-session-navigation";
import { CompanionSessionNavigationRequests } from "./companion-session-navigation";

type Session = { id: string; archived: boolean };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("companion navigation timeout integration", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not apply the original event when it is delivered after the timeout", async () => {
    let now = 0;
    const requests = new CompanionSessionNavigationRequests(() => now);
    let requestId = "";
    const pending = requests.request(41, "chat", (id) => {
      requestId = id;
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: "timeout" });
    now = 10_000;
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;

    const sequence = new SessionSelectionSequence();
    const prior = sequence.begin();
    const commit = vi.fn();
    const report = vi.fn(async () => {});
    await respondToCompanionNavigation({
      requestId,
      sessionId: "chat",
      sequence,
      knownSession: () => ({ id: "chat", archived: false }),
      loadSession: async () => null,
      navigationFailure: () => null,
      preflight: (id, sessionId) => requests.preflight(41, id, sessionId, () => true),
      claim: (id, sessionId) => requests.claim(41, id, sessionId, () => true),
      commit,
      report,
    });
    expect(prior()).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    requests.dispose();
  });

  it("does not apply a slow lookup that returns after the timeout", async () => {
    let now = 0;
    const requests = new CompanionSessionNavigationRequests(() => now);
    let requestId = "";
    const pending = requests.request(41, "chat", (id) => {
      requestId = id;
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: "timeout" });
    const lookup = deferred<Session | null>();
    const commit = vi.fn();
    const navigation = respondToCompanionNavigation({
      requestId,
      sessionId: "chat",
      sequence: new SessionSelectionSequence(),
      knownSession: () => undefined,
      loadSession: () => lookup.promise,
      navigationFailure: () => null,
      preflight: (id, sessionId) => requests.preflight(41, id, sessionId, () => true),
      claim: (id, sessionId) => requests.claim(41, id, sessionId, () => true),
      commit,
      report: async (result) => requests.settle(41, result),
    });

    now = 10_000;
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    lookup.resolve({ id: "chat", archived: false });
    await navigation;
    expect(commit).not.toHaveBeenCalled();
    requests.dispose();
  });

  it("rejects an expired claim even before the timer callback runs", async () => {
    let now = 0;
    const requests = new CompanionSessionNavigationRequests(() => now);
    let requestId = "";
    const pending = requests.request(41, "chat", (id) => {
      requestId = id;
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: "timeout" });
    now = 10_000;
    const commit = vi.fn();
    await respondToCompanionNavigation({
      requestId,
      sessionId: "chat",
      sequence: new SessionSelectionSequence(),
      knownSession: () => ({ id: "chat", archived: false }),
      loadSession: async () => null,
      navigationFailure: () => null,
      preflight: (id, sessionId) => requests.preflight(41, id, sessionId, () => true),
      claim: (id, sessionId) => requests.claim(41, id, sessionId, () => true),
      commit,
      report: async (result) => requests.settle(41, result),
    });
    await rejected;
    expect(commit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    requests.dispose();
  });
});
