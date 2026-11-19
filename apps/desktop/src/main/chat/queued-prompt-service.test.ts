import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAttachmentInput, ChatSendInput } from "../../shared/domain";
import {
  MAX_QUEUED_PROMPT_ATTACHMENT_BYTES,
  MAX_QUEUED_PROMPTS,
  QUEUED_PROMPT_CONFIGURATION_CHANGED,
  QUEUED_PROMPT_REQUIRES_ACTIVE_RUN,
  QUEUED_PROMPT_UNSUPPORTED_SUBAGENT,
  queuedPromptSettingKey,
} from "../../shared/queued-prompt";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import * as attachmentValidation from "./attachment-validation";
import { type QueuedPromptRuntime, QueuedPromptService } from "./queued-prompt-service";

const bytes = Buffer.from([0, 255, 3, 128]);
const fileAttachment = (name = "fixture.bin"): ChatAttachmentInput => ({
  name,
  mimeType: "application/octet-stream",
  size: bytes.length,
  kind: "file",
  dataUrl: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
  path: "C:\\private\\fixture.bin",
});
const sizedAttachment = (name: string, size: number): ChatAttachmentInput => ({
  name,
  mimeType: "application/octet-stream",
  size,
  kind: "file",
  dataUrl: "data:application/octet-stream;base64,AA==",
});

function createSession(
  repository: Repository,
  change: Partial<Parameters<Repository["insertSession"]>[0]> = {},
) {
  return repository.insertSession({
    title: "Queue fixture",
    providerId: "provider-1",
    modelId: "model-1",
    agentProfileId: "primary",
    agentMode: "code",
    workspacePath: "C:\\workspace",
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
    ...change,
  });
}

function runtime(busy = true) {
  let currentBusy = busy;
  return {
    isSessionBusy: vi.fn(() => currentBusy),
    send: vi.fn(async (_input: ChatSendInput) => ({ runId: "run-1" })),
    changed: vi.fn(),
    setBusy(next: boolean) {
      currentBusy = next;
    },
  } satisfies QueuedPromptRuntime & { setBusy(next: boolean): void };
}

type TestRuntime = ReturnType<typeof runtime>;

async function waitForSendCount(active: TestRuntime, count: number): Promise<void> {
  await vi.waitFor(() => expect(active.send).toHaveBeenCalledTimes(count));
}

