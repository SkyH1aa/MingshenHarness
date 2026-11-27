import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADDITIONAL_BUILTIN_AGENTS } from "../../shared/builtin-agents";
import type { AgentProfileView, ModelConfig, SessionView } from "../../shared/domain";
import { streamModelTurn } from "../providers/model-stream";
import { listGuardedWorkspaceFiles, readGuardedFile } from "../workspace/guarded-workspace-io";
import { agentPermission, ChatService } from "./chat-service";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
vi.mock("../providers/model-stream", () => ({ streamModelTurn: vi.fn() }));
vi.mock("../workspace/guarded-workspace-io", () => ({
  listGuardedWorkspaceFiles: vi.fn(),
  readGuardedFile: vi.fn(),
}));

const session = {
  id: "session",
  title: "Project",
  parentSessionId: null,
  agentMode: "code",
  providerId: "provider",
  modelId: "model",
  workspacePath: "C:\\host-project",
  status: "idle",
  archived: false,
  executionMode: "worktree",
  agentProfileId: "coordinator",
} as SessionView;
const model = {
  id: "model",
  providerId: "provider",
  enabled: true,
  inputModalities: ["text"],
  outputModalities: ["text"],
  maxOutputTokens: 8000,
} as ModelConfig;
const proposals = {
  suggestions: [1, 2, 3].map((index) => ({
    title: `Direction ${index}`,
    summary: `A distinct and supported next direction number ${index}.`,
    rationale: `The persisted evidence supports direction number ${index}.`,
    steps: ["Inspect the relevant files", "Implement and verify the change"],
    risks: ["The implementation may overlap existing behavior."],
    verification: ["Run the relevant focused checks and inspect the output."],
  })),
};

function profile(id: string): AgentProfileView {
  const result = ADDITIONAL_BUILTIN_AGENTS.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`Missing test profile: ${id}`);
  return { ...result, modelId: null } as AgentProfileView;
}

