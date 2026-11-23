import type { ChatStreamEvent } from "./domain";

export const COMPANION_IPC_CHANNELS = {
  getState: "companion:get-state",
  getPreferences: "companion:get-preferences",
  setPreferences: "companion:set-preferences",
  show: "companion:show",
  hide: "companion:hide",
  toggle: "companion:toggle",
  action: "companion:action",
  openMenu: "companion:open-menu",
  openQuickChat: "companion:open-quick-chat",
  openSession: "companion:open-session",
  setMotionAvailability: "companion:set-motion-availability",
  ready: "companion:ready",
  state: "companion:state",
} as const;

export type CompanionMood =
  | "idle"
  | "greeting"
  | "thinking"
  | "working"
  | "waiting"
  | "success"
  | "error"
  | "resting"
  | "sleeping"
  | "dragging"
  | "hover";

export type CompanionChattiness = "off" | "low" | "normal" | "high";
export type CompanionIdleAnimationFrequency = "off" | "low" | "normal" | "high";

export const COMPANION_TASK_PANEL_HEIGHT = 144;
export const COMPANION_TASK_PANEL_MIN_WIDTH = 272;

export const COMPANION_INTERACTION_MOTIONS = [
  "greet_wave",
  "pat",
  "nod",
  "shake_head",
  "look_around",
  "stretch",
  "dance",
  "jump",
  "drink",
  "listen",
  "notify",
  "read_enter",
  "read_exit",
  "walk_left",
  "walk_right",
  "preview_thinking",
  "preview_working",
  "preview_waiting",
  "preview_success",
  "preview_error",
  "preview_sleep",
  "cancel_interaction",
] as const;

export type CompanionInteractionMotion = (typeof COMPANION_INTERACTION_MOTIONS)[number];
export type CompanionInteraction = CompanionInteractionMotion | "sleep" | "wake";

export interface CompanionTaskSummary {
  sessionId: string;
  runId: string;
  title: string | null;
  status: "thinking" | "working" | "waiting";
  startedAt: number;
}

export function companionTaskStatusPriority(status: CompanionTaskSummary["status"]): number {
  return status === "waiting" ? 2 : status === "working" ? 1 : 0;
}

export function compareCompanionTasks(a: CompanionTaskSummary, b: CompanionTaskSummary): number {
  return (
    companionTaskStatusPriority(b.status) - companionTaskStatusPriority(a.status) ||
    a.startedAt - b.startedAt
  );
}

export interface CompanionPoint {
  x: number;
  y: number;
}

export interface CompanionLayout {
  avatarSize: number;
  panelHeight: number;
}

export interface CompanionPreferences {
  enabled: boolean;
  alwaysOnTop: boolean;
  animationEnabled: boolean;
  positionLocked: boolean;
  opacity: number;
  size: number;
  position: CompanionPoint | null;
  greetingEnabled: boolean;
  chattiness: CompanionChattiness;
  restAfterMinutes: number;
  taskHintsEnabled: boolean;
  taskPanelEnabled: boolean;
  showSessionTitles: boolean;
  quietMode: boolean;
  idleAnimationFrequency: CompanionIdleAnimationFrequency;
}

export interface CompanionState {
  visible: boolean;
  mood: CompanionMood;
  message: string | null;
  progress: number | null;
  locale: "zh" | "en";
  tasks: CompanionTaskSummary[];
  taskPanelOpen: boolean;
  layout: CompanionLayout;
  motionRequest: {
    id: number;
    action: CompanionInteractionMotion;
    source: "manual" | "idle";
  } | null;
  manualSleeping: boolean;
  preferences: CompanionPreferences;
  updatedAt: number;
}

export type CompanionAction =
  | { type: "pat" }
  | { type: "dismiss" }
  | { type: "interact"; action: CompanionInteraction }
  | { type: "hover"; active: boolean }
  | { type: "task-panel"; open: boolean }
  | { type: "drag-start" }
  | { type: "drag-end" }
  | { type: "drag"; x: number; y: number };

