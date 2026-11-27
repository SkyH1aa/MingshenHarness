import { randomUUID } from "node:crypto";
import type { ChatStreamEvent, SessionTodo } from "../../shared/domain";
import type {
  BeginPlanStepInput,
  ExecutionCheckpoint,
  PlanStepClaimView,
  PlanUpdateInput,
  SavedProjectPlan,
  SessionPlan,
  SettlePlanStepInput,
  WorkbenchState,
} from "../../shared/workbench";
import type { Repository } from "../storage/repository";
import { PlanClaimError, type PlanClaimService } from "../workbench/plan-claim-service";

export function persistedPlanPrompt(plan: SessionPlan): string {
  return [
    "Current persisted plan and todos; this is the authoritative state and user edits override older tool history.",
    plan.reviewRequired
      ? "Before doing other work, compare the latest user request with this previous plan. Call review_plan with the supplied revision, action keep or discard, and a factual reason. Keep it for continuation or related unfinished work, preserving progress. Discard it if superseded, abandoned or unrelated, then create a new plan with update_todos only if needed. Interruption alone does not mean abandonment. Do not ask the user just to perform this housekeeping."
      : "For continuation, preserve step IDs, completed/cancelled states, dependencies and breakpoints. Use the supplied revision for changes. This is the only active plan: older todo tool results are history, including when steps is empty. Do not revive a cleared plan unless the user asks.",
    JSON.stringify({
      revision: plan.revision,
      generation: plan.generation,
      paused: plan.paused,
      reviewRequired: Boolean(plan.reviewRequired),
      breakpoints: plan.breakpoints,
      steps: plan.steps,
      activeClaims: plan.activeClaims ?? [],
    }),
  ].join("\n");
}

export class SessionWorkbenchService {
  constructor(
    private readonly repository: Repository,
    private readonly emit: (event: ChatStreamEvent) => void,
    private readonly claims?: PlanClaimService,
  ) {}

  state(sessionId: string): WorkbenchState {
    if (this.claims) {
      return {
        plan: this.claims.plan(sessionId),
        checkpoint: this.repository.getSetting(
          `workbench.checkpoint.${sessionId}`,
        ) as ExecutionCheckpoint | null,
        queued: Boolean(this.repository.getSetting(`workbench.queued.${sessionId}`)),
      };
    }
    if (!this.repository.getSession(sessionId)) throw new Error("会话不存在。");
    const meta = this.repository.getSetting(`workbench.plan.${sessionId}`) as {
      revision?: number;
      generation?: number;
      paused?: boolean;
      reviewRequired?: boolean;
      order?: string[];
      breakpoints?: string[];
      dependencies?: Record<string, string[]>;
      updatedAt?: string;
    } | null;
    const order = meta?.order ?? [];
    const steps = this.repository
      .listSessionTodos(sessionId)
      .map((step) => ({ ...step, dependsOn: meta?.dependencies?.[step.id] ?? [] }))
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return {
      plan: {
        revision: meta?.revision ?? 0,
        generation: meta?.generation ?? 1,
        paused: meta?.paused ?? false,
        reviewRequired: meta?.reviewRequired ?? false,
        breakpoints: meta?.breakpoints ?? [],
        updatedAt: meta?.updatedAt ?? "",
        steps,
      },
      checkpoint: this.repository.getSetting(
        `workbench.checkpoint.${sessionId}`,
      ) as ExecutionCheckpoint | null,
      queued: Boolean(this.repository.getSetting(`workbench.queued.${sessionId}`)),
    };
  }

  prepareTurn(sessionId: string, resume = false, emitUpdates = true): SessionPlan {
    const plan = this.state(sessionId).plan;
    if (!plan.steps.length)
      return plan.paused || plan.reviewRequired
        ? this.update(
            { sessionId, revision: plan.revision, paused: false, steps: [] },
            false,
            false,
            emitUpdates,
          )
        : plan;
    if (plan.steps.every((step) => ["completed", "cancelled"].includes(step.status)))
      return this.update(
        { sessionId, revision: plan.revision, steps: [], paused: false, breakpoints: [] },
        false,
        false,
        emitUpdates,
      );
    if (resume && !plan.paused && !plan.reviewRequired) return plan;
    return this.update(
      { sessionId, revision: plan.revision, ...(resume ? { paused: false } : {}) },
      false,
      !resume,
      emitUpdates,
    );
  }

