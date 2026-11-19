import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent, ModelReference, SessionView } from "../../shared/domain";
import type { MemoryBackend, ProjectMemoryConfigurationInput } from "../../shared/project-memory";
import {
  commitProjectMemoryBackend,
  projectMemoryBackendKey,
  setProjectMemoryConfiguration,
} from "../agents/project-memory-config";
import { MEMORY_TOOL_DESCRIPTORS } from "../agents/project-memory-service";
import * as runtimeLog from "../diagnostics/runtime-log";
import { ApprovalBroker } from "../permissions/approval-broker";
import { PermissionStore } from "../permissions/permission-store";
import { QuestionBroker } from "../permissions/question-broker";
import type { StreamToolDefinition } from "../providers/model-stream";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ToolRegistry } from "../tools/tool-registry";
import { ChatService } from "./chat-service";
import { TOOL_CHAIN_DESCRIPTOR } from "./tool-chain";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const sse = (...events: unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
const tool = (name: string, args: unknown, id = "call") =>
  sse(
    {
      type: "response.output_item.added",
      item: { type: "function_call", call_id: id, name, arguments: JSON.stringify(args) },
    },
    { type: "response.completed" },
  );
const answer = (text = "Done") =>
  sse({ type: "response.output_text.delta", delta: text }, { type: "response.completed" });
interface ModelRequest {
  model: string;
  instructions: string;
  input: Array<{ role: string; content: string }>;
  tools?: unknown[];
}
const requestBody = (init?: RequestInit) => JSON.parse(String(init?.body)) as ModelRequest;
const memoryStage = (body: ModelRequest) =>
  body.instructions.includes("情境切分与记忆提取专家")
    ? "extract"
    : body.instructions.includes("记忆冲突检测器")
      ? "dedup"
      : "chat";
const memoryInput = (body: ModelRequest) => body.input.map((item) => item.content).join("\n");
const memoryExtraction = (body: ModelRequest, content?: string) => {
  const ids = [...memoryInput(body).matchAll(/^\[([^\]]+)\] \[(?:user|assistant)\] /gm)].map(
    (match) => match[1],
  );
  return answer(
    JSON.stringify([
      {
        scene_name: "The user is migrating project cache snapshots.",
        message_ids: ids,
        memories: content
          ? [
              {
                content,
                type: "episodic",
                priority: 80,
                source_message_ids: ids,
                metadata: {},
              },
            ]
          : [],
      },
    ]),
  );
};
const memoryDedup = (body: ModelRequest, action: "store" | "skip") =>
  answer(
    JSON.stringify(
      [...memoryInput(body).matchAll(/^### 第 \d+ 条新记忆 \(record_id: (m_[\w-]+)\)/gm)].map(
        (match) => ({ record_id: match[1], action, target_ids: [] }),
      ),
    ),
  );
const twoSteps = (guard = "ready") => ({
  steps: [
    { id: "inspect", tool: "read_file", arguments: { path: "a.txt" } },
    {
      id: "next",
      tool: "read_file",
      arguments: { path: "b.txt" },
      after: ["inspect"],
      when: { step: "inspect", contains: guard },
    },
  ],
});
async function fixture(backend: MemoryBackend = "native") {
  const root = await mkdtemp(join(tmpdir(), "mingshen-decision-memory-"));
  const db = openDatabase(":memory:");
  const repository = new Repository(db);
  commitProjectMemoryBackend(repository, root, backend);
  const provider = repository.insertProvider({
    name: "Local fixture",
    baseUrl: "https://fixture.invalid/v1",
    protocol: "openai_responses",
    authMode: "bearer",
    customHeaderName: null,
  });
  repository.insertModel({
    providerId: provider.id,
    modelId: "fixture",
    displayName: "Fixture",
    contextWindow: 128000,
    maxOutputTokens: 2048,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: true,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const model = repository.getProvider(provider.id)?.models[0];
  if (!model) throw new Error("Missing fixture model");
  const profile = repository.saveAgentProfile({
    id: "fixture-main",
    name: "Fixture",
    description: "Local test",
    role: "primary",
    instructions: "",
    modelId: null,
    readOnly: false,
    enabled: true,
  });
  const session = repository.insertSession({
    title: "Fixture",
    providerId: provider.id,
    modelId: model.id,
    workspacePath: root,
    agentProfileId: profile.id,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
  });
  const events: ChatStreamEvent[] = [];
  const broker = new ApprovalBroker();
  const questions = new QuestionBroker();
  const registry = new ToolRegistry();
  const getActiveApiKey = vi.fn((_providerId: string) => "local-fixture");
  const chat = new ChatService({
    repository,
    toolRegistry: registry,
    permissions: new PermissionStore(),
    approvalBroker: broker,
    questionBroker: questions,
    providerService: { getActiveApiKey },
    mcpService: { list: () => [] },
    dockerService: { getImage: () => null },
    customToolService: { has: async () => false },
    emit: (event: ChatStreamEvent) => events.push(event),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    availableTools: () => Promise<StreamToolDefinition[]>;
    buildSystemPrompt: () => Promise<string>;
    runPluginHooks: () => Promise<void>;
    runVerification: () => Promise<string>;
    runPostEditChecks: () => Promise<string>;
    memoryRoots: Map<string, string>;
    memoryPrompt(session: SessionView, run: string): Promise<string>;
    executeToolCall(input: object): Promise<{ output: string; isError: boolean }>;
    executeRun(input: object): Promise<void>;
  };
  internal.availableTools = async () => [
    ...registry.descriptors(),
    TOOL_CHAIN_DESCRIPTOR,
    ...MEMORY_TOOL_DESCRIPTORS,
  ];
  internal.buildSystemPrompt = async () => "Local fixture";
  internal.runPluginHooks = async () => undefined;
  internal.runVerification = async () => "";
  internal.runPostEditChecks = async () => "";
  const controller = new AbortController();
  await chat.setProjectMemoryEnabled(session.id, false);
  await writeFile(join(root, "a.txt"), "ready");
  await writeFile(join(root, "b.txt"), "next result");
  cleanups.push(async () => {
    controller.abort();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    repository,
    provider,
    model,
    session,
    events,
    chat,
    internal,
    controller,
    broker,
    questions,
    getActiveApiKey,
    setMemoryConfiguration: (input: ProjectMemoryConfigurationInput) => {
      chat.assertProjectMemoryConfigurable(input.workspacePath);
      return setProjectMemoryConfiguration(repository, input, (id) => chat.isSessionBusy(id));
    },
    run: () =>
      internal.executeRun({
        session: repository.getSession(session.id),
        provider,
        model,
        runId: "fixture-run",
        signal: controller.signal,
        generateTitle: false,
      }),
  };
}

function analysisModel(f: Awaited<ReturnType<typeof fixture>>, name: string): ModelReference {
  const provider = f.repository.insertProvider({
    name,
    baseUrl: `https://${name}.invalid/v1`,
    protocol: "openai_responses",
    authMode: "bearer",
    customHeaderName: null,
  });
  f.repository.insertModel({
    ...f.model,
    providerId: provider.id,
    modelId: name,
    displayName: name,
  });
  const model = f.repository.getProvider(provider.id)?.models[0];
  if (!model) throw new Error("Missing analysis model");
  return { providerId: provider.id, modelId: model.id };
}

describe("decision reuse runtime", () => {
  it("returns rendered Work pages to the model when write receipts use absolute workspace paths", async () => {
    const f = await fixture();
    f.repository.updateSession(f.session.id, { agentMode: "work" });
    f.model.inputModalities.push("image");
    const invocations: Array<{ name: string; args: Record<string, unknown> }> = [];
    f.internal.executeToolCall = async (raw) => {
      const input = raw as { toolCall: { name: string; arguments: string } };
      const { name } = input.toolCall;
      const args = JSON.parse(input.toolCall.arguments) as Record<string, unknown>;
      invocations.push({ name, args });
      if (name === "read_document")
        return {
          output: "Rendered page 1",
          isError: false,
          images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,AQID" }],
        };
      const preview = args.operation === "verify";
      return {
        output: preview ? "Microsoft Office verified; PDF exported." : "Workbook created.",
        isError: false,
        fileChanges: [
          {
            path: join(f.root, String(preview ? args.render_path : args.path)),
            changeType: "created" as const,
            additions: 0,
            deletions: 0,
          },
        ],
      };
    };
    const requests: ModelRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        requests.push(requestBody(init));
        return requests.length === 1
          ? tool("office_document", { operation: "create_spreadsheet", path: "budget.xlsx" })
          : answer();
      }),
    );
    await f.run();
    expect(invocations.map((call) => call.name)).toEqual([
      "office_document",
      "office_document",
      "read_document",
    ]);
    expect(invocations[1]?.args).toMatchObject({
      operation: "verify",
      path: "budget.xlsx",
      render_path: "budget.xlsx.preview-fixture-.pdf",
      overwrite: true,
    });
    expect(invocations[2]?.args).toMatchObject({
      path: "budget.xlsx.preview-fixture-.pdf",
      render: true,
    });
    const results = f.repository
      .getMessages(f.session.id)
      .flatMap((message) => message.parts.filter((part) => part.type === "tool_result"));
    expect(results.at(-1)?.images).toHaveLength(1);
    expect(JSON.stringify(requests.at(-1)?.input)).toContain("input_image");
    expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
  });

  it("executes two real reads in order with no model callback between them, preserving paired history", async () => {
    const f = await fixture();
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(String(init.body)));
        return bodies.length === 1 ? tool("execute_tool_chain", twoSteps()) : answer();
      }),
    );
    await f.run();
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toContain("ready");
    expect(JSON.stringify(bodies[1])).toContain("next result");
    const parts = f.repository.getMessages(f.session.id).flatMap((message) => message.parts);
    const calls = parts.filter((part) => part.type === "tool_call");
    const results = parts.filter((part) => part.type === "tool_result");
    expect(calls.map((part) => part.name)).toEqual([
      "execute_tool_chain",
      "read_file",
      "read_file",
    ]);
    expect(results.map((part) => part.callId)).toEqual(calls.map((part) => part.callId));
    expect(f.chat.workbench.state(f.session.id).checkpoint?.uncertainTools).toEqual([]);
    expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
  });

  it.each(["missing", "refused"])(
    "stops before the second action when the first receipt is %s",
    async (reason) => {
      const f = await fixture();
      let count = 0;
      if (reason === "refused") {
        const original = f.internal.executeToolCall.bind(f.internal);
        f.internal.executeToolCall = async (input) =>
          (input as { toolCall: { name: string } }).toolCall.name === "read_file"
            ? { output: "User refused this operation.", isError: true }
            : original(input);
      }
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          ++count === 1 ? tool("execute_tool_chain", twoSteps("missing")) : answer(),
        ),
      );
      await f.run();
      const calls = f.repository
        .getMessages(f.session.id)
        .flatMap((message) => message.parts.filter((part) => part.type === "tool_call"));
      expect(calls.map((part) => part.name)).toEqual(["execute_tool_chain", "read_file"]);
      expect(count).toBe(2);
    },
  );

  it("does not cross cancellation or a concurrently changed plan", async () => {
    for (const mode of ["cancel", "plan"] as const) {
      const f = await fixture();
      const original = f.internal.executeToolCall.bind(f.internal);
      f.internal.executeToolCall = async (input) => {
        const result = await original(input);
        if ((input as { toolCall: { name: string } }).toolCall.name === "read_file") {
          if (mode === "cancel") f.controller.abort();
          else
            f.chat.workbench.update({
              sessionId: f.session.id,
              revision: 0,
              paused: false,
              steps: [
                {
                  id: "user-step",
                  content: "Changed by user",
                  status: "pending",
                  priority: "medium",
                  updatedAt: new Date().toISOString(),
                },
              ],
            });
        }
        return result;
      };
      let count = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => (++count === 1 ? tool("execute_tool_chain", twoSteps()) : answer())),
      );
      await f.run();
      const reads = f.repository
        .getMessages(f.session.id)
        .flatMap((message) =>
          message.parts.filter((part) => part.type === "tool_call" && part.name === "read_file"),
        );
      expect(reads).toHaveLength(1);
      expect(count).toBe(mode === "cancel" ? 1 : 2);
    }
  });

  it("returns to the model on real edit diagnostics instead of executing the next cached action", async () => {
    const f = await fixture();
    f.internal.runPostEditChecks = async () => "TS2322: a new diagnostic";
    let count = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ++count === 1
          ? tool("execute_tool_chain", {
              steps: [
                {
                  id: "edit",
                  tool: "write_file",
                  arguments: { path: "note.txt", content: "changed" },
                },
                { id: "next", tool: "read_file", arguments: { path: "b.txt" }, after: ["edit"] },
              ],
            })
          : answer(),
      ),
    );
    await f.run();
    expect(await readFile(join(f.root, "note.txt"), "utf8")).toBe("changed");
    const calls = f.repository
      .getMessages(f.session.id)
      .flatMap((message) => message.parts.filter((part) => part.type === "tool_call"));
    expect(calls.map((part) => part.name)).toEqual(["execute_tool_chain", "write_file"]);
    expect(count).toBe(2);
  });

  it("waits for the real approval broker and a denial never starts either file action", async () => {
    const f = await fixture();
    f.repository.updateSession(f.session.id, { permissionMode: "request_approval" });
    let count = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++count === 1 ? tool("execute_tool_chain", twoSteps()) : answer())),
    );
    const pending = f.run();
    await vi.waitFor(() => expect(f.broker.state().requests).toHaveLength(1));
    const request = f.broker.state().requests[0];
    if (!request) throw new Error("Expected approval");
    expect(request.toolName).toBe("read_file");
    f.broker.decide({ approvalId: request.id, decision: "deny" });
    await pending;
    const results = f.repository
      .getMessages(f.session.id)
      .flatMap((message) => message.parts.filter((part) => part.type === "tool_result"));
    expect(results).toHaveLength(2);
    expect(results[1]?.isError).toBe(true);
    expect(f.broker.state().requests).toEqual([]);
    expect(count).toBe(2);
  });

  it("charges each cached action against the tool budget instead of allowing a fresh tool round", async () => {
    const f = await fixture();
    const profile = f.repository.getAgentProfile(f.session.agentProfileId);
    if (!profile) throw new Error("Missing default profile");
    f.repository.saveAgentProfile({ ...profile, maxSteps: 2 });
    let count = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ++count === 1
          ? tool("execute_tool_chain", twoSteps())
          : tool("read_file", { path: "a.txt" }, "too-many"),
      ),
    );
    await f.run();
    const reads = f.repository
      .getMessages(f.session.id)
      .flatMap((message) => message.parts.filter((part) => part.type === "tool_result"));
    expect(reads).toHaveLength(3);
    expect(count).toBe(2);
    expect(f.events.some((event) => event.type === "run_failed")).toBe(true);
  });

  it("allows final prose at the exact cached-action limit", async () => {
    const f = await fixture();
    const profile = f.repository.getAgentProfile(f.session.agentProfileId);
    if (!profile) throw new Error("Missing profile");
    f.repository.saveAgentProfile({ ...profile, maxSteps: 2 });
    let count = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++count === 1 ? tool("execute_tool_chain", twoSteps()) : answer())),
    );
    await f.run();
    expect(count).toBe(2);
    expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
  });
});

