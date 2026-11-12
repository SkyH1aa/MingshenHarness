import { describe, expect, it } from "vitest";
import { resolveSubagentModelId, supportsSubagentModel } from "./agent-profile-model";

describe("subagent model configuration", () => {
  it.each([
    ["primary", false],
    ["plan", false],
    ["subagent", true],
    ["all", true],
  ] as const)("recognizes %s profiles as subagent-capable: %s", (role, expected) => {
    expect(supportsSubagentModel(role)).toBe(expected);
  });

  it.each(["subagent", "all"] as const)("lets %s profiles override the parent model", (role) => {
    expect(resolveSubagentModelId(role, "dedicated-model", "main-model")).toBe("dedicated-model");
  });

  it.each(["subagent", "all"] as const)("lets %s profiles inherit the parent model", (role) => {
    expect(resolveSubagentModelId(role, null, "main-model")).toBe("main-model");
  });

  it.each(["primary", "plan"] as const)(
    "does not use a %s profile's model as a child override",
    (role) => {
      expect(resolveSubagentModelId(role, "unrelated-model", "main-model")).toBe("main-model");
    },
  );
});
