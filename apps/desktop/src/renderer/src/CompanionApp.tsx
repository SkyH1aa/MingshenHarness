import { ListTodo, MessageCircle, MoreHorizontal } from "lucide-react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CompanionAction,
  CompanionMood,
  CompanionPreferences,
  CompanionState,
} from "../../shared/desktop-companion";
import {
  COMPANION_TASK_PANEL_HEIGHT,
  DEFAULT_COMPANION_PREFERENCES,
} from "../../shared/desktop-companion";
import characterUrl from "../companion-assets/atom-companion.png";
import { CompanionTaskPanel } from "./CompanionTaskPanel";
import { CompanionVideo } from "./CompanionVideo";

const MOOD_LABELS: Record<CompanionMood, [string, string]> = {
  idle: ["待命", "Idle"],
  greeting: ["问候", "Greeting"],
  thinking: ["思考中", "Thinking"],
  working: ["处理中", "Working"],
  waiting: ["等待中", "Waiting"],
  success: ["已完成", "Complete"],
  error: ["需要注意", "Needs attention"],
  resting: ["休息中", "Resting"],
  sleeping: ["休眠", "Sleeping"],
  dragging: ["移动中", "Moving"],
  hover: ["待命", "Idle"],
};

const FALLBACK_STATE: CompanionState = {
  visible: true,
  mood: "idle",
  message: null,
  progress: null,
  locale: "zh",
  tasks: [],
  taskPanelOpen: false,
  layout: { avatarSize: DEFAULT_COMPANION_PREFERENCES.size, panelHeight: 0 },
  motionRequest: null,
  manualSleeping: false,
  preferences: DEFAULT_COMPANION_PREFERENCES,
  updatedAt: Date.now(),
};

let companionReadySent = false;

function hasBridge(): boolean {
  return Boolean(window.companion);
}

