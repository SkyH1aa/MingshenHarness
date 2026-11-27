import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ChatStreamEvent, HeadlessServerStatus, ShareLinkResult } from "../../shared/domain";
import { APP_VERSION } from "../../shared/release";
import { RUNTIME_TERMINAL_STATUSES } from "../../shared/runtime";
import type { AgentProfileService } from "../agents/agent-profile-service";
import type { CustomCommandService } from "../agents/custom-command-service";
import type { ProjectToolingService } from "../agents/project-tooling-service";
import type { ChatService } from "../chat/chat-service";
import { recordInterfaceResult } from "../diagnostics/interface-result";
import {
  recordRuntimeError,
  recordRuntimeWarning,
  registerRuntimeSecret,
} from "../diagnostics/runtime-log";
import type { McpService } from "../mcp/mcp-service";
import type { ApprovalBroker } from "../permissions/approval-broker";
import type { QuestionBroker } from "../permissions/question-broker";
import {
  RuntimeCursorExpiredError,
  RuntimeIdempotencyConflictError,
  RuntimeNotFoundError,
  type RuntimeService,
  RuntimeValidationError,
} from "../runtime/runtime-service";
import { SessionService } from "../sessions/session-service";
import type { Repository } from "../storage/repository";
import type { TrajectoryService } from "../trajectories/trajectory-service";

interface ShareRecord {
  sessionId: string;
  expiresAt: number;
}

type DeveloperHandler = (
  request: IncomingMessage,
  url: URL,
  body: Record<string, unknown>,
) => unknown | Promise<unknown>;

interface DeveloperRouteResult {
  httpStatus: number;
  json: unknown;
}

