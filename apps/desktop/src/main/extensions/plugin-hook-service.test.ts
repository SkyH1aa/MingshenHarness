import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionView, SessionView } from "../../shared/domain";
import type { McpService } from "../mcp/mcp-service";
import type { Repository } from "../storage/repository";
import { PluginHookService } from "./plugin-hook-service";

function pluginToken(name: string): string {
  return ["$", "{", name, "}"].join("");
}

function pluginExtension(installedPath = process.cwd()): ExtensionView {
  return {
    id: "plugin",
    type: "plugin",
    name: "Test plugin",
    description: "Hook fixture",
    sourcePath: installedPath,
    installedPath,
    contentHash: "hash",
    enabled: true,
    createdAt: new Date(0).toISOString(),
    skillCount: 0,
    mcpServerCount: 0,
    mcpServerNames: [],
    hookCount: 1,
  };
}

function fixture(
  hooks: unknown,
  options: {
    shellHooksEnabled?: boolean;
    enabled?: boolean;
    agentMode?: SessionView["agentMode"];
    trusted?: boolean;
    installedPath?: string;
    mcpService?: Partial<McpService>;
  } = {},
) {
  const extension = {
    ...pluginExtension(options.installedPath),
    enabled: options.enabled ?? true,
  };
  const service = new PluginHookService(
    {
      listSessionExtensionIds: () => ["plugin"],
      getExtension: () => extension,
      getExtensionManifest: () => ({ hooks }),
      getSetting: () => options.shellHooksEnabled ?? true,
      isProjectTrusted: () => options.trusted ?? true,
    } as unknown as Repository,
    (options.mcpService ?? {}) as McpService,
  );
  const session = {
    id: "session",
    agentMode: options.agentMode ?? "code",
    workspacePath: process.cwd(),
  } as SessionView;
  return { service, session, extension };
}

describe("Plugin prompt context", () => {
  it("loads declarative prompt hooks with plugin-root expansion and ignores commands", async () => {
    const { service, session, extension } = fixture({
      UserPromptSubmit: [
        {
          hooks: [
            { type: "prompt", text: `Plugin root: ${pluginToken("MINGSHEN_PLUGIN_ROOT")}` },
            {
              type: "command",
              command: "Write-Output should-not-run",
              input: { type: "prompt", text: "must-not-be-context" },
            },
          ],
        },
      ],
    });
    const result = await service.loadPromptContext(session);
    expect(result.errors).toEqual([]);
    expect(result.contexts).toEqual([
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: `Plugin root: ${extension.installedPath}`,
      },
    ]);
  });

  it("never supplies plugin hooks or context to ChatAgent", async () => {
    const { service, session } = fixture(
      {
        UserPromptSubmit: [{ hooks: [{ type: "prompt", text: "Chat must ignore this" }] }],
        Stop: [{ hooks: [{ type: "command", command: "Write-Output no" }] }],
      },
      { agentMode: "chat" },
    );
    const approve = vi.fn(async () => true);
    expect(await service.loadPromptContext(session)).toEqual({ contexts: [], errors: [] });
    expect(
      await service.run("Stop", session, "run", new AbortController().signal, approve),
    ).toEqual([]);
    expect(approve).not.toHaveBeenCalled();
  });

  it("loads external hook JSON and rejects declarations outside the plugin root", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-hook-"));
    try {
      await mkdir(join(root, "hooks"));
      await writeFile(
        join(root, "hooks", "hooks.json"),
        JSON.stringify({
          hooks: {
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: "prompt",
                    text: `External prompt from ${pluginToken("ZCODE_PLUGIN_ROOT")}`,
                  },
                ],
              },
            ],
          },
        }),
        "utf8",
      );
      const loaded = fixture("./hooks/hooks.json", { installedPath: root });
      const result = await loaded.service.loadPromptContext(loaded.session);
      expect(result.contexts[0]?.text).toBe(`External prompt from ${root}`);

      const escaped = fixture("../outside.json", { installedPath: root });
      const failed = await escaped.service.loadPromptContext(escaped.session);
      expect(failed.contexts).toEqual([]);
      expect(failed.errors[0]?.message).toMatch(/Unsafe|越界/);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});

