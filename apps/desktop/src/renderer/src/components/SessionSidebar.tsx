import {
  Archive,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CompletionNotice } from "../../../shared/desktop";
import type { SessionRunState, SessionUpdateInput, SessionView } from "../../../shared/domain";
import type { SessionWorkspaceGroup } from "../../../shared/session-catalog";
import { useLocale } from "../i18n";
import { tr } from "../i18n/index";
import { formatDuration, formatRelativeTime } from "../lib/format";
import {
  SessionNavigationIndex,
  visibleSessionRows,
  workspaceKey,
} from "../lib/session-navigation";
import { useDialog } from "./DialogProvider";
import { useUiPreferences } from "./UiPreferences";
import { VirtualSessionRows } from "./VirtualSessionRows";

interface SessionSidebarProps {
  sessions: SessionView[];
  catalogGroups?: SessionWorkspaceGroup[];
  onLoadSessions?: (items: SessionView[]) => void;
  unreadCompletions: CompletionNotice[];
  selectedSessionId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (sessionId: string) => void;
  onNewSession: (workspacePath: string | null) => void;
  onNewWorkspaceSession: (workspacePath: string | null) => void;
  creatingWorkspaceSession: boolean;
  workspaceSessionError: string;
  onCollapse: () => void;
  runs: Record<string, SessionRunState>;
  pendingQuestionSessionIds: string[];
  onPatch: (input: SessionUpdateInput) => Promise<SessionView>;
  onRemove: (sessionId: string) => Promise<void>;
  onFork: (sessionId: string) => Promise<void>;
}

