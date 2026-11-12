import type { AgentProfileView } from "../../../shared/domain";
import { tr } from "../i18n/index";

export function agentPurpose(profile: AgentProfileView): string {
  const purposes: Record<string, string> = {
    "code-review": "代码审查 · 只读",
    "review-subagent": "代码审查子任务",
    operations: "运维排障 · 人工确认",
    "operations-subagent": "排障子任务 · 只读",
    creative: "灵感创作",
    brainstorm: "头脑风暴 · 只读",
  };
  if (profile.builtin && purposes[profile.id]) return tr(purposes[profile.id] as string);
  if (profile.role === "plan") return tr("计划 · 只读");
  if (profile.role === "subagent") return tr(profile.readOnly ? "探索 · 只读子任务" : "通用子任务");
  return tr(profile.readOnly ? "只读" : "通用");
}

export function agentLabel(profile: AgentProfileView): string {
  return `${profile.name} · ${agentPurpose(profile)}`;
}

export function agentDescription(profile: AgentProfileView): string {
  if (!profile.builtin) return profile.description || agentPurpose(profile);
  switch (profile.id) {
    case "primary":
      return tr("处理日常任务、编写代码和修改文件，按当前权限执行工具。");
    case "plan":
      return tr("只读分析需求与代码，制定计划；需要执行修改时切换到通用 Agent。");
    case "general":
      return tr("处理多步骤任务，可直接创建会话，也可由主 Agent 委派或通过 @ 调用。");
    case "explore":
      return tr("只读检索文件与梳理代码结构，可直接创建探索会话，也可并行委派。");
    default:
      return tr(profile.description || agentPurpose(profile));
  }
}
