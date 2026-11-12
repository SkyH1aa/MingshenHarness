# Mingshen Harness 实施计划

状态：已确认，进入实施。

产品名：Mingshen Harness  
应用标识：`com.mingshen.harness`  
发布者：Ming  
首发平台：Windows 10 / 11 x64  
首版版本：`1.0.0`  
交付方式：未签名标准安装包，单次发布包含全部已确认功能

## 1. 交付定义

首版不是只做界面原型。最终验收必须完成以下闭环：

1. 用户安装应用，配置一个 OpenAI-compatible 或 Anthropic-compatible 供应商。
2. 用户保存多把 API Key，拉取模型列表，并为每个模型配置上下文、最大输出、模态和思考等级。
3. 用户在真实本地仓库中选择工作目录，建立可并发运行的会话。
4. 模型真实流式返回内容，调用文件、终端、Git、浏览器、MCP、Skills、子 Agent 等工具。
5. 用户能在“完全访问”和“请求批准”之间切换；请求批准模式下，敏感操作经过审批和 Windows 沙箱。
6. 用户能查看 diff、编辑文件、操作 Git、恢复旧会话、压缩长上下文、导出会话。
7. 应用能创建 Windows 定时任务、驻留托盘、检查更新、按用户授权上传脱敏日志。
8. 同一安装包在干净的 Windows 10 和 Windows 11 机器上完成验收。

内部按里程碑实施，但不发布半成品版本。最终发布门槛是全部功能通过验收矩阵。

## 2. GitHub 参考与取舍

已研究 OpenCode、ZCode、Codex、dsh-desktop、command-code 的公开实现，主要采用以下工程结论：

- 采用 OpenCode 的“Provider / Model / Session / Tool / Permission”分层方式。
- 采用 ZCode 的会话事件、权限请求、取消、排队和工具副作用分类思路。
- 采用 Codex 的 `SKILL.md`、`.codex-plugin/plugin.json`、MCP、AGENTS.md 兼容目标。
- 采用 Codex Windows sandbox 的 restricted token、AppContainer、Job Object、ACL 和防火墙思路。
- 不复制 Codex 或 ZCode 的界面结构，不把信息架构做成明显克隆。

引用或改写开源代码时保留原许可证和 NOTICE。Codex、ZCode 采用 Apache-2.0，OpenCode 采用 MIT；具体依赖清单在实现阶段生成 `THIRD_PARTY_NOTICES.md`。

## 3. 技术栈与进程边界

### 3.1 技术栈

- Electron：桌面壳、Windows 集成、托盘、WebContentsView 浏览器。
- React + TypeScript：渲染层。
- Vite + electron-vite：构建。
- electron-builder：NSIS 安装包。
- SQLite + FTS5：本地会话、配置、索引。
- CodeMirror 6：轻量代码编辑器与合并视图。
- xterm.js + node-pty：用户交互终端和 Agent 终端输出。
- Rust：Windows 沙箱 helper，基于 Codex 已公开的 Windows sandbox 实现改造。
- Vitest：单元与集成测试。
- Playwright：Electron 端到端测试和浏览器自动化测试。
- Zod：IPC、工具参数、配置和 Supabase 返回值校验。

不引入本地 Web 服务，也不开放 localhost 端口，减少攻击面。

### 3.2 进程边界

```text
Renderer (sandboxed, no Node)
        |
        | typed IPC only
        v
Electron Main (trusted OS boundary)
  |-- SQLite / attachments / logs / secrets
  |-- permission engine / approval queue
  |-- PTY / Git / browser / tray / updater / Task Scheduler
  |-- MCP lifecycle
  |
  +--> Agent Host (Electron utilityProcess)
  |      provider adapters, streaming, context, agent loop
  |
  +--> Native Sandbox Helper (Rust)
  |      restricted token / AppContainer / Job Object / ACL
  |
  +--> MCP child processes
  +--> PowerShell / user commands
  +--> WebContentsView browser renderer
```

职责约束：

- Renderer 不接触 Node、文件系统、API Key、原始 SSE 或命令句柄。
- Agent Host 不直接执行系统操作；所有文件、命令、MCP、浏览器动作经 Main 的工具执行器。
- Main 是唯一权限裁决点和持久化写入点。
- 每个会话使用独立 runner、AbortController 和事件序号。
- 结构化 IPC 全部通过 preload 暴露白名单方法，并用 Zod 双向校验。

## 4. 目录结构

