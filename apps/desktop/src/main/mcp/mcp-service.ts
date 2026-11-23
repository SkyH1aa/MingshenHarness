import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawn as spawnPortable } from "cross-spawn";
import type {
  McpOAuthStartResult,
  McpServerSaveInput,
  McpServerTestResult,
  McpServerView,
  McpToolSummary,
} from "../../shared/domain";
import { APP_VERSION } from "../../shared/release";
import type { McpServerConfig } from "../agents/project-config-service";
import { recordRuntimeError } from "../diagnostics/runtime-log";
import {
  expandPluginRootTokens,
  loadLocalPluginJsonDeclaration,
  PLUGIN_ROOT_TOKENS,
  pluginMcpServerId,
} from "../extensions/local-plugin-manifest";
import type { StreamToolDefinition } from "../providers/model-stream";
import { redactSecrets } from "../security/redact";
import type { Repository } from "../storage/repository";
import type { SecretStore } from "../storage/secret-store";

interface SecretConfig {
  headers: Record<string, string>;
  env: Record<string, string>;
  oauth?: {
    enabled: boolean;
    clientId?: string;
    clientSecret?: string;
    scope?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    tokenEndpoint?: string;
    authorizationServer?: string;
    resource?: string;
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface StdioConnection {
  child: ChildProcess;
  pending: Map<number, PendingRequest>;
  buffer: string;
  stderr: string;
  nextId: number;
  timeoutMs: number;
}

interface HttpConnection {
  sessionId: string | null;
  nextId: number;
}

interface PluginMcpSaveInput extends McpServerSaveInput {
  id: string;
}

export interface McpToolDefinition extends StreamToolDefinition {
  exposedName: string;
  serverId: string;
  serverName: string;
  toolName: string;
  readOnly: boolean;
}

const BUILTIN_SERVERS: Array<{
  id: string;
  name: string;
  description: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headerKeys?: string[];
  envKeys?: string[];
}> = [
  {
    id: "builtin-github",
    name: "GitHub",
    description: "GitHub 官方 MCP Server，支持仓库、Issue、PR、Actions 和代码搜索。",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    headerKeys: ["Authorization"],
  },
  {
    id: "builtin-notion",
    name: "Notion",
    description: "搜索、读取并编辑 Notion 页面与数据库。",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    envKeys: ["NOTION_TOKEN"],
  },
  {
    id: "builtin-wikipedia",
    name: "Wikipedia",
    description: "搜索和读取 Wikipedia 条目。",
    transport: "stdio",
    command: "npx",
    args: ["-y", "wikipedia-mcp"],
  },
  {
    id: "builtin-browserbase",
    name: "Browserbase",
    description: "云端浏览器自动化、页面观察与结构化提取。",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@browserbasehq/mcp"],
    envKeys: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"],
  },
  {
    id: "builtin-browserdo",
    name: "BrowserDo",
    description: "面向 Windows 的后台浏览器 MCP，支持多标签页和页面操作。",
    transport: "stdio",
    command: "npx",
    args: ["-y", "browserdo-mcp"],
  },
];

const PROTOCOL_VERSION = "2025-06-18";
const MAX_HTTP_ERROR_BODY = 100_000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function httpResponseError(response: Response, body: string, secrets: string[] = []): Error {
  const safeBody = redactSecrets(body, secrets);
  return new Error(
    `HTTP ${response.status} ${response.statusText}\n${safeBody.slice(0, MAX_HTTP_ERROR_BODY)}${safeBody.length > MAX_HTTP_ERROR_BODY ? "\n[Response truncated at 100,000 characters]" : ""}`,
  );
}

function normalizeMcpName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 42);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function containsPluginRootToken(value: string): boolean {
  return PLUGIN_ROOT_TOKENS.some((token) => value.includes(token));
}

function assertPluginPathWithinRoot(pluginRoot: string, target: string): string {
  const root = resolve(pluginRoot);
  const resolvedTarget = resolve(target);
  const local = relative(root, resolvedTarget);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error("Plugin root token resolved outside the installed plugin directory.");
  }
  return resolvedTarget;
}

function expandPluginPathValue(value: string, pluginRoot: string): string {
  if (!containsPluginRootToken(value)) return value;
  let cursor = 0;
  while (cursor < value.length) {
    const matches = PLUGIN_ROOT_TOKENS.map((token) => ({
      token,
      index: value.indexOf(token, cursor),
    })).filter((entry) => entry.index >= 0);
    if (!matches.length) break;
    const match = matches.sort((left, right) => left.index - right.index)[0];
    if (!match) break;
    const tail = value.slice(match.index + match.token.length).split(/[\s"'`,;]/u, 1)[0] ?? "";
    assertPluginPathWithinRoot(pluginRoot, resolve(pluginRoot, `.${tail || sep}`));
    cursor = match.index + match.token.length;
  }
  return expandPluginRootTokens(value, resolve(pluginRoot));
}

function pluginRuntimeValues(value: unknown, extensionPath: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asRecord(value))
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, entry]) => [
        key,
        expandPluginPathValue(entry, extensionPath)
          .replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name: string) => process.env[name] ?? "")
          .replace(/^\.\//, `${resolve(extensionPath)}\\`),
      ])
      .filter(([, entry]) => Boolean(entry)),
  );
}

function mergePreservedPluginSecrets(
  current: Record<string, string>,
  declared: Record<string, string>,
): Record<string, string> {
  const merged = { ...current };
  const keys = new Set(Object.keys(current).map((key) => key.toLocaleLowerCase("en-US")));
  for (const [key, value] of Object.entries(declared)) {
    const normalized = key.toLocaleLowerCase("en-US");
    if (keys.has(normalized)) continue;
    merged[key] = value;
    keys.add(normalized);
  }
  return merged;
}

