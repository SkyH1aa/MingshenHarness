import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { Lang, parse } from "@ast-grep/napi";
import { transformWithOxc } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPANION_IPC_CHANNELS } from "../../shared/desktop-companion";
import { IPC_CHANNELS } from "../../shared/ipc";
import { consumeReportedIpcConsoleError, instrumentIpcHandler } from "./ipc-diagnostics";
import { installRuntimeLog, RuntimeLogService } from "./runtime-log";

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mingshen-ipc-diagnostics-"));
  roots.push(root);
  const logger = new RuntimeLogService(join(root, "logs"), "1.3.7");
  installRuntimeLog(logger);
  return {
    logger,
    read: async () => {
      const path = join(root, "export.json");
      await logger.export(path);
      return JSON.parse(await readFile(path, "utf8")) as {
        entries: Array<{
          source: string;
          level: string;
          message: string;
          context: { operation?: string; code?: string };
        }>;
      };
    },
  };
}

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const ast = parse(Lang.TypeScript, source).root();
type Handler = (...args: unknown[]) => unknown;

async function registrationFixture(
  options: { trusted?: boolean; consent?: boolean; quick?: boolean } = {},
) {
  const assignment = ast
    .findAll({ rule: { kind: "assignment_expression" } })
    .find((node) => node.field("left")?.text() === "ipcMain.handle");
  const callback = assignment?.field("right");
  if (!callback) throw new Error("Main IPC diagnostics registration is missing");
  const handlers = new Map<string, Handler>();
  const register = await transformWithOxc(`(${callback.text()})`, "ipc-registration.ts");
  const ipcMain = { handle: (_channel: string, _listener: Handler) => {} };
  ipcMain.handle = runInNewContext(register.code, {
    originalHandle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    instrumentIpcHandler,
    applicationWindows: () => [{ webContents: { id: 1 } }],
    isRendererFrame: () => options.trusted !== false,
    quickChatWindow: options.quick ? { isDestroyed: () => false, webContents: { id: 1 } } : null,
    quickChat: { permitsIpc: () => false },
    companionWindow: null,
    COMPANION_IPC_CHANNELS,
    IPC_CHANNELS,
    desktop: { state: () => ({ accepted: options.consent !== false }) },
    services: null,
    localizeError: (message: string) => message,
    Error,
  }) as typeof ipcMain.handle;
  const registrations = ast
    .findAll({ rule: { kind: "call_expression" } })
    .filter((node) => node.field("function")?.text() === "ipcMain.handle");
  const channels = new Set<string>();
  for (const registration of registrations) {
    const key = registration
      .field("arguments")
      ?.children()
      .map((arg) => /^(IPC_CHANNELS|COMPANION_IPC_CHANNELS)\.(\w+)$/.exec(arg.text()))
      .find(Boolean);
    if (!key)
      throw new Error(
        `An IPC registration has no known channel: ${registration.text().slice(0, 80)}`,
      );
    const table = key[1] === "IPC_CHANNELS" ? IPC_CHANNELS : COMPANION_IPC_CHANNELS;
    const channel = (table as Record<string, string>)[key[2] as string];
    if (!channel) throw new Error("Unknown IPC channel");
    if (registration.range().start.index <= (assignment?.range().end.index ?? Infinity))
      throw new Error(`Uninstrumented IPC registration: ${channel}`);
    channels.add(channel);
  }
  return { ipcMain, handlers, channels };
}

