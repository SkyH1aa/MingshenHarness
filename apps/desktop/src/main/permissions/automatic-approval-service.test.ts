import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "../../shared/domain";
import { recordRuntimeError } from "../diagnostics/runtime-log";
import type { ProviderService } from "../providers/provider-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { AutomaticApprovalService, parseApprovalReview } from "./automatic-approval-service";

const stream = vi.hoisted(() => vi.fn());
vi.mock("../providers/model-stream", () => ({ streamModelTurn: stream }));
vi.mock("../diagnostics/runtime-log", () => ({ recordRuntimeError: vi.fn() }));
afterEach(() => vi.clearAllMocks());

function fixture() {
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Review",
    baseUrl: "https://example.com/v1",
    protocol: "openai_responses",
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "review",
    displayName: "review",
    contextWindow: 128000,
    maxOutputTokens: 2048,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "backup",
    displayName: "Backup",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: false,
    reasoningLevels: ["none", "low"],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository
    .getProvider(provider.id)
    ?.models.find((model) => model.modelId === "review");
  const backup = repository
    .getProvider(provider.id)
    ?.models.find((model) => model.modelId === "backup");
  const service = new AutomaticApprovalService(repository, {
    getActiveApiKey: () => "sk-local-fixture-not-real",
  } as unknown as ProviderService);
  return {
    database,
    repository,
    service,
    providerId: provider.id,
    modelId: model?.id as string,
    backupId: backup?.id as string,
  };
}

