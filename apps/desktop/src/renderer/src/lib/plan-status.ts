import type { SessionTodo, SessionView } from "../../../shared/domain";

export function planStepState(
  step: SessionTodo,
  session: SessionView,
  paused: boolean,
  reviewRequired = false,
): { label: string; spinning: boolean } {
  if (step.status === "completed") return { label: "已完成", spinning: false };
  if (step.status === "cancelled") return { label: "已取消", spinning: false };
  if (step.status === "pending") return { label: "待开始", spinning: false };
  if (reviewRequired) return { label: "待确认沿用", spinning: false };
  if (paused) return { label: "已暂停", spinning: false };
  if (session.status === "waiting_approval") return { label: "等待用户处理", spinning: false };
  if (session.status === "interrupted") return { label: "已中断", spinning: false };
  if (session.status === "error") return { label: "任务失败", spinning: false };
  if (session.status !== "running") return { label: "待继续", spinning: false };
  return { label: "进行中", spinning: true };
}