  review(sessionId: string, revision: number, action: unknown, reason: unknown): SessionPlan {
    if (
      (action !== "keep" && action !== "discard") ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 2000
    )
      throw new Error(
        "review_plan requires keep/discard and a concrete reason (1-2000 characters).",
      );
    return this.update(
      {
        sessionId,
        revision,
        paused: false,
        ...(action === "discard" ? { steps: [], breakpoints: [] } : {}),
      },
      false,
      false,
    );
  }

  update(
    input: PlanUpdateInput,
    fromAgent = false,
    reviewRequired?: boolean,
    emitUpdates = true,
    ownerRunId: string | null = null,
    forceGenerationAdvance = false,
  ): SessionPlan {
    const current = this.state(input.sessionId).plan;
    if (current.revision !== input.revision) throw new Error("计划已更新，请刷新后再保存。");
    const raw = input.steps ?? current.steps;
    if (!Array.isArray(raw) || raw.length > 200) throw new Error("计划最多包含 200 个步骤。");
    const seen = new Set<string>();
    const now = new Date().toISOString();
    const steps: SessionTodo[] = raw.map((step) => {
      if (!step || typeof step !== "object") throw new Error("计划步骤无效。");
      const id = step.id || randomUUID();
      if (
        seen.has(id) ||
        id.length > 120 ||
        typeof step.content !== "string" ||
        !step.content.trim() ||
        step.content.length > 4000 ||
        !["pending", "in_progress", "completed", "cancelled"].includes(step.status) ||
        !["high", "medium", "low"].includes(step.priority)
      )
        throw new Error("计划步骤无效或 ID 重复。");
      seen.add(id);
      return {
        id,
        content: step.content.trim(),
        status: step.status,
        priority: step.priority,
        dependsOn: Array.isArray(step.dependsOn)
          ? [...new Set(step.dependsOn.filter((id) => typeof id === "string"))]
          : [],
        updatedAt: now,
      };
    });
    const byId = new Map(steps.map((step) => [step.id, step]));
    const validated = new Set<string>();
    const visit = (id: string, path: Set<string>) => {
      if (path.has(id)) throw new Error("计划依赖不能形成循环。");
      if (validated.has(id)) return;
      const next = new Set([...path, id]);
      for (const dependency of byId.get(id)?.dependsOn ?? []) {
        if (!byId.has(dependency)) throw new Error("计划依赖的步骤不存在。");
        visit(dependency, next);
      }
      validated.add(id);
    };
    for (const step of steps) visit(step.id, new Set());
    for (const step of steps)
      if (
        step.status === "in_progress" &&
        step.dependsOn?.some((id) => byId.get(id)?.status !== "completed")
      )
        throw new Error("开始步骤前需要完成其依赖步骤。");
    if (input.paused !== undefined && typeof input.paused !== "boolean")
      throw new Error("暂停状态无效。");
    if (
      input.breakpoints !== undefined &&
      (!Array.isArray(input.breakpoints) || input.breakpoints.some((id) => typeof id !== "string"))
    )
      throw new Error("断点配置无效。");
    const breakpoints = (input.breakpoints ?? current.breakpoints).filter((id) => byId.has(id));
    const hitBreakpoint =
      fromAgent &&
      steps.some(
        (step) =>
          breakpoints.includes(step.id) &&
          step.status === "in_progress" &&
          current.steps.find((old) => old.id === step.id)?.status !== "in_progress",
      );
    const currentIds = new Set(current.steps.map((item) => item.id));
    const rebuild =
      current.steps.length > 0 &&
      steps.length > 0 &&
      steps.every((item) => !currentIds.has(item.id));
    const advanceGeneration =
      forceGenerationAdvance || (current.steps.length > 0 && steps.length === 0) || rebuild;
    const save = (generation: number) =>
      this.repository.replaceSessionTodos(input.sessionId, steps, {
        revision: current.revision + 1,
        generation,
        paused: hitBreakpoint || (input.paused ?? current.paused),
        reviewRequired: steps.length > 0 && (reviewRequired ?? current.reviewRequired ?? false),
        breakpoints,
        order: steps.map((step) => step.id),
        dependencies: Object.fromEntries(steps.map((step) => [step.id, step.dependsOn])),
        updatedAt: now,
      });
    if (this.claims)
      this.claims.withPlanUpdate(
        {
          sessionId: input.sessionId,
          nextSteps: steps,
          ownerRunId,
          advanceGeneration,
          requireOwnedStatusTransitions: fromAgent,
        },
        save,
      );
    else save(current.generation + (advanceGeneration ? 1 : 0));
    if (emitUpdates) this.publishState(input.sessionId);
    return this.state(input.sessionId).plan;
  }

