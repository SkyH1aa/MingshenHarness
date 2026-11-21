import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextCompactionService } from "../chat/context-compaction-service";
import type { ProviderService } from "../providers/provider-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";

describe("conversation forks", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;
  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
  });
  afterEach(() => database.close());
  const create = () =>
    repository.insertSession({
      title: "Original",
      providerId: "provider",
      modelId: "model",
      agentProfileId: "plan",
      workspacePath: "C:\\Project",
      systemPrompt: "Preserve constraints",
      reasoningLevel: "high",
      permissionMode: "request_approval",
      executionMode: "worktree",
      patchOnly: true,
    });
  it("copies the complete transcript, settings, extension references, todos and remapped effective summary independently", () => {
    const source = create();
    const user = repository.appendMessage({
      sessionId: source.id,
      role: "user",
      parts: [{ type: "text", text: "GOAL" }],
    });
    const result = repository.appendMessage({
      sessionId: source.id,
      role: "assistant",
      parts: [{ type: "text", text: "EARLIER_FACTS" }],
    });
    repository.appendMessage({
      sessionId: source.id,
      role: "user",
      parts: [{ type: "text", text: "CONTINUE" }],
    });
    repository.setSetting(`context.checkpoint.${source.id}`, {
      id: "summary-original",
      throughSeq: result.seq,
      throughId: result.id,
      summary: "COMPACTED_FACTS",
      createdAt: result.createdAt,
    });
    repository.setSetting(`context.model.${source.id}`, {
      mode: "custom",
      providerId: "summary-provider",
      modelId: "summary-model",
    });
    repository.setSetting(`context.observation.${source.id}`, { usedTokens: 99999 });
    repository.setSetting(`permissions.approval.${source.id}`, "automatic");
    repository.insertExtension({
      id: "skill",
      name: "Skill",
      type: "skill",
      description: "",
      sourcePath: "C:\\source",
      installedPath: "C:\\copy",
      contentHash: "hash",
      manifestJson: "{}",
    });
    repository.setSessionExtension(source.id, "skill", true);
    repository.replaceSessionTodos(source.id, [
      {
        id: "todo",
        content: "Remaining work",
        status: "pending",
        priority: "high",
        updatedAt: result.createdAt,
      },
    ]);
    repository.updateSession(source.id, { pinned: true, archived: true, status: "interrupted" });
    const original = repository.getMessages(source.id);
    const fork = repository.forkSession(source.id);
    expect(fork).toMatchObject({
      workspacePath: source.workspacePath,
      systemPrompt: source.systemPrompt,
      reasoningLevel: "high",
      agentProfileId: "plan",
      permissionMode: "request_approval",
      executionMode: "worktree",
      patchOnly: true,
      title: "Original · 分支",
      approvalMode: "automatic",
      status: "idle",
      archived: false,
      pinned: false,
      parentSessionId: null,
    });
    expect(fork.compactionModel?.modelId).toBe("summary-model");
    expect(repository.listSessionExtensionIds(fork.id)).toEqual(["skill"]);
    expect(repository.listSessionTodos(fork.id)).toEqual(repository.listSessionTodos(source.id));
    const copies = repository.getMessages(fork.id);
    expect(copies.map((message) => message.parts)).toEqual(
      original.map((message) => message.parts),
    );
    expect(copies.map((message) => message.createdAt)).toEqual(
      original.map((message) => message.createdAt),
    );
    expect(copies[0]?.id).not.toBe(user.id);
    expect(repository.getSetting(`context.observation.${fork.id}`)).toBeNull();
    const compaction = new ContextCompactionService(
      repository,
      {} as ProviderService,
      "",
      () => undefined,
    );
    expect(JSON.stringify(compaction.messages(fork.id))).toContain("COMPACTED_FACTS");
    expect(JSON.stringify(compaction.messages(fork.id))).not.toContain("EARLIER_FACTS");
    repository.deleteMessagesFromSeq(fork.id, 1);
    expect(repository.getMessages(source.id)).toEqual(original);
    repository.removeSession(source.id);
    expect(repository.getSession(fork.id)).not.toBeNull();
  });
  it("validates cutoff IDs and complete tool boundaries without creating partial forks", () => {
    const source = create();
    const first = repository.appendMessage({
      sessionId: source.id,
      role: "user",
      parts: [{ type: "text", text: "Task" }],
    });
    const call = repository.appendMessage({
      sessionId: source.id,
      role: "assistant",
      parts: [
        { type: "tool_call", callId: "c", name: "read_file", arguments: "{}", status: "completed" },
      ],
    });
    expect(() => repository.forkSession(source.id, "missing")).toThrow("分支消息");
    expect(() => repository.forkSession(source.id)).toThrow("未完成");
    repository.appendMessage({
      sessionId: source.id,
      role: "tool",
      parts: [{ type: "tool_result", callId: "c", output: "ok", isError: false }],
    });
    expect(() => repository.forkSession(source.id, call.id)).toThrow("未完成");
    repository.setSetting(`context.checkpoint.${source.id}`, {
      id: "invalid",
      throughSeq: 20,
      throughId: first.id,
      summary: "stale",
    });
    const fork = repository.forkSession(source.id, first.id);
    expect(repository.getMessages(fork.id)).toHaveLength(1);
    expect(repository.getSetting(`context.checkpoint.${fork.id}`)).toBeNull();
    expect(repository.forkSession(source.id).parentSessionId).toBeNull();
    expect(repository.listSessions()).toHaveLength(3);
  });
  it("preserves disabled ChatAgent internet access in a conversation fork", () => {
    const source = repository.insertSession({
      title: "Offline chat",
      agentMode: "chat",
      chatGroupId: null,
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    });
    repository.setSetting(`chat.network.enabled.${source.id}`, false);
    repository.appendMessage({
      sessionId: source.id,
      role: "user",
      parts: [{ type: "text", text: "offline conversation" }],
    });

    const fork = repository.forkSession(source.id);

    expect(fork).toMatchObject({ agentMode: "chat", chatNetworkEnabled: false });
  });
  it("rolls back the whole copy if a durable state write fails", () => {
    const source = create();
    repository.appendMessage({
      sessionId: source.id,
      role: "user",
      parts: [{ type: "text", text: "Task" }],
    });
    repository.setSetting(`context.model.${source.id}`, {
      mode: "current",
      providerId: null,
      modelId: null,
    });
    database.exec(
      "create trigger reject_fork before insert on app_settings when new.key like 'context.model.%' begin select raise(abort, 'fixture failure'); end;",
    );
    expect(() => repository.forkSession(source.id)).toThrow("fixture failure");
    expect(repository.listSessions()).toHaveLength(1);
    expect(repository.getMessages(source.id)).toHaveLength(1);
  });
});
