import { describe, expect, it } from "vitest";
import { parseCoordinationQaVerdict } from "./coordination";

describe("coordination QA verdict", () => {
  it("accepts a bounded structured verdict", () => {
    expect(
      parseCoordinationQaVerdict(
        '```json\n{"verdict":"passed","summary":"Checks passed","evidence":["pnpm test","typecheck"]}\n```',
      ),
    ).toEqual({
      verdict: "passed",
      summary: "Checks passed",
      evidence: ["pnpm test", "typecheck"],
    });
  });

  it("does not infer a pass from prose or missing evidence", () => {
    expect(() => parseCoordinationQaVerdict("Everything looks good")).toThrow("structured JSON");
    expect(() =>
      parseCoordinationQaVerdict('{"verdict":"passed","summary":"Looks good","evidence":[]}'),
    ).toThrow("evidence");
  });

  it("removes NULs from bounded QA text", () => {
    expect(
      parseCoordinationQaVerdict(
        JSON.stringify({
          verdict: "passed",
          summary: "Checks\u0000 passed",
          evidence: ["a\u0000b"],
        }),
      ),
    ).toEqual({ verdict: "passed", summary: "Checks passed", evidence: ["ab"] });
  });
});
