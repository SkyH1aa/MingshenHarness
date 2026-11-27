# Mingshen Harness 本地插件接口

适用版本：1.3.7 · Windows 10/11 x64

本文说明如何在 Mingshen Harness 中开发、校验、添加本地开发市场、手动安装、启用、试运行和更新原生本地插件。插件是用户主动安装的本地扩展，不因声明了 Skill、命令、MCP 或 Hook 就获得文件、命令、网络或审批权限。

插件、Skill、命令、MCP、Hook 和市场更新均受宿主管理策略约束。内置安全边界、机器管理员策略、应用策略、Agent 模式、项目信任和执行环境会叠加检查，拒绝优先；插件清单、项目文件、Agent 提示词和完全访问不能放宽策略。若 `%ProgramData%\MingshenHarness\managed-policy.json` 存在但损坏、不可读或版本不支持，新的插件、Skill、命令、MCP 和 Hook 执行会暂停；已安装状态和历史诊断仍可查看，修复策略后下一次调用前重新检查。校验本身只做静态检查，不执行插件，也不因校验按钮可用而绕过策略。

## 生命周期与权威状态

本地插件按以下顺序交付：

1. 在可编辑源码目录编写 `.mingshen-plugin/plugin.json`、技能和可选组件。
2. 使用随包 SDK 做可选预检，或调用 `local_plugin` 只读工具执行宿主校验。
3. 在 `marketplace.json` 中登记插件源码目录。
4. 用户在 **设置 → Skills 与插件 → 本地插件开发市场** 添加市场。
5. 用户选择插件并点击 **安装**，再按需启用或停用。
6. 新建任务或让当前任务进入下一轮，使用真实提示词验收。
7. 修改源码并提升版本，刷新市场后点击 **更新**。

以下状态不能混为一谈：

- 源码存在不等于预检通过。
- SDK 预检通过不等于宿主运行时校验通过。
- 市场已添加不等于插件已安装或启用。
- 插件已安装不等于其 MCP、Hook、命令或业务结果已经执行成功。
- 插件声明了某项能力不等于管理策略已经允许它在当前模式、项目、会话和隔离环境中启动。
- 已安装且启用的插件默认采用 `activation: "on-demand"`，进入 CodeAgent / WorkAgent 按需发现范围；Agent 可在当前运行中调用 `use_plugin`，无需先手动加入会话。`activation: "required"` 插件必须由用户先加入当前会话。
- 当前会话已引用也不等于 Hook 已触发；事件、权限、执行环境、项目信任和插件动作类型仍须满足下文边界。
- 试运行成功只证明该次输入、配置和运行环境下可用，不证明所有第三方服务或任意输入都兼容。

模型侧没有安装、更新、启用或卸载工具。CodeAgent / WorkAgent 的 `local_plugin` 仅提供 `inspect`、`validate` 和 `list_markets`，生命周期修改必须由用户在界面完成。

## 原生插件目录

推荐结构：

```text
market-root/
  marketplace.json
  plugins/
    report-tools/
      .mingshen-plugin/
        plugin.json
      skills/
        report-tools-harness/
          SKILL.md
      commands/
        review-report.md
      hooks/
        hooks.json
      mcp/
        servers.json
```

宿主的原生清单路径是 `.mingshen-plugin/plugin.json`。为导入兼容，也识别：

```text
.codex-plugin/plugin.json
.zcode-plugin/plugin.json
plugin.json
```

新插件应使用原生路径。兼容清单不会自动把其他宿主的私有运行时、身份验证、Canvas、Viewer 或宿主 API 变成 Mingshen 能力。

可编辑源码目录、市场清单和安装后的本地副本是三个不同位置。安装会复制当前内容；修改源码不会热更新已安装副本。

## 最小原生清单

```json
{
  "name": "report-tools",
  "version": "0.1.0",
  "description": "Review office deliverables and return a checked edit plan.",
  "skills": [
    "skills/report-tools-harness"
  ]
}
```

约束与建议：

