import { describe, expect, it } from "vitest";
import type { SessionTodo, SessionView } from "../../../shared/domain";
import { planStepState } from "./plan-status";

describe("plan step presentation follows actual execution", () => {
  const step: SessionTodo = {
    id: "current",
    content: "Keep progress",
    status: "in_progress",
    priority: "medium",
    updatedAt: "",
  };
  it.each([
    ["running", false, "进行中", true],
    ["running", true, "已暂停", false],
    ["waiting_approval", false, "等待用户处理", false],
    ["interrupted", false, "已中断", false],
    ["error", false, "任务失败", false],
    ["idle", false, "待继续", false],
  ] as const)(
    "shows %s/paused=%s without changing saved progress",
    (status, paused, label, spinning) => {
      expect(planStepState(step, { status } as SessionView, paused)).toEqual({ label, spinning });
      expect(step.status).toBe("in_progress");
    },
  );
  it.each(["completed", "cancelled", "pending"] as const)("never animates a %s step", (status) => {
    expect(
      planStepState({ ...step, status }, { status: "running" } as SessionView, false).spinning,
    ).toBe(false);
  });
  it("does not animate stale progress while the model decides whether the new request still uses it", () => {
    expect(planStepState(step, { status: "running" } as SessionView, false, true)).toEqual({
      label: "待确认沿用",
      spinning: false,
    });
  });
});
