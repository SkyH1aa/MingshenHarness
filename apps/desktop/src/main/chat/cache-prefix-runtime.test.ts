import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatStreamEvent,
  ProviderProtocol,
  SessionView,
} from "../../shared/domain";
import { ApprovalBroker } from "../permissions/approval-broker";
import { PermissionStore } from "../permissions/permission-store";
import { QuestionBroker } from "../permissions/question-broker";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import type { ToolExecutionContext, ToolExecutionResult } from "../tools/tool-registry";
import { ChatService } from "./chat-service";

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

type WireBody = Record<string, unknown>;
type Call = { id: string; name: string; arguments: Record<string, unknown> };

function bodyAt(bodies: WireBody[], index: number): WireBody {
  const body = bodies[index];
  if (!body) throw new Error(`Missing request ${index}`);
  return body;
}

function reply(protocol: ProviderProtocol, calls: Call[] = [], text = ""): Response {
  const events =
    protocol === "openai_responses"
      ? [
          ...(text ? [{ type: "response.output_text.delta", delta: text }] : []),
          {
            type: "response.completed",
            response: {
              output: calls.map((call) => ({
                type: "function_call",
                call_id: call.id,
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              })),
            },
          },
        ]
      : protocol === "anthropic_messages"
        ? [
            ...calls.map((call, index) => ({
              type: "content_block_start",
              index,
              content_block: {
                type: "tool_use",
                id: call.id,
                name: call.name,
                input: call.arguments,
              },
            })),
            ...(text ? [{ type: "content_block_delta", delta: { type: "text_delta", text } }] : []),
            { type: "message_stop" },
          ]
        : [
            {
              choices: [
                {
                  delta: {
                    ...(text ? { content: text } : {}),
                    ...(calls.length
                      ? {
                          tool_calls: calls.map((call, index) => ({
                            index,
                            id: call.id,
                            type: "function",
                            function: {
                              name: call.name,
                              arguments: JSON.stringify(call.arguments),
                            },
                          })),
                        }
                      : {}),
                  },
                  finish_reason: calls.length ? "tool_calls" : "stop",
                },
              ],
            },
            "[DONE]",
          ];
  return new Response(
    events
      .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
      .join(""),
  );
}

function system(body: WireBody, protocol: ProviderProtocol): unknown {
  if (protocol === "openai_responses") return body.instructions;
  if (protocol === "anthropic_messages") return body.system;
  return (body.messages as Array<{ content: unknown }>)[0]?.content;
}

function history(body: WireBody, protocol: ProviderProtocol): Array<Record<string, unknown>> {
  if (protocol === "openai_responses") return body.input as Array<Record<string, unknown>>;
  const messages = body.messages as Array<{
    role: string;
    content: Array<Record<string, unknown>>;
  }>;
  // Anthropic merges adjacent user messages; compare chronological blocks within them.
  if (protocol === "anthropic_messages")
    return messages.flatMap((message) =>
      message.content.map((block) => ({ role: message.role, ...block })),
    );
  return messages.slice(1);
}

function hostSections(body: WireBody, protocol: ProviderProtocol, section: string): string[] {
  return history(body, protocol)
    .map((item) => String(item.content ?? item.text ?? ""))
    .filter((text) => text.startsWith(`[HOST_CONTEXT ${section}]`));
}

function assertPairs(body: WireBody, protocol: ProviderProtocol): void {
  const pending = new Set<string>();
  for (const part of history(body, protocol)) {
    const calls =
      protocol === "openai_responses"
        ? part.type === "function_call"
          ? [String(part.call_id)]
          : []
        : protocol === "anthropic_messages"
          ? part.type === "tool_use"
            ? [String(part.id)]
            : []
          : ((part.tool_calls as Array<{ id: string }> | undefined) ?? []).map((call) => call.id);
    for (const call of calls) {
      expect(pending.has(call)).toBe(false);
      pending.add(call);
    }
    const result =
      part.type === "function_call_output"
        ? String(part.call_id)
        : part.type === "tool_result"
          ? String(part.tool_use_id)
          : part.role === "tool"
            ? String(part.tool_call_id)
            : null;
    if (result) {
      expect(pending.has(result)).toBe(true);
      pending.delete(result);
    } else if (part.role === "user" || part.role === "assistant" || part.type === "message") {
      if (!calls.length) expect(pending.size).toBe(0);
    }
  }
  expect(pending.size).toBe(0);
}

