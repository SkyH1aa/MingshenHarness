import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProfileService } from "../agents/agent-profile-service";
import type { CustomCommandService } from "../agents/custom-command-service";
import type { ProjectToolingService } from "../agents/project-tooling-service";
import type { ChatService } from "../chat/chat-service";
import type { McpService } from "../mcp/mcp-service";
import { ApprovalBroker } from "../permissions/approval-broker";
import { setProjectPermission } from "../permissions/project-permissions";
import { QuestionBroker } from "../permissions/question-broker";
import { MIGRATION_RUNTIME_V11, RuntimeService } from "../runtime/runtime-service";
import { SessionService } from "../sessions/session-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { TrajectoryService } from "../trajectories/trajectory-service";
import { HeadlessServerService } from "./headless-server-service";

const temporaryDirectories: string[] = [];

function ensureRuntimeSchema(database: DatabaseSync): void {
  const table = database
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'runtime_runs'")
    .get();
  if (!table) database.exec(MIGRATION_RUNTIME_V11);
}

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("HeadlessServerService", () => {
  it("serves authenticated session APIs and local read-only shares", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-headless-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    const session = repository.insertSession({
      title: 'Headless test <img src=x onerror="alert(1)">',
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    });
    const chatService = {
      send: vi.fn().mockResolvedValue({ runId: "run" }),
      stop: vi.fn(),
      forkSession: vi.fn((sessionId: string, messageId?: string | null) =>
        repository.forkSession(sessionId, messageId),
      ),
      compactSession: vi.fn().mockReturnValue({ runId: "compact" }),
      isSessionBusy: vi.fn().mockReturnValue(false),
      setSessionPermission: vi.fn((sessionId: string, mode: "request_approval" | "full_access") => {
        const current = repository.getSession(sessionId);
        if (!current) throw new Error("Missing test session");
        setProjectPermission(repository, current, mode);
        return repository.getSession(sessionId);
      }),
      removeSession: vi.fn(async (sessionId: string) => {
        repository.removeSession(sessionId);
      }),
    } as unknown as ChatService;
    const agentProfileService = {
      list: vi.fn().mockResolvedValue([]),
    } as unknown as AgentProfileService;
    const customCommandService = {
      list: vi.fn().mockResolvedValue([]),
    } as unknown as CustomCommandService;
    const toolingService = {
      status: vi.fn().mockResolvedValue([]),
    } as unknown as ProjectToolingService;
    const mcpService = {
      list: vi.fn().mockReturnValue([]),
    } as unknown as McpService;
    const emit = vi.fn();
    const questions = new QuestionBroker();
    const service = new HeadlessServerService(
      repository,
      new SessionService(repository),
      chatService,
      agentProfileService,
      customCommandService,
      toolingService,
      mcpService,
      new TrajectoryService(repository),
      new ApprovalBroker(),
      questions,
      emit,
    );
    try {
      const status = await service.start("127.0.0.1", 0);
      expect(status.running).toBe(true);
      const health = await fetch(`${status.url}/global/health`);
      expect(await health.json()).toMatchObject({ healthy: true });

      const unauthorized = await fetch(`${status.url}/session`);
      expect(unauthorized.status).toBe(401);
      const csrf = await fetch(`${status.url}/session`, {
        headers: { Origin: "https://attacker.invalid", Authorization: `Bearer ${status.token}` },
      });
      expect(csrf.status).toBe(403);
      const rebound = await new Promise<number | undefined>((resolveRequest, reject) => {
        const request = httpRequest(
          `${status.url}/global/health`,
          { headers: { Host: "attacker.invalid" } },
          (response) => {
            response.resume();
            resolveRequest(response.statusCode);
          },
        );
        request.on("error", reject);
        request.end();
      });
      expect(rebound).toBe(403);
      const sessions = await fetch(`${status.url}/session`, {
        headers: { Authorization: `Bearer ${status.token}` },
      });
      expect(sessions.status).toBe(200);
      expect(await sessions.json()).toHaveLength(1);
      const provider = repository.insertProvider({
        name: "Headless fixture",
        baseUrl: "https://example.invalid/v1",
        protocol: "openai_responses",
        authMode: "bearer",
        customHeaderName: null,
      });
      repository.insertModel({
        providerId: provider.id,
        modelId: "headless-model",
        displayName: "Headless model",
        contextWindow: 128_000,
        maxOutputTokens: 4_096,
        inputModalities: ["text"],
        outputModalities: ["text"],
        toolCalls: true,
        parallelToolCalls: true,
        reasoningLevels: [],
        anthropicNoneBehavior: "disabled",
      });
      const modelId = repository.getProvider(provider.id)?.models[0]?.id ?? "";
      const createHeadless = (model: string, extra: Record<string, unknown> = {}) =>
        fetch(`${status.url}/session`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${status.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "Headless created session",
            providerId: provider.id,
            modelId: model,
            workspacePath: root,
            ...extra,
          }),
        });
      const invalidCreation = await createHeadless("missing-model");
      expect(invalidCreation.status).toBe(400);
      expect(await invalidCreation.json()).toMatchObject({
        error: expect.stringContaining("模型配置不存在"),
      });
      expect(repository.listSessions()).toHaveLength(1);
      for (const field of ["parentSessionId", "forkedFromMessageId"]) {
        const derivedCreation = await createHeadless(modelId, {
          [field]: "existing-session-or-message",
        });
        expect(derivedCreation.status).toBe(400);
        expect(await derivedCreation.json()).toMatchObject({
          error: expect.stringContaining("root sessions only"),
        });
      }
      expect(repository.listSessions()).toHaveLength(1);
      const validCreation = await createHeadless(modelId);
      expect(validCreation.status).toBe(201);
      expect(await validCreation.json()).toMatchObject({
        providerId: provider.id,
        modelId,
        workspacePath: root,
      });
      expect(repository.listSessions()).toHaveLength(2);
      const questionRequest = questions.ask(
        {
          id: "clarification",
          sessionId: session.id,
          runId: "run",
          header: "Scope",
          question: "Choose tasks",
          options: [
            { label: "Test", description: "Run tests" },
            { label: "Build", description: "Build project" },
          ],
          multiSelect: true,
          createdAt: "",
        },
        new AbortController().signal,
      );
      const answer = (value: object) =>
        fetch(`${status.url}/question/clarification`, {
          method: "POST",
          headers: { Authorization: `Bearer ${status.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        });
      expect(
        (
          await answer({
            answers: [{ id: "question_1", selectedOptions: ["Unknown"], otherText: null }],
          })
        ).status,
      ).toBe(400);
      expect(questions.list()).toHaveLength(1);
      expect(
        (
          await answer({
            answers: [
              {
                id: "question_1",
                selectedOptions: ["Test", "Build"],
                otherText: "Document results",
              },
            ],
          })
        ).status,
      ).toBe(200);
      await expect(questionRequest).resolves.toMatchObject({
        answers: [{ selectedOptions: ["Test", "Build"], otherText: "Document results" }],
      });
      expect(questions.list()).toEqual([]);
      const providers = await fetch(`${status.url}/provider`, {
        headers: { Authorization: `Bearer ${status.token}` },
      });
      expect(providers.status).toBe(200);
      const forked = await fetch(`${status.url}/session/${session.id}/fork`, {
        method: "POST",
        headers: { Authorization: `Bearer ${status.token}`, "Content-Type": "application/json" },
        body: "{}",
      });
      expect(forked.status).toBe(201);
      const forkId = ((await forked.json()) as { id: string }).id;
      expect(chatService.forkSession).toHaveBeenCalledWith(session.id, null);
      expect(repository.getSession(forkId)?.parentSessionId).toBeNull();
      const compacted = await fetch(`${status.url}/session/${session.id}/compact`, {
        method: "POST",
        headers: { Authorization: `Bearer ${status.token}` },
      });
      expect(compacted.status).toBe(202);
      expect(chatService.compactSession).toHaveBeenCalledWith(session.id);
      repository.removeSession(forkId);
      const updated = await fetch(`${status.url}/session/${session.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${status.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ permissionMode: "full_access" }),
      });
      expect(updated.status).toBe(200);
      expect(chatService.setSessionPermission).toHaveBeenCalledWith(session.id, "full_access");
      expect(((await updated.json()) as { permissionMode: string }).permissionMode).toBe(
        "full_access",
      );

      const child = repository.insertSession({
        title: "Child",
        parentSessionId: session.id,
        providerId: null,
        modelId: null,
        agentProfileId: "primary",
        workspacePath: root,
        systemPrompt: "",
        reasoningLevel: null,
        permissionMode: "request_approval",
        executionMode: "host",
        patchOnly: false,
      });
      const archive = () =>
        fetch(`${status.url}/session/${session.id}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${status.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ archived: true }),
        });
      vi.mocked(chatService.isSessionBusy).mockImplementation((id) => id === child.id);
      expect((await archive()).status).toBe(409);
      expect(repository.getSession(session.id)?.archived).toBe(false);
      vi.mocked(chatService.isSessionBusy).mockReturnValue(false);
      expect((await archive()).status).toBe(200);
      expect(repository.getSession(child.id)?.archived).toBe(true);

      const shared = service.share(session.id);
      const page = await fetch(shared.url);
      expect(page.status).toBe(200);
      expect(page.headers.get("x-frame-options")).toBe("DENY");
      expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      const html = await page.text();
      expect(html).toContain("Headless test");
      expect(html).toContain("&lt;img");
      expect(html).not.toContain('<img src=x onerror="alert(1)">');
      const deleted = await fetch(`${status.url}/session/${session.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${status.token}` },
      });
      expect(deleted.status).toBe(200);
      expect(chatService.removeSession).toHaveBeenCalledExactlyOnceWith(session.id);
      expect(repository.getSession(session.id)).toBeNull();
    } finally {
      await service.stop();
      database.close();
    }
  });
  it("refuses non-loopback bindings", async () => {
    const service = new HeadlessServerService(
      {} as Repository,
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
    await expect(service.start("0.0.0.0", 4096)).rejects.toThrow("127.0.0.1");
  });

  it("serves idempotent v1 turns, runtime snapshots, resumable events and developer status", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-headless-v1-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    ensureRuntimeSchema(database);
    const repository = new Repository(database);
    const session = repository.insertSession({
      title: "Runtime v1",
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    });
    const runtime = new RuntimeService(database, repository);
    const chatService = {
      send: vi.fn(
        async (input: {
          sessionId: string;
          text: string;
          requestParts?: unknown;
          idempotencyKey: string;
        }) => {
          const accepted = runtime.admitTurn({
            sessionId: input.sessionId,
            idempotencyKey: input.idempotencyKey,
            requestHash: createHash("sha256")
              .update(
                JSON.stringify({
                  text: input.text,
                  requestParts: input.requestParts ?? null,
                }),
              )
              .digest("hex"),
            source: "local-api-v1",
          });
          return { runId: accepted.runId };
        },
      ),
      stop: vi.fn(),
      isSessionBusy: vi.fn().mockReturnValue(false),
    } as unknown as ChatService;
    const service = new HeadlessServerService(
      repository,
      new SessionService(repository),
      chatService,
      { list: vi.fn().mockResolvedValue([]) } as unknown as AgentProfileService,
      { list: vi.fn().mockResolvedValue([]) } as unknown as CustomCommandService,
      { status: vi.fn().mockResolvedValue([]) } as unknown as ProjectToolingService,
      { list: vi.fn().mockReturnValue([]) } as unknown as McpService,
      new TrajectoryService(repository),
      new ApprovalBroker(),
      new QuestionBroker(),
    );
    service.setRuntimeService(runtime);
    service.setRunCanceller(() => true);
    const accessChecks: Array<{
      method: string;
      path: string;
      operation: "dispatch" | "diagnostic";
    }> = [];
    service.setDeveloperHandlers({
      capabilities: () => ({ permissionModes: ["request_approval"] }),
      assertAccess: ({ method, path, operation }) => {
        accessChecks.push({ method, path, operation });
        return path === "/agent" ||
          (method === "GET" && path === "/v1/tasks/claims") ||
          (method === "POST" && path.startsWith("/v1/runs/"))
          ? {
              allowed: false,
              reason: "policy denied",
              revision: "policy-sha",
              policySources: [
                {
                  layer: "machine",
                  revision: "machine-sha",
                  decision: "deny",
                  reason: "machine policy denied the developer API",
                  path: "C:\\ProgramData\\MingshenHarness\\managed-policy.json",
                },
              ],
            }
          : undefined;
      },
      policyEffective: () => ({ revision: "policy-sha", tools: { shell: "deny" } }),
      taskClaims: (_request, _url, body) =>
        body.taskId
          ? { httpStatus: 201, json: { taskId: body.taskId, claimed: true } }
          : [{ taskId: "task-1" }],
      officeReceipts: () => [{ receiptId: "receipt-1", hash: "abc" }],
    });
    try {
      const status = await service.start("127.0.0.1", 0);
      const auth = { Authorization: `Bearer ${status.token}` };
      const unauthorized = await fetch(`${status.url}/v1/capabilities`);
      expect(unauthorized.status).toBe(401);
      const unauthenticatedDoc = await fetch(`${status.url}/doc`);
      expect(unauthenticatedDoc.status).toBe(401);
      const authenticatedDoc = await fetch(`${status.url}/doc`, { headers: auth });
      expect(authenticatedDoc.status).toBe(200);
      const policyDeniedLegacy = await fetch(`${status.url}/agent`, { headers: auth });
      expect(policyDeniedLegacy.status).toBe(403);
      expect(await policyDeniedLegacy.json()).toMatchObject({
        code: "DEVELOPER_API_DENIED",
        policyRevision: "policy-sha",
        policySources: [
          {
            layer: "machine",
            revision: "machine-sha",
            decision: "deny",
          },
        ],
      });

      const capabilities = await fetch(`${status.url}/v1/capabilities`, { headers: auth });
      expect(await capabilities.json()).toMatchObject({
        apiVersion: "v1",
        runtimeEvents: true,
        eventReplay: true,
        idempotentTurns: true,
        policy: true,
        taskClaims: true,
        officeReceipts: true,
        permissionModes: ["request_approval"],
      });
      expect(accessChecks).toContainEqual({
        method: "GET",
        path: "/v1/capabilities",
        operation: "diagnostic",
      });
      expect(accessChecks).toContainEqual({
        method: "GET",
        path: "/doc",
        operation: "dispatch",
      });
      const unknownPath = `/v1/sessions/${session.id}/not-a-safe-diagnostic`;
      const unknown = await fetch(`${status.url}${unknownPath}`, { headers: auth });
      expect(unknown.status).toBe(404);
      expect(accessChecks.at(-1)).toEqual({
        method: "GET",
        path: unknownPath,
        operation: "dispatch",
      });

      const turnsUrl = `${status.url}/v1/sessions/${session.id}/turns`;
      const missingKey = await fetch(turnsUrl, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "prepare the task" }),
      });
      expect(missingKey.status).toBe(400);

      const sendTurn = () =>
        fetch(turnsUrl, {
          method: "POST",
          headers: {
            ...auth,
            "Content-Type": "application/json",
            "Idempotency-Key": "v1-turn-1",
          },
          body: JSON.stringify({ text: "prepare the task" }),
        });
      const first = await sendTurn();
      expect(first.status).toBe(202);
      const firstBody = (await first.json()) as { runId: string };
      const duplicate = await sendTurn();
      expect(duplicate.status).toBe(202);
      expect(await duplicate.json()).toMatchObject({ runId: firstBody.runId });
      const conflicting = await fetch(turnsUrl, {
        method: "POST",
        headers: {
          ...auth,
          "Content-Type": "application/json",
          "Idempotency-Key": "v1-turn-1",
        },
        body: JSON.stringify({ text: "a different request" }),
      });
      expect(conflicting.status).toBe(409);
      expect(await conflicting.json()).toMatchObject({
        code: "IDEMPOTENCY_CONFLICT",
      });
      const cancel = await fetch(`${status.url}/v1/runs/${firstBody.runId}/cancel`, {
        method: "POST",
        headers: auth,
        body: "{}",
      });
      expect(cancel.status).toBe(202);
      expect(await cancel.json()).toMatchObject({
        accepted: true,
        stopRequested: true,
        cancellationConfirmed: false,
      });

      runtime.recordEvent({
        type: "run_started",
        sessionId: session.id,
        runId: firstBody.runId,
      });
      runtime.recordEvent({
        type: "run_completed",
        sessionId: session.id,
        runId: firstBody.runId,
      });
      const run = await fetch(`${status.url}/v1/runs/${firstBody.runId}`, { headers: auth });
      expect(await run.json()).toMatchObject({
        runId: firstBody.runId,
        status: "completed",
      });
      const snapshot = await fetch(`${status.url}/v1/sessions/${session.id}/snapshot`, {
        headers: auth,
      });
      const snapshotBody = (await snapshot.json()) as {
        eventCursor: number;
        runs: Array<{ runId: string }>;
      };
      expect(snapshotBody.eventCursor).toBeGreaterThan(0);
      expect(snapshotBody.runs.some((entry) => entry.runId === firstBody.runId)).toBe(true);
      const replay = await fetch(
        `${status.url}/v1/events?after=0&sessionId=${session.id}&follow=false`,
        { headers: auth },
      );
      expect(replay.status).toBe(200);
      const replayText = await replay.text();
      expect(replayText).toContain("event: runtime");
      expect(replayText).toContain(firstBody.runId);
      expect(replayText).toContain("id:");
      const replayFromHeader = await fetch(
        `${status.url}/v1/events?after=9007199254740991&sessionId=${session.id}&follow=false`,
        {
          headers: {
            ...auth,
            "Last-Event-ID": "0",
          },
        },
      );
      expect(replayFromHeader.status).toBe(200);
      expect(await replayFromHeader.text()).toContain(firstBody.runId);
      const expiredCursor = await fetch(
        `${status.url}/v1/events?after=9007199254740991&sessionId=${session.id}`,
        { headers: auth },
      );
      expect(expiredCursor.status).toBe(410);
      expect(await expiredCursor.json()).toMatchObject({
        code: "CURSOR_EXPIRED",
        snapshotRequired: true,
      });

      const originalSubscribe = runtime.subscribe.bind(runtime);
      let injectedEventId = 0;
      let livePersistentEventId = 0;
      const subscribeSpy = vi.spyOn(runtime, "subscribe").mockImplementation((listener) => {
        injectedEventId =
          runtime.recordEvent({
            type: "usage",
            sessionId: session.id,
            runId: firstBody.runId,
            inputTokens: 77,
            outputTokens: 0,
            totalTokens: 77,
          }).eventId ?? 0;
        return originalSubscribe(listener);
      });
      const followController = new AbortController();
      try {
        const followed = await fetch(
          `${status.url}/v1/events?after=${snapshotBody.eventCursor}&sessionId=${session.id}`,
          { headers: auth, signal: followController.signal },
        );
        expect(followed.status).toBe(200);
        expect(followed.body).not.toBeNull();
        const transient = runtime.recordEvent({
          type: "assistant_delta",
          sessionId: session.id,
          runId: firstBody.runId,
          text: "live transient without a persisted cursor",
        });
        const transientReasoning = runtime.recordEvent({
          type: "reasoning_delta",
          sessionId: session.id,
          runId: firstBody.runId,
          text: "live reasoning without a persisted cursor",
        });
        const livePersistent = runtime.recordEvent({
          type: "usage",
          sessionId: session.id,
          runId: firstBody.runId,
          inputTokens: 88,
          outputTokens: 0,
          totalTokens: 88,
        });
        livePersistentEventId = livePersistent.eventId ?? 0;
        expect(transient.eventId).toBeNull();
        expect(transientReasoning.eventId).toBeNull();
        expect(livePersistent.eventId).toBeGreaterThan(0);
        const reader = followed.body?.getReader();
        if (!reader) throw new Error("Expected an SSE response body.");
        let followedText = "";
        const abortTimer = setTimeout(() => followController.abort(), 250);
        try {
          while (!followedText.includes(`id: ${livePersistent.eventId}`)) {
            const { value, done } = await reader.read();
            if (done) break;
            followedText += new TextDecoder().decode(value, { stream: true });
          }
        } catch (error) {
          if (!followController.signal.aborted) throw error;
        } finally {
          clearTimeout(abortTimer);
        }
        expect(injectedEventId).toBeGreaterThan(0);
        expect(followedText).toContain(`id: ${injectedEventId}`);
        expect(followedText.match(new RegExp(`id: ${injectedEventId}\\b`, "g"))).toHaveLength(1);
        expect(followedText).toContain("live transient without a persisted cursor");
        expect(followedText).toContain("live reasoning without a persisted cursor");
        expect(followedText).not.toContain("id: null");
        expect(
          followedText.match(new RegExp(`id: ${livePersistent.eventId}\\b`, "g")),
        ).toHaveLength(1);
      } finally {
        followController.abort();
        subscribeSpy.mockRestore();
      }
      const transientReplay = await fetch(
        `${status.url}/v1/events?after=${livePersistentEventId}&sessionId=${session.id}&follow=false`,
        { headers: auth },
      );
      expect(transientReplay.status).toBe(200);
      const transientReplayText = await transientReplay.text();
      expect(transientReplayText).not.toContain("live transient without a persisted cursor");
      expect(transientReplayText).not.toContain("live reasoning without a persisted cursor");

      const bulkStartCursor = runtime.listEvents({ sessionId: session.id }).cursor;
      let lastBulkEventId = 0;
      for (let index = 0; index < 2_005; index += 1) {
        lastBulkEventId =
          runtime.recordEvent({
            type: "usage",
            sessionId: session.id,
            runId: firstBody.runId,
            inputTokens: index,
            outputTokens: 0,
            totalTokens: index,
          }).eventId ?? 0;
      }
      const bulkReplay = await fetch(
        `${status.url}/v1/events?after=${bulkStartCursor}&sessionId=${session.id}&follow=false`,
        { headers: auth },
      );
      expect(bulkReplay.status).toBe(200);
      const bulkReplayText = await bulkReplay.text();
      const replayIds = [...bulkReplayText.matchAll(/^id: (\d+)$/gm)].map((match) =>
        Number(match[1]),
      );
      expect(replayIds).toHaveLength(2_005);
      expect(replayIds.at(-1)).toBe(lastBulkEventId);

      const policy = await fetch(`${status.url}/v1/policy/effective?sessionId=${session.id}`, {
        headers: auth,
      });
      expect(await policy.json()).toMatchObject({ revision: "policy-sha" });
      expect(accessChecks).toContainEqual({
        method: "GET",
        path: "/v1/policy/effective",
        operation: "diagnostic",
      });
      const claims = await fetch(`${status.url}/v1/tasks/claims`, { headers: auth });
      expect(claims.status).toBe(403);
      expect(await claims.json()).toMatchObject({
        code: "DEVELOPER_API_DENIED",
        error: "policy denied",
      });
      const claim = await fetch(`${status.url}/v1/tasks/claims`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-2" }),
      });
      expect(claim.status).toBe(201);
      expect(await claim.json()).toMatchObject({ taskId: "task-2", claimed: true });
      const receipts = await fetch(`${status.url}/v1/office/receipts?sessionId=${session.id}`, {
        headers: auth,
      });
      expect(receipts.status).toBe(200);
      expect(accessChecks).toContainEqual({
        method: "GET",
        path: "/v1/office/receipts",
        operation: "diagnostic",
      });
      expect(await receipts.json()).toMatchObject([{ receiptId: "receipt-1" }]);

      const lingering = await fetch(`${status.url}/v1/events?after=${snapshotBody.eventCursor}`, {
        headers: auth,
      });
      expect(lingering.status).toBe(200);
      const lingeringReader = lingering.body?.getReader();
      if (!lingeringReader) throw new Error("Expected a persistent SSE response body.");
      await lingeringReader.read();
      let stopTimeout: ReturnType<typeof setTimeout> | null = null;
      const stopped = await Promise.race([
        service.stop().then(() => true),
        new Promise<boolean>((resolve) => {
          stopTimeout = setTimeout(() => resolve(false), 1_000);
        }),
      ]);
      if (stopTimeout) clearTimeout(stopTimeout);
      expect(stopped).toBe(true);
      let drainTimeout: ReturnType<typeof setTimeout> | null = null;
      const drained = await Promise.race([
        (async () => {
          while (true) {
            const { done } = await lingeringReader.read();
            if (done) return true;
          }
        })(),
        new Promise<boolean>((resolve) => {
          drainTimeout = setTimeout(() => resolve(false), 1_000);
        }),
      ]);
      if (drainTimeout) clearTimeout(drainTimeout);
      expect(drained).toBe(true);

      const restarted = await service.start("127.0.0.1", 0);
      expect(restarted.running).toBe(true);
      expect(restarted.token).not.toBe(status.token);
      await service.stop();
    } finally {
      await service.stop();
      database.close();
    }
  });
});
