import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatService } from "../chat/chat-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ScheduledTaskService } from "./scheduled-task-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ScheduledTaskService", () => {
  it("waits for pending sends on disposal without writing a shutdown error into the session", async () => {
    const append = vi.fn();
    let finish!: (error: Error) => void;
    const pending = new Promise<{ runId: string }>((_done, reject) => {
      finish = reject;
    });
    const chat = { send: vi.fn(() => pending), emitMessage: vi.fn() } as unknown as ChatService;
    const service = new ScheduledTaskService(
      {
        getSession: () => ({ id: "session" }),
        getScheduledTask: () => ({ id: "task", sessionId: "session", prompt: "Check" }),
        markScheduledTaskRun: vi.fn(),
        appendMessage: append,
      } as unknown as Repository,
      chat,
    );
    const running = service.runNow("task");
    let closed = false;
    const stopping = service.dispose().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    finish(new Error("Application is shutting down."));
    await running;
    await stopping;
    expect(closed).toBe(true);
    expect(append).not.toHaveBeenCalled();
    await service.runNow("task");
    expect(chat.send).toHaveBeenCalledTimes(1);
  });
  it("creates a task and sends its prompt when run now", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-schedule-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    const session = repository.insertSession({
      title: "Scheduled session",
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    });
    const chatService = {
      send: vi.fn().mockResolvedValue({ runId: "run" }),
      emitMessage: vi.fn(),
    } as unknown as ChatService;
    const service = new ScheduledTaskService(repository, chatService);

    const task = service.create({
      name: "检查项目",
      prompt: "检查当前项目状态。",
      sessionId: session.id,
      intervalMinutes: 30,
      enabled: true,
    });
    await service.runNow(task.id);

    expect(chatService.send).toHaveBeenCalledWith({
      sessionId: session.id,
      text: "检查当前项目状态。",
    });
    expect(service.list()[0]).toMatchObject({
      id: task.id,
      enabled: true,
      intervalMinutes: 30,
    });
    expect(service.list()[0]?.lastRunAt).not.toBeNull();
    database.close();
  });
});
