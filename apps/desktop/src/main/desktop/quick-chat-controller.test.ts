import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent, SessionMessage } from "../../shared/domain";
import { IPC_CHANNELS } from "../../shared/ipc";
import { QUICK_CHAT_TTL_MS } from "../../shared/quick-chat";
import { SessionService } from "../sessions/session-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { QuickChatController } from "./quick-chat-controller";

const START = 1_800_000_000_000;

describe("Quick chat ten minute sliding session", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;
  let sessionService: SessionService;
  let providerId: string;
  let modelId: string;
  let now: number;

  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
    sessionService = new SessionService(repository);
    providerId = repository.insertProvider({
      name: "Fixture",
      baseUrl: "https://example.com/v1",
      protocol: "openai_responses",
      authMode: "bearer",
      customHeaderName: null,
    }).id;
    database
      .prepare("insert into secrets (id, ciphertext, created_at) values (?, ?, ?)")
      .run("quick-chat-secret", new Uint8Array([1, 2, 3]), new Date(START).toISOString());
    repository.insertProviderKey({
      providerId,
      label: "Fixture",
      secretRef: "quick-chat-secret",
      maskedHint: "fixture",
      neverReveal: true,
      priority: 0,
    });
    modelId = addModel(providerId, "fixture-model", "Fixture model");
    now = START;
  });

  afterEach(() => database.close());

  function addModel(
    targetProviderId: string,
    externalModelId: string,
    displayName: string,
  ): string {
    repository.insertModel({
      providerId: targetProviderId,
      modelId: externalModelId,
      displayName,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: ["low", "high"],
      anthropicNoneBehavior: "disabled",
    });
    const model = repository
      .getProvider(targetProviderId)
      ?.models.find((candidate) => candidate.modelId === externalModelId);
    if (!model) throw new Error("Expected inserted model.");
    return model.id;
  }

  function controller(
    options: {
      context?: () => Promise<null> | null;
      isBusy?: (sessionId: string) => boolean;
      emit?: (event: ChatStreamEvent) => void;
    } = {},
  ): QuickChatController {
    return new QuickChatController({
      repository,
      sessionService,
      context: options.context ?? (async () => null),
      isBusy: options.isBusy ?? (() => false),
      emit: options.emit ?? (() => undefined),
      now: () => now,
    });
  }

  it("reuses and renews one isolated Chat session until the sliding lease expires", async () => {
    const emit = vi.fn();
    const quick = controller({ isBusy: () => true, emit });
    const first = await quick.activate();
    expect(first.session).toMatchObject({
      agentMode: "chat",
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "",
      permissionMode: "request_approval",
      approvalMode: "manual",
      executionMode: "host",
      patchOnly: false,
    });
    expect(first.expiresAt).toBe(START + QUICK_CHAT_TTL_MS);
    expect(first.pinned).toBe(false);
    expect(quick.currentSessionId).toBe(first.session?.id);
    expect(quick.acceptsSession(first.session?.id ?? null)).toBe(true);
    expect(quick.acceptsSession(null)).toBe(false);
    expect(quick.isCurrentBusy()).toBe(true);
    expect(emit).toHaveBeenCalledWith({
      type: "session_updated",
      session: first.session,
    });

    now += 5 * 60 * 1000;
    const readOnly = await quick.state();
    expect(readOnly.expiresAt).toBe(START + QUICK_CHAT_TTL_MS);

    const renewed = await quick.activate();
    expect(renewed.session?.id).toBe(first.session?.id);
    expect(renewed.expiresAt).toBe(now + QUICK_CHAT_TTL_MS);

    now += 9 * 60 * 1000;
    expect((await quick.activate()).session?.id).toBe(first.session?.id);

    now += 10 * 60 * 1000;
    const replacement = await quick.activate();
    expect(replacement.session?.id).not.toBe(first.session?.id);
    expect(replacement.session?.agentMode).toBe("chat");
    const chats = repository.listSessions().filter((session) => session.agentMode === "chat");
    expect(chats).toHaveLength(2);
    expect(chats.some((session) => session.id === first.session?.id)).toBe(true);
  });

  it("persists the compact window always-on-top preference", async () => {
    const quick = controller();
    expect((await quick.state()).pinned).toBe(false);
    expect((await quick.togglePinned()).pinned).toBe(true);
    expect((await quick.state()).pinned).toBe(true);
    expect(controller().pinned).toBe(true);
    expect((await quick.togglePinned()).pinned).toBe(false);
    expect((await quick.state()).pinned).toBe(false);
  });

  it("shares concurrent activation while queuing force-new instead of swallowing it", async () => {
    let resolveContext: (value: null) => void = () => undefined;
    let calls = 0;
    const context = vi.fn(() => {
      if (++calls > 1) return Promise.resolve(null);
      return new Promise<null>((resolve) => {
        resolveContext = resolve;
      });
    });
    const quick = controller({ context });
    const first = quick.activate();
    const concurrent = quick.activate();
    const forcedNew = quick.activate(true);
    expect(
      repository.listSessions().filter((session) => session.agentMode === "chat"),
    ).toHaveLength(1);
    resolveContext(null);
    const [left, right] = await Promise.all([first, concurrent]);
    expect(left.session?.id).toBe(right.session?.id);

    const created = await forcedNew;
    expect(created.session?.id).not.toBe(left.session?.id);
    expect(context).toHaveBeenCalledTimes(2);
    expect(
      repository.listSessions().filter((session) => session.agentMode === "chat"),
    ).toHaveLength(2);

    const another = await quick.activate(true);
    expect(another.session?.id).not.toBe(created.session?.id);
    expect(context).toHaveBeenCalledTimes(3);
  });

  it("reports configuration errors without inserting invalid sessions and recovers later", async () => {
    database.prepare("delete from models").run();
    const quick = controller();
    const missing = await quick.activate();
    expect(missing.session).toBeNull();
    expect(missing.error).toContain("配置");
    expect((await quick.state()).error).toContain("配置");
    expect(repository.listSessions()).toHaveLength(0);

    now += 1;
    modelId = addModel(providerId, "restored-model", "Restored model");
    const recovered = await quick.activate();
    expect(recovered.session).toMatchObject({ providerId, modelId, agentMode: "chat" });
    expect(recovered.error).toBeNull();
  });

  it("keeps a creation failure in state until a later successful activation", async () => {
    const creation = vi.spyOn(sessionService, "create").mockImplementationOnce(() => {
      throw new Error("Temporary create failure");
    });
    const quick = controller();
    const failed = await quick.activate();
    expect(failed.session).toBeNull();
    expect(failed.error).toBe("Temporary create failure");
    expect((await quick.state()).error).toBe("Temporary create failure");

    creation.mockRestore();
    const recovered = await quick.activate();
    expect(recovered.session?.agentMode).toBe("chat");
    expect((await quick.state()).error).toBeNull();
  });

  it("prefers a recent valid Chat configuration and only borrows provider/model from Code or Work", async () => {
    const secondProvider = repository.insertProvider({
      name: "Second",
      baseUrl: "https://second.example/v1",
      protocol: "openai_chat_completions",
      authMode: "bearer",
      customHeaderName: null,
    }).id;
    const secondModel = addModel(secondProvider, "second-model", "Second model");
    const code = sessionService.create({
      providerId: secondProvider,
      modelId: secondModel,
      agentMode: "code",
      workspacePath: "C:\\project",
      systemPrompt: "Code-only prompt",
      reasoningLevel: "high",
      permissionMode: "full_access",
      approvalMode: "automatic",
      executionMode: "docker",
      patchOnly: true,
    });
    const chat = sessionService.create({
      providerId,
      modelId,
      agentMode: "chat",
      workspacePath: null,
      systemPrompt: "Chat base configuration",
      reasoningLevel: "high",
      permissionMode: "request_approval",
      compactionModel: {
        mode: "custom",
        providerId,
        modelId,
      },
    });
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2027-02-01T00:00:00.000Z", code.id);
    database
      .prepare("update sessions set updated_at = ? where id = ?")
      .run("2027-01-01T00:00:00.000Z", chat.id);

    const fromChat = await controller().activate();
    expect(fromChat.session).toMatchObject({
      providerId,
      modelId,
      reasoningLevel: "high",
      compactionModel: { mode: "custom", providerId, modelId },
      workspacePath: null,
      permissionMode: "request_approval",
    });

    sessionService.update({ sessionId: chat.id, archived: true });
    if (fromChat.session) sessionService.update({ sessionId: fromChat.session.id, archived: true });
    const fromCode = await controller().activate();
    expect(fromCode.session).toMatchObject({
      providerId: secondProvider,
      modelId: secondModel,
      reasoningLevel: null,
      workspacePath: null,
      systemPrompt: "",
      permissionMode: "request_approval",
      approvalMode: "manual",
      executionMode: "host",
      patchOnly: false,
    });
  });

  it("restores the persisted lease before expiry but never revives an expired one", async () => {
    const firstController = controller();
    const first = await firstController.activate();
    now += 60_000;
    const secondController = controller();
    expect(secondController.currentSessionId).toBe(first.session?.id);
    expect((await secondController.activate()).session?.id).toBe(first.session?.id);

    now += QUICK_CHAT_TTL_MS;
    expect(controller().currentSessionId).toBeNull();
    const expired = await controller().activate();
    expect(expired.session?.id).not.toBe(first.session?.id);
    expect(expired.session?.agentMode).toBe("chat");
  });

  it("permits only current-chat reads and mutations plus the requested safe global operations", async () => {
    const quick = controller();
    const active = (await quick.activate()).session as NonNullable<
      Awaited<ReturnType<typeof quick.activate>>["session"]
    >;
    const message: SessionMessage = {
      id: "message",
      sessionId: active.id,
      seq: 1,
      role: "user",
      parts: [{ type: "text", text: "hello" }],
      createdAt: new Date(START).toISOString(),
    };
    expect(message.sessionId).toBe(active.id);

    for (const channel of [
      IPC_CHANNELS.appInfo,
      IPC_CHANNELS.uiPreferencesGet,
      IPC_CHANNELS.modelCatalogGet,
      IPC_CHANNELS.modelCatalogProviderMove,
      IPC_CHANNELS.modelCatalogStarSet,
      IPC_CHANNELS.desktopState,
      IPC_CHANNELS.runtimeLogReport,
    ]) {
      expect(quick.permitsIpc(channel, [])).toBe(true);
    }
    expect(quick.permitsIpc(IPC_CHANNELS.editCommand, ["copy"])).toBe(true);
    expect(quick.permitsIpc(IPC_CHANNELS.quickChatState, [])).toBe(true);
    expect(quick.permitsIpc(IPC_CHANNELS.quickChatAction, ["show"])).toBe(true);
    expect(quick.permitsIpc(IPC_CHANNELS.quickChatAction, ["toggle"])).toBe(true);
    expect(quick.permitsIpc(IPC_CHANNELS.quickChatAction, ["toggle-pin"])).toBe(true);
    expect(quick.permitsIpc(IPC_CHANNELS.openExternalUrl, ["https://example.com"])).toBe(true);
    expect(quick.permitsIpc(IPC_CHANNELS.openExternalUrl, ["file:///C:/secret"])).toBe(false);
    expect(quick.permitsIpc(IPC_CHANNELS.desktopAction, ["show", undefined, undefined])).toBe(true);
    expect(quick.permitsIpc(IPC_CHANNELS.desktopAction, ["quit", undefined, undefined])).toBe(
      false,
    );
    expect(quick.permitsIpc(IPC_CHANNELS.sessionMessages, [active.id])).toBe(true);
    expect(quick.permitsIpc(IPC_CHANNELS.sessionMessages, ["other"])).toBe(false);
    expect(quick.permitsIpc(IPC_CHANNELS.composerDraftClear, [active.id, "revision"])).toBe(true);
    expect(quick.permitsIpc(IPC_CHANNELS.composerDraftClear, ["other", "revision"])).toBe(false);
    expect(
      quick.permitsIpc(IPC_CHANNELS.sessionUpdate, [
        {
          sessionId: active.id,
          title: "Renamed",
          providerId,
          modelId,
          reasoningLevel: "low",
          compactionModel: { mode: "default", providerId: null, modelId: null },
        },
      ]),
    ).toBe(true);
    for (const forbidden of [
      { sessionId: active.id, systemPrompt: "Override" },
      { sessionId: active.id, permissionMode: "full_access" },
      { sessionId: active.id, workspacePath: "C:\\secret" },
      { sessionId: active.id, agentMode: "code" },
    ]) {
      expect(quick.permitsIpc(IPC_CHANNELS.sessionUpdate, [forbidden])).toBe(false);
    }
    expect(quick.permitsIpc(IPC_CHANNELS.workspaceRead, ["C:\\secret", "file.txt"])).toBe(false);
    expect(quick.permitsIpc(IPC_CHANNELS.mcpList, [])).toBe(false);
    for (const channel of [
      IPC_CHANNELS.queuedPromptList,
      IPC_CHANNELS.queuedPromptAdd,
      IPC_CHANNELS.queuedPromptUpdate,
      IPC_CHANNELS.queuedPromptReorder,
      IPC_CHANNELS.queuedPromptRemove,
      IPC_CHANNELS.queuedPromptContinue,
      IPC_CHANNELS.queuedPromptBeginEdit,
      IPC_CHANNELS.queuedPromptEndEdit,
    ]) {
      expect(quick.permitsIpc(channel, [active.id, "item"])).toBe(false);
    }

    expect(quick.permitsRuntimeEvent({ type: "session_updated", session: active })).toBe(true);
    expect(
      quick.permitsRuntimeEvent({
        type: "context_updated",
        context: {
          sessionId: active.id,
          runId: "run",
          state: "ready",
          usedTokens: 0,
          contextWindow: 100,
          source: "estimate",
          lastCompactedAt: null,
          error: null,
          updatedAt: new Date(START).toISOString(),
        },
      }),
    ).toBe(true);
    expect(
      quick.permitsRuntimeEvent({ type: "approval_state", state: { revision: 0, requests: [] } }),
    ).toBe(false);
    expect(
      quick.permitsRuntimeEvent({
        type: "activity",
        activity: {
          id: "activity",
          sessionId: active.id,
          runId: "run",
          toolName: "web_search",
          kind: "search",
          title: "Searching",
          detail: "",
          status: "running",
          startedAt: new Date(START).toISOString(),
          completedAt: null,
          durationMs: null,
          fileChange: null,
        },
      }),
    ).toBe(true);

    repository.removeSession(active.id);
    expect(
      quick.permitsRuntimeEvent({
        type: "session_removed",
        sessionId: active.id,
      }),
    ).toBe(true);
  });
});