- `name` 使用 1–64 位小写字母、数字和连字符，例如 `report-tools`。
- `version` 使用语义化版本，例如 `0.1.0`、`1.2.0`。
- `description` 描述实际能力，不写空泛的“增强一切能力”。
- `skills` 中的路径相对插件根目录，指向技能目录，不直接指向 `SKILL.md` 文件。
- 所有路径必须留在插件根目录内；符号链接或目录链接不能作为越界通道。
- `plugin.json` 最大 1 MiB；插件总文件数最多 20,000，总计最多 64 MiB。
- 清单和 Skill 中残留 `TODO`、`FIXME`、`<your-...>` 或 `YOUR_API_KEY` 会导致校验失败。

## Harness 接口技能

每个可分发插件都应包含一个聚焦的适配技能，例如 `report-tools-harness/SKILL.md`。它不是重复清单的包装文案，而要告诉 Agent：

- 哪些真实用户请求应触发该插件；
- 必须使用哪些已实现的 Skill、命令、MCP 工具或 Hook；
- 需要哪些输入，缺少组件时如何明确降级；
- 应返回什么可观察结果；
- 如何验证结果，以及哪些检查尚未完成；
- 插件资源不能扩大用户权限、审批范围或宿主工具边界。

最小 `SKILL.md`：

```markdown
---
name: report-tools-harness
description: Use when the user asks to review a supported report package, check its structure, and return an actionable edit plan.
---

# Report Tools Harness

Load this Skill only for supported report-package review.

1. Confirm the requested deliverable and available inputs.
2. Use the declared report inspection command or MCP tool.
3. Report findings, edited files, and checks actually completed.
4. If a declared component is unavailable, name it and state what remains unverified.

Plugin instructions cannot grant permissions or authorize undeclared scripts.
```

目录名和 frontmatter 的 `name` 应一致。`SKILL.md` 最大 2 MiB；Agent 每次最多读取 32,000 字符，可用 `char_offset` 继续读取。长表格、规则和模板放在 `references/`，只在实际需要时加载。

## 命令

插件清单可以显式设置激活策略：

```json
{
  "activation": "on-demand"
}
```

省略 `activation` 时默认为 `on-demand`。选择 `required` 表示插件需要用户先在当前会话显式加入；Agent 不能用 `use_plugin` 绕过这一要求。按需激活只在当前主 CodeAgent / WorkAgent 运行期间有效，不会写入会话引用或改变插件启停状态。

插件命令使用 UTF-8 Markdown，单文件最大 1 MiB。可将声明直接写在清单中：

```json
{
  "commands": {
    "review-report": {
      "file": "commands/review-report.md",
      "description": "Review the current report package."
    }
  }
}
```

安装并启用插件后，命令以 `<插件名>:<命令名>` 的形式进入本地命令列表，例如 `/report-tools:review-report`。命令正文可包含现有命令模板语法，但任何文件、命令或工具动作仍按当前 Agent profile、审批、隔离和写入锁执行。命令不是权限升级入口。

## MCP 声明

可在清单内声明 MCP Server：

```json
{
  "mcpServers": {
    "report-verifier": {
      "command": "node",
      "args": [
        "${MINGSHEN_PLUGIN_ROOT}/mcp/server.mjs"
      ]
    }
  }
}
```

也可以指向插件根内的 JSON 文件：

```json
{
  "mcpServers": "mcp/servers.json"
}
```

声明文件必须是插件根内的普通 JSON 文件且不超过 1 MiB。`${MINGSHEN_PLUGIN_ROOT}` 会展开为安装后的插件根；兼容 token `${CLAUDE_PLUGIN_ROOT}` 与 `${ZCODE_PLUGIN_ROOT}` 也会识别，但新插件不应使用它们。

安装时会同步插件 MCP 声明。实际启动、工具发现和调用仍受插件启用状态、MCP 配置、profile、审批、隔离与网络边界约束。校验不会自行启动声明中的 MCP Server。

## Hook

支持的 Hook 事件名：

```text
UserPromptSubmit
BeforeModelRequest
PreToolUse
PostToolUse
Stop
SubagentStop
Interrupt
```

Hook 不是“安装后全局后台监听”。普通按需插件须先由 Agent 在本轮调用 `use_plugin`，或由用户加入当前会话；`activation: "required"` 插件只能由用户加入会话。之后还须满足事件和运行策略：