function fixture(
  input: { permissions?: AgentProfileView["permissions"]; worktree?: string | null } = {},
) {
  const settings = new Map<string, unknown>();
  const parent = {
    ...profile("coordinator"),
    permissions: input.permissions ?? profile("coordinator").permissions,
  };
  const profiles = [parent, profile("qa"), profile("test"), profile("implementation")];
  const models = new Map<string, ModelConfig>([[model.id, model]]);
  const repository = {
    getSession: vi.fn(() => session),
    getMessages: vi.fn(() => [
      { role: "user", parts: [{ type: "text", text: "Continue the project" }] },
    ]),
    listSessionTodos: vi.fn(() => []),
    replaceSessionTodos: vi.fn(),
    getSetting: vi.fn((key: string) => settings.get(key)),
    setSetting: vi.fn((key: string, value: unknown) => settings.set(key, value)),
    getAgentProfile: vi.fn((id: string) => profiles.find((entry) => entry.id === id) ?? null),
    listAgentProfiles: vi.fn(() => profiles),
    getModel: vi.fn((id: string) => models.get(id) ?? null),
    getProvider: vi.fn((id: string) => (id === "provider" ? { id } : null)),
    listChildSessions: vi.fn(() => []),
    removeSession: vi.fn(),
  };
  const worktreeService = {
    get: vi.fn(() => (input.worktree === undefined ? "C:\\isolated-worktree" : input.worktree)),
    ensure: vi.fn(async () => "C:\\isolated-worktree"),
  };
  const chat = new ChatService({
    repository,
    providerService: { getActiveApiKey: () => "test-key" },
    worktreeService,
    approvalBroker: { cancelSession: vi.fn() },
    questionBroker: { cancelSession: vi.fn() },
    permissions: { clearSession: vi.fn() },
    emit: vi.fn(),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  return { chat, repository, worktreeService, profiles, models };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(streamModelTurn).mockImplementation(async function* () {
    yield { type: "text_delta", text: JSON.stringify(proposals) };
  });
});

describe("AutoDrive profile and worktree policy", () => {
  it("uses the effective worktree and excludes denied or approval-required paths", async () => {
    const f = fixture({
      permissions: { "read_file:private/*": "deny", "read_file:ask/*": "ask" },
    });
    vi.mocked(listGuardedWorkspaceFiles).mockResolvedValue({
      files: [
        { path: "public.ts", size: 11 },
        { path: "private\\secret.ts", size: 11 },
        { path: "ask\\review.ts", size: 11 },
      ],
      totalBytes: 33,
    });
    vi.mocked(readGuardedFile).mockResolvedValue({
      buffer: Buffer.from("public text"),
      size: 11,
      sha256: "a".repeat(64),
    });

    await f.chat.suggestAutoDrive(session.id);
    expect(f.worktreeService.get).toHaveBeenCalledWith(session.id);
    expect(f.worktreeService.ensure).not.toHaveBeenCalled();
    expect(listGuardedWorkspaceFiles).toHaveBeenCalledWith(
      "C:\\isolated-worktree",
      expect.any(Object),
      expect.any(Object),
    );
    expect(readGuardedFile).toHaveBeenCalledTimes(1);
    expect(readGuardedFile).toHaveBeenCalledWith(
      "C:\\isolated-worktree",
      "public.ts",
      11,
      expect.any(Object),
    );
    const request = vi.mocked(streamModelTurn).mock.calls[0]?.[0];
    expect(JSON.stringify(request?.messages)).not.toContain("private");
    expect(JSON.stringify(request?.messages)).not.toContain("ask/review");
    expect(request?.tools).toEqual([]);
  });

  it("does not list or read files when the profile denies reads", async () => {
    const f = fixture({ permissions: { read_file: "deny" }, worktree: "C:\\existing-worktree" });
    await f.chat.suggestAutoDrive(session.id);
    expect(f.worktreeService.ensure).not.toHaveBeenCalled();
    expect(listGuardedWorkspaceFiles).not.toHaveBeenCalled();
    expect(readGuardedFile).not.toHaveBeenCalled();
  });

  it("uses an existing worktree without creating one", async () => {
    vi.mocked(listGuardedWorkspaceFiles).mockResolvedValue({ files: [], totalBytes: 0 });
    const existing = fixture({ worktree: "C:\\existing-worktree" });
    await existing.chat.suggestAutoDrive(session.id);
    expect(existing.worktreeService.ensure).not.toHaveBeenCalled();
    expect(listGuardedWorkspaceFiles).toHaveBeenCalledWith(
      "C:\\existing-worktree",
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("rejects an unestablished worktree without creating it or requesting a model", async () => {
    const failed = fixture({ worktree: null });
    await expect(failed.chat.suggestAutoDrive(session.id)).rejects.toThrow(
      "AutoDrive requires an established worktree. Run a task in this session to establish it before retrying.",
    );
    expect(failed.worktreeService.get).toHaveBeenCalledWith(session.id);
    expect(failed.worktreeService.ensure).not.toHaveBeenCalled();
    expect(listGuardedWorkspaceFiles).not.toHaveBeenCalled();
    expect(readGuardedFile).not.toHaveBeenCalled();
    expect(streamModelTurn).not.toHaveBeenCalled();
  });

  it("continues to use the project root for host sessions", async () => {
    vi.mocked(listGuardedWorkspaceFiles).mockResolvedValue({ files: [], totalBytes: 0 });
    const host = fixture({ worktree: null });
    host.repository.getSession.mockReturnValue({ ...session, executionMode: "host" });
    await host.chat.suggestAutoDrive(session.id);
    expect(host.worktreeService.get).not.toHaveBeenCalled();
    expect(host.worktreeService.ensure).not.toHaveBeenCalled();
    expect(listGuardedWorkspaceFiles).toHaveBeenCalledWith(
      session.workspacePath,
      expect.any(Object),
      expect.any(Object),
    );
    expect(streamModelTurn).toHaveBeenCalledTimes(1);
  });

  it("rechecks policy changes before exposing a file read in progress", async () => {
    const f = fixture({ permissions: {} });
    vi.mocked(listGuardedWorkspaceFiles).mockResolvedValue({
      files: [{ path: "public.ts", size: 11 }],
      totalBytes: 11,
    });
    vi.mocked(readGuardedFile).mockImplementation(async () => {
      const parent = f.profiles.find((entry) => entry.id === "coordinator");
      if (!parent) throw new Error("Missing profile");
      parent.permissions["read_file:public.ts"] = "deny";
      return { buffer: Buffer.from("public text"), size: 11, sha256: "a".repeat(64) };
    });
    await f.chat.suggestAutoDrive(session.id);
    const request = vi.mocked(streamModelTurn).mock.calls[0]?.[0];
    expect(JSON.stringify(request?.messages)).not.toContain("public.ts");
    expect(JSON.stringify(request?.messages)).not.toContain("public text");
  });
});

describe("coordination policy", () => {
  const args = {
    goal: "Deliver the task",
    qa_criteria: "Verify the output",
    qa_agent: "qa",
    tasks: [
      { label: "Tests", task: "Add tests", agent: "test" },
      { label: "Implementation", task: "Implement", agent: "implementation" },
    ],
  };

  function start(chat: ChatService, onEffectStart = vi.fn()) {
    const internal = chat as unknown as {
      startCoordinatedAgents: (
        input: {
          session: SessionView;
          runId: string;
          signal: AbortSignal;
          onEffectStart: () => void;
        },
        args: Record<string, unknown>,
      ) => Promise<{ output: string; isError?: boolean }>;
    };
    return internal.startCoordinatedAgents(
      { session, runId: "parent-run", signal: new AbortController().signal, onEffectStart },
      args,
    );
  }

  it("lets the test engineer author tests without granting file edits to QA", () => {
    const test = profile("test");
    const qa = profile("qa");
    for (const tool of ["write_file", "replace_in_file", "apply_patch"]) {
      expect(test.toolAllowlist).toContain(tool);
      expect(agentPermission(test, tool)).toBe("ask");
      expect(qa.toolAllowlist).not.toContain(tool);
      expect(agentPermission(qa, tool)).toBe("deny");
    }
  });

  it("rejects an active second run before marking an effect", async () => {
    const f = fixture();
    f.chat.coordination.start({
      sessionId: session.id,
      runId: "first",
      goal: "Original",
      tasks: [{ id: "one", label: "Task", agentProfileId: "test", scope: "Scope" }],
      qaAgentProfileId: "qa",
      qaCriteria: "Checks",
    });
    const onEffectStart = vi.fn();
    await expect(start(f.chat, onEffectStart)).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining("COORDINATION_BUSY"),
    });
    expect(onEffectStart).not.toHaveBeenCalled();
    expect(f.chat.coordination.state(session.id)?.runId).toBe("first");
  });

  it.each(["parent", "qa", "worker"] as const)(
    "rejects an image-only %s model before starting workers",
    async (kind) => {
      const f = fixture();
      const imageOnly = {
        ...model,
        id: "image-only",
        inputModalities: ["image"],
        outputModalities: ["image"],
      } as ModelConfig;
      if (kind === "parent") f.models.set("model", { ...imageOnly, id: "model" });
      else {
        f.models.set(imageOnly.id, imageOnly);
        const target = f.profiles.find((entry) => entry.id === (kind === "qa" ? "qa" : "test"));
        if (!target) throw new Error("Missing profile");
        target.modelId = imageOnly.id;
      }
      const onEffectStart = vi.fn();
      await expect(start(f.chat, onEffectStart)).resolves.toMatchObject({
        isError: true,
        output: expect.stringContaining("COORDINATION_MODEL_UNAVAILABLE"),
      });
      expect(onEffectStart).not.toHaveBeenCalled();
      expect(f.chat.coordination.state(session.id)).toBeNull();
    },
  );
});

describe("session removal", () => {
  it("runs the terminal cleanup hook immediately before deleting the session", async () => {
    const operations: string[] = [];
    const f = fixture();
    f.repository.removeSession.mockImplementation(() => operations.push("database"));
    const options = (f.chat as unknown as { options: Record<string, unknown> }).options;
    options.snapshotService = {
      removeForSession: async () => {
        operations.push("snapshot");
      },
    };
    options.beforeSessionRemoved = async () => {
      operations.push("terminal");
    };
    await f.chat.removeSession(session.id);
    expect(operations).toEqual(["snapshot", "terminal", "database"]);
  });
});
