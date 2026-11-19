import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  Files,
  Folder,
  FolderOpen,
  GitBranch,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Save,
  SquareTerminal,
  Undo2,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActivityEvent,
  BrowserProvider,
  FileChange,
  SessionMessage,
  SessionRunState,
  UserCommandResult,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceGitStatus,
} from "../../../shared/domain";
import { useLocale } from "../i18n";
import { tr } from "../i18n/index";
import { activityDetailsText, collectToolDetails } from "../lib/activity-details";
import { formatCount } from "../lib/format";
import { BrowserDock } from "./BrowserDock";
import { DiffPreview } from "./ChatView";
import { CopyButton } from "./CopyButton";
import { useDialog } from "./DialogProvider";
import { ExpandableText } from "./ExpandableText";
import { useUiPreferences } from "./UiPreferences";

type WorkspaceTab = "files" | "git" | "terminal" | "browser" | "review";

export interface WorkspaceTabRequest {
  tab: WorkspaceTab;
  requestKey: number;
}

interface WorkspaceBrowserRequest {
  sessionId: string;
  provider: BrowserProvider;
  url: string;
  requestKey: number;
}

interface WorkspacePanelProps {
  sessionId: string | null;
  messages: SessionMessage[];
  activities: ActivityEvent[];
  runState: SessionRunState | null;
  root: string | null;
  browserRequest: WorkspaceBrowserRequest | null;
  fileRequest: WorkspaceFileRequest | null;
  tabRequest?: WorkspaceTabRequest | null;
  onTabChange?: (tab: WorkspaceTab) => void;
  onChooseRoot: () => Promise<void>;
  onClose: () => void;
}

