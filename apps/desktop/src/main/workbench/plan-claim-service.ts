import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SessionTodo } from "../../shared/domain";
import type {
  BeginPlanStepInput,
  PlanClaimStatus,
  PlanStepClaimView,
  SessionPlan,
  SettlePlanStepInput,
} from "../../shared/workbench";
import type { Repository } from "../storage/repository";

type Row = Record<string, unknown>;

const CLAIM_HEARTBEAT_MS = 60_000;
const CLAIM_LEASE_MS = 5 * 60_000;
const UNRESOLVED_STATUSES: readonly PlanClaimStatus[] = ["active", "stale", "cancel_requested"];

export type PlanClaimErrorCode =
  | "session_not_found"
  | "plan_changed"
  | "step_not_found"
  | "step_terminal"
  | "dependency_incomplete"
  | "breakpoint"
  | "plan_paused"
  | "claim_conflict"
  | "claim_not_found"
  | "claim_owner_mismatch"
  | "claim_version_conflict"
  | "claim_recovery_invalid"
  | "claim_inspection_required"
  | "active_claim_blocks_change"
  | "atomic_update_required";

export class PlanClaimError extends Error {
  constructor(
    readonly code: PlanClaimErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlanClaimError";
  }
}

interface StoredPlanMetadata {
  revision?: number;
  generation?: number;
  paused?: boolean;
  reviewRequired?: boolean;
  order?: string[];
  breakpoints?: string[];
  dependencies?: Record<string, string[]>;
  updatedAt?: string;
}

interface SemanticStep {
  id: string;
  content: string;
  status: SessionTodo["status"];
  priority: SessionTodo["priority"];
  dependsOn: string[];
}

