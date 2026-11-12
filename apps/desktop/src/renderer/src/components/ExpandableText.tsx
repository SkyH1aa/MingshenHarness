import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { tr } from "../i18n/index";
import { CopyButton } from "./CopyButton";

export function ExpandableText({
  text,
  label,
  preview = typeof text === "string" ? text : "",
  className = "",
  tone,
}: {
  text: string | (() => string);
  label?: string;
  preview?: string;
  className?: string;
  tone?: "error" | undefined;
}) {
  const [open, setOpen] = useState(false);
  const content = useMemo(
    () => (open ? (typeof text === "function" ? text() : text) : ""),
    [open, text],
  );
  return (
    <details
      className={`expandable-text${tone === "error" ? " expandable-text--error" : ""}${className ? ` ${className}` : ""}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary title={open ? tr("收起详情") : tr("展开详情")}>
        <ChevronRight className="expandable-text__chevron" size={14} aria-hidden="true" />
        {label ? <strong className="expandable-text__label">{label}</strong> : null}
        <span className="expandable-text__preview">{preview}</span>
      </summary>
      {open ? (
        <div className="expandable-text__body">
          <div className="expandable-text__actions">
            <CopyButton text={content} label={tr("复制完整内容")} />
          </div>
          <pre>{content}</pre>
        </div>
      ) : null}
    </details>
  );
}
