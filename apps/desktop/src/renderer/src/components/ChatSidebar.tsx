import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ChatGroupView, SessionUpdateInput, SessionView } from "../../../shared/domain";
import { useLocale } from "../i18n";
import { tr } from "../i18n/index";
import { formatRelativeTime } from "../lib/format";
import { loadChatSessionSnapshot } from "../lib/session-catalog-sync";
import {
  planSessionBatch,
  runSessionBatch,
  type SessionBatchAction,
  type SessionBatchResult,
} from "../lib/session-management";
import { useDialog } from "./DialogProvider";
import { RenameSessionDialog } from "./RenameSessionDialog";

interface ChatSidebarProps {
  sessions: SessionView[];
  groups: ChatGroupView[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewChat: (groupId: string | null) => void;
  creatingChatSession: boolean;
  chatSessionError: string;
  catalogReady: boolean;
  catalogError: string;
  onRetryCatalog: () => void;
  onLoadSessions: (sessions: SessionView[]) => void;
  onPatch: (input: SessionUpdateInput) => Promise<SessionView>;
  onRemove: (sessionId: string) => Promise<void>;
  onBatchChanged: (action: SessionBatchAction, result: SessionBatchResult) => Promise<void>;
  onBatchBusyChange: (busy: boolean) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (groupId: string, name: string) => Promise<void>;
  onRemoveGroup: (groupId: string) => Promise<void>;
}

function ChatRow({
  session,
  selected,
  managing,
  checked,
  disabled,
  onSelect,
  onMenu,
  onToggle,
}: {
  session: SessionView;
  selected: boolean;
  managing: boolean;
  checked: boolean;
  disabled: boolean;
  onSelect: (sessionId: string) => void;
  onMenu: (session: SessionView) => void;
  onToggle: (sessionId: string) => void;
}) {
  return (
    <div
      className={`chat-session-row${selected ? " chat-session-row--selected" : ""}${managing ? " chat-session-row--managing" : ""}`}
      data-testid="chat-session-row"
      data-session-id={session.id}
    >
      {managing ? (
        <input
          className="chat-sidebar__checkbox"
          type="checkbox"
          aria-label={tr("选择会话：{0}", [session.title])}
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle(session.id)}
        />
      ) : null}
      <button
        className="chat-session-row__main"
        type="button"
        disabled={disabled}
        onClick={() => (managing ? onToggle(session.id) : onSelect(session.id))}
        title={session.title}
      >
        <MessageCircle size={14} aria-hidden="true" />
        <span>
          <strong>{session.title}</strong>
          <small>{formatRelativeTime(session.updatedAt)}</small>
        </span>
        {session.pinned ? <Pin size={11} aria-label={tr("已置顶")} /> : null}
      </button>
      {!managing ? (
        <button
          className="icon-button icon-button--small"
          type="button"
          aria-label={tr("对话操作")}
          disabled={disabled}
          onClick={() => onMenu(session)}
        >
          <MoreHorizontal size={14} />
        </button>
      ) : null}
    </div>
  );
}

