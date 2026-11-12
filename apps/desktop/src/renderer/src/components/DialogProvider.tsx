import { AlertTriangle, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { tr } from "../i18n/index";

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

interface DialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const settle = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setDialog(null);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setDialog(options);
    });
  }, []);

  useEffect(() => {
    if (!dialog) {
      return;
    }
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialog, settle]);

  return (
    <DialogContext.Provider value={{ confirm }}>
      {children}
      {dialog
        ? createPortal(
            <div className="mingshen-dialog-backdrop">
              <button
                className="mingshen-dialog-backdrop__dismiss"
                type="button"
                aria-label={tr("\u5173\u95ED\u5BF9\u8BDD\u6846")}
                onClick={() => settle(false)}
              />

              <section
                className="mingshen-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="mingshen-dialog-title"
                aria-describedby="mingshen-dialog-description"
              >
                <header className="mingshen-dialog__header">
                  <span
                    className={
                      dialog.tone === "danger"
                        ? "mingshen-dialog__icon mingshen-dialog__icon--danger"
                        : "mingshen-dialog__icon"
                    }
                    aria-hidden="true"
                  >
                    <AlertTriangle size={17} />
                  </span>
                  <div>
                    <h2 id="mingshen-dialog-title">{dialog.title}</h2>
                    <p id="mingshen-dialog-description">{dialog.description}</p>
                  </div>
                  <button
                    className="icon-button icon-button--small"
                    type="button"
                    aria-label={tr("\u5173\u95ED\u5BF9\u8BDD\u6846")}
                    onClick={() => settle(false)}
                  >
                    <X aria-hidden="true" size={15} />
                  </button>
                </header>
                <footer className="mingshen-dialog__actions">
                  <button
                    ref={cancelRef}
                    className="btn btn--secondary"
                    type="button"
                    onClick={() => settle(false)}
                  >
                    {dialog.cancelLabel ?? tr("\u53D6\u6D88")}
                  </button>
                  <button
                    className={
                      dialog.tone === "danger" ? "btn btn--danger-solid" : "btn btn--primary"
                    }
                    type="button"
                    onClick={() => settle(true)}
                  >
                    {dialog.confirmLabel ?? tr("\u786E\u5B9A")}
                  </button>
                </footer>
              </section>
            </div>,
            document.body,
          )
        : null}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const value = useContext(DialogContext);
  if (!value) {
    throw new Error("useDialog must be used inside DialogProvider.");
  }
  return value;
}