function parseSecretConfig(value: string): SecretConfig {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return { headers: {}, env: {} };
    }
    const record = parsed as Record<string, unknown>;
    const oauthValue =
      record.oauth && typeof record.oauth === "object"
        ? (record.oauth as Record<string, unknown>)
        : null;
    return {
      headers:
        record.headers && typeof record.headers === "object"
          ? Object.fromEntries(
              Object.entries(record.headers as Record<string, unknown>)
                .filter((entry): entry is [string, string] => typeof entry[1] === "string")
                .map(([key, entry]) => [key, entry]),
            )
          : {},
      env:
        record.env && typeof record.env === "object"
          ? Object.fromEntries(
              Object.entries(record.env as Record<string, unknown>)
                .filter((entry): entry is [string, string] => typeof entry[1] === "string")
                .map(([key, entry]) => [key, entry]),
            )
          : {},
      ...(oauthValue
        ? {
            oauth: {
              enabled: oauthValue.enabled === true,
              ...(typeof oauthValue.clientId === "string" ? { clientId: oauthValue.clientId } : {}),
              ...(typeof oauthValue.clientSecret === "string"
                ? { clientSecret: oauthValue.clientSecret }
                : {}),
              ...(typeof oauthValue.scope === "string" ? { scope: oauthValue.scope } : {}),
              ...(typeof oauthValue.accessToken === "string"
                ? { accessToken: oauthValue.accessToken }
                : {}),
              ...(typeof oauthValue.refreshToken === "string"
                ? { refreshToken: oauthValue.refreshToken }
                : {}),
              ...(typeof oauthValue.expiresAt === "number"
                ? { expiresAt: oauthValue.expiresAt }
                : {}),
              ...(typeof oauthValue.tokenEndpoint === "string"
                ? { tokenEndpoint: oauthValue.tokenEndpoint }
                : {}),
              ...(typeof oauthValue.authorizationServer === "string"
                ? { authorizationServer: oauthValue.authorizationServer }
                : {}),
              ...(typeof oauthValue.resource === "string" ? { resource: oauthValue.resource } : {}),
            },
          }
        : {}),
    };
  } catch {
    return { headers: {}, env: {} };
  }
}