export function ChatSidebar({
  sessions,
  groups,
  selectedSessionId,
  onSelect,
  onNewChat,
  creatingChatSession,
  chatSessionError,
  catalogReady,
  catalogError,
  onRetryCatalog,
  onLoadSessions,
  onPatch,
  onRemove,
  onBatchChanged,
  onBatchBusyChange,
  onCreateGroup,
  onRenameGroup,
  onRemoveGroup,
}: ChatSidebarProps) {
  const { confirm } = useDialog();
  const en = useLocale() === "en";
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [nameEditor, setNameEditor] = useState<{
    kind: "create" | "rename";
    groupId?: string;
    value: string;
  } | null>(null);
  const [menuSession, setMenuSession] = useState<SessionView | null>(null);
  const [renaming, setRenaming] = useState<SessionView | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archived, setArchived] = useState<SessionView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState("");
  const [batchResult, setBatchResult] = useState<{
    action: SessionBatchAction;
    value: SessionBatchResult;
  } | null>(null);
  const batchPending = useRef(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const activeChats = useMemo(
    () =>
      sessions
        .filter(
          (session) =>
            session.agentMode === "chat" &&
            !session.archived &&
            (!normalizedSearch || session.title.toLocaleLowerCase().includes(normalizedSearch)),
        )
        .sort((left, right) => {
          if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
          return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
        }),
    [normalizedSearch, sessions],
  );
  const pinned = activeChats.filter((session) => session.pinned);
  const matchingArchived = archived.filter(
    (session) => !normalizedSearch || session.title.toLocaleLowerCase().includes(normalizedSearch),
  );
  const selectable = [...activeChats, ...(archivedOpen ? matchingArchived : [])].filter(
    (session) => session.parentSessionId === null,
  );
  const picked = selectable.filter((session) => selected.has(session.id));
  const allSelected = selectable.length > 0 && picked.length === selectable.length;
  const nameEditorOpen = Boolean(nameEditor);
  const grouped = new Map<string, SessionView[]>();
  for (const session of activeChats.filter((item) => !item.pinned)) {
    const key = session.chatGroupId ?? "";
    grouped.set(key, [...(grouped.get(key) ?? []), session]);
  }

  useEffect(() => {
    if (!nameEditorOpen) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [nameEditorOpen]);

  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate = picked.length > 0 && !allSelected;
  }, [allSelected, picked.length]);

  const resetSelection = () => {
    setSelected(new Set());
    setBatchResult(null);
    setError("");
  };

  const toggleSelection = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadArchived = async () => {
    setArchived([]);
    try {
      const rows = await loadChatSessionSnapshot(
        (input) => window.mingshen.listSessionPage(input),
        true,
      );
      setArchived(rows);
      onLoadSessions(rows);
    } catch (cause) {
      setArchivedOpen(false);
      throw cause;
    }
  };

  const refreshArchived = async (next = !archivedOpen) => {
    if (busy || batchPending.current) return;
    resetSelection();
    setArchivedOpen(next);
    if (!next) return;
    setBusy(true);
    setError("");
    try {
      await loadArchived();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const applyBatch = async (action: SessionBatchAction) => {
    if (batchPending.current || busy || !catalogReady || !picked.length) return;
    batchPending.current = true;
    onBatchBusyChange(true);
    setBusy(true);
    setError("");
    setBatchResult(null);
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
                  "将永久删除 {0} 个对话及 {1} 个子会话的消息、草稿和附件，无法撤销。运行中的任务会先停止。",
                  [plan.roots.length, plan.sessions.length - plan.roots.length],
                )
              : tr(
                  "将归档 {0} 个对话及 {1} 个子会话并暂停关联的定时任务，草稿会保留。运行中的任务需先停止；恢复后定时任务不会自动开启。",
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
      setBatchResult({ action, value });
      setSelected(new Set(value.failures.map((failure) => failure.sessionId)));
      const succeeded = new Set(value.succeeded);
      const removed = new Set(value.removedIds);
      setArchived((current) => {
        const remaining = current.filter((session) => !removed.has(session.id));
        if (action === "archive") {
          const existing = new Set(remaining.map((session) => session.id));
          return [
            ...remaining,
            ...plan.roots
              .filter((session) => succeeded.has(session.id) && !existing.has(session.id))
              .map((session) => ({ ...session, archived: true })),
          ];
        }
        return action === "restore"
          ? remaining.filter((session) => !succeeded.has(session.id))
          : remaining;
      });
      try {
        await onBatchChanged(action, value);
      } finally {
        if (archivedOpen) await loadArchived();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProgress("");
      setBusy(false);
      batchPending.current = false;
      onBatchBusyChange(false);
    }
  };

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    const value = nameEditor?.value.trim();
    if (!nameEditor || !value || busy) return;
    setBusy(true);
    setError("");
    try {
      if (nameEditor.kind === "create") await onCreateGroup(value);
      else if (nameEditor.groupId) await onRenameGroup(nameEditor.groupId, value);
      setNameEditor(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const groupMenu = async (group: ChatGroupView) => {
    const action = await confirm({
      title: en ? `Delete group "${group.name}"?` : `删除分组「${group.name}」？`,
      description: en
        ? "The group will be removed. Its conversations, history, drafts and attachments remain, and the conversations move to Ungrouped."
        : "分组将被删除，其中的对话会移到“未分组”，历史、草稿和附件均保留。",
      confirmLabel: tr("删除分组"),
      cancelLabel: tr("取消"),
      tone: "danger",
    });
    if (action) {
      setBusy(true);
      setError("");
      try {
        await onRemoveGroup(group.id);
        setArchived((current) =>
          current.map((session) =>
            session.chatGroupId === group.id ? { ...session, chatGroupId: null } : session,
          ),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    }
  };

  const patch = async (input: SessionUpdateInput) => {
    setBusy(true);
    setError("");
    try {
      const updated = await onPatch(input);
      setArchived((current) =>
        input.archived === true
          ? [...current.filter((item) => item.id !== updated.id), updated]
          : input.archived === false
            ? current.filter((item) => item.id !== updated.id)
            : current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setMenuSession(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (session: SessionView) => {
    const accepted = await confirm({
      title: tr("删除对话"),
      description: tr("删除「{0}」及其全部消息？此操作无法撤销。", [session.title]),
      confirmLabel: tr("删除"),
      tone: "danger",
    });
    if (!accepted) return;
    setBusy(true);
    try {
      await onRemove(session.id);
      setArchived((current) => current.filter((item) => item.id !== session.id));
      setMenuSession(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleGroup = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const newChat = (groupId: string | null) => {
    if (creatingChatSession) return;
    setSearch("");
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(groupId ?? "ungrouped");
      return next;
    });
    onNewChat(groupId);
  };

  return (
    <aside
      className="chat-sidebar"
      aria-label={tr("ChatAgent 对话")}
      data-testid="chat-sidebar"
      data-agent-mode="chat"
    >
      <header className="chat-sidebar__header">
        <div>
          <strong>{tr("对话")}</strong>
          <small>{activeChats.length ? tr("{0} 个会话", [activeChats.length]) : ""}</small>
        </div>
        <div className="chat-sidebar__header-actions">
          <button
            className="icon-button chat-sidebar__manage"
            type="button"
            aria-label={tr(managing ? "退出批量管理" : "批量管理对话")}
            title={tr(managing ? "退出批量管理" : "批量管理对话")}
            data-testid="chat-batch-toggle"
            aria-pressed={managing}
            disabled={busy || (!catalogReady && !managing)}
            onClick={() => {
              setManaging((current) => !current);
              resetSelection();
            }}
          >
            <ListChecks size={17} aria-hidden="true" />
          </button>
          <button
            className="icon-button chat-sidebar__new"
            type="button"
            aria-label={tr("新建对话")}
            title={tr("新建对话")}
            data-testid="new-chat"
            disabled={creatingChatSession || managing || busy}
            aria-busy={creatingChatSession}
            onClick={() => newChat(null)}
          >
            {creatingChatSession ? (
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
            ) : (
              <Plus size={17} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>
      <div className="chat-sidebar__controls">
        <label className="chat-sidebar__search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={search}
            disabled={busy}
            onChange={(event) => {
              setSearch(event.target.value);
              resetSelection();
            }}
            placeholder={tr("搜索对话")}
            aria-label={tr("搜索对话")}
          />
          {search ? (
            <button
              type="button"
              aria-label={tr("清除搜索")}
              disabled={busy}
              onClick={() => {
                setSearch("");
                resetSelection();
              }}
            >
              <X size={13} />
            </button>
          ) : null}
        </label>
        {managing ? (
          <div className="chat-sidebar__batch" aria-busy={busy}>
            <div className="chat-sidebar__batch-select">
              <label>
                <input
                  ref={selectAllRef}
                  className="chat-sidebar__checkbox"
                  type="checkbox"
                  data-testid="chat-batch-select-all"
                  checked={allSelected}
                  disabled={busy || !catalogReady || !selectable.length}
                  onChange={(event) =>
                    setSelected(
                      new Set(event.target.checked ? selectable.map((session) => session.id) : []),
                    )
                  }
                />
                <span>{tr("全选匹配会话（{0}）", [selectable.length])}</span>
              </label>
              <span role="status">{tr("已选 {0}", [picked.length])}</span>
            </div>
            <div className="chat-sidebar__batch-actions">
              <button
                type="button"
                className="btn btn--secondary"
                data-session-action="archive"
                title={tr("归档所选未归档会话")}
                disabled={
                  busy ||
                  !catalogReady ||
                  !picked.length ||
                  picked.some((session) => session.archived)
                }
                onClick={() => void applyBatch("archive")}
              >
                <Archive size={13} aria-hidden="true" />
                {tr("归档")}
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                data-session-action="restore"
                title={tr("恢复所选已归档会话")}
                disabled={
                  busy ||
                  !catalogReady ||
                  !picked.length ||
                  picked.some((session) => !session.archived)
                }
                onClick={() => void applyBatch("restore")}
              >
                <RotateCcw size={13} aria-hidden="true" />
                {tr("恢复")}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                data-session-action="delete"
                title={tr("删除所选会话")}
                disabled={busy || !catalogReady || !picked.length}
                onClick={() => void applyBatch("delete")}
              >
                <Trash2 size={13} aria-hidden="true" />
                {tr("删除")}
              </button>
            </div>
            {progress ? <p role="status">{progress}</p> : null}
            {batchResult ? (
              <div className="chat-sidebar__batch-result" role="status">
                <p>
                  {tr(
                    {
                      archive: "已归档 {0} 个主会话。",
                      restore: "已恢复 {0} 个主会话。",
                      delete: "已删除 {0} 个主会话。",
                    }[batchResult.action],
                    [batchResult.value.succeeded.length],
                  )}{" "}
                  {batchResult.value.failures.length
                    ? tr("有 {0} 个会话未完成，已保留勾选，可重试。", [
                        batchResult.value.failures.length,
                      ])
                    : ""}
                </p>
                {batchResult.value.failures.length ? (
                  <ul>
                    {batchResult.value.failures.map((failure) => (
                      <li key={failure.sessionId}>
                        <strong>{failure.title}</strong>: {tr(failure.message)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {chatSessionError ? (
          <p className="chat-sidebar__error" role="alert">
            {chatSessionError}
          </p>
        ) : null}
        {catalogError ? (
          <div className="chat-sidebar__error" role="alert">
            <span>{catalogError}</span>{" "}
            <button type="button" className="btn btn--secondary" onClick={onRetryCatalog}>
              <RotateCcw size={13} aria-hidden="true" />
              {tr("重试")}
            </button>
          </div>
        ) : null}
      </div>
      <div className="chat-sidebar__scroll">
        <button
          className="chat-group-create"
          type="button"
          data-testid="chat-group-create"
          disabled={busy || managing}
          onClick={() => setNameEditor({ kind: "create", value: "" })}
        >
          <FolderPlus size={14} aria-hidden="true" />
          {tr("新建分组")}
        </button>

        {pinned.length ? (
          <section className="chat-session-group">
            <button
              className="chat-session-group__heading"
              type="button"
              onClick={() => toggleGroup("pinned")}
              aria-expanded={!collapsed.has("pinned")}
            >
              {collapsed.has("pinned") ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <Pin size={13} aria-hidden="true" />
              <span>{tr("置顶")}</span>
              <code>{pinned.length}</code>
            </button>
            {!collapsed.has("pinned")
              ? pinned.map((session) => (
                  <ChatRow
                    session={session}
                    selected={selectedSessionId === session.id}
                    managing={managing}
                    checked={selected.has(session.id)}
                    disabled={busy || (managing && session.parentSessionId !== null)}
                    onSelect={onSelect}
                    onMenu={setMenuSession}
                    onToggle={toggleSelection}
                    key={session.id}
                  />
                ))
              : null}
          </section>
        ) : null}

        {groups.map((group) => {
          const rows = grouped.get(group.id) ?? [];
          const groupCollapsed = collapsed.has(group.id);
          return (
            <section className="chat-session-group" key={group.id} data-chat-group-id={group.id}>
              <div className="chat-session-group__header">
                <button
                  className="chat-session-group__heading"
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={!groupCollapsed}
                  title={group.name}
                >
                  {groupCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <Folder size={13} aria-hidden="true" />
                  <span>{group.name}</span>
                  <code>{rows.length}</code>
                </button>
                <button
                  className="icon-button icon-button--small"
                  type="button"
                  aria-label={tr("在 {0} 中新建对话", [group.name])}
                  title={tr("在 {0} 中新建对话", [group.name])}
                  data-testid="chat-group-new"
                  disabled={creatingChatSession || managing || busy}
                  aria-busy={creatingChatSession}
                  onClick={() => newChat(group.id)}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
                <button
                  className="icon-button icon-button--small"
                  type="button"
                  aria-label={tr("重命名分组")}
                  title={tr("重命名分组")}
                  data-testid="chat-group-rename"
                  disabled={busy || managing}
                  onClick={() =>
                    setNameEditor({ kind: "rename", groupId: group.id, value: group.name })
                  }
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="icon-button icon-button--small chat-session-group__delete"
                  type="button"
                  aria-label={tr("删除分组")}
                  title={tr("删除分组")}
                  data-testid="chat-group-delete"
                  disabled={busy || managing}
                  onClick={() => void groupMenu(group)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {!groupCollapsed
                ? rows.map((session) => (
                    <ChatRow
                      session={session}
                      selected={selectedSessionId === session.id}
                      managing={managing}
                      checked={selected.has(session.id)}
                      disabled={busy || (managing && session.parentSessionId !== null)}
                      onSelect={onSelect}
                      onMenu={setMenuSession}
                      onToggle={toggleSelection}
                      key={session.id}
                    />
                  ))
                : null}
            </section>
          );
        })}

        <section className="chat-session-group" data-chat-group-id="">
          <div className="chat-session-group__header chat-session-group__header--ungrouped">
            <button
              className="chat-session-group__heading"
              type="button"
              onClick={() => toggleGroup("ungrouped")}
              aria-expanded={!collapsed.has("ungrouped")}
            >
              {collapsed.has("ungrouped") ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <MessageCircle size={13} aria-hidden="true" />
              <span>{tr("未分组")}</span>
              <code>{(grouped.get("") ?? []).length}</code>
            </button>
            <button
              className="icon-button icon-button--small"
              type="button"
              aria-label={tr("在 {0} 中新建对话", [tr("未分组")])}
              title={tr("在 {0} 中新建对话", [tr("未分组")])}
              data-testid="chat-group-new"
              disabled={creatingChatSession || managing || busy}
              aria-busy={creatingChatSession}
              onClick={() => newChat(null)}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>
          {!collapsed.has("ungrouped")
            ? (grouped.get("") ?? []).map((session) => (
                <ChatRow
                  session={session}
                  selected={selectedSessionId === session.id}
                  managing={managing}
                  checked={selected.has(session.id)}
                  disabled={busy || (managing && session.parentSessionId !== null)}
                  onSelect={onSelect}
                  onMenu={setMenuSession}
                  onToggle={toggleSelection}
                  key={session.id}
                />
              ))
            : null}
        </section>

        <button
          className="chat-sidebar__archive-toggle"
          type="button"
          data-testid="chat-archive-toggle"
          aria-expanded={archivedOpen}
          disabled={busy}
          onClick={() => void refreshArchived()}
        >
          <Archive size={14} aria-hidden="true" />
          {tr("已归档")}
          {archivedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {archivedOpen ? (
          <div className="chat-sidebar__archive-list">
            {busy && !archived.length ? <p>{tr("正在加载…")}</p> : null}
            {!busy && !archived.length ? <p>{tr("暂无已归档对话")}</p> : null}
            {!busy && archived.length > 0 && !matchingArchived.length ? (
              <p>{tr("没有匹配的会话。")}</p>
            ) : null}
            {matchingArchived.map((session) => (
              <div
                className={`chat-archived-row${managing ? " chat-archived-row--managing" : ""}`}
                key={session.id}
                data-testid="chat-archived-row"
                data-session-id={session.id}
              >
                {managing ? (
                  <input
                    className="chat-sidebar__checkbox"
                    type="checkbox"
                    checked={selected.has(session.id)}
                    disabled={busy || session.parentSessionId !== null}
                    aria-label={tr("选择会话：{0}", [session.title])}
                    onChange={() => toggleSelection(session.id)}
                  />
                ) : null}
                <div className="chat-archived-row__copy" title={session.title}>
                  <MessageCircle size={13} />
                  <span>{session.title}</span>
                </div>
                {!managing ? (
                  <button
                    className="icon-button icon-button--small"
                    type="button"
                    aria-label={tr("恢复对话")}
                    title={tr("恢复对话")}
                    data-testid="chat-archived-restore"
                    disabled={busy}
                    onClick={() => void patch({ sessionId: session.id, archived: false })}
                  >
                    <RotateCcw size={13} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="chat-sidebar__error" role="alert">
            {tr(error)}
          </p>
        ) : null}
      </div>
      {nameEditor ? (
        <div className="chat-sidebar__name-editor" role="dialog" aria-label={tr("分组名称")}>
          <form onSubmit={saveName}>
            <input
              ref={nameInputRef}
              maxLength={80}
              value={nameEditor.value}
              onChange={(event) => setNameEditor({ ...nameEditor, value: event.target.value })}
              placeholder={tr("分组名称")}
              aria-label={tr("分组名称")}
            />
            <button
              className="btn btn--primary"
              type="submit"
              disabled={!nameEditor.value.trim() || busy}
            >
              {tr("保存")}
            </button>
            <button
              className="icon-button icon-button--small"
              type="button"
              aria-label={tr("取消")}
              onClick={() => setNameEditor(null)}
            >
              <X size={14} />
            </button>
          </form>
        </div>
      ) : null}
      {renaming ? (
        <RenameSessionDialog
          title={renaming.title}
          onClose={() => setRenaming(null)}
          onSave={async (title) => {
            await onPatch({ sessionId: renaming.id, title });
            setRenaming(null);
            setMenuSession(null);
          }}
        />
      ) : null}
      {menuSession ? (
        <div className="dialog-backdrop">
          <button
            className="dialog-scrim"
            type="button"
            aria-label={tr("关闭")}
            onClick={() => setMenuSession(null)}
          />
          <section className="dialog chat-session-menu" role="dialog" aria-modal="true">
            <header className="dialog__header">
              <div>
                <h2>{menuSession.title}</h2>
                <p>{tr("对话操作")}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={tr("关闭")}
                onClick={() => setMenuSession(null)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="chat-session-menu__body">
              <button type="button" onClick={() => setRenaming(menuSession)}>
                <Pencil size={15} />
                {tr("重命名")}
              </button>
              <button
                type="button"
                onClick={() =>
                  void patch({ sessionId: menuSession.id, pinned: !menuSession.pinned })
                }
              >
                <Pin size={15} />
                {menuSession.pinned ? tr("取消置顶") : tr("置顶")}
              </button>
              <label>
                <Folder size={15} aria-hidden="true" />
                <span>{tr("移动到分组")}</span>
                <select
                  value={menuSession.chatGroupId ?? ""}
                  onChange={(event) =>
                    void patch({
                      sessionId: menuSession.id,
                      chatGroupId: event.target.value || null,
                    })
                  }
                >
                  <option value="">{tr("未分组")}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void patch({ sessionId: menuSession.id, archived: true })}
              >
                <Archive size={15} />
                {tr("归档")}
              </button>
              <button
                className="chat-session-menu__danger"
                type="button"
                onClick={() => void remove(menuSession)}
              >
                <Trash2 size={15} />
                {tr("删除")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
