import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rename, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProfileView, ModelConfig, SessionView } from "../../shared/domain";
import type { LocalPluginMarketSource, LocalPluginValidation } from "../../shared/local-plugins";
import {
  LOCAL_PLUGIN_TOOL,
  type LocalPluginReadService,
  localPluginRequestSchema,
} from "../extensions/local-plugin-tool";
import { PermissionStore } from "../permissions/permission-store";
import { ChatService } from "./chat-service";

const execFileAsync = promisify(execFile);
const WINDOWS_JUNCTION_SCRIPT = [
  'const { symlink } = require("node:fs/promises");',
  "const [target, link] = process.argv.slice(1);",
  'symlink(target, link, "junction").catch((error) => {',
  "  console.error(error);",
  "  process.exitCode = 1;",
  "});",
].join("\n");

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

const temporaryRoots: string[] = [];

async function createDirectoryLink(target: string, link: string): Promise<void> {
  if (process.platform !== "win32") {
    await symlink(target, link, "dir");
    return;
  }
  try {
    await symlink(target, link, "junction");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES") throw error;
    await execFileAsync(process.execPath, ["-e", WINDOWS_JUNCTION_SCRIPT, target, link], {
      timeout: 10_000,
      windowsHide: true,
    });
  }
}

function directoryLinkPermissionCode(error: unknown): "EPERM" | "EACCES" | null {
  const directCode = (error as NodeJS.ErrnoException | undefined)?.code;
  if (directCode === "EPERM" || directCode === "EACCES") return directCode;
  const stderr = String((error as { stderr?: unknown } | undefined)?.stderr ?? "");
  const stdout = String((error as { stdout?: unknown } | undefined)?.stdout ?? "");
  const message = error instanceof Error ? error.message : String(error);
  const match = /\b(EPERM|EACCES)\b/.exec(`${message}\n${stdout}\n${stderr}`);
  return match?.[1] === "EPERM" || match?.[1] === "EACCES" ? match[1] : null;
}

