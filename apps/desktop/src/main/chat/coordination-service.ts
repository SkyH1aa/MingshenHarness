import type {
  CoordinationPhase,
  CoordinationQaStatus,
  CoordinationStateView,
  CoordinationTaskStatus,
  CoordinationVerificationStatus,
} from "../../shared/coordination";
import type { Repository } from "../storage/repository";

export interface CoordinationTaskInput {
  id: string;
  label: string;
  agentProfileId: string;
  scope: string;
}

export interface CoordinationStartInput {
  sessionId: string;
  runId: string;
  goal: string;
  tasks: CoordinationTaskInput[];
  qaAgentProfileId: string;
  qaCriteria: string;
}

type CoordinationActivityUpdater = (
  state: CoordinationStateView,
  event: {
    title: string;
    detail: string;
    status: "running" | "completed" | "failed";
  },
) => void;

function key(sessionId: string): string {
  return `coordination.state.${sessionId}`;
}

function now(): string {
  return new Date().toISOString();
}

function isActivePhase(phase: CoordinationPhase): boolean {
  return phase === "planned" || phase === "executing" || phase === "qa";
}

function cancelledState(state: CoordinationStateView, reason: string): CoordinationStateView {
  const timestamp = now();
  return {
    ...state,
    phase: "cancelled",
    tasks: state.tasks.map((task) =>
      task.status === "queued" || task.status === "running"
        ? { ...task, status: "cancelled", completedAt: timestamp, summary: reason }
        : task,
    ),
    verification:
      state.verification.status === "not_run" || state.verification.status === "running"
        ? { ...state.verification, status: "blocked", completedAt: timestamp, summary: reason }
        : state.verification,
    qa:
      state.qa.status === "not_run" || state.qa.status === "running"
        ? { ...state.qa, status: "blocked", completedAt: timestamp, summary: reason }
        : state.qa,
    updatedAt: timestamp,
  };
}

export class CoordinationService {
  private readonly activeRuns = new Map<string, string>();

  constructor(
    private readonly repository: Repository,
    private readonly changed?: CoordinationActivityUpdater,
  ) {}

  state(sessionId: string): CoordinationStateView | null {
    const stored = this.repository.getSetting(key(sessionId));
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    const state = stored as CoordinationStateView;
    if (
      state.sessionId !== sessionId ||
      !Array.isArray(state.tasks) ||
      !state.verification ||
      !state.qa
    )
      return null;
    if (isActivePhase(state.phase) && this.activeRuns.get(sessionId) !== state.runId) {
      const recovered = cancelledState(
        state,
        "应用重新启动前协同任务未完成，未执行或未完成的检查已中断。",
      );
      this.repository.setSetting(key(sessionId), recovered);
      return recovered;
    }
    return state;
  }

  isActive(sessionId: string): boolean {
    const current = this.state(sessionId);
    return current !== null && isActivePhase(current.phase);
  }

  start(input: CoordinationStartInput): CoordinationStateView {
    if (!input.tasks.length) throw new Error("A coordinated run needs at least one task.");
    const current = this.state(input.sessionId);
    if (current && isActivePhase(current.phase))
      throw new Error("A coordinated run is already active for this session.");
    const timestamp = now();
    const state: CoordinationStateView = {
      sessionId: input.sessionId,
      runId: input.runId,
      goal: input.goal,
      phase: "planned",
      tasks: input.tasks.map((task) => ({
        ...task,
        status: "queued",
        childSessionId: null,
        startedAt: null,
        completedAt: null,
        summary: "",
      })),
      verification: {
        status: "not_run",
        commands: [],
        summary: "",
        startedAt: null,
        completedAt: null,
      },
      qa: {
        status: "not_run",
        agentProfileId: input.qaAgentProfileId,
        childSessionId: null,
        criteria: input.qaCriteria,
        summary: "",
        evidence: [],
        startedAt: null,
        completedAt: null,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.activeRuns.set(input.sessionId, input.runId);
    try {
      this.save(state, {
        title: "协同计划已建立",
        detail: `${state.tasks.length} 个工作包 · QA 尚未运行`,
        status: "completed",
      });
    } catch (error) {
      if (this.activeRuns.get(input.sessionId) === input.runId)
        this.activeRuns.delete(input.sessionId);
      throw error;
    }
    return state;
  }

  phase(sessionId: string, phase: CoordinationPhase): CoordinationStateView {
    const next = this.update(sessionId, (state) => ({ ...state, phase }), {
      title:
        phase === "executing"
          ? "协同 Agent 开始并行执行"
          : phase === "qa"
            ? "执行完成，QA 复核开始"
            : phase === "completed"
              ? "协同任务通过 QA"
              : phase === "cancelled"
                ? "协同任务已取消"
                : phase === "failed"
                  ? "协同任务未通过"
                  : "协同阶段已更新",
      detail: `phase=${phase}`,
      status:
        phase === "completed"
          ? "completed"
          : phase === "failed" || phase === "cancelled"
            ? "failed"
            : "running",
    });
    if (!isActivePhase(phase) && this.activeRuns.get(sessionId) === next.runId)
      this.activeRuns.delete(sessionId);
    return next;
  }

  taskStatus(
    sessionId: string,
    taskId: string,
    status: CoordinationTaskStatus,
    detail: {
      childSessionId?: string | null;
      summary?: string;
    } = {},
  ): CoordinationStateView {
    return this.update(
      sessionId,
      (state) => ({
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status,
                ...(detail.childSessionId !== undefined
                  ? { childSessionId: detail.childSessionId }
                  : {}),
                ...(detail.summary !== undefined
                  ? { summary: detail.summary.slice(0, 2_000) }
                  : {}),
                ...(status === "running" && !task.startedAt ? { startedAt: now() } : {}),
                ...(status === "completed" || status === "failed" || status === "cancelled"
                  ? { completedAt: now() }
                  : {}),
              }
            : task,
        ),
      }),
      {
        title: `协同角色：${status}`,
        detail: detail.summary?.slice(0, 1_000) || taskId,
        status:
          status === "completed"
            ? "completed"
            : status === "failed" || status === "cancelled"
              ? "failed"
              : "running",
      },
    );
  }

