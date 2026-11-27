import { describe, expect, it } from "vitest";
import { PendingSubmissionKeys } from "./pending-submission-keys";

describe("pending submission idempotency keys", () => {
  it("reuses a key only for the same uncertain draft submission", () => {
    let sequence = 0;
    const keys = new PendingSubmissionKeys(() => `key-${++sequence}`);
    const first = { sessionId: "session", draftRevision: "revision-1" };

    expect(keys.acquire(first)).toBe("key-1");
    expect(keys.acquire(first)).toBe("key-1");
    expect(keys.acquire({ ...first, temporaryInstruction: "instruction" })).toBe("key-2");
    expect(keys.acquire({ ...first, draftRevision: "revision-2" })).toBe("key-3");
  });

  it("clears only the confirmed signature and starts a new request afterwards", () => {
    let sequence = 0;
    const keys = new PendingSubmissionKeys(() => `key-${++sequence}`);
    const first = { sessionId: "session", draftRevision: "revision-1" };
    const second = { sessionId: "session", draftRevision: "revision-2" };

    expect(keys.acquire(first)).toBe("key-1");
    keys.release(second);
    expect(keys.acquire(first)).toBe("key-1");
    keys.release(first);
    expect(keys.acquire(first)).toBe("key-2");
  });
});