export const DEFAULT_COMPANION_PREFERENCES: CompanionPreferences = {
  enabled: false,
  alwaysOnTop: true,
  animationEnabled: true,
  positionLocked: false,
  opacity: 1,
  size: 176,
  position: null,
  greetingEnabled: true,
  chattiness: "low",
  restAfterMinutes: 45,
  taskHintsEnabled: true,
  taskPanelEnabled: true,
  showSessionTitles: true,
  quietMode: false,
  idleAnimationFrequency: "normal",
};

export const COMPANION_LIMITS = {
  minOpacity: 0.35,
  maxOpacity: 1,
  minSize: 96,
  maxSize: 320,
  maxMessageLength: 120,
  maxPositionMagnitude: 10_000_000,
  minRestAfterMinutes: 0,
  maxRestAfterMinutes: 240,
} as const;

const CHATTER_INTERVAL_MS: Record<CompanionChattiness, number> = {
  off: 0,
  low: 60 * 60 * 1000,
  normal: 30 * 60 * 1000,
  high: 15 * 60 * 1000,
};

export function normalizeCompanionPreferences(value: unknown): CompanionPreferences {
  const input = isRecord(value) ? value : {};
  const position = normalizePosition(input.position);
  return {
    enabled:
      typeof input.enabled === "boolean" ? input.enabled : DEFAULT_COMPANION_PREFERENCES.enabled,
    alwaysOnTop:
      typeof input.alwaysOnTop === "boolean"
        ? input.alwaysOnTop
        : DEFAULT_COMPANION_PREFERENCES.alwaysOnTop,
    animationEnabled:
      typeof input.animationEnabled === "boolean"
        ? input.animationEnabled
        : DEFAULT_COMPANION_PREFERENCES.animationEnabled,
    positionLocked:
      typeof input.positionLocked === "boolean"
        ? input.positionLocked
        : DEFAULT_COMPANION_PREFERENCES.positionLocked,
    opacity: normalizeNumber(
      input.opacity,
      DEFAULT_COMPANION_PREFERENCES.opacity,
      COMPANION_LIMITS.minOpacity,
      COMPANION_LIMITS.maxOpacity,
      2,
    ),
    size: normalizeNumber(
      input.size,
      DEFAULT_COMPANION_PREFERENCES.size,
      COMPANION_LIMITS.minSize,
      COMPANION_LIMITS.maxSize,
      0,
    ),
    position,
    greetingEnabled:
      typeof input.greetingEnabled === "boolean"
        ? input.greetingEnabled
        : DEFAULT_COMPANION_PREFERENCES.greetingEnabled,
    chattiness: isChattiness(input.chattiness)
      ? input.chattiness
      : DEFAULT_COMPANION_PREFERENCES.chattiness,
    restAfterMinutes: normalizeNumber(
      input.restAfterMinutes,
      DEFAULT_COMPANION_PREFERENCES.restAfterMinutes,
      COMPANION_LIMITS.minRestAfterMinutes,
      COMPANION_LIMITS.maxRestAfterMinutes,
      0,
    ),
    taskHintsEnabled:
      typeof input.taskHintsEnabled === "boolean"
        ? input.taskHintsEnabled
        : DEFAULT_COMPANION_PREFERENCES.taskHintsEnabled,
    taskPanelEnabled:
      typeof input.taskPanelEnabled === "boolean"
        ? input.taskPanelEnabled
        : DEFAULT_COMPANION_PREFERENCES.taskPanelEnabled,
    showSessionTitles:
      typeof input.showSessionTitles === "boolean"
        ? input.showSessionTitles
        : DEFAULT_COMPANION_PREFERENCES.showSessionTitles,
    quietMode:
      typeof input.quietMode === "boolean"
        ? input.quietMode
        : DEFAULT_COMPANION_PREFERENCES.quietMode,
    idleAnimationFrequency: isChattiness(input.idleAnimationFrequency)
      ? input.idleAnimationFrequency
      : DEFAULT_COMPANION_PREFERENCES.idleAnimationFrequency,
  };
}

