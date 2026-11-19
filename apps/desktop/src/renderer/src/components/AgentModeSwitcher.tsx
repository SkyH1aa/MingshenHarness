import { Braces, BriefcaseBusiness, MessageCircle } from "lucide-react";
import type { AgentMode } from "../../../shared/domain";
import { useLocale } from "../i18n";

interface AgentModeSwitcherProps {
  value: AgentMode;
  running?: boolean;
  onChange: (mode: AgentMode) => void;
}

const MODES = [
  {
    value: "code",
    short: "Code",
    zh: "CodeAgent",
    en: "CodeAgent",
    icon: Braces,
  },
  {
    value: "work",
    short: "Work",
    zh: "WorkAgent",
    en: "WorkAgent",
    icon: BriefcaseBusiness,
  },
  {
    value: "chat",
    short: "Chat",
    zh: "ChatAgent",
    en: "ChatAgent",
    icon: MessageCircle,
  },
] as const;

export function AgentModeSwitcher({ value, running = false, onChange }: AgentModeSwitcherProps) {
  const en = useLocale() === "en";
  return (
    <nav
      className="agent-mode-switcher"
      aria-label={en ? "Agent mode" : "Agent 模式"}
      data-testid="agent-mode-switcher"
    >
      {MODES.map((mode) => {
        const Icon = mode.icon;
        const selected = value === mode.value;
        const locked = running && !selected;
        return (
          <button
            type="button"
            key={mode.value}
            className="agent-mode-switcher__mode"
            aria-pressed={selected}
            aria-label={en ? mode.en : mode.zh}
            title={
              locked
                ? en
                  ? "Stop the current task before switching Agent modes."
                  : "请先停止当前任务，再切换 Agent 模式。"
                : en
                  ? mode.en
                  : mode.zh
            }
            data-agent-mode={mode.value}
            data-testid={`agent-mode-${mode.value}`}
            disabled={locked}
            onClick={() => {
              if (!selected) onChange(mode.value);
            }}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{en ? mode.short : mode.zh}</span>
          </button>
        );
      })}
    </nav>
  );
}
