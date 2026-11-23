import { describe, expect, it, vi } from "vitest";
import type { CompanionSessionNavigationFailure } from "../../../shared/ipc";
import {
  respondToCompanionNavigation,
  SessionSelectionSequence,
} from "./companion-session-navigation";

type Session = { id: string; archived: boolean };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function fixture(known: Session | undefined = { id: "chat", archived: false }) {
  const sequence = new SessionSelectionSequence();
  const knownSession = vi.fn((_id: string): Session | undefined => known);
  const loadSession = vi.fn(async (_id: string): Promise<Session | null> => null);
  const navigationFailure = vi.fn(
    (_id: string, _session: Session | undefined): CompanionSessionNavigationFailure | null => null,
  );
  const preflight = vi.fn((_requestId: string, _sessionId: string) => true);
  const claim = vi.fn((_requestId: string, _sessionId: string) => true);
  const commit = vi.fn((_session: Session, _loaded: boolean) => {});
  const report = vi.fn(async (_result: unknown) => {});
  const input = {
    requestId: "req",
    sessionId: "chat",
    sequence,
    knownSession,
    loadSession,
    navigationFailure,
    preflight,
    claim,
    commit,
    report,
  };
  return {
    input,
    sequence,
    knownSession,
    loadSession,
    navigationFailure,
    preflight,
    claim,
    commit,
    report,
  };
}

