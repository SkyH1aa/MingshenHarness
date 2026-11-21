import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import {
  NativeSandboxCleanupUnconfirmedError,
  type NativeSandboxService,
} from "../workspace/native-sandbox-service";
import type { PersistentCommandService } from "./persistent-command-service";
import { type ToolExecutionContext, ToolRegistry } from "./tool-registry";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function contextFixture(): Promise<ToolExecutionContext> {
  const workspacePath = await mkdtemp(join(tmpdir(), "mingshen-native-scope-"));
  roots.push(workspacePath);
  const signal = new AbortController().signal;
  return {
    session: {
      id: "session",
      title: "Native scope",
      workspacePath,
      permissionMode: "request_approval",
      executionMode: "host",
    } as SessionView,
    runId: "run",
    toolCallId: "call",
    toolName: "run_command",
    signal,
    permissions: new PermissionStore(),
    requestApproval: async (request) => ({
      approvalId: request.id,
      decision: "allow_once",
    }),
  };
}

function commandService(
  overrides: Partial<PersistentCommandService> = {},
): PersistentCommandService {
  return {
    cancelRun: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    confirmRunStopped: vi.fn(() => 0),
    ...overrides,
  } as unknown as PersistentCommandService;
}

describe("ToolRegistry native cleanup integration", () => {
  it("passes session/run/tool scope and preserves typed native cleanup failures", async () => {
    const context = await contextFixture();
    const cleanupError = new NativeSandboxCleanupUnconfirmedError(
      "cancellation",
      "taskkill failed",
      "partial output",
    );
    const run = vi.fn(async () => {
      throw cleanupError;
    });
    const registry = new ToolRegistry({ run } as unknown as NativeSandboxService, commandService());

    const result = await registry.execute(
      "run_command",
      { command: "Write-Output hello" },
      context,
    );

    expect(result).toMatchObject({
      isError: true,
      cleanupUnconfirmed: true,
    });
    expect(result.output).toContain("COMMAND_CLEANUP_UNCONFIRMED:");
    expect(result.fullOutput).toContain("partial output");
    expect(run).toHaveBeenCalledWith(
      context.session.workspacePath,
      "Write-Output hello",
      context.signal,
      expect.objectContaining({
        scope: {
          sessionId: "session",
          runId: "run",
          toolCallId: "call",
        },
      }),
    );
  });

  it("passes the same scope to native file operations without marking ordinary failures", async () => {
    const context = await contextFixture();
    const fileOperation = vi.fn(async () => "hello");
    const registry = new ToolRegistry(
      { fileOperation } as unknown as NativeSandboxService,
      commandService(),
    );

    const result = await registry.execute(
      "read_file",
      { path: "note.txt" },
      { ...context, toolCallId: "read-call", toolName: "read_file" },
    );

    expect(result).toMatchObject({ isError: false });
    expect(result.cleanupUnconfirmed).toBeUndefined();
    expect(fileOperation).toHaveBeenCalledWith(
      context.session.workspacePath,
      { operation: "read", path: "note.txt" },
      context.signal,
      {
        sessionId: "session",
        runId: "run",
        toolCallId: "read-call",
      },
    );
  });

  it("settles both cleanup backends and reports aggregate cancellation failures", async () => {
    const persistentError = new Error("persistent cleanup failed");
    const nativeError = new NativeSandboxCleanupUnconfirmedError(
      "cancellation",
      "native tree did not close",
      "",
    );
    const cancelRun = vi.fn(async () => {
      throw persistentError;
    });
    const nativeCancelRun = vi.fn(async () => {
      throw nativeError;
    });
    const registry = new ToolRegistry(
      { cancelRun: nativeCancelRun } as unknown as NativeSandboxService,
      commandService({ cancelRun }),
    );

    const failure = await registry.cancelRun("run").catch((error: unknown) => error);

    expect(cancelRun).toHaveBeenCalledWith("run");
    expect(nativeCancelRun).toHaveBeenCalledWith("run");
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([persistentError, nativeError]);
  });

  it("does not skip native shutdown when persistent cleanup fails", async () => {
    const persistentError = new Error("persistent shutdown failed");
    const shutdown = vi.fn(async () => {
      throw persistentError;
    });
    const nativeShutdown = vi.fn(async () => undefined);
    const registry = new ToolRegistry(
      { shutdown: nativeShutdown } as unknown as NativeSandboxService,
      commandService({ shutdown }),
    );

    await expect(registry.shutdown()).rejects.toBe(persistentError);
    expect(shutdown).toHaveBeenCalledOnce();
    expect(nativeShutdown).toHaveBeenCalledOnce();
  });

  it("forwards explicit recovery confirmation to both cleanup backends", () => {
    const nativeConfirm = vi.fn(() => 1);
    const persistentConfirm = vi.fn(() => 1);
    const registry = new ToolRegistry(
      { confirmRunStopped: nativeConfirm } as unknown as NativeSandboxService,
      commandService({ confirmRunStopped: persistentConfirm }),
    );
    registry.confirmRunStopped("run");
    expect(nativeConfirm).toHaveBeenCalledWith("run");
    expect(persistentConfirm).toHaveBeenCalledWith("run");
  });

  it("attempts every backend confirmation even when an earlier backend rejects", () => {
    const persistentError = new Error("persistent command is still active");
    const persistentConfirm = vi.fn(() => {
      throw persistentError;
    });
    const nativeConfirm = vi.fn(() => 1);
    const registry = new ToolRegistry(
      { confirmRunStopped: nativeConfirm } as unknown as NativeSandboxService,
      commandService({ confirmRunStopped: persistentConfirm }),
    );

    expect(() => registry.confirmRunStopped("run")).toThrow(persistentError);
    expect(persistentConfirm).toHaveBeenCalledWith("run");
    expect(nativeConfirm).toHaveBeenCalledWith("run");
  });
});
