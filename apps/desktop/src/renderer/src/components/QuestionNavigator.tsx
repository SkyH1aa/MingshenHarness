import { MessageSquare } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionMessage } from "../../../shared/domain";
import { tr } from "../i18n/index";

export function QuestionNavigator({
  messages,
  scrollRef,
  onJump,
}: {
  messages: SessionMessage[];
  scrollRef: RefObject<HTMLElement | null>;
  onJump: (messageId: string) => void;
}) {
  const questions = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user")
        .map((message) => {
          const text = message.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
            .trim();
          const attachments = message.parts
            .filter((part) => part.type === "attachment")
            .map((part) => part.attachment.name);
          const lines = text.split(/\r?\n/).filter((line) => line.trim());
          const firstLine = lines[0]?.trim() ?? "";
          return {
            id: message.id,
            title: (firstLine || attachments.join(", ")).slice(0, 120),
            excerpt: `${firstLine.slice(120)}\n${lines.slice(1).join("\n")}`.trim().slice(0, 360),
            attachments,
          };
        }),
    [messages],
  );
  const railRef = useRef<HTMLOListElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    const scroll = scrollRef.current;
    const content = scroll?.firstElementChild;
    if (!scroll || !content || questions.length < 2) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const rect = scroll.getBoundingClientRect();
      const readingLine = rect.top + Math.min(100, rect.height * 0.25);
      const nodes = [...scroll.querySelectorAll<HTMLElement>(".message--user[data-message-id]")];
      let current = nodes[0]?.dataset.messageId ?? null;
      if (scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 8) {
        current = nodes.at(-1)?.dataset.messageId ?? current;
      } else {
        for (const node of nodes) {
          if (node.getBoundingClientRect().top > readingLine) break;
          current = node.dataset.messageId ?? current;
        }
      }
      setActiveId(current);
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    observer.observe(content);
    scroll.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [questions, scrollRef]);

  useEffect(() => {
    const rail = railRef.current;
    const active = [...(rail?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.getAttribute("aria-controls") === `message-${activeId}`,
    );
    if (!rail || !active || rail.contains(document.activeElement)) return;
    // Only scroll the rail itself: scrollIntoView can also move the conversation.
    const top = active.offsetTop;
    if (top < rail.scrollTop) rail.scrollTop = top;
    else if (top + active.offsetHeight > rail.scrollTop + rail.clientHeight)
      rail.scrollTop = top + active.offsetHeight - rail.clientHeight;
  }, [activeId]);

  useEffect(() => {
    if (!preview) return;
    const clear = () => setPreview(null);
    window.addEventListener("resize", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("resize", clear);
      window.removeEventListener("blur", clear);
    };
  }, [preview]);

  const index = questions.findIndex((question) => question.id === preview?.id);
  const question = questions[index];
  if (questions.length < 2) return null;

  return (
    <nav className="question-nav" aria-label={tr("历史问题导航")}>
      <ol
        ref={railRef}
        className="question-nav__rail"
        onScroll={(event) => {
          const focused = document.activeElement;
          if (focused instanceof HTMLButtonElement && event.currentTarget.contains(focused)) {
            const rect = focused.getBoundingClientRect();
            setPreview((current) =>
              current ? { ...current, x: rect.left - 10, y: rect.top + rect.height / 2 } : null,
            );
          } else setPreview(null);
        }}
      >
        {questions.map((item, itemIndex) => {
          const showPreview = (button: HTMLButtonElement) => {
            const rect = button.getBoundingClientRect();
            setDismissedId(null);
            setPreview({ id: item.id, x: rect.left - 10, y: rect.top + rect.height / 2 });
          };
          return (
            <li key={item.id}>
              <button
                type="button"
                className="question-nav__marker"
                aria-label={tr("跳转到问题 {0}：{1}", [
                  itemIndex + 1,
                  item.title || tr("附件消息"),
                ])}
                aria-controls={`message-${item.id}`}
                aria-current={activeId === item.id ? "location" : undefined}
                aria-describedby={
                  preview?.id === item.id && dismissedId !== item.id
                    ? "question-nav-preview"
                    : undefined
                }
                onPointerEnter={(event) => showPreview(event.currentTarget)}
                onPointerLeave={(event) => {
                  if (document.activeElement !== event.currentTarget) setPreview(null);
                }}
                onFocus={(event) => showPreview(event.currentTarget)}
                onBlur={() => setPreview(null)}
                onClick={() => {
                  setPreview(null);
                  setDismissedId(item.id);
                  onJump(item.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setPreview(null);
                    setDismissedId(item.id);
                  }
                  const buttons = railRef.current?.querySelectorAll<HTMLButtonElement>("button");
                  if (!buttons) return;
                  const next =
                    event.key === "ArrowDown"
                      ? Math.min(itemIndex + 1, buttons.length - 1)
                      : event.key === "ArrowUp"
                        ? Math.max(itemIndex - 1, 0)
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? buttons.length - 1
                            : null;
                  if (next !== null) {
                    event.preventDefault();
                    buttons[next]?.focus({ preventScroll: true });
                    const target = buttons[next];
                    const rail = railRef.current;
                    if (target && rail) {
                      if (target.offsetTop < rail.scrollTop) rail.scrollTop = target.offsetTop;
                      else if (
                        target.offsetTop + target.offsetHeight >
                        rail.scrollTop + rail.clientHeight
                      )
                        rail.scrollTop = target.offsetTop + target.offsetHeight - rail.clientHeight;
                      showPreview(target);
                    }
                  }
                }}
              >
                <span aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      {preview && question && dismissedId !== question.id
        ? createPortal(
            <div
              className="question-nav__preview"
              id="question-nav-preview"
              role="tooltip"
              style={{
                right: Math.max(12, window.innerWidth - preview.x),
                top: Math.max(12, Math.min(preview.y - 56, window.innerHeight - 210)),
              }}
            >
              <div className="question-nav__preview-heading">
                <span>{tr("问题 {0} / {1}", [index + 1, questions.length])}</span>
                <MessageSquare size={14} aria-hidden="true" />
              </div>
              <strong>{question.title || tr("附件消息")}</strong>
              {question.excerpt ? <p>{question.excerpt}</p> : null}
              {question.attachments.length ? (
                <small>{question.attachments.join(", ")}</small>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </nav>
  );
}