describe("central IPC diagnostics", () => {
  it("covers every actual old and new main-process invoke registration", async () => {
    const f = await fixture();
    const registration = await registrationFixture();
    expect(registration.channels.size).toBeGreaterThan(200);
    for (const channel of registration.channels) {
      registration.ipcMain.handle(channel, () => {
        throw new Error("Synthetic interface failure");
      });
      const handler = registration.handlers.get(channel);
      if (!handler) throw new Error(`Missing handler for ${channel}`);
      await expect(handler({ sender: { id: 1 } })).rejects.toThrow("Synthetic interface failure");
    }
    const report = await f.read();
    expect(new Set(report.entries.map((entry) => entry.context.operation))).toEqual(
      registration.channels,
    );
    expect(report.entries).toHaveLength(registration.channels.size);
    for (const channel of [
      IPC_CHANNELS.managedPolicyUserSet,
      IPC_CHANNELS.officeDeliveryContinue,
      IPC_CHANNELS.imageStudioRemoteOpenExternal,
      IPC_CHANNELS.imageStudioGenerate,
      IPC_CHANNELS.runtimeLogExport,
      IPC_CHANNELS.chatSend,
    ])
      expect(registration.channels.has(channel)).toBe(true);
  });

  it.each([
    [{ trusted: false }, "IPC_UNTRUSTED_SENDER"],
    [{ consent: false }, "IPC_CONSENT_REQUIRED"],
    [{ quick: true }, "IPC_CHAT_SCOPE"],
  ])("records pre-handler refusals once: %s", async (options, code) => {
    const f = await fixture();
    const registration = await registrationFixture(options);
    const listener = vi.fn();
    registration.ipcMain.handle(IPC_CHANNELS.imageStudioGenerate, listener);
    await expect(
      registration.handlers.get(IPC_CHANNELS.imageStudioGenerate)?.({ sender: { id: 1 } }),
    ).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect((await f.read()).entries).toMatchObject([
      { source: "ipc.security", context: { operation: IPC_CHANNELS.imageStudioGenerate, code } },
    ]);
  });

  it("preserves results and localized errors while observing structured failures without response content", async () => {
    const f = await fixture();
    const success = { ok: true, output: "private successful tool content" };
    expect(await instrumentIpcHandler("fixture:success", () => success)()).toBe(success);
    await instrumentIpcHandler(IPC_CHANNELS.localPluginValidate, () => ({
      kind: "plugin",
      validation: { ok: false, errors: ["private plugin source"] },
    }))();
    const original = new Error("HTTP 502 upstream failure");
    const mapped = new Error("Localized failure");
    await expect(
      instrumentIpcHandler(
        "fixture:async",
        async () => {
          throw original;
        },
        () => mapped,
      )(),
    ).rejects.toBe(mapped);
    const report = await f.read();
    expect(report.entries).toHaveLength(2);
    expect(
      report.entries.some((entry) => entry.context.operation === IPC_CHANNELS.localPluginValidate),
    ).toBe(true);
    expect(report.entries.some((entry) => entry.message.includes("HTTP 502"))).toBe(true);
    expect(JSON.stringify(report)).not.toContain("private");
  });

  it("counts cancellations as warnings and suppresses only corresponding immediate Electron console echoes", async () => {
    const f = await fixture();
    const channel = "fixture:cancel";
    await expect(
      instrumentIpcHandler(channel, () => {
        throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
      })(),
    ).rejects.toThrow("Cancelled");
    expect((await f.read()).entries[0]?.level).toBe("warn");
    expect(consumeReportedIpcConsoleError(["An unrelated error"])).toBe(false);
    expect(
      consumeReportedIpcConsoleError([
        "Error occurred in handler for 'unreported:channel':",
        new Error(),
      ]),
    ).toBe(false);
    expect(
      consumeReportedIpcConsoleError([`Error occurred in handler for '${channel}':`, new Error()]),
    ).toBe(true);
    expect(
      consumeReportedIpcConsoleError([`Error occurred in handler for '${channel}':`, new Error()]),
    ).toBe(false);
    await expect(
      instrumentIpcHandler("fixture:expired", () => {
        throw new Error("Expired fixture");
      })(),
    ).rejects.toThrow();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5_001);
    expect(
      consumeReportedIpcConsoleError(["Error occurred in handler for 'fixture:expired':"]),
    ).toBe(false);
  });

  it("uses the modern Electron console event for every application surface and captures preload errors", async () => {
    const f = await fixture();
    const callback = ast
      .findAll({ rule: { kind: "function_declaration" } })
      .find((node) => node.field("name")?.text() === "observeRendererDiagnostics");
    if (!callback) throw new Error("Renderer diagnostics are missing");
    const compiled = await transformWithOxc(`(${callback.text()})`, "renderer-diagnostics.ts");
    const observe = runInNewContext(compiled.code, {
      runtimeLogs: f.logger,
      recordRuntimeError: (scope: string, cause: unknown) => f.logger.record(scope, cause),
    }) as (window: unknown, surface: string) => void;
    for (const surface of ["renderer", "quick-chat", "companion", "startup"]) {
      expect(source).toContain(`observeRendererDiagnostics(window, "${surface}")`);
      const listeners = new Map<string, Handler>();
      observe(
        {
          webContents: { on: (event: string, callback: Handler) => listeners.set(event, callback) },
        },
        surface,
      );
      listeners.get("console-message")?.({ level: "error", message: "Synthetic console error" });
      listeners.get("console-message")?.({
        level: "warning",
        message: "Synthetic console warning",
      });
      listeners.get("console-message")?.({ level: "info", message: "private ordinary info" });
      listeners.get("preload-error")?.({}, "ignored path", new Error("Synthetic preload error"));
    }
    const report = await f.read();
    expect(report.entries).toHaveLength(12);
    expect(report.entries.filter((entry) => entry.level === "warn")).toHaveLength(4);
    expect(JSON.stringify(report)).not.toContain("private ordinary info");
  });
});
