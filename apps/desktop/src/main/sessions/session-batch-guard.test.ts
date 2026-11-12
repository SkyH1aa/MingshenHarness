import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localizeError } from "../../shared/localized-errors";
import type { SessionBatchTarget } from "../../shared/session-catalog";
import { ChatService } from "../chat/chat-service";
import { PermissionStore } from "../permissions/permission-store";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { createSessionBatchGuard } from "./session-batch-guard";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

describe("Confirmed batch conversation families", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;
  let chat: ChatService | undefined;
  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
  });
  afterEach(async () => {
    await chat?.shutdown();
    chat = undefined;
    database.close();
  });
  const create = (parentSessionId?: string, workspacePath: string | null = "C:\\Project") =>
    repository.insertSession({
      title: "Fixture",
      providerId: null,
      modelId: null,
      agentProfileId: "primary",
      workspacePath,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
      ...(parentSessionId ? { parentSessionId } : {}),
    });
  const makeChat = (removeForSession = vi.fn(async (_id: string) => undefined)) => {
    chat = new ChatService({
      repository,
      approvalBroker: { cancelSession: vi.fn() },
      questionBroker: { cancelSession: vi.fn() },
      snapshotService: { removeForSession },
      permissions: new PermissionStore(),
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    return chat;
  };

  it("preserves existing single-conversation API calls without an expectation", () => {
    expect(createSessionBatchGuard(repository, "missing")).toBeUndefined();
  });

  it.each([
    ["empty", []],
    ["null", null],
    ["invalid fields", [{ id: "root", parentSessionId: null, workspacePath: null }]],
    [
      "duplicate",
      [
        { id: "root", parentSessionId: null, workspacePath: null, archived: false },
        { id: "root", parentSessionId: null, workspacePath: null, archived: false },
      ],
    ],
    ["nonroot", [{ id: "root", parentSessionId: "parent", workspacePath: null, archived: false }]],
    [
      "extra root",
      [
        { id: "root", parentSessionId: null, workspacePath: null, archived: false },
        { id: "other", parentSessionId: null, workspacePath: null, archived: false },
      ],
    ],
    [
      "orphan",
      [
        { id: "root", parentSessionId: null, workspacePath: null, archived: false },
        { id: "child", parentSessionId: "missing", workspacePath: null, archived: false },
      ],
    ],
    [
      "disconnected cycle",
      [
        { id: "root", parentSessionId: null, workspacePath: null, archived: false },
        { id: "a", parentSessionId: "b", workspacePath: null, archived: false },
        { id: "b", parentSessionId: "a", workspacePath: null, archived: false },
      ],
    ],
  ])("rejects %s expectations before any mutation", (_name, input) => {
    expect(() =>
      createSessionBatchGuard(repository, "root", input as SessionBatchTarget[]),
    ).toThrow("会话目录发生变化");
    expect(repository.listSessions()).toEqual([]);
  });

  it("requires the complete initial family, including archived separate-worktree descendants", () => {
    const root = create();
    const child = create(root.id, "C:\\SeparateWorktree");
    repository.updateSession(child.id, { archived: true });
    const stored = repository.getSession(child.id);
    if (!stored) throw new Error("Missing fixture");
    expect(() => createSessionBatchGuard(repository, root.id, [root])).toThrow("会话目录");
    expect(createSessionBatchGuard(repository, root.id, [root, stored])?.()).toBe(true);
  });

  it.each(["workspace", "archive", "parent"])(
    "refuses a confirmed child whose %s identity changed",
    (change) => {
      const root = create();
      const child = create(root.id);
      const other = create();
      const guard = createSessionBatchGuard(repository, root.id, [root, child]);
      if (change === "workspace")
        repository.updateSession(child.id, { workspacePath: "C:\\Changed" });
      if (change === "archive") repository.updateSession(child.id, { archived: true });
      if (change === "parent")
        database
          .prepare("update sessions set parent_session_id = ? where id = ?")
          .run(other.id, child.id);
      expect(() => guard?.()).toThrow("会话目录发生变化");
      expect(repository.getSession(root.id)).not.toBeNull();
      expect(repository.getSession(child.id)).not.toBeNull();
    },
  );

  it("allows ordinary title and runtime updates and already deleted expected children", () => {
    const root = create();
    const child = create(root.id);
    const guard = createSessionBatchGuard(repository, root.id, [root, child]);
    repository.updateSession(root.id, { title: "Renamed", status: "interrupted", pinned: true });
    expect(guard?.()).toBe(true);
    repository.removeSession(child.id);
    expect(guard?.()).toBe(true);
    repository.removeSession(root.id);
    expect(() => guard?.()).toThrow("会话目录发生变化");
  });

  it("removes a confirmed family through real recursive deletion while retaining another root", async () => {
    const root = create();
    const child = create(root.id, "C:\\SeparateWorktree");
    const grandchild = create(child.id);
    const other = create();
    const guard = createSessionBatchGuard(repository, root.id, [root, child, grandchild]);
    await makeChat().removeSession(root.id, guard);
    expect(repository.listSessions().map((session) => session.id)).toEqual([other.id]);
  });

  it("catches a new child introduced while the real stop-and-wait yields", async () => {
    const root = create();
    const guard = createSessionBatchGuard(repository, root.id, [root]);
    const snapshots = vi.fn(async (_id: string) => undefined);
    const deleting = makeChat(snapshots).removeSession(root.id, guard);
    const handled = expect(deleting).rejects.toThrow("会话目录发生变化");
    const child = create(root.id);
    await handled;
    expect(repository.getSession(root.id)).not.toBeNull();
    expect(repository.getSession(child.id)).not.toBeNull();
    expect(snapshots).not.toHaveBeenCalled();
  });

  it.each(["new-child", "move-child", "archive-child"])(
    "blocks %s changes during real asynchronous snapshot cleanup",
    async (change) => {
      const root = create();
      const child = change === "new-child" ? undefined : create(root.id);
      const other = create();
      const guard = createSessionBatchGuard(repository, root.id, [root, ...(child ? [child] : [])]);
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const service = makeChat(
        vi.fn(async (_id: string) => {
          entered();
          await waiting;
        }),
      );
      const deleting = service.removeSession(root.id, guard);
      const handled = expect(deleting).rejects.toThrow("会话目录发生变化");
      try {
        await started;
        const changed = child ?? create(root.id);
        if (change === "move-child")
          database
            .prepare("update sessions set parent_session_id = ? where id = ?")
            .run(other.id, changed.id);
        if (change === "archive-child") repository.updateSession(changed.id, { archived: true });
        release();
        await handled;
        expect(repository.getSession(root.id)).not.toBeNull();
        expect(repository.getSession(changed.id)).not.toBeNull();
        expect(repository.getSession(other.id)).not.toBeNull();
      } finally {
        release();
      }
    },
  );

  it("localizes batch change errors before Electron wraps the IPC rejection", () => {
    expect(localizeError("会话目录发生变化，请刷新后重试。", "en")).toBe(
      "The conversation list changed. Refresh it and try again.",
    );
    expect(localizeError("会话的工作文件夹或归档状态已变化，请刷新后重试。", "en")).toBe(
      "The conversation's folder or archive status changed. Refresh the list and try again.",
    );
  });
});
