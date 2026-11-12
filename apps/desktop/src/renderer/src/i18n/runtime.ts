import { localizeError } from "../../../shared/localized-errors";
import { getLocale, tr } from "./index";

// Translate only application-authored activity labels, never model or user content.
const prefixes: Array<[string, string]> = [
  ["正在", "Working: "],
  ["准备编辑 ", "Preparing edit: "],
  ["准备删除 ", "Preparing deletion: "],
  ["已创建 ", "Created "],
  ["已删除 ", "Deleted "],
  ["已编辑 ", "Edited "],
  ["编辑 ", "Editing "],
  ["删除 ", "Deleting "],
  ["读取 ", "Reading "],
  ["写入 ", "Writing "],
  ["子 Agent · ", "Subagent · "],
  ["等待批准：", "Awaiting approval: "],
  ["询问用户：", "Asking user: "],
  ["打开内置浏览器：", "Opening browser: "],
  ["Agent 执行失败：", "Agent failed: "],
  ["会话状态：", "Session status: "],
];
export function runtimeText(text: string): string {
  if (getLocale() !== "en") return text;
  const translated = tr(text);
  if (translated !== text) return translated;
  for (const [prefix, replacement] of prefixes)
    if (text.startsWith(prefix)) return replacement + runtimeText(text.slice(prefix.length));
  const diagnostics = /^诊断发现 (\d+) 个(错误|警告)$/.exec(text);
  if (diagnostics)
    return `Diagnostics found ${diagnostics[1]} ${diagnostics[2] === "错误" ? "errors" : "warnings"}`;
  const command = /^在 (.+) 运行命令$/.exec(text);
  if (command) return `Run command in ${command[1]}`;
  const mcp = /^(.+) MCP 不可用$/.exec(text);
  if (mcp) return `${mcp[1]} MCP unavailable`;
  return localizeError(text, getLocale());
}