describe("memory runtime", () => {
  it("uses the current chat model for Tencent semantic extraction and deduplication, preserving preferences and duplicate bytes", async () => {
    const f = await fixture("tencentdb");
    await f.chat.setProjectMemoryEnabled(f.session.id, true);
    await f.chat.tencentMemory.add(
      f.root,
      "preferences",
      "Use TypeScript for project scripts.",
      "explicit-user-preference",
    );
    const user = f.repository.appendMessage({
      sessionId: f.session.id,
      role: "user",
      parts: [{ type: "text", text: "Migrate the cache snapshot format." }],
    });
    const result =
      "Cache snapshots are written atomically to local disk and verified before reuse.";
    const fact = "The user chose atomic local cache snapshots with validation before reuse.";
    const requests: ModelRequest[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = requestBody(init);
      requests.push(body);
      switch (memoryStage(body)) {
        case "extract":
          return memoryExtraction(body, fact);
        case "dedup":
          return memoryDedup(body, "skip");
        default:
          return answer(result);
      }
    });
    vi.stubGlobal("fetch", fetch);
    await f.run();
    expect(requests.map(memoryStage)).toEqual(["chat", "extract"]);
    expect(f.getActiveApiKey.mock.calls).toEqual([[f.provider.id], [f.provider.id]]);
    expect(requests[1]?.model).toBe(f.model.modelId);
    expect(requests[1]?.tools ?? []).toEqual([]);
    const prompt = memoryInput(requests[1] as ModelRequest);
    expect(prompt).toContain(`[${user.id}] [user]`);
    expect(prompt).toContain("Migrate the cache snapshot format.");
    expect(prompt).toContain(result);
    const assistant = f.repository
      .getMessages(f.session.id)
      .findLast((message) => message.role === "assistant");
    expect(prompt).toContain(`[${assistant?.id}] [assistant]`);
    const path = join(f.root, ".harness-tencent-memory", "records.jsonl");
    const first = await readFile(path, "utf8");
    const records = first
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.some((record) => record.type === "episodic" && record.content === fact)).toBe(
      true,
    );
    expect(first).not.toContain(result);
    expect((await f.chat.getProjectMemory(f.session.id)).memories).toBeGreaterThan(0);
    expect(
      f.events.some(
        (event) =>
          event.type === "activity" &&
          event.activity.title === "已保存项目记忆" &&
          event.activity.detail?.includes("写入"),
      ),
    ).toBe(true);
    const preference = records.find((record) => record.type === "persona");
    await f.run();
    expect(requests.map(memoryStage)).toEqual(["chat", "extract", "chat", "extract", "dedup"]);
    expect(requests.every((body) => body.model === f.model.modelId)).toBe(true);
    expect(
      requests
        .filter((body) => memoryStage(body) !== "chat")
        .every((body) => (body.tools ?? []).length === 0),
    ).toBe(true);
    expect(f.getActiveApiKey).toHaveBeenCalledTimes(5);
    expect(await readFile(path, "utf8")).toBe(first);
    expect(
      JSON.parse((await f.chat.getProjectMemory(f.session.id)).documents.preferences)[0],
    ).toMatchObject({ id: preference.id, content: preference.content });
    expect(
      f.events.findLast(
        (event) => event.type === "activity" && event.activity.toolName === "project_memory",
      ),
    ).toMatchObject({ activity: { title: "项目记忆无新增", status: "completed" } });
    expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
  });

  it.each([
    {
      question: "What is the difference between a stack and a queue?",
      result: "A stack removes the most recently added item; a queue removes the oldest item.",
      emptyArray: false,
    },
    {
      question: "Find the earlier project memory about local cache validation.",
      result: "The requested memory was retrieved. No new project decision was made.",
      emptyArray: false,
    },
    { question: "Continue.", result: "Done.", emptyArray: true },
  ])(
    "treats valid empty Tencent analysis as successful without trying the backup: $question",
    async ({ question, result, emptyArray }) => {
      const f = await fixture("tencentdb");
      await f.chat.setProjectMemoryEnabled(f.session.id, true);
      const fallbackModel = analysisModel(f, "memory-backup");
      await f.setMemoryConfiguration({
        workspacePath: f.root,
        backend: "tencentdb",
        analysisModel: null,
        fallbackModel,
      });
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "user",
        parts: [{ type: "text", text: question }],
      });
      const requests: ModelRequest[] = [];
      const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = requestBody(init);
        requests.push(body);
        if (memoryStage(body) === "chat") return answer(result);
        return emptyArray ? answer("[]") : memoryExtraction(body);
      });
      vi.stubGlobal("fetch", fetch);
      await f.run();
      expect(requests.map(memoryStage)).toEqual(["chat", "extract"]);
      expect(requests.map((body) => body.model)).toEqual([f.model.modelId, f.model.modelId]);
      expect(f.getActiveApiKey.mock.calls).toEqual([[f.provider.id], [f.provider.id]]);
      expect((await f.chat.getProjectMemory(f.session.id)).memories).toBe(0);
      expect(
        f.events.findLast(
          (event) => event.type === "activity" && event.activity.toolName === "project_memory",
        ),
      ).toMatchObject({
        activity: { title: "项目记忆无新增", status: "completed" },
      });
      expect(
        f.events.some(
          (event) => event.type === "activity" && event.activity.title === "已保存项目记忆",
        ),
      ).toBe(false);
      expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    },
  );

  it("lets Tencent semantic analysis decide explicit preferences without writing them during preparation", async () => {
    const f = await fixture("tencentdb");
    await f.chat.setProjectMemoryEnabled(f.session.id, true);
    const path = join(f.root, ".harness-tencent-memory", "records.jsonl");
    const before = await readFile(path, "utf8");
    f.repository.appendMessage({
      sessionId: f.session.id,
      role: "user",
      parts: [{ type: "text", text: "From now on, use TypeScript for all project scripts." }],
    });
    const requests: ModelRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = requestBody(init);
        requests.push(body);
        expect(await readFile(path, "utf8")).toBe(before);
        return memoryStage(body) === "chat" ? answer("Acknowledged.") : memoryExtraction(body);
      }),
    );
    await f.run();
    expect(requests.map(memoryStage)).toEqual(["chat", "extract"]);
    expect((await f.chat.getProjectMemory(f.session.id)).preferences).toBe(0);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
  });

  it.each(["child", "read-only profile"] as const)(
    "keeps Tencent automatic maintenance read-only for a %s",
    async (mode) => {
      const f = await fixture("tencentdb");
      await f.chat.setProjectMemoryEnabled(f.session.id, true);
      await f.chat.tencentMemory.add(f.root, "preferences", "Use typed project scripts.");
      const path = join(f.root, ".harness-tencent-memory", "records.jsonl");
      const before = await readFile(path, "utf8");
      let session = f.session;
      if (mode === "child")
        session = f.repository.insertSession({
          ...f.session,
          title: "Read-only child memory",
          parentSessionId: f.session.id,
        });
      else {
        const profile = f.repository.getAgentProfile(f.session.agentProfileId);
        if (!profile) throw new Error("Missing fixture profile");
        f.repository.saveAgentProfile({ ...profile, readOnly: true });
      }
      f.repository.appendMessage({
        sessionId: session.id,
        role: "user",
        parts: [{ type: "text", text: "Review the project's atomic cache snapshots." }],
      });
      const requests: ModelRequest[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init?: RequestInit) => {
          const body = requestBody(init);
          requests.push(body);
          return answer("The project uses atomic cache snapshots and validates them before reuse.");
        }),
      );
      await f.internal.executeRun({
        session,
        provider: f.provider,
        model: f.model,
        runId: "read-only-memory-run",
        signal: f.controller.signal,
        generateTitle: false,
      });
      expect(requests.map(memoryStage)).toEqual(["chat"]);
      expect(await readFile(path, "utf8")).toBe(before);
      expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
    },
  );

  it("routes an explicit Tencent analysis model to its provider without using a successful backup", async () => {
    const f = await fixture("tencentdb");
    await f.chat.setProjectMemoryEnabled(f.session.id, true);
    const primary = analysisModel(f, "memory-primary");
    const backup = analysisModel(f, "memory-backup");
    await f.setMemoryConfiguration({
      workspacePath: f.root,
      backend: "tencentdb",
      analysisModel: primary,
      fallbackModel: backup,
    });
    f.repository.appendMessage({
      sessionId: f.session.id,
      role: "user",
      parts: [{ type: "text", text: "Use atomic local cache snapshots for this project." }],
    });
    const requests: Array<{ url: string; body: ModelRequest; key: string | null }> = [];
    f.getActiveApiKey.mockImplementation((providerId: string) => `fixture-${providerId}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const body = requestBody(init);
        requests.push({
          url: String(url),
          body,
          key: new Headers(init?.headers).get("authorization"),
        });
        return memoryStage(body) === "chat"
          ? answer("The project now uses atomic local cache snapshots.")
          : memoryExtraction(body, "The user selected atomic local snapshots for project caches.");
      }),
    );
    await f.run();
    expect(requests.map(({ body }) => body.model)).toEqual(["fixture", "memory-primary"]);
    expect(requests[1]?.url).toBe("https://memory-primary.invalid/v1/responses");
    expect(requests[1]?.key).toBe(`Bearer fixture-${primary.providerId}`);
    expect(requests[1]?.body.tools ?? []).toEqual([]);
    expect(f.getActiveApiKey.mock.calls).toEqual([[f.provider.id], [primary.providerId]]);
    expect((await f.chat.getProjectMemory(f.session.id)).memories).toBe(1);
    expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
  });

  it.each(["default primary", "deleted primary"] as const)(
    "uses the configured backup when the %s cannot analyze Tencent memory",
    async (mode) => {
      const f = await fixture("tencentdb");
      await f.chat.setProjectMemoryEnabled(f.session.id, true);
      const primary = mode === "deleted primary" ? analysisModel(f, "memory-primary") : null;
      const backup = analysisModel(f, "memory-backup");
      await f.setMemoryConfiguration({
        workspacePath: f.root,
        backend: "tencentdb",
        analysisModel: primary,
        fallbackModel: backup,
      });
      if (primary) f.repository.removeModel(primary.modelId);
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "user",
        parts: [{ type: "text", text: "Migrate project caches to atomic validated snapshots." }],
      });
      const requests: ModelRequest[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init?: RequestInit) => {
          const body = requestBody(init);
          requests.push(body);
          if (memoryStage(body) === "chat")
            return answer("Project caches now use validated atomic snapshots.");
          if (body.model === "fixture")
            return new Response("Fixture default analysis unavailable.", { status: 403 });
          return memoryExtraction(
            body,
            "The user migrated project caches to validated atomic snapshots.",
          );
        }),
      );
      await f.run();
      expect(requests.map((body) => body.model)).toEqual(
        primary ? ["fixture", "memory-backup"] : ["fixture", "fixture", "memory-backup"],
      );
      expect((await f.chat.getProjectMemory(f.session.id)).memories).toBe(1);
      expect(f.getActiveApiKey).toHaveBeenLastCalledWith(backup.providerId);
      expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    },
  );

  it.each(["transport", "malformed"] as const)(
    "reruns Tencent analysis once with the configured backup after a %s primary failure",
    async (failure) => {
      const recordError = vi.spyOn(runtimeLog, "recordRuntimeError");
      const f = await fixture("tencentdb");
      await f.chat.setProjectMemoryEnabled(f.session.id, true);
      const primary = analysisModel(f, "memory-primary");
      const backup = analysisModel(f, "memory-backup");
      await f.setMemoryConfiguration({
        workspacePath: f.root,
        backend: "tencentdb",
        analysisModel: primary,
        fallbackModel: backup,
      });
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "user",
        parts: [{ type: "text", text: "Migrate the cache snapshot format." }],
      });
      const requests: ModelRequest[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init?: RequestInit) => {
          const body = requestBody(init);
          requests.push(body);
          if (memoryStage(body) === "chat")
            return answer("The cache migration completed with atomic snapshots and validation.");
          if (body.model === "memory-primary")
            return failure === "transport"
              ? new Response("Fixture analysis unavailable.", { status: 403 })
              : answer("This response has no extraction JSON.");
          return memoryExtraction(
            body,
            "The user migrated project caches to validated atomic snapshots.",
          );
        }),
      );
      await f.run();
      expect(requests.map((body) => body.model)).toEqual([
        "fixture",
        "memory-primary",
        "memory-backup",
      ]);
      expect(requests.map(memoryStage)).toEqual(["chat", "extract", "extract"]);
      expect(memoryInput(requests[2] as ModelRequest)).toBe(
        memoryInput(requests[1] as ModelRequest),
      );
      expect(requests[2]?.instructions).toBe(requests[1]?.instructions);
      expect(f.getActiveApiKey.mock.calls).toEqual([
        [f.provider.id],
        [primary.providerId],
        [backup.providerId],
      ]);
      expect(recordError).toHaveBeenCalledWith("memory.analysis", expect.any(Error), {
        sessionId: f.session.id,
        runId: "fixture-run",
        providerId: primary.providerId,
        modelId: primary.modelId,
        operation: "primary",
        attempt: 1,
      });
      expect((await f.chat.getProjectMemory(f.session.id)).memories).toBe(1);
      expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
      expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    },
  );

  it("starts the backup from the original round after deduplication fails without publishing primary records", async () => {
    const f = await fixture("tencentdb");
    await f.chat.setProjectMemoryEnabled(f.session.id, true);
    const primary = analysisModel(f, "memory-primary");
    const backup = analysisModel(f, "memory-backup");
    await f.setMemoryConfiguration({
      workspacePath: f.root,
      backend: "tencentdb",
      analysisModel: primary,
      fallbackModel: backup,
    });
    const existing = "The user selected atomic local cache snapshots for the project.";
    await f.chat.tencentMemory.add(f.root, "memory", existing);
    await f.chat.tencentMemory.add(f.root, "preferences", "Use typed project scripts.");
    const path = join(f.root, ".harness-tencent-memory", "records.jsonl");
    const before = await readFile(path, "utf8");
    f.repository.appendMessage({
      sessionId: f.session.id,
      role: "user",
      parts: [{ type: "text", text: "Validate the atomic cache snapshots." }],
    });
    const primaryFact =
      "The user completed atomic local cache snapshot validation for the project.";
    const backupFact =
      "The user confirmed atomic local cache snapshots must be validated before reuse.";
    const requests: ModelRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = requestBody(init);
        requests.push(body);
        if (memoryStage(body) === "chat") return answer("Atomic cache snapshot validation passed.");
        if (body.model === "memory-primary")
          return memoryStage(body) === "extract"
            ? memoryExtraction(body, primaryFact)
            : answer("Invalid deduplication JSON.");
        expect(await readFile(path, "utf8")).toBe(before);
        return memoryStage(body) === "extract"
          ? memoryExtraction(body, backupFact)
          : memoryDedup(body, "store");
      }),
    );
    await f.run();
    expect(requests.map((body) => [body.model, memoryStage(body)])).toEqual([
      ["fixture", "chat"],
      ["memory-primary", "extract"],
      ["memory-primary", "dedup"],
      ["memory-backup", "extract"],
      ["memory-backup", "dedup"],
    ]);
    expect(memoryInput(requests[3] as ModelRequest)).toBe(memoryInput(requests[1] as ModelRequest));
    const after = await readFile(path, "utf8");
    expect(after).toContain(backupFact);
    expect(after).not.toContain(primaryFact);
    const originalRecords = before.trim().split("\n");
    for (const record of originalRecords) expect(after.split("\n")).toContain(record);
    expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
  });

  it("keeps both Tencent analysis failures local and disabling memory suppresses maintenance", async () => {
    const f = await fixture("tencentdb");
    await f.chat.setProjectMemoryEnabled(f.session.id, true);
    const primary = analysisModel(f, "memory-primary");
    const backup = analysisModel(f, "memory-backup");
    await f.setMemoryConfiguration({
      workspacePath: f.root,
      backend: "tencentdb",
      analysisModel: primary,
      fallbackModel: backup,
    });
    const path = join(f.root, ".harness-tencent-memory", "records.jsonl");
    const before = await readFile(path, "utf8");
    f.repository.appendMessage({
      sessionId: f.session.id,
      role: "user",
      parts: [{ type: "text", text: "Migrate the cache snapshot format." }],
    });
    const requests: ModelRequest[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = requestBody(init);
      requests.push(body);
      return memoryStage(body) === "chat"
        ? answer("Cache snapshot migration completed.")
        : new Response("Fixture analysis unavailable.", { status: 403 });
    });
    vi.stubGlobal("fetch", fetch);
    await f.run();
    expect(requests.map((body) => body.model)).toEqual([
      "fixture",
      "memory-primary",
      "memory-backup",
    ]);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(
      f.events.some(
        (event) =>
          event.type === "activity" &&
          event.activity.title === "项目记忆未保存" &&
          event.activity.status === "failed",
      ),
    ).toBe(true);
    expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
    expect(f.events.some((event) => event.type === "run_failed")).toBe(false);
    await f.chat.setProjectMemoryEnabled(f.session.id, false);
    await f.run();
    expect(requests.map((body) => body.model)).toEqual([
      "fixture",
      "memory-primary",
      "memory-backup",
      "fixture",
    ]);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it.each(["cancel", "disable", "configuration"] as const)(
    "does not save or try the backup after %s while Tencent analysis is pending",
    async (change) => {
      const f = await fixture("tencentdb");
      await f.chat.setProjectMemoryEnabled(f.session.id, true);
      const primary = analysisModel(f, "memory-primary");
      const backup = analysisModel(f, "memory-backup");
      await f.setMemoryConfiguration({
        workspacePath: f.root,
        backend: "tencentdb",
        analysisModel: primary,
        fallbackModel: backup,
      });
      await f.chat.tencentMemory.add(
        f.root,
        "memory",
        "The user selected atomic local cache snapshots for the project.",
      );
      const path = join(f.root, ".harness-tencent-memory", "records.jsonl");
      const before = await readFile(path, "utf8");
      f.repository.appendMessage({
        sessionId: f.session.id,
        role: "user",
        parts: [{ type: "text", text: "Validate the atomic cache snapshots." }],
      });
      let release: () => void = () => undefined;
      const pendingAnalysis = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requests: ModelRequest[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init?: RequestInit) => {
          const body = requestBody(init);
          requests.push(body);
          if (memoryStage(body) === "chat")
            return answer("Atomic cache snapshot validation passed.");
          await pendingAnalysis;
          return memoryExtraction(
            body,
            "The user completed atomic local cache snapshot validation.",
          );
        }),
      );
      const pending = f.run();
      try {
        await vi.waitFor(() =>
          expect(requests.map((body) => body.model)).toEqual(["fixture", "memory-primary"]),
        );
        if (change === "cancel") f.controller.abort();
        else if (change === "disable") await f.chat.setProjectMemoryEnabled(f.session.id, false);
        else {
          const key = projectMemoryBackendKey(f.root);
          const configuration = f.repository.getSetting(key) as Record<string, unknown>;
          f.repository.setSetting(key, {
            ...configuration,
            analysisModel: backup,
            fallbackModel: null,
          });
        }
      } finally {
        release();
        await pending;
      }
      expect(requests.map((body) => body.model)).toEqual(["fixture", "memory-primary"]);
      expect(await readFile(path, "utf8")).toBe(before);
      expect(
        f.events.some(
          (event) => event.type === "activity" && event.activity.title === "已保存项目记忆",
        ),
      ).toBe(false);
    },
  );

  it("loads preferences alone, redacts manually edited secrets and immediately respects the project switch", async () => {
    const f = await fixture();
    await f.chat.setProjectMemoryEnabled(f.session.id, true);
    await f.chat.projectMemory.add(f.root, "memory", "Only load this payment history on demand.");
    await writeFile(
      join(f.root, ".harness-memory", "preferences.md"),
      "# Preferences\n\nUse TypeScript. api_key=private-fixture-value",
    );
    f.internal.memoryRoots.set("r", f.root);
    const prompt = await f.internal.memoryPrompt(f.session, "r");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("[REDACTED]");
    expect(prompt).not.toContain("private-fixture-value");
    expect(prompt).not.toContain("Only load this payment history");
    await f.chat.setProjectMemoryEnabled(f.session.id, false);
    expect(await f.internal.memoryPrompt(f.session, "r")).toBe("");
    await expect(f.chat.projectMemoryCommand(f.session.id, "/memory search")).rejects.toThrow(
      "keywords",
    );
    await expect(f.chat.projectMemoryCommand(f.session.id, "/memory unknown")).rejects.toThrow(
      "stats",
    );
  });

  it("saves a successful concise summary and catches malformed summaries without failing the task", async () => {
    for (const valid of [true, false]) {
      const f = await fixture();
      await f.chat.setProjectMemoryEnabled(f.session.id, true);
      const concise =
        "本次完成支付模块重试策略检查，确认断线后保留已完成操作，避免重复写入，并决定采用精简偏好与按需检索降低上下文开销，后续保留诊断和取消边界测试。";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) =>
          String(init.body).includes("[PROJECT_MEMORY_SUMMARY]")
            ? answer(valid ? concise : "too short")
            : answer("Task complete."),
        ),
      );
      await f.run();
      const view = await f.chat.getProjectMemory(f.session.id);
      expect(view.memories).toBe(valid ? 1 : 0);
      expect(f.events.some((event) => event.type === "run_completed")).toBe(true);
    }
  });

  it("enforces child read-only memory for direct tools, slash commands and settings without modifying index", async () => {
    const f = await fixture();
    await f.chat.setProjectMemoryEnabled(f.session.id, true);
    const child = f.repository.insertSession({ ...f.session, parentSessionId: f.session.id });
    f.internal.memoryRoots.set("r", f.root);
    for (const [name, args] of [
      ["memory_write", { action: "diary", content: "Child must not write." }],
      ["write_file", { path: ".harness-memory/memory.md", content: "Child must not write." }],
      [
        "apply_patch",
        { patch: "*** Begin Patch\n*** Delete File: .harness-memory/memory.md\n*** End Patch" },
      ],
    ] as const) {
      const result = await f.internal.executeToolCall({
        session: child,
        runId: "r",
        signal: f.controller.signal,
        toolCall: { index: 0, callId: name, name, arguments: JSON.stringify(args) },
      });
      expect(result.isError).toBe(true);
    }
    await expect(f.chat.projectMemoryCommand(child.id, "/remember cannot write")).rejects.toThrow(
      "main session",
    );
    await expect(f.chat.setProjectMemoryEnabled(child.id, false)).rejects.toThrow("Subagents");
    const indexPath = join(f.root, ".harness-memory", "index.md");
    await writeFile(indexPath, "# Child read-only marker\n");
    await f.chat.getProjectMemory(child.id);
    expect(await readFile(indexPath, "utf8")).toBe("# Child read-only marker\n");
    await f.chat.projectMemory.add(f.root, "memory", "Payment lesson for child read access.");
    const result = await f.internal.executeToolCall({
      session: child,
      runId: "r",
      signal: f.controller.signal,
      toolCall: {
        index: 0,
        callId: "search",
        name: "memory_search",
        arguments: JSON.stringify({ query: "Payment" }),
      },
    });
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Payment lesson");
  });

  it("asks before saving an inferred preference and preserves the user's skip decision", async () => {
    const f = await fixture();
    await f.chat.setProjectMemoryEnabled(f.session.id, true);
    let count = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        if (String(init.body).includes("[PROJECT_MEMORY_SUMMARY]")) return answer("too short");
        return ++count === 1
          ? tool("memory_write", { action: "preference", content: "Prefer Python for scripts." })
          : answer();
      }),
    );
    const pending = f.run();
    await vi.waitFor(() => expect(f.questions.list()).toHaveLength(1));
    const question = f.questions.list()[0];
    if (!question) throw new Error("Expected preference question");
    f.questions.answer({
      questionId: question.id,
      answers: [{ id: "memory-confirm", selectedOptions: ["跳过"], otherText: "" }],
    });
    await pending;
    expect((await f.chat.getProjectMemory(f.session.id)).preferences).toBe(0);
    expect(count).toBe(2);
  });
});
