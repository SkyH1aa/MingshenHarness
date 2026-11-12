import { ArrowUpRight, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionView } from "../../../shared/domain";
import type { SubagentOutputPreview } from "../../../shared/workbench";
import { tr } from "../i18n";
import { runtimeText } from "../i18n/runtime";
import type { LiveRun } from "../lib/chat-types";
import { ExpandableText } from "./ExpandableText";
import { MarkdownLite } from "./MarkdownLite";

export function SubagentOutput({
  parentId,
  session,
  live,
  onOpenFile,
  onOpenSession,
}: {
  parentId: string;
  session: SessionView;
  live: LiveRun | null;
  onOpenFile(path: string): void;
  onOpenSession(): void;
}) {
  const [preview, setPreview] = useState<SubagentOutputPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const body = useRef<HTMLElement>(null);
  const following = useRef(true);
  const refresh = useRef<() => void>(() => undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: New persisted/live output changes scroll height after render.
  useEffect(() => {
    if (following.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [preview, live?.text, live?.reasoning, loading]);
  useEffect(() => {
    let alive = true,
      pending = false,
      dirty = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      if (!alive) return;
      if (pending) {
        dirty = true;
        return;
      }
      pending = true;
      dirty = false;
      try {
        const next = await window.mingshen.getSubagentOutput(parentId, session.id);
        if (alive) {
          setPreview(next);
          setError("");
        }
      } catch (cause) {
        if (alive) setError(String(cause));
      } finally {
        pending = false;
        if (alive) {
          setLoading(false);
          if (dirty && !timer)
            timer = setTimeout(() => {
              timer = null;
              void load();
            }, 250);
        }
      }
    };
    const schedule = () => {
      dirty = true;
      if (!timer)
        timer = setTimeout(() => {
          timer = null;
          void load();
        }, 250);
    };
    refresh.current = schedule;
    void load();
    const off = window.mingshen.onRuntimeEvent((event) => {
      const id =
        event.type === "activity"
          ? event.activity.sessionId
          : "sessionId" in event
            ? event.sessionId
            : null;
      if (
        id === session.id &&
        [
          "assistant_message",
          "activity",
          "run_started",
          "run_completed",
          "run_failed",
          "run_interrupted",
          "conversation_rewound",
        ].includes(event.type)
      )
        schedule();
    });
    return () => {
      alive = false;
      off();
      if (timer) clearTimeout(timer);
      refresh.current = () => undefined;
    };
  }, [parentId, session.id]);
  const active = ["running", "waiting_approval"].includes(session.status);
  const openFile = (path: string) => {
    const absolute = /^(?:[a-z]:[\\/]|[\\/])/i.test(path);
    onOpenFile(
      absolute || !session.workspacePath
        ? path
        : `${session.workspacePath.replace(/[\\/]$/, "")}/${path}`,
    );
  };
  const text = active ? (live?.text.slice(-12000) ?? "") : "";
  const reasoning = active ? (live?.reasoning.slice(-12000) ?? "") : "";
  const reasoningPart = (id: string, value: string) => (
    <details key={id} className="subagent-output__reasoning">
      <summary>{tr("思考摘要")}</summary>
      <MarkdownLite
        text={value}
        workspacePath={session.workspacePath}
        onOpenFile={openFile}
        onOpenError={setError}
      />
    </details>
  );
  return (
    <section className="subagent-output" aria-label={tr("子 Agent 输出：{0}", [session.title])}>
      <header className="subagent-output__header">
        <span>{tr("最近输出")}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={tr("刷新输出")}
          title={tr("刷新输出")}
          onClick={() => refresh.current()}
        >
          <RefreshCw size={13} />
        </button>
      </header>
      <section
        className="subagent-output__body"
        ref={body}
        onClickCapture={(event) => {
          if ((event.target as Element).closest("summary")) following.current = false;
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
        }}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: This independently scrollable output region needs keyboard scrolling.
        tabIndex={0}
        aria-label={tr("子 Agent 输出内容")}
      >
        {loading ? (
          <p className="subagent-output__empty">
            <LoaderCircle className="spin" size={13} />
            {tr("正在加载输出")}
          </p>
        ) : null}
        {preview?.parts.map((part) =>
          part.kind === "reasoning" ? (
            reasoningPart(part.id, part.text)
          ) : part.kind === "tool" ? (
            <details key={part.id} className="subagent-output__tool">
              <summary>{part.toolName || tr(part.isError ? "工具执行失败" : "工具输出")}</summary>
              {part.text ? <pre>{part.text}</pre> : null}
            </details>
          ) : (
            <div key={part.id} className={part.isError ? "form-error" : "subagent-output__message"}>
              <MarkdownLite
                text={part.text}
                workspacePath={session.workspacePath}
                onOpenFile={openFile}
                onOpenError={setError}
              />
            </div>
          ),
        )}
        {reasoning ? reasoningPart("live-reasoning", reasoning) : null}
        {text ? (
          <div className="subagent-output__message subagent-output__live">
            <MarkdownLite
              text={text}
              workspacePath={session.workspacePath}
              onOpenFile={openFile}
              onOpenError={setError}
            />
          </div>
        ) : null}
        {!loading && !error && !preview?.parts.length && !text && !reasoning ? (
          <p className="subagent-output__empty">
            {tr(active ? "正在等待子 Agent 输出" : "暂无输出记录")}
          </p>
        ) : null}
        {preview?.truncated ||
        (live && (live.text.length > 12000 || live.reasoning.length > 12000)) ? (
          <p className="subagent-output__empty">
            {tr("仅展示最近输出，点击 Agent 名称查看完整会话。")}
            <button
              type="button"
              className="icon-button"
              aria-label={tr("打开会话：{0}", [session.title])}
              title={tr("打开会话：{0}", [session.title])}
              onClick={onOpenSession}
            >
              <ArrowUpRight size={13} />
            </button>
          </p>
        ) : null}
        {error ? (
          <div role="alert">
            <ExpandableText text={runtimeText(error)} className="form-error" tone="error" />
          </div>
        ) : null}
      </section>
    </section>
  );
}
