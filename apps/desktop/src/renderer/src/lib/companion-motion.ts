import type { CompanionMood } from "../../../shared/desktop-companion";

export type CompanionMotionId =
  | "idle_breathe"
  | "look_around"
  | "greet_wave"
  | "nod"
  | "shake_head"
  | "pat"
  | "stretch"
  | "dance"
  | "jump"
  | "drink"
  | "thinking_enter"
  | "thinking_loop"
  | "thinking_exit"
  | "working_enter"
  | "working_loop"
  | "working_exit"
  | "waiting"
  | "success"
  | "error"
  | "sleep_start"
  | "sleep_loop"
  | "sleep_end"
  | "drag_pickup"
  | "drag_loop"
  | "drop_land"
  | "turn_left"
  | "walk_left"
  | "stop_left"
  | "turn_right"
  | "walk_right"
  | "stop_right"
  | "listen"
  | "notify"
  | "read_enter"
  | "read_loop"
  | "read_exit";

export type CompanionManualMotion =
  | "greet_wave"
  | "pat"
  | "nod"
  | "shake_head"
  | "look_around"
  | "stretch"
  | "dance"
  | "jump"
  | "drink"
  | "listen"
  | "notify"
  | "read_enter"
  | "read_exit"
  | "walk_left"
  | "walk_right"
  | "preview_thinking"
  | "preview_working"
  | "preview_waiting"
  | "preview_success"
  | "preview_error"
  | "preview_sleep"
  | "cancel_interaction";

export interface CompanionMotionRequest {
  id: number;
  action: CompanionManualMotion;
  source?: "manual" | "idle";
}

export interface CompanionClip {
  id: CompanionMotionId;
  loop: boolean;
  playbackRate?: number;
  automatic?: true;
}

type Pose =
  | "front"
  | "thinking"
  | "working"
  | "sleeping"
  | "dragging"
  | "reading"
  | "left"
  | "right";
type Target = "idle" | "thinking" | "working" | "waiting" | "sleeping" | "dragging";
type CurrentClip = Omit<CompanionClip, "automatic"> & {
  endPose: Pose;
  kind: "loop" | "transition" | "one-shot" | "preview-loop";
  manual: boolean;
  automatic: boolean;
  automaticGreeting: boolean;
};

const POSE_LOOPS: Record<Exclude<Pose, "front">, CompanionMotionId> = {
  thinking: "thinking_loop",
  working: "working_loop",
  sleeping: "sleep_loop",
  dragging: "drag_loop",
  reading: "read_loop",
  left: "walk_left",
  right: "walk_right",
};

const POSE_EXITS: Record<Exclude<Pose, "front">, CompanionMotionId> = {
  thinking: "thinking_exit",
  working: "working_exit",
  sleeping: "sleep_end",
  dragging: "drop_land",
  reading: "read_exit",
  left: "stop_left",
  right: "stop_right",
};

const POSE_ENTRIES: Record<Exclude<Pose, "front">, CompanionMotionId> = {
  thinking: "thinking_enter",
  working: "working_enter",
  sleeping: "sleep_start",
  dragging: "drag_pickup",
  reading: "read_enter",
  left: "turn_left",
  right: "turn_right",
};

const PREVIEW_POSES: Partial<Record<CompanionManualMotion, Exclude<Pose, "front">>> = {
  walk_left: "left",
  walk_right: "right",
  preview_thinking: "thinking",
  preview_working: "working",
  preview_sleep: "sleeping",
};

const PREVIEW_CLIPS: Partial<Record<CompanionManualMotion, CompanionMotionId>> = {
  preview_waiting: "waiting",
  preview_success: "success",
  preview_error: "error",
};

function targetForMood(mood: CompanionMood): Target {
  if (mood === "thinking" || mood === "working" || mood === "waiting" || mood === "dragging")
    return mood;
  if (mood === "resting" || mood === "sleeping") return "sleeping";
  return "idle";
}

