import { Code2, MessagesSquare, Network } from "lucide-react";
import type { WorkbenchLayout } from "../../../shared/ui-preferences";
import { useLocale } from "../i18n";

export function LayoutPicker({
  value,
  onChange,
  labels = false,
}: {
  value: WorkbenchLayout;
  onChange(value: WorkbenchLayout): void;
  labels?: boolean;
}) {
  const en = useLocale() === "en";
  return (
    <fieldset className="layout-picker" aria-label={en ? "Workspace layout" : "工作区布局"}>
      {(
        [
          ["chat", MessagesSquare, en ? "Focused chat" : "专注对话"],
          ["code", Code2, en ? "Code workbench" : "代码工作台"],
          ["agents", Network, en ? "Agent collaboration" : "多任务协作"],
        ] as const
      ).map(([mode, Icon, label]) => (
        <button
          type="button"
          key={mode}
          data-layout={mode}
          data-orbit-label={
            labels
              ? mode === "chat"
                ? en
                  ? "Chat"
                  : "对话"
                : mode === "code"
                  ? en
                    ? "Code"
                    : "代码"
                  : en
                    ? "Agents"
                    : "协作"
              : undefined
          }
          title={label}
          aria-label={label}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </fieldset>
  );
}
