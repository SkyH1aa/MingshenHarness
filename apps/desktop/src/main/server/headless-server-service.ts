import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ChatStreamEvent, HeadlessServerStatus, ShareLinkResult } from "../../shared/domain";
import { APP_VERSION } from "../../shared/release";
import type { AgentProfileService } from "../agents/agent-profile-service";
import type { CustomCommandService } from "../agents/custom-command-service";
import type { ProjectToolingService } from "../agents/project-tooling-service";
import type { ChatService } from "../chat/chat-service";
import { recordRuntimeError, registerRuntimeSecret } from "../diagnostics/runtime-log";
import type { McpService } from "../mcp/mcp-service";
import type { ApprovalBroker } from "../permissions/approval-broker";
import type { QuestionBroker } from "../permissions/question-broker";
import { SessionService } from "../sessions/session-service";
import type { Repository } from "../storage/repository";
import type { TrajectoryService } from "../trajectories/trajectory-service";

interface ShareRecord {
  sessionId: string;
  expiresAt: number;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SHARE_TTL_MS = 24 * 60 * 60 * 1000;

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
}

function html(response: ServerResponse, value: string, status = 200): void {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(value),
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(value);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export class HeadlessServerService {
  private server: Server | null = null;
  private status: HeadlessServerStatus = {
    running: false,
    host: "127.0.0.1",
    port: 0,
    token: null,
    url: null,
  };
  private readonly eventClients = new Set<ServerResponse>();
  private readonly shares = new Map<string, ShareRecord>();

  constructor(
    private readonly repository: Repository,
    private readonly sessionService: SessionService,
    private readonly chatService: ChatService,
    private readonly agentProfileService: AgentProfileService,
    private readonly customCommandService: CustomCommandService,
    private readonly toolingService: ProjectToolingService,
    private readonly mcpService: McpService,
    private readonly trajectoryService: TrajectoryService,
    private readonly approvalBroker: ApprovalBroker,
    private readonly questionBroker: QuestionBroker,
    private readonly emit: (event: ChatStreamEvent) => void = () => undefined,
  ) {}

  getStatus(): HeadlessServerStatus {
    return { ...this.status };
  }

  async start(host = "127.0.0.1", port = 4096): Promise<HeadlessServerStatus> {
    if (host !== "127.0.0.1" || !Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Local API must bind to 127.0.0.1 with a valid port.");
    if (this.server) {
      return this.getStatus();
    }
    const token = randomBytes(32).toString("base64url");
    registerRuntimeSecret(token);
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((cause) => {
        recordRuntimeError("local-api.request", cause, { operation: request.method ?? "unknown" });
        json(response, 500, {
          error: "Request failed. Check the local application for details.",
        });
      });
    });
    await new Promise<void>((resolveStart, rejectStart) => {
      server.once("error", rejectStart);
      server.listen(port, host, () => resolveStart());
    });
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    this.server = server;
    this.status = {
      running: true,
      host,
      port: actualPort,
      token,
      url: `http://${host}:${actualPort}`,
    };
    return this.getStatus();
  }

  async stop(): Promise<void> {
    for (const client of this.eventClients) {
      client.end();
    }
    this.eventClients.clear();
    const server = this.server;
    this.server = null;
    this.status = { ...this.status, running: false, token: null, url: null };
    if (server) {
      await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
    }
  }

  recordEvent(event: ChatStreamEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.eventClients) {
      client.write(payload);
    }
  }

  share(sessionId: string): ShareLinkResult {
    if (!this.server || !this.status.url) {
      throw new Error("本地无头服务尚未启动。");
    }
    if (!this.repository.getSession(sessionId)) {
      throw new Error("会话不存在。");
    }
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString();
    this.shares.set(token, { sessionId, expiresAt: Date.parse(expiresAt) });
    return {
      url: `${this.status.url}/share/${token}`,
      expiresAt,
    };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const expectedHost = `127.0.0.1:${this.status.port}`;
    if (
      request.headers.host !== expectedHost ||
      (request.headers.origin && request.headers.origin !== this.status.url) ||
      (request.headers["sec-fetch-site"] &&
        !["same-origin", "none"].includes(String(request.headers["sec-fetch-site"])))
    ) {
      json(response, 403, { error: "Cross-site requests are forbidden" });
      return;
    }
    const url = new URL(request.url ?? "/", this.status.url ?? "http://127.0.0.1");
    if (request.method === "GET" && url.pathname.startsWith("/share/")) {
      this.renderShare(url.pathname.slice("/share/".length), response);
      return;
    }
    if (
      url.pathname !== "/global/health" &&
      url.pathname !== "/doc" &&
      request.headers.authorization !== `Bearer ${this.status.token}`
    ) {
      json(response, 401, { error: "Unauthorized" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/global/health") {
      json(response, 200, { healthy: true, version: APP_VERSION });
      return;
    }
    if (request.method === "GET" && url.pathname === "/doc") {
      json(response, 200, this.openApiDocument());
      return;
    }
    if (request.method === "GET" && url.pathname === "/event") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      response.write(`data: ${JSON.stringify({ type: "server.connected" })}\n\n`);
      this.eventClients.add(response);
      request.on("close", () => this.eventClients.delete(response));
      return;
    }
    if (request.method === "GET" && url.pathname === "/agent") {
      json(response, 200, await this.agentProfileService.list());
      return;
    }
    if (request.method === "GET" && url.pathname === "/provider") {
      json(response, 200, this.repository.listProviders());
      return;
    }
    if (request.method === "GET" && url.pathname === "/command") {
      const workspace =
        url.searchParams.get("workspace") ??
        this.repository.listSessions().find((session) => session.workspacePath)?.workspacePath ??
        null;
      json(response, 200, await this.customCommandService.list(workspace));
      return;
    }
    if (request.method === "GET" && url.pathname === "/session") {
      json(response, 200, this.repository.listSessions());
      return;
    }
    const permissionMatch = /^\/permission\/([^/]+)$/.exec(url.pathname);
    if (request.method === "POST" && permissionMatch?.[1]) {
      const input = await body(request);
      const decision =
        input.response === "allow_session"
          ? "allow_session"
          : input.response === "deny"
            ? "deny"
            : "allow_once";
      this.approvalBroker.decide({
        approvalId: permissionMatch[1],
        decision,
        ...(typeof input.feedback === "string" ? { feedback: input.feedback } : {}),
      });
      json(response, 200, true);
      return;
    }
    const questionMatch = /^\/question\/([^/]+)$/.exec(url.pathname);
    if (request.method === "POST" && questionMatch?.[1]) {
      const input = await body(request);
      try {
        this.questionBroker.answer({
          questionId: questionMatch[1],
          ...(input.answers !== undefined
            ? { answers: input.answers as import("../../shared/domain").AgentQuestionAnswer[] }
            : { answer: input.answer as string }),
        });
      } catch {
        json(response, 400, { error: "Invalid answer or question no longer pending." });
        return;
      }
      json(response, 200, true);
      return;
    }
    if (request.method === "POST" && url.pathname === "/session") {
      const input = await body(request);
      const requestsDerivedSession = [input.parentSessionId, input.forkedFromMessageId].some(
        (value) =>
          value !== undefined &&
          value !== null &&
          (typeof value !== "string" || value.trim().length > 0),
      );
      if (requestsDerivedSession) {
        json(response, 400, {
          error: "POST /session creates root sessions only; use /session/{id}/fork for branches.",
        });
        return;
      }
      const providerId = String(input.providerId ?? "");
      const modelId = String(input.modelId ?? "");
      if (!providerId || !modelId) {
        json(response, 400, { error: "providerId and modelId are required" });
        return;
      }
      let created: ReturnType<SessionService["create"]>;
      try {
        created = this.sessionService.create({
          title: String(input.title ?? "无头会话"),
          providerId,
          modelId,
          agentProfileId: String(input.agentProfileId ?? "primary"),
          agentMode: input.agentMode === "work" ? "work" : "code",
          workspacePath: typeof input.workspacePath === "string" ? input.workspacePath : null,
          systemPrompt: typeof input.systemPrompt === "string" ? input.systemPrompt : "",
          reasoningLevel: typeof input.reasoningLevel === "string" ? input.reasoningLevel : null,
          permissionMode:
            input.permissionMode === "full_access" ? "full_access" : "request_approval",
          executionMode:
            input.executionMode === "worktree" || input.executionMode === "docker"
              ? input.executionMode
              : "host",
          patchOnly: input.patchOnly === true,
        });
      } catch (cause) {
        json(response, 400, {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        return;
      }
      this.emit({ type: "session_updated", session: created });
      json(response, 201, created);
      return;
    }
    const sessionMatch = /^\/session\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (sessionMatch?.[1]) {
      await this.handleSession(request, response, sessionMatch[1], sessionMatch[2] ?? "");
      return;
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/mcp" || url.pathname === "/lsp" || url.pathname === "/formatter")
    ) {
      if (url.pathname === "/mcp") {
        json(response, 200, this.mcpService.list());
        return;
      }
      const workspace =
        url.searchParams.get("workspace") ??
        this.repository.listSessions().find((session) => session.workspacePath)?.workspacePath;
      const tooling = workspace ? await this.toolingService.status(workspace) : [];
      json(
        response,
        200,
        url.pathname === "/lsp"
          ? tooling.filter((entry) => entry.kind === "lsp")
          : tooling.filter((entry) => entry.kind === "formatter"),
      );
      return;
    }
    json(response, 404, { error: "Not found" });
  }

  private async handleSession(
    request: IncomingMessage,
    response: ServerResponse,
    sessionId: string,
    action: string,
  ): Promise<void> {
    const session = this.repository.getSession(sessionId);
    if (!session) {
      json(response, 404, { error: "Session not found" });
      return;
    }
    if (request.method === "GET" && !action) {
      json(response, 200, session);
      return;
    }
    if (request.method === "DELETE" && !action) {
      await this.chatService.removeSession(sessionId);
      json(response, 200, true);
      return;
    }
    if (request.method === "PUT" && !action) {
      const input = await body(request);
      const isBusy = (id: string): boolean =>
        this.chatService.isSessionBusy(id) ||
        this.repository.listChildSessions(id).some((child) => isBusy(child.id));
      if (input.archived === true && isBusy(sessionId)) {
        json(response, 409, {
          error: "Stop this conversation and its child tasks before archiving.",
        });
        return;
      }
      const updated = new SessionService(this.repository).update({
        sessionId,
        ...(typeof input.title === "string" ? { title: input.title } : {}),
        ...(typeof input.providerId === "string" ? { providerId: input.providerId } : {}),
        ...(typeof input.modelId === "string" ? { modelId: input.modelId } : {}),
        ...(typeof input.agentProfileId === "string"
          ? { agentProfileId: input.agentProfileId }
          : {}),
        ...(typeof input.workspacePath === "string" || input.workspacePath === null
          ? { workspacePath: input.workspacePath as string | null }
          : {}),
        ...(typeof input.systemPrompt === "string" ? { systemPrompt: input.systemPrompt } : {}),
        ...(typeof input.reasoningLevel === "string" || input.reasoningLevel === null
          ? { reasoningLevel: input.reasoningLevel as string | null }
          : {}),
        ...(input.executionMode === "host" ||
        input.executionMode === "worktree" ||
        input.executionMode === "docker"
          ? { executionMode: input.executionMode }
          : {}),
        ...(typeof input.patchOnly === "boolean" ? { patchOnly: input.patchOnly } : {}),
        ...(typeof input.archived === "boolean" ? { archived: input.archived } : {}),
        ...(typeof input.pinned === "boolean" ? { pinned: input.pinned } : {}),
      });
      if (input.permissionMode === "full_access" || input.permissionMode === "request_approval") {
        Object.assign(
          updated,
          this.chatService.setSessionPermission(sessionId, input.permissionMode),
        );
      }
      if (typeof input.archived === "boolean") {
        const emitChildren = (id: string) => {
          for (const child of this.repository.listChildSessions(id)) {
            this.emit({ type: "session_updated", session: child });
            emitChildren(child.id);
          }
        };
        emitChildren(sessionId);
      }
      this.emit({ type: "session_updated", session: updated });
      json(response, 200, updated);
      return;
    }
    if (request.method === "GET" && action === "message") {
      json(response, 200, this.repository.getMessages(sessionId));
      return;
    }
    if (request.method === "GET" && action === "children") {
      json(response, 200, this.repository.listChildSessions(sessionId));
      return;
    }
    if (request.method === "GET" && action === "todo") {
      json(response, 200, this.repository.listSessionTodos(sessionId));
      return;
    }
    if (request.method === "GET" && action === "trajectory") {
      json(response, 200, this.trajectoryService.list(sessionId));
      return;
    }
    if (request.method === "GET" && action === "diff") {
      const diffs = this.repository
        .getMessages(sessionId)
        .flatMap((message) => message.parts)
        .flatMap((part) => (part.type === "run_summary" ? part.summary.fileChanges : []));
      json(response, 200, diffs);
      return;
    }
    if (request.method === "POST" && action === "fork") {
      const input = await body(request);
      const messageId = typeof input.messageId === "string" ? input.messageId : null;
      json(response, 201, this.chatService.forkSession(sessionId, messageId));
      return;
    }
    if (request.method === "POST" && action === "compact") {
      json(response, 202, this.chatService.compactSession(sessionId));
      return;
    }
    if (request.method === "POST" && (action === "message" || action === "prompt_async")) {
      const input = await body(request);
      const text =
        typeof input.text === "string"
          ? input.text
          : Array.isArray(input.parts)
            ? input.parts
                .filter((part): part is Record<string, unknown> =>
                  Boolean(part && typeof part === "object"),
                )
                .filter((part) => part.type === "text")
                .map((part) => String(part.text ?? ""))
                .join("\n")
            : "";
      const result = await this.chatService.send({ sessionId, text });
      json(response, action === "prompt_async" ? 204 : 202, result);
      return;
    }
    if (request.method === "POST" && action === "command") {
      const input = await body(request);
      const command = String(input.command ?? "")
        .replace(/^\//, "")
        .trim();
      const args = String(input.arguments ?? "").trim();
      if (!command) {
        json(response, 400, { error: "command is required" });
        return;
      }
      const result = await this.chatService.send({
        sessionId,
        text: `/${command}${args ? ` ${args}` : ""}`,
      });
      json(response, 202, result);
      return;
    }
    if (request.method === "POST" && action === "abort") {
      this.chatService.stop(sessionId);
      json(response, 200, true);
      return;
    }
    if (request.method === "POST" && action === "share") {
      json(response, 200, this.share(sessionId));
      return;
    }
    json(response, 404, { error: "Not found" });
  }

  private renderShare(token: string, response: ServerResponse): void {
    const record = this.shares.get(token);
    if (!record || record.expiresAt <= Date.now()) {
      html(response, "<h1>分享链接不存在或已过期</h1>", 404);
      return;
    }
    const session = this.repository.getSession(record.sessionId);
    if (!session) {
      html(response, "<h1>会话不存在</h1>", 404);
      return;
    }
    const messages = this.repository.getMessages(session.id);
    const rendered = messages
      .map((message) => {
        const text = message.parts
          .filter(
            (part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
              part.type === "text",
          )
          .map((part) => part.text)
          .join("\n\n");
        return `<article class="message message--${message.role}"><strong>${escapeHtml(
          message.role,
        )}</strong><pre>${escapeHtml(text)}</pre></article>`;
      })
      .join("");
    html(
      response,
      `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(session.title)} · Mingshen Share</title>
<style>
body{margin:0;background:#0b0b0d;color:#f4f4f5;font:14px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:920px;margin:0 auto;padding:48px 24px}h1{font-size:24px;margin:0 0 8px}
.meta{color:#a6a6af;margin-bottom:32px}.message{border-top:1px solid #27272d;padding:18px 0}
.message strong{font:11px "Cascadia Code",monospace;color:#b9dee3}.message pre{
white-space:pre-wrap;word-break:break-word;font:14px/1.75 "Segoe UI","Microsoft YaHei",sans-serif;margin:8px 0 0}
</style></head><body><main><h1>${escapeHtml(session.title)}</h1>
<div class="meta">本地只读分享 · 过期时间 ${new Date(record.expiresAt).toLocaleString("zh-CN")}</div>
${rendered || "<p>会话没有消息。</p>"}</main></body></html>`,
    );
  }

  private openApiDocument(): Record<string, unknown> {
    return {
      openapi: "3.1.0",
      info: { title: "Mingshen Harness Local Server", version: APP_VERSION },
      servers: [{ url: this.status.url ?? "http://127.0.0.1:4096" }],
      paths: {
        "/global/health": { get: { summary: "Health" } },
        "/agent": { get: { summary: "List agents" } },
        "/provider": { get: { summary: "List providers and models" } },
        "/session": {
          get: { summary: "List sessions" },
          post: {
            summary: "Create a root session",
            description:
              "Creates a new root session. Use POST /session/{id}/fork to branch an existing session.",
          },
        },
        "/session/{id}": {
          get: { summary: "Get session" },
          put: { summary: "Update session" },
          delete: { summary: "Delete session" },
        },
        "/session/{id}/message": {
          get: { summary: "List messages" },
          post: { summary: "Send a message" },
        },
        "/session/{id}/prompt_async": { post: { summary: "Send asynchronously" } },
        "/session/{id}/abort": { post: { summary: "Stop a run" } },
        "/session/{id}/command": { post: { summary: "Run a custom command" } },
        "/session/{id}/fork": { post: { summary: "Fork a session" } },
        "/session/{id}/diff": { get: { summary: "List session file changes" } },
        "/session/{id}/children": { get: { summary: "List child sessions" } },
        "/session/{id}/share": { post: { summary: "Create a local read-only share link" } },
        "/mcp": { get: { summary: "MCP status" } },
        "/permission/{id}": { post: { summary: "Answer a permission request" } },
        "/question/{id}": { post: { summary: "Answer an Agent question" } },
        "/lsp": { get: { summary: "LSP status" } },
        "/formatter": { get: { summary: "Formatter status" } },
      },
    };
  }
}
