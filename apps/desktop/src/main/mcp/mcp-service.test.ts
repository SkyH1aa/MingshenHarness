import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { SecretStore } from "../storage/secret-store";
import { McpService } from "./mcp-service";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

describe("McpService", () => {
  it("merges partial credential updates without dropping untouched secrets", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const secretStore = new SecretStore(database);
    const service = new McpService(repository, secretStore, "1.3.4");
    try {
      const server = await service.save({
        name: "Credential merge fixture",
        description: "test",
        transport: "http",
        enabled: false,
        url: "https://example.invalid/mcp",
        headerKeys: ["AUTHORIZATION", "X-UNCHANGED"],
        envKeys: ["FIRST_TOKEN", "SECOND_TOKEN"],
        headers: {
          AUTHORIZATION: "old-authorization",
          "X-UNCHANGED": "keep-this",
        },
        env: {
          FIRST_TOKEN: "old-first",
          SECOND_TOKEN: "keep-this-too",
        },
      });
      await service.save({
        id: server.id,
        name: server.name,
        description: server.description,
        transport: server.transport,
        enabled: true,
        url: server.url,
        headerKeys: ["AUTHORIZATION", "X-UNCHANGED"],
        envKeys: ["FIRST_TOKEN", "SECOND_TOKEN"],
        headers: {
          AUTHORIZATION: "new-authorization",
          "X-BLANK": "",
        },
        env: {
          FIRST_TOKEN: "new-first",
        },
      });

      const stored = secretStore.read(repository.getMcpServerSecretRef(server.id) ?? "");
      expect(JSON.parse(stored)).toMatchObject({
        headers: {
          AUTHORIZATION: "new-authorization",
          "X-UNCHANGED": "keep-this",
        },
        env: {
          FIRST_TOKEN: "new-first",
          SECOND_TOKEN: "keep-this-too",
        },
      });
      expect(JSON.parse(stored).headers).not.toHaveProperty("X-BLANK");

      const removed = await service.save({
        id: server.id,
        name: server.name,
        description: server.description,
        transport: server.transport,
        enabled: true,
        url: server.url,
        headerKeys: ["AUTHORIZATION"],
        envKeys: ["FIRST_TOKEN"],
      });
      expect(removed.headerKeys).toEqual(["AUTHORIZATION"]);
      expect(removed.envKeys).toEqual(["FIRST_TOKEN"]);
      const afterRemoval = JSON.parse(
        secretStore.read(repository.getMcpServerSecretRef(server.id) ?? ""),
      );
      expect(afterRemoval.headers).toEqual({ AUTHORIZATION: "new-authorization" });
      expect(afterRemoval.env).toEqual({ FIRST_TOKEN: "new-first" });

      await expect(
        service.save({
          id: server.id,
          name: server.name,
          description: server.description,
          transport: server.transport,
          enabled: true,
          url: server.url,
          headerKeys: ["AUTHORIZATION"],
          headers: { "X-UNDECLARED": "must-not-store" },
        }),
      ).rejects.toThrow("未声明的 MCP Header 密钥");
      await expect(
        service.save({
          id: server.id,
          name: server.name,
          description: server.description,
          transport: server.transport,
          enabled: true,
          url: server.url,
          envKeys: ["FIRST_TOKEN"],
          env: { UNDECLARED_TOKEN: "must-not-store" },
        }),
      ).rejects.toThrow("未声明的 MCP 环境变量密钥");
    } finally {
      service.dispose();
      database.close();
    }
  });

  it("reconciles plugin MCP declarations while preserving enabled state and user credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-plugin-mcp-reconcile-"));
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    const secretStore = new SecretStore(database);
    const service = new McpService(repository, secretStore, "1.3.3");
    const installedPath = join(root, "plugin");
    await mkdir(installedPath, { recursive: true });
    const extension = repository.insertExtension({
      id: "12345678-1234-4234-8234-123456789abc",
      type: "plugin",
      name: "Reconcile plugin",
      description: "MCP reconcile",
      sourcePath: join(root, "source"),
      installedPath,
      manifestJson: JSON.stringify({
        name: "reconcile-plugin",
        mcpServers: {
          legacy: { url: "https://example.invalid/legacy" },
          stale: { url: "https://example.invalid/stale" },
        },
      }),
      contentHash: "reconcile-v1",
    });
    try {
      await service.importPluginServers(extension.id);
      const legacy = service.list().find((server) => server.name === "Reconcile plugin · legacy");
      expect(legacy).toBeDefined();
      if (!legacy) throw new Error("legacy plugin MCP server was not imported");
      await service.save({
        id: legacy.id,
        name: legacy.name,
        description: legacy.description,
        transport: legacy.transport,
        enabled: false,
        url: legacy.url,
        timeoutMs: legacy.timeoutMs,
        headers: { Authorization: "user-secret" },
        env: { USER_ONLY: "keep-me" },
        oauthEnabled: true,
        oauthScope: "mcp.read",
      });

      await writeFile(
        join(installedPath, "mcp.json"),
        JSON.stringify({
          mcpServers: {
            legacy: {
              url: "https://example.invalid/current",
              headers: {
                Authorization: "plugin-must-not-overwrite",
                "X-NEW": "new-value",
              },
              env: {
                USER_ONLY: "plugin-must-not-overwrite",
                NEW_PLUGIN_ENV: "new-env",
              },
            },
            added: { url: "https://example.invalid/added" },
          },
        }),
        "utf8",
      );
      repository.updateExtensionInstall({
        id: extension.id,
        name: extension.name,
        description: extension.description,
        sourcePath: extension.sourcePath,
        installedPath: extension.installedPath,
        manifestJson: JSON.stringify({
          name: "reconcile-plugin",
          mcpServers: "./mcp.json",
        }),
        contentHash: "reconcile-v2",
      });

      await service.importPluginServers(extension.id);
      expect(
        service.list().find((server) => server.name === "Reconcile plugin · legacy"),
      ).toMatchObject({ enabled: false });
      expect(
        service.list().find((server) => server.name === "Reconcile plugin · stale"),
      ).toBeUndefined();
      const current = service.list().find((server) => server.name === "Reconcile plugin · legacy");
      expect(current).toBeDefined();

      const currentId = current?.id ?? "";
      const secretRef = repository.getMcpServerSecretRef(currentId);
      const stored = secretStore.read(secretRef ?? "");
      const secrets = JSON.parse(stored) as {
        headers: Record<string, string>;
        env: Record<string, string>;
        oauth?: { enabled?: boolean; scope?: string };
      };
      expect(secrets.headers).toMatchObject({
        Authorization: "user-secret",
        "X-NEW": "new-value",
      });
      expect(secrets.env).toMatchObject({
        USER_ONLY: "keep-me",
        NEW_PLUGIN_ENV: "new-env",
      });
      expect(secrets.oauth).toMatchObject({ enabled: true, scope: "mcp.read" });
    } finally {
      service.dispose();
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("filters plugin MCP names by exact ownership and current run activation", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const service = new McpService(repository, new SecretStore(database), "1.3.5");
    const extension = repository.insertExtension({
      id: "12345678-1234-4234-8234-123456789abc",
      type: "plugin",
      name: "On-demand plugin",
      description: "An MCP server that must be activated for the current run.",
      sourcePath: join(tmpdir(), "on-demand-plugin-source"),
      installedPath: join(tmpdir(), "on-demand-plugin-installed"),
      manifestJson: JSON.stringify({
        mcpServers: { worker: { url: "https://example.invalid/mcp" } },
      }),
      contentHash: "on-demand-plugin-content-hash",
    });
    try {
      await service.importPluginServers(extension.id);
      const pluginServer = service
        .list()
        .find((server) => server.name === "On-demand plugin · worker");
      expect(pluginServer).toBeDefined();
      if (!pluginServer) throw new Error("plugin MCP fixture was not imported");

      const userServer = await service.save({
        id: "plugin-user-custom-server",
        name: "User MCP whose id begins with plugin-",
        description: "This is not owned by a plugin.",
        transport: "http",
        enabled: true,
        url: "https://example.invalid/user-mcp",
      });

      expect(service.pluginMcpServerIds()).toEqual(new Set([pluginServer.id]));
      expect(service.enabledServerNames(new Set())).toContain(userServer.name);
      expect(service.enabledServerNames(new Set())).not.toContain(pluginServer.name);
      expect(service.enabledServerNames(new Set([pluginServer.id]))).toContain(pluginServer.name);
    } finally {
      service.dispose();
      database.close();
    }
  });

  it("fails closed when two plugins resolve to the same MCP server id", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const service = new McpService(repository, new SecretStore(database), "1.3.5");
    const common = {
      type: "plugin" as const,
      name: "Collision plugin",
      description: "Test ambiguous deterministic MCP ownership.",
      sourcePath: join(tmpdir(), "collision-plugin-source"),
      installedPath: join(tmpdir(), "collision-plugin-installed"),
      manifestJson: JSON.stringify({
        mcpServers: { reports: { url: "https://example.invalid/mcp" } },
      }),
      contentHash: "collision-plugin-content-hash",
    };
    const first = repository.insertExtension({
      ...common,
      id: "12345678-1234-4234-8234-111111111111",
    });
    const second = repository.insertExtension({
      ...common,
      id: "12345678-1234-4234-8234-222222222222",
      contentHash: "collision-plugin-content-hash-second",
    });
    try {
      await service.importPluginServers(first.id);
      await service.importPluginServers(second.id);
      const ambiguous = service.list().find((server) => server.id === "plugin-12345678-reports");
      expect(ambiguous).toMatchObject({ enabled: false });
      expect(service.enabledServerNames()).not.toContain(ambiguous?.name);

      await service.removePluginServers(second.id);
      expect(service.list().find((server) => server.id === "plugin-12345678-reports")).toEqual(
        expect.objectContaining({ enabled: false }),
      );
      expect(service.enabledServerNames()).not.toContain(ambiguous?.name);

      repository.removeExtension(second.id);
      await service.removePluginServers(first.id);
      expect(service.list().map((server) => server.id)).not.toContain("plugin-12345678-reports");
    } finally {
      service.dispose();
      database.close();
    }
  });

  it("does not delete another plugin's MCP server when extension id prefixes collide", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const service = new McpService(repository, new SecretStore(database), "1.3.5");
    const common = {
      type: "plugin" as const,
      description: "Distinct MCP server names share an eight-character plugin ID prefix.",
      sourcePath: join(tmpdir(), "prefix-collision-source"),
      installedPath: join(tmpdir(), "prefix-collision-installed"),
      contentHash: "prefix-collision-content-hash",
    };
    const first = repository.insertExtension({
      ...common,
      id: "12345678-1234-4234-8234-333333333333",
      name: "First plugin",
      manifestJson: JSON.stringify({
        mcpServers: { first: { url: "https://example.invalid/first" } },
      }),
    });
    const second = repository.insertExtension({
      ...common,
      id: "12345678-1234-4234-8234-444444444444",
      name: "Second plugin",
      contentHash: "prefix-collision-content-hash-second",
      manifestJson: JSON.stringify({
        mcpServers: { second: { url: "https://example.invalid/second" } },
      }),
    });
    try {
      await service.importPluginServers(first.id);
      await service.importPluginServers(second.id);
      expect(service.list().map((server) => server.id)).toEqual(
        expect.arrayContaining(["plugin-12345678-first", "plugin-12345678-second"]),
      );

      await service.removePluginServers(second.id);
      expect(service.list().map((server) => server.id)).toContain("plugin-12345678-first");
      expect(service.list().map((server) => server.id)).not.toContain("plugin-12345678-second");
    } finally {
      service.dispose();
      database.close();
    }
  });

  it("hides plugin-provided MCP servers while their extension is disabled", async () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    const service = new McpService(repository, new SecretStore(database), "1.3.3");
    const extension = repository.insertExtension({
      id: "12345678-1234-4234-8234-123456789abc",
      type: "plugin",
      name: "Diagram plugin",
      description: "Disables its MCP tools with the plugin",
      sourcePath: join(tmpdir(), "diagram-plugin-source"),
      installedPath: join(tmpdir(), "diagram-plugin-installed"),
      manifestJson: JSON.stringify({
        mcpServers: {
          diagrams: {
            url: "https://example.invalid/mcp",
          },
        },
      }),
      contentHash: "extension-content-hash",
    });
    try {
      await service.importPluginServers(extension.id);
      expect(service.enabledServerNames()).toContain("Diagram plugin · diagrams");
      const pluginServer = service
        .list()
        .find((server) => server.name === "Diagram plugin · diagrams");
      expect(pluginServer).toBeDefined();

      repository.setExtensionEnabled(extension.id, false);
      expect(service.enabledServerNames()).not.toContain("Diagram plugin · diagrams");
      const directCall = await service.callTool(pluginServer?.id ?? "", "render", {});
      expect(directCall).toMatchObject({
        isError: true,
        output: expect.stringContaining("MCP_SERVER_DISABLED"),
      });
      expect(directCall.output).not.toContain("MCP_OUTCOME_UNCERTAIN");

      repository.setExtensionEnabled(extension.id, true);
      expect(service.enabledServerNames()).toContain("Diagram plugin · diagrams");
    } finally {
      service.dispose();
      database.close();
    }
  });

  it("cancels a real HTTP MCP call and preserves an explicit uncertain-outcome error", async () => {
    let started: () => void = () => {};
    const called = new Promise<void>((done) => {
      started = done;
    });
    const fixture = createServer(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += chunk.toString();
      const body = JSON.parse(text);
      if (body.method === "tools/call") {
        started();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
    });
    await new Promise<void>((done) => fixture.listen(0, "127.0.0.1", done));
    const db = openDatabase(":memory:"),
      service = new McpService(new Repository(db), new SecretStore(db), "1.2.6");
    try {
      const server = await service.save({
        name: "Cancellation fixture",
        description: "test",
        enabled: true,
        transport: "http",
        url: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/mcp`,
      });
      const controller = new AbortController();
      const pending = service.callTool(server.id, "write_something", {}, controller.signal);
      await called;
      controller.abort();
      const result = await pending;
      expect(result).toMatchObject({ isError: true });
      expect(result.output).toContain("MCP_OUTCOME_UNCERTAIN");
      expect(result.output).toContain("server may have started");
    } finally {
      service.dispose();
      db.close();
      fixture.closeAllConnections();
      await new Promise<void>((done) => fixture.close(() => done()));
    }
  });
  it("does not trust a third-party read-only hint and keeps a dropped reply uncertain", async () => {
    let calledResolve: () => void = () => {};
    const called = new Promise<void>((resolve) => {
      calledResolve = resolve;
    });
    const fixture = createServer(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += chunk.toString();
      const body = JSON.parse(text) as { id?: number; method?: string };
      if (body.method === "tools/call") {
        calledResolve();
        request.socket.destroy();
        return;
      }
      const result =
        body.method === "tools/list"
          ? {
              tools: [
                {
                  name: "declared_read_only",
                  description: "Declares no side effects.",
                  inputSchema: { type: "object", properties: {} },
                  annotations: { readOnlyHint: true },
                },
              ],
            }
          : {};
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    });
    await new Promise<void>((done) => fixture.listen(0, "127.0.0.1", done));
    const database = openDatabase(":memory:");
    const service = new McpService(new Repository(database), new SecretStore(database), "1.3.7");
    try {
      const server = await service.save({
        name: "Dropped reply fixture",
        description: "test",
        enabled: true,
        transport: "http",
        url: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/mcp`,
      });
      const definition = (await service.toolDefinitions()).find(
        (tool) => tool.serverId === server.id,
      );
      expect(definition?.readOnly).toBe(false);
      expect(service.list().find((item) => item.id === server.id)?.tools[0]?.readOnly).toBe(false);
      if (!definition) throw new Error("Read-only MCP tool was not discovered.");

      const pending = service.callTool(server.id, definition.toolName, {});
      await called;
      const result = await pending;
      expect(result).toMatchObject({
        isError: true,
        status: "failed",
        effect: "uncertain",
        outcome: { effect: "uncertain" },
      });
      expect(result.codes).toEqual(
        expect.arrayContaining(["MCP_OUTCOME_UNCERTAIN", "SIDE_EFFECT_UNCERTAIN"]),
      );
    } finally {
      service.dispose();
      database.close();
      fixture.closeAllConnections();
      await new Promise<void>((done) => fixture.close(() => done()));
    }
  });
  it("does not trust a reconfigured built-in id as read-only", async () => {
    const fixture = createServer(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += chunk.toString();
      const body = JSON.parse(text) as { id?: number; method?: string };
      const result =
        body.method === "initialize"
          ? {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "forged-wikipedia", version: "1" },
            }
          : body.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "lookup",
                    description: "Claims to be read-only.",
                    inputSchema: { type: "object", properties: {} },
                    annotations: { readOnlyHint: true },
                  },
                ],
              }
            : {};
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    });
    await new Promise<void>((done) => fixture.listen(0, "127.0.0.1", done));
    const database = openDatabase(":memory:");
    const service = new McpService(new Repository(database), new SecretStore(database), "1.3.7");
    try {
      const saved = await service.save({
        id: "builtin-wikipedia",
        name: "Reconfigured Wikipedia",
        description: "A third-party endpoint reusing a built-in id.",
        enabled: true,
        transport: "http",
        url: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/mcp`,
      });
      expect(saved).toMatchObject({
        id: "builtin-wikipedia",
        builtin: true,
        transport: "http",
      });

      const definition = (await service.toolDefinitions()).find(
        (tool) => tool.serverId === "builtin-wikipedia",
      );
      expect(definition?.readOnly).toBe(false);
      expect(
        service
          .list()
          .find((server) => server.id === "builtin-wikipedia")
          ?.tools.find((tool) => tool.name === "lookup")?.readOnly,
      ).toBe(false);
    } finally {
      service.dispose();
      database.close();
      fixture.closeAllConnections();
      await new Promise<void>((done) => fixture.close(() => done()));
    }
  });
  it("retains MCP outputSchema and rejects structuredContent that violates it", async () => {
    let structuredContent: unknown = { value: 4 };
    let listed = true;
    const fixture = createServer(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += chunk.toString();
      const body = JSON.parse(text) as { id?: number; method?: string };
      if (body.id === undefined) {
        response.end("{}");
        return;
      }
      const result =
        body.method === "initialize"
          ? {}
          : body.method === "tools/list"
            ? {
                tools: listed
                  ? [
                      {
                        name: "structured_value",
                        description: "Returns a validated value.",
                        inputSchema: { type: "object", properties: {} },
                        outputSchema: {
                          type: "object",
                          required: ["value"],
                          properties: { value: { type: "number" } },
                          additionalProperties: false,
                        },
                      },
                    ]
                  : [],
              }
            : body.method === "tools/call"
              ? {
                  content: [{ type: "text", text: "structured result" }],
                  structuredContent,
                }
              : {};
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    });
    await new Promise<void>((done) => fixture.listen(0, "127.0.0.1", done));
    const database = openDatabase(":memory:");
    const service = new McpService(new Repository(database), new SecretStore(database), "1.3.7");
    try {
      const server = await service.save({
        name: "Structured output fixture",
        description: "test",
        enabled: true,
        transport: "http",
        url: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/mcp`,
      });
      const definition = (await service.toolDefinitions()).find(
        (tool) => tool.serverId === server.id,
      );
      expect(definition?.outputSchema).toMatchObject({
        required: ["value"],
      });
      if (!definition) throw new Error("Structured MCP tool was not discovered.");

      const valid = await service.callTool(server.id, definition.toolName, {});
      expect(valid).toMatchObject({
        isError: false,
        status: "success",
        validation: { status: "validated", source: "mcp" },
        outcome: { status: "success" },
      });

      structuredContent = { value: "not a number" };
      const invalid = await service.callTool(server.id, definition.toolName, {});
      expect(invalid).toMatchObject({
        isError: true,
        status: "failed",
        effect: "uncertain",
        validation: { status: "invalid", source: "mcp" },
        outcome: { status: "failed", effect: "uncertain" },
      });
      expect(invalid.codes).toContain("INVALID_OUTPUT");

      listed = false;
      expect(
        (await service.toolDefinitions()).find((tool) => tool.serverId === server.id),
      ).toBeUndefined();
      const unlisted = await service.callTool(server.id, definition.toolName, {});
      expect(unlisted).toMatchObject({
        isError: false,
        status: "success",
        validation: { status: "not_declared", source: "mcp" },
      });
    } finally {
      service.dispose();
      database.close();
      fixture.closeAllConnections();
      await new Promise<void>((done) => fixture.close(() => done()));
    }
  });
  it("checks managed policy before calling an MCP tool", async () => {
    const database = openDatabase(":memory:");
    const service = new McpService(new Repository(database), new SecretStore(database), "1.3.7");
    const calls: string[] = [];
    service.setManagedPolicy({
      assertCapability(capability) {
        calls.push(capability);
      },
      assertToolAllowed(name) {
        calls.push(name);
        throw new Error("managed policy denied this MCP tool");
      },
    });
    try {
      const server = await service.save({
        name: "Policy fixture",
        description: "test",
        enabled: true,
        transport: "http",
        url: "https://example.invalid/mcp",
      });
      const result = await service.callTool(server.id, "write_record", {});
      expect(result).toMatchObject({
        isError: true,
        status: "denied",
        effect: "none",
        outcome: { status: "denied", effect: "none" },
      });
      expect(result.output).toContain("MCP_POLICY_DENIED");
      expect(calls).toEqual(["mcp.call", "write_record"]);
    } finally {
      service.dispose();
      database.close();
    }
  });
  it("retains MCP HTTP failures while redacting configured header secrets", async () => {
    const secret = "fixture-private-header-value";
    const body = `temporarily_unavailable\n\nEchoed credential: ${secret}\n${"diagnostic line\n".repeat(600)}\nMCP_HTTP_DIAGNOSTIC_TAIL\n`;
    const expected = `HTTP 503 Service Unavailable\n${body.replaceAll(secret, "[REDACTED]")}`;
    const fixture = createServer((_request, response) => {
      response.writeHead(503, { "Content-Type": "text/plain" });
      response.end(body);
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    const root = await mkdtemp(join(tmpdir(), "mingshen-mcp-redaction-"));
    const database = openDatabase(join(root, "test.db"));
    const service = new McpService(new Repository(database), new SecretStore(database), "1.2.1");
    try {
      const server = await service.save({
        name: "Error fixture",
        description: "test",
        enabled: true,
        transport: "http",
        url: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/mcp`,
        headers: { "x-private-key": secret },
      });
      const tested = await service.test(server.id);
      expect(tested.error).toBe(expected);
      expect(service.list().find((entry) => entry.id === server.id)?.lastError).toBe(expected);
      expect(tested.error).not.toContain(secret);
      const called = await service.callTool(server.id, "anything", {});
      expect(called.isError).toBe(true);
      expect(called.output).toContain(expected);
      expect(called.output).not.toContain(secret);
    } finally {
      service.dispose();
      database.close();
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
  it("bounds MCP HTTP diagnostics after redaction and marks only actual overflow", async () => {
    const secret = `fixture-cap-secret-${"s".repeat(1000)}`;
    let body = `${"x".repeat(99_930)}\n${secret}\nMCP_AFTER_REDACTION_TAIL`;
    const fixture = createServer((_request, response) => {
      response.writeHead(503, { "Content-Type": "text/plain" });
      response.end(body);
    });
    await new Promise<void>((done) => fixture.listen(0, "127.0.0.1", done));
    const db = openDatabase(":memory:");
    const service = new McpService(new Repository(db), new SecretStore(db), "1.3.0");
    try {
      const server = await service.save({
        name: "Bounded diagnostic fixture",
        description: "test",
        enabled: true,
        transport: "http",
        url: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/mcp`,
        headers: { "x-private-key": secret },
      });
      expect(body.length).toBeGreaterThan(100_000);
      const complete = await service.test(server.id);
      expect(complete.error).toBe(
        `HTTP 503 Service Unavailable\n${"x".repeat(99_930)}\n[REDACTED]\nMCP_AFTER_REDACTION_TAIL`,
      );
      expect(complete.error).not.toContain("truncated");

      body = `${"x".repeat(99_980)}\n${secret}\n${"y".repeat(80)}\nMCP_DROPPED_TAIL`;
      const overflow = await service.test(server.id);
      expect(overflow.error).toBe(
        `HTTP 503 Service Unavailable\n${"x".repeat(99_980)}\n[REDACTED]\n${"y".repeat(8)}\n[Response truncated at 100,000 characters]`,
      );
      expect(overflow.error).not.toContain(secret);
      expect(overflow.error).not.toContain("MCP_DROPPED_TAIL");
    } finally {
      service.dispose();
      db.close();
      fixture.closeAllConnections();
      await new Promise<void>((done) => fixture.close(() => done()));
    }
  });
  it("retains the redacted response body when an MCP notification fails", async () => {
    const secret = "fixture-notification-secret";
    const body = `notification rejected\n\nEchoed credential: ${secret}\n${"notification detail\n".repeat(400)}\nMCP_NOTIFICATION_TAIL\n`;
    const methods: string[] = [];
    const fixture = createServer(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += chunk.toString();
      const payload = JSON.parse(text);
      methods.push(payload.method);
      if (payload.method === "notifications/initialized") {
        response.writeHead(503, { "Content-Type": "text/plain" });
        response.end(body);
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {} }));
    });
    await new Promise<void>((done) => fixture.listen(0, "127.0.0.1", done));
    const db = openDatabase(":memory:");
    const service = new McpService(new Repository(db), new SecretStore(db), "1.3.0");
    try {
      const server = await service.save({
        name: "Notification failure fixture",
        description: "test",
        enabled: true,
        transport: "http",
        url: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/mcp`,
        headers: { "x-private-key": secret },
      });
      const tested = await service.test(server.id);
      expect(tested.ok).toBe(false);
      expect(tested.error).toBe(
        `HTTP 503 Service Unavailable\n${body.replaceAll(secret, "[REDACTED]")}`,
      );
      expect(methods).toEqual(["initialize", "notifications/initialized"]);
    } finally {
      service.dispose();
      db.close();
      fixture.closeAllConnections();
      await new Promise<void>((done) => fixture.close(() => done()));
    }
  });
  it.runIf(process.env.MINGSHEN_BROWSERDO_E2E === "1")(
    "opens a real Embiody window and reads its accessibility snapshot",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-browserdo-live-"));
      const database = openDatabase(join(root, "test.db"));
      const repository = new Repository(database);
      const service = new McpService(repository, new SecretStore(database), "1.2.1");
      let windowId: string | undefined;
      try {
        await service.setEnabled("builtin-browserdo", true);
        const opened = await service.callTool("builtin-browserdo", "browser_new_window", {
          url: "https://example.com",
          hideWindow: true,
        });
        console.log("BrowserDo open:", opened.output);
        expect(opened.isError).toBe(false);
        try {
          windowId = String(JSON.parse(opened.output).windowId ?? "") || undefined;
        } catch {
          windowId = /"?windowId"?\s*[:=]\s*"?([^"\s,}]+)/i.exec(opened.output)?.[1];
        }
        expect(windowId).toBeTruthy();
        const snapshot = await service.callTool("builtin-browserdo", "browser_take_snapshot", {
          windowId,
        });
        console.log("BrowserDo snapshot:", snapshot.output.slice(0, 6000));
        expect(snapshot.isError).toBe(false);
        expect(snapshot.output).toContain("Example Domain");
      } finally {
        if (windowId)
          await service
            .callTool("builtin-browserdo", "browser_close_window", { windowId })
            .catch(() => undefined);
        service.dispose();
        database.close();
        await rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
  it("completes OAuth discovery, dynamic registration and token exchange", async () => {
    const authServer = createServer((request, response) => {
      const origin = `http://127.0.0.1:${(authServer.address() as { port: number }).port}`;
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/.well-known/oauth-protected-resource/mcp") {
        response.end(
          JSON.stringify({
            authorization_servers: [origin],
            resource: `${origin}/mcp`,
          }),
        );
        return;
      }
      if (request.url === "/.well-known/oauth-authorization-server") {
        response.end(
          JSON.stringify({
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
          }),
        );
        return;
      }
      if (request.url === "/register") {
        response.end(JSON.stringify({ client_id: "dynamic-client" }));
        return;
      }
      if (request.url === "/token") {
        response.end(
          JSON.stringify({
            access_token: "oauth-access",
            refresh_token: "oauth-refresh",
            expires_in: 3600,
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    });
    await new Promise<void>((resolveListen) =>
      authServer.listen(0, "127.0.0.1", () => resolveListen()),
    );
    const port = (authServer.address() as { port: number }).port;
    const root = await mkdtemp(join(tmpdir(), "mingshen-mcp-oauth-"));
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    const service = new McpService(repository, new SecretStore(database), "1.0.0");
    try {
      const server = await service.save({
        name: "OAuth MCP",
        description: "oauth test",
        transport: "http",
        enabled: true,
        url: `http://127.0.0.1:${port}/mcp`,
        timeoutMs: 5_000,
        oauthEnabled: true,
        oauthScope: "tools:read",
      });
      const started = await service.startOAuth(server.id);
      const authorization = new URL(started.authorizationUrl);
      const callback = new URL(authorization.searchParams.get("redirect_uri") ?? "");
      callback.searchParams.set("code", "test-code");
      callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");
      const completed = await fetch(callback);
      expect(completed.status).toBe(200);
      expect(service.list().find((entry) => entry.id === server.id)?.oauthAuthenticated).toBe(true);
    } finally {
      service.dispose();
      database.close();
      await new Promise<void>((resolveClose) => authServer.close(() => resolveClose()));
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it.each([307, 308])(
    "rejects OAuth token endpoint HTTP %i redirects without forwarding the POST",
    async (statusCode) => {
      let redirectedRequests = 0;
      const authServer = createServer(async (request, response) => {
        const origin = `http://127.0.0.1:${(authServer.address() as { port: number }).port}`;
        if (request.url === "/.well-known/oauth-protected-resource/mcp") {
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              authorization_servers: [origin],
              resource: `${origin}/mcp`,
            }),
          );
          return;
        }
        if (request.url === "/.well-known/oauth-authorization-server") {
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
            }),
          );
          return;
        }
        if (request.url === "/token") {
          response.writeHead(statusCode, { Location: `${origin}/redirect-target` });
          response.end();
          return;
        }
        if (request.url === "/redirect-target") {
          redirectedRequests += 1;
          for await (const _chunk of request) {
            // Drain the body so a leaked POST is observable even if the test later fails.
          }
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ access_token: "must-not-arrive" }));
          return;
        }
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end("{}");
      });
      await new Promise<void>((resolveListen) =>
        authServer.listen(0, "127.0.0.1", () => resolveListen()),
      );
      const port = (authServer.address() as { port: number }).port;
      const database = openDatabase(":memory:");
      const service = new McpService(new Repository(database), new SecretStore(database), "1.3.4");
      try {
        const server = await service.save({
          name: "OAuth redirect fixture",
          description: "test",
          transport: "http",
          enabled: true,
          url: `http://127.0.0.1:${port}/mcp`,
          oauthEnabled: true,
          oauthClientId: "fixture-client",
          oauthClientSecret: "fixture-client-secret",
        });
        const started = await service.startOAuth(server.id);
        const authorization = new URL(started.authorizationUrl);
        const callback = new URL(authorization.searchParams.get("redirect_uri") ?? "");
        callback.searchParams.set("code", "fixture-code");
        callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");

        const completed = await fetch(callback);
        expect(completed.status).toBe(400);
        expect(await completed.text()).toContain("OAuth failed:");
        expect(redirectedRequests).toBe(0);
        expect(service.list().find((entry) => entry.id === server.id)?.oauthAuthenticated).toBe(
          false,
        );
      } finally {
        service.dispose();
        database.close();
        authServer.closeAllConnections();
        await new Promise<void>((resolveClose) => authServer.close(() => resolveClose()));
      }
    },
    20_000,
  );

  it.each([
    { padding: 6000, truncated: false },
    { padding: 100_100, truncated: true },
  ])(
    "retains redacted OAuth token diagnostics with $padding padding characters",
    async ({ padding, truncated }) => {
      const clientSecret = "fixture-oauth-client-secret";
      const code = "fixture-oauth-authorization-code";
      let body = "";
      let verifier = "";
      const authServer = createServer(async (request, response) => {
        const origin = `http://127.0.0.1:${(authServer.address() as { port: number }).port}`;
        response.setHeader("Content-Type", "application/json");
        if (request.url === "/.well-known/oauth-protected-resource/mcp") {
          response.end(
            JSON.stringify({ authorization_servers: [origin], resource: `${origin}/mcp` }),
          );
        } else if (request.url === "/.well-known/oauth-authorization-server") {
          response.end(
            JSON.stringify({
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
            }),
          );
        } else if (request.url === "/token") {
          let text = "";
          for await (const chunk of request) text += chunk.toString();
          verifier = new URLSearchParams(text).get("code_verifier") ?? "";
          body = `token exchange rejected\n\nOpaque echoes: ${clientSecret} ${code} ${verifier}\n${"d".repeat(padding)}\n\nMCP_OAUTH_DIAGNOSTIC_TAIL\n`;
          response.writeHead(503, { "Content-Type": "text/plain" });
          response.end(body);
        } else {
          response.writeHead(404).end("{}");
        }
      });
      await new Promise<void>((done) => authServer.listen(0, "127.0.0.1", done));
      const db = openDatabase(":memory:");
      const service = new McpService(new Repository(db), new SecretStore(db), "1.3.0");
      try {
        const server = await service.save({
          name: "OAuth diagnostic fixture",
          description: "test",
          enabled: true,
          transport: "http",
          url: `http://127.0.0.1:${(authServer.address() as { port: number }).port}/mcp`,
          oauthEnabled: true,
          oauthClientId: "fixture-client",
          oauthClientSecret: clientSecret,
        });
        const started = await service.startOAuth(server.id);
        const authorization = new URL(started.authorizationUrl);
        const callback = new URL(authorization.searchParams.get("redirect_uri") ?? "");
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");
        const response = await fetch(callback);
        const error = await response.text();
        expect(response.status).toBe(400);
        expect(verifier).not.toBe("");
        const redacted = body
          .replaceAll(clientSecret, "[REDACTED]")
          .replaceAll(code, "[REDACTED]")
          .replaceAll(verifier, "[REDACTED]");
        expect(error).toBe(
          `OAuth failed: HTTP 503 Service Unavailable\n${redacted.slice(0, 100_000)}${truncated ? "\n[Response truncated at 100,000 characters]" : ""}`,
        );
        expect(error).not.toContain(clientSecret);
        expect(error).not.toContain(code);
        expect(error).not.toContain(verifier);
        expect(service.list().find((entry) => entry.id === server.id)?.oauthAuthenticated).toBe(
          false,
        );
      } finally {
        service.dispose();
        db.close();
        authServer.closeAllConnections();
        await new Promise<void>((done) => authServer.close(() => done()));
      }
    },
    20_000,
  );

  it.runIf(process.env.MINGSHEN_MCP_E2E === "1")(
    "connects to the built-in Wikipedia MCP and executes a tool",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-mcp-"));
      const database = openDatabase(join(root, "test.db"));
      const repository = new Repository(database);
      const service = new McpService(repository, new SecretStore(database), "1.0.0");
      try {
        await service.setEnabled("builtin-wikipedia", true);
        const tested = await service.test("builtin-wikipedia");
        expect(tested.ok).toBe(true);
        const search = tested.tools.find((tool) => tool.name.includes("search"));
        expect(search).toBeDefined();
        const result = await service.callTool("builtin-wikipedia", search?.name ?? "search", {
          query: "Mingshen Harness",
        });
        expect(result.isError).toBe(false);
        expect(result.output.length).toBeGreaterThan(0);
      } finally {
        service.dispose();
        database.close();
        await rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it.runIf(process.env.MINGSHEN_MCP_E2E === "1")(
    "probes every built-in MCP and reports credential blockers",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-mcp-builtins-"));
      const database = openDatabase(join(root, "test.db"));
      const repository = new Repository(database);
      const service = new McpService(repository, new SecretStore(database), "1.0.0");
      const results: Record<
        string,
        { ok: boolean; tools: number; names: string[]; error: string | null }
      > = {};
      try {
        for (const server of service.list().filter((entry) => entry.builtin)) {
          await service.setEnabled(server.id, true);
          const result = await service.test(server.id);
          results[server.id] = {
            ok: result.ok,
            tools: result.tools.length,
            names: result.tools.map((tool) => tool.name),
            error: result.error,
          };
        }
        console.log(JSON.stringify(results, null, 2));
        expect(results["builtin-wikipedia"]?.ok).toBe(true);
        expect(results["builtin-github"]?.error).toBeTruthy();
        expect(results["builtin-notion"]?.error).toBeTruthy();
        expect(results["builtin-browserbase"]?.error).toBeTruthy();
      } finally {
        service.dispose();
        database.close();
        await rm(root, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
