import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectMemoryConfigurationInput } from "../../shared/project-memory";
import { SessionService } from "../sessions/session-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import {
  canonicalProjectMemoryRoot,
  commitProjectMemoryBackend,
  getProjectMemoryConfiguration,
  projectMemoryAnalysisModels,
  projectMemoryBackend,
  projectMemoryBackendKey,
  projectMemoryConfigurationRoot,
  projectMemorySelection,
  setProjectMemoryConfiguration,
  TENCENT_MEMORY_DIRECTORY,
  validateProjectMemoryBackend,
} from "./project-memory-config";

describe("exclusive project memory backend", () => {
  let root: string;
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;
  let service: SessionService;
  let providerId: string;
  let modelId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mingshen-memory-choice-"));
    database = openDatabase(":memory:");
    repository = new Repository(database);
    service = new SessionService(repository);
    providerId = repository.insertProvider({
      name: "Local fixture",
      baseUrl: "https://example.com/v1",
      protocol: "openai_responses",
      authMode: "bearer",
      customHeaderName: null,
    }).id;
    repository.insertModel({
      providerId,
      modelId: "fixture",
      displayName: "Fixture",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: ["low"],
      anthropicNoneBehavior: "disabled",
    });
    modelId = repository.getProvider(providerId)?.models[0]?.id as string;
  });
  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  const choice = (providerId: string, modelId: string, workspacePath: string | null) => ({
    providerId,
    modelId,
    workspacePath,
    permissionMode: "request_approval" as const,
    reasoningLevel: null,
    executionMode: "host" as const,
    patchOnly: false,
  });

  it("offers one backend for a new project and fixes the successful selection across sessions", () => {
    expect(projectMemorySelection(repository, root)).toEqual({ backend: "native", locked: false });
    const created = service.create({
      ...choice(providerId, modelId, root),
      memoryBackend: "tencentdb",
    });
    expect(projectMemorySelection(repository, root)).toEqual({
      backend: "tencentdb",
      locked: true,
    });
    const next = service.createInWorkspace(root);
    expect(next.id).not.toBe(created.id);
    expect(projectMemoryBackend(new Repository(database), root)).toBe("tencentdb");
    expect(() =>
      service.create({ ...choice(providerId, modelId, root), memoryBackend: "native" }),
    ).toThrow("already uses another");
    expect(repository.listSessions()).toHaveLength(2);
    service.remove(created.id);
    service.remove(next.id);
    expect(projectMemorySelection(repository, root)).toEqual({
      backend: "tencentdb",
      locked: true,
    });
  });

  it("preserves native memory for legacy projects including archived sessions", () => {
    const session = repository.insertSession({
      ...choice(providerId, modelId, root),
      title: "Legacy",
      agentProfileId: "primary",
      systemPrompt: "",
    });
    repository.updateSession(session.id, { archived: true });
    expect(projectMemorySelection(repository, root)).toEqual({ backend: "native", locked: true });
    expect(() =>
      service.create({ ...choice(providerId, modelId, root), memoryBackend: "tencentdb" }),
    ).toThrow("already uses another");
    expect(repository.listSettings("memory.backend.")).toEqual([]);
  });

  it("recognizes existing memory directories without initializing the other backend", async () => {
    await mkdir(join(root, ".harness-memory"));
    expect(projectMemorySelection(repository, root)).toEqual({ backend: "native", locked: true });
    expect(() => validateProjectMemoryBackend(repository, root, "tencentdb")).toThrow(
      "already uses another",
    );
    const other = join(root, "other");
    await mkdir(join(other, TENCENT_MEMORY_DIRECTORY), { recursive: true });
    expect(projectMemorySelection(repository, other)).toEqual({
      backend: "tencentdb",
      locked: true,
    });
  });

  it("fails visibly when both memory backend directories already exist", async () => {
    await mkdir(join(root, ".harness-memory"));
    await mkdir(join(root, TENCENT_MEMORY_DIRECTORY));
    expect(() => projectMemorySelection(repository, root)).toThrow("contains both memory backends");
    expect(() => service.create({ ...choice(providerId, modelId, root) })).toThrow(
      "contains both memory backends",
    );
    expect(repository.listSessions()).toHaveLength(0);
    expect(repository.listSettings("memory.backend.")).toEqual([]);
  });

  it("rejects a saved backend when only the opposite memory directory exists", async () => {
    for (const backend of ["native", "tencentdb"] as const) {
      const project = join(root, backend);
      await mkdir(project);
      commitProjectMemoryBackend(repository, project, backend);
      await mkdir(
        join(project, backend === "native" ? TENCENT_MEMORY_DIRECTORY : ".harness-memory"),
      );
      expect(() => projectMemorySelection(repository, project)).toThrow(
        "conflicts with its saved backend",
      );
      expect(() => commitProjectMemoryBackend(repository, project, backend)).toThrow(
        "conflicts with its saved backend",
      );
      expect(() => service.create({ ...choice(providerId, modelId, project) })).toThrow(
        "conflicts with its saved backend",
      );
    }
    expect(repository.listSessions()).toHaveLength(0);
  });

  it("does not override a legacy native session with a lone Tencent directory", async () => {
    repository.insertSession({
      ...choice(providerId, modelId, root),
      title: "Legacy",
      agentProfileId: "primary",
      systemPrompt: "",
    });
    await mkdir(join(root, TENCENT_MEMORY_DIRECTORY));
    expect(() => projectMemorySelection(repository, root)).toThrow(
      "conflicts with its saved backend",
    );
  });

  it("resolves trailing separators and Windows path case to one choice", async () => {
    const target = join(root, "target");
    await mkdir(target);
    service.create({ ...choice(providerId, modelId, target), memoryBackend: "tencentdb" });
    expect(projectMemoryBackend(repository, `${target}/`)).toBe("tencentdb");
    if (process.platform === "win32")
      expect(projectMemoryBackend(repository, target.toUpperCase())).toBe("tencentdb");
  });

  it("uses the native physical path result for alias identity and locking", async () => {
    const target = join(root, "target");
    const alias = join(root, "alias");
    await mkdir(target);
    service.create({ ...choice(providerId, modelId, target), memoryBackend: "tencentdb" });
    const nativeRealpath = realpathSync.native;
    const physicalPath = vi
      .spyOn(realpathSync, "native")
      .mockImplementation((path) => nativeRealpath(String(path) === alias ? target : path));
    try {
      expect(canonicalProjectMemoryRoot(alias)).toBe(canonicalProjectMemoryRoot(target));
      expect(projectMemoryBackend(repository, `${alias}/`)).toBe("tencentdb");
      expect(() => validateProjectMemoryBackend(repository, alias, "native")).toThrow(
        "already uses another",
      );
    } finally {
      physicalPath.mockRestore();
    }
  });

  it("does not persist a choice for failed creation or invalid multiple selections", () => {
    expect(() =>
      service.create({ ...choice(providerId, "missing", root), memoryBackend: "tencentdb" }),
    ).toThrow();
    expect(() =>
      service.create({
        ...choice(providerId, modelId, root),
        title: "",
        memoryBackend: "tencentdb",
      }),
    ).toThrow();
    for (const invalid of [["native", "tencentdb"], {}, "both", null, false])
      expect(() => validateProjectMemoryBackend(repository, root, invalid)).toThrow("exactly one");
    expect(repository.listSettings("memory.backend.")).toEqual([]);
    expect(repository.listSessions()).toEqual([]);
  });

  it("requires a workspace for Tencent and leaves unassigned native chats compatible", () => {
    expect(() =>
      service.create({ ...choice(providerId, modelId, null), memoryBackend: "tencentdb" }),
    ).toThrow("project directory");
    service.create(choice(providerId, modelId, null));
    expect(projectMemorySelection(repository, null)).toEqual({ backend: "native", locked: true });
    expect(repository.listSettings("memory.backend.")).toEqual([]);
  });

  it("fails visibly on an invalid saved backend rather than initializing native memory", () => {
    repository.setSetting(projectMemoryBackendKey(root), { backend: "both" });
    expect(() => projectMemoryBackend(repository, root)).toThrow("configuration is invalid");
  });

  it("inherits the parent backend for child worktrees and blocks direct directory changes", async () => {
    const parent = service.create({
      ...choice(providerId, modelId, root),
      memoryBackend: "tencentdb",
    });
    const worktree = join(root, "worktree");
    await mkdir(worktree);
    const child = repository.insertSession({
      ...choice(providerId, modelId, worktree),
      title: "Child",
      agentProfileId: "primary",
      parentSessionId: parent.id,
      systemPrompt: "",
    });
    expect(projectMemoryBackend(repository, worktree)).toBe("tencentdb");
    expect(() =>
      service.update({ sessionId: child.id, workspacePath: join(root, "elsewhere") }),
    ).toThrow("Subagents inherit");
  });

  it("preserves selection when moving to a new project and honors an existing destination", async () => {
    const source = service.create({
      ...choice(providerId, modelId, root),
      memoryBackend: "tencentdb",
    });
    const destination = join(root, "destination");
    await mkdir(destination);
    service.update({ sessionId: source.id, workspacePath: destination });
    expect(projectMemoryBackend(repository, destination)).toBe("tencentdb");
    expect(projectMemoryBackend(repository, root)).toBe("tencentdb");
    const native = join(root, "native");
    await mkdir(native);
    commitProjectMemoryBackend(repository, native, "native");
    service.update({ sessionId: source.id, workspacePath: native });
    expect(projectMemoryBackend(repository, native)).toBe("native");
    database.prepare("update sessions set status = 'running' where id = ?").run(source.id);
    expect(() => service.update({ sessionId: source.id, workspacePath: root })).toThrow("Stop");
  });

  it("rejects invalid project paths and keeps a committed backend immutable", () => {
    for (const invalid of [" ", "\0", "a".repeat(32769)])
      expect(() => canonicalProjectMemoryRoot(invalid)).toThrow("project directory");
    commitProjectMemoryBackend(repository, root, "tencentdb");
    expect(() => commitProjectMemoryBackend(repository, root, "native")).toThrow(
      "cannot be changed",
    );
    expect(projectMemoryBackend(repository, root)).toBe("tencentdb");
  });

  const configuration = (
    changes: Partial<ProjectMemoryConfigurationInput> = {},
  ): ProjectMemoryConfigurationInput => ({
    workspacePath: root,
    backend: "tencentdb",
    analysisModel: null,
    fallbackModel: null,
    ...changes,
  });

  it("configures a workspace without a session and preserves the choice on later session creation", async () => {
    expect(getProjectMemoryConfiguration(repository, root)).toEqual({
      workspacePath: canonicalProjectMemoryRoot(root),
      backend: "native",
      locked: false,
      analysisModel: null,
      fallbackModel: null,
    });
    const saved = setProjectMemoryConfiguration(repository, configuration());
    expect(saved).toEqual({
      workspacePath: canonicalProjectMemoryRoot(root),
      backend: "tencentdb",
      locked: true,
      analysisModel: null,
      fallbackModel: null,
    });
    expect(repository.listSessions()).toEqual([]);
    expect(await readdir(root)).toEqual([]);
    service.create(choice(providerId, modelId, root));
    expect(projectMemoryBackend(repository, root)).toBe("tencentdb");
    expect(() =>
      service.create({ ...choice(providerId, modelId, root), memoryBackend: "native" }),
    ).toThrow("already uses another");
  });

  it("explicitly switches a legacy native workspace while preserving both backend directories", async () => {
    service.create(choice(providerId, modelId, root));
    await mkdir(join(root, ".harness-memory"));
    await writeFile(join(root, ".harness-memory", "memory.md"), "Existing native fixture entry.");
    const native = await readFile(join(root, ".harness-memory", "memory.md"));
    expect(getProjectMemoryConfiguration(repository, root).backend).toBe("native");
    setProjectMemoryConfiguration(repository, configuration());
    expect(projectMemoryBackend(repository, root)).toBe("tencentdb");
    await mkdir(join(root, TENCENT_MEMORY_DIRECTORY));
    await writeFile(
      join(root, TENCENT_MEMORY_DIRECTORY, "records.jsonl"),
      "Tencent fixture bytes.",
    );
    const tencent = await readFile(join(root, TENCENT_MEMORY_DIRECTORY, "records.jsonl"));
    expect(projectMemorySelection(repository, root)).toEqual({
      backend: "tencentdb",
      locked: true,
    });
    commitProjectMemoryBackend(repository, root, "tencentdb");
    setProjectMemoryConfiguration(repository, configuration({ backend: "native" }));
    expect(projectMemoryBackend(repository, root)).toBe("native");
    expect(await readFile(join(root, ".harness-memory", "memory.md"))).toEqual(native);
    expect(await readFile(join(root, TENCENT_MEMORY_DIRECTORY, "records.jsonl"))).toEqual(tencent);
    expect((await readdir(root)).sort()).toEqual([".harness-memory", TENCENT_MEMORY_DIRECTORY]);
  });

  it("leaves ambiguous legacy projects blocked until an explicit settings selection resolves routing", async () => {
    await mkdir(join(root, ".harness-memory"));
    await mkdir(join(root, TENCENT_MEMORY_DIRECTORY));
    expect(() => getProjectMemoryConfiguration(repository, root)).toThrow(
      "contains both memory backends",
    );
    setProjectMemoryConfiguration(repository, configuration());
    expect(getProjectMemoryConfiguration(repository, root).backend).toBe("tencentdb");
    expect(repository.getSetting(projectMemoryBackendKey(root))).toMatchObject({
      explicitSelection: true,
      backend: "tencentdb",
    });
  });

  it("stores model configuration by physical workspace identity and retains it on backend commits", async () => {
    const primary = { providerId, modelId };
    const saved = setProjectMemoryConfiguration(
      repository,
      configuration({ analysisModel: primary }),
    );
    commitProjectMemoryBackend(repository, `${root}/`, "tencentdb");
    const persisted = getProjectMemoryConfiguration(new Repository(database), `${root}/`);
    expect(persisted).toEqual(saved);
    expect(projectMemoryAnalysisModels(repository, root)).toEqual({
      analysisModel: primary,
      fallbackModel: null,
    });
    const alias = join(root, "alias");
    const nativeRealpath = realpathSync.native;
    const physicalPath = vi
      .spyOn(realpathSync, "native")
      .mockImplementation((path) => nativeRealpath(String(path) === alias ? root : path));
    try {
      expect(getProjectMemoryConfiguration(repository, alias)).toEqual(saved);
      setProjectMemoryConfiguration(
        repository,
        configuration({ workspacePath: alias, fallbackModel: primary }),
      );
      expect(projectMemoryAnalysisModels(repository, root)).toEqual({
        analysisModel: null,
        fallbackModel: primary,
      });
      expect(repository.listSettings("memory.backend.")).toHaveLength(1);
    } finally {
      physicalPath.mockRestore();
    }
  });

  it("allows a fallback with the current-chat primary and rejects identical explicit primary and fallback", () => {
    const reference = { providerId, modelId };
    setProjectMemoryConfiguration(repository, configuration({ fallbackModel: reference }));
    expect(projectMemoryAnalysisModels(repository, root)).toEqual({
      analysisModel: null,
      fallbackModel: reference,
    });
    const before = repository.getSetting(projectMemoryBackendKey(root));
    expect(() =>
      setProjectMemoryConfiguration(
        repository,
        configuration({ analysisModel: reference, fallbackModel: reference }),
      ),
    ).toThrow("must differ");
    expect(repository.getSetting(projectMemoryBackendKey(root))).toEqual(before);
  });

  it("validates model ownership, enabled state and text capabilities without changing existing configuration", () => {
    const before = setProjectMemoryConfiguration(repository, configuration());
    for (const reference of [
      { providerId: "missing", modelId },
      { providerId, modelId: "missing" },
      { providerId, modelId: "" },
    ]) {
      expect(() =>
        setProjectMemoryConfiguration(repository, configuration({ analysisModel: reference })),
      ).toThrow();
      expect(getProjectMemoryConfiguration(repository, root)).toEqual(before);
    }
    database.prepare("update models set enabled = 0 where id = ?").run(modelId);
    expect(() =>
      setProjectMemoryConfiguration(
        repository,
        configuration({ analysisModel: { providerId, modelId } }),
      ),
    ).toThrow("disabled");
    database
      .prepare("update models set enabled = 1, output_modalities = ? where id = ?")
      .run(JSON.stringify(["image"]), modelId);
    expect(() =>
      setProjectMemoryConfiguration(
        repository,
        configuration({ fallbackModel: { providerId, modelId } }),
      ),
    ).toThrow("text input and output");
    expect(getProjectMemoryConfiguration(repository, root)).toEqual(before);
  });

  it.each([
    { field: "analysisModel", state: "disabled" },
    { field: "analysisModel", state: "removed" },
    { field: "fallbackModel", state: "disabled" },
    { field: "fallbackModel", state: "removed" },
  ] as const)(
    "can switch to native with a $state $field and retain its reference",
    ({ field, state }) => {
      const reference = { providerId, modelId };
      const requested = configuration({ [field]: reference });
      setProjectMemoryConfiguration(repository, requested);
      if (state === "disabled")
        database.prepare("update models set enabled = 0 where id = ?").run(modelId);
      else repository.removeModel(modelId);
      const saved = setProjectMemoryConfiguration(repository, {
        ...requested,
        backend: "native",
      });
      expect(saved.backend).toBe("native");
      expect(saved[field]).toEqual(reference);
      expect(getProjectMemoryConfiguration(repository, root)).toEqual(saved);
      expect(projectMemoryBackend(repository, root)).toBe("native");
      expect(() => setProjectMemoryConfiguration(repository, requested)).toThrow(
        "missing, disabled",
      );
      expect(getProjectMemoryConfiguration(repository, root)).toEqual(saved);
    },
  );

  it("rejects backend or model changes while matching sessions or their descendants are busy", async () => {
    const parent = service.create(choice(providerId, modelId, root));
    const worktree = join(root, "worktree");
    await mkdir(worktree);
    const child = repository.insertSession({
      ...choice(providerId, modelId, worktree),
      title: "Child fixture",
      agentProfileId: "primary",
      parentSessionId: parent.id,
      systemPrompt: "",
    });
    const before = repository.getSetting(projectMemoryBackendKey(root));
    const status = database.prepare("update sessions set status = ? where id = ?");
    status.run("running", child.id);
    expect(() => setProjectMemoryConfiguration(repository, configuration())).toThrow(
      "Stop all conversations",
    );
    status.run("idle", child.id);
    const preparing = vi.fn((id: string) => id === child.id);
    expect(() => setProjectMemoryConfiguration(repository, configuration(), preparing)).toThrow(
      "Stop all conversations",
    );
    expect(repository.getSetting(projectMemoryBackendKey(root))).toEqual(before);
    expect(preparing).toHaveBeenCalledWith(child.id);
    setProjectMemoryConfiguration(repository, configuration(), () => false);
    expect(projectMemoryBackend(repository, root)).toBe("tencentdb");
  });

  it("rejects invalid workspace, backend and selected memory paths without a partial settings write", async () => {
    const file = join(root, "file.txt");
    await writeFile(file, "Fixture.");
    for (const input of [
      null,
      {},
      configuration({ workspacePath: "" }),
      configuration({ workspacePath: file }),
      configuration({ workspacePath: join(root, "missing") }),
      { ...configuration(), backend: ["native", "tencentdb"] },
      { workspacePath: root, backend: "native" },
      { ...configuration(), analysisModel: { providerId: providerId } },
      { ...configuration({ backend: "native" }), fallbackModel: { providerId } },
    ])
      expect(() => setProjectMemoryConfiguration(repository, input)).toThrow();
    await writeFile(join(root, TENCENT_MEMORY_DIRECTORY), "Not a directory.");
    expect(() => setProjectMemoryConfiguration(repository, configuration())).toThrow(
      "regular directory",
    );
    expect(repository.listSettings("memory.backend.")).toEqual([]);
  });

  it("resolves nested child workspaces to their top-level memory owner for settings and selection", async () => {
    const parent = service.create(choice(providerId, modelId, root));
    const worktree = join(root, "worktree");
    const nested = join(root, "nested");
    await mkdir(worktree);
    await mkdir(nested);
    const child = repository.insertSession({
      ...choice(providerId, modelId, worktree),
      title: "Child fixture",
      agentProfileId: "primary",
      parentSessionId: parent.id,
      systemPrompt: "",
    });
    repository.insertSession({
      ...choice(providerId, modelId, nested),
      title: "Nested child fixture",
      agentProfileId: "primary",
      parentSessionId: child.id,
      systemPrompt: "",
    });
    commitProjectMemoryBackend(repository, worktree, "native");
    for (const workspace of [root, worktree, nested]) {
      await mkdir(join(workspace, ".harness-memory"));
      await mkdir(join(workspace, TENCENT_MEMORY_DIRECTORY));
    }
    const saved = setProjectMemoryConfiguration(
      repository,
      configuration({ workspacePath: nested, analysisModel: { providerId, modelId } }),
    );
    expect(saved.workspacePath).toBe(canonicalProjectMemoryRoot(root));
    expect(projectMemoryConfigurationRoot(repository, worktree)).toBe(
      canonicalProjectMemoryRoot(root),
    );
    expect(getProjectMemoryConfiguration(repository, worktree)).toEqual(saved);
    expect(getProjectMemoryConfiguration(repository, nested)).toEqual(saved);
    expect(projectMemoryBackend(repository, worktree)).toBe("tencentdb");
    expect(projectMemoryBackend(repository, nested)).toBe("tencentdb");
    expect(() => commitProjectMemoryBackend(repository, worktree, "tencentdb")).not.toThrow();
    expect(() => commitProjectMemoryBackend(repository, nested, "tencentdb")).not.toThrow();
    expect(() => commitProjectMemoryBackend(repository, worktree, "native")).toThrow(
      "Subagents inherit",
    );
    expect(repository.getSetting(projectMemoryBackendKey(nested))).toBeNull();
    expect(repository.getSetting(projectMemoryBackendKey(worktree))).toMatchObject({
      backend: "native",
    });
    database.prepare("update sessions set status = 'running' where id = ?").run(parent.id);
    expect(() =>
      setProjectMemoryConfiguration(
        repository,
        configuration({ workspacePath: nested, backend: "native" }),
      ),
    ).toThrow("Stop all conversations");
    expect(getProjectMemoryConfiguration(repository, nested)).toEqual(saved);
  });

  it("rejects a child directory shared by different memory owners instead of guessing a configuration", async () => {
    const other = join(root, "other-project");
    const worktree = join(root, "shared-worktree");
    await mkdir(other);
    await mkdir(worktree);
    const parents = [
      service.create(choice(providerId, modelId, root)),
      service.create(choice(providerId, modelId, other)),
    ];
    for (const parent of parents)
      repository.insertSession({
        ...choice(providerId, modelId, worktree),
        title: "Child fixture",
        agentProfileId: "primary",
        parentSessionId: parent.id,
        systemPrompt: "",
      });
    expect(() => getProjectMemoryConfiguration(repository, worktree)).toThrow(
      "multiple project memory owners",
    );
    expect(() =>
      setProjectMemoryConfiguration(repository, configuration({ workspacePath: worktree })),
    ).toThrow("multiple project memory owners");
    expect(repository.getSetting(projectMemoryBackendKey(worktree))).toBeNull();
    expect(projectMemoryBackend(repository, root)).toBe("native");
    expect(projectMemoryBackend(repository, other)).toBe("native");
  });
});
