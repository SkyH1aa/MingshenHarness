import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import type { MemoryBackend } from "../../shared/project-memory";
import { AgentProfileService } from "../agents/agent-profile-service";
import {
  canonicalProjectMemoryRoot,
  commitProjectMemoryBackend,
  projectMemoryBackend,
  projectMemoryBackendKey,
} from "../agents/project-memory-config";
import { ApprovalBroker } from "../permissions/approval-broker";
import { PermissionStore } from "../permissions/permission-store";
import { QuestionBroker } from "../permissions/question-broker";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ChatService } from "./chat-service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(backend: MemoryBackend) {
  const temporary = await mkdtemp(join(tmpdir(), "mingshen-memory-route-"));
  const root = canonicalProjectMemoryRoot(temporary);
  const database = openDatabase(":memory:");
  const repository = new Repository(database);
  new AgentProfileService(repository);
  repository.setSetting("desktop.locale", "en");
  commitProjectMemoryBackend(repository, root, backend);
  const input = {
    title: "Memory route",
    providerId: null,
    modelId: null,
    agentProfileId: "primary",
    workspacePath: root,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "full_access" as const,
    executionMode: "host" as const,
    patchOnly: false,
  };
  const session = repository.insertSession(input);
  const questionBroker = new QuestionBroker();
  const controller = new AbortController();
  cleanups.push(async () => {
    controller.abort();
    questionBroker.cancelSession(session.id);
    database.close();
    await rm(temporary, { recursive: true, force: true });
  });
  const chat = new ChatService({
    repository,
    permissions: new PermissionStore(),
    approvalBroker: new ApprovalBroker(),
    questionBroker,
    customToolService: { has: async () => false },
    emit: vi.fn(),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    memoryRoots: Map<string, string>;
    executeToolCall(input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      toolCall: { index: number; callId: string; name: string; arguments: string };
      onEffectStart?: () => void;
    }): Promise<{ output: string; isError: boolean }>;
  };
  internal.memoryRoots.set("run", root);
  const memory = backend === "native" ? chat.projectMemory : chat.tencentMemory;
  const id = await memory.add(root, "memory", "Keep independent retries isolated.", "decision");
  const files =
    backend === "native"
      ? [
          join(root, ".harness-memory", "preferences.md"),
          join(root, ".harness-memory", "memory.md"),
        ]
      : [join(root, ".harness-tencent-memory", "records.jsonl")];
  const snapshot = () => Promise.all(files.map((file) => readFile(file, "utf8")));
  return {
    root,
    input,
    session,
    repository,
    questionBroker,
    controller,
    chat,
    internal,
    memory,
    id,
    snapshot,
  };
}