function clampProgress(progress: number | null): number {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function moodClass(mood: CompanionMood): string {
  return `mood-${mood}`;
}

export function CompanionApp() {
  const [state, setState] = useState<CompanionState>(FALLBACK_STATE);
  const [preferences, setPreferences] = useState<CompanionPreferences>(FALLBACK_STATE.preferences);
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [videoVisible, setVideoVisible] = useState(false);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [patPulse, setPatPulse] = useState<{ id: number; x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLButtonElement>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0 });
  const movedDuringDragRef = useRef(false);
  const pointerDownRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const dragActiveRef = useRef(false);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ x: number; y: number } | null>(null);
  const patPulseIdRef = useRef(0);

  useEffect(() => {
    const bridge = window.companion;
    if (!bridge) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const report = () => {
      void bridge
        .setMotionAvailability(!query.matches && document.visibilityState === "visible")
        .catch(() => undefined);
    };
    report();
    query.addEventListener("change", report);
    document.addEventListener("visibilitychange", report);
    return () => {
      query.removeEventListener("change", report);
      document.removeEventListener("visibilitychange", report);
      void bridge.setMotionAvailability(false).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const bridge = window.companion;
    if (!bridge) return;
    if (!companionReadySent) {
      void bridge.ready().catch(() => undefined);
      companionReadySent = true;
    }

    let active = true;
    let receivedPush = false;
    void bridge
      .getState()
      .then((next) => {
        if (!active || receivedPush) return;
        setState(next);
        setPreferences(next.preferences);
      })
      .catch(() => undefined);
    const unsubscribe = bridge.onState((next) => {
      if (!active) return;
      receivedPush = true;
      setState(next);
      setPreferences(next.preferences);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const runAction = useCallback(async (action: CompanionAction) => {
    const bridge = window.companion;
    if (!bridge) return;
    try {
      await bridge.action(action);
    } catch {
      // The main process remains the source of truth; a stale companion frame
      // is safer than inventing a state when the window is being dismissed.
    }
  }, []);

  const openMenu = useCallback(() => {
    void window.companion?.openMenu().catch(() => undefined);
  }, []);

  const openQuickChat = useCallback(() => {
    void window.companion?.openQuickChat().catch(() => undefined);
  }, []);

  const respondToPat = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const stage = stageRef.current;
      if (!stage) return;
      const bounds = stage.getBoundingClientRect();
      const x = event.detail === 0 ? 50 : ((event.clientX - bounds.left) / bounds.width) * 100;
      const y = event.detail === 0 ? 48 : ((event.clientY - bounds.top) / bounds.height) * 100;
      patPulseIdRef.current += 1;
      const pulseId = patPulseIdRef.current;
      setPatPulse({
        id: pulseId,
        x: Math.max(12, Math.min(88, x)),
        y: Math.max(12, Math.min(88, y)),
      });
      window.setTimeout(() => {
        setPatPulse((current) => (current?.id === pulseId ? null : current));
      }, 700);
      void runAction({ type: "pat" });
    },
    [runAction],
  );

  const flushDrag = useCallback(() => {
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    const position = pendingDragRef.current;
    pendingDragRef.current = null;
    if (position) void runAction({ type: "drag", ...position });
  }, [runAction]);

  useEffect(
    () => () => {
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!preferences.positionLocked || !dragActiveRef.current) return;
    pointerDownRef.current = false;
    dragActiveRef.current = false;
    movedDuringDragRef.current = true;
    pendingDragRef.current = null;
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
    const pointerId = pointerIdRef.current;
    pointerIdRef.current = null;
    if (pointerId !== null && stageRef.current?.hasPointerCapture(pointerId))
      stageRef.current.releasePointerCapture(pointerId);
    setIsDragging(false);
  }, [preferences.positionLocked]);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const stage = stageRef.current;
      if (!stage) return;
      const bounds = stage.getBoundingClientRect();
      const x = Math.max(
        -1,
        Math.min(1, (event.clientX - (bounds.left + bounds.width / 2)) / bounds.width),
      );
      const y = Math.max(
        -1,
        Math.min(1, (event.clientY - (bounds.top + bounds.height / 2)) / bounds.height),
      );
      setGaze({ x, y });
      if (!pointerDownRef.current || preferences.positionLocked) return;
      if (!dragActiveRef.current) {
        const dx = event.screenX - dragStartRef.current.x;
        const dy = event.screenY - dragStartRef.current.y;
        if (Math.hypot(dx, dy) <= 4) return;
        movedDuringDragRef.current = true;
        dragActiveRef.current = true;
        setIsDragging(true);
        void runAction({ type: "drag-start" });
      }
      pendingDragRef.current = {
        x: event.screenX - dragOffsetRef.current.x,
        y: event.screenY - dragOffsetRef.current.y,
      };
      if (dragFrameRef.current === null)
        dragFrameRef.current = window.requestAnimationFrame(flushDrag);
    },
    [flushDrag, preferences.positionLocked, runAction],
  );

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragOffsetRef.current = {
      x: event.screenX - window.screenX,
      y: event.screenY - window.screenY,
    };
    dragStartRef.current = { x: event.screenX, y: event.screenY };
    movedDuringDragRef.current = false;
    pointerDownRef.current = true;
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      pointerIdRef.current = null;
      if (cancelled) movedDuringDragRef.current = true;
      const wasDragging = dragActiveRef.current;
      dragActiveRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!wasDragging) return;
      if (!cancelled) {
        pendingDragRef.current = {
          x: event.screenX - dragOffsetRef.current.x,
          y: event.screenY - dragOffsetRef.current.y,
        };
      }
      flushDrag();
      setIsDragging(false);
      void runAction({ type: "drag-end" });
    },
    [flushDrag, runAction],
  );

  const rootStyle = useMemo(
    () =>
      ({
        "--companion-size": `${state.layout.avatarSize}px`,
        "--companion-panel-height": `${state.layout.panelHeight || COMPANION_TASK_PANEL_HEIGHT}px`,
        "--gaze-x": `${gaze.x * 5}px`,
        "--gaze-y": `${gaze.y * 3}px`,
        "--progress": `${clampProgress(state.progress)}%`,
      }) as CSSProperties,
    [gaze.x, gaze.y, state.layout.avatarSize, state.layout.panelHeight, state.progress],
  );

  const mood = isDragging ? "dragging" : state.mood;
  const showStatus =
    isHovering || Boolean(state.message) || mood !== "idle" || state.tasks.length > 0;
  const actualTaskMood = state.tasks.some((task) => task.status === "waiting")
    ? "waiting"
    : state.tasks.some((task) => task.status === "working")
      ? "working"
      : state.tasks.some((task) => task.status === "thinking")
        ? "thinking"
        : null;
  const localeIndex = state.locale === "en" ? 1 : 0;
  const label = MOOD_LABELS[actualTaskMood ?? mood][localeIndex];
  const menuLabel = state.locale === "en" ? "Companion menu" : "桌宠菜单";
  const chatLabel = state.locale === "en" ? "Quick chat" : "快捷对话";
  const canShowTasks = preferences.taskPanelEnabled && state.tasks.length > 0;
  const panelOpen = state.visible && canShowTasks && state.taskPanelOpen;
  const panelLabel = panelOpen
    ? state.locale === "en"
      ? "Collapse working conversations"
      : "折叠工作会话"
    : state.locale === "en"
      ? "Expand working conversations"
      : "展开工作会话";
  const toggleTaskPanel = () => void runAction({ type: "task-panel", open: !panelOpen });
  const openSession = async (sessionId: string) => {
    const bridge = window.companion;
    if (!bridge)
      throw new Error(state.locale === "en" ? "Companion is unavailable." : "桌宠暂不可用。");
    await bridge.openSession(sessionId);
  };

  return (
    <main
      className={`companion-surface ${moodClass(mood)}${isHovering ? " is-hovering" : ""}${isDragging ? " is-dragging" : ""}${patPulse ? " is-patting" : ""}${videoVisible ? " has-motion" : ""}${preferences.animationEnabled ? "" : " no-motion"}`}
      style={rootStyle}
      aria-label={state.locale === "en" ? "Mingshen companion" : "Mingshen 桌宠"}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu();
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          openMenu();
        }
      }}
    >
      <div className="companion-avatar">
        <button
          type="button"
          ref={stageRef}
          className="companion-stage"
          aria-label={state.locale === "en" ? "Pat companion" : "轻拍桌宠"}
          onPointerEnter={() => {
            setIsHovering(true);
          }}
          onPointerLeave={() => {
            setIsHovering(false);
            setGaze({ x: 0, y: 0 });
          }}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={(event) => finishPointer(event, false)}
          onPointerCancel={(event) => finishPointer(event, true)}
          onLostPointerCapture={(event) => finishPointer(event, true)}
          onClick={(event) => {
            if (
              !isDragging &&
              (event.detail === 0 || (!movedDuringDragRef.current && event.detail === 1))
            ) {
              respondToPat(event);
            }
          }}
        >
          <span className="companion-orbit" aria-hidden="true">
            <svg viewBox="0 0 220 150" role="presentation">
              <ellipse className="orbit-line orbit-line-a" cx="110" cy="75" rx="96" ry="40" />
              <ellipse className="orbit-line orbit-line-b" cx="110" cy="75" rx="96" ry="40" />
              <circle className="orbit-core" cx="110" cy="75" r="4" />
            </svg>
          </span>
          <span className="companion-signal" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="companion-figure" aria-hidden="true">
            <CompanionVideo
              mood={mood}
              request={state.motionRequest}
              enabled={preferences.animationEnabled && state.visible}
              greetingAllowed={!preferences.quietMode && preferences.greetingEnabled}
              idleAllowed={
                state.tasks.length === 0 &&
                preferences.idleAnimationFrequency !== "off" &&
                !preferences.quietMode &&
                !state.manualSleeping &&
                !isDragging
              }
              onVisibleChange={setVideoVisible}
            />
            <img className="companion-character" src={characterUrl} alt="" draggable={false} />
            <svg
              className="companion-face-effects"
              viewBox="0 0 299 742"
              preserveAspectRatio="xMidYMax meet"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="companion-eyelid-skin" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#f8d8c8" />
                  <stop offset="0.58" stopColor="#f3c9b8" />
                  <stop offset="1" stopColor="#eab4a3" />
                </linearGradient>
                <linearGradient id="companion-arm-signal" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#71f4ff" stopOpacity="0" />
                  <stop offset="0.5" stopColor="#d3ffff" stopOpacity="0.95" />
                  <stop offset="1" stopColor="#71f4ff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g className="companion-eye-blinks">
                <g className="companion-blink-lid companion-blink-left">
                  <path
                    d="M88 170 C95 166 105 164 114 166 C119 168 123 171 124 175 C122 181 119 186 115 189 C107 192 98 188 93 183 C90 179 88 175 88 170Z"
                    fill="url(#companion-eyelid-skin)"
                  />
                  <path d="M89 171 C98 165 111 164 122 171" />
                </g>
                <g className="companion-blink-lid companion-blink-right">
                  <path
                    d="M152 161 C160 156 171 153 181 155 C188 157 193 161 195 165 C193 172 189 178 184 181 C176 185 165 181 158 176 C154 172 152 167 152 161Z"
                    fill="url(#companion-eyelid-skin)"
                  />
                  <path d="M153 161 C164 154 180 153 193 162" />
                </g>
              </g>
              <g className="companion-eye-sleep">
                <path
                  className="companion-sleep-cover"
                  d="M88 170 C95 166 105 164 114 166 C119 168 123 171 124 175 C122 181 119 186 115 189 C107 192 98 188 93 183 C90 179 88 175 88 170Z"
                />
                <path
                  className="companion-sleep-cover"
                  d="M152 161 C160 156 171 153 181 155 C188 157 193 161 195 165 C193 172 189 178 184 181 C176 185 165 181 158 176 C154 172 152 167 152 161Z"
                />
                <path d="M89 171 C98 165 111 164 122 171" />
                <path d="M153 161 C164 154 180 153 193 162" />
              </g>
              <g className="companion-work-reactor" fill="none">
                <ellipse cx="143" cy="279" rx="18" ry="14" />
                <circle cx="143" cy="279" r="21" />
                <path d="M143 251 v7 M143 300 v7 M112 279 h8 M166 279 h8" />
              </g>
            </svg>
          </span>
          {patPulse ? (
            <span
              key={patPulse.id}
              className="companion-pat-ripple"
              style={{ left: `${patPulse.x}%`, top: `${patPulse.y}%` }}
              onAnimationEnd={() => {
                setPatPulse((current) => (current?.id === patPulse.id ? null : current));
              }}
              aria-hidden="true"
            />
          ) : null}
          <span className="companion-ground" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`companion-status${showStatus ? " is-visible" : ""}`}
          aria-label={`${label}${state.tasks.length > 1 ? ` (${state.tasks.length})` : ""}. ${state.message ?? ""} ${canShowTasks ? panelLabel : menuLabel}`}
          aria-live="polite"
          onClick={canShowTasks ? toggleTaskPanel : openMenu}
        >
          <span className="status-dot" aria-hidden="true" />
          <span className="status-label">{label}</span>
          {state.tasks.length > 1 ? (
            <span className="status-count">{state.tasks.length}</span>
          ) : null}
          {state.progress !== null && mood === "working" ? (
            <span className="status-progress">{Math.round(clampProgress(state.progress))}%</span>
          ) : null}
          {state.message ? <span className="status-message">{state.message}</span> : null}
        </button>

        <div className="companion-actions">
          {canShowTasks ? (
            <button
              type="button"
              className="companion-action"
              title={panelLabel}
              aria-label={panelLabel}
              aria-expanded={panelOpen}
              {...(panelOpen ? { "aria-controls": "companion-working-conversations" } : {})}
              onClick={toggleTaskPanel}
            >
              <ListTodo size={14} strokeWidth={1.8} />
            </button>
          ) : null}
          <button
            type="button"
            className="companion-action"
            title={chatLabel}
            aria-label={chatLabel}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openQuickChat}
          >
            <MessageCircle size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="companion-action"
            title={menuLabel}
            aria-label={menuLabel}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openMenu}
          >
            <MoreHorizontal size={15} strokeWidth={1.8} />
          </button>
        </div>

        {!hasBridge() ? <span className="companion-dev-note">桌宠预览</span> : null}
      </div>
      {panelOpen ? (
        <CompanionTaskPanel
          tasks={state.tasks}
          locale={state.locale}
          showTitles={preferences.showSessionTitles}
          onCollapse={() => void runAction({ type: "task-panel", open: false })}
          onOpenSession={openSession}
        />
      ) : null}
    </main>
  );
}
