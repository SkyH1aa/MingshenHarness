import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ProjectNavigationService } from "./project-navigation-service";

function createSession(
  repository: Repository,
  input: {
    agentMode?: "code" | "chat";
    workspacePath: string | null;
    executionMode?: "host" | "worktree";
  },
) {
  return repository.insertSession({
    title: "Fixture",
    providerId: null,
    modelId: null,
    agentMode: input.agentMode ?? "code",
    agentProfileId: "primary",
    workspacePath: input.workspacePath,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: input.executionMode ?? "host",
    patchOnly: false,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("ProjectNavigationService", () => {
  it("does not infer branch history for unresolved or missing old records", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const readBranch = vi.fn(async () => "current-branch");
    const service = new ProjectNavigationService(repository, undefined, readBranch);
    try {
      const old = createSession(repository, { workspacePath: "C:\\Legacy" });
      const missing = createSession(repository, { workspacePath: "C:\\Missing" });
      repository.setSetting(`session.project-context.${old.id}`, {
        workspacePath: old.workspacePath,
        branch: null,
        worktree: false,
        recordedAt: "2020-01-01T00:00:00.000Z",
        resolved: false,
      });

      const result = await service.list([old.id, missing.id]);
      expect(result.contexts[old.id]).toMatchObject({
        branch: null,
        workspacePath: old.workspacePath,
      });
      expect(result.contexts[missing.id]).toBeNull();
      expect(readBranch).not.toHaveBeenCalled();
      expect(repository.getSetting(`session.project-context.${old.id}`)).toMatchObject({
        branch: null,
        resolved: false,
      });
    } finally {
      await service.dispose();
      database.close();
    }
  });

  it("bounds concurrent reads and cancels queued jobs on disposal", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const pending = new Map<string, ReturnType<typeof deferred<string | null>>>();
    const readBranch = vi.fn((path: string) => {
      const result = deferred<string | null>();
      pending.set(path, result);
      return result.promise;
    });
    const service = new ProjectNavigationService(repository, undefined, readBranch);
    try {
      const sessions = Array.from({ length: 7 }, (_, index) =>
        createSession(repository, { workspacePath: `C:\\Project${index}` }),
      );
      const first = sessions[0];
      const second = sessions[1];
      if (!first || !second) throw new Error("Expected fixture sessions");
      for (const session of sessions)
        service.markCreated(session.id, session.workspacePath, session.executionMode);

      await vi.waitFor(() => expect(readBranch).toHaveBeenCalledTimes(4));
      pending.get("C:\\Project0")?.resolve("main");
      await vi.waitFor(() => expect(readBranch).toHaveBeenCalledTimes(5));

      const disposed = service.dispose();
      expect(() => service.markCreated(first.id, first.workspacePath, "host")).toThrow();
      for (const result of pending.values()) result.resolve("after-close");
      await disposed;
      expect(readBranch).toHaveBeenCalledTimes(5);
      expect(repository.getSetting(`session.project-context.${second.id}`)).toMatchObject({
        branch: null,
        resolved: false,
      });
    } finally {
      for (const result of pending.values()) result.resolve(null);
      await service.dispose();
      database.close();
    }
  });

  it("deduplicates repeated resets and ignores stale results after reset or removal", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const results: Array<ReturnType<typeof deferred<string | null>>> = [];
    const readBranch = vi.fn(() => {
      const result = deferred<string | null>();
      results.push(result);
      return result.promise;
    });
    const service = new ProjectNavigationService(repository, undefined, readBranch);
    try {
      const session = createSession(repository, { workspacePath: "C:\\Project" });
      service.markCreated(session.id, session.workspacePath, "host");
      await vi.waitFor(() => expect(readBranch).toHaveBeenCalledTimes(1));
      service.reset(session.id, session.workspacePath, "host");
      service.reset(session.id, session.workspacePath, "host");
      expect(readBranch).toHaveBeenCalledTimes(1);
      results[0]?.resolve("stale");
      await vi.waitFor(() => expect(readBranch).toHaveBeenCalledTimes(2));
      expect((await service.list([session.id])).contexts[session.id]?.branch).toBeNull();
      results[1]?.resolve("new-branch");
      await vi.waitFor(async () =>
        expect((await service.list([session.id])).contexts[session.id]?.branch).toBe("new-branch"),
      );

      service.reset(session.id, session.workspacePath, "host");
      await vi.waitFor(() => expect(readBranch).toHaveBeenCalledTimes(3));
      service.forget(session.id);
      results[2]?.resolve("removed");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(repository.getSetting(`session.project-context.${session.id}`)).toBeNull();

      const deleted = createSession(repository, { workspacePath: "C:\\Deleted" });
      service.markCreated(deleted.id, deleted.workspacePath, "host");
      await vi.waitFor(() => expect(readBranch).toHaveBeenCalledTimes(4));
      repository.removeSession(deleted.id);
      results[3]?.resolve("removed-directly");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(repository.getSetting(`session.project-context.${deleted.id}`)).toBeNull();

      service.reset(session.id, session.workspacePath, "host");
      await vi.waitFor(() => expect(readBranch).toHaveBeenCalledTimes(5));
      service.reset(session.id, null, "host");
      results[4]?.resolve("workspace-removed");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(repository.getSetting(`session.project-context.${session.id}`)).toBeNull();
    } finally {
      for (const result of results) result.resolve(null);
      await service.dispose();
      database.close();
    }
  });

  it("captures established worktree branches without falling back to the source workspace", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const roots = new Map<string, string>();
    const readBranch = vi.fn(async (path: string) => (path === "C:\\Tree" ? "feature" : "main"));
    const service = new ProjectNavigationService(
      repository,
      (id) => roots.get(id) ?? null,
      readBranch,
    );
    try {
      const tree = createSession(repository, {
        workspacePath: "C:\\Project",
        executionMode: "worktree",
      });
      const missing = createSession(repository, {
        workspacePath: "C:\\Project",
        executionMode: "worktree",
      });
      const legacy = createSession(repository, {
        workspacePath: "C:\\Project",
        executionMode: "worktree",
      });
      const chat = createSession(repository, { agentMode: "chat", workspacePath: null });
      repository.setSetting(`session.project-context.${legacy.id}`, {
        workspacePath: legacy.workspacePath,
        branch: "old-host-branch",
        worktree: true,
        recordedAt: "2020-01-01T00:00:00.000Z",
        resolved: true,
      });
      roots.set(tree.id, "C:\\Tree");
      service.markCreated(tree.id, tree.workspacePath, "worktree");
      service.markCreated(missing.id, missing.workspacePath, "worktree");
      service.markCreated(chat.id, chat.workspacePath, "host");
      await vi.waitFor(() => expect(readBranch).toHaveBeenCalledOnce());
      await vi.waitFor(async () =>
        expect((await service.list([tree.id])).contexts[tree.id]?.branch).toBe("feature"),
      );
      expect(readBranch).toHaveBeenCalledWith("C:\\Tree");
      expect(
        (await service.list([tree.id, missing.id, legacy.id, chat.id])).contexts,
      ).toMatchObject({
        [tree.id]: { workspacePath: "C:\\Project", branch: "feature", worktree: true },
        [missing.id]: { branch: null, worktree: true },
        [legacy.id]: { branch: null, worktree: true },
        [chat.id]: null,
      });
    } finally {
      await service.dispose();
      database.close();
    }
  });

  it("does not start a scheduled branch read after disposal begins", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const readBranch = vi.fn(async () => "main");
    const service = new ProjectNavigationService(repository, undefined, readBranch);
    try {
      const session = createSession(repository, { workspacePath: "C:\\Project" });
      service.markCreated(session.id, session.workspacePath, "host");
      await service.dispose();
      expect(() => service.forget(session.id)).not.toThrow();
      expect(readBranch).not.toHaveBeenCalled();
      expect(repository.getSetting(`session.project-context.${session.id}`)).toMatchObject({
        branch: null,
        resolved: false,
      });
    } finally {
      await service.dispose();
      database.close();
    }
  });
});
