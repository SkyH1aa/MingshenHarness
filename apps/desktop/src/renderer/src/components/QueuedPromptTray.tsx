import {
  AlertTriangle,
  Check,
  Clock3,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  Pencil,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  MAX_QUEUED_PROMPTS,
  type QueuedPromptConfigurationField,
  type QueuedPromptContinueResult,
  type QueuedPromptView,
} from "../../../shared/queued-prompt";
import { tr } from "../i18n/index";

interface QueuedPromptTrayProps {
  items: QueuedPromptView[];
  onResume: (itemId: string) => Promise<QueuedPromptContinueResult>;
  onUpdate: (itemId: string, text: string) => Promise<void>;
  onRemove: (itemId: string) => Promise<void>;
  onReplaceAttachments: (itemId: string, text: string, files: File[]) => Promise<void>;
  onBeginEdit: (itemId: string) => Promise<string>;
  onEndEdit: (editId: string, abandon?: boolean) => Promise<void>;
}

interface QueueHold {
  token: string;
  itemId: string;
  kind: "edit" | "replace";
  text: string;
  endEdit: (editId: string, abandon?: boolean) => Promise<void>;
}

const CONFIGURATION_LABELS: Record<QueuedPromptConfigurationField, string> = {
  agentMode: "Agent 模式",
  workspacePath: "工作目录",
  agentProfileId: "Agent 配置",
  providerId: "供应商",
  modelId: "模型",
  permissionMode: "权限模式",
  approvalMode: "审批模式",
  executionMode: "执行环境",
};

const RESUME_BLOCKERS = new Set<string>([
  "session_missing",
  "session_archived",
  "session_busy",
  "dispatch_pending",
  "configuration_changed",
]);

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

function effectiveBlocker(item: QueuedPromptView): string {
  if (item.changedConfigurationFields.length) return "configuration_changed";
  return item.continuationBlocker ?? "";
}

function blockerText(item: QueuedPromptView): string | null {
  if (item.changedConfigurationFields.length) {
    return tr("配置已变化：{0}。请删除后重新加入下一轮。", [
      item.changedConfigurationFields.map((field) => tr(CONFIGURATION_LABELS[field])).join("、"),
    ]);
  }
  const blocker = effectiveBlocker(item);
  if (blocker === "dispatch_pending") {
    return tr("已派发或结果待确认，不能重复发送。");
  }
  if (blocker === "session_archived") {
    return tr("会话已归档。请先恢复会话，再处理队列消息。");
  }
  if (blocker === "session_missing") {
    return tr("会话不存在。");
  }
  if (blocker === "editing") {
    return tr("正在编辑此消息。保存或取消后可恢复自动发送。");
  }
  return null;
}

function pauseStatus(item: QueuedPromptView, editingActive: boolean): string | null {
  switch (item.automaticPauseReason) {
    case "stopped":
      return tr("当前任务已停止，队列已暂停。");
    case "failed":
      return tr("当前任务运行失败，队列已暂停。");
    case "restarted":
      return tr("应用重启后队列已暂停。");
    case "editing":
      return editingActive ? tr("正在编辑，队列已暂停。") : tr("编辑已结束，队列保持暂停。");
    case "send_failed":
      return tr("自动发送失败，队列已暂停。");
    default:
      return null;
  }
}

function queueStatus(item: QueuedPromptView, editingActive: boolean): string {
  const paused = pauseStatus(item, editingActive);
  if (paused) return paused;
  if (
    item.continuationBlocker === "dispatch_pending" &&
    (item.automaticError || item.dispatchState === "accepted")
  )
    return tr("派发记录待确认，队列已暂停。");
  if (item.dispatchState) return tr("正在自动发送队列消息。");
  if (item.continuationBlocker === "session_busy" || item.continuationBlocker === "waiting_turn") {
    return tr("当前任务完成后自动发送下一条。");
  }
  if (
    item.changedConfigurationFields.length ||
    RESUME_BLOCKERS.has(String(item.continuationBlocker ?? ""))
  ) {
    return tr("队列已暂停，请先处理下方提示。");
  }
  return tr("队列消息将按顺序自动发送。");
}

