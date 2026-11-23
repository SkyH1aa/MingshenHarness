import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionView, SessionView } from "../../shared/domain";
import type { McpService } from "../mcp/mcp-service";
import type { Repository } from "../storage/repository";
import { formatBeforeModelRequestContext, PluginHookService } from "./plugin-hook-service";

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
    selected?: boolean;
    activation?: string;
    installedPath?: string;
    mcpService?: Partial<McpService>;
  } = {},
) {
  const extension = {
    ...pluginExtension(options.installedPath),
    enabled: options.enabled ?? true,
  };
  const selectedExtensionIds = options.selected === false ? [] : ["plugin"];
  const repository = {
    listSessionExtensionIds: () => selectedExtensionIds,
    getExtension: () => extension,
    getExtensionManifest: () => ({
      hooks,
      ...(options.activation ? { activation: options.activation } : {}),
    }),
    getSetting: () => options.shellHooksEnabled ?? true,
    isProjectTrusted: () => options.trusted ?? true,
  };
  const service = new PluginHookService(
    repository as unknown as Repository,
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
  it("keeps the legacy before/context wrapper and string return", () => {
    const formatted = formatBeforeModelRequestContext([
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "legacy context",
      },
    ]);

    expect(formatted).toBeTypeOf("string");
    expect(formatted).toContain('<mingshen_plugin_context event="BeforeModelRequest"');
    expect(formatted).toContain("legacy context");
  });

  it("merges plain prompt positions into the request without plugin wrappers", () => {
    expect(
      formatBeforeModelRequestContext([
        {
          extensionId: "plugin",
          extensionName: "Test plugin",
          text: "prefix",
          position: "before",
          format: "plain",
        },
        {
          extensionId: "plugin",
          extensionName: "Test plugin",
          text: "suffix",
          position: "after",
          format: "plain",
        },
      ]),
    ).toEqual({
      systemContext: "",
      userPrefix: "prefix",
      userSuffix: "suffix",
    });
  });

  it("keeps context hook sourcing while placing after/context at the request end", () => {
    const formatted = formatBeforeModelRequestContext([
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "after context",
        position: "after",
        format: "context",
      },
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "plain suffix",
        position: "after",
        format: "plain",
      },
    ]);

    expect(formatted).toMatchObject({
      systemContext: "",
      userPrefix: "",
    });
    expect(formatted).not.toBeTypeOf("string");
    if (typeof formatted === "string") throw new Error("Expected structured context.");
    expect(formatted.userSuffix).toContain('<mingshen_plugin_context event="BeforeModelRequest"');
    expect(formatted.userSuffix).toContain("after context");
    expect(formatted.userSuffix).toMatch(/<\/mingshen_plugin_context>\n\nplain suffix$/u);
  });

  it("preserves declaration order across interleaved after/context and after/plain hooks", () => {
    const formatted = formatBeforeModelRequestContext([
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "context one",
        position: "after",
        format: "context",
      },
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "context two",
        position: "after",
        format: "context",
      },
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "plain one",
        position: "after",
        format: "plain",
      },
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "context three",
        position: "after",
        format: "context",
      },
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "plain two",
        position: "after",
        format: "plain",
      },
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "plain three",
        position: "after",
        format: "plain",
      },
    ]);

    if (typeof formatted === "string") throw new Error("Expected structured context.");
    const markers = ["context one", "context two", "plain one", "context three", "plain two"];
    const positions = markers.map((marker) => formatted.userSuffix.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(formatted.userSuffix.match(/<mingshen_plugin_context\b/gu)).toHaveLength(2);
    expect(formatted.userSuffix).toMatch(
      /context one\n\nPlugin 2 "Test plugin" \(plugin\):\ncontext two\n\n<\/mingshen_plugin_context>\n\nplain one\n\n<mingshen_plugin_context/u,
    );
    expect(formatted.userSuffix).toMatch(/plain two\nplain three$/u);
  });

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

  it("loads bounded per-request prompt context for a run-activated plugin only", async () => {
    const { service, session, extension } = fixture(
      {
        BeforeModelRequest: [
          {
            hooks: [
              {
                type: "prompt",
                text: [
                  `root=${pluginToken("MINGSHEN_PLUGIN_ROOT")}`,
                  `provider=${pluginToken("provider_id")}`,
                  `model=${pluginToken("model_id")}`,
                  `turn=${pluginToken("turn_id")}`,
                  `event=${pluginToken("hook_event_name")}`,
                ].join(" "),
              },
              { type: "command", command: "Write-Output must-not-run" },
              {
                type: "command",
                command: "Write-Output ignored-prompt-shaped-input",
                input: { type: "prompt", text: "must-not-be-context" },
              },
              {
                type: "mcp_tool",
                server: "fixture",
                tool: "notify",
                input: { should_not_execute: true },
              },
            ],
          },
        ],
      },
      { selected: false },
    );
    const result = await service.loadBeforeModelRequestContext(
      session,
      "run-42",
      new AbortController().signal,
      ["plugin"],
      { providerId: "provider-1", modelId: "model-1" },
    );
    expect(result.errors).toEqual([]);
    expect(result.contexts).toEqual([
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: `root=${extension.installedPath} provider=provider-1 model=model-1 turn=run-42 event=BeforeModelRequest`,
      },
    ]);
  });

  it("preserves prompt position and format declarations for request assembly", async () => {
    const { service, session } = fixture({
      BeforeModelRequest: [
        {
          hooks: [
            { type: "prompt", text: "before context" },
            {
              type: "prompt",
              text: "plain prefix",
              position: "before",
              format: "plain",
            },
            {
              type: "prompt",
              text: "after context",
              position: "after",
              format: "context",
            },
            {
              type: "prompt",
              text: "plain suffix",
              position: "after",
              format: "plain",
            },
          ],
        },
      ],
    });
    const result = await service.loadBeforeModelRequestContext(
      session,
      "run",
      new AbortController().signal,
    );

    expect(result.errors).toEqual([]);
    expect(result.contexts).toEqual([
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "before context",
      },
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "plain prefix",
        position: "before",
        format: "plain",
      },
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "after context",
        position: "after",
        format: "context",
      },
      {
        extensionId: "plugin",
        extensionName: "Test plugin",
        text: "plain suffix",
        position: "after",
        format: "plain",
      },
    ]);
  });

  it.each([
    { prompt: "legacy prompt field" },
    { text: 123 },
    { text: " \n \t " },
    { text: "invalid position", position: "middle" },
    { text: "invalid position", position: null },
    { text: "invalid format", format: "system" },
    { text: "invalid format", format: "" },
  ])("fails closed on malformed active BeforeModelRequest prompt: %o", async (prompt) => {
    const { service, session } = fixture({
      BeforeModelRequest: [{ hooks: [{ type: "prompt", ...prompt }] }],
    });

    const result = await service.loadBeforeModelRequestContext(
      session,
      "run-42",
      new AbortController().signal,
    );

    expect(result.contexts).toEqual([]);
    expect(result.errors).toMatchObject([
      {
        extensionId: "plugin",
        message: expect.stringContaining("BEFORE_MODEL_REQUEST_PROMPT_INVALID"),
      },
    ]);
  });

  it("reports an unreadable active declaration so the model caller can fail closed", async () => {
    const { service, session } = fixture("hooks/missing.json");
    const result = await service.loadBeforeModelRequestContext(
      session,
      "run-42",
      new AbortController().signal,
      ["plugin"],
    );
    expect(result.contexts).toEqual([]);
    expect(result.errors).toMatchObject([{ extensionId: "plugin", extensionName: "Test plugin" }]);
  });

  it("does not run required plugins without an explicit session reference", async () => {
    const { service, session } = fixture(
      {
        BeforeModelRequest: [{ hooks: [{ type: "prompt", text: "must stay unavailable" }] }],
      },
      { selected: false, activation: "required" },
    );
    await expect(
      service.loadBeforeModelRequestContext(session, "run", new AbortController().signal, [
        "plugin",
      ]),
    ).resolves.toEqual({ contexts: [], errors: [] });
  });

  it("does not run per-request hooks for ChatAgent or child sessions by default", async () => {
    const { service, session } = fixture({
      BeforeModelRequest: [{ hooks: [{ type: "prompt", text: "must not be injected" }] }],
    });
    for (const blockedSession of [
      { ...session, agentMode: "chat" },
      { ...session, parentSessionId: "parent" },
    ] as SessionView[]) {
      await expect(
        service.loadBeforeModelRequestContext(blockedSession, "run", new AbortController().signal, [
          "plugin",
        ]),
      ).resolves.toEqual({ contexts: [], errors: [] });
    }
  });

  it("loads only explicitly inherited child prompt hooks without enabling plugin actions", async () => {
    const callTool = vi.fn();
    const { service, session } = fixture(
      {
        UserPromptSubmit: [{ hooks: [{ type: "prompt", text: "submit stays blocked" }] }],
        BeforeModelRequest: [
          {
            hooks: [
              { type: "prompt", text: `child=${pluginToken("session_id")}` },
              { type: "command", command: "Write-Output must-not-run" },
              { type: "mcp_tool", server: "fixture", tool: "notify", input: {} },
            ],
          },
        ],
        PostToolUse: [
          { hooks: [{ type: "mcp_tool", server: "fixture", tool: "notify", input: {} }] },
        ],
      },
      { mcpService: { callTool } },
    );
    const child = { ...session, id: "child", parentSessionId: "parent" };
    const signal = new AbortController().signal;
    const options = { allowSubagentPromptContext: true };
    await expect(
      service.loadBeforeModelRequestContext(child, "run", signal, [], {}, options),
    ).resolves.toEqual({ contexts: [], errors: [] });
    await expect(
      service.loadBeforeModelRequestContext(child, "run", signal, ["plugin"], {}, options),
    ).resolves.toEqual({
      contexts: [{ extensionId: "plugin", extensionName: "Test plugin", text: "child=child" }],
      errors: [],
    });
    await expect(service.loadPromptContext(child)).resolves.toEqual({ contexts: [], errors: [] });
    const approve = vi.fn(async () => true);
    await expect(
      service.run("PostToolUse", child, "run", signal, approve, {}, ["plugin"]),
    ).resolves.toEqual([]);
    await expect(service.runInterrupt(child, "run", signal, {}, ["plugin"])).resolves.toEqual([]);
    expect(approve).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it("keeps ChatAgent and unselected required plugins blocked with child prompt opt-in", async () => {
    const { service, session } = fixture(
      { BeforeModelRequest: [{ hooks: [{ type: "prompt", text: "must stay blocked" }] }] },
      { selected: false, activation: "required" },
    );
    for (const blockedSession of [
      { ...session, agentMode: "chat" },
      { ...session, parentSessionId: "parent" },
    ] as SessionView[]) {
      await expect(
        service.loadBeforeModelRequestContext(
          blockedSession,
          "run",
          new AbortController().signal,
          ["plugin"],
          {},
          { allowSubagentPromptContext: true },
        ),
      ).resolves.toEqual({ contexts: [], errors: [] });
    }
  });

  it("returns a cancelled request without reading plugin resources", async () => {
    const { service, session } = fixture({
      BeforeModelRequest: [{ hooks: [{ type: "prompt", text: "must not be loaded" }] }],
    });
    const signal = AbortSignal.abort(new Error("fixture-cancelled"));
    await expect(service.loadBeforeModelRequestContext(session, "run", signal)).rejects.toThrow(
      "fixture-cancelled",
    );
  });

  it("rejects per-request prompt text that exceeds its bound instead of truncating it", async () => {
    const { service, session } = fixture({
      BeforeModelRequest: [
        {
          hooks: Array.from({ length: 8 }, () => ({ type: "prompt", text: "x".repeat(8_000) })),
        },
      ],
    });
    const result = await service.loadBeforeModelRequestContext(
      session,
      "run",
      new AbortController().signal,
    );
    expect(result.contexts).toEqual([]);
    expect(result.errors).toMatchObject([
      { message: expect.stringContaining("exceeds the 4000-character limit") },
    ]);
  });

  it("enforces the aggregate per-request prompt budget", async () => {
    const { service, session } = fixture({
      BeforeModelRequest: [
        {
          hooks: [
            { type: "prompt", text: "a".repeat(4_000) },
            { type: "prompt", text: "b".repeat(4_000) },
            { type: "prompt", text: "c".repeat(4_000) },
            { type: "prompt", text: "d" },
          ],
        },
      ],
    });
    const result = await service.loadBeforeModelRequestContext(
      session,
      "run",
      new AbortController().signal,
    );

    expect(result.contexts).toHaveLength(3);
    expect(result.errors).toMatchObject([
      { message: expect.stringContaining("exceeds the 12000-character limit") },
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

describe("Run-activated plugin hooks", () => {
  it("runs later action hooks for an on-demand plugin activated in the current run", async () => {
    const callTool = vi.fn(async () => ({ output: "notice recorded", isError: false }));
    const { service, session } = fixture(
      {
        PostToolUse: [
          {
            matcher: "write_file",
            hooks: [{ type: "mcp_tool", server: "notify", tool: "record", input: {} }],
          },
        ],
      },
      {
        selected: false,
        mcpService: {
          findServerByName: () =>
            ({ id: "plugin-server", name: "notify", enabled: true, configured: true }) as never,
          callTool,
        },
      },
    );
    const approve = vi.fn(async () => true);
    const signal = new AbortController().signal;
    const results = await service.run(
      "PostToolUse",
      session,
      "run",
      signal,
      approve,
      { toolName: "write_file" },
      ["plugin"],
    );

    expect(results).toMatchObject([{ status: "completed" }]);
    expect(approve).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledExactlyOnceWith("plugin-server", "record", {}, signal);
  });

  it("does not run an unselected required plugin even when given a run activation", async () => {
    const callTool = vi.fn();
    const { service, session } = fixture(
      {
        PostToolUse: [
          { hooks: [{ type: "mcp_tool", server: "notify", tool: "record", input: {} }] },
        ],
      },
      {
        selected: false,
        activation: "required",
        mcpService: {
          findServerByName: () =>
            ({ id: "plugin-server", name: "notify", enabled: true, configured: true }) as never,
          callTool,
        },
      },
    );
    const approve = vi.fn(async () => true);
    await expect(
      service.run(
        "PostToolUse",
        session,
        "run",
        new AbortController().signal,
        approve,
        { toolName: "write_file" },
        ["plugin"],
      ),
    ).resolves.toEqual([]);
    expect(approve).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
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