- 插件已安装且启用。
- 插件已在当前运行中按需激活，或已加入当前会话；仅被自动发现不会执行 Hook。
- Hook 类型与运行来源符合下述边界。

`UserPromptSubmit` 在 Agent 开始工作前发生，因此只检查提交时已加入当前会话的插件；之后调用 `use_plugin` 不会追溯触发本轮的 `UserPromptSubmit`。它只加载声明式 `type: "prompt"` 文本作为低优先级上下文，其中的命令或 MCP 动作不会执行。

`BeforeModelRequest` 是逐次模型请求的声明式提示 Hook。它会在主 CodeAgent / WorkAgent 运行中的每次模型请求前执行，包括主模型后续轮次与网络重试，以及该运行触发的压缩和记忆摘要请求；插件在运行中按需激活后，从下一个模型请求开始生效。实际经 `runSubagent` 从活动父运行派生的子任务，只继承父运行已选或已激活插件中的声明式 `type: "prompt"` 上下文：子任务初始请求使用派生时的父运行选择，后续每次请求读取父运行最新的选择/激活状态，因此父运行之后激活的插件会在子任务下一次尚未发送的请求前生效。不会回写已经发送的请求。独立通过 `@` 打开的子会话若没有活动父运行映射，不接入此继承。需要从主任务首个请求开始注入时，使用 `activation: "required"` 并在提交用户消息前引用该插件。它只接收 `type: "prompt"` 文本，不执行命令或 MCP 动作；`${provider_id}` 和 `${model_id}` 可读取当前请求的模型信息。收集有 3 秒总预算，单条提示最多 4,000 字符、聚合文本最多 12,000 字符；活动 Hook 声明读取失败、超时或超出上限时会记录诊断并拒绝发送本次模型请求，不会静默漏掉标记后继续。插件提示不能保证模型遵循其文字，也不能改写已发送的请求或历史消息。

`type: "prompt"` 还支持两个可选字段：

- `position`: `"before"` 或 `"after"`，默认 `"before"`。
- `format`: `"context"` 或 `"plain"`，默认 `"context"`。

`format: "plain"` 是可复用的去归属开关：与 `before` 或 `after` 搭配时，都不添加 `<mingshen_plugin_context>`、`Plugin N`、插件标题、来源标签或额外插件说明；旧版 `format: "context"` 继续保留这些归属和低优先级上下文标记。`before + context` 是原有默认行为，会使用低优先级系统上下文。`before + plain` 在普通输入轮次将纯文本放在本轮原文之前，`after + context` 保留包装但放在末尾，`after + plain` 则在原文后用单个换行追加普通用户文本，例如 `xxxx\n123abc`，不产生空行。除 `before + context` 外的用户内容型注入若遇到普通输入，会就近追加；若请求以工具结果结束，宿主按具体协议在完整工具结果内容之后添加普通用户文本块，或在需要独立消息的协议中新增普通 user 尾消息；若以 assistant 结束，则新增普通 user 尾消息。工具结果轮次不会把用户内容型插件文本插入 tool call 与对应 tool result 之间，也不会改写、隐藏或拆开工具调用/结果配对。每次请求临时附加，不写回会话历史。`plain` 不会把内容提升为 system 指令，仍受正常消息优先级和安全边界约束，不能覆盖系统规则、用户当前请求、审批、隔离或工具权限。

`format: "context"` 的插件提示会被标记为低优先级、不可信数据；`format: "plain"` 则是普通用户优先级文本。两者都不能覆盖用户请求、系统规则、审批、安全策略或工具边界。继承只传递 `BeforeModelRequest` 的提示文本，不向子任务开放插件激活、`UserPromptSubmit`、`Interrupt`、插件命令、MCP、动作型 Hook 或 `local_plugin`。该 Hook 不适用于 ChatAgent、自动审批安全审查模型、独立 AutoDrive / 草稿润色任务或任务完成后的标题请求。`UserPromptSubmit`、`Interrupt` 及常规动作型 Hook 仍不会在实际子任务中触发。

