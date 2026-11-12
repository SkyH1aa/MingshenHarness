import { describe, expect, it } from "vitest";
import type { SessionView } from "../../../shared/domain";
import { recentSessionIds, sessionRecency } from "./recent-sessions";

describe("recent workspace conversations", () => {
  const session = (id: string, updated: number, opened = updated, pinned = false) =>
    ({
      id,
      updatedAt: new Date(updated).toISOString(),
      lastOpenedAt: new Date(opened).toISOString(),
      createdAt: new Date(0).toISOString(),
      pinned,
    }) as SessionView;
  it("selects the three most recently opened or active sessions without mutating tree/pin order", () => {
    const sessions = [
      session("old-pinned", 1, 1, true),
      session("a", 2, 20),
      session("b", 30),
      session("c", 4, 40),
      session("d", 5),
    ];
    expect([...recentSessionIds(sessions)]).toEqual(["c", "b", "a"]);
    expect(sessions[0]?.id).toBe("old-pinned");
    expect(recentSessionIds(sessions.slice(0, 2)).size).toBe(2);
  });
  it("retains sane fallbacks for legacy or damaged timestamps", () => {
    const legacy = { ...session("legacy", 100), lastOpenedAt: "" };
    expect(sessionRecency(legacy)).toBe(100);
    expect(recentSessionIds([]).size).toBe(0);
  });
});
