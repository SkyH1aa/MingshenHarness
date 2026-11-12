import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentProfileSaveInput,
  ChatStreamEvent,
  ModelConfig,
  SessionView,
} from "../../shared/domain";
import { AgentProfileService } from "../agents/agent-profile-service";
import { authorOfficeDocument } from "../documents/document-author";
import { documentAuthoringSchema } from "../documents/document-authoring-schema";
import { ApprovalBroker } from "../permissions/approval-broker";
import { AutomaticApprovalService } from "../permissions/automatic-approval-service";
import { PermissionStore } from "../permissions/permission-store";
import { QuestionBroker } from "../permissions/question-broker";
import type { StreamToolDefinition } from "../providers/model-stream";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { type ToolExecutionResult, ToolRegistry } from "../tools/tool-registry";
import type { FileLockService } from "../workspace/file-lock-service";
import type { NativeSandboxService } from "../workspace/native-sandbox-service";
import { ChatService } from "./chat-service";
import type { ExecutionSafetyService } from "./execution-safety-service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const document = (path = "report.docx", extra: Record<string, unknown> = {}) => ({
  path,
  blocks: [{ type: "paragraph", text: "Editable runtime evidence" }],
  ...extra,
});
const imageDocument = () =>
  document("illustrated.docx", {
    blocks: [{ type: "image", path: "pixel.png" }],
  });
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const model: ModelConfig = {
  id: "fixture",
  providerId: "fixture",
  modelId: "fixture",
  displayName: "Fixture",
  contextWindow: 128000,
  maxOutputTokens: 4096,
  inputModalities: ["text"],
  outputModalities: ["text"],
  toolCalls: true,
  parallelToolCalls: false,
  reasoningLevels: [],
  anthropicNoneBehavior: "disabled",
  enabled: true,
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mingshen-document-runtime-"));
  const db = openDatabase(":memory:");
  const repository = new Repository(db);
  new AgentProfileService(repository);
  const saveProfile = (overrides: Partial<AgentProfileSaveInput> = {}) =>
    repository.saveAgentProfile({
      id: "legacy-author",
      name: "Legacy author",
      description: "Fixture using the pre-authoring write_file policy.",
      role: "primary",
      instructions: "",
      modelId: null,
      enabled: true,
      readOnly: false,
      toolAllowlist: ["write_file", "read_file", "read_document", "list_files"],
      permissions: {},
      ...overrides,
    });
  const profile = saveProfile();
  const session = repository.insertSession({
    title: "Document runtime",
    providerId: null,
    modelId: null,
    agentProfileId: profile.id,
    workspacePath: root,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
  });
  const controller = new AbortController();
  const permissions = new PermissionStore();
  const broker = new ApprovalBroker();
  const questions = new QuestionBroker();
  const events: ChatStreamEvent[] = [];
  // Only the OS containment transport is substituted; policy, authoring, leases and writes
  // still execute through ChatService and the real ToolRegistry.
  const fileOperation = vi.fn(
    async (
      workspace: string,
      request: {
        operation: string;
        path: string;
        content?: string;
        expectedHash?: string;
      },
      signal: AbortSignal,
    ): Promise<string> => {
      signal.throwIfAborted();
      const target = resolve(workspace, request.path);
      if (request.operation === "read_binary") return (await readFile(target)).toString("base64");
      if (request.operation === "hash") {
        try {
          return hash(await readFile(target));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
          throw error;
        }
      }
      if (request.operation === "write_binary") {
        await writeFile(target, Buffer.from(request.content ?? "", "base64"));
        return "written";
      }
      throw new Error(`Unexpected fixture transport operation: ${request.operation}`);
    },
  );
  const registry = new ToolRegistry({ fileOperation } as unknown as NativeSandboxService);
  const execute = vi.spyOn(registry, "execute");
  const chat = new ChatService({
    repository,
    permissions,
    approvalBroker: broker,
    questionBroker: questions,
    providerService: {},
    toolRegistry: registry,
    customToolService: {
      has: async () => false,
      list: async () => [],
      descriptors: async () => [],
    },
    projectConfigService: { load: async () => ({ mcpServers: [] }) },
    mcpService: {
      list: () => [],
      syncWorkspaceConfig: async () => undefined,
      toolDefinitions: async () => [],
    },
    dockerService: { getImage: () => null },
    emit: (event: ChatStreamEvent) => events.push(event),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    availableTools(session: SessionView, model: ModelConfig): Promise<StreamToolDefinition[]>;
    executeToolCall(input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      toolCall: { name: string; arguments: string; callId: string; index: number };
    }): Promise<ToolExecutionResult>;
    fileLocks: FileLockService;
    executionSafety: ExecutionSafetyService;
    fileVersions: Map<string, Map<string, string>>;
  };
  const current = () => {
    const value = repository.getSession(session.id);
    if (!value) throw new Error("Fixture session disappeared.");
    return value;
  };
  let sequence = 0;
  const call = (
    name: string,
    args: Record<string, unknown>,
    options: { session?: SessionView; runId?: string; callId?: string } = {},
  ) =>
    internal.executeToolCall({
      session: options.session ?? current(),
      runId: options.runId ?? "runtime",
      signal: controller.signal,
      toolCall: {
        name,
        arguments: JSON.stringify(args),
        callId: options.callId ?? `document-runtime-${++sequence}`,
        index: 0,
      },
    });
  await writeFile(join(root, "pixel.png"), pixel);
  cleanups.push(async () => {
    controller.abort();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    repository,
    session,
    current,
    saveProfile,
    controller,
    permissions,
    broker,
    questions,
    events,
    registry,
    execute,
    fileOperation,
    chat,
    internal,
    call,
    tools: async () => (await internal.availableTools(current(), model)).map((tool) => tool.name),
  };
}

describe("document authoring runtime policy", () => {
  it("inherits an existing write_file allowlist and writes a real editable document", async () => {
    const f = await fixture();
    expect(await f.tools()).toContain("create_document");
    const result = await f.call("create_document", document());
    expect(result).toMatchObject({
      isError: false,
      fileChange: { path: join(f.root, "report.docx"), changeType: "created" },
    });
    expect((await readFile(join(f.root, "report.docx"))).subarray(0, 2).toString()).toBe("PK");
    expect(f.broker.state().requests).toHaveLength(0);
  });

  it.each([{ write_file: "deny" }, { "edit:report.docx": "deny" }] as const)(
    "retains an existing write or path edit denial %#",
    async (permissions) => {
      const f = await fixture();
      f.saveProfile({ permissions });
      const result = await f.call("create_document", document());
      expect(result).toMatchObject({ isError: true, output: expect.stringContaining("禁止") });
      expect(f.execute).not.toHaveBeenCalled();
      await expect(access(join(f.root, "report.docx"))).rejects.toThrow();
    },
  );

  it("lets an explicit create_document allow override inherited write denial", async () => {
    const f = await fixture();
    f.saveProfile({ permissions: { write_file: "deny", create_document: "allow" } });
    const result = await f.call("create_document", document());
    expect(result).toMatchObject({ isError: false });
    expect(f.broker.state().requests).toHaveLength(0);
  });

  it("lets an explicit create_document denial override inherited write allow", async () => {
    const f = await fixture();
    f.saveProfile({ permissions: { write_file: "allow", create_document: "deny" } });
    const result = await f.call("create_document", document());
    expect(result).toMatchObject({ isError: true, output: expect.stringContaining("禁止") });
    expect(f.execute).not.toHaveBeenCalled();
    await expect(access(join(f.root, "report.docx"))).rejects.toThrow();
  });

  it("keeps inherited write_file ask manual in full access even with automatic approval enabled", async () => {
    const f = await fixture();
    f.saveProfile({ permissions: { write_file: "ask" } });
    f.repository.setSetting(`permissions.approval.${f.session.id}`, "automatic");
    const review = vi
      .spyOn(AutomaticApprovalService.prototype, "review")
      .mockResolvedValue({ allowed: true, reason: "Fixture" });
    const pending = f.call("create_document", document());
    await vi.waitFor(() => expect(f.broker.state().requests).toHaveLength(1));
    const request = f.broker.state().requests[0];
    expect(request).toMatchObject({
      toolName: "create_document",
      pathScope: join(f.root, "report.docx"),
      manualOnly: true,
    });
    expect(review).not.toHaveBeenCalled();
    await expect(access(join(f.root, "report.docx"))).rejects.toThrow();
    f.chat.decideApproval({ approvalId: request?.id as string, decision: "allow_once" });
    expect((await pending).isError).toBe(false);
    expect(review).not.toHaveBeenCalled();
  });

  it.each([
    { toolAllowlist: ["write_file"], permissions: {} },
    { toolAllowlist: ["write_file", "read_file"], permissions: { read_file: "deny" } },
    { toolAllowlist: ["write_file", "read_file"], permissions: { "read:pixel.png": "deny" } },
  ] as const)("does not read image assets outside the profile's read policy %#", async (policy) => {
    const f = await fixture();
    f.saveProfile({
      toolAllowlist: [...policy.toolAllowlist],
      permissions: policy.permissions,
    });
    const result = await f.call("create_document", imageDocument());
    expect(result).toMatchObject({ isError: true, output: expect.stringContaining("禁止读取") });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.fileOperation).not.toHaveBeenCalled();
    await expect(access(join(f.root, "illustrated.docx"))).rejects.toThrow();
  });

  it.each([{ read_file: "ask" }, { "read:pixel.png": "ask" }] as const)(
    "requires separate manual image-read approval in full access %#",
    async (permissions) => {
      const f = await fixture();
      f.saveProfile({ permissions });
      f.repository.setSetting(`permissions.approval.${f.session.id}`, "automatic");
      const review = vi
        .spyOn(AutomaticApprovalService.prototype, "review")
        .mockResolvedValue({ allowed: true, reason: "Fixture" });
      const pending = f.call("create_document", imageDocument());
      await vi.waitFor(() => expect(f.broker.state().requests).toHaveLength(1));
      const request = f.broker.state().requests[0];
      expect(request).toMatchObject({
        toolName: "read_file",
        pathScope: join(f.root, "pixel.png"),
        manualOnly: true,
      });
      expect(review).not.toHaveBeenCalled();
      await expect(access(join(f.root, "illustrated.docx"))).rejects.toThrow();
      f.chat.decideApproval({ approvalId: request?.id as string, decision: "allow_once" });
      expect((await pending).isError).toBe(false);
      expect(review).not.toHaveBeenCalled();
      expect((await readFile(join(f.root, "illustrated.docx"))).length).toBeGreaterThan(1000);
    },
  );

  it.each(["plan", "readOnly", "patchOnly"] as const)(
    "hides and rejects document authoring under %s policy",
    async (policy) => {
      const f = await fixture();
      if (policy === "plan") {
        f.repository.updateSession(f.session.id, { agentProfileId: "plan" });
      } else if (policy === "readOnly") {
        f.saveProfile({ readOnly: true });
      } else {
        f.repository.updateSession(f.session.id, { patchOnly: true });
      }
      expect(await f.tools()).not.toContain("create_document");
      const result = await f.call("create_document", document());
      expect(result).toMatchObject({ isError: true, output: expect.stringContaining("禁止") });
      expect(f.execute).not.toHaveBeenCalled();
      await expect(access(join(f.root, "report.docx"))).rejects.toThrow();
    },
  );

  it("lets a child author ordinary documents through containment while preserving managed memory", async () => {
    const f = await fixture();
    const child = f.repository.insertSession({
      title: "Author worker",
      parentSessionId: f.session.id,
      providerId: null,
      modelId: null,
      agentProfileId: "legacy-author",
      workspacePath: f.root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
    });
    expect(
      (await f.call("create_document", document("child.docx"), { session: child })).isError,
    ).toBe(false);
    expect(
      f.fileOperation.mock.calls.some(([, request]) => request.operation === "write_binary"),
    ).toBe(true);
    const calls = f.execute.mock.calls.length;
    for (const path of [".harness-memory/private.docx", ".harness-tencent-memory/private.docx"]) {
      const result = await f.call("create_document", document(path), { session: child });
      expect(result).toMatchObject({
        isError: true,
        output: expect.stringContaining("broker-managed"),
      });
    }
    expect(f.execute).toHaveBeenCalledTimes(calls);
  });

  it("does not bypass another writer's lease to generate a document", async () => {
    const f = await fixture();
    const release = await f.internal.fileLocks.acquire(
      [join(f.root, "held.docx")],
      false,
      { sessionId: "other", runId: "other-run", label: "Original writer" },
      f.controller.signal,
      async () => false,
    );
    try {
      const pending = f.call("create_document", document("held.docx"));
      await vi.waitFor(() => expect(f.questions.list()).toHaveLength(1));
      expect(f.questions.list()[0]?.kind).toBe("file_conflict");
      expect(f.execute).not.toHaveBeenCalled();
      f.questions.answer({
        questionId: f.questions.list()[0]?.id as string,
        answers: [{ id: "writer", selectedOptions: ["保留原 Agent"], otherText: "" }],
      });
      expect(await pending).toMatchObject({
        isError: true,
        output: expect.stringContaining("Writer retained: Original writer"),
      });
      await expect(access(join(f.root, "held.docx"))).rejects.toThrow();
    } finally {
      release();
    }
  });

  it("keeps document side effects blocked until real inspection and human recovery confirmation", async () => {
    const f = await fixture();
    f.internal.executionSafety.begin(f.session.id, "recovery");
    f.internal.executionSafety.markUncertain("recovery", "unknown-write");
    const call = (name: string, args: Record<string, unknown>, callId?: string) =>
      f.call(name, args, { runId: "recovery", ...(callId ? { callId } : {}) });
    expect((await call("create_document", document())).output).toContain(
      "RECOVERY_INSPECTION_REQUIRED",
    );
    expect(f.execute).not.toHaveBeenCalled();
    expect(
      (await call("resolve_interrupted", { evidence_call_ids: ["invented"], summary: "Claim" }))
        .isError,
    ).toBe(true);
    expect(f.questions.list()).toHaveLength(0);
    await writeFile(join(f.root, "state.txt"), "Actual state inspected; no process remains.");
    expect((await call("read_file", { path: "state.txt" }, "real-inspection")).isError).toBe(false);
    expect((await call("create_document", document())).output).toContain(
      "RECOVERY_INSPECTION_REQUIRED",
    );
    const pending = call("resolve_interrupted", {
      evidence_call_ids: ["real-inspection"],
      summary: "Read the current file and confirmed that the interrupted operation has stopped.",
    });
    await vi.waitFor(() => expect(f.questions.list()).toHaveLength(1));
    f.questions.answer({
      questionId: f.questions.list()[0]?.id as string,
      answers: [{ id: "recovery", selectedOptions: ["继续执行"], otherText: "" }],
    });
    expect((await pending).isError).toBe(false);
    expect((await call("create_document", document())).isError).toBe(false);
    expect((await readFile(join(f.root, "report.docx"))).length).toBeGreaterThan(1000);
  });

  it("observes raw document bytes and preserves external edits until a successful reread", async () => {
    const f = await fixture();
    const target = join(f.root, "report.docx");
    const original = await authorOfficeDocument(
      documentAuthoringSchema.parse(document()),
      new Map(),
    );
    await writeFile(target, original);
    expect((await f.call("read_document", { path: "report.docx" })).isError).toBe(false);
    expect(f.internal.fileVersions.get("runtime")?.get(resolve(target).toLowerCase())).toBe(
      hash(original),
    );
    const external = await authorOfficeDocument(
      documentAuthoringSchema.parse(
        document("report.docx", {
          blocks: [{ type: "paragraph", text: "External user edit must be preserved." }],
        }),
      ),
      new Map(),
    );
    await writeFile(target, external);
    const pending = f.call("create_document", document("report.docx", { overwrite: true }));
    await vi.waitFor(() => expect(f.questions.list()).toHaveLength(1));
    expect(f.questions.list()[0]?.kind).toBe("file_conflict");
    f.questions.answer({
      questionId: f.questions.list()[0]?.id as string,
      answers: [{ id: "external-change", selectedOptions: ["重新读取后继续"], otherText: "" }],
    });
    expect((await pending).output).toContain("EXTERNAL_FILE_CHANGED");
    expect(await readFile(target)).toEqual(external);
    expect(
      (await f.call("create_document", document("report.docx", { overwrite: true }))).output,
    ).toContain("FRESH_READ_REQUIRED");
    expect((await f.call("read_document", { path: "report.docx" })).output).toContain(
      "External user edit",
    );
    expect(
      (await f.call("create_document", document("report.docx", { overwrite: true }))).isError,
    ).toBe(false);
    expect(await readFile(target)).not.toEqual(external);
  });
});
