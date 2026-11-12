import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Folder,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionView } from "../../../shared/domain";
import { tr, useLocale } from "../i18n";
import { formatRelativeTime } from "../lib/format";
import { sessionRecency } from "../lib/recent-sessions";
import {
  loadManagedSessions,
  planSessionBatch,
  runSessionBatch,
  type SessionBatchAction,
  type SessionBatchResult,
} from "../lib/session-management";
import { workspaceKey } from "../lib/session-navigation";
import { useDialog } from "./DialogProvider";

const PAGE_SIZE = 50;

export function SessionManagementSettings({
  activeSessionId,
  onChanged,
  onBusyChange,
}: {
  activeSessionId: string | null;
  onChanged: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const locale = useLocale();
  const { confirm } = useDialog();
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [folder, setFolder] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    action: SessionBatchAction;
    value: SessionBatchResult;
  } | null>(null);
  const [progress, setProgress] = useState("");
  const pending = useRef(false);
  const selectAll = useRef<HTMLInputElement>(null);
  const initialSessionId = useRef(activeSessionId);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const rows = await loadManagedSessions(window.mingshen, signal);
      if (signal?.aborted) return;
      rows.sort((left, right) => sessionRecency(right) - sessionRecency(left));
      setSessions(rows);
      const existingIds = new Set(rows.map((session) => session.id));
      setSelected((current) => new Set([...current].filter((id) => existingIds.has(id))));
      setFolder((current) => {
        if (rows.some((session) => workspaceKey(session.workspacePath) === current)) return current;
        const active = rows.find((session) => session.id === initialSessionId.current);
        const initial = active ?? rows[0];
        return initial ? workspaceKey(initial.workspacePath) : "";
      });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [reload]);

  const folders = useMemo(() => {
    const groups = new Map<string, { path: string | null; count: number }>();
    for (const session of sessions) {
      const key = workspaceKey(session.workspacePath);
      const group = groups.get(key) ?? { path: session.workspacePath, count: 0 };
      group.count++;
      groups.set(key, group);
    }
    return [...groups].map(([key, value]) => ({ key, ...value }));
  }, [sessions]);
  const folderSessions = sessions.filter(
    (session) => workspaceKey(session.workspacePath) === folder,
  );
  const filtered = folderSessions.filter(
    (session) =>
      (status === "all" || session.archived === (status === "archived")) &&
      session.title.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)),
  );
  const picked = filtered.filter((session) => selected.has(session.id));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const allSelected = filtered.length > 0 && picked.length === filtered.length;
  const locked = busy || loading;
  const path = folders.find((group) => group.key === folder)?.path;

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = picked.length > 0 && !allSelected;
  }, [allSelected, picked.length]);

  const resetSelection = () => {
    setSelected(new Set());
    setPage(1);
    setResult(null);
    setError("");
  };
  const refresh = async () => {
    if (pending.current) return;
    pending.current = true;
    setError("");
    try {
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
    }
  };
  const apply = async (action: SessionBatchAction) => {
    if (pending.current || locked || !picked.length) return;
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setResult(null);
    setProgress(tr("正在核对所选会话…"));
    try {
      const plan = await planSessionBatch(window.mingshen, picked, action);
      if (
        action !== "restore" &&
        !(await confirm({
          title: tr(action === "delete" ? "删除所选会话？" : "归档所选会话？"),
          description:
            action === "delete"
              ? tr(
                  "将永久删除 {0} 个主会话及 {1} 个子会话的消息、草稿、附件和快照，无法撤销。运行中的任务会先停止；工作文件夹中的项目文件会保留。",
                  [plan.roots.length, plan.sessions.length - plan.roots.length],
                )
              : tr(
                  "将归档 {0} 个主会话及 {1} 个子会话，并暂停关联的定时任务。草稿会保留，可在已归档列表恢复；恢复不会自动开启定时任务。",
                  [plan.roots.length, plan.sessions.length - plan.roots.length],
                ),
          confirmLabel: tr(action === "delete" ? "永久删除" : "归档"),
          tone: action === "delete" ? "danger" : "default",
        }))
      )
        return;
      const value = await runSessionBatch(window.mingshen, plan, ({ completed, total }) =>
        setProgress(tr("正在处理会话 {0} / {1}…", [completed, total])),
      );
      setResult({ action, value });
      setSelected(new Set(value.failures.map((failure) => failure.sessionId)));
      try {
        await onChanged();
      } finally {
        await reload();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProgress("");
      setBusy(false);
      onBusyChange(false);
      pending.current = false;
    }
  };
  const completedText = result
    ? tr(
        {
          archive: "已归档 {0} 个主会话。",
          restore: "已恢复 {0} 个主会话。",
          delete: "已删除 {0} 个主会话。",
        }[result.action],
        [result.value.succeeded.length],
      )
    : "";

  return (
    <section className="settings-block session-management" aria-busy={locked}>
      <div className="settings-block__heading">
        <div>
          <h3>{tr("按文件夹管理会话")}</h3>
          <p>{tr("勾选主会话后批量归档或删除，子会话随所属主会话一并处理。")}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={tr("刷新会话列表")}
          title={tr("刷新会话列表")}
          disabled={locked}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" size={16} />
        </button>
      </div>
      <div className="session-management__filters">
        <label className="field session-management__folder">
          <span>{tr("工作文件夹")}</span>
          <select
            id="managed-workspace"
            value={folder}
            disabled={locked || !folders.length}
            onChange={(event) => {
              setFolder(event.target.value);
              resetSelection();
            }}
          >
            {!folders.length ? <option value="">{tr("暂无会话")}</option> : null}
            {folders.map((group) => (
              <option key={group.key} value={group.key}>
                {group.path ?? tr("未选择文件夹")} ({group.count})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr("会话范围")}</span>
          <select
            id="managed-status"
            value={status}
            disabled={locked}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              resetSelection();
            }}
          >
            <option value="active">{tr("未归档")}</option>
            <option value="archived">{tr("已归档")}</option>
            <option value="all">{tr("全部")}</option>
          </select>
        </label>
      </div>
      {path !== undefined ? (
        <p className="session-management__path" title={path ?? tr("未选择文件夹")}>
          <Folder aria-hidden="true" size={14} />
          <span>{path ?? tr("未选择文件夹")}</span>
        </p>
      ) : null}
      <label className="session-management__search">
        <Search aria-hidden="true" size={15} />
        <input
          id="managed-search"
          value={query}
          disabled={locked}
          placeholder={tr("搜索当前文件夹的会话标题")}
          aria-label={tr("搜索当前文件夹的会话标题")}
          onChange={(event) => {
            setQuery(event.target.value);
            resetSelection();
          }}
        />
      </label>
      <div className="session-management__toolbar">
        <label className="session-management__select-all">
          <input
            ref={selectAll}
            id="managed-select-all"
            type="checkbox"
            checked={allSelected}
            disabled={locked || !filtered.length}
            onChange={(event) =>
              setSelected(
                new Set(event.target.checked ? filtered.map((session) => session.id) : []),
              )
            }
          />
          <span>{tr("全选匹配会话（{0}）", [filtered.length])}</span>
        </label>
        <span className="session-management__count" role="status">
          {tr("已选 {0}", [picked.length])}
        </span>
        <div className="session-management__actions">
          {status !== "archived" ? (
            <button
              type="button"
              className="btn btn--secondary"
              data-session-action="archive"
              title={tr("归档所选未归档会话")}
              disabled={locked || !picked.length || picked.some((session) => session.archived)}
              onClick={() => void apply("archive")}
            >
              <Archive aria-hidden="true" size={14} />
              {tr("归档")}
            </button>
          ) : null}
          {status !== "active" ? (
            <button
              type="button"
              className="btn btn--secondary"
              data-session-action="restore"
              title={tr("恢复所选已归档会话")}
              disabled={locked || !picked.length || picked.some((session) => !session.archived)}
              onClick={() => void apply("restore")}
            >
              <ArchiveRestore aria-hidden="true" size={14} />
              {tr("恢复")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--danger"
            data-session-action="delete"
            disabled={locked || !picked.length}
            onClick={() => void apply("delete")}
          >
            <Trash2 aria-hidden="true" size={14} />
            {tr("删除")}
          </button>
        </div>
      </div>
      <div className="session-management__list">
        {loading && !sessions.length ? (
          <p className="quiet-copy" role="status">
            {tr("正在读取会话…")}
          </p>
        ) : !rows.length ? (
          <p className="quiet-copy">
            {tr(
              !sessions.length
                ? "暂无会话。"
                : query.trim()
                  ? "没有匹配的会话。"
                  : status === "archived"
                    ? "此文件夹没有已归档会话。"
                    : "此文件夹没有符合条件的会话。",
            )}
          </p>
        ) : (
          rows.map((session) => (
            <label
              key={session.id}
              data-session-id={session.id}
              className="managed-session-row"
              data-selected={selected.has(session.id)}
            >
              <input
                type="checkbox"
                checked={selected.has(session.id)}
                disabled={locked}
                aria-label={tr("选择会话：{0}", [session.title])}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(session.id);
                    else next.delete(session.id);
                    return next;
                  });
                }}
              />
              <span className="managed-session-row__copy">
                <strong title={session.title}>{session.title}</strong>
                <small>
                  <span>
                    {tr(
                      session.archived
                        ? "已归档"
                        : {
                            idle: "空闲",
                            running: "运行中",
                            waiting_approval: "等待批准",
                            interrupted: "已中断",
                            error: "出错",
                          }[session.status],
                    )}
                  </span>
                  {session.id === activeSessionId ? <span>{tr("当前会话")}</span> : null}
                  {session.childCount ? <span>{tr("含子会话")}</span> : null}
                </small>
              </span>
              <time dateTime={session.updatedAt} title={session.updatedAt}>
                {formatRelativeTime(session.updatedAt)}
              </time>
            </label>
          ))
        )}
      </div>
      {pageCount > 1 ? (
        <div className="session-management__pagination">
          <span>
            {tr("第 {0} / {1} 页，共 {2} 个主会话", [currentPage, pageCount, filtered.length])}
          </span>
          <button
            type="button"
            className="icon-button"
            data-session-page="previous"
            disabled={locked || currentPage <= 1}
            aria-label={tr("上一页")}
            title={tr("上一页")}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            data-session-page="next"
            disabled={locked || currentPage >= pageCount}
            aria-label={tr("下一页")}
            title={tr("下一页")}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
      {progress ? (
        <p className="form-note" role="status">
          {progress}
        </p>
      ) : null}
      {result ? (
        <div className="session-management__result" role="status">
          <p>
            {completedText}{" "}
            {result.value.failures.length
              ? tr("有 {0} 个会话未完成，已保留勾选，可重试。", [result.value.failures.length])
              : ""}
          </p>
          {result.value.failures.length ? (
            <ul>
              {result.value.failures.map((failure) => (
                <li key={failure.sessionId}>
                  <strong>{failure.title}</strong>
                  <span>{tr(failure.message)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {tr(error)}
        </p>
      ) : null}
    </section>
  );
}
