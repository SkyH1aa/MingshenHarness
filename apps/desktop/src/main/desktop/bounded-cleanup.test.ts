import { describe, expect, it } from "vitest";
import { settleWithin } from "./bounded-cleanup";

describe("bounded cleanup", () => {
  it("settles successful and rejected tasks without propagating cleanup failures", async () => {
    await expect(
      settleWithin([Promise.resolve(), Promise.reject(new Error("fixture cleanup failure"))], 100),
    ).resolves.toBe("settled");
  });

  it("returns after the deadline even when a cleanup task never settles", async () => {
    const pending = new Promise<void>(() => undefined);
    const started = Date.now();
    await expect(settleWithin([pending], 20)).resolves.toBe("timed_out");
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
