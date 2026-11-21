import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelConfig, ProviderView, SessionMessage, SessionView } from "../../shared/domain";
import type { SessionPlan } from "../../shared/workbench";
import { streamModelTurn } from "../providers/model-stream";
import type { RequestUsage } from "../token-saver/usage";
import { listGuardedWorkspaceFiles, readGuardedFile } from "../workspace/guarded-workspace-io";
import { AutoDriveService } from "./auto-drive-service";

vi.mock("../providers/model-stream", () => ({ streamModelTurn: vi.fn() }));
vi.mock("../workspace/guarded-workspace-io", () => ({
  listGuardedWorkspaceFiles: vi.fn(),
  readGuardedFile: vi.fn(),
}));

const session = {
  id: "session",
  title: "Feature",
  parentSessionId: null,
  agentMode: "code",
  providerId: "provider",
  modelId: "model-config",
  workspacePath: "C:\\workspace",
  status: "idle",
  archived: false,
  systemPrompt: "",
  reasoningLevel: null,
  permissionMode: "request_approval",
  executionMode: "host",
  patchOnly: false,
  agentProfileId: "primary",
  createdAt: "",
  updatedAt: "",
  lastOpenedAt: "",
  pinned: false,
} as SessionView;

const provider = {
  id: "provider",
  name: "Provider",
  baseUrl: "https://example.test",
  protocol: "openai_chat_completions",
  authMode: "bearer",
  customHeaderName: null,
  activeKeyId: "key",
  keys: [],
  models: [],
  createdAt: "",
  updatedAt: "",
} as ProviderView;

const model = {
  id: "model-config",
  providerId: "provider",
  modelId: "model",
  displayName: "Model",
  contextWindow: 100_000,
  maxOutputTokens: 8_000,
  inputModalities: ["text"],
  outputModalities: ["text"],
  toolCalls: true,
  parallelToolCalls: true,
  reasoningLevels: [],
  anthropicNoneBehavior: "disabled",
  enabled: true,
} as ModelConfig;

const plan = {
  revision: 2,
  paused: false,
  updatedAt: "",
  breakpoints: [],
  steps: [
    {
      id: "step",
      content: "Ship the feature",
      status: "completed",
      priority: "medium",
      updatedAt: "",
    },
  ],
} as SessionPlan;

const message = {
  id: "message",
  sessionId: "session",
  seq: 1,
  role: "user",
  parts: [{ type: "text", text: "Continue the project" }],
  createdAt: "",
} as SessionMessage;

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

type Options = NonNullable<ConstructorParameters<typeof AutoDriveService>[3]>;

function fixture(
  overrides: Partial<SessionView> = {},
  options: {
    useDefaultContext?: boolean;
    useDefaultRunner?: boolean;
    canReadPath?: NonNullable<Options["canReadPath"]>;
  } = {},
) {
  const settings = new Map<string, unknown>([["desktop.locale", "en"]]);
  const repository = {
    getSession: vi.fn((id: string) =>
      id === session.id ? ({ ...session, ...overrides } as SessionView) : null,
    ),
    getMessages: vi.fn(() => [message]),
    getModel: vi.fn((id: string) => (id === model.id ? model : null)),
    getProvider: vi.fn((id: string) => (id === provider.id ? provider : null)),
    getSetting: vi.fn((key: string) => settings.get(key)),
    setSetting: vi.fn((key: string, value: unknown) => settings.set(key, value)),
  };
  const runner = vi.fn(async (input: { onRequestUsage?: (usage: RequestUsage) => void }) => {
    input.onRequestUsage?.({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      completed: true,
    });
    return JSON.stringify(proposals);
  });
  const service = new AutoDriveService(
    repository,
    { getActiveApiKey: () => "secret" },
    { state: () => ({ plan, checkpoint: null }) },
    {
      ...(options.useDefaultRunner ? {} : { modelRunner: runner }),
      ...(options.useDefaultContext
        ? {}
        : {
            contextLoader: async (_session: SessionView, currentPlan: SessionPlan) => ({
              history: "USER: Continue",
              plan: currentPlan,
              fileTree: ["src/index.ts"],
              snippets: [{ path: "src/index.ts", content: "export const ready = true;" }],
            }),
          }),
      ...(options.canReadPath ? { canReadPath: options.canReadPath } : {}),
      now: () => new Date("2026-11-20T00:00:00.000Z"),
    },
  );
  return { service, repository, runner };
}

