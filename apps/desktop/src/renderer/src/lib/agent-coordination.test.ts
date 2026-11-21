import { describe, expect, it } from "vitest";
import type { ActivityEvent, AgentProfileView, SessionView } from "../../../shared/domain";
import {
  coordinationPrompt,
  deriveAgentQuality,
  recentAgentActivities,
  summarizeAgentQuality,
} from "./agent-coordination";

const session = {
  id: "child",
  title: "Test worker",
  status: "idle",
  agentMode: "code",
} as SessionView;

function activity(
  id: string,
  status: ActivityEvent["status"],
  toolName = "run_command",
  detail = "pnpm test -- --run",
): ActivityEvent {
  return {
    id,
    sessionId: "child",
    runId: "run",
    toolName,
    kind: "command",
    title: "Run command",
    detail,
    status,
    startedAt: `2026-11-20T00:00:0${id}.000Z`,
    completedAt: status === "running" ? null : `2026-11-20T00:00:0${id}.500Z`,
    durationMs: null,
    fileChange: null,
  };
}

describe("agent coordination quality", () => {
  it("only reports verification after real successful verification activity", () => {
    expect(deriveAgentQuality(session, [activity("1", "completed", "read_file", "README")])).toBe(
      "unverified",
    );
    expect(deriveAgentQuality(session, [activity("2", "completed")])).toBe("verified");
    expect(deriveAgentQuality(session, [activity("3", "failed")])).toBe("needs_review");
  });

  it("reports running from session or activity state, never a timer", () => {
    expect(deriveAgentQuality({ ...session, status: "running" }, [])).toBe("running");
    expect(deriveAgentQuality(session, [activity("4", "running")])).toBe("running");
    expect(deriveAgentQuality(session, [], true)).toBe("running");
  });

  it("summarizes and orders only supplied real activities", () => {
    expect(
      summarizeAgentQuality(["running", "verified", "verified", "needs_review", "unverified"]),
    ).toEqual({
      total: 5,
      running: 1,
      verified: 2,
      needsReview: 1,
      unverified: 1,
      failed: 0,
    });
    expect(
      recentAgentActivities([session], { child: [activity("1", "completed")] }, 4).map(
        (item) => item.id,
      ),
    ).toEqual(["1"]);
  });

  it("builds an editable coordination prompt without claiming it already ran", () => {
    const profile = {
      id: "quality-verifier",
      name: "Quality Verifier",
      role: "subagent",
      enabled: true,
      readOnly: true,
      applicableModes: ["code", "work"],
    } as AgentProfileView;
    const prompt = coordinationPrompt(session, [profile]);
    expect(prompt).toContain("启动一轮多角色 Agent 协同任务");
    expect(prompt).toContain("quality-verifier");
    expect(prompt).not.toContain("已完成协同");
  });
});