describe("project memory routing boundaries", () => {
  it.each([
    { backend: "native" as const, action: "preference" },
    { backend: "native" as const, action: "forget" },
    { backend: "tencentdb" as const, action: "preference" },
    { backend: "tencentdb" as const, action: "forget" },
  ])(
    "does not $action in $backend after memory is disabled during confirmation",
    async ({ backend, action }) => {
      const f = await fixture(backend);
      const before = await f.snapshot();
      const effect = vi.fn();
      const pending = f.internal.executeToolCall({
        session: f.session,
        runId: "run",
        signal: f.controller.signal,
        toolCall: {
          index: 0,
          callId: "memory",
          name: "memory_write",
          arguments: JSON.stringify({
            action,
            content: action === "forget" ? f.id : "Use typed project fixtures.",
          }),
        },
        onEffectStart: effect,
      });
      void pending.catch(() => undefined);
      await vi.waitFor(() => expect(f.questionBroker.list()).toHaveLength(1));
      await f.chat.setProjectMemoryEnabled(f.session.id, false);
      f.questionBroker.answer({
        questionId: f.questionBroker.list()[0]?.id as string,
        answers: [{ id: "memory-confirm", selectedOptions: ["Confirm"], otherText: "" }],
      });
      expect(await pending).toMatchObject({
        isError: true,
        output: "Project memory is disabled or unavailable.",
      });
      expect(effect).not.toHaveBeenCalled();
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it.each(["native", "tencentdb"] as const)(
    "saves a confirmed preference when %s memory stays enabled",
    async (backend) => {
      const f = await fixture(backend);
      const effect = vi.fn();
      const pending = f.internal.executeToolCall({
        session: f.session,
        runId: "run",
        signal: f.controller.signal,
        toolCall: {
          index: 0,
          callId: "memory",
          name: "memory_write",
          arguments: JSON.stringify({
            action: "preference",
            content: "Use typed project fixtures.",
          }),
        },
        onEffectStart: effect,
      });
      void pending.catch(() => undefined);
      await vi.waitFor(() => expect(f.questionBroker.list()).toHaveLength(1));
      f.questionBroker.answer({
        questionId: f.questionBroker.list()[0]?.id as string,
        answers: [{ id: "memory-confirm", selectedOptions: ["Confirm"], otherText: "" }],
      });
      expect(await pending).toMatchObject({ isError: false });
      expect(effect).toHaveBeenCalledOnce();
      expect(await f.memory.preferences(f.root)).toContain("Use typed project fixtures.");
    },
  );

  it.each(["native", "tencentdb"] as const)(
    "rejects an orphan child record before reading its own %s memory",
    async (backend) => {
      const f = await fixture(backend);
      const nativeView = vi.spyOn(f.chat.projectMemory, "view");
      const tencentView = vi.spyOn(f.chat.tencentMemory, "view");
      expect(() =>
        f.repository.insertSession({
          ...f.input,
          title: "Orphan",
          parentSessionId: "missing-parent",
        }),
      ).toThrow("父会话不存在。");
      expect(nativeView).not.toHaveBeenCalled();
      expect(tencentView).not.toHaveBeenCalled();
    },
  );

  it.each(["native", "tencentdb"] as const)(
    "resolves %s memory to the main project's root across child workspaces",
    async (backend) => {
      const f = await fixture(backend);
      const worktree = join(f.root, "worktree");
      await mkdir(worktree);
      const child = f.repository.insertSession({
        ...f.input,
        title: "Child",
        workspacePath: worktree,
        parentSessionId: f.session.id,
      });
      const grandchild = f.repository.insertSession({
        ...f.input,
        title: "Grandchild",
        workspacePath: join(worktree, "nested"),
        parentSessionId: child.id,
      });
      const before = await f.snapshot();
      const view = await f.chat.getProjectMemory(grandchild.id);
      expect(view.backend).toBe(backend);
      expect(view.root).toBe(
        join(f.root, backend === "native" ? ".harness-memory" : ".harness-tencent-memory"),
      );
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it.each(["native", "tencentdb"] as const)(
    "fixes an inherited %s backend before forking a child into an independent project chat",
    async (backend) => {
      const f = await fixture(backend);
      const worktree = join(f.root, "worktree");
      await mkdir(worktree);
      const child = f.repository.insertSession({
        ...f.input,
        title: "Child",
        workspacePath: worktree,
        parentSessionId: f.session.id,
      });
      expect(f.repository.getSetting(projectMemoryBackendKey(worktree))).toBeNull();
      const before = await f.snapshot();
      const fork = f.chat.forkSession(child.id);
      expect(fork).toMatchObject({ workspacePath: worktree, parentSessionId: null });
      expect(f.repository.getSetting(projectMemoryBackendKey(worktree))).toMatchObject({
        backend,
      });
      f.repository.removeSession(child.id);
      f.repository.removeSession(f.session.id);
      expect(projectMemoryBackend(f.repository, worktree)).toBe(backend);
      expect(await f.snapshot()).toEqual(before);
      for (const name of [".harness-memory", ".harness-tencent-memory"])
        await expect(access(join(worktree, name))).rejects.toThrow("ENOENT");
    },
  );

  it.each(["native", "tencentdb"] as const)(
    "does not fork a %s project whose memory directories conflict",
    async (backend) => {
      const f = await fixture(backend);
      await mkdir(
        join(f.root, backend === "native" ? ".harness-tencent-memory" : ".harness-memory"),
      );
      const before = f.repository.listSessions();
      expect(() => f.chat.forkSession(f.session.id)).toThrow("both memory backends");
      expect(f.repository.listSessions()).toEqual(before);
    },
  );
});