```text
apps/
  desktop/
    src/main/
      app/                 lifecycle, windows, tray, single-instance
      ipc/                 typed handlers and event streams
      storage/             SQLite, migrations, search, attachments
      secrets/             Windows Credential Manager bridge
      providers/           registry, auth, key rotation, tests
      agent/               session runners, queues, compaction, subagents
      tools/               file, shell, git, browser, search, plan, task
      permissions/         policy, approvals, dangerous command rules
      sandbox/             native helper client and policy binding
      extensions/          skills, plugins, hooks
      mcp/                 stdio/http/sse, OAuth, tool bridge
      browser/             WebContentsView and CDP automation
      terminal/            user PTY and agent command output
      scheduler/           Windows Task Scheduler integration
      updater/             Supabase release check and browser launch
      telemetry/           redaction, local queue, consent, upload
    src/agent-host/
      adapters/            anthropic, responses, chat completions
      runtime/             turn state machine and tool loop
      context/             compilation, usage, compaction
      tools/               model-facing schemas only
    src/preload/
    src/renderer/
      app/
      features/
        sessions/
        conversation/
        composer/
        workspace/
        git/
        browser/
        settings/
        extensions/
        tasks/
      components/
      i18n/
      styles/
    src/shared/
native/
  windows-sandbox/
supabase/
  migrations/
docs/
  DESIGN.md
  COMPATIBILITY.md
  SECURITY.md
  ACCEPTANCE.md
tests/
  unit/
  integration/
  e2e/
  fixtures/
```

## 5. 供应商、鉴权与模型

### 5.1 数据模型

`provider_connections`

- `id`
- `name`
- `base_url`，用户输入必须规范到以 `/v1` 结尾
- `protocol`: `anthropic_messages` / `openai_responses` / `openai_chat_completions`
- `auth_mode`: `bearer` / `x_api_key` / `api_key` / `custom`
- `custom_header_name`，仅 custom 模式
- `compatibility_fallback_enabled`，默认关闭
- `created_at`, `updated_at`

`provider_keys`

- `id`, `provider_id`, 用户可读标签
- `credential_ref`，只保存 Windows Credential Manager 引用
- `masked_hint`，例如尾 4 位或不可逆指纹，不是完整 Key
- `enabled`, `priority`, `cooldown_until`
- `never_reveal`，一旦开启只能替换
- 不保存明文 Key、DPAPI blob 或明文自定义敏感头

`models`

- `id`, `provider_id`, `model_id`
- `display_name`
- `context_window`
- `max_output_tokens`
- `input_modalities`: text / image / audio / video / file
- `output_modalities`
- `tool_calls`
- `parallel_tool_calls`
- `reasoning_levels`: 有序字符串数组
- `reasoning_wire`: 协议和模型特有的发送方式
- `anthropic_none_behavior`: `disabled` / `between_tools` / `reject`
- `compatibility_notes`
- `enabled`

一个供应商记录只对应一种协议。若同一网关支持 Responses 和 Chat Completions，建立两条连接记录，复用同一 Base URL 和 Key。

### 5.2 连接与模型发现

- Base URL 只接受到 `/v1`，自动移除末尾斜杠，不自动猜测或补全版本路径。
- 模型列表请求：`GET {base_url}/models`。
- 拉取结果只提供模型 ID；上下文、输出上限、模态、推理能力必须由用户确认或编辑。
- 拉取失败时保留手动新增入口，并显示完整 HTTP 状态、响应体和耗时。
- 同一供应商可添加任意多个模型。
- 连接测试发送真实最小请求，并展示状态码、响应正文、总耗时和 token 用量。
- 测试 Key、请求正文、响应正文不进入普通日志；API Key 始终脱敏。
- 连接测试依次验证所选鉴权方式；可选的兼容探测会尝试 Bearer、`x-api-key`、`api-key`，成功后保存探测结果，不在正式聊天中盲目反复切换。

### 5.3 多 Key 与故障切换

- 同一供应商可保存多把 Key，设置启用状态和优先级。
- 当前 Key 在连接卡片和会话状态区明确显示。
- 可配置故障切换：401、403、429、5xx、连接超时。
- 每把失败 Key 进入短时 cooldown，避免重复打到失效额度。
- 切换时在时间线写入可见系统事件，不能静默换账号。
- 自定义鉴权头默认关闭，添加时提示其安全含义。

### 5.4 三个协议适配器

统一接口：

```ts
interface ProviderAdapter {
  listModels(ctx): Promise<RemoteModel[]>;
  testConnection(input): Promise<ConnectionTestResult>;
  streamTurn(input, signal): AsyncIterable<NormalizedEvent>;
}
```

统一事件：

- `response_started`
- `reasoning_delta`
- `text_delta`
- `tool_call_started`
- `tool_call_arguments_delta`
- `tool_call_completed`
- `usage_updated`
- `response_completed`
- `response_interrupted`
- `response_error`

协议要求：

