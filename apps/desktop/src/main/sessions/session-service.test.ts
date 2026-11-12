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
});