export function SessionSidebar({
  sessions,
  catalogGroups = [],
  onLoadSessions,
  unreadCompletions,
  selectedSessionId,
  search,
  onSearchChange,
  onSelect,
  onNewSession,
  onNewWorkspaceSession,
  creatingWorkspaceSession,
  workspaceSessionError,
  onCollapse,
  runs,
  pendingQuestionSessionIds,
  onPatch,
  onRemove,
  onFork,
}: SessionSidebarProps) {
  const { confirm } = useDialog();
  const orbit = useUiPreferences().activeStyle === "orbit";
  const en = useLocale() === "en";
  const [menu, setMenu] = useState<{ session: SessionView; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<SessionView | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameDialogRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pages, setPages] = useState<Record<string, { cursor: string | null; total: number }>>({});
  const [searchRows, setSearchRows] = useState<SessionView[] | null>(null);
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;
  const withAncestors = useCallback(async (items: SessionView[]) => {
    const rows = new Map(items.map((item) => [item.id, item]));
    for (const item of items) {
      let parentId = item.parentSessionId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = rows.get(parentId) ?? (await window.mingshen.getSession(parentId));
        if (!parent || parent.archived) break;
        rows.set(parent.id, parent);
        parentId = parent.parentSessionId;
      }
    }
    return [...rows.values()];
  }, []);
  const loadChildren = async (parentId: string) => {
    try {
      let cursor: string | null = null;
      do {
        const page = await window.mingshen.listSessionPage({
          parentId,
          limit: 200,
          ...(cursor ? { cursor } : {}),
        });
        onLoadSessions?.(page.sessions);
        cursor = page.nextCursor;
      } while (cursor);
    } catch (error) {
      setActionError(String(error));
    }
  };
  const loadPage = async (path: string | null, append = true) => {
    try {
      const key = workspaceKey(path);
      const previous = pages[key];
      let page: import("../../../shared/session-catalog").SessionPage;
      try {
        page = await window.mingshen.listSessionPage({
          workspacePath: path,
          limit: 100,
          ...(append && previous?.cursor ? { cursor: previous.cursor } : {}),
        });
      } catch (error) {
        if (!String(error).includes("SESSION_PAGE_CHANGED")) throw error;
        page = await window.mingshen.listSessionPage({ workspacePath: path, limit: 100 });
      }
      onLoadSessions?.(page.sessions);
      setPages((current) => ({
        ...current,
        [key]: { cursor: page.nextCursor, total: page.total },
      }));
    } catch (error) {
      setActionError(String(error));
    }
  };
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (!search.trim()) {
        setSearchRows(null);
        return;
      }
      void window.mingshen
        .listSessionPage({ query: search, limit: 100 })
        .then(async (page) => {
          const rows = await withAncestors(page.sessions);
          if (alive) {
            setSearchRows(rows);
            setSearchCursor(page.nextCursor);
            onLoadSessions?.(rows);
          }
        })
        .catch((error) => {
          if (alive) setActionError(String(error));
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search, onLoadSessions, withAncestors]);
  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);
  useEffect(() => {
    if (!sessions.some((session) => ["running", "waiting_approval"].includes(session.status)))
      return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sessions]);
  useEffect(() => {
    if (!menu && !renaming) return;
    const previousFocus = document.activeElement;
    if (menu) menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenu(null);
        if (!busy) setRenaming(null);
      }
      if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const items = [
          ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
        ];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
      if (event.key === "Tab" && menu) {
        event.preventDefault();
        setMenu(null);
      }
      if (event.key === "Tab" && renaming) {
        const items = [
          ...(renameDialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled)",
          ) ?? []),
        ];
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [menu, renaming, busy]);
  const act = async (operation: () => Promise<unknown>) => {
    setMenu(null);
    setBusy(true);
    setActionError("");
    try {
      await operation();
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async (session: SessionView) => {
    setMenu(null);
    if (
      await confirm({
        title: tr("删除会话"),
        description: tr(
          "永久删除「{0}」及其子会话和聊天记录？正在运行的任务将先停止，工作区文件不会删除。",
          [session.title],
        ),
        confirmLabel: tr("删除"),
        tone: "danger",
      })
    )
      await act(() => onRemove(session.id));
  };
  const navigation = useRef(new SessionNavigationIndex());
  const groups = useMemo(() => {
    const result = [...navigation.current.groups(searchRows ?? sessions, search)];
    if (!search.trim())
      for (const summary of catalogGroups)
        if (!result.some((item) => item.key === workspaceKey(summary.path)))
          result.push({
            key: workspaceKey(summary.path),
            path: summary.path,
            label: summary.path?.split(/[\\/]/).at(-1) ?? "",
            roots: [],
            children: new Map(),
            sessions: [],
            updatedAt: Date.parse(summary.latest),
          });
    return result;
  }, [sessions, search, searchRows, catalogGroups]);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [rowLimits, setRowLimits] = useState<Record<string, number>>({});
  const unreadIds = useMemo(
    () => new Set(unreadCompletions.map((item) => item.sessionId)),
    [unreadCompletions],
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showAllGroups, setShowAllGroups] = useState<Set<string>>(new Set());
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const selectedGroup = groups.find((group) =>
    group.sessions.some((item) => item.id === selectedSessionId),
  );
  const selectedWorkspaceKey =
    selectedGroup?.key ?? (selectedSession ? workspaceKey(selectedSession.workspacePath) : null);

  useEffect(() => {
    if (!selectedWorkspaceKey) {
      return;
    }
    setExpandedGroups((current) => {
      if (current.has(selectedWorkspaceKey)) {
        return current;
      }
      return new Set([...current, selectedWorkspaceKey]);
    });
  }, [selectedWorkspaceKey]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <aside className={`session-sidebar${orbit ? " session-sidebar--orbit" : ""}`}>
      <div className="session-sidebar__heading">
        <h2>
          {orbit ? (en ? "Workspace" : "工作空间") : tr("\u5BF9\u8BDD")}

          <span>
            {catalogGroups.length
              ? catalogGroups.reduce((sum, group) => sum + group.total + group.children, 0)
              : sessions.filter((session) => !session.archived).length}
          </span>
        </h2>
        <button
          className="icon-button"
          type="button"
          aria-label={tr("\u6536\u8D77\u4F1A\u8BDD\u680F")}
          title={tr("\u6536\u8D77\u4F1A\u8BDD\u680F")}
          onClick={onCollapse}
        >
          <PanelLeftClose aria-hidden="true" size={17} />
        </button>
      </div>

      <button
        className="session-new-button"
        type="button"
        onClick={() => onNewSession(selectedSession?.workspacePath ?? null)}
      >
        <Plus aria-hidden="true" size={16} />
        {tr("\u65B0\u5BF9\u8BDD")}
        {orbit ? (
          <ArrowUpRight className="session-new-button__arrow" aria-hidden="true" size={15} />
        ) : null}
      </button>

      <label className="session-search">
        <Search aria-hidden="true" size={14} />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={tr("\u641C\u7D22\u4F1A\u8BDD")}
          aria-label={tr("\u641C\u7D22\u4F1A\u8BDD")}
        />
      </label>

      {workspaceSessionError ? (
        <p className="session-sidebar__error form-error" role="alert">
          {workspaceSessionError}
        </p>
      ) : null}
      {actionError ? (
        <p className="session-sidebar__error form-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <nav
        className="session-groups"
        aria-label={tr("\u6309\u5DE5\u4F5C\u6587\u4EF6\u5939\u5206\u7C7B\u7684\u4F1A\u8BDD")}
      >
        {groups.length === 0 ? (
          <p className="session-list__empty">
            {search
              ? tr("\u6CA1\u6709\u5339\u914D\u7684\u4F1A\u8BDD")
              : tr("\u8FD8\u6CA1\u6709\u4F1A\u8BDD")}
          </p>
        ) : null}

        {groups.map((group) => {
          const expanded = Boolean(search) || expandedGroups.has(group.key);
          const showAll = Boolean(search.trim()) || showAllGroups.has(group.key);
          const visibleSessions = visibleSessionRows(
            group,
            expandedParents,
            showAll,
            Boolean(search.trim()),
          );
          const rowLimit = rowLimits[`${group.key}:${search}`] ?? 100;
          const renderedSessions = visibleSessions.slice(0, rowLimit);
          const GroupFolderIcon = expanded ? FolderOpen : Folder;
          return (
            <section className="session-group" key={group.key}>
              <div className="session-group__heading">
                <button
                  className="session-group__header"
                  type="button"
                  aria-expanded={expanded}
                  title={group.path ?? group.label}
                  onClick={() => {
                    toggleGroup(group.key);
                    if (!group.roots.length) void loadPage(group.path, false);
                  }}
                >
                  {expanded ? (
                    <ChevronDown aria-hidden="true" size={14} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={14} />
                  )}
                  <GroupFolderIcon aria-hidden="true" size={14} />
                  <span>{group.label || tr("未选择文件夹")}</span>
                  <code>
                    {catalogGroups.find((item) => workspaceKey(item.path) === group.key)?.total ??
                      group.roots.length}
                  </code>
                  {group.sessions.some((item) => unreadIds.has(item.id)) ? (
                    <span
                      className="session-group__unread"
                      title={tr("有已完成的未读任务")}
                      role="img"
                      aria-label={tr("有已完成的未读任务")}
                    />
                  ) : null}
                </button>
                <button
                  className="session-group__add"
                  type="button"
                  aria-label={tr("\u5728 {0} \u4E2D\u65B0\u5EFA\u4F1A\u8BDD", [group.label])}
                  title={tr("\u5728\u6B64\u6587\u4EF6\u5939\u4E2D\u65B0\u5EFA\u4F1A\u8BDD")}
                  disabled={creatingWorkspaceSession}
                  onClick={() => {
                    setExpandedGroups((current) => new Set([...current, group.key]));
                    onNewWorkspaceSession(group.path);
                  }}
                >
                  <Plus aria-hidden="true" size={13} />
                </button>
              </div>

              {expanded ? (
                <div className="session-group__list">
                  <VirtualSessionRows
                    items={renderedSessions.map((session) => {
                      const selected = session.id === selectedSessionId;
                      const running =
                        session.status === "running" || session.status === "waiting_approval";
                      const unread = unreadIds.has(session.id);
                      const run = runs[session.id];
                      const seconds = run
                        ? Math.max(
                            0,
                            Math.floor(
                              ((running ? now : Date.parse(run.completedAt ?? session.updatedAt)) -
                                Date.parse(run.startedAt)) /
                                1000,
                            ),
                          )
                        : null;
                      return (
                        <div
                          className={
                            group.children.has(session.id) || session.childCount
                              ? "session-row-wrap session-row-wrap--parent"
                              : "session-row-wrap"
                          }
                          key={session.id}
                          data-session-id={session.id}
                        >
                          <button
                            className={[
                              "session-row",
                              selected ? "session-row--selected" : "",
                              session.parentSessionId ? "session-row--child" : "",
                              unread ? "session-row--unread" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            type="button"
                            onContextMenu={(event) => {
                              event.preventDefault();
                              const rect = event.currentTarget.getBoundingClientRect();
                              setMenu({
                                session,
                                x: Math.max(
                                  8,
                                  Math.min(event.clientX || rect.left, window.innerWidth - 232),
                                ),
                                y: Math.max(
                                  8,
                                  Math.min(event.clientY || rect.bottom, window.innerHeight - 264),
                                ),
                              });
                            }}
                            onClick={() => onSelect(session.id)}
                            aria-current={selected ? "page" : undefined}
                          >
                            <span
                              className={
                                running
                                  ? `session-row__state session-row__state--${session.status}`
                                  : "session-row__state"
                              }
                              aria-hidden="true"
                            >
                              {unread && !running ? (
                                <Check size={13} className="session-row__completed" />
                              ) : (
                                <span className="session-row__status-square" />
                              )}
                            </span>
                            <span className="session-row__body">
                              <span className="session-row__title" title={session.title}>
                                {session.title}
                              </span>
                              <span className="session-row__meta">
                                <span className="session-row__status-label">
                                  {running
                                    ? pendingQuestionSessionIds.includes(session.id)
                                      ? tr("等待回答")
                                      : session.status === "waiting_approval"
                                        ? tr("\u7B49\u5F85\u6279\u51C6")
                                        : tr("\u8FD0\u884C\u4E2D")
                                    : unread
                                      ? tr("已完成 · 未读")
                                      : formatRelativeTime(session.updatedAt)}
                                </span>
                                {seconds !== null ? (
                                  <span className="session-row__elapsed">
                                    {tr("已运行 {0}", [formatDuration(seconds)])}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            {session.pinned ? (
                              <Pin
                                className="session-row__pin"
                                aria-label={tr("已置顶")}
                                size={12}
                              />
                            ) : null}
                          </button>
                          {group.children.has(session.id) || session.childCount ? (
                            <button
                              type="button"
                              className="session-row__children icon-button"
                              aria-label={tr(
                                expandedParents.has(session.id) ? "收起子 Agent" : "展开子 Agent",
                              )}
                              title={tr("子 Agent：{0}", [
                                session.childCount ?? group.children.get(session.id)?.length ?? 0,
                              ])}
                              aria-expanded={
                                Boolean(search.trim()) || expandedParents.has(session.id)
                              }
                              onClick={() => {
                                if (!expandedParents.has(session.id)) void loadChildren(session.id);
                                setExpandedParents((current) => {
                                  const next = new Set(current);
                                  if (next.has(session.id)) next.delete(session.id);
                                  else next.add(session.id);
                                  return next;
                                });
                              }}
                            >
                              {expandedParents.has(session.id) || search.trim() ? (
                                <ChevronDown size={14} />
                              ) : (
                                <ChevronRight size={14} />
                              )}
                            </button>
                          ) : null}
                          <button
                            className="session-row__menu icon-button"
                            type="button"
                            aria-label={tr("会话操作：{0}", [session.title])}
                            title={tr("会话操作")}
                            disabled={busy}
                            aria-haspopup="menu"
                            aria-expanded={menu?.session.id === session.id}
                            onClick={(event) => {
                              event.currentTarget.focus();
                              const rect = event.currentTarget.getBoundingClientRect();
                              setMenu({
                                session,
                                x: Math.max(8, Math.min(rect.right, window.innerWidth - 232)),
                                y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 264)),
                              });
                            }}
                          >
                            <MoreHorizontal aria-hidden="true" size={16} />
                          </button>
                        </div>
                      );
                    })}
                  />
                  {pages[group.key]?.cursor ? (
                    <button
                      className="session-group__show-all"
                      type="button"
                      onClick={() => void loadPage(group.path)}
                    >
                      {tr("加载更多会话")}
                    </button>
                  ) : null}
                  {visibleSessions.length > rowLimit ? (
                    <button
                      type="button"
                      className="session-group__show-all"
                      onClick={() =>
                        setRowLimits((current) => ({
                          ...current,
                          [`${group.key}:${search}`]: rowLimit + 100,
                        }))
                      }
                    >
                      {tr("显示更多（还有 {0} 个）", [visibleSessions.length - rowLimit])}
                    </button>
                  ) : null}
                  {(catalogGroups.find((item) => workspaceKey(item.path) === group.key)?.total ??
                    group.roots.length) > 3 && !search.trim() ? (
                    <button
                      className="session-group__show-all"
                      type="button"
                      aria-expanded={showAll}
                      onClick={() => {
                        if (!showAll && !pages[group.key]) void loadPage(group.path, false);
                        setShowAllGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        });
                      }}
                    >
                      <ChevronDown
                        aria-hidden="true"
                        size={13}
                        style={{ transform: showAll ? "rotate(180deg)" : undefined }}
                      />
                      {showAll
                        ? tr("收起，仅显示最近 3 个")
                        : tr("展开全部（还有 {0} 个）", [
                            Math.max(
                              0,
                              (catalogGroups.find((item) => workspaceKey(item.path) === group.key)
                                ?.total ?? group.roots.length) - 3,
                            ),
                          ])}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </nav>
      {search.trim() && searchCursor ? (
        <button
          className="session-group__show-all"
          type="button"
          onClick={() => {
            void window.mingshen
              .listSessionPage({ query: search, cursor: searchCursor, limit: 100 })
              .then(async (page) => {
                const rows = await withAncestors(page.sessions);
                if (searchRef.current !== search) return;
                setSearchRows((current) => [
                  ...new Map([...(current ?? []), ...rows].map((item) => [item.id, item])).values(),
                ]);
                setSearchCursor(page.nextCursor);
                onLoadSessions?.(rows);
              })
              .catch((error) => setActionError(String(error)));
          }}
        >
          {tr("加载更多搜索结果")}
        </button>
      ) : null}

      <footer className="session-sidebar__footer">
        <ShieldCheck aria-hidden="true" size={14} />
        <span>
          <strong>{tr("\u672C\u5730\u8FD0\u884C")}</strong>
          <small>
            {tr("\u4F1A\u8BDD\u4E0E\u5DE5\u5177\u8BB0\u5F55\u4FDD\u5B58\u5728\u6B64\u7535\u8111")}
          </small>
        </span>
      </footer>
      {menu
        ? createPortal(
            <div className="session-menu-layer">
              <button
                type="button"
                className="session-menu-scrim"
                aria-label={tr("关闭会话菜单")}
                onClick={() => setMenu(null)}
              />
              <div
                ref={menuRef}
                className="session-menu"
                role="menu"
                style={{ left: menu.x, top: menu.y }}
              >
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setRenaming(menu.session);
                    setTitle(menu.session.title);
                    setActionError("");
                    setMenu(null);
                  }}
                >
                  <Pencil size={14} />
                  {tr("重命名")}
                </button>
                <button
                  role="menuitem"
                  type="button"
                  disabled={["running", "waiting_approval"].includes(menu.session.status)}
                  onClick={() => void act(() => onFork(menu.session.id))}
                >
                  <GitBranch size={14} />
                  {tr("分支聊天")}
                </button>
                <button
                  role="menuitem"
                  type="button"
                  disabled={!menu.session.workspacePath}
                  title={menu.session.workspacePath ?? tr("此会话尚未设置工作目录。")}
                  onClick={() =>
                    void act(() => window.mingshen.openSessionWorkspace(menu.session.id))
                  }
                >
                  <FolderOpen aria-hidden="true" size={14} />
                  {tr("在资源管理器中打开")}
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() =>
                    void act(() =>
                      onPatch({ sessionId: menu.session.id, pinned: !menu.session.pinned }),
                    )
                  }
                >
                  <Pin size={14} />
                  {tr(menu.session.pinned ? "取消置顶" : "置顶")}
                </button>
                <button
                  role="menuitem"
                  type="button"
                  disabled={["running", "waiting_approval"].includes(menu.session.status)}
                  onClick={() =>
                    void act(() => onPatch({ sessionId: menu.session.id, archived: true }))
                  }
                >
                  <Archive size={14} />
                  {tr("归档")}
                </button>
                <button
                  role="menuitem"
                  type="button"
                  className="session-menu__danger"
                  onClick={() => void remove(menu.session)}
                >
                  <Trash2 size={14} />
                  {tr("删除")}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
      {renaming
        ? createPortal(
            <div className="mingshen-dialog-backdrop">
              <button
                className="mingshen-dialog-backdrop__dismiss"
                type="button"
                aria-label={tr("关闭对话框")}
                onClick={() => setRenaming(null)}
              />
              <form
                ref={renameDialogRef}
                className="mingshen-dialog session-rename-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rename-session-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (busy) return;
                  void act(() => onPatch({ sessionId: renaming.id, title: title.trim() })).then(
                    (saved) => {
                      if (saved) setRenaming(null);
                    },
                  );
                }}
              >
                <header className="session-rename-dialog__heading">
                  <h2 id="rename-session-title">{tr("重命名会话")}</h2>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={tr("关闭对话框")}
                    onClick={() => setRenaming(null)}
                  >
                    <X size={16} />
                  </button>
                </header>
                <label className="field">
                  <span>{tr("会话名称")}</span>
                  <input
                    ref={renameRef}
                    value={title}
                    maxLength={120}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                {actionError ? (
                  <p className="form-error" role="alert">
                    {actionError}
                  </p>
                ) : null}
                <footer className="mingshen-dialog__actions">
                  <button
                    className="btn btn--secondary"
                    type="button"
                    onClick={() => setRenaming(null)}
                  >
                    {tr("取消")}
                  </button>
                  <button
                    className="btn btn--primary"
                    type="submit"
                    disabled={busy || !title.trim()}
                  >
                    {tr("保存")}
                  </button>
                </footer>
              </form>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
