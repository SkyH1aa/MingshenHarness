import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { ToolRegistry } from "../tools/tool-registry";
import { dockerExecutable } from "./docker-path";
import { DOCKER_SECURITY_ARGS, DockerService } from "./docker-service";

describe("Real Docker isolation", () => {
  it.runIf(process.env.MINGSHEN_DOCKER_E2E === "1")(
    "routes approval-mode Agent commands through Docker and honors denial",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-command-live-"));
      const registry = new ToolRegistry();
      const context = {
        session: {
          id: "sandbox-command",
          workspacePath: root,
          permissionMode: "request_approval",
          executionMode: "docker",
        } as SessionView,
        runId: "run",
        toolCallId: "call",
        toolName: "run_command",
        signal: AbortSignal.timeout(120_000),
        permissions: new PermissionStore(),
        requestApproval: async () => ({ approvalId: "test", decision: "deny" as const }),
      };
      try {
        const denied = await registry.execute(
          "run_command",
          { command: "[IO.File]::WriteAllText('/workspace/denied.txt','bad')" },
          context,
        );
        expect(denied.isError).toBe(true);
        await expect(readFile(join(root, "denied.txt"))).rejects.toThrow();
        const approved = await registry.execute(
          "run_command",
          {
            command:
              "[IO.File]::WriteAllText('/workspace/allowed.txt','ok'); @{ host=(Test-Path 'C:/Users'); socket=(Test-Path '/var/run/docker.sock'); network=@([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object Name -ne 'lo').Count } | ConvertTo-Json -Compress",
          },
          {
            ...context,
            requestApproval: async () => ({ approvalId: "test", decision: "allow_once" as const }),
          },
        );
        expect(approved.isError).toBe(false);
        expect(await readFile(join(root, "allowed.txt"), "utf8")).toBe("ok");
        expect(approved.output).toContain('"host":false');
        expect(approved.output).toContain('"socket":false');
        expect(approved.output).toContain('"network":0');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
  it.runIf(process.env.MINGSHEN_DOCKER_E2E === "1")(
    "isolates file tools, rejects traversal, denies root writes and has no network or Docker socket",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-docker-live-"));
      const workspace = join(root, "workspace");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(workspace);
      const signal = AbortSignal.timeout(120_000);
      const service = new DockerService();
      try {
        const image = await service.prepare(
          "test",
          workspace,
          { image: "mcr.microsoft.com/powershell:lts-alpine", dockerfile: "", buildContext: "." },
          signal,
        );
        await service.fileOperation(
          image,
          workspace,
          { operation: "write", path: "nested/probe.txt", content: "container-write" },
          signal,
        );
        expect(await readFile(join(workspace, "nested", "probe.txt"), "utf8")).toBe(
          "container-write",
        );
        expect(
          await service.fileOperation(
            image,
            workspace,
            { operation: "read", path: "nested/probe.txt" },
            signal,
          ),
        ).toBe("container-write");
        await expect(
          service.fileOperation(
            image,
            workspace,
            { operation: "read", path: "../../etc/passwd" },
            signal,
          ),
        ).rejects.toThrow();
        const command = `$ErrorActionPreference='Stop'; $denied=$false; try { [IO.File]::WriteAllText('/escape-probe','x') } catch { $denied=$true }; @{ rootWriteDenied=$denied; dockerSocket=(Test-Path '/var/run/docker.sock'); networkInterfaces=@([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object Name -ne 'lo').Count; hostPath=(Test-Path 'C:/Users') } | ConvertTo-Json -Compress`;
        const output = await promisify(execFile)(
          dockerExecutable(),
          [
            "run",
            "--rm",
            ...DOCKER_SECURITY_ARGS,
            "--network=none",
            "--entrypoint",
            "pwsh",
            image,
            "-NoProfile",
            "-EncodedCommand",
            Buffer.from(command, "utf16le").toString("base64"),
          ],
          { windowsHide: true, timeout: 60_000 },
        );
        expect(JSON.parse(output.stdout.trim())).toMatchObject({
          rootWriteDenied: true,
          dockerSocket: false,
          networkInterfaces: 0,
          hostPath: false,
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
