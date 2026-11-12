import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatService } from "../chat/chat-service";
import { PermissionStore } from "../permissions/permission-store";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { SessionRetentionService } from "./session-retention-service";
import { SessionService } from "./session-service";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const DAY = 86400000;

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

describe("Conversation retention and lifecycle", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;
  let retention: SessionRetentionService;
  let sessions: SessionService;
  let busy: Set<string>;
  let remove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
    sessions = new SessionService(repository);
    busy = new Set();
    remove = vi.fn(async (id: string) => repository.removeSession(id));
    retention = new SessionRetentionService(repository, {
      isSessionBusy: (id: string) => busy.has(id),
      removeSession: remove,
    } as unknown as ChatService);
  });
  afterEach(async () => {
    await retention.dispose();
    database.close();
  });
  const create = (daysAgo = 40, parentSessionId?: string) => {
    const session = repository.insertSession({
      title: "Fixture",
      providerId: null,
      modelId: null,
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
      ...(parentSessionId ? { parentSessionId } : {}),
    });
    database
      .prepare("update sessions set last_opened_at = ? where id = ?")
      .run(new Date(NOW - daysAgo * DAY).toISOString(), session.id);
    const stored = repository.getSession(session.id);
    if (!stored) throw new Error("Fixture session missing");
    return stored;
  };

  it("defaults to never delete and validates persisted retention choices", async () => {
    create(400);
    expect(retention.settings()).toEqual({ days: null });
    await retention.sweep(NOW);
    expect(remove).not.toHaveBeenCalled();
    expect(retention.configure({ days: 30 })).toEqual({ days: 30 });
    expect(repository.getSetting("sessions.retentionDays")).toBe(30);
    for (const days of [0, -1, 1.5, 36501, Number.NaN, "30"])
      expect(() => retention.configure({ days } as never)).toThrow("自动清理");
    repository.setSetting("sessions.retentionDays", "bad");
    expect(retention.settings().days).toBeNull();
    retention.configure({ days: null });
  });

  it("records opening separately from edits, status updates and pinning", () => {
    const old = create();
    repository.updateSession(old.id, { title: "Renamed", pinned: true, status: "idle" });
    expect(repository.getSession(old.id)?.lastOpenedAt).toBe(old.lastOpenedAt);
    retention.opened(old.id);
    expect(Date.parse(repository.getSession(old.id)?.lastOpenedAt ?? "")).toBeGreaterThan(
      Date.parse(old.lastOpenedAt),
    );
  });

  it("deletes only expired conversations, retaining archived, open, busy and scheduled ones", async () => {
    retention.configure({ days: 30 });
    const expired = create(31);
    const boundary = create(30);
    const recent = create(29);
    const archive = create(200);
    repository.updateSession(archive.id, { archived: true });
    const active = create();
    retention.opened(active.id);
    const preparing = create();
    busy.add(preparing.id);
    const running = create();
    repository.updateSession(running.id, { status: "running" });
    const waiting = create();
    repository.updateSession(waiting.id, { status: "waiting_approval" });
    const scheduled = create();
    repository.insertScheduledTask({
      name: "Scheduled fixture",
      prompt: "Do not run",
      sessionId: scheduled.id,
      intervalMinutes: 60,
      enabled: true,
      nextRunAt: new Date(NOW + DAY).toISOString(),
    });
    await retention.sweep(NOW);
    expect(remove).toHaveBeenCalledExactlyOnceWith(expired.id, expect.any(Function));
    for (const session of [
      boundary,
      recent,
      archive,
      active,
      preparing,
      running,
      waiting,
      scheduled,
    ])
      expect(repository.getSession(session.id)).not.toBeNull();
  });

  it.each(["archived", "busy", "recent", "scheduled", "draft", "notification-draft"])(
    "does not delete a tree with a protected %s child",
    async (kind) => {
      retention.configure({ days: 30 });
      const parent = create(200);
      const child = create(kind === "recent" ? 1 : 200, parent.id);
      if (kind === "archived") repository.updateSession(child.id, { archived: true });
      if (kind === "busy") busy.add(child.id);
      if (kind === "draft")
        repository.saveComposerDraft({
          sessionId: child.id,
          revision: "child-draft",
          text: "Keep child draft",
          formatted: false,
          attachmentIds: [],
          notificationDraftIds: [],
        });
      if (kind === "notification-draft")
        repository.setSetting("desktop.notificationReplyDraft", [
          {
            id: "notification-1",
            sessionId: child.id,
            text: "Keep pending notification reply",
            error: "Fixture send failed",
          },
        ]);
      if (kind === "scheduled")
        repository.insertScheduledTask({
          name: "Child schedule",
          prompt: "Do not run",
          sessionId: child.id,
          intervalMinutes: 60,
          enabled: true,
          nextRunAt: new Date(NOW + DAY).toISOString(),
        });
      await retention.sweep(NOW);
      expect(remove).not.toHaveBeenCalled();
      expect(repository.listSessions()).toHaveLength(2);
    },
  );

  it("cleans up an expired family children first without removing project paths", async () => {
    retention.configure({ days: 30 });
    const parent = create(200);
    const child = create(200, parent.id);
    const grandchild = create(200, child.id);
    await retention.sweep(NOW);
    expect(remove.mock.calls.map(([id]) => id)).toEqual([grandchild.id, child.id, parent.id]);
    expect(repository.listSessions()).toEqual([]);
  });

  it("protects whitespace, attachment-only and damaged drafts from retention", async () => {
    retention.configure({ days: 30 });
    const whitespace = create(200);
    const file = create(200);
    const damaged = create(200);
    repository.saveComposerDraft({
      sessionId: whitespace.id,
      revision: "whitespace-draft",
      text: " \n\t ",
      formatted: false,
      attachmentIds: [],
      notificationDraftIds: [],
    });
    repository.saveComposerDraft({
      sessionId: file.id,
      revision: "file-draft",
      text: "",
      formatted: false,
      attachmentIds: ["empty-file"],
      addedAttachments: [
        {
          id: "empty-file",
          name: "empty.bin",
          mimeType: "application/octet-stream",
          size: 0,
          kind: "file",
          dataUrl: "data:application/octet-stream;base64,",
        },
      ],
      notificationDraftIds: [],
    });
    repository.setSetting(`composer.draft.${damaged.id}`, { text: "Keep for recovery" });
    await retention.sweep(NOW);
    expect(remove).not.toHaveBeenCalled();
    expect(repository.listSessions()).toHaveLength(3);
  });

  it("deletes an eligible session through the real ChatService despite its own removal lock", async () => {
    await retention.dispose();
    const emit = vi.fn();
    const chat = new ChatService({
      repository,
      approvalBroker: { cancelSession: vi.fn() },
      questionBroker: { cancelSession: vi.fn() },
      permissions: new PermissionStore(),
      emit,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    retention = new SessionRetentionService(repository, chat);
    retention.configure({ days: 30 });
    const session = create(200);
    try {
      await retention.sweep(NOW);
      expect(repository.getSession(session.id)).toBeNull();
      expect(emit).toHaveBeenCalledWith({ type: "session_removed", sessionId: session.id });
    } finally {
      await chat.shutdown();
    }
  });

  it.each(["self", "existing-child", "new-child"])(
    "rechecks a %s draft saved while real snapshot cleanup is waiting",
    async (target) => {
      await retention.dispose();
      let started!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const emit = vi.fn();
      const chat = new ChatService({
        repository,
        approvalBroker: { cancelSession: vi.fn() },
        questionBroker: { cancelSession: vi.fn() },
        snapshotService: {
          removeForSession: async () => {
            started();
            await waiting;
          },
        },
        permissions: new PermissionStore(),
        emit,
      } as unknown as ConstructorParameters<typeof ChatService>[0]);
      retention = new SessionRetentionService(repository, chat);
      retention.configure({ days: 30 });
      const parent = create(200);
      let child = target === "existing-child" ? create(200, parent.id) : null;
      try {
        const sweep = retention.sweep(NOW);
        await entered;
        if (target === "new-child") child = create(200, parent.id);
        const owner = child ?? parent;
        repository.saveComposerDraft({
          sessionId: owner.id,
          revision: "new-draft",
          text: "Saved during retention",
          formatted: false,
          attachmentIds: [],
          notificationDraftIds: [],
        });
        release();
        await sweep;
        expect(repository.getComposerDraft(owner.id)?.text).toBe("Saved during retention");
        expect(repository.getSession(parent.id)).not.toBeNull();
        expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: "session_removed" }));
      } finally {
        release();
        await retention.dispose();
        await chat.shutdown();
      }
    },
  );

  it("archives descendants and pauses schedules; restoring refreshes last opened date", async () => {
    const parent = create(200);
    const child = create(200, parent.id);
    const schedule = repository.insertScheduledTask({
      name: "Archive fixture",
      prompt: "Do not run",
      sessionId: child.id,
      intervalMinutes: 60,
      enabled: true,
      nextRunAt: new Date(NOW + DAY).toISOString(),
    });
    sessions.update({ sessionId: parent.id, archived: true });
    expect(repository.getSession(child.id)?.archived).toBe(true);
    expect(repository.getScheduledTask(schedule.id)?.enabled).toBe(false);
    sessions.update({ sessionId: parent.id, archived: false });
    for (const id of [parent.id, child.id]) {
      expect(repository.getSession(id)?.archived).toBe(false);
      expect(Date.parse(repository.getSession(id)?.lastOpenedAt ?? "")).toBeGreaterThan(
        Date.parse(parent.lastOpenedAt),
      );
    }
    expect(repository.getScheduledTask(schedule.id)?.enabled).toBe(false);
  });

  it("rejects archiving a running child and permits metadata changes with no configured model", () => {
    const parent = create();
    const child = create(40, parent.id);
    repository.updateSession(child.id, { status: "running" });
    expect(() => sessions.update({ sessionId: parent.id, archived: true })).toThrow("先停止");
    expect(repository.getSession(parent.id)?.archived).toBe(false);
    expect(sessions.update({ sessionId: parent.id, title: "Renamed", pinned: true })).toMatchObject(
      { title: "Renamed", pinned: true },
    );
  });

  it("deduplicates sweeps and waits for cleanup during disposal", async () => {
    retention.configure({ days: 30 });
    const session = create();
    let release!: () => void;
    remove.mockImplementation(async (id: string) => {
      await new Promise<void>((done) => {
        release = done;
      });
      repository.removeSession(id);
    });
    const first = retention.sweep(NOW);
    const second = retention.sweep(NOW);
    expect(first).toBe(second);
    while (!release) await Promise.resolve();
    const disposing = retention.dispose();
    expect(repository.getSession(session.id)).not.toBeNull();
    release();
    await disposing;
    expect(remove).toHaveBeenCalledTimes(1);
    await retention.sweep(NOW);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("restores latest run timing from real persisted start and terminal events", () => {
    const session = create();
    expect(repository.latestSessionRun(session.id)).toBeNull();
    const append = (runId: string, type: string, time: string) => {
      const event = repository.appendTrajectoryEvent({
        sessionId: session.id,
        runId,
        type,
        summary: "Fixture",
        payload: {},
      });
      database.prepare("update trajectories set created_at = ? where id = ?").run(time, event.id);
    };
    append("old", "run_started", "2026-11-01T00:00:00Z");
    append("old", "run_completed", "2026-11-01T00:00:05Z");
    append("new", "run_started", "2026-11-02T00:00:00Z");
    expect(repository.latestSessionRun(session.id)).toMatchObject({
      runId: "new",
      status: "running",
      completedAt: null,
    });
    append("new", "run_failed", "2026-11-02T00:00:07Z");
    expect(repository.latestSessionRun(session.id)).toMatchObject({
      runId: "new",
      status: "failed",
      startedAt: "2026-11-02T00:00:00Z",
      completedAt: "2026-11-02T00:00:07Z",
    });
  });

  it("allows shutdown to finish when snapshot cleanup fails and retains the history for retry", async () => {
    retention.configure({ days: 30 });
    const session = create();
    let fail!: () => void;
    remove.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = () => reject(new Error("Fixture storage unavailable"));
        }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const sweep = retention.sweep(NOW);
      const handled = expect(sweep).rejects.toThrow("storage unavailable");
      while (!fail) await Promise.resolve();
      const disposal = retention.dispose();
      fail();
      await handled;
      await expect(disposal).resolves.toBeUndefined();
      expect(repository.getSession(session.id)).not.toBeNull();
    } finally {
      log.mockRestore();
    }
  });
});
