import type { ActivityEvent, AgentProfileView, SessionView } from "../../../shared/domain";

export type AgentQualityState =
  | "failed"
  | "running"
  | "verified"
  | "needs_review"
  | "unverified"
  | "idle";

export interface AgentQualitySummary {
  total: number;
  running: number;
  verified: number;
  needsReview: number;
  unverified: number;
  failed: number;
}

const VALIDATION_TOOLS = new Set([
  "diagnostics",
  "lsp",
  "office_document",
  "request_verification",
  "run_command",
]);

function activityTime(activity: ActivityEvent): number {
  return Date.parse(activity.completedAt ?? activity.startedAt) || 0;
}

function validationLike(activity: ActivityEvent): boolean {
  if (!VALIDATION_TOOLS.has(activity.toolName)) return false;
  return /(?:\b(?:test|tests|vitest|jest|pytest|playwright|cypress|typecheck|type-check|lint|biome|eslint|tsc|clippy|check|render|verify|verification|qa|diagnostics?)\b|测试|验证|校验|渲染检查|重算|诊断)/i.test(
    `${activity.title}\n${activity.detail}`,
  );
}

export function deriveAgentQuality(
  session: SessionView,
  activities: ActivityEvent[],
  queued = false,
): AgentQualityState {
  if (session.status === "error") return "failed";
  if (queued || session.status === "running" || session.status === "waiting_approval")
    return "running";
  const ordered = [...activities].sort((left, right) => activityTime(left) - activityTime(right));
  if (ordered.some((activity) => activity.status === "running")) return "running";
  const latest = ordered.at(-1);
  if (latest?.status === "failed") return "needs_review";
  const latestValidation = ordered.findLast(validationLike);
  if (latestValidation?.status === "failed") return "needs_review";
  if (latestValidation?.status === "completed") {
    const validationIndex = ordered.findLastIndex(
      (activity) => activity.id === latestValidation.id,
    );
    if (!ordered.slice(validationIndex + 1).some((activity) => activity.status === "failed"))
      return "verified";
  }
  if (ordered.some((activity) => activity.status === "completed")) return "unverified";
  return "idle";
}

export function summarizeAgentQuality(states: AgentQualityState[]): AgentQualitySummary {
  return {
    total: states.length,
    running: states.filter((state) => state === "running").length,
    verified: states.filter((state) => state === "verified").length,
    needsReview: states.filter((state) => state === "needs_review").length,
    unverified: states.filter((state) => state === "unverified").length,
    failed: states.filter((state) => state === "failed").length,
  };
}

export function qualityLabel(state: AgentQualityState, english: boolean): string {
  const labels: Record<AgentQualityState, [string, string]> = {
    failed: ["失败", "Failed"],
    running: ["运行中", "Running"],
    verified: ["已验证", "Verified"],
    needs_review: ["需复核", "Needs review"],
    unverified: ["待验证", "Unverified"],
    idle: ["未开始", "Idle"],
  };
  return labels[state][english ? 1 : 0];
}

export function recentAgentActivities(
  sessions: SessionView[],
  activities: Record<string, ActivityEvent[]>,
  limit = 8,
): ActivityEvent[] {
  return sessions
    .flatMap((session) =>
      (activities[session.id] ?? []).map((activity) => ({
        activity,
        time: activityTime(activity),
      })),
    )
    .sort((left, right) => right.time - left.time)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.activity);
}

export function coordinationPrompt(session: SessionView, profiles: AgentProfileView[]): string {
  const mode = session.agentMode === "work" ? "work" : "code";
  const available = profiles
    .filter(
      (profile) =>
        profile.enabled &&
        (profile.role === "subagent" || profile.role === "all") &&
        (!profile.applicableModes?.length || profile.applicableModes.includes(mode)),
    )
    .map((profile) => `${profile.id} (${profile.name}${profile.readOnly ? ", read-only" : ""})`);
  return [
    "启动一轮多角色 Agent 协同任务。",
    "1. 先读取当前持久计划、工作区事实、变更和相关历史，不要直接按角色名单机械派活。",
    "2. 把目标拆成有依赖关系且写入范围互不冲突的工作包，明确每个工作包的输入、产物和验收标准。",
    "3. 根据实际能力点将并并行派发 SubAgent；优先使用需求分析、实现、测试、安全、文档/数据与 QA 专业角色，缺少专用角色时再回退 General/Explore。",
    "4. 使用 spawn_subagent 后，父 Agent 继续处理不冲突的工作；需要汇总时再使用 wait_subagents，不要空等。",
    "5. 汇总子 Agent 的实际输出和证据，处理冲突，再让 QA/Review 角色检查回归、安全、文档或 Office 渲染/重算结果。",
    "6. 运行仓库已有的测试、类型检查、Lint、诊断以及适用的文档验证；没有证据的项目必须明确标为未验证。",
    "7. 持续维护真实计划状态。只有实现和验证证据都通过才报告完成；失败、阻塞和未验证项要如实列出。",
    available.length ? `可用专业 SubAgent：${available.join("; ")}。` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