describe("Non-blocking interrupt hooks", () => {
  it("records declarative prompts and skips command/MCP actions without approval", async () => {
    const { service, session, extension } = fixture({
      Interrupt: [
        {
          hooks: [
            { type: "prompt", text: `Interrupted at ${pluginToken("MINGSHEN_PLUGIN_ROOT")}` },
            {
              type: "command",
              command: "Write-Output should-not-run",
              input: { type: "prompt", text: "must-not-be-notified" },
            },
            { type: "mcp_tool", server: "missing", tool: "cleanup", input: {} },
          ],
        },
      ],
    });
    const approve = vi.fn(async () => true);
    const results = await service.run(
      "Interrupt",
      session,
      "run",
      new AbortController().signal,
      approve,
    );
    expect(results).toEqual([
      expect.objectContaining({
        status: "skipped",
        detail: expect.stringContaining("non-blocking"),
      }),
      expect.objectContaining({
        status: "completed",
        detail: expect.stringContaining(extension.installedPath),
      }),
    ]);
    expect(approve).not.toHaveBeenCalled();
  });

  it("does not dispatch interrupt notifications in ChatAgent or subagent sessions", async () => {
    for (const session of [
      {
        id: "chat",
        agentMode: "chat",
        workspacePath: process.cwd(),
      } as SessionView,
      {
        id: "child",
        agentMode: "code",
        parentSessionId: "parent",
        workspacePath: process.cwd(),
      } as SessionView,
    ]) {
      const { service } = fixture({
        Interrupt: [{ hooks: [{ type: "prompt", text: "Must not run" }] }],
      });
      await expect(
        service.runInterrupt(session, "run", new AbortController().signal),
      ).resolves.toEqual([]);
    }
  });
});

