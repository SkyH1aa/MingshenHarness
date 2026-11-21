import {
  Command as CommandIcon,
  FileCode2,
  Files,
  History,
  Image,
  LoaderCircle,
  MessageSquareText,
  MonitorCog,
  PanelTop,
  Search,
  Settings,
  SquareTerminal,
  Workflow,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CustomCommandView, SessionView } from "../../../shared/domain";
import type { SessionProjectContexts } from "../../../shared/project-navigation";
import { useLocale } from "../i18n";
import { tr } from "../i18n/index";
import {
  commandPaletteCommandAvailable,
  currentPaletteSession,
  paletteSearchScopeMatches,
} from "../lib/command-palette-policy";
import { formatRelativeTime } from "../lib/format";
import { beginLatestRequest, invalidateLatestRequests } from "../lib/latest-request";
import "./CommandPalette.css";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  sessionId?: string | null;
  onOpenFile: (absolutePath: string) => void;
  onSelectSession: (sessionId: string) => void;
  onCommand: (commandId: string) => void;
}

interface CommandEntry {
  id: string;
  label: string;
  description: string;
  englishLabel?: string;
  englishDescription?: string;
  keywords?: string;
}

interface PaletteItem {
  key: string;
  kind: "command" | "file" | "session";
  label: string;
  description: string;
  meta?: string;
  commandId?: string;
  path?: string;
  sessionId?: string;
}

const APP_COMMANDS: readonly CommandEntry[] = [
  {
    id: "settings",
    label: "打开设置",
    description: "应用、模型、扩展与工作区设置",
    englishLabel: "Open settings",
    englishDescription: "Application, model, extension and workspace settings",
  },
  {
    id: "new-session",
    label: "新建会话",
    description: "在当前工作面创建新对话",
    englishLabel: "New conversation",
    englishDescription: "Create a conversation in the current work surface",
  },
  {
    id: "terminal",
    label: "打开终端",
    description: "切换到终端面板",
    englishLabel: "Open terminal",
    englishDescription: "Switch to the terminal panel",
  },
  {
    id: "files",
    label: "打开文件",
    description: "浏览当前工作目录",
    englishLabel: "Open files",
    englishDescription: "Browse the current workspace",
  },
  {
    id: "review",
    label: "查看代码审查",
    description: "查看改动、diff 与检查结果",
    englishLabel: "Open code review",
    englishDescription: "Review changes, diffs and checks",
  },
  {
    id: "workstation",
    label: "打开 Mingshen 工作站",
    description: "模板、方案与办公工作流",
    englishLabel: "Open Mingshen workstation",
    englishDescription: "Templates, proposals and office workflows",
  },
  {
    id: "image-studio",
    label: "打开生图工作台",
    description: "提示词、画布与图片生成",
    englishLabel: "Open image studio",
    englishDescription: "Prompting, canvas and image generation",
  },
];

const SLASH_COMMANDS: readonly CommandEntry[] = [
  {
    id: "rename",
    label: "/rename",
    description: "重命名当前聊天",
    englishDescription: "Rename the current conversation",
  },
  {
    id: "compact",
    label: "/compact",
    description: "生成摘要，释放上下文空间",
    englishDescription: "Summarize history to free context",
  },
  {
    id: "archive",
    label: "/archive",
    description: "归档当前聊天",
    englishDescription: "Archive the current conversation",
  },
  {
    id: "fork",
    label: "/fork",
    description: "复制完整上下文并新建分支聊天",
    englishDescription: "Fork the full context into a new conversation",
  },
  {
    id: "skills",
    label: "/skills",
    description: "引用已安装技能",
    englishDescription: "Reference an installed skill",
  },
  {
    id: "plugins",
    label: "/plugins",
    description: "引用已安装插件",
    englishDescription: "Reference an installed plugin",
  },
  {
    id: "status",
    label: "/status",
    description: "查看上下文、模型与运行信息",
    englishDescription: "Inspect context, model and runtime status",
  },
  {
    id: "plan",
    label: "/plan",
    description: "切换到只读计划 Agent",
    englishDescription: "Switch to the read-only planning agent",
  },
  {
    id: "mcp",
    label: "/mcp",
    description: "管理 MCP 连接",
    englishDescription: "Manage MCP connections",
  },
  {
    id: "remember",
    label: "/remember",
    description: "保存一条精简的长期信息",
    englishDescription: "Save concise long-term information",
  },
  {
    id: "forget",
    label: "/forget",
    description: "删除指定记忆",
    englishDescription: "Remove a specific memory",
  },
  {
    id: "memory",
    label: "/memory",
    description: "查看、搜索或管理项目记忆",
    englishDescription: "Inspect, search or manage project memory",
  },
];
function commandIcon(id: string) {
  if (id === "settings") return <Settings aria-hidden="true" size={16} />;
  if (id === "new-session") return <PanelTop aria-hidden="true" size={16} />;
  if (id === "terminal") return <SquareTerminal aria-hidden="true" size={16} />;
  if (id === "files") return <Files aria-hidden="true" size={16} />;
  if (id === "review") return <FileCode2 aria-hidden="true" size={16} />;
  if (id === "workstation") return <Workflow aria-hidden="true" size={16} />;
  if (id === "image-studio") return <Image aria-hidden="true" size={16} />;
  return <CommandIcon aria-hidden="true" size={16} />;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function matchesCommand(command: CommandEntry, query: string): boolean {
  if (!query) return true;
  return normalized(
    `${command.id} ${command.label} ${command.description} ${command.englishLabel ?? ""} ${command.englishDescription ?? ""} ${command.keywords ?? ""}`,
  ).includes(query);
}

function workspaceLabel(path: string | null): string {
  if (!path) return tr("聊天");
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || path
  );
}

