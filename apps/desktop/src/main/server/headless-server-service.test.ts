import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProfileService } from "../agents/agent-profile-service";
import type { CustomCommandService } from "../agents/custom-command-service";
import type { ProjectToolingService } from "../agents/project-tooling-service";
import type { ChatService } from "../chat/chat-service";
import type { McpService } from "../mcp/mcp-service";
import { ApprovalBroker } from "../permissions/approval-broker";
import { setProjectPermission } from "../permissions/project-permissions";
import { QuestionBroker } from "../permissions/question-broker";
import { SessionService } from "../sessions/session-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { TrajectoryService } from "../trajectories/trajectory-service";
import { HeadlessServerService } from "./headless-server-service";

const temporaryDirectories: string[] = [];

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
});
