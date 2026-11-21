# Crow5 与 Mingshen Harness 功能对比

- 调研时间：2026-11-20 14:09:30 Asia/Shanghai
- Mingshen Harness 基线：1.3.4
- 调研性质：公开资料研究，不包含 Crow5 安装包实测、性能基准或私有实现分析

## 1. 结论摘要

截至调研时间，Crow5 官网线上内容显示最新桌面版为 **Crow5 Desktop
v1.3.31，发布于 2026-11-18**。官网提供 macOS、Windows x64 和 Linux 三类平台
共五个下载入口。

Crow5 相对 Mingshen Harness 的主要优势，不是某一个模型或单项办公能力，而是把以下
能力做成了连续、易发现的桌面工作流：

1. 固定角色多 Agent 协同指挥台与质量复核状态。
2. 覆盖文件、命令和历史会话的统一命令面板。
3. 可直接交互的多标签终端。
4. 面向方案、图片和媒体创作的超级工作站与无限画布。
5. 官方策划的 Skill Hub 和项目级 MCP 安装市场。
6. Memory Bank、源流档案与本地快照等历史整理入口。
7. 行级评论、草稿优化和输入规则等贴近日常编辑的交互。

Mingshen Harness 1.3.4 在以下方面已有更强或更明确的实现：

1. CodeAgent、WorkAgent、ChatAgent 三种执行模式及 ChatAgent 硬权限隔离。
2. Word、Excel、PowerPoint、PDF 的原生创建、受控旧稿编辑、结构检查和可选 Office
   重算/渲染验证。
3. 本地 SkillCreator、PluginCreator、插件 SDK、插件市场、Hook 与 MCP 声明。
4. 后台 SubAgent、无固定十分钟总运行期限及最多十条自动消息队列。
5. 自选模型供应商、四种 API 协议、模型级能力和子 Agent 独立模型配置。
6. 可编辑计划、依赖、断点、检查点、测试/Lint/类型检查验证闭环。
7. 原生沙箱、细粒度审批、自动审批模型、工作区边界和危险操作保护。
8. 快捷 Chat、全局快捷键、托盘、本地 Headless API/SDK 与更完整的 GitHub/浏览器
   工作台。

因此，两者不是同一种完成度上的单线竞品。Crow5 更接近
“创作、知识、办公、开发统一入口”；Mingshen Harness 更接近
“本地优先、可审计的 Coding/Work/Chat Agent 工作台”。

## 2. 证据口径

本文把结论分为四类，避免把宣传数字、社区解读和运行时事实混在一起。

| 标记 | 含义 | 使用方式 |
| --- | --- | --- |
| 官方正文 | Crow5 官网或官方产品文档直接公开的能力说明 | 可作为“产品公开支持此工作流”的证据，不等同于独立质量评测 |
| 官方自述 | 官网首页展示的 500+ Skills、200+ 模型等聚合数字 | 记录原口径，不据此推断当前实际可安装数量或真实表现 |
| 第三方资料 | 社区文章、社区技能整理或其他非官方来源 | 仅用于理解用户感受和工作流，不用于确认 Crow5 当前版本 |
| 未核实 | 页面需登录、正文未加载、仅见搜索摘要、未安装实测或未做独立基准 | 不进入确定的事实结论 |

本报告以 2026-11-20 实际请求到的 Crow5 线上首页和官方文档数据文件为主。线上首页响应
的 `Last-Modified` 为 `2026-11-18 11:36:38 GMT`。官方产品文档正文的数据版本为
`v6.46.0`，正文最近更新日期为 **2026-09-15**。后者包含较完整的 v1.3.22 时期功能
说明，但不应自动假定其中每个细节都与 v1.3.31 完全一致。

## 3. Crow5 当前公开版本

### 3.1 版本与平台

官方首页当前公开：

- Crow5 Desktop v1.3.31，发布日期 2026-11-18。
- macOS 16+ Universal。
- Windows x64。
- Linux x86_64 DEB、RPM、AppImage。
- 五个安装包入口。

