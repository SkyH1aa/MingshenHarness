import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent, SessionView, ToolResultImage } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { streamModelTurn } from "../providers/model-stream";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import type { ToolExecutionResult } from "../tools/tool-registry";
import { ChatService } from "./chat-service";

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const image: ToolResultImage = {
  dataUrl:
    "data:" +
    "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  mimeType: "image/png",
  alt: "Captured page",
};

function fixture(vision: boolean) {
  const db = openDatabase(":memory:");
  cleanups.push(() => db.close());
  const repository = new Repository(db);
  repository.setSetting("models.retry", { maxRetries: 0 });
  const provider = repository.insertProvider({
    name: "Tool image fixture",
    baseUrl: "https://fixture.invalid/v1",
    protocol: "openai_responses",
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "image-fixture",
    displayName: "Image fixture",
    contextWindow: 100000,
    maxOutputTokens: 2048,
    inputModalities: vision ? ["text", "image"] : ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: true,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository.getProvider(provider.id)?.models[0];
  if (!model) throw new Error("Missing image fixture model");
  repository.saveAgentProfile({
    id: "image-reader",
    name: "Image reader",
    description: "Tool image fixture",
    role: "primary",
    instructions: "",
    modelId: null,
    enabled: true,
    readOnly: false,
  });
  const session = repository.insertSession({
    title: "Image fixture",
    providerId: provider.id,
    modelId: model.id,
    agentProfileId: "image-reader",
    workspacePath: null,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
  });
  const events: ChatStreamEvent[] = [];
  const browserExecute = vi.fn(async () => ({
    output: "Screenshot saved to a local path.",
    isError: false,
    images: [{ ...image }],
  }));
  const chat = new ChatService({
    appVersion: "1.3.0",
    promptDirectory: `${process.cwd()}/resources/prompts`,
    repository,
    permissions: new PermissionStore(),
    browserService: { execute: browserExecute },
    toolRegistry: { descriptors: () => [] },
    providerService: { getActiveApiKey: () => "local-fixture" },
    extensionService: {
      buildSessionContext: async () => ({ skills: [], mcpServers: [], text: "" }),
    },
    projectInstructionService: { discover: async () => [] },
    mcpService: {
      list: () => [],
      enabledServerNames: () => [],
      toolDefinitions: async () => [],
    },
    customToolService: { has: async () => false, list: async () => [] },
    dockerService: { getImage: () => null },
    emit: (event: ChatStreamEvent) => events.push(event),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    executeRun(input: object): Promise<void>;
    executeToolCall(input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      toolCall: { index: number; name: string; callId: string; arguments: string };
    }): Promise<ToolExecutionResult>;
    persistToolResult(
      sessionId: string,
      runId: string,
      callId: string,
      result: ToolExecutionResult,
    ): void;
  };
  return { repository, provider, model, session, events, browserExecute, internal };
}

describe("ChatService tool image persistence and model replay", () => {
  it("does not mark a response containing only opaque native state as a completed answer", async () => {
    const f = fixture(true);
    f.repository.appendMessage({
      sessionId: f.session.id,
      role: "user",
      parts: [{ type: "text", text: "Give an actual answer." }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `data: ${JSON.stringify({
              type: "response.completed",
              response: {
                status: "completed",
                output: [
                  { type: "reasoning", encrypted_content: "opaque-without-answer", summary: [] },
                ],
              },
            })}\n\n`,
          ),
      ),
    );
    await f.internal.executeRun({
      session: f.session,
      provider: f.provider,
      model: f.model,
      runId: randomUUID(),
      signal: new AbortController().signal,
      generateTitle: false,
    });
    expect(f.events.filter((event) => event.type === "run_completed")).toEqual([]);
    expect(f.events.filter((event) => event.type === "run_failed")).toEqual([
      expect.objectContaining({ error: expect.stringContaining("模型没有返回可显示内容") }),
    ]);
    expect(f.repository.getSession(f.session.id)?.status).toBe("error");
  });

  it.each([true, false])(
    "routes a browser capture into persisted history and the next request, vision=%s",
    async (vision) => {
      const f = fixture(vision);
      const controller = new AbortController();
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "user",
        parts: [{ type: "text", text: "Inspect this page." }],
      });
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            callId: "screenshot-call",
            name: "browser_screenshot",
            arguments: "{}",
            status: "pending",
          },
        ],
      });
      const result = await f.internal.executeToolCall({
        session: f.session,
        runId: "run",
        signal: controller.signal,
        toolCall: {
          index: 0,
          name: "browser_screenshot",
          callId: "screenshot-call",
          arguments: "{}",
        },
      });
      expect(result.isError).toBe(false);
      expect(f.browserExecute).toHaveBeenCalledExactlyOnceWith(
        f.session.id,
        "browser_screenshot",
        {},
        controller.signal,
      );
      f.internal.persistToolResult(f.session.id, "run", "screenshot-call", result);
      const saved = f.repository.getMessages(f.session.id).at(-1);
      const part = saved?.parts[0];
      if (part?.type !== "tool_result") throw new Error("Missing persisted screenshot result");
      expect(part.callId).toBe("screenshot-call");
      if (vision) expect(part.images).toEqual([image]);
      else {
        expect(part.images).toBeUndefined();
        expect(part.output).toContain("图片未发送给模型");
      }
      expect(f.events.at(-1)).toMatchObject({
        type: "assistant_message",
        message: { id: saved?.id, parts: [part] },
      });

      let wire: Record<string, unknown> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init: RequestInit) => {
          wire = JSON.parse(String(init.body));
          return new Response(
            `data: ${JSON.stringify({
              type: "response.completed",
              response: { status: "completed", output: [] },
            })}\n\n`,
          );
        }),
      );
      for await (const _event of streamModelTurn({
        provider: f.provider,
        model: f.model,
        apiKey: "local-fixture",
        systemPrompt: "Interpret only actual image input.",
        messages: f.repository.getMessages(f.session.id),
        tools: [],
        reasoningLevel: null,
        signal: controller.signal,
      })) {
        // Draining the stream exercises the actual request serializer.
      }
      const toolOutput = (wire.input as Array<Record<string, unknown>>).find(
        (item) => item.type === "function_call_output",
      );
      if (vision)
        expect(toolOutput?.output).toEqual(
          expect.arrayContaining([
            { type: "input_image", image_url: image.dataUrl, detail: "high" },
          ]),
        );
      else {
        expect(typeof toolOutput?.output).toBe("string");
        expect(JSON.stringify(wire)).not.toContain(image.dataUrl);
      }
    },
  );
});
