import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfileView, ModelConfig, SessionView } from "../../shared/domain";
import { sessionBuiltinCapabilitiesSettingKey } from "../../shared/session-builtin-capabilities";
import { ChatService } from "../chat/chat-service";
import type { ExtensionService } from "../extensions/extension-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ToolRegistry } from "../tools/tool-registry";
import { builtinPluginDiscoveryRecords } from "./builtin-plugins";
import * as domainSkills from "./domain-skills";
import { builtinCapabilityDiscoveryRecords, domainSkillCatalog } from "./domain-skills";
import { SessionBuiltinCapabilityService } from "./session-builtin-capability-service";

const promptDirectory = resolve("resources/prompts");
const registryToolNames = new Set(new ToolRegistry().descriptors().map((tool) => tool.name));

describe("session built-in capability selection", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;
  let service: SessionBuiltinCapabilityService;
  let providerId: string;
  let modelId: string;

  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
    service = new SessionBuiltinCapabilityService(
      repository,
      promptDirectory,
      () => false,
      () => registryToolNames,
    );
    providerId = repository.insertProvider({
      name: "Fixture",
      baseUrl: "https://example.com/v1",
      protocol: "openai_responses",
      authMode: "bearer",
      customHeaderName: null,
    }).id;
    repository.insertModel({
      providerId,
      modelId: "fixture-model",
      displayName: "Fixture",
      contextWindow: 128_000,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
    });
    modelId = repository.getProvider(providerId)?.models[0]?.id ?? "";
  });

  afterEach(() => database.close());

  function createSession(agentMode: "code" | "work" | "chat", parentSessionId?: string) {
    return repository.insertSession({
      title: `${agentMode} session`,
      agentMode,
      parentSessionId: parentSessionId ?? null,
      providerId,
      modelId,
      agentProfileId: "primary",
      workspacePath: agentMode === "chat" ? null : "C:\\Project",
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    });
  }

  it("lists Work-only built-ins, persists manual references and preserves them across mode switches", async () => {
    const work = createSession("work");
    const catalog = JSON.parse(
      await readFile(resolve(promptDirectory, "skills/work-sources/catalog.json"), "utf8"),
    ) as { entries: Array<{ id: string; sourcePath: string }> };
    const sourceId = catalog.entries[0]?.id;
    expect(sourceId).toBeTruthy();
    const initial = await service.list(work.id);
    expect(initial.filter((capability) => capability.selected)).toEqual([]);
    expect(initial).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "builtin:work-ppt-master",
          name: "work-ppt-master",
          selected: false,
        }),
        expect.objectContaining({
          id: "builtin:work-asd-ste100",
          name: "work-asd-ste100",
          selected: false,
        }),
      ]),
    );

    await service.set(work.id, "builtin:work-ppt-master", true);
    await service.set(work.id, "builtin:work-asd-ste100", true);
    await service.set(work.id, sourceId as string, true);
    expect(await service.selectedIdsForPrompt(work)).toEqual([
      "builtin:work-ppt-master",
      "builtin:work-asd-ste100",
      sourceId,
    ]);
    expect(
      (await service.list(work.id))
        .filter((capability) => capability.selected)
        .map((capability) => capability.id),
    ).toEqual(["builtin:work-ppt-master", "builtin:work-asd-ste100", sourceId]);

    const prompt = domainSkillCatalog(work, new Set(await service.selectedIdsForPrompt(work)));
    expect(prompt).toContain("SESSION-PINNED SKILLS");
    expect(prompt).toContain("Pinned skill id: builtin:work-ppt-master");
    expect(prompt).toContain("Pinned skill id: builtin:work-asd-ste100");
    expect(prompt).toContain(`Pinned skill id: ${sourceId}`);
    expect(prompt).toContain("otherwise call use_skill with its exact id before substantive work");
    expect(initial.find((item) => item.id === sourceId)?.sourcePath).toBe(
      catalog.entries[0]?.sourcePath,
    );

    const discovered = await builtinCapabilityDiscoveryRecords(
      work,
      promptDirectory,
      new Set(await service.selectedIdsForPrompt(work)),
    );
    expect(
      discovered.find((capability) => capability.id === "builtin:work-ppt-master"),
    ).toMatchObject({ session_selected: true });

    repository.updateSession(work.id, { agentMode: "code" });
    const code = repository.getSession(work.id) as SessionView;
    expect(await service.selectedIdsForPrompt(code)).toEqual([]);
    expect((await service.list(code.id)).some((item) => item.id.includes("work-ppt-master"))).toBe(
      false,
    );

    repository.updateSession(work.id, { agentMode: "work" });
    expect(
      (await service.list(work.id))
        .filter((capability) => capability.selected)
        .map((capability) => capability.id),
    ).toEqual(["builtin:work-ppt-master", "builtin:work-asd-ste100", sourceId]);
  });

  it("preloads selected Work-source bodies only when the Profile already allows use_skill", async () => {
    const work = createSession("work");
    const catalog = JSON.parse(
      await readFile(resolve(promptDirectory, "skills/work-sources/catalog.json"), "utf8"),
    ) as { entries: Array<{ id: string; sourcePath: string }> };
    const source = catalog.entries[0];
    expect(source).toBeDefined();
    await service.set(work.id, source?.id as string, true);
    const chat = new ChatService({
      repository,
      extensionService: {} as ExtensionService,
      promptDirectory,
      sessionBuiltinCapabilityService: service,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      buildPinnedBuiltinSkillContext: (
        session: SessionView,
        profile: AgentProfileView,
        selectedIds: string[],
      ) => Promise<string>;
    };
    const allowedProfile = {
      permissions: { use_skill: "allow" },
      readOnly: false,
      toolAllowlist: ["use_skill"],
    } as unknown as AgentProfileView;
    const loaded = await internal.buildPinnedBuiltinSkillContext(work, allowedProfile, [
      source?.id as string,
    ]);
    expect(loaded).toContain(`BEGIN PINNED SKILL ${source?.id}`);
    expect(loaded).toContain(`Source path: ${source?.sourcePath}`);
    expect(loaded).not.toContain("Deferred skill id:");

    const askProfile = {
      permissions: { use_skill: "ask" },
      readOnly: false,
      toolAllowlist: ["use_skill"],
    } as unknown as AgentProfileView;
    const deferred = await internal.buildPinnedBuiltinSkillContext(work, askProfile, [
      source?.id as string,
    ]);
    expect(deferred).toContain("DEFERRED PINNED SKILLS");
    expect(deferred).toContain(`Deferred skill id: ${source?.id}`);
    expect(deferred).not.toContain(`BEGIN PINNED SKILL ${source?.id}`);

    const defaultProfile = {
      permissions: {},
      readOnly: false,
      toolAllowlist: [],
    } as unknown as AgentProfileView;
    const defaultLoaded = await internal.buildPinnedBuiltinSkillContext(work, defaultProfile, [
      source?.id as string,
    ]);
    expect(defaultLoaded).toContain(`BEGIN PINNED SKILL ${source?.id}`);
    expect(defaultLoaded).not.toContain("Deferred skill id:");

    for (const blockedProfile of [
      { ...defaultProfile, permissions: { use_skill: "deny" } },
      { ...defaultProfile, toolAllowlist: ["run_command"] },
    ] as AgentProfileView[]) {
      const blocked = await internal.buildPinnedBuiltinSkillContext(work, blockedProfile, [
        source?.id as string,
      ]);
      expect(blocked).not.toContain(`BEGIN PINNED SKILL ${source?.id}`);
    }
  });

  it("assembles selected Work-source text into the real system prompt and isolates Code and Chat", async () => {
    const work = createSession("work");
    const catalog = JSON.parse(
      await readFile(resolve(promptDirectory, "skills/work-sources/catalog.json"), "utf8"),
    ) as { entries: Array<{ id: string; sourcePath: string }> };
    const source = catalog.entries[0];
    expect(source).toBeDefined();
    await service.set(work.id, source?.id as string, true);
    await service.set(work.id, "builtin:plugin-github", true);
    await service.set(work.id, "builtin:plugin-browser", true);
    const profile = {
      id: "primary",
      name: "Primary",
      description: "",
      role: "primary",
      instructions: "",
      enabled: true,
      readOnly: false,
      permissions: {
        use_skill: "allow",
        read_file: "allow",
        github_search_repositories: "allow",
        browser_open: "allow",
      },
      toolAllowlist: ["use_skill", "read_file", "github_search_repositories", "browser_open"],
      applicableModes: ["code", "work"],
    } as unknown as AgentProfileView;
    vi.spyOn(repository, "getAgentProfile").mockReturnValue(profile);
    const chat = new ChatService({
      repository,
      extensionService: {
        buildSessionContext: async () => ({ text: "", skills: [], mcpServers: [] }),
      },
      sessionBuiltinCapabilityService: service,
      promptDirectory,
      appVersion: "1.3.3",
      projectInstructionService: {
        discover: async () => [],
        render: () => "",
      },
      toolRegistry: new ToolRegistry(),
      mcpService: { enabledServerNames: () => [] },
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const model = {
      id: "fixture-model-config",
      providerId,
      modelId: "fixture-model",
      displayName: "Fixture",
      contextWindow: 128_000,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
      enabled: true,
    } satisfies ModelConfig;
    const internal = chat as unknown as {
      buildSystemPrompt: (
        session: SessionView,
        model: ModelConfig,
        runId: string,
        tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
      ) => Promise<string>;
    };
    const tools = [
      {
        name: "github_search_repositories",
        description: "Search GitHub repositories.",
        parameters: { type: "object" },
      },
      {
        name: "browser_open",
        description: "Open the embedded browser.",
        parameters: { type: "object" },
      },
    ];

    const workPrompt = await internal.buildSystemPrompt(
      work,
      model,
      "00000000-0000-4000-8000-000000000001",
      tools,
    );
    expect(workPrompt).toContain(`Pinned skill id: ${source?.id}`);
    expect(workPrompt).toContain(`BEGIN PINNED SKILL ${source?.id}`);
    expect(workPrompt).toContain(`Source path: ${source?.sourcePath}`);
    expect(workPrompt).toContain("MANUALLY PREFERRED BUILTIN PLUGINS");
    expect(workPrompt).toContain('"id":"builtin:plugin-github"');
    expect(workPrompt).toContain('"id":"builtin:plugin-browser"');
    expect(workPrompt).toContain("github_search_repositories");
    expect(workPrompt).toContain("browser_open");
    expect(workPrompt).toContain("Never call use_skill with a plugin id");
    expect(workPrompt).not.toContain("Pinned skill id: builtin:plugin-github");

    const code = repository.updateSession(work.id, { agentMode: "code" });
    const codePrompt = await internal.buildSystemPrompt(
      code,
      model,
      "00000000-0000-4000-8000-000000000002",
      tools,
    );
    expect(codePrompt).not.toContain(`Pinned skill id: ${source?.id}`);
    expect(codePrompt).not.toContain(`BEGIN PINNED SKILL ${source?.id}`);
    expect(codePrompt).toContain('"id":"builtin:plugin-github"');
    expect(codePrompt).toContain('"id":"builtin:plugin-browser"');

    const chatSession = createSession("chat");
    const chatPrompt = await internal.buildSystemPrompt(
      chatSession,
      model,
      "00000000-0000-4000-8000-000000000003",
      tools,
    );
    expect(chatPrompt).not.toContain(`Pinned skill id: ${source?.id}`);
    expect(chatPrompt).not.toContain(`BEGIN PINNED SKILL ${source?.id}`);
    expect(chatPrompt).not.toContain("MANUALLY PREFERRED BUILTIN PLUGINS");
    expect(chatPrompt).not.toContain("builtin:plugin-github");
  });

  it("lists exact builtin plugins and never presents tools denied by the active Profile", async () => {
    const work = createSession("work");
    const code = createSession("code");
    const workCapabilities = await service.list(work.id);
    const codeCapabilities = await service.list(code.id);
    expect(workCapabilities.filter((item) => item.type === "skill")).toHaveLength(114);
    expect(codeCapabilities.filter((item) => item.type === "skill")).toHaveLength(9);
    for (const capabilities of [workCapabilities, codeCapabilities]) {
      expect(capabilities.filter((item) => item.type === "plugin")).toEqual([
        expect.objectContaining({ id: "builtin:plugin-github", selected: false }),
        expect.objectContaining({ id: "builtin:plugin-browser", selected: false }),
      ]);
    }

    await service.set(work.id, "builtin:plugin-github", true);
    await service.set(work.id, "builtin:plugin-browser", true);
    expect(await service.selectedIdsForPrompt(work)).toEqual([
      "builtin:plugin-github",
      "builtin:plugin-browser",
    ]);
    const discovered = builtinPluginDiscoveryRecords(
      work,
      registryToolNames,
      new Set(await service.selectedIdsForPrompt(work)),
    );
    expect(discovered).toEqual([
      expect.objectContaining({
        id: "builtin:plugin-github",
        session_selected: true,
        tool_names: expect.arrayContaining(["github_search_repositories"]),
      }),
      expect.objectContaining({
        id: "builtin:plugin-browser",
        session_selected: true,
        tool_names: expect.arrayContaining(["browser_open", "browser_snapshot"]),
      }),
    ]);
    const restrictedService = new SessionBuiltinCapabilityService(
      repository,
      promptDirectory,
      () => false,
      () => new Set(["browser_snapshot"]),
    );
    expect(
      (await restrictedService.list(work.id))
        .filter((item) => item.type === "plugin")
        .map((item) => item.id),
    ).toEqual(["builtin:plugin-browser"]);
    expect(await restrictedService.selectedIdsForPrompt(work)).toEqual(["builtin:plugin-browser"]);
    expect(repository.getSetting(sessionBuiltinCapabilitiesSettingKey(work.id))).toEqual([
      "builtin:plugin-github",
      "builtin:plugin-browser",
    ]);

    const restrictedProfile = {
      permissions: { browser_snapshot: "allow" },
      readOnly: false,
      toolAllowlist: ["browser_snapshot"],
    } as unknown as AgentProfileView;
    vi.spyOn(repository, "getAgentProfile").mockReturnValue(restrictedProfile);
    const chat = new ChatService({
      repository,
      toolRegistry: new ToolRegistry(),
      sessionBuiltinCapabilityService: service,
      promptDirectory,
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      buildBuiltinPluginPromptContext: (
        session: SessionView,
        selectedIds: string[],
        tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
      ) => string;
    };
    const prompt = internal.buildBuiltinPluginPromptContext(
      work,
      ["builtin:plugin-github", "builtin:plugin-browser"],
      [
        {
          name: "github_search_repositories",
          description: "Denied by the Profile.",
          parameters: { type: "object" },
        },
        {
          name: "browser_snapshot",
          description: "Allowed by the Profile.",
          parameters: { type: "object" },
        },
      ],
    );
    expect(prompt).not.toContain('"id":"builtin:plugin-github"');
    expect(prompt).toContain('"id":"builtin:plugin-browser"');
    expect(prompt).toContain("browser_snapshot");
    expect(prompt).not.toContain("github_search_repositories");
  });

  it("keeps Chat read-only, validates exact ids and locks the active session tree", async () => {
    const chat = createSession("chat");
    await expect(service.list(chat.id)).rejects.toThrow("CHAT_CAPABILITY_UNAVAILABLE");
    await expect(service.set(chat.id, "builtin:code-debugging", true)).rejects.toThrow(
      "CHAT_CAPABILITY_UNAVAILABLE",
    );

    const parent = createSession("work");
    const child = createSession("work", parent.id);
    await expect(service.set(parent.id, "builtin:not-real", true)).rejects.toThrow(
      "BUILTIN_CAPABILITY_UNAVAILABLE",
    );
    repository.updateSession(child.id, { status: "running" });
    await expect(service.set(parent.id, "builtin:work-ppt-master", true)).rejects.toThrow(
      "会话或其子任务正在运行",
    );
  });

  it("maps stored old selections to the latest version without losing stricter permission rules", async () => {
    const work = createSession("work");
    const oldId = "builtin:work-source-pdf-0-2-1-pdf-viewer-430308a5";
    const otherOldId = "builtin:work-source-pdf-0-2-2-pdf-viewer-7552e6cc";
    const latestId = "builtin:work-source-pdf-0-2-3-pdf-viewer-7552e6cc";
    const key = sessionBuiltinCapabilitiesSettingKey(work.id);
    repository.setSetting(key, [oldId, otherOldId, "builtin:work-ppt-master"]);

    expect((await service.list(work.id)).find((item) => item.id === latestId)?.selected).toBe(true);
    expect((await service.list(work.id)).some((item) => item.id === oldId)).toBe(false);
    expect(await service.selectedIdsForPrompt(work)).toContain(latestId);
    expect(await service.legacyIdsForCapability(work, latestId)).toEqual([oldId, otherOldId]);
    await service.set(work.id, latestId, true);
    expect(repository.getSetting(key)).toEqual([oldId, otherOldId, "builtin:work-ppt-master"]);

    let profile = {
      permissions: {
        use_skill: "allow",
        [`use_skill:${oldId}`]: "deny",
        [`use_skill:${otherOldId}`]: "ask",
        [`use_skill:${latestId}`]: "allow",
      },
      readOnly: false,
      toolAllowlist: ["use_skill"],
    } as unknown as AgentProfileView;
    vi.spyOn(repository, "getAgentProfile").mockImplementation(() => profile);
    const chat = new ChatService({
      repository,
      extensionService: {} as ExtensionService,
      promptDirectory,
      sessionBuiltinCapabilityService: service,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      buildPinnedBuiltinSkillContext: (
        session: SessionView,
        profile: AgentProfileView,
        ids: string[],
      ) => Promise<string>;
      requestApproval: () => Promise<{ decision: "deny" }>;
      executeOwnedToolCall: (
        input: unknown,
        release: () => void,
      ) => Promise<{ output: string; isError: boolean }>;
    };
    const requestApproval = vi
      .spyOn(internal, "requestApproval")
      .mockResolvedValue({ decision: "deny" });
    const execute = () =>
      internal.executeOwnedToolCall(
        {
          session: work,
          runId: "run",
          signal: new AbortController().signal,
          toolCall: {
            name: "use_skill",
            arguments: JSON.stringify({ name: latestId }),
            callId: "call",
            index: 0,
          },
        },
        vi.fn(),
      );

    for (const action of ["deny", "ask"] as const) {
      profile = {
        ...profile,
        permissions: {
          use_skill: "allow",
          [`use_skill:${oldId}`]: action,
          [`use_skill:${otherOldId}`]: "ask",
          [`use_skill:${latestId}`]: "allow",
        },
      };
      const pinned = await internal.buildPinnedBuiltinSkillContext(work, profile, [latestId]);
      expect(pinned).toContain(`Deferred skill id: ${latestId}`);
      expect(pinned).not.toContain(`BEGIN PINNED SKILL ${latestId}`);
      const result = await execute();
      expect(result.isError).toBe(true);
      expect(requestApproval).toHaveBeenCalledTimes(action === "ask" ? 1 : 0);
    }

    repository.updateSession(work.id, { agentMode: "code" });
    const code = repository.getSession(work.id) as SessionView;
    expect(await service.selectedIdsForPrompt(code)).not.toContain(latestId);
    expect(repository.getSetting(key)).toEqual([oldId, otherOldId, "builtin:work-ppt-master"]);
    repository.updateSession(work.id, { agentMode: "work" });
    await service.set(work.id, latestId, false);
    expect(repository.getSetting(key)).toEqual(["builtin:work-ppt-master"]);
    expect(await service.legacyIdsForCapability(work, latestId)).toEqual([oldId, otherOldId]);
    for (const selection of ["unselected", "reselected"] as const) {
      if (selection === "reselected") await service.set(work.id, latestId, true);
      for (const action of ["deny", "ask"] as const) {
        profile = {
          ...profile,
          permissions: {
            use_skill: "allow",
            [`use_skill:${oldId}`]: action,
            [`use_skill:${latestId}`]: "allow",
          },
        };
        requestApproval.mockClear();
        const pinned = await internal.buildPinnedBuiltinSkillContext(work, profile, [latestId]);
        expect(pinned).toContain(`Deferred skill id: ${latestId}`);
        expect(pinned).not.toContain(`BEGIN PINNED SKILL ${latestId}`);
        expect((await execute()).isError).toBe(true);
        expect(requestApproval).toHaveBeenCalledTimes(action === "ask" ? 1 : 0);
      }
    }
  });

  it("applies old scoped restrictions to an unpinned latest version without inheriting allows or other variants", async () => {
    const work = createSession("work");
    const oldId = "builtin:work-source-pdf-0-2-1-pdf-viewer-430308a5";
    const latestId = "builtin:work-source-pdf-0-2-3-pdf-viewer-7552e6cc";
    const otherVariant = "builtin:work-source-pdf-0-2-1-pdf-0016a97a";
    const chat = new ChatService({
      repository,
      extensionService: {} as ExtensionService,
      promptDirectory,
      sessionBuiltinCapabilityService: service,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      builtinSkillPermission: (
        session: SessionView,
        profile: AgentProfileView,
        id: string,
      ) => Promise<"allow" | "ask" | "deny" | null>;
    };
    const resolvePermission = (permissions: AgentProfileView["permissions"]) =>
      internal.builtinSkillPermission(work, { permissions } as AgentProfileView, latestId);

    expect(await service.selectedIdsForPrompt(work)).toEqual([]);
    const resolveLegacy = vi.spyOn(service, "legacyIdsForCapability");
    expect(await resolvePermission({ read: "allow" })).toBe("allow");
    expect(resolveLegacy).not.toHaveBeenCalled();
    expect(await resolvePermission({ [`use_skill:${oldId}`]: "deny" })).toBe("deny");
    expect(await resolvePermission({ [`use_skill:${oldId}`]: "ask" })).toBe("ask");
    expect(await resolvePermission({ [`use_skill:${oldId}`]: "allow" })).toBeNull();
    expect(await resolvePermission({ [`use_skill:${otherVariant}`]: "deny" })).toBeNull();
    expect(
      await resolvePermission({
        "use_skill:builtin:work-source-pdf-0-2-1-pdf-viewer-*": "deny",
        [`use_skill:${latestId}`]: "allow",
      }),
    ).toBe("deny");
    expect(
      await resolvePermission({
        read: "allow",
        [`read_file:${oldId}`]: "ask",
        [`use_skill:${latestId}`]: "allow",
      }),
    ).toBe("ask");
    expect(await resolvePermission({ read: "ask", [`use_skill:${latestId}`]: "allow" })).toBe(
      "allow",
    );
    expect(
      await resolvePermission({
        "use_skill:builtin:work-source-*": "deny",
        [`use_skill:${latestId}`]: "allow",
      }),
    ).toBe("allow");
    expect(
      await resolvePermission({
        use_skill: "allow",
        [`read_file:${oldId}`]: "deny",
        [`use_skill:${latestId}`]: "allow",
      }),
    ).toBe("allow");
    expect(
      await resolvePermission({
        "use_skill:builtin:work-source-*": "deny",
        [`read_file:${oldId}`]: "ask",
        [`use_skill:${latestId}`]: "allow",
      }),
    ).toBe("allow");
  });

  it("requires approval for an old scoped rule before reading an unpinned latest skill", async () => {
    const work = createSession("work");
    const oldId = "builtin:work-source-pdf-0-2-1-pdf-viewer-430308a5";
    const latestId = "builtin:work-source-pdf-0-2-3-pdf-viewer-7552e6cc";
    const profile = {
      permissions: { [`use_skill:${oldId}`]: "ask", [`use_skill:${latestId}`]: "allow" },
      readOnly: false,
      toolAllowlist: ["use_skill"],
    } as unknown as AgentProfileView;
    vi.spyOn(repository, "getAgentProfile").mockReturnValue(profile);
    const chat = new ChatService({
      repository,
      extensionService: {} as ExtensionService,
      promptDirectory,
      sessionBuiltinCapabilityService: service,
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      requestApproval: () => Promise<{ approvalId: string; decision: "allow_once" }>;
      executeOwnedToolCall: (
        input: unknown,
        release: () => void,
      ) => Promise<{ output: string; isError: boolean }>;
    };
    const approval = vi
      .spyOn(internal, "requestApproval")
      .mockResolvedValue({ approvalId: "approval", decision: "allow_once" });
    const result = await internal.executeOwnedToolCall(
      {
        session: work,
        runId: "run",
        signal: new AbortController().signal,
        toolCall: {
          name: "use_skill",
          arguments: JSON.stringify({ name: latestId }),
          callId: "call",
          index: 0,
        },
      },
      vi.fn(),
    );
    expect(await service.selectedIdsForPrompt(work)).toEqual([]);
    expect(approval).toHaveBeenCalledOnce();
    expect(result.isError).toBe(false);
    expect(result.output).toContain(`Built-in skill: ${latestId}`);
  });

  it("counts equivalent versions once, retains aliases across copies and modes, and removes them together", async () => {
    const work = createSession("work");
    const key = sessionBuiltinCapabilitiesSettingKey(work.id);
    const catalog = JSON.parse(
      await readFile(resolve(promptDirectory, "skills/work-sources/catalog.json"), "utf8"),
    ) as { entries: Array<{ id: string; version: string | null; sourcePath: string }> };
    const paths = [
      /^documents-1\/[^/]+\/skills\/docx\/SKILL\.md$/,
      /^spreadsheets\/[^/]+\/skills\/xlsx\/SKILL\.md$/,
      /^presentations\/[^/]+\/skills\/pptx\/SKILL\.md$/,
    ];
    const groups = paths.map((pattern) =>
      catalog.entries.filter((item) => pattern.test(item.sourcePath)),
    );
    expect(groups.map((group) => group.length)).toEqual([5, 5, 5]);
    const groupIds = groups.flatMap((group) => group.map((item) => item.id));
    const latest = groups.map((group) => group.find((item) => item.version === "0.2.2")?.id);
    expect(latest.every(Boolean)).toBe(true);
    const capabilities = await service.list(work.id);
    const available = capabilities.map((item) => item.id).filter((id) => !latest.includes(id));
    const initial = [...groupIds, ...available.slice(0, 17)];
    expect(initial).toHaveLength(32);
    expect(
      new Set(await domainSkills.canonicalBuiltinCapabilityIds(promptDirectory, initial)).size,
    ).toBe(20);
    repository.setSetting(key, initial);
    expect((await service.list(work.id)).filter((item) => item.selected)).toHaveLength(20);

    for (const id of available.slice(17, 29)) await service.set(work.id, id, true);
    const expanded = repository.getSetting(key) as string[];
    expect(expanded).toHaveLength(44);
    expect(
      new Set(await domainSkills.canonicalBuiltinCapabilityIds(promptDirectory, expanded)).size,
    ).toBe(32);
    const extra = available[29];
    expect(extra).toBeDefined();
    await expect(service.set(work.id, extra as string, true)).rejects.toThrow(
      "BUILTIN_CAPABILITY_LIMIT",
    );

    const child = createSession("work", work.id);
    const fork = repository.forkSession(work.id);
    const copied = createSession("work");
    service.copy(work.id, copied.id);
    for (const session of [child, fork, copied]) {
      expect(repository.getSetting(sessionBuiltinCapabilitiesSettingKey(session.id))).toEqual(
        expanded,
      );
      expect((await service.list(session.id)).filter((item) => item.selected)).toHaveLength(32);
    }

    repository.updateSession(work.id, { agentMode: "code" });
    expect(
      await service.legacyIdsForCapability(
        repository.getSession(work.id) as SessionView,
        latest[0] as string,
      ),
    ).toEqual([]);
    await expect(service.set(work.id, "builtin:code-debugging", true)).rejects.toThrow(
      "BUILTIN_CAPABILITY_LIMIT",
    );
    expect(repository.getSetting(key)).toEqual(expanded);
    repository.updateSession(work.id, { agentMode: "work" });
    await service.set(work.id, latest[0] as string, false);
    const afterRemoval = repository.getSetting(key) as string[];
    expect(afterRemoval.some((id) => groups[0]?.some((item) => item.id === id))).toBe(false);
    await service.set(work.id, latest[0] as string, true);
    expect(repository.getSetting(key)).toEqual([...afterRemoval, latest[0]]);
    expect(await service.legacyIdsForCapability(work, latest[0] as string)).toEqual(
      groups[0]?.filter((item) => item.id !== latest[0]).map((item) => item.id),
    );
  });

  it("rechecks session mode and concurrent selection changes after resolving aliases", async () => {
    const work = createSession("work");
    const key = sessionBuiltinCapabilitiesSettingKey(work.id);
    const original = domainSkills.canonicalBuiltinCapabilityIds;
    const spy = vi.spyOn(domainSkills, "canonicalBuiltinCapabilityIds");
    try {
      spy.mockImplementationOnce(async (directory, ids) => {
        repository.setSetting(key, ["builtin:work-asd-ste100"]);
        return original(directory, ids);
      });
      await service.set(work.id, "builtin:work-ppt-master", true);
      expect(repository.getSetting(key)).toEqual([
        "builtin:work-asd-ste100",
        "builtin:work-ppt-master",
      ]);

      spy.mockImplementationOnce(async (directory, ids) => {
        repository.updateSession(work.id, { agentMode: "code" });
        return original(directory, ids);
      });
      await expect(service.set(work.id, "builtin:work-pdf", true)).rejects.toThrow(
        "BUILTIN_CAPABILITY_STATE_CHANGED",
      );
      expect(repository.getSetting(key)).toEqual([
        "builtin:work-asd-ste100",
        "builtin:work-ppt-master",
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it("fails closed instead of silently truncating an oversized stored selection", async () => {
    const work = createSession("work");
    const key = sessionBuiltinCapabilitiesSettingKey(work.id);
    const raw = Array.from(
      { length: domainSkills.MAX_WORK_SOURCE_CATALOG_ENTRIES + 33 },
      (_, index) => `builtin:fixture-${index}`,
    );
    repository.setSetting(key, raw);
    await expect(service.list(work.id)).rejects.toThrow("BUILTIN_CAPABILITY_STORAGE_INVALID");
    expect(repository.getSetting(key)).toEqual(raw);
  });

  it("enforces the selection budget and cleans the setting with the session", async () => {
    const work = createSession("work");
    repository.setSetting(
      sessionBuiltinCapabilitiesSettingKey(work.id),
      Array.from({ length: 32 }, (_, index) => `builtin:fixture-${index}`),
    );
    await expect(service.set(work.id, "builtin:work-asd-ste100", true)).rejects.toThrow(
      "BUILTIN_CAPABILITY_LIMIT",
    );

    const selectedKey = sessionBuiltinCapabilitiesSettingKey(work.id);
    expect(repository.getSetting(selectedKey)).not.toBeNull();
    repository.removeSession(work.id);
    expect(repository.getSetting(selectedKey)).toBeNull();
  });

  it("inherits selections in forks and child sessions without changing installed extension state", async () => {
    const source = createSession("work");
    await service.set(source.id, "builtin:work-ppt-master", true);
    const child = createSession("work", source.id);
    const fork = repository.forkSession(source.id);
    const selectedKey = sessionBuiltinCapabilitiesSettingKey(source.id);

    expect(repository.getSetting(sessionBuiltinCapabilitiesSettingKey(child.id))).toEqual([
      "builtin:work-ppt-master",
    ]);
    expect(repository.getSetting(sessionBuiltinCapabilitiesSettingKey(fork.id))).toEqual([
      "builtin:work-ppt-master",
    ]);
    expect(repository.listSessionExtensionIds(source.id)).toEqual([]);
    expect(repository.listSessionExtensionIds(child.id)).toEqual([]);
    expect(repository.getSetting(selectedKey)).toEqual(["builtin:work-ppt-master"]);
  });
});
