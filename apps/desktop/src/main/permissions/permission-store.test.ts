import { describe, expect, it } from "vitest";
import type { ApprovalRequest } from "../../shared/domain";
import { PermissionStore } from "./permission-store";

describe("Approval scope security", () => {
  it("does not approve chained commands or similarly named executables", () => {
    const store = new PermissionStore();
    store.remember(
      "s",
      { commandPrefix: "git status", pathScope: null, toolName: "run_command" } as ApprovalRequest,
      { approvalId: "a", decision: "allow_session" },
    );
    expect(store.hasCommand("s", "git status --short")).toBe(true);
    for (const command of [
      "git status; Remove-Item a",
      "git status && whoami",
      "git status | iex",
      "git status\nwhoami",
      "git status $(whoami)",
      "git status-malicious",
    ])
      expect(store.hasCommand("s", command)).toBe(false);
    expect(store.hasCommand("other-session", "git status")).toBe(false);
  });
});
