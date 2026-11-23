import { describe, expect, it } from "vitest";
import { parseBeforeModelRequestPrompts } from "./plugin-prompt-declaration";

describe("BeforeModelRequest prompt declarations", () => {
  it("keeps the legacy texts projection while defaulting new options", () => {
    const parsed = parseBeforeModelRequestPrompts({
      BeforeModelRequest: [
        {
          hooks: [{ type: "prompt", text: "  default context  " }],
        },
      ],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.texts).toEqual(["default context"]);
    expect(parsed.prompts).toEqual([
      {
        text: "default context",
        position: "before",
        format: "context",
      },
    ]);
  });

  it("accepts explicit before/after and context/plain combinations", () => {
    const parsed = parseBeforeModelRequestPrompts({
      BeforeModelRequest: [
        {
          hooks: [
            { type: "prompt", text: "prefix", position: "before", format: "plain" },
            { type: "prompt", text: "suffix", position: "after", format: "context" },
          ],
        },
      ],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.texts).toEqual(["prefix", "suffix"]);
    expect(parsed.prompts).toEqual([
      { text: "prefix", position: "before", format: "plain" },
      { text: "suffix", position: "after", format: "context" },
    ]);
  });

  it.each([
    { text: "invalid", position: null },
    { text: "invalid", position: 1 },
    { text: "invalid", position: "" },
    { text: "invalid", format: null },
    { text: "invalid", format: 1 },
    { text: "invalid", format: "" },
  ])("fails closed for an explicitly invalid prompt option: %o", (prompt) => {
    const parsed = parseBeforeModelRequestPrompts({
      BeforeModelRequest: [{ hooks: [{ type: "prompt", ...prompt }] }],
    });

    expect(parsed.texts).toEqual([]);
    expect(parsed.prompts).toEqual([]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]?.path).toMatch(/\.(?:position|format)$/u);
  });

  it("does not treat prompt-shaped command input as an active prompt", () => {
    const parsed = parseBeforeModelRequestPrompts({
      BeforeModelRequest: [
        {
          hooks: [
            {
              type: "command",
              command: "Write-Output ignored",
              input: { type: "prompt", text: "must not inject" },
            },
          ],
        },
      ],
    });

    expect(parsed).toEqual({ texts: [], prompts: [], errors: [] });
  });
});
