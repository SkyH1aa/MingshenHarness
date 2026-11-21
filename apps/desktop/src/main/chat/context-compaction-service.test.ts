import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChatStreamEvent,
  MessagePart,
  ModelConfig,
  ProviderProtocol,
  SessionMessage,
} from "../../shared/domain";
import { recordRuntimeError } from "../diagnostics/runtime-log";
import { estimateModelInputTokens, streamModelTurn } from "../providers/model-stream";
import type { ProviderService } from "../providers/provider-service";
import { SessionService } from "../sessions/session-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { TokenSaverService } from "../token-saver/token-saver-service";
import { ContextCompactionService, safeCompactionCut } from "./context-compaction-service";
import { HostContextService } from "./host-context";

vi.mock("../diagnostics/runtime-log", () => ({ recordRuntimeError: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture(protocol: ProviderProtocol = "openai_responses") {
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  // These cases isolate compaction/fallback behavior; transport retries have separate coverage.
  repository.setSetting("models.retry", { maxRetries: 0 });
  const provider = repository.insertProvider({
    name: "Fixture",
    baseUrl: "https://fixture.invalid/v1",
    protocol,
    authMode: "bearer",
    customHeaderName: null,
  });
  const addModel = (modelId: string, contextWindow = 20000) => {
    repository.insertModel({
      providerId: provider.id,
      modelId,
      displayName: modelId,
      contextWindow,
      maxOutputTokens: 2048,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: false,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
    });
    return repository
      .getProvider(provider.id)
      ?.models.find((model) => model.modelId === modelId) as ModelConfig;
  };
  const model = addModel("current");
  const sessionService = new SessionService(repository);
  const session = sessionService.create({
    providerId: provider.id,
    modelId: model.id,
    title: "Existing",
    workspacePath: null,
    permissionMode: "request_approval",
    reasoningLevel: null,
  });
  const events: ChatStreamEvent[] = [];
  const providers = { getActiveApiKey: () => "fixture-key" } as unknown as ProviderService;
  const service = new ContextCompactionService(
    repository,
    providers,
    `${process.cwd()}/resources/prompts`,
    (event) => events.push(event),
  );
  const append = (role: SessionMessage["role"], text: string) =>
    repository.appendMessage({ sessionId: session.id, role, parts: [{ type: "text", text }] });
  append("user", "Original goal: modify notes.txt, preserve security and report real results.");
  append("assistant", "Actual findings. ".repeat(1100));
  append("user", "Continue CURRENT_USER_INSTRUCTION.");
  const input = {
    session,
    provider,
    model,
    systemPrompt: "Test system",
    tools: [],
    runId: "run",
    signal: new AbortController().signal,
  };
  return {
    database,
    repository,
    provider,
    model,
    session,
    sessionService,
    events,
    providers,
    service,
    append,
    input,
    addModel,
  };
}

function response(protocol: ProviderProtocol, text: string): Response {
  const events =
    protocol === "openai_responses"
      ? [
          { type: "response.output_text.delta", delta: text },
          {
            type: "response.completed",
            response: { usage: { input_tokens: 100, output_tokens: 80 } },
          },
        ]
      : protocol === "anthropic_messages"
        ? [
            { type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 0 } } },
            { type: "content_block_delta", delta: { type: "text_delta", text } },
            { type: "message_stop" },
          ]
        : protocol === "gemini_generate_content"
          ? [
              {
                candidates: [
                  { content: { role: "model", parts: [{ text }] }, finishReason: "STOP" },
                ],
              },
            ]
          : [{ choices: [{ delta: { content: text }, finish_reason: "stop" }] }, "[DONE]"];
  return new Response(
    events
      .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function compactionResponse(
  protocol: ProviderProtocol,
  text: string,
  outputLimited = false,
): Response {
  const outputTokens = outputLimited ? 4096 : 80;
  const events =
    protocol === "openai_responses"
      ? [
          { type: "response.output_text.delta", delta: text },
          {
            type: outputLimited ? "response.incomplete" : "response.completed",
            response: {
              status: outputLimited ? "incomplete" : "completed",
              ...(outputLimited ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
              usage: {
                input_tokens: 120,
                output_tokens: outputTokens,
                output_tokens_details: { reasoning_tokens: outputLimited ? 4000 : 0 },
              },
            },
          },
        ]
      : protocol === "anthropic_messages"
        ? [
            { type: "message_start", message: { usage: { input_tokens: 120, output_tokens: 0 } } },
            { type: "content_block_delta", delta: { type: "text_delta", text } },
            {
              type: "message_delta",
              delta: { stop_reason: outputLimited ? "max_tokens" : "end_turn" },
              usage: { output_tokens: outputTokens },
            },
            { type: "message_stop" },
          ]
        : [
            { choices: [{ delta: { content: text }, finish_reason: null }] },
            {
              choices: [{ delta: {}, finish_reason: outputLimited ? "length" : "stop" }],
              usage: {
                prompt_tokens: 120,
                completion_tokens: outputTokens,
                completion_tokens_details: { reasoning_tokens: outputLimited ? 4000 : 0 },
              },
            },
            "[DONE]",
          ];
  return new Response(
    events
      .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function summaryOutputLimit(body: Record<string, unknown>): number {
  return Number(body.max_output_tokens ?? body.max_tokens);
}

function summaryTokenTarget(body: Record<string, unknown>): number {
  const match = JSON.stringify(body).match(
    /Your final summary for this request must not exceed (\d+) tokens/,
  );
  if (!match) throw new Error("Missing explicit summary token target");
  return Number(match[1]);
}

function summaryUserText(body: Record<string, unknown>): string {
  const entries = (body.input ?? body.messages) as Array<Record<string, unknown>>;
  const user = entries.findLast((entry) => entry.role === "user");
  if (typeof user?.content === "string") return user.content;
  return Array.isArray(user?.content)
    ? user.content.map((part) => String((part as { text?: string }).text ?? "")).join("\n")
    : "";
}

function summaryHistoryFragment(body: Record<string, unknown>): string {
  const match = summaryUserText(body).match(
    /\n\nHistory fragment \d+:\n([\s\S]*?)\n\nPrevious summary:\n/,
  );
  if (!match) throw new Error("Missing complete history fragment");
  return match[1] ?? "";
}

function serializedTextHistory(messages: SessionMessage[]): string {
  return messages
    .map((message) =>
      JSON.stringify({
        id: message.id,
        role: message.role,
        seq: message.seq,
        parts: message.parts,
      }),
    )
    .join("\n\n");
}

describe("context compaction", () => {
  it("rejects image-output compactors at configuration and falls back when a saved model changes", async () => {
    const f = fixture();
    const image = f.addModel("configured-summary");
    const backup = f.addModel("text-backup");
    const primary = { providerId: f.provider.id, modelId: image.id };
    const fallback = { providerId: f.provider.id, modelId: backup.id };
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
      response("openai_responses", "Summary with constraints."),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      f.service.setGlobalModel(primary);
      f.service.setFallbackModel(fallback);
      f.repository.updateModel(image.id, { ...image, outputModalities: ["image"] });
      expect(() => f.service.setGlobalModel(primary)).toThrow("压缩模型不存在");
      expect(() =>
        f.sessionService.update({
          sessionId: f.session.id,
          compactionModel: { mode: "custom", ...primary },
        }),
      ).toThrow("压缩模型不存在");

      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      await f.service.prepare(f.input);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
      expect(body.model).toBe("text-backup");
    } finally {
      f.database.close();
    }
  });
  it("compacts with native Gemini using native contents and preserves source history", async () => {
    const f = fixture("gemini_generate_content");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        expect(url).toContain("/models/current:streamGenerateContent?alt=sse");
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        expect(body.systemInstruction.parts[0].text).toContain("压缩");
        expect(body.toolConfig?.functionCallingConfig.mode).not.toBe("AUTO");
        expect(body.messages).toBeUndefined();
        return response(
          "gemini_generate_content",
          "Preserve the original goal, constraints and verified findings.",
        );
      }),
    );
    try {
      const original = f.repository.getMessages(f.session.id);
      await f.service.prepare({ ...f.input, manual: true });
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies[0]?.contents).toBeInstanceOf(Array);
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toBeTruthy();
    } finally {
      f.database.close();
    }
  });

  it("omits native provider continuation from independent text summaries and preserves source history", async () => {
    const f = fixture();
    const canary = "NATIVE_CONTINUATION_ONLY_CANARY";
    f.repository.appendMessage({
      sessionId: f.session.id,
      role: "assistant",
      parts: [
        { type: "text", text: "A verified finding to summarize." },
        {
          type: "provider_state",
          state: {
            family: "deepseek",
            protocol: "openai_chat_completions",
            providerId: f.provider.id,
            modelId: f.model.modelId,
            endpointKey: "fixture",
            payload: {
              role: "assistant",
              content: "A verified finding to summarize.",
              reasoning_content: canary,
            },
          },
        },
      ],
    });
    f.append("user", "Continue using the verified finding.");
    const original = f.repository.getMessages(f.session.id);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: RequestInit) => {
        bodies.push(JSON.parse(String(options.body)) as Record<string, unknown>);
        return response("openai_responses", "Preserve the original goal and verified findings.");
      }),
    );
    try {
      await f.service.prepare({ ...f.input, manual: true });
      expect(bodies.length).toBeGreaterThan(0);
      expect(JSON.stringify(bodies)).toContain("A verified finding to summarize.");
      expect(JSON.stringify(bodies)).not.toContain(canary);
      expect(JSON.stringify(bodies)).not.toContain("provider_state");
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
    } finally {
      f.database.close();
    }
  });

  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "derives the output cap from 15%% of the current main context and respects lower model limits: %s",
    async (protocol) => {
      const f = fixture(protocol);
      const large = { ...f.model, contextWindow: 200000 };
      f.repository.updateModel(large.id, large);
      const configured = f.addModel("large-summary", 200000);
      f.repository.updateModel(configured.id, { ...configured, maxOutputTokens: 32000 });
      f.service.setGlobalModel({ providerId: f.provider.id, modelId: configured.id });
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, options: RequestInit) => {
          bodies.push(JSON.parse(String(options.body)));
          return compactionResponse(protocol, "Verified concise facts and original constraints.");
        }),
      );
      try {
        const original = f.repository.getMessages(f.session.id);
        await f.service.prepare({ ...f.input, model: large, manual: true });
        expect(summaryOutputLimit(bodies[0] ?? {})).toBe(30000);
        expect(JSON.stringify(bodies[0])).toContain("30000 tokens (15%");
        expect(JSON.stringify(bodies[0])).toContain("200000-token context window");
        expect(summaryTokenTarget(bodies[0] ?? {})).toBeLessThanOrEqual(30000);
        expect(f.repository.getMessages(f.session.id)).toEqual(original);

        const narrower = f.addModel("narrower-main", 100000);
        f.sessionService.update({ sessionId: f.session.id, modelId: narrower.id });
        const session = f.repository.getSession(f.session.id);
        if (!session) throw new Error("Missing changed session");
        f.append("assistant", "New verified source evidence. ".repeat(900));
        f.append("user", "Continue using the narrower main model.");
        await f.service.prepare({
          ...f.input,
          session,
          model: narrower,
          manual: true,
          runId: "narrower-main",
        });
        expect(summaryOutputLimit(bodies.at(-1) ?? {})).toBe(15000);
        expect(JSON.stringify(bodies.at(-1))).toContain("15000 tokens (15%");
        expect(JSON.stringify(bodies.at(-1))).toContain("100000-token context window");

        f.repository.updateModel(configured.id, { ...configured, maxOutputTokens: 4096 });
        f.append("assistant", "Further independently verified evidence. ".repeat(900));
        f.append("user", "Continue respecting the configured summary model output limit.");
        const latestHistory = f.repository.getMessages(f.session.id);
        await f.service.prepare({
          ...f.input,
          session,
          model: narrower,
          manual: true,
          runId: "configured-output-limit",
        });
        expect(summaryOutputLimit(bodies.at(-1) ?? {})).toBe(4096);
        expect(summaryTokenTarget(bodies.at(-1) ?? {})).toBeLessThanOrEqual(4096);
        expect(f.repository.getMessages(f.session.id)).toEqual(latestHistory);
      } finally {
        f.database.close();
      }
    },
  );

  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "recovers from exhausted output with shorter prompts and complete original fragments: %s",
    async (protocol) => {
      const f = fixture(protocol);
      f.repository.setSetting("plugins.tokenSaver", { enabled: false });
      f.repository.setSetting("models.retry", { maxRetries: 5 });
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, options: RequestInit) => {
          bodies.push(JSON.parse(String(options.body)));
          return compactionResponse(
            protocol,
            bodies.length === 1 ? "DISCARDED_OUTPUT_LIMIT_PARTIAL" : "Verified complete summary.",
            bodies.length === 1,
          );
        }),
      );
      try {
        const original = f.repository.getMessages(f.session.id);
        const expectedPrefix = serializedTextHistory(original.slice(0, 2));
        const compacted = await f.service.prepare({ ...f.input, manual: true });
        expect(bodies.length).toBeGreaterThan(2);
        expect(JSON.stringify(bodies[1])).toContain("Write a shorter summary");
        expect(summaryTokenTarget(bodies[1] ?? {})).toBeLessThan(
          summaryTokenTarget(bodies[0] ?? {}),
        );
        expect(bodies.slice(1).map(summaryHistoryFragment).join("")).toBe(expectedPrefix);
        expect(JSON.stringify(bodies.slice(1))).not.toContain("DISCARDED_OUTPUT_LIMIT_PARTIAL");
        expect(JSON.stringify(compacted)).not.toContain("DISCARDED_OUTPUT_LIMIT_PARTIAL");
        expect(JSON.stringify(compacted)).toContain("CURRENT_USER_INSTRUCTION");
        expect(f.repository.getMessages(f.session.id)).toEqual(original);
        expect(f.service.state(f.session.id)?.state).toBe("ready");
        expect(f.repository.getSetting(`tokenSaver.usage.${f.session.id}`)).toMatchObject({
          compaction: {
            requests: bodies.length,
            failedRequests: 1,
            inputTokens: 120 * bodies.length,
            outputTokens: 4096 + 80 * (bodies.length - 1),
          },
        });
      } finally {
        f.database.close();
      }
    },
  );

  it("keeps the original offset and completed summary when a later fragment exhausts output", async () => {
    const f = fixture();
    f.repository.setSetting("plugins.tokenSaver", { enabled: false });
    const small = f.addModel("small-summary", 5000);
    f.service.setGlobalModel({ providerId: f.provider.id, modelId: small.id });
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options: RequestInit) => {
        bodies.push(JSON.parse(String(options.body)));
        return compactionResponse(
          "openai_responses",
          bodies.length === 1
            ? "ACCUMULATED_FIRST_FRAGMENT"
            : bodies.length === 2
              ? "DISCARDED_SECOND_FRAGMENT"
              : "Complete verified continuation summary.",
          bodies.length === 2,
        );
      }),
    );
    try {
      const original = f.repository.getMessages(f.session.id);
      const compacted = await f.service.prepare({ ...f.input, manual: true });
      expect(bodies.length).toBeGreaterThan(3);
      const failedFragment = summaryHistoryFragment(bodies[1] ?? {});
      const retriedFragment = summaryHistoryFragment(bodies[2] ?? {});
      expect(failedFragment.startsWith(retriedFragment)).toBe(true);
      expect(retriedFragment.length).toBeLessThan(failedFragment.length);
      expect(summaryUserText(bodies[2] ?? {})).toContain(
        "Previous summary:\nACCUMULATED_FIRST_FRAGMENT",
      );
      expect(JSON.stringify(bodies.slice(2))).not.toContain("DISCARDED_SECOND_FRAGMENT");
      expect(
        bodies
          .filter((_body, index) => index !== 1)
          .map(summaryHistoryFragment)
          .join(""),
      ).toBe(serializedTextHistory(original.slice(0, 2)));
      expect(JSON.stringify(compacted)).not.toContain("DISCARDED_SECOND_FRAGMENT");
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
    } finally {
      f.database.close();
    }
  });

  it("recovers an exhausted cached prefix with shorter segmented requests and no partial summary", async () => {
    const f = fixture();
    f.repository.setSetting("plugins.tokenSaver", { enabled: false });
    const tools = [{ name: "read_file", description: "Read", parameters: { type: "object" } }];
    const source = f.service.messages(f.session.id);
    f.service.rememberRequest(
      f.session,
      { ...f.input, messages: source, reasoningLevel: null, tools },
      source,
    );
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options: RequestInit) => {
        bodies.push(JSON.parse(String(options.body)));
        return compactionResponse(
          "openai_responses",
          bodies.length === 1 ? "DISCARDED_CACHED_PARTIAL" : "Verified segmented summary.",
          bodies.length === 1,
        );
      }),
    );
    try {
      const original = f.repository.getMessages(f.session.id);
      const compacted = await f.service.prepare({ ...f.input, tools, manual: true });
      expect(bodies[0]?.tool_choice).toBe("none");
      expect(JSON.stringify(bodies[0])).toContain("chronological logical-message index");
      expect(bodies[1]?.tools).toBeUndefined();
      expect(JSON.stringify(bodies[1])).toContain("Write a shorter summary");
      expect(summaryTokenTarget(bodies[1] ?? {})).toBeLessThan(summaryTokenTarget(bodies[0] ?? {}));
      expect(bodies.slice(1).map(summaryHistoryFragment).join("")).toBe(
        serializedTextHistory(original.slice(0, 2)),
      );
      expect(JSON.stringify(bodies.slice(1))).not.toContain("DISCARDED_CACHED_PARTIAL");
      expect(JSON.stringify(compacted)).not.toContain("DISCARDED_CACHED_PARTIAL");
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
    } finally {
      f.database.close();
    }
  });

  it("bounds exhausted-output recovery to four shorter retries without changing source data", async () => {
    const f = fixture();
    f.repository.setSetting("models.retry", { maxRetries: 5 });
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options: RequestInit) => {
        bodies.push(JSON.parse(String(options.body)));
        return compactionResponse("openai_responses", "DISCARDED_REPEATED_PARTIAL", true);
      }),
    );
    try {
      const original = f.repository.getMessages(f.session.id);
      await expect(f.service.prepare({ ...f.input, manual: true })).rejects.toThrow(
        "多次耗尽输出预算",
      );
      expect(bodies).toHaveLength(5);
      const targets = bodies.map(summaryTokenTarget);
      expect(targets.slice(1).every((target, index) => target < (targets[index] ?? 0))).toBe(true);
      expect(
        bodies.slice(1).every((body) => JSON.stringify(body).includes("Write a shorter")),
      ).toBe(true);
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toBeNull();
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
      expect(f.service.state(f.session.id)?.state).toBe("failed");
      expect(f.repository.getSetting(`tokenSaver.usage.${f.session.id}`)).toMatchObject({
        compaction: { requests: 5, failedRequests: 5, outputTokens: 4096 * 5 },
      });
    } finally {
      f.database.close();
    }
  });

  it("restarts the backup from complete source history after primary output-limit recovery is exhausted", async () => {
    const f = fixture();
    f.repository.setSetting("plugins.tokenSaver", { enabled: false });
    const backup = f.addModel("backup-after-output-limit");
    f.service.setFallbackModel({ providerId: f.provider.id, modelId: backup.id });
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options: RequestInit) => {
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        const primary = body.model === "current";
        return compactionResponse(
          "openai_responses",
          primary ? "DISCARDED_PRIMARY_OUTPUT_LIMIT" : "Verified complete fallback summary.",
          primary,
        );
      }),
    );
    try {
      const original = f.repository.getMessages(f.session.id);
      const compacted = await f.service.prepare({ ...f.input, manual: true });
      expect(bodies.slice(0, 5).every((body) => body.model === "current")).toBe(true);
      const fallbackRequests = bodies.filter((body) => body.model === "backup-after-output-limit");
      expect(fallbackRequests).toHaveLength(1);
      expect(fallbackRequests.map(summaryHistoryFragment).join("")).toBe(
        serializedTextHistory(original.slice(0, 2)),
      );
      expect(JSON.stringify(fallbackRequests)).not.toContain("DISCARDED_PRIMARY_OUTPUT_LIMIT");
      expect(JSON.stringify(compacted)).toContain("Verified complete fallback summary.");
      expect(JSON.stringify(compacted)).not.toContain("DISCARDED_PRIMARY_OUTPUT_LIMIT");
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
      expect(f.repository.getSetting(`tokenSaver.usage.${f.session.id}`)).toMatchObject({
        compaction: { requests: 6, failedRequests: 5, outputTokens: 4096 * 5 + 80 },
      });
      expect(
        f.events.some(
          (event) =>
            event.type === "activity" &&
            event.activity.status === "completed" &&
            event.activity.detail.includes("多次耗尽输出预算"),
        ),
      ).toBe(true);
    } finally {
      f.database.close();
    }
  });

  it("cancels shorter-output recovery without replacing a saved checkpoint or starting fallback", async () => {
    const f = fixture();
    const backup = f.addModel("backup-summary");
    f.service.setFallbackModel({ providerId: f.provider.id, modelId: backup.id });
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
      compactionResponse("openai_responses", "Previously committed user constraints."),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      await f.service.prepare({ ...f.input, manual: true });
      const checkpoint = f.repository.getSetting(`context.checkpoint.${f.session.id}`);
      f.append("assistant", "New source evidence. ".repeat(1000));
      f.append("user", "Continue with all original constraints.");
      const original = f.repository.getMessages(f.session.id);
      const controller = new AbortController();
      let requests = 0;
      fetcher.mockImplementation(async (_url, options) => {
        expect(JSON.parse(String(options.body)).model).toBe("current");
        if (++requests === 1)
          return compactionResponse("openai_responses", "DISCARDED_BEFORE_CANCEL", true);
        controller.abort(new Error("Cancelled shorter-summary recovery"));
        throw controller.signal.reason;
      });
      await expect(
        f.service.prepare({
          ...f.input,
          manual: true,
          signal: controller.signal,
          runId: "cancel-shorter-recovery",
        }),
      ).rejects.toThrow("Cancelled shorter-summary recovery");
      expect(requests).toBe(2);
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toEqual(checkpoint);
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
    } finally {
      f.database.close();
    }
  });

  it.each([false, true])(
    "reserves actual input headroom for a small compactor with maximum configured output, old checkpoint: %s",
    async (oldCheckpoint) => {
      const f = fixture();
      const main = { ...f.model, contextWindow: 200000 };
      f.repository.updateModel(main.id, main);
      const small = f.addModel("small-high-output", 5000);
      f.repository.updateModel(small.id, { ...small, maxOutputTokens: 5000 });
      f.service.setGlobalModel({ providerId: f.provider.id, modelId: small.id });
      const olderSummary = `OLD_CONSTRAINT_START\n${"Prior verified result and immutable constraint. ".repeat(1500)}\nOLD_CONSTRAINT_END`;
      if (oldCheckpoint) {
        const through = f.repository.getMessages(f.session.id)[1];
        if (!through) throw new Error("Missing checkpoint anchor");
        f.repository.setSetting(`context.checkpoint.${f.session.id}`, {
          id: "large-old-checkpoint",
          summary: olderSummary,
          createdAt: new Date().toISOString(),
          throughSeq: through.seq,
          throughId: through.id,
        });
        f.append("assistant", "NEW_VERIFIED_EVIDENCE. ".repeat(900));
        f.append("user", "CURRENT_SMALL_COMPACTOR_INSTRUCTION");
      }
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, options: RequestInit) => {
          bodies.push(JSON.parse(String(options.body)));
          return compactionResponse(
            "openai_responses",
            "Preserve prior user constraints and new verified evidence.",
          );
        }),
      );
      try {
        const original = f.repository.getMessages(f.session.id);
        const compacted = await f.service.prepare({ ...f.input, model: main, manual: true });
        expect(bodies.length).toBeGreaterThan(1);
        for (const body of bodies) {
          const used = estimateModelInputTokens({
            provider: f.provider,
            model: small,
            systemPrompt: String(body.instructions),
            tools: [],
            messages: [
              {
                id: "budget-probe",
                sessionId: f.session.id,
                seq: 1,
                role: "user",
                createdAt: new Date().toISOString(),
                parts: [{ type: "text", text: summaryUserText(body) }],
              },
            ],
          });
          expect(used + summaryOutputLimit(body) + 256).toBeLessThanOrEqual(5000);
          expect(summaryTokenTarget(body)).toBeLessThanOrEqual(summaryOutputLimit(body));
        }
        if (oldCheckpoint) {
          const fragments = bodies.map(summaryHistoryFragment).join("");
          expect(fragments).toContain(olderSummary);
          expect(fragments).toContain("NEW_VERIFIED_EVIDENCE");
          expect(JSON.stringify(compacted)).toContain("CURRENT_SMALL_COMPACTOR_INSTRUCTION");
        }
        expect(f.repository.getMessages(f.session.id)).toEqual(original);
        expect(f.service.state(f.session.id)?.state).toBe("ready");
      } finally {
        f.database.close();
      }
    },
  );

  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "keeps immutable summary prefixes with a separate cheap model across compactions and restart: %s",
    async (protocol) => {
      const f = fixture(protocol);
      const cheap = f.addModel("cheap-summary");
      const mainModel = { ...f.model, contextWindow: 100000 };
      f.repository.updateModel(mainModel.id, mainModel);
      f.repository.updateModel(cheap.id, { ...cheap, maxOutputTokens: 256 });
      f.sessionService.update({
        sessionId: f.session.id,
        compactionModel: { mode: "custom", providerId: f.provider.id, modelId: cheap.id },
      });
      const bodies: Record<string, unknown>[] = [];
      let summaries = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, options) => {
          const body = JSON.parse(String(options.body));
          bodies.push(body);
          return response(
            protocol,
            body.model === "cheap-summary"
              ? `Segment ${++summaries}: verified result and updated task state; preserve notes.txt and all user constraints.`
              : "Main task continues.",
          );
        }),
      );
      const input = {
        ...f.input,
        model: mainModel,
        tools: [{ name: "read_file", description: "Read", parameters: { type: "object" } }],
      };
      const sendMain = async () => {
        for await (const _event of streamModelTurn({
          ...input,
          apiKey: "fixture-key",
          messages: f.service.messages(f.session.id),
          reasoningLevel: null,
        })) {
          /* Drain actual wire. */
        }
      };
      try {
        await sendMain();
        const first = bodies.at(-1);
        await f.service.prepare({ ...input, manual: true, runId: "compact-1" });
        const prefix = f.service.messages(f.session.id)[0];
        expect(prefix?.seq).toBe(0);
        await sendMain();
        const afterFirst = bodies.at(-1);
        f.append("assistant", "New verified work. ".repeat(800));
        f.append("user", "Continue with the changed result.");
        await f.service.prepare({ ...input, manual: true, runId: "compact-2" });
        expect(f.service.messages(f.session.id)[0]).toEqual(prefix);
        expect(JSON.stringify(f.service.messages(f.session.id))).toContain("Segment 2");
        await sendMain();
        const last = bodies.at(-1);
        if (!first || !last) throw new Error("Missing main requests");
        const wireSummary = (body: Record<string, unknown>) => {
          const entries = (body.input ?? body.messages) as Record<string, unknown>[];
          const content = entries.find((entry) => entry.role === "user")?.content;
          return Array.isArray(content) ? content[0] : content;
        };
        if (!afterFirst) throw new Error("Missing first compacted wire request");
        expect(wireSummary(last)).toEqual(wireSummary(afterFirst));
        expect(last?.tools).toEqual(first?.tools);
        if (protocol === "openai_responses") expect(last?.instructions).toBe(first?.instructions);
        else if (protocol === "anthropic_messages") expect(last?.system).toEqual(first?.system);
        else expect((last.messages as unknown[])[0]).toEqual((first.messages as unknown[])[0]);
        const compactions = bodies.filter((body) => body.model === "cheap-summary");
        expect(compactions).toHaveLength(2);
        expect(
          compactions.every((body) => !Array.isArray(body.tools) || body.tools.length === 0),
        ).toBe(true);
        expect(JSON.stringify(compactions[1])).toContain("Older immutable summaries");
        expect(JSON.stringify(compactions[1])).toContain("Segment 1");
        const restored = new ContextCompactionService(
          f.repository,
          f.providers,
          `${process.cwd()}/resources/prompts`,
          () => {},
        );
        expect(restored.messages(f.session.id)).toEqual(f.service.messages(f.session.id));
        const originalCount = f.repository.getMessages(f.session.id).length;
        for (let n = 3; n <= 9; n++) {
          f.append("assistant", "More verified evidence. ".repeat(800));
          f.append("user", `Continue ${n}.`);
          await f.service.prepare({ ...input, manual: true, runId: `compact-${n}` });
        }
        const checkpoint = f.repository.getSetting(`context.checkpoint.${f.session.id}`) as {
          segments: unknown[];
        };
        expect(checkpoint.segments).toHaveLength(1); // Ninth summary rebases the bounded ledger.
        expect(f.repository.getMessages(f.session.id)).toHaveLength(originalCount + 14);
        const fork = f.repository.forkSession(f.session.id);
        expect(JSON.stringify(restored.messages(fork.id))).toContain("Segment 9");
      } catch (cause) {
        throw new Error(`Independent summary attempt ${summaries} failed`, { cause });
      } finally {
        f.database.close();
      }
    },
  );

  it("rebases a custom-model summary before its reserved output exceeds the segment budget", async () => {
    const f = fixture();
    const cheap = f.addModel("cheap-summary");
    f.service.setGlobalModel({ providerId: f.provider.id, modelId: cheap.id });
    let attempts = 0;
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        bodies.push(JSON.parse(String(options.body)));
        return response(
          "openai_responses",
          ++attempts === 1 ? "Verified earlier constraint. ".repeat(180) : "Merged new baseline.",
        );
      }),
    );
    try {
      await f.service.prepare({ ...f.input, manual: true });
      const old = f.service.messages(f.session.id)[0];
      f.append("assistant", "More work. ".repeat(1800));
      f.append("user", "Continue new work.");
      await f.service.prepare({ ...f.input, manual: true, runId: "second" });
      const checkpoint = f.repository.getSetting(`context.checkpoint.${f.session.id}`) as {
        segments: unknown[];
      };
      expect(checkpoint.segments).toHaveLength(1);
      expect(f.service.messages(f.session.id)[0]?.id).not.toBe(old?.id);
      expect(JSON.stringify(bodies[1])).toContain("Verified earlier constraint.");
      expect(JSON.stringify(bodies[1])).not.toContain("Older immutable summaries");
    } finally {
      f.database.close();
    }
  });

  it("rejects a gateway exceeding the append budget and preserves the complete checkpoint", async () => {
    const f = fixture();
    const cheap = f.addModel("cheap-summary");
    f.repository.updateModel(cheap.id, { ...cheap, maxOutputTokens: 256 });
    f.service.setGlobalModel({ providerId: f.provider.id, modelId: cheap.id });
    const fetcher = vi.fn(async () => response("openai_responses", "Verified original summary."));
    vi.stubGlobal("fetch", fetcher);
    const input = { ...f.input, model: { ...f.model, contextWindow: 100000 }, manual: true };
    try {
      fetcher.mockResolvedValueOnce(response("openai_responses", "超".repeat(12000)));
      await expect(f.service.prepare({ ...input, runId: "oversize-baseline" })).rejects.toThrow(
        "分段预算",
      );
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toBeNull();
      await f.service.prepare(input);
      const checkpoint = f.repository.getSetting(`context.checkpoint.${f.session.id}`);
      f.append("assistant", "More work. ".repeat(1800));
      f.append("user", "Continue.");
      fetcher.mockImplementation(async () => response("openai_responses", "超".repeat(12000)));
      await expect(f.service.prepare({ ...input, runId: "oversize" })).rejects.toThrow("分段预算");
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toEqual(checkpoint);
      expect(f.repository.getMessages(f.session.id)).toHaveLength(5);
    } finally {
      f.database.close();
    }
  });

  it("appends with a backup compactor and preserves all segments when the next compaction is stopped", async () => {
    const f = fixture();
    const cheap = f.addModel("cheap-summary");
    const backup = f.addModel("backup-summary");
    for (const model of [cheap, backup])
      f.repository.updateModel(model.id, { ...model, maxOutputTokens: 256 });
    f.service.setGlobalModel({ providerId: f.provider.id, modelId: cheap.id });
    f.service.setFallbackModel({ providerId: f.provider.id, modelId: backup.id });
    let initial = true;
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      return initial || body.model === "backup-summary"
        ? response("openai_responses", initial ? "Original constraint." : "Backup verified result.")
        : new Response("primary unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetcher);
    const input = { ...f.input, model: { ...f.model, contextWindow: 100000 }, manual: true };
    try {
      await f.service.prepare(input);
      const old = f.service.messages(f.session.id)[0];
      initial = false;
      f.append("assistant", "New work. ".repeat(1800));
      f.append("user", "Continue.");
      await f.service.prepare({ ...input, runId: "fallback" });
      expect(f.service.messages(f.session.id)[0]).toEqual(old);
      expect(JSON.stringify(f.service.messages(f.session.id))).toContain("Backup verified result.");
      const checkpoint = f.repository.getSetting(`context.checkpoint.${f.session.id}`);
      f.append("assistant", "Further work. ".repeat(1800));
      f.append("user", "Continue again.");
      const controller = new AbortController();
      fetcher.mockImplementation(async () => {
        controller.abort();
        throw new Error("Stopped");
      });
      await expect(
        f.service.prepare({ ...input, signal: controller.signal, runId: "stop" }),
      ).rejects.toThrow();
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toEqual(checkpoint);
    } finally {
      f.database.close();
    }
  });

  it("rebases instead of freezing a summary containing a newly configured credential", async () => {
    const f = fixture();
    const cheap = f.addModel("cheap-summary");
    f.repository.updateModel(cheap.id, { ...cheap, maxOutputTokens: 256 });
    f.service.setGlobalModel({ providerId: f.provider.id, modelId: cheap.id });
    const credential = "newly-configured-credential-canary";
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
      response("openai_responses", `Old opaque value: ${credential}`),
    );
    vi.stubGlobal("fetch", fetcher);
    const input = { ...f.input, model: { ...f.model, contextWindow: 100000 }, manual: true };
    try {
      await f.service.prepare(input);
      vi.spyOn(f.providers, "getActiveApiKey").mockReturnValue(credential);
      f.append("assistant", "New work. ".repeat(1800));
      f.append("user", "Continue.");
      fetcher.mockImplementation(async () =>
        response("openai_responses", "Redacted new baseline."),
      );
      await f.service.prepare({ ...input, runId: "redact" });
      const request = fetcher.mock.calls.at(-1)?.[1];
      expect(String(request?.body)).not.toContain(credential);
      const checkpoint = f.repository.getSetting(`context.checkpoint.${f.session.id}`) as {
        segments: unknown[];
      };
      expect(checkpoint.segments).toHaveLength(1);
      expect(JSON.stringify(checkpoint)).not.toContain(credential);
    } finally {
      f.database.close();
    }
  });

  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "reuses the prepared normal request prefix and preserves tools and reasoning without executing them: %s",
    async (protocol) => {
      const f = fixture(protocol);
      const tools = [
        {
          name: "read_file",
          description: "Read an approved local file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      ];
      const model = { ...f.model, reasoningLevels: ["low", "high"] };
      f.repository.updateModel(model.id, model);
      f.sessionService.update({ sessionId: f.session.id, reasoningLevel: "high" });
      const session = f.repository.getSession(f.session.id);
      if (!session) throw new Error("Missing session");
      const input = { ...f.input, session, model, tools };
      const requests: Record<string, unknown>[] = [];
      const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
        requests.push(JSON.parse(String(options.body)));
        return response(protocol, "Short verified summary with user constraints.");
      });
      vi.stubGlobal("fetch", fetcher);
      try {
        const source = f.service.messages(session.id);
        for await (const _event of streamModelTurn({
          ...input,
          apiKey: "fixture-key",
          messages: source,
          reasoningLevel: "high",
          temperature: 0.25,
          topP: 0.9,
          onRequestPrepared: (request) => f.service.rememberRequest(session, request, source),
        })) {
          // Drain the real serializer/transport so the snapshot is captured after preparation.
        }
        const originals = f.repository.getMessages(session.id);
        f.service.recordResponse(input, { inputTokens: 17000, outputTokens: 0 });
        const result = await f.service.prepare(input);
        const [normal, summary] = requests;
        expect(requests).toHaveLength(2);
        if (!normal || !summary) throw new Error("Missing captured requests");
        expect(summary.tools).toEqual(normal.tools);
        expect(JSON.stringify(summary)).toContain(source[0]?.id);
        expect(JSON.stringify(summary)).toContain("chronological logical-message index");
        expect(JSON.stringify(summary)).toContain("Test system");
        expect(JSON.stringify(summary)).not.toContain("History fragment");
        if (protocol === "openai_responses") {
          expect(summary.instructions).toBe(normal.instructions);
          expect(summary.reasoning).toEqual(normal.reasoning);
          expect(summary.tool_choice).toBe("none");
          expect((summary.input as unknown[]).slice(0, 2)).toEqual(
            (normal.input as unknown[]).slice(0, 2),
          );
        } else if (protocol === "openai_chat_completions") {
          expect(summary.reasoning_effort).toBe(normal.reasoning_effort);
          expect(summary.tool_choice).toBe("none");
          expect((summary.messages as unknown[]).slice(0, 3)).toEqual(
            (normal.messages as unknown[]).slice(0, 3),
          );
        } else {
          expect(summary.system).toEqual(normal.system);
          expect(summary.thinking).toEqual(normal.thinking);
          expect(summary.output_config).toEqual(normal.output_config);
          expect(summary.tool_choice).toEqual({ type: "none" });
          expect((summary.messages as unknown[]).slice(0, 2)).toEqual(
            (normal.messages as unknown[]).slice(0, 2),
          );
        }
        expect(summary.temperature).toBe(0.25);
        expect(summary.top_p).toBe(0.9);
        expect(JSON.stringify(result)).toContain("CURRENT_USER_INSTRUCTION");
        expect(f.repository.getMessages(session.id)).toEqual(originals);
      } finally {
        f.database.close();
      }
    },
  );

  it("appends a newly completed tool step while keeping previously transformed history unchanged", async () => {
    const f = fixture();
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: RequestInit) => {
        requests.push(JSON.parse(String(options.body)));
        return response("openai_responses", "Summary preserves all completed evidence.");
      }),
    );
    try {
      f.repository.deleteMessagesFromSeq(f.session.id, 3);
      const source = f.service.messages(f.session.id);
      const prepared = source.map((message) =>
        message.role === "assistant"
          ? { ...message, parts: [{ type: "text" as const, text: "FROZEN_EXPLANATION" }] }
          : message,
      );
      for await (const _event of streamModelTurn({
        ...f.input,
        apiKey: "fixture-key",
        messages: prepared,
        reasoningLevel: null,
        onRequestPrepared: (request) => f.service.rememberRequest(f.session, request, source),
      })) {
        // Capture a previous frozen transformation, then add a completed tool boundary.
      }
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            name: "read_file",
            callId: "new-read",
            arguments: '{"path":"notes.txt"}',
            status: "completed",
          },
        ],
      });
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "tool",
        parts: [
          { type: "tool_result", callId: "new-read", output: "NEW_EVIDENCE", isError: false },
        ],
      });
      f.append("user", "Continue with the new evidence.");
      const effective = f.service.messages(f.session.id);
      const transform = vi.fn((messages: SessionMessage[]) => messages);
      await f.service.prepare({ ...f.input, manual: true, transformMessages: transform });
      const summary = requests[1];
      const normal = requests[0];
      if (!normal || !summary) throw new Error("Missing captured requests");
      expect((summary.input as unknown[]).slice(0, 2)).toEqual(
        (normal.input as unknown[]).slice(0, 2),
      );
      expect(JSON.stringify(summary.input)).toContain("FROZEN_EXPLANATION");
      expect(JSON.stringify(summary.input)).toContain("NEW_EVIDENCE");
      expect(JSON.stringify(summary.input)).not.toContain("Actual findings");
      expect(transform).toHaveBeenCalledWith(effective);
    } finally {
      f.database.close();
    }
  });

  it("manual compression can use the last real tools without starting discovery or changing the frozen prefix", async () => {
    const f = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("openai_responses", "Summary for continuation.")),
    );
    try {
      const source = f.service.messages(f.session.id);
      const tools = [{ name: "fixture_tool", description: "Never execute", parameters: {} }];
      f.service.rememberRequest(
        f.session,
        { ...f.input, messages: source, tools, reasoningLevel: null },
        source,
      );
      const saver = vi.spyOn(TokenSaverService.prototype, "prepareMessages");
      await f.service.prepare({ ...f.input, manual: true, systemPrompt: "", tools: [] });
      const call = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(String(call?.[1]?.body));
      expect(body.instructions).toBe("Test system");
      expect(body.tools).toHaveLength(1);
      expect(body.tool_choice).toBe("none");
      expect(saver).not.toHaveBeenCalled();
    } finally {
      f.database.close();
    }
  });

  it.each([
    "configuration",
    "history",
    "secret",
    "binary",
    "request-size",
    "window-size",
    "system",
    "tools",
    "separate-model",
  ] as const)(
    "uses independent redacted compaction when prepared replay is unsafe or no longer applicable: %s",
    async (reason) => {
      const f = fixture();
      const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
        response("openai_responses", "Independent safe summary preserves constraints."),
      );
      vi.stubGlobal("fetch", fetcher);
      try {
        if (reason === "secret") {
          f.repository.deleteMessagesFromSeq(f.session.id, 3);
          f.append("assistant", "Never repeat fixture-key or sk-fixturelongsecret12345.");
          f.append("user", "Continue after the protected secret.");
        }
        if (reason === "binary") {
          f.repository.deleteMessagesFromSeq(f.session.id, 1);
          f.repository.appendMessage({
            sessionId: f.session.id,
            role: "user",
            parts: [
              { type: "text", text: "Original task with a binary attachment." },
              {
                type: "attachment",
                attachment: {
                  name: "opaque.bin",
                  mimeType: "application/octet-stream",
                  kind: "file",
                  size: 4,
                  dataUrl: "data:application/octet-stream;base64,AQIDBA==",
                },
              },
            ],
          });
          f.append("assistant", "Real evidence. ".repeat(1100));
          f.append("user", "Continue.");
        }
        const source = f.service.messages(f.session.id);
        f.service.rememberRequest(
          f.session,
          {
            ...f.input,
            messages: source,
            reasoningLevel: null,
            systemPrompt:
              reason === "request-size"
                ? "x".repeat(2 * 1024 * 1024)
                : reason === "window-size"
                  ? "Fixed instructions ".repeat(4000)
                  : f.input.systemPrompt,
          },
          source,
        );
        let input = { ...f.input, manual: true };
        if (reason === "configuration") {
          input = {
            ...input,
            session: f.repository.updateSession(f.session.id, { permissionMode: "full_access" }),
          };
        } else if (reason === "history") {
          f.repository.deleteMessagesFromSeq(f.session.id, 1);
          f.append("user", "Replacement goal");
          f.append("assistant", "Rewritten evidence. ".repeat(1100));
          f.append("user", "Continue replacement.");
        } else if (reason === "system") {
          input = { ...input, manual: false, systemPrompt: "Changed system" };
        } else if (reason === "tools") {
          Object.assign(input, {
            manual: false,
            tools: [{ name: "changed", description: "Changed availability", parameters: {} }],
          });
        } else if (reason === "separate-model") {
          const separate = f.addModel("summary-model");
          f.sessionService.update({
            sessionId: f.session.id,
            compactionModel: { mode: "custom", providerId: f.provider.id, modelId: separate.id },
          });
        }
        const original = f.repository.getMessages(f.session.id);
        f.service.recordResponse(input, { inputTokens: 17000, outputTokens: 0 });
        await f.service.prepare(input);
        expect(fetcher).toHaveBeenCalled();
        for (const call of fetcher.mock.calls) {
          const body = JSON.parse(String(call[1].body));
          expect(body.instructions).not.toBe("Test system");
          expect(body.tools).toBeUndefined();
          expect(JSON.stringify(body)).toContain("History fragment");
          expect(JSON.stringify(body)).not.toContain("fixture-key");
          expect(JSON.stringify(body)).not.toContain("sk-fixturelongsecret12345");
        }
        expect(f.repository.getMessages(f.session.id)).toEqual(original);
        expect(f.service.state(f.session.id)?.state).toBe("ready");
      } finally {
        f.database.close();
      }
    },
  );

  it.each([400, 422])(
    "falls back once to same-model segmented summary for incompatible prefix options: %s",
    async (status) => {
      const f = fixture();
      const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
        const body = JSON.parse(String(options.body));
        return body.tool_choice === "none"
          ? new Response(JSON.stringify({ error: { message: "tool_choice none not supported" } }), {
              status,
            })
          : response("openai_responses", "Compatible summary preserves source and constraints.");
      });
      vi.stubGlobal("fetch", fetcher);
      try {
        const source = f.service.messages(f.session.id);
        f.service.rememberRequest(
          f.session,
          {
            ...f.input,
            messages: source,
            tools: [{ name: "read_file", description: "Read", parameters: {} }],
            reasoningLevel: null,
          },
          source,
        );
        await f.service.prepare({ ...f.input, manual: true });
        expect(fetcher).toHaveBeenCalledTimes(2);
        const bodies = fetcher.mock.calls.map((call) => JSON.parse(String(call[1].body)));
        expect(bodies[0].tool_choice).toBe("none");
        expect(bodies[1].tool_choice).toBeUndefined();
        expect(bodies[1].tools).toBeUndefined();
        expect(bodies[1].model).toBe(bodies[0].model);
        expect(JSON.stringify(bodies[1])).toContain("History fragment");
        expect(f.repository.getMessages(f.session.id)).toEqual(source);
        expect(f.service.state(f.session.id)?.state).toBe("ready");
      } finally {
        f.database.close();
      }
    },
  );

  it("does not compatibility-retry authentication failures even if they mention tool_choice", async () => {
    const f = fixture();
    const fetcher = vi.fn(async () => new Response("Forbidden tool_choice", { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    try {
      const source = f.service.messages(f.session.id);
      f.service.rememberRequest(
        f.session,
        { ...f.input, messages: source, reasoningLevel: null },
        source,
      );
      await expect(f.service.prepare({ ...f.input, manual: true })).rejects.toThrow("403");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(f.repository.getMessages(f.session.id)).toEqual(source);
    } finally {
      f.database.close();
    }
  });

  it("rejects tool calls from a replay summary and retries the original history with the backup", async () => {
    const f = fixture();
    const backup = f.addModel("backup");
    f.service.setFallbackModel({ providerId: f.provider.id, modelId: backup.id });
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      return body.model === "current"
        ? new Response(
            'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"forbidden","name":"write_file","arguments":"{}"}}\n\ndata: {"type":"response.completed","response":{}}\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          )
        : response("openai_responses", "Backup preserves real goals and completed evidence.");
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const source = f.service.messages(f.session.id);
      f.service.rememberRequest(
        f.session,
        { ...f.input, messages: source, reasoningLevel: null },
        source,
      );
      await f.service.prepare({ ...f.input, manual: true });
      const [primary, fallback] = fetcher.mock.calls.map((call) =>
        JSON.parse(String(call[1].body)),
      );
      expect(primary.instructions).toBe("Test system");
      expect(JSON.stringify(fallback)).toContain("History fragment");
      expect(JSON.stringify(fallback)).not.toContain("forbidden");
      expect(f.repository.getMessages(f.session.id)).toEqual(source);
      expect(f.service.state(f.session.id)?.state).toBe("ready");
    } finally {
      f.database.close();
    }
  });

  it("groups host snapshots with real boundaries and retains the most recent complete tool step", () => {
    const f = fixture();
    try {
      f.repository.deleteMessagesFromSeq(f.session.id, 1);
      f.append("user", "Continue the same task.");
      const host = new HostContextService(f.repository);
      host.append(f.session.id, { coding: "Coding rules", permissions: "Approval required" });
      let latestCall = "";
      let latestResult = "";
      for (let index = 1; index <= 2; index++) {
        const call = f.repository.appendMessage({
          sessionId: f.session.id,
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              callId: `step-${index}`,
              name: "read_file",
              arguments: '{"path":"notes.txt"}',
              status: "completed",
            },
          ],
        });
        const result = f.repository.appendMessage({
          sessionId: f.session.id,
          role: "tool",
          parts: [
            {
              type: "tool_result",
              callId: `step-${index}`,
              output: `Observed step ${index}`,
              isError: false,
            },
          ],
        });
        host.append(f.session.id, {
          plan: `Plan revision ${index}`,
          diagnostics: `Check ${index}`,
        });
        latestCall = call.id;
        latestResult = result.id;
      }
      const messages = f.service.messages(f.session.id);
      const cut = safeCompactionCut(messages);
      const tail = messages.slice(cut);
      expect(tail.filter((item) => item.seq !== 0).map((item) => item.id)).toEqual([
        latestCall,
        latestResult,
      ]);
      expect(JSON.stringify(tail)).toContain("Plan revision 2");
      expect(JSON.stringify(messages.slice(0, cut))).toContain("Plan revision 1");
    } finally {
      f.database.close();
    }
  });
  it("Token Saver summarizes older completed turns below 85%, retains five turns and accounts summary cost", async () => {
    const f = fixture();
    f.repository.setSetting("plugins.tokenSaver", {
      enabled: true,
      historySummaries: true,
      minimumSummaryTokens: 1024,
      deduplicate: false,
    });
    for (let index = 0; index < 10; index++) {
      f.append("assistant", `Old explanation ${index}. `.repeat(100));
      f.append("user", `New turn ${index}`);
    }
    const history = f.repository.getMessages(f.session.id);
    const tail = history.slice(
      history.findIndex(
        (item) => item.id === history.filter((item) => item.role === "user").at(-5)?.id,
      ),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          "openai_responses",
          "Goals preserved. Decisions retained. Refer to source message IDs for original details.",
        ),
      ),
    );
    try {
      const result = await f.service.prepare({
        ...f.input,
        model: { ...f.model, contextWindow: 1000000 },
      });
      expect(result.slice(-tail.length)).toEqual(tail);
      expect(f.repository.getMessages(f.session.id)).toEqual(history);
      expect(f.repository.getSetting(`tokenSaver.summary.${f.session.id}`)).toMatchObject({
        keptTurns: 5,
      });
      expect(f.repository.getSetting(`tokenSaver.usage.${f.session.id}`)).toMatchObject({
        compaction: { requests: 1, inputTokens: 100, outputTokens: 80 },
      });
    } finally {
      f.database.close();
    }
  });
  it("disabling Token Saver does not trigger proactive summaries below the window threshold", async () => {
    const f = fixture();
    f.repository.setSetting("plugins.tokenSaver", { enabled: false });
    for (let index = 0; index < 20; index++)
      f.append(index % 2 ? "user" : "assistant", "Text ".repeat(100));
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      await f.service.prepare({ ...f.input, model: { ...f.model, contextWindow: 1000000 } });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      f.database.close();
    }
  });
  it("keeps complete redacted retry diagnostics while successfully compacting", async () => {
    const f = fixture();
    f.repository.setSetting("models.retry", { maxRetries: 1 });
    const diagnostic = `${"Temporary upstream failure\n".repeat(200)}api_key=fixture-key\nCOMPACTION_RETRY_TAIL`;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(diagnostic, { status: 503, headers: { "retry-after-ms": "0" } }),
      )
      .mockResolvedValueOnce(
        response("openai_responses", "Recovered summary preserving goals and verified evidence."),
      );
    vi.stubGlobal("fetch", fetcher);
    try {
      const original = f.repository.getMessages(f.session.id);
      const compacted = JSON.stringify(await f.service.prepare({ ...f.input, manual: true }));
      expect(compacted).toContain("Recovered summary");
      expect(fetcher).toHaveBeenCalledTimes(2);
      const retry = f.events.find(
        (event) => event.type === "activity" && event.activity.detail.includes("正在重试压缩模型"),
      );
      expect(retry).toMatchObject({
        activity: {
          detail: expect.stringContaining("COMPACTION_RETRY_TAIL"),
        },
      });
      if (retry?.type !== "activity") throw new Error("Missing compaction retry activity.");
      expect(retry.activity.detail).toContain("api_key=[REDACTED]");
      expect(retry.activity.detail).not.toContain("fixture-key");
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
      expect(f.service.state(f.session.id)?.state).toBe("ready");
    } finally {
      f.database.close();
    }
  });
  it("retries a truncated summary, discards its partial text and keeps the original history", async () => {
    const f = fixture();
    f.repository.setSetting("models.retry", { maxRetries: 5 });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('data: {"type":"response.output_text.delta","delta":"DISCARDED_PARTIAL"}\n\n'),
      )
      .mockResolvedValueOnce(
        response("openai_responses", "Recovered summary preserving goals and verified evidence."),
      );
    vi.stubGlobal("fetch", fetcher);
    try {
      const original = f.repository.getMessages(f.session.id);
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      const compacted = JSON.stringify(await f.service.prepare(f.input));
      expect(compacted).toContain("Recovered summary");
      expect(compacted).not.toContain("DISCARDED_PARTIAL");
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
      expect(
        f.events.some(
          (event) => event.type === "context_updated" && event.context.notice?.includes("重试"),
        ),
      ).toBe(true);
    } finally {
      f.database.close();
      vi.useRealTimers();
    }
  });
  it("extracts legacy uploaded text attachments before summarizing while preserving original history", async () => {
    const f = fixture();
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
      response("openai_responses", "Preserve uploaded source evidence."),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      const data = Buffer.from("Legacy uploaded code evidence 127");
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "user",
        parts: [
          {
            type: "attachment",
            attachment: {
              name: "evidence.py",
              mimeType: "application/octet-stream",
              kind: "file",
              size: data.length,
              dataUrl: `data:application/octet-stream;base64,${data.toString("base64")}`,
            },
          },
        ],
      });
      f.append("assistant", "Read evidence.");
      f.append("user", "Continue with the evidence.");
      const original = f.repository.getMessages(f.session.id);
      await f.service.prepare({ ...f.input, manual: true });
      expect(fetcher.mock.calls.map((call) => String(call[1].body)).join("\n")).toContain(
        "Legacy uploaded code evidence 127",
      );
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
      expect(f.service.state(f.session.id)?.state).toBe("ready");
    } finally {
      f.database.close();
    }
  });
  it("recalculates manual CTX after a large provider calibration, keeps fixed tooling costs, and restores the lower count", async () => {
    const f = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("openai_responses", "Short verified continuation facts.")),
    );
    try {
      const realInput = {
        ...f.input,
        systemPrompt: "Fixed system and tool instructions. ".repeat(150),
      };
      f.service.recordResponse(realInput, { inputTokens: 18000, outputTokens: 100 });
      const before = f.service.state(f.session.id)?.usedTokens ?? 0;
      const original = f.repository.getMessages(f.session.id);
      await f.service.prepare({ ...f.input, systemPrompt: "", tools: [], manual: true });
      const after = f.service.state(f.session.id);
      expect(after?.usedTokens).toBeLessThan(before * 0.6);
      expect(after?.usedTokens).toBeGreaterThan(500);
      expect(after?.source).toBe("estimate");
      expect(f.repository.getSetting(`context.observation.${f.session.id}`)).toBeNull();
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
      const restarted = new ContextCompactionService(
        f.repository,
        f.providers,
        `${process.cwd()}/resources/prompts`,
        () => {},
      );
      expect((await restarted.restore(f.session.id))?.usedTokens).toBe(after?.usedTokens);
      f.append("user", "Continue from the saved short summary.");
      await f.service.prepare({ ...realInput, runId: "after-summary" });
      f.service.recordResponse(realInput, { inputTokens: 1500, outputTokens: 100 });
      expect(f.service.state(f.session.id)?.usedTokens).toBeLessThan(before);
    } finally {
      f.database.close();
    }
  });

  it("does not let a legacy pre-summary observation restore the full old token count", async () => {
    const f = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("openai_responses", "Short verified facts.")),
    );
    try {
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      const old = f.repository.getSetting(`context.observation.${f.session.id}`);
      await f.service.prepare(f.input);
      f.repository.setSetting(`context.observation.${f.session.id}`, old);
      await f.service.prepare({ ...f.input, runId: "new-run" });
      expect(f.service.state(f.session.id)?.usedTokens).toBeLessThan(17000);
    } finally {
      f.database.close();
    }
  });
  it("manually compacts below 85% without deleting messages or running tools", async () => {
    const f = fixture();
    const fetcher = vi.fn(async () =>
      response("openai_responses", "Summary of earlier facts and constraints."),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      const original = f.repository.getMessages(f.session.id);
      await f.service.prepare(f.input);
      expect(fetcher).not.toHaveBeenCalled();
      f.service.recordResponse(f.input, { inputTokens: 10000, outputTokens: 100 });
      const before = f.service.state(f.session.id)?.usedTokens;
      const compacted = await f.service.prepare({ ...f.input, manual: true });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(JSON.stringify(compacted)).toContain("CURRENT_USER_INSTRUCTION");
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
      expect(
        f.events.find(
          (event) => event.type === "context_updated" && event.context.state === "compacting",
        ),
      ).toMatchObject({ context: { usedTokens: before, source: "estimate" } });
      expect(
        f.events.some(
          (event) => event.type === "activity" && event.activity.title === "正在手动压缩上下文",
        ),
      ).toBe(true);
    } finally {
      f.database.close();
    }
  });
  it("manual failures reject visibly and preserve earlier checkpoints and originals", async () => {
    const f = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("openai_responses", "")),
    );
    try {
      const original = f.repository.getMessages(f.session.id);
      await expect(f.service.prepare({ ...f.input, manual: true })).rejects.toThrow("有效摘要");
      expect(f.repository.getMessages(f.session.id)).toEqual(original);
      expect(f.service.state(f.session.id)?.state).toBe("failed");
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toBeNull();
    } finally {
      f.database.close();
    }
  });
  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "triggers at exactly 85%%, uses current model, persists summary and preserves all history: %s",
    async (protocol) => {
      const f = fixture(protocol);
      const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
        response(protocol, "Goal and constraints preserved. Continue the remaining task."),
      );
      vi.stubGlobal("fetch", fetcher);
      try {
        const original = f.repository.getMessages(f.session.id);
        f.service.recordResponse(f.input, { inputTokens: 16999, outputTokens: 0 });
        await f.service.prepare(f.input);
        expect(fetcher).not.toHaveBeenCalled();
        f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
        const messages = await f.service.prepare(f.input);
        expect(fetcher).toHaveBeenCalledOnce();
        expect(JSON.stringify(messages)).toContain("CURRENT_USER_INSTRUCTION");
        expect(JSON.stringify(messages)).toContain("Goal and constraints preserved");
        expect(f.repository.getMessages(f.session.id)).toEqual(original);
        expect(f.service.state(f.session.id)?.usedTokens).toBeLessThan(17000);
        expect(f.service.state(f.session.id)?.lastCompactedAt).toBeTruthy();
        const body = JSON.parse(String(fetcher.mock.calls[0]?.[1].body));
        expect(body.model).toBe("current");
        expect(body.tools).toBeUndefined();
        await f.service.prepare(f.input);
        expect(fetcher).toHaveBeenCalledOnce();
        const restarted = new ContextCompactionService(
          f.repository,
          f.providers,
          `${process.cwd()}/resources/prompts`,
          () => {},
        );
        expect(restarted.messages(f.session.id)).toEqual(messages);
        expect(
          f.events.some(
            (event) => event.type === "context_updated" && event.context.state === "compacting",
          ),
        ).toBe(true);
      } finally {
        f.database.close();
      }
    },
  );

  it("resolves session override, explicit current and global default", async () => {
    const f = fixture();
    const global = f.addModel("global");
    const custom = f.addModel("custom");
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
      response("openai_responses", "Short summary with constraints."),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      f.service.setGlobalModel({ providerId: f.provider.id, modelId: global.id });
      for (const [choice, expected] of [
        [{ mode: "default", providerId: null, modelId: null }, "global"],
        [{ mode: "custom", providerId: f.provider.id, modelId: custom.id }, "custom"],
        [{ mode: "current", providerId: null, modelId: null }, "current"],
      ] as const) {
        f.repository.removeSetting(`context.checkpoint.${f.session.id}`);
        f.sessionService.update({ sessionId: f.session.id, compactionModel: choice });
        f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
        await f.service.prepare(f.input);
        const body = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1].body));
        expect(body.model).toBe(expected);
      }
      const inherited = f.sessionService.createInWorkspace(null);
      expect(inherited.compactionModel?.mode).toBe("current");
      f.service.setGlobalModel(null);
      expect(f.service.globalModel()).toBeNull();
      expect(() =>
        f.service.setGlobalModel({ providerId: f.provider.id, modelId: "missing" }),
      ).toThrow("不存在");
      expect(() =>
        f.sessionService.update({
          sessionId: f.session.id,
          compactionModel: { mode: "custom", providerId: f.provider.id, modelId: "missing" },
        }),
      ).toThrow("不存在");
    } finally {
      f.database.close();
    }
  });

  it("uses the separate provider's protocol and credential and reports missing overrides without fallback", async () => {
    const f = fixture();
    const separate = f.repository.insertProvider({
      name: "Separate summary provider",
      baseUrl: "https://summary.invalid/v1",
      protocol: "anthropic_messages",
      authMode: "x_api_key",
      customHeaderName: null,
    });
    f.repository.insertModel({
      providerId: separate.id,
      modelId: "summary-only",
      displayName: "Summary only",
      contextWindow: 40000,
      maxOutputTokens: 2048,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: false,
      parallelToolCalls: false,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
    });
    const summaryModel = f.repository.getProvider(separate.id)?.models[0];
    if (!summaryModel) throw new Error("Missing fixture model");
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
      response("anthropic_messages", "Cross-provider summary of goals and results."),
    );
    vi.stubGlobal("fetch", fetcher);
    const key = vi.spyOn(f.providers, "getActiveApiKey").mockReturnValue("summary-fixture-key");
    try {
      f.sessionService.update({
        sessionId: f.session.id,
        compactionModel: { mode: "custom", providerId: separate.id, modelId: summaryModel.id },
      });
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      await f.service.prepare(f.input);
      expect(key).toHaveBeenCalledWith(separate.id);
      expect(fetcher.mock.calls[0]?.[0]).toBe("https://summary.invalid/v1/messages");
      expect(fetcher.mock.calls[0]?.[1].headers).toMatchObject({
        "x-api-key": "summary-fixture-key",
      });
      expect(JSON.parse(String(fetcher.mock.calls[0]?.[1].body)).model).toBe("summary-only");
      f.repository.removeSetting(`context.checkpoint.${f.session.id}`);
      f.repository.deleteProvider(separate.id);
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      await f.service.prepare({ ...f.input, runId: "deleted-override" });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(f.service.state(f.session.id)).toMatchObject({
        state: "failed",
        error: expect.stringContaining("不存在"),
      });
    } finally {
      f.database.close();
    }
  });

  it("preserves complete parallel tool groups and the current user instruction during long single-turn work", async () => {
    const f = fixture();
    try {
      const user = f.repository.getMessages(f.session.id).at(-1);
      if (!user) throw new Error("Missing user");
      f.repository.deleteMessagesFromSeq(f.session.id, user.seq);
      const append = (role: SessionMessage["role"], parts: MessagePart[]) =>
        f.repository.appendMessage({ sessionId: f.session.id, role, parts });
      append("assistant", [
        { type: "tool_call", name: "read_file", callId: "a", arguments: "{}", status: "pending" },
        { type: "tool_call", name: "read_file", callId: "b", arguments: "{}", status: "pending" },
      ]);
      append("tool", [{ type: "tool_result", callId: "a", output: "Evidence A", isError: false }]);
      expect(safeCompactionCut(f.repository.getMessages(f.session.id))).toBe(2);
      append("tool", [{ type: "tool_result", callId: "b", output: "Evidence B", isError: false }]);
      append("assistant", [
        { type: "tool_call", name: "read_file", callId: "c", arguments: "{}", status: "pending" },
      ]);
      append("tool", [
        { type: "tool_result", callId: "c", output: "Current evidence", isError: false },
      ]);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          response("openai_responses", "Preserve original constraints and evidence A/B."),
        ),
      );
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      const compacted = await f.service.prepare(f.input);
      const parts = compacted.flatMap((message) => message.parts);
      expect(parts.some((part) => part.type === "tool_call" && part.callId === "c")).toBe(true);
      expect(parts.some((part) => part.type === "tool_result" && part.callId === "c")).toBe(true);
      expect(parts.some((part) => part.type === "tool_result" && part.callId === "a")).toBe(false);
      expect(JSON.stringify(compacted)).toContain("Original goal");
    } finally {
      f.database.close();
    }
  });

  it("chunks oversized history for a smaller compaction model without silently truncating it", async () => {
    const f = fixture();
    const small = f.addModel("small", 5000);
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
      response("openai_responses", "Merged goal and all known facts."),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      f.sessionService.update({
        sessionId: f.session.id,
        compactionModel: { mode: "custom", providerId: f.provider.id, modelId: small.id },
      });
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      await f.service.prepare(f.input);
      expect(fetcher.mock.calls.length).toBeGreaterThan(1);
      for (const call of fetcher.mock.calls) {
        const body = JSON.parse(String(call[1].body));
        expect(body.model).toBe("small");
        expect(body.max_output_tokens).toBeLessThanOrEqual(small.maxOutputTokens);
      }
      expect(f.service.state(f.session.id)?.state).toBe("ready");
    } finally {
      f.database.close();
    }
  });

  it("retains originals on failure, suppresses repeat retries in one run, retries next run, and invalidates rewind summaries", async () => {
    const f = fixture();
    const fetcher = vi.fn(async () => new Response("Fixture unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    try {
      const original = f.repository.getMessages(f.session.id);
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      expect(await f.service.prepare(f.input)).toEqual(original);
      expect(f.service.state(f.session.id)).toMatchObject({
        state: "failed",
        error: expect.stringContaining("503"),
      });
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toBeNull();
      await f.service.prepare(f.input);
      expect(fetcher).toHaveBeenCalledOnce();
      fetcher.mockImplementation(async () => response("openai_responses", "Valid short summary."));
      await f.service.prepare({ ...f.input, runId: "retry" });
      expect(f.service.state(f.session.id)?.lastCompactedAt).toBeTruthy();
      f.repository.deleteMessagesFromSeq(f.session.id, 1);
      f.append("user", "Replacement goal");
      expect(f.service.messages(f.session.id)).toHaveLength(1);
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toBeNull();
      f.repository.removeSession(f.session.id);
      expect(f.repository.getSetting(`context.view.${f.session.id}`)).toBeNull();
    } finally {
      f.database.close();
    }
  });

  it("does not save a partial summary on stop, exposes active state after reload, and deduplicates prepare calls", async () => {
    const f = fixture();
    const controller = new AbortController();
    let started!: () => void;
    const startedPromise = new Promise<void>((done) => {
      started = done;
    });
    const fetcher = vi.fn(async (_url, options: RequestInit) => {
      started();
      return await new Promise<Response>((_resolve, reject) =>
        options.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
          once: true,
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      const pending = f.service.prepare({ ...f.input, signal: controller.signal });
      expect(f.service.prepare(f.input)).toBe(pending);
      const failure = expect(pending).rejects.toThrow();
      await startedPromise;
      expect(f.service.state(f.session.id)?.state).toBe("compacting");
      controller.abort();
      await failure;
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toBeNull();
      expect(f.repository.getMessages(f.session.id)).toHaveLength(3);
    } finally {
      f.database.close();
    }
  });

  it("compacts further completed steps when the most recent turn is itself too large", async () => {
    const f = fixture();
    try {
      f.append("assistant", "Completed recent evidence. ".repeat(2000));
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            name: "read_file",
            callId: "large",
            arguments: "{}",
            status: "pending",
          },
        ],
      });
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "tool",
        parts: [
          { type: "tool_result", callId: "large", output: "Latest evidence", isError: false },
        ],
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          response("openai_responses", "A compact account of all evidence and constraints."),
        ),
      );
      const compacted = await f.service.prepare(f.input);
      expect(JSON.stringify(compacted)).toContain("CURRENT_USER_INSTRUCTION");
      expect(
        compacted
          .flatMap((message) => message.parts)
          .some((part) => part.type === "tool_call" && part.callId === "large"),
      ).toBe(true);
      expect(
        compacted
          .flatMap((message) => message.parts)
          .some((part) => part.type === "tool_result" && part.callId === "large"),
      ).toBe(true);
      expect(f.service.state(f.session.id)?.usedTokens).toBeLessThan(17000);
    } finally {
      f.database.close();
    }
  });

  it("rejects empty, tool-calling and nonshrinking summaries without replacing a valid checkpoint", async () => {
    const f = fixture();
    const fetcher = vi.fn(async () => response("openai_responses", "A valid short summary."));
    vi.stubGlobal("fetch", fetcher);
    try {
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      await f.service.prepare(f.input);
      const checkpoint = f.repository.getSetting(`context.checkpoint.${f.session.id}`);
      f.append("assistant", "New real evidence. ".repeat(1500));
      f.append("user", "CURRENT_FOLLOWUP");
      for (const [index, kind] of ["empty", "tool", "huge"].entries()) {
        fetcher.mockImplementation(async () =>
          kind === "tool"
            ? new Response(
                'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"forbidden","name":"run_command","arguments":"{}"}}\n\ndata: {"type":"response.completed","response":{}}\n\n',
                { headers: { "Content-Type": "text/event-stream" } },
              )
            : response(
                "openai_responses",
                kind === "empty" ? "" : "An oversized repetitive summary. ".repeat(2000),
              ),
        );
        const input = { ...f.input, runId: `failure-${index}` };
        f.service.recordResponse(input, { inputTokens: 17000, outputTokens: 0 });
        const messages = await f.service.prepare(input);
        expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toEqual(checkpoint);
        expect(JSON.stringify(messages)).toContain("CURRENT_FOLLOWUP");
        expect(f.service.state(f.session.id)?.state).toBe("failed");
      }
    } finally {
      f.database.close();
    }
  });

  it("does not submit an oversized unsummarizable current input and does not reuse another model's usage", async () => {
    const f = fixture();
    const fetcher = vi.fn(async () => response("openai_responses", "Short summary."));
    vi.stubGlobal("fetch", fetcher);
    try {
      f.service.recordResponse(f.input, { inputTokens: 19000, outputTokens: 100 });
      const other = f.addModel("larger", 100000);
      await f.service.prepare({ ...f.input, model: other });
      expect(fetcher).not.toHaveBeenCalled();
      f.repository.deleteMessagesFromSeq(f.session.id, 1);
      f.append("user", "Unreducible original input. ".repeat(5000));
      await expect(f.service.prepare({ ...f.input, runId: "oversized" })).rejects.toThrow("上下文");
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toBeNull();
      expect(f.service.state(f.session.id)?.state).toBe("failed");
    } finally {
      f.database.close();
    }
  });

  it("uses wire-relevant content for estimates and ignores UI-only reasoning and diff data", () => {
    const f = fixture();
    try {
      const base = f.service.messages(f.session.id);
      const before = estimateModelInputTokens({ ...f.input, messages: base });
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "assistant",
        parts: [{ type: "reasoning", text: "private reasoning ".repeat(10000) }],
      });
      expect(
        estimateModelInputTokens({ ...f.input, messages: f.service.messages(f.session.id) }),
      ).toBe(before);
      expect(
        estimateModelInputTokens({
          ...f.input,
          systemPrompt: "large system ".repeat(10000),
          messages: base,
        }),
      ).toBeGreaterThan(before);
    } finally {
      f.database.close();
    }
  });

  it.each(["network", "empty", "tool", "nonshrinking", "error-payload"])(
    "restarts compaction with the backup after %s, preserving the same history and the primary failure",
    async (failure) => {
      const f = fixture();
      const backup = f.addModel("backup");
      const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
        const body = JSON.parse(String(options.body));
        if (body.model === "current") {
          if (failure === "network") throw new Error("Upstream HTTP/2 stream failed");
          if (failure === "tool")
            return new Response(
              'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"forbidden","name":"write_file","arguments":"{}"}}\n\ndata: {"type":"response.completed","response":{}}\n\n',
              { headers: { "Content-Type": "text/event-stream" } },
            );
          if (failure === "error-payload")
            return response(
              "openai_responses",
              '{"message":"Upstream HTTP/2 stream failed","type":"upstream_error"}',
            );
          return response(
            "openai_responses",
            failure === "empty" ? "" : "Oversized summary. ".repeat(5000),
          );
        }
        return response(
          "openai_responses",
          "Backup preserves goals, constraints and verified evidence.",
        );
      });
      vi.stubGlobal("fetch", fetcher);
      try {
        expect(() =>
          f.service.setGlobalModel({ providerId: f.provider.id, modelId: backup.id }),
        ).not.toThrow();
        f.service.setGlobalModel(null);
        f.service.setFallbackModel({ providerId: f.provider.id, modelId: backup.id });
        const original = f.repository.getMessages(f.session.id);
        f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
        const compacted = await f.service.prepare(f.input);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(compacted)).toContain("Backup preserves goals");
        expect(JSON.stringify(compacted)).toContain("CURRENT_USER_INSTRUCTION");
        expect(f.repository.getMessages(f.session.id)).toEqual(original);
        expect(
          f.events.some(
            (event) => event.type === "context_updated" && event.context.notice?.includes("备用"),
          ),
        ).toBe(true);
        expect(
          f.events.some(
            (event) =>
              event.type === "activity" &&
              event.activity.status === "completed" &&
              event.activity.detail.includes("主压缩模型失败"),
          ),
        ).toBe(true);
        expect(f.service.state(f.session.id)?.state).toBe("ready");
      } finally {
        f.database.close();
      }
    },
  );

  it("restarts every history chunk with the backup instead of adopting partial primary summaries", async () => {
    const f = fixture();
    const small = f.addModel("primary-small", 5000);
    const backup = f.addModel("backup-large", 40000);
    let attempts = 0;
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      if (body.model === "primary-small") {
        if (++attempts === 1) return response("openai_responses", "PARTIAL_PRIMARY_FACTS");
        return new Response("Primary chunk failed", { status: 503 });
      }
      expect(JSON.stringify(body.input)).toContain("Original goal");
      expect(JSON.stringify(body.input)).not.toContain("PARTIAL_PRIMARY_FACTS");
      return response(
        "openai_responses",
        "A complete backup summary preserving user goals and constraints.",
      );
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      f.service.setGlobalModel({ providerId: f.provider.id, modelId: small.id });
      f.service.setFallbackModel({ providerId: f.provider.id, modelId: backup.id });
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      await f.service.prepare(f.input);
      expect(attempts).toBe(2);
      expect(f.service.state(f.session.id)?.state).toBe("ready");
      expect(JSON.stringify(f.service.messages(f.session.id))).toContain("complete backup summary");
      expect(() =>
        f.service.setFallbackModel({ providerId: f.provider.id, modelId: small.id }),
      ).toThrow("相同");
      f.service.setFallbackModel(null);
      expect(f.service.fallbackModel()).toBeNull();
    } finally {
      f.database.close();
    }
  });

  it("keeps both errors when compaction fails twice and does not launch the backup on Stop", async () => {
    const f = fixture();
    const backup = f.addModel("backup");
    const fetcher = vi.fn(
      async (_url: string, options: RequestInit) =>
        new Response(
          String(options.body).includes('"model":"current"')
            ? "primary unavailable"
            : "backup unavailable",
          { status: 503 },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      f.service.setFallbackModel({ providerId: f.provider.id, modelId: backup.id });
      f.service.recordResponse(f.input, { inputTokens: 17000, outputTokens: 0 });
      const originals = f.repository.getMessages(f.session.id);
      expect(await f.service.prepare(f.input)).toEqual(originals);
      expect(f.service.state(f.session.id)?.error).toContain("primary unavailable");
      expect(f.service.state(f.session.id)?.error).toContain("backup unavailable");
      expect(recordRuntimeError).toHaveBeenCalledWith(
        "compaction.model",
        expect.any(Error),
        expect.objectContaining({
          sessionId: f.session.id,
          attempt: "primary",
          modelId: f.model.id,
        }),
        expect.any(Array),
      );
      expect(recordRuntimeError).toHaveBeenCalledWith(
        "compaction.model",
        expect.any(Error),
        expect.objectContaining({
          sessionId: f.session.id,
          attempt: "fallback",
          modelId: backup.id,
        }),
        expect.any(Array),
      );
      expect(f.repository.getSetting(`context.checkpoint.${f.session.id}`)).toBeNull();
      fetcher.mockClear();
      const stop = new AbortController();
      fetcher.mockImplementation(async () => {
        stop.abort();
        throw new Error("Stopped");
      });
      await expect(
        f.service.prepare({ ...f.input, runId: "stop", signal: stop.signal }),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      f.database.close();
    }
  });
});
