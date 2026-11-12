import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NativeSandboxService } from "../workspace/native-sandbox-service";
import { PersistentCommandService } from "./persistent-command-service";

describe("persistent native commands", () => {
  it.runIf(process.platform === "win32" && process.env.MINGSHEN_NATIVE_E2E === "1")(
    "retains approved stdin and confirms native process cleanup after cancellation",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-persistent-native-"));
      const checked = resolve(root);
      if (!checked.startsWith(`${resolve(tmpdir())}\\mingshen-persistent-native-`))
        throw new Error("Native probe cleanup path is outside its temporary workspace.");
      const workspace = join(root, "workspace");
      await mkdir(workspace);
      const native = new NativeSandboxService(
        resolve("resources/native/codex-sandbox.exe"),
        join(root, "profiles"),
      );
      const service = new PersistentCommandService();
      const owner = { sessionId: "native-probe", runId: "run" };
      const signal = AbortSignal.timeout(60_000);
      try {
        const command =
          "[Console]::Out.WriteLine('READY');$line=[Console]::ReadLine();[Console]::Out.WriteLine(('ANSWER:'+$line))";
        const first = await service.start(
          owner,
          { command, cwd: workspace, securityScope: "native" },
          await native.prepareCommand(workspace, command, signal),
          { signal, timeoutMs: 30_000, yieldMs: 5000, maxOutputChars: 2000 },
        );
        expect(first.running, first.output).toBe(true);
        expect(first.output).toContain("READY");
        let last = await service.interact(first.id, owner, {
          chars: "fixture input\n",
          yieldMs: 5000,
          maxOutputChars: 2000,
        });
        for (let attempt = 0; last.running && attempt < 5; attempt++)
          last = await service.interact(first.id, owner, {
            yieldMs: 1000,
            maxOutputChars: 2000,
          });
        expect(last.running, last.output).toBe(false);
        expect(last.output).toContain("ANSWER:fixture input");
        expect(last.exitCode).toBe(0);
        const blocking = "Start-Sleep -Seconds 60";
        const waiting = await service.start(
          owner,
          { command: blocking, cwd: workspace, securityScope: "native" },
          await native.prepareCommand(workspace, blocking, signal, { readOnly: true }),
          { signal, timeoutMs: 30_000, yieldMs: 500, maxOutputChars: 2000 },
        );
        expect(waiting.running).toBe(true);
        await service.cancelRun(owner.runId);
        expect(service.list(owner.runId)).toEqual([]);
      } finally {
        await service.shutdown();
        await rm(checked, { force: true, recursive: true });
      }
    },
    80_000,
  );
});
