import { RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { MemoryDocument, ProjectMemoryView } from "../../../shared/project-memory";
import { tr } from "../i18n/index";
import { useDialog } from "./DialogProvider";

function memoryError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("Memory changed on disk"))
    return tr("记忆文件已被其他来源修改。请复制保留草稿，刷新后重新编辑；本次未覆盖磁盘内容。");
  return tr(message.replace(/^Error invoking remote method '[^']+': Error: /, ""));
}

export function ProjectDiarySettings({
  sessionId,
  readOnly,
  onDirtyChange,
}: {
  sessionId: string;
  readOnly: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [view, setView] = useState<ProjectMemoryView | null>(null);
  const [document, setDocument] = useState<MemoryDocument | "index">("preferences");
  const [drafts, setDrafts] = useState({ preferences: "", memory: "" });
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { confirm } = useDialog();
  const structured = view?.backend === "tencentdb";
  const load = useCallback(async () => {
    const next = await window.mingshen.getProjectMemory(sessionId);
    setView(next);
    setDrafts({ preferences: next.documents.preferences, memory: next.documents.memory });
  }, [sessionId]);
  useEffect(() => {
    let active = true;
    void window.mingshen
      .getProjectMemory(sessionId)
      .then((next) => {
        if (active) {
          setView(next);
          setDrafts({ preferences: next.documents.preferences, memory: next.documents.memory });
        }
      })
      .catch((cause) => {
        if (active) setError(memoryError(cause));
      });
    return () => {
      active = false;
    };
  }, [sessionId]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(memoryError(cause));
    } finally {
      setBusy(false);
    }
  };
  const dirty = Boolean(
    view &&
      (drafts.preferences !== view.documents.preferences ||
        drafts.memory !== view.documents.memory),
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const refresh = () =>
    act(async () => {
      if (
        dirty &&
        !(await confirm({
          title: tr("放弃未保存的记忆修改？"),
          description: tr("刷新将重新读取磁盘中的项目记忆。"),
          confirmLabel: tr("刷新"),
        }))
      )
        return;
      await load();
    });
  return (
    <section
      className="settings-block project-diary"
      aria-labelledby="project-diary-title"
      data-unsaved={dirty}
    >
      <div className="settings-block__heading">
        <div>
          <h3 id="project-diary-title">{tr("项目记忆")}</h3>
          <p>
            {structured
              ? `TencentDB Agent Memory · ${view?.frameworkVersion ?? ""} · ${tr("本地记忆库")}`
              : tr("精简偏好常驻，历史日记按需检索。短期上下文不写入日记。")}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={tr("刷新记忆")}
          title={tr("刷新记忆")}
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
      {view ? (
        <>
          <label className="toggle-row">
            <span>{tr("启用此项目的自动记忆")}</span>
            <input
              type="checkbox"
              checked={view.enabled}
              disabled={busy || readOnly}
              onChange={(event) => {
                const enabled = event.target.checked;
                void act(async () => {
                  await window.mingshen.setProjectMemoryEnabled(sessionId, enabled);
                  setView({ ...view, enabled });
                });
              }}
            />
          </label>
          <code className="settings-path">{view.root}</code>
          <p className="quiet-copy">
            {tr("偏好 {0} · 记忆 {1} · 归档 {2} · {3} KiB", [
              String(view.preferences),
              String(view.memories),
              String(view.archives),
              (view.bytes / 1024).toFixed(1),
            ])}
          </p>
          {readOnly ? (
            <p className="quiet-copy">{tr("子 Agent 仅可读取记忆，请在主会话管理。")}</p>
          ) : null}
          <div className="provider-detail-tabs" role="tablist" aria-label={tr("记忆文件")}>
            {(["preferences", "memory", "index"] as const).map((item) => (
              <button
                type="button"
                role="tab"
                id={`memory-tab-${item}`}
                aria-controls="memory-document-panel"
                aria-selected={document === item}
                key={item}
                onClick={() => setDocument(item)}
              >
                {tr(
                  item === "preferences"
                    ? "工作偏好"
                    : item === "memory"
                      ? structured
                        ? "结构化记忆"
                        : "长期日记"
                      : "记忆索引",
                )}
                {item !== "index" && view.documents[item] !== drafts[item] ? " *" : ""}
              </button>
            ))}
          </div>
          <div
            className="field"
            id="memory-document-panel"
            role="tabpanel"
            aria-labelledby={`memory-tab-${document}`}
          >
            <label className="field-label" htmlFor="memory-document">
              {structured
                ? document === "index"
                  ? "records.jsonl"
                  : `records.jsonl · ${document} (JSON)`
                : `${document}.md`}
            </label>
            {structured && document !== "index" && !readOnly ? (
              <p className="quiet-copy" id="memory-edit-format">
                {tr("可修改 content 或移除记录；保留 id 和 type，新增使用 /remember。")}
              </p>
            ) : null}
            <textarea
              id="memory-document"
              className="memory-document"
              aria-describedby={
                structured && document !== "index" && !readOnly ? "memory-edit-format" : undefined
              }
              value={document === "index" ? view.documents.index : drafts[document]}
              readOnly={readOnly || document === "index"}
              disabled={busy}
              spellCheck={false}
              onChange={(event) => {
                if (document !== "index") setDrafts({ ...drafts, [document]: event.target.value });
              }}
            />
          </div>
          {document !== "index" && !readOnly ? (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy || view.documents[document] === drafts[document]}
              onClick={() =>
                void act(async () => {
                  await window.mingshen.editProjectMemory({
                    sessionId,
                    document,
                    content: drafts[document],
                    revision: view.revisions[document],
                  });
                  const next = await window.mingshen.getProjectMemory(sessionId);
                  const other = document === "preferences" ? "memory" : "preferences";
                  // One Tencent snapshot backs both tabs. Adopt our own new revision
                  // only when the other tab's disk content did not change externally.
                  setView(
                    next.documents[other] === view.documents[other]
                      ? next
                      : {
                          ...next,
                          documents: { ...next.documents, [other]: view.documents[other] },
                          revisions: { ...next.revisions, [other]: view.revisions[other] },
                        },
                  );
                  setDrafts((current) => ({ ...current, [document]: next.documents[document] }));
                  setNotice(tr("记忆已保存"));
                })
              }
            >
              <Save size={15} aria-hidden="true" />
              {tr("保存记忆")}
            </button>
          ) : null}
          <div className="memory-search field">
            <label htmlFor="memory-query">{tr("搜索记忆 / 输入要删除的记忆 ID")}</label>
            <input
              id="memory-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={500}
            />
            <button
              type="button"
              className="icon-button"
              disabled={busy || !query.trim()}
              aria-label={tr("搜索记忆")}
              title={tr("搜索记忆")}
              onClick={() =>
                void act(async () => {
                  setResult(
                    await window.mingshen.projectMemoryCommand(
                      sessionId,
                      `/memory search ${query}`,
                    ),
                  );
                })
              }
            >
              <Search size={16} aria-hidden="true" />
            </button>
            {!readOnly ? (
              <button
                type="button"
                className="icon-button"
                disabled={busy || !query.trim()}
                aria-label={tr("删除匹配的记忆")}
                title={tr("删除匹配的记忆")}
                onClick={() =>
                  void act(async () => {
                    if (
                      !(await confirm({
                        title: tr("删除项目记忆？"),
                        description: query,
                        confirmLabel: tr("删除"),
                        tone: "danger",
                      }))
                    )
                      return;
                    if (dirty) throw new Error(tr("请先保存或刷新未保存的修改。"));
                    setResult(
                      await window.mingshen.projectMemoryCommand(sessionId, `/forget ${query}`),
                    );
                    await load();
                  })
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {result ? <pre className="memory-search-result">{result}</pre> : null}
        </>
      ) : (
        <p className="quiet-copy">{tr("正在读取项目记忆…")}</p>
      )}
      {notice ? (
        <p role="status" className="quiet-copy">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
