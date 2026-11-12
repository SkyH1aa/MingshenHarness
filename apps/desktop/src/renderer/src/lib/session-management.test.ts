import { describe, expect, it, vi } from "vitest";
import type { SessionUpdateInput, SessionView } from "../../../shared/domain";
import type { SessionPageInput } from "../../../shared/session-catalog";
import {
  loadManagedSessions,
  planSessionBatch,
  runSessionBatch,
  type SessionManagementApi,
} from "./session-management";

function session(id: string, overrides: Partial<SessionView> = {}): SessionView {
  return {
    id,
    title: id,
    parentSessionId: null,
    providerId: null,
    modelId: null,
    agentProfileId: "default",
    workspacePath: "C:\\project",
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
    status: "idle",
    archived: false,
    pinned: false,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    lastOpenedAt: "2026-11-11T00:00:00.000Z",
    ...overrides,
  };
}

function fixture(initial: SessionView[]) {
  const records = new Map(initial.map((value) => [value.id, { ...value }]));
  const family = (id: string) => {
    const ids = new Set([id]);
    for (const parentId of ids) {
      for (const value of records.values()) {
        if (value.parentSessionId === parentId) ids.add(value.id);
      }
    }
    return [...ids];
  };
  const api = {
    listSessionPage: vi.fn(async (input: SessionPageInput) => {
      const values = [...records.values()].filter(
        (value) => value.parentSessionId === input.parentId && value.archived === input.archived,
      );
      const offset = Number(input.cursor ?? 0);
      const limit = input.limit ?? 100;
      const next = offset + limit;
      return {
        sessions: values.slice(offset, next).map((value) => ({ ...value })),
        nextCursor: next < values.length ? String(next) : null,
        total: values.length,
        revision: 1,
      };
    }),
    getSession: vi.fn(async (id: string) => {
      const value = records.get(id);
      return value ? { ...value } : null;
    }),
    updateSession: vi.fn(async (input: SessionUpdateInput, _expected?: unknown) => {
      const root = records.get(input.sessionId);
      if (!root) throw new Error("Session not found");
      const ids = family(input.sessionId);
      if (
        input.archived &&
        ids.some((id) => {
          const status = records.get(id)?.status;
          return status === "running" || status === "waiting_approval";
        })
      )
        throw new Error("请先停止会话及其子任务，再归档。");
      for (const id of ids) {
        const value = records.get(id);
        if (value && input.archived !== undefined)
          records.set(id, { ...value, archived: input.archived });
      }
      return { ...root, archived: input.archived ?? root.archived };
    }),
    removeSession: vi.fn(async (id: string, _expected?: unknown) => {
      for (const member of family(id)) records.delete(member);
    }),
  } satisfies SessionManagementApi;
  return { api, records };
}