describe("AutoDriveService", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns validated proposals without writing session messages", async () => {
    const f = fixture();
    const result = await f.service.suggest("session", new AbortController().signal);
    expect(result.suggestions).toHaveLength(3);
    expect(result.generatedAt).toBe("2026-11-20T00:00:00.000Z");
    expect(f.repository.setSetting).toHaveBeenCalledWith(
      "tokenSaver.usage.session",
      expect.objectContaining({
        agent: expect.objectContaining({ requests: 1, totalTokens: 150 }),
      }),
    );
    expect(f.runner).toHaveBeenCalledWith(
      expect.objectContaining({
        provider,
        model,
        apiKey: "secret",
      }),
    );
  });

  it("rejects ChatAgent and workspace-free sessions before loading files", async () => {
    await expect(
      fixture({ agentMode: "chat" }).service.suggest("session", new AbortController().signal),
    ).rejects.toThrow("CodeAgent and WorkAgent");
    await expect(
      fixture({ workspacePath: null }).service.suggest("session", new AbortController().signal),
    ).rejects.toThrow("Select a project workspace");
  });

  it("does not read or expose paths rejected by the supplied profile policy", async () => {
    vi.mocked(listGuardedWorkspaceFiles).mockResolvedValue({
      files: [
        { path: "public.ts", size: 12 },
        { path: "private\\secrets.ts", size: 12 },
      ],
      totalBytes: 24,
    });
    vi.mocked(readGuardedFile).mockResolvedValue({
      buffer: Buffer.from("public text"),
      size: 11,
      sha256: "a".repeat(64),
    });
    const f = fixture(
      {},
      {
        useDefaultContext: true,
        canReadPath: (_session, path) => !path.startsWith("private"),
      },
    );
    await f.service.suggest("session", new AbortController().signal);
    expect(readGuardedFile).toHaveBeenCalledTimes(1);
    expect(readGuardedFile).toHaveBeenCalledWith(
      session.workspacePath,
      "public.ts",
      12,
      expect.any(Object),
    );
    expect(f.runner.mock.calls[0]?.[0]).toMatchObject({
      userPrompt: expect.not.stringContaining("private"),
    });
  });

  it("fails closed for worktree sessions without an effective-root resolver", async () => {
    const f = fixture({ executionMode: "worktree" });
    await expect(f.service.suggest("session", new AbortController().signal)).rejects.toThrow(
      "cannot resolve the session worktree",
    );
    expect(f.runner).not.toHaveBeenCalled();
  });

  it("sends no model tools even when the selected model supports tools", async () => {
    vi.mocked(streamModelTurn).mockImplementation(async function* () {
      yield { type: "text_delta", text: JSON.stringify(proposals) };
    });
    const f = fixture({}, { useDefaultRunner: true });
    await f.service.suggest("session", new AbortController().signal);
    expect(streamModelTurn).toHaveBeenCalledWith(
      expect.objectContaining({ tools: [], toolChoice: "none" }),
    );
  });

  it("rejects a model without text input", async () => {
    const f = fixture();
    f.repository.getModel.mockReturnValue({ ...model, inputModalities: ["image"] });
    await expect(f.service.suggest("session", new AbortController().signal)).rejects.toThrow(
      "unavailable for AutoDrive",
    );
    expect(f.runner).not.toHaveBeenCalled();
  });
});
