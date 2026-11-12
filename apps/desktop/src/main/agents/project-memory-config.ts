import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ModelReference, SessionView } from "../../shared/domain";
import type {
  MemoryBackend,
  ProjectMemoryConfiguration,
  ProjectMemorySelection,
} from "../../shared/project-memory";
import { sameModel } from "../providers/auxiliary-model";
import type { Repository } from "../storage/repository";

export const TENCENT_MEMORY_DIRECTORY = ".harness-tencent-memory";

export function canonicalProjectMemoryRoot(root: string): string {
  if (typeof root !== "string" || !root.trim() || root.length > 32_768 || root.includes("\0"))
    throw new Error("Invalid project directory.");
  const absolute = resolve(root.trim());
  const normalize = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
  try {
    return normalize(realpathSync.native(absolute));
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    return normalize(absolute);
  }
}

export function projectMemoryBackendKey(root: string): string {
  return `memory.backend.${createHash("sha256").update(canonicalProjectMemoryRoot(root)).digest("hex")}`;
}

function storedBackend(repository: Repository, root: string): MemoryBackend | null {
  const stored = repository.getSetting(projectMemoryBackendKey(root));
  if (stored === null) return null;
  const backend =
    stored && typeof stored === "object" ? (stored as { backend?: unknown }).backend : stored;
  if (backend !== "native" && backend !== "tencentdb")
    throw new Error("Project memory configuration is invalid. Restore its saved configuration.");
  return backend;
}

function hasExplicitSelection(repository: Repository, root: string): boolean {
  const stored = repository.getSetting(projectMemoryBackendKey(root));
  return Boolean(
    stored &&
      typeof stored === "object" &&
      (stored as { explicitSelection?: unknown }).explicitSelection === true,
  );
}