function toolListFromResult(value: unknown): McpToolSummary[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const tools = (value as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((tool) => ({
      name: String(tool.name ?? ""),
      title:
        typeof tool.title === "string"
          ? tool.title
          : typeof tool.annotations === "object" &&
              tool.annotations &&
              typeof (tool.annotations as Record<string, unknown>).title === "string"
            ? String((tool.annotations as Record<string, unknown>).title)
            : String(tool.name ?? ""),
      description: String(tool.description ?? ""),
      readOnly:
        Boolean(tool.annotations && typeof tool.annotations === "object") &&
        Boolean((tool.annotations as Record<string, unknown>).readOnlyHint),
      parameters:
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? (tool.inputSchema as Record<string, unknown>)
          : { type: "object", additionalProperties: true },
    }))
    .filter((tool) => tool.name);
}

function builtinReadOnly(serverId: string, tool: McpToolSummary): boolean {
  if (tool.readOnly || serverId === "builtin-wikipedia") {
    return true;
  }
  return (
    serverId === "builtin-browserdo" &&
    [
      "browser_status",
      "browser_take_snapshot",
      "browser_read_pages",
      "browser_get_window_info",
    ].includes(tool.name)
  );
}

export class McpService {
  private readonly stdioConnections = new Map<string, StdioConnection>();
  private readonly httpConnections = new Map<string, HttpConnection>();
  private readonly initializations = new WeakMap<object, Promise<void>>();
  private readonly workspaceFingerprints = new Map<string, string>();

  constructor(
    private readonly repository: Repository,
    private readonly secretStore: SecretStore,
    private readonly appVersion: string,
  ) {
    this.ensureBuiltins();
  }

  list(): McpServerView[] {
    return this.repository.listMcpServers().map((server) => {
      const secrets = this.secretConfig(server.id);
      const oauth = secrets.oauth;
      const oauthAuthenticated = Boolean(oauth?.accessToken || oauth?.refreshToken);
      const pluginAvailable = this.isPluginServerAvailable(server.id);
      const hasConnection =
        server.transport === "stdio" ? Boolean(server.command) : Boolean(server.url);
      const secretsConfigured =
        server.headerKeys.every((key) => Boolean(secrets.headers[key])) &&
        server.envKeys.every((key) => Boolean(secrets.env[key]));
      return {
        ...server,
        enabled: server.enabled && pluginAvailable,
        oauthEnabled: oauth?.enabled ?? false,
        oauthAuthenticated,
        configured:
          hasConnection &&
          (secretsConfigured || (server.transport === "http" && Boolean(oauth?.enabled))),
      };
    });
  }

  private isPluginServerAvailable(serverId: string): boolean {
    const owners = this.repository
      .listExtensions()
      .filter(
        (extension) =>
          extension.type === "plugin" &&
          extension.mcpServerNames.some(
            (serverName) => pluginMcpServerId(extension.id, serverName) === serverId,
          ),
      );
    return owners.length === 0 || (owners.length === 1 && Boolean(owners[0]?.enabled));
  }

  pluginMcpServerIds(): ReadonlySet<string> {
    return new Set(
      this.repository
        .listExtensions()
        .filter((extension) => extension.type === "plugin")
        .flatMap((extension) =>
          extension.mcpServerNames.map((serverName) => pluginMcpServerId(extension.id, serverName)),
        ),
    );
  }

  private diagnosticSecrets(serverId: string): string[] {
    const secrets = this.secretConfig(serverId);
    return [
      ...Object.values(secrets.headers),
      ...Object.values(secrets.env),
      secrets.oauth?.accessToken ?? "",
      secrets.oauth?.refreshToken ?? "",
      secrets.oauth?.clientSecret ?? "",
    ];
  }

  private diagnostic(serverId: string, cause: unknown): string {
    const message = redactSecrets(errorText(cause), this.diagnosticSecrets(serverId));
    recordRuntimeError("mcp.server", message, { serverId });
    return message;
  }

  async importPluginServers(extensionId: string): Promise<void> {
    const extension = this.repository.getExtension(extensionId);
    const manifest = this.repository.getExtensionManifest(extensionId);
    if (!extension || !manifest || extension.type !== "plugin") {
      return;
    }
    const paths = asRecord(manifest.paths);
    const declared = await loadLocalPluginJsonDeclaration(
      extension.installedPath,
      paths.mcpServers ?? manifest.mcpServers,
      "mcpServers",
    );
    const desired = Object.entries(declared);
    const desiredIds = new Set<string>();
    const saves: PluginMcpSaveInput[] = [];
    for (const [name, raw] of desired) {
      const id = pluginMcpServerId(extension.id, name);
      if (desiredIds.has(id)) {
        throw new Error(`Plugin MCP declarations collapse to the same server id: ${name}`);
      }
      desiredIds.add(id);
      const config = asRecord(raw);
      const rawUrl =
        typeof config.url === "string"
          ? config.url
          : typeof config.serverUrl === "string"
            ? config.serverUrl
            : "";
      const url = expandPluginPathValue(rawUrl, extension.installedPath);
      const rawCommand = typeof config.command === "string" ? config.command : "";
      let commandValue = expandPluginPathValue(rawCommand, extension.installedPath);
      if (!url && !commandValue) {
        throw new Error(`Plugin MCP server ${name} must declare command or url.`);
      }
      if (commandValue.startsWith("./") || commandValue.startsWith(".\\")) {
        commandValue = assertPluginPathWithinRoot(
          extension.installedPath,
          resolve(extension.installedPath, commandValue),
        );
      }
      const command = commandValue;
      const existing = this.repository.getMcpServer(id);
      const currentSecrets = existing ? this.secretConfig(existing.id) : { headers: {}, env: {} };
      const declaredHeaders = pluginRuntimeValues(config.headers, extension.installedPath);
      const declaredEnv = pluginRuntimeValues(config.env, extension.installedPath);
      const headers = mergePreservedPluginSecrets(currentSecrets.headers, declaredHeaders);
      const env = mergePreservedPluginSecrets(currentSecrets.env, declaredEnv);
      const rawCwd = typeof config.cwd === "string" ? config.cwd : "";
      const cwd = rawCwd
        ? assertPluginPathWithinRoot(
            extension.installedPath,
            resolve(
              extension.installedPath,
              expandPluginPathValue(rawCwd, extension.installedPath),
            ),
          )
        : extension.installedPath;
      const args = Array.isArray(config.args)
        ? config.args
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => expandPluginPathValue(entry, extension.installedPath))
        : [];
      saves.push({
        id,
        name: `${extension.name} · ${name}`,
        description:
          typeof config.description === "string"
            ? config.description
            : `由插件 ${extension.name} 提供`,
        transport: url ? "http" : "stdio",
        enabled: existing?.enabled ?? config.enabled !== false,
        command,
        args,
        url,
        cwd,
        timeoutMs: typeof config.timeout === "number" ? config.timeout : 30_000,
        headers,
        env,
      });
    }

    for (const input of saves) await this.save(input);

    const prefix = `plugin-${extension.id.slice(0, 8)}-`;
    const otherPluginServerIds = new Set(
      this.repository
        .listExtensions()
        .filter((item) => item.type === "plugin" && item.id !== extension.id)
        .flatMap((item) =>
          item.mcpServerNames.map((serverName) => pluginMcpServerId(item.id, serverName)),
        ),
    );
    const ownedNamePrefix = `${extension.name} · `;
    for (const server of this.list()) {
      if (
        server.id.startsWith(prefix) &&
        server.name.startsWith(ownedNamePrefix) &&
        !desiredIds.has(server.id) &&
        !otherPluginServerIds.has(server.id)
      )
        await this.remove(server.id);
    }
  }

  async syncWorkspaceConfig(
    workspacePath: string,
    configuredServers: McpServerConfig[],
  ): Promise<void> {
    if (!this.repository.isProjectTrusted(workspacePath)) {
      return;
    }
    const owner = createHash("sha256")
      .update(resolve(workspacePath).toLocaleLowerCase("en-US"))
      .digest("hex")
      .slice(0, 12);
    const settingKey = `mcp.projectIds.${owner}`;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(configuredServers))
      .digest("hex");
    if (this.workspaceFingerprints.get(owner) === fingerprint) return;
    const previous = this.repository.getSetting(settingKey);
    const previousIds = Array.isArray(previous)
      ? previous.filter((entry): entry is string => typeof entry === "string")
      : [];
    const activeIds = new Set<string>();
    for (const server of configuredServers) {
      const slug = normalizeMcpName(server.id) || "server";
      const id = `project-${owner}-${slug}`;
      activeIds.add(id);
      await this.save({
        id,
        name: server.name,
        description: `项目配置导入：${server.id}`,
        transport: server.transport,
        enabled: server.enabled,
        command: server.command,
        args: server.args,
        cwd: server.cwd ? resolve(workspacePath, server.cwd) : workspacePath,
        url: server.url,
        timeoutMs: server.timeoutMs,
        headers: server.headers,
        env: server.env,
        oauthEnabled: server.oauthEnabled,
        ...(server.oauthClientId ? { oauthClientId: server.oauthClientId } : {}),
        ...(server.oauthClientSecret ? { oauthClientSecret: server.oauthClientSecret } : {}),
        ...(server.oauthScope ? { oauthScope: server.oauthScope } : {}),
      });
    }
    for (const id of previousIds) {
      if (!activeIds.has(id)) {
        const existing = this.repository.getMcpServer(id);
        if (existing && !existing.builtin) {
          await this.remove(id);
        }
      }
    }
    this.repository.setSetting(settingKey, [...activeIds]);
    this.workspaceFingerprints.set(owner, fingerprint);
  }

  async removePluginServers(extensionId: string): Promise<void> {
    const extension = this.repository.getExtension(extensionId);
    if (extension?.type !== "plugin") return;
    const otherPluginServerIds = new Set(
      this.repository
        .listExtensions()
        .filter((candidate) => candidate.type === "plugin" && candidate.id !== extensionId)
        .flatMap((candidate) =>
          candidate.mcpServerNames.map((serverName) => pluginMcpServerId(candidate.id, serverName)),
        ),
    );
    for (const serverName of extension.mcpServerNames) {
      const serverId = pluginMcpServerId(extension.id, serverName);
      if (!otherPluginServerIds.has(serverId)) await this.remove(serverId);
    }
  }

  async save(input: McpServerSaveInput): Promise<McpServerView> {
    const name = input.name.trim();
    if (!name || name.length > 120) {
      throw new Error("MCP 名称长度必须为 1 到 120 个字符。");
    }
    const existing = input.id ? this.repository.getMcpServer(input.id) : null;
    const command = input.command?.trim() ?? "";
    const cwd = input.cwd?.trim() ?? "";
    const url = input.url?.trim() ?? "";
    if (input.transport === "stdio" && !command) {
      throw new Error("stdio MCP 必须填写启动命令。");
    }
    if (input.transport === "http" && !/^https?:\/\//i.test(url)) {
      throw new Error("HTTP MCP 必须填写有效的 http/https URL。");
    }

    const providedSecrets = {
      headers: compactRecord(input.headers),
      env: compactRecord(input.env),
    };
    const currentSecrets: SecretConfig = existing
      ? this.secretConfig(existing.id)
      : { headers: {}, env: {} };
    const headerKeys =
      input.headerKeys === undefined
        ? uniqueKeys([...(existing?.headerKeys ?? []), ...Object.keys(providedSecrets.headers)])
        : uniqueKeys(input.headerKeys);
    const envKeys =
      input.envKeys === undefined
        ? uniqueKeys([...(existing?.envKeys ?? []), ...Object.keys(providedSecrets.env)])
        : uniqueKeys(input.envKeys);
    const undeclaredHeaders = Object.keys(providedSecrets.headers).filter(
      (key) => !headerKeys.includes(key),
    );
    const undeclaredEnv = Object.keys(providedSecrets.env).filter((key) => !envKeys.includes(key));
    if (undeclaredHeaders.length) {
      throw new Error(`未声明的 MCP Header 密钥：${undeclaredHeaders.join(", ")}`);
    }
    if (undeclaredEnv.length) {
      throw new Error(`未声明的 MCP 环境变量密钥：${undeclaredEnv.join(", ")}`);
    }
    const selectSecrets = (
      keys: string[],
      current: Record<string, string>,
      provided: Record<string, string>,
    ) =>
      Object.fromEntries(
        keys.flatMap((key) => {
          const value = provided[key] ?? current[key];
          return value ? [[key, value]] : [];
        }),
      );
    const nextSecrets: SecretConfig = {
      ...currentSecrets,
      headers: selectSecrets(headerKeys, currentSecrets.headers, providedSecrets.headers),
      env: selectSecrets(envKeys, currentSecrets.env, providedSecrets.env),
    };
    const oauthTouched =
      input.oauthEnabled !== undefined ||
      input.oauthClientId !== undefined ||
      input.oauthClientSecret !== undefined ||
      input.oauthScope !== undefined;
    const nextOAuth = oauthTouched
      ? {
          ...currentSecrets.oauth,
          enabled: input.oauthEnabled ?? currentSecrets.oauth?.enabled ?? false,
          ...(input.oauthClientId !== undefined
            ? { clientId: input.oauthClientId.trim() || undefined }
            : {}),
          ...(input.oauthClientSecret ? { clientSecret: input.oauthClientSecret.trim() } : {}),
          ...(input.oauthScope !== undefined
            ? { scope: input.oauthScope.trim() || undefined }
            : {}),
        }
      : currentSecrets.oauth;
    const currentSecretRef = existing ? this.repository.getMcpServerSecretRef(existing.id) : null;
    const declarationsChanged =
      existing !== null &&
      (existing.headerKeys.join("\0") !== headerKeys.join("\0") ||
        existing.envKeys.join("\0") !== envKeys.join("\0"));
    let secretRef = currentSecretRef;
    if (
      Object.keys(providedSecrets.headers).length > 0 ||
      Object.keys(providedSecrets.env).length > 0 ||
      declarationsChanged ||
      oauthTouched
    ) {
      const stored = this.secretStore.store(
        JSON.stringify({
          headers: nextSecrets.headers,
          env: nextSecrets.env,
          ...(nextOAuth ? { oauth: nextOAuth } : {}),
        }),
      );
      secretRef = stored.secretRef;
    }
    const record = {
      id: input.id,
      name,
      description: input.description.trim(),
      transport: input.transport,
      command,
      args: input.args?.map((value) => value.trim()).filter(Boolean) ?? [],
      cwd,
      url,
      timeoutMs: Math.max(
        1_000,
        Math.min(600_000, input.timeoutMs ?? existing?.timeoutMs ?? 30_000),
      ),
      enabled: input.enabled,
      builtin: existing?.builtin ?? false,
      headerKeys,
      envKeys,
      secretRef,
    };
    try {
      const saved = existing
        ? this.repository.updateMcpServer(existing.id, record)
        : this.repository.insertMcpServer(record);
      if (currentSecretRef && secretRef !== currentSecretRef) {
        this.secretStore.remove(currentSecretRef);
      }
      await this.disconnect(saved.id);
      return saved;
    } catch (error) {
      if (secretRef && secretRef !== currentSecretRef) {
        this.secretStore.remove(secretRef);
      }
      throw error;
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<McpServerView> {
    const server = this.requireServer(id);
    if (server.enabled === enabled) {
      return server;
    }
    const updated = await this.save({
      id: server.id,
      name: server.name,
      description: server.description,
      transport: server.transport,
      enabled,
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      url: server.url,
      timeoutMs: server.timeoutMs,
    });
    return updated;
  }

  async setGitHubToken(token: string | null): Promise<void> {
    const server = this.requireServer("builtin-github");
    if (token) {
      await this.save({
        ...server,
        headers: { Authorization: `Bearer ${token}` },
        oauthEnabled: false,
      });
    } else {
      const secretRef = this.repository.getMcpServerSecretRef(server.id);
      this.repository.updateMcpServerSecretRef(server.id, null);
      if (secretRef) this.secretStore.remove(secretRef);
      this.repository.updateMcpServerStatus(server.id, {
        status: "disconnected",
        tools: [],
        error: null,
      });
      await this.disconnect(server.id);
    }
  }

  async startOAuth(id: string): Promise<McpOAuthStartResult> {
    const server = this.requireServer(id);
    if (server.transport !== "http") {
      throw new Error("OAuth 仅适用于远程 HTTP MCP Server。");
    }
    const current = this.secretConfig(server.id).oauth;
    if (!current?.enabled) {
      throw new Error("请先在 MCP 配置中启用 OAuth。");
    }

    const metadata = await this.discoverOAuth(server.url);
    const callbackServer = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      callbackServer.once("error", rejectListen);
      callbackServer.listen(0, "127.0.0.1", () => resolveListen());
    });
    const address = callbackServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (!port) {
      callbackServer.close();
      throw new Error("无法启动本地 OAuth 回调服务。");
    }
    const redirectUri = `http://127.0.0.1:${port}/mcp/oauth/callback`;
    let clientId = current.clientId?.trim() ?? "";
    let clientSecret = current.clientSecret?.trim() ?? "";
    if (!clientId) {
      if (!metadata.registrationEndpoint) {
        callbackServer.close();
        throw new Error("OAuth Server 未提供动态客户端注册，请填写 Client ID。");
      }
      const registration = await fetchJson(
        metadata.registrationEndpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_name: "Mingshen Harness",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: clientSecret ? "client_secret_post" : "none",
          }),
        },
        this.diagnosticSecrets(server.id),
      );
      clientId = typeof registration.client_id === "string" ? registration.client_id : "";
      clientSecret =
        typeof registration.client_secret === "string" ? registration.client_secret : clientSecret;
    }
    if (!clientId) {
      callbackServer.close();
      throw new Error("OAuth 客户端注册未返回 client_id。");
    }

    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizationUrl = new URL(metadata.authorizationEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    if (current.scope) {
      authorizationUrl.searchParams.set("scope", current.scope);
    }
    if (metadata.resource) {
      authorizationUrl.searchParams.set("resource", metadata.resource);
    }

    const timeout = setTimeout(() => callbackServer.close(), 5 * 60_000);
    timeout.unref();
    callbackServer.on("request", (request, response) => {
      void (async () => {
        const callbackUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
        if (callbackUrl.pathname !== "/mcp/oauth/callback") {
          response.writeHead(404).end("Not found");
          return;
        }
        try {
          if (callbackUrl.searchParams.get("state") !== state) {
            throw new Error("OAuth state 校验失败。");
          }
          const error = callbackUrl.searchParams.get("error");
          if (error) {
            throw new Error(callbackUrl.searchParams.get("error_description") || error);
          }
          const code = callbackUrl.searchParams.get("code");
          if (!code) {
            throw new Error("OAuth 回调缺少 authorization code。");
          }
          const token = await fetchJson(
            metadata.tokenEndpoint,
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                client_id: clientId,
                code_verifier: verifier,
                ...(clientSecret ? { client_secret: clientSecret } : {}),
                ...(metadata.resource ? { resource: metadata.resource } : {}),
              }),
            },
            [...this.diagnosticSecrets(server.id), clientSecret, code, verifier],
          );
          const accessToken = typeof token.access_token === "string" ? token.access_token : "";
          if (!accessToken) {
            throw new Error("OAuth Token 响应缺少 access_token。");
          }
          this.persistOAuth(server.id, {
            ...current,
            clientId,
            ...(clientSecret ? { clientSecret } : {}),
            accessToken,
            ...(typeof token.refresh_token === "string"
              ? { refreshToken: token.refresh_token }
              : {}),
            ...(typeof token.expires_in === "number"
              ? {
                  expiresAt: Date.now() + token.expires_in * 1_000,
                }
              : {}),
            tokenEndpoint: metadata.tokenEndpoint,
            authorizationServer: metadata.authorizationServer,
            ...(metadata.resource ? { resource: metadata.resource } : {}),
          });
          await this.disconnect(server.id);
          response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
          });
          response.end(
            "<!doctype html><meta charset='utf-8'><title>Mingshen Harness</title><main style='font:16px Segoe UI;padding:48px;background:#0e0e11;color:#f4f4f5'><h1>OAuth 已完成</h1><p>可以关闭此页面并返回 Mingshen Harness。</p></main>",
          );
        } catch (error) {
          response.writeHead(400, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end(`OAuth failed: ${this.diagnostic(server.id, error)}`);
        } finally {
          clearTimeout(timeout);
          callbackServer.close();
        }
      })();
    });

    return { authorizationUrl: authorizationUrl.toString() };
  }

  async remove(id: string): Promise<void> {
    const server = this.requireServer(id);
    if (server.builtin) {
      throw new Error("内置 MCP 不能删除，可以禁用或替换凭据。");
    }
    const secretRef = this.repository.removeMcpServer(id);
    await this.disconnect(id);
    if (secretRef) {
      this.secretStore.remove(secretRef);
    }
  }

  async test(id: string): Promise<McpServerTestResult> {
    const server = this.requireServer(id);
    const startedAt = performance.now();
    if (!server.configured) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        tools: [],
        error: "MCP 尚未配置必需的凭据或连接参数。",
      };
    }
    try {
      const tools = await this.discoverTools(server);
      this.repository.updateMcpServerStatus(id, { status: "connected", tools, error: null });
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - startedAt),
        tools,
        error: null,
      };
    } catch (error) {
      const message = this.diagnostic(id, error);
      this.repository.updateMcpServerStatus(id, { status: "error", error: message });
      await this.disconnect(id);
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        tools: [],
        error: message,
      };
    }
  }

  async toolDefinitions(
    remoteOnly = false,
    workspacePath?: string | null,
    allowedProcesses?: Set<string>,
    allowedPluginServers?: ReadonlySet<string>,
  ): Promise<McpToolDefinition[]> {
    const results: McpToolDefinition[] = [];
    const pluginServerIds = this.pluginMcpServerIds();
    const owner = workspacePath
      ? createHash("sha256")
          .update(resolve(workspacePath).toLocaleLowerCase("en-US"))
          .digest("hex")
          .slice(0, 12)
      : null;
    for (const server of this.list().filter(
      (item) =>
        item.enabled &&
        item.configured &&
        (!pluginServerIds.has(item.id) ||
          allowedPluginServers === undefined ||
          allowedPluginServers.has(item.id)) &&
        (item.transport !== "stdio" ||
          allowedProcesses === undefined ||
          allowedProcesses.has(item.id)) &&
        (!remoteOnly || item.transport === "http") &&
        (workspacePath === undefined ||
          !item.id.startsWith("project-") ||
          (owner !== null && item.id.startsWith(`project-${owner}-`))),
    )) {
      try {
        const tools = await this.discoverTools(server);
        this.repository.updateMcpServerStatus(server.id, {
          status: "connected",
          tools,
          error: null,
        });
        const serverSlug = normalizeMcpName(server.id.replace(/^builtin-/, ""));
        for (const tool of tools) {
          results.push({
            exposedName: `mcp__${serverSlug}__${normalizeMcpName(tool.name)}`,
            serverId: server.id,
            serverName: server.name,
            toolName: tool.name,
            readOnly: builtinReadOnly(server.id, tool),
            name: `mcp__${serverSlug}__${normalizeMcpName(tool.name)}`,
            description: `[MCP · ${server.name}] ${tool.description || tool.title}`,
            parameters: tool.parameters,
          });
        }
      } catch (error) {
        this.repository.updateMcpServerStatus(server.id, {
          status: "error",
          error: this.diagnostic(server.id, error),
        });
        await this.disconnect(server.id);
      }
    }
    return results;
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ output: string; isError: boolean }> {
    const server = this.requireServer(serverId);
    if (!server.enabled || !this.isPluginServerAvailable(server.id)) {
      return {
        output: `MCP_SERVER_DISABLED: ${server.name} is disabled or its owning plugin is disabled.`,
        isError: true,
      };
    }
    try {
      signal?.throwIfAborted();
      const result =
        server.transport === "stdio"
          ? await this.httpOrStdioRequest(
              server,
              "tools/call",
              {
                name: toolName,
                arguments: args,
              },
              signal,
            )
          : await this.httpRequest(
              server,
              "tools/call",
              {
                name: toolName,
                arguments: args,
              },
              false,
              signal,
            );
      return {
        output: formatToolResult(result),
        isError: Boolean(
          result &&
            typeof result === "object" &&
            (result as Record<string, unknown>).isError === true,
        ),
      };
    } catch (error) {
      return {
        output: `MCP_OUTCOME_UNCERTAIN: MCP ${server.name}: ${this.diagnostic(serverId, error)}\nThe transport failed or was cancelled; the server may have started this operation. Inspect server state before further side effects.`,
        isError: true,
      };
    }
  }

  async executeExposedTool(
    exposedName: string,
    args: Record<string, unknown>,
  ): Promise<{ output: string; isError: boolean }> {
    const definitions = await this.toolDefinitions();
    const definition = definitions.find((item) => item.exposedName === exposedName);
    if (!definition) {
      return { output: `MCP 工具不存在或服务器未启用：${exposedName}`, isError: true };
    }
    return await this.callTool(definition.serverId, definition.toolName, args);
  }

  findServerByName(value: string): McpServerView | null {
    const needle = normalizeMcpName(value);
    return (
      this.list().find(
        (server) =>
          normalizeMcpName(server.name) === needle ||
          normalizeMcpName(server.id.replace(/^builtin-/, "")) === needle ||
          normalizeMcpName(server.id).endsWith(needle),
      ) ?? null
    );
  }

  async exposedTool(
    name: string,
    remoteOnly = false,
    workspacePath?: string | null,
    allowedProcesses?: Set<string>,
    allowedPluginServers?: ReadonlySet<string>,
  ): Promise<McpToolDefinition | null> {
    return (
      (
        await this.toolDefinitions(
          remoteOnly,
          workspacePath,
          allowedProcesses,
          allowedPluginServers,
        )
      ).find((tool) => tool.name === name) ?? null
    );
  }

  enabledServerNames(allowedPluginServers?: ReadonlySet<string>): string[] {
    const pluginServerIds = this.pluginMcpServerIds();
    return this.list()
      .filter(
        (server) =>
          server.enabled &&
          server.configured &&
          (!pluginServerIds.has(server.id) ||
            allowedPluginServers === undefined ||
            allowedPluginServers.has(server.id)),
      )
      .map((server) => server.name);
  }

  async disconnect(serverId: string): Promise<void> {
    const connection = this.stdioConnections.get(serverId);
    if (connection) {
      for (const pending of connection.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("MCP connection closed."));
      }
      connection.child.kill();
      if (process.platform === "win32" && connection.child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(connection.child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => undefined);
        killer.unref();
      }
      this.stdioConnections.delete(serverId);
    }
    this.httpConnections.delete(serverId);
  }

  dispose(): void {
    for (const serverId of this.stdioConnections.keys()) {
      void this.disconnect(serverId);
    }
  }

  private ensureBuiltins(): void {
    for (const builtin of BUILTIN_SERVERS) {
      if (this.repository.getMcpServer(builtin.id)) {
        continue;
      }
      this.repository.insertMcpServer({
        id: builtin.id,
        name: builtin.name,
        description: builtin.description,
        transport: builtin.transport,
        command: builtin.command ?? "",
        args: builtin.args ?? [],
        cwd: "",
        url: builtin.url ?? "",
        timeoutMs: 30_000,
        enabled: false,
        builtin: true,
        headerKeys: builtin.headerKeys ?? [],
        envKeys: builtin.envKeys ?? [],
        secretRef: null,
      });
    }
  }

  private persistOAuth(serverId: string, oauth: NonNullable<SecretConfig["oauth"]>): void {
    const current = this.secretConfig(serverId);
    const currentSecretRef = this.repository.getMcpServerSecretRef(serverId);
    const stored = this.secretStore.store(
      JSON.stringify({
        ...current,
        oauth,
      }),
    );
    this.repository.updateMcpServerSecretRef(serverId, stored.secretRef);
    if (currentSecretRef && currentSecretRef !== stored.secretRef) {
      this.secretStore.remove(currentSecretRef);
    }
  }

  private async oauthHeaders(server: McpServerView): Promise<Record<string, string>> {
    const oauth = this.secretConfig(server.id).oauth;
    if (!oauth?.enabled) {
      return {};
    }
    if (oauth.accessToken && (!oauth.expiresAt || oauth.expiresAt > Date.now() + 60_000)) {
      return { Authorization: `Bearer ${oauth.accessToken}` };
    }
    if (!oauth.refreshToken || !oauth.tokenEndpoint || !oauth.clientId) {
      return {};
    }
    const token = await fetchJson(
      oauth.tokenEndpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: oauth.refreshToken,
          client_id: oauth.clientId,
          ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}),
        }),
      },
      this.diagnosticSecrets(server.id),
    );
    const accessToken = typeof token.access_token === "string" ? token.access_token : "";
    if (!accessToken) {
      return {};
    }
    this.persistOAuth(server.id, {
      ...oauth,
      accessToken,
      ...(typeof token.refresh_token === "string" ? { refreshToken: token.refresh_token } : {}),
      ...(typeof token.expires_in === "number"
        ? {
            expiresAt: Date.now() + token.expires_in * 1_000,
          }
        : {}),
    });
    return { Authorization: `Bearer ${accessToken}` };
  }

  private async discoverOAuth(resourceUrl: string): Promise<{
    authorizationEndpoint: string;
    tokenEndpoint: string;
    registrationEndpoint: string | null;
    authorizationServer: string;
    resource: string | null;
  }> {
    const resource = new URL(resourceUrl);
    const protectedCandidates = [
      new URL(`/.well-known/oauth-protected-resource${resource.pathname}`, resource.origin),
      new URL("/.well-known/oauth-protected-resource", resource.origin),
    ];
    try {
      const probe = await fetch(resourceUrl, {
        headers: { Accept: "application/json, text/event-stream" },
        signal: AbortSignal.timeout(10_000),
      });
      const metadata = /resource_metadata="([^"]+)"/i.exec(
        probe.headers.get("www-authenticate") ?? "",
      )?.[1];
      await probe.body?.cancel();
      if (metadata) {
        const url = new URL(metadata, resource);
        if (
          url.protocol === "https:" ||
          (resource.hostname === "127.0.0.1" && url.hostname === "127.0.0.1")
        )
          protectedCandidates.unshift(url);
      }
    } catch {
      /* Continue with standard discovery locations. */
    }
    let protectedMetadata: Record<string, unknown> | null = null;
    for (const candidate of protectedCandidates) {
      try {
        protectedMetadata = await fetchJson(candidate.toString(), {
          headers: { Accept: "application/json" },
        });
        break;
      } catch {
        // Try the next standard discovery location.
      }
    }
    const authorizationServer =
      Array.isArray(protectedMetadata?.authorization_servers) &&
      typeof protectedMetadata.authorization_servers[0] === "string"
        ? protectedMetadata.authorization_servers[0]
        : resource.origin;
    const issuer = new URL(authorizationServer);
    const authorizationCandidates = [
      new URL(
        `/.well-known/oauth-authorization-server${issuer.pathname === "/" ? "" : issuer.pathname}`,
        issuer.origin,
      ),
      new URL(
        `${issuer.pathname === "/" ? "" : issuer.pathname}/.well-known/openid-configuration`,
        issuer.origin,
      ),
    ];
    let authorizationMetadata: Record<string, unknown> | null = null;
    for (const candidate of authorizationCandidates) {
      try {
        authorizationMetadata = await fetchJson(candidate.toString(), {
          headers: { Accept: "application/json" },
        });
        break;
      } catch {
        // Try OpenID Connect discovery next.
      }
    }
    const authorizationEndpoint =
      typeof authorizationMetadata?.authorization_endpoint === "string"
        ? authorizationMetadata.authorization_endpoint
        : "";
    const tokenEndpoint =
      typeof authorizationMetadata?.token_endpoint === "string"
        ? authorizationMetadata.token_endpoint
        : "";
    if (!authorizationEndpoint || !tokenEndpoint) {
      throw new Error("未能发现 OAuth authorization/token endpoint。");
    }
    return {
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint:
        typeof authorizationMetadata?.registration_endpoint === "string"
          ? authorizationMetadata.registration_endpoint
          : null,
      authorizationServer,
      resource:
        typeof protectedMetadata?.resource === "string"
          ? protectedMetadata.resource
          : resource.toString(),
    };
  }

  private requireServer(id: string): McpServerView {
    const server = this.list().find((entry) => entry.id === id);
    if (!server) {
      throw new Error("MCP Server 不存在。");
    }
    return server;
  }

  private secretConfig(serverId: string): SecretConfig {
    const secretRef = this.repository.getMcpServerSecretRef(serverId);
    return secretRef
      ? parseSecretConfig(this.secretStore.read(secretRef))
      : { headers: {}, env: {} };
  }

  private async discoverTools(server: McpServerView): Promise<McpToolSummary[]> {
    const tools: McpToolSummary[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.httpOrStdioRequest(server, "tools/list", cursor ? { cursor } : {});
      tools.push(...toolListFromResult(result));
      const next =
        result && typeof result === "object"
          ? (result as Record<string, unknown>).nextCursor
          : undefined;
      cursor = typeof next === "string" ? next : undefined;
    } while (cursor);
    return tools;
  }

  private async httpOrStdioRequest(
    server: McpServerView,
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return server.transport === "stdio"
      ? await this.stdioRequest(server, method, params, signal)
      : await this.httpRequest(server, method, params, false, signal);
  }

  private async stdioRequest(
    server: McpServerView,
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const connection = this.stdioConnections.get(server.id) ?? this.connectStdio(server);
    await this.initializeStdio(connection);
    return await this.sendStdio(connection, method, params, signal);
  }

  private connectStdio(server: McpServerView): StdioConnection {
    const secrets = this.secretConfig(server.id);
    const bundledBrowser = server.id === "builtin-browserdo";
    const browserScript = bundledBrowser
      ? createRequire(__filename).resolve("browserdo-mcp/dist/index.js")
      : null;
    const child = spawnPortable(
      bundledBrowser ? process.execPath : server.command,
      browserScript ? [browserScript] : server.args,
      {
        windowsHide: true,
        cwd: server.cwd || undefined,
        env: {
          ...process.env,
          ...(bundledBrowser
            ? {
                ELECTRON_RUN_AS_NODE: "1",
                EMBIODY_USER_DATA_DIR: resolve(
                  process.env.LOCALAPPDATA ?? process.cwd(),
                  "MingshenHarness",
                  "EmbiodyProfile",
                ),
              }
            : {}),
          ...secrets.env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const connection: StdioConnection = {
      child,
      pending: new Map(),
      buffer: "",
      stderr: "",
      nextId: 1,
      timeoutMs: server.timeoutMs,
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.consumeStdio(connection, chunk));
    child.stderr?.on("data", (chunk: string) => {
      connection.stderr = `${connection.stderr}${chunk}`.slice(-12_000);
    });
    child.stdin?.on("error", (error) => {
      for (const pending of connection.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      connection.pending.clear();
    });
    child.on("error", (error) => {
      for (const pending of connection.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      connection.pending.clear();
      this.stdioConnections.delete(server.id);
    });
    child.once("exit", (code) => {
      this.stdioConnections.delete(server.id);
      for (const pending of connection.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(`MCP process exited (${code ?? "unknown"}). ${connection.stderr.trim()}`),
        );
      }
      connection.pending.clear();
    });
    this.stdioConnections.set(server.id, connection);
    return connection;
  }

  private async initializeStdio(connection: StdioConnection): Promise<void> {
    const record = connection as StdioConnection & { initialized?: boolean };
    if (record.initialized) {
      return;
    }
    const pending = this.initializations.get(connection);
    if (pending) return await pending;
    const initializing = (async () => {
      await this.sendStdio(connection, "initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Mingshen Harness", version: this.appVersion },
      });
      this.writeStdio(connection, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      });
      record.initialized = true;
    })();
    this.initializations.set(connection, initializing);
    try {
      await initializing;
    } finally {
      this.initializations.delete(connection);
    }
  }

  private sendStdio(
    connection: StdioConnection,
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    signal?.throwIfAborted();
    const id = connection.nextId++;
    return new Promise((resolve, reject) => {
      const finish = (error: Error | null, value?: unknown) => {
        connection.pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(value);
      };
      const cancel = (reason: string) => {
        try {
          this.writeStdio(connection, {
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: id, reason },
          });
        } catch {
          /* Transport may already be closed. */
        }
        finish(new Error(reason));
      };
      const abort = () => cancel(`MCP stdio request cancelled: ${method}`);
      const timer = setTimeout(() => {
        cancel(`MCP stdio request timed out: ${method}`);
      }, connection.timeoutMs);
      connection.pending.set(id, {
        resolve: (value) => finish(null, value),
        reject: (error) => finish(error),
        timer,
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.writeStdio(connection, { jsonrpc: "2.0", id, method, params });
      if (signal?.aborted) abort();
    });
  }

  private writeStdio(connection: StdioConnection, payload: Record<string, unknown>): void {
    connection.child.stdin?.write(`${JSON.stringify(payload)}\n`);
  }

  private consumeStdio(connection: StdioConnection, chunk: string): void {
    connection.buffer += chunk;
    while (true) {
      const newline = connection.buffer.indexOf("\n");
      if (newline < 0) {
        break;
      }
      const line = connection.buffer.slice(0, newline).trim();
      connection.buffer = connection.buffer.slice(newline + 1);
      if (!line) {
        continue;
      }
      try {
        const payload = JSON.parse(line) as Record<string, unknown>;
        const id = typeof payload.id === "number" ? payload.id : null;
        if (id === null) {
          continue;
        }
        const pending = connection.pending.get(id);
        if (!pending) {
          continue;
        }
        connection.pending.delete(id);
        clearTimeout(pending.timer);
        if (payload.error) {
          pending.reject(new Error(JSON.stringify(payload.error)));
        } else {
          pending.resolve(payload.result);
        }
      } catch {
        // Ignore non-JSON diagnostic lines from third-party MCP servers.
      }
    }
  }

  private httpConnection(serverId: string): HttpConnection {
    let connection = this.httpConnections.get(serverId);
    if (!connection) {
      connection = { sessionId: null, nextId: 1 };
      this.httpConnections.set(serverId, connection);
    }
    return connection;
  }

  private async initializeHttp(server: McpServerView): Promise<void> {
    const record = this.httpConnection(server.id) as HttpConnection & { initialized?: boolean };
    if (record.initialized) {
      return;
    }
    const pending = this.initializations.get(record);
    if (pending) return await pending;
    const initializing = (async () => {
      await this.httpRequest(server, "initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Mingshen Harness", version: this.appVersion },
      });
      await this.httpRequest(server, "notifications/initialized", {}, true);
      record.initialized = true;
    })();
    this.initializations.set(record, initializing);
    try {
      await initializing;
    } finally {
      this.initializations.delete(record);
    }
  }

  private async httpRequest(
    server: McpServerView,
    method: string,
    params: Record<string, unknown>,
    notification = false,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const connection = this.httpConnection(server.id);
    if (!notification && method !== "initialize") {
      await this.initializeHttp(server);
    }
    signal?.throwIfAborted();
    const secrets = this.secretConfig(server.id);
    const oauthHeaders = await this.oauthHeaders(server);
    const id = notification ? undefined : connection.nextId++;
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...(connection.sessionId ? { "mcp-session-id": connection.sessionId } : {}),
        ...oauthHeaders,
        ...secrets.headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(id === undefined ? {} : { id }),
        method,
        params,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(server.timeoutMs)])
        : AbortSignal.timeout(server.timeoutMs),
      redirect: "error",
    });
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      connection.sessionId = sessionId;
    }
    if (!response.ok) {
      const failure = httpResponseError(
        response,
        await response.text(),
        this.diagnosticSecrets(server.id),
      );
      if (response.status === 401 && secrets.oauth?.enabled && !oauthHeaders.Authorization) {
        throw new Error(`MCP Server 需要 OAuth 认证，请先在设置中完成授权。\n\n${failure.message}`);
      }
      throw failure;
    }
    if (notification) {
      await response.body?.cancel();
      return null;
    }
    const raw = await response.text();
    const payload = parseJsonRpcHttpResponse(raw, response.headers.get("content-type") ?? "");
    if (payload.error) {
      throw new Error(JSON.stringify(payload.error));
    }
    return payload.result;
  }
}