- OpenAI Responses 使用 `POST {base_url}/responses`，解析语义化 SSE 事件，处理 `response.output_text.delta`、函数调用参数事件和 `response.completed`。
- OpenAI Chat Completions 使用 `POST {base_url}/chat/completions`，解析 `choices[].delta`、`tool_calls`、`finish_reason` 和 usage。
- Anthropic Messages 使用 `POST {base_url}/messages`，处理 content blocks、thinking blocks、tool_use、tool_result 和 signature。
- 不依赖某家 SDK 的网关私有行为；请求和 SSE 解析由适配器自行实现，并保留原始错误诊断。
- Responses 与 Chat Completions 都采用“显式携带完整会话上下文”的方式，不依赖 `previous_response_id`，优先保证第三方网关兼容性。

官方接口依据：

- OpenAI Responses 流式事件：https://developers.openai.com/api/docs/guides/streaming-responses
- OpenAI Function Calling：https://developers.openai.com/api/docs/guides/function-calling
- OpenAI Responses 事件参考：https://developers.openai.com/api/reference/resources/responses/streaming-events
- Anthropic Thinking：https://platform.claude.com/docs/en/build-with-claude/thinking
- Anthropic Effort：https://platform.claude.com/docs/en/build-with-claude/effort

### 5.5 思考等级

统一等级集合为 `none`, `low`, `medium`, `high`, `xhigh`, `max`，但每个模型拥有自己的有序支持列表。

- 用户可手动输入该模型支持的等级名称。
- UI 根据该有序列表生成步进式拖动条，不假设所有模型都有六档。
- 模型明确标记“不支持 none”时，`none` 显示禁用状态并解释原因。
- 会话发起后不可在单个 turn 中途改变推理配置。
- Responses：按模型能力映射到 Responses 的 reasoning 配置。
- Chat Completions：仅在模型配置声明支持时发送兼容的 reasoning effort 字段。
- Anthropic Messages：
  - 发送 `thinking: { type: "adaptive", display: "summarized" }`。
  - 发送 `output_config.effort`，不发送 `budget_tokens`。
  - `none` 按模型的 `disabled`、`between_tools` 或“不支持”能力矩阵处理。
  - 工具调用往返中保留 thinking blocks 和 signature，不做文本重写。

## 6. 附件与多模态

- 单文件上限 25 MiB，用户消息附件随消息直接发送。
- 支持常见文本、代码、图片、音频、视频、PDF、Office 文件和压缩包等。
- 代码文件按文本内容发送；图片按协议支持转为 base64 或 URL。
- 音频只接受已有文件，不做应用内录音。
- PDF 和 Office 文件在发送前做本地文本抽取；需要视觉理解时，只有模型声明支持时才发送原文件或页面图像。
- 模型或协议不支持某模态时，UI 标记不兼容，并把本地文件路径作为文本附件提供给模型，不静默丢弃。
- 每个附件在本地以内容哈希存储，同一文件不重复占用空间。
- 发送前做协议预检：大小、模态、模型能力、上下文预算。

## 7. Agent 运行时

### 7.1 会话状态机

```text
idle -> preparing -> streaming -> tool_pending -> awaiting_approval
     -> executing_tool -> streaming -> completed
     -> compacting -> streaming
     -> interrupted / failed
```

每个会话保存：

- 当前运行状态
- 当前模型、思考档、权限模式、工作目录
- turn 序号和事件序号
- 工具调用状态
- 待处理用户消息队列
- 待处理审批
- 子 Agent 关系
- 最后检查点

### 7.2 并发与调度

- 同窗多会话，默认最多 5 个会话同时运行，可配置。
- 用户可在会话之间切换，后台会话继续运行。
- 子 Agent 默认并发 3，最大 8，可配置。
- 子 Agent 继承父会话的模型、权限、工作目录、Skills、MCP 和系统提示。
- 子 Agent 禁止继续创建子 Agent。
- 子 Agent 独立保存事件，但结果返回父会话；UI 可展开查看。
- 某个会话失败或被停止，不终止其他会话。

### 7.3 消息插入、排队和停止

- 运行中收到新消息时进入队列。
- 在当前工具执行完成、下一次模型请求之前插入，保持工具调用消息成对完整。
- 用户可选择立即停止当前 turn。
- 停止操作取消流式请求、终止该 turn 的沙箱子进程树、停止可控的浏览器动作，并把会话标记为已中断。
- 已经产生的文本和工具结果保留，不自动重跑。

### 7.4 上下文压缩

- 使用当前会话模型生成摘要，不切换到另一供应商。
- 达到上下文的 85% 时触发；给输出 token 和工具 schema 预留空间。
- 原始消息和工具事件永久保留，压缩摘要作为新的 checkpoint。
- 发送给模型的是“摘要 + 必要近期原文”，UI 可查看完整历史。
- 摘要模型调用失败时明确报错，可重试或切换模型，不伪造摘要。
- usage 优先使用供应商返回值；缺失时使用保守估算并标记为估算值。

