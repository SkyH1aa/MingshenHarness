import { describe, expect, it, vi } from "vitest";
import type { ActivityEvent, SessionMessage } from "../../../shared/domain";
import {
  activityDetailsText,
  collectActiveToolDetails,
  collectToolDetails,
  formatToolArguments,
  toolDetailsForActivity,
  toolDetailsForMessage,
} from "./activity-details";

vi.mock("../i18n/index", () => ({
  tr: (value: string) => value,
  getLocale: () => "zh-CN",
}));

function activity(id: string): ActivityEvent {
  return {
    id,
    sessionId: "session",
    runId: "run",
    toolName: "run_command",
    kind: "command",
    title: "Run command",
    detail: "Short command preview",
    status: "completed",
    startedAt: "2026-11-09T00:00:00.000Z",
    completedAt: "2026-11-09T00:00:01.000Z",
    durationMs: 1000,
    fileChange: null,
  };
}

function message(
  parts: SessionMessage["parts"],
  overrides: Partial<SessionMessage> = {},
): SessionMessage {
  return {
    id: "message",
    sessionId: "session",
    seq: 1,
    role: "assistant",
    parts,
    createdAt: "2026-11-09T00:00:00.000Z",
    ...overrides,
  };
}

describe("activity detail disclosure", () => {
  it.each(["call", "provider:call:part"])(
    "links the complete %s arguments and output through the exact run prefix",
    (callId) => {
      const command = `command ${"argument ".repeat(300)}ARGUMENT_TAIL`;
      const output = `${"output detail\n".repeat(1500)}\nOUTPUT_TAIL`;
      const argumentsText = JSON.stringify({ command, timeout_ms: 120000 });
      const tools = collectToolDetails([
        message([
          {
            type: "tool_call",
            callId,
            name: "run_command",
            arguments: argumentsText,
            status: "completed",
          },
        ]),
        message([{ type: "tool_result", callId, output, isError: true }], {
          id: "result",
          seq: 2,
          createdAt: "2026-11-09T00:00:01.000Z",
        }),
      ]);
      const details = activityDetailsText(activity(`run:${callId}`), tools);
      expect(details).toContain(JSON.stringify(JSON.parse(argumentsText), null, 2));
      expect(details).toContain(output);
      expect(details).toContain("ARGUMENT_TAIL");
      expect(details).toContain("OUTPUT_TAIL");
    },
  );

  it("supports a bare call id and retains original diagnostics without a tool match", () => {
    const tools = collectToolDetails([
      message([
        {
          type: "tool_call",
          callId: "call",
          name: "run_command",
          arguments: "{}",
          status: "running",
        },
      ]),
    ]);
    expect(activityDetailsText(activity("call"), tools)).toContain("run_command");
    const retry = { ...activity("run:retry:1"), detail: "First line\n\nLast line" };
    expect(activityDetailsText(retry, tools)).toBe("Run command\n\nFirst line\n\nLast line");
  });

  it("keeps output collected before a call and preserves invalid streamed arguments", () => {
    const tools = collectToolDetails([
      message([{ type: "tool_result", callId: "call", output: "", isError: false }]),
      message([
        {
          type: "tool_call",
          callId: "call",
          name: "run_command",
          arguments: '{"command":',
          status: "running",
        },
      ]),
    ]);
    expect(toolDetailsForMessage(tools, "message", "call")).toMatchObject({
      name: "run_command",
      arguments: '{"command":',
      output: "",
      isError: false,
    });
    expect(formatToolArguments('{"command":')).toBe('{"command":');
    expect(formatToolArguments("[]")).toBe("[]");
    expect(formatToolArguments("null")).toBe("null");
    expect(
      activityDetailsText({ ...activity("run:call"), status: "running", completedAt: null }, tools),
    ).toContain('{"command":');
  });

  it("keeps reused provider call IDs associated with each persisted occurrence", () => {
    const callId = "provider:shared-call";
    const tools = collectToolDetails([
      message(
        [
          {
            type: "tool_call",
            callId,
            name: "run_command",
            arguments: '{"command":"first-command"}',
            status: "completed",
          },
        ],
        { id: "first-call" },
      ),
      message([{ type: "tool_result", callId, output: "FIRST_OUTPUT", isError: true }], {
        id: "first-result",
        seq: 2,
        createdAt: "2026-11-09T00:00:01.000Z",
      }),
      message([{ type: "text", text: "Run a different command." }], {
        id: "next-user",
        seq: 3,
        role: "user",
        createdAt: "2026-11-09T00:00:02.000Z",
      }),
      message(
        [
          {
            type: "tool_call",
            callId,
            name: "run_command",
            arguments: '{"command":"second-command"}',
            status: "completed",
          },
        ],
        { id: "second-call", seq: 4, createdAt: "2026-11-09T00:00:03.000Z" },
      ),
      message([{ type: "tool_result", callId, output: "SECOND_OUTPUT", isError: false }], {
        id: "second-result",
        seq: 5,
        createdAt: "2026-11-09T00:00:04.000Z",
      }),
    ]);
    const firstActivity = activity(`run:${callId}`);
    const secondActivity = {
      ...activity(`next-run:${callId}`),
      runId: "next-run",
      startedAt: "2026-11-09T00:00:03.000Z",
      completedAt: "2026-11-09T00:00:04.000Z",
    };
    expect(activityDetailsText(firstActivity, tools)).toContain("FIRST_OUTPUT");
    expect(activityDetailsText(firstActivity, tools)).toContain("first-command");
    expect(activityDetailsText(firstActivity, tools)).not.toContain("SECOND_OUTPUT");
    expect(activityDetailsText(secondActivity, tools)).toContain("SECOND_OUTPUT");
    expect(activityDetailsText(secondActivity, tools)).not.toContain("first-command");
    expect(toolDetailsForMessage(tools, "first-call", callId)).toMatchObject({
      output: "FIRST_OUTPUT",
      isError: true,
    });
    expect(toolDetailsForActivity(firstActivity, tools)).toBe(
      toolDetailsForMessage(tools, "first-call", callId),
    );
    expect(toolDetailsForActivity(secondActivity, tools)).toBe(
      toolDetailsForMessage(tools, "second-call", callId),
    );
  });

  it("never carries an earlier output into a running call or a streamed preparation", () => {
    const callId = "shared-call";
    const first = message([
      {
        type: "tool_call",
        callId,
        name: "run_command",
        arguments: '{"command":"first-command"}',
        status: "completed",
      },
    ]);
    const result = message(
      [{ type: "tool_result", callId, output: "STALE_OUTPUT", isError: true }],
      { id: "old-result", seq: 2, createdAt: "2026-11-09T00:00:01.000Z" },
    );
    const user = message([{ type: "text", text: "Next command." }], {
      id: "next-user",
      seq: 3,
      role: "user",
      createdAt: "2026-11-09T00:00:02.000Z",
    });
    const running = {
      ...activity(`next-run:${callId}`),
      runId: "next-run",
      status: "running" as const,
      startedAt: "2026-11-09T00:00:03.000Z",
      completedAt: null,
    };
    const preparing = collectToolDetails([first, result, user]);
    expect(toolDetailsForActivity(running, preparing)).toBeUndefined();
    expect(activityDetailsText(running, preparing)).not.toContain("STALE_OUTPUT");
    const tools = collectToolDetails([
      first,
      result,
      user,
      message(
        [
          {
            type: "tool_call",
            callId,
            name: "run_command",
            arguments: '{"command":"new-command"}',
            status: "running",
          },
        ],
        { id: "new-call", seq: 4, createdAt: running.startedAt },
      ),
    ]);
    expect(toolDetailsForActivity(running, tools)).toBe(
      toolDetailsForMessage(tools, "new-call", callId),
    );
    expect(toolDetailsForMessage(tools, "new-call", callId)?.output).toBeUndefined();
    expect(activityDetailsText(running, tools)).toContain("new-command");
    expect(activityDetailsText(running, tools)).not.toContain("STALE_OUTPUT");
  });

  it("keeps a persistent command's initial result when its activity completes after polling", () => {
    const tools = collectToolDetails([
      message([
        {
          type: "tool_call",
          callId: "pipe",
          name: "exec_command",
          arguments: '{"command":"long-running-command"}',
          status: "completed",
        },
      ]),
      message([{ type: "tool_result", callId: "pipe", output: "INITIAL_OUTPUT", isError: false }], {
        id: "initial-result",
        seq: 2,
        createdAt: "2026-11-09T00:00:01.000Z",
      }),
    ]);
    const completed = {
      ...activity("run:pipe"),
      toolName: "exec_command",
      completedAt: "2026-11-09T00:00:10.000Z",
    };
    expect(toolDetailsForActivity(completed, tools)).toBe(
      toolDetailsForMessage(tools, "message", "pipe"),
    );
    expect(activityDetailsText(completed, tools)).toContain("INITIAL_OUTPUT");
  });

  it("only treats a running tool without a persisted result as active", () => {
    const callId = "retry-visible";
    const tools = collectToolDetails([
      message([
        {
          type: "tool_call",
          callId,
          name: "write_file",
          arguments: '{"path":"notes.md","content":"complete"}',
          status: "completed",
        },
      ]),
      message([{ type: "tool_result", callId, output: "written", isError: false }], {
        id: "result",
        seq: 2,
        createdAt: "2026-11-09T00:00:01.000Z",
      }),
    ]);
    const running = {
      ...activity(`run:${callId}`),
      toolName: "write_file",
      status: "running" as const,
      completedAt: null,
    };
    expect(collectActiveToolDetails([running], tools).size).toBe(0);

    const pendingCallId = "retry-pending";
    const pendingTools = collectToolDetails([
      message(
        [
          {
            type: "tool_call",
            callId: pendingCallId,
            name: "write_file",
            arguments: '{"path":"pending.md","content":"pending"}',
            status: "running",
          },
        ],
        { id: "pending-call", seq: 2, createdAt: "2026-11-09T00:00:01.000Z" },
      ),
    ]);
    const pending = {
      ...running,
      id: `run:${pendingCallId}`,
      startedAt: "2026-11-09T00:00:01.000Z",
    };
    const active = collectActiveToolDetails([pending], pendingTools);
    expect(active).toHaveLength(1);
    expect([...active][0]).toBe(toolDetailsForActivity(pending, pendingTools));
  });

  it("does not guess between ambiguous calls or attach another session's result", () => {
    const call = {
      type: "tool_call" as const,
      callId: "shared",
      name: "run_command",
      arguments: "{}",
      status: "running" as const,
    };
    const ambiguous = collectToolDetails([
      message([call], { id: "first" }),
      message([call], { id: "second", seq: 2 }),
    ]);
    expect(toolDetailsForActivity(activity("run:shared"), ambiguous)).toBeUndefined();
    const tools = collectToolDetails([
      message([call], { id: "own-call" }),
      message([call], { id: "other-call", sessionId: "other" }),
      message([{ type: "tool_result", callId: "shared", output: "OTHER_OUTPUT", isError: true }], {
        id: "other-result",
        sessionId: "other",
        seq: 2,
      }),
    ]);
    expect(toolDetailsForActivity(activity("run:shared"), tools)).toBe(
      toolDetailsForMessage(tools, "own-call", "shared"),
    );
    expect(activityDetailsText(activity("run:shared"), tools)).not.toContain("OTHER_OUTPUT");
    expect(toolDetailsForMessage(tools, "other-call", "shared")?.output).toBe("OTHER_OUTPUT");
    const duplicate = collectToolDetails([message([call, call])]);
    expect(toolDetailsForMessage(duplicate, "message", "shared")).toBeUndefined();
  });

  it("does not reuse an unresolved call across a later user turn", () => {
    const tools = collectToolDetails([
      message([
        {
          type: "tool_call",
          callId: "shared",
          name: "write_file",
          arguments: '{"path":"old.txt","content":"old content"}',
          status: "pending",
        },
      ]),
      message([{ type: "text", text: "Write a new file." }], {
        id: "next-user",
        seq: 2,
        role: "user",
        createdAt: "2026-11-09T00:00:02.000Z",
      }),
    ]);
    const preparing = {
      ...activity("next-run:shared"),
      runId: "next-run",
      toolName: "write_file",
      status: "running" as const,
      startedAt: "2026-11-09T00:00:03.000Z",
      completedAt: null,
    };
    expect(toolDetailsForActivity(preparing, tools)).toBeUndefined();
    expect(activityDetailsText(preparing, tools)).not.toContain("old content");
  });

  it.each([
    '{"id":9007199254740993}',
    '{"path":"first","path":"second"}',
    '{"value":-0}',
    '{"value":1e400}',
    '{"2":"two","1":"one"}',
    '{"unicode":"\\u0041","slash":"\\/"}',
  ])("retains exact source JSON when pretty printing would change %s", (value) => {
    expect(formatToolArguments(value)).toBe(value);
  });

  it("formats ordinary JSON without changing spaces, escapes or punctuation inside strings", () => {
    const value = JSON.stringify({
      command: 'printf "a b"; echo \\"quoted\\"',
      nested: [{ text: "braces { }, comma, colon: and\nnewlines" }, null],
      timeout_ms: 120000,
    });
    expect(formatToolArguments(value)).toBe(JSON.stringify(JSON.parse(value), null, 2));
  });
});