搜索引擎缓存此前仍显示 v1.3.30。该缓存晚于线上 `Last-Modified` 的发布信息，因此本文
采用官网实时正文中的 v1.3.31，不把搜索摘要当成当前版本。

### 3.2 v1.3.31 官方更新内容

官方首页当前更新日志列出：

- 新增“做方案”工作站，内置 24 套模板，支持风格切换、分节修改、撤销、讲解和导出。
- 图片、视频和方案支持批量选择与批量删除。
- 方案生成提供实时进度和内容预览，工具调用可折叠。
- 新增 `gpt-6.2-astra`、`gpt-6.2-sol` 专属通道适配。
- 优化 GPT 多轮缓存、带图请求、重启后缓存续接和长回答截断兼容。
- 完善 Claude 推理档位、缓存、思考签名及 Anthropic 原生接口。
- 统一新版做图工作站，优化图片本地存储和内存占用。
- 视频生成在部分断网或合盖异常后可“再查一次”。
- 修复项目初始化 Git 后历史会话列表消失的问题，并增强页面崩溃恢复。

以上属于官方发布说明，不代表第三方独立复验或质量基准。

### 3.3 官方公开功能面

| 模块 | 官方公开内容 |
| --- | --- |
| AI 会话 | Build/Plan、模型、Skills、思考档位、自定义指令、权限、Review、消息导航、推理摘要 |
| 多 Agent | 固定八角色阵容、总控拆解与点将、并行执行、QA 复核、质量状态、实时事件流和游戏化协同视图 |
| Auto Drive | 对当前项目最近会话发送“推进下一步”提示 |
| 命令面板 | `Ctrl+Shift+P` 同时检索文件、命令和历史会话 |
| 终端 | 内置真实 Shell，多终端标签 |
| Memory Bank | 全局规则内核、跨项目会话源流档案、搜索、归档、恢复和永久删除 |
| 超级工作站 | 创作、知识、办公、开发四类 Agent 应用入口 |
| 无限画布 | 图片生成、素材包、参考图、标记和按批注改图 |
| Skill Hub | 官方策划目录、安装/卸载、来源和 SHA-256 校验 |
| MCP 市场 | 项目级严选服务、固定版本安装、连接和重连 |
| 本地快照 | 自动/手动节点、按项目或单文件恢复 |
| Review | Git/Branch/会话/上一轮范围、diff 与行级评论 |
| 快捷键 | 命令、会话、视图、模型、权限等分组快捷键和冲突提示 |

## 4. Mingshen Harness 1.3.4 基线

本报告中的 Mingshen 状态以仓库当前实现和文档为准，不以规划稿代替已完成能力。

| 能力域 | 当前仓库依据 |
| --- | --- |
| 产品定位与功能概览 | [README.md](../README.md) |
| Code/Work/Chat 模式、Work 办公和插件说明 | [README.md](../README.md)、[USER_GUIDE.md](USER_GUIDE.md) |
| 工作区、计划、快照、权限和长命令 | [USER_GUIDE.md](USER_GUIDE.md) |
| Agent、Skill、Plugin、MCP 和命令面板 | `apps/desktop/src/main/`、`apps/desktop/src/renderer/src/` |
| 本地代码索引和符号关系 | [code-index-service.ts](../apps/desktop/src/main/agents/code-index-service.ts) |
| 工具权限和执行边界 | [tool-registry.ts](../apps/desktop/src/main/tools/tool-registry.ts) |
| 本地插件开发接口 | [LOCAL_PLUGINS.md](LOCAL_PLUGINS.md) |

需要特别区分：

- Mingshen 右侧“终端”是真实命令执行记录视图；长命令可通过管道读取和发送 stdin，但
  文档明确声明它不是完整 PTY。
- Mingshen 的 Review 已覆盖本轮保存的 diff 和 Git 工作区，但当前没有 Crow5 公开的
  本地 diff 行级评论闭环。
- Mingshen 已有 OpenAI 官方技能仓库、Composio 社区技能仓库和本地插件市场，但没有
  Crow5 式由本项目官方策划并统一治理的 Skill/MCP 精选服务目录。
