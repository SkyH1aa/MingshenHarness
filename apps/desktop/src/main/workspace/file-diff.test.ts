import { describe, expect, it } from "vitest";
import { createFileDiff } from "./file-diff";

describe("createFileDiff", () => {
  it("returns changed line counts and context", () => {
    const result = createFileDiff(
      ["one", "two", "three", "four", "five"].join("\n"),
      ["one", "two", "THREE", "four", "five"].join("\n"),
    );

    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.diff?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "removed", oldLine: 3, text: "three" }),
        expect.objectContaining({ type: "added", newLine: 3, text: "THREE" }),
        expect.objectContaining({ type: "context", oldLine: 4, newLine: 4, text: "four" }),
      ]),
    );
  });

  it("treats a new file as additions", () => {
    const result = createFileDiff("", "alpha\nbeta");

    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(0);
    expect(result.diff?.lines.every((line) => line.type === "added")).toBe(true);
  });

  it("marks very large previews as truncated without changing counts", () => {
    const before = Array.from({ length: 200 }, (_, index) => `before-${index}`).join("\n");
    const after = Array.from({ length: 200 }, (_, index) => `after-${index}`).join("\n");
    const result = createFileDiff(before, after);

    expect(result.additions).toBe(200);
    expect(result.deletions).toBe(200);
    expect(result.diff?.truncated).toBe(true);
  });
});