function compactRecord(value: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .map(([key, entry]) => [key.trim(), entry.trim()] as const)
      .filter(([key, entry]) => Boolean(key && entry)),
  );
}

function uniqueKeys(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function parseJsonRpcHttpResponse(raw: string, contentType: string): Record<string, unknown> {
  if (contentType.includes("text/event-stream")) {
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]")
      .at(-1);
    return data ? (JSON.parse(data) as Record<string, unknown>) : {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function formatToolResult(value: unknown): string {
  if (!value || typeof value !== "object") {
    return String(value ?? "");
  }
  const record = value as Record<string, unknown>;
  if (record.structuredContent) {
    return JSON.stringify(record.structuredContent, null, 2);
  }
  if (Array.isArray(record.content)) {
    return record.content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return String(item ?? "");
        }
        const content = item as Record<string, unknown>;
        if (content.type === "text") {
          return String(content.text ?? "");
        }
        return `[${String(content.type ?? "content")}] ${String(content.mimeType ?? "")}`.trim();
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return JSON.stringify(record, null, 2);
}

async function fetchJson(
  url: string,
  init: RequestInit,
  secrets: string[] = [],
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    redirect: init.redirect ?? "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/json",
      "User-Agent": `Mingshen-Harness/${APP_VERSION}`,
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw httpResponseError(response, body, secrets);
  }
  const parsed: unknown = body ? JSON.parse(body) : {};
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