- Mingshen 已有运行快照、文件检查点和 Git 恢复，核心回退能力不完全落后，但 Crow5
  的时间线组织和单文件回退交互更产品化。

## 5. 能力对比

状态说明：`覆盖` 表示当前公开能力相近；`部分` 表示底层能力存在但产品入口、范围或
安全边界不同；`未见等价能力` 仅表示当前仓库或公开文档中未找到等价实现，不推断底层
绝对无法通过扩展实现。

| 能力 | Crow5 官方公开口径 | Mingshen 1.3.4 | 判断 |
| --- | --- | --- | --- |
| 产品定位 | 创作、知识、办公、开发统一入口 | Coding、Work、Chat 三模式本地工作台 | 产品方向不同 |
| 操作系统 | macOS、Windows x64、Linux | Windows 10/11 x64 | Crow5 领先 |
| Agent 模式 | Build/Plan，另有 Agent 配置 | Code/Work 共享工作区，Chat 独立且禁用本地工具 | Mingshen 边界更明确 |
| 模型接入 | 内置模型、免费模型口径、账号/API 接入和自定义兼容服务 | 自选供应商，多 Key，多模型，四协议渲染 | 生态与自由度互换 |
| 子 Agent 模型 | 当前协同统一使用所选模型，Agent 内切换模型为锁定占位 | 子 Agent 可独立配置供应商和模型 | Mingshen 领先 |
| 多 Agent 编排 | 八角色、自动拆解、点将、并行、QA、质量状态、实时事件和协同视图 | 后台 SubAgent、并发上限、任务树、父 Agent 可继续工作 | 底层接近，Crow5 呈现更完整 |
| 计划管理 | Todo 由 AI 更新，用户主要查看进度 | 可编辑步骤、依赖、断点、暂停、恢复和版本检查 | Mingshen 领先 |
| 代码库理解 | 官方称全工程级语义索引、跨模块关系与上下文预测 | 本地增量 AST、符号、引用、调用图和 LSP | 均覆盖，技术口径不同 |
| 命令导航 | 文件、命令、历史会话统一命令面板 | 有搜索、斜杠命令、文件列表和执行记录，无统一面板 | Crow5 领先 |
| 终端 | 真实 Shell、多标签、用户直接输入 | 命令执行记录和管道 stdin，不是完整 PTY | Crow5 领先 |
| 创作工作台 | 方案模板、图片、视频、音乐、海报和无限画布 | WorkAgent 专注 Office/PDF；未找到媒体生成或无限画布工具 | Crow5 领先 |
| Office 交付 | 官方入口覆盖文档、表格、PPT；公开资料未展示同等细粒度编辑与验证 | DOCX/XLSX/PPTX/PDF 创建、旧稿编辑、结构检查、可选 COM 重算/渲染 | Mingshen 更深入 |
| Skill 管理 | 官方策划 Skill Hub、SHA 校验和全局安装 | OpenAI/Composio 市场、本地导入、按需发现、手动引用、SkillCreator | Mingshen 自主性更强，Crow5 官方治理更强 |
| 插件 | 公开资料重点为 Skill、MCP 和超级工作站 | 原生插件清单、SDK、校验、安装、更新、启停、MCP/Hook 声明 | Mingshen 领先 |
| MCP | 项目级严选市场、一键安装与连接状态 | stdio/HTTP、OAuth、密钥、启停和 MCP 调用 | Mingshen 手工配置更强，Crow5 市场更易用 |
| Diff Review | Git/Branch/会话/上一轮、行级评论 | 本轮 diff、Git 工作区和 GitHub PR 集成 | Crow5 的本地审阅交互领先 |
| 项目组织 | 多项目、Git 分支/worktree 分组、未读状态 | 按工作文件夹分组，有 worktree 执行方式 | Crow5 的视图组织领先 |
| 项目记忆 | 全局规则、跨项目源流档案和可视化 Memory Bank | 原生 Memory、TencentDB 本地核心、项目日记/偏好和检索 | Mingshen 记忆深度更强，Crow5 汇总入口更集中 |
| 项目回退 | 自动/手动快照、全项目和单文件恢复 | 运行快照、安全恢复、受控文件检查点和 Git 恢复 | 核心能力接近 |
| 连续任务 | Auto Drive 一键推进最近会话 | 手动恢复计划、压缩后续跑、十条自动队列 | 用途不同，Crow5 更轻量 |
| 快捷 Chat | 公开官网未找到同等独立小窗 | `Ctrl+M` 快捷 Chat、10 分钟续期会话、置顶和自定义快捷键 | Mingshen 领先 |
| 本地自动化 | 定时任务在官方手册中标为即将开放 | 已有定时任务、托盘和本地运行 | Mingshen 领先 |
| 外部集成 | MCP、Skill、模型提供商、内置终端 | GitHub、GitHub OAuth、内嵌 Chromium、stdio/HTTP MCP、Headless API/SDK | Mingshen 更广 |
| 安全边界 | 权限三态、自动接受权限、Review、安全护栏 | 本地沙箱、细粒度权限、自动审批模型、工作区边界、危险命令保护 | Mingshen 更明确 |
| 更新与生态 | Token 套餐、设备激活、免费模型口径和官方模型目录 | BYOK，无免费模型或订阅额度 | Crow5 商业生态更完整 |