### 7.5 恢复、归档与清理

- 应用崩溃或退出时，未完成 turn 标记为 `interrupted`，重启后要求用户手动继续。
- 所有会话默认永久保存在本地。
- 自动清理默认关闭；启用后可清理 X 天未打开的非归档会话，X 默认 30。
- 归档会话永不参与自动清理，可随时恢复。
- 会话标题在第一个 turn 完成后调用该会话模型生成；失败时截取首条用户消息。

## 8. 工具目录

| 工具组 | 首版能力 |
| --- | --- |
| 文件 | 列目录、glob、grep、读取、写入、补丁编辑、移动、删除、文件元信息 |
| 终端 | 真实子进程、PowerShell 默认、交互式用户终端、输出流、超时、取消和进程树终止 |
| Git | status、diff、log、branch、checkout、add、commit、merge、rebase、stash、push、pull；同时允许模型通过终端操作 Git |
| 网页 | 应用内 Chromium 打开、前进后退、点击、输入、按键、滚动、上传文件、截图、可访问性树 |
| 搜索 | Google、Bing、DuckDuckGo，以及供应商原生 web search |
| 图片 | 本地图片查看、缩放、元信息 |
| 计划 | 会话级计划/待办，持久化、可恢复 |
| 子 Agent | 创建、查看、等待、停止、返回结果 |
| 定时任务 | 创建、暂停、删除、立即运行 |
| MCP | 工具发现、调用、取消、OAuth、stdio/HTTP/SSE |
| 扩展 | 读取 Skills、执行已批准扩展脚本 |

所有工具都声明：

- 参数 schema
- 副作用范围：`none` / `workspace` / `filesystem` / `network` / `git` / `process` / `mcp_write`
- 是否需要审批
- 超时、取消、输出上限

工具输出使用结构化结果，单条结果设置大小上限；超限内容写入会话临时目录并返回路径和摘要。

## 9. 权限、批准与沙箱

### 9.1 两种模式

- 完全访问：Agent 可读写整个磁盘并执行任意命令，不逐次审批。
- 请求批准：Agent 的每次文件读取、文件写入、命令、MCP 写操作都进入审批队列。

用户自己在编辑器、文件树、Git 面板、终端输入的操作不触发 Agent 审批。

默认模式为“请求批准”。项目可覆盖全局默认。

### 9.2 审批选项

- 仅本次允许
- 在时间窗口内允许相同精确命令前缀或相同路径
- 本会话始终允许
- 本项目始终允许
- 拒绝
- 拒绝并填写原因

命令匹配只使用规范化后的精确前缀；路径匹配只使用规范化后的路径范围。不做 AI 相似度判断，也不允许用户自定义“相似命令”规则。

默认时间窗口 5 分钟，可配置。

### 9.3 工作区信任

- 第一次选择工作目录时立即询问是否信任。
- 信任记录绑定规范化路径和仓库根目录。
- 未信任仓库中的插件、Skills 脚本、Hooks、MCP 启动项不得自动执行。
- 内容哈希变化后重新询问。
- 全局启用状态可被项目设置覆盖。

### 9.4 危险命令

内置固定规则和用户可编辑规则：

- 默认禁止递归删除系统目录。
- 默认禁止格式化磁盘、分区破坏、关机、重启、引导配置破坏等命令。
- 识别 PowerShell 别名、大小写、路径拼接、编码命令、管道和重定向。
- 内置规则不可被项目级配置直接绕过，除非用户在明确提示后做出单项高风险确认。
- 命令白名单和黑名单均支持精确前缀与正则。

### 9.5 Windows 沙箱

请求批准模式下：

- Agent 子进程使用 restricted token / AppContainer、低权限 Job Object 和路径 ACL。
- 只允许已批准路径的读写；未批准路径在操作系统层拒绝。
- 进程树由 Job Object 统一终止。
- 标准输出、错误输出和退出码通过受限管道回收。
- 拦截并记录越界路径、符号链接/junction、路径穿越和重解析点绕过。
- 完全访问模式不启用该沙箱，但仍经过主进程工具入口。

实现基于 Codex 的 `windows-sandbox-rs` 和 `windows-sandbox-service` 设计做精简移植，不自行发明安全边界。Rust 工具链目前未安装，构建阶段必须安装 rustup，并把编译后的 helper 随安装包分发。

本机文件工具由 Main 的受控实现执行，使用规范化绝对路径、工作区边界检查、禁止穿越和可审计记录；任意子进程和脚本进入 Windows 沙箱。

## 10. Skills、Plugin、MCP 与 Hook

### 10.1 Skills

