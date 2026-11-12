import { describe, expect, it } from "vitest";
import type { MessagePart, SessionMessage } from "../../../shared/domain";
import { orbitTranscript } from "./orbit-transcript";

function message(
  id: string,
  parts: SessionMessage["parts"],
  role: SessionMessage["role"] = "assistant",
): SessionMessage {
  return {
    id,
    sessionId: "session",
    seq: 1,
    role,
    parts,
    createdAt: "2026-11-09T00:00:00.000Z",
  };
}

function tool(callId: string): MessagePart {
  return {
    type: "tool_call",
    callId,
    name: "read_file",
    arguments: '{"path":"sample.ts"}',
    status: "completed",
  };
}

function responsesState(): MessagePart {
  return {
    type: "responses_state",
    providerId: "provider",
    modelId: "model",
    endpointKey: "responses",
    items: [{ type: "reasoning", id: "native-reasoning", encrypted_content: "opaque" }],
  };
}

function providerState(): MessagePart {
  return {
    type: "provider_state",
    state: {
      family: "deepseek",
      protocol: "openai_chat_completions",
      providerId: "provider",
      modelId: "model",
      endpointKey: "endpoint",
      payload: { role: "assistant", content: "", reasoning_content: "Native continuation" },
    },
  };
}

describe("Orbit transcript grouping", () => {
  it("keeps provider continuation state invisible without splitting tool execution", () => {
    const first = message("first", [tool("first"), providerState()]);
    const hidden = message("hidden", [providerState()]);
    const second = message("second", [providerState(), tool("second")]);
    expect(orbitTranscript([hidden, first, hidden, second])).toEqual([
      { messages: [first, second], execution: true, showAssistantHeader: true },
    ]);
    expect(orbitTranscript([hidden])).toEqual([]);
  });

  it("groups Responses tool calls across their hidden result messages", () => {
    const user = message("user", [{ type: "text", text: "Inspect the project." }], "user");
    const first = message("first", [tool("first"), responsesState()]);
    const result = message(
      "result",
      [{ type: "tool_result", callId: "first", output: "FILE_CONTENT", isError: false }],
      "tool",
    );
    const second = message("second", [responsesState(), tool("second")]);
    const entries = orbitTranscript([user, first, result, second]);

    expect(entries).toHaveLength(2);
    expect(entries[1]).toEqual({
      messages: [first, second],
      execution: true,
      showAssistantHeader: true,
    });
    expect(entries[1]?.messages[0]).toBe(first);
    expect(entries[1]?.messages[1]).toBe(second);
  });

  it("keeps consecutive reasoning and tool messages in original sequence", () => {
    const reasoning = message("reasoning", [
      { type: "reasoning", text: "Check the configuration first." },
      responsesState(),
    ]);
    const metadata = message("metadata", [
      responsesState(),
      { type: "text", text: " \n " },
      { type: "reasoning", text: "" },
    ]);
    const execution = message("execution", [
      { type: "text", text: "\n" },
      tool("call"),
      responsesState(),
    ]);
    const source = [reasoning, metadata, execution];
    const before = structuredClone(source);
    const entries = orbitTranscript(source);

    expect(entries).toEqual([
      {
        messages: [reasoning, execution],
        execution: true,
        showAssistantHeader: true,
      },
    ]);
    expect(source).toEqual(before);
    expect(entries[0]?.messages[0]).toBe(reasoning);
    expect(entries[0]?.messages[1]).toBe(execution);
  });

  it.each([
    { type: "text", text: "A substantive progress update." },
    { type: "error", message: "The command failed." },
    {
      type: "attachment",
      attachment: {
        kind: "file",
        name: "result.txt",
        mimeType: "text/plain",
        size: 0,
        dataUrl: "",
      },
    },
    {
      type: "run_summary",
      summary: { runId: "run", durationMs: 1000, toolCount: 1, fileChanges: [] },
    },
  ] satisfies MessagePart[])(
    "keeps a substantive $type message outside the execution group",
    (part) => {
      const first = message("first", [tool("first"), responsesState()]);
      const substantive = message("substantive", [part, responsesState()]);
      const second = message("second", [tool("second"), responsesState()]);
      const entries = orbitTranscript([first, substantive, second]);

      expect(entries.map((entry) => entry.execution)).toEqual([true, false, true]);
      expect(entries[1]?.messages).toEqual([substantive]);
      expect(entries[1]?.messages[0]).toBe(substantive);
      expect(entries.map((entry) => entry.showAssistantHeader)).toEqual([true, false, false]);
    },
  );

  it("does not fold a mixed text and tool response into the execution group", () => {
    const mixed = message("mixed", [
      { type: "text", text: "I will inspect this file." },
      tool("mixed"),
      responsesState(),
    ]);

    expect(orbitTranscript([mixed])).toEqual([
      { messages: [mixed], execution: false, showAssistantHeader: true },
    ]);
  });

  it("keeps a single Agent heading per user turn despite invisible messages", () => {
    const metadata = () => message("metadata", [responsesState()]);
    const first = message("first", [tool("first"), responsesState()]);
    const answer = message("answer", [{ type: "text", text: "The first result." }]);
    const user = message("user", [{ type: "text", text: "Continue." }], "user");
    const second = message("second", [{ type: "text", text: "The next result." }]);
    const later = message("later", [tool("later")]);
    const entries = orbitTranscript([metadata(), first, answer, user, metadata(), second, later]);

    expect(entries.map((entry) => entry.messages[0]?.id)).toEqual([
      "first",
      "answer",
      "user",
      "second",
      "later",
    ]);
    expect(entries.map((entry) => entry.showAssistantHeader)).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
  });

  it("ignores hidden-only history without creating an empty execution group", () => {
    expect(
      orbitTranscript([
        message("metadata", [responsesState()]),
        message("empty", []),
        message("whitespace", [{ type: "reasoning", text: " \n " }]),
      ]),
    ).toEqual([]);
  });
});