## 6. 优先功能差异

优先级按“对现有 Mingshen 用户的日常收益、实现边界和与现有架构的复用程度”排序，
不是对 Crow5 全部功能的机械复制顺序。

### P1：高频、低歧义、可直接复用现有能力

#### 6.1 统一命令面板

Crow5 用 `Ctrl+Shift+P` 一次搜索文件、命令和会话。Mingshen 已有会话搜索、文件树、
自定义斜杠命令和执行记录，但入口分散。

建议目标：

- 一个统一检索器覆盖文件、会话、命令、Agent、Skill 和 Plugin。
- `Ctrl+P` 聚焦文件，`Ctrl+Shift+P` 聚焦命令和会话。
- 结果必须标明来源和权限边界；选择 Skill 或 Plugin 只产生本轮引用，不扩大工具权限。

### P1：高频编辑闭环

#### 6.2 可交互多标签终端

Mingshen 当前命令能力足以运行构建、测试和长任务，但右侧“终端”不是完整 PTY。Crow5
公开支持真实 Shell 和多终端标签。

建议目标：

- 终端作为独立 PTY 通道，不复用模型工具输出。
- 每个标签绑定当前工作区和权限模式。
- 用户主动输入与 Agent 命令分别记录，避免把用户终端输入误写为 Agent 工具结果。
- 保持现有工作区边界、进程停止和退出结算能力。

#### 6.3 Review 行级评论与范围切换

Crow5 支持从 diff 选中行添加评论，并把它作为下一步输入上下文；Review 可在 Git、
Branch、会话和上一轮之间切换。Mingshen 有本轮 diff、Git 工作区和 PR 集成，但没有
同等本地行级评论闭环。

建议目标：

- 在当前 diff 中添加行级评论草稿，用户确认后再送入输入框。
- 评论携带文件、旧/新行号和 diff 版本，避免文件已变化后错位。
- 增加上一轮、当前会话、Git 工作区和分支范围，但不改变 Git 写入安全边界。

### P2：可复用现有计划、SubAgent 和市场能力

#### 6.4 Auto Drive“继续推进”

Crow5 从左侧运行入口向最近会话发送推进提示。Mingshen 已有计划续跑、队列和恢复点，
但没有面向当前项目的一键继续入口。

建议目标：

- 只对最近的活动会话生成“读取真实计划/工具结果后推进下一步”的任务。
- 有未完成审批、问题等待、失败屏障或配置变化时暂停，不自动跳过。
- 明确区分“继续执行已批准计划”和“创建新任务”。

#### 6.5 多 Agent 协同状态台