export function QueuedPromptTray({
  items,
  onResume,
  onUpdate,
  onRemove,
  onReplaceAttachments,
  onBeginEdit,
  onEndEdit,
}: QueuedPromptTrayProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<
    "edit" | "replace" | "remove" | "save" | "resume" | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const holdRef = useRef<QueueHold | null>(null);
  const replacementRef = useRef<QueueHold | null>(null);
  const replacementCancelHandledRef = useRef(false);
  const replacementCancelRequestedRef = useRef(false);
  const replacementFocusTimerRef = useRef<number | null>(null);
  const actionInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const queueSessionId = items[0]?.sessionId ?? null;
  const queueSessionIdRef = useRef(queueSessionId);

  useEffect(() => {
    if (editingId) editTextareaRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (replacementFocusTimerRef.current !== null)
        window.clearTimeout(replacementFocusTimerRef.current);
      replacementFocusTimerRef.current = null;
      const hold = holdRef.current;
      holdRef.current = null;
      replacementRef.current = null;
      if (hold) void hold.endEdit(hold.token, true).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const previousSessionId = queueSessionIdRef.current;
    if (previousSessionId === queueSessionId) return;
    queueSessionIdRef.current = queueSessionId;

    const hold = holdRef.current;
    if (replacementFocusTimerRef.current !== null)
      window.clearTimeout(replacementFocusTimerRef.current);
    replacementFocusTimerRef.current = null;
    replacementCancelHandledRef.current = false;
    replacementCancelRequestedRef.current = false;
    holdRef.current = null;
    replacementRef.current = null;
    setEditingId(null);
    setEditingText("");
    setReplacementId(null);
    if (hold) void hold.endEdit(hold.token, true).catch(() => undefined);
  }, [queueSessionId]);

  const releaseHold = async (hold: QueueHold, abandon: boolean): Promise<void> => {
    await hold.endEdit(hold.token, abandon);
    if (holdRef.current?.token === hold.token) holdRef.current = null;
    if (replacementRef.current?.token === hold.token) replacementRef.current = null;
  };

  const run = async (
    itemId: string,
    kind: "edit" | "replace" | "remove" | "save" | "resume",
    action: () => Promise<void>,
  ): Promise<boolean> => {
    if (actionInFlightRef.current || !mountedRef.current) return false;
    actionInFlightRef.current = true;
    setBusyId(itemId);
    setBusyKind(kind);
    setError(null);
    setNotice(null);
    try {
      await action();
      return true;
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      actionInFlightRef.current = false;
      if (mountedRef.current) {
        setBusyId(null);
        setBusyKind(null);
      }
    }
  };

  const beginEdit = async (item: QueuedPromptView): Promise<void> => {
    if (holdRef.current || editingId || replacementId) return;
    const requestedSessionId = queueSessionIdRef.current;
    const endEdit = onEndEdit;
    await run(item.id, "edit", async () => {
      const token = await onBeginEdit(item.id);
      if (!token.trim()) throw new Error(tr("无法锁定队列消息，请重试。"));
      if (!mountedRef.current || queueSessionIdRef.current !== requestedSessionId) {
        void endEdit(token, true).catch(() => undefined);
        return;
      }
      const hold: QueueHold = {
        token,
        itemId: item.id,
        kind: "edit",
        text: item.text,
        endEdit,
      };
      holdRef.current = hold;
      setEditingId(item.id);
      setEditingText(item.text);
    });
  };

  const saveEdit = async (item: QueuedPromptView): Promise<void> => {
    const hold = holdRef.current;
    if (hold?.kind !== "edit" || hold.itemId !== item.id) {
      setError(tr("编辑锁已失效，请取消后重新编辑。"));
      return;
    }
    if (!editingText.trim() && item.attachments.length === 0) {
      setError(tr("队列消息和附件不能同时为空。"));
      return;
    }
    await run(item.id, "save", async () => {
      await onUpdate(item.id, editingText);
      await releaseHold(hold, false);
      if (!mountedRef.current) return;
      setEditingId(null);
      setEditingText("");
      setNotice(tr("修改已保存。"));
    });
  };

  const cancelEdit = async (): Promise<void> => {
    const hold = holdRef.current;
    if (hold?.kind !== "edit") {
      setEditingId(null);
      setEditingText("");
      return;
    }
    await run(hold.itemId, "save", async () => {
      await releaseHold(hold, false);
      if (!mountedRef.current) return;
      setEditingId(null);
      setEditingText("");
      setNotice(tr("已取消编辑并保留原消息。"));
    });
  };

  const cancelReplacementSelection = async (): Promise<void> => {
    const hold = replacementRef.current;
    if (!hold) {
      replacementCancelRequestedRef.current = false;
      return;
    }
    if (actionInFlightRef.current) {
      replacementCancelRequestedRef.current = true;
      return;
    }
    replacementCancelRequestedRef.current = false;
    await run(hold.itemId, "replace", async () => {
      await releaseHold(hold, false);
      if (!mountedRef.current) return;
      setReplacementId(null);
      setNotice(tr("已取消附件替换并保留原附件。"));
    });
  };

  const chooseReplacementFiles = async (item: QueuedPromptView): Promise<void> => {
    if (holdRef.current || editingId || replacementId || actionInFlightRef.current) return;
    const requestedSessionId = queueSessionIdRef.current;
    const endEdit = onEndEdit;
    replacementCancelHandledRef.current = false;
    replacementCancelRequestedRef.current = false;
    await run(item.id, "replace", async () => {
      const token = await onBeginEdit(item.id);
      if (!token.trim()) throw new Error(tr("无法锁定队列消息，请重试。"));
      const hold: QueueHold = {
        token,
        itemId: item.id,
        kind: "replace",
        text: item.text,
        endEdit,
      };
      if (!mountedRef.current || queueSessionIdRef.current !== requestedSessionId) {
        void endEdit(token, true).catch(() => undefined);
        return;
      }
      holdRef.current = hold;
      replacementRef.current = hold;
      setReplacementId(item.id);
      const input = replaceInputRef.current;
      if (!input) {
        await releaseHold(hold, false);
        setReplacementId(null);
        throw new Error(tr("无法打开附件选择器。"));
      }
      input.value = "";
      input.click();
    });
  };

  const replaceFiles = async (files: File[]): Promise<void> => {
    const hold = replacementRef.current;
    if (!hold) return;
    if (!files.length) {
      await cancelReplacementSelection();
      return;
    }
    await run(hold.itemId, "replace", async () => {
      let actionError: unknown;
      let replaced = false;
      let released = false;
      try {
        await onReplaceAttachments(hold.itemId, hold.text, files);
        replaced = true;
      } catch (cause) {
        actionError = cause;
      }
      try {
        await releaseHold(hold, !replaced);
        released = true;
      } catch (cause) {
        actionError =
          actionError === undefined
            ? cause
            : new Error(
                `${actionError instanceof Error ? actionError.message : String(actionError)}；${cause instanceof Error ? cause.message : String(cause)}`,
              );
      }
      if (mountedRef.current) {
        if (released) setReplacementId(null);
        if (replaced && actionError === undefined) setNotice(tr("附件已替换。"));
        else if (!replaced && released) setNotice(tr("附件未替换，队列已暂停，请处理后恢复。"));
      }
      if (actionError !== undefined) throw actionError;
    });
  };

  const handleReplacementCancel = (): void => {
    replacementCancelHandledRef.current = true;
    replacementCancelRequestedRef.current = true;
    if (replacementFocusTimerRef.current !== null)
      window.clearTimeout(replacementFocusTimerRef.current);
    replacementFocusTimerRef.current = null;
    if (replaceInputRef.current) replaceInputRef.current.value = "";
    void cancelReplacementSelection();
  };

  useEffect(() => {
    const input = replaceInputRef.current;
    if (!input) return;
    input.addEventListener("cancel", handleReplacementCancel);
    return () => input.removeEventListener("cancel", handleReplacementCancel);
  });

  useEffect(() => {
    const releaseCanceledReplacement = () => {
      if (replacementFocusTimerRef.current !== null)
        window.clearTimeout(replacementFocusTimerRef.current);
      replacementFocusTimerRef.current = window.setTimeout(() => {
        replacementFocusTimerRef.current = null;
        const hold = replacementRef.current;
        if (!hold || replacementCancelHandledRef.current) return;
        const input = replaceInputRef.current;
        if (input?.files?.length) return;
        void cancelReplacementSelection();
      }, 250);
    };
    window.addEventListener("focus", releaseCanceledReplacement);
    return () => {
      window.removeEventListener("focus", releaseCanceledReplacement);
      if (replacementFocusTimerRef.current !== null)
        window.clearTimeout(replacementFocusTimerRef.current);
      replacementFocusTimerRef.current = null;
    };
  });

  useEffect(() => {
    if (
      !actionInFlightRef.current &&
      replacementCancelRequestedRef.current &&
      replacementRef.current
    )
      void cancelReplacementSelection();
  });

  const resumeQueue = async (item: QueuedPromptView): Promise<void> => {
    await run(item.id, "resume", async () => {
      const result = await onResume(item.id);
      if (!mountedRef.current) return;
      if (result.cleanupWarning) {
        setNotice(tr("任务已启动，但队列记录待清理：{0}", [result.cleanupWarning]));
      } else {
        setNotice(tr("已恢复自动发送。"));
      }
    });
  };

  if (!items.length) {
    if (!notice && !error) return null;
    return (
      <section
        className="queued-prompts queued-prompts--status"
        data-testid="queued-prompt-status"
        aria-label={tr("下一轮队列")}
        aria-live="polite"
      >
        {notice ? (
          <p className="queued-prompts__notice" data-testid="queued-prompt-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="queued-prompts__error" data-testid="queued-prompt-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  const head = items[0];
  if (!head) return null;
  const pauseReason = head.automaticPauseReason;
  const paused = Boolean(pauseReason);
  const editingActive = Boolean(editingId || replacementId);
  const showResume = paused && (pauseReason !== "editing" || !editingActive);
  const resumeBlocked =
    Boolean(busyId || editingId || replacementId) ||
    head.changedConfigurationFields.length > 0 ||
    RESUME_BLOCKERS.has(String(head.continuationBlocker ?? ""));
  const statusTone =
    pauseReason === "failed" || pauseReason === "send_failed"
      ? "danger"
      : pauseReason === "stopped" || pauseReason === "restarted"
        ? "warning"
        : pauseReason === "editing"
          ? editingActive
            ? "accent"
            : "warning"
          : "muted";
  const resumeTitle = resumeBlocked
    ? (blockerText(head) ?? tr("当前不能恢复自动队列。"))
    : tr("恢复自动发送");

  return (
    <section
      className="queued-prompts"
      data-testid="queued-prompt-tray"
      data-busy={busyId ? "true" : "false"}
      data-auto-pause-reason={pauseReason ?? "none"}
      aria-label={tr("下一轮队列")}
      aria-live="polite"
      aria-busy={Boolean(busyId)}
    >
      <input
        ref={replaceInputRef}
        className="visually-hidden"
        type="file"
        multiple
        data-testid="queued-prompt-replace-input"
        aria-label={tr("替换队列附件")}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void replaceFiles(files);
        }}
      />
      <header className="queued-prompts__header">
        <span className="queued-prompts__title">
          <Clock3 aria-hidden="true" size={14} />
          <strong>{tr("下一轮队列")}</strong>
          <code data-testid="queued-prompt-count">
            {items.length}/{MAX_QUEUED_PROMPTS}
          </code>
        </span>
        <div className="queued-prompts__header-actions">
          <span
            className={`queued-prompts__status queued-prompts__status--${statusTone}`}
            data-testid="queued-prompt-auto-status"
            title={head.automaticError ?? undefined}
          >
            {queueStatus(head, editingActive)}
          </span>
          {showResume ? (
            <button
              className="queued-prompts__resume"
              type="button"
              data-testid="queued-prompt-resume"
              title={resumeTitle}
              disabled={resumeBlocked}
              onClick={() => void resumeQueue(head)}
            >
              {busyId === head.id && busyKind === "resume" ? (
                <LoaderCircle className="spin" aria-hidden="true" size={12} />
              ) : (
                <Play aria-hidden="true" size={12} />
              )}
              <span>{tr("恢复自动发送")}</span>
            </button>
          ) : null}
        </div>
      </header>
      {head.automaticError ? (
        <p
          className="queued-prompts__auto-error"
          data-testid="queued-prompt-auto-error"
          role="status"
        >
          {head.automaticError}
        </p>
      ) : null}
      <div className="queued-prompts__items">
        {items.map((item, index) => {
          const editing = editingId === item.id;
          const replacing = replacementId === item.id;
          const blocker =
            item.continuationBlocker === "editing" && !editing && !replacing
              ? null
              : blockerText(item);
          const dispatching = item.dispatchState === "sending";
          const pendingDispatch = item.continuationBlocker === "dispatch_pending";
          const itemBusy = busyId === item.id;
          const held = Boolean(editing || replacing);
          const actionDisabled =
            Boolean(busyId) ||
            dispatching ||
            pendingDispatch ||
            Boolean((editingId || replacementId) && !held);
          const blockerCode = effectiveBlocker(item);
          return (
            <article
              className="queued-prompt-item"
              data-testid="queued-prompt-item"
              data-queue-item-id={item.id}
              data-dispatch-state={item.dispatchState ?? "idle"}
              data-continuation-blocker={blockerCode}
              data-configuration-fields={item.changedConfigurationFields.join(",")}
              data-can-continue={item.canContinue ? "true" : "false"}
              data-editing={editing ? "true" : "false"}
              aria-busy={itemBusy || dispatching || pendingDispatch}
              key={item.id}
            >
              <div className="queued-prompt-item__main">
                <span className="queued-prompt-item__order">{index + 1}</span>
                <div className="queued-prompt-item__copy">
                  {editing ? (
                    <textarea
                      ref={editTextareaRef}
                      value={editingText}
                      rows={3}
                      data-testid="queued-prompt-edit-input"
                      aria-label={tr("编辑队列消息")}
                      disabled={Boolean(busyId)}
                      onChange={(event) => setEditingText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          void cancelEdit();
                        }
                        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          void saveEdit(item);
                        }
                      }}
                    />
                  ) : (
                    <p title={item.text}>{item.text || tr("仅附件")}</p>
                  )}
                  {item.attachments.length ? (
                    <div className="queued-prompt-item__attachments">
                      {item.attachments.map((attachment) => (
                        <span
                          key={`${attachment.name}:${attachment.size}`}
                          title={`${attachment.name} · ${formatBytes(attachment.size)}`}
                        >
                          <Paperclip aria-hidden="true" size={11} />
                          {attachment.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.temporaryInstruction ? (
                    <span
                      className="queued-prompt-item__temporary-instruction"
                      data-testid="queued-prompt-temporary-instruction"
                      title={tr("临时指令：{0}", [item.temporaryInstruction])}
                      aria-label={tr("含临时指令：{0}", [item.temporaryInstruction])}
                      role="note"
                    >
                      <MessageSquareText aria-hidden="true" size={11} />
                      {tr("含临时指令")}
                    </span>
                  ) : null}
                  {blocker ? (
                    <p
                      className="queued-prompt-item__warning"
                      data-testid="queued-prompt-blocker"
                      data-blocker={blockerCode}
                    >
                      <AlertTriangle aria-hidden="true" size={12} />
                      {blocker}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="queued-prompt-item__actions">
                {editing ? (
                  <>
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      data-testid="queued-prompt-save"
                      aria-label={tr("保存队列消息")}
                      title={tr("保存队列消息")}
                      disabled={Boolean(busyId)}
                      onClick={() => void saveEdit(item)}
                    >
                      {itemBusy && busyKind === "save" ? (
                        <LoaderCircle className="spin" aria-hidden="true" size={13} />
                      ) : (
                        <Check aria-hidden="true" size={13} />
                      )}
                    </button>
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      data-testid="queued-prompt-cancel"
                      aria-label={tr("取消编辑")}
                      title={tr("取消编辑")}
                      disabled={Boolean(busyId)}
                      onClick={() => void cancelEdit()}
                    >
                      <X aria-hidden="true" size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      data-testid="queued-prompt-edit"
                      aria-label={tr("编辑队列消息")}
                      title={tr("编辑队列消息")}
                      disabled={actionDisabled}
                      onClick={() => void beginEdit(item)}
                    >
                      {itemBusy && busyKind === "edit" ? (
                        <LoaderCircle className="spin" aria-hidden="true" size={13} />
                      ) : (
                        <Pencil aria-hidden="true" size={13} />
                      )}
                    </button>
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      data-testid="queued-prompt-replace-attachments"
                      aria-label={tr("替换队列附件")}
                      title={tr("替换队列附件")}
                      disabled={actionDisabled}
                      onClick={() => void chooseReplacementFiles(item)}
                    >
                      {itemBusy && busyKind === "replace" ? (
                        <LoaderCircle className="spin" aria-hidden="true" size={13} />
                      ) : (
                        <Paperclip aria-hidden="true" size={13} />
                      )}
                    </button>
                    <button
                      className="icon-button icon-button--small queued-prompt-item__delete"
                      type="button"
                      data-testid="queued-prompt-delete"
                      aria-label={tr("删除队列消息")}
                      title={tr("删除队列消息")}
                      disabled={Boolean(busyId) || Boolean(editingId || replacementId)}
                      onClick={() => void run(item.id, "remove", () => onRemove(item.id))}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {notice ? (
        <p className="queued-prompts__notice" data-testid="queued-prompt-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="queued-prompts__error" data-testid="queued-prompt-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