describe("workspace session management", () => {
  it("loads all root pages, including archived-only folders and sessions without a folder", async () => {
    const roots = Array.from({ length: 205 }, (_, index) => session(`root-${index}`));
    const archived = session("archived", { archived: true, workspacePath: "C:\\old-project" });
    const unassigned = session("unassigned", { workspacePath: null });
    const { api } = fixture([
      ...roots,
      unassigned,
      archived,
      session("child", { parentSessionId: roots[0]?.id ?? null }),
    ]);
    const loaded = await loadManagedSessions(api);
    expect(loaded.map((value) => value.id)).toEqual([
      ...roots.map((value) => value.id),
      "unassigned",
      "archived",
    ]);
    expect(api.listSessionPage.mock.calls.map(([input]) => input)).toEqual([
      { parentId: null, archived: false, limit: 200, cursor: null },
      { parentId: null, archived: false, limit: 200, cursor: "200" },
      { parentId: null, archived: true, limit: 200, cursor: null },
    ]);
  });

  it("does not start or continue paging after cancellation", async () => {
    const { api } = fixture([]);
    const before = new AbortController();
    before.abort();
    await expect(loadManagedSessions(api, before.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(api.listSessionPage).not.toHaveBeenCalled();

    const during = new AbortController();
    api.listSessionPage.mockImplementationOnce(async () => {
      during.abort();
      return { sessions: [session("first")], nextCursor: "next", total: 201, revision: 1 };
    });
    await expect(loadManagedSessions(api, during.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(api.listSessionPage).toHaveBeenCalledTimes(1);
  });

  it("rejects a repeated page cursor instead of looping forever", async () => {
    const { api } = fixture([]);
    api.listSessionPage.mockResolvedValue({
      sessions: [session("first")],
      nextCursor: "same",
      total: 201,
      revision: 1,
    });
    await expect(loadManagedSessions(api)).rejects.toThrow("会话目录发生变化");
    expect(api.listSessionPage).toHaveBeenCalledTimes(2);
  });

  it("rejects a revision change while paging rather than silently omitting moved sessions", async () => {
    const roots = Array.from({ length: 201 }, (_, index) => session(`root-${index}`));
    const { api } = fixture(roots);
    const list = api.listSessionPage.getMockImplementation();
    api.listSessionPage.mockImplementation(async (input) => {
      const page = await list?.(input);
      if (!page) throw new Error("Missing fixture");
      return { ...page, revision: input.cursor ? 2 : 1 };
    });
    await expect(loadManagedSessions(api)).rejects.toThrow("会话目录发生变化");
    expect(api.listSessionPage).toHaveBeenCalledTimes(6);
  });

  it("restarts the complete parent snapshot after an unrelated conversation-open revision", async () => {
    const roots = Array.from({ length: 201 }, (_, index) => session(`root-${index}`));
    const archived = session("archived", { archived: true });
    const { api } = fixture([...roots, archived]);
    const list = api.listSessionPage.getMockImplementation();
    let reads = 0;
    api.listSessionPage.mockImplementation(async (input) => {
      const page = await list?.(input);
      if (!page) throw new Error("Missing fixture");
      reads += 1;
      return { ...page, revision: reads === 1 ? 1 : 2 };
    });
    const loaded = await loadManagedSessions(api);
    expect(loaded.map((value) => value.id)).toEqual([
      ...roots.map((value) => value.id),
      archived.id,
    ]);
    expect(api.listSessionPage.mock.calls.map(([input]) => input.cursor)).toEqual([
      null,
      "200",
      null,
      "200",
      null,
    ]);
  });

  it("reloads a complete keyset snapshot when opening a later session moves it before the cursor", async () => {
    const roots = Array.from({ length: 201 }, (_, index) => session(`root-${index}`));
    const moved = roots[200];
    const last = roots[199];
    if (!moved || !last) throw new Error("Missing fixture");
    const { api } = fixture(roots);
    api.listSessionPage
      .mockResolvedValueOnce({
        sessions: roots.slice(0, 200),
        nextCursor: "first-anchor",
        total: 201,
        revision: 1,
      })
      .mockResolvedValueOnce({
        // The last session was opened and moved ahead of the first page's anchor.
        sessions: [],
        nextCursor: null,
        total: 201,
        revision: 2,
      })
      .mockResolvedValueOnce({
        sessions: [moved, ...roots.slice(0, 199)],
        nextCursor: "retry-anchor",
        total: 201,
        revision: 2,
      })
      .mockResolvedValueOnce({
        sessions: [last],
        nextCursor: null,
        total: 201,
        revision: 2,
      })
      .mockResolvedValueOnce({
        sessions: [],
        nextCursor: null,
        total: 0,
        revision: 2,
      });
    const loaded = await loadManagedSessions(api);
    expect(loaded).toHaveLength(201);
    expect(new Set(loaded.map((value) => value.id))).toEqual(
      new Set(roots.map((value) => value.id)),
    );
    expect(loaded[0]?.id).toBe(moved.id);
    expect(api.listSessionPage.mock.calls.map(([input]) => input.cursor)).toEqual([
      null,
      "first-anchor",
      null,
      "retry-anchor",
      null,
    ]);
  });

  it("rejects changes between archived scopes and an incomplete terminal page", async () => {
    const { api } = fixture([session("root")]);
    const list = api.listSessionPage.getMockImplementation();
    api.listSessionPage.mockImplementation(async (input) => {
      const page = await list?.(input);
      if (!page) throw new Error("Missing fixture");
      return { ...page, revision: input.archived ? 2 : 1 };
    });
    await expect(loadManagedSessions(api)).rejects.toThrow("会话目录发生变化");
    api.listSessionPage.mockResolvedValue({
      sessions: [],
      nextCursor: null,
      total: 1,
      revision: 1,
    });
    await expect(loadManagedSessions(api)).rejects.toThrow("会话目录发生变化");
  });

  it("plans each root once with every child page, nested descendants and worktree folders", async () => {
    const root = session("root");
    const children = Array.from({ length: 205 }, (_, index) =>
      session(`child-${index}`, {
        parentSessionId: root.id,
        workspacePath: `C:\\worktrees\\${index}`,
      }),
    );
    const archived = session("archived-child", {
      parentSessionId: root.id,
      archived: true,
      workspacePath: null,
    });
    const nested = session("nested", { parentSessionId: "child-0" });
    const { api } = fixture([root, ...children, archived, nested]);
    const plan = await planSessionBatch(api, [root, children[0] as SessionView, root], "delete");
    expect(plan.roots.map((value) => value.id)).toEqual(["root"]);
    expect(plan.sessions).toHaveLength(208);
    expect(new Set(plan.sessions.map((value) => value.id)).size).toBe(208);
    expect(plan.sessions.map((value) => value.id)).toEqual(
      expect.arrayContaining(["archived-child", "nested"]),
    );
    expect(
      api.listSessionPage.mock.calls.some(
        ([input]) => input.parentId === "root" && input.cursor === "200",
      ),
    ).toBe(true);
    expect(api.listSessionPage.mock.calls.every(([input]) => !("workspacePath" in input))).toBe(
      true,
    );
    expect(api.removeSession).not.toHaveBeenCalled();
  });

  it.each([
    { workspacePath: "C:\\moved" },
    { parentSessionId: "new-parent" },
    { archived: true },
  ] satisfies Partial<SessionView>[])(
    "rejects a root changed before confirmation: %j",
    async (patch) => {
      const root = session("root");
      const { api, records } = fixture([root]);
      records.set(root.id, { ...root, ...patch });
      await expect(planSessionBatch(api, [root], "delete")).rejects.toThrow(
        "会话的工作文件夹或归档状态已变化",
      );
      expect(api.removeSession).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing root, an empty selection and independently selected children", async () => {
    const root = session("root");
    const child = session("child", { parentSessionId: "root" });
    const { api } = fixture([child]);
    await expect(planSessionBatch(api, [root], "delete")).rejects.toThrow("会话已删除或不存在");
    await expect(planSessionBatch(api, [], "archive")).rejects.toThrow("请选择要管理的会话");
    await expect(planSessionBatch(api, [child], "delete")).rejects.toThrow("选择主会话");
  });

  it.each(["root", "child"])(
    "keeps busy %s archive failures separate and continues remaining roots",
    async (busyId) => {
      const root = session("root");
      const child = session("child", { parentSessionId: "root" });
      const second = session("second");
      const { api, records } = fixture([root, child, second]);
      const plan = await planSessionBatch(api, [root, second], "archive");
      records.set(busyId, { ...(records.get(busyId) as SessionView), status: "running" });
      const progress = vi.fn();
      const result = await runSessionBatch(api, plan, progress);
      expect(result.succeeded).toEqual(["second"]);
      expect(result.failures).toEqual([
        { sessionId: "root", title: "root", message: "请先停止会话及其子任务，再归档。" },
      ]);
      expect(records.get("root")?.archived).toBe(false);
      expect(records.get("child")?.archived).toBe(false);
      expect(records.get("second")?.archived).toBe(true);
      expect(api.updateSession.mock.calls.map(([input]) => input)).toEqual([
        { sessionId: "root", archived: true },
        { sessionId: "second", archived: true },
      ]);
      expect(api.updateSession.mock.calls[0]?.[1]).toEqual([
        {
          id: "root",
          parentSessionId: null,
          workspacePath: "C:\\project",
          archived: false,
        },
        {
          id: "child",
          parentSessionId: "root",
          workspacePath: "C:\\project",
          archived: false,
        },
      ]);
      expect(progress.mock.calls.map(([value]) => value)).toEqual([
        { completed: 1, total: 2, sessionId: "root", title: "root", succeeded: false },
        { completed: 2, total: 2, sessionId: "second", title: "second", succeeded: true },
      ]);
    },
  );

  it("rejects a newly added child after confirmation and still processes other roots", async () => {
    const root = session("root");
    const second = session("second");
    const { api, records } = fixture([root, second]);
    const plan = await planSessionBatch(api, [root, second], "delete");
    records.set("new-child", session("new-child", { parentSessionId: root.id }));
    const result = await runSessionBatch(api, plan);
    expect(result.succeeded).toEqual(["second"]);
    expect(result.failures[0]).toMatchObject({ sessionId: "root" });
    expect(result.failures[0]?.message).toContain("会话目录发生变化");
    expect(result.removedIds).toEqual(["second"]);
    expect(records.has("root")).toBe(true);
    expect(records.has("new-child")).toBe(true);
    expect(api.removeSession.mock.calls).toEqual([
      [
        "second",
        [
          {
            id: "second",
            parentSessionId: null,
            workspacePath: "C:\\project",
            archived: false,
          },
        ],
      ],
    ]);
  });

  it("rejects a newly added child even when a revision retry obtains the changed family", async () => {
    const root = session("root");
    const { api, records } = fixture([root]);
    const plan = await planSessionBatch(api, [root], "delete");
    const list = api.listSessionPage.getMockImplementation();
    let reads = 0;
    api.listSessionPage.mockImplementation(async (input) => {
      reads += 1;
      if (reads === 2) records.set("new-child", session("new-child", { parentSessionId: root.id }));
      const page = await list?.(input);
      if (!page) throw new Error("Missing fixture");
      return { ...page, revision: reads === 1 ? 1 : 2 };
    });
    const result = await runSessionBatch(api, plan);
    expect(result.succeeded).toEqual([]);
    expect(result.failures[0]?.message).toContain("会话目录发生变化");
    expect(records.has(root.id)).toBe(true);
    expect(records.has("new-child")).toBe(true);
    expect(api.removeSession).not.toHaveBeenCalled();
  });

  it("continues archiving when the app opens another conversation between child scopes", async () => {
    const root = session("root");
    const other = session("other");
    const { api, records } = fixture([root, other]);
    const plan = await planSessionBatch(api, [root], "archive");
    const list = api.listSessionPage.getMockImplementation();
    let reads = 0;
    api.listSessionPage.mockImplementation(async (input) => {
      reads += 1;
      if (reads === 2)
        records.set(other.id, { ...other, lastOpenedAt: "2026-11-11T01:00:00.000Z" });
      const page = await list?.(input);
      if (!page) throw new Error("Missing fixture");
      return { ...page, revision: reads === 1 ? 1 : 2 };
    });
    const result = await runSessionBatch(api, plan);
    expect(result).toEqual({ succeeded: ["root"], failures: [], removedIds: [] });
    expect(api.listSessionPage.mock.calls.slice(-4).map(([input]) => input)).toEqual([
      { parentId: root.id, archived: false, limit: 200, cursor: null },
      { parentId: root.id, archived: true, limit: 200, cursor: null },
      { parentId: root.id, archived: false, limit: 200, cursor: null },
      { parentId: root.id, archived: true, limit: 200, cursor: null },
    ]);
    expect(records.get(root.id)?.archived).toBe(true);
    expect(records.get(other.id)?.archived).toBe(false);
  });

  it.each([
    { workspacePath: "C:\\other-worktree" },
    { parentSessionId: "other-root" },
    { archived: true },
  ] satisfies Partial<SessionView>[])(
    "rejects a changed child after confirmation: %j",
    async (patch) => {
      const root = session("root");
      const child = session("child", { parentSessionId: root.id });
      const { api, records } = fixture([root, child]);
      const plan = await planSessionBatch(api, [root], "delete");
      records.set(child.id, { ...child, ...patch });
      const result = await runSessionBatch(api, plan);
      expect(result.succeeded).toEqual([]);
      expect(result.failures[0]?.message).toContain("会话目录发生变化");
      expect(api.removeSession).not.toHaveBeenCalled();
    },
  );

  it("restores a family with no configured model and ignores harmless title or timestamp updates", async () => {
    const root = session("root", { archived: true });
    const child = session("child", { parentSessionId: root.id, archived: true });
    const { api, records } = fixture([root, child]);
    const plan = await planSessionBatch(api, [root], "restore");
    records.set(root.id, { ...root, title: "renamed", updatedAt: "2026-11-11T01:00:00.000Z" });
    const result = await runSessionBatch(api, plan);
    expect(result).toEqual({ succeeded: ["root"], failures: [], removedIds: [] });
    expect(api.updateSession).toHaveBeenCalledWith({ sessionId: "root", archived: false }, [
      {
        id: "root",
        parentSessionId: null,
        workspacePath: "C:\\project",
        archived: true,
      },
      {
        id: "child",
        parentSessionId: "root",
        workspacePath: "C:\\project",
        archived: true,
      },
    ]);
    expect(records.get("child")?.archived).toBe(false);
  });

  it("reports actual child removals after partial failure without treating the root as successful", async () => {
    const root = session("root");
    const removed = session("removed", { parentSessionId: root.id });
    const unknown = session("unknown", { parentSessionId: root.id });
    const second = session("second");
    const { api, records } = fixture([root, removed, unknown, second]);
    const plan = await planSessionBatch(api, [root, second], "delete");
    const getSession = api.getSession.getMockImplementation();
    const removeSession = api.removeSession.getMockImplementation();
    let failed = false;
    api.getSession.mockImplementation(async (id) => {
      if (failed && id === "unknown") throw new Error("database unavailable");
      return (await getSession?.(id)) ?? null;
    });
    api.removeSession.mockImplementation(async (id) => {
      if (id === "root") {
        records.delete("removed");
        failed = true;
        throw new Error("snapshot locked");
      }
      await removeSession?.(id);
    });
    const result = await runSessionBatch(api, plan);
    expect(result.succeeded).toEqual(["second"]);
    expect(result.failures).toEqual([
      { sessionId: "root", title: "root", message: "snapshot locked" },
    ]);
    expect(result.removedIds).toEqual(["removed", "second"]);
    expect(records.has("root")).toBe(true);
    expect(records.has("unknown")).toBe(true);
  });
});
