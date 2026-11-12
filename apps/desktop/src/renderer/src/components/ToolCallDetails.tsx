import { Check, ChevronDown, Terminal, XCircle } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { MessagePart } from "../../../shared/domain";
import { tr, useLocale } from "../i18n/index";
import { formatToolArguments } from "../lib/activity-details";
import { CopyButton } from "./CopyButton";

type ToolCall = Extract<MessagePart, { type: "tool_call" }>;

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const ToolCallDetails = memo(function ToolCallDetails({
  toolCall,
  output,
  isError,
  orbit,
}: {
  toolCall: ToolCall;
  output: string | undefined;
  isError: boolean | undefined;
  orbit: boolean;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const { command, target } = useMemo(() => {
    const parsed = parseArguments(toolCall.arguments);
    const command = typeof parsed.command === "string" ? parsed.command : "";
    return {
      command,
      target: command || (typeof parsed.path === "string" ? parsed.path : ""),
    };
  }, [toolCall.arguments]);
  const formatted = useMemo(
    () => (open ? formatToolArguments(toolCall.arguments) : ""),
    [open, toolCall.arguments],
  );
  const hasResult = output !== undefined;
  const status = hasResult ? (isError ? "failed" : "completed") : "requested";

  return (
    <details
      className={`${
        isError ? "tool-call tool-call--error" : "tool-call tool-call--expanded"
      }${orbit ? " orbit-execution-step" : ""}`}
      data-status={orbit ? status : undefined}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {orbit ? (
          <>
            <span className="orbit-execution-node" aria-hidden="true">
              {hasResult ? (
                isError ? (
                  <XCircle size={13} />
                ) : (
                  <Check size={13} />
                )
              ) : (
                <Terminal size={13} />
              )}
            </span>
            <span className="orbit-execution-label">
              <strong>{toolCall.name}</strong>
              {target ? <code>{target}</code> : null}
            </span>
          </>
        ) : (
          <>
            <Terminal aria-hidden="true" size={13} />
            <code>{toolCall.name}</code>
          </>
        )}
        <span className={orbit ? "orbit-execution-state" : undefined}>
          {hasResult
            ? isError
              ? tr("\u5931\u8D25")
              : tr("\u5B8C\u6210")
            : tr("\u5DF2\u8BF7\u6C42")}
        </span>
        <ChevronDown className="tool-call__chevron" aria-hidden="true" size={14} />
      </summary>
      {open ? (
        <div className="tool-call__body">
          {command ? (
            <section>
              <header className="tool-call__section-heading">
                <strong>{tr("\u547D\u4EE4")}</strong>
                <CopyButton text={command} label={tr("复制完整内容")} />
              </header>
              <pre>{command}</pre>
            </section>
          ) : null}
          <section>
            <header className="tool-call__section-heading">
              <strong>{tr("\u53C2\u6570")}</strong>
              <CopyButton text={formatted} label={tr("复制完整内容")} />
            </header>
            <pre>{formatted}</pre>
          </section>
          {hasResult ? (
            <section>
              <header className="tool-call__section-heading">
                <strong>{tr("\u8F93\u51FA")}</strong>
                <CopyButton text={output} label={tr("复制完整内容")} />
              </header>
              <pre>{output}</pre>
            </section>
          ) : null}
        </div>
      ) : null}
    </details>
  );
});
