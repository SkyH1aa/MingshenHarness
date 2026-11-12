import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../i18n/index";

export function RenameSessionDialog({
  title: initialTitle,
  onClose,
  onSave,
}: {
  title: string;
  onClose: () => void;
  onSave: (title: string) => Promise<unknown>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    input.current?.select();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div className="mingshen-dialog-backdrop">
      <button
        type="button"
        className="mingshen-dialog-backdrop__dismiss"
        aria-label={tr("关闭对话框")}
        disabled={busy}
        onClick={onClose}
      />
      <form
        ref={form}
        className="mingshen-dialog session-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-rename-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            const items = [
              ...(form.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled)",
              ) ?? []),
            ];
            if (event.shiftKey && document.activeElement === items[0]) {
              event.preventDefault();
              items.at(-1)?.focus();
            } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
              event.preventDefault();
              items[0]?.focus();
            }
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !title.trim()) return;
          setBusy(true);
          setError("");
          void onSave(title.trim())
            .then(onClose)
            .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
            .finally(() => setBusy(false));
        }}
      >
        <header className="session-rename-dialog__heading">
          <h2 id="composer-rename-title">{tr("重命名会话")}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={tr("关闭")}
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <label className="field">
          <span>{tr("会话名称")}</span>
          <input
            ref={input}
            value={title}
            maxLength={120}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="mingshen-dialog__actions">
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={onClose}>
            {tr("取消")}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !title.trim()}>
            {tr("保存")}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
