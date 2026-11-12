import { describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import type { McpService } from "../mcp/mcp-service";
import type { Repository } from "../storage/repository";
import { PluginHookService } from "./plugin-hook-service";

function fixture(command: string, enabled = true) {
  const service = new PluginHookService(
    {
      listSessionExtensionIds: () => ["plugin"],
      getExtension: () => ({ id: "plugin", name: "Test plugin", enabled: true, type: "plugin" }),
      getExtensionManifest: () => ({ hooks: { Stop: [{ type: "command", command }] } }),
      getSetting: () => enabled,
      isProjectTrusted: () => true,
    } as unknown as Repository,
    {} as McpService,
  );
  const session = { id: "session", workspacePath: process.cwd() } as SessionView;
  return { service, session };
}

describe("Plugin shell hook protection", () => {
  it("keeps shell hooks disabled by default", async () => {
    const { service, session } = fixture("Write-Output test", false);
    const approve = vi.fn(async () => true);
    const results = await service.run(
      "Stop",
      session,
      "run",
      new AbortController().signal,
      approve,
    );
    expect(results[0]?.status).toBe("skipped");
    expect(approve).not.toHaveBeenCalled();
  });
  it("applies fatal command protection even when shell hooks are enabled", async () => {
    const { service, session } = fixture("shutdown.exe /s /t 0");
    const approve = vi.fn(async () => true);
    const results = await service.run(
      "Stop",
      session,
      "run",
      new AbortController().signal,
      approve,
    );
    expect(results[0]).toMatchObject({ status: "failed" });
    expect(results[0]?.detail).toContain("禁止关机");
    expect(approve).not.toHaveBeenCalled();
  });
  it("cancels an approved command without waiting for its full timeout", async () => {
    const { service, session } = fixture("Start-Sleep -Seconds 60");
    const controller = new AbortController();
    const started = Date.now();
    const results = await service.run("Stop", session, "run", controller.signal, async () => {
      setTimeout(() => controller.abort(), 100);
      return true;
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(results[0]).toMatchObject({ status: "failed" });
    expect(results[0]?.detail).toContain("cancelled");
  });
});