- 导入源可以是单个技能目录或包含多个技能的父目录。
- 递归发现目录中的 `SKILL.md`；没有 `SKILL.md` 的目录视为无效。
- 支持 YAML frontmatter、`description: >` 和 `description: |` 多行写法。
- 支持目录内脚本、资源文件和引用文档。
- 默认复制为本地副本，用户可选择软链接/junction；创建失败自动回退复制。
- 导入后不同步源目录。
- 支持全局启用、项目覆盖、会话开关。
- 示例验收路径：`C:\Users\ASUS\Desktop\taste-skill-main\skills\taste-skill`。

### 10.2 Codex Plugin

识别目录结构：

- `.codex-plugin/plugin.json`
- `skills`
- `mcpServers`
- `hooks`
- 可选的 `.mcp.json`

兼容规则：

- 支持本地目录导入，转换成应用管理的本地副本。
- 支持 manifest 中声明的 Skills、MCP、命令与 Hooks。
- MCP 类型 Hook 默认可用；shell Hook 默认禁用，每次启用和每次执行都需要明确批准。
- 插件自带 UI 扩展不在首版范围内。
- 插件按目录路径和内容哈希记录信任状态。
- 遇到无法映射的字段，不忽略到无提示；导入报告逐项列出“已支持 / 部分支持 / 不支持”。

### 10.3 MCP

- 支持 stdio、HTTP、SSE。
- 支持 OAuth PKCE，使用系统浏览器授权，回调只监听回环临时端口。
- 继承用户环境变量和代理，允许每个 server 覆盖环境变量。
- 项目级、全局级和插件级配置合并，项目级优先。
- 请求批准模式下每个 MCP 工具调用都审批；可“本会话始终允许该 MCP server”。
- 服务器启动、工具列表变化、OAuth 失效、超时和取消都有可见状态。

### 10.4 AGENTS.md

- 自动发现用户级、项目根目录和各级祖先目录中的 `AGENTS.md`。
- 按 Codex 兼容优先级注入，记录来源路径和作用范围。
- 会话设置中允许查看实际注入内容。

## 11. 浏览器与搜索

- 浏览器是应用内 Chromium `WebContentsView`，不是外置浏览器窗口。
- 每个工作区拥有独立持久化分区，可随时清理。
- 通过 Electron `webContents.debugger` 使用 CDP 执行点击、输入、滚动、上传和截图。
- 使用 `Accessibility.getFullAXTree` 读取可访问性树。
- 截图进入会话附件，可被模型再次读取。
- 页面下载属于文件写入，必须经过权限策略。
- 用户可以在浏览器面板直接操作；Agent 操作会在时间线中显示。
- 搜索支持 Google、Bing、DuckDuckGo；网关原生 web search 由协议适配器启用。
- 搜索供应商顺序可配置，失败时自动回退并在 UI 说明。

## 12. 本地数据与存储

默认目录：`app.getPath("userData")`

```text
MingshenHarness/
  mingshen.db
  attachments/
  logs/
  crash-dumps/
  skills/
  plugins/
  browser-profiles/
  temp/
```

SQLite 使用 WAL 和迁移版本。核心表：

- `app_settings`
- `workspaces`
- `workspace_trust`
- `providers`
- `provider_keys`
- `models`
- `sessions`
- `session_events`
- `session_checkpoints`
- `turns`
- `tool_calls`
- `approval_requests`
- `attachments`
- `skills`
- `plugins`
- `mcp_servers`
- `scheduled_tasks`
- `telemetry_outbox`
- `update_state`

设计选择：

- 会话采用追加式 `session_events`，支持完整重放和崩溃恢复。
- 额外维护投影表和 FTS5 索引，支持全文搜索。
- 原始会话永不因上下文压缩而被截断。
- API Key 只在凭据存储中；数据库仅保存引用和不可逆指纹。
- 用户数据不上传云端。

## 13. 界面与视觉

### 13.1 信息架构

单窗口多会话：

- 左侧：会话树、归档、搜索、工作区切换、运行状态。
- 顶部：打开的会话标签，可拖拽；运行中、等待审批、中断状态明确显示。
- 中央：Agent 时间线，展示回答、思考摘要、工具调用、diff、审批和错误。
- 右侧可折叠工作区：文件树、编辑器、diff、图片预览、浏览器。
- 底部可折叠面板：用户终端、任务输出、Git 状态。
- 底部输入区：模型、思考拖动条、权限模式、工作目录、附件、系统提示、MCP 开关、Skills 开关。
- 状态区：token 用量、上下文占用、总耗时、工具耗时；用户可逐项关闭。

常用视图：

- 会话
- 工作区
- Git
- 浏览器
- Skills
- MCP
- 定时任务
- 设置

设置分组：

- 通用
- 外观与语言
- 供应商与模型
- 权限、批准与沙箱
- 工具与安全规则
- MCP
- Skills 与 Plugin
- 会话与存储
- 定时任务
- 更新
- 诊断与隐私
- 关于、隐私政策、使用条款

