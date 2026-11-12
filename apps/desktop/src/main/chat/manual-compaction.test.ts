import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ChatService } from "./chat-service";

function fixture() {
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Fixture",
    baseUrl: "https://fixture.invalid/v1",
    protocol: "openai_responses",
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "fixture",
    displayName: "Fixture",
    contextWindow: 100000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: true,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const session = repository.insertSession({
    title: "Existing",
    providerId: provider.id,
    modelId: repository.getProvider(provider.id)?.models[0]?.id ?? null,
    agentProfileId: "primary",
    workspacePath: null,
    systemPrompt: "Constraints",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
  repository.appendMessage({
    sessionId: session.id,
    role: "user",
    parts: [{ type: "text", text: "Goal" }],
  });
  repository.appendMessage({
    sessionId: session.id,
    role: "assistant",
    parts: [{ type: "text", text: "Findings" }],
  });
  const emit = vi.fn();
  const tools = vi.fn();
  const chat = new ChatService({
    repository,
    emit,
    toolRegistry: { execute: tools },
    mcpService: { connect: tools },
    approvalBroker: { cancelSession: vi.fn() },
    questionBroker: { cancelSession: vi.fn() },
    permissions: { clearSession: vi.fn() },
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  return { database, repository, session, chat, emit, tools };
}

describe("manual compaction lifecycle", () => {
  it("uses a tracked cancellable job, reserves the conversation and never invokes workspace tools", async () => {
    const f = fixture();
    let release!: () => void;
    const pending = new Promise<void>((done) => {
      release = done;
    });
    const prepare = vi
      .spyOn(f.chat.contextCompaction, "prepare")
      .mockImplementation(async (input) => {
        expect(input.manual).toBe(true);
        expect(input.tools).toEqual([]);
        await pending;
        input.signal.throwIfAborted();
        return [];
      });
    try {
      const started = await f.chat.send({ sessionId: f.session.id, text: "/COMPACT" });
      expect(f.chat.activeConversationCount()).toBe(1);
      expect(f.chat.isSessionBusy(f.session.id)).toBe(true);
      expect(() => f.chat.compactSession(f.session.id)).toThrow("正在运行");
      expect(() => f.chat.forkSession(f.session.id)).toThrow("停止");
      expect(f.repository.getMessages(f.session.id)).toHaveLength(2);
      f.chat.stop(f.session.id);
      expect(prepare.mock.calls[0]?.[0].signal.aborted).toBe(true);
      const deleting = f.chat.removeSession(f.session.id);
      await Promise.resolve();
      expect(f.repository.getSession(f.session.id)).not.toBeNull();
      release();
      await deleting;
      expect(f.repository.getSession(f.session.id)).toBeNull();
      expect(f.tools).not.toHaveBeenCalled();
      expect(f.emit).toHaveBeenCalledWith({
        type: "run_interrupted",
        sessionId: f.session.id,
        runId: started.runId,
      });
    } finally {
      release();
      await f.chat.shutdown();
      f.database.close();
    }
  });
  it("reports compaction failures without inserting an assistant answer and waits during shutdown", async () => {
    const f = fixture();
    let release!: () => void;
    const pending = new Promise<void>((done) => {
      release = done;
    });
    vi.spyOn(f.chat.contextCompaction, "prepare").mockImplementation(async () => {
      await pending;
      throw new Error("Fixture failure");
    });
    try {
      const started = f.chat.compactSession(f.session.id);
      release();
      await vi.waitFor(() => expect(f.chat.activeConversationCount()).toBe(0));
      expect(f.emit).toHaveBeenCalledWith({
        type: "run_failed",
        sessionId: f.session.id,
        runId: started.runId,
        error: "Fixture failure",
      });
      expect(f.repository.getMessages(f.session.id)).toHaveLength(2);
      expect(f.repository.getSession(f.session.id)?.status).toBe("error");
      const fork = f.chat.forkSession(f.session.id);
      expect(fork.parentSessionId).toBeNull();
      expect(f.emit).toHaveBeenCalledWith({ type: "session_updated", session: fork });
    } finally {
      release();
      await f.chat.shutdown();
      f.database.close();
    }
  });
  it("rejects empty history and attachments before starting a compaction request", async () => {
    const f = fixture();
    const prepare = vi.spyOn(f.chat.contextCompaction, "prepare");
    try {
      await expect(
        f.chat.send({ sessionId: f.session.id, text: "/compact", attachments: [{} as never] }),
      ).rejects.toThrow("附件");
      f.repository.deleteMessagesFromSeq(f.session.id, 1);
      expect(() => f.chat.compactSession(f.session.id)).toThrow("完整历史");
      expect(prepare).not.toHaveBeenCalled();
      expect(f.chat.activeConversationCount()).toBe(0);
    } finally {
      await f.chat.shutdown();
      f.database.close();
    }
  });
});