Mingshen 的底层已经有后台派发、并发限制、任务树、子 Agent 输出和父 Agent 并行工作。
缺少的是类似 Crow5 指挥台的任务拆解、角色责任、质量状态和实时事件总览。

建议目标：

- 先展示真实事件和任务依赖，不使用动画伪造工作进度。
- 允许用户看到每个子 Agent 的模型、任务、审批、文件范围和输出。
- 质量状态必须来自测试、审查和验证证据，不能只由另一个模型给出主观评分。
- 可不复制固定动漫角色和游戏化场景，先做功能性协同台。

#### 6.6 官方策划 MCP 目录

Crow5 把 MCP 安装做成项目级严选目录，并管理固定版本、连接和重连。Mingshen 当前
MCP 配置能力更完整，但用户需要自行寻找条目并填写服务信息。

建议目标：

- Mingshen 维护经过审核的 MCP 清单、版本、来源和 SHA。
- 一键安装仍生成显式项目配置，不能绕过当前密钥、OAuth、信任和审批规则。
- 优先收录官方、开源、许可证明确且可验证发布包的服务。

### P2：统一信息和历史入口

#### 6.7 跨项目记忆中心

Mingshen 的记忆深度和本地性较强，但入口按工作区、会话和设置分散。Crow5 的 Memory
Bank 把全局规则、跨项目任务档案和回收站集中在一个界面。

建议目标：

- 先做统一索引、搜索、来源、修改时间和回收站，不必先复制游戏化场景。
- 全局规则必须可关闭、可审计，并低于系统/安全/用户当前指令。
- 项目记忆继续保持独立存储，跨项目汇总不能暗中合并原始数据。

#### 6.8 Git 分支/worktree 会话视图

Mingshen 已支持 worktree 执行，但会话主要按工作文件夹组织。Crow5 公开支持按 Git
分支/worktree 分组和项目未读状态。

建议目标：

- 在现有文件夹分组下增加可选的分支/worktree 二级视图。
- 保留 worktree 与父工作区的记忆继承和删除规则。
- 不把 worktree 视图做成新的数据模型或复制会话。

### P3：产品线或生态型投入

#### 6.9 方案、图片和媒体工作站

Crow5 的超级工作站、无限画布和 24 套方案模板是一次完整的产品线扩展。Mingshen 的
WorkAgent 已能制作高质量 Office/PDF，但当前没有内置图片、视频、音乐生成或无限
画布工具。

建议目标：

- 可先做“方案工作站”，复用现有文档、PPT、模板和项目文件能力。
- 图像生成、标注改图、视频和音乐应独立立项，不把普通 MCP 工具描述包装成内置能力。
- 所有生成结果都应保存真实模型、提示、来源、费用和失败状态。

#### 6.10 输入与推理辅助

Crow5 公开提供草稿优化、临时自定义指令、项目级语气和英文推理中文化。Mingshen 已有
Agent/项目指令和推理展示，但没有全部日常快捷入口。

建议目标：

- 草稿优化必须预览后再替换，不直接发送。
- 推理翻译属于显示层，不得覆盖原始 reasoning 或改变供应商续接状态。
- 临时指令需要明确标记有效期，不能升级为持久系统指令。

#### 6.11 跨平台与内置模型生态

Crow5 已提供 macOS、Windows、Linux，并公开免费模型、Token 套餐和设备激活生态。
Mingshen 当前为 Windows x64、BYOK、无免费额度。

建议目标：

- 跨平台属于架构级投入，应先处理路径、进程、沙箱、Office COM、原生依赖和全局快捷键
  的平台抽象，再讨论 Linux/macOS 发布。
- 自选供应商仍是 Mingshen 的核心原则。若未来增加托管模型，需要单独处理密钥、
  计费、隐私、区域和供应商直连边界。

## 7. Mingshen Harness 的明确优势

这些能力在当前仓库和文档中有直接实现依据，不应为了模仿 Crow5 而弱化。

### 7.1 三种 Agent 模式的权限边界

