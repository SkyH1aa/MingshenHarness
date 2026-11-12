import { mkdtemp, rm } from "node:fs/promises";
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