常规动作型 Hook（`PreToolUse`、`PostToolUse`、完成后的 `Stop`、`SubagentStop`）只在**主 CodeAgent / WorkAgent + 宿主执行 + 完全访问 + 已信任项目**中尝试。请求批准、Docker、ChatAgent、实际 SubAgent、只读配置、未信任项目或插件未加入当前会话/本轮激活时不会执行。MCP Hook 即使满足这些前置条件，仍须逐次人工审批；Shell Hook 还受下文默认关闭与致命命令保护约束。

### Interrupt

`Interrupt` 是显式停止时的独立清理期通知，不是普通动作 Hook。用户显式停止且会话满足“主 CodeAgent / WorkAgent + 宿主执行 + 完全访问 + 非只读配置 + 当前会话已引用或本轮已按需激活的启用插件”时，宿主才可能用独立清理信号触发它；该声明式通知不要求项目信任。信号最多等待约 1.5 秒，采用 fire-and-forget，主页面的停止流程不会等待 Hook 完成。

`Interrupt` 仅处理 `type: "prompt"` 文本活动通知。`command` 和 MCP 动作会被明确标记为 skipped，绝不弹出 Hook 审批、启动进程、调用 MCP 或恢复/重放工具。ChatAgent、实际 SubAgent、请求批准、Docker、应用正在关闭及未显式停止的运行不会触发。不要把 `Interrupt` 写成能执行 Shell、MCP 或回滚副作用的生命周期钩子。

示例：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "type": "prompt",
        "text": "If the request names a supported report package, consider the report-tools capability."
      }
    ],
    "BeforeModelRequest": [
      {
        "hooks": [
          {
            "type": "prompt",
            "text": "123abc",
            "position": "after",
            "format": "plain"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "read_file|list_files",
        "hooks": [
          {
            "type": "mcp_tool",
            "server": "report-verifier",
            "tool": "inspect_path",
            "input": {
              "path": "${plugin_root}/.mingshen-plugin/plugin.json"
            }
          }
        ]
      }
    ]
  }
}
```

匹配器支持精确工具名、`|` 分隔的多个名称以及 `*` / `?` 通配符，不执行任意正则表达式。

MCP Hook 的 `input` 只展开扁平变量，例如 `${plugin_root}`、`${cwd}`、`${session_id}`、`${tool_name}`、`${tool_call_id}` 和 `${hook_event_name}`。当前不解析 `${tool_input.path}` 这类嵌套路径；需要读取实际工具参数时使用 Shell Hook，Hook 输入 JSON 会通过 stdin 提供 `tool_input`，不要把未展开的占位符当作已传值。

安全边界：

- 安装、启用或自动发现插件不会自动运行 Hook；默认 `on-demand` 插件须由 Agent 在本轮调用 `use_plugin`，或由用户加入当前会话。`activation: "required"` 只能通过用户显式加入满足。
- 常规动作型 Hook 只在主 CodeAgent / WorkAgent 的宿主、完全访问、已信任项目中尝试；请求批准、Docker、ChatAgent、实际 SubAgent 和只读配置不会执行。按需激活不会授予这些策略例外。
- Shell Hook 默认关闭，并继续要求项目信任与每次动作审批；致命命令保护继续生效。
- 启用后的 Shell Hook 使用宿主 PowerShell，不因 Agent 处于请求批准或隔离会话就自动获得宿主回退。
- MCP Hook 仍要求对应 MCP Server 已启用、已配置，并逐次审批。
- 结构化 MCP Hook 返回 `effect: "uncertain"` 时，即使传输层给出了输出，状态也不能记为成功；保留 `EXTENSION_OUTCOME_UNCERTAIN` 和真实证据，禁止把远端结果未知当成可安全重放。
- Shell Hook 只有在取消后的 `taskkill` 明确成功且目标子进程已关闭时才能确认终止；`taskkill` 非零、无法启动，或命令已退出但 `child close` 未确认，都必须保留 `effect: "uncertain"` 和 `EXTENSION_OUTCOME_UNCERTAIN`，不得宣称清理成功或自动重跑动作。
- `Interrupt` 只发送 prompt 文本活动通知；其中声明的 Command/MCP 动作一律跳过，不审批、不执行、不恢复工具。
- 校验、市场扫描和安装流程不运行 Hook、MCP Server 或插件脚本。

## 本地开发市场

市场根目录必须有 `marketplace.json`：

```json
{
  "name": "dev-report-tools",
  "displayName": "Report Tools Dev",
  "description": "Local development builds.",
  "plugins": [
    {
      "name": "report-tools",
      "source": "./plugins/report-tools",
      "version": "0.1.0",
      "description": "Review and improve report packages.",
      "displayName": "Report Tools",
      "category": "documents"
    }
  ]
}
```

规则：

- 市场 `name` 使用稳定的小写连字符标识。
- `source` 必须是市场根内的相对目录，不能是绝对路径、URL 或包含 `..` 的路径。
- 市场条目 `name` / `version` 必须与插件清单一致。
- 一个市场最多 200 个条目，`marketplace.json` 最大 1 MiB。
- 首选根目录 `marketplace.json`；兼容隐藏路径 `.mingshen-plugin/marketplace.json`、`.zcode-plugin/marketplace.json` 和 `.claude-plugin/marketplace.json`。
- 市场只扫描本地真实目录；市场根、插件源及其解析结果不能通过链接逃出市场根。
- SDK 写入市场清单时使用同进程串行队列和跨进程锁，在读取、修改与提交期间阻止另一个 CLI 同步更新；正常写入最多等待 15 秒，随后使用随机名同目录临时文件和重命名替换 `marketplace.json`，并回读核对结果。锁存在超过 60 秒时不在代码中按 mtime 自动删除，而是报出锁的绝对路径并保持原清单不变。确认没有市场写入进程后，只手动删除报错中的 `.marketplace.json.lock` 再重试；不要删除或重建 `marketplace.json`。这避免并发更新静默丢失和直接覆盖留下的半截清单，但不替代磁盘级 `fsync`、备份或版本控制。
- 添加或移除市场只修改 Mingshen 的市场登记，不删除用户的源码目录或已安装插件副本。

## SDK 预检

安装包中的 SDK 位于：

```text
<Mingshen Harness 安装目录>\resources\sdk\plugin-dev\mingshen-plugin.mjs
```

源码仓库中的同一工具位于：

```text
apps\desktop\resources\sdk\plugin-dev\mingshen-plugin.mjs
```

PowerShell 示例：

```powershell
$sdk = "C:\Path\To\MingshenHarness\resources\sdk\plugin-dev\mingshen-plugin.mjs"
$plugin = "C:\Workspace\plugin-dev\plugins\report-tools"
$market = "C:\Workspace\plugin-dev"

