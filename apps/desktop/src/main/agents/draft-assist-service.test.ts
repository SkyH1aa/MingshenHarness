import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderService } from "../providers/provider-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import {
  DraftAssistService,
  projectToneSettingKey,
  resolveDraftTurnContext,
} from "./draft-assist-service";

const stream = vi.hoisted(() => vi.fn());
vi.mock("../providers/model-stream", () => ({ streamModelTurn: stream }));

afterEach(() => {
  vi.clearAllMocks();
});

function fixture() {
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Draft provider",
    baseUrl: "https://example.com/v1",
    protocol: "openai_chat_completions",
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "draft-editor",
    displayName: "Draft editor",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "image-only",
    displayName: "Image only",
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    inputModalities: ["text"],
    outputModalities: ["image"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository
    .getProvider(provider.id)
    ?.models.find((candidate) => candidate.modelId === "draft-editor");
  const image = repository
    .getProvider(provider.id)
    ?.models.find((candidate) => candidate.modelId === "image-only");
  const session = repository.insertSession({
    title: "Draft fixture",
    agentMode: "work",
    providerId: provider.id,
    modelId: model?.id as string,
    agentProfileId: "primary",
    workspacePath: "C:\\fixture\\project",
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
  const service = new DraftAssistService(repository, {
    getActiveApiKey: () => "sk-local-draft-fixture",
  } as unknown as ProviderService);
  return {
    database,
    repository,
    service,
    providerId: provider.id,
    modelId: model?.id as string,
    imageModelId: image?.id as string,
    session,
  };
}

describe("draft assist", () => {
  it("persists a text-only polish model and rejects image-only models", () => {
    const f = fixture();
    try {
      expect(() =>
        f.service.configure({ providerId: f.providerId, modelId: f.imageModelId }),
      ).toThrow("配置损坏");
      expect(f.service.configure({ providerId: f.providerId, modelId: f.modelId })).toEqual({
        providerId: f.providerId,
        modelId: f.modelId,
      });
      expect(f.service.settings()).toEqual({
        providerId: f.providerId,
        modelId: f.modelId,
      });
      expect(f.service.configure({ providerId: null, modelId: null })).toEqual({
        providerId: null,
        modelId: null,
      });
    } finally {
      f.database.close();
    }
  });

  it("stores project tone by workspace and renders it only with explicit transient context", () => {
    const f = fixture();
    try {
      expect(f.service.getProjectTone(f.session.id)).toMatchObject({
        preset: "default",
        configured: false,
      });
      expect(
        f.service.setProjectTone({
          sessionId: f.session.id,
          preset: "professional",
        }),
      ).toMatchObject({
        preset: "professional",
        customInstruction: null,
        configured: true,
      });
      expect(f.repository.getSetting(projectToneSettingKey("C:\\fixture\\project"))).toMatchObject({
        preset: "professional",
      });
      expect(resolveDraftTurnContext(f.repository, f.session, "这一轮只做风险分析")).toContain(
        '"temporaryInstruction":"这一轮只做风险分析"',
      );
      expect(resolveDraftTurnContext(f.repository, f.session)).toContain("专业、准确、克制");
      expect(
        resolveDraftTurnContext(
          { getSetting: () => null },
          { agentMode: "work", workspacePath: "C:\\fixture\\none" },
          "只分析",
        ),
      ).not.toContain("专业、准确、克制");
      expect(() =>
        f.service.setProjectTone({
          sessionId: f.session.id,
          preset: "custom",
          customInstruction: "",
        }),
      ).toThrow("请填写语气说明");
    } finally {
      f.database.close();
    }
  });

  it("returns a preview without writing messages or drafts and never enables tools", async () => {
    const f = fixture();
    try {
      f.service.configure({ providerId: f.providerId, modelId: f.modelId });
      stream.mockImplementation(async function* () {
        yield { type: "text_delta", text: "已润色的草稿" };
        yield { type: "usage", inputTokens: 12, outputTokens: 5 };
      });
      const beforeMessages = f.repository.getMessages(f.session.id);
      await expect(
        f.service.polish({
          sessionId: f.session.id,
          text: "需要润色的草稿",
          draftRevision: "revision-1",
        }),
      ).resolves.toMatchObject({
        text: "已润色的草稿",
        draftRevision: "revision-1",
        model: { providerId: f.providerId, modelId: f.modelId },
      });
      expect(f.repository.getMessages(f.session.id)).toEqual(beforeMessages);
      expect(stream.mock.calls[0]?.[0]).toMatchObject({
        tools: [],
        toolChoice: "none",
        maxOutputTokens: 8_192,
      });
      expect(stream.mock.calls[0]?.[0].messages).toHaveLength(1);
    } finally {
      f.database.close();
    }
  });

  it("rejects tool calls and empty output while preserving the original draft", async () => {
    const f = fixture();
    try {
      stream.mockImplementation(async function* () {
        yield { type: "tool_call_started", name: "write_file" };
      });
      await expect(
        f.service.polish({
          sessionId: f.session.id,
          text: "原稿",
          draftRevision: "revision-2",
        }),
      ).rejects.toThrow("尝试调用工具");
      stream.mockImplementation(async function* () {
        yield { type: "text_delta", text: "   " };
      });
      await expect(
        f.service.polish({
          sessionId: f.session.id,
          text: "原稿",
          draftRevision: "revision-3",
        }),
      ).rejects.toThrow("空结果");
    } finally {
      f.database.close();
    }
  });

  it("preserves whitespace in the supplied draft and rejects duplicate session requests", async () => {
    const f = fixture();
    let release: (() => void) | undefined;
    try {
      stream.mockImplementation(async function* () {
        await new Promise<void>((done) => {
          release = done;
        });
        yield { type: "text_delta", text: "Rewritten" };
      });
      const pending = f.service.polish({
        requestId: "request-a",
        sessionId: f.session.id,
        text: "  draft\n\n",
        draftRevision: "revision-a",
      });
      expect(stream.mock.calls.at(-1)?.[0].messages[0].parts[0].text).toBe(
        "Rewrite this draft only:\n  draft\n\n",
      );
      await expect(
        f.service.polish({
          requestId: "request-b",
          sessionId: f.session.id,
          text: "new draft",
          draftRevision: "revision-b",
        }),
      ).rejects.toThrow("当前会话正在润色");
      release?.();
      await expect(pending).resolves.toMatchObject({ text: "Rewritten" });
    } finally {
      release?.();
      await f.service.dispose();
      f.database.close();
    }
  });

  it.each(["cancel", "session", "shutdown"])(
    "rejects late output after %s and settles cleanup",
    async (mode) => {
      const f = fixture();
      let release: (() => void) | undefined;
      try {
        stream.mockImplementation(async function* () {
          await new Promise<void>((done) => {
            release = done;
          });
          yield { type: "text_delta", text: "Late result must not apply" };
        });
        const pending = f.service.polish({
          requestId: "request-cancel",
          sessionId: f.session.id,
          text: "Original draft",
          draftRevision: "revision-cancel",
        });
        const rejected = expect(pending).rejects.toThrow();
        const cleanup =
          mode === "session"
            ? f.service.disposeSession(f.session.id)
            : mode === "shutdown"
              ? f.service.dispose()
              : Promise.resolve(f.service.cancelRequest("request-cancel"));
        expect(stream.mock.calls.at(-1)?.[0].signal.aborted).toBe(true);
        release?.();
        await rejected;
        await cleanup;
        expect(f.repository.getMessages(f.session.id)).toEqual([]);
        if (mode === "shutdown")
          await expect(
            f.service.polish({ sessionId: f.session.id, text: "New", draftRevision: "next" }),
          ).rejects.toThrow("正在退出");
      } finally {
        release?.();
        await f.service.dispose();
        f.database.close();
      }
    },
  );
});
