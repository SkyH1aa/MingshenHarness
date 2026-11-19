import { describe, expect, it, vi } from "vitest";
import type { ModelConfig, QuestionRequest, SessionView } from "../../shared/domain";
import { ApprovalBroker } from "../permissions/approval-broker";
import { PermissionStore } from "../permissions/permission-store";
import { QuestionBroker } from "../permissions/question-broker";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ToolRegistry } from "../tools/tool-registry";
import { ChatService } from "./chat-service";

function fixture(permissionMode: SessionView["permissionMode"] = "request_approval") {
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  const questionWaiters: Array<(request: QuestionRequest) => void> = [];
  const broker = new QuestionBroker(undefined, (state) => {
    const request = state.requests[0];
    if (!request) return;
    for (let index = questionWaiters.length - 1; index >= 0; index -= 1) {
      questionWaiters.splice(index, 1)[0]?.(request);
    }
  });
  const approvals = new ApprovalBroker();
  const session = repository.insertSession({
    title: "Question test",
    providerId: null,
    modelId: null,
    agentProfileId: "primary",
    workspacePath: null,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode,
    executionMode: "host",
    patchOnly: false,
  });
  const chat = new ChatService({
    repository,
    questionBroker: broker,
    approvalBroker: approvals,
    permissions: new PermissionStore(),
    toolRegistry: new ToolRegistry(),
    customToolService: { descriptors: async () => [] },
    mcpService: { list: () => [], toolDefinitions: async () => [] },
    emit: vi.fn(),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    executeToolCall: (input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      toolCall: { index: number; callId: string; name: string; arguments: string };
    }) => Promise<{ output: string; isError: boolean }>;
    availableTools: (session: SessionView, model: ModelConfig) => Promise<Array<{ name: string }>>;
  };
  const ask = (args: object, signal = new AbortController().signal) =>
    internal.executeToolCall({
      session,
      runId: "run",
      signal,
      toolCall: { index: 0, callId: "call", name: "ask_user", arguments: JSON.stringify(args) },
    });
  const waitForQuestion = (): Promise<QuestionRequest> => {
    const current = broker.list()[0];
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => questionWaiters.push(resolve));
  };
  return {
    database,
    repository,
    broker,
    approvals,
    session,
    chat,
    internal,
    ask,
    waitForQuestion,
  };
}

describe("Agent clarification lifecycle", () => {
  it.each(["request_approval", "full_access"] as const)(
    "waits for real answers in %s, returns structured results and does not grant permissions",
    async (mode) => {
      const f = fixture(mode);
      try {
        const pending = f.ask({
          questions: [
            {
              id: "scope",
              header: "Scope",
              question: "Which tasks?",
              multi_select: true,
              options: [
                { label: "Test", description: "Run tests." },
                { label: "Build", description: "Build the app." },
              ],
            },
          ],
        });
        const request = await f.waitForQuestion();
        expect(request.questions?.[0]?.multiSelect).toBe(true);
        expect(f.repository.getSession(f.session.id)?.status).toBe("waiting_approval");
        expect(f.approvals.state().requests).toEqual([]);
        f.broker.answer({
          questionId: request.id,
          answers: [{ id: "scope", selectedOptions: ["Test", "Build"], otherText: "Document it" }],
        });
        const result = await pending;
        expect(result.isError).toBe(false);
        expect(JSON.parse(result.output)).toEqual({
          status: "answered",
          answers: [
            {
              id: "scope",
              question: "Which tasks?",
              selected_options: ["Test", "Build"],
              other: "Document it",
            },
          ],
        });
        expect(f.repository.getSession(f.session.id)?.permissionMode).toBe(mode);
        expect(f.repository.getSession(f.session.id)?.status).toBe("running");
      } finally {
        f.database.close();
      }
    },
  );
  it("rejects malformed questions before entering a wait and cancels unanswered questions", async () => {
    const f = fixture();
    try {
      const invalid = await f.ask({
        questions: [
          {
            question: "Choose",
            options: Array.from({ length: 5 }, (_, n) => ({
              label: `${n}`,
              description: "Choice",
            })),
          },
        ],
      });
      expect(invalid.isError).toBe(true);
      expect(f.broker.list()).toEqual([]);
      expect(f.repository.getSession(f.session.id)?.status).toBe("idle");
      const controller = new AbortController();
      const pending = f.ask({ question: "Need more context?", options: [] }, controller.signal);
      const rejected = expect(pending).rejects.toThrow("取消");
      await f.waitForQuestion();
      f.chat.stop(f.session.id);
      await rejected;
      expect(f.broker.list()).toEqual([]);
      expect(f.repository.getSession(f.session.id)?.status).toBe("running");
    } finally {
      f.database.close();
    }
  });
  it("exposes clarification to all defaults including Plan, honors explicit disabling and model capability", async () => {
    const f = fixture();
    try {
      for (const profile of f.repository.listAgentProfiles()) {
        const tools = await f.internal.availableTools(
          { ...f.session, agentProfileId: profile.id },
          { toolCalls: true } as ModelConfig,
        );
        expect(tools.map((tool) => tool.name)).toContain("ask_user");
      }
      expect(
        await f.internal.availableTools(f.session, { toolCalls: false } as ModelConfig),
      ).toEqual([]);
      expect(
        (
          await f.internal.availableTools({ ...f.session, parentSessionId: "parent" }, {
            toolCalls: true,
          } as ModelConfig)
        ).map((tool) => tool.name),
      ).not.toContain("ask_user");
      const profile = f.repository.getAgentProfile("primary");
      if (!profile) throw new Error("Missing profile");
      f.repository.saveAgentProfile({ ...profile, permissions: { question: "deny" } });
      const blocked = await f.ask({ question: "Choose?", options: [] });
      expect(blocked.isError).toBe(true);
      expect(f.broker.list()).toEqual([]);
      expect(
        (await f.internal.availableTools(f.session, { toolCalls: true } as ModelConfig)).map(
          (tool) => tool.name,
        ),
      ).not.toContain("ask_user");
    } finally {
      f.database.close();
    }
  });
});
