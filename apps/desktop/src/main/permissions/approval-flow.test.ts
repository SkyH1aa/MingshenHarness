import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest, ChatStreamEvent, SessionView } from "../../shared/domain";
import { ChatService } from "../chat/chat-service";
import { SessionService } from "../sessions/session-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { isDangerousCommand, ToolRegistry } from "../tools/tool-registry";
import { ApprovalBroker } from "./approval-broker";
import { AutomaticApprovalService } from "./automatic-approval-service";
import { PermissionStore } from "./permission-store";
import { QuestionBroker } from "./question-broker";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  const events: ChatStreamEvent[] = [];
  const broker = new ApprovalBroker((state) => events.push({ type: "approval_state", state }));
  const sessions = new SessionService(repository);
  const provider = repository.insertProvider({
    name: "Local",
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
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const modelId = repository.getProvider(provider.id)?.models[0]?.id as string;
  const config = {
    providerId: provider.id,
    modelId,
    workspacePath: "C:\\Fixture",
    permissionMode: "request_approval" as const,
    reasoningLevel: null,
  };
  const session = sessions.create(config);
  const questionBroker = new QuestionBroker();
  const chat = new ChatService({
    repository,
    providerService: { getActiveApiKey: () => "fixture" },
    approvalBroker: broker,
    questionBroker,
    permissions: new PermissionStore(),
    toolRegistry: new ToolRegistry(),
    customToolService: { has: async () => false },
    dockerService: { getImage: () => null },
    emit: (event: ChatStreamEvent) => events.push(event),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const request = (id: string, sessionId = session.id): ApprovalRequest => ({
    id,
    sessionId,
    runId: "run",
    toolCallId: id,
    toolName: "run_command",
    summary: "Read",
    detail: "Get-Content notes.txt",
    pathScope: null,
    commandPrefix: "Get-Content notes.txt",
    risk: "normal",
    createdAt: new Date().toISOString(),
  });
  const internal = chat as unknown as {
    requestApproval: (request: ApprovalRequest, signal: AbortSignal) => Promise<unknown>;
    executeToolCall: (input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      toolCall: { name: string; arguments: string; callId: string; index: number };
    }) => Promise<{ isError: boolean; output: string }>;
  };
  return {
    database,
    repository,
    events,
    broker,
    sessions,
    config,
    session,
    chat,
    request,
    internal,
    questionBroker,
  };
}

describe("live approval flow", () => {
  it("keeps waiting while any approval or question is still pending in the same session", async () => {
    const f = fixture();
    try {
      const internal = f.chat as unknown as {
        askUser: (
          session: SessionView,
          runId: string,
          signal: AbortSignal,
          args: Record<string, unknown>,
        ) => Promise<unknown>;
      };
      const signal = new AbortController().signal;
      const first = f.internal.requestApproval(f.request("first"), signal);
      const second = f.internal.requestApproval(f.request("second"), signal);
      const question = internal.askUser(f.session, "run", signal, { question: "Continue?" });
      f.chat.decideApproval({ approvalId: "first", decision: "allow_session" });
      await first;
      expect(f.repository.getSession(f.session.id)?.status).toBe("waiting_approval");
      const questionId = f.questionBroker.list()[0]?.id as string;
      f.questionBroker.answer({ questionId, answer: "Yes" });
      await question;
      expect(f.repository.getSession(f.session.id)?.status).toBe("waiting_approval");
      f.chat.decideApproval({ approvalId: "second", decision: "deny" });
      await second;
      expect(f.repository.getSession(f.session.id)?.status).toBe("running");
      const remaining = internal.askUser(f.session, "run", signal, { question: "Another?" });
      const approval = f.internal.requestApproval(f.request("last"), signal);
      f.chat.decideApproval({ approvalId: "last", decision: "allow_once" });
      await approval;
      expect(f.repository.getSession(f.session.id)?.status).toBe("waiting_approval");
      f.questionBroker.answer({
        questionId: f.questionBroker.list()[0]?.id as string,
        answer: "Yes",
      });
      await remaining;
      expect(f.repository.getSession(f.session.id)?.status).toBe("running");
    } finally {
      f.database.close();
    }
  });
  it("registers before emitting, restores running after cancellation and never loses the next approval", async () => {
    const f = fixture();
    try {
      const signal = new AbortController();
      const first = f.internal.requestApproval(f.request("a"), signal.signal);
      expect(f.broker.state().requests[0]?.id).toBe("a");
      f.chat.decideApproval({ approvalId: "a", decision: "allow_session" });
      await first;
      const second = f.internal.requestApproval(f.request("b"), signal.signal);
      f.chat.decideApproval({ approvalId: "a", decision: "allow_session" });
      expect(f.broker.state().requests[0]?.id).toBe("b");
      const failure = expect(second).rejects.toThrow("取消");
      signal.abort();
      await failure;
      expect(f.repository.getSession(f.session.id)?.status).toBe("running");
      expect(f.broker.state().requests).toEqual([]);
    } finally {
      f.database.close();
    }
  });
  it("upgrades the entire project immediately, inherits into new conversations and retains hard protection", async () => {
    const f = fixture();
    try {
      const other = f.sessions.create({ ...f.config, workspacePath: "c:/Fixture/" });
      const unrelated = f.sessions.create({ ...f.config, workspacePath: "C:\\Other" });
      const child = f.repository.insertSession({
        title: "Isolated child",
        parentSessionId: f.session.id,
        providerId: f.config.providerId,
        modelId: f.config.modelId,
        agentProfileId: "general",
        workspacePath: "C:\\IsolatedWorktree",
        systemPrompt: "",
        reasoningLevel: null,
        permissionMode: "request_approval",
        executionMode: "worktree",
        patchOnly: false,
      });
      const signal = new AbortController().signal;
      const first = f.internal.requestApproval(f.request("a"), signal);
      const second = f.internal.requestApproval(f.request("b", other.id), signal);
      f.chat.decideApproval({ approvalId: "a", decision: "full_access" });
      await Promise.all([first, second]);
      expect(f.repository.getSession(other.id)?.permissionMode).toBe("full_access");
      expect(f.repository.getSession(child.id)?.permissionMode).toBe("full_access");
      expect(f.sessions.create(f.config).permissionMode).toBe("full_access");
      expect(f.repository.getSession(unrelated.id)?.permissionMode).toBe("request_approval");
      await expect(f.internal.requestApproval(f.request("c"), signal)).resolves.toMatchObject({
        decision: "allow_once",
      });
      const blocked = await f.internal.executeToolCall({
        session: f.session,
        runId: "run",
        signal,
        toolCall: {
          name: "run_command",
          callId: "danger",
          index: 0,
          arguments: JSON.stringify({ command: "shutdown /s /t 0" }),
        },
      });
      expect(blocked.isError).toBe(true);
      expect(isDangerousCommand("shutdown /s /t 0")).toBeTruthy();
      expect(f.session.permissionMode).toBe("full_access");
      const hook = f.internal.requestApproval(
        { ...f.request("hook"), toolName: "hook:Stop", manualOnly: true },
        signal,
      );
      expect(f.broker.get("hook")).toBeTruthy();
      expect(() => f.chat.decideApproval({ approvalId: "hook", decision: "full_access" })).toThrow(
        "单独",
      );
      f.chat.decideApproval({ approvalId: "hook", decision: "deny" });
      await hook;
    } finally {
      f.database.close();
    }
  });
  it("blocks unconfigured automatic mode, reviews pending and future operations, and recovers manually on errors", async () => {
    const f = fixture();
    try {
      expect(() => f.chat.startAutomaticApproval(f.session.id)).toThrow("APPROVAL_MODEL_REQUIRED");
      expect(f.repository.getSession(f.session.id)?.approvalMode).toBe("manual");
      f.chat.setApprovalModelSettings({
        providerId: f.config.providerId,
        modelId: f.config.modelId,
      });
      const review = vi
        .spyOn(AutomaticApprovalService.prototype, "review")
        .mockResolvedValue({ allowed: true, reason: "Read only" });
      const signal = new AbortController().signal;
      const pending = f.internal.requestApproval(f.request("first"), signal);
      f.chat.startAutomaticApproval(f.session.id);
      await expect(pending).resolves.toMatchObject({ decision: "allow_once" });
      review.mockResolvedValueOnce({ allowed: false, reason: "Destructive" });
      await expect(f.internal.requestApproval(f.request("denied"), signal)).resolves.toMatchObject({
        decision: "deny",
        feedback: "Destructive",
      });
      review.mockRejectedValueOnce(new Error("HTTP 503"));
      const failed = f.internal.requestApproval(f.request("offline"), signal);
      await vi.waitFor(() =>
        expect(f.broker.get("offline")?.review).toMatchObject({
          state: "manual",
          reason: "HTTP 503",
        }),
      );
      f.chat.decideApproval({ approvalId: "offline", decision: "allow_once" });
      await failed;
      expect(
        f.events.some(
          (event) => event.type === "activity" && event.activity.toolName === "approval_review",
        ),
      ).toBe(true);
    } finally {
      f.database.close();
    }
  });
  it("ignores a late reviewer verdict after switching to manual and never upgrades unrelated blank workspaces", async () => {
    const f = fixture();
    try {
      f.chat.setApprovalModelSettings({
        providerId: f.config.providerId,
        modelId: f.config.modelId,
      });
      let finish!: (review: { allowed: boolean; reason: string }) => void;
      vi.spyOn(AutomaticApprovalService.prototype, "review").mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      f.chat.startAutomaticApproval(f.session.id);
      const pending = f.internal.requestApproval(f.request("late"), new AbortController().signal);
      f.chat.setSessionApprovalMode(f.session.id, "manual");
      finish({ allowed: true, reason: "Late answer" });
      await Promise.resolve();
      expect(f.broker.get("late")).toBeTruthy();
      f.chat.decideApproval({ approvalId: "late", decision: "deny" });
      await expect(pending).resolves.toMatchObject({ decision: "deny" });
      const blank = f.sessions.create({ ...f.config, workspacePath: null });
      const otherBlank = f.sessions.create({ ...f.config, workspacePath: null });
      f.chat.setSessionPermission(blank.id, "full_access");
      expect(f.repository.getSession(otherBlank.id)?.permissionMode).toBe("request_approval");
    } finally {
      f.database.close();
    }
  });

  it("cancels old review verdicts when reviewer settings are cleared", async () => {
    const f = fixture();
    try {
      f.chat.setApprovalModelSettings({
        providerId: f.config.providerId,
        modelId: f.config.modelId,
      });
      let finish!: (review: { allowed: boolean; reason: string }) => void;
      const review = vi.spyOn(AutomaticApprovalService.prototype, "review").mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      f.chat.startAutomaticApproval(f.session.id);
      const pending = f.internal.requestApproval(
        f.request("changed-model"),
        new AbortController().signal,
      );
      f.chat.setApprovalModelSettings({ providerId: null, modelId: null });
      finish({ allowed: true, reason: "Obsolete reviewer" });
      await Promise.resolve();
      expect(f.broker.get("changed-model")?.review?.state).toBe("manual");
      expect(review).toHaveBeenCalledOnce();
      f.chat.decideApproval({ approvalId: "changed-model", decision: "deny" });
      await expect(pending).resolves.toMatchObject({ decision: "deny" });
    } finally {
      f.database.close();
    }
  });
});