async function settleRun(
  service: QueuedPromptService,
  active: TestRuntime,
  sessionId: string,
  runId: string,
  outcome: "completed" | "failed" | "interrupted" = "completed",
): Promise<void> {
  active.setBusy(false);
  service.runSettled({ sessionId, runId, outcome });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("queued prompts", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;

  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  it("queues only while a run is active and returns metadata without attachment bytes or paths", () => {
    const session = createSession(repository);
    const idle = runtime(false);
    const idleService = new QueuedPromptService(repository, idle);

    expect(() =>
      idleService.add({
        sessionId: session.id,
        text: "Next",
        attachments: [fileAttachment()],
      }),
    ).toThrow(QUEUED_PROMPT_REQUIRES_ACTIVE_RUN);

    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    const queued = service.add({
      sessionId: session.id,
      text: "Next",
      attachments: [fileAttachment()],
    });
    expect(queued).toMatchObject({
      text: "Next",
      attachments: [
        {
          name: "fixture.bin",
          mimeType: "application/octet-stream",
          size: bytes.length,
          kind: "file",
        },
      ],
      snapshot: {
        agentMode: "code",
        workspacePath: "C:\\workspace",
        agentProfileId: "primary",
        providerId: "provider-1",
        modelId: "model-1",
        permissionMode: "request_approval",
        approvalMode: "manual",
        executionMode: "host",
      },
      canContinue: false,
      continuationBlocker: "session_busy",
    });
    expect(queued.attachments[0]).not.toHaveProperty("dataUrl");
    expect(queued.attachments[0]).not.toHaveProperty("path");
    expect(JSON.stringify(queued)).not.toContain("base64");
    const stored = repository.getSetting(queuedPromptSettingKey(session.id)) as {
      items: Array<{ attachments: ChatAttachmentInput[] }>;
    };
    expect(stored.items[0]?.attachments[0]).toMatchObject({
      name: "fixture.bin",
      dataUrl: fileAttachment().dataUrl,
    });
    expect(stored.items[0]?.attachments[0]).not.toHaveProperty("path");
  });

  it("allows primary ChatAgent queues while rejecting SubAgent sessions", () => {
    const parent = createSession(repository);
    const chat = createSession(repository, {
      agentMode: "chat",
      workspacePath: null,
    });
    const child = createSession(repository, {
      parentSessionId: parent.id,
    });
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);

    expect(service.add({ sessionId: chat.id, text: "Chat queue" })).toMatchObject({
      text: "Chat queue",
      snapshot: { agentMode: "chat" },
    });
    expect(() => service.add({ sessionId: child.id, text: "SubAgent queue" })).toThrow(
      QUEUED_PROMPT_UNSUPPORTED_SUBAGENT,
    );
    expect(active.send).not.toHaveBeenCalled();
  });

  it("rejects continuation when a legacy queue item now belongs to a SubAgent", async () => {
    const parent = createSession(repository);
    const session = createSession(repository, { workspacePath: "C:\\legacy-queue" });
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    const item = service.add({ sessionId: session.id, text: "Legacy queue" });
    active.setBusy(false);
    database
      .prepare("update sessions set parent_session_id = ? where id = ?")
      .run(parent.id, session.id);
    await expect(service.continue(session.id, item.id)).rejects.toThrow(
      QUEUED_PROMPT_UNSUPPORTED_SUBAGENT,
    );
    expect(active.send).not.toHaveBeenCalled();
  });

  it("persists a held queue across restart, starts paused, and sends nothing until explicit resume", async () => {
    const session = createSession(repository);
    const firstRuntime = runtime(true);
    const first = new QueuedPromptService(repository, firstRuntime);
    first.runStarted(session.id, "before-restart");
    const queued = first.add({ sessionId: session.id, text: "Hold until resumed" });

    const afterRestart = runtime(false);
    const reopened = new QueuedPromptService(repository, afterRestart);
    expect(reopened.list(session.id)).toEqual([
      expect.objectContaining({
        id: queued.id,
        text: "Hold until resumed",
        canContinue: true,
        continuationBlocker: null,
        automaticPauseReason: "restarted",
      }),
    ]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(afterRestart.send).not.toHaveBeenCalled();

    await expect(reopened.continue(session.id, queued.id)).resolves.toEqual(
      expect.objectContaining({
        itemId: queued.id,
        runId: "run-1",
        dispatchId: expect.any(String),
      }),
    );
    expect(afterRestart.send).toHaveBeenCalledExactlyOnceWith({
      sessionId: session.id,
      text: "Hold until resumed",
      attachments: [],
    });
    expect(reopened.list(session.id)).toEqual([]);
  });

  it("automatically dispatches ten messages in insertion order only after each run completes", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++)
      service.add({ sessionId: session.id, text: `queued-${index}` });

    let dispatchIndex = 0;
    active.send.mockImplementation(async () => {
      const runId = `queued-run-${dispatchIndex++}`;
      active.setBusy(true);
      service.runStarted(session.id, runId);
      return { runId };
    });

    await settleRun(service, active, session.id, "initial-run");
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++) {
      await waitForSendCount(active, index + 1);
      expect(active.send.mock.calls[index]?.[0]).toMatchObject({
        sessionId: session.id,
        text: `queued-${index}`,
      });
      await settleRun(service, active, session.id, `queued-run-${index}`);
    }

    expect(active.send).toHaveBeenCalledTimes(MAX_QUEUED_PROMPTS);
    expect(service.list(session.id)).toEqual([]);
  });

  it("continues WorkAgent main-session FIFO across consecutive successful runs", async () => {
    const session = createSession(repository, {
      agentMode: "work",
      workspacePath: "C:\\work-project",
    });
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "work-initial");
    service.add({ sessionId: session.id, text: "Work one" });
    service.add({ sessionId: session.id, text: "Work two" });
    service.add({ sessionId: session.id, text: "Work three" });

    let dispatchIndex = 0;
    active.send.mockImplementation(async () => {
      const runId = `work-queued-${dispatchIndex++}`;
      active.setBusy(true);
      service.runStarted(session.id, runId);
      return { runId };
    });

    await settleRun(service, active, session.id, "work-initial");
    for (const [index, text] of ["Work one", "Work two", "Work three"].entries()) {
      await waitForSendCount(active, index + 1);
      expect(active.send.mock.calls[index]?.[0]).toMatchObject({
        sessionId: session.id,
        text,
      });
      await settleRun(service, active, session.id, `work-queued-${index}`);
    }

    expect(active.send).toHaveBeenCalledTimes(3);
    expect(service.list(session.id)).toEqual([]);
  });

  it("does not replay a queued item from duplicate completion notifications", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    service.add({ sessionId: session.id, text: "Only once" });
    active.send.mockImplementationOnce(async () => {
      active.setBusy(true);
      service.runStarted(session.id, "queued-run");
      return { runId: "queued-run" };
    });

    await settleRun(service, active, session.id, "initial-run");
    await waitForSendCount(active, 1);
    service.runSettled({ sessionId: session.id, runId: "initial-run", outcome: "completed" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(active.send).toHaveBeenCalledTimes(1);

    await settleRun(service, active, session.id, "queued-run");
    expect(active.send).toHaveBeenCalledTimes(1);
    expect(service.list(session.id)).toEqual([]);
  });

  it("does not lose the next dispatch when a very short run completes before send acceptance", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    service.add({ sessionId: session.id, text: "Short" });
    service.add({ sessionId: session.id, text: "After short" });

    let call = 0;
    active.send.mockImplementation(async () => {
      call += 1;
      const runId = call === 1 ? "short-run" : "after-short-run";
      active.setBusy(true);
      service.runStarted(session.id, runId);
      if (runId === "short-run") {
        active.setBusy(false);
        service.runSettled({ sessionId: session.id, runId, outcome: "completed" });
      }
      return { runId };
    });

    await settleRun(service, active, session.id, "initial-run");
    await waitForSendCount(active, 2);
    expect(active.send.mock.calls.map(([input]) => (input as ChatSendInput).text)).toEqual([
      "Short",
      "After short",
    ]);
    expect(service.list(session.id).map((item) => item.text)).toEqual([]);
  });

  it("pauses after stop or failure and resumes the same head item", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    const queued = service.add({ sessionId: session.id, text: "Resume me" });

    service.pause(session.id, "stopped");
    await settleRun(service, active, session.id, "initial-run", "interrupted");
    expect(active.send).not.toHaveBeenCalled();
    expect(service.list(session.id)[0]).toMatchObject({
      id: queued.id,
      automaticPauseReason: "stopped",
    });

    active.send.mockImplementationOnce(async () => {
      active.setBusy(true);
      service.runStarted(session.id, "resumed-run");
      return { runId: "resumed-run" };
    });
    await expect(service.continue(session.id, queued.id)).resolves.toMatchObject({
      itemId: queued.id,
      runId: "resumed-run",
    });
    expect(active.send).toHaveBeenCalledExactlyOnceWith({
      sessionId: session.id,
      text: "Resume me",
      attachments: [],
    });

    const failedSession = createSession(repository);
    const failedRuntime = runtime(true);
    const failedService = new QueuedPromptService(repository, failedRuntime);
    failedService.runStarted(failedSession.id, "failed-initial");
    failedService.add({ sessionId: failedSession.id, text: "Retry after failure" });
    await settleRun(failedService, failedRuntime, failedSession.id, "failed-initial", "failed");
    expect(failedRuntime.send).not.toHaveBeenCalled();
    expect(failedService.list(failedSession.id)[0]).toMatchObject({
      automaticPauseReason: "failed",
    });
  });

  it("holds automatic dispatch while editing and sends saved text when the hold is released", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    const queued = service.add({ sessionId: session.id, text: "Before edit" });
    const editId = service.beginEdit(session.id, queued.id, 41);

    service.update({ sessionId: session.id, itemId: queued.id, text: "Saved edit" });
    await settleRun(service, active, session.id, "initial-run");
    expect(active.send).not.toHaveBeenCalled();
    expect(service.list(session.id)[0]).toMatchObject({
      text: "Saved edit",
      continuationBlocker: "editing",
      automaticPauseReason: "editing",
    });

    active.send.mockImplementationOnce(async () => {
      active.setBusy(true);
      service.runStarted(session.id, "edited-run");
      return { runId: "edited-run" };
    });
    service.endEdit(session.id, editId, false, 41);
    await waitForSendCount(active, 1);
    expect(active.send).toHaveBeenCalledExactlyOnceWith({
      sessionId: session.id,
      text: "Saved edit",
      attachments: [],
    });
  });

  it("keeps an abandoned edit paused and resumes only by explicit approval", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    const original = fileAttachment("original.bin");
    const queued = service.add({
      sessionId: session.id,
      text: "Keep original",
      attachments: [original],
    });
    const editId = service.beginEdit(session.id, queued.id);

    await settleRun(service, active, session.id, "initial-run");
    service.endEdit(session.id, editId, true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(active.send).not.toHaveBeenCalled();
    expect(service.list(session.id)[0]).toMatchObject({
      text: "Keep original",
      attachments: [expect.objectContaining({ name: "original.bin", size: bytes.length })],
      automaticPauseReason: "editing",
    });

    active.send.mockImplementationOnce(async () => {
      active.setBusy(true);
      service.runStarted(session.id, "explicit-resume");
      return { runId: "explicit-resume" };
    });
    await service.continue(session.id, queued.id);
    expect(active.send).toHaveBeenCalledExactlyOnceWith({
      sessionId: session.id,
      text: "Keep original",
      attachments: [
        expect.objectContaining({
          name: "original.bin",
          size: bytes.length,
          dataUrl: original.dataUrl,
        }),
      ],
    });
    expect(active.send.mock.calls[0]?.[0].attachments?.[0]).not.toHaveProperty("path");
  });

  it.each([
    { outcome: "interrupted" as const, pauseReason: "stopped" as const },
    { outcome: "failed" as const, pauseReason: "failed" as const },
  ])(
    "keeps the queue paused after $outcome finishes while an edit hold is open",
    async ({ outcome, pauseReason }) => {
      const session = createSession(repository);
      const active = runtime(true);
      const service = new QueuedPromptService(repository, active);
      service.runStarted(session.id, "initial-run");
      const queued = service.add({ sessionId: session.id, text: "Hold through outcome" });
      const editId = service.beginEdit(session.id, queued.id);

      active.setBusy(false);
      service.runSettled({ sessionId: session.id, runId: "initial-run", outcome });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(active.send).not.toHaveBeenCalled();
      expect(service.list(session.id)[0]).toMatchObject({
        automaticPauseReason: "editing",
      });

      service.endEdit(session.id, editId, false);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(active.send).not.toHaveBeenCalled();
      expect(service.list(session.id)[0]).toMatchObject({
        id: queued.id,
        automaticPauseReason: pauseReason,
      });
    },
  );

  it("abandons an owner's edit hold without automatically sending stale content", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    const queued = service.add({ sessionId: session.id, text: "Owner protected" });
    service.beginEdit(session.id, queued.id, 77);

    await settleRun(service, active, session.id, "initial-run");
    service.abandonEdits(77);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(active.send).not.toHaveBeenCalled();
    expect(service.list(session.id)[0]).toMatchObject({
      id: queued.id,
      automaticPauseReason: "editing",
    });
  });

  it("stops at a blocked head and resumes after the configuration is restored", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    const first = service.add({ sessionId: session.id, text: "First" });
    const second = service.add({ sessionId: session.id, text: "Second" });
    repository.updateSession(session.id, { agentProfileId: "changed-profile" });

    await settleRun(service, active, session.id, "initial-run");
    expect(active.send).not.toHaveBeenCalled();
    expect(service.list(session.id)[0]).toMatchObject({
      id: first.id,
      continuationBlocker: "configuration_changed",
    });
    await expect(service.continue(session.id, second.id)).rejects.toThrow(/请先处理第一条消息/);

    active.send.mockImplementationOnce(async () => {
      active.setBusy(true);
      service.runStarted(session.id, "first-run");
      return { runId: "first-run" };
    });
    repository.updateSession(session.id, { agentProfileId: "primary" });
    service.sessionChanged(session.id);
    await waitForSendCount(active, 1);
    expect(active.send).toHaveBeenCalledExactlyOnceWith({
      sessionId: session.id,
      text: "First",
      attachments: [],
    });
  });

  it("does not dispatch archived sessions or after service shutdown", async () => {
    const archivedSession = createSession(repository);
    const archivedRuntime = runtime(true);
    const archivedService = new QueuedPromptService(repository, archivedRuntime);
    archivedService.runStarted(archivedSession.id, "archived-initial");
    archivedService.add({ sessionId: archivedSession.id, text: "Not while archived" });
    repository.updateSession(archivedSession.id, { archived: true });
    await settleRun(archivedService, archivedRuntime, archivedSession.id, "archived-initial");
    expect(archivedRuntime.send).not.toHaveBeenCalled();

    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    const queued = service.add({ sessionId: session.id, text: "Shutdown protected" });
    service.dispose();
    active.setBusy(false);
    service.runSettled({ sessionId: session.id, runId: "initial-run", outcome: "completed" });
    await expect(service.continue(session.id, queued.id)).rejects.toThrow(
      "Application is shutting down.",
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(active.send).not.toHaveBeenCalled();
  });

  it("keeps a queue item after automatic send failure and allows one explicit retry", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.runStarted(session.id, "initial-run");
    const queued = service.add({ sessionId: session.id, text: "Retry me" });
    active.send.mockRejectedValueOnce(new Error("model unavailable"));

    await settleRun(service, active, session.id, "initial-run");
    await vi.waitFor(() =>
      expect(service.list(session.id)[0]).toMatchObject({
        id: queued.id,
        text: "Retry me",
        dispatchState: null,
        automaticPauseReason: "send_failed",
        automaticError: "model unavailable",
      }),
    );
    expect(active.send).toHaveBeenCalledTimes(1);

    active.send.mockImplementationOnce(async () => {
      active.setBusy(true);
      service.runStarted(session.id, "retry-run");
      return { runId: "retry-run" };
    });
    await service.continue(session.id, queued.id);
    expect(active.send).toHaveBeenCalledTimes(2);
  });

  it("persists a dispatch claim before send and blocks retry if accepted cleanup fails", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    const queued = service.add({ sessionId: session.id, text: "Dispatch exactly once" });
    active.setBusy(false);
    let claimedState: string | null = null;
    active.send.mockImplementationOnce(async () => {
      const stored = repository.getSetting(queuedPromptSettingKey(session.id)) as {
        items: Array<{ dispatch?: { state?: string } }>;
      };
      claimedState = stored.items[0]?.dispatch?.state ?? null;
      return { runId: "run-accepted" };
    });
    const originalSetSetting = repository.setSetting.bind(repository);
    let failAcceptedWrite = false;
    let writes = 0;
    vi.spyOn(repository, "setSetting").mockImplementation((key, value) => {
      if (failAcceptedWrite) {
        writes += 1;
        if (writes === 2) throw new Error("disk unavailable");
      }
      originalSetSetting(key, value);
    });

    failAcceptedWrite = true;
    const result = await service.continue(session.id, queued.id);
    expect(claimedState).toBe("sending");
    expect(result).toMatchObject({
      itemId: queued.id,
      runId: "run-accepted",
      cleanupWarning: expect.stringContaining("任务已启动"),
    });
    expect(service.list(session.id)).toEqual([
      expect.objectContaining({
        id: queued.id,
        canContinue: false,
        continuationBlocker: "dispatch_pending",
        dispatchState: "sending",
      }),
    ]);
    await expect(service.continue(session.id, queued.id)).rejects.toThrow(/禁止重试/);
    expect(active.send).toHaveBeenCalledTimes(1);

    const reopened = new QueuedPromptService(repository, active);
    expect(reopened.list(session.id)[0]).toMatchObject({
      continuationBlocker: "dispatch_pending",
      dispatchState: "sending",
    });
    reopened.remove(session.id, queued.id);
    expect(reopened.list(session.id)).toEqual([]);
  });

  it("locks an accepted dispatch when the third cleanup write fails and never replays it after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-queue-accepted-cleanup-"));
    const path = join(root, "queue.db");
    let disk = openDatabase(path);
    try {
      let repo = new Repository(disk);
      const session = createSession(repo);
      const active = runtime(true);
      const service = new QueuedPromptService(repo, active);
      service.runStarted(session.id, "initial-run");
      const queued = service.add({ sessionId: session.id, text: "Accepted exactly once" });
      active.setBusy(false);
      active.send.mockImplementationOnce(async () => {
        active.setBusy(true);
        service.runStarted(session.id, "accepted-run");
        return { runId: "accepted-run" };
      });

      const originalSetSetting = repo.setSetting.bind(repo);
      const originalRemoveSetting = repo.removeSetting.bind(repo);
      let persistenceWrites = 0;
      let cleanupWriteFailed = false;
      vi.spyOn(repo, "setSetting").mockImplementation((key, value) => {
        persistenceWrites += 1;
        originalSetSetting(key, value);
      });
      vi.spyOn(repo, "removeSetting").mockImplementation((key) => {
        persistenceWrites += 1;
        if (persistenceWrites === 3) {
          cleanupWriteFailed = true;
          throw new Error("cleanup remove failed");
        }
        originalRemoveSetting(key);
      });

      const result = await service.continue(session.id, queued.id);
      expect(result).toMatchObject({
        itemId: queued.id,
        runId: "accepted-run",
        cleanupWarning: expect.stringContaining("队列记录未能立即清理"),
      });
      expect(persistenceWrites).toBe(3);
      expect(cleanupWriteFailed).toBe(true);
      expect(active.send).toHaveBeenCalledTimes(1);
      expect(service.list(session.id)[0]).toMatchObject({
        id: queued.id,
        dispatchState: "accepted",
        continuationBlocker: "dispatch_pending",
        canContinue: false,
      });
      expect(() =>
        service.update({ sessionId: session.id, itemId: queued.id, text: "Retry as new" }),
      ).toThrow(/派发结果尚未确认/);

      disk.close();
      disk = openDatabase(path);
      repo = new Repository(disk);
      const restartedRuntime = runtime(false);
      const restarted = new QueuedPromptService(repo, restartedRuntime);
      expect(restarted.list(session.id)[0]).toMatchObject({
        id: queued.id,
        dispatchState: "accepted",
        continuationBlocker: "dispatch_pending",
        canContinue: false,
      });
      await expect(restarted.continue(session.id, queued.id)).rejects.toThrow(/禁止重试/);
      expect(restartedRuntime.send).not.toHaveBeenCalled();
    } finally {
      disk.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks changed configuration snapshots and rejects direct continuation", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    const queued = service.add({ sessionId: session.id, text: "Config locked" });
    active.setBusy(false);
    repository.updateSession(session.id, {
      agentProfileId: "other-profile",
      providerId: "provider-2",
      modelId: "model-2",
      permissionMode: "full_access",
      agentMode: "work",
      workspacePath: "D:\\workspace",
      executionMode: "docker",
    });
    repository.setSetting(`permissions.approval.${session.id}`, "automatic");

    expect(service.list(session.id)[0]).toMatchObject({
      id: queued.id,
      canContinue: false,
      continuationBlocker: "configuration_changed",
      changedConfigurationFields: expect.arrayContaining([
        "agentMode",
        "workspacePath",
        "agentProfileId",
        "providerId",
        "modelId",
        "permissionMode",
        "approvalMode",
        "executionMode",
      ]),
    });
    await expect(service.continue(session.id, queued.id)).rejects.toThrow(
      QUEUED_PROMPT_CONFIGURATION_CHANGED,
    );
    expect(active.send).not.toHaveBeenCalled();
  });

  it("edits text and attachments while preserving stable FIFO IDs", () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    const first = service.add({
      sessionId: session.id,
      text: "First",
      attachments: [fileAttachment("first.bin")],
    });
    const second = service.add({ sessionId: session.id, text: "Second" });

    expect(
      service.update({ sessionId: session.id, itemId: first.id, text: "First edited" }),
    ).toMatchObject({
      attachments: [expect.objectContaining({ name: "first.bin" })],
      text: "First edited",
    });
    expect(
      service.update({
        sessionId: session.id,
        itemId: first.id,
        text: "",
        attachments: [fileAttachment("replacement.bin")],
      }),
    ).toMatchObject({
      text: "",
      attachments: [expect.objectContaining({ name: "replacement.bin" })],
    });
    expect(JSON.stringify(service.list(session.id))).not.toContain("data:application");
    active.setBusy(false);
    expect(service.list(session.id)[1]).toMatchObject({
      id: second.id,
      continuationBlocker: "waiting_turn",
    });
    service.remove(session.id, second.id);
    expect(service.list(session.id).map((item) => item.id)).toEqual([first.id]);
  });

  it("allows exactly 50 MiB of queued attachments and rejects the next byte", () => {
    vi.spyOn(attachmentValidation, "validateChatAttachments").mockImplementation(
      (value) => value?.map((attachment) => ({ ...attachment })) ?? [],
    );
    const session = createSession(repository);
    const service = new QueuedPromptService(repository, runtime(true));

    service.add({
      sessionId: session.id,
      text: "Half",
      attachments: [sizedAttachment("half-1.bin", MAX_QUEUED_PROMPT_ATTACHMENT_BYTES / 2)],
    });
    service.add({
      sessionId: session.id,
      text: "Other half",
      attachments: [sizedAttachment("half-2.bin", MAX_QUEUED_PROMPT_ATTACHMENT_BYTES / 2)],
    });
    expect(() =>
      service.add({
        sessionId: session.id,
        text: "One byte over",
        attachments: [sizedAttachment("overflow.bin", 1)],
      }),
    ).toThrow(/超过 50 MiB/);
    expect(service.list(session.id)).toHaveLength(2);
  });

  it("enforces the 50 MiB boundary when replacing queued attachments", () => {
    vi.spyOn(attachmentValidation, "validateChatAttachments").mockImplementation(
      (value) => value?.map((attachment) => ({ ...attachment })) ?? [],
    );
    const session = createSession(repository);
    const service = new QueuedPromptService(repository, runtime(true));
    const twentyMiB = 20 * 1024 * 1024;
    service.add({
      sessionId: session.id,
      text: "Twenty A",
      attachments: [sizedAttachment("twenty-a.bin", twentyMiB)],
    });
    service.add({
      sessionId: session.id,
      text: "Twenty B",
      attachments: [sizedAttachment("twenty-b.bin", twentyMiB)],
    });
    const changed = service.add({
      sessionId: session.id,
      text: "Nine",
      attachments: [sizedAttachment("nine.bin", 9 * 1024 * 1024)],
    });

    expect(
      service.update({
        sessionId: session.id,
        itemId: changed.id,
        text: "Ten",
        attachments: [sizedAttachment("ten.bin", 10 * 1024 * 1024)],
      }),
    ).toMatchObject({
      text: "Ten",
      attachments: [expect.objectContaining({ name: "ten.bin", size: 10 * 1024 * 1024 })],
    });
    expect(() =>
      service.update({
        sessionId: session.id,
        itemId: changed.id,
        text: "Eleven",
        attachments: [sizedAttachment("eleven.bin", 11 * 1024 * 1024)],
      }),
    ).toThrow(/超过 50 MiB/);
    expect(service.list(session.id)[2]).toMatchObject({
      id: changed.id,
      text: "Ten",
      attachments: [expect.objectContaining({ name: "ten.bin", size: 10 * 1024 * 1024 })],
    });
  });

  it("rejects moving a queue item ahead of insertion order", () => {
    const session = createSession(repository);
    const service = new QueuedPromptService(repository, runtime(true));
    const first = service.add({ sessionId: session.id, text: "First" });
    const second = service.add({ sessionId: session.id, text: "Second" });

    expect(() =>
      service.reorder({ sessionId: session.id, itemId: second.id, targetIndex: 0 }),
    ).toThrow(/不支持调整顺序/);
    expect(service.list(session.id).map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it("enforces the ten-item cap and rejects continuation while busy or archived", () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++)
      service.add({ sessionId: session.id, text: `queued-${index}` });
    expect(() => service.add({ sessionId: session.id, text: "overflow" })).toThrow(
      /最多保留 10 条/,
    );
    expect(service.list(session.id)[0]).toMatchObject({
      continuationBlocker: "session_busy",
      canContinue: false,
    });
    repository.updateSession(session.id, { archived: true });
    expect(service.list(session.id)[0]).toMatchObject({
      continuationBlocker: "session_archived",
      canContinue: false,
    });
  });

  it("survives SQLite restart while preserving FIFO order, pause state and attachment snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-queued-prompts-"));
    const path = join(root, "queue.db");
    let disk = openDatabase(path);
    try {
      let repo = new Repository(disk);
      const session = createSession(repo);
      const first = new QueuedPromptService(repo, runtime(true));
      const one = first.add({
        sessionId: session.id,
        text: "One",
        attachments: [fileAttachment("one.bin")],
      });
      first.add({ sessionId: session.id, text: "Two" });
      disk.close();

      disk = openDatabase(path);
      repo = new Repository(disk);
      const reopened = new QueuedPromptService(repo, runtime(false));
      expect(reopened.list(session.id).map((item) => item.text)).toEqual(["One", "Two"]);
      expect(reopened.list(session.id)[0]).toMatchObject({
        id: one.id,
        automaticPauseReason: "restarted",
        attachments: [{ name: "one.bin", size: bytes.length }],
      });
      expect(reopened.list(session.id)[1]).toMatchObject({
        continuationBlocker: "waiting_turn",
      });
      expect(disk.prepare("pragma user_version").get()?.user_version).toBe(9);
      expect(disk.prepare("pragma integrity_check").get()?.integrity_check).toBe("ok");
    } finally {
      disk.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prevents update, remove and duplicate continue while a send acceptance is pending", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    const queued = service.add({ sessionId: session.id, text: "One at a time" });
    active.setBusy(false);
    let accept!: (value: { runId: string }) => void;
    active.send.mockImplementationOnce(
      () => new Promise<{ runId: string }>((resolve) => (accept = resolve)),
    );

    const pending = service.continue(session.id, queued.id);
    await expect(service.continue(session.id, queued.id)).rejects.toThrow(/正在发送/);
    expect(() =>
      service.update({
        sessionId: session.id,
        itemId: queued.id,
        text: "Must not change while dispatching",
      }),
    ).toThrow(/正在发送/);
    expect(() => service.remove(session.id, queued.id)).toThrow(/正在发送/);
    accept({ runId: "run-accepted" });
    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        itemId: queued.id,
        runId: "run-accepted",
        dispatchId: expect.any(String),
      }),
    );
    expect(service.list(session.id)).toEqual([]);
  });

  it("serializes continuation and never exposes the second item as dispatchable", async () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    const first = service.add({ sessionId: session.id, text: "First" });
    const second = service.add({ sessionId: session.id, text: "Second" });
    active.setBusy(false);
    let accept!: (value: { runId: string }) => void;
    active.send.mockImplementationOnce(async () => {
      active.setBusy(true);
      service.runStarted(session.id, "run-first");
      return await new Promise<{ runId: string }>((resolve) => (accept = resolve));
    });

    const pending = service.continue(session.id, first.id);
    await expect(service.continue(session.id, second.id)).rejects.toThrow(
      /该会话已有队列消息正在发送/,
    );
    expect(active.send).toHaveBeenCalledTimes(1);
    accept({ runId: "run-first" });
    await pending;
    expect(service.list(session.id)).toEqual([
      expect.objectContaining({
        id: second.id,
        continuationBlocker: "session_busy",
        canContinue: false,
      }),
    ]);
    active.send.mockImplementationOnce(async () => {
      active.setBusy(true);
      service.runStarted(session.id, "run-second");
      return { runId: "run-second" };
    });
    await settleRun(service, active, session.id, "run-first");
    await waitForSendCount(active, 2);
    expect(active.send.mock.calls[1]?.[0]).toMatchObject({
      sessionId: session.id,
      text: "Second",
    });
  });

  it("removes the persisted queue when its session is deleted", () => {
    const session = createSession(repository);
    const active = runtime(true);
    const service = new QueuedPromptService(repository, active);
    service.add({ sessionId: session.id, text: "Remove with session" });
    expect(repository.getSetting(queuedPromptSettingKey(session.id))).not.toBeNull();

    repository.removeSession(session.id);
    service.forgetSession(session.id);

    expect(repository.getSession(session.id)).toBeNull();
    expect(repository.getSetting(queuedPromptSettingKey(session.id))).toBeNull();
    expect(service.list(session.id)).toEqual([]);
  });
});
