import {
  AlertTriangle,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  History,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff, FileDiffLine } from "../../../shared/domain";
import type {
  LocalReviewCommentDraft,
  LocalReviewCommentsInput,
  LocalReviewRequest,
  LocalReviewScope,
  LocalReviewSnapshot,
} from "../../../shared/local-review";
import { useLocale } from "../i18n";
import { formatCount } from "../lib/format";
import { CopyButton } from "./CopyButton";
import "../local-review.css";

interface LocalReviewProps {
  sessionId: string | null;
  root: string | null;
  onOpenFile: (path: string) => void;
  onComment: (text: string) => Promise<void> | void;
}

interface LineSelection {
  anchor: number;
  focus: number;
  side: "old" | "new";
}

interface SelectionInfo {
  side: "old" | "new";
  startLine: number;
  endLine: number;
  indexes: number[];
  preview: string;
}

interface PendingComment {
  key: string;
  label: string;
  preview: string;
  draft: LocalReviewCommentDraft;
}

const MAX_PENDING_COMMENT_CHARACTERS = 20_000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lineNumber(line: FileDiffLine, side: "old" | "new"): number | null {
  return side === "old" ? line.oldLine : line.newLine;
}

function resolveSelection(diff: FileDiff, selection: LineSelection): SelectionInfo | null {
  const anchor = Math.min(selection.anchor, selection.focus);
  const focus = Math.max(selection.anchor, selection.focus);
  const indexes: number[] = [];
  const numbers: number[] = [];
  const quote: string[] = [];
  for (let index = anchor; index <= focus; index += 1) {
    const line = diff.lines[index];
    const number = line ? lineNumber(line, selection.side) : null;
    if (line === undefined || number === null) continue;
    indexes.push(index);
    numbers.push(number);
    quote.push(line.text);
  }
  if (!numbers.length) return null;
  const startLine = numbers[0] as number;
  const endLine = numbers.at(-1) as number;
  if (
    numbers.length !== endLine - startLine + 1 ||
    numbers.some((number, index) => number !== startLine + index)
  ) {
    return null;
  }
  return {
    side: selection.side,
    startLine,
    endLine,
    indexes,
    preview: quote.join("\n").slice(0, 600),
  };
}

function scopeOptions(en: boolean): Array<{
  id: LocalReviewScope;
  label: string;
  icon: typeof GitBranch;
}> {
  return [
    { id: "git", label: en ? "Git" : "Git", icon: GitBranch },
    { id: "branch", label: en ? "Branch" : "分支", icon: GitCommitHorizontal },
    { id: "session", label: en ? "Session" : "会话", icon: History },
    { id: "previous", label: en ? "Previous" : "上一轮", icon: History },
  ];
}

