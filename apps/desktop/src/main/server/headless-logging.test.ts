import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "../../shared/domain";
import type { AgentProfileService } from "../agents/agent-profile-service";
import type { CustomCommandService } from "../agents/custom-command-service";
import type { ProjectToolingService } from "../agents/project-tooling-service";
import type { ChatService } from "../chat/chat-service";
import { recordRuntimeError, recordRuntimeWarning } from "../diagnostics/runtime-log";
import type { McpService } from "../mcp/mcp-service";
import { ApprovalBroker } from "../permissions/approval-broker";
import { QuestionBroker } from "../permissions/question-broker";
import { RuntimeNotFoundError, type RuntimeService } from "../runtime/runtime-service";
import type { SessionService } from "../sessions/session-service";
import type { Repository } from "../storage/repository";
import type { TrajectoryService } from "../trajectories/trajectory-service";
import { HeadlessServerService } from "./headless-server-service";

vi.mock("../diagnostics/runtime-log", () => ({
  recordRuntimeError: vi.fn(),
  recordRuntimeWarning: vi.fn(),
  registerRuntimeSecret: vi.fn(),
}));

const services: HeadlessServerService[] = [];

function fixture(): HeadlessServerService {
  const service = new HeadlessServerService(
    { getSession: vi.fn().mockReturnValue(null) } as unknown as Repository,
    {} as SessionService,
    {} as ChatService,
    {} as AgentProfileService,
    {} as CustomCommandService,
    {} as ProjectToolingService,
    {} as McpService,
    {} as TrajectoryService,
    new ApprovalBroker(),
    new QuestionBroker(),
  );
  services.push(service);
  return service;
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  vi.clearAllMocks();
});

