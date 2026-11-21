import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionMessage } from "../../shared/domain";
import {
  DEFAULT_TOKEN_SAVER_SETTINGS as defaults,
  normalizeTokenSaverSettings,
  tokenSaverSettingsSchema,
} from "../../shared/token-saver";
import { streamModelTurn } from "../providers/model-stream";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import {
  compactStructuredText,
  compressInput,
  historySummaryCut,
  importance,
} from "./input-compressor";
import {
  codingPromptNeeded,
  RECALL_CONTEXT_TOOL,
  TokenSaverService,
  tokenSaverPrompt,
} from "./token-saver-service";
import { usageRecorder } from "./usage";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) db.close();
});
function message(seq: number, role: SessionMessage["role"], text: string): SessionMessage {
  return {
    id: `m${seq}`,
    seq,
    role,
    sessionId: "test",
    parts: [{ type: "text", text }],
    createdAt: "2026-11-07T00:00:00Z",
  };
}
function history() {
  return Array.from({ length: 14 }, (_, index) => [
    message(index * 2 + 1, "user", `Task ${index}`),
    message(index * 2 + 2, "assistant", `Explanation ${"ordinary prose ".repeat(350)}`),
  ]).flat();
}
function fixture() {
  const db = openDatabase(":memory:");
  databases.push(db);
  const repository = new Repository(db);
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
    contextWindow: 128000,
    maxOutputTokens: 2048,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository.getProvider(provider.id)?.models[0];
  if (!model) throw new Error("Missing fixture model");
  const session = repository.insertSession({
    title: "Fixture",
    providerId: provider.id,
    modelId: model.id,
    workspacePath: null,
    agentProfileId: "mingshen",
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
  return { repository, session, provider, model, service: new TokenSaverService(repository) };
}

describe("Token Saver request transformations", () => {
  it("has conservative defaults and rejects invalid or ambiguous settings", () => {
    expect(normalizeTokenSaverSettings(null)).toEqual(defaults);
    expect(defaults.keepRecentTurns).toBe(5);
    expect(defaults.historySummaries).toBe(false);
    expect(defaults.outputMode).toBe("auto");
    expect([defaults.filterHistory, defaults.codeOutlines, defaults.trimToolResults]).toEqual([
      false,
      false,
      false,
    ]);
    expect(tokenSaverSettingsSchema.safeParse({ ...defaults, keepRecentTurns: 12 }).success).toBe(
      false,
    );
    expect(tokenSaverSettingsSchema.safeParse({ ...defaults, surprise: true }).success).toBe(false);
  });
  it("leaves all recent five turns and original objects untouched", () => {
    const messages = history();
    const original = JSON.stringify(messages);
    const result = compressInput(messages, defaults, true);
    expect(result.messages.slice(-10)).toEqual(messages.slice(-10));
    expect(result.changes.some((change) => change.strategy === "duplicate")).toBe(true);
    expect(JSON.stringify(messages)).toBe(original);
    expect(compressInput(messages, { ...defaults, enabled: false }, true).messages).toBe(messages);
  });
  it("retains the original duplicate target even if relevance filtering is enabled", () => {
    const messages = history();
    const result = compressInput(messages, { ...defaults, filterHistory: true }, true);
    expect(result.messages[1]).toEqual(messages[1]);
    const reference = result.messages[3]?.parts[0];
    expect(reference).toMatchObject({ type: "text", text: expect.stringContaining("m2") });
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
    expect(result.changes.every((change) => change.afterTokens < change.beforeTokens)).toBe(true);
  });
  it("does not count synthetic diagnostics or a saved summary as user turns", () => {
    const messages = history();
    const tail = messages.slice(-10);
    messages.unshift(message(0, "user", "Earlier summary"));
    messages.push(message(0, "user", "New diagnostics"));
    const result = compressInput(messages, { ...defaults, filterHistory: true }, true);
    expect(result.messages.slice(-11, -1)).toEqual(tail);
    const belowThreshold = history().slice(0, 22);
    belowThreshold.unshift(message(0, "user", "Earlier summary"));
    belowThreshold.push(message(0, "user", "New diagnostics"));
    expect(historySummaryCut(belowThreshold, defaults)).toBe(0);
  });
  it("does not rewrite tool arguments, errors, constraints, attachments or summary messages", () => {
    const messages = history();
    messages[0] = { ...message(0, "assistant", "SUMMARY ".repeat(1000)) };
    messages[1] = {
      ...message(2, "assistant", ""),
      parts: [
        {
          type: "tool_call",
          callId: "read",
          name: "read_file",
          arguments: '{"path":"src/a.ts"}',
          status: "completed",
        },
        { type: "text", text: "large text ".repeat(2000) },
      ],
    };
    messages[2] = {
      ...message(3, "tool", ""),
      parts: [
        {
          type: "tool_result",
          callId: "read",
          output: "ERROR: preserve exact evidence ".repeat(1000),
          isError: true,
        },
      ],
    };
    messages[3] = message(4, "assistant", "Must preserve security constraint. ".repeat(300));
    const result = compressInput(
      messages,
      { ...defaults, filterHistory: true, trimToolResults: true, codeOutlines: true },
      true,
    );
    expect(result.messages.slice(0, 4)).toEqual(messages.slice(0, 4));
    expect(importance(messages[3])).toBe("high");
  });
  it("only excerpts prose with recall available and retains all old user instructions", () => {
    const messages = history();
    messages[1] = message(2, "assistant", "Unrelated historical explanation. ".repeat(300));
    messages[2] = message(3, "user", "Keep this user requirement exactly. ".repeat(200));
    const settings = { ...defaults, deduplicate: false, filterHistory: true };
    expect(compressInput(messages, settings, false).messages[1]).toEqual(messages[1]);
    const result = compressInput(messages, settings, true);
    expect(JSON.stringify(result.messages[1])).toContain("recall_context");
    expect(result.messages[2]).toEqual(messages[2]);
  });
  it("preserves native state text and image-result text under every input transformation", () => {
    const messages = history();
    const text = `{\n  "evidence": "${"unrelated evidence ".repeat(350)}"\n}`;
    messages[1] = {
      ...message(2, "assistant", text),
      parts: [
        { type: "text", text },
        {
          type: "responses_state",
          providerId: "provider",
          modelId: "model",
          endpointKey: "fixture-endpoint",
          items: [
            {
              type: "message",
              role: "assistant",
              phase: "commentary",
              content: [{ type: "output_text", text, annotations: [] }],
            },
          ],
        },
      ],
    };
    messages[3] = message(4, "assistant", text);
    messages[5] = {
      ...message(6, "tool", ""),
      parts: [
        { type: "text", text },
        {
          type: "tool_result",
          callId: "image",
          output: text,
          isError: false,
          images: [{ mimeType: "image/png", dataUrl: "fixture-image-bytes" }],
        },
      ],
    };
    const result = compressInput(
      messages,
      { ...defaults, filterHistory: true, trimToolResults: true, codeOutlines: true },
      true,
    );
    expect(result.messages[1]).toEqual(messages[1]);
    expect(result.messages[5]).toEqual(messages[5]);
    expect(result.changes.some((change) => ["m2", "m6"].includes(change.messageId))).toBe(false);
    expect(result.messages[3]).not.toEqual(messages[3]);
  });
  it("minifies JSON without changing large integers, strings, escapes or negative zero", () => {
    const json = '{\n  "n": 900719925474099312345,\n  "v": " a  b \\\\" ,\n  "minus": -0\n}';
    const compact = compactStructuredText(json);
    expect(compact).toBe('{"n":900719925474099312345,"v":" a  b \\\\","minus":-0}');
    expect(compactStructuredText('{"a":1,"a":2}')).toBe('{"a":1,"a":2}');
  });
  it.each([
    "a: &x [1, 2]\nb: *x",
    "1: yes\n",
    "? [a, b]\n: value",
    "a: 9007199254740993",
    "a: .inf",
    "# important comment\na: 1",
    "a: |\n  preserve\n  lines",
    "a: 1\na: 2",
    "a: !custom value",
    "a: -0",
    "a: 0.12345678901234567890123456789",
  ])("keeps unsafe YAML verbatim: %s", (yaml) => {
    expect(compactStructuredText(yaml, "yaml")).toBe(yaml);
  });
  it("can compact safely convertible YAML and leaves invalid input unchanged", () => {
    const yaml = "title:     hello\nitems:\n  - alpha\n  - beta\n";
    expect(JSON.parse(compactStructuredText(yaml, "yaml"))).toEqual({
      title: "hello",
      items: ["alpha", "beta"],
    });
    expect(compactStructuredText("{ broken")).toBe("{ broken");
  });
  it("uses the bundled AST only on opted-in older assistant code and includes recall", () => {
    const messages = history();
    const code = `export function calculate(value: number): number {\n${"  console.log(value);\n".repeat(250)}return value + 1;\n}`;
    messages[1] = message(2, "assistant", `\`\`\`ts\n${code}\n\`\`\``);
    const result = compressInput(messages, { ...defaults, codeOutlines: true }, true);
    expect(JSON.stringify(result.messages[1])).toContain("Historical outline");
    expect(JSON.stringify(result.messages[1])).toContain("return value + 1");
    expect(JSON.stringify(result.messages[1])).toContain("recall_context");
    expect(compressInput(messages, defaults, true).messages[1]).toEqual(messages[1]);
  });
  it("uses completed tool boundaries for proactive summaries and respects thresholds", () => {
    const messages = history();
    const enabled = { ...defaults, historySummaries: true };
    expect(historySummaryCut(messages, defaults)).toBe(0);
    expect(historySummaryCut(messages, enabled)).toBe(18);
    expect(historySummaryCut(messages.slice(0, 10), enabled)).toBe(0);
    messages[1]?.parts.push({
      type: "tool_call",
      callId: "pending",
      name: "read_file",
      arguments: "{}",
      status: "pending",
    });
    expect(historySummaryCut(messages, enabled)).toBe(0);
    messages[2]?.parts.push({
      type: "tool_result",
      callId: "pending",
      output: "ok",
      isError: false,
    });
    expect(historySummaryCut(messages, enabled)).toBe(18);
    expect(historySummaryCut(messages, { ...enabled, enabled: false })).toBe(0);
  });
  it("does not treat opaque state and image bytes as text when testing the summary threshold", () => {
    const messages = history().map((item) => ({
      ...item,
      parts: [{ type: "text" as const, text: `Short ${item.seq}` }],
    })) as SessionMessage[];
    messages[1]?.parts.push({
      type: "responses_state",
      providerId: "provider",
      modelId: "model",
      endpointKey: "fixture-endpoint",
      items: [{ type: "reasoning", encrypted_content: "opaque".repeat(100000) }],
    });
    messages[3]?.parts.push({
      type: "tool_result",
      callId: "image",
      output: "Image inspected",
      isError: false,
      images: [{ mimeType: "image/png", dataUrl: `fixture:${"A".repeat(500000)}` }],
    });
    const enabled = { ...defaults, historySummaries: true };
    expect(historySummaryCut(messages, enabled)).toBe(0);
    messages[5] = message(6, "assistant", "Actual visible explanation. ".repeat(400));
    expect(historySummaryCut(messages, enabled)).toBe(18);
  });
  it("respects detailed requests and retains the coding/safety prompt for uncertain tasks", () => {
    expect(tokenSaverPrompt(defaults, "请给出详细实现")).toBe(tokenSaverPrompt(defaults, "你好"));
    expect(tokenSaverPrompt(defaults, "请给出详细实现")).toContain("explicit request for detail");
    expect(tokenSaverPrompt(defaults, "你好")).toContain("response=auto");
    expect(tokenSaverPrompt({ ...defaults, enabled: false }, "Hello")).toBe("");
    expect(codingPromptNeeded("修复仓库")).toBe(true);
    expect(codingPromptNeeded("Translate this code")).toBe(true);
    expect(codingPromptNeeded("你好")).toBe(false);
  });

  it("uses quality-first defaults only for missing fields and preserves explicit choices", () => {
    expect(normalizeTokenSaverSettings({ enabled: true }).historySummaries).toBe(false);
    expect(normalizeTokenSaverSettings({ enabled: true }).outputMode).toBe("auto");
    expect(
      normalizeTokenSaverSettings({ enabled: true, historySummaries: true, outputMode: "minimal" }),
    ).toMatchObject({ historySummaries: true, outputMode: "minimal" });
  });
});

describe("Token Saver persistence, recall and accounting", () => {
  it("does not write or replace an existing opt-in while loading settings", () => {
    const f = fixture();
    expect(f.service.settings()).toMatchObject({ historySummaries: false, outputMode: "auto" });
    expect(f.repository.getSetting("plugins.tokenSaver")).toBeNull();
    const configured = { ...defaults, historySummaries: true, outputMode: "minimal" as const };
    f.service.configure(configured);
    const restarted = new TokenSaverService(f.repository);
    expect(restarted.settings()).toEqual(configured);
    expect(f.repository.getSetting("plugins.tokenSaver")).toEqual(configured);
  });

  it("records only estimated request changes without modifying stored history", () => {
    const f = fixture();
    for (const item of history())
      f.repository.appendMessage({ sessionId: f.session.id, role: item.role, parts: item.parts });
    const original = f.repository.getMessages(f.session.id);
    const result = f.service.prepare({
      ...f,
      sessionId: f.session.id,
      runId: "run",
      systemPrompt: "Keep safety.",
      tools: [RECALL_CONTEXT_TOOL],
      messages: original,
    });
    expect(result.report.savedTokens).toBeGreaterThan(0);
    expect(result.report.beforeTokens - result.report.afterTokens).toBe(result.report.savedTokens);
    expect(f.repository.getMessages(f.session.id)).toEqual(original);
    expect(f.service.snapshot(f.session.id).report).toEqual(result.report);
    f.repository.deleteMessagesFromSeq(f.session.id, 10);
    expect(f.service.snapshot(f.session.id).report).toBeNull();
  });
  it("paginates long single-line originals completely and rejects cross-session access", () => {
    const f = fixture();
    const text = "0123456789".repeat(4000);
    const item = f.repository.appendMessage({
      sessionId: f.session.id,
      role: "assistant",
      parts: [{ type: "text", text }],
    });
    let result = "";
    let offset: number | null = 0;
    while (offset !== null) {
      const page = JSON.parse(
        f.service.recall(f.session.id, { message_id: item.id, char_offset: offset }),
      );
      result += page.content;
      offset = page.next_char_offset;
    }
    expect(result).toBe(text);
    expect(() => f.service.recall("other", { message_id: item.id })).toThrow("not found");
    expect(() =>
      f.service.recall(f.session.id, { message_id: item.id, char_offset: -1 }),
    ).toThrow();
  });
  it("counts partial, missing, failed and ancillary usage without inventing values", () => {
    const f = fixture();
    usageRecorder(
      f.repository,
      f.session.id,
      "approval",
    )({
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      completed: true,
    });
    usageRecorder(
      f.repository,
      f.session.id,
      "compaction",
    )({
      inputTokens: null,
      outputTokens: 4,
      totalTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      completed: false,
    });
    usageRecorder(
      f.repository,
      f.session.id,
      "agent",
    )({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      completed: false,
    });
    expect(f.service.snapshot(f.session.id).usage).toMatchObject({
      approval: { requests: 1, totalTokens: 12, unmeasuredRequests: 0, partialRequests: 0 },
      compaction: { totalTokens: 4, partialRequests: 1, failedRequests: 1 },
      agent: { totalTokens: 0, unmeasuredRequests: 1, failedRequests: 1 },
    });
    f.repository.deleteMessagesFromSeq(f.session.id, 1);
    expect(f.service.snapshot(f.session.id).usage.approval?.totalTokens).toBe(12);
    f.repository.removeSession(f.session.id);
    expect(f.repository.getSetting(`tokenSaver.usage.${f.session.id}`)).toBeNull();
  });
  it("measures cache coverage separately from unknown and legacy usage", () => {
    const f = fixture();
    f.repository.setSetting(`tokenSaver.usage.${f.session.id}`, {
      agent: {
        requests: 1,
        inputTokens: 1000,
        outputTokens: 10,
        totalTokens: 1010,
        unmeasuredRequests: 0,
        partialRequests: 0,
        failedRequests: 0,
      },
    });
    const record = usageRecorder(f.repository, f.session.id, "agent");
    const measured = {
      inputTokens: 100,
      outputTokens: 3,
      totalTokens: 103,
      cachedInputTokens: 80,
      cacheCreationInputTokens: 10,
      completed: true,
    };
    record(measured);
    record({ ...measured, cachedInputTokens: 0, cacheCreationInputTokens: 0 });
    record({ ...measured, cachedInputTokens: null, cacheCreationInputTokens: null });
    record({
      ...measured,
      inputTokens: null,
      totalTokens: null,
      cacheCreationInputTokens: null,
      completed: false,
    });
    const usage = f.service.snapshot(f.session.id).usage.agent;
    expect(usage).toMatchObject({
      requests: 5,
      inputTokens: 1300,
      cachedInputTokens: 80,
      cacheCreationInputTokens: 10,
      cacheMeasuredRequests: 2,
      cacheMeasuredInputTokens: 200,
      cacheCreationMeasuredRequests: 2,
      partialRequests: 1,
      failedRequests: 1,
    });
    expect((usage?.cachedInputTokens ?? 0) / (usage?.cacheMeasuredInputTokens ?? 1)).toBe(0.4);
  });
  it("resolves inherited citations to local copies across forks without reading another conversation", () => {
    const f = fixture();
    const source = f.repository.appendMessage({
      sessionId: f.session.id,
      role: "assistant",
      parts: [{ type: "text", text: "Original evidence in copied history." }],
    });
    const first = f.repository.forkSession(f.session.id);
    const second = f.repository.forkSession(first.id);
    f.repository.removeSession(f.session.id);
    expect(JSON.parse(f.service.recall(second.id, { message_id: source.id })).content).toBe(
      "Original evidence in copied history.",
    );
    expect(f.service.snapshot(second.id).usage).toEqual({});
    const other = fixture();
    const foreign = other.repository.appendMessage({
      sessionId: other.session.id,
      role: "user",
      parts: [{ type: "text", text: "Foreign data" }],
    });
    expect(() => f.service.recall(second.id, { message_id: foreign.id })).toThrow("not found");
    f.repository.deleteMessagesFromSeq(second.id, 1);
    expect(() => f.service.recall(second.id, { message_id: source.id })).toThrow("not found");
    f.repository.removeSession(second.id);
    expect(f.repository.getSetting(`tokenSaver.aliases.${second.id}`)).toBeNull();
  });
  it("records each completed transport attempt once", async () => {
    const f = fixture();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":11,"output_tokens":3}}}\n\n',
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    for await (const _event of streamModelTurn({
      ...f,
      apiKey: "fixture",
      systemPrompt: "",
      messages: [],
      tools: [],
      reasoningLevel: null,
      signal: new AbortController().signal,
      onRequestUsage: usageRecorder(f.repository, f.session.id, "agent"),
    })) {
      /* Consume the real SSE parser. */
    }
    expect(f.service.snapshot(f.session.id).usage.agent).toMatchObject({
      requests: 1,
      inputTokens: 11,
      outputTokens: 3,
      totalTokens: 14,
      failedRequests: 0,
    });
  });
  it("includes usage from a failed stream and its successful retry without double counting frames", async () => {
    const f = fixture();
    const partial =
      'data: {"choices":[{"delta":{"content":"partial"}}],"usage":{"prompt_tokens":9,"completion_tokens":2,"total_tokens":11,"prompt_tokens_details":{"cached_tokens":6}}}\n\n';
    const completed = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(partial))
        .mockResolvedValueOnce(new Response(`${partial}${completed}data: [DONE]\n\n`)),
    );
    for await (const _event of streamModelTurn({
      ...f,
      provider: { ...f.provider, protocol: "openai_chat_completions" },
      apiKey: "fixture",
      systemPrompt: "",
      messages: [],
      tools: [],
      reasoningLevel: null,
      signal: new AbortController().signal,
      retry: { maxRetries: 1, onRetry: () => undefined },
      onRequestUsage: usageRecorder(f.repository, f.session.id, "agent"),
    })) {
      /* Consume both transport attempts. */
    }
    expect(f.service.snapshot(f.session.id).usage.agent).toMatchObject({
      requests: 2,
      inputTokens: 18,
      outputTokens: 4,
      totalTokens: 22,
      failedRequests: 1,
      cachedInputTokens: 12,
      cacheMeasuredRequests: 2,
      cacheMeasuredInputTokens: 18,
    });
  });
});