/** Reconciles the latest actual task state with a single transient interaction. */
export class CompanionMotionScheduler {
  private mood: CompanionMood = "idle";
  private target: Target = "idle";
  private pose: Pose = "front";
  private poseManual = false;
  private current: CurrentClip | null = null;
  private pending: CompanionMotionRequest | null = null;
  private lastRequestId: number | null = null;
  private playedMood: CompanionMood | null = null;
  private reading = false;
  private previewPose: Exclude<Pose, "front"> | null = null;
  private blocked = false;
  private greetingAllowed = true;

  update(
    mood: CompanionMood,
    request: CompanionMotionRequest | null,
    idleAllowed = true,
    greetingAllowed = idleAllowed,
  ): CompanionClip | null {
    this.greetingAllowed = greetingAllowed;
    const moodChanged = mood !== this.mood;
    const previous = this.current;
    if (moodChanged) {
      this.mood = mood;
      this.target = targetForMood(mood);
      this.playedMood = null;
      this.reading = false;
      this.previewPose = null;
      // A transient greeting can expire before its clip ends; keep queued interactions
      // until consumed or explicitly interrupted by an urgent state below.
      this.blocked = false;
    }

    let cancelInteraction = false;
    let manualRequested = false;
    if (request && request.id !== this.lastRequestId) {
      this.lastRequestId = request.id;
      const canAccept =
        request.source !== "idle" ||
        (idleAllowed &&
          this.target === "idle" &&
          !this.current?.manual &&
          !this.reading &&
          !this.previewPose &&
          (!this.pending || this.pending.source === "idle"));
      if (canAccept) {
        manualRequested = request.source !== "idle";
        if (manualRequested && mood === "greeting") this.playedMood = "greeting";
        this.reading = false;
        this.previewPose = null;
        cancelInteraction =
          request.action === "read_exit" || request.action === "cancel_interaction";
        this.pending =
          cancelInteraction || this.target === "dragging" || this.target === "sleeping"
            ? null
            : request;
        this.blocked = false;
      }
    }
    if ((!idleAllowed || this.target !== "idle") && this.pending?.source === "idle")
      this.pending = null;
    const automaticAllowed = previous?.automaticGreeting ? greetingAllowed : idleAllowed;
    if (previous?.automatic && (!automaticAllowed || this.target !== "idle" || manualRequested)) {
      this.pose = "front";
      this.poseManual = false;
      this.current = null;
    }

    if (this.blocked) return null;
    const urgent =
      this.target === "dragging" ||
      this.target === "sleeping" ||
      mood === "success" ||
      mood === "error";
    if (previous && ((moodChanged && urgent) || (cancelInteraction && previous.manual))) {
      this.pose =
        cancelInteraction && previous.manual && previous.endPose !== "front"
          ? previous.endPose
          : "front";
      this.poseManual = this.pose !== "front" && previous.manual;
      this.current = null;
      if (urgent) this.pending = null;
    } else if (this.current && previous && moodChanged && previous.id === "drag_pickup") {
      this.pose = "dragging";
      this.poseManual = false;
      this.current = null;
    } else if (
      this.current &&
      previous &&
      moodChanged &&
      (previous.kind === "transition" ||
        previous.kind === "preview-loop" ||
        (previous.kind === "loop" && previous.manual))
    ) {
      // Discard obsolete entries and previews so a fast task change cannot queue old states.
      this.pose = "front";
      this.poseManual = false;
      this.current = null;
    }

    // Normal one-shot interactions may finish while the real task badge remains authoritative.
    if (this.current && !this.current.loop) {
      return null;
    }
    return this.reconcile();
  }

  complete(id: CompanionMotionId): CompanionClip | null {
    if (!this.current || this.current.id !== id || this.current.loop || this.blocked) return null;
    this.pose = this.current.endPose;
    this.poseManual = this.pose !== "front" && this.current.manual;
    if (this.current.kind === "preview-loop") this.previewPose = null;
    this.current = null;
    return this.reconcile();
  }

