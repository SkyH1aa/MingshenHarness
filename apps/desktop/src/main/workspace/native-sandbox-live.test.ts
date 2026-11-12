import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { ToolRegistry } from "../tools/tool-registry";
import { NativeSandboxService, sandboxEnvironment } from "./native-sandbox-service";

describe("Native Windows sandbox boundaries", () => {
  it("does not inherit provider, GitHub or model credentials", () => {
    process.env.MSH_TEST_SECRET = "do-not-inherit";
    expect(sandboxEnvironment("isolated").MSH_TEST_SECRET).toBeUndefined();
    delete process.env.MSH_TEST_SECRET;
  });
  it("rejects malformed binary requests before starting the sandbox", async () => {
    const native = new NativeSandboxService("missing.exe", "missing-profile");
    await expect(
      native.fileOperation(
        "C:\\workspace",
        {
          operation: "write_binary",
          path: "output.pdf",
          content: "not-base64",
          expectedHash: "missing",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("canonical base64");
    await expect(
      native.fileOperation(
        "C:\\workspace",
        { operation: "read", path: "input.txt", expectedHash: "missing" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("expectedHash is only valid");
  });
  it.runIf(process.env.MINGSHEN_NATIVE_E2E === "1")(
    "executes approved tools and blocks outside paths, junctions, child escape, network and missing runtimes",
    async () => {
      const root =
        process.env.MINGSHEN_NATIVE_TEST_ROOT ||
        (await mkdtemp(join(tmpdir(), "mingshen-mxc-e2e-")));
      const workspace = join(root, "workspace");
      const outside = join(root, "outside");
      await mkdir(workspace, { recursive: true });
      await mkdir(outside, { recursive: true });
      const secret = join(outside, "sentinel.txt");
      await writeFile(secret, "OUTSIDE_SECRET");
      await mkdir(join(workspace, ".codex"), { recursive: true });
      await writeFile(
        join(workspace, ".codex", "config.toml"),
        'default_permissions="mingshen"\n[windows]\nsandbox="disabled"\n[permissions.mingshen.filesystem]\n":root"="write"\n[permissions.mingshen.network]\nenabled=true\n',
      );
      let junctionCreated = false;
      if (!process.env.MINGSHEN_NATIVE_TEST_ROOT) {
        try {
          await symlink(outside, join(workspace, "linked"), "junction");
          junctionCreated = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
        }
      }
      const native = new NativeSandboxService(
        resolve("resources/native/codex-sandbox.exe"),
        join(root, "profiles"),
      );
      const signal = AbortSignal.timeout(180_000);
      const context = {
        session: {
          id: "native-live",
          workspacePath: workspace,
          permissionMode: "request_approval",
          executionMode: "host",
        } as SessionView,
        runId: "run",
        toolCallId: "call",
        toolName: "run_command",
        signal,
        permissions: new PermissionStore(),
        requestApproval: async () => ({ approvalId: "test", decision: "allow_once" as const }),
      };
      try {
        const registry = new ToolRegistry(native);
        const large = "示例 Unicode\n".repeat(8000);
        const written = await registry.execute(
          "write_file",
          { path: "nested/test.txt", content: large },
          context,
        );
        expect(written.isError, written.output).toBe(false);
        expect(await readFile(join(workspace, "nested/test.txt"), "utf8")).toBe(large);
        expect(
          await native.fileOperation(
            workspace,
            { operation: "read", path: "nested/test.txt" },
            signal,
          ),
        ).toBe(large);
        const docx = zipSync({
          "[Content_Types].xml": strToU8(
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
          ),
          "_rels/.rels": strToU8(
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
          ),
          "word/document.xml": strToU8(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Protected document parsed</w:t></w:r></w:p></w:body></w:document>',
          ),
        });
        await writeFile(join(workspace, "test.docx"), docx);
        const document = await registry.execute("read_document", { path: "test.docx" }, context);
        expect(document.isError, document.output).toBe(false);
        expect(document.output).toContain("Protected document parsed");
        const binary = Buffer.from([0, 1, 2, 250, 251, 252]);
        await native.fileOperation(
          workspace,
          {
            operation: "write_binary",
            path: "generated/report.pdf",
            content: binary.toString("base64"),
            expectedHash: "missing",
          },
          signal,
        );
        expect(await readFile(join(workspace, "generated/report.pdf"))).toEqual(binary);
        const binaryHash = await native.fileOperation(
          workspace,
          { operation: "hash", path: "generated/report.pdf" },
          signal,
        );
        expect(binaryHash).toMatch(/^[0-9a-f]{64}$/);
        await expect(
          native.fileOperation(
            workspace,
            {
              operation: "write_binary",
              path: "generated/report.pdf",
              content: Buffer.from("changed").toString("base64"),
              expectedHash: "0".repeat(64),
            },
            signal,
          ),
        ).rejects.toThrow("Target changed");
        expect(await readFile(join(workspace, "generated/report.pdf"))).toEqual(binary);
        expect(
          await native.fileOperation(workspace, { operation: "hash", path: "missing.pdf" }, signal),
        ).toBe("missing");
        const externalFailure = await native.run(workspace, "& $env:ComSpec /d /c exit 7", signal);
        expect(externalFailure.exitCode).toBe(7);
        const selfInvocation = await native.run(
          workspace,
          `& '${resolve("resources/native/codex-sandbox.exe").replaceAll("'", "''")}' --version`,
          signal,
        );
        expect(selfInvocation.exitCode).not.toBe(0);
        const denied = await registry.execute(
          "run_command",
          { command: "[IO.File]::WriteAllText('denied.txt','x')" },
          {
            ...context,
            requestApproval: async () => ({ approvalId: "test", decision: "deny" as const }),
          },
        );
        expect(denied.isError).toBe(true);
        await expect(access(join(workspace, "denied.txt"))).rejects.toThrow();
        const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
        for (const command of [
          `[IO.File]::ReadAllText(${quote(secret)})`,
          `[IO.File]::WriteAllText(${quote(secret)},'ESCAPED')`,
        ]) {
          const result = await native.run(workspace, command, signal);
          expect(result.exitCode).not.toBe(0);
          expect(result.output).not.toContain("OUTSIDE_SECRET");
        }
        await expect(
          native.fileOperation(
            workspace,
            { operation: "read", path: "../outside/sentinel.txt" },
            signal,
          ),
        ).rejects.toThrow();
        if (junctionCreated) {
          await expect(
            native.fileOperation(
              workspace,
              { operation: "write", path: "linked/sentinel.txt", content: "ESCAPED" },
              signal,
            ),
          ).rejects.toThrow();
          const linked = await native.run(
            workspace,
            "[IO.File]::WriteAllText('linked/sentinel.txt','ESCAPED')",
            signal,
          );
          expect(linked.exitCode).not.toBe(0);
        }
        const child = await native.run(
          workspace,
          `& $env:ComSpec /d /c ${quote(`type "${secret}"`)}; exit $LASTEXITCODE`,
          signal,
        );
        expect(child.exitCode).not.toBe(0);
        expect(child.output).not.toContain("OUTSIDE_SECRET");
        const network = await native.run(
          workspace,
          "$c=New-Object Net.Sockets.TcpClient;try{$r=$c.ConnectAsync('1.1.1.1',443);if($r.Wait(1500) -and $c.Connected){throw 'NETWORK_ALLOWED'};'NETWORK_BLOCKED'}catch{if($_.Exception.Message -eq 'NETWORK_ALLOWED'){throw};'NETWORK_BLOCKED'}finally{$c.Dispose()}",
          signal,
        );
        expect(network.exitCode).toBe(0);
        expect(network.output).toContain("NETWORK_BLOCKED");
        const loopback = createServer((socket) => socket.destroy());
        await new Promise<void>((done) => loopback.listen(0, "127.0.0.1", done));
        try {
          const port = (loopback.address() as { port: number }).port;
          const result = await native.run(
            workspace,
            `$c=New-Object Net.Sockets.TcpClient;try{$r=$c.ConnectAsync('127.0.0.1',${port});if($r.Wait(1500) -and $c.Connected){'LOOPBACK_ALLOWED'}else{'LOOPBACK_BLOCKED'}}catch{'LOOPBACK_BLOCKED'}finally{$c.Dispose()}`,
            signal,
          );
          console.log("MXC loopback probe:", result.output);
          expect(result.exitCode).toBe(0);
          expect(result.output).toMatch(/LOOPBACK_(?:ALLOWED|BLOCKED)/);
        } finally {
          await new Promise<void>((done) => loopback.close(() => done()));
        }
        const readonly = await native.run(
          workspace,
          "[IO.File]::WriteAllText('readonly.txt','bad')",
          signal,
          { readOnly: true },
        );
        expect(readonly.exitCode).not.toBe(0);
        await mkdir(join(workspace, ".harness-memory"), { recursive: true });
        const protectedMemory = await native.run(
          workspace,
          "[IO.File]::WriteAllText('.harness-memory/blocked.md','bad')",
          signal,
          { readOnlyPaths: [join(workspace, ".harness-memory")] },
        );
        expect(protectedMemory.exitCode).not.toBe(0);
        const ordinaryWrite = await native.run(
          workspace,
          "[IO.File]::WriteAllText('ordinary.txt','ok')",
          signal,
          { readOnlyPaths: [join(workspace, ".harness-memory")] },
        );
        expect(ordinaryWrite.exitCode).toBe(0);
        await expect(
          new NativeSandboxService(join(root, "missing.exe"), join(root, "missing-profile")).run(
            workspace,
            "'bad'",
            signal,
          ),
        ).rejects.toThrow("no host fallback");
        expect(await readFile(secret, "utf8")).toBe("OUTSIDE_SECRET");
        const aborted = new AbortController();
        const pending = native.run(workspace, "Start-Sleep -Seconds 60", aborted.signal);
        setTimeout(() => aborted.abort(), 3000);
        await expect(pending).rejects.toThrow("canceled");
      } finally {
        const checked = resolve(root);
        if (
          !process.env.MINGSHEN_NATIVE_TEST_ROOT &&
          checked.startsWith(`${resolve(tmpdir())}\\mingshen-mxc-e2e-`)
        )
          await rm(checked, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
