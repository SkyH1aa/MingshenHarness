import { ChevronUp, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CompanionTaskSummary } from "../../shared/desktop-companion";

function elapsedLabel(startedAt: number, now: number): string {
  const total = Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function CompanionTaskPanel({
  tasks,
  locale,
  showTitles,
  onCollapse,
  onOpenSession,
}: {
  tasks: CompanionTaskSummary[];
  locale: "zh" | "en";
  showTitles: boolean;
  onCollapse(): void;
  onOpenSession(sessionId: string): Promise<void>;
}) {
  const isEnglish = locale === "en";
  const [now, setNow] = useState(Date.now);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const pending = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (tasks.length === 0) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tasks.length]);

  const openSession = async (sessionId: string) => {
    if (pending.current) return;
    pending.current = true;
    setOpening(sessionId);
    setError("");
    try {
      await onOpenSession(sessionId);
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : isEnglish
              ? "Could not open this conversation. Try again."
              : "无法打开此会话，请重试。",
        );
    } finally {
      pending.current = false;
      if (alive.current) setOpening(null);
    }
  };

  return (
    <section
      id="companion-working-conversations"
      className="companion-task-panel"
      aria-label={isEnglish ? "Working conversations" : "工作会话"}
    >
      <div className="companion-task-heading">
        <strong>{isEnglish ? "Working conversations" : "工作会话"}</strong>
        <span className="companion-task-count" aria-live="polite">
          {tasks.length}
        </span>
        <button
          type="button"
          className="companion-panel-toggle"
          title={isEnglish ? "Collapse working conversations" : "折叠工作会话"}
          aria-label={isEnglish ? "Collapse working conversations" : "折叠工作会话"}
          aria-expanded="true"
          aria-controls="companion-working-conversation-list"
          onClick={onCollapse}
        >
          <ChevronUp size={16} aria-hidden="true" />
        </button>
      </div>
      <div
        id="companion-working-conversation-list"
        className="companion-task-list"
        aria-busy={opening !== null}
      >
        {tasks.map((task, index) => {
          const title =
            showTitles && task.title
              ? task.title
              : isEnglish
                ? `Conversation ${index + 1}`
                : `会话 ${index + 1}`;
          const status =
            task.status === "waiting"
              ? isEnglish
                ? "Needs input"
                : "等待确认"
              : task.status === "working"
                ? isEnglish
                  ? "Working"
                  : "处理中"
                : isEnglish
                  ? "Thinking"
                  : "思考中";
          return (
            <button
              key={task.sessionId}
              type="button"
              className="companion-task-row"
              data-status={task.status}
              title={title}
              aria-label={`${title}, ${status}`}
              disabled={opening !== null}
              onClick={() => void openSession(task.sessionId)}
            >
              <MessageSquare size={14} aria-hidden="true" />
              <span className="companion-task-copy">
                <span className="companion-task-title">{title}</span>
                <span className="companion-task-status">
                  {opening === task.sessionId ? (isEnglish ? "Opening…" : "正在打开…") : status}
                </span>
              </span>
              <time className="companion-task-elapsed">{elapsedLabel(task.startedAt, now)}</time>
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="companion-task-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