export interface DeveloperServiceHandlers {
  capabilities?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  assertAccess?: (input: {
    method: string;
    path: string;
    sessionId: string | null;
    operation: "dispatch" | "diagnostic";
  }) => unknown | Promise<unknown>;
  policyEffective?: DeveloperHandler;
  taskClaims?: DeveloperHandler;
  officeReceipts?: DeveloperHandler;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const SERVER_CLOSE_GRACE_MS = 1_000;
const SAFE_READONLY_V1_PATHS = new Set([
  "/v1/capabilities",
  "/v1/policy/effective",
  "/v1/events",
  "/v1/tasks/claims",
  "/v1/office/receipts",
]);

const LOGGABLE_STATIC_PATHS = new Set([
  "/global/health",
  "/doc",
  "/event",
  "/agent",
  "/provider",
  "/command",
  "/session",
  "/mcp",
  "/lsp",
  "/formatter",
  "/v1/capabilities",
  "/v1/events",
  "/v1/policy/effective",
  "/v1/tasks/claims",
  "/v1/office/receipts",
]);
const LOGGABLE_SESSION_ACTIONS = new Set([
  "message",
  "children",
  "todo",
  "trajectory",
  "diff",
  "fork",
  "compact",
  "prompt_async",
  "command",
  "abort",
  "share",
]);

function requestOperation(request: IncomingMessage): string {
  const method = ["GET", "POST", "PUT", "DELETE"].includes(request.method ?? "")
    ? request.method
    : "OTHER";
  let pathname = "";
  try {
    pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return `${method} unknown`;
  }
  if (LOGGABLE_STATIC_PATHS.has(pathname)) return `${method} ${pathname}`;
  if (/^\/share\/[^/]+$/.test(pathname)) return `${method} /share/:token`;
  if (/^\/permission\/[^/]+$/.test(pathname)) return `${method} /permission/:id`;
  if (/^\/question\/[^/]+$/.test(pathname)) return `${method} /question/:id`;
  if (/^\/v1\/sessions\/[^/]+\/snapshot$/.test(pathname))
    return `${method} /v1/sessions/:id/snapshot`;
  if (/^\/v1\/sessions\/[^/]+\/turns$/.test(pathname)) return `${method} /v1/sessions/:id/turns`;
  if (/^\/v1\/runs\/[^/]+$/.test(pathname)) return `${method} /v1/runs/:id`;
  if (/^\/v1\/runs\/[^/]+\/cancel$/.test(pathname)) return `${method} /v1/runs/:id/cancel`;
  const session = /^\/session\/[^/]+(?:\/([^/]+))?$/.exec(pathname);
  if (session && !session[1]) return `${method} /session/:id`;
  if (session?.[1] && LOGGABLE_SESSION_ACTIONS.has(session[1]))
    return `${method} /session/:id/${session[1]}`;
  return `${method} unknown`;
}

function isClientDisconnect(cause: unknown): boolean {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  return (
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "ABORT_ERR" ||
    code === "ERR_STREAM_DESTROYED" ||
    code === "ERR_STREAM_WRITE_AFTER_END"
  );
}

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

function developerRouteResult(httpStatus: number, value: unknown): DeveloperRouteResult {
  return { httpStatus, json: value };
}

function isSafeReadonlyV1Request(method: string, pathname: string): boolean {
  if (method !== "GET") return false;
  if (SAFE_READONLY_V1_PATHS.has(pathname)) return true;
  return /^\/v1\/sessions\/[^/]+\/snapshot$/.test(pathname) || /^\/v1\/runs\/[^/]+$/.test(pathname);
}

function isDeveloperRouteResult(value: unknown): value is DeveloperRouteResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      "httpStatus" in value &&
      Number.isInteger(value.httpStatus) &&
      "json" in value,
  );
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
  private readonly runtimeEventClosers = new Set<() => void>();
  private readonly shares = new Map<string, ShareRecord>();
  private runtimeService: RuntimeService | null = null;
  private persistHeadlessEvents = false;
  private developerHandlers: DeveloperServiceHandlers = {};
  private runCanceller: ((runId: string) => boolean) | null = null;

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

  setRuntimeService(service: RuntimeService, options: { persistEvents?: boolean } = {}): void {
    this.runtimeService = service;
    this.persistHeadlessEvents = options.persistEvents === true;
  }

  setDeveloperHandlers(handlers: DeveloperServiceHandlers): void {
    this.developerHandlers = handlers;
  }

  setRunCanceller(canceller: (runId: string) => boolean): void {
    this.runCanceller = canceller;
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
      const operation = requestOperation(request);
      let exceptionRecorded = false;
      response.once("finish", () => {
        const status = response.statusCode;
        if (status < 400 || exceptionRecorded) return;
        const context = { operation, status, code: `HTTP_${status}` };
        const message = "Local API request returned an unsuccessful HTTP status.";
        if (status < 500) recordRuntimeWarning("local-api.response", message, context);
        else recordRuntimeError("local-api.response", message, context);
      });
      void this.handle(request, response).catch((cause) => {
        if (isClientDisconnect(cause) || request.aborted || response.destroyed) return;
        exceptionRecorded = true;
        recordRuntimeError("local-api.request", "Local API request failed unexpectedly.", {
          operation,
          status: 500,
          code: "LOCAL_API_EXCEPTION",
        });
        if (response.headersSent || response.writableEnded) {
          if (!response.destroyed) response.destroy();
          return;
        }
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
    for (const close of [...this.runtimeEventClosers]) close();
    this.runtimeEventClosers.clear();
    const server = this.server;
    this.server = null;
    this.status = { ...this.status, running: false, token: null, url: null };
    if (server) {
      await new Promise<void>((resolveStop) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(forceClose);
          resolveStop();
        };
        const forceClose = setTimeout(() => {
          server.closeAllConnections();
          finish();
        }, SERVER_CLOSE_GRACE_MS);
        forceClose.unref();
        server.close(finish);
        server.closeIdleConnections();
      });
    }
  }

  recordEvent(event: ChatStreamEvent): void {
    if (this.persistHeadlessEvents) this.runtimeService?.recordEvent(event);
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.eventClients) {
      if (client.destroyed || client.writableEnded) {
        this.eventClients.delete(client);
        continue;
      }
      try {
        client.write(payload);
      } catch (cause) {
        this.eventClients.delete(client);
        if (!isClientDisconnect(cause) && !client.destroyed && !client.writableEnded) {
          recordRuntimeError("local-api.events", "Local API event stream write failed.", {
            operation: "GET /event",
            code: "LOCAL_API_STREAM_WRITE_FAILED",
          });
        }
        if (!client.destroyed) client.destroy();
      }
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
      request.headers.authorization !== `Bearer ${this.status.token}`
    ) {
      json(response, 401, { error: "Unauthorized" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/global/health") {
      json(response, 200, { healthy: true, version: APP_VERSION });
      return;
    }
    if (url.pathname.startsWith("/v1/")) {
      await this.handleV1(request, response, url);
      return;
    }
    const accessDenied = await this.developerAccessDenied(request, url);
    if (accessDenied) {
      json(response, accessDenied.httpStatus, accessDenied.json);
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
      response.once("close", () => this.eventClients.delete(response));
      response.on("error", (cause) => {
        this.eventClients.delete(response);
        if (!isClientDisconnect(cause) && !request.aborted) {
          recordRuntimeError("local-api.events", "Local API event stream failed.", {
            operation: "GET /event",
            code: "LOCAL_API_STREAM_FAILED",
          });
        }
      });
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

  private async handleV1(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const runtime = this.runtimeService;
    try {
      const isExactCancellation =
        request.method === "POST" && /^\/v1\/runs\/[^/]+\/cancel$/.test(url.pathname);
      if (!isExactCancellation) {
        const accessDenied = await this.developerAccessDenied(request, url);
        if (accessDenied) {
          json(response, accessDenied.httpStatus, accessDenied.json);
          return;
        }
      }
      if (request.method === "GET" && url.pathname === "/v1/capabilities") {
        const extended = this.developerHandlers.capabilities
          ? await this.developerHandlers.capabilities()
          : {};
        json(response, 200, {
          version: APP_VERSION,
          limits: {
            requestBodyBytes: MAX_BODY_BYTES,
            eventPageSize: 2_000,
          },
          ...(runtime?.capabilities() ?? {
            apiVersion: "v1",
            runtimeEvents: false,
            eventReplay: false,
            idempotentTurns: false,
            exactRunCancellation: false,
            policy: false,
            taskClaims: false,
            officeReceipts: false,
          }),
          exactRunCancellation: Boolean(this.runCanceller),
          policy: Boolean(this.developerHandlers.policyEffective),
          taskClaims: Boolean(this.developerHandlers.taskClaims),
          officeReceipts: Boolean(this.developerHandlers.officeReceipts),
          permissionModes: ["request_approval", "full_access"],
          ...extended,
        });
        return;
      }
      if (!runtime) {
        json(response, 503, { error: "Runtime persistence is unavailable." });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/policy/effective") {
        await this.handleDeveloperRoute(
          response,
          this.developerHandlers.policyEffective,
          request,
          url,
          {},
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/events") {
        this.openRuntimeEventStream(request, response, url, runtime);
        return;
      }

      const snapshotMatch = /^\/v1\/sessions\/([^/]+)\/snapshot$/.exec(url.pathname);
      if (request.method === "GET" && snapshotMatch?.[1]) {
        json(response, 200, runtime.snapshot(snapshotMatch[1]));
        return;
      }
      const turnMatch = /^\/v1\/sessions\/([^/]+)\/turns$/.exec(url.pathname);
      if (request.method === "POST" && turnMatch?.[1]) {
        const input = await body(request);
        const header = request.headers["idempotency-key"];
        const idempotencyKey = Array.isArray(header) ? header[0] : header;
        if (!idempotencyKey?.trim()) {
          json(response, 400, { error: "Idempotency-Key header is required." });
          return;
        }
        const sessionId = turnMatch[1];
        if (!this.repository.getSession(sessionId)) {
          json(response, 404, { error: "Session not found." });
          return;
        }
        const text = this.messageText(input);
        if (!text.trim()) {
          json(response, 400, { error: "A non-empty text turn is required." });
          return;
        }
        const result = await this.chatService.send({
          sessionId,
          text,
          requestParts: input.parts ?? null,
          ...(Array.isArray(input.attachments)
            ? {
                attachments: input.attachments as NonNullable<
                  Parameters<ChatService["send"]>[0]["attachments"]
                >,
              }
            : {}),
          ...(typeof input.temporaryInstruction === "string"
            ? { temporaryInstruction: input.temporaryInstruction }
            : {}),
          idempotencyKey,
        });
        json(response, 202, {
          runId: result.runId,
          run: runtime.getRun(result.runId),
        });
        return;
      }

      const runMatch = /^\/v1\/runs\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (runMatch?.[1]) {
        const run = runtime.getRun(runMatch[1]);
        if (request.method === "GET" && !runMatch[2]) {
          json(response, 200, run);
          return;
        }
        if (request.method === "POST" && runMatch[2] === "cancel") {
          if (RUNTIME_TERMINAL_STATUSES.has(run.status)) {
            json(response, 200, {
              accepted: false,
              alreadyTerminal: true,
              run,
            });
            return;
          }
          if (!this.runCanceller) {
            json(response, 501, {
              error: "Exact run cancellation is not configured.",
              runId: run.runId,
              cancellationConfirmed: false,
            });
            return;
          }
          const accepted = this.runCanceller(run.runId);
          json(response, accepted ? 202 : 409, {
            accepted,
            alreadyTerminal: false,
            stopRequested: accepted,
            cancellationConfirmed: false,
            run: runtime.getRun(run.runId),
          });
          return;
        }
      }

      if (
        (request.method === "GET" || request.method === "POST") &&
        url.pathname === "/v1/tasks/claims"
      ) {
        await this.handleDeveloperRoute(
          response,
          this.developerHandlers.taskClaims,
          request,
          url,
          request.method === "POST" ? await body(request) : {},
        );
        return;
      }
      if (
        (request.method === "GET" || request.method === "POST") &&
        url.pathname === "/v1/office/receipts"
      ) {
        await this.handleDeveloperRoute(
          response,
          this.developerHandlers.officeReceipts,
          request,
          url,
          request.method === "POST" ? await body(request) : {},
        );
        return;
      }
      json(response, 404, { error: "Not found" });
    } catch (cause) {
      if (cause instanceof RuntimeCursorExpiredError) {
        json(response, cause.statusCode, {
          error: cause.message,
          code: cause.code,
          snapshotRequired: true,
          requestedCursor: cause.requestedCursor,
          earliestCursor: cause.earliestCursor,
        });
        return;
      }
      if (cause instanceof RuntimeIdempotencyConflictError) {
        json(response, cause.statusCode, {
          error: cause.message,
          code: cause.code,
        });
        return;
      }
      if (cause instanceof RuntimeNotFoundError) {
        json(response, cause.statusCode, {
          error: cause.message,
          code: cause.code,
        });
        return;
      }
      if (cause instanceof RuntimeValidationError) {
        json(response, cause.statusCode, {
          error: cause.message,
          code: cause.code,
        });
        return;
      }
      throw cause;
    }
  }

  private openRuntimeEventStream(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    runtime: RuntimeService,
  ): void {
    const header = request.headers["last-event-id"];
    const rawCursor = Array.isArray(header) ? header[0] : (header ?? url.searchParams.get("after"));
    const after = Number(rawCursor ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) {
      json(response, 400, { error: "Event cursor must be a non-negative integer." });
      return;
    }
    const sessionId = url.searchParams.get("sessionId");
    const runId = url.searchParams.get("runId");
    const follow = url.searchParams.get("follow") !== "false";
    let closed = false;
    let cursor = after;
    let replayComplete = !follow;
    let heartbeat: NodeJS.Timeout | null = null;
    const pendingEvents: Array<ReturnType<RuntimeService["recordEvent"]>> = [];
    const writeEnvelope = (envelope: ReturnType<RuntimeService["recordEvent"]>): void => {
      if (
        closed ||
        response.destroyed ||
        response.writableEnded ||
        (sessionId && envelope.sessionId !== sessionId) ||
        (runId && envelope.runId !== runId)
      ) {
        return;
      }
      if (envelope.eventId === null) {
        response.write(`event: runtime\ndata: ${JSON.stringify(envelope)}\n\n`);
        return;
      }
      if (envelope.eventId <= cursor) return;
      cursor = envelope.eventId;
      response.write(`id: ${envelope.eventId}\nevent: runtime\n`);
      response.write(`data: ${JSON.stringify(envelope)}\n\n`);
    };
    let unsubscribe: () => void = () => undefined;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      this.runtimeEventClosers.delete(close);
    };
    const close = (): void => {
      cleanup();
      if (!response.writableEnded && !response.destroyed) response.end();
    };
    const reportStreamFailure = (cause: unknown): void => {
      if (!isClientDisconnect(cause) && !request.aborted) {
        recordRuntimeError("local-api.runtime-events", "Runtime event stream failed.", {
          operation: "GET /v1/events",
          code: "LOCAL_API_STREAM_FAILED",
        });
      }
    };
    unsubscribe = follow
      ? runtime.subscribe((envelope, eventSessionId, eventRunId) => {
          if ((sessionId && eventSessionId !== sessionId) || (runId && eventRunId !== runId)) {
            return;
          }
          if (!replayComplete) {
            pendingEvents.push(envelope);
            return;
          }
          try {
            writeEnvelope(envelope);
          } catch (cause) {
            reportStreamFailure(cause);
            close();
            if (!response.destroyed) response.destroy();
          }
        })
      : () => undefined;
    this.runtimeEventClosers.add(close);
    request.once("aborted", close);
    response.once("close", close);
    response.on("error", (cause) => {
      if (closed) return;
      reportStreamFailure(cause);
      close();
    });

    // Resolve the first page before committing SSE headers. The remaining page
    // loop runs synchronously, so no JS cleanup or runtime event can interleave
    // between cursor validation and the documented HTTP 200 response.
    let firstReplay: ReturnType<RuntimeService["listEvents"]>;
    try {
      firstReplay = runtime.listEvents({
        after,
        sessionId,
        runId,
        limit: 2_000,
      });
    } catch (error) {
      cleanup();
      throw error;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 3000\n\n");
    heartbeat = setInterval(() => {
      if (!closed && !response.destroyed) response.write(`: heartbeat ${Date.now()}\n\n`);
    }, 15_000);
    heartbeat.unref();

    try {
      let replay = firstReplay;
      while (true) {
        for (const envelope of replay.events) writeEnvelope(envelope);
        if (!replay.hasMore) break;
        replay = runtime.listEvents({
          after: replay.cursor,
          sessionId,
          runId,
          limit: 2_000,
        });
      }
      replayComplete = true;
      for (const envelope of pendingEvents.splice(0)) writeEnvelope(envelope);
      if (closed || response.destroyed) return;
      response.write(
        `data: ${JSON.stringify({
          type: "server.connected",
          cursor,
        })}\n\n`,
      );
      if (!follow) {
        close();
        return;
      }
    } catch (error) {
      reportStreamFailure(error);
      close();
      if (!response.destroyed) response.destroy();
    }
  }

  private async handleDeveloperRoute(
    response: ServerResponse,
    handler: DeveloperHandler | undefined,
    request: IncomingMessage,
    url: URL,
    bodyValue: Record<string, unknown>,
  ): Promise<void> {
    if (!handler) {
      json(response, 503, { error: "This developer capability is unavailable." });
      return;
    }
    const result = await handler(request, url, bodyValue);
    if (isDeveloperRouteResult(result)) {
      if (result.httpStatus < 400)
        recordInterfaceResult("local-api", requestOperation(request), result.json);
      json(response, result.httpStatus, result.json);
      return;
    }
    recordInterfaceResult("local-api", requestOperation(request), result);
    json(response, request.method === "POST" ? 202 : 200, result);
  }

  private async developerAccessDenied(
    request: IncomingMessage,
    url: URL,
  ): Promise<DeveloperRouteResult | null> {
    if (!this.developerHandlers.assertAccess) return null;
    const sessionMatch = /^(?:\/v1)?\/sessions\/([^/]+)/.exec(url.pathname);
    const access = await this.developerHandlers.assertAccess({
      method: request.method ?? "GET",
      path: url.pathname,
      sessionId: sessionMatch?.[1]
        ? decodeURIComponent(sessionMatch[1])
        : url.searchParams.get("sessionId"),
      operation: isSafeReadonlyV1Request(request.method ?? "GET", url.pathname)
        ? "diagnostic"
        : "dispatch",
    });
    if (
      !access ||
      typeof access !== "object" ||
      !("allowed" in access) ||
      access.allowed !== false
    ) {
      return null;
    }
    const decision = access as {
      allowed: false;
      status?: number;
      code?: string;
      reason?: string;
      revision?: string;
      policySources?: unknown[];
    };
    return developerRouteResult(decision.status ?? 403, {
      error: decision.reason ?? "Developer API access was denied by managed policy.",
      code: decision.code ?? "DEVELOPER_API_DENIED",
      ...(decision.revision ? { policyRevision: decision.revision } : {}),
      ...(decision.policySources?.length ? { policySources: decision.policySources } : {}),
    });
  }

  private messageText(input: Record<string, unknown>): string {
    if (typeof input.text === "string") return input.text;
    if (!Array.isArray(input.parts)) return "";
    return input.parts
      .filter((part): part is Record<string, unknown> => Boolean(part && typeof part === "object"))
      .filter((part) => part.type === "text")
      .map((part) => String(part.text ?? ""))
      .join("\n");
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
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
        },
      },
      security: [{ bearerAuth: [] }],
      paths: {
        "/global/health": { get: { summary: "Health", security: [] } },
        "/v1/capabilities": { get: { summary: "Read local API and runtime capabilities" } },
        "/v1/events": {
          get: {
            summary: "Resume and follow persisted runtime events",
            description:
              "Supports Last-Event-ID and the after query cursor. An expired cursor returns 410 and requires a new session snapshot.",
          },
        },
        "/v1/sessions/{id}/snapshot": {
          get: { summary: "Get session, messages, todos, runs and latest event cursor" },
        },
        "/v1/sessions/{id}/turns": {
          post: {
            summary: "Admit and send an idempotent turn",
            description: "Requires a unique Idempotency-Key header for each request body.",
          },
        },
        "/v1/runs/{id}": { get: { summary: "Get a runtime run" } },
        "/v1/runs/{id}/cancel": {
          post: {
            summary: "Request cancellation of one exact runtime run",
            description:
              "HTTP 202 acknowledges the stop request only. Observe the exact run until it reaches a terminal state before reporting cancellation as confirmed.",
          },
        },
        "/v1/policy/effective": {
          get: { summary: "Get the effective non-secret management policy" },
        },
        "/v1/tasks/claims": {
          get: {
            summary: "List task claims",
            description:
              "Filter by claimId, sessionId or ownerRunId. Use includeTerminal=true to include completed and released history.",
          },
          post: {
            summary: "Create, heartbeat, settle or recover one canonical plan-step claim",
            description:
              "The action field selects claim, heartbeat, settle or recover. Creation requires a live runtime run bound to the authorized owner session. Heartbeat and direct settlement require that exact nonterminal run. An expired or cancel-requested claim requires recover with its inspected expectedVersion and factual evidence; terminal runs cannot be settled directly.",
          },
        },
        "/v1/office/receipts": {
          get: { summary: "List or inspect office delivery receipts" },
          post: {
            summary: "Prepare or check a host-governed office delivery receipt",
            description:
              "The action field selects prepare or check. Both actions use the same main CodeAgent/WorkAgent host full-access session policy as the in-app host workflow. Prepare accepts only a path within the session workspace. External visual-batch and record-visual evidence is rejected as untrusted; use check so MingshenHarness performs its own bounded render and vision inspection.",
          },
        },
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
