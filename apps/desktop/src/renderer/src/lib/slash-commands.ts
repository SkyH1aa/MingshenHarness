import type { CustomCommandView, ExtensionView } from "../../../shared/domain";
import { tr } from "../i18n/index";

export const BUILTIN_COMMANDS = [
  "rename",
  "compact",
  "archive",
  "fork",
  "skills",
  "plugins",
  "status",
  "plan",
  "mcp",
  "remember",
  "forget",
  "memory",
] as const;
export type BuiltinCommand = (typeof BUILTIN_COMMANDS)[number];
export interface SlashItem {
  id: string;
  name: string;
  description: string;
  kind: "builtin" | "custom" | "extension" | "manage";
  command?: BuiltinCommand;
  extension?: ExtensionView;
}
const descriptions: Record<BuiltinCommand, string> = {
  rename: "重命名当前聊天",
  compact: "生成摘要，释放上下文空间",
  archive: "归档当前聊天，可在设置中恢复",
  fork: "复制完整上下文，新建独立分支聊天",
  skills: "引用已导入的技能",
  plugins: "引用已导入的插件",
  status: "查看上下文用量与模型信息",
  plan: "切换到只读计划 Agent",
  mcp: "管理 MCP 连接",
  remember: "记住精简信息；明确长期偏好会保存到偏好文件",
  forget: "删除指定记忆 ID 或匹配内容",
  memory: "管理项目记忆，或输入 search / stats",
};

export function parseBuiltinCommand(
  text: string,
): { command: BuiltinCommand; argument: string } | null {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  const command = match?.[1]?.toLowerCase() as BuiltinCommand;
  return BUILTIN_COMMANDS.includes(command)
    ? { command, argument: match?.[2]?.trim() ?? "" }
    : null;
}

export function slashItems(
  draft: string,
  custom: CustomCommandView[],
  extensions: ExtensionView[],
): SlashItem[] | null {
  const reference = /^\/(skills|plugins)\s+([^\n]*)$/i.exec(draft);
  if (reference) {
    const type = reference[1]?.toLowerCase() === "skills" ? "skill" : "plugin";
    const query = reference[2]?.trim().toLocaleLowerCase() ?? "";
    return [
      ...extensions
        .filter(
          (extension) =>
            extension.type === type &&
            extension.enabled &&
            `${extension.name} ${extension.description}`.toLocaleLowerCase().includes(query),
        )
        .map(
          (extension): SlashItem => ({
            id: extension.id,
            name: extension.name,
            description: extension.description,
            kind: "extension",
            extension,
          }),
        ),
      {
        id: "manage-extensions",
        name: tr("管理技能与插件"),
        description: tr("从本地导入、启用或移除扩展"),
        kind: "manage" as const,
      },
    ];
  }
  const match = /^\/([^\s/]*)$/.exec(draft);
  if (!match) return null;
  const query = match[1]?.toLocaleLowerCase() ?? "";
  return [
    ...BUILTIN_COMMANDS.map(
      (command): SlashItem => ({
        id: command,
        name: `/${command}`,
        description: tr(descriptions[command]),
        kind: "builtin",
        command,
      }),
    ),
    ...custom
      .filter((command) => !BUILTIN_COMMANDS.includes(command.name.toLowerCase() as BuiltinCommand))
      .map(
        (command): SlashItem => ({
          id: command.id,
          name: `/${command.name}`,
          description: command.description || tr("自定义命令"),
          kind: "custom",
        }),
      ),
  ].filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(query));
}
