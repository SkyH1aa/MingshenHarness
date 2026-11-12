import { describe, expect, it } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";

describe("bounded parent task-tree output", () => {
  function fixture() {
    const db = openDatabase(":memory:");
    const repo = new Repository(db);
    const create = (parentSessionId: string | null = null) =>
      repo.insertSession({
        title: "Fixture",
        providerId: null,
        modelId: null,
        agentProfileId: "primary",
        parentSessionId,
        workspacePath: null,
        systemPrompt: "",
        reasoningLevel: null,
        permissionMode: "request_approval",
        executionMode: "host",
        patchOnly: false,
      });
    return { db, repo, create };
  }
  it("only reads the selected parent's child, preserves output order and excludes user attachments", () => {
    const { db, repo, create } = fixture();
    try {
      const parent = create(),
        child = create(parent.id),
        other = create();
      repo.appendMessage({
        sessionId: child.id,
        role: "user",
        parts: [{ type: "text", text: "Do not preview the delegation prompt" }],
      });
      repo.appendMessage({
        sessionId: child.id,
        role: "assistant",
        parts: [
          { type: "reasoning", text: "Inspect evidence" },
          {
            type: "tool_call",
            callId: "c",
            name: "read_file",
            arguments: '{"private":"omitted"}',
            status: "completed",
          },
        ],
      });
      repo.appendMessage({
        sessionId: child.id,
        role: "tool",
        parts: [{ type: "tool_result", callId: "c", output: "Actual evidence", isError: false }],
      });
      repo.appendMessage({
        sessionId: child.id,
        role: "assistant",
        parts: [{ type: "text", text: "Final verified result" }],
      });
      const preview = repo.subagentOutput(parent.id, child.id);
      expect(preview.parts.map((part) => part.text)).toEqual([
        "Inspect evidence",
        "",
        "Actual evidence",
        "Final verified result",
      ]);
      expect(preview.truncated).toBe(false);
      expect(JSON.stringify(preview)).not.toMatch(/delegation prompt|private|omitted/);
      expect(() => repo.subagentOutput(other.id, child.id)).toThrow("不属于");
      expect(() => repo.subagentOutput(parent.id, parent.id)).toThrow();
      expect(() => repo.subagentOutput(parent.id, "missing")).toThrow();
    } finally {
      db.close();
    }
  });
  it("returns a bounded recent tail and flags truncation without loading full message history", () => {
    const { db, repo, create } = fixture();
    try {
      const parent = create(),
        child = create(parent.id);
      for (let i = 0; i < 30; i++)
        repo.appendMessage({
          sessionId: child.id,
          role: "assistant",
          parts: [{ type: "text", text: `${i}:${"x".repeat(14000)}END_${i}` }],
        });
      const preview = repo.subagentOutput(parent.id, child.id);
      expect(preview.truncated).toBe(true);
      expect(preview.parts.length).toBeLessThanOrEqual(24);
      expect(
        preview.parts.reduce((total, part) => total + part.text.length, 0),
      ).toBeLessThanOrEqual(48000);
      expect(preview.parts.at(-1)?.text).toContain("END_29");
      expect(preview.parts.at(-1)?.text.length).toBe(12000);
    } finally {
      db.close();
    }
  });
});
