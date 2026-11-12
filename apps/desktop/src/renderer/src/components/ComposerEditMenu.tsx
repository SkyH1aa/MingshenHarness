import { ClipboardPaste, Copy, Scissors, TextSelect } from "lucide-react";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../i18n/index";

export function ComposerEditMenu({
  position,
  textarea,
  onClose,
  onError,
}: {
  position: { x: number; y: number };
  textarea: RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
  onError: (error: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState(position);
  const selected = Boolean(
    textarea.current && textarea.current.selectionStart !== textarea.current.selectionEnd,
  );
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPoint({
      x: Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8)),
    });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = () => onClose();
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [position, onClose]);
  const execute = async (command: "copy" | "cut" | "paste" | "selectAll") => {
    const element = textarea.current;
    onClose();
    if (!element || element.disabled) return;
    element.focus();
    try {
      await window.mingshen.editCommand(command);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return createPortal(
    <div className="session-menu-layer composer-edit-menu-layer">
      <button
        type="button"
        className="session-menu-scrim"
        aria-label={tr("关闭编辑菜单")}
        onClick={() => {
          onClose();
          textarea.current?.focus();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className="session-menu composer-edit-menu"
        role="menu"
        aria-label={tr("编辑菜单")}
        style={{ left: point.x, top: point.y }}
        onKeyDown={(event) => {
          if (["Escape", "Tab"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            textarea.current?.focus();
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
            ];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }
        }}
      >
        {(
          [
            ["cut", Scissors, "剪切", !selected],
            ["copy", Copy, "复制", !selected],
            ["paste", ClipboardPaste, "粘贴", false],
            ["selectAll", TextSelect, "全选", !textarea.current?.value],
          ] as const
        ).map(([command, Icon, label, disabled]) => (
          <button
            key={command}
            role="menuitem"
            type="button"
            disabled={disabled}
            onClick={() => void execute(command)}
          >
            <Icon size={14} aria-hidden="true" />
            {tr(label)}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