async function removeDirectoryLink(root: string, link: string): Promise<void> {
  const fixtureRoot = resolve(root);
  const resolvedLink = resolve(link);
  const local = relative(fixtureRoot, resolvedLink);
  if (
    !local ||
    local === ".." ||
    local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  )
    throw new Error("Refusing to remove a directory link outside the test fixture.");
  try {
    if (!(await lstat(resolvedLink)).isSymbolicLink()) return;
    await unlink(resolvedLink);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function validation(rootPath: string): LocalPluginValidation {
  return {
    ok: false,
    rootPath,
    manifestPath: join(rootPath, ".mingshen-plugin", "plugin.json"),
    manifestKind: "mingshen",
    name: "fixture-plugin",
    version: "0.1.0",
    description: "Fixture plugin",
    contentHash: "a".repeat(64),
    skills: [],
    commands: [],
    hookEvents: [],
    mcpServers: [],
    errors: [{ code: "fixture-error", message: "Fixture validation error" }],
    warnings: [{ code: "fixture-warning", message: "Fixture validation warning" }],
  };
}

const market: LocalPluginMarketSource = {
  id: "local-fixture",
  name: "fixture-market",
  displayName: "Fixture market",
  description: "Local development market",
  rootPath: "C:\\fixture-market",
  catalogPath: "C:\\fixture-market\\marketplace.json",
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mingshen-local-plugin-tool-"));
  temporaryRoots.push(root);
  return root;
}

function profileWith(
  permissions: AgentProfileView["permissions"] = {},
  toolAllowlist: string[] = [],
): AgentProfileView {
  return {
    id: "local-plugin-profile",
    name: "Local Plugin Developer",
    permissions,
    readOnly: false,
    toolAllowlist,
  } as AgentProfileView;
}

function sessionWith(workspacePath: string, overrides: Partial<SessionView> = {}): SessionView {
  return {
    id: "local-plugin-session",
    agentProfileId: "local-plugin-profile",
    agentMode: "code",
    workspacePath,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
    ...overrides,
  } as SessionView;
}

function runtime(
  service: LocalPluginReadService | undefined,
  profile: AgentProfileView | null = profileWith(),
  session?: SessionView,
) {
  const permissions = new PermissionStore();
  const repository = {
    getAgentProfile: () => profile,
    listAgentProfiles: () => [],
    getSetting: () => null,
  };
  const chat = new ChatService({
    repository,
    permissions,
    localPluginMarketplaceService: service,
    mcpService: {
      list: () => [],
      syncWorkspaceConfig: vi.fn(),
      toolDefinitions: vi.fn(async () => []),
    },
    projectConfigService: { load: vi.fn(async () => ({ mcpServers: [] })) },
    customToolService: { list: vi.fn(async () => []), descriptors: vi.fn(async () => []) },
    toolRegistry: { descriptors: () => [] },
    emit: vi.fn(),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    availableTools: (session: SessionView, model: ModelConfig) => Promise<Array<{ name: string }>>;
    requestApproval: ReturnType<typeof vi.fn>;
    executeOwnedToolCall: (
      input: {
        session: SessionView;
        runId: string;
        signal: AbortSignal;
        toolCall: {
          name: string;
          arguments: string;
          callId: string;
          index: number;
        };
      },
      onCommandLease: (release: () => void) => void,
    ) => Promise<{ output: string; isError: boolean }>;
  };
  return {
    chat,
    internal,
    permissions,
    execute: (
      args: Record<string, unknown>,
      activeSession = session ?? sessionWith(String(args.rootPath ?? "C:\\workspace")),
      signal = new AbortController().signal,
    ) =>
      internal.executeOwnedToolCall(
        {
          session: activeSession,
          runId: "local-plugin-run",
          signal,
          toolCall: {
            name: "local_plugin",
            arguments: JSON.stringify(args),
            callId: "local-plugin-call",
            index: 0,
          },
        },
        vi.fn(),
      ),
  };
}

describe("local_plugin schema", () => {
  it.each([
    { action: "install", rootPath: "C:\\workspace\\plugin" },
    { action: "update", rootPath: "C:\\workspace\\plugin" },
    { action: "enable", rootPath: "C:\\workspace\\plugin" },
    { action: "validate", rootPath: "C:\\workspace\\plugin", enabled: true },
  ])("rejects lifecycle mutations and unknown fields: %o", (request) => {
    expect(() => localPluginRequestSchema.parse(request)).toThrow();
  });

  it("describes a read-only tool surface", () => {
    expect(LOCAL_PLUGIN_TOOL.name).toBe("local_plugin");
    expect(LOCAL_PLUGIN_TOOL.description).toContain("never installs");
    expect(LOCAL_PLUGIN_TOOL.description).toContain("protected session");
    expect(LOCAL_PLUGIN_TOOL.description).toContain("instead of invoking the Node SDK CLI");
    expect(LOCAL_PLUGIN_TOOL.description).toContain(
      "Settings > Skills and plugins > Local plugin development marketplace",
    );
  });
});

describe("local_plugin runtime boundary", () => {
  it("lists the tool for supported main host sessions in protected and full-access modes", async () => {
    const workspace = await createRoot();
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const runtimeUnderTest = runtime(service, null, sessionWith(workspace));
    const supported = await runtimeUnderTest.internal.availableTools(sessionWith(workspace), {
      toolCalls: true,
    } as ModelConfig);
    expect(supported.map((tool) => tool.name)).toContain("local_plugin");
    const protectedTools = await runtimeUnderTest.internal.availableTools(
      sessionWith(workspace, { permissionMode: "request_approval" }),
      { toolCalls: true } as ModelConfig,
    );
    expect(protectedTools.map((tool) => tool.name)).toContain("local_plugin");
    const workTools = await runtimeUnderTest.internal.availableTools(
      sessionWith(workspace, { agentMode: "work" }),
      { toolCalls: true } as ModelConfig,
    );
    expect(workTools.map((tool) => tool.name)).toContain("local_plugin");

    for (const unsupported of [
      sessionWith(workspace, { agentMode: "chat", workspacePath: null }),
      sessionWith(workspace, { executionMode: "docker" }),
      sessionWith(workspace, { executionMode: "worktree" }),
      sessionWith(workspace, { parentSessionId: "parent-session" }),
    ]) {
      const tools = await runtimeUnderTest.internal.availableTools(unsupported, {
        toolCalls: true,
      } as ModelConfig);
      expect(tools.map((tool) => tool.name)).not.toContain("local_plugin");
    }
    expect(service.validatePlugin).not.toHaveBeenCalled();
    expect(service.listSources).not.toHaveBeenCalled();
  });

  it("omits and rejects the interface when the backend service is unavailable", async () => {
    const workspace = await createRoot();
    const pluginRoot = join(workspace, "plugin");
    await mkdir(pluginRoot);
    const runtimeUnderTest = runtime(undefined, profileWith(), sessionWith(workspace));
    const tools = await runtimeUnderTest.internal.availableTools(sessionWith(workspace), {
      toolCalls: true,
    } as ModelConfig);
    expect(tools.map((tool) => tool.name)).not.toContain("local_plugin");
    expect(
      await runtimeUnderTest.execute({ action: "validate", rootPath: pluginRoot }),
    ).toMatchObject({
      isError: true,
      output: expect.stringContaining("LOCAL_PLUGIN_UNAVAILABLE"),
    });
  });

  it.each([
    ["docker", { executionMode: "docker" }],
    ["worktree", { executionMode: "worktree" }],
    ["subagent", { parentSessionId: "parent-session" }],
  ] as const)("rejects %s sessions before reading the source", async (_name, overrides) => {
    const workspace = await createRoot();
    const pluginRoot = join(workspace, "plugin");
    await mkdir(pluginRoot);
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const runtimeUnderTest = runtime(service, profileWith(), sessionWith(workspace, overrides));
    const result = await runtimeUnderTest.execute(
      { action: "validate", rootPath: pluginRoot },
      sessionWith(workspace, overrides),
    );
    expect(result).toMatchObject({
      isError: true,
      output: expect.stringContaining("LOCAL_PLUGIN_SESSION_UNSUPPORTED"),
    });
    expect(service.validatePlugin).not.toHaveBeenCalled();
  });

  it("requests path-scoped read approval before protected validation", async () => {
    const workspace = await createRoot();
    const pluginRoot = join(workspace, "plugin");
    await mkdir(pluginRoot);
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const protectedSession = sessionWith(workspace, { permissionMode: "request_approval" });
    const runtimeUnderTest = runtime(service, profileWith(), protectedSession);
    runtimeUnderTest.internal.requestApproval = vi.fn(async (request) => ({
      approvalId: request.id,
      decision: "allow_once",
    }));

    const result = await runtimeUnderTest.execute(
      { action: "validate", rootPath: pluginRoot },
      protectedSession,
    );

    expect(result.isError).toBe(false);
    expect(runtimeUnderTest.internal.requestApproval).toHaveBeenCalledOnce();
    expect(runtimeUnderTest.internal.requestApproval.mock.calls[0]?.[0]).toMatchObject({
      toolName: "local_plugin",
      pathScope: pluginRoot,
      risk: "normal",
      reviewInput: expect.stringContaining('"action":"validate"'),
    });
    expect(service.validatePlugin).toHaveBeenCalledWith(pluginRoot, expect.any(AbortSignal));
  });

  it("does not scan protected plugin source when read approval is denied", async () => {
    const workspace = await createRoot();
    const pluginRoot = join(workspace, "plugin");
    await mkdir(pluginRoot);
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const protectedSession = sessionWith(workspace, { permissionMode: "request_approval" });
    const runtimeUnderTest = runtime(service, profileWith(), protectedSession);
    runtimeUnderTest.internal.requestApproval = vi.fn(async (request) => ({
      approvalId: request.id,
      decision: "deny",
      feedback: "keep the folder private",
    }));

    const result = await runtimeUnderTest.execute(
      { action: "validate", rootPath: pluginRoot },
      protectedSession,
    );

    expect(result).toMatchObject({
      isError: true,
      output: expect.stringContaining("keep the folder private"),
    });
    expect(service.validatePlugin).not.toHaveBeenCalled();
  });

  it("rechecks canonical paths after approval and discards a grant when an ancestor link changes", async (context) => {
    if (process.platform !== "win32") {
      context.skip("Approval-time ancestor junction regression requires Windows.");
      return;
    }
    const fixtureRoot = await createRoot();
    const workspace = join(fixtureRoot, "workspace");
    const outside = join(fixtureRoot, "outside");
    const pluginsRoot = join(workspace, "plugins");
    const originalPluginsRoot = join(workspace, "plugins-original");
    const pluginRoot = join(pluginsRoot, "plugin");
    await mkdir(pluginRoot, { recursive: true });
    await mkdir(join(outside, "plugin"), { recursive: true });
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const protectedSession = sessionWith(workspace, { permissionMode: "request_approval" });
    const runtimeUnderTest = runtime(service, profileWith(), protectedSession);
    let swapped = false;
    let linkCreated = false;
    let swapError: unknown = null;
    runtimeUnderTest.internal.requestApproval = vi.fn(async (request) => {
      try {
        await rename(pluginsRoot, originalPluginsRoot);
        swapped = true;
        await createDirectoryLink(outside, pluginsRoot);
        linkCreated = true;
      } catch (error) {
        swapError = error;
        throw error;
      }
      return {
        approvalId: request.id,
        decision: "allow_session",
      };
    });

    let firstResult: Awaited<ReturnType<typeof runtimeUnderTest.execute>>;
    try {
      firstResult = await runtimeUnderTest.execute(
        { action: "validate", rootPath: pluginRoot },
        protectedSession,
      );
    } finally {
      if (linkCreated) await removeDirectoryLink(fixtureRoot, pluginsRoot);
      if (swapped) await rename(originalPluginsRoot, pluginsRoot);
    }
    if (swapError) {
      const permissionCode = directoryLinkPermissionCode(swapError);
      if (permissionCode) {
        context.skip(`This Windows environment denies directory links with ${permissionCode}.`);
        return;
      }
      throw swapError;
    }

    expect(firstResult).toMatchObject({
      isError: true,
      output: expect.stringContaining("LOCAL_PLUGIN_PATH_CHANGED"),
    });
    expect(service.validatePlugin).not.toHaveBeenCalled();

    const secondApproval = vi.fn(async () => ({ decision: "deny" }));
    runtimeUnderTest.internal.requestApproval = secondApproval;
    const secondResult = await runtimeUnderTest.execute(
      { action: "validate", rootPath: pluginRoot },
      protectedSession,
    );
    expect(secondResult).toMatchObject({
      isError: true,
      output: expect.stringContaining("拒绝"),
    });
    expect(secondApproval).toHaveBeenCalledOnce();
    expect(service.validatePlugin).not.toHaveBeenCalled();
  }, 15_000);

  it("reuses a protected session read grant without prompting again", async () => {
    const workspace = await createRoot();
    const pluginRoot = join(workspace, "plugin");
    await mkdir(pluginRoot);
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const protectedSession = sessionWith(workspace, { permissionMode: "request_approval" });
    const runtimeUnderTest = runtime(service, profileWith(), protectedSession);
    runtimeUnderTest.permissions.remember(
      protectedSession.id,
      {
        id: "prior-approval",
        sessionId: protectedSession.id,
        runId: "prior-run",
        toolCallId: "prior-call",
        toolName: "local_plugin",
        summary: "prior approval",
        detail: pluginRoot,
        pathScope: pluginRoot,
        commandPrefix: null,
        risk: "normal",
        createdAt: new Date().toISOString(),
      },
      { approvalId: "prior-approval", decision: "allow_session" },
    );
    runtimeUnderTest.internal.requestApproval = vi.fn();

    const result = await runtimeUnderTest.execute(
      { action: "inspect", rootPath: pluginRoot },
      protectedSession,
    );

    expect(result.isError).toBe(false);
    expect(runtimeUnderTest.internal.requestApproval).not.toHaveBeenCalled();
    expect(service.validatePlugin).toHaveBeenCalledWith(pluginRoot, expect.any(AbortSignal));
  });

  it("preserves cancellation before protected plugin validation", async () => {
    const workspace = await createRoot();
    const pluginRoot = join(workspace, "plugin");
    await mkdir(pluginRoot);
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const protectedSession = sessionWith(workspace, { permissionMode: "request_approval" });
    const runtimeUnderTest = runtime(service, profileWith(), protectedSession);
    const controller = new AbortController();
    runtimeUnderTest.internal.requestApproval = vi.fn(async () => {
      controller.abort();
      throw new Error("cancelled");
    });

    await expect(
      runtimeUnderTest.execute(
        { action: "validate", rootPath: pluginRoot },
        protectedSession,
        controller.signal,
      ),
    ).rejects.toThrow("cancelled");
    expect(service.validatePlugin).not.toHaveBeenCalled();
  });

  it("rejects ChatAgent even if a caller bypasses tool discovery", async () => {
    const workspace = await createRoot();
    const pluginRoot = join(workspace, "plugin");
    await mkdir(pluginRoot);
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const runtimeUnderTest = runtime(
      service,
      profileWith(),
      sessionWith(workspace, { agentMode: "chat", workspacePath: null }),
    );
    const result = await runtimeUnderTest.execute(
      { action: "validate", rootPath: pluginRoot },
      sessionWith(workspace, { agentMode: "chat", workspacePath: null }),
    );
    expect(result).toMatchObject({
      isError: true,
      output: expect.stringContaining("CHAT_TOOL_DENIED"),
    });
    expect(service.validatePlugin).not.toHaveBeenCalled();
  });

  it("requires an absolute plugin root inside the current workspace", async () => {
    const workspace = await createRoot();
    const outside = await createRoot();
    const outsidePlugin = join(outside, "plugin");
    await mkdir(outsidePlugin);
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const runtimeUnderTest = runtime(service, profileWith(), sessionWith(workspace));

    expect(
      await runtimeUnderTest.execute({ action: "validate", rootPath: "plugin" }),
    ).toMatchObject({
      isError: true,
      output: expect.stringContaining("must be an absolute"),
    });
    expect(
      await runtimeUnderTest.execute({ action: "validate", rootPath: outsidePlugin }),
    ).toMatchObject({
      isError: true,
      output: expect.stringContaining("LOCAL_PLUGIN_PATH_INVALID"),
    });
    expect(service.validatePlugin).not.toHaveBeenCalled();
  });

  it("returns an invalid plugin as structured validation, not a failed tool call", async () => {
    const workspace = await createRoot();
    const pluginRoot = join(workspace, "plugin");
    await mkdir(pluginRoot);
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const runtimeUnderTest = runtime(service, profileWith(), sessionWith(workspace));
    const result = await runtimeUnderTest.execute({
      action: "validate",
      rootPath: pluginRoot,
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toMatchObject({
      action: "validate",
      readOnly: true,
      lifecycleChanged: false,
      validation: {
        ok: false,
        errors: [{ code: "fixture-error" }],
      },
    });
    expect(service.validatePlugin).toHaveBeenCalledOnce();
    expect(service.validatePlugin).toHaveBeenCalledWith(pluginRoot, expect.any(AbortSignal));
  });

  it("reapplies a subject-scoped Profile deny to the canonical plugin root", async (context) => {
    if (process.platform !== "win32") {
      context.skip("Canonical Windows separator and parent-segment aliases require Windows.");
      return;
    }
    const workspace = await createRoot();
    const pluginRoot = join(workspace, "plugin");
    await mkdir(pluginRoot);
    const canonicalPluginRoot = await realpath(pluginRoot);
    for (const rootAlias of [
      pluginRoot.replaceAll("\\", "/"),
      `${workspace}\\ignored\\..\\plugin`,
    ]) {
      const service: LocalPluginReadService = {
        listSources: vi.fn(() => []),
        validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
      };
      const profile = profileWith({ read: "allow", [`read_file:${canonicalPluginRoot}`]: "deny" }, [
        "read_file",
      ]);
      const runtimeUnderTest = runtime(service, profile, sessionWith(workspace));
      runtimeUnderTest.internal.requestApproval = vi.fn(async () => ({ decision: "deny" }));
      const result = await runtimeUnderTest.execute({
        action: "validate",
        rootPath: rootAlias,
      });
      expect(result).toMatchObject({
        isError: true,
        output: expect.stringContaining("禁止"),
      });
      expect(runtimeUnderTest.internal.requestApproval).not.toHaveBeenCalled();
      expect(service.validatePlugin).not.toHaveBeenCalled();
    }
  });

  it("applies a canonical subject-scoped ask once in full-access mode", async (context) => {
    if (process.platform !== "win32") {
      context.skip("Canonical Windows alias requires Windows.");
      return;
    }
    const workspace = await createRoot();
    const pluginRoot = join(workspace, "plugin");
    await mkdir(pluginRoot);
    const canonicalPluginRoot = await realpath(pluginRoot);
    const rootAlias = `${workspace}\\ignored\\..\\plugin`;
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => []),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const profile = profileWith({ read: "allow", [`read_file:${canonicalPluginRoot}`]: "ask" }, [
      "read_file",
    ]);
    const runtimeUnderTest = runtime(service, profile, sessionWith(workspace));
    runtimeUnderTest.internal.requestApproval = vi.fn(async () => ({ decision: "deny" }));
    const result = await runtimeUnderTest.execute({
      action: "validate",
      rootPath: rootAlias,
    });
    expect(result).toMatchObject({
      isError: true,
      output: expect.stringContaining("拒绝"),
    });
    expect(runtimeUnderTest.internal.requestApproval).toHaveBeenCalledOnce();
    expect(runtimeUnderTest.internal.requestApproval.mock.calls[0]?.[0]).toMatchObject({
      toolName: "local_plugin",
      pathScope: canonicalPluginRoot,
      manualOnly: true,
    });
    expect(service.validatePlugin).not.toHaveBeenCalled();
  });

  it("returns registered market metadata without scanning market directories", async () => {
    const workspace = await createRoot();
    const service: LocalPluginReadService = {
      listSources: vi.fn(() => [market]),
      validatePlugin: vi.fn(async (rootPath) => validation(rootPath)),
    };
    const runtimeUnderTest = runtime(service, profileWith(), sessionWith(workspace));
    const result = await runtimeUnderTest.execute({ action: "list_markets" });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output)).toEqual({
      action: "list_markets",
      markets: [market],
      readOnly: true,
    });
    expect(service.listSources).toHaveBeenCalledOnce();
    expect(service.validatePlugin).not.toHaveBeenCalled();
  });
});