node $sdk create $plugin `
  --name report-tools `
  --description "Review office deliverables and return a checked edit plan." `
  --display-name "Report Tools"

node $sdk validate $plugin --json

node $sdk marketplace $market `
  --name dev-report-tools `
  --add $plugin
```

`create` 会故意生成待完成的 `TODO` 内容；替换为真实实现后才能通过校验。SDK 是文件与路径预检，输出中的 `authoritative:false` 表示它不能替代宿主校验。

## 使用 Agent 创建插件或技能

CodeAgent / WorkAgent 内置三个按需技能：

- `builtin:skill-creator`：将一个可重复工作流整理成标准 `SKILL.md`、参考资源、触发描述和验收提示。
- `builtin:plugin-creator`：创建包含多个 Skill、命令、MCP 或 Hook 的本地插件、市场条目和手动安装说明。
- `builtin:harness-plugin-api`：解释原生清单、市场、只读验证工具、生命周期和兼容边界。

可直接用自然语言说明目标，例如“用 Plugin Creator 在 `plugin-dev` 中创建并校验一个报告检查插件，包含 Harness 适配技能和本地市场，不要自动安装”。正确交付应包含绝对源码路径、清单、适配技能、市场路径、校验结果和待用户执行的安装步骤。

### 受限只读 `local_plugin` 工具

CodeAgent / WorkAgent 的主会话可在满足全部条件时看到只读 `local_plugin`：

```text
主 CodeAgent 或 WorkAgent
+ 有当前工作目录
+ 宿主执行
+ 请求批准或完全访问
+ 不是 SubAgent
```

