# Mingshen 系统提示词设计

提示词源文件位于 `apps/desktop/resources/prompts/`。它们是产品行为的一部分，必须版本化、测试并随安装包发布。

## 组合顺序

每次模型请求按以下顺序构造系统上下文：

1. `safety.md`
2. `core.md`
3. `tools.md`
4. `coding.md`，仅在当前会话启用编程能力时
5. `runtime.md`，注入宿主运行事实
6. 当前会话的用户自定义系统提示
7. 已发现的 `AGENTS.md` 层级内容
8. 当前启用 Skills 的元数据和按需内容

`subagent.md` 替换 `core.md` 中的身份段落不现实，因此子 Agent 使用：

1. `safety.md`
2. `core.md`
3. `tools.md`
4. `coding.md`
5. `subagent.md`
6. `runtime.md`
7. 父会话允许继承的系统提示和项目上下文

安全规则不能通过设置页关闭。用户自定义系统提示只能增加任务要求，不能取消凭据保护、沙箱、审批和灾难性命令拦截。

## 动态运行上下文

`runtime.md` 使用 `{{RUNTIME_CONTEXT_JSON}}` 占位。建议结构：

```json
{
  "app_version": "1.2.1",
  "session_id": "uuid",
  "turn_id": "uuid",
  "agent_depth": 0,
  "locale": "zh-CN",
  "os": "Windows 11",
  "shell": "PowerShell 7.5",
  "workspace_path": "C:\\work\\project",
  "workspace_trusted": true,
  "permission_mode": "request_approval",
  "model": {
    "id": "model-id",
    "context_window": 200000,
    "max_output_tokens": 32000,
    "input_modalities": ["text", "image"],
    "tool_calls": true,
    "parallel_tool_calls": true,
    "reasoning_level": "high"
  },
  "available_tools": ["read_file", "apply_patch", "shell_exec"],
  "enabled_skills": [],
  "enabled_mcp_servers": []
}
```

不要在该 JSON 中加入 API Key、认证头、Cookie、完整环境变量或原始用户提示。

## 上下文安全

- `AGENTS.md` 和 Skill 内容使用明确分隔符包裹，并标注来源路径。
- 网页、文件、命令输出和 MCP 返回内容不得进入系统提示，只作为工具结果或用户内容传递。
- 运行时 JSON 必须序列化生成，不用字符串拼接。
- 用户自定义系统提示为空时不生成空区块。
- 动态事实变化后重新编译系统提示，不使用过期工具列表。

## Token 与缓存

- 静态部分保持在 `safety.md` 到 `coding.md`，便于供应商缓存前缀。
- 动态运行事实放在静态部分之后。
- Skill 全文只在被激活或需要时载入，默认只注入名称和描述。
- 项目 `AGENTS.md` 只注入命中的层级，不扫描无关目录。
- 达到上下文 85% 时调用 `compaction.md`，原始事件不删除。

## 测试要求

- 验证安全的固定规则始终出现。
- 验证用户系统提示不能移除安全区块。
- 验证子 Agent 不获得创建子 Agent 的能力。
- 验证未提供的工具不会出现在可用工具列表中。
- 验证运行上下文 JSON 中的路径、换行和引号被正确转义。
- 验证压缩摘要不包含密钥模式。

## 维护规则

- 修改提示词必须说明行为影响并增加或更新测试。
- 不在提示词中写死某一家模型或供应商名称。
- 不把 UI 文案复制进提示词，除非它改变 Agent 的判断。
- 安全规则新增后，需要同步检查拒绝原因和替代建议是否清晰。
