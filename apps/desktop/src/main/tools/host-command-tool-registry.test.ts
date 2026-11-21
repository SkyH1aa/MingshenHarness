import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import type { NativeSandboxService } from "../workspace/native-sandbox-service";
import { HostCommandService } from "./host-command-service";
import type { PersistentCommandService } from "./persistent-command-service";
import { type ToolExecutionContext, ToolRegistry } from "./tool-registry";

function fakeChild(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid: 7654,
    exitCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    unref: vi.fn(),
  }) as unknown as ChildProcess;
}

function contextFixture(controller = new AbortController()): ToolExecutionContext {
  return {
    session: {
      id: "host-session",
      title: "Host command",
      workspacePath: process.cwd(),
      permissionMode: "full_access",
      executionMode: "host",
    } as SessionView,
    runId: "host-run",
    toolCallId: "host-call",
    toolName: "run_command",
    signal: controller.signal,
    permissions: new PermissionStore(),
    requestApproval: async (request) => ({
      approvalId: request.id,
      decision: "allow_once",
    }),
  };
}

describe("ToolRegistry host command cleanup", () => {
  it("returns a bounded cleanup failure and retains it until recovery confirmation", async () => {
    const child = fakeChild();
    const stdout = new PassThrough();
    Object.defineProperty(child, "stdout", { value: stdout });
    const output = `H${"x".repeat(80_000)}L`;
    const controller = new AbortController();
    const hostCommands = new HostCommandService({
      spawn: vi.fn(() => {
        queueMicrotask(() => {
          stdout.write(output);
          controller.abort();
        });
        return child;
      }),
      terminate: vi.fn(async () => {
        throw new Error("Access is denied.");
      }),
    });
    const commands = {
      list: vi.fn(() => []),
      cancelRun: vi.fn(async () => undefined),
      confirmRunStopped: vi.fn(() => 0),
      shutdown: vi.fn(async () => undefined),
    } as unknown as PersistentCommandService;
    const registry = new ToolRegistry(
      {
        cancelRun: vi.fn(async () => undefined),
        confirmRunStopped: vi.fn(() => 0),
        shutdown: vi.fn(async () => undefined),
      } as unknown as NativeSandboxService,
      commands,
      hostCommands,
    );

    const result = await registry.execute(
      "run_command",
      { command: "Write-Output hello" },
      contextFixture(controller),
    );

    expect(result).toMatchObject({ isError: true, cleanupUnconfirmed: true });
    expect(result.fullOutput).toBe(output);
    expect(registry.hasRunningCommands("host-run")).toBe(true);
    await expect(registry.cancelRun("host-run")).rejects.toThrow("COMMAND_CLEANUP_UNCONFIRMED");
    registry.confirmRunStopped("host-run");
    expect(registry.hasRunningCommands("host-run")).toBe(false);
  });

  it.each([
    ["80K", 80_001],
    ["256K", 256_001],
    ["4M", 4_000_001],
  ])("uses the host capture for %s fullOutput recovery", async (_label, size) => {
    const child = fakeChild();
    const stdout = new PassThrough();
    Object.defineProperty(child, "stdout", { value: stdout });
    const output = `H${"x".repeat(size - 2)}L`;
    const hostCommands = new HostCommandService({
      spawn: vi.fn(() => {
        queueMicrotask(() => {
          stdout.write(output);
          setImmediate(() => child.emit("close", 0));
        });
        return child;
      }),
    });
    const registry = new ToolRegistry(
      {
        cancelRun: vi.fn(async () => undefined),
        confirmRunStopped: vi.fn(() => 0),
        shutdown: vi.fn(async () => undefined),
      } as unknown as NativeSandboxService,
      {
        list: vi.fn(() => []),
        cancelRun: vi.fn(async () => undefined),
        confirmRunStopped: vi.fn(() => 0),
        shutdown: vi.fn(async () => undefined),
      } as unknown as PersistentCommandService,
      hostCommands,
    );

    const result = await registry.execute(
      "run_command",
      { command: "Write-Output large" },
      contextFixture(),
    );

    expect(result.output).toContain("output truncated");
    if (size > 4_000_000) {
      expect(result.fullOutput).toContain("OUTPUT_CAPTURE_LIMIT");
      expect(result.fullOutput?.length).toBeLessThan(4_000_200);
    } else {
      expect(result.fullOutput).toBe(output);
    }
  });
});
