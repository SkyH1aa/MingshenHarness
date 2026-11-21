import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest, ChatStreamEvent, SessionView } from "../../shared/domain";
import { AgentProfileService } from "../agents/agent-profile-service";
import { ApprovalBroker } from "../permissions/approval-broker";
import { PermissionStore } from "../permissions/permission-store";
import { QuestionBroker } from "../permissions/question-broker";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import type { ToolExecutionResult } from "../tools/tool-registry";
import { ChatService } from "./chat-service";

function fixture() {
  const db = openDatabase(":memory:");
  const repository = new Repository(db);
  new AgentProfileService(repository);
  const session = repository.insertSession({
    title: "Fixture",
    providerId: null,
    modelId: null,
    agentProfileId: "primary",
    workspacePath: "C:\\Fixture",
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
  const events: ChatStreamEvent[] = [];
  const permissions = new PermissionStore();
  const broker = new ApprovalBroker();
  const tools = vi.fn(async (): Promise<ToolExecutionResult> => ({ output: "ok", isError: false }));
  const confirmRunStopped = vi.fn();
  const registryShutdown = vi.fn(async () => {});
  const questionBroker = new QuestionBroker();
  const custom = { has: async () => false };
  const chat = new ChatService({
    repository,
    permissions,
    approvalBroker: broker,
    questionBroker,
    customToolService: custom,
    dockerService: { getImage: () => null },
    providerService: {},
    toolRegistry: {
      descriptors: () =>
        ["read_file", "list_files", "write_file", "run_command"].map((name) => ({ name })),
      execute: tools,
      confirmRunStopped,
      shutdown: registryShutdown,
    },
    emit: (event: ChatStreamEvent) => events.push(event),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    requestApproval(request: ApprovalRequest, signal: AbortSignal): Promise<unknown>;
    repairInterruptedToolResults(id: string): void;
    executeToolCall(input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      toolCall: { index: number; callId: string; name: string; arguments: string };
    }): Promise<{ output: string; isError: boolean }>;
    runVerification(
      session: SessionView,
      runId: string,
      paths: string[],
      signal: AbortSignal,
      attempt: number,
    ): Promise<string>;
    runHostTool(
      session: SessionView,
      runId: string,
      signal: AbortSignal,
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ output: string; isError: boolean }>;
    runSubagent(
      session: SessionView,
      signal: AbortSignal,
      args: Record<string, unknown>,
    ): Promise<{ output: string; isError: boolean }>;
    fileLocks: import("../workspace/file-lock-service").FileLockService;
    directoryRefreshRequired: Map<string, Set<string>>;
    executionSafety: import("./execution-safety-service").ExecutionSafetyService;
    stopAndWait(id: string): Promise<void>;
    withExternalWriter<T>(
      session: SessionView,
      runId: string,
      signal: AbortSignal,
      execute: () => Promise<T>,
    ): Promise<T>;
  };
  return {
    db,
    repository,
    session,
    events,
    permissions,
    broker,
    tools,
    confirmRunStopped,
    registryShutdown,
    chat,
    internal,
    questionBroker,
  };
}
function request(
  id: string,
  sessionId: string,
  toolName = "read_file",
  path = "C:\\Fixture\\a.ts",
): ApprovalRequest {
  return {
    id,
    sessionId,
    runId: "run",
    toolCallId: id,
    toolName,
    summary: "Read file",
    detail: path,
    pathScope: path,
    commandPrefix: null,
    risk: "normal",
    createdAt: new Date().toISOString(),
  };
}

describe("workbench runtime boundaries", () => {
  it("retains the writer lease and durable recovery barrier when native cleanup is unconfirmed", async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    const runId = "unconfirmed-native-run";
    try {
      f.internal.executionSafety.begin(f.session.id, runId);
      f.tools.mockResolvedValue({
        output: "The sandbox process could not be confirmed stopped.",
        isError: true,
        cleanupUnconfirmed: true,
      });
      const result = await f.internal.executeToolCall({
        session: f.session,
        runId,
        signal,
        toolCall: {
          index: 0,
          callId: "unconfirmed-command",
          name: "run_command",
          arguments: JSON.stringify({ command: "Write-Output 'task'" }),
        },
      });
      expect(result, result.output).toMatchObject({ isError: true, cleanupUnconfirmed: true });
      expect(f.internal.executionSafety.inspect(runId)).toMatchObject({ resolved: false });
      await expect(
        f.internal.fileLocks.acquire(
          [f.session.workspacePath as string],
          true,
          { sessionId: "another-session", runId: "another-run", label: "Another writer" },
          signal,
          async () => false,
        ),
      ).rejects.toThrow("Writer retained");
      f.internal.executionSafety.finish(runId);
      f.internal.executionSafety.begin(f.session.id, "next-run");
      const blocked = await f.internal.executeToolCall({
        session: f.session,
        runId: "next-run",
        signal,
        toolCall: {
          index: 0,
          callId: "next-write",
          name: "write_file",
          arguments: JSON.stringify({ path: "file.txt", content: "blocked" }),
        },
      });
      expect(blocked.output).toContain("RECOVERY_INSPECTION_REQUIRED");
      expect(f.tools).toHaveBeenCalledOnce();
      await f.internal.executeToolCall({
        session: f.session,
        runId: "next-run",
        signal,
        toolCall: {
          index: 0,
          callId: "failed-recovery-read",
          name: "read_file",
          arguments: JSON.stringify({ path: "file.txt" }),
        },
      });
      f.tools.mockResolvedValue({ output: "Inspected current files.", isError: false });
      expect(
        (
          await f.internal.executeToolCall({
            session: f.session,
            runId: "next-run",
            signal,
            toolCall: {
              index: 0,
              callId: "recovery-read",
              name: "read_file",
              arguments: JSON.stringify({ path: "file.txt" }),
            },
          })
        ).isError,
      ).toBe(false);
      const recovery = f.internal.executeToolCall({
        session: f.session,
        runId: "next-run",
        signal,
        toolCall: {
          index: 0,
          callId: "recover-command",
          name: "resolve_interrupted",
          arguments: JSON.stringify({
            evidence_call_ids: ["recovery-read"],
            summary: "Inspected files and confirmed the affected process tree stopped.",
          }),
        },
      });
      await vi.waitFor(() => expect(f.questionBroker.list()).toHaveLength(1));
      expect(f.confirmRunStopped).not.toHaveBeenCalled();
      f.questionBroker.answer({
        questionId: f.questionBroker.list()[0]?.id as string,
        answers: [{ id: "recovery", selectedOptions: ["继续执行"], otherText: "" }],
      });
      expect(await recovery).toMatchObject({ isError: false });
      expect(f.confirmRunStopped).toHaveBeenCalledWith(runId);
      const release = await f.internal.fileLocks.acquire(
        [f.session.workspacePath as string],
        true,
        { sessionId: "another-session", runId: "another-run", label: "Recovered writer" },
        signal,
        async () => false,
      );
      release();
      expect(
        (
          await f.internal.executeToolCall({
            session: f.session,
            runId: "next-run",
            signal,
            toolCall: {
              index: 0,
              callId: "recovered-write",
              name: "write_file",
              arguments: JSON.stringify({ path: "file.txt", content: "allowed" }),
            },
          })
        ).isError,
      ).toBe(false);
    } finally {
      f.internal.fileLocks.releaseRun(runId);
      f.db.close();
    }
  });
  it("releases the command lease after a confirmed ordinary failure", async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    try {
      f.tools.mockResolvedValue({ output: "exit_code: 1", isError: true });
      await f.internal.executeToolCall({
        session: f.session,
        runId: "confirmed-native-run",
        signal,
        toolCall: {
          index: 0,
          callId: "failed-command",
          name: "run_command",
          arguments: JSON.stringify({ command: "Write-Output 'task'" }),
        },
      });
      expect(f.tools).toHaveBeenCalledOnce();
      const release = await f.internal.fileLocks.acquire(
        [f.session.workspacePath as string],
        true,
        { sessionId: "next-session", runId: "next-run", label: "Next writer" },
        signal,
        async () => false,
      );
      release();
    } finally {
      f.db.close();
    }
  });
  it("starts host tool activities after persisting their source call despite checkpoint storage delay", async () => {
    const f = fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T00:00:00.000Z"));
    try {
      const append = f.repository.appendMessage.bind(f.repository);
      vi.spyOn(f.repository, "appendMessage").mockImplementation((input) => {
        vi.setSystemTime(Date.now() + 15);
        return append(input);
      });
      vi.spyOn(f.internal, "executeToolCall").mockResolvedValue({
        output: "FULL_HOST_TOOL_OUTPUT",
        isError: false,
      });
      await f.internal.runHostTool(
        f.session,
        "host-tool-run",
        new AbortController().signal,
        "write_stdin",
        { session_id: "owned-command", chars: "", yield_time_ms: 1000 },
      );
      const messages = f.repository.getMessages(f.session.id);
      const call = messages.find((message) =>
        message.parts.some((part) => part.type === "tool_call"),
      );
      expect(call).toBeDefined();
      const activities = f.events.flatMap((event) =>
        event.type === "activity" ? [event.activity] : [],
      );
      expect(activities).toHaveLength(2);
      for (const activity of activities) {
        expect(Date.parse(activity.startedAt)).toBeGreaterThanOrEqual(
          Date.parse(call?.createdAt ?? ""),
        );
      }
      expect(messages.at(-1)?.parts).toEqual([
        expect.objectContaining({ type: "tool_result", output: "FULL_HOST_TOOL_OUTPUT" }),
      ]);
    } finally {
      vi.useRealTimers();
      f.db.close();
    }
  });
  it.each([
    { output: "cleanup status unknown", isError: true, cleanupUnconfirmed: true },
    { output: "COMMAND_CLEANUP_UNCONFIRMED: process still unknown", isError: true },
    {
      output: "command still running",
      isError: false,
      commandSession: { id: "running", running: true, unreadOutputChars: 0 },
    },
  ] satisfies ToolExecutionResult[])(
    "preserves an uncertain host-tool checkpoint for $output",
    async (result) => {
      const f = fixture();
      try {
        f.chat.workbench.checkpoint(f.session.id, {
          runId: "host-run",
          state: "running",
          updatedAt: "",
          lastSafeTool: "read_file",
          lastSafeCallId: "prior-safe",
          completedTools: 2,
          uncertainTools: [],
        });
        vi.spyOn(f.internal, "executeToolCall").mockResolvedValue(result);
        await f.internal.runHostTool(
          f.session,
          "host-run",
          new AbortController().signal,
          "run_command",
          { command: "Write-Output task" },
        );
        expect(f.chat.workbench.state(f.session.id).checkpoint).toMatchObject({
          completedTools: 2,
          lastSafeTool: "read_file",
          lastSafeCallId: "prior-safe",
          uncertainTools: [expect.objectContaining({ name: "run_command" })],
        });
      } finally {
        f.db.close();
      }
    },
  );
  it("blocks unrelated actions until the current model reviews the previous plan, without granting file permissions", async () => {
    const f = fixture();
    try {
      f.chat.workbench.update({
        sessionId: f.session.id,
        revision: 0,
        paused: true,
        steps: [
          {
            id: "old",
            content: "Old task",
            status: "in_progress",
            priority: "medium",
            updatedAt: "",
          },
        ],
      });
      const plan = f.chat.workbench.prepareTurn(f.session.id);
      const call = (name: string, args: object) =>
        f.internal.executeToolCall({
          session: f.session,
          runId: "review",
          signal: new AbortController().signal,
          toolCall: { index: 0, callId: name, name, arguments: JSON.stringify(args) },
        });
      expect((await call("read_file", { path: "old.txt" })).output).toContain(
        "PLAN_REVIEW_REQUIRED",
      );
      expect(f.tools).not.toHaveBeenCalled();
      expect(
        (
          await call("review_plan", {
            revision: plan.revision - 1,
            action: "discard",
            reason: "Different task",
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await call("review_plan", {
            revision: plan.revision,
            action: "discard",
            reason: "Latest request does not need the old task",
          })
        ).isError,
      ).toBe(false);
      expect(f.chat.workbench.state(f.session.id).plan).toMatchObject({
        steps: [],
        paused: false,
        reviewRequired: false,
      });
      expect((await call("read_file", { path: "new.txt" })).isError).toBe(false);
      expect(f.repository.getSession(f.session.id)?.permissionMode).toBe("request_approval");
    } finally {
      f.db.close();
    }
  });
  it("resumes the same conversation with its latest edited plan, todo statuses and breakpoints", async () => {
    const f = fixture();
    try {
      f.repository.updateSession(f.session.id, { status: "interrupted" });
      const first = f.chat.workbench.update({
        sessionId: f.session.id,
        revision: 0,
        paused: true,
        breakpoints: ["verify"],
        steps: [
          {
            id: "done",
            content: "Already inspected",
            status: "completed",
            priority: "high",
            updatedAt: "",
          },
          {
            id: "continue",
            content: "Continue this task",
            status: "in_progress",
            priority: "medium",
            dependsOn: ["done"],
            updatedAt: "",
          },
          {
            id: "verify",
            content: "Verify changes",
            status: "pending",
            priority: "medium",
            dependsOn: ["continue"],
            updatedAt: "",
          },
        ],
      });
      const edited = f.chat.workbench.update({
        sessionId: f.session.id,
        revision: first.revision,
        steps: first.steps.map((item) =>
          item.id === "continue"
            ? { ...item, content: "User edit saved after interruption" }
            : item,
        ),
      });
      f.chat.workbench.checkpoint(f.session.id, {
        runId: "old",
        state: "interrupted",
        updatedAt: "",
        lastSafeTool: "read_file",
        lastSafeCallId: "confirmed",
        completedTools: 4,
        uncertainTools: [{ name: "write_file", callId: "uncertain", state: "executing" }],
      });
      const send = vi.spyOn(f.chat, "send").mockResolvedValue({ runId: "new" });
      expect(await f.chat.resumeSession(f.session.id)).toEqual({ runId: "new" });
      const input = send.mock.calls[0]?.[0];
      expect(input?.sessionId).toBe(f.session.id);
      expect(input?.text).toContain("User edit saved after interruption");
      expect(input?.text).toContain('"status":"completed"');
      expect(input?.text).toContain('"status":"in_progress"');
      expect(input?.text).toContain('"breakpoints":["verify"]');
      expect(input?.text).toContain("不自动重放");
      const resumed = f.chat.workbench.state(f.session.id);
      expect(resumed.plan).toMatchObject({
        revision: edited.revision + 1,
        paused: false,
        steps: edited.steps.map(({ updatedAt: _time, ...item }) => item),
        breakpoints: ["verify"],
      });
      expect(resumed.checkpoint?.uncertainTools).toEqual([
        { name: "write_file", callId: "uncertain", state: "executing" },
      ]);
      f.repository.updateSession(f.session.id, { archived: true });
      expect(() => f.chat.resumeSession(f.session.id)).toThrow("归档");
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      f.db.close();
    }
  });
  it("requires a real directory inspection after external writer transfer and does not execute a stale extension", async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    try {
      const original = f.internal.fileLocks.acquire(
        ["C:\\Fixture"],
        true,
        { sessionId: "owner", runId: "owner-run", label: "Original" },
        signal,
        async () => false,
      );
      const release = await original;
      vi.spyOn(f.internal, "stopAndWait").mockImplementation(async () => release());
      const execute = vi.fn(async () => "mutated");
      const waiting = f.internal.withExternalWriter(f.session, "transfer", signal, execute);
      const rejected = expect(waiting).rejects.toThrow("NOT executed");
      await vi.waitFor(() => expect(f.questionBroker.list().length).toBe(1));
      expect(f.questionBroker.list()[0]).toMatchObject({
        sessionId: f.session.id,
        runId: "transfer",
        kind: "file_conflict",
      });
      f.questionBroker.answer({
        questionId: f.questionBroker.list()[0]?.id as string,
        answers: [{ id: "writer", selectedOptions: ["切换到当前 Agent"], otherText: "" }],
      });
      await rejected;
      expect(execute).not.toHaveBeenCalled();
      const toolCall = (name: string, args: object) =>
        f.internal.executeToolCall({
          session: f.session,
          runId: "transfer",
          signal,
          toolCall: { index: 0, callId: name, name, arguments: JSON.stringify(args) },
        });
      expect(
        (await toolCall("write_file", { path: "file.txt", content: "stale" })).output,
      ).toContain("FRESH_INSPECTION_REQUIRED");
      f.tools.mockResolvedValue({ output: "file file.txt", isError: false });
      expect((await toolCall("list_files", { path: "." })).isError).toBe(false);
      expect(f.internal.directoryRefreshRequired.get("transfer")?.size).toBe(0);
      await expect(
        f.internal.withExternalWriter(f.session, "transfer", signal, execute),
      ).resolves.toBe("mutated");
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      f.db.close();
    }
  });
  it("blocks edits observed against stale file content and requires a new successful read", async () => {
    const f = fixture();
    const session = { ...f.session, permissionMode: "full_access" as const };
    f.repository.updateSession(session.id, { permissionMode: "full_access" });
    type Context = {
      observeFile: (path: string, hash: string) => void;
      beforeFileWrite: (path: string, hash: string) => Promise<void>;
    };
    const contextTools = f.tools as unknown as ReturnType<
      typeof vi.fn<
        (
          name: string,
          args: object,
          context: Context,
        ) => Promise<{ output: string; isError: boolean }>
      >
    >;
    contextTools.mockImplementation(async (name, _args, context) => {
      if (name === "read_file") context.observeFile("C:\\Fixture\\file.txt", "initial");
      if (name === "write_file") await context.beforeFileWrite("C:\\Fixture\\file.txt", "external");
      return { output: "ok", isError: false };
    });
    const call = (name: string) =>
      f.internal.executeToolCall({
        session,
        runId: "stale",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: name,
          name,
          arguments: JSON.stringify({ path: "file.txt", content: "overwrite" }),
        },
      });
    try {
      await call("read_file");
      const waiting = call("write_file");
      await vi.waitFor(() => expect(f.questionBroker.list().length).toBe(1));
      expect(f.questionBroker.list()[0]).toMatchObject({
        sessionId: session.id,
        runId: "stale",
        kind: "file_conflict",
      });
      f.questionBroker.answer({
        questionId: f.questionBroker.list()[0]?.id as string,
        answers: [{ id: "external-change", selectedOptions: ["重新读取后继续"], otherText: "" }],
      });
      expect((await waiting).output).toContain("EXTERNAL_FILE_CHANGED");
      expect((await call("write_file")).output).toContain("FRESH_READ_REQUIRED");
      await call("read_file");
      contextTools.mockResolvedValue({ output: "written", isError: false });
      expect((await call("write_file")).isError).toBe(false);
    } finally {
      f.db.close();
    }
  });
  it("classifies a held file write as a conflict and keeps the writer until the user decides", async () => {
    const f = fixture();
    const controller = new AbortController();
    const release = await f.internal.fileLocks.acquire(
      ["C:\\Fixture\\file.txt"],
      false,
      { sessionId: "owner", runId: "owner-run", label: "Original Agent" },
      controller.signal,
      async () => false,
    );
    try {
      const waiting = f.internal.executeToolCall({
        session: f.session,
        runId: "contender",
        signal: controller.signal,
        toolCall: {
          index: 0,
          callId: "contender-write",
          name: "write_file",
          arguments: JSON.stringify({ path: "file.txt", content: "blocked edit" }),
        },
      });
      await vi.waitFor(() => expect(f.questionBroker.list()).toHaveLength(1));
      const pending = f.questionBroker.list()[0];
      expect(pending).toMatchObject({
        sessionId: f.session.id,
        runId: "contender",
        kind: "file_conflict",
      });
      expect(f.tools).not.toHaveBeenCalled();
      expect(f.repository.getSession(f.session.id)?.status).toBe("waiting_approval");
      f.questionBroker.answer({
        questionId: pending?.id as string,
        answers: [{ id: "writer", selectedOptions: ["保留原 Agent"], otherText: "" }],
      });
      const result = await waiting;
      expect(result).toMatchObject({ isError: true });
      expect(result.output).toContain("Writer retained: Original Agent");
      expect(f.tools).not.toHaveBeenCalled();
      expect(f.questionBroker.list()).toHaveLength(0);
      expect(f.repository.getSession(f.session.id)?.permissionMode).toBe("request_approval");
    } finally {
      controller.abort();
      release();
      f.db.close();
    }
  });
  it("ignores a model-supplied conflict kind when asking the user an ordinary question", async () => {
    const f = fixture();
    const controller = new AbortController();
    try {
      const waiting = f.internal.executeToolCall({
        session: f.session,
        runId: "question",
        signal: controller.signal,
        toolCall: {
          index: 0,
          callId: "model-question",
          name: "ask_user",
          arguments: JSON.stringify({
            kind: "file_conflict",
            questions: [
              {
                id: "direction",
                header: "Choose approach",
                question: "Which approach should I use?",
                options: [
                  { label: "Continue", description: "Proceed with the proposed approach." },
                  { label: "Pause", description: "Keep the task paused for review." },
                ],
              },
            ],
          }),
        },
      });
      await vi.waitFor(() => expect(f.questionBroker.list()).toHaveLength(1));
      const pending = f.questionBroker.list()[0];
      expect(pending).toMatchObject({
        sessionId: f.session.id,
        runId: "question",
        kind: "agent",
      });
      expect(f.tools).not.toHaveBeenCalled();
      f.questionBroker.answer({
        questionId: pending?.id as string,
        answers: [{ id: "direction", selectedOptions: ["Continue"], otherText: "" }],
      });
      expect(await waiting).toMatchObject({
        isError: false,
        output: expect.stringContaining('"selected_options":["Continue"]'),
      });
      expect(f.questionBroker.list()).toHaveLength(0);
      expect(f.repository.getSession(f.session.id)?.permissionMode).toBe("request_approval");
    } finally {
      controller.abort();
      f.db.close();
    }
  });
  it("persists uncertain extension outcomes across writers and requires actual evidence plus human recovery confirmation", async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    const call = (name: string, args: object) =>
      f.internal.executeToolCall({
        session: f.session,
        runId: "retry",
        signal,
        toolCall: { index: 0, callId: `retry-${name}`, name, arguments: JSON.stringify(args) },
      });
    try {
      f.internal.executionSafety.begin(f.session.id, "uncertain");
      await f.internal.withExternalWriter(f.session, "uncertain", signal, async () => ({
        output: "MCP_OUTCOME_UNCERTAIN: transport ended",
        isError: true,
      }));
      f.internal.executionSafety.finish("uncertain");
      f.internal.executionSafety.begin(f.session.id, "retry");
      expect((await call("write_file", { path: "x.txt", content: "blocked" })).output).toContain(
        "RECOVERY_INSPECTION_REQUIRED",
      );
      expect(
        (await call("resolve_interrupted", { evidence_call_ids: ["invented"], summary: "done" }))
          .isError,
      ).toBe(true);
      expect(f.questionBroker.list()).toHaveLength(0);
      expect((await call("read_file", { path: "x.txt" })).isError).toBe(false);
      const pending = call("resolve_interrupted", {
        evidence_call_ids: ["retry-read_file"],
        summary: "Inspected actual file and server state; execution has stopped.",
      });
      await vi.waitFor(() => expect(f.questionBroker.list()).toHaveLength(1));
      f.questionBroker.answer({
        questionId: f.questionBroker.list()[0]?.id as string,
        answers: [{ id: "recovery", selectedOptions: ["继续执行"], otherText: "" }],
      });
      expect((await pending).isError).toBe(false);
      expect((await call("write_file", { path: "x.txt", content: "allowed" })).isError).toBe(false);
    } finally {
      f.db.close();
    }
  });
  it("scopes simple command batch grants by cwd and excludes shell expressions", () => {
    const permissions = new PermissionStore();
    const base = {
      ...request("command", "s", "run_command"),
      pathScope: null,
      commandCwd: "C:\\Fixture",
      commandPrefix: "git diff --stat",
    };
    expect(permissions.similarScope("C:\\Fixture", base)).toBe("command:c:\\fixture:git diff");
    expect(
      permissions.similarScope("C:\\Fixture", { ...base, commandCwd: "C:\\Other" }),
    ).toBeNull();
    expect(
      permissions.similarScope("C:\\Fixture", {
        ...base,
        commandPrefix: "git diff (Invoke-Expression 'x')",
      }),
    ).toBeNull();
    expect(
      permissions.similarScope("C:\\Fixture", { ...base, commandPrefix: "git diff; shutdown /s" }),
    ).toBeNull();
    expect(permissions.similarScope("C:\\Fixture", { ...base, manualOnly: true })).toBeNull();
  });
  it("does not overwrite a user-edited plan with a stale model revision", async () => {
    const f = fixture();
    try {
      const saved = f.chat.workbench.update({
        sessionId: f.session.id,
        revision: 0,
        steps: [
          {
            id: "user",
            content: "Keep this user edit",
            status: "pending",
            priority: "medium",
            updatedAt: "",
          },
        ],
      });
      const result = await f.internal.executeToolCall({
        session: f.session,
        runId: "run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "stale",
          name: "update_todos",
          arguments: JSON.stringify({ revision: 0, todos: [] }),
        },
      });
      expect(result.isError).toBe(true);
      expect(result.output).toContain("Plan changed");
      expect(f.chat.workbench.state(f.session.id).plan).toEqual(saved);
    } finally {
      f.db.close();
    }
  });
  it("batch-approves same-session reads without granting writes, other projects/sessions or manual-only calls", async () => {
    const f = fixture();
    const controller = new AbortController();
    const signal = controller.signal;
    try {
      const first = f.internal.requestApproval(request("one", f.session.id), signal);
      const second = f.internal.requestApproval(
        request("two", f.session.id, "search_files", "C:\\Fixture\\src"),
        signal,
      );
      f.chat.decideApproval({ approvalId: "one", decision: "allow_similar" });
      await Promise.all([first, second]);
      await expect(
        f.internal.requestApproval(request("future", f.session.id), signal),
      ).resolves.toMatchObject({ decision: "allow_once" });
      expect(f.repository.getSession(f.session.id)?.permissionMode).toBe("request_approval");
      const write = f.internal.requestApproval(
        request("write", f.session.id, "write_file"),
        signal,
      );
      expect(f.broker.get("write")).toBeTruthy();
      f.chat.decideApproval({ approvalId: "write", decision: "deny" });
      await write;
      const manual = f.internal.requestApproval(
        { ...request("manual", f.session.id), manualOnly: true },
        signal,
      );
      expect(() =>
        f.chat.decideApproval({ approvalId: "manual", decision: "allow_similar" }),
      ).toThrow();
      f.chat.decideApproval({ approvalId: "manual", decision: "deny" });
      await manual;
      expect(
        f.permissions.similarScope(
          "C:\\Fixture",
          request("outside", f.session.id, "read_file", "C:\\Fixture-private\\a.ts"),
        ),
      ).toBeNull();
      expect(f.permissions.hasSimilar("other", "read:c:\\fixture")).toBe(false);
    } finally {
      controller.abort();
      f.db.close();
    }
  });
  it("repairs missing tool results once with uncertainty, preserving confirmed writes and restart checkpoints", () => {
    const f = fixture();
    try {
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            callId: "done",
            name: "write_file",
            arguments: "{}",
            status: "pending",
          },
          {
            type: "tool_call",
            callId: "unknown",
            name: "run_command",
            arguments: "{}",
            status: "pending",
          },
        ],
      });
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "tool",
        parts: [{ type: "tool_result", callId: "done", output: "Written", isError: false }],
      });
      f.internal.repairInterruptedToolResults(f.session.id);
      f.internal.repairInterruptedToolResults(f.session.id);
      const results = f.repository
        .getMessages(f.session.id)
        .flatMap((message) => message.parts.filter((part) => part.type === "tool_result"));
      expect(results).toHaveLength(2);
      expect(results.at(-1)).toMatchObject({
        callId: "unknown",
        isError: true,
        output: expect.stringContaining("Do not replay"),
      });
      f.repository.updateSession(f.session.id, { status: "running" });
      f.chat.workbench.checkpoint(f.session.id, {
        runId: "run",
        state: "running",
        updatedAt: "",
        lastSafeTool: "write_file",
        lastSafeCallId: "done",
        completedTools: 1,
        uncertainTools: [{ name: "run_command", callId: "unknown", state: "executing" }],
      });
      f.repository.recoverInterruptedRuns();
      expect(f.repository.getSession(f.session.id)?.status).toBe("interrupted");
      expect(f.chat.workbench.state(f.session.id).checkpoint).toMatchObject({
        state: "interrupted",
        completedTools: 1,
        uncertainTools: [{ callId: "unknown" }],
      });
      expect(f.tools).not.toHaveBeenCalled();
    } finally {
      f.db.close();
    }
  });
  it("discovers declared checks, executes through the tool gateway and returns real failure evidence", async () => {
    const f = fixture();
    try {
      const lintOutput = `exit_code: 1\nsource.ts:2: lint error\n${"Diagnostic detail\n".repeat(900)}VERIFICATION_COMMAND_TAIL`;
      const execute = vi.spyOn(f.internal, "executeToolCall").mockImplementation(async (input) =>
        input.toolCall.name === "list_files"
          ? { isError: false, output: "file package.json" }
          : input.toolCall.name === "read_file"
            ? {
                isError: false,
                output:
                  '1 | {"packageManager":"pnpm@11","scripts":{"test":"vitest","lint":"biome check .","typecheck":"tsc --noEmit"}}',
              }
            : {
                isError: input.toolCall.arguments.includes("lint"),
                output: input.toolCall.arguments.includes("lint")
                  ? lintOutput
                  : "exit_code: 0\nPassed",
              },
      );
      const feedback = await f.internal.runVerification(
        f.session,
        "run",
        ["source.ts"],
        new AbortController().signal,
        1,
      );
      expect(
        execute.mock.calls
          .map(([input]) => JSON.parse(input.toolCall.arguments).command)
          .filter(Boolean),
      ).toEqual(["pnpm run test -- --run", "pnpm run lint", "pnpm run typecheck"]);
      expect(feedback).toContain("source.ts:2: lint error");
      expect(feedback).not.toContain("VERIFICATION_COMMAND_TAIL");
      expect(
        f.events.some(
          (event) =>
            event.type === "activity" &&
            event.activity.toolName === "verification" &&
            event.activity.status === "failed",
        ),
      ).toBe(true);
      expect(
        f.events.findLast(
          (event) =>
            event.type === "activity" &&
            event.activity.toolName === "verification" &&
            event.activity.status === "failed",
        ),
      ).toMatchObject({
        activity: { detail: expect.stringContaining("VERIFICATION_COMMAND_TAIL") },
      });
      expect(
        f.repository.getMessages(f.session.id).filter((message) => message.role === "tool"),
      ).toHaveLength(5);
      execute.mockClear();
      expect(
        await f.internal.runVerification(
          f.session,
          "run",
          ["notes.txt"],
          new AbortController().signal,
          1,
        ),
      ).toBe("");
      expect(execute).not.toHaveBeenCalled();
    } finally {
      f.db.close();
    }
  });
  it("seeds eighteen built-in profiles once, preserves custom profiles and respects readonly/ask policies", () => {
    const f = fixture();
    try {
      expect(f.repository.listAgentProfiles().filter((profile) => profile.builtin)).toHaveLength(
        18,
      );
      const review = f.repository.getAgentProfile("code-review");
      expect(review).toMatchObject({
        readOnly: true,
        toolAllowlist: expect.arrayContaining(["code_index", "update_todos"]),
      });
      expect(f.repository.getAgentProfile("operations")?.permissions.run_command).toBe("ask");
      f.repository.saveAgentProfile({
        id: "creative",
        name: "My Creative",
        role: "primary",
        instructions: "Custom",
        modelId: null,
        enabled: false,
        readOnly: true,
        description: "Mine",
      });
      new AgentProfileService(f.repository);
      expect(f.repository.listAgentProfiles().filter((profile) => profile.builtin)).toHaveLength(
        18,
      );
      expect(f.repository.getAgentProfile("creative")).toMatchObject({
        name: "My Creative",
        enabled: false,
        instructions: "Custom",
      });
    } finally {
      f.db.close();
    }
  });
  it("reports unreadable/invalid verification manifests and rejects an empty declared command list", async () => {
    const f = fixture();
    try {
      const execute = vi.spyOn(f.internal, "executeToolCall");
      for (const manifest of [
        { isError: true, output: "Read denied" },
        { isError: false, output: "1 | { broken" },
      ]) {
        execute.mockImplementation(async (input) =>
          input.toolCall.name === "list_files"
            ? { isError: false, output: "file package.json" }
            : manifest,
        );
        expect(
          await f.internal.runVerification(
            f.session,
            "run",
            ["code.ts"],
            new AbortController().signal,
            1,
          ),
        ).toContain("Verification was not run");
      }
      execute.mockImplementation(async (input) =>
        input.toolCall.name === "list_files"
          ? { isError: false, output: "file mingshen.verify.json" }
          : { isError: false, output: '1 | {"commands":[]}' },
      );
      expect(
        await f.internal.runVerification(
          f.session,
          "run",
          ["code.ts"],
          new AbortController().signal,
          1,
        ),
      ).toContain("Invalid mingshen.verify.json");
      expect(execute.mock.calls.every(([input]) => input.toolCall.name !== "run_command")).toBe(
        true,
      );
    } finally {
      f.db.close();
    }
  });
  it.each(["list_files", "read_file"])(
    "preserves full %s failure details for the UI while keeping model feedback bounded",
    async (failingTool) => {
      const f = fixture();
      const diagnostic = `${"Read denied: diagnostic detail\n".repeat(100)}VERIFICATION_READ_TAIL`;
      try {
        const execute = vi
          .spyOn(f.internal, "executeToolCall")
          .mockImplementation(async (input) =>
            input.toolCall.name === failingTool
              ? { isError: true, output: diagnostic }
              : { isError: false, output: "file package.json" },
          );
        const feedback = await f.internal.runVerification(
          f.session,
          "run",
          ["source.ts"],
          new AbortController().signal,
          1,
        );
        expect(feedback).toContain("Verification was not run");
        expect(feedback).not.toContain("VERIFICATION_READ_TAIL");
        expect(
          f.events.findLast(
            (event) =>
              event.type === "activity" &&
              event.activity.toolName === "verification" &&
              event.activity.status === "failed",
          ),
        ).toMatchObject({
          activity: { detail: expect.stringContaining("VERIFICATION_READ_TAIL") },
        });
        expect(
          f.repository
            .getMessages(f.session.id)
            .flatMap((message) => message.parts)
            .find((part) => part.type === "tool_result" && part.isError),
        ).toMatchObject({ output: diagnostic });
        expect(execute.mock.calls.every(([input]) => input.toolCall.name !== "run_command")).toBe(
          true,
        );
      } finally {
        f.db.close();
      }
    },
  );
  it("prevents specialized profiles from delegating to a worker outside their fixed policy", async () => {
    const f = fixture();
    try {
      for (const id of ["code-review", "operations", "creative", "brainstorm"]) {
        const restricted = {
          ...f.session,
          agentProfileId: id,
          providerId: "provider",
          modelId: "model",
        };
        const blocked = await f.internal.runSubagent(restricted, new AbortController().signal, {
          task: "Do work",
          agent: "general",
        });
        expect(blocked.isError).toBe(true);
        expect(blocked.output).toContain("不允许调用子 Agent");
      }
      let finishChild!: (result: { output: string; isError: boolean }) => void;
      const delegate = vi.spyOn(f.internal, "runSubagent").mockImplementation(
        () =>
          new Promise((resolve) => {
            finishChild = resolve;
          }),
      );
      const allowed = await f.internal.executeToolCall({
        session: { ...f.session, agentProfileId: "creative" },
        runId: "run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: "delegate",
          name: "spawn_subagent",
          arguments: JSON.stringify({ task: "Inspect relevant material", agent: "explore" }),
        },
      });
      expect(allowed.isError).toBe(false);
      expect(allowed.output).toContain("任务已安排");
      expect(delegate).toHaveBeenCalledOnce();
      finishChild({ output: "Read-only evidence", isError: false });
      await vi.waitFor(() =>
        expect(f.events).toContainEqual(
          expect.objectContaining({
            type: "activity",
            activity: expect.objectContaining({
              sessionId: f.session.id,
              toolName: "subagent",
              kind: "subagent",
              status: "completed",
              title: "后台子 Agent 已完成",
            }),
          }),
        ),
      );
    } finally {
      f.db.close();
    }
  });
});