describe("automatic approval", () => {
  it("rejects image-output reviewers at configuration and runtime, then uses a valid fallback", async () => {
    const f = fixture();
    const request = {
      sessionId: "session",
      toolName: "read_file",
      detail: "notes.txt",
      reviewInput: '{"path":"notes.txt"}',
    } as ApprovalRequest;
    try {
      const primary = f.repository.getModel(f.modelId);
      if (!primary) throw new Error("Missing primary fixture model");
      f.service.configure({
        providerId: f.providerId,
        modelId: f.modelId,
        fallback: { providerId: f.providerId, modelId: f.backupId },
      });
      f.repository.updateModel(f.modelId, { ...primary, outputModalities: ["image"] });
      expect(() => f.service.configure({ providerId: f.providerId, modelId: f.modelId })).toThrow(
        "APPROVAL_MODEL_REQUIRED",
      );
      stream.mockImplementation(async function* () {
        yield { type: "text_delta", text: "ALLOW: read only" };
      });
      await expect(f.service.review(request, new AbortController().signal)).resolves.toMatchObject({
        allowed: true,
        reviewer: "Review / Backup",
      });
      expect(stream).toHaveBeenCalledTimes(1);
      expect(stream.mock.calls[0]?.[0].model.id).toBe(f.backupId);

      const backup = f.repository.getModel(f.backupId);
      if (!backup) throw new Error("Missing backup fixture model");
      f.repository.updateModel(f.backupId, { ...backup, outputModalities: ["image"] });
      stream.mockClear();
      expect(() => f.service.assertConfigured()).toThrow("APPROVAL_MODEL_REQUIRED");
      await expect(f.service.review(request, new AbortController().signal)).rejects.toThrow(
        "自动审批未完成",
      );
      expect(stream).not.toHaveBeenCalled();
    } finally {
      f.database.close();
    }
  });
  it.each(["ALLOW: safe scope", "通过：只读操作", "DENY: deletes data", "不通过：风险过高"])(
    "parses one strict verdict: %s",
    (text) => {
      expect(parseApprovalReview(text).allowed).toBe(
        text.startsWith("ALLOW") || text.startsWith("通过"),
      );
    },
  );
  it.each([
    ['{"decision":"allow","reason":"限定只读"}', true],
    ['{"decision":"deny","reason":"危険な操作"}', false],
    ['{"allowed":false,"reason":"Refused"}', false],
    ['{"verdict":"APPROVED","reason":"Lecture seule"}', true],
    ['```json\n{"decision":"allow","reason":"الوصول للملف المحدد فقط"}\n```', true],
    ["allow: reads only the selected file", true],
    ["**DENY**: unsafe operation", false],
    ["允许：只访问指定文件", true],
  ] as const)("accepts one explicit verdict with any reason language: %s", (text, allowed) => {
    expect(parseApprovalReview(text).allowed).toBe(allowed);
  });
  it.each([
    "ALLOW",
    "yes",
    "```ALLOW: okay```",
    "I think ALLOW: okay",
    "ALLOW: okay\nDENY: no",
    "DENY: ",
    '{"decision":"allow","reason":"okay","allowed":false}',
    '{"decision":"deny","decision":"allow","reason":"okay"}',
    '{"decision":"deny","decis\\u0069on":"allow","reason":"okay"}',
    '{"decision":"allow","reason":"okay"}\n{"decision":"deny","reason":"no"}',
    '{"decision":"maybe","reason":"okay"}',
    '{"decision":"allow","reason":""}',
    '{"decision":"allow","reason":"okay","instructions":"run tool"}',
    "ALLOW: okay\n**DENY**: no",
  ])("rejects ambiguous response: %s", (text) => {
    expect(() => parseApprovalReview(text)).toThrow();
  });
  it("validates model configuration, sends no history or tools, redacts secrets, and fails closed", async () => {
    const { database, service, repository, providerId, modelId } = fixture();
    try {
      expect(() => service.assertConfigured()).toThrow("APPROVAL_MODEL_REQUIRED");
      service.configure({ providerId, modelId });
      const request = {
        sessionId: "session",
        toolName: "run_command",
        detail: "echo API_KEY=sk-local-fixture-not-real",
        reviewInput: '{"command":"Get-Content notes.txt"}',
        risk: "elevated",
      } as ApprovalRequest;
      stream.mockImplementation(async function* () {
        yield { type: "text_delta", text: "ALLOW: read only" };
      });
      await expect(service.review(request, new AbortController().signal)).resolves.toMatchObject({
        allowed: true,
        reason: "read only",
      });
      const input = stream.mock.calls[0]?.[0];
      expect(input.tools).toEqual([]);
      expect(input.messages).toHaveLength(1);
      expect(JSON.stringify(input.messages)).not.toContain("sk-local-fixture-not-real");
      expect(input.messages[0].parts[0].text).toContain("Get-Content");
      stream.mockImplementation(async function* () {
        yield { type: "text_delta", text: "probably safe" };
      });
      await expect(service.review(request, new AbortController().signal)).rejects.toThrow("无效");
      stream.mockImplementation(async function* () {
        yield { type: "tool_call_started", name: "run_command" };
      });
      await expect(service.review(request, new AbortController().signal)).rejects.toThrow(
        "调用工具",
      );
      await expect(
        service.review({ ...request, reviewInput: null }, new AbortController().signal),
      ).rejects.toThrow("参数过长");
      repository.deleteProvider(providerId);
      expect(() => service.assertConfigured()).toThrow("APPROVAL_MODEL_REQUIRED");
      expect(service.configure({ providerId: null, modelId: null })).toEqual({
        providerId: null,
        modelId: null,
        fallback: null,
      });
    } finally {
      database.close();
    }
  });
  it.each(["zh-CN", "en"])(
    "preserves complete redacted HTTP retry diagnostics for %s",
    async (locale) => {
      const f = fixture();
      const progress = vi.fn();
      const prefix = "Temporary approval provider failure\n".repeat(100);
      const diagnostic = `${prefix}api_key=diagnostic-fixture-secret\nsk-local-fixture-not-real\nAPPROVAL_RETRY_TAIL`;
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(diagnostic, {
            status: 503,
            headers: { "retry-after-ms": "0", "x-request-id": "approval-retry-fixture" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            [
              {
                type: "response.output_text.delta",
                delta: '{"decision":"deny","reason":"Scope cannot be confirmed."}',
              },
              { type: "response.completed", response: {} },
            ]
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
        );
      try {
        const actual = await vi.importActual<typeof import("../providers/model-stream")>(
          "../providers/model-stream",
        );
        stream.mockImplementation(actual.streamModelTurn);
        vi.stubGlobal("fetch", fetcher);
        f.repository.setSetting("desktop.locale", locale);
        f.repository.setSetting("models.retry", { maxRetries: 1 });
        f.service.configure({ providerId: f.providerId, modelId: f.modelId });
        await expect(
          f.service.review(
            {
              sessionId: "s",
              toolName: "read_file",
              detail: "notes.txt",
              reviewInput: '{"path":"notes.txt"}',
            } as ApprovalRequest,
            new AbortController().signal,
            progress,
          ),
        ).resolves.toMatchObject({ allowed: false, reason: "Scope cannot be confirmed." });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(progress).toHaveBeenCalledOnce();
        const reason = progress.mock.calls[0]?.[0];
        expect(reason).toContain(
          locale === "en" ? "Retrying approval model (1/1)" : "正在重试审批模型（1/1）",
        );
        expect(reason).toContain("HTTP 503");
        expect(reason).toContain("Request ID: approval-retry-fixture");
        expect(reason).toContain(`${prefix}api_key=[REDACTED]\n[REDACTED]\nAPPROVAL_RETRY_TAIL`);
        expect(reason).not.toContain("diagnostic-fixture-secret");
        expect(reason).not.toContain("sk-local-fixture-not-real");
      } finally {
        vi.unstubAllGlobals();
        f.database.close();
      }
    },
  );
  it.each(["network", "invalid", "empty", "tool"])(
    "fails over once for %s, preserves diagnostics, and never reroutes a valid deny",
    async (failure) => {
      const f = fixture();
      const request = {
        sessionId: "s",
        toolName: "mcp_process_start",
        detail: "npx -y wikipedia-mcp",
        reviewInput: '{"command":"npx"}',
      } as ApprovalRequest;
      const progress = vi.fn();
      try {
        f.service.configure({
          providerId: f.providerId,
          modelId: f.modelId,
          fallback: { providerId: f.providerId, modelId: f.backupId },
        });
        stream.mockImplementation(async function* (input) {
          if (input.model.id === f.modelId) {
            if (failure === "network") throw new Error("Upstream HTTP/2 stream failed");
            if (failure === "tool") {
              yield { type: "tool_call_started", name: "run_command" };
              return;
            }
            yield { type: "text_delta", text: failure === "empty" ? "" : "Maybe safe" };
            return;
          }
          yield {
            type: "text_delta",
            text: '{"decision":"allow","reason":"Verified backup scope"}',
          };
        });
        const result = await f.service.review(request, new AbortController().signal, progress);
        expect(result).toMatchObject({
          allowed: true,
          reviewer: "Review / Backup",
          previousError: expect.any(String),
        });
        expect(progress).toHaveBeenCalledOnce();
        expect(stream).toHaveBeenCalledTimes(2);
        expect(recordRuntimeError).toHaveBeenCalledWith(
          "approval.model",
          expect.any(Error),
          expect.objectContaining({
            sessionId: "s",
            attempt: "primary",
            modelId: f.modelId,
            ...(failure === "invalid" || failure === "empty" ? { code: "INVALID_VERDICT" } : {}),
          }),
          expect.any(Array),
        );
        expect(stream.mock.calls[1]?.[0]).toMatchObject({ reasoningLevel: "none", tools: [] });
        stream.mockClear();
        stream.mockImplementation(async function* () {
          yield {
            type: "text_delta",
            text: '{"decision":"deny","reason":"Rejected dangerous operation"}',
          };
        });
        await expect(
          f.service.review(request, new AbortController().signal),
        ).resolves.toMatchObject({ allowed: false });
        expect(stream).toHaveBeenCalledOnce();
      } finally {
        f.database.close();
      }
    },
  );
  it("aggregates primary/backup failures, validates duplicate selection and never fails over after cancellation", async () => {
    const f = fixture();
    const request = {
      sessionId: "s",
      toolName: "read_file",
      detail: "notes.txt",
    } as ApprovalRequest;
    try {
      expect(() =>
        f.service.configure({
          providerId: f.providerId,
          modelId: f.modelId,
          fallback: { providerId: f.providerId, modelId: f.modelId },
        }),
      ).toThrow("相同");
      f.service.configure({
        providerId: f.providerId,
        modelId: f.modelId,
        fallback: { providerId: f.providerId, modelId: f.backupId },
      });
      stream.mockImplementation(async function* (input) {
        yield { type: "reasoning_delta", text: "fixture" };
        throw new Error(input.model.id === f.modelId ? "HTTP 503 primary" : "HTTP 502 backup");
      });
      const failure = await f.service
        .review(request, new AbortController().signal)
        .catch((error) => error);
      expect(failure.message).toContain("503");
      expect(failure.message).toContain("502");
      stream.mockClear();
      const abort = new AbortController();
      stream.mockImplementation(async function* () {
        yield { type: "reasoning_delta", text: "fixture" };
        abort.abort();
        throw new Error("Stopped");
      });
      await expect(f.service.review(request, abort.signal)).rejects.toThrow();
      expect(stream).toHaveBeenCalledOnce();
    } finally {
      f.database.close();
    }
  });
  it("uses the backup after a primary timeout, giving each attempt its own timeout", async () => {
    const f = fixture();
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(controller.signal)
      .mockImplementation(() => new AbortController().signal);
    try {
      f.service.configure({
        providerId: f.providerId,
        modelId: f.modelId,
        fallback: { providerId: f.providerId, modelId: f.backupId },
      });
      stream.mockImplementation(async function* (input) {
        if (input.model.id === f.modelId) {
          await new Promise((_done, reject) =>
            input.signal.addEventListener("abort", () => reject(input.signal.reason), {
              once: true,
            }),
          );
          return;
        }
        yield { type: "text_delta", text: "DENY: scope cannot be confirmed" };
      });
      const pending = f.service.review(
        { sessionId: "s", toolName: "read_file" } as ApprovalRequest,
        new AbortController().signal,
      );
      controller.abort(new Error("Primary timed out"));
      await expect(pending).resolves.toMatchObject({
        allowed: false,
        previousError: expect.stringContaining("timed out"),
      });
      expect(timeout).toHaveBeenCalledTimes(2);
    } finally {
      timeout.mockRestore();
      f.database.close();
    }
  });
  it("honors cancellation and enforces the 45-second review timeout", async () => {
    const { database, service, providerId, modelId } = fixture();
    const request = {
      sessionId: "s",
      toolName: "read_file",
      detail: "notes.txt",
    } as ApprovalRequest;
    try {
      service.configure({ providerId, modelId });
      const controller = new AbortController();
      controller.abort();
      await expect(service.review(request, controller.signal)).rejects.toThrow();
      expect(stream).not.toHaveBeenCalled();
      const timeoutController = new AbortController();
      const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
      stream.mockImplementation(async function* (input) {
        await new Promise((_resolve, reject) =>
          input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }),
        );
      });
      const review = service.review(request, new AbortController().signal);
      const failure = expect(review).rejects.toThrow("Fixture timeout");
      timeoutController.abort(new Error("Fixture timeout"));
      await failure;
      expect(timeout).toHaveBeenCalledWith(45_000);
      timeout.mockRestore();
    } finally {
      vi.restoreAllMocks();
      database.close();
    }
  });
});