function now(clock = Date.now()): string {
  return new Date(clock).toISOString();
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const value = Date.parse(timestamp);
  return new Date(value + milliseconds).toISOString();
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function evidence(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function semantic(step: SessionTodo): SemanticStep {
  return {
    id: step.id,
    content: step.content.trim(),
    status: step.status,
    priority: step.priority,
    dependsOn: [...(step.dependsOn ?? [])].sort(),
  };
}

function sameStep(left: SessionTodo, right: SessionTodo): boolean {
  return JSON.stringify(semantic(left)) === JSON.stringify(semantic(right));
}

export interface PlanStepTransactionInput {
  sessionId: string;
  nextSteps: SessionTodo[];
  ownerRunId?: string | null;
  advanceGeneration?: boolean;
  requireOwnedStatusTransitions?: boolean;
}

export interface MaterializeCoordinationStepsInput {
  sessionId: string;
  revision: number;
  tasks: Array<{
    taskId: string;
    label: string;
    scope: string;
    agentProfileId: string;
    planStepId?: string | null;
  }>;
}

export interface RecoverPlanClaimInput {
  sessionId: string;
  claimId: string;
  expectedVersion: number;
  summary: string;
  evidence?: string[];
}

export interface SettleLivePlanStepInput extends SettlePlanStepInput {
  expectedVersion: number;
}

type SettlementInput = SettlePlanStepInput & { expectedVersion?: number };

/**
 * Owns generation checks, canonical plan claims and lease state. It deliberately
 * stores claim history separately from session_todos because todo replacement is
 * not a history-preserving operation.
 */
export class PlanClaimService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly repository: Repository,
    private readonly changed?: (sessionId: string) => void,
  ) {}

  generation(sessionId: string): number {
    this.requireSession(sessionId);
    return this.ensureGeneration(sessionId);
  }

  plan(sessionId: string): SessionPlan {
    return this.readPlan(sessionId);
  }

  listClaims(sessionId: string, includeTerminal = false): PlanStepClaimView[] {
    this.requireSession(sessionId);
    this.refreshExpiredClaims(sessionId);
    const generation = this.ensureGeneration(sessionId);
    const rows = this.database
      .prepare(
        `select * from plan_step_claims
         where session_id = ? and generation = ?
           ${includeTerminal ? "" : "and status in ('active', 'stale', 'cancel_requested')"}
         order by created_at desc, rowid desc`,
      )
      .all(sessionId, generation) as Row[];
    return rows.map((row) => this.mapClaim(row));
  }

  listOwnerRunClaims(ownerRunId: string, includeTerminal = false): PlanStepClaimView[] {
    if (!ownerRunId.trim())
      throw new PlanClaimError("claim_owner_mismatch", "ownerRunId is required.");
    const sessions = this.database
      .prepare(
        `select distinct session_id from plan_step_claims
         where owner_run_id = ?
         order by session_id`,
      )
      .all(ownerRunId) as Row[];
    for (const session of sessions) {
      const sessionId = text(session.session_id);
      if (sessionId) this.refreshExpiredClaims(sessionId);
    }
    const rows = this.database
      .prepare(
        `select * from plan_step_claims
         where owner_run_id = ?
           ${includeTerminal ? "" : "and status in ('active', 'stale', 'cancel_requested')"}
         order by created_at desc, rowid desc`,
      )
      .all(ownerRunId) as Row[];
    return rows.map((row) => this.mapClaim(row));
  }

  getClaim(claimId: string): PlanStepClaimView | null {
    this.refreshExpiredClaim(claimId);
    const row = this.database.prepare("select * from plan_step_claims where id = ?").get(claimId) as
      | Row
      | undefined;
    return row ? this.mapClaim(row) : null;
  }

  begin(input: BeginPlanStepInput): { plan: SessionPlan; claim: PlanStepClaimView } {
    const savepoint = this.savepoint("begin_plan_claim");
    try {
      this.assertOwnerAuthorized(input);
      const current = this.readPlan(input.sessionId);
      if (current.revision !== input.revision)
        throw new PlanClaimError(
          "plan_changed",
          `Plan changed (revision ${current.revision}). Refresh the canonical plan before claiming a step.`,
        );
      if (current.reviewRequired)
        throw new PlanClaimError(
          "plan_paused",
          "The previous plan requires review before a step can start.",
        );
      if (current.paused)
        throw new PlanClaimError(
          "plan_paused",
          "The plan is paused. Remove the pause or breakpoint through the plan owner before claiming a step.",
        );
      const step = current.steps.find((item) => item.id === input.stepId);
      if (!step)
        throw new PlanClaimError(
          "step_not_found",
          "Plan step not found. Read the current canonical plan.",
        );
      if (step.status === "completed" || step.status === "cancelled")
        throw new PlanClaimError("step_terminal", "The selected plan step is already terminal.");
      const byId = new Map(current.steps.map((item) => [item.id, item]));
      if (step.dependsOn?.some((id) => byId.get(id)?.status !== "completed"))
        throw new PlanClaimError(
          "dependency_incomplete",
          "Complete all dependency steps before claiming this plan step.",
        );
      if (step.status === "pending" && current.breakpoints.includes(step.id))
        throw new PlanClaimError(
          "breakpoint",
          `Breakpoint reached at plan step ${step.id}. Inspect the plan and explicitly clear the breakpoint before continuing.`,
        );

      const unresolved = this.unresolvedClaims(input.sessionId, current.generation);
      const existing = unresolved.find((claim) => claim.stepId === step.id);
      if (existing) {
        if (
          existing.ownerRunId === input.runId &&
          existing.ownerSessionId === input.ownerSessionId &&
          existing.status === "active"
        ) {
          const claim = this.heartbeat({ claimId: existing.id, ownerRunId: input.runId });
          this.database.exec(`release ${savepoint};`);
          return { plan: this.readPlan(input.sessionId), claim };
        }
        throw new PlanClaimError(
          "claim_conflict",
          `Plan step ${step.id} is already claimed by ${existing.ownerSessionId}/${existing.ownerRunId} (${existing.status}).`,
        );
      }

      const timestamp = now();
      const attempt =
        integer(
          (
            this.database
              .prepare(
                `select max(attempt) as attempt from plan_step_claims
                 where session_id = ? and generation = ? and step_id = ?`,
              )
              .get(input.sessionId, current.generation, step.id) as Row | undefined
          )?.attempt,
          0,
        ) + 1;
      const claimId = randomUUID();
      this.database
        .prepare(
          `insert into plan_step_claims (
             id, session_id, generation, step_id, owner_session_id, owner_run_id,
             agent_profile_id, status, lease_until, heartbeat_at, attempt, revision,
             claim_version, summary, evidence_json, created_at, updated_at, completed_at
           ) values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1, '', '[]', ?, ?, null)`,
        )
        .run(
          claimId,
          input.sessionId,
          current.generation,
          step.id,
          input.ownerSessionId,
          input.runId,
          input.agentProfileId ?? null,
          addMilliseconds(timestamp, CLAIM_LEASE_MS),
          timestamp,
          attempt,
          current.revision,
          timestamp,
          timestamp,
        );
      this.setStepStatus(input.sessionId, step.id, "in_progress", timestamp);
      this.touchPlanMetadata(input.sessionId, current.generation, timestamp);
      this.database.exec(`release ${savepoint};`);
      this.changed?.(input.sessionId);
      const claim = this.getClaim(claimId);
      if (!claim) throw new Error("Plan claim was not saved.");
      return { plan: this.readPlan(input.sessionId), claim };
    } catch (error) {
      this.rollback(savepoint);
      throw error;
    }
  }

  heartbeat(input: { claimId: string; ownerRunId: string }): PlanStepClaimView {
    this.refreshExpiredClaim(input.claimId);
    const row = this.claimRow(input.claimId);
    if (!row) throw new PlanClaimError("claim_not_found", "The plan step claim no longer exists.");
    if (text(row.owner_run_id) !== input.ownerRunId)
      throw new PlanClaimError(
        "claim_owner_mismatch",
        "Only the run that owns this plan step may renew its lease.",
      );
    if (text(row.status) === "stale")
      throw new PlanClaimError(
        "claim_inspection_required",
        "The claim lease expired. Verify the old run and its side effects before recovery.",
      );
    if (text(row.status) !== "active")
      throw new PlanClaimError(
        "claim_owner_mismatch",
        `A ${text(row.status)} claim cannot be renewed.`,
      );
    const timestamp = now();
    const generation = this.ensureGeneration(text(row.session_id));
    if (integer(row.generation, 1) !== generation)
      throw new PlanClaimError(
        "claim_inspection_required",
        "The claim belongs to an old plan generation. Inspect it before recovery.",
      );
    const claimVersion = integer(row.claim_version, 1);
    const updated = this.database
      .prepare(
        `update plan_step_claims
         set lease_until = ?, heartbeat_at = ?, claim_version = claim_version + 1, updated_at = ?
         where id = ? and owner_run_id = ? and status = 'active'
           and generation = ? and claim_version = ? and lease_until >= ?`,
      )
      .run(
        addMilliseconds(timestamp, CLAIM_LEASE_MS),
        timestamp,
        timestamp,
        input.claimId,
        input.ownerRunId,
        generation,
        claimVersion,
        timestamp,
      );
    if (Number(updated.changes) !== 1) throw this.claimMutationConflict(input.claimId, "renewed");
    const claim = this.getClaim(input.claimId);
    if (!claim) throw new Error("Plan claim disappeared while renewing its lease.");
    return claim;
  }

  settle(input: SettlementInput): {
    plan: SessionPlan;
    claim: PlanStepClaimView;
  } {
    const savepoint = this.savepoint("settle_plan_claim");
    try {
      const result = this.applySettlement(input);
      this.database.exec(`release ${savepoint};`);
      this.changed?.(result.claim.sessionId);
      return { plan: result.plan, claim: result.claim };
    } catch (error) {
      this.rollback(savepoint);
      throw error;
    }
  }

  settleLive(input: SettleLivePlanStepInput): {
    plan: SessionPlan;
    claim: PlanStepClaimView;
  } {
    const current = this.getClaim(input.claimId);
    if (!current)
      throw new PlanClaimError("claim_not_found", "The plan step claim no longer exists.");
    if (current.ownerRunId !== input.ownerRunId)
      throw new PlanClaimError(
        "claim_owner_mismatch",
        "Only the run that owns this plan step may settle it.",
      );
    if (current.status !== "active" || !this.isLeaseLive(current.leaseUntil))
      throw new PlanClaimError(
        "claim_inspection_required",
        "The plan step claim is expired or no longer active and must be recovered with its current version.",
      );
    if (current.generation !== this.ensureGeneration(current.sessionId))
      throw new PlanClaimError(
        "claim_recovery_invalid",
        "The plan step claim belongs to an old plan generation and cannot be settled directly.",
      );
    if (current.claimVersion !== input.expectedVersion)
      throw new PlanClaimError(
        "claim_version_conflict",
        "The plan step claim changed after inspection. Refresh it before settling.",
      );
    return this.settle(input);
  }

  recover(input: RecoverPlanClaimInput): {
    plan: SessionPlan;
    claim: PlanStepClaimView;
  } {
    const savepoint = this.savepoint("recover_plan_claim");
    try {
      this.requireSession(input.sessionId);
      const row = this.claimRow(input.claimId);
      if (!row)
        throw new PlanClaimError("claim_not_found", "The plan step claim no longer exists.");
      if (text(row.session_id) !== input.sessionId)
        throw new PlanClaimError(
          "claim_owner_mismatch",
          "The plan step claim does not belong to the declared canonical session.",
        );
      const status = text(row.status) as PlanClaimStatus;
      if (status !== "stale" && status !== "cancel_requested")
        throw new PlanClaimError(
          "claim_recovery_invalid",
          `Only a stale or cancel-requested claim can be recovered; current status is ${status}.`,
        );
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1 ||
        integer(row.claim_version, 1) !== input.expectedVersion
      )
        throw new PlanClaimError(
          "claim_version_conflict",
          "The claim changed after it was inspected. Refresh the canonical plan and inspect it again.",
        );
      const summary = input.summary.replaceAll("\u0000", "").trim().slice(0, 4_000);
      if (!summary)
        throw new PlanClaimError(
          "claim_recovery_invalid",
          "Recovery requires a factual inspection summary.",
        );
      const evidenceItems = [
        ...new Set([
          ...evidence(row.evidence_json),
          ...(Array.isArray(input.evidence)
            ? input.evidence
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.replaceAll("\u0000", "").trim().slice(0, 2_000))
                .filter(Boolean)
            : []),
        ]),
      ].slice(0, 20);
      const timestamp = now();
      const updated = this.database
        .prepare(
          `update plan_step_claims
           set status = 'released', summary = ?, evidence_json = ?, updated_at = ?,
             completed_at = ?, claim_version = claim_version + 1
           where id = ? and session_id = ? and claim_version = ?
             and status in ('stale', 'cancel_requested')`,
        )
        .run(
          summary,
          JSON.stringify(evidenceItems),
          timestamp,
          timestamp,
          input.claimId,
          input.sessionId,
          input.expectedVersion,
        );
      if (Number(updated.changes) !== 1)
        throw new PlanClaimError(
          "claim_version_conflict",
          "The claim changed while recovery was being applied.",
        );
      const stepId = text(row.step_id);
      const step = this.repository
        .listSessionTodos(input.sessionId)
        .find((item) => item.id === stepId);
      if (step?.status === "in_progress") {
        this.setStepStatus(input.sessionId, stepId, "pending", timestamp);
      }
      this.touchPlanMetadata(input.sessionId, this.ensureGeneration(input.sessionId), timestamp);
      this.database.exec(`release ${savepoint};`);
      this.changed?.(input.sessionId);
      const claim = this.getClaim(input.claimId);
      if (!claim) throw new Error("Plan claim disappeared during recovery.");
      return { plan: this.readPlan(input.sessionId), claim };
    } catch (error) {
      this.rollback(savepoint);
      throw error;
    }
  }

  settleOwnerRun(
    ownerRunId: string,
    status: "completed" | "stale" | "released" | "cancel_requested",
    summary = "The owning run stopped.",
  ): string[] {
    const savepoint = this.savepoint("settle_owner_run_claims");
    try {
      const initialRows = this.database
        .prepare(
          `select id, owner_run_id, session_id from plan_step_claims
           where owner_run_id = ? and status = 'active'`,
        )
        .all(ownerRunId) as Row[];
      for (const sessionId of new Set(initialRows.map((row) => text(row.session_id)))) {
        if (sessionId) this.refreshExpiredClaims(sessionId);
      }
      const rows = this.database
        .prepare(
          `select id, owner_run_id, session_id from plan_step_claims
           where owner_run_id = ? and status = 'active'`,
        )
        .all(ownerRunId) as Row[];
      const sessions = new Set<string>();
      for (const row of rows) {
        const result = this.applySettlement({
          claimId: text(row.id),
          ownerRunId,
          status,
          summary,
        });
        sessions.add(result.claim.sessionId);
      }
      this.database.exec(`release ${savepoint};`);
      for (const sessionId of sessions) this.changed?.(sessionId);
      return [...sessions];
    } catch (error) {
      this.rollback(savepoint);
      throw error;
    }
  }

  requireNoUnresolvedClaims(sessionId: string): void {
    const claim = this.listClaims(sessionId)[0];
    if (claim)
      throw new PlanClaimError(
        "active_claim_blocks_change",
        `Plan step ${claim.stepId} is ${claim.status} under ${claim.ownerSessionId}/${claim.ownerRunId}. Stop and settle the owner before replacing or resetting this plan.`,
      );
  }

  /**
   * Runs the synchronous plan replacement and claim reconciliation under one
   * savepoint. The callback must not await or start a separate connection.
   */
  withPlanUpdate<T>(input: PlanStepTransactionInput, write: (generation: number) => T): T {
    const savepoint = this.savepoint("update_claimed_plan");
    try {
      const current = this.readPlan(input.sessionId);
      this.assertCanReplace(
        input.sessionId,
        input.nextSteps,
        current,
        input.ownerRunId,
        Boolean(input.advanceGeneration),
      );
      const claims = this.unresolvedClaims(input.sessionId, current.generation);
      if (input.requireOwnedStatusTransitions)
        this.assertOwnedStatusTransitions(
          current,
          input.nextSteps,
          claims,
          input.ownerRunId ?? null,
        );
      const generation = input.advanceGeneration ? current.generation + 1 : current.generation;
      if (input.advanceGeneration) this.setGeneration(input.sessionId, generation);
      const written = write(generation);
      if (!input.advanceGeneration)
        this.reconcileClaimsAfterUpdate(
          current.generation,
          input.nextSteps,
          input.ownerRunId ?? null,
          claims,
        );
      this.database.exec(`release ${savepoint};`);
      this.changed?.(input.sessionId);
      return written;
    } catch (error) {
      this.rollback(savepoint);
      throw error;
    }
  }

  assertCanReplace(
    sessionId: string,
    nextSteps: SessionTodo[],
    current = this.readPlan(sessionId),
    ownerRunId?: string | null,
    advanceGeneration = false,
  ): void {
    const claims = this.unresolvedClaims(sessionId, current.generation);
    if (advanceGeneration && claims.length)
      throw new PlanClaimError(
        "active_claim_blocks_change",
        `Generation cannot change while ${claims.length} unresolved plan step claim(s) remain.`,
      );
    if (!claims.length) return;
    const currentById = new Map(current.steps.map((step) => [step.id, step]));
    const nextById = new Map(nextSteps.map((step) => [step.id, step]));
    for (const claim of claims) {
      const oldStep = currentById.get(claim.stepId);
      const nextStep = nextById.get(claim.stepId);
      if (!oldStep || !nextStep)
        throw new PlanClaimError(
          "active_claim_blocks_change",
          `Claimed plan step ${claim.stepId} cannot be removed while its claim is ${claim.status}.`,
        );
      if (!sameStep(oldStep, { ...nextStep, status: oldStep.status, updatedAt: oldStep.updatedAt }))
        throw new PlanClaimError(
          "active_claim_blocks_change",
          `Claimed plan step ${claim.stepId} cannot change content, priority or dependencies while its claim is ${claim.status}.`,
        );
      if (nextStep.status !== oldStep.status) {
        const ownerMaySettle =
          claim.status === "active" &&
          Boolean(ownerRunId) &&
          claim.ownerRunId === ownerRunId &&
          (nextStep.status === "completed" || nextStep.status === "cancelled");
        if (!ownerMaySettle)
          throw new PlanClaimError(
            "active_claim_blocks_change",
            `Only the active owner may settle plan step ${claim.stepId}; stale or cancel-requested claims require inspection.`,
          );
      }
    }
  }

  private assertOwnedStatusTransitions(
    current: SessionPlan,
    nextSteps: SessionTodo[],
    claims: PlanStepClaimView[],
    ownerRunId: string | null,
  ): void {
    const currentById = new Map(current.steps.map((step) => [step.id, step]));
    const claimsByStep = new Map(claims.map((claim) => [claim.stepId, claim]));
    for (const step of nextSteps) {
      const previous = currentById.get(step.id);
      if (previous?.status === step.status) continue;
      // New work may be proposed freely, but only a live claim may move it
      // directly into an active or terminal state.
      if (!previous && step.status === "pending") continue;
      const claim = claimsByStep.get(step.id);
      const authorized = Boolean(
        ownerRunId &&
          claim &&
          claim.status === "active" &&
          claim.ownerRunId === ownerRunId &&
          claim.generation === current.generation &&
          claim.revision === current.revision &&
          this.isLeaseLive(claim.leaseUntil),
      );
      if (!authorized)
        throw new PlanClaimError(
          "atomic_update_required",
          `Plan step ${step.id} cannot change to ${step.status} without an active claim owned by the current run at the current generation and revision. Use begin_plan_step and recover stale claims before continuing.`,
        );
    }
  }

  advanceGeneration(sessionId: string): number {
    const savepoint = this.savepoint("advance_plan_generation");
    try {
      this.requireNoUnresolvedClaims(sessionId);
      const next = this.ensureGeneration(sessionId) + 1;
      this.setGeneration(sessionId, next);
      this.database.exec(`release ${savepoint};`);
      this.changed?.(sessionId);
      return next;
    } catch (error) {
      this.rollback(savepoint);
      throw error;
    }
  }

  advanceForkGeneration(sourceSessionId: string, targetSessionId: string): number {
    this.requireSession(sourceSessionId);
    this.requireSession(targetSessionId);
    const next = this.ensureGeneration(sourceSessionId) + 1;
    this.setGeneration(targetSessionId, next);
    return next;
  }

  /**
   * Materializes coordination work packages into the canonical plan and returns
   * stable planStepId values. Existing plan IDs are never silently re-owned.
   */
  materializeCoordinationSteps(
    input: MaterializeCoordinationStepsInput,
    replacePlan: (
      sessionId: string,
      revision: number,
      steps: SessionTodo[],
      ownerRunId?: string | null,
    ) => SessionPlan,
  ): Array<{ taskId: string; planStepId: string }> {
    const current = this.readPlan(input.sessionId);
    if (current.revision !== input.revision)
      throw new PlanClaimError(
        "plan_changed",
        `Plan changed (revision ${current.revision}). Refresh before linking coordination work.`,
      );
    const timestamp = now();
    const existingIds = new Set(current.steps.map((step) => step.id));
    const additions: SessionTodo[] = [];
    const result = input.tasks.map((task, index) => {
      if (task.planStepId && existingIds.has(task.planStepId))
        return { taskId: task.taskId, planStepId: task.planStepId };
      const planStepId =
        task.planStepId && !existingIds.has(task.planStepId)
          ? task.planStepId
          : `coordination-${task.taskId}`;
      if (existingIds.has(planStepId)) return { taskId: task.taskId, planStepId };
      existingIds.add(planStepId);
      additions.push({
        id: planStepId,
        content: `${task.label}: ${task.scope}`.slice(0, 4_000),
        status: "pending",
        priority: index === 0 ? "high" : "medium",
        updatedAt: timestamp,
        dependsOn: [],
      });
      return { taskId: task.taskId, planStepId };
    });
    if (!additions.length) return result;
    replacePlan(input.sessionId, current.revision, [...current.steps, ...additions], null);
    return result;
  }

  private readPlan(sessionId: string): SessionPlan {
    this.requireSession(sessionId);
    const generation = this.ensureGeneration(sessionId);
    this.refreshExpiredClaims(sessionId);
    const meta = this.repository.getSetting(
      `workbench.plan.${sessionId}`,
    ) as StoredPlanMetadata | null;
    const order = meta?.order ?? [];
    const steps = this.repository
      .listSessionTodos(sessionId)
      .map((step) => ({
        ...step,
        dependsOn: meta?.dependencies?.[step.id] ?? [],
      }))
      .sort((left, right) => {
        const leftIndex = order.indexOf(left.id);
        const rightIndex = order.indexOf(right.id);
        if (leftIndex < 0 && rightIndex < 0) return left.updatedAt.localeCompare(right.updatedAt);
        if (leftIndex < 0) return 1;
        if (rightIndex < 0) return -1;
        return leftIndex - rightIndex;
      });
    return {
      revision: integer(meta?.revision),
      generation,
      paused: Boolean(meta?.paused),
      reviewRequired: Boolean(meta?.reviewRequired),
      breakpoints: Array.isArray(meta?.breakpoints) ? meta.breakpoints : [],
      updatedAt: text(meta?.updatedAt),
      steps,
      activeClaims: this.unresolvedClaims(sessionId, generation),
    };
  }

  private reconcileClaimsAfterUpdate(
    generation: number,
    nextSteps: SessionTodo[],
    ownerRunId: string | null,
    claims: PlanStepClaimView[],
  ): void {
    if (!ownerRunId) return;
    const byId = new Map(nextSteps.map((step) => [step.id, step]));
    for (const claim of claims) {
      if (claim.ownerRunId !== ownerRunId || claim.status !== "active") continue;
      const step = byId.get(claim.stepId);
      if (!step) continue;
      if (step.status === "completed" || step.status === "cancelled") {
        const timestamp = now();
        this.database
          .prepare(
            `update plan_step_claims
             set status = 'completed', summary = case
                   when summary = '' then ? else summary end,
                 updated_at = ?, completed_at = ?, claim_version = claim_version + 1
             where id = ? and generation = ? and owner_run_id = ? and status = 'active'`,
          )
          .run(
            step.status === "completed"
              ? "Completed through update_todos."
              : "Cancelled through update_todos.",
            timestamp,
            timestamp,
            claim.id,
            generation,
            ownerRunId,
          );
      } else if (step.status !== "in_progress") {
        const timestamp = now();
        this.database
          .prepare(
            `update plan_step_claims
             set status = 'released', summary = ?, updated_at = ?, completed_at = ?,
               claim_version = claim_version + 1
             where id = ? and generation = ? and owner_run_id = ? and status = 'active'`,
          )
          .run(
            "Released through update_todos without completion.",
            timestamp,
            timestamp,
            claim.id,
            generation,
            ownerRunId,
          );
      }
    }
  }

  private applySettlement(input: SettlementInput): {
    plan: SessionPlan;
    claim: PlanStepClaimView;
  } {
    this.refreshExpiredClaim(input.claimId);
    const row = this.claimRow(input.claimId);
    if (!row) throw new PlanClaimError("claim_not_found", "The plan step claim no longer exists.");
    if (text(row.owner_run_id) !== input.ownerRunId)
      throw new PlanClaimError(
        "claim_owner_mismatch",
        "Only the run that owns this plan step may settle it.",
      );
    if (!UNRESOLVED_STATUSES.includes(text(row.status) as PlanClaimStatus))
      throw new PlanClaimError(
        "claim_owner_mismatch",
        "A terminal plan claim cannot be settled again.",
      );
    if (text(row.status) !== "active")
      throw new PlanClaimError(
        "claim_inspection_required",
        "An expired or cancel-requested claim must be recovered with its inspected claim version.",
      );
    const timestamp = now();
    const generation = this.ensureGeneration(text(row.session_id));
    if (
      integer(row.generation, 1) !== generation ||
      !this.isLeaseLive(text(row.lease_until), timestamp)
    )
      throw new PlanClaimError(
        "claim_inspection_required",
        "The claim is expired or belongs to an old plan generation. Inspect it before recovery.",
      );
    const summary =
      typeof input.summary === "string"
        ? input.summary.replaceAll("\u0000", "").trim().slice(0, 4_000)
        : "";
    const evidenceItems = Array.isArray(input.evidence)
      ? [
          ...new Set(
            input.evidence
              .filter((item) => typeof item === "string")
              .map((item) => item.slice(0, 2_000)),
          ),
        ].slice(0, 20)
      : [];
    const currentVersion = integer(row.claim_version, 1);
    const expectedVersion = input.expectedVersion ?? currentVersion;
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new PlanClaimError(
        "claim_version_conflict",
        "Settlement requires the positive integer claimVersion read by the caller.",
      );
    const updated = this.database
      .prepare(
        `update plan_step_claims
         set status = ?, summary = ?, evidence_json = ?, updated_at = ?,
           completed_at = ?, claim_version = claim_version + 1
         where id = ? and owner_run_id = ? and status = 'active'
           and generation = ? and claim_version = ? and lease_until >= ?`,
      )
      .run(
        input.status,
        summary,
        JSON.stringify(evidenceItems),
        timestamp,
        ["completed", "released"].includes(input.status) ? timestamp : null,
        input.claimId,
        input.ownerRunId,
        generation,
        expectedVersion,
        timestamp,
      );
    if (Number(updated.changes) !== 1) throw this.claimMutationConflict(input.claimId, "settled");
    const sessionId = text(row.session_id);
    const stepId = text(row.step_id);
    if (input.status === "completed") this.setStepStatus(sessionId, stepId, "completed", timestamp);
    if (input.status === "released") {
      const step = this.repository.listSessionTodos(sessionId).find((item) => item.id === stepId);
      if (step?.status === "in_progress")
        this.setStepStatus(sessionId, stepId, "pending", timestamp);
    }
    const currentGeneration = this.ensureGeneration(sessionId);
    this.touchPlanMetadata(sessionId, currentGeneration, timestamp);
    const claim = this.getClaim(input.claimId);
    if (!claim) throw new Error("Plan claim disappeared while settling.");
    return { plan: this.readPlan(sessionId), claim };
  }

  private unresolvedClaims(sessionId: string, generation: number): PlanStepClaimView[] {
    const rows = this.database
      .prepare(
        `select * from plan_step_claims
         where session_id = ? and generation = ?
           and status in ('active', 'stale', 'cancel_requested')
         order by created_at asc, rowid asc`,
      )
      .all(sessionId, generation) as Row[];
    return rows.map((row) => this.mapClaim(row));
  }

  private refreshExpiredClaims(sessionId: string): void {
    const current = now();
    const generation = this.ensureGeneration(sessionId);
    this.database
      .prepare(
        `update plan_step_claims
         set status = 'stale', updated_at = ?, claim_version = claim_version + 1
         where session_id = ? and generation = ? and status = 'active' and lease_until < ?`,
      )
      .run(current, sessionId, generation, current);
  }

  private refreshExpiredClaim(claimId: string): void {
    const row = this.claimRow(claimId);
    if (!row || text(row.status) !== "active") return;
    const sessionId = text(row.session_id);
    if (!sessionId || !this.repository.getSession(sessionId)) return;
    const current = now();
    const generation = this.ensureGeneration(sessionId);
    this.database
      .prepare(
        `update plan_step_claims
         set status = 'stale', updated_at = ?, claim_version = claim_version + 1
         where id = ? and status = 'active'
           and (lease_until < ? or generation <> ?)`,
      )
      .run(current, claimId, current, generation);
  }

  private claimMutationConflict(claimId: string, action: string): PlanClaimError {
    const current = this.claimRow(claimId);
    if (
      !current ||
      text(current.status) !== "active" ||
      !this.isLeaseLive(text(current.lease_until))
    )
      return new PlanClaimError(
        "claim_inspection_required",
        `The claim could not be ${action} because its lease expired or it is no longer active. Inspect it before recovery.`,
      );
    return new PlanClaimError(
      "claim_version_conflict",
      `The plan step claim changed while it was being ${action}. Refresh it and verify side effects again.`,
    );
  }

  private isLeaseLive(leaseUntil: string, timestamp = now()): boolean {
    const lease = Date.parse(leaseUntil);
    const current = Date.parse(timestamp);
    return Number.isFinite(lease) && Number.isFinite(current) && lease >= current;
  }

  private setStepStatus(
    sessionId: string,
    stepId: string,
    status: SessionTodo["status"],
    timestamp: string,
  ): void {
    this.database
      .prepare(
        `update session_todos set status = ?, updated_at = ?
         where session_id = ? and id = ?`,
      )
      .run(status, timestamp, sessionId, stepId);
  }

  private touchPlanMetadata(sessionId: string, generation: number, timestamp: string): void {
    const meta = this.repository.getSetting(
      `workbench.plan.${sessionId}`,
    ) as StoredPlanMetadata | null;
    if (!meta) return;
    this.repository.setSetting(`workbench.plan.${sessionId}`, {
      ...meta,
      generation,
      updatedAt: timestamp,
    });
  }

  private ensureGeneration(sessionId: string): number {
    const timestamp = now();
    this.database
      .prepare(
        `insert or ignore into plan_generations (session_id, generation, updated_at)
         values (?, 1, ?)`,
      )
      .run(sessionId, timestamp);
    const row = this.database
      .prepare("select generation from plan_generations where session_id = ?")
      .get(sessionId) as Row | undefined;
    return Math.max(1, integer(row?.generation, 1));
  }

  private setGeneration(sessionId: string, generation: number): void {
    this.database
      .prepare(
        `insert into plan_generations (session_id, generation, updated_at)
         values (?, ?, ?)
         on conflict(session_id) do update set
           generation = excluded.generation,
           updated_at = excluded.updated_at`,
      )
      .run(sessionId, generation, now());
  }

  private claimRow(claimId: string): Row | null {
    return (
      (this.database.prepare("select * from plan_step_claims where id = ?").get(claimId) as
        | Row
        | undefined) ?? null
    );
  }

  private mapClaim(row: Row): PlanStepClaimView {
    return {
      id: text(row.id),
      sessionId: text(row.session_id),
      generation: integer(row.generation, 1),
      stepId: text(row.step_id),
      ownerSessionId: text(row.owner_session_id),
      ownerRunId: text(row.owner_run_id),
      agentProfileId: typeof row.agent_profile_id === "string" ? row.agent_profile_id : null,
      status: text(row.status) as PlanClaimStatus,
      leaseUntil: text(row.lease_until),
      heartbeatAt: text(row.heartbeat_at),
      attempt: integer(row.attempt, 1),
      revision: integer(row.revision),
      claimVersion: integer(row.claim_version, 1),
      summary: text(row.summary),
      evidence: evidence(row.evidence_json),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    };
  }

  private requireSession(sessionId: string): void {
    if (!this.repository.getSession(sessionId))
      throw new PlanClaimError("session_not_found", "Session not found.");
  }

  private assertOwnerAuthorized(input: BeginPlanStepInput): void {
    const planOwner = this.repository.getSession(input.sessionId);
    const executionOwner = this.repository.getSession(input.ownerSessionId);
    if (!planOwner || !executionOwner)
      throw new PlanClaimError(
        "claim_owner_mismatch",
        "The plan or execution-owner session does not exist.",
      );
    if (executionOwner.id !== planOwner.id && executionOwner.parentSessionId !== planOwner.id)
      throw new PlanClaimError(
        "claim_owner_mismatch",
        "A plan step may be claimed only by its canonical plan session or one direct child session.",
      );
    if (input.agentProfileId && executionOwner.agentProfileId !== input.agentProfileId)
      throw new PlanClaimError(
        "claim_owner_mismatch",
        "The claimed Agent profile does not match the execution-owner session.",
      );
  }

  private savepoint(label: string): string {
    const name = `${label}_${randomUUID().replaceAll("-", "")}`;
    this.database.exec(`savepoint ${name}`);
    return name;
  }

  private rollback(savepoint: string): void {
    try {
      this.database.exec(`rollback to ${savepoint}; release ${savepoint}`);
    } catch {
      // The original operation error is more useful than a nested rollback error.
    }
  }
}

export const PLAN_CLAIM_TIMING = {
  heartbeatMs: CLAIM_HEARTBEAT_MS,
  leaseMs: CLAIM_LEASE_MS,
} as const;