它支持：

```json
{"action":"inspect","rootPath":"C:\\Workspace\\plugin-dev\\plugins\\report-tools"}
{"action":"validate","rootPath":"C:\\Workspace\\plugin-dev\\plugins\\report-tools"}
{"action":"list_markets"}
```

`rootPath` 必须是当前工作区内真实绝对目录。宿主会先经过现有 `safeFilePath` 边界，拒绝链接根、任意中间符号链接、`.git` 和危险 Windows 路径段，再用 `realpath` 复核目录仍在规范化工作区内。未显式允许 `local_plugin` 时，工具权限继承 `read_file`；`read_file:<路径>`、`local_plugin:<路径>`、`read` 组规则、`*` 和工具 allowlist 均参与判定。Profile 的拒绝会在扫描源码前生效。

请求批准模式下，路径检查完成后会按插件目录请求一次只读审批。`allow_once` 只授权当次，`allow_session` 只复用该规范目录及其子目录；拒绝或取消不会进入校验器。完全访问模式仍不会绕过 Profile 的 `deny`/`ask`。`list_markets` 只读取已登记市场元数据，不扫描市场目录。

ChatAgent、实际 SubAgent、Docker 和 worktree 会话不能调用该工具，应在界面中校验与安装。该工具不安装、不更新、不启用、不运行脚本，也不执行 Hook、MCP 或命令。宿主校验直接在 Electron 主进程完成，不启动系统 Node、SDK CLI、Shell 或其他子进程，也不读取 `PATH`。`resources/sdk/plugin-dev/` 是可选开发预检；只有用户主动运行其 CLI 时才需要相应 Node 环境，且其 `authoritative:false` 结果不能代替宿主校验。

## 手动安装

1. 打开 **设置 → Skills 与插件**。
2. 在 **本地插件开发市场** 点击 **添加市场**。
3. 选择市场根目录，或直接选择 `marketplace.json`。
4. 展开插件错误与警告，确认市场条目名称、版本、来源目录和校验状态。
5. 如界面提供独立的 **校验开发目录**，可粘贴单插件根目录，或粘贴市场根目录逐项检查 catalog 中的插件；校验不会注册市场或安装插件。
6. 在插件卡片点击 **安装**。
7. 使用卡片上的启用开关确认插件已启用。
8. 默认 `on-demand` 插件无需预先加入会话；Agent 可通过 `discover_capabilities` 找到它，并用精确 ID 调用 `use_plugin`。之后可按需 `use_skill`；插件 MCP 工具从下一轮开始按普通审批与隔离策略提供。
9. `activation: "required"` 插件须由用户通过输入框加号菜单或 `/plugins` 加入当前会话；Agent 不能自行激活。
10. `UserPromptSubmit` 只会在提交时看到当时已加入会话的插件；运行时按需激活从之后的模型请求及工具事件开始生效。
11. 运行验收提示，并核对实际审批与运行结果。请求批准、Docker、ChatAgent 和实际 SubAgent 不会执行动作型 Hook；`Interrupt` 只发送 prompt 活动通知。

任何 Agent 任务仍在活动时，主进程会拒绝安装或更新。等待任务结束或手动停止后重试，插件版本不会在运行中的一轮静默切换。

若设置 → 运行与集成 → 运行治理显示策略无效，市场仍可用于只读诊断，但安装后插件、Skill、命令、MCP、Hook 和需要新扩展执行的操作会被暂停。根据页面显示的机器策略路径和错误修复 JSON；不要把项目改成完全访问或手动删除策略文件来绕过。

## 更新

1. 修改原源码并完成真实实现。
2. 提升清单和对应市场条目的语义版本。
3. 保留稳定插件 `name`、市场 `name` 和源码路径。
4. 打开本地市场页、刷新市场或点击重新检查；更新检查按登记顺序 round-robin 只读轮转，每批最多检查 10 个市场、每个市场最多读取 200 个条目。它只检查下一批，不会一次扫描全部市场；已发现的候选会跨批保留并合并，只替换本批市场结果。市场被移除、路径身份变化、插件卸载、来源 provenance 不匹配或已安装版本追平候选版本时，旧候选会被清除。
5. 只有来源路径复核一致且严格语义版本高于已安装版本时才显示 **可更新**；缺少安装来源记录或来源不可追踪的插件不会按名称自动认领市场条目。用户核对原始来源并点击 **更新** 后才复用该来源，不需要重新导入。扫描只报告候选，不修改或执行插件；更新动作会重新校验来源。
6. 确认已安装版本，并在新任务中使用验收提示。

