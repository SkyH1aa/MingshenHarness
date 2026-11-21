import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { DockerService } from "../workspace/docker-service";
import type { NativeSandboxService } from "../workspace/native-sandbox-service";
import { type ToolExecutionContext, ToolRegistry } from "./tool-registry";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn,
}));

const roots: string[] = [];
beforeEach(() => {
  spawn.mockReset();
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: 123,
      exitCode: null,
    });
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

async function fixture(
  executionMode: SessionView["executionMode"],
  names: string[] = [],
  child = true,
) {
  const root = await mkdtemp(join(tmpdir(), "mingshen-command-memory-"));
  roots.push(root);
  for (const name of names) await mkdir(join(root, name));
  const context: ToolExecutionContext = {
    session: {
      id: child ? "child" : "main",
      parentSessionId: child ? "parent" : null,
      workspacePath: root,
      permissionMode: "full_access",
      executionMode,
    } as SessionView,
    runId: "run",
    toolCallId: "call",
    toolName: "run_command",
    dockerImage: "local-fixture",
    signal: new AbortController().signal,
    permissions: new PermissionStore(),
    requestApproval: vi.fn(async () => ({
      approvalId: "fixture",
      decision: "allow_once" as const,
    })),
  };
  return { root, context };
}

describe("subagent command memory boundaries", () => {
  it.each([
    { names: [".harness-memory"] },
    { names: [".harness-tencent-memory"] },
    { names: [".harness-memory", ".harness-tencent-memory"] },
    { names: [] },
  ])(
    "makes the child Docker workspace read only without creating memories: $names",
    async ({ names }) => {
      const { root, context } = await fixture("docker", names);
      const result = await new ToolRegistry().execute(
        "run_command",
        { command: "Write-Output hello" },
        context,
      );
      expect(result.isError).toBe(false);
      expect(context.requestApproval).not.toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledOnce();
      const args = spawn.mock.calls[0]?.[1] as string[];
      expect(args).toContain(`type=bind,source=${root},target=/workspace,readonly`);
      expect(args).not.toContain(`type=bind,source=${root},target=/workspace`);
      expect(args).toContain("--read-only");
      expect(args).toContain("--security-opt=no-new-privileges");
      for (const name of [".harness-memory", ".harness-tencent-memory"]) {
        const mount = `type=bind,source=${join(root, name)},target=/workspace/${name},readonly`;
        if (names.includes(name)) expect(args).toContain(mount);
        else {
          expect(args).not.toContain(mount);
          await expect(access(join(root, name))).rejects.toThrow("ENOENT");
        }
      }
    },
  );

  it.each([
    { names: [".harness-memory"] },
    { names: [".harness-tencent-memory"] },
    { names: [".harness-memory", ".harness-tencent-memory"] },
    { names: [] },
  ])(
    "makes the child native workspace read only without creating memories: $names",
    async ({ names }) => {
      const { root, context } = await fixture("host", names);
      const run = vi.fn(async () => ({ output: "hello", exitCode: 0 }));
      const registry = new ToolRegistry({ run } as unknown as NativeSandboxService);
      const result = await registry.execute(
        "run_command",
        { command: "Write-Output hello" },
        context,
      );
      expect(result.isError).toBe(false);
      expect(context.requestApproval).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledWith(
        root,
        "Write-Output hello",
        context.signal,
        expect.objectContaining({
          readOnly: true,
          scope: {
            sessionId: context.session.id,
            runId: context.runId,
            toolCallId: context.toolCallId,
          },
        }),
      );
      expect(spawn).not.toHaveBeenCalled();
      for (const name of [".harness-memory", ".harness-tencent-memory"]) {
        if (!names.includes(name)) await expect(access(join(root, name))).rejects.toThrow("ENOENT");
      }
    },
  );

  it("keeps approval-mode main commands writable in the native sandbox", async () => {
    const { root, context } = await fixture("host", [], false);
    context.session.permissionMode = "request_approval";
    const run = vi.fn(async (..._args: unknown[]) => ({ output: "hello", exitCode: 0 }));
    const result = await new ToolRegistry({ run } as unknown as NativeSandboxService).execute(
      "run_command",
      { command: "Write-Output hello" },
      context,
    );
    expect(result.isError).toBe(false);
    expect(context.requestApproval).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      root,
      "Write-Output hello",
      context.signal,
      expect.objectContaining({
        scope: {
          sessionId: context.session.id,
          runId: context.runId,
          toolCallId: context.toolCallId,
        },
      }),
    );
    expect(run.mock.calls[0]?.[3]).not.toHaveProperty("readOnly", true);
  });

  it("keeps main Docker workspaces writable", async () => {
    const { root, context } = await fixture("docker", [], false);
    const result = await new ToolRegistry().execute(
      "run_command",
      { command: "Write-Output hello" },
      context,
    );
    expect(result.isError).toBe(false);
    const args = spawn.mock.calls[0]?.[1] as string[];
    expect(args).toContain(`type=bind,source=${root},target=/workspace`);
    expect(args).not.toContain(`type=bind,source=${root},target=/workspace,readonly`);
  });

  it.each(["host", "docker"] as const)(
    "keeps child %s file tools writable for ordinary files and rejects both memories",
    async (executionMode) => {
      const { root, context } = await fixture(executionMode);
      const fileOperation = vi
        .fn<NativeSandboxService["fileOperation"]>()
        .mockRejectedValueOnce(new Error("FILE_NOT_FOUND"))
        .mockResolvedValue(undefined);
      if (executionMode === "docker")
        vi.spyOn(DockerService.prototype, "fileOperation").mockImplementation(
          (_image, workspace, request, signal) => fileOperation(workspace, request, signal),
        );
      const registry = new ToolRegistry({ fileOperation } as unknown as NativeSandboxService);
      const result = await registry.execute(
        "write_file",
        { path: "ordinary.txt", content: "managed-write" },
        { ...context, toolName: "write_file" },
      );
      expect(result.isError, result.output).toBe(false);
      expect(result.fileChange).toMatchObject({
        path: join(root, "ordinary.txt"),
        changeType: "created",
      });
      const expectedFileOperationArgs = [
        root,
        { operation: "write", path: "ordinary.txt", content: "managed-write" },
        context.signal,
        ...(executionMode === "host"
          ? [
              {
                sessionId: context.session.id,
                runId: context.runId,
                toolCallId: context.toolCallId,
              },
            ]
          : []),
      ];
      expect(fileOperation).toHaveBeenLastCalledWith(...expectedFileOperationArgs);
      const calls = fileOperation.mock.calls.length;
      for (const name of [".harness-memory", ".harness-tencent-memory"]) {
        const blocked = await registry.execute(
          "write_file",
          { path: `${name}/records.txt`, content: "blocked" },
          { ...context, toolName: "write_file" },
        );
        expect(blocked.isError).toBe(true);
        expect(blocked.output).toContain("Project memory is broker-managed.");
        await expect(access(join(root, name))).rejects.toThrow("ENOENT");
      }
      expect(fileOperation).toHaveBeenCalledTimes(calls);
      expect(spawn).not.toHaveBeenCalled();
    },
  );
});
