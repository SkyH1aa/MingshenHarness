import { describe, expect, it } from "vitest";
import { beginLatestRequest, invalidateLatestRequests } from "./latest-request";

describe("latest request tracking", () => {
  it("invalidates an earlier response when a newer request starts", () => {
    const cursor = { current: 0 };
    const first = beginLatestRequest(cursor);
    const second = beginLatestRequest(cursor);

    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it("invalidates pending responses on cleanup", () => {
    const cursor = { current: 0 };
    const pending = beginLatestRequest(cursor);

    invalidateLatestRequests(cursor);

    expect(pending.isCurrent()).toBe(false);
  });
});
