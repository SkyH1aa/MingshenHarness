import { describe, expect, it } from "vitest";
import { summarySegmentBudget, summarySegments } from "./compaction-summary-segments";

describe("bounded immutable compaction summaries", () => {
  const legacy = { id: "old", summary: "Verified constraints", createdAt: "2026-11-07" };
  it("keeps legacy checkpoints and rejects inconsistent or oversized segment metadata", () => {
    expect(summarySegments(legacy)).toEqual([legacy]);
    for (const segments of [
      [],
      [legacy, legacy],
      [{ ...legacy, summary: "different" }],
      Array(9).fill(legacy),
    ])
      expect(summarySegments({ ...legacy, segments })).toEqual([legacy]);
  });
  it("preserves exact segment content and caps the ledger token budget", () => {
    const newer = { id: "new", summary: "Changed result", createdAt: "2026-11-07" };
    const segments = [legacy, newer];
    expect(
      summarySegments({ ...newer, summary: `${legacy.summary}\n\n${newer.summary}`, segments }),
    ).toBe(segments);
    expect(summarySegmentBudget(20000)).toBe(3000);
    expect(summarySegmentBudget(200000)).toBe(30000);
    expect(summarySegmentBudget(1000000)).toBe(150000);
    expect(summarySegmentBudget(10001)).toBe(1500);
  });
});
