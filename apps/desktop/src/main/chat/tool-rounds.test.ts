import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TOOL_ROUNDS, toolRoundLimit } from "../../shared/agent-limits";
import type { ChatStreamEvent, SessionView } from "../../shared/domain";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ChatService } from "./chat-service";

const modelStream = vi.hoisted(() => vi.fn());
vi.mock("../providers/model-stream", async (original) => ({
  ...(await original<typeof import("../providers/model-stream")>()),
  streamModelTurn: modelStream,
}));
afterEach(() => vi.clearAllMocks());

describe("tool round limits", () => {
  it("defaults to 750 and preserves configured limits without the previous 64-round clamp", () => {
    expect(DEFAULT_TOOL_ROUNDS).toBe(750);
    expect(toolRoundLimit(null)).toBe(750);
    expect(toolRoundLimit(800)).toBe(800);
    expect(toolRoundLimit(5)).toBe(5);
    expect(toolRoundLimit(Number.NaN)).toBe(750);
    expect(toolRoundLimit(-3)).toBe(1);
    expect(toolRoundLimit(20000)).toBe(10000);
  });

  it.each([
    { limit: null, calls: 750, executed: 750, completed: true },
    { limit: 2, calls: 3, executed: 2, completed: false },
    { limit: 2, calls: 2, executed: 2, completed: true },
  ])(
    "executes bounded real runtime loops: %o",
    async ({ limit, calls, executed, completed }) => {
      const database = openDatabase(":memory:");
      const repository = new Repository(database);
      const events: ChatStreamEvent[] = [];
      const provider = repository.insertProvider({
        name: "Fixture",
        baseUrl: "https://example.com/v1",
        protocol: "openai_responses",
        authMode: "bearer",
        customHeaderName: null,
      });
      repository.insertModel({
        providerId: provider.id,
        modelId: "fixture",
        displayName: "fixture",
        contextWindow: 128000,
        maxOutputTokens: 1024,
        inputModalities: ["text"],
        outputModalities: ["text"],
        toolCalls: true,
        parallelToolCalls: false,
        reasoningLevels: [],
        anthropicNoneBehavior: "disabled",
      });
      const model = repository.getProvider(provider.id)?.models[0];
      if (!model) throw new Error("fixture model missing");
      repository.saveAgentProfile({
        id: "primary",
        name: "Mingshen",
        description: "",
        role: "primary",
        instructions: "",
        modelId: null,
        readOnly: false,
        enabled: true,
        maxSteps: limit,
      });
      const session = repository.insertSession({
        title: "Loop",
        providerId: provider.id,
        modelId: model.id,
        agentProfileId: "primary",
        workspacePath: null,
        systemPrompt: "",
        reasoningLevel: null,
        permissionMode: "full_access",
        executionMode: "host",
        patchOnly: false,
      });
      const chat = new ChatService({
        repository,
        providerService: { getActiveApiKey: () => "local" },
        toolRegistry: {
          hasRunningCommands: () => false,
          commandSessions: () => [],
          cancelRun: async () => undefined,
        },
        mcpService: { list: () => [] },
        emit: (event: ChatStreamEvent) => events.push(event),
      } as unknown as ConstructorParameters<typeof ChatService>[0]);
      const internal = chat as unknown as {
        availableTools: ReturnType<typeof vi.fn>;
        buildSystemPrompt: ReturnType<typeof vi.fn>;
        executeToolCall: ReturnType<typeof vi.fn>;
        executeRun: (input: {
          session: SessionView;
          provider: typeof provider;
          model: typeof model;
          runId: string;
          signal: AbortSignal;
          generateTitle: boolean;
        }) => Promise<void>;
      };
      internal.availableTools = vi.fn(async () => []);
      internal.buildSystemPrompt = vi.fn(async () => "Fixture");
      internal.executeToolCall = vi.fn(async () => ({ output: "done", isError: false }));
      let rounds = 0;
      modelStream.mockImplementation(async function* () {
        rounds++;
        if (rounds <= calls) {
          yield {
            type: "tool_call_started",
            index: 0,
            name: "update_todos",
            callId: `call-${rounds}`,
          };
          yield { type: "tool_call_arguments_delta", index: 0, delta: '{"todos":[]}' };
        } else yield { type: "text_delta", text: "Final verified answer." };
      });
      try {
        await internal.executeRun({
          session,
          provider,
          model,
          runId: "rounds",
          signal: new AbortController().signal,
          generateTitle: false,
        });
        expect(internal.executeToolCall).toHaveBeenCalledTimes(executed);
        expect(events.some((event) => event.type === "run_completed")).toBe(completed);
        if (!completed)
          expect(
            events.some((event) => event.type === "run_failed" && event.error.includes("轮次")),
          ).toBe(true);
        else expect(rounds).toBe(calls + 1);
      } finally {
        database.close();
      }
    },
    120000,
  );
});