describe("companion session navigation", () => {
  it("captures the selection sequence without invalidating an existing selection", () => {
    const sequence = new SessionSelectionSequence();
    const first = sequence.begin();
    const capture = sequence.capture();
    expect(first()).toBe(true);
    expect(capture()).toBe(true);
    const next = sequence.begin();
    expect(first()).toBe(false);
    expect(capture()).toBe(false);
    expect(next()).toBe(true);
  });

  it("claims before synchronously committing a known session", async () => {
    const f = fixture();
    const steps: string[] = [];
    f.claim.mockImplementation(() => {
      steps.push("claim");
      queueMicrotask(() => steps.push("microtask"));
      return true;
    });
    f.commit.mockImplementation(() => steps.push("commit"));
    await respondToCompanionNavigation(f.input);
    expect(steps).toEqual(["claim", "commit", "microtask"]);
    expect(f.claim).toHaveBeenCalledWith("req", "chat");
    expect(f.commit).toHaveBeenCalledWith({ id: "chat", archived: false }, false);
    expect(f.loadSession).not.toHaveBeenCalled();
    expect(f.report).not.toHaveBeenCalled();
  });

  it("does not commit or invalidate another selection when the original event arrives after timeout", async () => {
    const f = fixture();
    const earlier = f.sequence.begin();
    f.preflight.mockReturnValue(false);
    await respondToCompanionNavigation(f.input);
    expect(earlier()).toBe(true);
    expect(f.preflight).toHaveBeenCalledWith("req", "chat");
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.report).not.toHaveBeenCalled();
  });

  it("cannot commit a session whose slow lookup finishes after timeout", async () => {
    const f = fixture(undefined);
    const lookup = deferred<Session | null>();
    f.knownSession.mockReturnValue(undefined);
    f.loadSession.mockReturnValue(lookup.promise);
    const earlier = f.sequence.begin();
    const pending = respondToCompanionNavigation(f.input);
    expect(f.claim).not.toHaveBeenCalled();
    f.claim.mockReturnValue(false);
    lookup.resolve({ id: "chat", archived: false });
    await pending;
    expect(earlier()).toBe(false);
    expect(f.claim).toHaveBeenCalledOnce();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.report).not.toHaveBeenCalled();
  });

  it("commits and merges a loaded session only after a successful claim", async () => {
    const f = fixture(undefined);
    f.knownSession.mockReturnValue(undefined);
    f.loadSession.mockResolvedValue({ id: "chat", archived: false });
    await respondToCompanionNavigation(f.input);
    expect(f.commit).toHaveBeenCalledWith({ id: "chat", archived: false }, true);
    expect(f.report).not.toHaveBeenCalled();
  });

  it("does not override a manual selection made during a session lookup", async () => {
    const f = fixture(undefined);
    const lookup = deferred<Session | null>();
    f.knownSession.mockReturnValue(undefined);
    f.loadSession.mockReturnValue(lookup.promise);
    const pending = respondToCompanionNavigation(f.input);
    const manual = f.sequence.begin();
    lookup.resolve({ id: "chat", archived: false });
    await pending;
    expect(manual()).toBe(true);
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.report).toHaveBeenCalledWith({ requestId: "req", accepted: false, reason: "failed" });
  });

  it.each(["busy", "unsaved_plan", "unsaved_edits"] as const)(
    "rejects an initial %s block without claiming or mutating navigation",
    async (reason) => {
      const f = fixture();
      const earlier = f.sequence.begin();
      f.navigationFailure.mockReturnValue(reason);
      await respondToCompanionNavigation(f.input);
      expect(earlier()).toBe(true);
      expect(f.claim).not.toHaveBeenCalled();
      expect(f.commit).not.toHaveBeenCalled();
      expect(f.report).toHaveBeenCalledWith({ requestId: "req", accepted: false, reason });
    },
  );

  it.each(["busy", "unsaved_plan", "unsaved_edits"] as const)(
    "rechecks a %s block after an asynchronous lookup",
    async (reason) => {
      const f = fixture(undefined);
      const lookup = deferred<Session | null>();
      f.knownSession.mockReturnValue(undefined);
      f.loadSession.mockReturnValue(lookup.promise);
      const pending = respondToCompanionNavigation(f.input);
      f.navigationFailure.mockReturnValue(reason);
      lookup.resolve({ id: "chat", archived: false });
      await pending;
      expect(f.claim).not.toHaveBeenCalled();
      expect(f.commit).not.toHaveBeenCalled();
      expect(f.report).toHaveBeenCalledWith({ requestId: "req", accepted: false, reason });
    },
  );

  it.each(["first", "second"] as const)(
    "only commits the latest of two pending lookups when %s resolves first",
    async (firstResolved) => {
      const f = fixture(undefined);
      const first = deferred<Session | null>();
      const second = deferred<Session | null>();
      f.knownSession.mockReturnValue(undefined);
      f.loadSession.mockImplementation((id) => (id === "first" ? first.promise : second.promise));
      const oldNavigation = respondToCompanionNavigation({
        ...f.input,
        requestId: "old",
        sessionId: "first",
      });
      const newNavigation = respondToCompanionNavigation({
        ...f.input,
        requestId: "new",
        sessionId: "second",
      });
      if (firstResolved === "first") {
        first.resolve({ id: "first", archived: false });
        await oldNavigation;
        second.resolve({ id: "second", archived: false });
        await newNavigation;
      } else {
        second.resolve({ id: "second", archived: false });
        await newNavigation;
        first.resolve({ id: "first", archived: false });
        await oldNavigation;
      }
      expect(f.claim).toHaveBeenCalledTimes(1);
      expect(f.claim).toHaveBeenCalledWith("new", "second");
      expect(f.commit).toHaveBeenCalledWith({ id: "second", archived: false }, true);
      expect(f.report).toHaveBeenCalledWith({
        requestId: "old",
        accepted: false,
        reason: "failed",
      });
    },
  );

  it("supersedes an earlier pending manual selection before the lookup finishes", async () => {
    const f = fixture(undefined);
    const earlier = f.sequence.begin();
    const lookup = deferred<Session | null>();
    f.knownSession.mockReturnValue(undefined);
    f.loadSession.mockReturnValue(lookup.promise);
    const pending = respondToCompanionNavigation(f.input);
    expect(earlier()).toBe(false);
    lookup.resolve({ id: "chat", archived: false });
    await pending;
    expect(f.commit).toHaveBeenCalledOnce();
  });

  it.each([null, { id: "chat", archived: true }])(
    "rejects a missing or archived loaded session",
    async (session) => {
      const f = fixture(undefined);
      f.knownSession.mockReturnValue(undefined);
      f.loadSession.mockResolvedValue(session);
      await respondToCompanionNavigation(f.input);
      expect(f.claim).not.toHaveBeenCalled();
      expect(f.commit).not.toHaveBeenCalled();
      expect(f.report).toHaveBeenCalledWith({
        requestId: "req",
        accepted: false,
        reason: "unavailable",
      });
    },
  );

  it("reports a failed lookup without changing navigation state", async () => {
    const f = fixture(undefined);
    f.knownSession.mockReturnValue(undefined);
    f.loadSession.mockRejectedValue(new Error("lookup failed"));
    await respondToCompanionNavigation(f.input);
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.report).toHaveBeenCalledWith({ requestId: "req", accepted: false, reason: "failed" });
  });

  it("does not commit when the synchronous claim fails unexpectedly", async () => {
    const f = fixture();
    f.claim.mockImplementation(() => {
      throw new Error("IPC unavailable");
    });
    await expect(respondToCompanionNavigation(f.input)).rejects.toThrow("IPC unavailable");
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.report).not.toHaveBeenCalled();
  });
});
