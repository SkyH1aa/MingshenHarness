import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest, ModelConfig, ProviderProtocol } from "../../shared/domain";
import { auxiliaryReasoning } from "../providers/auxiliary-model";
import type { ProviderService } from "../providers/provider-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { AutomaticApprovalService } from "./automatic-approval-service";

afterEach(() => vi.unstubAllGlobals());

function sse(protocol: ProviderProtocol, text: string) {
  const events =
    protocol === "openai_responses"
      ? [
          { type: "response.output_text.delta", delta: text },
          { type: "response.completed", response: {} },
        ]
      : protocol === "anthropic_messages"
        ? [
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

describe("approval protocol failover", () => {
  it("retries the current reviewer after a truncated verdict without combining conflicting decisions", async () => {
    vi.useFakeTimers();
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const provider = repository.insertProvider({
      name: "Review",
      baseUrl: "https://fixture.invalid/v1",
      protocol: "openai_responses",
      authMode: "bearer",
      customHeaderName: null,
    });
    repository.insertModel({
      providerId: provider.id,
      modelId: "review",
      displayName: "Review",
      contextWindow: 32000,
      maxOutputTokens: 1024,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: false,
      parallelToolCalls: false,
      reasoningLevels: [],
      anthropicNoneBehavior: "disabled",
    });
    const service = new AutomaticApprovalService(repository, {
      getActiveApiKey: () => "fixture",
    } as unknown as ProviderService);
    const model = repository.getProvider(provider.id)?.models[0];
    if (!model) throw new Error("Fixture model missing");
    service.configure({
      providerId: provider.id,
      modelId: model.id,
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"response.output_text.delta","delta":"{\\"decision\\":\\"allow\\","}\n\n',
        ),
      )
      .mockResolvedValueOnce(
        sse("openai_responses", '{"decision":"deny","reason":"Scope is not safe."}'),
      );
    vi.stubGlobal("fetch", fetcher);
    const progress = vi.fn();
    try {
      const pending = service.review(
        { sessionId: "s", toolName: "write_file", reviewInput: "{}" } as ApprovalRequest,
        new AbortController().signal,
        progress,
      );
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toMatchObject({
        allowed: false,
        reason: "Scope is not safe.",
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(progress).toHaveBeenCalledWith(expect.stringContaining("重试审批模型（1/5）"));
    } finally {
      database.close();
      vi.useRealTimers();
    }
  });
  it.each([
    ["openai_responses", "anthropic_messages"],
    ["anthropic_messages", "openai_chat_completions"],
    ["openai_chat_completions", "openai_responses"],
    ["gemini_generate_content", "openai_responses"],
    ["openai_responses", "gemini_generate_content"],
  ] as const)(
    "uses separate providers, protocols and credentials from %s to %s",
    async (primaryProtocol, backupProtocol) => {
      const database = openDatabase(":memory:");
      const repository = new Repository(database);
      const add = (name: string, protocol: ProviderProtocol) => {
        const provider = repository.insertProvider({
          name,
          baseUrl: `https://${name}.invalid/v1`,
          protocol,
          authMode: protocol === "gemini_generate_content" ? "x_goog_api_key" : "bearer",
          customHeaderName: null,
        });
        repository.insertModel({
          providerId: provider.id,
          modelId: name,
          displayName: name,
          contextWindow: 32000,
          maxOutputTokens: 4096,
          inputModalities: ["text"],
          outputModalities: ["text"],
          toolCalls: false,
          parallelToolCalls: false,
          reasoningLevels: protocol === "gemini_generate_content" ? ["auto"] : ["none", "low"],
          anthropicNoneBehavior: "disabled",
        });
        return {
          providerId: provider.id,
          modelId: repository.getProvider(provider.id)?.models[0]?.id as string,
        };
      };
      const primary = add("primary", primaryProtocol);
      const backup = add("backup", backupProtocol);
      const key = (id: string) =>
        id === primary.providerId ? "fixture-primary-secret" : "fixture-backup-secret";
      const fetcher = vi.fn(async (url: string, options: RequestInit) => {
        const body = JSON.parse(String(options.body));
        expect(body.tools).toBeUndefined();
        expect(String(options.body)).not.toContain("fixture-primary-secret");
        expect(String(options.body)).not.toContain("fixture-backup-secret");
        expect(
          body.instructions ??
            body.system ??
            body.systemInstruction?.parts[0].text ??
            body.messages[0].content,
        ).toContain('"decision"');
        if (url.includes("primary.invalid")) {
          expect(options.headers).toMatchObject(
            primaryProtocol === "gemini_generate_content"
              ? { "x-goog-api-key": "fixture-primary-secret" }
              : { authorization: "Bearer fixture-primary-secret" },
          );
          return sse(
            primaryProtocol,
            '{"message":"Upstream HTTP/2 stream failed","type":"upstream_error"}',
          );
        }
        expect(options.headers).toMatchObject(
          backupProtocol === "gemini_generate_content"
            ? { "x-goog-api-key": "fixture-backup-secret" }
            : { authorization: "Bearer fixture-backup-secret" },
        );
        return sse(backupProtocol, '{"decision":"deny","reason":"操作範囲を確認できません。"}');
      });
      vi.stubGlobal("fetch", fetcher);
      try {
        const service = new AutomaticApprovalService(repository, {
          getActiveApiKey: key,
        } as unknown as ProviderService);
        service.configure({ ...primary, fallback: backup });
        await expect(
          service.review(
            {
              sessionId: "s",
              toolName: "mcp_process_start",
              detail: "fixture-primary-secret fixture-backup-secret",
              reviewInput: '{"command":"npx -y wikipedia-mcp"}',
            } as ApprovalRequest,
            new AbortController().signal,
          ),
        ).resolves.toMatchObject({
          allowed: false,
          reason: "操作範囲を確認できません。",
          reviewer: "backup / backup",
          previousError: expect.stringContaining("upstream_error"),
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
        const paths: Record<ProviderProtocol, string> = {
          openai_responses: "/responses",
          anthropic_messages: "/messages",
          openai_chat_completions: "/chat/completions",
          gemini_generate_content: "/models/primary:streamGenerateContent?alt=sse",
        };
        expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
          `https://primary.invalid/v1${paths[primaryProtocol]}`,
          `https://backup.invalid/v1${
            backupProtocol === "gemini_generate_content"
              ? "/models/backup:streamGenerateContent?alt=sse"
              : paths[backupProtocol]
          }`,
        ]);
      } finally {
        database.close();
      }
    },
  );

  it("selects a supported low-cost reasoning level without sending an unsupported none", () => {
    const config = {
      reasoningLevels: ["none", "low", "high"],
      anthropicNoneBehavior: "disabled",
    } as ModelConfig;
    expect(auxiliaryReasoning(config)).toBe("none");
    expect(auxiliaryReasoning({ ...config, anthropicNoneBehavior: "reject" })).toBe("low");
    expect(auxiliaryReasoning({ ...config, reasoningLevels: ["high"] })).toBe("high");
    expect(auxiliaryReasoning({ ...config, reasoningLevels: [] })).toBeNull();
  });
});
