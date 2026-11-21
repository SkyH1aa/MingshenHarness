import { describe, expect, it } from "vitest";
import { type AutoDriveResult, autoDriveChoicePrompt, parseAutoDriveResult } from "./autodrive";

const proposal = {
  title: "Extend verification",
  summary: "Add an end-to-end verification path for the completed workflow.",
  rationale: "The plan is complete, but the current checks leave integration risk.",
  steps: ["Inspect the existing workflow", "Add a focused integration check"],
  risks: ["The check may duplicate an existing scenario."],
  verification: ["Run the targeted test and inspect the resulting diff."],
};

describe("AutoDrive payloads", () => {
  it("parses three distinct proposals from a JSON code fence", () => {
    const result = parseAutoDriveResult(
      `\`\`\`json\n${JSON.stringify({
        suggestions: [
          proposal,
          { ...proposal, title: "Harden recovery" },
          { ...proposal, title: "Improve operator feedback" },
        ],
      })}\n\`\`\``,
      { sessionId: "session", modelId: "model", generatedAt: "2026-11-20T00:00:00.000Z" },
    );
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]?.id).toBe("suggestion-1");
  });

  it("rejects duplicate titles and malformed payloads", () => {
    expect(() =>
      parseAutoDriveResult(
        JSON.stringify({
          suggestions: [proposal, proposal, { ...proposal, title: "Third direction" }],
        }),
        { sessionId: "session", modelId: "model" },
      ),
    ).toThrow("distinct titles");
    expect(() =>
      parseAutoDriveResult(JSON.stringify({ suggestions: [proposal] }), {
        sessionId: "session",
        modelId: "model",
      }),
    ).toThrow("invalid proposal payload");
  });

  it("rejects unsupported control characters while allowing normal whitespace", () => {
    const input = { sessionId: "session", modelId: "model" };
    const suggestions = [
      proposal,
      { ...proposal, title: "Harden recovery" },
      { ...proposal, title: "Improve operator feedback" },
    ];
    expect(() => parseAutoDriveResult(JSON.stringify({ suggestions }), input)).not.toThrow();
    expect(() =>
      parseAutoDriveResult(
        JSON.stringify({
          suggestions: [
            { ...proposal, summary: `${proposal.summary}\x01` },
            ...suggestions.slice(1),
          ],
        }),
        input,
      ),
    ).toThrow("unsupported control characters");
  });

  it("turns a selected proposal into composer text without claiming execution", () => {
    const result: AutoDriveResult = {
      sessionId: "session",
      modelId: "model",
      generatedAt: "",
      suggestions: [
        {
          id: "suggestion-1",
          ...proposal,
        },
      ],
    };
    const prompt = autoDriveChoicePrompt(result, "suggestion-1");
    expect(prompt).toContain("采用 AutoDrive 的后续方案");
    expect(prompt).toContain("先核对实际代码");
    expect(prompt).not.toContain("已执行");
  });
});