  qa(
    sessionId: string,
    status: CoordinationQaStatus,
    detail: {
      childSessionId?: string | null;
      summary?: string;
      evidence?: string[];
    } = {},
  ): CoordinationStateView {
    return this.update(
      sessionId,
      (state) => ({
        ...state,
        qa: {
          ...state.qa,
          status,
          ...(detail.childSessionId !== undefined ? { childSessionId: detail.childSessionId } : {}),
          ...(detail.summary !== undefined ? { summary: detail.summary.slice(0, 2_000) } : {}),
          ...(detail.evidence !== undefined ? { evidence: detail.evidence.slice(0, 12) } : {}),
          ...(status === "running" && !state.qa.startedAt ? { startedAt: now() } : {}),
          ...(["passed", "failed", "blocked"].includes(status) ? { completedAt: now() } : {}),
        },
      }),
      {
        title:
          status === "passed"
            ? "QA 复核通过"
            : status === "failed"
              ? "QA 复核失败"
              : status === "blocked"
                ? "QA 复核受阻"
                : status === "running"
                  ? "QA 正在复核"
                  : "QA 尚未运行",
        detail: detail.summary?.slice(0, 1_000) || `QA status=${status}`,
        status:
          status === "passed"
            ? "completed"
            : status === "failed" || status === "blocked"
              ? "failed"
              : "running",
      },
    );
  }

  verification(
    sessionId: string,
    status: CoordinationVerificationStatus,
    detail: {
      commands?: string[];
      summary?: string;
    } = {},
  ): CoordinationStateView {
    return this.update(
      sessionId,
      (state) => ({
        ...state,
        verification: {
          ...state.verification,
          status,
          ...(detail.commands !== undefined ? { commands: detail.commands.slice(0, 8) } : {}),
          ...(detail.summary !== undefined ? { summary: detail.summary.slice(0, 2_000) } : {}),
          ...(status === "running" && !state.verification.startedAt ? { startedAt: now() } : {}),
          ...(["passed", "failed", "blocked"].includes(status) ? { completedAt: now() } : {}),
        },
      }),
      {
        title:
          status === "passed"
            ? "协同验证通过"
            : status === "failed"
              ? "协同验证失败"
              : status === "blocked"
                ? "协同验证受阻"
                : status === "running"
                  ? "正在执行协同验证"
                  : "尚未执行协同验证",
        detail: detail.summary?.slice(0, 1_000) || `verification status=${status}`,
        status:
          status === "passed"
            ? "completed"
            : status === "failed" || status === "blocked"
              ? "failed"
              : "running",
      },
    );
  }

  cancel(sessionId: string, reason = "协同任务已取消。"): CoordinationStateView | null {
    const current = this.state(sessionId);
    if (!current || !isActivePhase(current.phase)) return current;
    const cancelled = cancelledState(current, reason);
    this.save(cancelled, {
      title: "协同任务已取消",
      detail: reason,
      status: "failed",
    });
    if (this.activeRuns.get(sessionId) === current.runId) this.activeRuns.delete(sessionId);
    return cancelled;
  }

  private update(
    sessionId: string,
    change: (state: CoordinationStateView) => CoordinationStateView,
    event: {
      title: string;
      detail: string;
      status: "running" | "completed" | "failed";
    },
  ): CoordinationStateView {
    const current = this.state(sessionId);
    if (!current) throw new Error("Coordination state not found.");
    const next = { ...change(current), updatedAt: now() };
    this.save(next, event);
    return next;
  }

  private save(
    state: CoordinationStateView,
    event: {
      title: string;
      detail: string;
      status: "running" | "completed" | "failed";
    },
  ): void {
    this.repository.setSetting(key(state.sessionId), state);
    this.changed?.(state, event);
  }
}
