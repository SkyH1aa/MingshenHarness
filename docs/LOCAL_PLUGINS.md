# Mingshen Harness 本地插件接口

适用版本：1.3.3 · Windows 10/11 x64

本文说明如何在 Mingshen Harness 中开发、校验、添加本地开发市场、手动安装、启用、试运行和更新原生本地插件。插件是用户主动安装的本地扩展，不因声明了 Skill、命令、MCP 或 Hook 就获得文件、命令、网络或审批权限。

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
- 已安装且启用只让插件进入可发现范围；Hook 还要求把该插件引用到当前 CodeAgent / WorkAgent 会话。
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
PreToolUse
PostToolUse
Stop
SubagentStop
Interrupt
```

Hook 不是“安装后全局后台监听”。只有同时满足以下条件，宿主才会检查该插件的事件声明：

- 插件已安装且启用。
- 插件已通过输入框加号菜单或 `/plugins` 引用到当前 CodeAgent / WorkAgent 会话；只被自动发现、未加入当前会话的 Skill/MCP/命令不会让该插件的 Hook 自动运行。
- 会话是主会话，不是 ChatAgent 或实际 SubAgent。

`UserPromptSubmit` 只从当前会话已引用且启用的插件加载声明式 `type: "prompt"` 文本作为低优先级上下文；其中的命令或 MCP 动作不会执行。文本有长度上限，不能覆盖用户请求、系统规则、审批、安全策略或工具边界。

常规动作型 Hook（`PreToolUse`、`PostToolUse`、完成后的 `Stop`、`SubagentStop`）只在**主 CodeAgent / WorkAgent + 宿主执行 + 完全访问 + 已信任项目**中尝试。请求批准、Docker、ChatAgent、实际 SubAgent、只读配置、未信任项目或插件未加入当前会话时不会执行。MCP Hook 即使满足这些前置条件，仍须逐次人工审批；Shell Hook 还受下文默认关闭与致命命令保护约束。

### Interrupt

`Interrupt` 是显式停止时的独立清理期通知，不是普通动作 Hook。用户显式停止且会话满足“主 CodeAgent / WorkAgent + 宿主执行 + 完全访问 + 非只读配置 + 当前会话已引用已启用插件”时，宿主才可能用独立清理信号触发它；该声明式通知不要求项目信任。信号最多等待约 1.5 秒，采用 fire-and-forget，主页面的停止流程不会等待 Hook 完成。

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

- 安装、启用、自动发现或更新插件都不会自动运行 Hook；动作型 Hook 必须在当前会话中显式引用该插件。
- 常规动作型 Hook 只在主 CodeAgent / WorkAgent 的宿主、完全访问、已信任项目中尝试；请求批准、Docker、ChatAgent、实际 SubAgent 和只读配置不会执行。
- Shell Hook 默认关闭，并继续要求项目信任与每次动作审批；致命命令保护继续生效。
- 启用后的 Shell Hook 使用宿主 PowerShell，不因 Agent 处于请求批准或隔离会话就自动获得宿主回退。
- MCP Hook 仍要求对应 MCP Server 已启用、已配置，并逐次审批。
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
5. 如界面提供独立的 **校验开发目录**，先粘贴插件根目录完成校验。
6. 在插件卡片点击 **安装**。
7. 使用卡片上的启用开关确认插件已启用。
8. 新建或打开 CodeAgent / WorkAgent 会话，在输入框加号菜单或 `/plugins` 中把该插件加入当前会话。
9. 只有加入当前会话后，Hook 才可能按事件和权限条件触发；Skill、MCP 或命令的自动发现不会代替这一步。
10. 运行验收提示，并核对实际审批与运行结果。请求批准、Docker、ChatAgent 和实际 SubAgent 不会执行动作型 Hook；`Interrupt` 只发送 prompt 活动通知。

任何 Agent 任务仍在活动时，主进程会拒绝安装或更新。等待任务结束或手动停止后重试，插件版本不会在运行中的一轮静默切换。

## 更新

1. 修改原源码并完成真实实现。
2. 提升清单和对应市场条目的语义版本。
3. 保留稳定插件 `name`、市场 `name` 和源码路径。
4. 在设置中刷新现有市场，不要新增一个同身份的重复市场。
5. 插件显示 **可更新** 后点击 **更新**。
6. 确认已安装版本，并在新任务中使用验收提示。

成功更新保留 extension ID、会话引用和用户原有启用/停用状态。更新在下一轮或新任务生效；旧版本资源在运行期间保留，应用正常退出且任务全部停止后，仅清理宿主管理目录中的旧安装副本。清理失败会记录日志，保留对应副本，不阻止退出。更新失败时旧安装仍应可用。源码路径改变、名称不一致、来源记录损坏或同名内容已在其他位置安装时不会自动认领。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 市场无法添加 | 选择包含 `marketplace.json` 的真实本地目录；不要选择符号链接或仅有插件源码的目录 |
| 条目显示名称/版本错误 | 让市场条目的 `name`、`version` 与 `.mingshen-plugin/plugin.json` 完全一致 |
| 校验提示占位符 | 替换 `TODO`、`FIXME`、`<your-...>`、`YOUR_API_KEY` 等内容 |
| 技能未识别 | `skills` 必须指向目录，目录内必须有 `SKILL.md` |
| 路径越界 | 所有声明、资源、命令、MCP 与 Hook 文件必须位于插件根内，且不能借助链接逃逸 |
| 安装/更新按钮报任务忙碌 | 完成或停止所有活动 Agent 任务后重试 |
| 更新后行为未变化 | 更新不会热重载；开始新任务或让当前会话进入下一轮 |
| MCP 已声明但不可调用 | 检查插件启用、MCP 配置、审批、隔离和 Server 是否真实可用 |
| 插件已安装并启用但 Hook 不运行 | 把该插件加入当前 CodeAgent / WorkAgent 会话；动作型 Hook 还需要宿主、完全访问、已信任项目和对应事件，请求批准与 Docker 不执行 |
| Shell Hook 被跳过 | Shell Hook 默认关闭；还需项目信任和逐次审批 |
| `Interrupt` 没有执行命令或 MCP | 这是设计边界：`Interrupt` 只发送 prompt 文本活动通知，Command/MCP 动作明确跳过，不审批、不启动进程、不恢复工具 |
| ChatAgent 看不到插件 | 这是设计边界；ChatAgent 不加载插件、Skill、MCP 或 Hook |

代码、市场和校验功能的实现与限制以当前源码和 1.3.3 验证记录为准。源码存在、SDK 预检或静态文档均不能证明插件已经在真实运行中完成验收。
