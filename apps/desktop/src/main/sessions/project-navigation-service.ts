import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { SessionExecutionMode } from "../../shared/domain";
import type {
  SessionProjectContext,
  SessionProjectContexts,
} from "../../shared/project-navigation";
import type { Repository } from "../storage/repository";

const execFileAsync = promisify(execFile);
const SETTING_PREFIX = "session.project-context.";
const MAX_BRANCH_READS = 4;

interface StoredProjectContext {
  workspacePath: string;
  branch: string | null;
  branchRoot?: string;
  worktree: boolean;
  recordedAt: string;
  resolved: boolean;
}

interface BranchJob {
  sessionId: string;
  workspacePath: string;
  branchRoot: string;
  recordedAt: string;
  worktree: boolean;
}

async function readBranch(workspacePath: string): Promise<string | null> {
  try {
    if (!(await stat(workspacePath)).isDirectory()) return null;
    const result = await execFileAsync(
      process.platform === "win32" ? "git.exe" : "git",
      [
        "-c",
        "core.hooksPath=NUL",
        "-c",
        "core.fsmonitor=false",
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ],
      {
        cwd: workspacePath,
        windowsHide: true,
        timeout: 8_000,
        maxBuffer: 64_000,
      },
    );
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

export class ProjectNavigationService {
  private readonly jobs = new Map<string, BranchJob>();
  private readonly activeSessions = new Set<string>();
  private readonly activeJobs = new Set<Promise<void>>();
  private queue: BranchJob[] = [];
  private disposed = false;

  constructor(
    private readonly repository: Repository,
    private readonly resolveWorktreeRoot?: (sessionId: string) => string | null,
    private readonly branchReader: (workspacePath: string) => Promise<string | null> = readBranch,
  ) {}

  markCreated(
    sessionId: string,
    workspacePath: string | null,
    executionMode: SessionExecutionMode,
  ): void {
    this.assertActive();
    if (!workspacePath) return;
    const value: StoredProjectContext = {
      workspacePath,
      branch: null,
      worktree: executionMode === "worktree",
      recordedAt: new Date().toISOString(),
      resolved: false,
    };
    this.repository.setSetting(`${SETTING_PREFIX}${sessionId}`, value);
    this.jobs.delete(sessionId);
    const branchRoot = value.worktree ? this.resolveWorktreeRoot?.(sessionId) : workspacePath;
    if (!branchRoot) return;
    const job: BranchJob = {
      sessionId,
      workspacePath,
      branchRoot,
      recordedAt: value.recordedAt,
      worktree: value.worktree,
    };
    this.jobs.set(sessionId, job);
    this.queue.push(job);
    this.drainQueue();
  }

  reset(
    sessionId: string,
    workspacePath: string | null,
    executionMode: SessionExecutionMode,
  ): void {
    this.assertActive();
    if (!workspacePath) {
      this.jobs.delete(sessionId);
      this.repository.removeSetting(`${SETTING_PREFIX}${sessionId}`);
      return;
    }
    this.markCreated(sessionId, workspacePath, executionMode);
  }

  forget(sessionId: string): void {
    if (this.disposed) return;
    this.jobs.delete(sessionId);
    this.repository.removeSetting(`${SETTING_PREFIX}${sessionId}`);
  }

  async list(sessionIds: string[]): Promise<SessionProjectContexts> {
    this.assertActive();
    const uniqueIds = [...new Set(sessionIds.filter((id) => typeof id === "string"))].slice(
      0,
      2_000,
    );
    const contexts = await Promise.all(
      uniqueIds.map((sessionId) => {
        const session = this.repository.getSession(sessionId);
        const value = this.stored(sessionId);
        if (!session || session.agentMode === "chat" || !value) return [sessionId, null] as const;
        if (value.workspacePath !== session.workspacePath) return [sessionId, null] as const;
        const worktree = session.executionMode === "worktree";
        const branch =
          value.resolved && value.worktree === worktree && (!worktree || value.branchRoot)
            ? value.branch
            : null;
        return [
          sessionId,
          {
            sessionId,
            workspacePath: value.workspacePath,
            branch,
            worktree,
            recordedAt: value.recordedAt,
          } satisfies SessionProjectContext,
        ] as const;
      }),
    );
    return { contexts: Object.fromEntries(contexts) };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.jobs.clear();
    this.queue = [];
    await Promise.all([...this.activeJobs]);
  }

  private stored(sessionId: string): StoredProjectContext | null {
    const value = this.repository.getSetting(`${SETTING_PREFIX}${sessionId}`);
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<StoredProjectContext>;
    if (
      typeof record.workspacePath !== "string" ||
      typeof record.recordedAt !== "string" ||
      typeof record.worktree !== "boolean" ||
      typeof record.resolved !== "boolean" ||
      (record.branchRoot !== undefined && typeof record.branchRoot !== "string") ||
      (record.branch !== null && typeof record.branch !== "string")
    )
      return null;
    return record as StoredProjectContext;
  }

  private drainQueue(): void {
    if (this.disposed) return;
    this.queue = this.queue.filter((job) => this.jobs.get(job.sessionId) === job);
    while (this.activeJobs.size < MAX_BRANCH_READS) {
      const index = this.queue.findIndex((job) => !this.activeSessions.has(job.sessionId));
      if (index < 0) return;
      const [job] = this.queue.splice(index, 1);
      if (!job) return;
      this.activeSessions.add(job.sessionId);
      const active = Promise.resolve()
        .then(() => {
          if (this.disposed || this.jobs.get(job.sessionId) !== job) return null;
          return this.branchReader(job.branchRoot);
        })
        .catch(() => null)
        .then((branch) => {
          if (this.disposed || this.jobs.get(job.sessionId) !== job) return;
          const current = this.stored(job.sessionId);
          const session = this.repository.getSession(job.sessionId);
          if (
            !current ||
            !session ||
            session.workspacePath !== job.workspacePath ||
            current.workspacePath !== job.workspacePath ||
            current.recordedAt !== job.recordedAt ||
            current.worktree !== job.worktree ||
            current.resolved
          )
            return;
          current.branch = branch;
          current.branchRoot = job.branchRoot;
          current.resolved = true;
          this.repository.setSetting(`${SETTING_PREFIX}${job.sessionId}`, current);
        })
        .catch(() => undefined)
        .finally(() => {
          if (this.jobs.get(job.sessionId) === job) this.jobs.delete(job.sessionId);
          this.activeSessions.delete(job.sessionId);
          this.activeJobs.delete(active);
          this.drainQueue();
        });
      this.activeJobs.add(active);
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("项目导航服务正在关闭。");
  }
}