export function normalizeCompanionPatch(value: unknown): Partial<CompanionPreferences> {
  if (!isRecord(value)) throw new Error("Invalid desktop companion preferences.");
  const allowed = new Set<keyof CompanionPreferences>([
    "enabled",
    "alwaysOnTop",
    "animationEnabled",
    "positionLocked",
    "opacity",
    "size",
    "position",
    "greetingEnabled",
    "chattiness",
    "restAfterMinutes",
    "taskHintsEnabled",
    "taskPanelEnabled",
    "showSessionTitles",
    "quietMode",
    "idleAnimationFrequency",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key as keyof CompanionPreferences)))
    throw new Error("Unknown desktop companion preference.");

  for (const key of [
    "enabled",
    "alwaysOnTop",
    "animationEnabled",
    "positionLocked",
    "greetingEnabled",
    "taskHintsEnabled",
    "taskPanelEnabled",
    "showSessionTitles",
    "quietMode",
  ] as const) {
    if (key in value && typeof value[key] !== "boolean")
      throw new Error(`Invalid desktop companion preference: ${key}.`);
  }
  for (const key of ["opacity", "size", "restAfterMinutes"] as const) {
    if (key in value && (typeof value[key] !== "number" || !Number.isFinite(value[key])))
      throw new Error(`Invalid desktop companion preference: ${key}.`);
  }
  if ("chattiness" in value && !isChattiness(value.chattiness))
    throw new Error("Invalid desktop companion preference: chattiness.");
  if ("idleAnimationFrequency" in value && !isChattiness(value.idleAnimationFrequency))
    throw new Error("Invalid desktop companion preference: idleAnimationFrequency.");
  if ("position" in value && value.position !== null && !normalizePosition(value.position))
    throw new Error("Invalid desktop companion preference: position.");

  const normalized = normalizeCompanionPreferences({ ...DEFAULT_COMPANION_PREFERENCES, ...value });
  const patch: Partial<CompanionPreferences> = {};
  for (const key of Object.keys(value) as (keyof CompanionPreferences)[]) {
    (patch as Record<keyof CompanionPreferences, unknown>)[key] = normalized[key];
  }
  return patch;
}

export function normalizeCompanionAction(value: unknown): CompanionAction {
  if (!isRecord(value) || typeof value.type !== "string")
    throw new Error("Invalid desktop companion action.");
  if (
    (value.type === "pat" ||
      value.type === "dismiss" ||
      value.type === "drag-start" ||
      value.type === "drag-end") &&
    Object.keys(value).length === 1
  )
    return { type: value.type };
  if (
    value.type === "hover" &&
    typeof value.active === "boolean" &&
    Object.keys(value).length === 2
  )
    return { type: "hover", active: value.active };
  if (
    value.type === "task-panel" &&
    typeof value.open === "boolean" &&
    Object.keys(value).length === 2
  )
    return { type: "task-panel", open: value.open };
  if (value.type === "interact" && Object.keys(value).length === 2) {
    return { type: "interact", action: normalizeCompanionInteraction(value.action) };
  }
  if (value.type === "drag" && Object.keys(value).length === 3) {
    const point = normalizePosition({ x: value.x, y: value.y });
    if (!point) throw new Error("Invalid desktop companion position.");
    return { type: "drag", ...point };
  }
  throw new Error("Unsupported desktop companion action.");
}

export function normalizeCompanionInteraction(value: unknown): CompanionInteraction {
  if (
    value === "sleep" ||
    value === "wake" ||
    (typeof value === "string" &&
      COMPANION_INTERACTION_MOTIONS.includes(value as CompanionInteractionMotion))
  )
    return value as CompanionInteraction;
  throw new Error("Unsupported desktop companion interaction.");
}

export function chatterIntervalMs(chattiness: CompanionChattiness): number {
  return CHATTER_INTERVAL_MS[chattiness];
}

export function isCompanionTaskEvent(event: ChatStreamEvent): boolean {
  return [
    "run_started",
    "activity",
    "run_completed",
    "run_interrupted",
    "run_failed",
    "approval_required",
    "question_required",
    "approval_state",
    "question_state",
    "question_resolved",
    "session_updated",
    "session_removed",
  ].includes(event.type);
}

function normalizePosition(value: unknown): CompanionPoint | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;
  const x = value.x;
  const y = value.y;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.abs(x) > COMPANION_LIMITS.maxPositionMagnitude ||
    Math.abs(y) > COMPANION_LIMITS.maxPositionMagnitude
  )
    return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  decimals: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const precision = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, value)) * precision) / precision;
}

function isChattiness(value: unknown): value is CompanionChattiness {
  return value === "off" || value === "low" || value === "normal" || value === "high";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
