import { History, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionView, SnapshotView, TrajectoryView } from "../../../shared/domain";
import { tr } from "../i18n/index";
import { runtimeText } from "../i18n/runtime";
import { useDialog } from "./DialogProvider";

function summaryEntries(summaries: string[]) {
  const occurrences = new Map<string, number>();
  return summaries.map((text) => {
    const occurrence = (occurrences.get(text) ?? 0) + 1;
    occurrences.set(text, occurrence);
    return { id: `${text}:${occurrence}`, text };
  });
}

export function RuntimeHistorySettings({
  sessions,
  activeSessionId,
}: {
  sessions: SessionView[];
  activeSessionId: string | null;
}) {
  const { confirm } = useDialog();
  const [sessionId, setSessionId] = useState(activeSessionId ?? sessions[0]?.id ?? "");
  const [snapshots, setSnapshots] = useState<SnapshotView[]>([]);
  const [trajectories, setTrajectories] = useState<TrajectoryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playbackRunId, setPlaybackRunId] = useState<string | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [redoSnapshotId, setRedoSnapshotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());
  const [eventLimits, setEventLimits] = useState<Record<string, number>>({});
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    if (!sessionId) {
      setSnapshots([]);
      setTrajectories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextSnapshots, nextTrajectories] = await Promise.all([
        window.mingshen.listSnapshots(sessionId),
        window.mingshen.listTrajectories(sessionId),
      ]);
      if (request !== requestId.current) return;
      setSnapshots(nextSnapshots);
      setTrajectories(nextTrajectories);
      setError(null);
    } catch (cause) {
      if (request !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setSnapshots([]);
    setTrajectories([]);
    setPlaybackRunId(null);
    setPlaybackIndex(0);
    setExpandedRuns(new Set());
    setExpandedSummaries(new Set());
    setEventLimits({});
    setRedoSnapshotId(null);
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!playbackRunId) {
      return;
    }
    const run = trajectories.find((item) => item.runId === playbackRunId);
    if (!run || playbackIndex >= run.events.length - 1) {
      return;
    }
    const timer = window.setTimeout(() => setPlaybackIndex((current) => current + 1), 700);
    return () => window.clearTimeout(timer);
  }, [playbackIndex, playbackRunId, trajectories]);

  const restore = async (snapshot: SnapshotView) => {
    const accepted = await confirm({
      title: tr("\u6062\u590D\u6587\u4EF6\u5FEB\u7167"),
      description: tr(
        "\u8FD9\u4F1A\u628A\u5DE5\u4F5C\u533A\u6062\u590D\u4E3A\u8BE5\u8F6E\u5F00\u59CB\u524D\u7684\u6587\u4EF6\u72B6\u6001\uFF0C\u5E76\u79FB\u9664\u8BE5\u8F6E\u65B0\u5EFA\u7684\u6587\u4EF6\u3002\u5DE5\u4F5C\u533A\u4E4B\u5916\u7684\u8DEF\u5F84\u4E0D\u4F1A\u53D7\u5F71\u54CD\u3002",
      ),

      confirmLabel: tr("\u6062\u590D\u5FEB\u7167"),
      tone: "danger",
    });
    if (!accepted) {
      return;
    }
    try {
      const result = await window.mingshen.restoreSnapshot(snapshot.id, snapshot.workspacePath);
      setRedoSnapshotId(result.safetySnapshotId);
      await refresh();
      setError(
        tr(
          "\u5DF2\u6062\u590D {0} \u4E2A\u6587\u4EF6\uFF0C\u79FB\u9664 {1} \u4E2A\u65B0\u6587\u4EF6\u3002\u53EF\u64A4\u9500\u672C\u6B21\u6062\u590D\u3002",
          [result.restored, result.removed],
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const exportRun = async (runId: string, format: "markdown" | "json") => {
    const request = requestId.current;
    try {
      await window.mingshen.exportTrajectory(sessionId, runId, format);
    } catch (cause) {
      if (request === requestId.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  };

  return (
    <div className="settings-page runtime-history-settings">
      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("\u8FD0\u884C\u8F68\u8FF9\u4E0E\u6587\u4EF6\u5FEB\u7167")}</h3>
            <p>
              {tr(
                "\u6BCF\u8F6E Agent \u8FD0\u884C\u90FD\u4F1A\u8BB0\u5F55\u771F\u5B9E\u4E8B\u4EF6\uFF0C\u5E76\u5728\u5F00\u59CB\u65F6\u521B\u5EFA\u672C\u5730\u5DE5\u4F5C\u533A\u5FEB\u7167\u3002",
              )}
            </p>
          </div>
        </div>
        <label className="field runtime-history-session">
          <span>{tr("选择会话")}</span>
          <select
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            disabled={sessions.length === 0}
          >
            {sessions.map((session) => (
              <option value={session.id} key={session.id}>
                {session.title}
              </option>
            ))}
          </select>
        </label>
        {loading ? (
          <p className="quiet-copy" role="status">
            {tr("正在加载记录")}
          </p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <label className="field catalog-search">
          <span>{tr("筛选记录")}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {redoSnapshotId ? (
          <div className="runtime-undo-bar">
            <span>
              {tr(
                "\u6700\u8FD1\u4E00\u6B21\u5FEB\u7167\u6062\u590D\u5DF2\u521B\u5EFA\u5B89\u5168\u5FEB\u7167\u3002",
              )}
            </span>
            <button
              className="btn btn--secondary"
              type="button"
              onClick={async () => {
                const restored = snapshots.find((snapshot) => snapshot.id === redoSnapshotId);
                if (restored) {
                  await restore(restored);
                  setRedoSnapshotId(null);
                }
              }}
            >
              {tr("\u64A4\u9500\u672C\u6B21\u6062\u590D")}
            </button>
          </div>
        ) : null}
        <div className="runtime-history-split">
          <div>
            <h4>
              <RotateCcw aria-hidden="true" size={14} />
              {tr("\u6587\u4EF6\u5FEB\u7167")}
            </h4>
            <div className="runtime-history-list">
              {snapshots
                .filter((snapshot) =>
                  `${snapshot.runId} ${snapshot.createdAt}`.includes(query.trim()),
                )
                .map((snapshot) => (
                  <article className="runtime-history-row" key={snapshot.id}>
                    <div>
                      <strong>{new Date(snapshot.createdAt).toLocaleString()}</strong>
                      <span>
                        {snapshot.fileCount}
                        {tr("\u4E2A\u6587\u4EF6 \xB7")}
                        {snapshot.runId.slice(0, 8)}
                      </span>
                    </div>
                    <button
                      className="btn btn--secondary"
                      type="button"
                      onClick={() => void restore(snapshot)}
                    >
                      {tr("\u6062\u590D")}
                    </button>
                  </article>
                ))}
              {!loading && snapshots.length === 0 ? (
                <p className="quiet-copy">
                  {tr("\u8FD8\u6CA1\u6709\u6587\u4EF6\u5FEB\u7167\u3002")}
                </p>
              ) : null}
            </div>
          </div>
          <div>
            <h4>
              <History aria-hidden="true" size={14} />
              {tr("\u8FD0\u884C\u8F68\u8FF9")}
            </h4>
            <div className="runtime-history-list">
              {trajectories
                .filter((trajectory) =>
                  `${trajectory.runId} ${trajectory.startedAt} ${trajectory.stepSummaries.join(" ")}`
                    .toLocaleLowerCase()
                    .includes(query.trim().toLocaleLowerCase()),
                )
                .map((trajectory) => (
                  <details
                    className="trajectory-row"
                    key={trajectory.runId}
                    onToggle={(event) => {
                      if (event.target !== event.currentTarget) return;
                      const open = event.currentTarget.open;
                      setExpandedRuns((current) => {
                        const next = new Set(current);
                        if (open) next.add(trajectory.runId);
                        else next.delete(trajectory.runId);
                        return next;
                      });
                    }}
                  >
                    <summary>
                      <span>{new Date(trajectory.startedAt).toLocaleString()}</span>
                      <small>
                        {trajectory.events.length}
                        {tr("\u4E2A\u6B65\u9AA4")}
                      </small>
                    </summary>
                    {expandedRuns.has(trajectory.runId) ? (
                      <>
                        <div className="trajectory-playback">
                          <button
                            className="btn btn--secondary"
                            type="button"
                            onClick={() => {
                              if (playbackRunId === trajectory.runId) {
                                setPlaybackRunId(null);
                              } else {
                                setPlaybackRunId(trajectory.runId);
                                setPlaybackIndex(0);
                              }
                            }}
                          >
                            {playbackRunId === trajectory.runId ? (
                              <Pause aria-hidden="true" size={13} />
                            ) : (
                              <Play aria-hidden="true" size={13} />
                            )}
                            {playbackRunId === trajectory.runId
                              ? tr("\u6682\u505C\u56DE\u653E")
                              : tr("\u56DE\u653E")}
                          </button>
                          {playbackRunId === trajectory.runId ? (
                            <code>
                              {Math.min(playbackIndex + 1, trajectory.events.length)} /{" "}
                              {trajectory.events.length}
                            </code>
                          ) : null}
                          <button
                            className="btn btn--ghost"
                            type="button"
                            onClick={() => void exportRun(trajectory.runId, "markdown")}
                          >
                            {tr("\u5BFC\u51FA Markdown")}
                          </button>
                          <button
                            className="btn btn--ghost"
                            type="button"
                            onClick={() => void exportRun(trajectory.runId, "json")}
                          >
                            {tr("\u5BFC\u51FA JSON")}
                          </button>
                        </div>
                        {trajectory.stepSummaries.length > 0 ? (
                          <details
                            className="trajectory-summary"
                            open={expandedSummaries.has(trajectory.runId)}
                            onToggle={(event) => {
                              event.stopPropagation();
                              const open = event.currentTarget.open;
                              setExpandedSummaries((current) => {
                                const next = new Set(current);
                                if (open) next.add(trajectory.runId);
                                else next.delete(trajectory.runId);
                                return next;
                              });
                            }}
                          >
                            <summary>
                              {tr("步骤摘要（{0}）", [trajectory.stepSummaries.length])}
                            </summary>
                            {expandedSummaries.has(trajectory.runId) ? (
                              <div className="trajectory-steps">
                                {summaryEntries(
                                  trajectory.stepSummaries.slice(
                                    0,
                                    eventLimits[trajectory.runId] ?? 100,
                                  ),
                                ).map((summary) => (
                                  <span key={summary.id}>{runtimeText(summary.text)}</span>
                                ))}
                              </div>
                            ) : null}
                          </details>
                        ) : null}
                        <ol>
                          {trajectory.events
                            .slice(
                              0,
                              Math.max(
                                eventLimits[trajectory.runId] ?? 100,
                                playbackRunId === trajectory.runId ? playbackIndex + 1 : 0,
                              ),
                            )
                            .filter(
                              (_event, index) =>
                                playbackRunId !== trajectory.runId || index <= playbackIndex,
                            )
                            .map((event) => (
                              <li key={event.id}>
                                <details>
                                  <summary>
                                    <span>{runtimeText(event.summary)}</span>
                                    <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
                                  </summary>
                                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                                </details>
                              </li>
                            ))}
                        </ol>
                        {(eventLimits[trajectory.runId] ?? 100) < trajectory.events.length ? (
                          <button
                            className="btn btn--ghost"
                            type="button"
                            onClick={() =>
                              setEventLimits((current) => ({
                                ...current,
                                [trajectory.runId]: (current[trajectory.runId] ?? 100) + 100,
                              }))
                            }
                          >
                            {tr("显示更多步骤")}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </details>
                ))}
              {!loading && trajectories.length === 0 ? (
                <p className="quiet-copy">
                  {tr("\u8FD8\u6CA1\u6709\u8FD0\u884C\u8F68\u8FF9\u3002")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
