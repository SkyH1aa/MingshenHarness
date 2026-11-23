import { describe, expect, it } from "vitest";
import { CompanionMotionScheduler } from "./companion-motion";

describe("companion motion scheduling", () => {
  it("reconciles real task loops through accelerated automatic transitions", () => {
    const motion = new CompanionMotionScheduler();
    expect(motion.update("idle", null)).toEqual({ id: "idle_breathe", loop: true });
    expect(motion.update("thinking", null)).toEqual({
      id: "thinking_enter",
      loop: false,
      playbackRate: 2,
    });
    expect(motion.complete("thinking_enter")).toEqual({ id: "thinking_loop", loop: true });
    expect(motion.update("working", null)).toEqual({
      id: "thinking_exit",
      loop: false,
      playbackRate: 2,
    });
    expect(motion.complete("thinking_exit")?.id).toBe("working_enter");
    expect(motion.complete("working_enter")?.id).toBe("working_loop");
    expect(motion.update("waiting", null)?.id).toBe("working_exit");
    expect(motion.complete("working_exit")?.id).toBe("waiting");
  });

  it("does not queue stale automatic states when tasks change quickly", () => {
    const motion = new CompanionMotionScheduler();
    expect(motion.update("thinking", null)?.id).toBe("thinking_enter");
    expect(motion.update("working", null)?.id).toBe("working_enter");
    expect(motion.update("waiting", null)?.id).toBe("waiting");
    expect(motion.complete("thinking_enter")).toBeNull();
    expect(motion.complete("working_enter")).toBeNull();
    expect(motion.update("success", null)?.id).toBe("success");
  });

  it("finishes a normal interaction while retaining the latest actual task state", () => {
    const motion = new CompanionMotionScheduler();
    motion.update("working", null);
    motion.complete("working_enter");
    expect(motion.update("working", { id: 1, action: "pat" })?.id).toBe("working_exit");
    expect(motion.complete("working_exit")?.id).toBe("pat");
    expect(motion.update("waiting", { id: 1, action: "pat" })).toBeNull();
    expect(motion.complete("pat")?.id).toBe("waiting");
    expect(motion.update("waiting", { id: 1, action: "pat" })).toBeNull();
  });

  it("keeps a queued interaction when the greeting expires before the current clip ends", () => {
    const motion = new CompanionMotionScheduler();
    expect(motion.update("greeting", { id: 1, action: "pat" })?.id).toBe("pat");
    expect(motion.update("greeting", { id: 2, action: "dance" })).toBeNull();
    expect(motion.update("idle", { id: 2, action: "dance" })).toBeNull();
    expect(motion.complete("pat")).toEqual({ id: "dance", loop: false });
    expect(motion.complete("dance")?.id).toBe("idle_breathe");
    expect(motion.update("idle", { id: 2, action: "dance" })).toBeNull();
  });

  it("retains queued manual interactions across ordinary task state changes", () => {
    for (const mood of ["thinking", "working", "waiting"] as const) {
      const motion = new CompanionMotionScheduler();
      motion.update("greeting", { id: 1, action: "pat" });
      motion.update("greeting", { id: 2, action: "dance" });
      expect(motion.update(mood, { id: 2, action: "dance" })).toBeNull();
      expect(motion.complete("pat")?.id).toBe("dance");
      expect(motion.complete("dance")?.id).toBe(
        { thinking: "thinking_enter", working: "working_enter", waiting: "waiting" }[mood],
      );
    }
  });

  it("discards a queued interaction when an urgent actual state interrupts it", () => {
    for (const mood of ["success", "error", "dragging", "sleeping"] as const) {
      const motion = new CompanionMotionScheduler();
      motion.update("greeting", { id: 1, action: "pat" });
      motion.update("greeting", { id: 2, action: "dance" });
      expect(motion.update(mood, { id: 2, action: "dance" })?.id).toBe(
        { success: "success", error: "error", dragging: "drag_pickup", sleeping: "sleep_start" }[
          mood
        ],
      );
      expect(motion.complete("pat")).toBeNull();
      const next = motion.complete(
        { success: "success", error: "error", dragging: "drag_pickup", sleeping: "sleep_start" }[
          mood
        ] as "success" | "error" | "drag_pickup" | "sleep_start",
      );
      expect(next?.id).not.toBe("dance");
    }
  });

  it("lets terminal states, drag, and sleep interrupt a manual interaction", () => {
    for (const mood of ["success", "error", "dragging", "sleeping"] as const) {
      const motion = new CompanionMotionScheduler();
      motion.update("idle", { id: 1, action: "dance" });
      expect(motion.update(mood, { id: 1, action: "dance" })?.id).toBe(
        { success: "success", error: "error", dragging: "drag_pickup", sleeping: "sleep_start" }[
          mood
        ],
      );
      expect(motion.complete("dance")).toBeNull();
    }
  });

  it("does not replay terminal states while a mood is unchanged", () => {
    const motion = new CompanionMotionScheduler();
    expect(motion.update("success", null)?.id).toBe("success");
    expect(motion.complete("success")?.id).toBe("idle_breathe");
    expect(motion.update("success", null)).toBeNull();
  });

  it("enters and explicitly exits reading without changing task state", () => {
    const motion = new CompanionMotionScheduler();
    motion.update("idle", null);
    expect(motion.update("idle", { id: 2, action: "read_enter" })?.id).toBe("read_enter");
    expect(motion.complete("read_enter")).toEqual({ id: "read_loop", loop: true });
    expect(motion.update("idle", { id: 3, action: "read_exit" })).toEqual({
      id: "read_exit",
      loop: false,
    });
    expect(motion.complete("read_exit")?.id).toBe("idle_breathe");
  });

  it("plays each manual pose preview once and can cancel it", () => {
    const motion = new CompanionMotionScheduler();
    expect(motion.update("idle", { id: 1, action: "walk_left" })?.id).toBe("turn_left");
    expect(motion.complete("turn_left")).toEqual({ id: "walk_left", loop: false });
    expect(motion.complete("walk_left")).toEqual({ id: "stop_left", loop: false });
    expect(motion.complete("stop_left")?.id).toBe("idle_breathe");
    expect(motion.update("idle", { id: 2, action: "walk_right" })?.id).toBe("turn_right");
    expect(motion.complete("turn_right")?.id).toBe("walk_right");
    expect(motion.update("idle", { id: 3, action: "cancel_interaction" })?.id).toBe("stop_right");
    expect(motion.complete("stop_right")?.id).toBe("idle_breathe");
  });

  it("discards a preview when a real task changes", () => {
    const motion = new CompanionMotionScheduler();
    expect(motion.update("idle", { id: 1, action: "preview_thinking" })?.id).toBe("thinking_enter");
    expect(motion.complete("thinking_enter")?.id).toBe("thinking_loop");
    expect(motion.update("working", { id: 1, action: "preview_thinking" })?.id).toBe(
      "working_enter",
    );
  });

  it("makes drag take priority and returns through landing", () => {
    const motion = new CompanionMotionScheduler();
    motion.update("thinking", null);
    expect(motion.update("dragging", null)?.id).toBe("drag_pickup");
    expect(motion.update("idle", null)?.id).toBe("drop_land");
    expect(motion.complete("drop_land")?.id).toBe("idle_breathe");
  });

  it("does not replay requests or stale terminal moods after being hidden", () => {
    const motion = new CompanionMotionScheduler();
    const request = { id: 4, action: "pat" } as const;
    motion.update("idle", request);
    motion.reset("success", request);
    expect(motion.update("success", request)?.id).toBe("idle_breathe");
    expect(motion.update("thinking", request)?.id).toBe("thinking_enter");
  });

  it("stops retrying a failed clip until a new state or interaction", () => {
    const motion = new CompanionMotionScheduler();
    motion.update("idle", null);
    motion.fail("idle_breathe");
    expect(motion.update("idle", null)).toBeNull();
    expect(motion.update("idle", { id: 4, action: "pat" })?.id).toBe("pat");
  });

  it("keeps an idle action playing across non-interrupting state pushes", () => {
    const motion = new CompanionMotionScheduler();
    const request = { id: 1, action: "stretch", source: "idle" } as const;
    expect(motion.update("idle", request)?.id).toBe("stretch");
    expect(motion.update("idle", request)).toBeNull();
    expect(motion.complete("stretch")?.id).toBe("idle_breathe");
  });

  it("immediately interrupts idle actions for real tasks or quiet mode", () => {
    for (const mood of ["thinking", "working", "waiting", "idle"] as const) {
      const motion = new CompanionMotionScheduler();
      const request = { id: 1, action: "dance", source: "idle" } as const;
      motion.update("idle", request);
      expect(motion.update(mood, request, false)?.id).toBe(
        {
          thinking: "thinking_enter",
          working: "working_enter",
          waiting: "waiting",
          idle: "idle_breathe",
        }[mood],
      );
      expect(motion.complete("dance")).toBeNull();
    }
  });

  it("rejects idle requests when busy or not allowed without replaying them later", () => {
    const motion = new CompanionMotionScheduler();
    const request = { id: 1, action: "drink", source: "idle" } as const;
    expect(motion.update("working", request)?.id).toBe("working_enter");
    expect(motion.complete("working_enter")?.id).toBe("working_loop");
    expect(motion.update("idle", request)?.id).toBe("working_exit");
    expect(motion.complete("working_exit")?.id).toBe("idle_breathe");
    expect(motion.update("idle", { ...request, id: 2 }, false)).toBeNull();
    expect(motion.update("idle", { ...request, id: 2 }, true)).toBeNull();
  });

  it("lets manual interactions interrupt idle actions and ignores idle requests during manual ones", () => {
    const motion = new CompanionMotionScheduler();
    motion.update("idle", { id: 1, action: "dance", source: "idle" });
    expect(motion.update("idle", { id: 2, action: "pat", source: "manual" })?.id).toBe("pat");
    expect(motion.update("idle", { id: 3, action: "stretch", source: "idle" })).toBeNull();
    expect(motion.complete("pat")?.id).toBe("idle_breathe");
  });

  it("marks automatic greetings for immediate quiet-mode interruption", () => {
    const motion = new CompanionMotionScheduler();
    expect(motion.update("greeting", null)).toEqual({
      id: "greet_wave",
      loop: false,
      automatic: true,
    });
    expect(motion.update("idle", null, false)?.id).toBe("idle_breathe");
    expect(motion.complete("greet_wave")).toBeNull();
  });

  it("bounds idle reading to one clip and lets real work interrupt it", () => {
    const request = { id: 1, action: "read_enter", source: "idle" } as const;
    const motion = new CompanionMotionScheduler();
    expect(motion.update("idle", request)).toEqual({
      id: "read_enter",
      loop: false,
      automatic: true,
    });
    expect(motion.complete("read_enter")?.id).toBe("idle_breathe");
    motion.update("idle", { ...request, id: 2 });
    expect(motion.update("working", { ...request, id: 2 }, false)?.id).toBe("working_enter");
    expect(motion.complete("read_enter")).toBeNull();
  });

  it("does not append automatic greetings after manual interactions in quiet mode", () => {
    const motion = new CompanionMotionScheduler();
    expect(motion.update("greeting", { id: 1, action: "pat" }, false, false)?.id).toBe("pat");
    expect(motion.complete("pat")?.id).toBe("idle_breathe");
    expect(new CompanionMotionScheduler().update("greeting", null, false, false)?.id).toBe(
      "idle_breathe",
    );
  });

  it("keeps greeting permission independent from idle frequency", () => {
    const motion = new CompanionMotionScheduler();
    expect(motion.update("greeting", null, false, true)?.id).toBe("greet_wave");
    expect(motion.update("greeting", null, false, true)).toBeNull();
    expect(motion.update("greeting", null, false, false)?.id).toBe("idle_breathe");
    const idleWave = new CompanionMotionScheduler();
    const request = { id: 1, action: "greet_wave", source: "idle" } as const;
    expect(idleWave.update("idle", request, true, true)?.id).toBe("greet_wave");
    expect(idleWave.update("idle", request, false, true)?.id).toBe("idle_breathe");
  });
});
