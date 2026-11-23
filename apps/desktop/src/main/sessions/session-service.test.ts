import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectMemoryBackendKey } from "../agents/project-memory-config";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { SessionService } from "./session-service";

describe("Workspace conversation creation", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;
  let service: SessionService;
  let providerId: string;
  let modelId: string;

  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
    service = new SessionService(repository);
    providerId = repository.insertProvider({
      name: "Fixture",
      baseUrl: "https://example.com/v1",
      protocol: "openai_responses",
      authMode: "bearer",
      customHeaderName: null,
    }).id;
    repository.insertModel({
      providerId,
      modelId: "model",
      displayName: "Fixture",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: ["low", "high"],
      anthropicNoneBehavior: "disabled",
    });
    modelId = repository.getProvider(providerId)?.models[0]?.id as string;
  });
  afterEach(() => database.close());

  it("inherits the latest main conversation in the same folder without its history or runtime state", () => {
    const input = {
      providerId,
      modelId,
      workspacePath: "C:\\Project",
      permissionMode: "request_approval" as const,
      reasoningLevel: "high",
      agentProfileId: "plan",
      systemPrompt: "Keep this configuration",
      executionMode: "docker" as const,
      patchOnly: true,
    };
    const source = service.create({ ...input, title: "Previous" });
    const old = service.create({ ...input, reasoningLevel: "low", systemPrompt: "Old" });
    const child = repository.insertSession({
      ...input,
      title: "Child",
      parentSessionId: source.id,
      agentProfileId: "primary",
      systemPrompt: "Child config",
    });
    const archived = service.create({ ...input, systemPrompt: "Archived" });
    repository.updateSession(archived.id, { archived: true });
    service.create({ ...input, workspacePath: "C:\\Other", systemPrompt: "Other folder" });
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2026-01-01T00:00:00Z", old.id);
    database
      .prepare("update sessions set updated_at = ?, pinned = 1, status = 'running' where id = ?")
      .run("2026-02-01T00:00:00Z", source.id);
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2026-03-01T00:00:00Z", child.id);
    repository.insertExtension({
      id: "skill",
      type: "skill",
      name: "Test skill",
      description: "",
      sourcePath: "C:\\skill",
      installedPath: "C:\\skill-copy",
      manifestJson: "{}",
      contentHash: "fixture",
    });
    repository.setSessionExtension(source.id, "skill", true);
    const created = service.createInWorkspace("c:/project/");
    expect(created).toMatchObject({
      ...input,
      title: "新会话",
      parentSessionId: null,
      status: "idle",
      archived: false,
      pinned: false,
    });
    expect(created.id).not.toBe(source.id);
    expect(repository.getMessages(created.id)).toEqual([]);
    expect(repository.listSessionExtensionIds(created.id)).toEqual(["skill"]);
    expect(repository.getSession(source.id)?.status).toBe("running");
  });

  it("rejects missing folder sources and invalid models without changing permissions or inserting a chat", () => {
    expect(() => service.createInWorkspace("C:\\Unknown")).toThrow("主会话");
    const source = service.create({
      providerId,
      modelId,
      workspacePath: "C:\\Project",
      permissionMode: "request_approval",
      reasoningLevel: null,
    });
    database.prepare("delete from models where id = ?").run(modelId);
    expect(() => service.createInWorkspace("C:\\Project")).toThrow("重新配置");
    expect(service.list()).toHaveLength(1);
    expect(repository.getSession(source.id)?.permissionMode).toBe("request_approval");
  });

  it("supports the unassigned folder group and validates the inherited reasoning profile", () => {
    const source = service.create({
      providerId,
      modelId,
      workspacePath: null,
      permissionMode: "full_access",
      reasoningLevel: "high",
    });
    expect(service.createInWorkspace(null)).toMatchObject({
      workspacePath: null,
      permissionMode: "full_access",
    });
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2099-01-01T00:00:00Z", source.id);
    database.prepare("update models set reasoning_levels = ? where id = ?").run('["low"]', modelId);
    expect(() => service.createInWorkspace(null)).toThrow("思考等级");
    expect(service.list()).toHaveLength(2);
  });

  it("selects a compatible Agent profile when creating a shortcut in another workspace mode", () => {
    const primary = repository.getAgentProfile("primary");
    if (!primary) throw new Error("Expected the built-in primary Agent profile.");
    const codeOnly = repository.saveAgentProfile({
      ...primary,
      id: "code-only",
      name: "Code only",
      applicableModes: ["code"],
    });
    const source = service.create({
      providerId,
      modelId,
      workspacePath: "C:\\Project",
      permissionMode: "request_approval",
      reasoningLevel: null,
      agentMode: "code",
      agentProfileId: codeOnly.id,
    });
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2099-01-01T00:00:00Z", source.id);

    const created = service.createInWorkspace("C:\\Project", "work");
    expect(created).toMatchObject({
      agentMode: "work",
      agentProfileId: "primary",
      workspacePath: "C:\\Project",
    });
  });

  it.each([
    { descendant: "child", status: "running" },
    { descendant: "child", status: "waiting_approval" },
    { descendant: "grandchild", status: "running" },
    { descendant: "grandchild", status: "waiting_approval" },
  ])("does not move a project while its $descendant is $status", ({ descendant, status }) => {
    const input = {
      providerId,
      modelId,
      workspacePath: "C:\\Project",
      permissionMode: "full_access" as const,
      reasoningLevel: null,
      agentProfileId: "primary",
      systemPrompt: "",
      executionMode: "host" as const,
      patchOnly: false,
    };
    const parent = service.create(input);
    const child = repository.insertSession({
      ...input,
      title: "Child",
      parentSessionId: parent.id,
    });
    const grandchild = repository.insertSession({
      ...input,
      title: "Grandchild",
      parentSessionId: child.id,
    });
    const busy = descendant === "child" ? child : grandchild;
    database.prepare("update sessions set status = ? where id = ?").run(status, busy.id);
    const before = repository.getSession(parent.id);
    expect(() =>
      service.update({
        sessionId: parent.id,
        title: "Must stay unchanged",
        workspacePath: "C:\\Destination",
      }),
    ).toThrow("Stop the conversation");
    expect(repository.getSession(parent.id)).toEqual(before);
    expect(repository.getSetting(projectMemoryBackendKey("C:\\Destination"))).toBeNull();

    // Updating another setting or spelling the same root does not move a project.
    expect(service.update({ sessionId: parent.id, title: "Renamed" }).title).toBe("Renamed");
    expect(
      service.update({ sessionId: parent.id, workspacePath: "c:/project/" }).workspacePath,
    ).toBe("c:/project/");
    repository.updateSession(busy.id, { status: "idle" });
    expect(
      service.update({ sessionId: parent.id, workspacePath: "C:\\Destination" }).workspacePath,
    ).toBe("C:\\Destination");
  });

  it("keeps conversations and settings unchanged if destination memory configuration cannot be saved", () => {
    const input = {
      providerId,
      modelId,
      workspacePath: "C:\\Project",
      permissionMode: "full_access" as const,
      reasoningLevel: null,
      agentProfileId: "primary",
      systemPrompt: "",
      executionMode: "host" as const,
      patchOnly: false,
    };
    const parent = service.create({ ...input, memoryBackend: "tencentdb" });
    const child = repository.insertSession({
      ...input,
      title: "Child",
      parentSessionId: parent.id,
    });
    const before = repository.getSession(parent.id);
    const childBefore = repository.getSession(child.id);
    const destinationKey = projectMemoryBackendKey("C:\\Destination");
    const setSetting = repository.setSetting.bind(repository);
    const saving = vi.spyOn(repository, "setSetting").mockImplementation((key, value) => {
      if (key === destinationKey) throw new Error("Destination configuration write failed");
      setSetting(key, value);
    });
    try {
      expect(() =>
        service.update({
          sessionId: parent.id,
          title: "Must stay unchanged",
          workspacePath: "C:\\Destination",
          archived: true,
          compactionModel: { mode: "default", providerId: null, modelId: null },
        }),
      ).toThrow("Destination configuration write failed");
      expect(repository.getSession(parent.id)).toEqual(before);
      expect(repository.getSession(child.id)).toEqual(childBefore);
      expect(repository.getSetting(`context.model.${parent.id}`)).toBeNull();
      expect(repository.getSetting(destinationKey)).toBeNull();
    } finally {
      saving.mockRestore();
    }
  });

  it("rolls back destination memory configuration when a later conversation update fails", () => {
    const parent = service.create({
      providerId,
      modelId,
      workspacePath: "C:\\Project",
      permissionMode: "full_access",
      reasoningLevel: null,
      agentProfileId: "primary",
      systemPrompt: "",
      executionMode: "host",
      patchOnly: false,
      memoryBackend: "tencentdb",
    });
    const before = repository.getSession(parent.id);
    const destinationKey = projectMemoryBackendKey("C:\\Destination");
    expect(repository.getSetting(destinationKey)).toBeNull();
    database.exec(`
      create temp trigger fail_project_move before update on sessions
      when new.title = 'Reject late write'
      begin select raise(abort, 'fixture late session failure'); end;
    `);

    expect(() =>
      service.update({
        sessionId: parent.id,
        workspacePath: "C:\\Destination",
        title: "Reject late write",
        compactionModel: { mode: "default", providerId: null, modelId: null },
      }),
    ).toThrow("fixture late session failure");
    expect(repository.getSession(parent.id)).toEqual(before);
    expect(repository.getSetting(destinationKey)).toBeNull();
    expect(repository.getSetting(`context.model.${parent.id}`)).toBeNull();
  });

  it("creates an isolated ChatAgent without project or custom Agent configuration", () => {
    const group = service.createChatGroup("Ideas");
    const chat = service.create({
      title: "Pure chat",
      providerId,
      modelId,
      agentMode: "chat",
      agentProfileId: "primary",
      chatGroupId: group.id,
      workspacePath: null,
      reasoningLevel: "high",
      permissionMode: "full_access",
      approvalMode: "automatic",
    });
    expect(chat).toMatchObject({
      agentMode: "chat",
      chatGroupId: group.id,
      workspacePath: null,
      agentProfileId: "primary",
      permissionMode: "request_approval",
      chatNetworkEnabled: true,
      approvalMode: "manual",
      executionMode: "host",
      patchOnly: false,
    });
    expect(service.listChatGroups().map((item) => item.id)).toContain(group.id);

    expect(() =>
      service.create({
        providerId,
        modelId,
        agentMode: "chat",
        workspacePath: "C:\\Forbidden",
        reasoningLevel: null,
        permissionMode: "request_approval",
      }),
    ).toThrow("工作目录");
    expect(() =>
      service.create({
        providerId,
        modelId,
        agentMode: "chat",
        agentProfileId: "plan",
        workspacePath: null,
        reasoningLevel: null,
        permissionMode: "request_approval",
      }),
    ).toThrow("自定义 Agent");
    expect(() =>
      service.create({
        providerId,
        modelId,
        agentMode: "chat",
        workspacePath: null,
        reasoningLevel: null,
        permissionMode: "request_approval",
        executionMode: "docker",
      }),
    ).toThrow("宿主聊天");
    expect(() => service.update({ sessionId: chat.id, agentMode: "code" })).toThrow("不能直接互换");

    const primary = repository.getAgentProfile("primary");
    if (!primary) throw new Error("Primary Agent profile is missing.");
    repository.saveAgentProfile({ ...primary, enabled: false });
    expect(
      service.create({
        providerId,
        modelId,
        agentMode: "chat",
        workspacePath: null,
        reasoningLevel: null,
        permissionMode: "request_approval",
      }),
    ).toMatchObject({ agentMode: "chat", agentProfileId: "primary" });
    expect(service.update({ sessionId: chat.id, title: "Renamed pure chat" })).toMatchObject({
      agentMode: "chat",
      title: "Renamed pure chat",
    });
  });

  it("persists ChatAgent network controls and locks them while the task is active", () => {
    const chat = service.create({
      providerId,
      modelId,
      agentMode: "chat",
      workspacePath: null,
      reasoningLevel: null,
      permissionMode: "request_approval",
    });
    expect(chat.chatNetworkEnabled).toBe(true);
    expect(
      service.update({ sessionId: chat.id, chatNetworkEnabled: false }).chatNetworkEnabled,
    ).toBe(false);
    expect(repository.getSession(chat.id)?.chatNetworkEnabled).toBe(false);
    expect(
      service.update({ sessionId: chat.id, chatNetworkEnabled: true }).chatNetworkEnabled,
    ).toBe(true);

    repository.updateSession(chat.id, { status: "running" });
    expect(() => service.update({ sessionId: chat.id, chatNetworkEnabled: false })).toThrow(
      "任务运行期间不能切换",
    );

    const code = service.create({
      providerId,
      modelId,
      workspacePath: null,
      reasoningLevel: null,
      permissionMode: "request_approval",
    });
    expect(() => service.update({ sessionId: code.id, chatNetworkEnabled: false })).toThrow(
      "仅适用于 ChatAgent",
    );
  });

  it("validates network controls before creating a session", () => {
    expect(() =>
      service.create({
        providerId,
        modelId,
        agentMode: "chat",
        workspacePath: null,
        reasoningLevel: null,
        permissionMode: "request_approval",
        chatNetworkEnabled: "false" as unknown as boolean,
      }),
    ).toThrow("ChatAgent 联网状态无效");

    expect(() =>
      service.create({
        providerId,
        modelId,
        workspacePath: null,
        reasoningLevel: null,
        permissionMode: "request_approval",
        chatNetworkEnabled: false,
      }),
    ).toThrow("仅适用于 ChatAgent");

    const blocked = service.create({
      providerId,
      modelId,
      agentMode: "chat",
      workspacePath: null,
      reasoningLevel: null,
      permissionMode: "request_approval",
      chatNetworkEnabled: false,
    });
    expect(blocked.chatNetworkEnabled).toBe(false);
  });

  it("creates a chat from the latest updated chat in the selected group", () => {
    const group = service.createChatGroup("Ideas");
    const otherGroup = service.createChatGroup("Other");
    const source = service.create({
      title: "Latest in group",
      providerId,
      modelId,
      agentMode: "chat",
      chatGroupId: group.id,
      workspacePath: null,
      systemPrompt: "Keep the chat instructions",
      reasoningLevel: "high",
      permissionMode: "request_approval",
      compactionModel: { mode: "current", providerId: null, modelId: null },
    });
    const older = service.create({
      title: "Pinned but older",
      providerId,
      modelId,
      agentMode: "chat",
      chatGroupId: group.id,
      workspacePath: null,
      reasoningLevel: "low",
      permissionMode: "request_approval",
    });
    service.create({
      title: "Newest elsewhere",
      providerId,
      modelId,
      agentMode: "chat",
      chatGroupId: otherGroup.id,
      workspacePath: null,
      reasoningLevel: "low",
      permissionMode: "request_approval",
    });
    repository.insertExtension({
      id: "chat-skill",
      type: "skill",
      name: "Chat skill",
      description: "",
      sourcePath: "C:\\chat-skill",
      installedPath: "C:\\chat-skill-copy",
      manifestJson: "{}",
      contentHash: "chat-fixture",
    });
    repository.setSessionExtension(source.id, "chat-skill", true);
    service.update({ sessionId: source.id, chatNetworkEnabled: false });
    database
      .prepare("update sessions set updated_at = ?, pinned = 1 where id = ?")
      .run("2026-05-01T00:00:00Z", older.id);
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2026-06-01T00:00:00Z", source.id);

    const created = service.createChatSessionInGroup(group.id);
    expect(created).toMatchObject({
      title: "新会话",
      agentMode: "chat",
      chatGroupId: group.id,
      providerId,
      modelId,
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "Keep the chat instructions",
      reasoningLevel: "high",
      permissionMode: "request_approval",
      chatNetworkEnabled: false,
      approvalMode: "manual",
      compactionModel: { mode: "current", providerId: null, modelId: null },
      executionMode: "host",
      patchOnly: false,
      parentSessionId: null,
      archived: false,
      pinned: false,
    });
    expect(repository.getMessages(created.id)).toEqual([]);
    expect(repository.listSessionExtensionIds(created.id)).toEqual([]);
  });

  it("falls back to the latest active chat when the selected group is empty", () => {
    const emptyGroup = service.createChatGroup("Empty");
    const sourceGroup = service.createChatGroup("Source");
    const archivedGroup = service.createChatGroup("Archived");
    const olderSource = service.create({
      title: "Older source",
      providerId,
      modelId,
      agentMode: "chat",
      chatGroupId: sourceGroup.id,
      workspacePath: null,
      systemPrompt: "Older",
      reasoningLevel: "low",
      permissionMode: "request_approval",
    });
    const source = service.create({
      title: "Latest active source",
      providerId,
      modelId,
      agentMode: "chat",
      chatGroupId: sourceGroup.id,
      workspacePath: null,
      systemPrompt: "Latest fallback",
      reasoningLevel: "high",
      permissionMode: "request_approval",
    });
    const archived = service.create({
      title: "Newest archived",
      providerId,
      modelId,
      agentMode: "chat",
      chatGroupId: archivedGroup.id,
      workspacePath: null,
      systemPrompt: "Archived",
      reasoningLevel: "low",
      permissionMode: "request_approval",
    });
    repository.updateSession(archived.id, { archived: true });
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2026-07-01T00:00:00Z", olderSource.id);
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2026-08-01T00:00:00Z", source.id);
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2026-09-01T00:00:00Z", archived.id);

    expect(service.createChatSessionInGroup(emptyGroup.id)).toMatchObject({
      chatGroupId: emptyGroup.id,
      providerId,
      modelId,
      systemPrompt: "Latest fallback",
      reasoningLevel: "high",
      permissionMode: "request_approval",
    });
  });

  it("uses the first enabled text model when no chat exists yet", () => {
    database.prepare("update models set enabled = 0 where id = ?").run(modelId);
    const secondProvider = repository.insertProvider({
      name: "Second provider",
      baseUrl: "https://second.example.com/v1",
      protocol: "openai_responses",
      authMode: "bearer",
      customHeaderName: null,
    });
    repository.insertModel({
      providerId: secondProvider.id,
      modelId: "image-only",
      displayName: "Image only",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      inputModalities: ["image"],
      outputModalities: ["text"],
      toolCalls: false,
      parallelToolCalls: false,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
    });
    repository.insertModel({
      providerId: secondProvider.id,
      modelId: "chat-default",
      displayName: "Chat default",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: false,
      parallelToolCalls: false,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
    });
    const chatModel = repository
      .getProvider(secondProvider.id)
      ?.models.find((model) => model.modelId === "chat-default");

    expect(service.createChatSessionInGroup(null)).toMatchObject({
      agentMode: "chat",
      chatGroupId: null,
      providerId: secondProvider.id,
      modelId: chatModel?.id,
      reasoningLevel: null,
      permissionMode: "request_approval",
      workspacePath: null,
    });
  });

  it("explains how to recover when no enabled text model is available", () => {
    database.prepare("update models set enabled = 0 where id = ?").run(modelId);
    expect(() => service.createChatSessionInGroup(null)).toThrow(
      "没有可用于 ChatAgent 的已启用文本模型，请先在设置中启用或添加模型。",
    );
    expect(service.list()).toEqual([]);
  });

  it("rejects image-only models for session creation, updates and inherited chats", () => {
    repository.insertModel({
      providerId,
      modelId: "image-only-output",
      displayName: "Image",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["image"],
      toolCalls: false,
      parallelToolCalls: false,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
    });
    const image = repository
      .getProvider(providerId)
      ?.models.find((item) => item.modelId === "image-only-output");
    if (!image) throw new Error("Missing image fixture model");
    const input = {
      providerId,
      workspacePath: null,
      reasoningLevel: null,
      permissionMode: "request_approval" as const,
    };
    expect(() => service.create({ ...input, modelId: image.id })).toThrow("文本输入和输出");
    const chat = service.create({ ...input, modelId, agentMode: "chat" });
    expect(() => service.update({ sessionId: chat.id, modelId: image.id })).toThrow(
      "文本输入和输出",
    );
    expect(repository.getSession(chat.id)?.modelId).toBe(modelId);

    database
      .prepare("update models set output_modalities = ? where id = ?")
      .run('["image"]', modelId);
    expect(() => service.createChatSessionInGroup(null)).toThrow("已失效");
    expect(service.update({ sessionId: chat.id, title: "Still editable" }).title).toBe(
      "Still editable",
    );
  });

  it("skips an enabled image-output model when choosing a first Chat model", () => {
    const original = repository.getModel(modelId);
    if (!original) throw new Error("Missing fixture model");
    repository.updateModel(modelId, { ...original, outputModalities: ["image"] });
    repository.insertModel({
      providerId,
      modelId: "text-fallback",
      displayName: "Text fallback",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: false,
      parallelToolCalls: false,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
    });
    const fallback = repository
      .getProvider(providerId)
      ?.models.find((item) => item.modelId === "text-fallback");
    if (!fallback) throw new Error("Missing text fallback fixture model");
    expect(service.createChatSessionInGroup(null).modelId).toBe(fallback.id);
  });

  it.each([
    {
      condition: "disabled model",
      expected: "已失效",
      invalidate: (targetModelId: string) => {
        database.prepare("update models set enabled = 0 where id = ?").run(targetModelId);
      },
    },
    {
      condition: "changed reasoning level",
      expected: "思考等级",
      invalidate: (targetModelId: string) => {
        database
          .prepare("update models set reasoning_levels = ? where id = ?")
          .run('["low"]', targetModelId);
      },
    },
  ])(
    "does not fall back to an older valid chat when the latest template has a $condition",
    ({ expected, invalidate }) => {
      const group = service.createChatGroup("Invalid template");
      const templateProvider = repository.insertProvider({
        name: "Template provider",
        baseUrl: "https://template.example.com/v1",
        protocol: "openai_responses",
        authMode: "bearer",
        customHeaderName: null,
      });
      repository.insertModel({
        providerId: templateProvider.id,
        modelId: "template-model",
        displayName: "Template model",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputModalities: ["text"],
        outputModalities: ["text"],
        toolCalls: true,
        parallelToolCalls: false,
        reasoningLevels: ["low", "high"],
        anthropicNoneBehavior: "disabled",
      });
      const templateModelId = repository
        .getProvider(templateProvider.id)
        ?.models.find((model) => model.modelId === "template-model")?.id as string;
      const older = service.create({
        title: "Older valid chat",
        providerId,
        modelId,
        agentMode: "chat",
        chatGroupId: group.id,
        workspacePath: null,
        reasoningLevel: "high",
        permissionMode: "request_approval",
      });
      const latest = service.create({
        title: "Latest invalid template",
        providerId: templateProvider.id,
        modelId: templateModelId,
        agentMode: "chat",
        chatGroupId: group.id,
        workspacePath: null,
        reasoningLevel: "high",
        permissionMode: "request_approval",
      });
      database
        .prepare("update sessions set updated_at = ? where id = ?")
        .run("2026-01-01T00:00:00Z", older.id);
      database
        .prepare("update sessions set updated_at = ? where id = ?")
        .run("2026-02-01T00:00:00Z", latest.id);
      invalidate(templateModelId);
      const before = service.list().length;

      expect(() => service.createChatSessionInGroup(group.id)).toThrow(expected);
      expect(service.list()).toHaveLength(before);
    },
  );

  it("rejects invalid groups and does not skip a latest chat with invalid configuration", () => {
    const group = service.createChatGroup("Validation");
    expect(() => service.createChatSessionInGroup("missing-group")).toThrow("分组不存在");
    expect(() => service.createChatSessionInGroup("   ")).toThrow("分组无效");

    service.create({
      title: "Older valid chat",
      providerId,
      modelId,
      agentMode: "chat",
      chatGroupId: group.id,
      workspacePath: null,
      reasoningLevel: null,
      permissionMode: "request_approval",
    });
    const latest = service.create({
      title: "Latest invalid chat",
      providerId,
      modelId,
      agentMode: "chat",
      chatGroupId: group.id,
      workspacePath: null,
      reasoningLevel: null,
      permissionMode: "request_approval",
    });
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2026-10-01T00:00:00Z", latest.id);
    database.prepare("delete from models where id = ?").run(modelId);
    const before = service.list().length;

    expect(() => service.createChatSessionInGroup(group.id)).toThrow("已失效");
    expect(service.list()).toHaveLength(before);
  });

  it("switches CodeAgent to WorkAgent only while stopped and honors profile applicability", () => {
    const workspacePath = "C:\\Shared project";
    const session = service.create({
      providerId,
      modelId,
      agentMode: "code",
      workspacePath,
      reasoningLevel: null,
      permissionMode: "request_approval",
    });
    expect(service.update({ sessionId: session.id, agentMode: "work" })).toMatchObject({
      agentMode: "work",
      workspacePath,
    });
    database.prepare("update sessions set status='running' where id=?").run(session.id);
    expect(() => service.update({ sessionId: session.id, agentMode: "code" })).toThrow(
      "请先停止会话及其子任务",
    );
    database.prepare("update sessions set status='idle' where id=?").run(session.id);

    const workOnly = repository.saveAgentProfile({
      name: "Work only",
      description: "",
      role: "primary",
      instructions: "",
      modelId: null,
      readOnly: false,
      enabled: true,
      applicableModes: ["work"],
    });
    expect(() =>
      service.update({ sessionId: session.id, agentMode: "code", agentProfileId: workOnly.id }),
    ).toThrow("不适用于当前模式");
    expect(
      service.update({ sessionId: session.id, agentMode: "work", agentProfileId: workOnly.id }),
    ).toMatchObject({ agentMode: "work", agentProfileId: workOnly.id });
  });

  it("preserves shared history, directory, draft, attachments and tool output when switching modes", () => {
    const workspacePath = "C:\\Shared project";
    const session = service.create({
      providerId,
      modelId,
      agentMode: "code",
      workspacePath,
      reasoningLevel: null,
      permissionMode: "request_approval",
    });
    repository.appendMessage({
      sessionId: session.id,
      role: "user",
      parts: [{ type: "text", text: "Keep this history" }],
    });
    const attachment = {
      id: "attachment-1",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 1,
      kind: "file" as const,
      dataUrl: "data:text/plain;base64,YQ==",
    };
    repository.saveComposerDraft({
      sessionId: session.id,
      revision: "draft-1",
      text: "Pending work",
      formatted: false,
      attachmentIds: [attachment.id],
      addedAttachments: [attachment],
      notificationDraftIds: [],
    });
    repository.setSetting(`tool.output.${session.id}.call-1`, { output: "recoverable" });

    expect(service.update({ sessionId: session.id, agentMode: "work" })).toMatchObject({
      agentMode: "work",
      workspacePath,
    });
    expect(repository.getMessages(session.id)).toMatchObject([
      { role: "user", parts: [{ type: "text", text: "Keep this history" }] },
    ]);
    expect(repository.getComposerDraft(session.id)).toMatchObject({
      revision: "draft-1",
      text: "Pending work",
      attachments: [attachment],
    });
    expect(repository.getSetting(`tool.output.${session.id}.call-1`)).toEqual({
      output: "recoverable",
    });
  });

  it("inherits the parent workbench mode for subagents and rejects cross-mode or chat children", () => {
    const workParent = service.create({
      providerId,
      modelId,
      agentMode: "work",
      workspacePath: "C:\\Shared project",
      reasoningLevel: null,
      permissionMode: "request_approval",
    });
    const childInput = {
      providerId,
      modelId,
      agentProfileId: "primary",
      workspacePath: workParent.workspacePath,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval" as const,
      executionMode: "host" as const,
      patchOnly: false,
    };
    expect(
      repository.insertSession({
        ...childInput,
        title: "Inherited work subagent",
        parentSessionId: workParent.id,
      }),
    ).toMatchObject({ agentMode: "work", parentSessionId: workParent.id });
    expect(() =>
      repository.insertSession({
        ...childInput,
        title: "Cross-mode subagent",
        parentSessionId: workParent.id,
        agentMode: "code",
      }),
    ).toThrow("必须继承");

    const chat = service.create({
      providerId,
      modelId,
      agentMode: "chat",
      workspacePath: null,
      reasoningLevel: null,
      permissionMode: "request_approval",
    });
    expect(() =>
      repository.insertSession({
        ...childInput,
        title: "Forbidden chat child",
        parentSessionId: chat.id,
        workspacePath: null,
      }),
    ).toThrow("ChatAgent 不支持子 Agent");
  });
});
