import { describe, expect, it } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ExecutionSafetyService } from "./execution-safety-service";

describe("execution recovery enforcement", () => {
  it("deduplicates confirmed recovery operations and blocks mutations until real inspection and explicit resolution", () => {
    const db = openDatabase(":memory:"),
      repo = new Repository(db),
      guard = new ExecutionSafetyService(repo);
    try {
      guard.begin("s", "a");
      guard.completed(
        "s",
        "a",
        "confirmed",
        "write_file",
        { path: "x", content: "one" },
        { output: "written", isError: false },
        true,
      );
      expect(guard.before("a", "write_file", { path: "x", content: "one" }, true)).toBeNull();
      repo.setSetting("workbench.checkpoint.s", {
        state: "interrupted",
        uncertainTools: [{ callId: "maybe", state: "executing" }],
      });
      guard.begin("s", "b");
      expect(
        guard.before("b", "write_file", { content: "one", path: "x" }, true)?.output,
      ).toContain("NOT replayed");
      expect(guard.before("b", "run_command", { command: "npm install" }, true)?.output).toContain(
        "RECOVERY_INSPECTION_REQUIRED",
      );
      expect(guard.canResolve("b", ["invented"])).toBe(false);
      guard.completed(
        "s",
        "b",
        "inspection",
        "read_file",
        { path: "x" },
        { output: "one", isError: false },
        false,
      );
      expect(guard.canResolve("b", ["inspection"])).toBe(true);
      repo.setSetting("workbench.checkpoint.s", { state: "running", uncertainTools: [] });
      guard.finish("b");
      guard.begin("s", "retry");
      expect(guard.inspect("retry")?.uncertain).toContain("maybe");
      expect(
        guard.before("retry", "write_file", { path: "x", content: "one" }, true)?.output,
      ).toContain("NOT replayed");
      expect(
        guard.before("retry", "run_command", { command: "npm install" }, true)?.output,
      ).toContain("RECOVERY_INSPECTION_REQUIRED");
      guard.completed(
        "s",
        "retry",
        "inspection-2",
        "list_files",
        {},
        { output: "x", isError: false },
        false,
      );
      expect(guard.canResolve("retry", ["inspection-2"])).toBe(true);
      guard.resolve("retry");
      expect(guard.before("retry", "write_file", { path: "x", content: "two" }, true)).toBeNull();
      guard.resolve("b");
      expect(guard.before("b", "write_file", { path: "x", content: "two" }, true)).toBeNull();
    } finally {
      db.close();
    }
  });
});