### 13.2 视觉方向

不采用终端拟物、营销首页或仿冒某一家 Agent 的视觉。使用硬朗几何分割、细线、序号、状态灯和工业标记感。

字体：

- 中文正文：Noto Sans SC
- 西文正文：Noto Sans SC Latin fallback
- 代码与指标：IBM Plex Mono

两套暗色主题：

日间“朱墨”：

- 背景 `#090A0B`
- 面板 `#101214`
- 浮层 `#15181B`
- 分隔线 `#292D31`
- 主文字 `#F2F1ED`
- 次文字 `#A5A7AA`
- 强调 `#E33A2E`
- 强调悬停 `#FF5344`
- 成功 `#63B08E`
- 警告 `#D6A34B`
- 错误 `#FF5A4F`

夜间“青弧”：

- 背景 `#050B0E`
- 面板 `#08131A`
- 浮层 `#0C1B24`
- 分隔线 `#12303C`
- 主文字 `#E4F7FA`
- 次文字 `#84A4AE`
- 强调 `#35D6E8`
- 次强调 `#4F8DFF`
- 成功 `#54C8A4`
- 警告 `#D9B25E`
- 错误 `#FF6B62`

约束：

- 圆角上限 6px；工具卡片仅用于单条工具调用、审批和模态框。
- 不使用装饰性渐变球、光斑或大面积玻璃拟态。
- 界面文字不宣传功能，不使用营销式口号。
- 状态不能只靠颜色表达。
- 所有主要流程可键盘操作。
- 动效 120-180ms，尊重减少动效设置。
- 控件使用 Lucide 图标；工具按钮、模式切换、数值配置采用符合语义的控件。

### 13.3 语言

- 默认简体中文。
- 设置内可切换英文。
- 技术协议名、模型 ID、工具名保持英文。
- 所有 UI 文案集中管理，不允许散落硬编码。

## 14. Git、编辑器与终端

- CodeMirror 6 提供文件编辑、语法高亮、搜索和保存。
- 文件树支持显示 `.gitignore` 文件、隐藏文件开关、搜索、拖拽、新建、重命名、删除。
- 多标签打开文件和 diff。
- 并排 diff 使用 CodeMirror Merge；提供逐块接受/拒绝的编辑基础能力。
- 图片使用内置查看器，PDF 使用 Chromium 预览；不支持的可视格式显示元信息。
- 用户终端使用真实 PTY，PowerShell 为默认 shell。
- Agent 命令在请求批准模式下进入沙箱；完全访问模式直接运行。
- Git 面板提供状态、暂存、取消暂存、提交、分支创建/切换、合并、变基、stash、拉取和推送。
- Git 面板中的用户主动操作无需额外 Agent 审批。

## 15. 定时任务与托盘

- 托盘常驻，显示空闲、运行中、等待审批、错误状态。
- 关闭主窗口时弹出选择：“最小化到托盘” / “彻底退出”。
- 有启用中的定时任务时，退出对话框明确说明彻底退出会停用全部任务。
- 定时任务同时保存到本地数据库和 Windows Task Scheduler。
- 最小化到托盘时任务保持启用，由托盘后台进程执行。
- 彻底退出时停用全部 Windows 计划任务并取消活动运行；下次正常启动时恢复用户未暂停的计划。
- 请求批准模式下，后台任务遇到审批会等待并显示托盘通知，不自行放行。
- 完全访问模式下按计划直接执行。
- 支持创建、暂停、恢复、立即运行、删除和查看历史。

## 16. 自动更新

- 内置版本来自安装包 `package.json` 的 `1.0.0`。
- 版本格式严格为 `x.x.x`，每段 1-3 位数字。
- 启动后检查一次，之后每 24 小时检查；设置页可手动检查。
- 仅当远端版本大于本地版本时弹窗。
- 弹窗包含版本、简短说明、发布日期和“打开下载页”按钮。
- 下载页使用系统默认浏览器打开，不要求直链。
- 设置页始终显示“当前已是最新版本”或可用版本。
- 不调用 Electron autoUpdater 静默下载，避免与网页分发方式冲突。

## 17. Supabase 设计

应用使用用户提供的 publishable key 调用公开只读 RPC 和受限写入 RPC。

### 17.1 版本表与 RPC

`public.mingshen_app_releases`

- `id`
- `version`，CHECK 符合 `^\d{1,3}\.\d{1,3}\.\d{1,3}$`
- `download_page_url`
- `notes`，限制长度
- `published_at`
- `is_active`
- `created_at`

安全策略：