describe("Tool hook dispatch", () => {
  it("applies matchers before Shell Hook validation", async () => {
    const { service, session } = fixture(
      {
        PreToolUse: [
          {
            matcher: "read_*|Glob",
            hooks: [{ type: "command", command: "Write-Output matched" }],
          },
        ],
      },
      { shellHooksEnabled: false },
    );
    const approve = vi.fn(async () => true);
    const matching = await service.run(
      "PreToolUse",
      session,
      "run",
      new AbortController().signal,
      approve,
      { toolCallId: "call", toolName: "read_file", toolInput: { path: "a.txt" } },
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ status: "skipped" });
    const skipped = await service.run(
      "PreToolUse",
      session,
      "run",
      new AbortController().signal,
      approve,
      { toolCallId: "call", toolName: "write_file", toolInput: { path: "a.txt" } },
    );
    expect(skipped).toEqual([]);
    expect(approve).not.toHaveBeenCalled();
  });

  it("passes bounded structured stdin and plugin-root environment to an approved command", async () => {
    const { service, session, extension } = fixture({
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command:
                "$raw=[Console]::In.ReadToEnd(); [pscustomobject]@{stdin=$raw;root=$env:MINGSHEN_PLUGIN_ROOT}|ConvertTo-Json -Compress",
              timeoutMs: 5_000,
            },
          ],
        },
      ],
    });
    const approve = vi.fn(async () => true);
    const results = await service.run(
      "PreToolUse",
      session,
      "run",
      new AbortController().signal,
      approve,
      {
        toolCallId: "call-1",
        toolName: "read_file",
        toolInput: { path: "notes.txt" },
      },
    );
    expect(results[0]?.status).toBe("completed");
    expect(results[0]?.detail).toContain('\\"hook_event_name\\":\\"PreToolUse\\"');
    expect(results[0]?.detail).toContain('\\"tool_name\\":\\"read_file\\"');
    expect(results[0]?.detail).toContain(extension.installedPath.replaceAll("\\", "\\\\"));
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("does not call an unconfigured MCP server from a hook", async () => {
    const callTool = vi.fn();
    const { service, session } = fixture(
      {
        PostToolUse: [
          {
            hooks: [{ type: "mcp_tool", server: "disabled", tool: "write", input: {} }],
          },
        ],
      },
      {
        mcpService: {
          findServerByName: () =>
            ({
              id: "plugin-server",
              name: "disabled",
              enabled: false,
              configured: true,
            }) as never,
          callTool,
        },
      },
    );
    const approve = vi.fn(async () => true);
    const results = await service.run(
      "PostToolUse",
      session,
      "run",
      new AbortController().signal,
      approve,
      { toolName: "write_file", toolResponse: { isError: false } },
    );
    expect(results[0]).toMatchObject({ status: "failed" });
    expect(results[0]?.detail).toContain("未启用或未配置");
    expect(callTool).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it("does not approve or call a configured MCP hook for an untrusted project", async () => {
    const callTool = vi.fn(async () => ({ output: "should not run", isError: false }));
    const { service, session } = fixture(
      {
        PostToolUse: [
          {
            hooks: [{ type: "mcp_tool", server: "enabled", tool: "audit", input: {} }],
          },
        ],
      },
      {
        trusted: false,
        mcpService: {
          findServerByName: () =>
            ({
              id: "plugin-server",
              name: "enabled",
              enabled: true,
              configured: true,
            }) as never,
          callTool,
        },
      },
    );
    const approve = vi.fn(async () => true);
    const results = await service.run(
      "PostToolUse",
      session,
      "run",
      new AbortController().signal,
      approve,
      { toolName: "write_file", toolResponse: { isError: false } },
    );
    expect(results[0]).toMatchObject({ status: "skipped" });
    expect(results[0]?.detail).toContain("尚未信任");
    expect(callTool).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it("requires approval and forwards structured tool data to an enabled MCP hook", async () => {
    const callTool = vi.fn(async () => ({ output: "MCP hook complete", isError: false }));
    const { service, session } = fixture(
      {
        PostToolUse: [
          {
            matcher: "write_file",
            hooks: [
              {
                type: "mcp_tool",
                server: "enabled",
                tool: "audit",
                input: {
                  session: pluginToken("SESSION_ID"),
                  root: pluginToken("CLAUDE_PLUGIN_ROOT"),
                },
              },
            ],
          },
        ],
      },
      {
        trusted: true,
        mcpService: {
          findServerByName: () =>
            ({
              id: "plugin-server",
              name: "enabled",
              enabled: true,
              configured: true,
            }) as never,
          callTool,
        },
      },
    );
    const approve = vi.fn(async () => true);
    const results = await service.run(
      "PostToolUse",
      session,
      "run",
      new AbortController().signal,
      approve,
      { toolName: "write_file", toolInput: { path: "a.txt" } },
    );
    expect(results[0]).toMatchObject({ status: "completed" });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(
      "plugin-server",
      "audit",
      expect.objectContaining({
        session: "session",
        root: process.cwd(),
      }),
      expect.any(AbortSignal),
    );
  });

  it("ignores plugins that are not selected and enabled", async () => {
    const { service, session } = fixture(
      { Stop: [{ hooks: [{ type: "command", command: "Write-Output no" }] }] },
      { enabled: false },
    );
    expect(
      await service.run(
        "Stop",
        session,
        "run",
        new AbortController().signal,
        vi.fn(async () => true),
      ),
    ).toEqual([]);
  });
});

describe("Plugin shell hook protection", () => {
  it("keeps shell hooks disabled by default", async () => {
    const { service, session } = fixture(
      { Stop: [{ hooks: [{ type: "command", command: "Write-Output test" }] }] },
      { shellHooksEnabled: false },
    );
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
    const { service, session } = fixture({
      Stop: [{ hooks: [{ type: "command", command: "shutdown.exe /s /t 0" }] }],
    });
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
    const { service, session } = fixture({
      Stop: [
        {
          hooks: [{ type: "command", command: "Start-Sleep -Seconds 60", timeoutMs: 60_000 }],
        },
      ],
    });
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