function mergeSessions(primary: SessionView[], chat: SessionView[]): SessionView[] {
  const now = Date.now();
  return [...primary, ...chat]
    .sort((left, right) => {
      const leftTime = Date.parse(left.lastOpenedAt ?? left.updatedAt);
      const rightTime = Date.parse(right.lastOpenedAt ?? right.updatedAt);
      const leftFuture = !Number.isFinite(leftTime) || leftTime > now + 5 * 60_000;
      const rightFuture = !Number.isFinite(rightTime) || rightTime > now + 5 * 60_000;
      if (leftFuture !== rightFuture) return leftFuture ? 1 : -1;
      return Number(right.pinned) - Number(left.pinned) || rightTime - leftTime;
    })
    .slice(0, 12);
}

async function settle<T>(promise: Promise<T>): Promise<{ value: T | null; error: string | null }> {
  try {
    return { value: await promise, error: null };
  } catch (cause) {
    return {
      value: null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export function CommandPalette({
  open,
  onClose,
  sessionId,
  onOpenFile,
  onSelectSession,
  onCommand,
}: CommandPaletteProps) {
  const en = useLocale() === "en";
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [session, setSession] = useState<SessionView | null>(null);
  const [customCommands, setCustomCommands] = useState<{
    sessionId: string;
    commands: CustomCommandView[];
  } | null>(null);
  const [fileResults, setFileResults] = useState<{
    sessionId: string | null | undefined;
    query: string;
    items: Array<{ name: string; path: string; relativePath: string }>;
    root: string;
  } | null>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [contexts, setContexts] = useState<SessionProjectContexts["contexts"]>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const currentSession = currentPaletteSession(session, sessionId);
  const currentFileResults =
    currentSession && fileResults && paletteSearchScopeMatches(fileResults, sessionId, query)
      ? fileResults
      : null;

  useEffect(() => {
    if (!open) return;
    const modal = modalRef.current;
    try {
      if (modal && !modal.open) modal.showModal();
    } catch {
      // Closing or replacing the portal can race with the browser modal lifecycle.
    }
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setSelectedIndex(0);
    setFileResults(null);
    setSessions([]);
    setContexts({});
    setError("");
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      if (modal?.open) modal.close();
      const previous = restoreFocusRef.current;
      if (previous?.isConnected) requestAnimationFrame(() => previous.focus());
    };
  }, [open]);

  useEffect(() => {
    let alive = true;
    setSession(null);
    setCustomCommands(null);
    if (!open || !sessionId) {
      return;
    }
    void window.mingshen
      .getSession(sessionId)
      .then(async (current) => {
        if (!alive) return;
        setSession(current);
        if (!current?.workspacePath) {
          return;
        }
        const commands = await window.mingshen.listCustomCommands(current.workspacePath);
        if (alive)
          setCustomCommands({
            sessionId,
            commands: commands.filter(
              (command) =>
                !command.agent ||
                command.agent === current.agentMode ||
                (command.agent === "code" && current.agentMode === "work"),
            ),
          });
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
    };
  }, [open, sessionId]);

  useEffect(() => {
    if (!open) return;
    const request = beginLatestRequest(requestRef);
    const search = query.trim();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      const includeFiles =
        Boolean(search) &&
        Boolean(sessionId) &&
        Boolean(currentSession?.workspacePath) &&
        currentSession?.agentMode !== "chat";
      void Promise.all([
        settle(window.mingshen.listSessionPage({ query: search, limit: 8 })),
        settle(window.mingshen.listSessionPage({ query: search, agentMode: "chat", limit: 8 })),
        includeFiles
          ? settle(
              window.mingshen.searchWorkspaceFiles({
                sessionId: sessionId as string,
                query: search,
                limit: 40,
              }),
            )
          : Promise.resolve({ value: null, error: null }),
      ])
        .then(async ([workspaceResult, chatResult, fileResult]) => {
          if (!request.isCurrent()) return;
          const merged = mergeSessions(
            workspaceResult.value?.sessions ?? [],
            chatResult.value?.sessions ?? [],
          );
          const projectContexts = merged.length
            ? await window.mingshen
                .getProjectContexts(merged.map((item) => item.id))
                .catch(() => ({ contexts: {} }))
            : { contexts: {} };
          if (!request.isCurrent()) return;
          setSessions(merged);
          setSelectedIndex(0);
          setContexts(projectContexts.contexts);
          setFileResults({
            sessionId,
            query: search,
            items: fileResult.value?.items ?? [],
            root: fileResult.value?.root ?? currentSession?.workspacePath ?? "",
          });
          setError(
            [workspaceResult.error, chatResult.error, fileResult.error]
              .filter((message): message is string => Boolean(message))
              .join("\n"),
          );
        })
        .finally(() => {
          if (request.isCurrent()) setLoading(false);
        });
    }, 140);
    return () => {
      window.clearTimeout(timer);
      invalidateLatestRequests(requestRef);
    };
  }, [open, query, currentSession?.agentMode, currentSession?.workspacePath, sessionId]);

  const commandItems = useMemo(() => {
    const sourceQuery = normalized(query);
    return [
      ...[...APP_COMMANDS, ...SLASH_COMMANDS]
        .filter(
          (command) =>
            matchesCommand(command, sourceQuery) &&
            commandPaletteCommandAvailable(command.id, currentSession),
        )
        .map<PaletteItem>((command) => ({
          key: `command:${command.id}`,
          kind: "command",
          label: en ? (command.englishLabel ?? command.label) : command.label,
          description: en
            ? (command.englishDescription ?? command.description)
            : command.description,
          meta: tr("命令"),
          commandId: command.id,
        })),
      ...(customCommands && currentSession && customCommands.sessionId === currentSession.id
        ? customCommands.commands
        : []
      )
        .filter(
          (command) =>
            normalized(`${command.name} ${command.description}`).includes(sourceQuery) &&
            commandPaletteCommandAvailable(`custom:${command.name}`, currentSession),
        )
        .map<PaletteItem>((command) => ({
          key: `custom:${command.id}`,
          kind: "command",
          label: `/${command.name}`,
          description: command.description || tr("自定义命令"),
          meta: tr("自定义"),
          commandId: `custom:${command.name}`,
        })),
    ];
  }, [customCommands, currentSession, en, query]);

  const sessionItems = useMemo<PaletteItem[]>(
    () =>
      sessions.map((item) => ({
        key: `session:${item.id}`,
        kind: "session",
        label: item.title,
        description: item.agentMode === "chat" ? tr("聊天") : workspaceLabel(item.workspacePath),
        meta: formatRelativeTime(item.lastOpenedAt ?? item.updatedAt),
        sessionId: item.id,
      })),
    [sessions],
  );

  const fileItems = useMemo<PaletteItem[]>(
    () =>
      (currentFileResults?.items ?? []).map((file) => ({
        key: `file:${file.path}`,
        kind: "file",
        label: file.name,
        description: file.relativePath,
        meta: tr("文件"),
        path: file.path,
      })),
    [currentFileResults],
  );

  const sections = useMemo(
    () =>
      [
        { id: "commands", label: tr("命令"), items: commandItems },
        { id: "sessions", label: tr("历史会话"), items: sessionItems },
        { id: "files", label: tr("工作区文件"), items: fileItems },
      ].filter((section) => section.items.length),
    [commandItems, fileItems, sessionItems],
  );
  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const activeItem = flatItems[Math.min(selectedIndex, Math.max(0, flatItems.length - 1))];

  useEffect(() => {
    if (!activeItem) return;
    const row = dialogRef.current?.querySelector<HTMLElement>(
      `[data-palette-key="${CSS.escape(activeItem.key)}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [activeItem]);

  const activate = (item: PaletteItem) => {
    if (item.kind === "file" && item.path) {
      onOpenFile(item.path);
      onClose();
      return;
    }
    if (item.kind === "session" && item.sessionId) {
      onSelectSession(item.sessionId);
      onClose();
      return;
    }
    if (item.commandId) {
      onCommand(item.commandId);
      onClose();
    }
  };

  if (!open) return null;

  const moveSelection = (next: number) => {
    if (!flatItems.length) return;
    setSelectedIndex(((next % flatItems.length) + flatItems.length) % flatItems.length);
  };

  return createPortal(
    <dialog
      ref={modalRef}
      className="command-palette__backdrop"
      data-testid="command-palette"
      aria-modal="true"
      aria-label={en ? "Search files, commands and sessions" : "搜索文件、命令和历史会话"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveSelection(selectedIndex + 1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveSelection(selectedIndex - 1);
          return;
        }
        if (event.key === "Home" && flatItems.length) {
          event.preventDefault();
          setSelectedIndex(0);
          return;
        }
        if (event.key === "End" && flatItems.length) {
          event.preventDefault();
          setSelectedIndex(flatItems.length - 1);
          return;
        }
        if (event.key === "Enter" && activeItem) {
          event.preventDefault();
          activate(activeItem);
        }
      }}
    >
      <div className="command-palette" ref={dialogRef}>
        <div className="command-palette__search">
          <Search aria-hidden="true" size={18} />
          <input
            ref={inputRef}
            type="text"
            data-testid="command-palette-input"
            value={query}
            maxLength={120}
            spellCheck={false}
            autoComplete="off"
            aria-label={en ? "Search" : "搜索"}
            aria-controls="command-palette-results"
            aria-activedescendant={
              activeItem ? `command-palette-${activeItem.key.replaceAll(":", "-")}` : undefined
            }
            placeholder={
              en ? "Search files, commands and conversations" : "搜索文件、命令或历史会话"
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
          />
          {loading ? (
            <LoaderCircle className="spin" aria-label={tr("搜索中")} size={16} />
          ) : (
            <kbd>Esc</kbd>
          )}
        </div>

        <div className="command-palette__scope">
          <span>
            <MonitorCog aria-hidden="true" size={13} />
            {currentSession
              ? `${currentSession.title} · ${workspaceLabel(currentSession.workspacePath)}`
              : en
                ? "All projects"
                : "全部项目"}
          </span>
          {currentFileResults?.root ? (
            <code title={currentFileResults.root}>{workspaceLabel(currentFileResults.root)}</code>
          ) : null}
        </div>

        <div
          className="command-palette__results"
          id="command-palette-results"
          data-testid="command-palette-results"
          role="listbox"
        >
          {sections.map((section) => (
            <section className="command-palette__section" key={section.id}>
              <h3>{section.label}</h3>
              {section.items.map((item) => {
                const index = flatItems.findIndex((candidate) => candidate.key === item.key);
                const selected = index === selectedIndex;
                return (
                  <button
                    className="command-palette__item"
                    data-testid={`command-palette-${item.kind}`}
                    data-palette-key={item.key}
                    data-selected={selected ? "true" : "false"}
                    data-command-id={item.commandId}
                    data-session-id={item.sessionId}
                    data-path={item.path}
                    id={`command-palette-${item.key.replaceAll(":", "-")}`}
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setSelectedIndex(index)}
                    onClick={() => activate(item)}
                  >
                    <span className="command-palette__icon">
                      {item.kind === "file" ? (
                        <FileCode2 aria-hidden="true" size={16} />
                      ) : item.kind === "session" ? (
                        item.description === tr("聊天") ? (
                          <MessageSquareText aria-hidden="true" size={16} />
                        ) : (
                          <History aria-hidden="true" size={16} />
                        )
                      ) : (
                        commandIcon(item.commandId ?? "")
                      )}
                    </span>
                    <span className="command-palette__copy">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    {item.kind === "session" &&
                    item.sessionId &&
                    contexts[item.sessionId]?.branch ? (
                      <span className="command-palette__branch">
                        {contexts[item.sessionId]?.worktree ? <Wrench size={11} /> : null}
                        {contexts[item.sessionId]?.branch}
                      </span>
                    ) : null}
                    <span className="command-palette__meta">{item.meta}</span>
                  </button>
                );
              })}
            </section>
          ))}
          {!flatItems.length && !loading ? (
            <div className="command-palette__empty">
              <Search aria-hidden="true" size={20} />
              <strong>{en ? "No matches" : "没有匹配结果"}</strong>
              <span>
                {en ? "Try a file name, command or title." : "试试文件名、命令名或会话标题。"}
              </span>
            </div>
          ) : null}
        </div>

        <footer className="command-palette__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            {en ? "Navigate" : "选择"}
          </span>
          <span>
            <kbd>Enter</kbd>
            {en ? "Open" : "打开"}
          </span>
          <span>
            <kbd>Esc</kbd>
            {en ? "Close" : "关闭"}
          </span>
          {error ? <strong role="alert">{error}</strong> : null}
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