function assertActiveMemoryDirectory(root: string, backend: MemoryBackend): void {
  const target = join(root, backend === "native" ? ".harness-memory" : TENCENT_MEMORY_DIRECTORY);
  try {
    const metadata = lstatSync(target);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error("The selected project memory path must be a regular directory.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function assertMemoryDirectorySelection(root: string, backend?: MemoryBackend): void {
  const nativeDirectory = existsSync(join(root, ".harness-memory"));
  const tencentDirectory = existsSync(join(root, TENCENT_MEMORY_DIRECTORY));
  if (nativeDirectory && tencentDirectory)
    throw new Error(
      "Project contains both memory backends. Select the active backend in Settings > Project instructions and trust before continuing.",
    );
  if ((backend === "native" && tencentDirectory) || (backend === "tencentdb" && nativeDirectory))
    throw new Error(
      "Project memory directory conflicts with its saved backend. Select the active backend in Settings > Project instructions and trust before continuing.",
    );
}

function topLevelOwner(repository: Repository, session: SessionView): SessionView {
  let owner = session;
  const visited = new Set<string>();
  while (owner.parentSessionId) {
    if (visited.has(owner.id)) throw new Error("Invalid session ancestry.");
    visited.add(owner.id);
    const parent = repository.getSession(owner.parentSessionId);
    if (!parent) throw new Error("Project memory owner is missing.");
    owner = parent;
  }
  return owner;
}

export function projectMemorySelection(
  repository: Repository,
  root: string | null,
): ProjectMemorySelection {
  if (!root) return { backend: "native", locked: true };
  const canonical = canonicalProjectMemoryRoot(root);
  const stored = storedBackend(repository, root);
  const existing = repository
    .listSessions()
    .find(
      (session) =>
        session.workspacePath && canonicalProjectMemoryRoot(session.workspacePath) === canonical,
    );
  const owner = existing ? topLevelOwner(repository, existing) : null;
  const inheritedBackend = owner?.workspacePath
    ? (storedBackend(repository, owner.workspacePath) ?? "native")
    : "native";
  if (owner?.workspacePath && hasExplicitSelection(repository, owner.workspacePath)) {
    assertActiveMemoryDirectory(canonicalProjectMemoryRoot(owner.workspacePath), inheritedBackend);
    return { backend: inheritedBackend, locked: true };
  }
  if (stored && hasExplicitSelection(repository, root)) {
    assertActiveMemoryDirectory(canonical, stored);
    return { backend: stored, locked: true };
  }
  assertMemoryDirectorySelection(root);
  const nativeDirectory = existsSync(join(root, ".harness-memory"));
  const tencentDirectory = existsSync(join(root, TENCENT_MEMORY_DIRECTORY));
  if (stored) {
    assertMemoryDirectorySelection(root, stored);
    return { backend: stored, locked: true };
  }
  if (owner) {
    if (owner.workspacePath) assertMemoryDirectorySelection(owner.workspacePath, inheritedBackend);
    assertMemoryDirectorySelection(root, inheritedBackend);
    return { backend: inheritedBackend, locked: true };
  }
  if (nativeDirectory) return { backend: "native", locked: true };
  if (tencentDirectory) return { backend: "tencentdb", locked: true };
  return { backend: "native", locked: false };
}

export function projectMemoryBackend(repository: Repository, root: string): MemoryBackend {
  return projectMemorySelection(repository, root).backend;
}

export function validateProjectMemoryBackend(
  repository: Repository,
  root: string | null,
  choice?: unknown,
): MemoryBackend {
  if (choice !== undefined && choice !== "native" && choice !== "tencentdb")
    throw new Error("Choose exactly one project memory backend.");
  const existing = projectMemorySelection(repository, root);
  if (!root && choice === "tencentdb")
    throw new Error("Select a project directory before choosing TencentDB Agent Memory.");
  if (existing.locked && choice !== undefined && choice !== existing.backend)
    throw new Error(
      "This project already uses another memory backend. New conversations inherit it.",
    );
  return (choice as MemoryBackend | undefined) ?? existing.backend;
}

// Called only after validation and successful session creation; session insertion
// itself makes a legacy project look locked, so do not infer a default here.
export function commitProjectMemoryBackend(
  repository: Repository,
  root: string | null,
  backend: MemoryBackend,
): void {
  if (!root) return;
  if (backend !== "native" && backend !== "tencentdb")
    throw new Error("Choose exactly one project memory backend.");
  const canonical = canonicalProjectMemoryRoot(root);
  const existing = repository
    .listSessions()
    .find(
      (session) =>
        session.workspacePath && canonicalProjectMemoryRoot(session.workspacePath) === canonical,
    );
  const owner = existing ? topLevelOwner(repository, existing) : null;
  if (
    owner?.workspacePath &&
    canonicalProjectMemoryRoot(owner.workspacePath) !== canonical &&
    hasExplicitSelection(repository, owner.workspacePath)
  ) {
    const ownerRoot = projectMemoryConfigurationRoot(repository, root);
    if (storedBackend(repository, ownerRoot) !== backend)
      throw new Error("Subagents inherit their parent project's memory backend.");
    assertActiveMemoryDirectory(ownerRoot, backend);
    return;
  }
  const stored = storedBackend(repository, root);
  if (stored && stored !== backend) throw new Error("Project memory backend cannot be changed.");
  if (stored && hasExplicitSelection(repository, root))
    assertActiveMemoryDirectory(canonicalProjectMemoryRoot(root), backend);
  else assertMemoryDirectorySelection(root, backend);
  if (!stored)
    repository.setSetting(projectMemoryBackendKey(root), {
      backend,
      root: canonicalProjectMemoryRoot(root),
    });
}

type AnalysisModels = Pick<ProjectMemoryConfiguration, "analysisModel" | "fallbackModel">;

function modelReference(value: unknown): ModelReference | null {
  if (value === undefined || value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as ModelReference).providerId !== "string" ||
    !(value as ModelReference).providerId.trim() ||
    (value as ModelReference).providerId.length > 128 ||
    typeof (value as ModelReference).modelId !== "string" ||
    !(value as ModelReference).modelId.trim() ||
    (value as ModelReference).modelId.length > 128
  )
    throw new Error("Invalid project memory analysis model.");
  const reference = value as ModelReference;
  return { providerId: reference.providerId, modelId: reference.modelId };
}

export function projectMemoryAnalysisModels(repository: Repository, root: string): AnalysisModels {
  const stored = repository.getSetting(projectMemoryBackendKey(root));
  if (!stored || typeof stored !== "object") return { analysisModel: null, fallbackModel: null };
  const value = stored as Record<string, unknown>;
  return {
    analysisModel: modelReference(value.analysisModel),
    fallbackModel: modelReference(value.fallbackModel),
  };
}

function existingConfigurationRoot(root: string): string {
  const canonical = canonicalProjectMemoryRoot(root);
  if (!statSync(canonical).isDirectory()) throw new Error("Select an existing project directory.");
  return canonical;
}

export function projectMemoryConfigurationRoot(repository: Repository, root: string): string {
  const requested = existingConfigurationRoot(root);
  const owners = new Set<string>();
  for (const session of repository.listSessions()) {
    if (!session.workspacePath || canonicalProjectMemoryRoot(session.workspacePath) !== requested)
      continue;
    const owner = topLevelOwner(repository, session);
    if (!owner.workspacePath) throw new Error("Project memory owner has no project directory.");
    owners.add(existingConfigurationRoot(owner.workspacePath));
  }
  if (owners.size > 1)
    throw new Error(
      "This directory belongs to multiple project memory owners. Select the intended parent project directory.",
    );
  return owners.values().next().value ?? requested;
}

export function getProjectMemoryConfiguration(
  repository: Repository,
  root: string,
): ProjectMemoryConfiguration {
  const workspacePath = projectMemoryConfigurationRoot(repository, root);
  return {
    workspacePath,
    ...projectMemorySelection(repository, workspacePath),
    ...projectMemoryAnalysisModels(repository, workspacePath),
  };
}

function assertModelAvailable(repository: Repository, reference: ModelReference | null): void {
  if (!reference) return;
  const model = repository
    .getProvider(reference.providerId)
    ?.models.find((candidate) => candidate.id === reference.modelId && candidate.enabled);
  if (!model?.inputModalities.includes("text") || !model.outputModalities.includes("text"))
    throw new Error(
      "Project memory analysis model is missing, disabled, or does not support text input and output.",
    );
}

function assertConfigurationIdle(
  repository: Repository,
  root: string,
  isSessionBusy: (sessionId: string) => boolean,
): void {
  const sessions = repository.listSessions();
  const affected = new Set(
    sessions
      .filter(
        (session) =>
          session.workspacePath && canonicalProjectMemoryRoot(session.workspacePath) === root,
      )
      .map((session) => session.id),
  );
  let previousSize = -1;
  while (previousSize !== affected.size) {
    previousSize = affected.size;
    for (const session of sessions)
      if (session.parentSessionId && affected.has(session.parentSessionId))
        affected.add(session.id);
  }
  if (
    sessions.some(
      (session) =>
        affected.has(session.id) &&
        (isSessionBusy(session.id) || ["running", "waiting_approval"].includes(session.status)),
    )
  )
    throw new Error(
      "Stop all conversations and child tasks in this project before changing its memory configuration.",
    );
}

export function setProjectMemoryConfiguration(
  repository: Repository,
  input: unknown,
  isSessionBusy: (sessionId: string) => boolean = () => false,
): ProjectMemoryConfiguration {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid project memory configuration.");
  const value = input as Record<string, unknown>;
  if (
    typeof value.workspacePath !== "string" ||
    (value.backend !== "native" && value.backend !== "tencentdb") ||
    !Object.hasOwn(value, "analysisModel") ||
    !Object.hasOwn(value, "fallbackModel")
  )
    throw new Error("Invalid project memory configuration.");
  const workspacePath = projectMemoryConfigurationRoot(repository, value.workspacePath);
  const backend = value.backend as MemoryBackend;
  const analysisModel = modelReference(value.analysisModel);
  const fallbackModel = modelReference(value.fallbackModel);
  if (backend === "tencentdb") {
    assertModelAvailable(repository, analysisModel);
    assertModelAvailable(repository, fallbackModel);
  }
  if (sameModel(analysisModel, fallbackModel))
    throw new Error("The fallback memory analysis model must differ from the primary model.");
  assertConfigurationIdle(repository, workspacePath, isSessionBusy);
  assertActiveMemoryDirectory(workspacePath, backend);
  // One synchronous setting write changes routing and model selection together.
  // Inactive backend directories remain intact and are never read or migrated.
  repository.setSetting(projectMemoryBackendKey(workspacePath), {
    root: workspacePath,
    backend,
    explicitSelection: true,
    analysisModel,
    fallbackModel,
  });
  return { workspacePath, backend, locked: true, analysisModel, fallbackModel };
}
