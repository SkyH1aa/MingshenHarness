import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextUsageView } from "../../shared/domain";
import type { ProviderService } from "../providers/provider-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ContextCompactionService } from "./context-compaction-service";

afterEach(() => vi.restoreAllMocks());

function fixture(path = ":memory:") {
  const database = openDatabase(path);
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Fixture",
    baseUrl: "https://fixture.invalid/v1",
    protocol: "openai_responses",
    authMode: "bearer",
    customHeaderName: null,
  });
  const addModel = (name: string, window = 200000) => {
    repository.insertModel({
      providerId: provider.id,
      modelId: name,
      displayName: name,
      contextWindow: window,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
    });
    return repository
      .getProvider(provider.id)
      ?.models.find((model) => model.modelId === name) as NonNullable<
      ReturnType<Repository["getModel"]>
    >;
  };
  const model = addModel("current");
  const session = repository.insertSession({
    title: "Existing",
    providerId: provider.id,
    modelId: model.id,
    agentProfileId: "primary",
    workspacePath: null,
    systemPrompt: "Preserve constraints",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
  const providers = {
    getActiveApiKey: vi.fn(() => {
      throw new Error("Restoring must not request credentials");
    }),
  } as unknown as ProviderService;
  const createService = () =>
    new ContextCompactionService(
      repository,
      providers,
      `${process.cwd()}/resources/prompts`,
      vi.fn(),
    );
  const service = createService();
  const append = (text: string) =>
    repository.appendMessage({
      sessionId: session.id,
      role: "user",
      parts: [{ type: "text", text }],
    });
  const input = {
    session,
    provider,
    model,
    systemPrompt: "System",
    tools: [],
    runId: "existing-run",
    signal: new AbortController().signal,
  };
  return {
    database,
    repository,
    provider,
    model,
    session,
    providers,
    service,
    append,
    input,
    addModel,
    createService,
  };
}

describe("context usage restoration", () => {
  it("retains provider-calibrated counts across an actual SQLite close/reopen, including UI-only summaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-context-restore-"));
    const path = join(root, "test.db");
    const f = fixture(path);
    let reopened: ReturnType<typeof openDatabase> | undefined;
    const network = vi.spyOn(globalThis, "fetch");
    try {
      f.append("Original task");
      f.service.recordResponse(f.input, { inputTokens: 32000, outputTokens: 500 });
      const saved = f.service.state(f.session.id) as ContextUsageView;
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "assistant",
        parts: [
          {
            type: "run_summary",
            summary: { runId: "existing-run", durationMs: 400, toolCount: 0, fileChanges: [] },
          },
        ],
      });
      f.database.close();
      reopened = openDatabase(path);
      const repository = new Repository(reopened);
      const restored = await new ContextCompactionService(
        repository,
        f.providers,
        `${process.cwd()}/resources/prompts`,
        vi.fn(),
      ).restore(f.session.id);
      expect(restored).toMatchObject({
        usedTokens: saved.usedTokens,
        source: "provider",
        restored: true,
        modelId: f.model.id,
        updatedAt: saved.updatedAt,
      });
      expect(network).not.toHaveBeenCalled();
      expect(f.providers.getActiveApiKey).not.toHaveBeenCalled();
    } finally {
      if (reopened) reopened.close();
      else f.database.close();
      if (resolve(root).startsWith(resolve(tmpdir()) + sep))
        await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers old usage views missing model identity from matching durable observations", async () => {
    const f = fixture();
    try {
      f.append("Existing task");
      f.service.recordResponse(f.input, { inputTokens: 32000, outputTokens: 500 });
      const saved = f.service.state(f.session.id) as ContextUsageView;
      const { providerId: _provider, modelId: _model, ...legacy } = saved;
      f.repository.setSetting(`context.view.${f.session.id}`, legacy);
      f.repository.removeSetting(`context.snapshot.${f.session.id}`);
      const restored = await f.createService().restore(f.session.id);
      expect(restored).toMatchObject({
        providerId: f.provider.id,
        modelId: f.model.id,
        usedTokens: 32500,
        restored: true,
      });
      expect(f.service.state(f.session.id)?.modelId).toBe(f.model.id);
    } finally {
      f.database.close();
    }
  });

  it("estimates empty chats and forks immediately without a model call, then persists that estimate", async () => {
    const f = fixture();
    const network = vi.spyOn(globalThis, "fetch");
    try {
      const empty = await f.service.restore(f.session.id);
      expect(empty).toMatchObject({
        source: "estimate",
        estimateScope: "local",
        modelId: f.model.id,
        restored: false,
      });
      expect(empty?.usedTokens).toBeGreaterThan(0);
      f.append("Full conversation context. ".repeat(100));
      const source = await f.service.restore(f.session.id);
      const fork = f.repository.forkSession(f.session.id);
      expect((await f.service.restore(fork.id))?.usedTokens).toBe(source?.usedTokens);
      expect(await f.createService().restore(fork.id)).toMatchObject({
        usedTokens: source?.usedTokens,
        restored: true,
      });
      expect(network).not.toHaveBeenCalled();
    } finally {
      f.database.close();
    }
  });

  it("does not reuse old calibrated usage after switching model, system prompt or rewriting history", async () => {
    const f = fixture();
    try {
      f.append("Existing task");
      f.service.recordResponse(f.input, { inputTokens: 100000, outputTokens: 500 });
      const other = f.addModel("other", 128000);
      f.repository.updateSession(f.session.id, { modelId: other.id });
      const switched = await f.service.restore(f.session.id);
      expect(switched).toMatchObject({
        modelId: other.id,
        contextWindow: 128000,
        source: "estimate",
      });
      expect(switched?.usedTokens).toBeLessThan(100500);
      f.repository.updateSession(f.session.id, {
        modelId: f.model.id,
        systemPrompt: "New prompt ".repeat(300),
      });
      expect((await f.service.restore(f.session.id))?.source).toBe("estimate");
      f.repository.deleteMessagesFromSeq(f.session.id, 1);
      expect(f.repository.getSetting(`context.snapshot.${f.session.id}`)).toBeNull();
      f.append("Replacement");
      const rewritten = await f.service.restore(f.session.id);
      expect(rewritten?.source).toBe("estimate");
      expect(rewritten?.usedTokens).toBeLessThan(100500);
      f.repository.removeSession(f.session.id);
      expect(await f.service.restore(f.session.id)).toBeNull();
      expect(f.repository.getSetting(`context.snapshot.${f.session.id}`)).toBeNull();
    } finally {
      f.database.close();
    }
  });

  it("uses effective summaries instead of the uncompressed transcript when estimating old chats", async () => {
    const f = fixture();
    try {
      const original = f.append("Long original facts. ".repeat(1500));
      f.append("Continue the task");
      const before = await f.service.restore(f.session.id);
      f.repository.setSetting(`context.checkpoint.${f.session.id}`, {
        id: "summary",
        throughSeq: original.seq,
        throughId: original.id,
        summary: "Short known facts",
        createdAt: original.createdAt,
      });
      const restored = await f.createService().restore(f.session.id);
      expect(restored?.usedTokens).toBeLessThan(before?.usedTokens ?? 0);
      expect(restored?.lastCompactedAt).toBe(original.createdAt);
      expect(f.repository.getMessages(f.session.id)).toHaveLength(2);
    } finally {
      f.database.close();
    }
  });

  it("keeps interruption diagnostics visible and repairs corrupt saved counts", async () => {
    const f = fixture();
    try {
      f.append("Existing task");
      f.service.recordResponse(f.input, { inputTokens: 32000, outputTokens: 500 });
      f.repository.setSetting(`context.view.${f.session.id}`, {
        ...f.service.state(f.session.id),
        state: "compacting",
      });
      expect(await f.createService().restore(f.session.id)).toMatchObject({
        state: "failed",
        usedTokens: 32500,
        error: expect.stringContaining("已中断"),
      });
      f.repository.setSetting(`context.view.${f.session.id}`, {
        ...f.service.state(f.session.id),
        usedTokens: -100,
      });
      expect((await f.service.restore(f.session.id))?.usedTokens).toBeGreaterThan(0);
      f.database.prepare("delete from models where id = ?").run(f.model.id);
      expect(await f.service.restore(f.session.id)).toBeNull();
    } finally {
      f.database.close();
    }
  });
});
