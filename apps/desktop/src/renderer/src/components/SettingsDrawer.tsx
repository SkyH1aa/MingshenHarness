import {
  Bell,
  BookOpen,
  Bot,
  CalendarClock,
  Database,
  FileCode2,
  GitBranch,
  Globe2,
  HardDrive,
  History,
  Info,
  Languages,
  Layers3,
  LockKeyhole,
  Logs,
  Monitor,
  Moon,
  Palette,
  Save,
  Search,
  Server,
  ShieldCheck,
  Sun,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompletionNotificationState, UpdateStatus } from "../../../shared/desktop";
import type {
  AgentProfileView,
  ApprovalModelSettings,
  ExtensionView,
  McpServerView,
  ProviderView,
  ScheduledTaskView,
  SessionRetentionSettings,
  SessionView,
} from "../../../shared/domain";
import type { AppInfo } from "../../../shared/ipc";
import { APP_VERSION } from "../../../shared/release";
import { setLocale, useLocale } from "../i18n";
import { tr } from "../i18n/index";
import { AgentSettings } from "./AgentSettings";
import { BrandMark } from "./BrandMark";
import { BrowserConnectionsSettings } from "./BrowserConnectionsSettings";
import { ContextSettings } from "./ContextSettings";
import { DesktopExperienceSettings } from "./DesktopExperienceSettings";
import { useDialog } from "./DialogProvider";
import { ExtensionSettings } from "./ExtensionSettings";
import { GitHubPluginSettings } from "./GitHubPluginSettings";
import { GlobalShortcutsSettings } from "./GlobalShortcutsSettings";
import { InterfaceStylePicker } from "./InterfaceStylePicker";
import { LayoutPicker } from "./LayoutPicker";
import { McpSettings } from "./McpSettings";
import { ModelPicker } from "./ModelPicker";
import { ProjectMemorySettings } from "./ProjectMemorySettings";
import { ProviderSetup } from "./ProviderSetup";
import { RuntimeHistorySettings } from "./RuntimeHistorySettings";
import { RuntimeLogSettings } from "./RuntimeLogSettings";
import { RuntimeToolingSettings } from "./RuntimeToolingSettings";
import { ScheduledTaskSettings } from "./ScheduledTaskSettings";
import { SessionManagementSettings } from "./SessionManagementSettings";
import { useUiPreferences } from "./UiPreferences";
import { UpdateControls } from "./UpdateControls";

type SettingsSection =
  | "appearance"
  | "desktop"
  | "providers"
  | "context"
  | "agents"
  | "extensions"
  | "project"
  | "mcp"
  | "github"
  | "browser"
  | "schedules"
  | "permissions"
  | "data"
  | "history"
  | "logs"
  | "runtime"
  | "about";

interface SettingsDrawerProps {
  navigationRequestId?: number;
  initialSection?:
    | "appearance"
    | "desktop"
    | "providers"
    | "permissions"
    | "context"
    | "extensions"
    | "mcp"
    | "project";
  providers: ProviderView[];
  agentProfiles: AgentProfileView[];
  extensions: ExtensionView[];
  mcpServers: McpServerView[];
  scheduledTasks: ScheduledTaskView[];
  sessions: SessionView[];
  activeSessionId: string | null;
  theme: "day" | "night";
  onThemeChange: (theme: "day" | "night") => void;
  onChanged: () => Promise<void>;
  onClose: () => void;
  onSessionManagementBusyChange: (busy: boolean) => void;
}

const SETTINGS_ITEMS: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof Palette;
}> = [
  { id: "appearance", label: tr("\u5916\u89C2\u4E0E\u8BED\u8A00"), icon: Palette },
  { id: "desktop", label: tr("桌面体验"), icon: Monitor },
  { id: "providers", label: tr("\u4F9B\u5E94\u5546\u4E0E\u6A21\u578B"), icon: Server },
  { id: "context", label: tr("上下文与压缩"), icon: Layers3 },
  { id: "agents", label: tr("Agent \u914D\u7F6E"), icon: Bot },
  { id: "extensions", label: tr("Skills \u4E0E\u63D2\u4EF6"), icon: BookOpen },
  { id: "project", label: tr("\u9879\u76EE\u6307\u4EE4\u4E0E\u4FE1\u4EFB"), icon: FileCode2 },
  { id: "mcp", label: "MCP Servers", icon: Server },
  { id: "github", label: tr("GitHub \u63D2\u4EF6"), icon: GitBranch },
  { id: "browser", label: tr("\u6D4F\u89C8\u5668\u8FDE\u63A5"), icon: Globe2 },
  { id: "schedules", label: tr("\u5B9A\u65F6\u4EFB\u52A1"), icon: CalendarClock },
  { id: "permissions", label: tr("\u6743\u9650\u4E0E\u5B89\u5168"), icon: ShieldCheck },
  { id: "data", label: tr("\u4F1A\u8BDD\u4E0E\u6570\u636E"), icon: Database },
  { id: "history", label: tr("\u5FEB\u7167\u4E0E\u8F68\u8FF9"), icon: History },
  { id: "logs", label: tr("运行日志"), icon: Logs },
  { id: "runtime", label: tr("\u8FD0\u884C\u4E0E\u96C6\u6210"), icon: Wrench },
  { id: "about", label: tr("\u5173\u4E8E"), icon: Info },
];

