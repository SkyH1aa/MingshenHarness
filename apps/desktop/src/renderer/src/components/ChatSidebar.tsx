import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
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
import type { SessionPage } from "../../../shared/session-catalog";
import { useLocale } from "../i18n";
import { tr } from "../i18n/index";
import { formatRelativeTime } from "../lib/format";
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
  onLoadSessions: (sessions: SessionView[]) => void;
  onPatch: (input: SessionUpdateInput) => Promise<SessionView>;
  onRemove: (sessionId: string) => Promise<void>;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (groupId: string, name: string) => Promise<void>;
  onRemoveGroup: (groupId: string) => Promise<void>;
}

function ChatRow({
  session,
  selected,
  onSelect,
  onMenu,
}: {
  session: SessionView;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  onMenu: (session: SessionView) => void;
}) {
  return (
    <div
      className={`chat-session-row${selected ? " chat-session-row--selected" : ""}`}
      data-testid="chat-session-row"
      data-session-id={session.id}
    >
      <button
        className="chat-session-row__main"
        type="button"
        onClick={() => onSelect(session.id)}
        title={session.title}
      >
        <MessageCircle size={14} aria-hidden="true" />
        <span>
          <strong>{session.title}</strong>
          <small>{formatRelativeTime(session.updatedAt)}</small>
        </span>
        {session.pinned ? <Pin size={11} aria-label={tr("已置顶")} /> : null}
      </button>
      <button
        className="icon-button icon-button--small"
        type="button"
        aria-label={tr("对话操作")}
        onClick={() => onMenu(session)}
      >
        <MoreHorizontal size={14} />
      </button>
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
  onLoadSessions,
  onPatch,
  onRemove,
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

  const refreshArchived = async (next = !archivedOpen) => {
    setArchivedOpen(next);
    if (!next) return;
    setBusy(true);
    setError("");
    try {
      const rows: SessionView[] = [];
      let cursor: string | null = null;
      do {
        const page: SessionPage = await window.mingshen.listSessionPage({
          agentMode: "chat",
          archived: true,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        rows.push(...page.sessions);
        cursor = page.nextCursor;
      } while (cursor);
      setArchived(rows);
      onLoadSessions(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
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
        <button
          className="icon-button chat-sidebar__new"
          type="button"
          aria-label={tr("新建对话")}
          title={tr("新建对话")}
          data-testid="new-chat"
          disabled={creatingChatSession}
          aria-busy={creatingChatSession}
          onClick={() => newChat(null)}
        >
          {creatingChatSession ? (
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
          ) : (
            <Plus size={17} aria-hidden="true" />
          )}
        </button>
      </header>
      <div className="chat-sidebar__controls">
        <label className="chat-sidebar__search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr("搜索对话")}
            aria-label={tr("搜索对话")}
          />
          {search ? (
            <button type="button" aria-label={tr("清除搜索")} onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          ) : null}
        </label>
        {chatSessionError ? (
          <p className="chat-sidebar__error" role="alert">
            {chatSessionError}
          </p>
        ) : null}
      </div>
      <div className="chat-sidebar__scroll">
        <button
          className="chat-group-create"
          type="button"
          data-testid="chat-group-create"
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
                    onSelect={onSelect}
                    onMenu={setMenuSession}
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
                  disabled={creatingChatSession}
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
                      onSelect={onSelect}
                      onMenu={setMenuSession}
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
              disabled={creatingChatSession}
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
                  onSelect={onSelect}
                  onMenu={setMenuSession}
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
            {archived.map((session) => (
              <div
                className="chat-archived-row"
                key={session.id}
                data-testid="chat-archived-row"
                data-session-id={session.id}
              >
                <div className="chat-archived-row__copy" title={session.title}>
                  <MessageCircle size={13} />
                  <span>{session.title}</span>
                </div>
                <button
                  className="icon-button icon-button--small"
                  type="button"
                  aria-label={tr("恢复对话")}
                  title={tr("恢复对话")}
                  data-testid="chat-archived-restore"
                  onClick={() => void patch({ sessionId: session.id, archived: false })}
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="chat-sidebar__error" role="alert">
            {error}
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