成功更新保留 extension ID、会话引用和用户原有启用/停用状态。更新在下一轮或新任务生效；旧版本资源在运行期间保留，应用正常退出且任务全部停止后，仅清理宿主管理目录中的旧安装副本。清理失败会记录日志，保留对应副本，不阻止退出。更新失败时旧安装仍应可用。源码路径改变、名称不一致、来源记录损坏或同名内容已在其他位置安装时不会自动认领。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 市场无法添加 | 选择包含 `marketplace.json` 的真实本地目录；不要选择符号链接或仅有插件源码的目录 |
| SDK 提示市场锁超过 60 秒 | 先确认没有其他 CLI 或宿主市场写入者，再仅删除报错给出的 `.marketplace.json.lock`；不要修改或删除 `marketplace.json` |
| 条目显示名称/版本错误 | 让市场条目的 `name`、`version` 与 `.mingshen-plugin/plugin.json` 完全一致 |
| 校验提示占位符 | 替换 `TODO`、`FIXME`、`<your-...>`、`YOUR_API_KEY` 等内容 |
| 技能未识别 | `skills` 必须指向目录，目录内必须有 `SKILL.md` |
| 路径越界 | 所有声明、资源、命令、MCP 与 Hook 文件必须位于插件根内，且不能借助链接逃逸 |
| 安装/更新按钮报任务忙碌 | 完成或停止所有活动 Agent 任务后重试 |
| 更新后行为未变化 | 更新不会热重载；开始新任务或让当前会话进入下一轮 |
| MCP 已声明但不可调用 | 检查插件启用、MCP 配置、审批、隔离和 Server 是否真实可用 |
| 插件已安装并启用但 Hook 不运行 | 默认 on-demand 插件可由 CodeAgent / WorkAgent 先 `discover_capabilities` 再 `use_plugin`；`activation: "required"` 必须手动加入会话。`UserPromptSubmit` 不会追溯执行；动作型 Hook 还需要宿主、完全访问、已信任项目和对应事件，请求批准与 Docker 不执行 |
| `use_skill` 报资源不存在 | 先读取该 Skill 的入口并使用其中列出的精确相对资源路径；内置 Harness API 资源见中英文用户指南，错误信息也会列出该 Skill 扫描到的可用引用 |
| Shell Hook 被跳过 | Shell Hook 默认关闭；还需项目信任和逐次审批 |
| `Interrupt` 没有执行命令或 MCP | 这是设计边界：`Interrupt` 只发送 prompt 文本活动通知，Command/MCP 动作明确跳过，不审批、不启动进程、不恢复工具 |
| ChatAgent 看不到插件 | 这是设计边界；ChatAgent 不加载插件、Skill、MCP 或 Hook |

市场更新检查不会自动安装或运行新版；只有用户点击 **更新** 后才会替换插件，安装流程也会再次校验来源和版本。Agent 活动期间仍拒绝安装或更新。

代码、市场和校验功能的实现与限制以当前源码为准；1.3.5 的完整插件验证见[1.3.5验证记录](VALIDATION_1.3.5.md)，1.3.6 的验证见[1.3.6验证记录](VALIDATION_1.3.6.md)。1.3.7 的 Hook 结果已接入 `ToolOutcome` 的不确定副作用语义，`plugin-hook-service` 定向为 **47/47**，其中包含真实 PowerShell stdin/环境与取消清理夹具；结构化 MCP 和进程树清理的其余故障组合仍由模拟进程覆盖。本轮最终全量与安装包状态以[1.3.7验证记录](VALIDATION_1.3.7.md)为准。源码存在、SDK 预检或静态文档均不能证明插件已经在所有第三方服务和真实安装环境中完成验收。