- 表启用 RLS。
- `anon` 和 `authenticated` 不授予直接 SELECT、INSERT、UPDATE、DELETE。
- 仅暴露 `mingshen_get_latest_release()` security definer 函数。
- 函数按版本数字段降序返回一条最新发布记录。
- 函数只返回 version、URL、notes、published_at。

### 17.2 日志与崩溃

`public.mingshen_telemetry_events`、`public.mingshen_crash_reports`

- 只有匿名 install ID、应用版本、Windows 版本、错误代码、脱敏堆栈、模块和时间戳。
- 不接受 prompt、回答、代码、路径、命令、供应商 URL、API Key 或原始 dump。
- 客户端不能 SELECT。
- 通过受限 RPC 校验字段、长度和 JSON 结构后写入。
- 默认保留 30 天。

SQL 文件在批准计划后写入 `supabase/migrations/0001_init.sql`，由用户手动在控制台执行。

## 18. 日志、崩溃与隐私

- 本地日志按天滚动，默认保留 30 天。
- 首次启动询问是否允许自动上传诊断日志，默认关闭。
- 发生错误后询问“上传 / 不上传”，并提供“以后自动上传”的显式开关。
- 崩溃 dump 仅保存在本地，不上传。
- 上传前执行统一脱敏，移除密钥、认证头、用户路径、prompt、回答、命令输出和仓库内容。
- 设置页提供导出诊断包，导出前显示内容清单。
- 隐私政策和使用条款先提供稳定入口和占位页面，正文由用户后续补写。

## 19. 安装、发布与系统兼容

- electron-builder NSIS 每用户安装，不需要管理员权限。
- `appId`: `com.mingshen.harness`
- `productName`: `Mingshen Harness`
- `publisherName`: `Ming`
- 首版 x64，不签名。
- 安装到用户本地程序目录，不写系统服务，不启用开机启动，除非用户显式设置。
- 应用清单使用 `asInvoker`，不请求管理员权限。
- 自动更新只打开浏览器。
- 安装包和 helper 使用稳定文件名、正常版本资源和标准 Electron 打包方式，减少杀毒误报。
- 未签名程序仍可能触发 SmartScreen 或企业安全策略，这是首版已知风险。

## 20. 测试与验收

### 20.1 自动化测试

单元测试：

- SSE 分帧、多行 data、断线、UTF-8 边界。
- 三个协议适配器的请求映射和事件归一化。
- 工具 schema 和参数校验。
- 命令前缀、路径规范化、junction/符号链接和路径穿越。
- 危险命令规则。
- 审批作用域和过期时间。
- 模型版本比较和格式校验。
- Skill frontmatter、`description: >`、`description: |` 和多级发现。
- Codex Plugin manifest 兼容映射。

集成测试：

- SQLite 迁移、事件重放、崩溃恢复、FTS 搜索、清理任务。
- 多 Key 冷却和切换。
- 上下文压缩触发和原历史保留。
- MCP stdio/HTTP/SSE 生命周期。
- Windows Credential Manager 读写和“不可再次查看”。
- Windows sandbox 路径允许/拒绝。
- Task Scheduler 创建、停用和恢复。
- 更新检查只读取最新版本。

端到端测试：

- 新建供应商、拉模型、手动补齐能力、真实发送。
- 双会话并发、消息排队、停止和继续。
- 文件编辑、终端命令、Git 操作、diff 查看。
- 审批、时间窗口复用、拒绝并反馈。
- 附件、图片、音频、超限文件。
- 浏览器打开、点击、输入、滚动、上传、截图、可访问性树。
- 重启恢复旧会话和归档恢复。
- 中英文切换、两套主题、指标开关。
- 安装包在干净 Windows 10/11 虚拟机上安装和运行。

### 20.2 真实供应商验收

使用用户提供的最小额度测试账号，测试：

- `GET /v1/models`
- `gpt-6.1-sol`
- `/v1/responses`
- `/v1/chat/completions`
- 流式返回
- 工具调用
- 错误回显
- Key 不进入源码、数据库、日志或最终交付物

测试 Key 只通过临时环境变量或 Windows Credential Manager 注入，不写入仓库、fixture、截图或会话导出。

Anthropic `/v1/messages` 需要单独提供一个 Anthropic-compatible 端点做真实验收；若暂时没有，首版先使用协议 fixture 和兼容网关测试，最终发布前再补真实链路。

### 20.3 最终验收场景