CodeAgent 和 WorkAgent 共享工作目录、会话和历史，ChatAgent 使用独立会话页，只开放
用户主动上传的只读附件、联网搜索和网页读取，不加载本地命令、MCP、Skills、Hooks 或
子 Agent。该边界比普通聊天/编程模式切换更容易做安全审计。

### 7.2 WorkAgent 的 Office 闭环

WorkAgent 不仅能生成文件，还覆盖旧稿受控修改、源文件 SHA 校验、结构化 Excel 操作、
PPTX 原生对象、Word 原生公式、公式重算状态和可选页面渲染检查。Crow5 官方公开资料
强调了办公和创作入口，但没有公开同等细粒度的失败区分和安全验证语义。

### 7.3 本地插件开发接口

Mingshen 已具备 SkillCreator、PluginCreator、Harness Plugin API、插件清单校验、
本地市场、安装副本、更新、启停、MCP 声明和受控 Hook。Crow5 的 Skill Hub 与 MCP
市场更集中，但公开资料未展示同等的本地插件开发 SDK 工作流。

### 7.4 后台子 Agent 与消息队列

Mingshen 的 `spawn_subagent` 是后台派发，父 Agent 可继续独立工作，再用
`wait_subagents` 收取结果。SubAgent 没有固定十分钟总运行期限，但仍受单次请求超时、
并发和取消规则约束。主会话另有最多十条 FIFO 自动消息队列。Crow5 当前多 Agent
统一使用所选模型，Agent 内模型切换在官方手册中仍是锁定占位。

### 7.5 计划与验证闭环

Mingshen 的计划支持用户编辑、依赖、断点、版本冲突、暂停和恢复；CodeAgent 还要求
连续失败后更换策略、分页恢复大工具输出，并用测试、Lint、类型检查和 diff 审查收敛。
Crow5 Todo 当前更偏只读进度展示。

### 7.6 安全、本地化和外部集成

Mingshen 具备 Windows 原生/Docker 隔离、细粒度审批、自动审批模型、致命命令保护、
工作区边界、GitHub 集成、内嵌 Chromium、本地 Headless API/SDK、快捷 Chat、托盘和
定时任务。Crow5 的公开产品页展示了权限控制和安全护栏，但本报告没有安装包级安全
对比证据，不能据此判断双方实际安全强度。

## 8. 官方自述、第三方信息与未核实内容

### 8.1 官方自述数字

官网首页公开写有：

- 500+ 内置 Skills 应用。
- 200+ 主流模型。
- 20+ 厂商。
- Skills 页面展示“已安装 500 项”。

这些是聚合口径，缺少当前版本可逐一枚举的完整清单。官方产品文档 Skill Hub 页面在
2026-09-15 的快照中列出 68 个当前技能，并分为 31 个编程类、15 个工作类、22 个
项目类。两者可能分别描述累计安装、历史生态、内部能力或首页演示状态，不能直接认定
当前有 500 个可安装条目。

200+ 模型和 20+ 厂商同样属于官方自述，本报告没有逐项核对所有模型、地区、价格、
协议兼容性和稳定性。

### 8.2 官方注明为占位或受限的能力

官方产品文档明确显示：

- “手机操控电脑”仍为永久禁用的即将开放按钮。
- 定时任务在 Crow5 左侧栏中仍标为即将开放。
- 多 Agent 当前统一使用用户选择的模型。
- 协同台内每个 Agent 的模型切换仍锁定。
- Memory Bank 中只有“核心水晶”和“源流档案”等部分装置可用，其他装置仍为静态标识。
- 需账号连接的若干 MCP 服务仍显示即将开放。

这些内容不能作为 Crow5 已完整提供的功能。

### 8.3 第三方资料