export interface WorkspaceFileRequest {
  path: string;
  requestKey: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workspaceRelativePath(root: string, target: string): string | null {
  const normalizedRoot = root.replaceAll("/", "\\").replace(/\\+$/, "");
  const normalizedTarget = target.replaceAll("/", "\\");
  const rootPrefix = `${normalizedRoot.toLowerCase()}\\`;
  if (normalizedTarget.toLowerCase().startsWith(rootPrefix)) {
    return normalizedTarget.slice(normalizedRoot.length + 1);
  }
  if (!/^[A-Za-z]:[\\/]|^\\\\/.test(target)) {
    return normalizedTarget;
  }
  return null;
}

export function WorkspacePanel({
  sessionId,
  messages,
  activities,
  runState,
  root,
  browserRequest,
  fileRequest,
  tabRequest,
  onTabChange,
  onChooseRoot,
  onClose,
}: WorkspacePanelProps) {
  const { confirm } = useDialog();
  const en = useLocale() === "en";
  const { activeStyle, ready: preferencesReady } = useUiPreferences();
  const orbit = activeStyle === "orbit";
  const [tab, setTab] = useState<WorkspaceTab>("files");
  useEffect(() => onTabChange?.(tab), [tab, onTabChange]);
  const initializedStyle = useRef(false);
  const handledTabRequest = useRef<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [treeVersion, setTreeVersion] = useState(0);
  const [rootEntries, setRootEntries] = useState<WorkspaceEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [externalFilePath, setExternalFilePath] = useState<string | null>(null);
  const handledFileRequestRef = useRef(0);
  const rootRequest = useRef(0);
  const fileRequestVersion = useRef(0);
  const [commandDock, setCommandDock] = useState(false);
  const [reviewPath, setReviewPath] = useState<string | null>(null);
  const [restoredActivities, setRestoredActivities] = useState<ActivityEvent[]>([]);
  const [commandLimit, setCommandLimit] = useState(100);
  const toolDetails = useMemo(() => collectToolDetails(messages), [messages]);
  const lastSummary = messages
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "run_summary")
    .at(-1);
  const changes = new Map<string, FileChange>();
  const savedSummary = lastSummary?.type === "run_summary" ? lastSummary.summary : null;
  const reviewRunId = runState?.runId ?? savedSummary?.runId;
  const currentActivities = [
    ...new Map(
      [...restoredActivities, ...activities]
        .filter((item) => item.runId === reviewRunId)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const commandActivities = currentActivities.filter(
    (item) => item.kind === "command" || item.status === "failed",
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new session/turn resets only its local disclosure limits.
  useEffect(() => {
    setCommandLimit(100);
    setReviewPath(null);
  }, [sessionId, reviewRunId]);
  useEffect(() => {
    if (tab !== "review" || !sessionId || !reviewRunId) return;
    let active = true;
    void window.mingshen
      .listTrajectories(sessionId, reviewRunId)
      .then((runs) => {
        if (!active) return;
        setRestoredActivities(
          runs.flatMap((run) =>
            run.events.flatMap((event) => {
              if (event.type !== "activity") return [];
              const activity = (event.payload as { activity?: ActivityEvent })?.activity;
              return activity?.runId === reviewRunId ? [activity] : [];
            }),
          ),
        );
      })
      .catch((cause) => {
        if (active) setTreeError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [tab, sessionId, reviewRunId]);
  const reviewChanges =
    savedSummary && (!runState || savedSummary.runId === runState.runId)
      ? savedSummary.fileChanges
      : currentActivities.flatMap((item) => (item.fileChange ? [item.fileChange] : []));
  for (const change of reviewChanges) {
    const previous = changes.get(change.path);
    changes.set(change.path, {
      ...change,
      additions: (previous?.additions ?? 0) + change.additions,
      deletions: (previous?.deletions ?? 0) + change.deletions,
    });
  }
  const reviewFiles = [...changes.values()];
  const selectedReviewChange =
    reviewFiles.find((change) => change.path === reviewPath) ?? reviewFiles[0] ?? null;
  const selectedReviewPath = selectedReviewChange
    ? ((root ? workspaceRelativePath(root, selectedReviewChange.path) : null) ??
      selectedReviewChange.path)
    : "";
  const selectedReviewSegments = selectedReviewPath.replaceAll("\\", "/").split("/");
  const selectedReviewName = selectedReviewSegments.pop() || selectedReviewPath;
  const selectedReviewDirectory = selectedReviewSegments.join("/");

  useEffect(() => {
    if (!preferencesReady || initializedStyle.current) return;
    initializedStyle.current = true;
    if (orbit && !tabRequest && !browserRequest && !fileRequest) setTab("review");
  }, [preferencesReady, orbit, tabRequest, browserRequest, fileRequest]);

  useEffect(() => {
    if (!tabRequest || handledTabRequest.current === tabRequest.requestKey) return;
    handledTabRequest.current = tabRequest.requestKey;
    setTab(tabRequest.tab);
  }, [tabRequest]);

  const loadRoot = useCallback(async () => {
    const request = ++rootRequest.current;
    if (!root) {
      setRootEntries([]);
      return;
    }
    setTreeLoading(true);
    setTreeError(null);
    try {
      const entries = await window.mingshen.listWorkspace(root, ".");
      if (request === rootRequest.current) setRootEntries(entries);
    } catch (error) {
      if (request === rootRequest.current) setTreeError(errorText(error));
    } finally {
      if (request === rootRequest.current) setTreeLoading(false);
    }
  }, [root]);

  useEffect(() => {
    fileRequestVersion.current += 1;
    setSelectedFile(null);
    setEditorValue("");
    setExternalFilePath(null);
    setTreeVersion(0);
    void loadRoot();
    return () => {
      rootRequest.current += 1;
      fileRequestVersion.current += 1;
    };
  }, [loadRoot]);

  useEffect(() => {
    if (browserRequest) {
      setTab("browser");
    }
  }, [browserRequest]);

  const openRelativeFile = useCallback(
    async (relativePath: string) => {
      if (!root) {
        return;
      }
      const request = ++fileRequestVersion.current;
      if (selectedFile && editorValue !== selectedFile.content) {
        const discard = await confirm({
          title: tr("\u653E\u5F03\u672A\u4FDD\u5B58\u4FEE\u6539"),
          description: tr(
            "\u5F53\u524D\u6587\u4EF6\u6709\u5C1A\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\uFF0C\u5207\u6362\u6587\u4EF6\u540E\u8FD9\u4E9B\u4FEE\u6539\u4F1A\u4E22\u5931\u3002",
          ),
          confirmLabel: tr("\u7EE7\u7EED\u5207\u6362"),
          tone: "danger",
        });
        if (!discard || request !== fileRequestVersion.current) {
          return;
        }
      }

      try {
        const file = await window.mingshen.readWorkspaceFile(root, relativePath);
        if (request !== fileRequestVersion.current) return;
        setSelectedFile(file);
        setEditorValue(file.content);
        setExternalFilePath(null);
        setTab("files");
        setTreeError(null);
      } catch (error) {
        if (request === fileRequestVersion.current) setTreeError(errorText(error));
      }
    },
    [confirm, editorValue, root, selectedFile],
  );

  const openAbsoluteFile = useCallback(
    async (targetPath: string) => {
      const request = ++fileRequestVersion.current;
      if (
        selectedFile &&
        editorValue !== selectedFile.content &&
        !(await confirm({
          title: tr("放弃未保存修改"),
          description: tr("当前文件有尚未保存的修改，切换文件后这些修改会丢失。"),
          confirmLabel: tr("继续切换"),
          tone: "danger",
        }))
      )
        return;
      if (request !== fileRequestVersion.current) return;
      try {
        const file = await window.mingshen.readAbsoluteFile(targetPath);
        if (request !== fileRequestVersion.current) return;
        setSelectedFile(file);
        setEditorValue(file.content);
        setExternalFilePath(targetPath);
        setTab("files");
        setTreeError(null);
      } catch (error) {
        if (request === fileRequestVersion.current) setTreeError(errorText(error));
      }
    },
    [confirm, editorValue, selectedFile],
  );

  const openFile = async (entry: WorkspaceEntry) => {
    if (!root || entry.directory) {
      return;
    }
    await openRelativeFile(entry.relativePath);
  };

  useEffect(() => {
    if (!fileRequest || handledFileRequestRef.current === fileRequest.requestKey) {
      return;
    }
    handledFileRequestRef.current = fileRequest.requestKey;
    const relativePath = root ? workspaceRelativePath(root, fileRequest.path) : null;
    if (relativePath) {
      void openRelativeFile(relativePath);
      return;
    }
    if (/^[A-Za-z]:[\\/]|^\\\\/.test(fileRequest.path)) {
      void openAbsoluteFile(fileRequest.path);
    }
  }, [fileRequest, openAbsoluteFile, openRelativeFile, root]);

  const saveFile = async () => {
    if ((!root && !externalFilePath) || !selectedFile) {
      return;
    }
    setSaving(true);
    const request = fileRequestVersion.current;
    try {
      if (externalFilePath) {
        await window.mingshen.writeAbsoluteFile(externalFilePath, editorValue);
      } else if (root) {
        await window.mingshen.writeWorkspaceFile(root, selectedFile.relativePath, editorValue);
      }
      if (request !== fileRequestVersion.current) return;
      setSelectedFile({ ...selectedFile, content: editorValue, size: editorValue.length });
      if (!externalFilePath) {
        setTreeVersion((value) => value + 1);
      }
    } catch (error) {
      setTreeError(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside
      className={`workspace-panel${orbit ? " workspace-panel--orbit" : ""}`}
      aria-label={tr("\u5DE5\u4F5C\u533A")}
      data-unsaved={Boolean(selectedFile && editorValue !== selectedFile.content)}
      data-workspace-tab={tab}
    >
      <header className="workspace-panel__header">
        <div
          className="workspace-tabs"
          role="tablist"
          aria-label={tr("\u5DE5\u4F5C\u533A\u89C6\u56FE")}
        >
          <button
            className={tab === "review" ? "workspace-tab workspace-tab--active" : "workspace-tab"}
            type="button"
            role="tab"
            aria-selected={tab === "review"}
            data-workspace-tab="review"
            title={en ? "Review" : "审查"}
            onClick={() => setTab("review")}
          >
            <GitBranch size={14} aria-hidden="true" />
            {en ? "Review" : "审查"}
            {orbit && changes.size > 0 ? (
              <span className="workspace-tab__count">{changes.size}</span>
            ) : null}
          </button>
          <button
            className={tab === "files" ? "workspace-tab workspace-tab--active" : "workspace-tab"}
            type="button"
            role="tab"
            aria-selected={tab === "files"}
            data-workspace-tab="files"
            title={tr("文件")}
            onClick={() => setTab("files")}
          >
            <Files aria-hidden="true" size={14} />
            {tr("\u6587\u4EF6")}
          </button>
          {!orbit ? (
            <button
              className={tab === "git" ? "workspace-tab workspace-tab--active" : "workspace-tab"}
              type="button"
              role="tab"
              aria-selected={tab === "git"}
              data-workspace-tab="git"
              onClick={() => setTab("git")}
            >
              <GitBranch aria-hidden="true" size={14} />
              Git
            </button>
          ) : null}
          <button
            className={tab === "terminal" ? "workspace-tab workspace-tab--active" : "workspace-tab"}
            type="button"
            role="tab"
            aria-selected={tab === "terminal"}
            data-workspace-tab="terminal"
            title={tr("终端")}
            onClick={() => setTab("terminal")}
          >
            <SquareTerminal aria-hidden="true" size={14} />
            {tr("\u7EC8\u7AEF")}
          </button>
          {orbit ? (
            <button
              className={`workspace-tab workspace-tab--auxiliary${tab === "git" ? " workspace-tab--active" : ""}`}
              type="button"
              role="tab"
              aria-selected={tab === "git"}
              data-workspace-tab="git"
              aria-label="Git"
              title="Git"
              onClick={() => setTab("git")}
            >
              <GitBranch aria-hidden="true" size={14} />
            </button>
          ) : null}
          <button
            className={`workspace-tab${orbit ? " workspace-tab--auxiliary" : ""}${tab === "browser" ? " workspace-tab--active" : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === "browser"}
            data-workspace-tab="browser"
            aria-label={tr("\u6D4F\u89C8\u5668")}
            title={tr("\u6D4F\u89C8\u5668")}
            onClick={() => setTab("browser")}
          >
            <Globe2 aria-hidden="true" size={14} />
            {!orbit ? tr("\u6D4F\u89C8\u5668") : null}
          </button>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={tr("\u5173\u95ED\u5DE5\u4F5C\u533A")}
          title={tr("\u5173\u95ED\u5DE5\u4F5C\u533A")}
          onClick={onClose}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      {tab === "review" ? (
        <section className="review-panel">
          {treeError ? (
            <p className="form-error" role="alert">
              {treeError}
            </p>
          ) : null}
          <header>
            <strong>{en ? "Current turn" : "本轮变更"}</strong>
            <span>
              {changes.size} {en ? "files" : "个文件"}
            </span>
            <button type="button" className="link-button" onClick={() => setTab("git")}>
              {en ? "Git workspace" : "Git 工作区"}
            </button>
          </header>
          {changes.size === 0 ? (
            <p className="quiet-copy">
              {en ? "No file changes in this turn." : "本轮尚无文件变更。"}
            </p>
          ) : orbit ? (
            <>
              <div className="orbit-review-files">
                {reviewFiles.map((change) => {
                  const displayPath =
                    (root ? workspaceRelativePath(root, change.path) : null) ?? change.path;
                  const segments = displayPath.replaceAll("\\", "/").split("/");
                  const name = segments.pop() || displayPath;
                  const directory = segments.join("/");
                  return (
                    <button
                      className={`orbit-review-file${selectedReviewChange?.path === change.path ? " orbit-review-file--selected" : ""}`}
                      type="button"
                      key={change.path}
                      data-review-file={change.path}
                      aria-pressed={selectedReviewChange?.path === change.path}
                      title={change.path}
                      aria-label={
                        en
                          ? `${displayPath}, ${change.additions} additions, ${change.deletions} deletions`
                          : `${displayPath}，新增 ${change.additions} 行，删除 ${change.deletions} 行`
                      }
                      onClick={() => setReviewPath(change.path)}
                    >
                      <FileCode2 aria-hidden="true" size={15} />
                      <span className="orbit-review-file__copy">
                        <span className="orbit-review-file__name">{name}</span>
                        {directory ? (
                          <span className="orbit-review-file__path" dir="rtl">
                            <bdi dir="ltr">{directory}</bdi>
                          </span>
                        ) : null}
                      </span>
                      <span className="run-summary__added">+{change.additions}</span>
                      <span className="run-summary__deleted">-{change.deletions}</span>
                    </button>
                  );
                })}
              </div>
              {selectedReviewChange ? (
                <section className="orbit-review-preview">
                  <header>
                    <button
                      type="button"
                      title={selectedReviewChange.path}
                      aria-label={selectedReviewPath}
                      onClick={() => {
                        const relative = root
                          ? workspaceRelativePath(root, selectedReviewChange.path)
                          : null;
                        if (relative) void openRelativeFile(relative);
                        else void openAbsoluteFile(selectedReviewChange.path);
                      }}
                    >
                      <code className="orbit-review-file__name">{selectedReviewName}</code>
                      {selectedReviewDirectory ? (
                        <span className="orbit-review-file__path" dir="rtl">
                          <bdi dir="ltr">{selectedReviewDirectory}</bdi>
                        </span>
                      ) : null}
                    </button>
                    {selectedReviewChange.diff ? (
                      <CopyButton
                        text={selectedReviewChange.diff.lines
                          .map(
                            (line) =>
                              `${line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}${line.text}`,
                          )
                          .join("\n")}
                        label={en ? "Copy file diff" : "复制文件变更"}
                        className="icon-button"
                      />
                    ) : null}
                  </header>
                  {selectedReviewChange.diff ? (
                    <DiffPreview
                      path={selectedReviewChange.path}
                      additions={selectedReviewChange.additions}
                      deletions={selectedReviewChange.deletions}
                      diff={selectedReviewChange.diff}
                      onOpenFile={(path) => {
                        const relative = root ? workspaceRelativePath(root, path) : null;
                        if (relative) void openRelativeFile(relative);
                        else void openAbsoluteFile(path);
                      }}
                    />
                  ) : (
                    <p className="quiet-copy">
                      {en ? "No saved diff is available." : "此文件没有已保存的 diff。"}
                    </p>
                  )}
                </section>
              ) : null}
            </>
          ) : (
            [...changes.values()].map((change) => (
              <div className="review-file" key={change.path}>
                <button
                  className="review-file__toggle"
                  type="button"
                  aria-expanded={reviewPath === change.path}
                  onClick={() => setReviewPath(reviewPath === change.path ? null : change.path)}
                >
                  <ChevronRight size={14} />
                  <code>{change.path}</code>
                  <span className="run-summary__added">+{change.additions}</span>
                  <span className="run-summary__deleted">-{change.deletions}</span>
                </button>
                {reviewPath === change.path ? (
                  change.diff ? (
                    <DiffPreview
                      path={change.path}
                      additions={change.additions}
                      deletions={change.deletions}
                      diff={change.diff}
                      onOpenFile={(path) => {
                        const relative = root ? workspaceRelativePath(root, path) : null;
                        if (relative) void openRelativeFile(relative);
                        else void openAbsoluteFile(path);
                      }}
                    />
                  ) : (
                    <p className="quiet-copy">
                      {en ? "No saved diff is available." : "此文件没有已保存的 diff。"}
                    </p>
                  )
                ) : null}
              </div>
            ))
          )}
          <div className="review-checks">
            <strong>{en ? "Execution & verification" : "执行与验证"}</strong>
            {commandActivities.slice(0, commandLimit).map((item) => (
              <ExpandableText
                key={item.id}
                label={`${item.title} · ${tr(
                  item.status === "running"
                    ? "运行中"
                    : item.status === "failed"
                      ? "失败"
                      : "已完成",
                )}`}
                preview={item.detail}
                text={activityDetailsText(item, toolDetails)}
                tone={item.status === "failed" ? "error" : undefined}
              />
            ))}
            {commandLimit < commandActivities.length ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setCommandLimit((value) => value + 100)}
              >
                {tr("显示更多步骤")}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {root ? (
        <button
          className="command-dock-toggle"
          type="button"
          aria-pressed={commandDock}
          onClick={() => setCommandDock((value) => !value)}
          title={en ? "Dock command panel" : "停靠命令面板"}
        >
          <SquareTerminal size={14} />
          {en ? "Commands" : "命令"}
          <ChevronDown size={12} />
        </button>
      ) : null}

      {!root &&
      tab !== "browser" &&
      tab !== "review" &&
      !(tab === "files" && externalFilePath && selectedFile) ? (
        <div className="workspace-empty">
          <p>{tr("\u5F53\u524D\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u76EE\u5F55\u3002")}</p>
          <button className="btn btn--secondary" type="button" onClick={() => void onChooseRoot()}>
            <FolderOpen aria-hidden="true" size={15} />
            {tr("\u9009\u62E9\u76EE\u5F55")}
          </button>
        </div>
      ) : null}

      {!root && tab === "files" && externalFilePath && selectedFile ? (
        <div className="workspace-files">
          <div className="workspace-section-heading">
            <code title={externalFilePath}>{externalFilePath}</code>
          </div>
          <div className="editor-pane">
            <div className="editor-pane__header">
              <div>
                <strong>{selectedFile.relativePath}</strong>
                {editorValue !== selectedFile.content ? (
                  <span>{tr("\u672A\u4FDD\u5B58")}</span>
                ) : null}
              </div>
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => void saveFile()}
                disabled={saving || editorValue === selectedFile.content}
              >
                {saving ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : (
                  <Save aria-hidden="true" size={14} />
                )}
                {tr("\u4FDD\u5B58")}
              </button>
            </div>
            <textarea
              className="editor-textarea"
              value={editorValue}
              onChange={(event) => setEditorValue(event.target.value)}
              spellCheck={false}
              aria-label={tr("\u5916\u90E8\u6587\u4EF6\u7F16\u8F91\u5668")}
            />
          </div>
        </div>
      ) : null}

      {root && tab === "files" ? (
        <div className="workspace-files">
          <div className="workspace-section-heading">
            <code title={root}>{root}</code>
            <button
              className="icon-button"
              type="button"
              aria-label={tr("\u5237\u65B0\u6587\u4EF6\u6811")}
              title={tr("\u5237\u65B0")}
              onClick={() => {
                setTreeVersion((value) => value + 1);
                void loadRoot();
              }}
              disabled={treeLoading}
            >
              <RefreshCw
                className={treeLoading ? "spin" : undefined}
                aria-hidden="true"
                size={14}
              />
            </button>
          </div>

          <div className={selectedFile ? "file-browser file-browser--with-editor" : "file-browser"}>
            <section
              className="file-tree"
              aria-label={en ? "Workspace files" : "工作区文件"}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: The independently scrollable file list needs keyboard scrolling.
              tabIndex={0}
            >
              {treeError ? <p className="form-error">{treeError}</p> : null}
              {rootEntries.map((entry) => (
                <TreeNode
                  key={`${entry.path}:${treeVersion}`}
                  root={root}
                  entry={entry}
                  depth={0}
                  onOpenFile={openFile}
                />
              ))}
            </section>

            {selectedFile ? (
              <div className="editor-pane">
                <div className="editor-pane__header">
                  <div>
                    <strong>{selectedFile.relativePath.split(/[\\/]/).at(-1)}</strong>
                    {editorValue !== selectedFile.content ? (
                      <span>{tr("\u672A\u4FDD\u5B58")}</span>
                    ) : null}
                  </div>
                  <button
                    className="btn btn--secondary"
                    type="button"
                    onClick={() => void saveFile()}
                    disabled={saving || editorValue === selectedFile.content}
                  >
                    {saving ? (
                      <LoaderCircle className="spin" aria-hidden="true" size={14} />
                    ) : (
                      <Save aria-hidden="true" size={14} />
                    )}
                    {tr("\u4FDD\u5B58")}
                  </button>
                </div>
                <textarea
                  className="editor-textarea"
                  value={editorValue}
                  onChange={(event) => setEditorValue(event.target.value)}
                  spellCheck={false}
                  aria-label={tr("\u6587\u4EF6\u7F16\u8F91\u5668")}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {root && tab === "git" ? <GitPanel root={root} /> : null}
      {root ? (
        <div
          className={commandDock && tab !== "terminal" ? "command-dock" : "command-tab"}
          hidden={tab !== "terminal" && !commandDock}
        >
          <TerminalPanel root={root} />
        </div>
      ) : null}
      {browserRequest ? (
        <div
          className={
            tab === "browser"
              ? "workspace-browser-host"
              : "workspace-browser-host workspace-browser-host--hidden"
          }
        >
          <BrowserDock
            key={`${browserRequest.sessionId}:${browserRequest.provider}:${browserRequest.requestKey}`}
            sessionId={browserRequest.sessionId}
            provider={browserRequest.provider}
            initialUrl={browserRequest.url}
          />
        </div>
      ) : tab === "browser" ? (
        <div className="workspace-empty">
          <Globe2 aria-hidden="true" size={22} />
          <p>
            {tr(
              "Agent \u6253\u5F00\u6D4F\u89C8\u5668\u9875\u9762\u540E\u4F1A\u5728\u8FD9\u91CC\u5B9E\u65F6\u663E\u793A\u3002",
            )}
          </p>
        </div>
      ) : null}
    </aside>
  );
}

function TreeNode({
  root,
  entry,
  depth,
  onOpenFile,
}: {
  root: string;
  entry: WorkspaceEntry;
  depth: number;
  onOpenFile: (entry: WorkspaceEntry) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<WorkspaceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (!entry.directory) {
      await onOpenFile(entry);
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (children.length > 0) {
      return;
    }
    setLoading(true);
    try {
      setChildren(await window.mingshen.listWorkspace(root, entry.relativePath));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tree-node">
      <button
        className="tree-row"
        type="button"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => void toggle()}
        title={entry.relativePath}
      >
        {entry.directory ? (
          expanded ? (
            <ChevronDown aria-hidden="true" size={13} />
          ) : (
            <ChevronRight aria-hidden="true" size={13} />
          )
        ) : (
          <span className="tree-row__spacer" />
        )}
        {entry.directory ? (
          expanded ? (
            <FolderOpen aria-hidden="true" size={14} />
          ) : (
            <Folder aria-hidden="true" size={14} />
          )
        ) : (
          <File aria-hidden="true" size={14} />
        )}
        <span>{entry.name}</span>
        {!entry.directory && entry.size > 0 ? <code>{formatCount(entry.size)}</code> : null}
        {loading ? <LoaderCircle className="spin" aria-hidden="true" size={12} /> : null}
      </button>
      {error ? <p className="tree-error">{error}</p> : null}
      {expanded
        ? children.map((child) => (
            <TreeNode
              key={child.path}
              root={root}
              entry={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
            />
          ))
        : null}
    </div>
  );
}

function GitPanel({ root }: { root: string }) {
  const { confirm } = useDialog();
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [backupId, setBackupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await window.mingshen.getGitStatus(root);
      setStatus(next);
      setPaths(next.isRepository ? (await window.mingshen.getGitChanges(root)).paths : []);
      setBackupId(next.isRepository ? await window.mingshen.getLatestGitBackup(root) : null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const discard = async (path?: string) => {
    if (
      !(await confirm({
        title: path
          ? tr("\u64A4\u9500\u6587\u4EF6\u53D8\u66F4")
          : tr("\u64A4\u9500\u4ED3\u5E93\u5168\u90E8\u53D8\u66F4"),
        description: tr(
          "{0} \u5C06\u6062\u590D\u5230 HEAD\uFF1B\u65B0\u5EFA\u6587\u4EF6\u5C06\u79FB\u5165\u672C\u5730\u6062\u590D\u5907\u4EFD\uFF0C\u6682\u5B58\u533A\u4E5F\u4F1A\u6062\u590D\u3002",
          [path ?? `${paths.length} 个文件`],
        ),
        confirmLabel: tr("\u5907\u4EFD\u5E76\u64A4\u9500"),
        tone: "danger",
      }))
    )
      return;
    setLoading(true);
    try {
      const result = await window.mingshen.discardGitChanges(root, path ? [path] : undefined);
      setBackupId(result.backupId);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  const restoreUndo = async () => {
    if (
      !backupId ||
      !(await confirm({
        title: tr("\u6062\u590D\u64A4\u9500\u524D\u7684\u53D8\u66F4"),
        description: tr(
          "\u6062\u590D\u5907\u4EFD\u4E2D\u7684\u6587\u4EF6\u53CA\u6682\u5B58\u533A\u3002\u7EE7\u7EED\u524D\u8BF7\u786E\u8BA4\u6CA1\u6709\u9700\u8981\u4FDD\u7559\u7684\u65B0\u4FEE\u6539\u3002",
        ),
        confirmLabel: tr("\u6062\u590D\u53D8\u66F4"),
      }))
    )
      return;
    setLoading(true);
    try {
      await window.mingshen.restoreGitUndo(root, backupId);
      setBackupId(null);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="side-panel">
      <div className="workspace-section-heading">
        <h3>{tr("Git \u72B6\u6001")}</h3>
        <button
          className="icon-button"
          type="button"
          aria-label={tr("\u5237\u65B0 Git \u72B6\u6001")}
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "spin" : undefined} aria-hidden="true" size={14} />
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="settings-actions">
        <button
          className="btn btn--secondary"
          type="button"
          disabled={loading || !paths.length}
          onClick={() => void discard()}
        >
          <Undo2 size={14} />
          {tr("\u64A4\u9500\u5168\u90E8\u53D8\u66F4")}
        </button>
        {backupId ? (
          <button
            className="btn btn--secondary"
            type="button"
            disabled={loading}
            onClick={() => void restoreUndo()}
          >
            {tr("\u6062\u590D\u64A4\u9500\u524D")}
          </button>
        ) : null}
      </div>
      {paths.map((path) => (
        <div className="workspace-section-heading" key={path}>
          <code title={path}>{path}</code>
          <button
            className="icon-button"
            type="button"
            title={tr("\u64A4\u9500\u6B64\u6587\u4EF6\u53D8\u66F4")}
            aria-label={tr("\u64A4\u9500 {0}", [path])}
            disabled={loading}
            onClick={() => void discard(path)}
          >
            <Undo2 size={14} />
          </button>
        </div>
      ))}
      {status ? (
        <div className="git-status">
          <div className="git-branch">
            <GitBranch aria-hidden="true" size={14} />
            {status.branch ?? "not a repository"}
          </div>
          {status.error ? <p className="form-error">{status.error}</p> : null}
          {status.statusText ? (
            <pre>{status.statusText}</pre>
          ) : (
            <p className="quiet-copy">{tr("\u5DE5\u4F5C\u533A\u5E72\u51C0")}</p>
          )}
          {status.diffStat ? <pre>{status.diffStat}</pre> : null}
        </div>
      ) : null}
    </section>
  );
}

function TerminalPanel({ root }: { root: string }) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<
    Array<{
      id: string;
      command: string;
      result: UserCommandResult | null;
      error: string | null;
    }>
  >([]);
  const [running, setRunning] = useState(false);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    const next = command.trim();
    if (!next || running) {
      return;
    }
    setCommand("");
    setRunning(true);
    try {
      const result = await window.mingshen.runUserCommand(root, next);
      setHistory((current) => [
        ...current,
        { id: crypto.randomUUID(), command: next, result, error: null },
      ]);
    } catch (error) {
      setHistory((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          command: next,
          result: null,
          error: errorText(error),
        },
      ]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="terminal-panel">
      <div className="terminal-output">
        <p className="terminal-hint">PowerShell · {root}</p>
        {history.map((item) => (
          <details className="terminal-entry" key={item.id} open>
            <summary className="terminal-command">
              <ChevronRight size={14} aria-hidden="true" />
              <span>PS&gt;</span>
              <code>{item.command}</code>
            </summary>
            <div className="terminal-entry__actions">
              <CopyButton
                label={tr("复制完整内容")}
                text={[
                  item.command,
                  item.result?.stdout,
                  item.result?.stderr,
                  item.error,
                  item.result
                    ? `exit ${item.result.exitCode ?? "null"} · ${item.result.durationMs} ms`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n\n")}
              />
            </div>
            <pre className="terminal-entry__command">{item.command}</pre>
            {item.result ? (
              <>
                {item.result.stdout ? <pre>{item.result.stdout}</pre> : null}
                {item.result.stderr ? (
                  <pre className={item.result.exitCode === 0 ? undefined : "terminal-stderr"}>
                    {item.result.stderr}
                  </pre>
                ) : null}
                <div className="terminal-meta">
                  exit {item.result.exitCode ?? "null"} · {item.result.durationMs} ms
                </div>
              </>
            ) : null}
            {item.error ? <pre className="terminal-stderr">{item.error}</pre> : null}
          </details>
        ))}
      </div>
      <form className="terminal-input-row" onSubmit={run}>
        <span>PS&gt;</span>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={tr("\u8F93\u5165 PowerShell \u547D\u4EE4")}
          disabled={running}
          autoComplete="off"
          spellCheck={false}
        />

        <button className="btn btn--secondary" type="submit" disabled={!command.trim() || running}>
          {running ? (
            <LoaderCircle className="spin" aria-hidden="true" size={14} />
          ) : (
            tr("\u8FD0\u884C")
          )}
        </button>
      </form>
    </section>
  );
}