1. 在干净 Windows 11 上安装未签名包。
2. 首次启动选择语言、遥测策略。
3. 导入示例 Skill，确认识别 `SKILL.md`。
4. 添加 OpenAI-compatible 供应商，保存两把 Key，测试连接，拉取模型。
5. 给 `gpt-6.1-sol` 配置上下文、最大输出、模态和思考等级。
6. 打开一个真实 Git 仓库，完成信任确认。
7. 在请求批准模式下要求 Agent 读取文件、运行测试、修改代码、查看 diff。
8. 逐项批准、拒绝一次并填写原因、使用 5 分钟命令前缀授权。
9. 同时启动两个会话，其中一个排队新消息并停止。
10. 用聊天协议和 Responses 协议分别完成一次真实调用。
11. 上传代码、图片、PDF，验证不兼容时的路径回退。
12. 打开浏览器，完成点击、输入、截图和可访问性树读取。
13. 导入一个本地 Codex Plugin，验证 Skills 和 MCP 映射。
14. 创建定时任务，最小化托盘验证运行，彻底退出验证任务停用。
15. 重启应用，恢复旧会话、归档会话和中断会话。
16. 检查更新，验证只弹新版本、默认浏览器打开网页。
17. 触发一次受控错误，验证上传选择、脱敏和 30 天清理。

## 21. 实施里程碑

### M0 工程基座

- Monorepo、Electron、React、TypeScript、构建、测试框架。
- SQLite schema 与迁移。
- typed IPC、日志、配置、凭据桥。
- Windows 10/11 开发环境和 Rust helper 构建链。

### M1 供应商与模型

- 三个协议适配器。
- 模型拉取、手动配置、多 Key、连接测试、故障切换。
- 思考等级、Claude adaptive thinking、附件编码。

### M2 Agent 与工具

- turn 状态机、流式事件、工具调用、排队、停止、压缩。
- 文件、终端、Git、搜索、计划、子 Agent。
- 审批引擎、危险命令规则、工作区信任。
- Windows 沙箱 helper。

### M3 主工作区 UI

- 单窗口多会话、时间线、浮动审批、输入区。
- 文件树、编辑器、diff、终端、图片、Git 面板。
- 设置、国际化、两套主题、指标显示。

### M4 扩展与浏览器

- Skills 导入与运行。
- Codex Plugin 兼容层、MCP、Hooks。
- WebContentsView 浏览器、CDP 自动化、搜索适配器。

### M5 系统集成

- 定时任务、托盘、退出策略。
- 自定义更新检查、Supabase RPC。
- 日志、崩溃报告、隐私入口、诊断导出。

### M6 稳定化与发布

- 安全审计、性能、恢复、异常场景。
- 真实模型验收、干净系统安装测试。
- NSIS 安装包、第三方许可证、发布说明。
- 冻结 1.0.0 构建。

## 22. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 首版功能面过大 | 内部里程碑拆分，但只发布一个完整 RC；每个功能都有验收项 |
| Windows 沙箱实现复杂 | 以 Codex Apache-2.0 实现为基线，先过沙箱专项测试再接 Agent |
| 无代码签名可能触发 SmartScreen | 用户已接受；使用标准 Electron 打包、用户级安装、稳定 helper 名，并记录残余风险 |
| 第三方网关协议不标准 | 适配器自解析、连接测试回显、兼容探测、能力矩阵 |
| 模型元数据不完整 | 只自动导入 ID，上下文/输出/模态/推理必须用户确认 |
| 搜索页面结构变化 | 浏览器适配器与多搜索源回退，允许供应商原生搜索 |
| Codex Plugin 没有统一运行契约 | 先输出格式探测和支持矩阵，不承诺插件 UI |
| 并发会话与取消导致状态错乱 | 事件追加、检查点、Job Object、每会话独立 runner |
| 未签名 helper 被安全软件误报 | 最小权限、无隐藏服务、可审计进程、稳定签名信息；正式版可后续签名 |

## 23. 明确不在首版

- 云端同步、团队协作、远程设备控制。
- 公开插件市场。
- 插件自定义 UI 渲染。
- 应用内录音。
- 费用显示与预算计费。
- macOS、Linux 发布包。
- 代码签名。
- 自动下载并静默安装更新。

## 24. 已确认的默认值

1. 完全访问模式仍保留致命命令硬保护，默认拦截递归删除系统目录、磁盘格式化、关机/重启和引导破坏；用户可做一次性高风险确认。
2. 请求批准模式下，已批准的命令允许联网，但文件系统受路径 ACL 限制。浏览器、搜索和远程 MCP 的网络由主进程独立代理。
3. “分享会话”采用本地能力：复制 Markdown、导出 `.md`/`.json` 或生成本地分享包，不上传云端。

## 25. 系统提示词

系统提示词源文件位于 `apps/desktop/resources/prompts/`：

- `safety.md`
- `core.md`
- `tools.md`
- `coding.md`
- `subagent.md`
- `compaction.md`
- `title.md`
- `runtime.md`

安全层不可由会话设置关闭。用户自定义系统提示只能附加任务要求，不能取消凭据保护、审批、沙箱或灾难性命令拦截。组合与测试规则见 `docs/SYSTEM_PROMPTS.md`。