  fail(id: CompanionMotionId): void {
    if (this.current?.id !== id) return;
    this.current = null;
    this.pose = "front";
    this.poseManual = false;
    this.pending = null;
    this.reading = false;
    this.previewPose = null;
    this.blocked = true;
  }

  reset(mood: CompanionMood, request: CompanionMotionRequest | null): void {
    this.current = null;
    this.pose = "front";
    this.poseManual = false;
    this.pending = null;
    this.reading = false;
    this.previewPose = null;
    this.blocked = false;
    this.mood = mood;
    this.target = targetForMood(mood);
    this.playedMood = mood;
    if (request) this.lastRequestId = request.id;
  }

  private reconcile(): CompanionClip | null {
    const desiredPose = this.desiredPose();
    if (this.pose !== "front") {
      if (desiredPose !== this.pose)
        return this.select(POSE_EXITS[this.pose], false, "front", "transition", this.poseManual);
      if (this.previewPose === this.pose)
        return this.select(POSE_LOOPS[this.pose], false, this.pose, "preview-loop", true);
      return this.select(POSE_LOOPS[this.pose], true, this.pose, "loop", this.reading);
    }

    if (this.pending && this.target !== "dragging" && this.target !== "sleeping") {
      const { action, source } = this.pending;
      this.pending = null;
      if (action === "read_enter") {
        if (source === "idle")
          return this.select("read_enter", false, "front", "one-shot", false, true);
        this.reading = true;
        return this.select("read_enter", false, "reading", "transition", true);
      }
      const previewPose = PREVIEW_POSES[action];
      if (previewPose) {
        this.previewPose = previewPose;
        return this.select(POSE_ENTRIES[previewPose], false, previewPose, "transition", true);
      }
      const previewClip = PREVIEW_CLIPS[action];
      if (previewClip) return this.select(previewClip, false, "front", "one-shot", true);
      if (action !== "read_exit" && action !== "cancel_interaction")
        return this.select(
          action as CompanionMotionId,
          false,
          "front",
          "one-shot",
          source !== "idle",
          source === "idle",
        );
    }

    if (desiredPose !== "front") return this.select(POSE_ENTRIES[desiredPose], false, desiredPose);
    if (this.target === "waiting") return this.select("waiting", true, "front");
    const moodClip =
      this.mood === "greeting" && this.greetingAllowed
        ? "greet_wave"
        : this.mood === "success"
          ? "success"
          : this.mood === "error"
            ? "error"
            : null;
    if (moodClip && this.playedMood !== this.mood) {
      this.playedMood = this.mood;
      const greeting = this.mood === "greeting";
      return this.select(moodClip, false, "front", "one-shot", false, greeting, greeting);
    }
    return this.select("idle_breathe", true, "front");
  }

  private desiredPose(): Pose {
    if (this.target === "dragging") return "dragging";
    if (this.target === "sleeping") return "sleeping";
    if (this.pending) return "front";
    if (this.reading) return "reading";
    if (this.previewPose) return this.previewPose;
    if (this.target === "thinking" || this.target === "working") return this.target;
    return "front";
  }

  private select(
    id: CompanionMotionId,
    loop: boolean,
    endPose: Pose,
    kind: CurrentClip["kind"] = loop ? "loop" : "transition",
    manual = false,
    automatic = false,
    automaticGreeting = false,
  ): CompanionClip | null {
    if (this.current?.id === id && this.current.loop === loop) return null;
    const playbackRate = kind === "transition" && !manual ? 2 : undefined;
    this.current = {
      id,
      loop,
      endPose,
      kind,
      manual,
      automatic,
      automaticGreeting,
      ...(playbackRate ? { playbackRate } : {}),
    };
    return {
      id,
      loop,
      ...(playbackRate ? { playbackRate } : {}),
      ...(automatic ? { automatic: true as const } : {}),
    };
  }
}