export function SettingsDrawer({
  initialSection = "appearance",
  navigationRequestId = 0,
  providers,
  agentProfiles,
  extensions,
  mcpServers,
  scheduledTasks,
  sessions,
  activeSessionId,
  theme,
  onThemeChange,
  onChanged,
  onClose,
  onSessionManagementBusyChange,
}: SettingsDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [projectMemoryDirty, setProjectMemoryDirty] = useState(false);
  const [desktopPreferencesPending, setDesktopPreferencesPending] = useState(false);
  const [sessionManagementBusy, setSessionManagementBusy] = useState(false);
  const sessionManagementBusyRef = useRef(false);
  const navigationPendingRef = useRef(false);
  const { confirm } = useDialog();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const groups = [
    { label: locale === "en" ? "General" : "通用", ids: ["appearance", "desktop"] },
    {
      label: locale === "en" ? "Models & Agents" : "模型与 Agent",
      ids: ["providers", "context", "agents"],
    },
    {
      label: locale === "en" ? "Connections" : "扩展连接",
      ids: ["extensions", "mcp", "github", "browser"],
    },
    {
      label: locale === "en" ? "Project & security" : "项目与安全",
      ids: ["project", "permissions"],
    },
    {
      label: locale === "en" ? "Automation & records" : "自动化与记录",
      ids: ["schedules", "history", "logs"],
    },
    {
      label: locale === "en" ? "Data & application" : "数据与应用",
      ids: ["data", "runtime", "about"],
    },
  ];
  const canLeaveProject = useCallback(async () => {
    if (sessionManagementBusyRef.current) return false;
    const leavingDesktop = section === "desktop" && desktopPreferencesPending;
    if (!leavingDesktop && (section !== "project" || !projectMemoryDirty)) return true;
    if (navigationPendingRef.current) return false;
    navigationPendingRef.current = true;
    try {
      return await confirm({
        title: leavingDesktop
          ? locale === "en"
            ? "Leave unsaved companion settings?"
            : "离开未保存的桌宠设置？"
          : tr("放弃未保存的项目修改？"),
        description: leavingDesktop
          ? locale === "en"
            ? "Changes waiting to be saved or retried may be lost. Stay here to retry."
            : "等待保存或重试的修改可能丢失，可留在此页重试。"
          : tr("尚未保存的记忆配置或记忆内容将被丢弃。"),
        confirmLabel: leavingDesktop
          ? locale === "en"
            ? "Leave settings"
            : "离开设置"
          : tr("放弃修改"),
      });
    } finally {
      navigationPendingRef.current = false;
    }
  }, [confirm, desktopPreferencesPending, locale, projectMemoryDirty, section]);
  const canLeaveProjectRef = useRef(canLeaveProject);
  canLeaveProjectRef.current = canLeaveProject;
  const lastNavigationRequestRef = useRef({ initialSection, navigationRequestId });
  useEffect(() => {
    const last = lastNavigationRequestRef.current;
    if (last.initialSection === initialSection && last.navigationRequestId === navigationRequestId)
      return;
    lastNavigationRequestRef.current = { initialSection, navigationRequestId };
    let active = true;
    void canLeaveProjectRef.current().then((allowed) => {
      if (!active || !allowed) return;
      setSearch("");
      setSection(initialSection);
    });
    return () => {
      active = false;
    };
  }, [initialSection, navigationRequestId]);
  const sectionLabel = (item: (typeof SETTINGS_ITEMS)[number]) =>
    item.id === "desktop" && locale === "en" ? "Desktop experience" : tr(item.label);
  const onSessionManagementBusy = useCallback(
    (value: boolean) => {
      sessionManagementBusyRef.current = value;
      setSessionManagementBusy(value);
      onSessionManagementBusyChange(value);
    },
    [onSessionManagementBusyChange],
  );
  const requestClose = useCallback(() => {
    void canLeaveProject().then((allowed) => {
      if (allowed) onClose();
    });
  }, [canLeaveProject, onClose]);

  useEffect(() => {
    // Initial focus belongs to opening the drawer, not to parent state refreshes.
    closeButtonRef.current?.focus();
    let active = true;
    void window.mingshen
      .getAppInfo()
      .then((info) => {
        if (active) setAppInfo(info);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  return (
    <div className="settings-layer">
      <button
        className="settings-scrim"
        type="button"
        aria-label={tr("\u5173\u95ED\u8BBE\u7F6E")}
        onClick={requestClose}
      />
      <section
        className="settings-workspace"
        role="dialog"
        aria-modal="true"
        aria-label={tr("\u8BBE\u7F6E")}
      >
        <aside className="settings-nav">
          <header className="settings-nav__header">
            <BrandMark size={30} />
            <div>
              <strong>Mingshen</strong>
              <small>{tr("\u8BBE\u7F6E")}</small>
            </div>
          </header>

          <label className="settings-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={locale === "en" ? "Search settings" : "搜索设置"}
              aria-label={locale === "en" ? "Search settings" : "搜索设置"}
            />
          </label>
          <nav aria-label={tr("\u8BBE\u7F6E\u5206\u7C7B")}>
            {groups.map((group) => {
              const items = SETTINGS_ITEMS.filter(
                (item) =>
                  group.ids.includes(item.id) &&
                  `${sectionLabel(item)} ${item.id} ${item.id === "desktop" ? "desktop experience 桌面体验" : ""} ${group.label} ${item.id === "runtime" ? "重试 retry reconnect" : ""} ${item.id === "extensions" ? "Token Saver 节省 用量 精简" : ""} ${item.id === "data" ? "会话 文件夹 批量 删除 归档 恢复 conversations folder bulk delete archive restore" : ""}`
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()),
              );
              return items.length ? (
                <div className="settings-nav__group" key={group.label}>
                  <h3>{group.label}</h3>
                  {items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        className={
                          section === item.id
                            ? "settings-nav__item settings-nav__item--active"
                            : "settings-nav__item"
                        }
                        type="button"
                        key={item.id}
                        disabled={sessionManagementBusy}
                        onClick={() => {
                          if (item.id === section) return;
                          void canLeaveProject().then((allowed) => {
                            if (allowed) setSection(item.id);
                          });
                        }}
                      >
                        <Icon aria-hidden="true" size={15} />
                        {sectionLabel(item)}
                      </button>
                    );
                  })}
                </div>
              ) : null;
            })}
            {search &&
            !SETTINGS_ITEMS.some((item) =>
              `${sectionLabel(item)} ${item.id} ${item.id === "desktop" ? "desktop experience 桌面体验" : ""} ${groups.find((group) => group.ids.includes(item.id))?.label} ${item.id === "runtime" ? "重试 retry reconnect" : ""} ${item.id === "extensions" ? "Token Saver 节省 用量 精简" : ""} ${item.id === "data" ? "会话 文件夹 批量 删除 归档 恢复 conversations folder bulk delete archive restore" : ""}`
                .toLowerCase()
                .includes(search.trim().toLowerCase()),
            ) ? (
              <p className="quiet-copy">
                {locale === "en" ? "No matching settings" : "未找到相关设置"}
              </p>
            ) : null}
          </nav>

          <div className="settings-nav__footer">
            <span>
              {tr("\u7248\u672C")}
              {appInfo?.version ?? APP_VERSION}
            </span>
            <span>{tr("\u672C\u5730\u8FD0\u884C")}</span>
          </div>
        </aside>

        <div className="settings-content">
          <header className="settings-content__header">
            <h2>
              {section === "desktop" && locale === "en"
                ? "Desktop experience"
                : tr(SETTINGS_ITEMS.find((item) => item.id === section)?.label ?? "")}
            </h2>
            <button
              className="icon-button"
              type="button"
              aria-label={tr("\u5173\u95ED\u8BBE\u7F6E")}
              onClick={requestClose}
              ref={closeButtonRef}
              disabled={sessionManagementBusy}
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>

          <div className="settings-content__body">
            {section === "appearance" ? (
              <AppearanceSettings theme={theme} onThemeChange={onThemeChange} />
            ) : null}
            {section === "desktop" ? (
              <DesktopExperienceSettings onPendingChange={setDesktopPreferencesPending} />
            ) : null}
            {section === "providers" ? (
              <ProviderSetup providers={providers} onChanged={onChanged} compact />
            ) : null}
            {section === "context" ? (
              <ContextSettings
                providers={providers}
                session={sessions.find((session) => session.id === activeSessionId) ?? null}
                onChanged={onChanged}
              />
            ) : null}
            {section === "agents" ? (
              <AgentSettings profiles={agentProfiles} providers={providers} onChanged={onChanged} />
            ) : null}
            {section === "extensions" ? (
              <ExtensionSettings
                extensions={extensions}
                onChanged={onChanged}
                sessionId={activeSessionId}
              />
            ) : null}
            {section === "project" ? (
              <ProjectMemorySettings
                sessionId={activeSessionId}
                providers={providers}
                sessions={sessions}
                onDirtyChange={setProjectMemoryDirty}
                workspacePath={
                  sessions.find((session) => session.id === activeSessionId)?.workspacePath ?? null
                }
              />
            ) : null}
            {section === "mcp" ? <McpSettings servers={mcpServers} onChanged={onChanged} /> : null}
            {section === "browser" ? (
              <BrowserConnectionsSettings sessionId={activeSessionId} />
            ) : null}
            {section === "github" ? <GitHubPluginSettings /> : null}
            {section === "schedules" ? (
              <ScheduledTaskSettings
                tasks={scheduledTasks}
                sessions={sessions}
                onChanged={onChanged}
              />
            ) : null}
            {section === "permissions" ? <PermissionSettings providers={providers} /> : null}
            {section === "data" ? (
              <DataSettings
                activeSessionId={activeSessionId}
                onChanged={onChanged}
                managementBusy={sessionManagementBusy}
                onManagementBusyChange={onSessionManagementBusy}
              />
            ) : null}
            {section === "history" ? (
              <RuntimeHistorySettings sessions={sessions} activeSessionId={activeSessionId} />
            ) : null}
            {section === "logs" ? <RuntimeLogSettings /> : null}
            {section === "runtime" ? (
              <RuntimeToolingSettings
                session={sessions.find((session) => session.id === activeSessionId) ?? null}
                onOpenExternal={(url) => window.mingshen.openExternalUrl(url)}
              />
            ) : null}
            {section === "about" ? <AboutSettings appInfo={appInfo} /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function AppearanceSettings({
  theme,
  onThemeChange,
}: {
  theme: "day" | "night";
  onThemeChange: (theme: "day" | "night") => void;
}) {
  const locale = useLocale();
  const { preferences, activeStyle, ready, update, error, retry } = useUiPreferences();
  const [closeAction, setCloseAction] = useState("ask");
  const [notifications, setNotifications] = useState<CompletionNotificationState | null>(null);
  const [notificationError, setNotificationError] = useState("");
  useEffect(() => {
    void window.mingshen.getDesktopState().then((state) => setCloseAction(state.closeAction));
    void window.mingshen
      .getCompletionNotifications()
      .then(setNotifications)
      .catch((cause) => setNotificationError(String(cause)));
    return window.mingshen.onCompletionNotifications(setNotifications);
  }, []);
  return (
    <div className="settings-page">
      <InterfaceStylePicker />
      <section className="settings-block">
        <div className="settings-block__heading">
          <h3>{locale === "en" ? "Default workspace layout" : "默认工作区布局"}</h3>
          <LayoutPicker
            value={preferences.defaultLayout}
            onChange={(defaultLayout) => update((current) => ({ ...current, defaultLayout }))}
          />
        </div>
        <label className="settings-row">
          <span>{locale === "en" ? "Motion" : "动态效果"}</span>
          <select
            value={preferences.motion}
            onChange={(event) =>
              update((current) => ({
                ...current,
                motion: event.target.value === "off" ? "off" : "system",
              }))
            }
          >
            <option value="system">{locale === "en" ? "Follow system" : "跟随系统"}</option>
            <option value="off">{locale === "en" ? "Off" : "关闭"}</option>
          </select>
        </label>
        <label className="settings-row">
          <span>{tr("在输入区显示 Markdown 和公式预览开关")}</span>
          <input
            type="checkbox"
            checked={preferences.composerRichPaste}
            disabled={!ready}
            onChange={(event) => {
              const composerRichPaste = event.target.checked;
              update((current) => ({ ...current, composerRichPaste }));
            }}
          />
        </label>
        {error ? (
          <p className="form-error">
            {error}
            <button type="button" onClick={retry}>
              {tr("重试")}
            </button>
          </p>
        ) : null}
      </section>
      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("\u754C\u9762\u4E3B\u9898")}</h3>
            <p>
              {locale === "en"
                ? "Color mode changes take effect immediately."
                : "日夜主题切换立即生效。"}
            </p>
          </div>
        </div>
        <fieldset className="theme-gallery">
          <legend className="visually-hidden">{tr("\u754C\u9762\u4E3B\u9898")}</legend>
          <button
            className={theme === "day" ? "theme-card theme-card--active" : "theme-card"}
            type="button"
            onClick={() => onThemeChange("day")}
          >
            <span className="theme-card__preview theme-card__preview--day" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="theme-card__copy">
              <Sun aria-hidden="true" size={16} />
              <span>
                <strong>
                  {activeStyle === "orbit"
                    ? locale === "en"
                      ? "Day · Ice"
                      : "日间 · 冰白"
                    : tr("\u65E5\u95F4 \xB7 \u67D4\u767D")}
                </strong>
                <small>
                  {activeStyle === "orbit"
                    ? locale === "en"
                      ? "Ice white and mineral green"
                      : "冰白底色与矿青线条"
                    : tr(
                        "\u67D4\u767D\u754C\u9762\u3001\u77F3\u58A8\u6587\u5B57\u3001\u9752\u8272\u539F\u5B50\u6807\u4E0E\u4E2D\u6027\u64CD\u4F5C\u8272",
                      )}
                </small>
              </span>
            </span>
          </button>
          <button
            className={theme === "night" ? "theme-card theme-card--active" : "theme-card"}
            type="button"
            onClick={() => onThemeChange("night")}
          >
            <span className="theme-card__preview theme-card__preview--night" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="theme-card__copy">
              <Moon aria-hidden="true" size={16} />
              <span>
                <strong>
                  {activeStyle === "orbit"
                    ? locale === "en"
                      ? "Night · Mineral"
                      : "夜间 · 墨青"
                    : tr("\u591C\u95F4 \xB7 \u58A8\u9ED1")}
                </strong>
                <small>
                  {activeStyle === "orbit"
                    ? locale === "en"
                      ? "Deep teal and optical edges"
                      : "深墨青底色与冷光边缘"
                    : tr(
                        "\u8FD1\u9ED1\u5DE5\u4F5C\u533A\u3001\u51B7\u767D\u6587\u5B57\u3001\u9752\u8272\u72B6\u6001\u5149\u4E0E\u514B\u5236\u7684\u6731\u7EA2\u8B66\u793A",
                      )}
                </small>
              </span>
            </span>
          </button>
        </fieldset>
      </section>

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("\u754C\u9762\u8BED\u8A00")}</h3>
            <p>
              {tr(
                "\u5F53\u524D\u7248\u672C\u4EE5\u7B80\u4F53\u4E2D\u6587\u4E3A\u4E3B\uFF0C\u6280\u672F\u534F\u8BAE\u4E0E\u6A21\u578B\u6807\u8BC6\u4FDD\u7559\u82F1\u6587\u3002",
              )}
            </p>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row__label">
            <Languages aria-hidden="true" size={16} />
            <span>
              <strong>{tr("\u663E\u793A\u8BED\u8A00")}</strong>
              <small>
                {tr("\u5E94\u7528\u754C\u9762\u4E0E\u7CFB\u7EDF\u72B6\u6001\u6587\u6848")}
              </small>
            </span>
          </div>
          <div className="segmented-control">
            <button
              type="button"
              className={
                locale === "zh-CN"
                  ? "segmented-control__item segmented-control__item--active"
                  : "segmented-control__item"
              }
              onClick={() => {
                setLocale("zh-CN");
                void window.mingshen.desktopAction("locale", "zh-CN");
              }}
            >
              {tr("\u7B80\u4F53\u4E2D\u6587")}
            </button>
            <button
              type="button"
              className={
                locale === "en"
                  ? "segmented-control__item segmented-control__item--active"
                  : "segmented-control__item"
              }
              onClick={() => {
                setLocale("en");
                void window.mingshen.desktopAction("locale", "en");
              }}
            >
              English
            </button>
          </div>
        </div>
      </section>
      <section className="settings-block">
        <div className="settings-block__heading">
          <h3>
            <Bell aria-hidden="true" size={15} /> {tr("任务与交互通知")}
          </h3>
        </div>
        {notifications ? (
          <div className="setting-list">
            {(
              [
                ["nativeEnabled", "Windows 原生通知"],
                ["approvalEnabled", "待审批通知（批准 / 拒绝）"],
                ["questionEnabled", "Agent 提问与修改冲突提醒"],
                ["taskbarEnabled", "任务栏未读数字"],
                ["showPreview", "在通知中显示会话标题和内容摘要"],
                ["sound", "通知声音"],
              ] as const
            ).map(([key, label]) => (
              <label className="setting-row" key={key}>
                <span className="setting-row__label">{tr(label)}</span>
                <input
                  type="checkbox"
                  checked={notifications.settings[key] ?? true}
                  onChange={(event) => {
                    const next = { ...notifications.settings, [key]: event.target.checked };
                    void window.mingshen
                      .configureCompletionNotifications(next)
                      .then(setNotifications)
                      .catch((cause) => setNotificationError(String(cause)));
                  }}
                />
              </label>
            ))}
          </div>
        ) : null}
        {notifications && !notifications.supported ? (
          <p className="form-error">{tr("当前系统不支持原生通知，会话未读标识仍然可用")}</p>
        ) : null}
        {notificationError || notifications?.lastError ? (
          <p className="form-error">{notificationError || notifications?.lastError}</p>
        ) : null}
      </section>
      <GlobalShortcutsSettings />
      <section className="settings-block">
        <label className="field">
          <span>{tr("关闭窗口时")}</span>
          <select
            value={closeAction}
            onChange={(event) => {
              setCloseAction(event.target.value);
              void window.mingshen.desktopAction("close-preference", event.target.value);
            }}
          >
            <option value="ask">{tr("每次询问")}</option>
            <option value="tray">{tr("最小化到托盘")}</option>
            <option value="quit">{tr("彻底退出")}</option>
          </select>
        </label>
      </section>
    </div>
  );
}

function PermissionSettings({ providers }: { providers: ProviderView[] }) {
  const [reviewer, setReviewer] = useState<ApprovalModelSettings>({
    providerId: null,
    modelId: null,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void window.mingshen
      .getApprovalModelSettings()
      .then((settings) => {
        setReviewer(settings);
        setLoaded(true);
      })
      .catch((error) => setNotice(String(error)));
  }, []);
  const save = async () => {
    setBusy(true);
    setNotice("");
    try {
      setReviewer(await window.mingshen.setApprovalModelSettings(reviewer));
      setNotice("审批模型已保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-page">
      <section className="settings-block approval-model-settings">
        <div className="settings-block__heading">
          <h3>{tr("自动审批模型")}</h3>
        </div>
        <div className="field">
          <span>{tr("审批模型")}</span>
          <ModelPicker
            providers={providers}
            value={
              reviewer.providerId && reviewer.modelId
                ? { providerId: reviewer.providerId, configId: reviewer.modelId }
                : null
            }
            onChange={(selection) =>
              setReviewer({
                ...reviewer,
                providerId: selection.providerId,
                modelId: selection.configId,
              })
            }
            disabled={busy || !loaded}
          />
        </div>
        <div className="field approval-backup-picker">
          <span>{tr("备用审批模型（可选）")}</span>
          <ModelPicker
            providers={providers}
            value={
              reviewer.fallback
                ? { providerId: reviewer.fallback.providerId, configId: reviewer.fallback.modelId }
                : null
            }
            onChange={(selection) =>
              setReviewer({
                ...reviewer,
                fallback: { providerId: selection.providerId, modelId: selection.configId },
              })
            }
            disabled={busy || !loaded || !reviewer.modelId}
          />
        </div>
        <p className="form-note">
          {tr(
            "主模型网络错误、超时或返回无效裁决时，自动尝试一次备用模型；有效拒绝不切换，两者失败则等待手动审批。备用供应商会接收相同操作数据。",
          )}
        </p>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy || !loaded || !reviewer.fallback}
          onClick={() => setReviewer({ ...reviewer, fallback: null })}
        >
          {tr("清除备用模型")}
        </button>
        <p className="form-note">
          {tr(
            "启用自动审批后，待执行操作的命令、路径和参数将发送给所选模型，可能产生 API 用量。主备均失败时等待手动审批，沙箱与致命命令保护继续生效。",
          )}
        </p>
        <div className="approval-panel__actions">
          <button
            className="btn btn--ghost"
            type="button"
            disabled={busy || !loaded}
            onClick={() => setReviewer({ providerId: null, modelId: null, fallback: null })}
          >
            {tr("清除选择")}
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={busy || !loaded}
            onClick={() => void save()}
          >
            <Save size={14} />
            {tr("保存审批模型")}
          </button>
        </div>
        {notice ? (
          <p className="form-note" role="status">
            {tr(notice)}
          </p>
        ) : null}
      </section>
      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("\u9ED8\u8BA4\u5B89\u5168\u8FB9\u754C")}</h3>
            <p>
              {tr(
                "\u65B0\u4F1A\u8BDD\u9ED8\u8BA4\u4F7F\u7528\u8BF7\u6C42\u6279\u51C6\u3002\u65E0\u8BBA\u6743\u9650\u6A21\u5F0F\u5982\u4F55\uFF0C\u81F4\u547D\u547D\u4EE4\u4FDD\u62A4\u59CB\u7EC8\u542F\u7528\u3002",
              )}
            </p>
          </div>
        </div>
        <div className="setting-list">
          <div className="setting-row">
            <div className="setting-row__label">
              <LockKeyhole aria-hidden="true" size={16} />
              <span>
                <strong>{tr("\u65B0\u4F1A\u8BDD\u6743\u9650")}</strong>
                <small>
                  {tr(
                    "\u6587\u4EF6\u8BFB\u53D6\u3001\u5199\u5165\u3001\u547D\u4EE4\u4E0E MCP \u5199\u64CD\u4F5C\u9010\u9879\u5BA1\u6279",
                  )}
                </small>
              </span>
            </div>
            <span className="setting-value">{tr("\u8BF7\u6C42\u6279\u51C6")}</span>
          </div>
          <div className="setting-row">
            <div className="setting-row__label">
              <ShieldCheck aria-hidden="true" size={16} />
              <span>
                <strong>{tr("\u81F4\u547D\u547D\u4EE4\u4FDD\u62A4")}</strong>
                <small>
                  {tr(
                    "\u7CFB\u7EDF\u76EE\u5F55\u9012\u5F52\u5220\u9664\u3001\u683C\u5F0F\u5316\u3001\u5173\u673A\u4E0E\u542F\u52A8\u914D\u7F6E\u7834\u574F",
                  )}
                </small>
              </span>
            </div>
            <span className="setting-value setting-value--success">
              {tr("\u5F3A\u5236\u5F00\u542F")}
            </span>
          </div>
          <div className="setting-row">
            <div className="setting-row__label">
              <HardDrive aria-hidden="true" size={16} />
              <span>
                <strong>{tr("\u5DE5\u4F5C\u533A\u4FE1\u4EFB")}</strong>
                <small>
                  {tr(
                    "\u9996\u6B21\u9009\u62E9\u76EE\u5F55\u65F6\u8BE2\u95EE\uFF0C\u672A\u4FE1\u4EFB\u4ED3\u5E93\u4E0D\u81EA\u52A8\u6267\u884C\u6269\u5C55\u811A\u672C",
                  )}
                </small>
              </span>
            </div>
            <span className="setting-value">{tr("\u6309\u9879\u76EE\u8BB0\u5F55")}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function DataSettings({
  activeSessionId,
  onChanged,
  managementBusy,
  onManagementBusyChange,
}: {
  activeSessionId: string | null;
  onChanged: () => Promise<void>;
  managementBusy: boolean;
  onManagementBusyChange: (busy: boolean) => void;
}) {
  const { confirm } = useDialog();
  const [retention, setRetention] = useState<SessionRetentionSettings>({ days: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeValues, setNoticeValues] = useState<string[]>([]);
  useEffect(() => {
    void window.mingshen
      .getSessionRetention()
      .then(setRetention)
      .catch((cause) => setNotice(String(cause)));
  }, []);
  const save = async () => {
    if (
      retention.days !== null &&
      !(await confirm({
        title: tr("开启会话自动清理"),
        description: tr(
          "保存后，应用将在定期检查时永久删除超过 {0} 天未打开的普通会话。归档、正在使用、运行中及关联已启用定时任务的会话会保留。",
          [retention.days],
        ),
        confirmLabel: tr("保存清理设置"),
        tone: "danger",
      }))
    )
      return;
    setBusy(true);
    setNotice("");
    setNoticeValues([]);
    try {
      setRetention(await window.mingshen.setSessionRetention(retention));
      setNotice("会话保留设置已保存。");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-page">
      <SessionManagementSettings
        activeSessionId={activeSessionId}
        onChanged={onChanged}
        onBusyChange={onManagementBusyChange}
      />
      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("\u672C\u5730\u4F1A\u8BDD")}</h3>
            <p>
              {tr(
                "\u4F1A\u8BDD\u3001\u5DE5\u5177\u7ED3\u679C\u548C\u5DE5\u4F5C\u533A\u53D8\u66F4\u9ED8\u8BA4\u53EA\u4FDD\u5B58\u5728\u5F53\u524D Windows \u7528\u6237\u76EE\u5F55\u3002",
              )}
            </p>
          </div>
        </div>
        <div className="setting-list">
          <div className="setting-row">
            <div className="setting-row__label">
              <Database aria-hidden="true" size={16} />
              <span>
                <strong>{tr("\u5386\u53F2\u4FDD\u7559")}</strong>
                <small>{tr("按最后打开时间清理；已归档会话永久保留。")}</small>
              </span>
            </div>
            <span className="setting-value">{tr("\u672C\u5730 SQLite")}</span>
          </div>
          <div className="session-retention-form">
            <label className="field">
              <span>{tr("自动清理")}</span>
              <select
                value={retention.days === null ? "never" : "days"}
                onChange={(event) =>
                  setRetention({ days: event.target.value === "never" ? null : 30 })
                }
                disabled={busy || managementBusy}
              >
                <option value="never">{tr("永不删除")}</option>
                <option value="days">{tr("按未打开天数清理")}</option>
              </select>
            </label>
            {retention.days !== null ? (
              <label className="field">
                <span>{tr("未打开天数")}</span>
                <input
                  type="number"
                  min={1}
                  max={36500}
                  value={retention.days}
                  disabled={busy || managementBusy}
                  onChange={(event) => setRetention({ days: Number(event.target.value) })}
                />
              </label>
            ) : null}
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => void save()}
              disabled={
                busy ||
                managementBusy ||
                (retention.days !== null &&
                  (!Number.isInteger(retention.days) ||
                    retention.days < 1 ||
                    retention.days > 36500))
              }
            >
              <Save size={14} />
              {tr("保存清理设置")}
            </button>
          </div>
          <div className="setting-row">
            <div className="setting-row__label">
              <LockKeyhole aria-hidden="true" size={16} />
              <span>
                <strong>{tr("\u51ED\u636E")}</strong>
                <small>
                  {tr(
                    "API Key \u4F7F\u7528\u7CFB\u7EDF\u4FDD\u62A4\u5B58\u50A8\uFF0C\u5B8C\u6574\u503C\u4E0D\u4F1A\u8FDB\u5165\u754C\u9762\u72B6\u6001",
                  )}
                </small>
              </span>
            </div>
            <span className="setting-value setting-value--success">{tr("\u5DF2\u52A0\u5BC6")}</span>
          </div>
        </div>
        {notice ? (
          <p className="form-note" role="status">
            {tr(notice, noticeValues)}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function AboutSettings({ appInfo }: { appInfo: AppInfo | null }) {
  const [updates, setUpdates] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    void window.mingshen.getUpdateStatus().then(setUpdates);
    return window.mingshen.onUpdateEvent((event) => setUpdates(event.status));
  }, []);
  return (
    <div className="settings-page">
      <section className="about-lockup">
        <BrandMark size={42} />
        <div>
          <h3>Mingshen Harness</h3>
          <p>{tr("\u672C\u5730\u4F18\u5148\u7684\u7F16\u7A0B\u4E0E\u5DE5\u4F5C Agent")}</p>
        </div>
      </section>
      <section className="settings-block">
        <div className="setting-list">
          <div className="setting-row">
            <span className="setting-row__label">{tr("\u7248\u672C")}</span>
            <span className="setting-value">{appInfo?.version ?? APP_VERSION}</span>
          </div>
          <div className="setting-row">
            <span className="setting-row__label">{tr("\u8FD0\u884C\u6A21\u5F0F")}</span>
            <span className="setting-value">
              {appInfo?.isPackaged ? tr("\u5B89\u88C5\u7248") : tr("\u5B9E\u9A8C\u7248")}
            </span>
          </div>
          <div className="setting-row">
            <span className="setting-row__label">{tr("\u5E73\u53F0")}</span>
            <span className="setting-value">{appInfo?.platform ?? "win32"}</span>
          </div>
        </div>
      </section>
      <section className="settings-block">
        <div className="settings-block__heading">
          <h3>{tr("软件更新")}</h3>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={Boolean(
              updates &&
                [
                  "checking",
                  "downloading",
                  "verifying",
                  "extracting",
                  "ready",
                  "installing",
                ].includes(updates.state),
            )}
            onClick={() => void window.mingshen.checkForUpdates().then(setUpdates)}
          >
            {tr(updates?.state === "checking" ? "正在检查更新" : "检查更新")}
          </button>
        </div>
        {updates?.release ? (
          <p>
            {tr("发布版本")} {updates.release.version}
          </p>
        ) : null}
        {updates ? <UpdateControls status={updates} onChange={setUpdates} /> : null}
      </section>
      <div className="settings-actions">
        {(["terms", "privacy", "disclaimer", "manual"] as const).map((name) => (
          <button
            key={name}
            type="button"
            className="btn btn--secondary"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("mingshen:document", { detail: name }))
            }
          >
            {tr(
              name === "terms"
                ? "服务协议"
                : name === "privacy"
                  ? "隐私政策"
                  : name === "disclaimer"
                    ? "免责协议"
                    : "使用手册",
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
