import { describe, expect, it } from "vitest";
import { BoundedOutput } from "./bounded-output";

describe("BoundedOutput", () => {
  it("keeps a complete surrogate pair when the tail starts on its low code unit", () => {
    const capture = new BoundedOutput(10);
    capture.append("abcde123😀4567");

    const text = capture.text();
    expect(text).toContain("abcde");
    expect(text).toContain("😀4567");
    expect(text).toContain("OUTPUT_CAPTURE_LIMIT");
    expect(text).not.toMatch(
      /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
    );
  });
});