function fixture(protocol: ProviderProtocol) {
  const db = openDatabase(":memory:");
  cleanups.push(() => db.close());
  const repository = new Repository(db);
  repository.setSetting("models.retry", { maxRetries: 0 });
  const provider = repository.insertProvider({
    name: "Cache prefix fixture",
    baseUrl: "https://fixture.invalid/v1",
    protocol,
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "fixture",
    displayName: "Fixture",
    contextWindow: 1000000,
    maxOutputTokens: 1024,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: true,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository.getProvider(provider.id)?.models[0];
  if (!model) throw new Error("Fixture model missing");
  repository.saveAgentProfile({
    id: "fixture-main",
    name: "Main",
    description: "Main fixture",
    role: "primary",
    instructions: "Preserve the user's constraints.",
    readOnly: false,
    enabled: true,
    modelId: null,
  });
  for (const id of ["worker-z", "worker-a"])
    repository.saveAgentProfile({
      id,
      name: id,
      description: id,
      role: "subagent",
      instructions: "",
      readOnly: true,
      enabled: true,
      modelId: null,
    });
  const session = repository.insertSession({
    title: "Cache prefix fixture",
    providerId: provider.id,
    modelId: model.id,
    agentProfileId: "fixture-main",
    workspacePath: null,
    systemPrompt: "Keep all original deliverables.",
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
  });
  const state = { reverseDiscovery: false };
  const names = (values: string[]) => (state.reverseDiscovery ? [...values].reverse() : values);
  const descriptors = () =>
    names(["read_file", "list_files"]).map((name) => ({
      name,
      description: `Fixture ${name}`,
      parameters: state.reverseDiscovery
        ? {
            required: ["path"],
            properties: { path: { description: "Path", type: "string" } },
            type: "object",
          }
        : {
            type: "object",
            properties: { path: { type: "string", description: "Path" } },
            required: ["path"],
          },
    }));
  const broker = new ApprovalBroker();
  const events: ChatStreamEvent[] = [];
  const onApproval = { current: (_request: ApprovalRequest): void => undefined };
  const registry = { descriptors, execute: vi.fn() };
  const chat = new ChatService({
    appVersion: "1.2.9",
    promptDirectory: `${process.cwd()}/resources/prompts`,
    repository,
    toolRegistry: registry,
    permissions: new PermissionStore(),
    approvalBroker: broker,
    questionBroker: new QuestionBroker(),
    providerService: { getActiveApiKey: () => "local-fixture" },
    extensionService: {
      buildSessionContext: async () => ({
        skills: names(["skill-z", "skill-a"]),
        mcpServers: names(["server-z", "server-a"]),
        text: "Stable selected extension instructions.",
      }),
    },
    projectInstructionService: { discover: async () => [] },
    mcpService: {
      list: () => [],
      enabledServerNames: () => names(["server-a", "server-z"]),
      toolDefinitions: async () => [],
    },
    customToolService: { has: async () => false, list: async () => [] },
    dockerService: { getImage: () => null },
    emit: (event: ChatStreamEvent) => {
      events.push(event);
      if (event.type === "approval_required") onApproval.current(event.approval);
    },
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    executeRun(input: object): Promise<void>;
    executeToolCall(input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      toolCall: { index: number; name: string; callId: string; arguments: string };
    }): Promise<ToolExecutionResult>;
    runPluginHooks(): Promise<void>;
    runVerification(): Promise<string>;
    runPostEditChecks(): Promise<string>;
  };
  internal.runPluginHooks = async () => undefined;
  internal.runVerification = async () => "";
  internal.runPostEditChecks = async () => "";
  const append = (text: string) =>
    repository.appendMessage({
      sessionId: session.id,
      role: "user",
      parts: [{ type: "text", text }],
    });
  return {
    repository,
    session,
    chat,
    internal,
    events,
    state,
    registry,
    broker,
    onApproval,
    append,
    run: () =>
      internal.executeRun({
        session: repository.getSession(session.id),
        provider,
        model,
        runId: randomUUID(),
        signal: new AbortController().signal,
        generateTitle: false,
      }),
  };
}

describe("ChatService cache-prefix integration", () => {
  it("runs independent read calls together and waits before writes and following reads", async () => {
    const f = fixture("openai_responses");
    f.append("Inspect both files, make the edit and check it.");
    const order: string[] = [];
    let activeReads = 0;
    let peakReads = 0;
    f.registry.execute.mockImplementation(async (name: string, args: { path: string }) => {
      order.push(`start:${args.path}`);
      if (name === "write_file") {
        expect(activeReads).toBe(0);
        expect(order).toContain("end:first");
        expect(order).toContain("end:second");
      } else {
        if (args.path === "after") expect(order).toContain("end:edit");
        activeReads++;
        peakReads = Math.max(peakReads, activeReads);
        await new Promise((done) => setTimeout(done, 15));
        activeReads--;
      }
      order.push(`end:${args.path}`);
      return { output: "Observed.", isError: false };
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply("openai_responses", [
          { id: "r1", name: "read_file", arguments: { path: "first" } },
          { id: "r2", name: "read_file", arguments: { path: "second" } },
          { id: "w", name: "write_file", arguments: { path: "edit", content: "change" } },
          { id: "r3", name: "read_file", arguments: { path: "after" } },
        ]),
      )
      .mockResolvedValueOnce(reply("openai_responses", [], "Verified."));
    vi.stubGlobal("fetch", fetcher);
    await f.run();
    expect(peakReads).toBe(2);
    expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
    expect(f.events.filter((event) => event.type === "run_failed")).toEqual([]);
  });

  it("continues after a native commentary message and persists its original phase and encrypted state", async () => {
    const f = fixture("openai_responses");
    f.append("Finish the task, including actual work.");
    const bodies: WireBody[] = [];
    const items = [
      { id: "reason-1", type: "reasoning", encrypted_content: "opaque-fixture", summary: [] },
      {
        id: "message-1",
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [{ type: "output_text", text: "I am checking the result.", annotations: [] }],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return bodies.length === 1
          ? new Response(
              `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: items } })}\n\n`,
            )
          : reply("openai_responses", [], "Actual final answer.");
      }),
    );
    await f.run();
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toContain("MODEL_CONTINUATION_REQUIRED");
    expect(bodies[1]?.input).toEqual(expect.arrayContaining(items));
    const state = f.repository
      .getMessages(f.session.id)
      .flatMap((message) => message.parts)
      .find((part) => part.type === "responses_state");
    expect(state).toMatchObject({ items, modelId: "fixture" });
    expect(f.events.filter((event) => event.type === "run_completed")).toHaveLength(1);
    expect(f.events.filter((event) => event.type === "run_failed")).toEqual([]);
  });

  it("collects a persistent command's final output before completing and only confirms after exit", async () => {
    const f = fixture("openai_responses");
    f.append("Run the check and report its actual exit.");
    let running = false;
    const registry = Object.assign(f.registry, {
      commandSessions: () => [
        {
          id: "process-1",
          sessionId: f.session.id,
          command: "node check.js",
          cwd: process.cwd(),
          running,
        },
      ],
      hasRunningCommands: () => running,
      cancelRun: vi.fn(async () => {
        expect(running).toBe(false);
      }),
    });
    registry.execute.mockImplementation(async (name: string) => {
      if (name === "exec_command") {
        running = true;
        expect(f.repository.getSetting(`workbench.ledger.${f.session.id}`)).toEqual([]);
        return {
          output: "Started.",
          isError: false,
          commandSession: { id: "process-1", running: true },
        };
      }
      expect(name).toBe("write_stdin");
      expect(f.repository.getSetting(`workbench.ledger.${f.session.id}`)).toEqual([]);
      running = false;
      return {
        output: "CHECK_PASSED\nExit code: 0",
        isError: false,
        commandSession: { id: "process-1", running: false },
      };
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply("openai_responses", [
          { id: "exec", name: "exec_command", arguments: { command: "node check.js" } },
        ]),
      )
      .mockResolvedValueOnce(reply("openai_responses", [], "Wait for the check."))
      .mockResolvedValueOnce(reply("openai_responses", [], "Check passed with exit 0."));
    vi.stubGlobal("fetch", fetcher);
    await f.run();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(f.repository.getMessages(f.session.id))).toContain("CHECK_PASSED");
    const ledger = f.repository.getSetting(`workbench.ledger.${f.session.id}`) as Array<{
      callId: string;
      fingerprint: string;
    }>;
    expect(ledger).toHaveLength(1);
    expect(ledger).toEqual([
      expect.objectContaining({
        callId: "exec",
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(registry.cancelRun).toHaveBeenCalled();
    expect(f.events.filter((event) => event.type === "run_failed")).toEqual([]);
    expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
  });

  it("keeps a failed persistent-command poll uncertain without writing a final ledger entry", async () => {
    const f = fixture("openai_responses");
    f.append("Run the failing check and report its actual state.");
    let running = false;
    Object.assign(f.registry, {
      commandSessions: () => [
        {
          id: "process-failed",
          sessionId: f.session.id,
          command: "node check.js",
          cwd: process.cwd(),
          running,
        },
      ],
      hasRunningCommands: () => running,
      cancelRun: vi.fn(async () => undefined),
    });
    f.registry.execute.mockImplementation(async (name: string) => {
      if (name === "exec_command") {
        running = true;
        return {
          output: "Started.",
          isError: false,
          commandSession: { id: "process-failed", running: true },
        };
      }
      expect(name).toBe("write_stdin");
      running = false;
      return {
        output: "CHECK_FAILED: the command exited before producing a verified result.",
        isError: true,
        commandSession: { id: "process-failed", running: false },
      };
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply("openai_responses", [
          { id: "exec", name: "exec_command", arguments: { command: "node check.js" } },
        ]),
      )
      .mockImplementation(async () => reply("openai_responses", [], "Wait for the check."));
    vi.stubGlobal("fetch", fetcher);
    await f.run();

    const failedTool = f.repository
      .getMessages(f.session.id)
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "tool_result" && part.output.includes("CHECK_FAILED"))
      .at(-1);
    expect(failedTool).toMatchObject({
      isError: true,
      outcome: {
        status: "failed",
        effect: "uncertain",
      },
    });
    expect(f.repository.getSetting(`workbench.ledger.${f.session.id}`)).toEqual([]);
    expect(f.repository.getSetting(`workbench.recovery.${f.session.id}`)).toMatchObject({
      uncertain: expect.any(Array),
    });
    expect(f.events.some((event) => event.type === "run_failed")).toBe(true);
  });

  it("reads a closed command's remaining output before allowing a final answer", async () => {
    const f = fixture("openai_responses");
    f.append("Report every page of the command result.");
    let unread = 0;
    Object.assign(f.registry, {
      commandSessions: () => [
        {
          id: "closed-process",
          sessionId: f.session.id,
          command: "node check.js",
          cwd: process.cwd(),
          running: false,
          unreadOutputChars: unread,
        },
      ],
      hasRunningCommands: () => false,
      cancelRun: async () => {
        expect(unread).toBe(0);
      },
    });
    f.registry.execute.mockImplementation(async (name: string) => {
      if (name === "exec_command") {
        unread = 20;
        return {
          output: "FIRST_PAGE",
          isError: false,
          commandSession: { id: "closed-process", running: false, unreadOutputChars: unread },
        };
      }
      expect(name).toBe("write_stdin");
      unread = 0;
      return {
        output: "LAST_PAGE_EVIDENCE",
        isError: false,
        commandSession: { id: "closed-process", running: false, unreadOutputChars: 0 },
      };
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply("openai_responses", [
          { id: "exec", name: "exec_command", arguments: { command: "node check.js" } },
        ]),
      )
      .mockResolvedValueOnce(reply("openai_responses", [], "Preparing the result."))
      .mockImplementationOnce(async (_url: unknown, init: RequestInit) => {
        expect(String(init.body)).toContain("LAST_PAGE_EVIDENCE");
        return reply("openai_responses", [], "All output checked.");
      });
    vi.stubGlobal("fetch", fetcher);
    await f.run();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(f.events.filter((event) => event.type === "run_failed")).toEqual([]);
    expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
  });

  it("defers stdin approval to the registry so empty polls do not prompt and input is approved once", async () => {
    const f = fixture("openai_responses");
    const profile = f.repository.getAgentProfile(f.session.agentProfileId);
    if (!profile) throw new Error("Fixture profile missing.");
    f.repository.saveAgentProfile({ ...profile, permissions: { bash: "ask" } });
    Object.assign(f.registry, {
      commandSessions: () => [
        { id: "process", sessionId: f.session.id, command: "node interactive.js" },
      ],
    });
    f.registry.execute.mockImplementation(
      async (_name: string, args: Record<string, unknown>, context: ToolExecutionContext) => {
        expect(context.forceApproval).toBe(true);
        if (args.chars || args.close_stdin)
          await context.requestApproval(
            {
              id: randomUUID(),
              sessionId: f.session.id,
              runId: context.runId,
              toolCallId: context.toolCallId,
              toolName: "write_stdin",
              summary: "Fixture stdin",
              detail: "Fixture input",
              pathScope: null,
              commandPrefix: null,
              risk: "normal",
              manualOnly: true,
              createdAt: new Date().toISOString(),
            },
            context.signal,
          );
        return { output: "Polled.", isError: false };
      },
    );
    const approved: ApprovalRequest[] = [];
    f.onApproval.current = (request) => {
      approved.push(request);
      f.broker.decide({ approvalId: request.id, decision: "allow_once" });
    };
    for (const args of [
      { session_id: "process" },
      { session_id: "process", terminate: true },
      { session_id: "process", chars: "yes\n" },
      { session_id: "process", close_stdin: true },
    ]) {
      const result = await f.internal.executeToolCall({
        session: f.session,
        runId: "stdin-policy",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: randomUUID(),
          name: "write_stdin",
          arguments: JSON.stringify(args),
        },
      });
      expect(result.isError).toBe(false);
    }
    expect(f.registry.execute).toHaveBeenCalledTimes(4);
    expect(approved).toHaveLength(2);
    expect(approved.every((request) => request.manualOnly && request.commandPrefix === null)).toBe(
      true,
    );
  });

  it.each([false, true])(
    "relays child verification through the parent policy, denied=%s",
    async (denied) => {
      const f = fixture("openai_responses");
      f.repository.saveAgentProfile({
        id: "worker",
        name: "Worker",
        description: "",
        role: "subagent",
        instructions: "",
        enabled: true,
        readOnly: false,
        modelId: null,
        toolAllowlist: ["run_command"],
      });
      if (denied)
        f.repository.saveAgentProfile({
          id: "fixture-main",
          name: "Main",
          description: "",
          role: "primary",
          instructions: "",
          enabled: true,
          readOnly: false,
          modelId: null,
          permissions: { run_command: "deny" },
        });
      const child = f.repository.insertSession({
        ...f.session,
        title: "Child",
        parentSessionId: f.session.id,
        agentProfileId: "worker",
      });
      const internal = f.chat as unknown as {
        managedChildren: Set<string>;
        verificationRequests: Map<string, string[]>;
        delegatedTasks: Map<string, Map<string, { promise: Promise<object>; delivered: boolean }>>;
        executeToolCall(input: object): Promise<ToolExecutionResult>;
        waitSubagents(runId: string): Promise<ToolExecutionResult>;
        drainParentVerification(
          session: SessionView,
          runId: string,
          signal: AbortSignal,
        ): Promise<string>;
      };
      Object.assign(f.registry, { hasRunningCommands: () => false, commandSessions: () => [] });
      f.registry.execute.mockResolvedValue({ output: "Verified in parent.", isError: false });
      internal.managedChildren.add(child.id);
      const signal = new AbortController().signal;
      expect(
        await internal.executeToolCall({
          session: child,
          runId: "child-run",
          signal,
          toolCall: {
            name: "request_verification",
            index: 0,
            callId: "queue",
            arguments: '{"commands":["npm test"]}',
          },
        }),
      ).toMatchObject({ isError: false, output: expect.stringContaining("NOT executed") });
      expect(f.registry.execute).not.toHaveBeenCalled();
      internal.delegatedTasks.set(
        "parent-run",
        new Map([
          [
            "task",
            {
              delivered: false,
              promise: Promise.resolve({
                output: "Child edits complete; verification pending.",
                isError: false,
                verification: {
                  childId: child.id,
                  commands: internal.verificationRequests.get(child.id),
                },
              }),
            },
          ],
        ]),
      );
      const result = await internal.waitSubagents("parent-run");
      expect(result.isError).toBe(false);
      expect(f.registry.execute).not.toHaveBeenCalled();
      const report = await internal.drainParentVerification(f.session, "parent-run", signal);
      expect(Boolean(report)).toBe(denied);
      if (denied) expect(f.registry.execute).not.toHaveBeenCalled();
      else
        expect(f.registry.execute).toHaveBeenCalledWith(
          "run_command",
          expect.objectContaining({ command: "npm test" }),
          expect.objectContaining({ session: expect.objectContaining({ id: f.session.id }) }),
        );
      expect(result.output).toContain("Parent verification");
      expect((await internal.waitSubagents("parent-run")).output).toContain("没有待汇总");
    },
  );

  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "keeps %s tool calls paired when child verification follows wait_subagents",
    async (protocol) => {
      const f = fixture(protocol);
      f.append("Delegate and verify the result.");
      Object.assign(f.registry, { hasRunningCommands: () => false, commandSessions: () => [] });
      Object.defineProperty(f.chat, "runSubagent", {
        value: async () => ({
          output: "Child edits done.",
          isError: false,
          verification: { childId: "child", commands: ["node check.js"] },
        }),
      });
      f.registry.execute.mockResolvedValue({ output: "VERIFICATION_EVIDENCE", isError: false });
      let round = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init: RequestInit) => {
          const body = JSON.parse(String(init.body)) as WireBody;
          assertPairs(body, protocol);
          round++;
          if (round === 1)
            return reply(protocol, [
              {
                id: "spawn",
                name: "spawn_subagent",
                arguments: { task: "Check", agent: "worker-a" },
              },
            ]);
          if (round === 2)
            return reply(protocol, [
              { id: "wait", name: "wait_subagents", arguments: {} },
              { id: "read", name: "read_file", arguments: { path: "evidence" } },
            ]);
          expect(JSON.stringify(body)).toContain("VERIFICATION_EVIDENCE");
          return reply(protocol, [], "Verified.");
        }),
      );
      await f.run();
      expect(round).toBe(3);
      expect(f.registry.execute.mock.calls.some(([name]) => name === "run_command")).toBe(true);
      expect(f.events.filter((event) => event.type === "run_failed")).toEqual([]);
      expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
    },
  );

  it.each(["openai_responses", "openai_chat_completions", "anthropic_messages"] as const)(
    "keeps %s request prefixes across tools, changing plan/diagnostics and the next user turn",
    async (protocol) => {
      const f = fixture(protocol);
      const bodies: WireBody[] = [];
      f.append("Inspect the source and explain the result.");
      f.internal.executeToolCall = vi.fn(async ({ toolCall }) => {
        const plan = f.chat.workbench.state(f.session.id).plan;
        f.chat.workbench.update({
          sessionId: f.session.id,
          revision: plan.revision,
          paused: false,
          steps: [
            {
              id: "inspect",
              content: toolCall.callId === "first" ? "Inspect original source" : "Verify source",
              status: "in_progress",
              priority: "medium",
              updatedAt: "",
            },
          ],
        });
        return {
          output: `Result from ${toolCall.callId}`,
          isError: false,
          fileChange: {
            path: `${toolCall.callId}.ts`,
            changeType: "modified" as const,
            additions: 1,
            deletions: 0,
          },
        };
      });
      f.internal.runPostEditChecks = vi
        .fn()
        .mockResolvedValueOnce("first.ts:1:1 [error] fixture diagnostic")
        .mockResolvedValueOnce("");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, options) => {
          bodies.push(JSON.parse(String(options.body)));
          if (bodies.length <= 2) {
            const id = bodies.length === 1 ? "first" : "second";
            return reply(protocol, [{ id, name: "read_file", arguments: { path: `${id}.ts` } }]);
          }
          return reply(protocol, [], "The requested inspection is complete.");
        }),
      );
      await f.run();
      expect(bodies).toHaveLength(3);
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
      f.append("Continue with the current plan and summarize the findings.");
      const plan = f.chat.workbench.state(f.session.id).plan;
      f.chat.workbench.update({
        sessionId: f.session.id,
        revision: plan.revision,
        steps: plan.steps.map((step) => ({ ...step, content: "Latest user-edited plan" })),
      });
      f.state.reverseDiscovery = true;
      await f.run();
      expect(bodies).toHaveLength(4);
      const firstSystem = JSON.stringify(system(bodyAt(bodies, 0), protocol));
      const firstTools = JSON.stringify(bodyAt(bodies, 0).tools);
      for (const [index, body] of bodies.entries()) {
        expect(JSON.stringify(system(body, protocol))).toBe(firstSystem);
        expect(JSON.stringify(body.tools)).toBe(firstTools);
        assertPairs(body, protocol);
        if (index)
          expect(
            history(body, protocol).slice(0, history(bodyAt(bodies, index - 1), protocol).length),
          ).toEqual(history(bodyAt(bodies, index - 1), protocol));
      }
      expect(firstSystem).not.toContain("Latest user-edited plan");
      expect(firstSystem).not.toContain("fixture diagnostic");
      expect(JSON.stringify(history(bodyAt(bodies, 1), protocol))).toContain("fixture diagnostic");
      expect(hostSections(bodyAt(bodies, 2), protocol, "diagnostics").at(-1)).toContain(
        "(No active information in this section.)",
      );
      expect(hostSections(bodyAt(bodies, 3), protocol, "diagnostics")).toHaveLength(2);
      const finalHistory = JSON.stringify(history(bodyAt(bodies, 3), protocol));
      expect(finalHistory).toContain("Latest user-edited plan");
      expect(finalHistory).toContain("Result from first");
      expect(finalHistory).toContain("Result from second");
      const parts = f.repository.getMessages(f.session.id).flatMap((item) => item.parts);
      expect(parts.filter((part) => part.type === "tool_result")).toHaveLength(2);
      expect(f.events.filter((event) => event.type === "run_completed")).toHaveLength(2);
    },
  );

  it("uses current permissions at every tool boundary despite an older stable runtime snapshot", async () => {
    const f = fixture("openai_responses");
    const bodies: WireBody[] = [];
    const executionModes: string[] = [];
    let effects = 0;
    f.append("Inspect both sources.");
    f.onApproval.current = (request) =>
      f.broker.decide({ approvalId: request.id, decision: "deny" });
    f.registry.execute.mockImplementation(
      async (_name: string, _args: unknown, context: ToolExecutionContext) => {
        executionModes.push(context.session.permissionMode);
        const decision: ApprovalDecision = await context.requestApproval(
          {
            id: randomUUID(),
            sessionId: f.session.id,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "read_file",
            summary: "Fixture read",
            detail: "No files are read by this test.",
            pathScope: null,
            commandPrefix: null,
            risk: "normal",
            createdAt: "",
          },
          context.signal,
        );
        if (decision.decision === "deny") return { output: "Denied fixture read", isError: true };
        effects++;
        return { output: "Allowed fixture read", isError: false };
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        bodies.push(JSON.parse(String(options.body)));
        if (bodies.length <= 2) {
          f.repository.updateSession(f.session.id, {
            permissionMode: bodies.length === 1 ? "request_approval" : "full_access",
          });
          return reply("openai_responses", [
            {
              id: `permission-${bodies.length}`,
              name: "read_file",
              arguments: { path: `${bodies.length}.txt` },
            },
          ]);
        }
        return reply("openai_responses", [], "Reported both actual outcomes.");
      }),
    );
    await f.run();
    expect(bodies).toHaveLength(3);
    expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    expect(executionModes).toEqual(["request_approval", "full_access"]);
    expect(effects).toBe(1);
    expect(f.events.filter((event) => event.type === "approval_required")).toHaveLength(1);
    for (const body of bodies) {
      expect(system(body, "openai_responses")).toBe(system(bodyAt(bodies, 0), "openai_responses"));
      assertPairs(body, "openai_responses");
    }
    const permissionFacts = (index: number) =>
      hostSections(bodyAt(bodies, index), "openai_responses", "permissions").map((text) =>
        JSON.parse(text.slice(text.lastIndexOf("\n\n") + 2)),
      );
    expect(permissionFacts(1).at(-1)).toMatchObject({ permission_mode: "request_approval" });
    expect(permissionFacts(2).at(-1)).toMatchObject({ permission_mode: "full_access" });
    const finalHistory = JSON.stringify(history(bodyAt(bodies, 2), "openai_responses"));
    expect(finalHistory).toContain("Denied fixture read");
    expect(finalHistory).toContain("Allowed fixture read");
    expect(f.broker.state().requests).toHaveLength(0);
  });
});