export function LocalReview({ sessionId, root, onOpenFile, onComment }: LocalReviewProps) {
  const en = useLocale() === "en";
  const scopes = useMemo(() => scopeOptions(en), [en]);
  const [scope, setScope] = useState<LocalReviewScope>("git");
  const [baseRef, setBaseRef] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LocalReviewSnapshot | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [commentText, setCommentText] = useState("");
  const [pending, setPending] = useState<PendingComment[]>([]);
  const [staleFiles, setStaleFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const mounted = useRef(false);
  const submitInFlight = useRef<object | null>(null);
  const currentSession = useRef({ sessionId, root });
  currentSession.current = { sessionId, root };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadVersion.current += 1;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A different session or root owns separate review state.
  useEffect(() => {
    submitInFlight.current = null;
    setSubmitting(false);
    setPending([]);
    setStaleFiles([]);
    setSelection(null);
    setCommentText("");
    setSnapshot(null);
  }, [sessionId, root]);

  const load = useCallback(async () => {
    const requestVersion = ++loadVersion.current;
    const isCurrentLoad = () =>
      mounted.current &&
      requestVersion === loadVersion.current &&
      currentSession.current.sessionId === sessionId &&
      currentSession.current.root === root;
    if (!sessionId || !root) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const request: LocalReviewRequest = {
        sessionId,
        scope,
        baseRef: scope === "branch" ? baseRef : null,
      };
      const next = await window.mingshen.getLocalReview(request);
      if (isCurrentLoad()) setSnapshot(next);
    } catch (cause) {
      if (isCurrentLoad()) {
        setError(errorText(cause));
        setSnapshot(null);
      }
    } finally {
      if (isCurrentLoad()) setLoading(false);
    }
  }, [baseRef, root, scope, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!snapshot) {
      setSelectedPath(null);
      return;
    }
    const current = snapshot.files.find((file) => file.path === selectedPath);
    if (!current) setSelectedPath(snapshot.files[0]?.path ?? null);
  }, [selectedPath, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const versions = new Map(snapshot.files.map((file) => [file.path, file.version]));
    setStaleFiles(
      [
        ...new Set(
          pending
            .filter((item) => versions.get(item.draft.path) !== item.draft.version)
            .map((item) => item.draft.path),
        ),
      ].filter(Boolean),
    );
  }, [pending, snapshot]);

  const selectedFile =
    snapshot?.files.find((file) => file.path === selectedPath) ?? snapshot?.files[0] ?? null;
  const selectionInfo =
    selectedFile?.diff && selection ? resolveSelection(selectedFile.diff, selection) : null;
  const selectedIndexes = useMemo(
    () => new Set(selectionInfo?.indexes ?? []),
    [selectionInfo?.indexes],
  );
  const selectedFileIsStale = Boolean(
    selectedFile && staleFiles.some((path) => path === selectedFile.path),
  );
  const canAdd =
    Boolean(selectedFile && selectionInfo && commentText.trim()) &&
    !selectedFileIsStale &&
    pending.length < 20 &&
    pending.reduce((total, item) => total + item.draft.text.length, 0) + commentText.length <=
      MAX_PENDING_COMMENT_CHARACTERS;
  const canSend =
    pending.length > 0 &&
    !staleFiles.length &&
    !loading &&
    !submitting &&
    snapshot?.sessionId === sessionId &&
    snapshot.scope === scope &&
    pending.every((item) => item.draft.text.trim());

  const chooseLine = (
    event: React.MouseEvent<HTMLButtonElement>,
    index: number,
    line: FileDiffLine,
  ) => {
    const lineSide = line.type === "removed" ? "old" : "new";
    if (!event.shiftKey || !selection) {
      setSelection({ anchor: index, focus: index, side: lineSide });
      return;
    }
    setSelection({ ...selection, focus: index });
  };

  const addComment = () => {
    if (!selectedFile || !selectionInfo || !commentText.trim()) return;
    const label = `${
      selectionInfo.side === "old" ? (en ? "Old" : "旧") : en ? "New" : "新"
    } ${selectionInfo.startLine}-${selectionInfo.endLine}`;
    setPending((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        label,
        preview: selectionInfo.preview,
        draft: {
          path: selectedFile.path,
          version: selectedFile.version,
          side: selectionInfo.side,
          startLine: selectionInfo.startLine,
          endLine: selectionInfo.endLine,
          text: commentText.trim(),
        },
      },
    ]);
    setCommentText("");
    setSelection(null);
    setError(null);
  };

  const sendComments = async () => {
    if (!sessionId || !root || !snapshot || !canSend || submitInFlight.current) return;
    const attempt = {};
    const isCurrentSession = () =>
      mounted.current &&
      submitInFlight.current === attempt &&
      currentSession.current.sessionId === sessionId &&
      currentSession.current.root === root;
    const sentKeys = new Set(pending.map((item) => item.key));
    const stale = pending
      .filter(
        (item) =>
          snapshot.files.find((file) => file.path === item.draft.path)?.version !==
          item.draft.version,
      )
      .map((item) => item.draft.path);
    if (stale.length) {
      setStaleFiles([...new Set(stale)]);
      setError(
        en
          ? "Some commented files changed. Refresh and create the comments again."
          : "部分评论对应的文件或 diff 已变化，请刷新后重新添加意见。",
      );
      return;
    }

    const input: LocalReviewCommentsInput = {
      request: {
        sessionId,
        scope,
        baseRef: scope === "branch" ? baseRef : null,
      },
      comments: pending.map((item) => item.draft),
    };
    submitInFlight.current = attempt;
    setSubmitting(true);
    setError(null);
    try {
      const result = await window.mingshen.submitLocalReviewComments(input);
      if (!isCurrentSession()) return;
      if (!result.ok || !result.formattedText) {
        setStaleFiles(result.staleFiles);
        setError(
          en
            ? "The file or diff changed after selection. Refresh before sending."
            : "选中后文件或 diff 已变化，请刷新后重新添加意见。",
        );
        return;
      }
      await onComment(result.formattedText);
      if (!isCurrentSession()) return;
      setPending((current) => current.filter((item) => !sentKeys.has(item.key)));
    } catch (cause) {
      if (isCurrentSession()) setError(errorText(cause));
    } finally {
      if (submitInFlight.current === attempt) {
        const current = isCurrentSession();
        submitInFlight.current = null;
        if (current) setSubmitting(false);
      }
    }
  };

  if (!sessionId || !root) {
    return (
      <div className="local-review__empty">
        <GitBranch aria-hidden="true" size={20} />
        <p>{en ? "Open a workspace to review changes." : "打开工作目录后可审阅代码变更。"}</p>
      </div>
    );
  }

  return (
    <section
      className="local-review"
      aria-label={en ? "Local review" : "本地代码审阅"}
      data-testid="local-review"
      data-review-scope={scope}
    >
      <div className="local-review__toolbar">
        <div className="local-review__scopes" role="tablist">
          {scopes.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={scope === option.id}
                data-review-scope={option.id}
                className={scope === option.id ? "is-active" : undefined}
                onClick={() => {
                  setScope(option.id);
                  setBaseRef(null);
                  setSelection(null);
                  setCommentText("");
                }}
              >
                <Icon aria-hidden="true" size={13} />
                {option.label}
              </button>
            );
          })}
        </div>
        <button
          className="local-review__icon-button"
          type="button"
          aria-label={en ? "Refresh review" : "刷新审阅"}
          title={en ? "Refresh review" : "刷新审阅"}
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "spin" : undefined} aria-hidden="true" size={14} />
        </button>
      </div>

      {scope === "branch" ? (
        <label className="local-review__base">
          <span>{en ? "Compare with" : "比较基准"}</span>
          <select
            value={baseRef ?? snapshot?.baseRef ?? ""}
            onChange={(event) => setBaseRef(event.target.value || null)}
            disabled={loading || !snapshot?.branches.length}
          >
            <option value="">{en ? "Default branch" : "默认分支"}</option>
            {(snapshot?.branches ?? []).map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? (
        <div className="local-review__error" role="alert">
          <AlertTriangle aria-hidden="true" size={14} />
          <span>{error}</span>
        </div>
      ) : null}
      {snapshot?.warnings.length ? (
        <div className="local-review__warnings">
          {snapshot.warnings.slice(0, 3).map((warning) => (
            <p key={warning}>
              <AlertTriangle aria-hidden="true" size={12} />
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      {snapshot ? (
        <div className="local-review__meta">
          <span>
            {snapshot?.currentBranch
              ? `${en ? "Branch" : "分支"} ${snapshot.currentBranch}`
              : snapshot?.isRepository
                ? en
                  ? "Detached HEAD"
                  : "游离 HEAD"
                : en
                  ? "No Git repository"
                  : "非 Git 仓库"}
          </span>
          <span>
            {snapshot.files.length}{" "}
            {en ? (snapshot.files.length === 1 ? "file" : "files") : "个文件"}
          </span>
          {snapshot?.runId ? <code>{snapshot.runId.slice(0, 8)}</code> : null}
        </div>
      ) : null}

      {loading && !snapshot ? (
        <div className="local-review__empty">
          <RefreshCw className="spin" aria-hidden="true" size={18} />
          <p>{en ? "Loading changes..." : "正在加载变更…"}</p>
        </div>
      ) : snapshot && snapshot.files.length === 0 ? (
        <div className="local-review__empty">
          <GitCommitHorizontal aria-hidden="true" size={20} />
          <p>{en ? "No changes in this scope." : "此范围没有可审阅的变更。"}</p>
        </div>
      ) : snapshot ? (
        <div className="local-review__workspace">
          <fieldset className="local-review__files" aria-label={en ? "Changed files" : "变更文件"}>
            {snapshot.files.map((file) => {
              const stale = staleFiles.includes(file.path);
              return (
                <div
                  key={file.path}
                  className={[
                    "local-review__file",
                    file.path === selectedFile?.path ? "is-selected" : "",
                    stale ? "is-stale" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-review-file={file.path}
                  data-review-stale={stale ? "true" : "false"}
                >
                  <button
                    className="local-review__file-main"
                    type="button"
                    title={file.path}
                    onClick={() => {
                      setSelectedPath(file.path);
                      setSelection(null);
                      setCommentText("");
                    }}
                  >
                    <span
                      className={`local-review__status local-review__status--${file.changeType}`}
                    >
                      {file.changeType === "created"
                        ? "A"
                        : file.changeType === "deleted"
                          ? "D"
                          : "M"}
                    </span>
                    <span>{file.path}</span>
                    <small>
                      +{formatCount(file.additions)} -{formatCount(file.deletions)}
                    </small>
                  </button>
                  {file.changeType !== "deleted" ? (
                    <button
                      className="local-review__open-file"
                      type="button"
                      title={en ? "Open file" : "打开文件"}
                      aria-label={en ? `Open ${file.path}` : `打开 ${file.path}`}
                      onClick={() => onOpenFile(file.absolutePath)}
                    >
                      <ExternalLink aria-hidden="true" size={13} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </fieldset>

          {selectedFile ? (
            <section className="local-review__diff">
              <header>
                <div>
                  <code title={selectedFile.path}>{selectedFile.path}</code>
                  <span>
                    +{selectedFile.additions} -{selectedFile.deletions}
                  </span>
                </div>
                {selectedFile.diff ? (
                  <CopyButton
                    className="local-review__icon-button"
                    text={selectedFile.diff.lines
                      .map(
                        (line) =>
                          `${line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}${line.text}`,
                      )
                      .join("\n")}
                    label={en ? "Copy diff" : "复制 diff"}
                  />
                ) : null}
              </header>

              {selectedFile.diff ? (
                <>
                  <fieldset
                    className="local-review__code"
                    aria-label={en ? "Selectable diff lines" : "可选择 diff 行"}
                  >
                    {selectedFile.diff.lines.map((line, index) => {
                      const selected = selectedIndexes.has(index);
                      return (
                        <button
                          type="button"
                          aria-pressed={selected}
                          aria-label={`${line.oldLine ?? ""} ${line.newLine ?? ""} ${line.text}`}
                          data-review-old-line={line.oldLine ?? ""}
                          data-review-new-line={line.newLine ?? ""}
                          title={
                            en
                              ? "Click to select a line; Shift-click to extend"
                              : "点击选择行，Shift 点击扩展选择"
                          }
                          className={[
                            "local-review__line",
                            `local-review__line--${line.type}`,
                            selected ? "is-selected" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          key={`${line.type}:${line.oldLine ?? "x"}:${line.newLine ?? "x"}:${line.text}`}
                          onClick={(event) => chooseLine(event, index, line)}
                        >
                          <span>{line.oldLine ?? ""}</span>
                          <span>{line.newLine ?? ""}</span>
                          <code>
                            {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                            {line.text || " "}
                          </code>
                        </button>
                      );
                    })}
                  </fieldset>
                  {selectedFile.diff.truncated ? (
                    <p className="local-review__truncated">
                      {en ? "Large diff truncated." : "变更较大，diff 已截断。"}
                    </p>
                  ) : null}
                  <div className="local-review__comment-editor">
                    <div className="local-review__selection">
                      {selectionInfo ? (
                        <>
                          <strong>
                            {selectionInfo.side === "old" ? (en ? "Old" : "旧") : en ? "New" : "新"}
                            {en ? " " : ""}
                            {selectionInfo.startLine}-{selectionInfo.endLine}
                          </strong>
                          <code>{selectionInfo.preview || (en ? "(blank line)" : "（空行）")}</code>
                        </>
                      ) : (
                        <span>
                          {en
                            ? "Select one or more lines on the same side."
                            : "请选择同一侧的一行或多行代码。"}
                        </span>
                      )}
                    </div>
                    <textarea
                      data-testid="local-review-comment-input"
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                      placeholder={en ? "Add a review comment" : "添加代码审查意见"}
                      rows={3}
                      maxLength={4_000}
                      disabled={!selectionInfo}
                    />
                    <button
                      className="btn btn--secondary"
                      type="button"
                      data-testid="local-review-add-comment"
                      onClick={addComment}
                      disabled={!canAdd}
                    >
                      <MessageSquarePlus aria-hidden="true" size={14} />
                      {en ? "Add comment" : "添加意见"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="local-review__no-diff">
                  {en
                    ? "No line diff is available for this file."
                    : "此文件没有可选择的逐行 diff。"}
                </p>
              )}
            </section>
          ) : null}
        </div>
      ) : null}

      {pending.length ? (
        <section className="local-review__pending" data-testid="local-review-pending">
          <header>
            <strong>
              {en ? "Pending comments" : "待送入意见"} · {pending.length}
            </strong>
            <button
              className="btn btn--secondary"
              type="button"
              data-testid="local-review-submit"
              disabled={!canSend}
              onClick={() => void sendComments()}
            >
              <Send aria-hidden="true" size={14} />
              {submitting
                ? en
                  ? "Checking..."
                  : "正在校验…"
                : en
                  ? "Put in composer"
                  : "送入输入框"}
            </button>
          </header>
          {staleFiles.length ? (
            <p className="local-review__stale-note" role="alert">
              <AlertTriangle aria-hidden="true" size={13} />
              {en
                ? "Changed files are marked stale and cannot be sent."
                : "已变化的文件会被标记为过期，不能送入旧行号意见。"}
            </p>
          ) : null}
          <div className="local-review__pending-list">
            {pending.map((item) => (
              <article
                key={item.key}
                className={staleFiles.includes(item.draft.path) ? "is-stale" : undefined}
                data-review-pending-path={item.draft.path}
              >
                <div>
                  <strong>{item.draft.path}</strong>
                  <span>{item.label}</span>
                </div>
                <p>{item.draft.text}</p>
                <button
                  className="local-review__icon-button"
                  type="button"
                  aria-label={en ? "Remove comment" : "移除意见"}
                  title={en ? "Remove comment" : "移除意见"}
                  onClick={() =>
                    setPending((current) =>
                      current.filter((candidate) => candidate.key !== item.key),
                    )
                  }
                >
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