  updateWithOwner(
    input: PlanUpdateInput,
    ownerRunId: string,
    fromAgent = true,
    reviewRequired?: boolean,
    emitUpdates = true,
  ): SessionPlan {
    return this.update(input, fromAgent, reviewRequired, emitUpdates, ownerRunId);
  }

  beginStep(input: BeginPlanStepInput): {
    plan: SessionPlan;
    claim: PlanStepClaimView | null;
  } {
    if (this.claims) {
      const result = this.claims.begin(input);
      this.publishState(input.sessionId);
      return result;
    }
    const current = this.state(input.sessionId).plan;
    if (input.revision !== current.revision)
      throw new Error(
        `Plan changed (revision ${current.revision}). Refresh before starting a step.`,
      );
    const step = current.steps.find((item) => item.id === input.stepId);
    if (!step) throw new Error("Plan step not found.");
    const saved = this.update(
      {
        sessionId: input.sessionId,
        revision: current.revision,
        steps: current.steps.map((item) =>
          item.id === step.id ? { ...item, status: "in_progress" } : item,
        ),
      },
      true,
    );
    return { plan: saved, claim: null };
  }

  heartbeatClaim(claimId: string, ownerRunId: string): void {
    if (!this.claims) throw new Error("Persistent plan claims are unavailable.");
    const claim = this.claims.heartbeat({ claimId, ownerRunId });
    this.publishState(claim.sessionId);
  }

  settleStep(input: SettlePlanStepInput): SessionPlan {
    if (!this.claims) throw new Error("Persistent plan claims are unavailable.");
    const current = this.claims.getClaim(input.claimId);
    if (!current) throw new PlanClaimError("claim_not_found", "Plan step claim not found.");
    const result = this.claims.settle(input);
    this.publishState(current.sessionId);
    return result.plan;
  }

  settleLiveStep(input: SettlePlanStepInput & { expectedVersion: number }): {
    plan: SessionPlan;
    claim: PlanStepClaimView;
  } {
    if (!this.claims) throw new Error("Persistent plan claims are unavailable.");
    const current = this.claims.getClaim(input.claimId);
    if (!current) throw new Error("Plan step claim not found.");
    const result = this.claims.settleLive(input);
    this.publishState(current.sessionId);
    return result;
  }

  settleOwnerRun(
    ownerRunId: string,
    status: "completed" | "stale" | "released" | "cancel_requested",
    summary?: string,
  ): void {
    if (!this.claims) return;
    for (const sessionId of this.claims.settleOwnerRun(ownerRunId, status, summary))
      this.publishState(sessionId);
  }

  listOwnerRunClaims(ownerRunId: string, includeTerminal = false): PlanStepClaimView[] {
    if (!this.claims) return [];
    return this.claims.listOwnerRunClaims(ownerRunId, includeTerminal);
  }

  recoverClaim(input: Parameters<PlanClaimService["recover"]>[0]): {
    plan: SessionPlan;
    claim: PlanStepClaimView;
  } {
    if (!this.claims) throw new Error("Persistent plan claims are unavailable.");
    const result = this.claims.recover(input);
    this.publishState(input.sessionId);
    return result;
  }