describe("headless API logging", () => {
  it("records handled legacy/v1 failures with static route templates and no request data", async () => {
    const service = fixture();
    service.setRuntimeService({
      snapshot: () => {
        throw new RuntimeNotFoundError("fixture private resource");
      },
    } as unknown as RuntimeService);
    const status = await service.start("127.0.0.1", 0);
    const headers = { Authorization: `Bearer ${status.token}` };
    expect((await fetch(`${status.url}/session`)).status).toBe(401);
    expect(
      (await fetch(`${status.url}/session/fixture-private-id?token=fixture-secret`, { headers }))
        .status,
    ).toBe(404);
    expect(
      (
        await fetch(`${status.url}/v1/sessions/fixture-private-id/snapshot?token=fixture-secret`, {
          headers,
        })
      ).status,
    ).toBe(404);
    expect((await fetch(`${status.url}/fixture-private-url`, { headers })).status).toBe(404);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const calls = vi.mocked(recordRuntimeWarning).mock.calls;
    expect(calls.map((call) => call[2])).toEqual([
      { operation: "GET /session", status: 401, code: "HTTP_401" },
      { operation: "GET /session/:id", status: 404, code: "HTTP_404" },
      { operation: "GET /v1/sessions/:id/snapshot", status: 404, code: "HTTP_404" },
      { operation: "GET unknown", status: 404, code: "HTTP_404" },
    ]);
    expect(JSON.stringify(calls)).not.toContain("fixture-private");
    expect(JSON.stringify(calls)).not.toContain(status.token);
    expect(recordRuntimeError).not.toHaveBeenCalled();
  });

  it("records server failures once without copying malformed body or exception text", async () => {
    const service = fixture();
    const status = await service.start("127.0.0.1", 0);
    const response = await fetch(`${status.url}/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${status.token}`, "Content-Type": "application/json" },
      body: '{"private_input":"fixture-secret",',
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(recordRuntimeError).toHaveBeenCalledTimes(1);
    expect(recordRuntimeError).toHaveBeenCalledWith(
      "local-api.request",
      "Local API request failed unexpectedly.",
      { operation: "POST /session", status: 500, code: "LOCAL_API_EXCEPTION" },
    );
    expect(JSON.stringify(vi.mocked(recordRuntimeError).mock.calls)).not.toContain(
      "fixture-secret",
    );
    expect(recordRuntimeWarning).not.toHaveBeenCalled();
  });

  it("records handled v1 5xx and successful HTTP office validation failures", async () => {
    const service = fixture();
    service.setRuntimeService({} as RuntimeService);
    service.setDeveloperHandlers({
      taskClaims: () => ({ httpStatus: 503, json: { error: "fixture-private-claim" } }),
      officeReceipts: () => ({
        httpStatus: 201,
        json: {
          receipt: { status: "blocked", stages: { package: "blocked" } },
          visualBatch: { pages: ["fixture-private-image"] },
        },
      }),
    });
    const status = await service.start("127.0.0.1", 0);
    const headers = { Authorization: `Bearer ${status.token}` };
    expect((await fetch(`${status.url}/v1/tasks/claims`, { headers })).status).toBe(503);
    expect(
      (await fetch(`${status.url}/v1/office/receipts`, { method: "POST", headers })).status,
    ).toBe(201);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(recordRuntimeError).toHaveBeenCalledWith(
      "local-api.response",
      "Local API request returned an unsuccessful HTTP status.",
      { operation: "GET /v1/tasks/claims", status: 503, code: "HTTP_503" },
    );
    expect(recordRuntimeWarning).toHaveBeenCalledWith(
      "local-api.result",
      "Interface operation returned an unsuccessful result.",
      { operation: "POST /v1/office/receipts", code: "OFFICE_DELIVERY_BLOCKED" },
    );
    const calls = [
      ...vi.mocked(recordRuntimeError).mock.calls,
      ...vi.mocked(recordRuntimeWarning).mock.calls,
    ];
    expect(JSON.stringify(calls)).not.toContain("fixture-private");
  });

  it("keeps the legacy SSE stream subscribed until client close without reporting normal close", async () => {
    const service = fixture();
    const status = await service.start("127.0.0.1", 0);
    const response = await fetch(`${status.url}/event`, {
      headers: { Authorization: `Bearer ${status.token}` },
    });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) throw new Error("Expected an SSE reader.");
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("server.connected");
    service.recordEvent({ type: "fixture-event" } as unknown as ChatStreamEvent);
    const event = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Legacy SSE did not deliver the event.")), 2000),
      ),
    ]);
    expect(new TextDecoder().decode(event.value)).toContain("fixture-event");
    await reader.cancel();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(recordRuntimeError).not.toHaveBeenCalled();
    expect(recordRuntimeWarning).not.toHaveBeenCalled();
  });

  it("logs an unexpected live SSE write failure and cleans up the subscription", () => {
    const service = fixture();
    const request = Object.assign(new EventEmitter(), { headers: {}, aborted: false });
    let failWrite = false;
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      writeHead: vi.fn(),
      write: vi.fn(() => {
        if (failWrite) throw new Error("fixture private event payload");
        return true;
      }),
      end: vi.fn(function (this: { writableEnded: boolean }) {
        this.writableEnded = true;
      }),
      destroy: vi.fn(function (this: { destroyed: boolean }) {
        this.destroyed = true;
      }),
    });
    const unsubscribe = vi.fn();
    let listener: ((event: unknown, sessionId: string, runId: string) => void) | undefined;
    const runtime = {
      subscribe: vi.fn((callback: typeof listener) => {
        listener = callback;
        return unsubscribe;
      }),
      listEvents: vi.fn(() => ({ events: [], hasMore: false, cursor: 0 })),
    } as unknown as RuntimeService;
    const internal = service as unknown as {
      openRuntimeEventStream(
        request: IncomingMessage,
        response: ServerResponse,
        url: URL,
        runtime: RuntimeService,
      ): void;
    };
    internal.openRuntimeEventStream(
      request as unknown as IncomingMessage,
      response as unknown as ServerResponse,
      new URL("http://127.0.0.1/v1/events"),
      runtime,
    );
    expect(listener).toBeDefined();
    failWrite = true;
    listener?.({ eventId: null }, "session", "run");
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(response.destroyed).toBe(true);
    expect(recordRuntimeError).toHaveBeenCalledWith(
      "local-api.runtime-events",
      "Runtime event stream failed.",
      { operation: "GET /v1/events", code: "LOCAL_API_STREAM_FAILED" },
    );
    expect(JSON.stringify(vi.mocked(recordRuntimeError).mock.calls)).not.toContain(
      "fixture private",
    );
  });
});
