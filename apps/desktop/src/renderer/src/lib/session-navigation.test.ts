import { describe, expect, it } from "vitest";
import type { SessionView } from "../../../shared/domain";
import {
  branchNavigationGroups,
  SessionNavigationIndex,
  visibleSessionRows,
} from "./session-navigation";

const session = (id: string, time: number, parent: string | null = null) =>
  ({
    id,
    title: id,
    parentSessionId: parent,
    workspacePath: "C:\\Project",
    archived: false,
    pinned: false,
    updatedAt: new Date(time).toISOString(),
    lastOpenedAt: new Date(time).toISOString(),
    createdAt: new Date(0).toISOString(),
  }) as SessionView;

describe("conversation hierarchy and incremental search", () => {
  it("counts only roots toward the recent three, hides children until expanded, and keeps matched children with parent context", () => {
    const sessions = [
      session("old", 1),
      session("a", 2),
      session("b", 3),
      session("c", 4),
      ...Array.from({ length: 30 }, (_, index) => session(`child-${index}`, 100 + index, "a")),
    ];
    const index = new SessionNavigationIndex();
    const group = index.groups(sessions, "")[0];
    if (!group) throw new Error("missing group");
    expect(visibleSessionRows(group, new Set(), false, false).map((s) => s.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(visibleSessionRows(group, new Set(["a"]), false, false)).toHaveLength(33);
    expect(visibleSessionRows(group, new Set(), true, false)).toHaveLength(4);
    const search = index.groups(sessions, "child-29")[0];
    if (!search) throw new Error("missing search");
    expect(visibleSessionRows(search, new Set(), true, true).map((s) => s.id)).toEqual([
      "a",
      "child-29",
    ]);
    const renamed = sessions.map((session) =>
      session.id === "old" ? { ...session, title: "renamed" } : session,
    );
    expect(index.groups(renamed, "renamed")[0]?.roots[0]?.title).toBe("renamed");
  });
  it("bounds visible rows for thousands of sessions without normalizing unchanged titles again", () => {
    const index = new SessionNavigationIndex();
    const sessions = Array.from({ length: 12000 }, (_, number) =>
      session(`task-${number}`, number),
    );
    const group = index.groups(sessions, "")[0];
    expect(group?.roots).toHaveLength(12000);
    if (group) expect(visibleSessionRows(group, new Set(), false, false)).toHaveLength(3);
    expect(index.groups(sessions, "task-11999")[0]?.sessions).toHaveLength(1);
    expect(
      index.groups(
        sessions.map((session) => ({ ...session })),
        "",
      ),
    ).toBe(index.groups(sessions, ""));
    expect(
      index.groups(
        sessions.filter((s) => s.id !== "task-11999"),
        "task-11999",
      ),
    ).toHaveLength(0);
  });
  it("groups session families by recorded branch and keeps unrecorded history explicit", () => {
    const sessions = [
      session("main", 4),
      session("child", 3, "main"),
      session("old", 2),
      session("worktree", 1),
    ];
    const workspaceGroup = new SessionNavigationIndex().groups(sessions, "")[0];
    if (!workspaceGroup) throw new Error("missing workspace group");
    const groups = branchNavigationGroups(workspaceGroup ? [workspaceGroup] : [], {
      main: {
        sessionId: "main",
        workspacePath: "C:\\Project",
        branch: "feature/palette",
        worktree: false,
        recordedAt: "2026-11-20T00:00:00.000Z",
      },
      worktree: {
        sessionId: "worktree",
        workspacePath: "C:\\Project",
        branch: "feature/palette",
        worktree: true,
        recordedAt: "2026-11-20T00:00:00.000Z",
      },
    });
    expect(groups.map((group) => group.key)).toEqual([
      `${workspaceGroup.key}::branch:host:feature/palette`,
      `${workspaceGroup.key}::branch:host:`,
      `${workspaceGroup.key}::branch:worktree:feature/palette`,
    ]);
    expect(
      groups
        .find((group) => group.key.includes("host:feature/palette"))
        ?.sessions.map((item) => item.id),
    ).toEqual(["main", "child"]);
    expect(groups.find((group) => group.key.endsWith("host:"))).toMatchObject({
      branch: null,
      branchRecorded: false,
    });
  });
});