  materializeCoordinationSteps(
    sessionId: string,
    revision: number,
    tasks: Parameters<PlanClaimService["materializeCoordinationSteps"]>[0]["tasks"],
  ): Array<{ taskId: string; planStepId: string }> {
    if (this.claims)
      return this.claims.materializeCoordinationSteps(
        { sessionId, revision, tasks },
        (targetSessionId, targetRevision, steps, ownerRunId) => {
          const result = this.updateWithOwner(
            {
              sessionId: targetSessionId,
              revision: targetRevision,
              steps,
            },
            ownerRunId ?? "host:coordination-link",
            true,
            false,
            false,
          );
          return result;
        },
      );
    const current = this.state(sessionId).plan;
    if (current.revision !== revision) throw new Error("Plan changed before coordination.");
    const timestamp = new Date().toISOString();
    const steps = [...current.steps];
    const result = tasks.map((task, index) => {
      const existing = current.steps.find(
        (step) => step.id === task.planStepId || step.content.startsWith(`${task.label}:`),
      );
      if (existing) return { taskId: task.taskId, planStepId: existing.id };
      const planStepId = task.planStepId || `coordination-${task.taskId}`;
      steps.push({
        id: planStepId,
        content: `${task.label}: ${task.scope}`.slice(0, 4_000),
        status: "pending",
        priority: index === 0 ? "high" : "medium",
        updatedAt: timestamp,
        dependsOn: [],
      });
      return { taskId: task.taskId, planStepId };
    });
    if (steps.length !== current.steps.length)
      this.update({ sessionId, revision, steps }, true, false, false);
    return result;
  }

  publishState(sessionId: string): void {
    const state = this.state(sessionId);
    this.emit({ type: "session_todos_updated", sessionId, todos: state.plan.steps });
    this.emit({ type: "workbench_updated", sessionId, state });
  }

  checkpoint(sessionId: string, checkpoint: ExecutionCheckpoint): void {
    this.repository.setSetting(`workbench.checkpoint.${sessionId}`, checkpoint);
    this.changed(sessionId);
  }

  queued(sessionId: string, queued: boolean): void {
    if (queued) this.repository.setSetting(`workbench.queued.${sessionId}`, true);
    else this.repository.removeSetting(`workbench.queued.${sessionId}`);
    this.changed(sessionId);
  }

  saveProjectPlan(sessionId: string, name: string, id?: string): SavedProjectPlan {
    const session = this.repository.getSession(sessionId);
    if (!session) throw new Error("会话不存在。");
    if (typeof name !== "string" || !name.trim() || name.length > 120)
      throw new Error("计划名称需要 1–120 个字符。");
    const existing = id
      ? (this.repository.getSetting(`workbench.library.${id}`) as SavedProjectPlan | null)
      : null;
    if (id && !existing) throw new Error("保存的计划不存在。");
    const value: SavedProjectPlan = {
      id: existing?.id ?? randomUUID(),
      name: name.trim(),
      workspacePath: session.workspacePath,
      sourceSessionId: sessionId,
      savedAt: new Date().toISOString(),
      revision: (existing?.revision ?? 0) + 1,
      plan: (() => {
        const current = this.state(sessionId).plan;
        const { activeClaims: _activeClaims, ...snapshot } = current;
        return snapshot;
      })(),
    };
    this.repository.setSetting(`workbench.library.${value.id}`, value);
    return value;
  }

  listProjectPlans(workspacePath: string | null): SavedProjectPlan[] {
    const normalized = (path: string | null) =>
      path?.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() ?? null;
    return this.repository
      .listSettings("workbench.library.")
      .map((item) => item.value as SavedProjectPlan)
      .filter((item) => item?.id && normalized(item.workspacePath) === normalized(workspacePath))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  applyProjectPlan(
    sessionId: string,
    planId: string,
    revision: number,
    resetCompleted = false,
  ): SessionPlan {
    const stored = this.repository.getSetting(
      `workbench.library.${planId}`,
    ) as SavedProjectPlan | null;
    const session = this.repository.getSession(sessionId);
    if (!stored || !session) throw new Error("保存的计划或目标会话不存在。");
    if (["running", "waiting_approval"].includes(session.status))
      throw new Error("请先停止任务，再绑定计划。");
    const normalize = (path: string | null) =>
      path?.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() ?? null;
    if (normalize(session.workspacePath) !== normalize(stored.workspacePath))
      throw new Error("只可绑定同一项目的计划。");
    return this.update(
      {
        sessionId,
        revision,
        paused: false,
        breakpoints: stored.plan.breakpoints,
        steps: stored.plan.steps.map((step) => ({
          ...step,
          status: resetCompleted || step.status === "in_progress" ? "pending" : step.status,
        })),
      },
      false,
      false,
      true,
      null,
      true,
    );
  }

  removeProjectPlan(id: string): void {
    this.repository.removeSetting(`workbench.library.${id}`);
  }

  private changed(sessionId: string): void {
    this.emit({ type: "workbench_updated", sessionId, state: this.state(sessionId) });
  }
}
