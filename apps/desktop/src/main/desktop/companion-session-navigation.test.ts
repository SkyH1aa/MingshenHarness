import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CompanionSessionNavigationError,
  CompanionSessionNavigationRequests,
} from "./companion-session-navigation";

describe("companion session navigation requests", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves an accepted request once and removes its timeout", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(requests.claim(41, requestId, "session", () => true)).toBe(true);
    await expect(pending).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(requests.claim(41, requestId, "session", () => true)).toBe(false);
    requests.dispose();
  });

  it.each(["busy", "unsaved_plan", "unsaved_edits", "unavailable", "failed"] as const)(
    "rejects a declined request with the public %s code",
    async (reason) => {
      const requests = new CompanionSessionNavigationRequests();
      let requestId = "";
      const pending = requests.request(41, "session", (id) => {
        requestId = id;
      });
      const rejection = expect(pending).rejects.toMatchObject({
        name: "CompanionSessionNavigationError",
        code: reason,
      });
      requests.settle(41, { requestId, accepted: false, reason });
      await rejection;
      expect(vi.getTimerCount()).toBe(0);
      requests.dispose();
    },
  );

  it("preflights without settling or consuming the request before claim", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let requestId = "";
    let settled = false;
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    void pending.finally(() => {
      settled = true;
    });
    const validate = vi.fn(() => true);
    expect(requests.preflight(41, requestId, "session", validate)).toBe(true);
    expect(requests.preflight(41, requestId, "session", validate)).toBe(true);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(requests.claim(41, requestId, "session", validate)).toBe(true);
    await expect(pending).resolves.toBeUndefined();
    expect(validate).toHaveBeenCalledTimes(3);
    expect(requests.preflight(41, requestId, "session", validate)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("binds preflight to the original sender and session without consuming mismatches", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const validate = vi.fn(() => true);
    expect(requests.preflight(42, requestId, "session", validate)).toBe(false);
    expect(requests.preflight(41, requestId, "other", validate)).toBe(false);
    expect(requests.preflight(41, randomUUID(), "session", validate)).toBe(false);
    expect(requests.preflight(0, requestId, "session", validate)).toBe(false);
    expect(requests.preflight(41, "", "session", validate)).toBe(false);
    expect(requests.preflight(41, requestId, "", validate)).toBe(false);
    expect(validate).not.toHaveBeenCalled();
    expect(requests.preflight(41, requestId, "session", validate)).toBe(true);
    expect(requests.claim(41, requestId, "session", validate)).toBe(true);
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects an expired preflight before its timer fires or target validation runs", async () => {
    let now = 0;
    const requests = new CompanionSessionNavigationRequests(() => now);
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    const validate = vi.fn(() => true);
    now = 10_000;
    expect(requests.preflight(41, requestId, "session", validate)).toBe(false);
    expect(validate).not.toHaveBeenCalled();
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a preflight if target validation crosses the deadline", async () => {
    let now = 0;
    const requests = new CompanionSessionNavigationRequests(() => now);
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    expect(
      requests.preflight(41, requestId, "session", () => {
        now = 10_000;
        return true;
      }),
    ).toBe(false);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["false", "throw"] as const)(
    "rejects an unavailable target during preflight when validation returns %s",
    async (result) => {
      const requests = new CompanionSessionNavigationRequests();
      let requestId = "";
      const pending = requests.request(41, "session", (id) => {
        requestId = id;
      });
      const rejection = expect(pending).rejects.toMatchObject({ code: "unavailable" });
      expect(
        requests.preflight(41, requestId, "session", () => {
          if (result === "throw") throw new Error("session check failed");
          return false;
        }),
      ).toBe(false);
      await rejection;
      expect(requests.claim(41, requestId, "session", () => true)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("rechecks the target at claim after a successful preflight", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "unavailable" });
    expect(requests.preflight(41, requestId, "session", () => true)).toBe(true);
    expect(requests.claim(41, requestId, "session", () => false)).toBe(false);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rechecks the deadline at claim after a successful preflight", async () => {
    let now = 0;
    const requests = new CompanionSessionNavigationRequests(() => now);
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    expect(requests.preflight(41, requestId, "session", () => true)).toBe(true);
    now = 10_000;
    const validate = vi.fn(() => true);
    expect(requests.claim(41, requestId, "session", validate)).toBe(false);
    expect(validate).not.toHaveBeenCalled();
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not preflight a request cancelled during validation", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "unavailable" });
    expect(
      requests.preflight(41, requestId, "session", () => {
        requests.cancelSender(41);
        return true;
      }),
    ).toBe(false);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out after ten seconds and rejects a late receipt", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let requestId = "";
    let settled = false;
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(settled).toBe(true);
    expect(requests.claim(41, requestId, "session", () => true)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    requests.dispose();
  });

  it("rejects a claim at the monotonic deadline even before its timer runs", async () => {
    let now = 2_000;
    const requests = new CompanionSessionNavigationRequests(() => now);
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    const validate = vi.fn(() => true);
    now = 12_000;
    expect(requests.claim(41, requestId, "session", validate)).toBe(false);
    expect(validate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await rejection;
  });

  it("checks the deadline again if synchronous validation blocks", async () => {
    let now = 0;
    const requests = new CompanionSessionNavigationRequests(() => now);
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    expect(
      requests.claim(41, requestId, "session", () => {
        now = 10_001;
        return true;
      }),
    ).toBe(false);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses timeout for a decline arriving after the deadline before the timer fires", async () => {
    let now = 0;
    const requests = new CompanionSessionNavigationRequests(() => now);
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    now = 10_000;
    requests.settle(41, { requestId, accepted: false, reason: "unsaved_plan" });
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not time out a claimed request or permit its claim to be replayed", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    expect(requests.claim(41, requestId, "session", () => true)).toBe(true);
    expect(requests.claim(41, requestId, "session", () => true)).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("binds claims to the pending request, sender and session without consuming mismatches", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const validate = vi.fn(() => true);
    expect(requests.claim(42, requestId, "session", validate)).toBe(false);
    expect(requests.claim(41, requestId, "other", validate)).toBe(false);
    expect(requests.claim(41, randomUUID(), "session", validate)).toBe(false);
    expect(requests.claim(0, requestId, "session", validate)).toBe(false);
    expect(requests.claim(41, "", "session", validate)).toBe(false);
    expect(requests.claim(41, requestId, "", validate)).toBe(false);
    expect(validate).not.toHaveBeenCalled();
    expect(requests.claim(41, requestId, "session", validate)).toBe(true);
    expect(validate).toHaveBeenCalledOnce();
    await expect(pending).resolves.toBeUndefined();
  });

  it.each(["false", "throw"] as const)(
    "rejects an unavailable target when validation returns %s",
    async (result) => {
      const requests = new CompanionSessionNavigationRequests();
      let requestId = "";
      const pending = requests.request(41, "session", (id) => {
        requestId = id;
      });
      const rejection = expect(pending).rejects.toMatchObject({ code: "unavailable" });
      expect(
        requests.claim(41, requestId, "session", () => {
          if (result === "throw") throw new Error("session check failed");
          return false;
        }),
      ).toBe(false);
      await rejection;
      expect(requests.claim(41, requestId, "session", () => true)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("cannot claim after cancellation occurs during target validation", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "unavailable" });
    expect(
      requests.claim(41, requestId, "session", () => {
        requests.cancelSender(41);
        return true;
      }),
    ).toBe(false);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds concurrent requests and lets another request start after settlement", async () => {
    const requests = new CompanionSessionNavigationRequests();
    const ids: string[] = [];
    const pending = Array.from({ length: 16 }, () =>
      requests.request(41, "session", (id) => ids.push(id)),
    );
    expect(new Set(ids).size).toBe(16);
    const sendExtra = vi.fn();
    await expect(requests.request(41, "session", sendExtra)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(sendExtra).not.toHaveBeenCalled();

    expect(requests.claim(41, ids[0], "session", () => true)).toBe(true);
    let replacementId = "";
    const replacement = requests.request(42, "session", (id) => {
      replacementId = id;
    });
    for (const requestId of ids.slice(1).reverse())
      expect(requests.claim(41, requestId, "session", () => true)).toBe(true);
    expect(requests.claim(42, replacementId, "session", () => true)).toBe(true);
    await expect(Promise.all([...pending, replacement])).resolves.toHaveLength(17);
    expect(vi.getTimerCount()).toBe(0);
    requests.dispose();
  });

  it("rejects malformed, forged and unknown receipts without settling the real request", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
    });
    const invalid = [
      null,
      [],
      {},
      { requestId, accepted: "true" },
      { requestId, accepted: false },
      { requestId, accepted: false, reason: "timeout" },
      { requestId, accepted: false, reason: undefined },
      { requestId, accepted: true },
      { requestId, accepted: true, reason: "failed" },
      { requestId, accepted: true, extra: true },
      { requestId: "", accepted: true },
      Object.assign(Object.create({ accepted: true }) as object, { requestId }),
    ];
    for (const input of invalid) expect(() => requests.settle(41, input)).toThrow();
    expect(() => requests.settle(42, { requestId, accepted: false, reason: "failed" })).toThrow();
    expect(() =>
      requests.settle(41, { requestId: randomUUID(), accepted: false, reason: "failed" }),
    ).toThrow();
    expect(() =>
      requests.settle(Number.NaN, { requestId, accepted: false, reason: "failed" }),
    ).toThrow();
    expect(requests.claim(41, requestId, "session", () => true)).toBe(true);
    await expect(pending).resolves.toBeUndefined();
    requests.dispose();
  });

  it("rejects pending requests on dispose and cannot be reused", async () => {
    const requests = new CompanionSessionNavigationRequests();
    const ids: string[] = [];
    const first = requests.request(41, "session", (id) => ids.push(id));
    const second = requests.request(42, "session", (id) => ids.push(id));
    const firstRejection = expect(first).rejects.toMatchObject({ code: "unavailable" });
    const secondRejection = expect(second).rejects.toMatchObject({ code: "unavailable" });
    requests.dispose();
    requests.dispose();
    await Promise.all([firstRejection, secondRejection]);
    expect(vi.getTimerCount()).toBe(0);
    expect(requests.claim(41, ids[0], "session", () => true)).toBe(false);
    await expect(requests.request(41, "session", vi.fn())).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("cancels only the reloading sender and allows its new page to make requests", async () => {
    const requests = new CompanionSessionNavigationRequests();
    const ids: string[] = [];
    const first = requests.request(41, "session", (id) => ids.push(id));
    const second = requests.request(41, "session", (id) => ids.push(id));
    const other = requests.request(42, "session", (id) => ids.push(id));
    const firstRejection = expect(first).rejects.toMatchObject({ code: "unavailable" });
    const secondRejection = expect(second).rejects.toMatchObject({ code: "unavailable" });

    requests.cancelSender(41);
    await Promise.all([firstRejection, secondRejection]);
    expect(vi.getTimerCount()).toBe(1);
    expect(requests.claim(41, ids[0], "session", () => true)).toBe(false);

    let reloadedId = "";
    const reloaded = requests.request(41, "session", (id) => {
      reloadedId = id;
    });
    expect(reloadedId).not.toBe(ids[0]);
    expect(requests.claim(42, ids[2], "session", () => true)).toBe(true);
    expect(requests.claim(41, reloadedId, "session", () => true)).toBe(true);
    await expect(Promise.all([other, reloaded])).resolves.toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    requests.dispose();
  });

  it("does not let a closed window's cancellation or late receipt affect its replacement", async () => {
    const requests = new CompanionSessionNavigationRequests();
    let closedId = "";
    const closed = requests.request(41, "session", (id) => {
      closedId = id;
    });
    const closedRejection = expect(closed).rejects.toMatchObject({ code: "unavailable" });
    requests.cancelSender(41);
    await closedRejection;

    let replacementId = "";
    const replacement = requests.request(43, "session", (id) => {
      replacementId = id;
    });
    requests.cancelSender(41);
    expect(requests.claim(41, closedId, "session", () => true)).toBe(false);
    expect(requests.claim(41, replacementId, "session", () => true)).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(requests.claim(43, replacementId, "session", () => true)).toBe(true);
    await expect(replacement).resolves.toBeUndefined();
    requests.cancelSender(43);
    expect(vi.getTimerCount()).toBe(0);
    requests.dispose();
  });

  it("cleans up and preserves a synchronous send failure", async () => {
    const requests = new CompanionSessionNavigationRequests();
    const failure = new Error("window destroyed");
    let requestId = "";
    const pending = requests.request(41, "session", (id) => {
      requestId = id;
      throw failure;
    });
    await expect(pending).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
    expect(requests.claim(41, requestId, "session", () => true)).toBe(false);
    await expect(requests.request(0, "session", vi.fn())).rejects.toBeInstanceOf(
      CompanionSessionNavigationError,
    );
    requests.dispose();
  });
});