一篇第三方文章把可视化记忆描述为“意图、过程、结果、上下文”的结构化记忆卡片，并称
支持回溯、搜索、复用和导出；文章同时称跨会话关联仍在开发中。见
[第三方记忆功能分析](https://expectopatronus00.github.io/post/dy-fdpDisviqWg/dy-fdpDisviqWg.html)。

该文章发布于 2026-06-21，早于当前官方手册更新时间，也没有给出可复验的产品版本或
完整截图证据。它与当前官方 Memory Bank 描述部分相似，但“记忆卡片”和“跨会话关系”
不能直接当作 v1.3.31 已确认功能。

另一份社区仓库整理把 Crow5 的 `qa`、`qa-only`、`browse`、`office-hours` 描述为四种
典型工作流，见
[第三方技能工作流整理](https://github.com/TheQin0630/Agent-Flow/blob/main/docs/crow5_skills_workflow.md)。
该资料适合理解技能使用方式，但不是 Crow5 官方规范，也不能证明全部 Skill Hub 条目
的行为或质量。

第三方短视频摘要所引用的 v1.3.29 描述未纳入本报告事实结论。搜索结果摘要、视频标题
和未打开的视频不能替代官方版本记录。

### 8.4 未核实边界

本报告没有完成以下验证：

- 未安装 Crow5 v1.3.31，未逐项点击当前客户端。
- 未执行 Crow5 的多 Agent、Office、记忆、MCP、Skill 和终端实机测试。
- 未登录 Crow5 用户中心，未核对套餐价格、额度、地区限制和订单状态。
- 未做 Crow5 与 Mingshen Harness 的同任务耗时、Token、成功率或产物质量基准。
- 未检查 Crow5 安装包签名、依赖、网络行为、数据存储和私有实现。
- 未验证第三方文章描述是否仍适用于当前版本。
- 未覆盖 Windows DPI、辅助技术、复杂企业代理、断网恢复和跨平台矩阵。

因此，“Crow5 公开提供某入口”不代表它在该入口上优于 Mingshen Harness，也不代表
Mingshen Harness 无法通过已有插件或工具实现类似工作流。

## 9. 建议实施顺序

### 第一阶段：立即提升日常效率

1. 统一命令面板。
2. 可交互多标签 PTY 终端。
3. Review diff 行级评论和范围切换。

这三项可复用现有文件、会话、命令、Git 和权限基础设施，能够形成明确的用户收益，且
不需要新增模型费用。

### 第二阶段：强化现有 Agent 工作台

1. Auto Drive 风格的项目推进入口。
2. 基于真实 SubAgent 事件的多 Agent 状态台。
3. Mingshen 官方策划、可审计的 MCP/Skill 目录。
4. 跨项目记忆索引与回收站。

第二阶段应优先复用计划、任务树、审批、市场、Memory 和会话归档，不另建平行数据体系。

### 第三阶段：战略型产品能力

1. 方案模板工作站。
2. 图片/标注改图与更广的媒体创作。
3. Git 分支/worktree 会话视图。
4. 跨平台适配。
5. 可选的内置模型或套餐生态。

这些项目涉及新工具、新存储、平台抽象或商业服务，适合单独立项并设定独立验收标准。

## 10. 来源

### 10.1 Crow5 官方来源

以下页面均在 2026-11-20 实际请求或在浏览器数据文件中读取。

| 来源 | 用途 |
| --- | --- |
| [Crow5 官网](https://crow5.com/) | v1.3.31、平台、首页能力、500+ Skills、200+ 模型和 v1.3.31 更新日志 |
| [产品文档](https://crow5.com/product-docs-v6.38.0.html) | 系统操作手册入口和模块目录 |
| [AI 会话工作区](https://crow5.com/product-docs-v6.38.0.html#module-05) | Build/Plan、模型、Skills、自定义指令、Review 和推理摘要 |
| [Review 面板](https://crow5.com/product-docs-v6.38.0.html#module-06) | 变更范围、diff 和行级评论 |
| [多 Agent 协同](https://crow5.com/product-docs-v6.38.0.html#module-08) | 固定角色、拆解、并行、复核和质量状态 |
| [Auto Drive](https://crow5.com/product-docs-v6.38.0.html#module-09) | 推进最近会话下一步 |
| [命令面板](https://crow5.com/product-docs-v6.38.0.html#module-11) | 文件、命令和历史会话统一搜索 |
| [设置](https://crow5.com/product-docs-v6.38.0.html#module-12) | 提供商、MCP、Skills、模型和快捷键 |
| [快捷键](https://crow5.com/product-docs-v6.38.0.html#module-13) | 命令面板、终端、Review 和 Agent 快捷键 |
| [Memory Bank](https://crow5.com/product-docs-v6.38.0.html#module-15) | 全局规则和源流档案 |
| [超级工作站](https://crow5.com/product-docs-v6.38.0.html#module-16) | 创作、知识、办公和开发入口 |
| [无限画布](https://crow5.com/product-docs-v6.38.0.html#module-17) | 图片生成、素材和标注改图 |
| [Skill Hub](https://crow5.com/product-docs-v6.38.0.html#module-18) | 官方技能市场、SHA 校验和安装 |
| [MCP 插件大世界](https://crow5.com/product-docs-v6.38.0.html#module-19) | 项目级 MCP 市场 |
| [本地快照](https://crow5.com/product-docs-v6.38.0.html#module-20) | 项目时间线和单文件恢复 |
| [官方文档数据 v6.46.0](https://crow5.com/assets/crow5-product-docs-data-v6.46.0.js) | 产品文档正文、更新时间、模块、FAQ 和 Skill Hub 数量 |
| [多 Agent 模型 FAQ](https://crow5.com/product-docs-v6.38.0.html#faq-10) | 当前多 Agent 使用同一模型 |
| [技能自动调用 FAQ](https://crow5.com/product-docs-v6.38.0.html#faq-18) | 单 Agent 和多 Agent 的技能按需调用口径 |
| [Crow5 用户中心](https://user.crow5.com/console) | 官方账号、设备和服务入口；本报告未登录核对套餐细节 |

### 10.2 第三方来源

| 来源 | 使用限制 |
| --- | --- |
| [可视化记忆第三方分析](https://expectopatronus00.github.io/post/dy-fdpDisviqWg/dy-fdpDisviqWg.html) | 2026-06-21 社区整理；只用于理解记忆卡片概念，不作为当前版本事实 |
| [Crow5 技能工作流整理](https://github.com/TheQin0630/Agent-Flow/blob/main/docs/crow5_skills_workflow.md) | 社区对四种技能的再整理；不证明官方 Skill Hub 全量行为 |

### 10.3 Mingshen Harness 本地依据

- [README.md](../README.md)
- [USER_GUIDE.md](USER_GUIDE.md)
- [LOCAL_PLUGINS.md](LOCAL_PLUGINS.md)
- [DOCUMENT_TOOLS.md](DOCUMENT_TOOLS.md)
- [CODE_AGENT_RESEARCH_1.3.3.md](CODE_AGENT_RESEARCH_1.3.3.md)
- [OFFICE_AGENT_RESEARCH_1.3.3.md](OFFICE_AGENT_RESEARCH_1.3.3.md)
- [T3_CODE_RESEARCH_1.3.3.md](T3_CODE_RESEARCH_1.3.3.md)
- [code-index-service.ts](../apps/desktop/src/main/agents/code-index-service.ts)
- [tool-registry.ts](../apps/desktop/src/main/tools/tool-registry.ts)

## 11. 最终判断

如果以“用户打开桌面端后能多快发现和串联完整工作流”为指标，Crow5 当前在命令导航、
交互式终端、创作入口、多 Agent 可视化和官方市场治理方面更主动。

如果以“本地控制、权限边界、Office 交付、插件开发、计划恢复、后台委派、自选模型和
可验证执行闭环”为指标，Mingshen Harness 1.3.4 的基础更扎实。

最值得优先补齐的不是 Crow5 的品牌角色、像素场景或首页宣传数字，而是以下三项可复用
现有架构的高价值差距：

1. 统一命令面板。
2. 可交互多标签终端。
3. Review diff 行级评论。

完成这三项后，再根据真实使用数据决定是否投入 Auto Drive、协同状态台、跨项目记忆
中心、创作工作站或跨平台。
