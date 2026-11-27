import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { withToolOutcome } from "../../shared/tool-outcome";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import type { ToolExecutionResult } from "../tools/tool-registry";
import { ChatService } from "./chat-service";
import { ToolOutputStore } from "./tool-output-store";

const databases: ReturnType<typeof openDatabase>[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
});

function success(output = "written"): ToolExecutionResult {
  return withToolOutcome({
    output,
    isError: false,
    status: "success",
    effect: "confirmed",
    retryable: false,
    codes: [],
    validation: { status: "validated", source: "builtin" },
    evidence: [],
  });
}

function fixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = new Repository(database);
  const session = repository.insertSession({
    title: "Tool durability fixture",
    providerId: null,
    modelId: null,
    agentProfileId: "primary",
    workspacePath: "C:\\Fixture",
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
  });
  const emit = vi.fn();
  const hookRun = vi.fn(async () => []);
  const chat = new ChatService({
    repository,
    emit,
    pluginHookService: { run: hookRun },
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    performToolCall: () => Promise<ToolExecutionResult>;
    runPluginHooks: (
      event: string,
      session: SessionView,
      runId: string,
      signal: AbortSignal,
    ) => Promise<void>;
    executeToolCall(input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      toolCall: { index: number; callId: string; name: string; arguments: string };
      onOutcomeSettled?: (result: ToolExecutionResult) => void;
    }): Promise<ToolExecutionResult>;
    persistToolResult(
      sessionId: string,
      runId: string,
      callId: string,
      result: ToolExecutionResult,
    ): void;
    executionSafety: {
      begin(sessionId: string, runId: string): void;
      inspect(runId: string): { resolved: boolean } | undefined;
    };
    withExternalWriter<T>(
      session: SessionView,
      runId: string,
      signal: AbortSignal,
      execute: () => Promise<T>,
    ): Promise<T>;
  };
  internal.executionSafety.begin(session.id, "run");
  const input = {
    session,
    runId: "run",
    signal: new AbortController().signal,
    toolCall: { index: 0, callId: "call", name: "write_file", arguments: "{}" },
  };
  return { database, repository, session, internal, input, emit, hookRun };
}

describe("tool result durability", () => {
  it("rolls back eviction and the new output when the retained-output index cannot be stored", () => {
    const f = fixture();
    const store = new ToolOutputStore(f.repository);
    for (let index = 0; index < 40; index++)
      store.save(f.session.id, `call-${index}`, `retained-${index}`);
    f.database.exec(`
      create trigger fail_output_index before insert on app_settings
      when new.key like 'tool.output.%.index'
      begin select raise(abort, 'fixture retention failure'); end;
    `);

    expect(() => store.save(f.session.id, "new-call", "new output")).toThrow(
      "fixture retention failure",
    );
    expect(store.read(f.session.id, { call_id: "call-0" })).toContain("retained-0");
    expect(() => store.read(f.session.id, { call_id: "new-call" })).toThrow("NOT_FOUND");
  });

  it("returns an uncertain recovery result when checkpoint settlement fails after execution", async () => {
    const f = fixture();
    const execute = vi.spyOn(f.internal, "performToolCall").mockResolvedValue(success());
    vi.spyOn(f.internal, "runPluginHooks").mockResolvedValue();
    const result = await f.internal.executeToolCall({
      ...f.input,
      onOutcomeSettled: () => {
        throw new Error("fixture checkpoint failure");
      },
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(result.output).toContain("TOOL_OUTCOME_SETTLEMENT_FAILED");
    expect(result.outcome).toMatchObject({ effect: "uncertain", retryable: false, isError: true });
    expect(f.internal.executionSafety.inspect("run")?.resolved).toBe(false);
    expect(f.repository.getSetting(`workbench.recovery.${f.session.id}`)).toMatchObject({
      uncertain: ["call"],
    });
  });

  it("preserves the completed outcome and reports a capture gap when large-output storage fails", async () => {
    const f = fixture();
    vi.spyOn(f.internal, "performToolCall").mockResolvedValue(success("x".repeat(90_000)));
    vi.spyOn(f.internal, "runPluginHooks").mockResolvedValue();
    vi.spyOn(ToolOutputStore.prototype, "save").mockImplementation(() => {
      throw new Error("fixture output storage failure");
    });

    const result = await f.internal.executeToolCall(f.input);
    expect(result.isError).toBe(false);
    expect(result.outcome).toMatchObject({ status: "success", effect: "confirmed" });
    expect(result.outcome?.codes).toContain("TOOL_OUTPUT_RETENTION_FAILED");
    expect(result.output).toContain("TOOL_OUTPUT_RETENTION_FAILED");
    expect(result.output).not.toContain("LARGE_OUTPUT_RETAINED");
    expect(result.output.length).toBeLessThan(71_000);
  });

  it("atomically replaces a failed message insert with one bounded recovery result", () => {
    const f = fixture();
    const append = f.repository.appendMessage.bind(f.repository);
    vi.spyOn(f.repository, "appendMessage")
      .mockImplementation(append)
      .mockImplementationOnce((input) => {
        append(input);
        throw new Error("fixture failure after message insert");
      });
    const result = success();

    f.internal.persistToolResult(f.session.id, "run", "call", result);
    const results = f.repository
      .getMessages(f.session.id)
      .flatMap((message) => message.parts.filter((part) => part.type === "tool_result"));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      callId: "call",
      isError: true,
      outcome: { effect: "uncertain", retryable: false },
    });
    expect(results[0]?.output).toContain("TOOL_RESULT_PERSISTENCE_FAILED");
    expect(f.internal.executionSafety.inspect("run")?.resolved).toBe(false);
  });

  it("keeps an already stored result when the live notification fails", () => {
    const f = fixture();
    f.emit.mockImplementation(() => {
      throw new Error("fixture event transport failure");
    });

    expect(() =>
      f.internal.persistToolResult(f.session.id, "run", "call", success()),
    ).not.toThrow();
    const messages = f.repository.getMessages(f.session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts[0]).toMatchObject({ callId: "call", isError: false });
  });

  it("retains a barrier for structured Hook uncertainty without matching error text", async () => {
    const f = fixture();
    const hookOutcome = {
      ...success().outcome,
      output: "ordinary service error",
      isError: true,
      status: "failed",
      effect: "uncertain",
    };
    f.hookRun.mockResolvedValue([
      { status: "failed", detail: "ordinary service error", outcome: hookOutcome },
    ] as never[]);
    vi.spyOn(f.repository, "listSessionExtensionIds").mockReturnValue(["plugin"]);
    vi.spyOn(f.repository, "getExtension").mockReturnValue({
      id: "plugin",
      enabled: true,
      type: "plugin",
    } as ReturnType<Repository["getExtension"]>);
    vi.spyOn(f.internal, "withExternalWriter").mockImplementation(
      async (_session, _runId, _signal, execute) => await execute(),
    );

    await f.internal.runPluginHooks("Stop", f.session, "run", f.input.signal);
    expect(f.internal.executionSafety.inspect("run")?.resolved).toBe(false);
    expect(f.repository.getSetting(`workbench.recovery.${f.session.id}`)).toMatchObject({
      uncertain: ["hook:Stop"],
    });
  });
});
