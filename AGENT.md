# Mingshen Harness 开发交接与维护记录

最后核对日期：2026-11-12（Asia/Shanghai）。适用工作区版本：1.3.2。

本文供其他智能体、开发者和新对话接续工作，记录开发经过、已确认约束、实际代码位置、验证边界和打包方法。它不是功能全部完成、无漏洞或安装包已验收的证明。任何接续工作先核对当前源码、用户最新指令和 `git status`，不要直接照搬早期计划。

## 1. 接手时先做什么

1. 阅读本文和 [README.md](README.md)，涉及安全时阅读 [SECURITY.md](SECURITY.md)。
2. 执行 `git status --short`，了解已有修改；本交接时工作区有大量未提交修改和未跟踪文件，包含有效实现，不是可直接清理的废料。
3. 按任务阅读对应模块及相邻测试。优先小范围修复，沿用现有 Electron、React、TypeScript 和 pnpm 结构。
4. 先阅读 [1.3.2 验证记录](docs/VALIDATION_1.3.2.md)；历史行为参考 [1.3.1 验证记录](docs/VALIDATION_1.3.1.md)、[1.3.0 验证记录](docs/VALIDATION_1.3.0.md)、[1.2.9 验证记录](docs/VALIDATION_1.2.9.md)、[1.2.8 工作区验证](docs/VALIDATION_1.2.8.md)、[1.2.7 计划生命周期与附件验证](docs/VALIDATION_1.2.7.md)、[1.2.6 任务工作台与执行验证](docs/VALIDATION_1.2.6.md)、[1.2.5 菜单、首次引导、日志与上下文验证](docs/VALIDATION_1.2.5.md)、[1.2.4 验证](docs/VALIDATION_1.2.4.md)、[1.2.3 验证记录](docs/VALIDATION_1.2.3.md)、[1.2.2 验证记录](docs/VALIDATION_1.2.2.md) 和 [1.2.1 全量记录](docs/FULL_VALIDATION_1.2.1.md)，区分历史结果、模拟验证、真实集成和未验证项目。
5. 完成后记录改了什么、执行了什么、结果及剩余边界；变更协议、打包、数据结构或安全边界时同步本文和对应文档。

当前 1.3.2 新增 Gemini / DeepSeek 模型体系与缓存续接适配，见第41节、[供应商缓存说明](docs/PROVIDER_CACHING.md)及[1.3.2验证记录](docs/VALIDATION_1.3.2.md)；表格单元格富内容和原生可编辑公式见第42节；第四种供应商协议 Google Gemini 原生 GenerateContent 及 schema8 数据迁移见第43节，原有历史迁移保留。1.3.1 修复文件栏滚动、光轨会话标题与按钮重叠，以及未配置诊断器的虚假成功记录，见第33节；光轨对话偏移、详情开合及长历史性能见第34节；输入框Markdown/LaTeX粘贴显示及设置开关见第35节；跨会话及正常重启保留待发送草稿见第36节；原生Word公式、Markdown、图表及模板填充见第37节和 [文档工具说明](docs/DOCUMENT_TOOLS.md)；设置中按文件夹批量归档、恢复和删除会话见第38节；供应商长按排序及各模型入口星标分组见第39节。历史证据及边界见 [1.3.1 验证记录](docs/VALIDATION_1.3.1.md)，不要将前轮数字当作新增功能验证。

1.3.0 包含内置 DOCX/PPTX/PDF、按 profile 配置子模型、原生 Responses 状态、图片工具、管道命令、分页读取/受控并发、父会话验证转交与 Token Saver 质量默认值；随后补充模型首次预填、K/M 数值输入、供应商连接编辑和 TencentDB 记忆库。最新工作区记忆设置及模型语义提取见第30节，取代历史离线规则摘录；官方提示词逐字对齐与真实请求核验见第31节。第二套“光轨”界面保留默认“简约”，按已确认预览重构为独立工作台，独立结构见第26节，最新材质打磨及主界面模型/供应商标签见第27节；第24节为首次接入历史。选择自动保存、重载或重启生效，共用全部业务功能。运行信息展开/收起、完整诊断与命令详情见第25节，并在独立结构中回归。各轮实际结果和未验证边界见 [1.3.0 验证记录](docs/VALIDATION_1.3.0.md)。主会话窗口15%的压缩输出预算及触顶恢复、TencentDB 本地记忆核心及项目二选一、工具参数流与 UTF-16 读写修复、缓存前缀优化与诊断、供应商缓存配置、同模型压缩复用、提问/修改冲突通知、Token Saver、执行链、项目记忆、自动重试及剪贴板图片附件见 [1.2.9 验证记录](docs/VALIDATION_1.2.9.md)；下方历史版本结果不能替代本轮验证。

文件名说明：用户指定的主要交接文件是本 `AGENT.md`；根目录 `AGENTS.md` 是自动发现入口，指向本文。不要复制维护两份正文。

仓库忽略规则及新仓库准备检查见第44节，面向公开仓库访客的 README 调整见第45节；首页提供产品能力、快速开始与开发入口，内部留档过程继续保留在本文及版本验证记录中。

### 必须保留的仓库约束

- 不擅自重建项目、迁移框架、移动模块、创建替代仓库或改变包管理器。
- 不执行 `git reset --hard`、`git checkout --`、`git clean -fd` 等丢弃现有工作的命令；不把已有未跟踪源码当临时文件删除。
- 未经明确请求不提交、推送、发布 GitHub Release、不执行云端 SQL、不生成或安装正式安装包。`--dir` 解包验证与正式 NSIS 安装包是两个不同操作。
- 用户最新指定版本为 **1.3.2**；本轮交付实验版，不生成安装包。已生成的1.3.0/1.3.1安装包及发布SQL保留真实历史元数据，不代表包含当前源码。
- 保留用户已确定的水青色原子图标。不要替换成旧红色 M 或 Electron 默认图标。
- 不将真实 API Key、OAuth Secret、Token、Cookie、个人数据库、日志、截图或会话内容加入代码、文档和测试夹具。历史对话中的测试 Key 不得再次使用。
- 不通过关闭防护、加白名单、改系统 ACL、删除 DLL、修改官方二进制或跳过哈希校验来“修复”打包与隔离。
- Windows 删除/移动操作先核对绝对路径和范围，使用 `-LiteralPath`；不要跨 shell 拼接删除命令。不能清空整个 AppData、临时目录、用户数据或 BuildCache。
- 不编辑 `node_modules`、构建产物、上游运行时来代替修改仓库内脚本和源码。

## 2. 产品身份与已确认方向

| 项目 | 当前约定 |
| --- | --- |
| 产品名 / Agent 名 | Mingshen Harness / Mingshen |
| 发布者 / 维护主体 | Ming / 新哲文院算法社 |
| 平台 | Windows 10/11 x64 桌面 GUI；原生 MXC 需要兼容的较新 Windows 11，旧系统选择 Docker |
| 应用版本 | 根 `package.json`、桌面 `package.json`、`apps/desktop/src/shared/release.ts` 中的 1.3.2 |
| 协议修订号 | `apps/desktop/src/shared/release.ts` 中的 `2026-11-04.3`，与应用版本分别管理；新增备用审批/压缩供应商的数据发送说明，旧版用户重新同意 |
| 分发 | 当前用户 x64 NSIS、首版不签名；1.2.6起确认后后台下载/校验ZIP并在会话结束后启动安装器，旧网页链接手动打开 |
| 语言与外观 | 默认简体中文，支持 English；默认“简约”保留白色日间/近黑石墨夜间，第二风格“光轨”为冰白矿青/深墨青；风格重载或重启生效，日夜即时切换，原子图标保留 |
| 使用对象 | 内部员工；本地优先、自定义供应商，不附赠免费模型或 ChatGPT 订阅 |
| 供应商示例名 | `Chatgpt Pro`；仅示例名称，不是 OpenAI 官方服务声明 |
| GitHub | `https://github.com/SkyH1aa/MingshenHarness`；公开 OAuth Client ID 在 `release.ts`，不要添加 Client Secret |
| 开源许可 | 当前 package license 为 `UNLICENSED`，未见根 LICENSE；Apache-2.0 是建议而非已经授予的许可 |

用户要求借鉴 Codex、Zcode、OpenCode 和开源 Trae Agent 的工作流，但不能做明显的品牌克隆。Trae Agent 开源仓库不等于完整 Trae 商业 IDE，不得混为同一个能力来源。

### 用户已确定的主要行为

- 一个供应商使用一种协议，一般 Base URL 输入到 `/v1`；Gemini 原生使用 `https://generativelanguage.googleapis.com/v1beta` 和 `x-goog-api-key`，Chat 兼容接口使用 `https://generativelanguage.googleapis.com/v1beta/openai`。DeepSeek 官方 Chat 可使用根地址、`/v1` 或 `/beta`，Responses 使用根地址或`/v1`，Anthropic 使用`/anthropic/v1`。应用分别追加 `/messages`、`/responses`、`/chat/completions` 或 `/models/{model}:streamGenerateContent?alt=sse`，不要重复添加端点。
- 同一供应商有多把 Key、多模型；每个模型单独配置上下文、输出 token、模态、工具能力及有序思考等级。Anthropic 使用 adaptive thinking / effort，不手填 token budget。
- 模型菜单按供应商折叠；会话按工作文件夹折叠，可在文件夹下创建会话；多会话可并行运行。
- 主聊天区展示真实工作进展、命令、文件变更和可展开 diff；文件链接在右侧预览，网站链接以默认浏览器打开。
- 工具活动与最新轮次的修改记录应保留；同一轮避免重复 Agent 标识和重复修改汇总。
- 附件入口在输入框加号菜单，支持拖入；剪贴板图片可在输入框 Ctrl+V 或右键粘贴，单文件上限 25 MiB；不支持的内容不得假装已经解析。
- 权限只有完全访问和请求批准；完全访问仍保留致命命令硬保护，请求批准不能失败后静默回退宿主执行。
- 子 Agent 不再递归生成子 Agent；默认并发 3、可配置 1 至 8；Plan 为只读配置。
- 本地导入 Skills/插件，不做隐式同步；技能目录或子目录必须有 `SKILL.md`，插件兼容 `.codex-plugin/plugin.json`。
- OpenAI 官方技能仓库与 Composio 社区仓库分开显示，每页最多 20 个；MCP 市场外链保留。
- Chrome/Edge 入口是应用内 Chromium 页面与独立 profile，不是操控用户已安装的系统浏览器；GitHub 是 API/MCP 集成，不是 GitHub 网页书签。
- 对话、配置和工作记录默认本地保存；工具或模型请求按用户配置传输必要上下文。费用不显示，只展示可配置的 token、上下文和耗时指标。
- 业务确认使用应用风格弹窗；Windows 原生通知、系统选文件和托盘等 OS 集成另行处理。
- 首次使用须分别勾选服务协议、隐私政策、免责协议，至少阅读五秒后进入内置手册；协议更新后重新确认。

这些是维护约束，不能据此把尚未实现或未验收的行为宣称为已完成。

## 3. 开发周期与主要决策

以下按需求演进记录，无法可靠还原的阶段不编造日期。已确认的代码和验收记录主要集中在 2026-11-02 至 2026-11-03。

| 阶段 | 工作与决定 | 接手注意事项 |
| --- | --- | --- |
| 需求确认 | 确定 Windows GUI、自定义多协议供应商、本地历史、审批、工具、插件、MCP、并行 Agent、更新与安装包；初始目标版本 1.0.0 | 原始范围见 `IMPLEMENTATION_PLAN.md`，不等于全部已按原设计实现 |
| 可运行原型 | 建立 Electron/React/TS 主进程、IPC、模型 SSE、文件/命令工具、SQLite 和实验启动入口 | 用户要求真实调用与改文件；后续回归使用本地模拟模型避免私人 Key 和费用 |
| 基础修复 | 修复重复审批、审批延迟、DOCX 外部解析依赖、启动找不到 pnpm 等问题 | 文档读取走内置解析器；审批 broker 与界面各有职责 |
| 交互与视觉迭代 | 设置分类、供应商折叠、会话目录分组、侧栏收回、Markdown/KaTeX、附件、消息复制/编辑/重试、自定义弹窗 | 原子图标、日夜配色和现有布局已确认，勿恢复旧主题或默认图标 |
| 工作轨迹与扩展 | 真实活动、流式文件变更、持久化 diff、右栏预览、嵌入浏览器、GitHub 集成、双技能市场及 MCP | 实时准备进度不等同于磁盘写入已完成；缺凭据服务不算真实调用通过 |
| Agent 能力扩展 | Agent profiles、只读 Plan、`@` 子会话、项目指令、LSP/Formatter、快照、Git 撤销、worktree、轨迹、本地 API/SDK/ACP | 安全模式会禁用部分宿主扩展能力；不要为“对齐功能”绕过隔离 |
| 1.2.1 版本 | 原生 MXC 与 Docker 可选隔离、依赖入口、完整错误诊断、中英文、内置协议/手册、自定义标题栏、托盘与更新 | Docker/WSL2/Embiody 是独立运行时，不得声称都已封装进 EXE |
| 通知 | 完成未读标记、数字角标、Windows 通知、快捷回复、失败草稿恢复 | 保持原会话权限；并发测试窗口会影响焦点和角标断言 |
| 图标修复 | 独立实验 EXE、固定应用 ID/通知 CLSID、窗口与快捷方式图标一致 | 历史 Electron 快捷方式 ID 冲突不能仅靠换 PNG 解决 |
| 全量审查 | 修复发送准备竞争、取消/删除/退出顺序、长任务追踪、回复重复、worktree 仓库误复用、协议流与 Hook 保护 | 详细证据见 `FULL_VALIDATION_1.2.1.md`；不以“全量”表示无 Bug 保证 |
| 打包排障 | 依次遇到 Electron ZIP 解压 `vulkan-1.dll`、暂存及二次复制 `d3dcompiler_47.dll` 的 EPERM；单次成功与加重试均不足 | 当前修复是 LocalAppData 构建、两阶段 EXE 优先、构建进程内复制兼容和哈希核对 |
| 1.2.1 打包验收 | 同一个 `.cmd --dir` 入口连续两次通过，12 项打包测试、21 项解包桌面验收通过 | 属于历史 1.2.1 证据，尚无 NSIS 安装/卸载/升级已验收的证据 |
| 1.2.2 内测反馈 | 文件夹加号直接继承最近主会话配置；修复隔离模式和文档编辑的虚假诊断；书本入口加入中英文内嵌更新日志 | 不迁移数据库、不修改协议修订号、不复制消息或审批授权；117 项测试、6 组桌面流程、21 项资源预检通过，详见 `VALIDATION_1.2.2.md` |
| 1.2.2 文档同步 | 三份中英文协议与手册版本头统一为当前应用 1.2.2；协议修订号保持 `2026-11-03.3` | 仅版本与文档维护，不改实质条款、生效日期或重新同意门槛；打包前仍需重新运行资源预检 |
| 1.2.3 内测修复 | 快照与轨迹布局、设置导航溢出、GitHub 先显示验证码及恢复等待；修正子 Agent 提示词深度并支持后台委派与等待结果 | 自动、手动 `@` 和继续子会话统一受应用并发上限控制，停止父任务取消子任务，禁止递归；文档与打包版本同步，实际验收见 `VALIDATION_1.2.3.md` |
| 1.2.3 会话体验补充 | 实时编辑与 diff 默认折叠；发送即思考状态、独立最近运行耗时；左栏重命名/置顶/归档/删除；设置可配置保留期和恢复归档；修复分行公式 | 默认永不删除，归档及受保护会话不参与清理。只同步手册/日志，不再改三协议、修订号或 schema；本轮源码构建不等于此前解包 EXE 已更新 |
| 1.2.3 审批补充 | 旧回执不再清掉新审批，主进程同步待审批；项目完全访问立即生效；可选模型自动审批；时分秒；退出计数；默认 750 轮工具 | 自动审批保留隔离，异常等待人工，Shell Hook/显式手动策略不自动放行。使用 app_settings，不迁移 schema。协议修订至 `2026-11-04.1`，应用仍 1.2.3；验证见报告末尾 |
| 1.2.3 上下文压缩 | 接通 85% 阈值、下一轮/工具边界触发、压缩提示、自动续跑、全局及会话模型选择 | app_settings 持久摘要和用量，原始历史保留，工具调用成对处理，停止不存半截摘要；失败可见且不在同运行反复重试。独立供应商的数据范围使协议修订至 `2026-11-04.2`，版本仍 1.2.3 |
| 1.2.3 主备模型补充 | 固定 JSON 审批提示、明确格式兼容与脱敏返回预览；审批/压缩各一个可选备用模型 | 主调用失败/无效结果时备用一次，有效拒绝不切换；停止/手动决定/审批配置变更取消整条审核。备用压缩从原文重做，双失败保留原文/人工。协议修订 `2026-11-04.3`，应用仍 1.2.3 |
| 1.2.3 分支与命令 | 桌面/API 共用完整上下文 fork、手动 `/compact`、统一斜杠菜单、CTX 详情和默认 Agent 说明 | 分支独立于子会话；复制有效摘要并重映射消息 ID，不复制临时授权/任务/快照。手动压缩无工具启动、可停止/恢复；使用现有主备模型。仅更新手册与日志，应用/协议不变 |
| 1.2.3 CTX 恢复 | 打开会话恢复有效用量；缺失、旧形状、分支及模型切换提供本地估算 | 不额外调用模型/启动 MCP，计数绑定模型/配置/历史；未打开会话按需恢复，不在启动时全量重算。版本/协议/schema 不变 |
| 1.2.4 设置输入焦点 | 修复主界面审批同步/后台刷新改变 onClose 回调后重复聚焦设置关闭按钮 | SettingsDrawer 打开时仅初始化焦点/应用信息一次，Esc 监听独立维护；中英文协议只改适用版本，政策修订与 schema 不变。专项证据见 `VALIDATION_1.2.4.md` |
| 1.2.4 历史问题导航 | 右侧问题标记、本地悬停概要、点击跳转、阅读位置、长历史和键盘 | QuestionNavigator 只读取所选聊天本地消息；ChatView 跳转取消待执行底部跟随，不改模型上下文/审批/schema。只同步手册、日志与交接 |
| 1.2.4 新建 Agent 选择 | 去掉新建窗口对 subagent 角色的额外过滤，四个默认配置均可创建独立会话 | 默认优先已启用 primary，否则回退可用项；不改现有角色/只读/权限。parentSessionId 决定实际子任务身份，相关测试见1.2.4报告 |
| 1.2.4 自建 Agent 与审批恢复 | 全部 enabled 自建配置可直接选择并显示用途；审批/提问均同步完整状态，增加提交和恢复入口 | 不按builtin/role/hidden过滤直接菜单；旧回执/结束事件不得直接删面板，未确认五秒恢复控件，异常不放行。版本/协议/schema不变 |
| 1.2.4 主动结构化提问 | ask_user支持1–3题、单选/多选、最多4个标题描述选项与系统Other，真实回答后续跑 | 旧单题和文字API兼容；root各配置可用，实际委派child向父报告疑问；不代答、不扩大授权。中英文手册/日志同步，无schema或协议变更 |
| 1.2.4 滚动控制 | 暂停跟随后提供一次回到底部、恢复自动跟随两个独立入口 | 一次跳转不恢复跟随；恢复后上滑再暂停。保留手动回底部恢复，避免内容收缩及排队frame误改状态，仅同步手册/日志/交接 |
| 1.2.4 资源管理器入口 | 左侧会话省略号菜单打开该会话工作目录，运行中及未选中会话均可用 | 独立session:open-workspace IPC按ID查询真实会话；仅打开现存本地目录，无目录禁用，失败应用内提示；不改权限/历史/schema |
| 1.2.5 菜单与首次引导 | 多类浮层按触发位置限高/内部滚动，修复滚动即关闭；首次三协议和手册跨重启续接 | 共享floating-panel定位/生命周期，保留日夜与折叠供应商；完整consent判定、manualPending状态，不清用户DB或按安装目录重置；协议修订/schema不变 |
| 1.2.5 后台审批通知 | Windows原生待审批通知及批准单次/拒绝，复用完成通知激活分发 | 前台当前会话只显示inline；后台/托盘/其他会话提醒，自动审查转人工时可提醒；旧请求/重复激活不放行新操作，独立开关、预览与声音控制；版本/协议/schema不变 |
| 1.2.6 任务工作台 | 父子折叠/右键、持久计划与任务树、六个专用配置、JS/TS索引、读取去重、显式验证、批量审批、写入冲突和恢复点 | 314项源码测试、13组新桌面流程及既有回归通过，详见1.2.6报告；实验版已重建，未打包，schema6及协议修订号不变 |

### 历史文档的优先级

事实核对顺序：用户最新指令、当前源码/配置、最近实际运行结果、本文与新版验证报告、早期规划。

`PRODUCT.md`、`IMPLEMENTATION_PLAN.md`、能力差距表和早期实验报告有历史描述，例如“无原生 helper”“仅 Docker”“1.0.0”“Agent Host utilityProcess”“完整 PTY”“不开放本地服务”等，与当前实现不完全一致。不要按这些条目重新创建一套目录或逆向改回旧实现。先检查代码，再有针对性地更新文档。

## 4. 当前仓库结构与修改入口

项目是 pnpm workspace，目前应用在 `apps/desktop`。`pnpm-workspace.yaml` 声明 `packages/*` 不表示必须创建该目录。

| 路径 | 职责 |
| --- | --- |
| `apps/desktop/src/main/index.ts` | Electron 启动、窗口、IPC 注册、信任/协议门槛、桌面集成及退出收尾 |
| `apps/desktop/src/main/app-services.ts` | 服务组装、事件分发和异步销毁，关闭数据库前等待任务结束 |
| `apps/desktop/src/main/chat/` | 发送、Agent 工具循环、取消、标题、活动/汇总、子 Agent、删除与退出协调 |
| `apps/desktop/src/main/sessions/` | 会话配置/工作区继承、父子归档与恢复、按最后打开时间自动清理 |
| `apps/desktop/src/main/providers/` | 供应商/Key/模型管理，四种协议请求与 SSE、原生续接、完整错误和脱敏 |
| `apps/desktop/src/main/storage/` | SQLite、Repository、safeStorage 密文；当前 schema version 8，保留本地FTS/游标分页/变更序号及全部历史迁移 |
| `apps/desktop/src/main/permissions/` | 审批、提问 broker、会话内前缀与路径授权 |
| `apps/desktop/src/main/tools/` | 文件、文档、命令、搜索、patch、自定义工具和致命命令保护 |
| `apps/desktop/src/main/documents/` | 文档读取/OCR、结构化作者 schema、内存生成 DOCX/PPTX 与隔离 Chromium PDF 打印 |
| `apps/desktop/src/main/workspace/` | 原生沙箱、Docker、文件边界、快照、Git 撤销和 worktree |
| `apps/desktop/src/main/agents/` | Agent 配置、指令发现、项目配置、斜杠命令、Formatter、LSP |
| `apps/desktop/src/main/extensions/` | 本地 Skill/插件扫描、复制/链接导入、信任及 Hook |
| `apps/desktop/src/main/mcp/` | 内置/自定义 stdio 与 HTTP MCP、凭据、发现、调用、OAuth |
| `apps/desktop/src/main/browser/` | 应用内浏览器及 GitHub API/Device Flow |
| `apps/desktop/src/main/marketplace/` | GitHub 技能仓库读取和安装 |
| `apps/desktop/src/main/desktop/` | 协议/托盘、运行时依赖、更新、完成/审批/提问与修改冲突通知 |
| `apps/desktop/src/main/schedules/` | 应用存活期间的定时任务扫描和销毁 |
| `apps/desktop/src/main/server/` / `trajectories/` | 可选回环 API、分享与轨迹 |
| `apps/desktop/src/preload/index.ts` | 受限桌面 API bridge；与 shared IPC 和 main 成对维护 |
| `apps/desktop/src/shared/` | domain、IPC、桌面事件、版本和错误翻译 |
| `apps/desktop/src/renderer/src/App.tsx` | 主状态与事件接收、会话/工作区协调 |
| `apps/desktop/src/renderer/src/components/` | ChatView、SessionSidebar、SettingsDrawer、ModelPicker、WorkspacePanel、BrowserDock 等 |
| `apps/desktop/src/renderer/src/i18n/` / `styles.css` | 中英文、运行时翻译和 UI 样式 |
| `apps/desktop/resources/prompts/` | core、coding、safety、runtime、tools、title、subagent、compaction 提示词 |
| `apps/desktop/resources/documents/` | PDF 页面渲染、离线中英文 OCR 与旧 DOC 解析 worker；随包资源，不从工作区加载 |
| `apps/desktop/resources/native/` | 固定版本原生 executor、PROVENANCE、LICENSE、NOTICE |
| `apps/desktop/resources/lsp/` / `sdk/` | 随包 LSP 资源、SDK 与 ACP 桥 |
| `apps/desktop/build/` | 已确认 PNG 与生成的多尺寸 ICO |
| `apps/desktop/electron-builder.yml` | ASAR、额外资源、Windows 品牌、NSIS、afterPack 校验 |
| `scripts/` | 启动准备、打包兼容、原生运行时下载、专项和桌面验收脚本 |
| `supabase/` | 由用户手动执行的迁移与发布 SQL，不在客户端自动执行 |
| `docs/` | 中英文手册/协议、部署、比较及版本化验收记录 |

### 不破坏现有实现的具体规则

- IPC 修改同时核对 `shared/ipc.ts`、preload、main 和 renderer；不要将 Node、Key 或系统对象暴露给网页。
- 数据迁移在 `storage/database.ts` 顺序追加，维护 `user_version`，不清库、不覆盖用户 DB、不降低 schema。当前会话等数据通过 Repository 访问。
- 停止/删除/退出必须等待活跃执行完成，不能先删会话或关数据库；保留 `ChatService.removeSession()`、`shutdown()` 的协调顺序。
- `worktree` 重用须校验所属仓库，脏 worktree 不能自动删除；撤销恢复须保留文件与 Git index 安全备份。
- 受保护工具经 main 的统一执行路径；自定义工具、Shell Hook、Formatter/LSP 与 stdio MCP 的宿主能力不能借其他入口绕过策略。
- 模型摘要、任务活动、usage、失败信息来自真实事件；不能用定时器伪造工作进度。SSE 提前断流不得当正常完成。
- 文档解析使用内置依赖。不要让 Agent 以 PowerShell 缺少压缩库、pandoc、pdftotext 为由替代已有 `read_document` 路径。
- 样式依照 [DESIGN.md](DESIGN.md)，前端任务另读适用设计技能；本交接不授权重做 UI。

## 5. 开发、启动与本地数据

需要 Node.js 24+、pnpm 11+，项目固定 `pnpm@11.25.0`。当前 Electron 45.2.1、electron-builder 26.18.0；具体依赖以 package 与 lockfile 为准。不要无任务需要升级依赖或重生成 lockfile。

从仓库根目录运行：

```powershell
pnpm install
node scripts/provision-electron-runtime.cjs
node scripts/provision-native-runtime.mjs
pnpm dev
```

使用已有目录构建运行实验版：

```powershell
pnpm build
.\run-experimental.cmd
```

`run-experimental.cmd` 会自动寻找 Node/pnpm，缺依赖或原生运行时时准备它们，由准备脚本校验 ICO、必要时从同目录同名 PNG 恢复并生成专用实验 EXE。**如果 `out/main/index.js` 已存在，脚本不会自动重建源码**，所以修改后要先 `pnpm build`；仅重启可能仍运行旧构建。正常退出托盘中的旧测试进程后再验证，不能擅自终止用户任务。

| 数据或标识 | 约定 |
| --- | --- |
| 实验数据目录 | 启动脚本默认 `%LOCALAPPDATA%\MingshenHarnessExperimental` |
| 正式数据目录 | Electron `app.getPath("userData")`；默认基于 `%APPDATA%` 和应用名，不与实验目录混用 |
| 测试覆盖 | `MSH_USER_DATA_DIR` 或 `--mingshen-user-data=<absolute path>` 指定独立目录 |
| 本地存储 | `mingshen.db`、其 WAL/SHM 及目录内扩展/快照/配置等；不要上传或作为测试夹具 |
| 正式 AppUserModelID | `com.mingshen.harness` |
| 正常实验 ID | `com.mingshen.harness.experimental.desktop` |
| 原生 Electron 开发 ID | `com.mingshen.harness.development.electron` |
| 实验 EXE | 从当前桌面包解析到的 `electron/dist/MingshenHarnessExperimental.exe`；hoisted 安装通常位于根 `node_modules`，从原版生成，不修改原 `electron.exe` |

Windows 通知 CLSID 固定在 `main/index.ts`。快捷方式、任务栏窗口 ID、图标和通知身份必须一致；不要再使用旧实验 ID `com.mingshen.harness.experimental`，也不要随机生成 CLSID。

1.2.3 图标补充修复：专用实验与正式窗口的 `setAppDetails.appIconPath` 使用 `process.execPath` 内嵌图标，实验开始菜单快捷方式同样引用 EXE；原生 electron.exe 开发入口保留 ICO，窗口/托盘仍用原子图片。实验准备脚本对源 EXE、ICO 和生成 EXE 做 SHA-256 校验，不能只凭版本/mtime/marker 跳过；被原版覆盖或标记损坏会重建独立实验 EXE，绝不修改原版 electron.exe。2026-11-10 补充 ICO 目录/图像校验、损坏自动恢复及生成器原子替换，见第28节。三份 `prepare-experimental-runtime`、`generate-icon`、`windows-icon` Node 测试覆盖准备、生成及格式回归；`taskbar-restart-smoke.mjs` 同时比较 Windows shell 提取的大小图标并检查两次启动身份。生成文件在运行中被锁定时应提示先退出实验进程，不强杀用户任务。

实验/验收常用环境变量：`MSH_EXPERIMENTAL=1`、`MSH_USER_DATA_DIR`、`MSH_DISABLE_AUTO_DEPENDENCIES=1`、`MSH_NOTIFICATION_FIXTURE=1`、开发调试 `MSH_DEBUG_PORT`。这些只按用途设置，不把测试开关写死到正式包。

## 6. Windows 打包方法与 EPERM 排障

### 6.1 面向用户的唯一推荐入口

PowerShell 在仓库根目录执行；当前开发机例子：

```powershell
cd C:\Users\ASUS\Desktop\MingshenHarness
.\package-win.cmd --check
.\package-win.cmd --dir
```

只有用户要求生成正式安装包时执行：

```powershell
.\package-win.cmd
```

| 命令 | 行为 |
| --- | --- |
| `.\package-win.cmd --check` | 查找 Node/pnpm，检查 Electron Windows 运行时及 33 项必需资源（含 TencentDB 记忆核心、许可/清单、文档 worker、两份更新日志、压缩提示词和 TypeScript 索引解析器）、记忆源码/运行时哈希与 ESM 依赖闭包、离线 OCR/原生依赖和版本；不下载或构建 |
| `.\package-win.cmd --dir` | Electron 准备、图标、原生运行时、生产构建、预检、完整解包构建和 afterPack；不创建 NSIS 安装包 |
| `.\package-win.cmd` | 同上并创建 NSIS 安装包；复制最终发布文件回项目 |
| `pnpm package:win` | pnpm 已可用时的正式安装包等效入口，同样使用仓库打包包装脚本 |

版本 1.3.2 的预期输出（历史版本发布材料保留）：

```text
apps\desktop\release-artifacts\MingshenHarness-1.3.2-x64.exe
apps\desktop\release-artifacts\MingshenHarness-1.3.2-x64.zip
apps\desktop\release-artifacts\MingshenHarness-1.3.2-x64.zip.sha256
apps\desktop\release-artifacts\MingshenHarness-1.3.2-x64.zip.json
```

实际构建目录由脚本创建：

```text
%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.3.2-<random>\
  electron\                  临时原版运行时，结束后受限清理
  temp\                      构建子进程的 TEMP/TMP
  output\win-unpacked\      完整应用目录
  output\MingshenHarness-1.3.2-x64.exe
```

`--dir` 会打印可运行 EXE 的绝对路径；正式打包会打印项目输出及 `Cached installer:`。如果安装包构建成功、只是复制回 Documents 失败，使用缓存中的完整安装包，不要再次全盘清理重装。失败时打印 `Build files retained for diagnostics:`；该目录不一定有成功安装包，先看构建退出码及目标文件。

### 6.2 打包调用链

`package-win.cmd` -> 根/桌面 `package:win` -> `provision-electron-runtime.cjs` -> `generate-icon.ps1` -> `provision-native-runtime.mjs` -> `pnpm build` -> `package:check` -> `scripts/package-windows.cjs` -> electron-builder -> `scripts/check-package.cjs` afterPack。

| 脚本 | 必须保留的作用 |
| --- | --- |
| `package-win.cmd` | 从 PATH/常见位置自动定位 Node 和 pnpm，进程内补 PATH；避免用户机器报“pnpm 不是命令” |
| `scripts/provision-electron-runtime.cjs` | 从当前桌面包解析 Electron，验证版本、path.txt、EXE 和关键伴随资源；缺失时调用包内官方安装器并保留固定 ZIP 校验和，不依赖迁移前路径 |
| `scripts/package-windows.cjs` | 验证本地 Electron 版本，LocalAppData 构建目录，EXE 优先暂存，调用 builder、回收暂存并保留输出 |
| `scripts/package-paths.cjs` | 本地缓存定位与删除/写入边界校验 |
| `scripts/package-runtime-copy.cjs` | 有限重试、流式/原生回退、SHA-256 一致性核对 |
| `scripts/package-copy-compat.cjs` | 仅在 builder 子进程、仅本次构建目录移动已暂存运行时并校验移动前后哈希；先部署原版 `electron.exe`，无法移动时回退到验证复制 |
| `scripts/package-native-copy.cjs` / `.ps1` | 必要时调用 Windows 文件 API，目的地仍校验在本次构建范围内；不永久修改执行策略 |
| `scripts/check-package.cjs` | 源预检、原生运行时哈希、ICO 尺寸、ASAR 及额外资源校验；拒绝混入实验 EXE、标记和 Electron 示例应用 |
| `scripts/generate-icon.ps1` / `windows-icon.cjs` | 从已确认 PNG 内存生成多尺寸 ICO，再以同目录临时文件原子替换；共享 ICO 结构与图像校验，不重新设计图标 |

NSIS 配置在 `apps/desktop/electron-builder.yml`：x64、当前用户、未签名、允许选目录、桌面/开始菜单快捷方式、产品名及固定图标。`signAndEditExecutable: true` 负责品牌资源，不应因为“不签名”而关闭它导致图标回退。

必须随包包含 Electron/Chromium、生产依赖、BrowserDo MCP 代码、原生沙箱及许可、提示词、LSP、SDK、文档 worker、canvas Windows 绑定、Tesseract worker/WASM 和 eng/chi_sim 语言数据、三份中英文协议、手册与更新日志。用户数据、Key、开发缓存、实验专用 EXE 不随包。

### 6.3 已经踩过的坑，勿重新引入

- 直接运行 `electron-builder --dir` 可能跳过本仓库的暂存/复制兼容；不要用它的单次成功替代用户 `.cmd` 入口验收。
- 本机默认 Node 是 `D:\NodeJs\node.exe` v24.19.0；pnpm 入口可能来自 Codex runtime 的 fallback `.cmd`，其自身 Node 与运行项目脚本的 Node 不一定相同。不能凭打印的 Node 路径猜测全部子进程行为。
- 先后出现 ZIP 解压 `vulkan-1.dll`、暂存复制 `d3dcompiler_47.dll`、builder 第二次复制同 DLL 的 `EPERM`。只改其中一个阶段或只加重试没有解决问题。
- 源 DLL 微软签名有效，失败后单独复制同目标曾成功。ACL 正常不能排除临时保护；本机火绒/360 运行不等于已证明具体拦截原因。
- 连续六次 EXE 优先部署探测通过，因此现在两个阶段都先复制原版 `electron.exe`，之后才处理 DLL；不要改回目录枚举顺序或无约束并发复制。
- 1.2.3 全量检查又复现 builder 第二次复制 DLL 的 `EPERM`，上述历史通过不能证明该问题永不复发。现在 builder 只移动本次构建中已暂存的运行时文件，移动前后核对 SHA-256，移动失败才验证复制。原始 `node_modules/electron/dist` 不移动、不修改；不要把部署来源改为该原版目录。本轮 `--dir` 和解包程序实测通过，详见 `VALIDATION_1.2.3.md`。
- 保留有限重试、哈希核对、原始错误和路径；不跳过 DLL，不从不明网站另下同名文件，不关闭系统安全功能。
- 已完成 **两次同入口 `--dir`** 验证及解包程序检查；这仍不表示 NSIS 编译、安装/卸载、升级、全部电脑或防护配置已验收。

### 6.4 原生运行时获取

`node scripts/provision-native-runtime.mjs` 下载固定 OpenAI Codex `rust-v0.166.0` Windows executor，只用于 MXC 执行，不调用其模型服务、不使用用户 Codex 凭据。来源与哈希见 [PROVENANCE.md](apps/desktop/resources/native/PROVENANCE.md)。

`codex-sandbox.exe` 大于普通 Git 文件限制，受 `.gitignore` 排除；它没提交不代表被错误删除。新克隆要运行准备脚本，不能把缺失运行时变成无沙箱执行。升级时同步下载脚本、执行时校验、打包校验和第三方许可，不只改一个版本字符串。

## 7. 验证方法与最近证据

当前 1.3.1 光轨稳定性、文件栏及诊断修复、格式粘贴、持久草稿及扩展文档工具范围见 [验证记录](docs/VALIDATION_1.3.1.md)，原生公式、图表及模板参数见 [文档工具说明](docs/DOCUMENT_TOOLS.md)。1.3.0 初版文档制作及记忆范围见 [历史验证记录](docs/VALIDATION_1.3.0.md)，1.2.9 自动重试/记忆/压缩范围见 [历史记录](docs/VALIDATION_1.2.9.md)，优先以本轮实际结果为准；以下均为历史证据。

1.2.8 当前证据见 [工作区升级验证](docs/VALIDATION_1.2.8.md)：70 文件 408 项通过、3 文件 9 项外部环境跳过；Biome209、两套 TS、最终生产构建、生产依赖审计、14 项打包/图标 Node 测试及 24 资源预检通过。18 个桌面专项覆盖新布局和原流程；新版14组、滚动19项最后修正后重跑。所有会话/模型均使用临时 profile 和本地夹具，Windows通知及公开HTTPS更新另有真实链路。实验 out 已更新，无解包/NSIS、用户 DB 操作或云发布。下方1.2.7及更早均为历史证据，不能替代本轮范围。

1.2.7 最新证据见 [计划生命周期与附件验证](docs/VALIDATION_1.2.7.md) 及其扫描PDF补充：69文件405项通过、3文件9项环境跳过；Biome204文件、两套TS、生产构建、生产依赖审计、14打包/图标Node测试和24资源预检通过。真实Electron文档8组7请求、计划/附件7组15请求通过；原生MXC及Docker各一组真实文档读取通过，ASAR文档依赖闭包真实Electron验证通过。均使用临时profile/项目与本地模型，schema7保留，未生成安装包。完整解包尝试仍在运行时DLL复制遇EPERM，不算成功，详见补充记录。

1.2.6 最新证据见 [任务工作台验证](docs/VALIDATION_1.2.6.md)：59文件314项通过、2文件8项环境跳过；Biome182文件、两套TS、生产构建、生产依赖审计、14项打包/图标测试及23资源预检通过。真实Electron新增13组（33次本地模型请求、子任务并发峰值2）、Agent选择9组、审批恢复6组、会话命令11组、聊天滚动19项、通用桌面21项通过；全部自建临时profile，不使用用户Key/DB。实验out已构建，未生成解包应用或NSIS。

1.2.5 菜单与首次引导（2026-11-05）：`floating-panel.ts`/`use-floating-panel.ts`按触发点上下空间统一限高、定位及监听清理；ModelPicker外层scroll不再关闭自己，方向键/Home/End可见项导航，Esc先关闭菜单。Skills/CTX和body portal的slash/@复用，@不截前8项。DesktopController的accepted核对`legal.acceptedVersion`及`legal.consent`三true+version，完整旧记录不重置；`legal.manualPending`保存首次手册步骤，读取后由`finish-onboarding`完成，重载/重启可恢复，完成后无自动弹窗。状态/文档失败可重试，未就绪IPC不返回undefined；未同意时文档事件不能绕过checkbox和五秒。使用app_settings、schema6/POLICY_VERSION不变，不删除旧数据，不按安装路径“重置首次”。新增v125-smoke8组、多次真实退出/启动、18供应商/末项28模型/24skills/16自建Agent、中文夜间/英文日间1040×680及1120×720通过；焦点10/会话命令11/自动压缩9组通过。源码270通过8跳过、Biome160/两TS/构建/打包14项/22资源预检通过。详细证据见1.2.5报告，无用户Key/DB、NSIS或云端发布。脚本使用renderer9363/main9364，与所有UI smoke顺序运行。10份文档/SDK/命令/发布SQL模板同步1.2.5，历史验证版本保留；afterPack还禁止ASAR包含用户DB，资源检查文档版本头。

同轮最终回归：通用桌面21项、聊天滚动19项通过。旧滚动脚本须等待“开始使用”按钮enabled且手册关闭，不能点击disabled按钮后把遮罩拦截滚轮误认成产品滚动故障；已修正测试等待。更新RPC本次只读服务器1.2.4、本地1.2.5正确为current，未修改云端发布数据。实验out已重新构建，无需生成安装包即可从原run-experimental入口查看。

1.2.4 资源管理器入口（2026-11-05）：SessionSidebar新增“在资源管理器中打开”及英文文案，菜单宽224px/视口限高适应六项。`session:open-workspace`经shared/preload/main进入DesktopController，按Repository会话ID取目录；本次运行已建立的worktree且当前仍选worktree模式时用实际目录，否则用配置路径，不创建worktree。校验绝对本地路径/存在/目录类型，拒绝UNC、设备、空值和相对路径；shell.openPath错误回应用侧栏并本地化，不使用命令拼接、不修改文件或审批。新单元覆盖含中文空格/目录名.cmd/不存在/误配文件/无目录/无效ID/原生失败/实际worktree选择；完整源码264项通过、8环境跳过，Biome157文件、两套TS和构建通过。真实Electron会话回归6组，实际Explorer已打开未选中会话中文空格目录并通过Shell COM核对及只关闭测试窗口；菜单禁用/失败、中英文日夜1040×680、既有重命名分支位置/置顶/归档恢复/删除均覆盖。手册/日志中英文同步，三协议/版本/schema不变；未生成安装包，命令仍`.\package-win.cmd`。专项`v123-conversation-smoke.mjs`使用原9339/9345端口与临时数据，与其他UI smoke顺序运行。

1.2.4 打包前复核（2026-11-05）：用户要求仅核对并提供命令、自行打包。实际执行`.\package-win.cmd --check`通过（22项资源/生产依赖/版本），打包路径/复制/原生兼容/实验图标14项测试通过；main/preload/renderer生产构建、Biome157文件和两套TypeScript通过。10份中英文内嵌文档版本头、三协议修订号、docs extraResources映射、原子PNG一致性与x64/当前用户/未签名NSIS参数均核对通过；DesktopController文档/协议读取测试通过。手册和日志已包含最新滚动按钮、主动提问、审批恢复及自建Agent选择，无需再改协议正文或修订号。没有生成新的解包应用或NSIS，不将源码预检当作安装/升级验收。推荐命令仍为根目录`.\package-win.cmd`，预期输出`apps\desktop\release-artifacts\MingshenHarness-1.2.4-x64.exe`。

1.2.4 滚动控制最新证据（2026-11-05）：真实Electron滚动专项19项、历史问题导航13组通过，包含一次跳转后新输出保持位置、键盘恢复后持续跟随文本/思考、再次上滑暂停、折叠/展开思考、连续四次切换空会话、完成后操作、中英文日夜1040×680和右侧工作面板。ChatView以ref驱动跟随和frame，React仅同步位置/模式布尔值；一次跳转更新previousTop避免被自身scroll事件恢复跟随，暂停时ResizeObserver也更新按钮。跳转按钮隐藏后焦点移至恢复按钮，恢复后移至聊天区；未溢出的空会话不因上滑出现恢复控件。验证详见1.2.4报告末尾，版本/协议/schema不变，无新增依赖、模型付费请求或安装包。

1.2.4 主动提问当前实现：`shared/questions.ts`统一规范化提问/回答；tool-registry中`ask_user`显式JSON schema与core/tools/runtime提示同步，主动澄清但不重复询问已知事项。`AgentQuestionPanel.tsx`单选radio、多选checkbox、系统Other文本、三题翻页、结构化提交和错误重试，pending沿用revision恢复；当前普通composer收起只保留底栏/停止，不使用系统弹窗。主区域显式minmax行、sidebar min-height0，防止多会话撑出紧凑窗口。主备审批/full_access都不回答提问；既有profile工具策略和Plan保留；child去掉ask_user，符合subagent返回父会话约定。

验证及边界见1.2.4报告末尾：49测试文件263项通过/8环境跳过，157文件Biome、两套TS、生产构建、生产依赖审计、14打包/图标测试；提问9组三协议本地SSE、审批恢复6组/审批13组、通用桌面21项、其他会话/压缩/CTX/滚动/导航/Agent/焦点/子任务专项、通知原生/失败和原生隔离/路径探测通过。全部模型夹具，无用户Key/DB，用户明确免测BrowserDo/Embiody；无NSIS。版本1.2.4、POLICY_VERSION和schema不变；本地API结构化回答校验失败返回400，SDK兼容字符串和数组。

1.2.4 审批恢复最新证据：`approval-recovery-smoke.mjs` 6组、最终原审批13组、Agent选择9组（8次本地请求）、设置焦点10组均通过；Biome153文件、两套TS、47测试文件251项通过/8环境跳过、生产构建和22资源预检通过。修复前丢失提问事件可稳定复现waiting无面板；提问现有revision完整同步，审批列表不再由IPC回执/结束事件直接删，提交5秒恢复按钮，失败busy复位及旧回调保护。混合审批/提问待处理14项专项覆盖。全用OS临时profile、本地SSE及测试进程调试注入，不改用户DB，不调用真实付费模型，无安装包。中英文手册/日志同步，版本/协议/schema不变，详见1.2.4报告末尾。

1.2.4 自定义 Agent 选择最新证据：扩展 `agent-selection-smoke.mjs` 后真实Electron9组通过、8次本地模型请求；从设置界面新建配置立即刷新两个菜单及说明，custom primary/plan/subagent/all全类型、hidden只影响@、禁用过滤、创建/执行/只读/切换重载均验证。AgentGuide说明区改为全部enabled、内置顺序保留，不额外过滤builtin/role/hidden；NewSessionDialog与ChatView本已按enabled列出全部配置，不再添加仅内置限制。Biome152文件、两套TS、构建与脚本语法通过，版本/协议/schema不变，未生成安装包。

1.2.4 新建 Agent 选择最新证据：真实 Electron 6 组通过，四种配置从窗口创建并各完成1次本地模型请求；root depth0、只读工具筛选、重载持久、禁用/回退及中英文日夜均验证。既有会话继承和subagent保护7项、Biome152文件、两套TS、生产构建及22资源预检通过，无安装包。`agent-selection-smoke.mjs` 使用renderer CDP9357/main inspector9358与OS临时profile，与其他桌面检查顺序执行。仅改NewSessionDialog选项/默认回退和用途说明，不更改角色配置、SessionService或ChatService执行策略。版本/协议/schema均不变，详见1.2.4报告末尾。

1.2.4 历史问题导航最新证据：真实 Electron 专项 13 组、最终焦点回归 10 组、滚动回归 10 项通过；Biome 152 文件、两套 TS、生产构建、246 项测试（8 环境跳过）及 22 资源预检通过。新增 `QuestionNavigator.tsx` 只从本地 user 文本/附件提取预览，阅读位置监听真实滚动/布局；ChatView 点击跳转先暂停/取消底部跟随，使用稳定 message ID。导航条独立滚动不调用 scrollIntoView 移动聊天；切换会话 key 重置、编辑覆盖随有效消息更新。`question-nav-smoke.mjs` 使用 renderer CDP9355/main inspector9356、OS临时数据库和本地SSE，包含119条历史、键盘、真实鼠标滚轮/悬停、流式、工作面板和中英文日夜。与其他UI检查顺序执行。没有新增依赖、模型请求概要或schema迁移，版本/协议不变；未生成安装包，详见1.2.4报告。

1.2.4 设置输入焦点修复：修复前真实 Electron 连续输入复现 `active=关闭设置`；修复后专项 10 组通过，含三秒审批轮询、显式刷新、选区/光标、合成 IME、Key 和模型真实保存、中英文日夜布局及 10 份内嵌文档版本。Biome 151 文件、两套 TypeScript、生产构建通过；246 项测试通过、8 项环境跳过；13 项打包测试和 22 资源预检通过。版本/打包元数据均为 1.2.4，协议修订/schema 不变；未生成安装包。详见 [1.2.4 记录](docs/VALIDATION_1.2.4.md)。`settings-focus-smoke.mjs` 使用 renderer CDP9353/main inspector9354 和独立 OS 临时 profile，与其他桌面 smoke 顺序执行。

1.2.3 CTX 启动恢复最新证据：Biome 151 文件、两套 TypeScript、生产构建及 22 资源预检通过；46 个测试文件通过、2 个跳过，246 项通过、8 项环境跳过。新 SQLite 恢复 6 项及真实 Electron 三次启动 6 组通过（仅1次基准模型请求，重启/模型切换/估算无额外模型请求）；自动压缩9组、会话命令11组回归通过。详见验证报告末尾，无安装包。

1.2.3 分支/手动压缩的最新证据：Biome 150 文件、两套 TypeScript、生产构建通过；45 个测试文件通过、2 个跳过，240 项通过、8 项环境跳过。新增真实 Electron 会话命令专项 11 组（3 次聊天、3 次摘要），自动压缩回归 9 组、滚动 10 项、通用桌面 21 项通过，英文设置无漏译；22 项资源预检通过。模型请求使用临时 profile 与本地 SSE，无真实 Key/用户数据；未生成安装包。版本 1.2.3、协议 `2026-11-04.3`、schema 6 均不变，详情见验证报告末尾。

1.2.3 主备模型补充的历史源码证据：Biome 142 文件、两套 TypeScript、生产构建通过；42 个测试文件通过、2 个跳过，228 项通过、8 项环境跳过。审批解析/备用 34 项、跨供应商协议 4 项、压缩 20 项专项通过；真实 Electron 审批 13 组（13 次主审核、5 次备用）、压缩 9 组（12 次摘要、18 次主对话请求）、通用桌面 21 项通过，英文设置无漏译；22 项资源预检和 diff 空白检查通过。全部模型请求使用本地夹具，不代表所有付费代理与模型语义质量；未生成安装包。应用 1.2.3，协议 `2026-11-04.3`，详情见验证报告末尾。

1.2.3 上下文压缩补充证据：Biome 140 文件、两套 TypeScript 与生产构建通过；41 个测试文件通过、2 个跳过，195 项通过、8 项环境跳过。新增压缩单元测试 13 项，三协议/跨供应商请求、阈值与失败边界；真实 Electron 压缩 7 组（8 次摘要、14 次主模型请求），审批回归 9 组、滚动 10 项、通用桌面 21 项通过，英文设置无漏译。22 项资源预检通过。全部模型为独立本地夹具，无历史 Key、用户数据库或安装包；该次协议为 `2026-11-04.2`，应用仍 1.2.3。后续主备模型验证见报告最后。

1.2.3 审批补充证据：Biome 136 文件、两套 TypeScript、生产构建通过；40 测试文件通过、2 跳过，182 项通过、8 环境跳过；审批专项 9 组（6 次本地审核请求）、滚动 10 项、通用桌面 21 项通过；21 资源预检通过。实际 native 文件写入、延迟审批回执、刷新恢复、项目授权、审核通过/拒绝/无效/HTTP503、并发和退出计数均覆盖。耗时小时显示使用临时轨迹时间夹具，750 工具轮次为真实 ChatService 循环配模拟模型/工具。该次协议更新至 `2026-11-04.1`，应用仍 1.2.3，schema 不变；后续压缩验证见报告最后，不将下方历史结果当作新安装包验收。

1.2.3 会话体验补充（同日后续）的最新源码证据：Biome 126 文件、两套 TypeScript、生产构建通过；148 项测试通过、8 项环境跳过。新增真实 Electron 会话流程 4 组、原 1.2.2/1.2.3 专项各 6 组、通用桌面 21 项通过，21 项资源预检通过。新流程覆盖两次连续写入、diff 折叠、立即思考与计时、重载、KaTeX、会话菜单/键盘、归档恢复及保留期；详见验证报告末尾补充。本次未重新生成解包应用或 NSIS，下面此前打包路径不能代表包含这些新改动。

1.2.3 最新证据见 [专项记录](docs/VALIDATION_1.2.3.md)：Biome 122 文件、两套 TypeScript、生产构建、124 项测试通过，8 项环境跳过。文件夹/文档 6 组、布局/授权/子任务 6 组、解包程序 21 项桌面检查及通知两种流程通过；原生 MXC、Docker、路径防护、GitHub 公开 API、Wikipedia MCP、两技能仓库安装实测通过。打包专项、资源预检和 `--dir` 通过，没有创建 NSIS 安装包。1.2.2 的旧结果保存在原验证报告，本节表格已标注来源。

### 常规检查

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod
```

### 打包专项

```powershell
node --test scripts/package-paths.test.cjs scripts/package-runtime-copy.test.cjs scripts/package-native-copy.test.cjs
.\package-win.cmd --check
.\package-win.cmd --dir
```

### 桌面、通知与图标

这些检查会启动真实 Electron 和独立临时数据库；先构建。不要使用正常用户 DB。

```powershell
node scripts/desktop-smoke.mjs
node scripts/v126-workbench-smoke.mjs
node scripts/v125-smoke.mjs
node scripts/v122-smoke.mjs
node scripts/v123-smoke.mjs
node scripts/v123-conversation-smoke.mjs
node scripts/compaction-smoke.mjs
node scripts/conversation-actions-smoke.mjs
node scripts/context-restore-smoke.mjs
node scripts/settings-focus-smoke.mjs
node scripts/question-nav-smoke.mjs
node scripts/agent-selection-smoke.mjs
node scripts/approval-smoke.mjs
node scripts/approval-recovery-smoke.mjs
node scripts/agent-questions-smoke.mjs
node scripts/notification-smoke.mjs --native
node scripts/notification-smoke.mjs --failure
node scripts/approval-notification-smoke.mjs
node scripts/question-notification-smoke.mjs
node scripts/prepare-experimental-runtime.cjs
node scripts/taskbar-restart-smoke.mjs
```

测试解包程序：`node scripts/desktop-smoke.mjs --app "<完整路径>\MingshenHarness.exe"`。其中路径来自 `--dir` 输出，不复用本文历史随机目录。

`v122-smoke.mjs` 使用 CDP 9337、临时端口模拟模型、系统临时工作目录及独立 profile，测试文件夹快捷新建、配置/技能继承、中英文日志和普通文档不触发虚假诊断。脚本会运行真实受保护文件写入，不触碰用户项目；仍应与其他桌面测试顺序执行。只读更新检查可能连接现有 Supabase，但不修改云数据或固定依赖 8.8.8。

`v123-smoke.mjs` 使用 CDP 9338、main inspector 9344、临时模拟模型与独立 profile，覆盖布局、GitHub 码先于网页显示/切页恢复/夹具 Token 存储、四个后台子任务上限二、手动 `@` 排队及父任务取消。GitHub HTTP 和打开网页仅在该调试进程内替换，不能将调试替换加入产品源码；不使用私人凭据，不代表真实用户账号已授权。脚本中的子会话与工具循环是真实执行层。

`v123-conversation-smoke.mjs` 使用 renderer CDP 9339、main inspector 9345、独立临时 profile/工作目录和本地延迟 SSE 模型，覆盖本轮会话体验。主进程只在该测试内替换更新请求，真实文件工具写两次 `notes.txt`；测试不读取用户数据库。与其他桌面测试顺序运行。

桌面 smoke 使用 CDP 9336、模拟模型 43124；通知/图标使用 CDP 9341，通知模型 43129。**这些 UI 测试顺序执行**，避免端口冲突、焦点变化和角标断言失真。不要批量杀死所有 Electron/Node 来腾端口。通知原生测试调用真实 Windows COM 回调，不等于人工操作横幅；图标属性检查不等于整机重启或任务栏截图验证。

`desktop-smoke.mjs` 实际只读 Supabase 当前最新发布，按数值比较版本并验证弹窗状态，已取消固定 8.8.8 断言。本轮服务器最新为 1.2.2，本地为 1.2.3，正确显示“当前已是最新版本”。更高版本提示由 UpdateService 夹具测试覆盖。不能为通过测试改写云端发布记录。

### 可选真实隔离和联网检查

```powershell
node scripts/native-sandbox-test.mjs
node scripts/security-path-smoke.mjs --docker
$env:MINGSHEN_DOCKER_E2E='1'
pnpm --filter @mingshen/desktop exec vitest run src/main/workspace/docker-live.test.ts
Remove-Item Env:MINGSHEN_DOCKER_E2E -ErrorAction SilentlyContinue
$env:MINGSHEN_MARKETPLACE_E2E='1'
pnpm --filter @mingshen/desktop exec vitest run src/main/marketplace/skill-marketplace-service.test.ts
Remove-Item Env:MINGSHEN_MARKETPLACE_E2E -ErrorAction SilentlyContinue
$env:MINGSHEN_MCP_E2E='1'
pnpm --filter @mingshen/desktop exec vitest run src/main/mcp/mcp-service.test.ts -t 'connects to the built-in Wikipedia'
Remove-Item Env:MINGSHEN_MCP_E2E -ErrorAction SilentlyContinue
```

用户已明确免测 BrowserDo/Embiody：不要启用 `MINGSHEN_BROWSERDO_E2E`，也不要不带过滤地运行 MCP 全部内置服务联网循环，因为该循环会连接 BrowserDo。普通未开启环境开关的模拟回归不受此限制。

| 最近检查 | 已记录结果与限制 |
| --- | --- |
| 常规全量 | 1.2.3：Biome 122 文件、两套 TS、生产构建通过；124 项通过，8 项环境开关跳过 |
| 真实隔离 | 1.2.3：原生沙箱 2 项、Docker 2 项及路径/junction 探测通过；Docker 首次因引擎未启动失败，启动后重验通过；不是永无逃逸证明 |
| 技能/MCP | 1.2.3：两技能仓库读取与安装、Wikipedia 调用、GitHub 公开 API 通过；GitHub/Notion/Browserbase 真实账户验收未完成 |
| 桌面 | 1.2.3：解包程序 21 项检查通过，含审批写文件、diff、HTTP503、浏览器、停止/删除会话、中英文和协议；本轮新增另有 6 组流程 |
| 通知/图标 | 1.2.3：Windows 通知和 COM 回复、失败草稿、两次干净实验启动的窗口身份与原子图标属性通过 |
| 打包专项 | 1.2.3：13 项验证测试、资源预检、三次 `--dir` 与最终解包程序 21 项桌面检查通过，关键 DLL 哈希匹配；NSIS 未生成 |
| 依赖审计 | 1.2.3：`pnpm audit --prod` 无已知漏洞；只是当时数据库的结果 |
| 尚未验证 | 本周期正式 NSIS 生成、安装、卸载、升级迁移；跨 Windows/企业策略矩阵、第三方渗透和付费网关全协议验收 |

## 8. 安全、扩展和外部依赖边界

- Electron main 是可信、拥有当前用户权限的主进程；renderer 关闭 Node，使用 sandbox、contextIsolation、CSP 和受限顶层 IPC。
- 内嵌浏览器页面没有应用 preload/IPC/Node；不能为实现浏览器功能打开网页 Node 权限。
- 请求批准的文件和命令默认经原生 MXC；Docker 是可切换的另一个 backend。二者不是嵌套“双重容器”，也不是整个 Electron App 被 Windows 沙箱包住。
- 完全访问保留致命命令保护。路径/前缀规则不能充当完整恶意程序检测，worktree 不是沙箱。
- Docker 只挂工作区、限制网络/根文件系统/资源，不挂 Docker socket；隔离不可用应明确失败。
- 可信 broker、模型 HTTP、快照和用户手动命令面板有独立边界。外部 MCP 的权限不自动继承容器隔离。
- 本地 stdio MCP 启动和工具操作受相应审批；Plan 只读工具筛选不能仅信任模型自述。MCP 写入、GitHub 写操作与 Hook 不能绕过裁决。
- Shell Hook 默认禁用，执行须显式批准，仍应用致命命令检查和取消。受保护/Docker 会话限制宿主 Hook、自定义工具、Formatter/LSP 等执行入口。
- API Key 用 Electron safeStorage 加密后将密文存 SQLite；不要把原始计划中的“Windows Credential Manager 引用”当当前实现。完整 Key 不返还 renderer。
- 敏感错误保留 HTTP 状态、Request ID 和诊断，但 Key/Token 必须脱敏。网络抓取的私网/元数据与路径遍历检查不能被方便性修复删除。
- 可选本地 API 只绑定 `127.0.0.1`，随机 Bearer、Host/Origin 等检查保留；分享是独立限时只读 capability，不是云端公开分享服务。
- Docker Desktop、WSL2、Embiody 需要官方独立安装与系统条件/许可。依赖入口可以下载和安装，不表示它们已内嵌；Embiody 不未经授权重新分发。

## 9. 更新、SQL、协议与许可

### Supabase

项目地址为 `https://jgezpvmlnhycxslqbwcx.supabase.co`，publishable key 由现有更新服务配置维护；不在本文重复任何密钥。禁止放入 service-role Key。

- [部署说明](docs/SUPABASE_DEPLOY.md)、[初始化说明](supabase/README.md)。
- 初始化：`supabase/migrations/0001_init.sql`；可选清理计划：`0002_optional_pg_cron.sql`。
- ZIP更新部署：已部署项目手动追加`supabase/migrations/0003_zip_updates.sql`，新增format/hash/size和`mingshen_get_latest_release_v2()`，不改旧四字段RPC。新部署执行0001及0003，0002仍为可选诊断清理。
- 发布 SQL：`supabase/publish-release.sql`，用户在 SQL Editor 填写公开HTTPS ZIP直链后手动执行。当前1.3.0已填维护者2026-11-10自行生成ZIP的实际SHA-256 `551d665b93f174bf8f6ea8faa13647838ea22840ee83f66759d23afc98a35d17`及293630075字节，与本地文件、JSON及SHA256旁文件一致。`REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL`尚待替换；重新打包后必须重算元数据，不沿用旧包。不要执行占位符或自动写云端。历史1.2.6网页过渡模板另行保留。
- 所有表/RPC 用 `mingshen_` 命名，不能改用用户另一个软件的 `apprelease` 或 `app_releases`。
- 客户端优先调用 `mingshen_get_latest_release_v2()`，404时回退旧`mingshen_get_latest_release()`；两个均读取最多数值最大的生效版本，不得开放整张发布表或诊断表的匿名 SELECT。
- 版本比较是严格三段 `x.x.x`、每段最多三位数字，按数值比较，不能用字符串顺序比较。
- 同意协议后启动检查、每24小时检查、设置手动检查；仅新版本提示。1.2.6起确认后后台下载ZIP/校验/解压，运行会话结束后退出并启动安装器；旧page链接仍默认浏览器手动打开。
- 诊断/崩溃 SQL 接口存在，30 天清理机制有定义；**客户端诊断上传仍未启用**，不能以迁移文件存在宣称已上传成功。

不要自动删除用户云端 8.8.8 测试发布，也不要对其填入的 `example.com` 进行发布操作。

### 协议与手册

`docs/TERMS_OF_SERVICE(.en).md`、`PRIVACY_POLICY(.en).md`、`DISCLAIMER(.en).md`、`USER_GUIDE(.en).md` 永久作为资源内置。旧外部手册链接不是现行方案。

`docs/CHANGELOG.md` 和 `docs/CHANGELOG.en.md` 同样内置。顶栏书本入口在手册与更新日志之间切换；读取参考文档不能启动协议阅读计时。每次版本变化同步中英文日志与适用手册，历史验收报告保留原版本。

1.2.2 文件夹内新会话走 `session:create-in-workspace`，主进程按同一路径选择最近更新的未归档主会话，验证其模型/Agent/思考配置后复制配置与有效扩展引用。不会继承子 Agent 状态、聊天历史或运行时审批，不能在来源失效时悄悄切成完全访问。普通全局“新对话”保留设置框。

编辑后自动检查：请求批准与 Docker 不执行宿主 Formatter/LSP，也不把跳过提示当诊断发送给模型。普通文档只在显式配置对应检查器时参与诊断；默认代码检查使用适用的现存文件，空报告无反馈。有效诊断只反馈一次，后续编辑产生新报告时再反馈。

1.2.3 子 Agent：`spawn_subagent` 返回后台任务 ID，父任务继续独立工作，`wait_subagents` 汇总真实结果。父任务提前结束时执行层会收集尚未读取的结果并请求继续汇总；达到步骤上限明确失败并保留结果，不能误报已完成。统一名额在 `send()` 的子会话入口获取、实际执行结束后释放，排队唤醒前预留名额；降低上限低于在跑数量会被拒绝。修改这些路径须复测取消、失败、Plan 只读与全局上限。

1.2.3 会话体验：`runsBySession` 独立于流式文本，用持久化轨迹恢复最近一轮计时；工具/助手消息不再移除运行起点。实时 ActivityTrail 和文件 diff 默认折叠，更新事件不得强制展开。Markdown 数学在 Marked block/inline tokenizer 内处理，不能恢复全局反斜杠替换而破坏代码和矩阵换行。

1.2.3 流式滚动修复及后续控制：ChatView 不再按每个 token 无条件滚到底部。ResizeObserver 在底部跟随时响应真实布局变化，用户向上滚轮/键盘/触摸或移动滚动条后暂停并取消排队的 animation frame；手动滚回底部或点击右下侧单个向下箭头恢复。1.2.6按用户要求合并原1.2.4的两个按钮，箭头同时回到底部并恢复跟随，激活后收起并将键盘焦点移回聊天区。正文常驻侧边留白，历史问题导航底部避让，不因按钮出现重排文本。阅读历史时文本、思考摘要、工具事件和完成不能重启跟随。内容收缩钳制scrollTop不当作用户上滑，已在底部时不排多余frame。聊天容器支持键盘聚焦，自动跟随不使用 CSS smooth scroll，监听器/observer/frame 在会话切换或卸载时清理。`node scripts/chat-scroll-smoke.mjs` 使用 CDP9340、main inspector9346、临时profile和本地SSE验证；与其他桌面smoke顺序运行。历史双按钮测试证据保留在旧版报告，最新结果见1.2.6报告末尾。

审批恢复当前实现（1.2.4）：App 的待审批/提问列表只由各自主进程完整快照更新，`approval:state` / `question:state`、bootstrap、窗口聚焦、切换会话与三秒轮询均可恢复。ApprovalBroker 与 QuestionBroker 的 revision 单调递增，旧/相同 revision 不重复覆盖；逐条 required/resolved 事件只触发同步，不直接增加/删面板。旧审批 IPC 回执、run结束或rewind不能按会话直接清除pending，避免下一条请求或并发项被隐藏。保留pendingQuestions的bootstrap兼容字段，新增questionState，无schema迁移。

ChatView 对具体审批 ID 及提交对象隔离异步回调，立即隐藏后显示“正在提交审批”；五秒同一请求仍pending则恢复控件并提示可重试，实际提交失败也恢复按钮；后到回执不得改新请求。新approval/question使composer-wrap滚动回可见起点，不改变聊天历史阅读位置。请求缺失显示恢复与“刷新请求”入口；恢复只读状态，绝不自动批准或改权限。任一approval/question仍pending时ChatService必须保持waiting_approval，不能在其中一项结束后提前置running。运行中的executeToolCall、模型轮次与tool context在审批返回后读取最新权限，保留worktree实际路径。

项目权限经 `permissions/project-permissions.ts` 按规范化绝对路径的哈希键保存，显式变更更新同路径会话及关联子会话（含隔离 worktree 路径），空工作区只改当前会话。新会话尊重已有项目授权；完全访问不跳过致命命令硬检查、Plan、patch-only 或显式手动策略。普通 pending approval 可以在升级时放行，ask_user 与 Shell Hook 不随之自动确认。

自动审批独立于 PermissionMode：`SessionView.approvalMode` 存于 `permissions.approval.<sessionId>`，默认 manual。`permissions.approvalModel` 保存主供应商/模型及可选 fallback 引用，不复制 Key。通过 `AutomaticApprovalService` 调用现有三协议客户端，无执行工具、不附整段历史、尽力脱敏；每个模型 45 秒超时，固定 JSON 裁决，单次允许不记永久规则，双失败保留人工入口。停止/人工决定/改回手动/改审批模型（含备用）均中止旧审核并忽略迟到结果。Shell Hook 和 profile 显式手动规则不能经自动审核通过。相关 UI 继续自建日夜主题弹窗，缺审批模型跳至权限设置；审核操作数据（含拟写入内容）会传至所选供应商，协议已同步。

主备审批在本服务内顺序调用，最多主备各一次，主模型有效 DENY 直接返回，不能以备用获取另一结论。提示固定 `{"decision":"allow"|"deny","reason":"..."}`，reason 任意语言；解析接受明确单一 JSON/中文英文裁决、大小写及 fenced JSON，拒绝缺原因、重复 JSON key（含转义重复）、冲突字段、多个对象或含糊文本，不猜未知语言自由文本。出错保留主/备角色、实际模型、HTTP/断流原文及脱敏限长 1500 字回复预览。`providers/auxiliary-model.ts` 优先 none、minimal/low 或配置首档（跳过禁止 none），审核输出上限由 1024 提至最多 4096，不超模型设置。纯推理、截断与模型自身判断错误仍可能发生，不作兼容保证。

默认工具上限定义在 `shared/agent-limits.ts`，每次用户运行 750 轮，profile 可显式覆盖 1–10000；允许满额工具执行后的最终纯文本总结，第 751 轮新工具不得执行。不要恢复旧16默认/64钳制，也不要覆盖用户自定义较小上限。耗时统一 `shared/duration.ts`，分钟小时自动进位并超过24小时累计。关闭弹窗从 ChatService 活跃/准备 ID 去重计数，含等待审批和子任务；不只相信数据库残留 status。

1.2.3 压缩位于 `chat/context-compaction-service.ts`，每次主模型请求前检查当前模型窗口 85%（含），最终回复结束不额外请求，下一条消息再触发。先处理完整工具结果；保留最新用户指令，优先保留最近完整工具组，尾部本身过大时推进至更后的安全边界。Token 采用实际请求估算及供应商 input+output 校准（Anthropic 缓存读/写计入），不是通用精确 tokenizer。切换模型不复用旧用量校准；二进制模态估算仍有误差。

`context.globalModel` 存全局引用，`context.model.<sessionId>` 为 default/current/custom；default 有全局则用全局，否则当前，current 显式忽略全局。`context.checkpoint/observation/view.<sessionId>` 保存摘要、校准、UI 状态。全部使用 app_settings、schema 不变，不持久化 Key 副本。消息不被删改；重写覆盖摘要边界使其失效，删除会话清掉相关键。子会话/同目录新会话继承选择，不复制 checkpoint；桌面与本地 API fork 统一复制完整原文及有效 checkpoint，重映射 throughId/摘要 ID，不复用旧用量校准。

压缩复用三协议客户端、供应商可用 Key、无工具，按需分段合并，单请求 5 分钟、最多 128 段。完整且缩小上下文后才保存 checkpoint；HTTP/空/工具调用/非缩小/上游错误对象结果触发一次已配置备用，双失败保留旧摘要和原文，同运行不反复重试，超出窗口时明确失败，仍容得下才继续原上下文。停止中止请求，不存半成品，下一轮达到阈值可重试。界面 progress/context_updated 可经 bootstrap 恢复，点击 CTX → 压缩设置，或设置“上下文与压缩”配置。独立/备用供应商会接收历史及文本附件内容，三份中英文协议/手册/日志同步，POLICY_VERSION `2026-11-04.3`。

1.2.3 分支使用 Repository.forkSession 原子 savepoint，同步桌面 IPC `session:fork` 与本地 API `/session/:id/fork` 经 ChatService 的关闭/忙碌保护。新 ID、新消息 ID，保留原消息时间和内容、配置、已启用扩展、完整聊天的待办、有效 checkpoint；无 parentSessionId，不能引入父子删除级联。指定 messageId 时严格验证且不得截断工具调用/结果，无效 checkpoint 不复制。临时审批授权、pending、轨迹/快照、定时任务、磁盘文件和活跃执行不复制；同路径文件仍共享，worktree 与聊天分支不是同一概念。当前运行中须等待或停止再分支。

手动压缩 IPC `chat:compact`、文本 `/compact` 和本地 `/session/:id/compact` 复用 ContextCompactionService.manual，低于 85% 也尝试，短历史明确报错。ChatService 使用统一 activeRuns/activeExecutions，支持停止、删除等待、退出等待；不进入 executeRun，因此不启动 MCP/Hook/快照/工具，不追加用户/助手消息。run_started/completed.kind=compaction 避免普通任务通知；计时和轨迹真实记录。手动错误显式报告，原摘要/记录保留；最近固定请求开销作为估算保留，下一真实请求重新测量，不能视为通用精确 tokenizer。

输入框斜杠菜单位于 ChatView 与 lib/slash-commands.ts，内置 rename/compact/archive/fork/skills/plugins/status/plan/mcp，支持方向键、Enter/Tab/Esc、IME；项目/全局命令保留，内置重名优先。技能/插件列表分别筛选已启用扩展并可打开导入管理。CTX ContextMeter 展示百分比和 K/总K（1000 token）、计数来源/模型/阈值/时间，可跳设置/立即压缩；旧模型无有效测量不冒用。Agent 标签/说明在 agent-labels.ts，主界面、setup、新建会话共用；默认优先 primary，不修改持久化 profile 名称。

CTX 恢复使用 `context:usage` / `getContextUsage` → ChatService.restoreContext → ContextCompactionService.restore；bootstrap 先带已保存 view，打开会话时按需修复/估算，更新会话配置也刷新。`context.snapshot.<sessionId>` 保存 SHA-256 校验（模型、协议、相关配置、有效历史末消息、checkpoint、扩展引用/MCP工具元数据）；UI-only run_summary/error 不使有效计数失效。兼容旧 view 缺模型标识，匹配 observation 恢复；无有效记录、新建/分支、模型或配置变更用已保存有效历史、内置提示、内置工具和扩展描述本地估算，source/estimateScope 明示；不启动工具/读取项目正文/拉取MCP/调用模型。实际请求重测。`restored` 标注已从本地恢复，异常压缩的错误仍保留；删除/重写清 snapshot。计数仅估算，未加载的指令/技能/动态工具可能有差异，不把估算用于启动自动压缩。记录不存 Key 或新的聊天副本。历史校验只查末条有效模型消息，不能在每轮额外重解析整段聊天，750轮回归必须通过。

`node scripts/context-restore-smoke.mjs` 使用 renderer CDP9351/main inspector9352、OS临时数据库、本地SSE和3次真实退出/启动；保留32.5K/200K与时间戳、换模型、分支、临时旧形状迁移、中英文日夜详情。只基准请求1次，其他操作不发模型请求；调试器先断开再等待退出，不能把 inspector 等待误报为产品退出失败。不得改用户DB。与其他UI smoke顺序执行。

专项 `node scripts/conversation-actions-smoke.mjs` 使用 renderer CDP 9349、main inspector 9350，独立 OS 临时 profile/本地 SSE/临时技能及插件；11 组操作覆盖分支续聊、原文不变、摘要继承、手动压缩/停止/503、键盘/IME、CTX、扩展引用及中英文日夜紧凑布局。测试完成关闭自己的进程/清理自己的目录，禁止与其他 UI smoke 并发；不代表真实付费模型摘要语义认证。本轮仅更新相关手册/日志/README/交接，无三协议实质条款变化、不调整协议修订号。

全局可选备用压缩存在 `context.fallbackModel`，IPC `context:fallback-get/set`；它适用于全局、当前模型和会话覆盖的所有有效主模型。配置的全局主备不能相同，运行时与会话有效主模型相同则去重。备用从原始 prefix 和上一个已保存 checkpoint 重新分段，不接收主模型失败尝试的半摘要。切换发布 context.notice 并写入同一活动，成功记录模型及主失败，双失败记录两者；未配置备用保持原有行为。配置均 app_settings，旧配置缺 fallback 即 null，无 schema 迁移。

压缩专项 `node scripts/compaction-smoke.mjs` 使用 renderer CDP 9343/main inspector 9348、独立 OS 临时 profile、本地 Responses SSE 和三个模型 ID。真实 UI 保存全局/会话模型，模拟 provider 用量达到阈值，验证空闲等待下一轮、界面 reload 恢复提示、工具循环自动继续、停止与 503 重试，保留原始消息。跨协议和跨供应商使用真实请求构建/流解析加 fetch 夹具的单元测试，不算真实外部供应商验收。与其他 UI smoke 顺序执行。文本附件最多前 120,000 字符并标注截断；二进制只含元数据。分段总量上限超出时明确失败，不能写成无限上下文。

专项：`node scripts/approval-smoke.mjs`，renderer CDP 9342、main inspector 9347，独立临时 profile/项目和本地 SSE。仅在这个调试进程中延迟审批回执、修改临时轨迹时间并拦截更新请求；无生产调试后门，不改用户数据库、不用真实模型Key。与其他 UI smoke 顺序执行。未重新验收 NSIS、真实付费供应商或 BrowserDo/Embiody。

审批恢复专项 `node scripts/approval-recovery-smoke.mjs` 使用renderer CDP9359/main inspector9360、OS临时profile与本地SSE；仅测试调试进程丢弃question/approval事件、延迟或拒绝审批IPC。6组覆盖漏事件轮询恢复、连续提问、切换会话、失败按钮恢复、紧凑长草稿、八秒延迟（五秒恢复控件）、迟到旧回执、英文日间重载与拒绝阻止写入。可用`--only=question|approval|rejected|visibility|slow|reload`定位，勿加入生产后门，与其他UI smoke顺序执行。详见1.2.4报告。

主动提问专项`node scripts/agent-questions-smoke.mjs`使用renderer CDP9361/main inspector9362、OS临时profile及本地三协议SSE，9组共18次聊天请求，覆盖工具schema/提示、暂停/续跑、四选项+Other、radio键盘、多选取消选择+Other、三题回看、legacy自由文本、无效第五项纠正、提交失败恢复、中文夜间/英文日间1040×680、Plan、重载停止和Ctrl+Enter。UI smoke按顺序运行，不与其他Electron验收抢焦点。

ask_user对外参数为`questions:[{id,header,question,multi_select,options:[{label,description}]}]`，最多3题每题4选项，Other客户端提供；旧`{question,header,options}`继续规范化。QuestionRequest保留旧首题字段，新增可选questions/multiSelect；QuestionAnswer既接受旧answer文本，也接受answers数组`{id,selectedOptions,otherText}`，统一在broker校验全部题、单选数量、选项所属、唯一性和12000字自填。无效回答不消费pending；60秒已答ID幂等仅防迟到回执，不能影响下一题。问题和结构化结果保留现有工具历史，无新增DB字段。未提交草稿是组件内临时态，翻页保留，提交错误保留；重载/切换恢复的是pending，不保证未提交选择持久化。

保留设置 `sessions.retentionDays` 默认 `null`（永不删除），范围 1–36500 天；`touchSession` 只在打开/恢复时刷新日期，普通 `updateSession` 不再刷新。SessionRetentionService 在同意协议后启动，30 秒后首次、每小时检查。归档、当前打开、准备/运行/审批中、关联已启用计划任务以及有受保护子会话的父会话不清理。归档隐藏父子并暂停计划任务，恢复不自动启用计划任务；会话元数据修改不依赖供应商仍有效。删除走 ChatService，先停止并等待、递归删除子会话、清理应用快照，再删除 DB 和通知界面；快照清理失败保留该会话以便重试，不删项目或脏 worktree。退出等待清理完成，清理失败记录错误而不阻塞其他服务的关闭。本地 API 归档也走 SessionService 并检查活跃子任务。

服务协议第 2 节已说明三项勾选和确认表示完整阅读、理解、接受并遵守，用户自主使用/授权产生的责任在法律允许范围内由用户承担，不转给开发者、创作者或新哲文院算法社。依法不得免除的责任和用户法定权利仍保留。不要改成绝对免责或宣称勾选五秒等于证明已经理解。

协议重大更新同步中英文、内置手册及 `POLICY_VERSION`，不能靠提高应用版本替代协议重新同意。最终解释权表述保留法定权利边界。源代码开源许可须用户明确选择，第三方许可和 NOTICE 继续保留。

### 2026-11-05 / 1.2.5 本地日志、最近会话与 CTX 补充

用户要求记录运行中的异常并可导出，同目录默认显示最近使用三条会话，修复压缩后 CTX 数字不刷新；版本仍1.2.5，不生成NSIS、不更换图标、不动用户数据。

新增 `main/diagnostics/runtime-log.ts`、`shared/runtime-log.ts` 和 `RuntimeLogSettings.tsx`。`index.ts` 在初始化服务前绑定 `<userData>/logs`；IPC `runtime-log:status/export/report` 对应状态、用户选路径JSON导出和受限renderer错误上报。保留原IPC来源验证和consent门槛；仅错误上报可在首次同意前调用，不暴露日志读取/任意路径写入API。导出使用系统保存文件选择器，业务页仍沿用应用主题；拒绝导出覆盖活动日志目录。

日志异步串行写JSONL，单文件2MiB、五文件总计约10MiB，按条目时间最多30天，启动/使用时及每小时维护；不是独立后台守护服务。队列最多512条，突发省略数量记到随后写入项；单项错误详情16000字符并明确截断。主进程致命异常同步写最旧轮换槽，避免退出前异步丢失；普通退出等待flush。写日志失败不替代原业务错误，设置页显示记录失败。导出与轮换串行，JSON按时间排序，包含版本/平台/时间/相关ID/来源，不复制聊天、附件或源文件。

接入范围包括模型流/网络、供应商列表和连接测试、审批与压缩的每个主备尝试/无效裁决、运行失败/工具失败/活动失败、MCP诊断、更新、依赖状态/安装、技能市场失败回退、本地API异常、通知、main console/未处理异常及renderer console/error/promise/process。后续新增吞掉异常的回退路径必须显式record，不仅依靠IPC最终throw。SecretStore保存/解密时将凭据及嵌套敏感配置字符串注册到进程内脱敏集合；通用密钥、鉴权、Cookie、URL凭据/查询和已识别的模型输入字段脱敏/省略，原始日志与导出均处理。任意第三方自由文本不保证完整匿名化，分享前仍检查；无自动上传/Supabase报告功能。不要把本地日志打包或提交仓库。

`lib/recent-sessions.ts` 用最后打开/更新/创建时间的最大值选三条；SessionSidebar每组另存showAll状态，不复用文件夹整体展开。展开全部保留pin和父子排序，搜索直接覆盖全部未归档记录。打开会话IPC发送更新后的lastOpenedAt，旧会话进入近期三条；touchSession仍不改变updatedAt及自动清理的原有语义。其他回归脚本需要全部会话时明确点击展开全部，不应还断言默认全铺开。

CTX根因之一是manual把provider计数与本地估算差额全部当固定开销，摘要后仍带回大数。ContextCompactionService新增 `context.basis.<sessionId>`（模型身份、固定prompt/tool成本和估算比例）；没有旧basis时用当前有效历史比例回退，不把整个差额永久加回。成功压缩清旧observation、立即发布/保存有效摘要上下文计数；observation保存checkpointId并验证匹配，checkpoint状态的snapshot估算版本更新。实际请求继续provider校准。remove/rewind清basis，无DB schema迁移，无原始消息删除。不要宣称跨模型精确tokenizer或保证任何固定压缩比例。

新增 `node scripts/runtime-logs-recency-smoke.mjs`，renderer9365/main9366、独立OS临时profile/项目及本地SSE。6组覆盖最近三条/展开/再次收起/搜索/打开旧会话/文件夹关闭保持、真实手动压缩85,000→38,651与UI/reload、真实IPC导出26条夹具日志（包括主备审批/无效裁决、主备摘要503、provider503、renderer错误）、脱敏及中英文日夜1040×680、真实退出重启保留。只在测试进程注入失败和保存文件选择结果，不改生产API权限。与其他UI smoke串行。

本次全量279通过/8环境跳过，52文件通过/2跳过；Biome166文件、两套TS、生产构建和22资源打包预检通过。真实压缩专项9组/12摘要+18聊天请求、CTX恢复6组/3次启动且仅1模型请求、菜单/首次引导8组、会话操作11组通过。具体测试过程和边界见VALIDATION_1.2.5；未调用真实付费模型、BrowserDo/Embiody、未生成NSIS。隐私政策中英文补充本地日志保留/主动导出，手册/更新日志/README同步；服务/免责正文未涉及不改，政策修订号仍2026-11-04.3，无新云端收集。

### 2026-11-05 / 1.2.5 后台审批通知补充

新增 `main/desktop/approval-notifications.ts`，作为CompletionNotifications的可选协作者接入；全局 `Notification.handleActivation` 仍只有CompletionNotifications注册一个回调，先路由审批action/click，其他reply继续走现有完成通知。不要另注册回调覆盖旧回复逻辑。ApprovalNotifications监听真实broker快照而非renderer面板，审批状态更新和窗口焦点/最小化/托盘/选中会话变化时同步；当前前台显示的会话不额外弹窗，其他会话可提醒。reviewing不弹，失败转manual再提醒。按请求ID去重，不在轮询中反复弹；前台已处理/取消/停止/移除/转自动审核时清toast及路由。

每条Windows通知使用随机16hex tag和mingshen-approvals group，两个原生action为批准（allow_once）与拒绝（deny+简短feedback），正文点击只打开原会话。回调重新检查broker请求ID、runId、sessionId、toolCallId和review状态，消费路由后调用ChatService.decideApproval；不授予allow_session、full_access或改变隔离/规则。Windows全局activation和实例action可能各发一次，路由先消费防重复。main调用前保留consent检查；无待处理请求/重启后旧tag均无效，通知不能恢复任务。审批路由仅内存，不复制Key/命令/审批参数到数据库；系统通知只含限长标题/工具名/summary，用runtime脱敏，不放detail/reviewInput。用户仍应在软件面板核对完整内容；Windows同账户消息激活不是抵御已失陷OS的独立安全边界。

新增可选通知设置 `approvalEnabled` 默认true，旧profile/旧API缺字段兼容；关闭总native开关同样关闭审批，单独关闭approval不影响完成通知。CompletionNotifications负责设置/选中/运行事件/退出转发，审批发送或决定失败记本地runtime日志并显示通知设置错误，异常不自动放行。设置外观页新增中英文checkbox，沿用主题；原生弹窗随Windows系统样式。三协议不改revision，隐私中英文补充操作摘要可进本机通知历史、关闭预览和临时路由边界，手册/日志/README同步，版本仍1.2.5。

验证：新ApprovalNotifications12项、单分发/旧设置兼容及既有完成通知/broker专项29项通过；全量292通过/8环境跳过、53文件通过/2跳过，Biome168、两套TS/生产构建/22资源预检通过。`node scripts/approval-notification-smoke.mjs` renderer9367/main9368、OS临时profile/项目、本地SSE，真实Windows历史XML及原生COM回调6组通过：托盘批准真实受保护写文件且权限不变、拒绝不落盘、停止后旧action不能决定新请求、前台inline→最小化提醒、英文/无预览/静音/独立开关/路由失效和真实设置入口。探针输出统一UTF8，按钮参数从实际XML读取（Electron生成action=0/1），不把初次测试乱码当产品中文损坏。`node scripts/notification-smoke.mjs --native`原完成通知XML/COM回复/模型续跑/角标和双语设置/内嵌手册回归通过。COM回调测试不等于人工点Windows横幅，不代表所有Windows勿扰/组织策略可显示横幅；无NSIS，无用户凭据/DB、付费模型或BrowserDo/Embiody调用。

### 2026-11-05 / 1.2.6 结构化工作台与执行协调

用户要求完成父子会话折叠、右键、真实待办、专用Agent、索引、验证、自修复、断点计划、任务树、缓存、批量审批、安全恢复和写入冲突，版本升1.2.6，只交实验版。沿用目录和存储schema6，不做安装/发布/云SQL，不改原子图标和本机用户数据。

`lib/session-navigation.ts`维护字符/二元组倒排及最多12个查询缓存，元数据不变复用；不全量重读聊天。Sidebar根会话计最近三条，子项默认收起且归属父路径（含独立worktree），右键复用portal菜单；展开超过100行使用分批按钮。`TaskWorkbench.tsx`在聊天上方提供可折叠计划/任务树，最大高度240px/30dvh。真实子会话状态与排队、最近轨迹支持重载恢复，点击进入原会话，无虚构DAG节点。

`SessionWorkbenchService`、`shared/workbench.ts`与workbench:get/plan-update/resume IPC通过app_settings的`workbench.plan.*`、`workbench.checkpoint.*`、`workbench.queued.*`持久化。todos与元数据savepoint原子提交，200步上限、ID/依赖/循环/状态/版本校验；模型请求前记录计划版本，用户期间修改拒绝晚到覆盖。断点在模型将步骤标记in_progress后、下一工具前暂停；UI暂停停止任务；完整聊天fork复制计划，删除清状态，重写清恢复点。中断保留已确认工具边界与pending/executing不确定调用，续跑先修复孤立tool_result并明确要求核实，不自动重放外部副作用、不保证exactly-once。

`shared/builtin-agents.ts`新增Code Review/Review Worker、Operations/Operations Worker、Inspiration、Brainstorm，合计十个内置。仅补缺失ID，保留已有配置。每个有提示/allowlist/权限，专用主Agent只可委派明确允许的只读worker，提示/工具暴露/执行层均校验，避免通过general间接突破限制。Operations命令及修改即使完全访问也manualOnly，forceApproval不复用/留下临时会话授权。全部enabled自建及内置可直接选，说明区独立滚动。

`CodeIndexService`加载仅随应用分发的TypeScript解析器（不从工作区cwd加载代码）；AST符号/签名/位置、相对导入边，非完整跨语言调用图。fingerprint/hash增量重用，删除失效，同scope串行刷新，内存六工作区，`code.index.<hash>`本地快照；单文件500K字符、2000代码文件、30000符号、深度16，宿主4000目录项/隔离2000目录项上限。受保护模式仍批准workspace读取并走native/Docker，无host回退；其他语言使用已有LSP/搜索，不宣称通用精确图谱。新增typescript.js资源预检，23项必需资源。

`ToolResultCache`最多128条/100K字符，读缓存仍先批准和真实隔离读哈希；重复返回内容引用，refresh:true强制全文，scope含session/run/摘要epoch。仅严格字面runtime --version探针15秒可跳执行；测试/构建/安装及任意命令不缓存，写入清缓存。`PermissionStore`同类授权限同会话和workspace读/写分类或简单字面命令前缀+cwd，当前pending同步放行；不改模式，不跨项目/会话，重启清，人工策略/Hook/危险操作排除。

`FileLockService`对规范化实际路径持有run级文件lease，命令用临时workspace目录lease。冲突进入QuestionBroker人工选择，不交自动审批；转交先停止等待旧任务，返回未执行、重读重算后重试，子任务不得停止父任务夺权。失败/拒绝释放新lease，任务finalization后释放全部；命令停止/超时等待进程树退出及Docker清理，不提前释放锁。不是OS强制锁，第三方MCP、custom host tools和外部编辑器不受协调；宿主Formatter/LSP临时目录lease且尊重profile。

完成代码变更/项目命令后显式验证，工具通道发现/读取配置/执行并持久化，真实失败最多三轮反馈。优先根`mingshen.verify.json`声明1–6条命令，否则package脚本test/lint/typecheck并识别包管理器；无package时Rust/Go/Python默认检查。单命令120秒，缺配置/读取拒绝/JSON错误/缺依赖不能声称通过；普通txt/文档不触发。配置可执行项目代码，仍受profile、审批、致命规则和隔离限制。手册有示例及边界。

验证：`pnpm.cmd test`314通过/8环境跳过、59文件通过/2跳过，Biome182、两TS、main/preload/renderer生产构建、audit --prod无已知漏洞，14打包/图标测试及用户入口--check23资源通过。`v126-workbench-smoke.mjs`renderer9369/main9370、独立OS临时profile/项目+本地ResponsesSSE，13组33请求，含十Agent+自建、真实计划编辑/冲突、native隔离索引、缓存/批量、只读审查父派4worker上限2、实际测试失败→修正→三检查通过、断点/转交/重启安全续跑、105会话分批与搜索、两语言主题和10文档。Agent选择9组、审批恢复6组、会话命令11组、滚动19项、桌面21项通过；桌面只读更新RPC服务器1.2.5、本地1.2.6为current。另跑native-sandbox-test真实2项及security-path-smoke的junction/路径/Git元数据拒绝、哨兵不变通过。不得与其他UI smoke并发抢焦点。没有NSIS/解包构建、真实付费模型或BrowserDo/Embiody调用，不保证所有供应商/系统组合零缺陷。

三协议适用版本、手册、日志、SDK/命令/发布SQL模板等同步1.2.6；隐私补充本地计划/索引/缓存，POLICY_VERSION仍2026-11-04.3，无新自动云收集。实验源码已build，入口仍`.\run-experimental.cmd`。历史验证和未完成边界继续保留，不用新版本覆盖历史证据。

### 2026-11-05 / 1.2.6 能力覆盖补充

用户要求补齐上一轮审计的功能缺口，仍为1.2.6实验版，不生成安装包。以下覆盖上述早期1.2.6的实现限制，不改写其历史验证结果。

- `multilanguage-parser.ts`使用随包ast-grep N-API/tree-sitter grammar，和TypeScript编译器一起支持JS/TS、Python、Go、Rust、Java、C/C++、C#定义/引用/调用者/被调用者及导入证据。语法候选不是全语言精确语义解析。默认代码文件10000/深度32，可调至20000/64；文件500K字符、符号30000和目录项25000仍有保护。旧索引缺references时重建，不从项目加载解析器。
- `@ast-grep/napi`及七个grammar是生产依赖；grammar包自带Windows-X64预编译`parser.so`，pnpm allowBuilds=false不运行其下载/编译脚本。`electron-builder.yml`解包`node_modules/@ast-grep/**/*`；`check-package.cjs`源预检及afterPack检查Windows绑定与七个parser。React Virtual 3.13.12提供长列表虚拟化，renderer必须dedupe React/React DOM，否则已复现重复React导致白屏。
- schema7追加FTS5 trigram标题索引、复合索引、insert/update/delete变更日志和清理trigger；已有会话/消息/配置/密文保留。`sessionPage/Delta/Groups/Get` IPC实现游标分页、已加载ID增量同步。实际renderer使用paged bootstrap，不重读全部聊天；兼容默认bootstrap仍保留用于现有API/测试。只读选中项目的Agent文件按需同步。父级补齐、子项分页、归档加载与删除选中恢复不能退回全列表假设。
- 项目计划库`workbench.library.*`独立保存，同路径跨会话绑定，默认保留完成状态/进行中转pending，可显式全部重置。删除源会话不删计划库。新增四个workbench plan IPC与`TaskWorkbench`第三tab；`begin_plan_step`在执行层要求先选可执行步骤并检查依赖/断点。
- `ExecutionSafetyService`持久`workbench.ledger.*`确认callID/参数SHA256，保存历史结果引用而不重复正文；恢复只防直接重放已有指纹，正常任务中不误去重刻意重复。`workbench.recovery.*`阻断不确定副作用，重试/重启继续保持；真实成功读取ID+`resolve_interrupted`的人工QuestionBroker确认才解锁。改写历史清session恢复/ledger；独立工作区不确定扩展屏障保留至核实。
- 写入lease覆盖内置编辑/命令、可写MCP、自定义工具元数据/执行及插件Hook；转交停止并等待原任务，拒绝停止祖先，当前操作不执行，先新读取/目录检查再试。内置文件observe hash检测外部编辑，询问重读或停止，不能覆盖旧内容。MCP取消发送协议通知/中断HTTP；结果不确定时保存`workbench.writerBarrier.<workspacehash>`，同工作区新写入暂阻，真实检查并人工确认后解除。外部MCP可忽略取消，先确认服务端已停止；这不是OS锁/远程exactly-once保证。
- 自定义工具元数据和执行进入受管理Worker，取消等待terminate；运行时文件加UUID防并发覆盖，扫描排除runtime缓存和链接。它仍是可信完全访问宿主扩展，可另启进程/远程操作，不是安全沙箱。Hook/Formatter取消及LSP关闭等待进程退出；Docker文件取消等待CLI关闭和容器清理，清理不确定时返回明确屏障标记。
- 缓存并发合并仍在每次审批之后，按session/run/摘要epoch/隔离作用域划分；简单字面PowerShell读取/list/exists通过结构化依赖校验后可缓存；写入失效。测试/构建/安装/复杂shell不缓存，不跨会话分享敏感结果。

中英文手册、日志、隐私说明、README/SECURITY/第三方清单同步；服务/免责正文未涉及不改，POLICY_VERSION仍2026-11-04.3，不新增云端收集。新验证记录续写`VALIDATION_1.2.6.md`，以其末尾实际结果为准。多Agent委派通道本轮返回`unsupported_encrypted_agent_content`未执行；工程任务在主会话完成，不算委派成功。

最新验证：62源码文件335项通过、2文件8项环境跳过；Biome189、两套TS、生产构建、依赖审计通过，用户入口--check23资源+七grammar/Windows绑定通过，14打包/图标Node测试通过。真实Electron工作台15组/41本地请求/worker并发峰值2、审批恢复6组、会话操作11组、滚动19项、桌面21项、原生隔离2项与路径哨兵通过。桌面发现“审批前停止仍被记作executing”，修为副作用实际开始回调：文件审批与哈希检查后、命令spawn前才记录；验证阶段同样区分pending/executing，未批准停止不制造恢复死锁。完整结果及未验收范围见最新报告。

收尾：Agent选择9组/8本地请求通过。动态grammar在Electron安装版需显式把`.asar/`映射至`.asar.unpacked/`供原生dlopen，不能只配置asarUnpack后仍把虚拟路径交给Rust。最终build与335测试/两TS/Biome189/预检通过；未生成安装包。Docker命令取消在CLI关闭后再清理容器，清理失败保留屏障标记，不能静默吞掉后放行写入。

### 1.2.6 滚动按钮合并补充

用户要求保留未发布1.2.6和schema7升级，将一次回底部/恢复跟随合并。ChatView仅保留一个36px向下图标按钮，aria/title中英文为“回到底部并恢复自动跟随”；点击jumpTo(...,true)，移焦聊天区，按钮隐藏，再上滑暂停。删除旧resume按钮/ref与双状态，保留历史问题jumpTo(...,false)。按钮定位聊天viewport右下侧，正文常驻112px总侧边留白，不因按钮显示重排；问题导航始终bottom64px，避免出现按钮导致标记位置跳动。QuestionNavigator在rail内有焦点时不自动滚动当前阅读项，保护Home/End选择。测试脚本先等手册开始使用按钮enabled并等遮罩关闭，再进行真实鼠标命中，不能把未关闭的引导遮罩误判成hover失败。

相关中英文手册/1.2.6日志和DESIGN已同步，三协议/POLICY_VERSION/schema无改动，不回退本地数据库升级，不接触用户DB。滚动专项19项、160段本地流式输出通过，含单按钮/鼠标与键盘恢复/随后输出跟随/再次上滑暂停/正文不遮挡和不重排；历史问题导航13组含119条历史及工作面板通过。Biome189、两套TS、生产构建、资源预检和diff空白检查通过。实验out已更新，无安装包；本次窄UI变更不将上一轮335项全量测试写成本轮重跑结果。

### 1.2.6 ZIP自动更新与永久本地迁移补充

用户要求1.2.6起确认后后台下载ZIP、校验解压自动运行安装器，1.2.7开始发布ZIP直链；仍仅交付实验版、不生成/安装正式包、不写云SQL。`update-service.ts`新增状态/取消/一次handoff/等待会话；`update-package.ts`用yauzl流式抽取唯一根目录版本匹配安装EXE，HTTPS/public/redirect<=5、ZIP SHA256/size<=2GiB、CRC32/PE、路径/链接/重复/脚本/解压比保护，安装前重哈希。`update-transport.ts`隔离内存Chromium session保留系统代理并去Cookie/鉴权；DIRECT用NodeHTTPS校验实际socket DNS，代理为用户信任的网络边界。不要改成全ZIP进内存或解压任意路径，也不以包名充当发布者签名。

下载IPC立即应答，UI事件更新真实进度；共享UpdateControls用于自建中英文日夜弹窗与About，顶栏恢复后台进度、renderer reload恢复状态。后台继续不取消，cancel/quit停止且清本次缓存；交接安装器留存供新进程打开，下次启动不自动续装。活动主/子任务及准备发送结束前不退出，ChatService.prepareForUpdate同步空闲检查并阻止新send，services.dispose/数据库关闭/日志flush成功后app.relaunch。失败不执行；Windows安全提示不绕过。

云端手动运行`supabase/migrations/0003_zip_updates.sql`，增加package_format、ZIP的package_sha256、package_size和`mingshen_get_latest_release_v2`；保留旧四字段RPC，v2 404回退。只改mingshen表、匿名只读最高一条生效版本。publish-release.sql示例1.2.7不代表当前版本升级；填ZIP HTTPS直链/哈希/字节数，不执行占位值。package-windows.cjs成功生成EXE后调用create-update-zip.cjs/.ps1，生成同名.zip/.zip.sha256/.zip.json并复制release-artifacts；已有EXE可单独执行helper。本轮只生成测试夹具ZIP，没有NSIS。

database.ts永久包含全部历史migration，按user_version顺序事务升级，保持schema7；新版本不能删旧步骤或按app版本清库。失败回滚并关闭连接，未来schema拒绝。旧schema1..6真实fixture保留会话/消息/归档/置顶/配置/同意/密文，两次启动及FTS/完整性/外键通过。不是只测试改版本字符串。

本次365源码通过/8环境跳过、64文件通过/2跳过，Biome194/两TS/生产构建/依赖审计/23资源预检/14打包图标Node测试通过；最终边界小修专项49项通过。真实update-zip-smoke7组、通用desktop21项通过，具体证据见VALIDATION_1.2.6末尾。新smoke顺序运行，使用9371/9372、临时profile，真实PowerShellZIP和公开GitHubHTTPS；编译无副作用probe替代安装器，经真实app.relaunch实际启动并确认父退出/SQLite关闭，无安装。Node inspector会持有进程，记录状态后须断开再等exit，不强杀后误报成功。三协议相关服务/隐私与手册/日志中英文、部署/许可/安全/设计已同步；免责未涉及不改、POLICY_VERSION不变。新增yauzl3.4.0生产及@types开发依赖，保留lockfile，不编辑node_modules。

### 1.2.6 README与发布公告同步

本轮仅文档/SQL材料：README在开头集中说明1.2.6的会话层级、计划/任务树、十内置Agent、跨语言索引、缓存验证、恢复冲突、单滚动按钮、ZIP更新和永久schema迁移，移除“四种默认Agent”旧描述及隐私段落中散落的功能清单。区分安装用户与源码开发依赖，不改应用代码或版本。

新增`supabase/publish-release-1.2.6.sql`，用于过渡版1.2.6的page下载发布，需手动部署0003；沿用用户提供的123pan分享页，尚未验证里面的文件为1.2.6，执行前由维护者确认或更换。含585字更新公告、幂等upsert，page时显式清空hash/size。未来1.2.7+ZIP模板仍在publish-release.sql，README/两份部署说明互相链接，不把分享网页误标ZIP。未执行云SQL、未改其他应用表、未生成安装包。已核对README本地链接/版本/SQL字段/1000字约束、diff空白及用户入口--check23资源通过；未声称本轮重跑源码/桌面或云端PostgreSQL执行。委派审查通道仍报unsupported_encrypted_agent_content，工作在主会话完成。

### 1.2.6 恢复计划与任务树输出补充

用户要求恢复点续跑继承当前计划/待办、中断任务停止转圈、主会话任务树箭头预览子输出而名称才导航，仍1.2.6并提供用户自行打包命令。`SessionWorkbenchService.persistedPlanPrompt`统一当前计划的权威说明/版本/步骤状态/依赖/断点；`ChatService.resumeSession`原会话继续，仅解除暂停，不重置完成状态，并将最新用户编辑纳入恢复消息，每轮系统提示重新读取。既有uncertainty/ledger及并发修改保护保留。

`lib/plan-status.ts`仅实际运行未暂停显示spin；其他进行中步骤展示静态已暂停/等待用户/已中断/任务失败/待继续，不修改存储状态。`TaskWorkbench`独立箭头展开，名字跳转；只调整workbench内部滚动，已完成行不显示过期活动或重复状态。工作台使用可收缩flex列/限高/裁剪，不覆盖compact composer。`SubagentOutput.tsx`懒加载最近本地输出并接受App已有liveBySession，思考和工具details/刷新/空错误状态双语，独立滚动上滑暂停跟随、底部恢复，卸载清监听/定时器。

`workbench:subagent-output`贯穿shared/preload/main，经既有可信IPC及consent限制；Repository按真实直接父子关系检查，SQL限定17条assistant/tool消息、24个part、每条12000/总48000字符，不加载完整聊天/附件/用户委派或原始工具参数，截断标记。没有schema迁移或新增云收集。中英文手册/日志、README/DESIGN同步，三协议及POLICY_VERSION不变。

实际验证：377源码测试通过/8环境跳过（66文件通过/2跳过），Biome198、两TS/生产构建、23资源预检和14打包路径/复制/图标Node测试通过。新`task-workbench-ui-smoke.mjs`用9373/9374、独立临时profile/项目+本地Responses SSE，4组8请求，两个真实worker，覆盖流式预览/主timeline不动、键盘折叠、名称跳转、完成/reload、预览刷新保持阅读、停止保存计划后退出重启/续跑及英文日间1040×680边界。完整v126-workbench最终15组41请求/worker峰值2通过，包含native索引/七grammar/真实项目测试失败→修复/断点/写入转交/恢复只写一次/105会话分页和10文档；滚动19项160段输出通过。截图已查看。

首次完整回归native索引超时，后续最终重跑真实通过；夹具误识别父参数、键盘事件缺Enter文本、折叠/分页选择器及reload composer抢焦点时序已修正，不将失败脚本算作通过。截图发现预览正文藏在滚动区下方/compact工作台越界，产品修复并新增断言。源码out已更新，可`run-experimental.cmd`，用户正式打包仍根目录`package-win.cmd`，生成1.2.6 EXE+ZIP/hash/JSON；本轮无NSIS/解包、云SQL、真实付费模型或BrowserDo/Embiody调用。委派审查仍返回unsupported_encrypted_agent_content，工作本地主会话完成；更多边界见VALIDATION_1.2.6末节。

### 2026-11-06 / 1.2.7 计划生命周期与文档附件

用户要求完成/废弃计划及时清理，相关中断任务保留并正确续跑，修复上传PDF/Word无法阅读，升级1.2.7并同步内嵌文档。沿用现有结构、原子图标、schema7和永久migration；不动用户DB、不生成安装包、不执行云SQL、不使用历史Key。

`SessionWorkbenchService.prepareTurn`在下一条用户消息清除全terminal活动计划；unfinished普通新请求标记reviewRequired，静态待确认。当前模型通过只读`review_plan`比较最新请求keep/discard并给原因；元数据保存原key，无schema变更。先判断再执行其他工具，revision guard保留用户编辑，非法action/空原因不更新；不放宽文件审批、恢复ledger或workspace屏障。旧历史todos不能复活权威空计划；显式resume在生成恢复消息前准备计划并保留最新进度。未正确判断最多三次请求后失败，可重试/编辑，不无限转圈。源码测试保留项目计划库与不确定恢复记录。

`shared/attachments.ts`统一识别可解析文件；`documents/attachment-content.ts`对上传字节直接调用内置解析器、核对25MiB/size、保留120K字符及明确截断/错误。新消息保存派生文字，旧附件请求和压缩前懒解析不改原文；cache为16个内容hash项。三协议文本fallback包含实际文字，Responses/Anthropic原生PDF仍按file配置。Office ZIP预检4000项/100MiB总/32MiB单项/加密拒绝，不执行宏/外部解析器。本阶段尚无扫描OCR和旧DOC支持，该限制已由下方同版本补充取代；不能把所有二进制都写成支持。

三协议中英文适用版本、手册/日志、README、SDK和启动/打包版本同步1.2.7；隐私说明提取文字/摘要，POLICY_VERSION仍2026-11-04.3。当前ZIP模板publish-release.sql为1.2.7，1.2.6 page SQL保留历史。update-download测试高版本fixture改998.998.998，避免应用升版让“新版本”测试无效。

最终393测试通过/8环境跳过，Biome201、两TS、build、audit、23资源和14打包/图标测试通过；真实Electron新7组15本地请求及原恢复/子输出4组8请求通过，截图已查。详细范围、脚本端口和未验收边界见VALIDATION_1.2.7。实验out已重建，run-experimental.cmd直接运行；用户自行打包仍package-win.cmd，输出1.2.7 EXE+ZIP/hash/json。无NSIS/解包、付费模型、真实账户MCP或BrowserDo调用，不宣称零Bug。

收尾`.PDF`扩展名大小写规范化修正后，相关六文件71项测试、Biome201、build和diff检查再次通过，最终out包含该修正；393项仍为此前完整回归结果。

### 2026-11-06 / 1.2.7 扫描PDF、视觉输入与旧DOC补充

用户补充扫描/手写PDF及DOC/DOCX兼容，版本继续1.2.7、schema7和协议修订2026-11-04.3不变，不新增云服务、不使用历史Key或用户DB、不生成安装包。既有计划生命周期修复保留。

- `document-worker.cjs`使用随包unpdf、`@napi-rs/canvas@1.1.0`、`tesseract.js@7.0.0`和eng/chi_sim@1.0.0语言数据；本地离线OCR只读应用语言包，无CDN或独立OCR服务。`word-extractor@1.0.4`读取真正Word97–2003 OLE `.doc`，DOCX沿用mammoth，不执行宏或外部命令。
- `pdfReadMode`按当前协议/模型选择：Responses/Anthropic配置file时原PDF；否则image模型带页码PNG；否则本地OCR。Chat Completions即使标记file也不能假装有原生PDF，使用image或OCR。混合文字/图像页面同样OCR；手写/公式优先视觉，结果不保证正确。
- 输入25MiB、文字120K字符、本地检查200页、渲染/OCR20页、图像总20MiB/长边2000px。两个并发worker，可取消排队和执行，180秒超时，停止等待terminate；worker是可信解析器的资源控制，不是OS沙箱。`doc.loadingTask.destroy()`清理PDF资源；Tesseract使用字符串`eng+chi_sim`和本地langPath，不能传code/data语言数组（已复现上游错误）。临时目录仅含语言数据，finally清理。
- cache最多16项且48MiB，成功才缓存，取消/失败可重试；不共享在途取消。提取文字/模式/页数保存在原附件，页面图像不入库，切换模型/重启按原附件重建。摘要包含提取警告及部分读取范围，不把OCR缺字解释为页面为空。
- `read_document/read_file`仍先审批，MXC/Docker通过`read_binary`读取最多25MiB再交可信解析器；不因解析失败回退未批准宿主读。Docker二进制网关已补全，保留无网络和路径/链接边界，空stdout保留真实daemon错误，非零退出拒绝结果。
- worker来自resources/documents或基于模块路径的开发资源，不从项目cwd加载。builder额外复制worker，asarUnpack包含canvas、OCR及其worker依赖；预检/afterPack检查绑定、语言和三种LSTM WASM。language/WASM缺失明确失败；保留新增生产依赖和lockfile，不修改node_modules。

新增真实光栅PDF测试夹具及上游MIT许可DOC夹具（来源/哈希见`scripts/fixtures/legacy-word-LICENSE.md`），不随应用分发。源码全量405通过/9环境跳过，Biome204/两TS/build/audit/24资源预检通过；本轮新增沙箱读取在真实MXC、Docker各一组通过。Docker起初daemon未运行，启动已有Docker Desktop29.9.2后重验成功。`document-vision-smoke.mjs`9377/9378，真实Electron8组7次本地请求验证三协议/两原生PDF/中英OCR/两Word格式、重启图像重建、OCR停止且不发请求；`v127-plan-attachments-smoke.mjs`7组15请求回归通过。`document-asar-smoke.cjs`在真实Electron使用临时ASAR及物理解包OCR依赖验证OCR/渲染/DOC，不能替代完整安装验收。UI脚本继续顺序执行。

完整`.\package-win.cmd --dir`尝试在复制`d3dcompiler_47.dll`阶段仍EPERM，保留诊断目录`%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.2.7-L4ztzi`，未生成完整解包应用/NSIS；不得关闭防护或修改ACL绕过。README、双语手册/日志/隐私及SECURITY/第三方清单同步，服务/免责无新条款不改。视觉模型请求只做本地SSE内容验收，没有真实付费模型手写识别质量验收；语言覆盖为简体中文/英文，不能承诺任意手写/语言准确。实验入口仍`run-experimental.cmd`，先build后启动。

### 2026-11-06 / 1.2.8 连续工作区与全页面升级

本轮用户明确要求按已确认方案实施1.2.8，不再停留调研，保留原功能并全面回归，仅交付实验版。沿用Electron/React/TS/pnpm、原子图标、日夜/中英文、schema7永久迁移、POLICY_VERSION2026-11-04.3；不动用户DB，不生成解包或安装包、不执行云SQL。

新增shared/ui-preferences.ts、UiPreferences/LayoutPicker/PanelResizeHandle及受限IPC，在app_settings存ui.preferences；校验模式/尺寸/项目条目，异步保存串行，失败可见重试，读取失败不覆盖。App单48px标题栏portal、三布局/连续面板、指针键盘尺寸、窄窗互斥抽屉，保留组件身份和编辑草稿。workbench.css收敛新版外观并移除被替代的旧选择器；后续勿再追加多层互相覆盖的布局规则。

ChatView将模型/Agent/权限详情集中到输入区；计划空态隐藏/默认折叠，协作模式停靠任务树；审批突出单次/拒绝但不改变权限，聊天Home/End/Page按容器处理。WorkspacePanel增加本轮审查和命令停靠、按需恢复轨迹和100条命令批次，编辑读取防旧root/文件异步结果覆盖。设置六组/search、供应商分栏/三tabs、MCP搜索详情、Agent行、定时筛选与轨迹懒挂载、文档目录。源码安全执行规则未因UI简化放宽。

最终截图修复抽屉grid定位、MCP重叠、重复轨迹摘要和审查框；空会话follow忽略占位内容，避免品牌图标被滚出。长轨迹摘要独立details/分批，导出失败就地显示。新版smoke14组含24截图矩阵、全部16设置、10000会话P95 65.7ms/3行DOM、1000命令、8个子任务状态、草稿/编辑DOM持久和关闭动效；八状态不是八实际worker，真实工作台四worker峰值2另测。CDP像素scale不是实际系统DPI认证。

最终408源码通过/9环境跳过、Biome209/两TS/build/audit/24资源/14Node打包图标通过；原桌面焦点10/通用21/滚动19/历史13/审批恢复6/提问9/Agent选择9/会话11/压缩9/CTX6/v1258/工作台15/子输出4/计划附件7/文档8/审批通知6/ZIP7组通过，详细范围以报告为准。README、双语10内嵌文件及版本入口同步；三协议仅适用版本更新，不改条款或同意修订。设计文档和收尾审查委派各两次上游unsupported_encrypted_agent_content，主会话按降级清单完成，不算独立审查通过。

可直接run-experimental.cmd查看最终out；修改源码需先build。package-win.cmd仍供用户未来自行打包，预期产物1.2.8 EXE+ZIP/hash/json；本轮没有再追查环境DLL EPERM。正式安装/付费模型/真实账户MCP/Windows全DPI和用户可用性研究仍未验收；BrowserDo/Embiody继续免真实调用。

### 2026-11-06 / 1.2.8 打包与发布材料复核

用户要求核对清单并提供自行打包命令及发布SQL。本轮用户入口`package-win.cmd --check`通过24资源、生产依赖、文档版本及原生哈希检查；14项路径/复制/图标Node测试通过。核对builder的生产依赖、OCR/grammar解包、文档及许可映射和NSIS参数；不重新生成解包或安装包，不追查用户已确认的环境DLL问题。ZIP发布模板及两份部署说明同步1.2.8，公告符合1000字符限制；URL、ZIP哈希与字节数需用户打包上传后填写，未执行云SQL。若云端仍启用8.8.8等较高测试版本，由维护者确认停用，本轮不修改云记录。预检与脚本测试不等于正式安装/升级验收。

### 2026-11-06 / 1.2.9 模型自动重试

用户授权新增自动重试并升级1.2.9。配置在现有app_settings的`models.retry`，默认每次断连5、0–20整数，初次请求不计入；恢复有效输出后重新计数，不是整段对话/任务/流式回复的总额。shared/model-retry.ts集中约束，main验证、typed IPC/preload、运行与集成设置及搜索中英文入口完整；不迁移schema7，不动用户DB。

providers/model-request-error.ts分类临时HTTP/上游流错误、Retry-After、退避及可取消等待；streamModelTurn仅重试当前请求，逐次脱敏记录失败。ChatService.onRetry清空当轮累加器及未完成工具参数，关闭未完成文件准备活动、发送model_attempt_reset，保留已执行工具结果/检查点；主/子/定时共用，停止不再重发。认证/权限/参数/证书/策略错误不循环。未知错误保留，工具副作用不重试。ACP无法撤回chunk，提供明确分隔，不冒充已删除远端文字。

审批/压缩在主备各一个逻辑尝试内使用相同传输重试；valid DENY不改判，主备选择/凭据/隔离规则不变。45秒审核/300秒摘要片段总时限包含等待，可能先于次数耗尽；不能承诺必定跑满20次。旧文档“主备各一次”现在指逻辑尝试，传输可多次。设置0用于关闭，也用于历史failover测试隔离；新增partial-reset测试不使用私人模型。

最终443源码通过/9环境跳过，Biome213、两TS、build、24资源预检和14Node打包/图标测试通过。真实Electron新重试9组（18普通/父请求+2子请求）、工作台15组42请求/worker峰值2、审批恢复6组通过；截图已检查。详细范围见VALIDATION_1.2.9.md。新版smoke端口9385/9386，GUI测试顺序运行。Impeccable detect两设置组件无发现，无本轮独立审查委派。

双语十文档、README、版本入口及发布SQL模板同步，政策修订号仍2026-11-04.3（同供应商重复请求/额外用量澄清），schema7永久迁移不变。最终out已重建；实验入口run-experimental.cmd，自行打包package-win.cmd，预期1.2.9 EXE+ZIP/hash/json。无NSIS/解包/云SQL/私人Key，未追查已确认的DLL环境问题。尚无真实所有供应商及全安装流程保证，BrowserDo/Embiody免真实调用约定保持。

### 2026-11-06 / 1.2.9 按每次断连独立计数补充

用户澄清重连上限按每次断连计算。本轮发现原实现跨完整模型请求已独立，但同一streamModelTurn内恢复部分输出后再次断连仍累加；改为consecutiveRetries，在文字/思考/工具名称或参数取得新进展后清零，下一次断连重新1/N，退避也从1秒开始。成功完整请求天然结束本地计数，日志attempt仍保留实际请求序号便于排错；不保存全局/会话耗尽状态。

每个流通道比较已见前缀，不受token分块影响，接受更短但不同的新内容；空响应/心跳/usage/相同未完成片段不能伪装恢复而无限清零。新增可选onRecovered回调，ChatService只在有效恢复或完整结束后更新“连接已恢复”，不因任意usage事件提前报成功；中文等待标题为“正在自动尝试重连（n/N）”。只重发当前模型请求，部分内容仍丢弃，已执行工具不重放，取消/主备总超时/审批安全规则保留。

新增9项源码回归，最终全量452通过/9环境跳过（72文件通过/3跳过）、Biome213、两TS和生产构建通过；用户入口--check24资源通过。真实Electron重试专项10组/25普通父请求+2子请求通过，同一次流式回复实际经历三组1/2、2/2重连并成功；覆盖已执行工具一次、定时/子Agent恢复、取消等待、403、0禁用/上限耗尽、持久化与中英文日夜截图，已查看。专项仅临时profile/本地SSE，不接触用户DB、私人Key、云SQL或NSIS；其他工作台/审批UI旧结果不冒充本轮重跑。

README、双语手册/日志、服务/隐私的次数说明及发布SQL模板同步，版本仍1.2.9，免责未涉及不改，schema7/协议修订号2026-11-04.3不变。源码out已build；run-experimental.cmd查看实验版，正式包仍由用户package-win.cmd自行生成，未执行打包安装。

### 2026-11-06 / 1.2.9 剪贴板图片附件

用户要求截图/图片可Ctrl+V或右键粘贴到对话附件，版本保持1.2.9。ChatView只处理主输入框paste事件，clipboard-images.ts提取image File并生成唯一名称，避免相同image.png/大小被既有addFiles误去重；无图片不preventDefault，普通文字保留原生行为。复用25MiB、模型能力、移除、dataURL、send和消息持久化，不自动发送、不下载网址、不做后台监控或剪贴板历史读取。

ComposerEditMenu复用session-menu样式和Lucide，剪切/复制/粘贴/全选、选区禁用态、视口限位、方向键/Home/End/Enter/Esc和返回输入框焦点。shared/preload/main新增composer:edit-command，只接收四个原生webContents编辑命令；既有可信顶层来源/consent及前台focus检查保留，不暴露任意剪贴板读写。保持schema7、永久迁移、POLICY_VERSION2026-11-04.3、原子图标和现有主题。

最终456源码通过/9环境跳过（73文件通过/3跳过），新增4剪贴板测试；Biome216、两TS、main77/preload3/renderer2114生产构建及24资源用户入口--check通过，diff空白检查和Impeccable detect通过。clipboard-attachments-smoke.mjs用9387/9388、独立临时profile/本地SSE，真实Electron9组/1次请求通过；真实系统图片和文字粘贴、复制剪切全选/焦点/键盘、两张图实际请求与保存、移除、纯文本拦截及双语主题菜单均验证。25MiB超限用合成ClipboardEvent，不冒称实际大图系统剪贴板验证。截图已查看，GUI检查继续顺序执行。

初次全量与GUI/TS并行有既有日志/PDF两测试超时，GUI结束后完整重跑通过；没有提高超时或改安全规则。测试须await原生复制及Enter字符事件。Electron45使用异步ClipboardItem/Blob接口，旧readImage/writeImage不可用；测试备份需按类型保存Blob重建ClipboardItem，read返回对象不能直接写回。首次原剪贴板恢复失败已披露，后续最终测试备份恢复成功；不得把用户剪贴板内容存仓库。

README和双语手册/日志/隐私同步，仅澄清主动粘贴与普通附件处理，服务/免责/协议修订不改；详细证据见1.2.9报告末节。最终out已更新，可run-experimental.cmd；没有NSIS/解包、云SQL、私人Key或用户DB操作，未重跑历史全部GUI专项，不宣称所有第三方剪贴板格式或付费模型认证。

### 2026-11-06 / 1.2.9 回复与代码块复制

用户要求已完成回复和对话代码块都有复制按钮，继续1.2.9。ChatView在已保存且无工具调用的assistant文字下提供复制原始Markdown入口，不拼入思考/工具/其他消息。MarkdownLite在DOMPurify清理后包装pre/code为语言/复制顶栏，React portal挂载CopyButton，复制code.textContent；围栏/无语言/缩进块均可，行内代码不变，流式块可复制当前内容且不提供整条流式回复复制。

CopyButton使用navigator.clipboard.writeText及现有message-action，32px图标、复制中/成功勾选/失败重试、title/双语aria与visually-hidden状态；内容更新/卸载清计时并忽略迟到回执。仍使用原HTML清理和文件链接路径，无新IPC/依赖/数据库/schema/权限或云传输。README/DESIGN、双语手册/日志及本交接同步，三协议/修订号无变化不改。

456源码通过/9环境跳过（73文件通过/3跳过），Biome217、两TS、最终build main77/preload3/renderer2115及24资源--check通过。message-copy-smoke.mjs端口9389/9390，独立临时profile/本地SSE，真实5组1请求通过，含整条Markdown、四类代码块/原文字符、流式更新、失败重试、重载、键盘和双语日夜1040×680；chat-scroll-smoke19项160段回归通过，截图已查看，diff空白/detect通过。GUI顺序执行，无用户DB/私人Key/NSIS/云发布。

测试系统剪贴板需备份每个类型Blob并重建ClipboardItem后恢复；Windows LF转CRLF是正常平台行为，断言只规范此项。截图发现sr-only未定义和Copied缺译，已用既有visually-hidden并补en；修正后build/复制专项/滚动/TS/Biome重验通过，456全量为这两处纯展示修正前的运行，不虚报再次全量。最终out可从run-experimental.cmd启动，详细边界见VALIDATION_1.2.9末节，未重新验收全部历史GUI或正式安装。

### 2026-11-06 / 1.2.9 打包与发布材料复核

用户要求核对并提供自行打包命令及1.2.9 SQL。实际用户入口--check24资源/依赖/原生哈希/十文档版本通过，四个Node打包/图标文件共14项通过；核对builder NSIS x64当前用户、原子图标、生产依赖、OCR/grammar解包、文档/许可映射以及EXE→ZIP/hash/json产物。publish-release.sql公告补齐图片粘贴和回复/代码复制，保留mingshen表/v2 RPC、1.2.9幂等upsert与ZIP元数据约束；URL/hash/size由用户打包上传后填写，旧云项目未部署0003时须先手动迁移。

没有生成NSIS/解包、没有写云SQL或动用户DB，未追查用户已确认的DLL环境问题，未冒称重跑历史全量测试。命令仍根目录package-win.cmd，预计release-artifacts下1.2.9 EXE+ZIP+sha256+json。完整范围见VALIDATION_1.2.9末节；高版本8.8.8测试发布若仍生效需维护者确认停用，不能自动修改。

### 2026-11-06 / 1.2.9 工具参数与本地浏览器预览修复

用户反馈命令工具和文件读取偶发出现 `command/path undefined` 参数传递错误，并发现内嵌浏览器打开本地文件时会把路径强制补成网页协议。本轮保持版本 `1.2.9`、schema7、协议修订号和数据库不变。

- `model-stream.ts` 及 `chat-service.ts` 现在对 Anthropic、OpenAI Responses 和 Chat Completions 的完整工具参数快照、增量参数、晚到调用 ID、并行调用及冲突索引做一致归并；`tool-registry.ts` 对必填参数校验失败返回明确 `TOOL_ARGUMENTS_INVALID`，不再把缺参请求静默执行为空对象。
- 新增 `main/browser/browser-url.ts`，集中处理 HTTP/HTTPS、搜索、Windows 绝对路径、`file://` 和工作区相对路径。浏览器本地文件必须属于当前会话工作目录，并通过 `safeFilePath` 拒绝越界、Git 元数据、网络共享/设备路径和不安全协议；不存在的工作区内目标可生成预览 URL，但不会读取工作区外文件。
- `BrowserService` 从仓库按会话读取工作区，浏览器工具和地址栏统一走主进程规范化；内嵌 webview 对未获批准的本地文件导航拦截。普通网页地址行为保持原样，浏览器不再把本地路径补成 `https://`。
- 新增 `browser-url.test.ts` 覆盖网页、搜索、中文/空格路径、相对文档、`file://`、越界路径和危险协议；参数修复回归覆盖模型流、重试运行时和工具缓存。

本轮实际验证：

```text
pnpm --filter @mingshen/desktop exec vitest run \
  src/main/browser/browser-url.test.ts \
  src/main/providers/model-stream.test.ts \
  src/main/providers/model-retry.test.ts \
  src/main/chat/model-retry-runtime.test.ts \
  src/main/tools/tool-cache-index.test.ts
```

结果：5 个定向测试文件、91 项通过；完整 Vitest 以 `--no-file-parallelism --testTimeout=30000` 运行后为 74 个文件通过、3 个环境跳过、481 项通过、9 项环境跳过。并行默认模式下个别既有 750 轮工具和日志轮换测试受 Windows worker 启动/磁盘竞争超过各自 20s/5s 阈值，单独及串行重跑均通过；不是本轮功能失败。`pnpm --filter @mingshen/desktop typecheck` 通过；`pnpm build` 通过（main 78、preload 3、renderer 2115 模块）；`pnpm package:check` 通过（24 项资源、生产依赖及 1.2.9 版本检查）。本地浏览器测试使用临时工作区和文件，不访问用户数据库、真实 Key 或云端服务。未生成安装包，正式安装/升级和第三方供应商质量仍不在本轮验收范围。

## 10. 继续开发前仍需核对的缺口

- 本周期没有正式 NSIS 安装、卸载、升级迁移成功证据；不要在后续对话中误报“安装包完整验收通过”。
- 真实 Anthropic/各代理、多模态和思考参数兼容仍依赖供应商；本地 SSE 夹具不是所有网关的真实验证。
- 85% 自动上下文压缩已接通，行为与证据见上文及最新验证记录；不同网关 tokenizer、多模态估算和付费供应商摘要质量仍需实际确认。原始排队/插入等要求仍须追踪对应代码，不能仅照功能文案。
- 当前用户命令面板在 `WorkspacePanel.tsx` / `workspace-service.ts`，不是原始规划的 xterm.js + node-pty 终端。1.3.0 新增模型使用的管道命令会话，入口为 `exec_command` / `write_stdin` 与 `tools/persistent-command-service.ts`；也不支持完整 PTY/TTY 专用程序。
- 定时任务当前为应用内扫描，托盘驻留可继续；彻底退出后不能运行，不应写成已实现独立 Windows Task Scheduler 守护进程。
- LSP TypeScript 路径已真实覆盖；其他语言依赖对应服务或项目检查，ACP 是现有桥接子集，不等于所有编辑器功能认证。
- BrowserDo/Embiody 原环境失败是历史记录，用户已要求停止真实调用测试；除非收到新指令，不再把该项当必须修复的当前阻塞。
- 截图、界面静态文案和英文设置曾检查，不等于全面无障碍、视觉或所有动态第三方文案完全本地化。

## 11. 后续交接记录格式

每次涉及关键行为的工作，在本文相应位置更新事实，并按需追加简短记录：

```text
日期 / 应用版本 / 协议修订：
用户本轮目标：
修改模块和原因：
保留约束、兼容与数据迁移：
执行的命令及实际结果：
模拟 / 真实环境 / 跳过或未通过：
构建输出（如有；勿写私人密钥或会话）：
后续尚需验证与下一步：
```

不要将“计划做”“工具存在”“一次构建成功”“环境缺少凭据”统一记成“全部通过”。把证据留在仓库文档中，减少后续对话依赖聊天记忆。

## 12. 2026-11-07 / 1.2.9 受控执行链与项目记忆

用户本轮要求在不升级版本的情况下加入两项能力：对已确定的工具动作减少重复模型往返；为每个工作目录维护分层 `.harness-memory/`，主 Agent 可写、实际 Subagent 只读，并同步内嵌文档。

实际修改：

- `main/chat/tool-chain.ts` 新增 `execute_tool_chain`，2–8 步静态 schema、依赖和文字 guard；`chat-service.ts` 将其展开为真实独立工具调用，继续使用审批、隔离、写入锁、计划版本、诊断、检查点和活动记录。失败、拒绝、取消、计划变化、诊断或未知副作用会停止后续动作。它不是跨任务推理缓存，不缓存或重放副作用。
- `main/agents/project-memory-service.ts` 提供工作区 `.harness-memory` 服务：偏好、日记、索引、归档、大小/路径边界、原子写入、同进程串行、SHA-256 revision 冲突、精确去重、检索切片和已识别秘密脱敏。偏好6KiB、活跃日记50KiB、源文件256KiB、检索源合计2MiB/最多40归档；旧任务摘要完整归档，不再次调用模型语义改写。派生索引预览256KiB，预览截断不影响完整来源检索；正文内元数据式标签不会在后续写入中被误删。
- `memory_search` 只读，`memory_write` 由主会话 broker 控制；实际子会话普通文件工具拒绝记忆编辑，命令经原生 MXC/Docker 的记忆只读保护，不向子任务开放宿主自定义工具、Hook、LSP 或 stdio MCP。可写远程 MCP 不向子任务开放；第三方只读声明仍属信任边界，不能称为操作系统强制保证。
- `chat-service.ts` 在运行前只加载偏好，相关时检索日记；显式长期偏好可捕获，推断偏好先询问用户；成功主任务触发一次无工具摘要请求。摘要失败只记录活动/日志，不破坏主任务；子会话和只读 Plan 不写摘要。
- IPC/preload、项目设置记忆页、斜杠菜单、英文文案和 ChatView 状态同步，并对 session、命令、文档、内容、revision 做长度/枚举校验。记忆设置支持查看、编辑、删除、检索、开关和冲突提示。
- 新增 `project-memory-service.test.ts`、`tool-chain.test.ts`、`decision-memory-runtime.test.ts` 共23项，覆盖真实工具与模型请求计数、历史配对、预算、失败/拒绝/取消/计划变化/诊断、开关、摘要有效性、主子权限和真实提问确认。原生沙箱专项增加记忆目录只读/普通文件写入检查；junction 夹具在 EPERM 时只跳过该子断言，不将其当作本轮独立通过证据。

实际验证：

```text
最终全量：77 个文件通过、3 个环境跳过；504 项通过、9 项环境跳过（98.38秒）
TypeScript：通过
Biome：226 个文件通过
构建：main 80、preload 3、renderer 2116 模块通过
资源预检：24 项资源、生产依赖和 1.2.9 版本通过
打包/图标：四个Node测试文件、14项通过；生产依赖audit无已知漏洞
原生沙箱：启用MINGSHEN_NATIVE_E2E后2项通过，含普通写入与记忆目录只读
桌面：记忆/执行链7组，审批恢复6组，滚动19项通过
UI：中英文日夜1040×680截图已查看；两组件源码正则检测未报告问题，不是完整DOM可访问性审计
```

`scripts/project-memory-chain-smoke.mjs` 使用renderer9391/main9392、系统临时profile/项目和本地SSE，7组通过，7次普通Agent请求加3次独立日记请求。一次真实两文件读取只需两次普通模型请求（声明执行链、读取后的汇总），日记另计，不把它隐去以夸大收益。覆盖真实输入框命令、偏好复用、按需检索、推断偏好Skip、双标签草稿/外部revision冲突、关闭自动注入和摘要、重载与双语主题。UI专项顺序运行，不读用户DB/Key、不动剪贴板；只收尾自己的测试进程和临时目录。

README、SECURITY、中英文手册/更新日志/隐私政策和 `docs/VALIDATION_1.2.9.md` 已同步。服务与免责条款未涉及不改，隐私补充同一配置模型的摘要及本地记忆处理说明；schema7、政策修订号 `2026-11-04.3`、数据库迁移、图标和打包入口未改变。没有生成安装包、执行云 SQL 或使用私人凭据。

后续边界：参考上游 HarnessMM 的既定决策复用思路，自写受控静态执行链，不是论文完整复现、跨任务自动学习银行或普遍Token/延迟收益认证。Docker引擎当前未运行，本轮没有把Docker真实测试计为通过；9项环境跳过、真实付费模型摘要质量、全部第三方MCP、正式安装升级和跨进程恶意hardlink竞争仍未认证。实验版入口仍为 `run-experimental.cmd`，正式包由用户自行运行 `package-win.cmd`。

## 13. 2026-11-07 / 1.2.9 内置 Token Saver

用户要求以节省 Token、保留任务质量和用户可控为目标加入内置插件，继续 1.2.9。没有创建替代工程或改包管理器；schema7、永久迁移、协议修订号 `2026-11-04.3`、图标、审批和隔离保持。

实际入口与模块：

- `shared/token-saver.ts` 定义严格配置、默认值和报告。`main/token-saver/` 包含请求精简、原文召回、配置/报告和逐次请求用量记录，复用现有 Repository 的 `app_settings`。
- 设置 → Skills 与插件 → Token Saver 提供总开关、轮次/大小阈值、回复档位、安全精简和高级摘录；输入数值和跨字段条件先做本地中英文校验，保留草稿，定位无效字段，不发送错误配置。CTX 及设置复用统计与原文分页预览。
- 默认启用，保留最近5轮；未压缩历史达到12轮且待摘要部分至少2048估算 tokens 时复用现有主备压缩模型。seq0 摘要/诊断不算用户轮数，工具调用和结果不能拆开；85% 窗口保护仍优先，必要时可压缩更近的安全边界。失败、取消或没有缩小上下文不保存半摘要。
- 精确重复引用、JSON词法空白精简、安全YAML转换、运行时JSON精简和明显非代码任务的代码提示按需加载默认开启；安全、核心、工具、用户/项目和扩展指令保留。较早助手解释的相关性摘录、长JS/TS代码AST提纲、成功工具结果首尾摘录默认关闭，且必须提供可用的 `recall_context` 才执行这些有损摘录。
- 原始消息不修改，近期轮次、工具参数、错误、用户约束和配对受保护。`recall_context` 只查当前会话，最多200行/16000字符，支持长单行偏移和下一段；普通分支与二次分支通过本地别名映射读取自己的消息副本，源会话删除后仍可回读，不能据ID读取另一聊天。
- `streamModelTurn` 按每次实际传输尝试记录供应商已返回的用量，包括部分失败/重试；普通推理、压缩、审批、记忆摘要和标题分别累计。缺失、部分报告及失败计数分开，不虚构未报告值。最近请求估算仅比较相同提示和工具下的精简前后输入，不等于真实账单对照；摘要开销另计。
- 删除会话清用量/报告/摘要估算/分支别名；改写历史清失效报告与摘要估算，已消耗用量不退回。请求精简和回复规则下一模型请求生效，系统提示模块下一用户轮重新加载。复用现有索引、工具缓存和执行链，不缓存重放副作用。

最终验证：全量串行 Vitest 为78文件通过/3文件环境跳过、534项通过/9项环境跳过（103.03秒）；两套TypeScript、234文件Biome和生产构建（main84/preload3/renderer2215）通过。真实Electron Token Saver 6组（12次普通请求、2次摘要请求）、审批恢复6组、滚动19项/160段输出通过。用户入口`package-win.cmd --check`24资源及四个Node打包/图标测试文件14项通过，脚本语法和diff空白检查通过。桌面使用临时profile与本地SSE，未读用户DB/Key、未操作剪贴板；GUI顺序运行。中英文日夜1040×680设置/CTX和中文校验截图已查看；UI独立收尾审查对已列出的校验问题给出Ship，不是全平台可访问性认证。

测试过程边界：首次全量的4个失败是既有mock缺少新读取接口或预期未包含内置召回工具，补齐夹具且保留审批/隔离/深度断言后最终全量通过。桌面脚本补齐Windows Backspace键码，并等待下一帧焦点迁移，防止把测试输入未清空/断言过早当作产品失败；最终完整桌面专项通过。不要弱化这些断言或把失败轮次计为通过。

README、SECURITY、中英文手册/更新日志/隐私政策及1.2.9验证记录同步；服务和免责条款无实质变化不改。没有新增依赖、云端服务或完整聊天副本。源码out已重建，实验入口仍 `.\run-experimental.cmd`；不生成安装包，用户打包入口仍 `.\package-win.cmd`。真实付费模型的摘要质量、净账单收益、第三方全部兼容及正式安装升级仍未认证；不能承诺固定节省率或绝对零信息损失。

## 14. 2026-11-07 / 1.2.9 提问与修改冲突通知

用户要求 Agent 提问及多 Agent 修改冲突等待人工处理时发送 Windows 原生提醒；继续1.2.9，不生成安装包。沿用现有通知身份、图标、日夜/中英文、schema7永久迁移和政策修订号`2026-11-04.3`，保留上一轮Token Saver等未提交实现。

- 新增`main/desktop/question-notifications.ts`，由权威QuestionBroker快照驱动。后台、托盘、最小化或其他会话待处理时提醒；前台当前会话只显示应用内面板。普通问题的按钮为“查看问题”，文件冲突为“处理冲突”，只打开准确会话，不代答、不批准、不转交写入权。
- `QuestionRequest.kind`由宿主分类；文件lease、可写扩展lease和外部文件变更三条路径标记`file_conflict`，模型参数不能伪造此分类。Broker增加只读`get(id)`供激活时核验真实pending。
- 复用CompletionNotifications唯一的`Notification.handleActivation`，先审批、再提问，完成快捷回复保持。随机tag与`mingshen-questions`组仅在内存路由；激活重新核验请求/会话/run，先消费再打开，避免全局及实例重复回调。回答、取消、停止、结束和删除清路由；旧run结束不得影响新请求。
- 设置 → 外观与语言 → 任务与交互通知增加默认开启的独立`questionEnabled`开关，遵循Windows原生通知总开关、预览和声音。旧配置/旧API省略字段时保留原值；隐藏预览不显示会话标题、问题或路径。通知错误记`notifications.question`本地日志，不影响人工面板或放行操作。

最终实际验证：完整串行Vitest为79文件通过/3文件环境跳过、557项通过/9项环境跳过，102.05秒；两套TypeScript、236文件Biome及生产构建（main85/preload3/renderer2215）通过。新增18项通知测试、3项单分发/兼容回归及2项运行时分类回归，共新增23项；三条宿主冲突路径均有断言。用户入口`package-win.cmd --check`24资源和四个Node打包/图标文件14项通过，脚本语法及diff空白检查通过。

真实Electron新增`question-notification-smoke.mjs`8组/16次本地模型请求通过，renderer9395/main9396、独立系统临时profile/项目：Windows历史XML与COM激活、准确跳转、应用内回答续跑、重复/旧通知失效、前台转最小化、双Agent真实文件争用及人工转交不重放旧写入、英文/隐私/静音、独立开关与重启/旧API兼容、中英文日夜1040×680及内嵌文档版本。三张设置/冲突截图已查看；既有审批原生通知6组、完成通知原生COM快捷回复/角标、审批恢复6组回归通过，GUI均顺序运行。

测试夹具首次过早读取Electron的临时通知CLSID，随后又在入口初始化前缓存了无app属性的模块；已把模块和固定CLSID读取移至renderer/preload就绪之后，最终完整8组通过。仅修测试等待，不改通知注册身份或放宽断言。测试使用本地SSE，不读取用户DB/Key/剪贴板、不调用收费模型或云SQL，只收尾自己的进程和临时目录。COM回调不是人工点击系统横幅，不代表所有勿扰/企业策略都允许横幅显示；9项环境跳过及正式安装升级未算通过。

README、SECURITY、中英文内嵌手册/更新日志/隐私说明和本轮验证记录同步；英文开关名称与实际界面统一。服务/免责条款未涉及不改，无新依赖、云通知或数据迁移。最终实验out已重建，可从`.\run-experimental.cmd`启动；没有解包或NSIS安装包。

### 2026-11-07 / 1.2.9 打包材料再次复核

用户要求仅检查材料并给自行打包指令。本轮核对`package-win.cmd`、package脚本、builder资源映射、Windows包装脚本及ZIP产物链路；Token Saver与提问通知已在构建main中，随`out/**`入包，无新增资源遗漏。十份内嵌文档、原子图标、native哈希/许可、OCR与七grammar/Windows绑定及生产依赖预检通过；修正`THIRD_PARTY_NOTICES.md`陈旧的应用1.2.7标记为1.2.9，以及Java wrapper版本为实际0.0.7，不改许可正文。

实际用户入口`.\package-win.cmd --check`24资源通过，四个Node打包/图标测试文件14项通过，diff空白检查通过。未生成解包/NSIS、未重跑前一节557项全量或GUI、不动用户DB与云SQL。正式命令仍为根目录`.\package-win.cmd`，自动重建后生成`apps\desktop\release-artifacts\MingshenHarness-1.2.9-x64.exe`及同名ZIP/ZIP.sha256/ZIP.json。预检不等于已验收正式安装、升级或卸载。

## 15. 2026-11-07 / 1.2.9 供应商提示缓存修复

用户反馈同一 API Key 在本应用的供应商缓存命中低于20%，其他客户端高于90%。没有读取其Key或账单，不能据此断言全部差距或承诺修复后达到90%；实际源码确认了多项会使请求前缀变化的原因。保留已有Token Saver、记忆、通知等未提交修改，版本1.2.9、schema7、政策修订号、图标和打包入口不变。

- `prompts/loader.ts`保留宿主内部session/turn标识，但不把追踪UUID序列化给模型；用户/项目/扩展指令先于运行快照。`runtime.md`明确初始快照与最新宿主状态的关系，实际执行层仍核验权限与计划版本。
- 新增`chat/host-context.ts`，将计划、记忆、代码提示、权限、诊断以`context.host.<session>`按真实消息锚点追加；内容不变不新增，不能插入未完成工具配对，诊断清除有空状态。seq0虚拟消息不进入聊天UI或用户轮数，压缩保留各节最新基线，分支重映射锚点，删除/回退清理。宿主快照须与前一真实消息归为同一压缩边界，不能把相邻快照当独立工具步骤。
- `token-saver/stable-input.ts`通过源消息哈希和变换片段持久化已发表示；近期窗口移动、新问题或后来重复项不改旧前缀。重复引用指向更早保留的原文。配置、历史或摘要变化可重新建立表示；模型和工具变化本身也会影响供应商缓存。UI专用状态/思考摘要/运行摘要不参与已传输内容哈希，原始聊天未改。
- `providers/prompt-caching.ts`固定工具名称和schema对象键顺序，保留数组语义；runtime内工具、Skills、MCP、子Agent列表同样固定排序。仅精确官方OpenAI/Anthropic HTTPS `/v1`源添加稳定会话键/默认短期cache标记，未知兼容网关不加未确认支持的字段；不要求延长保留期。
- `extractUsage`和逐次传输统计保留OpenAI两协议、Anthropic及DeepSeek兼容字段的缓存读/写；Anthropic输入还原为未缓存+读取+写入，OpenAI完整输入不重复加缓存。失败/中断/重试已报告用量各记一次。UI仅用明确有效读取报告的完整输入为分母，显示覆盖范围，未报告/历史未知不计零；写入独立展示，CTX仍含完整输入。
- README、双语手册/日志/隐私说明同步；宿主快照包含曾用偏好/日记片段、计划、诊断并可随后续历史发送，冻结表示仅保存哈希和替换片段。关闭自动记忆停止新增注入，不追溯擦除已发送聊天/摘要或供应商数据；需要不带旧历史时新建聊天，删除原会话清对应本地记录。无新增云收集、生产依赖或数据库迁移。

验证与失败修复的实际证据见`docs/VALIDATION_1.2.9.md`末节。真实供应商账单、TTL、路由、付费模型与全部兼容网关尚未实测，不能把本地SSE夹具的缓存数字当作实际收益。实验版入口仍`.\run-experimental.cmd`，用户自行打包`.\package-win.cmd`；本轮不生成安装包、不执行云SQL、不动用户数据。

最终完整串行Vitest83文件通过/3跳过、605项通过/9环境跳过（113.77秒）；两TS、243文件Biome、生产构建main88/preload3/renderer2215通过。真实Electron Token Saver8组（13普通+2摘要请求）、压缩9组（18普通+12摘要）及审批恢复6组通过；中英文日夜1040×680缓存汇总/明细和CTX截图已查看，UI源码检测无发现。用户入口预检24资源、四个Node打包/图标文件14项通过，未生成安装包。首次压缩专项暴露并修复真实宿主快照边界问题；随后旧503夹具与默认重试等待不匹配，专项显式关闭传输重试以隔离压缩主备，产品默认仍5次；最终完整专项通过，不将失败尝试计为通过。

## 16. 2026-11-07 / 1.2.9 缓存能力配置、压缩前缀复用与诊断

用户授权按成熟Harness的提示缓存方法继续优化。本节是在第15节稳定前缀修复基础上的补充，保留既有修改、版本1.2.9、schema7永久迁移、政策修订号`2026-11-04.3`、图标及权限边界，不生成安装包。

- `shared/prompt-caching.ts`和`ProviderCacheSettings.tsx`增加供应商提示缓存配置，入口为设置 → 供应商与模型 → 供应商详情。`auto/off/openai/anthropic_auto/anthropic_breakpoints`及5分钟/1小时保留通过现有IPC严格校验，存于`providers.promptCaching.<providerId>`；删除供应商清理配置，保存从下次运行生效。自动模式仅识别精确官方HTTPS `/v1`源；未知网关默认不附加专用字段，用户确认兼容后才手动启用。OpenAI使用稳定的不透明会话键；Anthropic静态工具/系统边界与消息边界共用最多4处预算，保留调用方已有标记。一小时保留为可选项并说明缓存写入可能更贵。
- `chat/compaction-request-cache.ts`在主Agent实际请求准备后仅于内存保留可复用的纯文字请求，最多8会话、序列化合计2MiB，不等于整个进程堆上限。不保留API Key、信号或回调，所有附件（包括已提取文字的文档）均走原摘要路径。源消息哈希、模型/配置/工具/权限/扩展等需匹配；同模型安全边界追加摘要指令并保留原system/tools/history，显式`tool_choice:none`且拒绝返回工具调用，不进入执行器。
- 摘要尾部附原始消息索引以维持`recall_context`可用；seq0宿主消息不伪造真实ID。仅明确的HTTP400/422工具选择或思考参数兼容错误会同模型降级一次到原分段摘要；取消、认证、工具调用或完整性错误不因此重试。独立/备用压缩模型、重启、附件、大小或上下文预算不符继续原路径。每次传输开销分别记录，失败不替换有效摘要，删除/回退清内存快照。
- `providers/cache-diagnostics.ts`在每次实际fetch前对最终请求生成分块指纹，按会话和agent/compaction/approval/memory/title用途比较供应商、模型、端点、凭据、工具、系统与历史；区分追加、改写、截短、重启和比较上限。使用进程随机HMAC密钥，仅存有界摘要与安全说明，不持久化密钥或原始请求。超过2048个比较块的尾部也有摘要，不能在截断范围外误报完整前缀相同。缓存配置/生成设置单独说明，不把结构相同当作TTL、路由或实际命中证明。
- CTX与Token Saver复用“缓存前缀诊断”披露原因和缓存读写统计；缺失读取仍为未知、明确0保留为0。README、SECURITY、双语手册/更新日志/隐私说明已同步；服务和免责条款未涉及不改，没有新生产依赖或云接收方。

最终实际验证：

```text
完整串行Vitest：87文件通过、3文件环境跳过；667项通过、9项环境跳过（117.00秒）
TypeScript：Node/Web两套通过；Biome：252文件通过
生产构建：main91 / preload3 / renderer2217模块通过，实验out已更新
新增provider-cache桌面专项：8组、11次普通本地请求通过
Token Saver桌面专项：8组、13次普通+2次摘要请求通过
压缩桌面专项：9组、18次普通+12次摘要请求通过
审批恢复桌面专项：6组、24次普通本地轮次通过
用户入口预检：24资源/生产依赖/1.2.9版本通过；四个Node打包/图标文件14项通过
```

首次全量与构建并行时，既有750轮工具预算测试超过自身20秒时限；未放宽断言或修改该时限，停止构建争用后独立重跑完整套件得到上述667项通过。新增附件测试先修正夹具的必填ID/大小字段，再通过定向及最终全量。最终只读复核未发现阻断问题，确认取消/清理、消息索引、工具禁用、兼容降级与逐次用量边界。

真实Electron脚本顺序执行，使用独立系统临时profile/项目和本地SSE。新`provider-cache-smoke.mjs`使用renderer9397/main9398，覆盖未知网关、OpenAI两协议稳定键、Anthropic两种方式/1小时/4断点、无效IPC、焦点、四种语言主题、真实重启和删除清理；其他脚本沿用各自端口。中文/英文日夜1040×680供应商配置、诊断和CTX截图已查看，无横向越界；源码检测无发现，不冒称完整无障碍验收。没有读取用户DB/Key/剪贴板、调用付费供应商或执行云SQL。

实验入口仍为`.\run-experimental.cmd`，用户自行打包仍为`.\package-win.cmd`。没有生成解包或NSIS；真实供应商命中率、计费、TTL、路由、摘要语义质量、全部网关兼容和正式安装升级未被本地夹具认证。不得把夹具90%或结构稳定性写成真实90%命中承诺。

## 17. 2026-11-07 / 1.2.9 独立低价压缩模型与供应商模型体系

用户要求配置其他低价模型压缩时尽量保留主Agent缓存前缀，并在创建/编辑供应商时选择OpenAI或Claude缓存体系。继续保留全部既有修改、1.2.9、schema7永久迁移、政策修订号`2026-11-04.3`、图标和审批/隔离，不生成安装包。

- `chat/compaction-summary-segments.ts`定义可选摘要分段。独立provider/model压缩优先只总结新原始前缀，旧摘要作参考且原文/顺序/标识不变，追加新段。`checkpoint.summary`仍保存完整合并文字以兼容旧记录；有效`segments`经上限、ID及合并内容验证，损坏元数据回退完整旧摘要而不隐藏内容。重启和fork保留，回退/删除沿用原清理。
- 上限8段，原文摘要预算取主模型窗口12%与8192估算tokens的较小值；追加前预留配置输出和256余量，压缩模型窗口也须足够。段数/预算不足或需重新脱敏时合并新基线；返回后再次检查预算，网关不遵守输出限制不能无限追加。无效、超长、非缩小结果和取消保留最近完整检查点及原始消息；备用模型从原始前缀和完整旧摘要重做。最新进度替代旧进度，原用户约束及宿主执行核验保留。主会话和压缩模型缓存不共享，替换原始尾部及重建基线仍会改变相应前缀。
- `token-saver/stable-input.ts`改为保留源ID/哈希匹配的最长连续前缀，从首次失配后重建，不能跨过变化复用后续条目。修复未获得供应商校准时反复以旧used/currentEstimate缩放，导致多次手动压缩CTX逐次趋小的真实缺陷；仍保留有效供应商EstimateBasis。
- `shared/prompt-caching.ts`增加可选`modelFamily:auto/openai/claude/other`，不为旧配置强加新默认字段。`ProviderCreateInput`可带配置，创建前严格校验，沿用本地provider设置和删除清理；不改schema。`ProviderCacheFields`共用于新建/编辑，模型体系选择会重置为自动/5分钟，仍支持显式模式、1小时和关闭参数。
- 自动模式只有确认的OpenAI体系+OpenAI协议、Claude体系+Anthropic协议才对网关发送对应参数；未选择时仍只识别精确官方源，其他/混合或协议不匹配不自动附加原生参数。体系不转换协议、不切换模型；混合模型建议拆分provider。Claude有效seq0摘要前缀可占用一个显式边界，与工具、系统、自动/尾部标记共用最多4处预算；不把普通用户伪装摘要文本当宿主摘要。

已完成真实Electron桌面专项：provider-cache 10组/16次普通本地请求，compaction 10组/21次普通+13次摘要，Token Saver 8组/13次普通+2次摘要，approval-recovery 6组/24次普通轮次；全部顺序运行，独立临时profile/本地SSE，无用户DB/私人Key/剪贴板/付费服务。包括新建OpenAI/Claude体系、编辑/协议不匹配、输入焦点、中英文日夜、真实重启，以及连续自定义压缩后主模型首段实际wire内容不变。截图生成及DOM横向边界检查通过；本轮图像查看工具未返回像素内容，不把截图存在冒充人工视觉验收。

README、SECURITY、中英文手册/更新日志/隐私说明同步，服务和免责条款无实质变化不改。新增源码、最终全量和打包材料验证以`docs/VALIDATION_1.2.9.md`本轮末节为准。实验out已按新功能构建；真实计费、命中率、摘要语义质量、全部网关及正式安装升级仍未认证，不承诺90%命中。

最终实际验证：完整串行Vitest88文件通过/3文件环境跳过、688项通过/9项环境跳过（133.31秒）；Node/Web TypeScript、254文件Biome及main92/preload3/renderer2217构建通过。用户入口`package-win.cmd --check`24资源和四个Node打包/图标文件14项通过，脚本语法及diff空白检查通过。第一次完整686项通过后补了两条实际Claude序列化测试，再跑完整套件得到上述688项；测试脚本状态选择器超时和一次夹具格式检查已修复并完整重跑，不计失败轮次为通过。没有付费请求、云SQL、解包或正式安装包；启动仍`.\run-experimental.cmd`，用户打包仍`.\package-win.cmd`。

## 18. 2026-11-07 / 1.2.9 TencentDB 本地记忆与工具错误修复

用户要求项目创建时只选原生 Memory 或 TencentDB Agent Memory 的一种，仅内置腾讯项目的记忆算法，不接入其业务适配；随后分析用户提供的日志，修复命令/文件红错并做全量检查。版本继续1.2.9、schema7和永久迁移、POLICY_VERSION `2026-11-04.3`、原子图标及现有权限保护不变，保留全部既有未提交修改。不读取或修改正常用户DB/Key/剪贴板，不执行云SQL、不生成解包或安装包。

- `agents/project-memory-config.ts`统一规范化路径、固定选择和目录冲突检查；SessionService、ChatService、IPC/preload与新建窗口共用。已有项目保留原生选择；新会话、同目录快捷创建、聊天fork、实际子任务和关联worktree继承。缺失父会话明确拒绝；两种目录共存或反向目录与固定后端冲突时拒绝，不删除、迁移或静默回退。workspace变更先检查父及全部后代忙碌状态，并在任何会话/归档/上下文修改前完成配置提交；fork先固定来源项目后端，不复制记忆数据。
- `agents/tencent-memory-service.ts`加载随包的本地L1预设：提取、质量筛选、冲突去重、记录写入和SQLite全文检索。上游固定v2.0.3 / `084bed45cad6bb7f877455082cee82835d65671a`，原始25个模块、完整MIT及SHA-256保留在`third_party/tencentdb-agent-memory/`。运行资源在`resources/tencentdb-memory/`，构建脚本校验原文后生成18个资源/13个JS模块，打包同时校验运行时哈希、ESM闭包和业务提示排除。
- 运行使用通用`promptMode:"chat"`；不分发腾讯工作/团队提示、OpenClaw、云/团队服务、遥测、embedding或产品存储回退。SQLite仅内存重建，权威数据为`.harness-tencent-memory/records.jsonl`，上限2000条/2MiB，无另一个持久数据库、L0原始对话或完整L0–L3流水线。旧实验`work_*`记录读为episodic并在保存时规范化，不丢文本；不要声称旧`"work"`值曾实际开启腾讯业务提示，上游只识别chat/code。
- 自动提取只允许episodic；确认过的persona/instruction偏好完全排除自动去重可变索引，保存时原样保留。宿主严格核验提取类型、去重ID/动作/目标/重复目标/合并字段，错误或取消保留旧快照；总计30秒辅助预算，记入memory用量，不影响已成功主任务。原子写入、revision校验和外部修改保护覆盖手动编辑与自动维护。两tab保留独立草稿，仅在另一tab磁盘未变时采用共享快照的新revision。
- 实际child命令走只读workspace，Docker主挂载加readonly，普通修改使用受管文件工具，记忆目录由broker管理。真实MXC探针已确认：只对不存在目录设置read rule不足以阻止mkdir，因此不能据此恢复可写child shell。最终只读复核又发现General/full_access/host child可经继承插件的Hook绕过；`runPluginHooks`现从统一入口拒绝所有实际child事件，新增回归保留root Hook行为。提示与双语文档说明构建/安装等写磁盘命令由父会话执行。
- SSE完整工具参数快照与增量统一归并；done之后迟到delta不破坏最终JSON，正式final仍可校正。Responses先到的无index参数按item_id暂存，元数据到达后回放，孤儿参数拒绝。缺参返回`TOOL_ARGUMENTS_INVALID`，不执行空参数。list/search支持单文件目标；ToolRegistry与WorkspaceService识别UTF-8 BOM及UTF-16 LE/BE，保留真实二进制/大小限制，宿主修改用原始字节hash检测外部变化并写回UTF-8。
- PowerShell使用系统绝对路径、UTF-8/Text输出及分块解码，保留真实退出码；WorkspaceService的spawn错误清timer，超时等待close后返回。终端exit0的stderr用普通色，非零退出仍显示错误色。CSP只增加合法内联字体所需`font-src 'self' data:`，日志省略base64 data URI。

本轮用户日志是跨11月5日至7日的455条记录（422 error/33 warn），不能当当前失败率。123条tool.result中缺参28条（path15/query8/command5），另有ENOTDIR7、二进制6及真实文件/大小/脚本/Git失败。外部429/502/503/timeout、模型列表401、过期MCP401保留诊断；不对认证/策略拒绝或工具副作用盲重试。日志有旧app.asar栈，修复源码后必须重建并退出旧实例，不能把旧进程当新out验收。

最终源码验证：完整串行Vitest94文件通过/3文件环境跳过、800项通过/9项环境跳过（147.27秒），未增加既有超时；Node/Web TypeScript、262文件Biome及main94/preload3/renderer2217生产构建通过。用户入口`package-win.cmd --check`33资源、五个Node打包/图标文件33项、生产依赖审计、62个脚本语法、28个JSON解析及diff空白检查通过。先前799项全量通过后补了child Hook回归，以上800项是补丁后的完整重跑。随后`node scripts/native-sandbox-test.mjs`启用真实原生沙箱专项，2项通过（其中1项为真实MXC综合流程），44.53秒；覆盖工作区普通写入、只读命令与记忆目录保护、外部路径/子进程/网络拒绝、文档读取、退出码、取消及缺运行时不回退。junction子断言不单独计作本次通过证据。桌面实际结果和失败夹具修正续记`docs/VALIDATION_1.2.9.md`本轮末节。

真实Electron共13个桌面专项最终通过：Tencent10组（主7/child2/memory6/native0）、原生记忆7组、重连10组、工作台15组、审批恢复6组、通用桌面21项、供应商缓存10组、Token Saver8组、压缩10组、计划/附件7组、文档视觉8组、提问/冲突原生通知8组、滚动19项/160段。均顺序执行，独立测试profile/本地SSE；Tencent重启、真实child检索/不可写、双JSON草稿/外部冲突、UTF-16与退出码/颜色均实测，六张设置/创建/终端截图已查看实际像素。旧夹具的system/宿主快照位置、辅助摘要计数和短HTTP503等待已按实际wire修正，保留强断言后完整重跑，未改产品行为来迁就脚本；失败不算通过。详细请求数及边界见验证记录。

README、SECURITY、THIRD_PARTY_NOTICES及双语内嵌手册/更新日志/隐私说明同步；服务/免责正文无实质变化不改。Docker daemon本轮不可用，仅参数/单元校验，不能写成真实Docker通过。硬崩溃可能留下`write.lock`并阻止后续写入，尚无陈旧锁自动清理/崩溃自恢复保证；不要未核实活跃writer便删除锁。9项外部环境、真实付费模型的记忆语义质量、全部网关、正式安装/升级和Windows矩阵均不在已通过范围。实验入口仍`.\run-experimental.cmd`；有out时不会自动重建，之后改源码须先`pnpm build`。

## 19. 2026-11-07 / 1.2.9 发布SQL与本地产物核对

用户自行打包后要求发布SQL。本机`release-artifacts`的1.2.9 EXE/ZIP现已更新至2026-11-07 22:16–22:17，替代上一节交付时的旧包；本轮只读核对，没有再次打包、安装或执行云SQL。`supabase/publish-release.sql`公告补齐本轮记忆、Token Saver、缓存/压缩、通知及工具修复，594字符符合1000字符上限。文件已填实际ZIP的SHA-256 `7d7ab0b0826a46acb0400a23090b88a004bbbda0a3bca13ae0a7133fe8a339f7`与290429003字节，`Get-FileHash`、文件大小和`.zip.json`一致；公开HTTPS ZIP直链仍须用户上传后填写，重新打包须重算元数据。

沿用0001/0003及`mingshen_app_releases`的幂等upsert，不改其他应用表/RPC。发布说明和元数据本地静态核对通过，不等于已执行数据库验证或正式升级验收。部署说明同步：活跃高版本仍优先；同版本1.2.9重新发布不会通知已安装1.2.9的用户，需要手动安装。版本/schema/政策修订号不变，没有付费模型请求或用户数据操作。

## 20. 2026-11-08 / 1.2.9 压缩输出预算与触顶恢复

用户提供的压缩错误显示两协议均在4096总输出时耗尽，推理分别占3935和4096 tokens；正文不足或完全没有正文。源码原有固定4096钳制确实限制压缩能力。本轮按用户最新要求取消该钳制，以当前主会话模型窗口的15%为上限；第17节的12%/8192是历史规则，已由本节取代。保留全部已有修改，应用仍1.2.9、schema7、政策修订号`2026-11-04.3`及图标/权限不变。

- `chat/compaction-summary-segments.ts`的合并摘要估算预算改为`floor(mainContextWindow * 0.15)`，不再固定8192。`context-compaction-service.ts`的每次总输出还受压缩模型配置和可用窗口限制；压缩窗口的30%用于预分配输出，为历史及滚动摘要留下输入空间，发送前按实际wire估算和256余量再次收紧。主窗口200000时最多30000，切模型同步变化；较小模型配置仍可更低。推理与正文共享生成额度，提示明确15%总上限和更小的本次正文目标。
- 仅明确的Anthropic`max_tokens`、Chat Completions`length`、Responses`incomplete_details.reason=max_output_tokens`归类为`ModelOutputLimitError`；Responses嵌套completed/incomplete形态同样核验。子类在脱敏重抛后保留，`retryable=false`，不按网络重试发送原样请求。其他incomplete、过滤、EOF和认证/策略错误不误入本次短摘要恢复。
- 每个候选压缩模型最多4次输出触顶恢复，正文目标和历史片段逐次缩小，明确通知并发送`Write a shorter summary`；同模型前缀触顶转为无工具分段和最低支持思考等级。只有成功片段才推进offset或更新滚动摘要，半截正文不传给后续请求、不保存。备用从原始待压缩前缀及完整旧摘要重做。每次片段请求的5分钟包含内部传输重试；每模型最多128次逻辑摘要请求，不宣称整次分段压缩固定5分钟完成。
- 已有摘要过大或切换到较小压缩模型时，旧摘要完整纳入待压缩输入再分片重建，不要求每次请求塞入完整旧摘要，不直接丢弃。最终检查累计摘要15%预算、实际缩小、主窗口可容纳及取消状态后，才原子替换检查点；原始消息始终保留。
- README、SECURITY、双语USER_GUIDE/CHANGELOG及内置压缩提示同步。没有新增模型、凭据、设置UI或依赖，不读取正常用户DB/Key/剪贴板，不调用付费模型、不执行云SQL。

最终实际验证：

```text
完整串行Vitest：94文件通过、3文件环境跳过；828项通过、9项环境跳过（146.51秒）
Node/Web TypeScript、262文件Biome通过
生产构建：main94 / preload3 / renderer2217模块通过，实验out已更新
真实Electron压缩专项：12组、25次普通+21次摘要请求通过
真实Electron Token Saver：8组、13次普通+2次摘要请求通过
用户入口package-win.cmd --check：33资源/生产依赖/1.2.9版本通过
五个Node打包/图标文件：33项通过；生产依赖审计无已知漏洞
脚本语法与diff空白检查通过
```

新增回归覆盖三协议200K→30K、切100K→15K、更小配置、输出触顶、成功片段后的失败offset、cached转分片、4次恢复上限、取消保留旧检查点、备用原文重做、5000窗口高输出及旧大摘要完整分片。旧rebase/超长夹具按新15%预算调大，保留原有预算/拒绝断言。接续最初测试因错误子类尚未完成而失败，另有旧夹具不再跨新预算；补齐实现与夹具后，上述828项为最终完整重跑，不把失败计通过。

两桌面专项顺序运行，独立临时profile与本地SSE；新增两组真实触顶恢复检查每次wire上限30000、短摘要指令、无半摘要、完成检查点及任务续跑。没有再次运行上一节所有13个桌面专项，也没有生成解包/NSIS或完成安装升级。真实付费网关、摘要语义质量和9项环境跳过仍在边界外；Chat终止帧之后才单独发送的usage尾帧可能未被读取，失败用量不保证完整。

2026-11-07 22:17的现有1.2.9安装包/ZIP及第19节SQL哈希不包含本次修复，未重打包、未改哈希。实验入口仍`.\run-experimental.cmd`；用户重新打包用`.\package-win.cmd`，之后须重新核对ZIP元数据及发布SQL。同版本重发不提示自动更新，安装用户需手动安装新包。

## 21. 2026-11-08 / 1.3.0 内置 DOCX、PPTX、PDF 制作

用户要求把 Harness 升级为 1.3.0，补齐实际文档制作能力并同步内嵌文档。本轮保留 schema7、永久迁移、协议修订号 `2026-11-04.3`、原子图标、Memory/TencentDB 二选一和已有压缩/工具安全边界；未读取正常用户 DB/Key/剪贴板，未执行云 SQL，未生成正式安装包。

- `main/documents/document-authoring-schema.ts` 定义有界结构化输入：目标扩展名选择 `.docx`、`.pptx` 或 `.pdf`；支持标题、段落、列表、表格、分页、幻灯片、讲者备注和工作区 PNG/JPEG。文字 500,000 字符、参数 1 MiB、图片 20 MiB、输出 25 MiB、幻灯片 100 张等限制均在宿主校验；PPTX 定位框按 13.333 × 7.5 英寸检查容量。
- `main/documents/document-author.ts` 使用随包 `docx@9.15.3`、`pptxgenjs@4.0.1` 生成可编辑 Office Open XML；PDF 先生成转义的离线 HTML，再由独立 Chromium 打印为可选中文字 PDF。图片只由工作区二进制读取网关提供，禁止 URL/网络素材。
- `main/documents/document-pdf.ts` 使用独立 session、sandbox、contextIsolation、无 Node、权限/下载/导航/外部请求拦截和 60 秒取消清理。真实 smoke 暴露 `javascript:false` 与受控字体/图片 readiness 脚本冲突，现为 `javascript:true`；HTML 仍使用 `default-src 'none'`，只允许 `data:` 图片和内联样式，不执行用户脚本或外部资源。
- `ToolRegistry`、ChatService、preload 和内嵌 tools 提示注册 `create_document`。它继承旧 `write_file` 工具资格；显式 `create_document` permission 优先，图片另按 `read_file` 策略审批。Plan、patch-only、只读子 Agent、Memory 目录保护、writer lease、外部 hash 冲突、默认不覆盖和取消/半成品清理继续有效。
- 打包预检和 ASAR smoke 递归核对 `docx`/`pptxgenjs` 运行闭包，实际从包内 ASAR/解包目录读取，不依赖宿主 `require.resolve`。`pnpm-workspace.yaml` 将 `image-size` 覆盖到 `2.0.3`，修复 `pptxgenjs` 间接高危 DoS 依赖；`pnpm audit --prod` 已无已知漏洞。

### Agent 子模型配置补充（2026-11-08）

用户要求为所有可被调用为子 Agent 的 profile 配置独立子 Agent 模型，并保持应用版本 1.3.0。本轮只改 Agent profile、路由、设置页、提示词、翻译和文档，不新增 schema、凭据、云服务或腾讯业务适配。

- `apps/desktop/src/shared/agent-profile-model.ts` 是共享规则入口：只有 `subagent` 与 `all` 角色允许子 Agent 模型覆盖；空值继承发起该任务的主会话模型。
- 设置 → Agent 配置只为这两类 profile 显示“子 Agent 模型”，选项为“使用主会话模型”或已启用模型。切换到 `primary`/`plan` 时清空草稿中的覆盖值；历史 `modelId` 字段仍保留，但这两类角色运行时不会把它当作子 Agent 覆盖。
- `@Agent` 手动调用与 `spawn_subagent` 自动委派共用同一解析规则。指定模型时同步切换到该模型所属 provider；指定模型不存在、被禁用或父会话模型失效时明确返回配置错误，不静默回退。
- 子 Agent 提示词和中英文手册/更新日志已说明继承与独立模型行为。子 Agent 仍继承父会话的权限、工作目录、Skill、MCP 和系统边界，不因此获得额外权限或递归委派能力。

本轮定向测试覆盖共享解析、profile 保存、自动子任务模型/provider 路由和无效模型错误；完整 TypeScript、Biome、生产构建与全量测试结果以 `docs/VALIDATION_1.3.0.md` 的末节为准。未生成正式安装包、未执行云 SQL、未读取正常用户数据库或凭据。

最终验证：

```text
完整串行 Vitest：98 个文件通过、3 个环境跳过；905 项通过、9 项环境跳过（750 轮工具测试使用120秒单测试上限）
Node/Web TypeScript：通过
Biome：269 文件通过
生产构建：main97 / preload3 / renderer2217 模块通过
package:check：33 项资源、生产依赖和 1.3.0 版本通过
打包/资源 Node 测试：16 项通过；脚本语法、diff 空白检查通过
pnpm audit --prod：无已知漏洞
真实 Electron 文档 smoke：7 个场景、16 次 Agent 请求通过
真实 ASAR 文档 smoke：离线 OCR/PDF/legacy DOC 与包内 DOCX/PPTX 作者闭包通过
```

真实 smoke 使用独立系统临时 profile、临时工作区和本地 SSE，不读用户数据库/Key，不调用付费模型。证据与边界见 [1.3.0 验证记录](docs/VALIDATION_1.3.0.md)。本轮没有生成 NSIS/ZIP 正式包、安装/升级/卸载验收或执行云 SQL；用户打包入口仍为 `.\package-win.cmd`，生成包后必须重新计算 ZIP 元数据并更新发布 SQL。

## 22. 2026-11-09 / 1.3.0 原生状态、工具闭环与质量默认值

用户在官方能力调研后明确要求实施五项优化、全量检查并同步内嵌文档。应用继续1.3.0、schema7、永久迁移、协议修订号`2026-11-04.3`和现有图标/权限边界；保留此前全部未提交实现，不接入腾讯业务适配。

- `providers/responses-state.ts`校验有界、已完成的原生项，`model-stream.ts`捕获供应商实际提供的加密reasoning/compaction、工具身份与assistant phase。重放校验provider/model/endpoint和可见内容；缺失、切模型/端点或内容不一致走普通历史，不伪造原生状态。请求token估算不按reasoning/compaction的`encrypted_content`字符串长度计数，改用每项1024、合计最多8192且不超过模型窗口5%的有界预留，保留实际usage校准，不作精确token保证。不透明项不是可读取的原始隐藏思维链；不宣称已接通服务端`/responses/compact`或无限上下文。
- `view_image`读取工作区PNG/JPEG/WebP/GIF（单图20MiB），经已有审批及原生MXC/Docker网关返回原生图像内容；模型须配置image能力。图片工具结果会随本地历史保存，附件生成的临时PDF页面图仍按原缓存生命周期处理。
- `browser_screenshot`截取内嵌浏览器可见页面，按比例限制最长边2048像素、PNG最多8MiB；保存本地PNG的同时返回`tool_result.images`，实际像素随下一次视觉模型请求发送。当前模型未配置image能力时剔除图片并明确提示未发送；此限制独立于工作区`view_image`的20MiB。截图文件与带图历史均按现有本地记录保存，不把路径存在当成模型已看到像素的证据。
- `tools/persistent-command-service.ts`提供run/session/security-scope绑定的`exec_command`/`write_stdin`管道会话，支持增量输出、stdin、EOF、停止及受管进程收尾；不是PTY。清理未确认保留commandEffects、writer屏障和lease，不得先释放；当前已结束句柄的cleanup失败不会自动重试，短暂失败后的恢复可能需要重启，清屏障不能代替确认进程/容器停止及核实副作用。宿主故意detached/`Start-Process`后原父提前退出，不保证跟踪全部脱离后代；不能宣称任意daemon都有OS级清理保证。
- `read_file`使用`start_line`、`end_line`/`limit`、`char_offset`、`max_chars`和下一页JSON游标，offset为首行UTF-16偏移；范围缓存仍核对完整源hash。启用模型parallelToolCalls时，最多3个相邻独立内置读取并发，执行链、命令、写入、浏览器、MCP和custom排除，各自保留审批/隔离/预算。
- 可写managed child可用`request_verification`排队1–6条检查；`wait_subagents`只收集请求，当前模型轮全部tool_result保存完后，parent再按自己的profile、计划、审批、隔离与writer lease顺序执行并保存独立验证结果，避免Chat/Anthropic调用与结果配对错误。parent仍有运行中命令则保持pending，先轮询或停止再执行。只读child不得申请；child shell继续只读，排队不能算通过。
- Token Saver缺失/新配置默认`historySummaries:false`、`outputMode:auto`，已有明确配置保留，85%压力保护不变。`input-compressor.ts`保护原生状态/图像结果整消息，不精简或去重其可见文字，拒绝恢复含相关旧替换的ledger；提前摘要阈值不把opaque/base64字节当普通正文。`stable-input.ts`及`compaction-request-cache.ts`指纹包含scope/endpointKey和内容hash，替换ledger不存图像/opaque原文。
- `scripts/harness-eval.mjs`与`fixtures/harness-eval/`固定六类任务，默认仅验证离线合成评分/报告复现，不调用模型。显式live模式连接独立测试profile的现有回环API；工具证据须completed，缺失观测不是通过。当前API缺wire与Token Saver配置观测，不能作完整Token Saver A/B认证，main-session usage不等于总账单；provider配置也不能证明供应商内部后端。

本节补充的实际定向检查：Token Saver/stable-input/compaction cache共3文件53项通过，Node评估器9项通过（含本地HTTP假应用，非真实Electron/付费模型），7个相关TS文件Biome通过。其余本轮全量、构建、真实桌面和隔离结果以`docs/VALIDATION_1.3.0.md`本轮末节最终记录为准，不用此前922项结果替代本轮证据。

README、SECURITY、双语USER_GUIDE/CHANGELOG/PRIVACY和验证文档已说明实现及边界。服务/免责正文未涉及不改；没有新增云接收方或改协议修订号。真实付费模型语义质量、全部网关、PTY、任意脱离进程、正式安装升级仍非上述定向测试的证明。

本轮最终完整串行Vitest：105文件通过、4文件环境跳过；1009项通过、10项环境跳过（176.98秒）。Node/Web TypeScript、280文件Biome、生产构建main100/preload3/renderer2218、用户入口`package-win.cmd --check`33资源/依赖/1.3.0、生产依赖审计、七个Node文件45项、67个JS及6个PowerShell脚本语法、30个JSON的Node解析均通过。750轮压力测试保留全部轮次与执行次数断言，将旧20秒单测试时限明确改为120秒，不作为性能改善证据；旧生命周期/模态/UUID及桌面等待夹具修正后才计最终通过。

真实Electron顺序完成九个专项：新增能力4组17请求、压缩12组、Token Saver8组、Agent选择9组、审批恢复6组18轮、工作台15组/实际worker峰值2、文档作者7组、模型重试10组及通用桌面21项。能力专项实测原生状态/phase续接、3000/4000行分页、持续stdin、截图像素进入下次请求及child排队后parent实际检查。两张浏览器及两页PDF渲染图已查看；DOCX仅语义预览，不混称Word版式渲染。另开启真实MXC专项2文件4项通过（68.12秒，其中2项为真实流程），覆盖文件/记忆/外部路径/网络保护及持续命令输入/取消；与1009部分重复不相加。

完整结果、证据路径及失败修正见[本轮验证记录](docs/VALIDATION_1.3.0.md)末节。六任务两合成变体12通过明确标注非模型质量评测，六组比较均不可作真实A/B；未执行付费质量对照、真实Docker持续命令或正式安装升级。实验out已重建，仍从`.\run-experimental.cmd`运行；没有正式安装包、云SQL或Git发布操作。

## 23. 2026-11-09 / 1.3.0 模型配置体验、供应商编辑与离线记忆

用户要求新模型首次预填、K/M 数值输入、已保存供应商连接编辑，以及 TencentDB 记忆算法完全内置本地、不依赖辅助模型或后端。本轮保持1.3.0、schema7、全部永久迁移、政策修订号`2026-11-04.3`、图标和现有数据，不提交、推送、执行云SQL或生成正式安装包。

- `shared/model-settings-input.ts`为新模型草稿提供一次性预设：字面前缀`gpt-6`（包括`gpt-6.1`）使用1000000上下文、128000输出、text/image/file及`none,low,medium,high,xhigh,max`；`deepseek-`使用1000000/384000及`low,high,max`。这是用户指定的可编辑表单预设，不是官方规格检测。手动输入和模型发现共用规则，保存模型不自动覆盖；同一草稿首次应用后改ID也不再次预填。
- GPT新模型表单的长上下文计费勾选默认关闭；用户主动勾选/取消分别改上下文为200000/1000000，只改上下文，不改用户输入的输出上限。此草稿字段不检测或修改供应商实际计费，也不从已保存数值推断开关。
- 上下文/输出接受十进制`K/k`和`M/m`，例如100k=100000、1.5M=1500000、1.001K=1001；使用数字字符串展开避免浮点舍入，只保存安全正整数。无效输入显示双语错误、保留草稿并聚焦首个错误字段；输出不得大于上下文。
- `provider:update`贯通shared/preload/main/ProviderService/Repository；设置“连接”可改名称、Base URL和协议，保留身份、Key、鉴权、模型、历史和会话引用。活动任务存在时拒绝地址/协议修改，名称可单独修改。不兼容缓存模式/时长回自动/5m；实际端点/协议变化时，在同一savepoint内清该provider所有会话的context observation/view/snapshot/basis，保留checkpoint、历史与累计用量，失败共同回滚。
- `agents/tencent-memory-local.ts`以有界、脱敏、带来源归属的任务结果摘录提供候选，用精确内容/空白去重作本地冲突决策；保留固定v2.0.3上游质量筛选、FTS候选召回、冲突流水线、writer和检索核心，不声称等价于其LLM语义抽取/合并。自动只新增episodic，不覆盖不同事实，不推断或改写已确认偏好；空白、确认短句、代码和媒体噪声不制造记录。
- Tencent维护不取Key、不请求模型、不联网、不启动业务/云服务，移除旧30秒模型超时；Native Memory仍沿用原模型摘要及30秒限制。聊天本身仍可能把偏好和检索摘录送给所选模型。活动区区分“已保存”“无新增”“未保存”，展示真实新增/现有条数；本地失败不使已完成主任务失败。
- JSONL仍是权威快照，FTS只在内存重建，2000条/2MiB限制、二选一后端、手动编辑revision、串行队列和writer lock保留；最终替换前再次检查快照hash、开关和取消信号，停止或外部编辑保留原始内容。未新增持久数据库或依赖，不修改固定上游源码/源哈希；host NOTICE改动由构建重新生成资源及runtime清单。

README、SECURITY、THIRD_PARTY_NOTICES、双语内嵌手册/更新日志/隐私说明、tools提示和host NOTICE已同步。本轮定向6文件142项、两套TypeScript、284文件Biome通过；最终完整串行Vitest为107文件通过/4文件环境跳过、1110项通过/10项环境跳过，179.83秒，未另加全局超时。生产构建main101/preload3/renderer2219及25个上游模块源哈希校验/资源生成、用户入口`package-win.cmd --check`33资源、七个Node文件45项、生产依赖审计通过。

真实Electron顺序完成五个专项：模型/供应商8组4请求、Tencent10组（主7/child2/辅助记忆0/原生摘要0）、原生Memory7组（普通7/摘要3）、供应商缓存10组16请求、通用桌面21项。模型/连接四种语言主题截图及Tencent中夜/英日截图已查看实际像素，1040×680无横向控件溢出；Impeccable detector三UI目标无发现。目录链接测试改`unlink`清测试junction、Tencent重启夹具等待preload后挂接dialog后完整重跑；失败轮次未计通过。

收尾68个JavaScript、6个PowerShell脚本语法、30个JSON解析、diff空白检查、26个本地链接及版本/政策/NOTICE一致性通过。具体命令、当前证据、截图命名与边界见[本轮验证记录](docs/VALIDATION_1.3.0.md)末节。没有真实付费模型语义/网关参数认证、完整Windows矩阵、真实Docker或正式安装升级；未生成安装包、执行云SQL或Git发布。实验out已更新，仍从`.\run-experimental.cmd`运行。

## 24. 2026-11-09 / 1.3.0 光轨第二界面风格

用户认可光轨方向，要求移除大型“本地记忆引擎”展示卡、正式接入第二风格，细化金属质感与流光动效；简约保留，切换需重载或重启，全部功能不变。本轮仍为1.3.0、schema7、永久迁移及政策修订号`2026-11-04.3`，保留既有图标、数据与业务执行边界，不生成安装包或执行发布操作。

- `shared/ui-preferences.ts`在现有`ui.preferences`中保存`interfaceStyle: "simple" | "orbit"`；缺失/非法字段默认简约。旧客户端保存时遗漏字段则由主进程保留现有风格，不改数据库schema。
- `UiPreferencesProvider`首次成功加载后锁定当前`activeStyle`，选择仅改变待应用值，重载前不会换肤。保存使用串行队列及最新快照，失败保留待保存值并显示可重试错误；`save()`可供重载操作等待保存完成。
- 设置 → 外观与语言 → 界面风格中的`InterfaceStylePicker`使用原生radio、小型布局缩略图及使用中/待重载状态。点击“重载并应用”先等待保存，前后核查未发送草稿/附件、文件编辑和历史消息编辑；存在未保存内容则拒绝。`ChatView`和隐藏的`WorkspacePanel`通过准确的`data-unsaved`标记参与保护。
- `ui:reload-interface`贯通shared/preload/main；`desktop/interface-reload.ts`仅重载主renderer。主进程同步核查全部活跃/准备发送/压缩/等待审批或回答的任务，退出清理与更新安装交接时也拒绝，不自动停止任务。
- `renderer/src/orbit.css`通过根`data-interface-style="orbit"`限定正式光轨覆盖；简约沿用原样式。连续工作台、三种布局、splitter及窄窗抽屉继续使用相同组件和计算。夜间深墨青、日间冰白矿青，细金属边缘、选中会话光轨、输入框流光、工作区与设置细节共同构成新风格；不显示大型记忆展示卡，真实记忆入口保留。
- 连续装饰动效使用CSS transform/opacity，无Canvas或JS逐帧循环；真实运行状态驱动信号，审批/提问/完成不伪装运行。应用关闭动效或系统减少动态效果时禁用，窗口隐藏时暂停。流式消息仅轻微位移、首帧保持不透明，避免淡入造成正文短暂偏暗。
- README、双语内嵌手册/更新日志及DESIGN同步；原预览HTML也移除整块`memory-stage`。没有新增云服务、模型请求、业务权限或依赖。

最终生产构建main102/preload3/renderer2221及25个上游模块哈希校验通过，实验out已更新。Node/Web TypeScript、287文件Biome、用户入口`package-win.cmd --check`33资源/依赖/1.3.0、七个Node文件45项和生产依赖审计通过；69个JavaScript、6个PowerShell脚本语法、30个JSON解析及diff空白检查通过。

真实Electron光轨专项最终17组、36张截图、两次启动、两次本地SSE请求通过，renderer异常0。覆盖旧配置/待应用/撤销/实际重载/重启、旧保存保留字段、简约往返与会话/供应商/模型/权限/原文不变、草稿/文件/历史编辑保护、运行中拒绝重载而任务继续、真实hide/show暂停、三布局组件身份、双语日夜、800–1920宽度及像素缩放、关闭与减少动效。另顺序完成设置焦点10组、滚动19项/160段、通用桌面21项。截图已查看，最新流式首帧清晰；源码与像素独立复核未发现本轮阻塞，未进行保存失败注入、队列压力或完整无障碍认证。

完整串行Vitest最终108文件通过/4环境跳过、1118项通过/10环境跳过，148.72秒，退出0，使用Codex bundled Node24.22.1直接运行Vitest。相同测试在本机`D:\NodeJs`的24.19.0 worker中有一项junction创建挂起及清理EBUSY；换上述运行时后Tencent18项及全量通过，没有改产品/测试/时限，不能据此认定具体Node上游缺陷。准确命令与边界见[本轮验证记录](docs/VALIDATION_1.3.0.md)末节，不用第23节1110项结果替代。本轮所有桌面检查使用独立临时profile/项目与本地模型，只读通用桌面更新RPC；没有读取正常用户DB/Key、生成NSIS/ZIP、执行云SQL或Git提交/推送。实验入口仍`.\run-experimental.cmd`。

## 25. 2026-11-09 / 1.3.0 运行信息展开与完整详情

用户要求单行省略的报错、重连信息、命令和其他运行记录均可展开/收起，阅读全部已保存信息。本轮延续现有简约/光轨及中英文日夜外观，保留全部已有修改、版本1.3.0、schema7、永久迁移、政策修订号、图标和执行权限，不生成安装包或执行发布。

- `ExpandableText.tsx`使用原生`details/summary`、Lucide箭头、可见键盘焦点及懒挂载正文；默认紧凑摘要，展开保留换行、长行换行、内部滚动与完整内容复制。可访问名称包含真实摘要，展开/收起提示双语。
- ChatView活动、历史工具、重连/失败、上下文和输入区错误、右侧审查/终端、任务树及子输出、MCP与运行集成设置接入详情。命令/参数/输出分区，展开聊天记录立即暂停跟随；后续事件不强制收起，运行状态变化保留同一展开节点。
- `lib/activity-details.ts`按单次调用索引来源消息，结合会话、工具名、开始时间、结果时间和用户轮次匹配活动。复用callId时不串接旧结果，匹配不唯一保留活动原文；ChatView只隐藏已由当前活动完整承载的同一个调用，后续运行仍能打开历史记录。宿主调用先保存源消息再记录开始时间，避免存储延迟导致详情缺失。
- JSON参数只在格式化不改变数字、键、顺序和字符串表示时排版，否则保留原文。重连、审批、压缩和MCP诊断不再为一行展示提前缩短，既有脱敏继续；项目检查活动保留全部可用诊断，给模型的反馈仍最多80条。
- 多个展开的输入区错误共用有界滚动区，在任务带和小窗口内仍能到达正文末尾与输入框。MCP测试Flex项明确可收缩，修复长摘要把列宽撑至数万像素的问题。子输出仍是有界近期预览，提供完整子会话入口。
- README、DESIGN、双语内嵌手册/更新日志同步。展开只展示实际保留的来源，不能恢复上游或原执行容量限制已经省略的数据；没有放宽输出、响应、预览和安全限制。

真实Electron顺序完成运行信息专项11组/6次本地请求/35张截图、面板专项10组/2次本地MCP请求/12张截图、子任务工作台6组/8次本地请求和聊天滚动19项/160段。实测本地PowerShell长命令及失败输出、HTTP503重连恢复/403最终失败、历史记录、完整复制、阅读位置、双风格双语日夜与窄窗；子任务原文超过12k时可从截断预览进入完整会话。面板上下文/回复草稿及子预览加载错误为独立测试进程注入，不能当作相应后端故障链路的真实执行证据。

首次面板检查发现MCP宽度问题，修复后完整重跑；测试导航断言改为核对真实子会话消息ID，避免把侧栏父组折叠误判为未导航。截图夹具改为只滚指定容器，并在截屏前置前测试窗口、等待可见和有限入场动画完成，避免外层滚动或隐藏窗口暂停透明首帧导致失真。最终MCP、输入区、子输出和主聊天代表截图已查看实际像素，独立数据/界面复核无阻塞。

最终完整串行Vitest为109文件通过/4文件环境跳过、1145项通过/10项环境跳过，153.90秒，使用Codex bundled Node24.22.1；Node/Web TypeScript、290文件Biome、生产构建main102/preload3/renderer2223、25个上游模块哈希和用户入口`package-win.cmd --check`33资源均通过。最终8个UI目标Impeccable detector返回`[]`，三个专项脚本语法、diff空白及版本/政策/schema核对通过。详情见[本轮验证记录](docs/VALIDATION_1.3.0.md)末节。实验out已重建，仍从`.\run-experimental.cmd`运行；没有读取正常用户DB/Key/剪贴板、调用付费模型、执行云SQL、生成NSIS/ZIP或Git提交/推送。完整Windows/DPI、辅助技术及第三方网关矩阵不属于本轮验收。

## 26. 2026-11-09 / 1.3.0 光轨独立工作台重构

用户反馈此前光轨接入仍是原界面换肤，要求按`docs/previews/harness-styles/index.html`中的实际预览重构第二界面。当前光轨结构以本节及源码为准；第24、25节保留各自历史实现和验证结果，不将旧验收视为本轮通过。默认简约、1.3.0、schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标和业务执行边界均保持。

- `App.tsx`和`orbit-workbench.css`建立独立网格：56px工具轨、工作空间会话侧栏、项目/会话面包屑、中央聊天与输入区、右上审查/文件/终端、右下任务/Agent及底部状态栏。上下右区同时显示，窄窗作为同一抽屉组开闭；工具轨和面包屑按钮连接真实导航，不使用静态演示数据。
- `WorkspacePanel`光轨审查先列真实变更文件，再显示所选文件的已保存diff，保留打开文件、复制差异、Git、浏览器、命令停靠和未保存编辑。`TaskWorkbench`固定在右下，计划、Agent和计划库继续使用真实数据；计划页附实际子任务摘要，可进入任务树并展开其输出。
- `ChatView`将连续的工具/思考消息组织为执行记录时间轴，记录组和单条详情分别开合，沿用第25节的完整参数/输出关联、复制和阅读位置保护。`lib/orbit-transcript.ts`在分类时跳过不显示的Responses状态及空元数据，正文、错误和附件仍构成真实边界，同一用户轮次只保留一次Agent标头。消息标头显示真实身份、主/子Agent角色和消息时间；权限、隔离及仅补丁详情位于光轨输入框底栏，简约保留原位置。
- `projectLayoutKey`保留简约原键，光轨使用`@orbit:`前缀；同一项目在两风格下独立保存布局、宽度和开闭状态。光轨新项目侧栏/右区默认228/360px，简约260/460px和既有保存值不变。布局切换复用聊天及工作区组件，保留输入草稿和文件编辑。
- Agent导航请求绑定目标会话并在切换会话时清理旧请求，避免历史请求强制覆盖新会话的本地标签；工作区工具轨选中态由面板实际标签同步。文件与浏览器请求继续能打开右上工作区，关闭右侧面板同时隐藏上下两区。
- 风格仍在设置中自动保存，重载或重启生效；未发送草稿/附件、文件及消息编辑、活跃/准备发送/压缩/等待审批或回答、退出与更新交接保护不变。补上计划编辑的`data-unsaved`标记，未保存计划也阻止重载，取消后清除标记。日夜即时切换，装饰动效继续遵循减少动态效果和隐藏窗口暂停，不新增模型请求、云服务、数据库迁移或权限。
- 设置中光轨缩略图同步独立工具轨、会话栏、右侧上下两区与状态条，简约缩略图保留。README、双语内嵌手册与更新日志同步独立结构和两风格差异，DESIGN与设计sidecar合并实际设计规范，项目记忆沿用现有入口，不恢复大型记忆展示卡。

本轮最终完整串行Vitest为110文件通过/4文件环境跳过、1155项通过/10项环境跳过，174.35秒，退出0，使用Codex bundled Node24.22.1；没有提高测试时限。Node/Web TypeScript、292文件Biome、最终生产构建main102/preload3/renderer2225及25个上游模块源哈希、用户入口`package-win.cmd --check`33项资源通过。五个相关smoke脚本语法及diff空白核对通过。不要用第24、25节的测试数字代替本节。

真实Electron顺序完成独立工作台9组（13次本地请求含2次worker请求、21张截图）、风格与重载18组（37张截图、两次启动/两次本地请求）、运行信息11组（6次本地请求、35张截图）、信息面板10组（2次本地MCP请求、12张截图）、子任务6组（8次本地请求）、聊天滚动19项/160段、设置焦点10组及通用桌面21项。最终工作台、风格及信息展开专项renderer异常均为0。全部使用独立profile/临时项目和本地模型；通用桌面的公开更新RPC仅只读。没有访问正常用户DB/Key/剪贴板、付费模型、云SQL、NSIS/ZIP或Git提交/推送。

实际日夜、中英、800–2559窗口、展开命令和真实diff/任务图已复核。独立视觉复核先要求修正缩略图和溢出，修正后重采同一15张图，两项均判resolved、disposition为ship（只覆盖这两项）；独立代码复核发现计划草稿保护遗漏，修复后新18组风格回归通过。旧4px用户操作栏外边距及箭头旋转溢出使用局部CSS修正，保留原完整内容与越界断言。详见[本轮验证记录](docs/VALIDATION_1.3.0.md)末节。实验out已更新，仍从`.\run-experimental.cmd`运行；完整Windows/DPI、辅助技术和付费网关矩阵不属于本轮验收。

## 27. 2026-11-09 / 1.3.0 光轨材质打磨与模型供应商标签

用户已认可第26节独立结构，要求继续增强科技感与高级感，并在主界面模型后显示括号及供应商。本轮沿用已认可的光轨工作台，保留简约、版本1.3.0、schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标及既有业务流程。

- `orbit-workbench.css`细化标题栏与工具轨的金属明暗和边缘反射，使用由现有令牌派生的光边/暗边；中央光轨标识去掉盒形底座，配细线和冰蓝静态边缘。工具轨、选中会话与工作区标签加强层次，输入框增加局部深度、右侧信号边及上下文分隔，不添加新展示卡或装饰数据。
- 执行记录仅在包含真实运行行时使用运行材质，完成、审批和提问继续由实际状态区分；底部菱形只在运行中填充。`orbit.css`的标题栏/输入框光线行程分别收至100%/150%，保留CSS transform/opacity、隐藏暂停、关闭和减少动态效果保护。
- `ModelPicker`新增默认关闭的`inlineProvider`，仅主聊天入口启用：中文为`模型名（供应商名）`，英文为`Model (Provider)`；没有有效模型只显示选择提示。完整供应商、模型名及ID保留在title，辅助技术名称保留完整模型/供应商文本；其余选择器继续沿用原布局。
- 主模型控件按内容占宽，最大`min(360px, 100%)`，模型/供应商自然收缩并分别省略，2px间隔，供应商使用较轻的辅助文字。两枚14px图标不收缩；去除会让普通供应商提前省略的55%上限，不以隐藏整段供应商规避窄窗问题。
- README、双语内嵌手册/更新日志及DESIGN/sidecar同步。设计文档保留Simple原始令牌、前五例及narrative，8节/10例和YAML/JSON校验通过；未修改图标字节或引入依赖。

最终真实Electron光轨专项12组、30张截图、13次本地请求（含2次worker）、renderer异常0。覆盖原有独立结构与完整命令、真实diff/计划/worker、导航及草稿，以及同名模型跨供应商、双风格×双语×日夜×1440/800的普通名完整显示、长名截断、完整title和实际CDP AX名称、空选择无多余括号。800/1040/1920/2559布局继续通过。本轮前段还执行18组风格/重载专项（37张图、两次启动/两次本地请求、异常0）；它先于最后供应商宽度修正，后者由上述最终12组覆盖。

Node/Web TypeScript、最终292文件Biome、生产构建main102/preload3/renderer2225、25个上游模块源哈希和`package-win.cmd --check`33项通过。最后smoke脚本语法、diff空白、版本/政策/schema、两枚受保护原子PNG与Git原始字节核对通过。本轮5个UI目标仅执行一次Impeccable detector，返回`[]`，时间在最后删除供应商百分比上限之前；没有为收尾重复detector，也没有重跑完整Vitest，不将第26节1155项作为本轮结果。

独立视觉复核打开用户参考和16张指定截图，最初`disposition: fix`指出普通供应商被55%上限提前截断；修正代码和文档、完整重跑并覆盖原路径后，再打开同一16张图，该项`resolved`，没有此次修正引入的回归，最终`disposition: ship`，仅覆盖该项评分。详情与准确边界见[本轮验证记录](docs/VALIDATION_1.3.0.md)末节。

全部GUI串行使用独立profile/临时项目和本地SSE，无私人DB/Key/剪贴板或付费模型访问，无云SQL、NSIS/ZIP或Git提交/推送。菜单选择使用实际DOM点击，缺选中模型仅核对简约中英；CDP AX不等于屏幕阅读器/完整Windows-DPI认证。实验out已重建，正常退出旧进程后从`.\run-experimental.cmd`启动；已有out时启动脚本不会自动构建。

## 28. 2026-11-10 / 1.3.0 实验启动图标损坏恢复

用户报告 `prepare-experimental-runtime.cjs` 调用 resedit 时出现 `DataView` 越界。实际 `apps/desktop/build/icon.ico` 为0字节，原子PNG与原版Electron完整。旧入口只检查ICO是否存在，空文件绕过生成后交给解析器；旧生成器又在写入前直接截断目标。本轮未确定这次具体清空原因，旧脚本在隔离目录可生成正常图标，不能归因于Node24.19.0。

- 新增 `windows-icon.cjs`，检查ICO头、目录、帧范围，以及PNG尺寸/chunk边界/CRC/IDAT/IEND或未压缩40字节DIB的基本结构；准备脚本与源/afterPack资源检查共用，避免resedit把未知载荷当作图像接收。
- 准备脚本遇到缺失或无效ICO时，从同目录同名PNG重建并重新校验；自定义 `options.icon` 仅使用其相邻PNG，不回写仓库默认图标。生成失败报告具体路径及原因，保留原实验EXE与标记；有效图标及完整缓存不重写。
- `generate-icon.ps1`保留既定绘制方式与8个尺寸，增加可选源/输出参数、源输出同路径保护，全部内容在内存完成后写同目录唯一临时文件，以Replace/Move替换并清理自身临时文件。Windows PowerShell5.1替换时使用显式 `NullString.Value`，避免 `$null` 转为空路径。独占锁或PNG解码失败时保留旧ICO。
- `run-experimental.cmd`移除重复的“仅缺失时生成”分支，统一由准备脚本恢复；README及本验证记录同步。版本1.3.0、schema7、政策修订号和受保护原子PNG/原版Electron不变。

已通过真实准备入口将实际ICO恢复为37498字节、8帧，SHA-256为 `6b9fae1ae52dc5d28543e02ae66d46af1d2c4afce35190dd9596d0dab9eda8b6`；再次准备返回 `changed:false`，ICO/实验EXE时间戳不变。使用用户同一 `D:\NodeJs\node.exe` v24.19.0，三份图标专项17项、五份既有打包测试35项均通过，无跳过；用户入口 `package-win.cmd --check`33资源通过。

真实Electron顺序完成两次启动与Windows大小图标/应用ID检查；随后以独立系统临时profile完整运行实际 `run-experimental.cmd`，确认preload就绪、窗口正常打开并通过应用退出入口正常退出。详情与命令见[验证记录](docs/VALIDATION_1.3.0.md)末节。此次仅脚本/派生ICO/文档修复，无前端源码变更，未重建out或重跑完整Vitest，未生成解包/NSIS/ZIP，不访问正常用户DB/Key或付费模型，不执行云SQL或Git发布。

## 29. 2026-11-10 / 1.3.0 Windows ASAR 文档依赖校验修复

用户报告正式打包退出1，完整日志定位到afterPack的 `Missing packaged document dependency: docx`。失败缓存内实际已有docx/pptxgenjs及其依赖；本机ASAR读取接口需要Windows分隔符，旧检查器将索引里的POSIX路径直接传给extractFile，读取异常被物理解包回退吞掉后误报缺包。不是本次图标、生产构建或DLL复制失败。

- `check-package.cjs`保留POSIX文件索引，调用ASAR读取时用`path.normalize`转换为本机路径，继续检查包内版本、入口和依赖闭包，不使用宿主依赖冒充包内依赖。
- 真实缺包负例另发现查包路径可能返回前导`/`，向上到`/`时永久循环；候选改用POSIX join并正确识别根node_modules，父路径不再缩短时退出。
- `package-document-runtime.test.cjs`用真实ASAR替代Map夹具，隔离source与`.unpacked`，等待归档写流完成。6项覆盖源闭包、纯ASAR、混合解包、缺包和缺入口，避免物理fixture掩盖ASAR读取失败。

用户同一`D:\NodeJs\node.exe` v24.19.0下，8份打包/图标/资源Node测试55项全部通过、无跳过，26.119秒。两份旧失败缓存完整afterPack重检通过，均核实17个文档依赖；用户原入口完整`package-win.cmd --dir`已通过，包含main102/preload3/renderer2225构建、33资源预检及真实afterPack。最终路径和补充结果见[验证记录](docs/VALIDATION_1.3.0.md)末节。

保持1.3.0、schema7、政策修订号、已确认图标与已有修改。README和验证记录同步；没有生成NSIS/ZIP、安装/升级/卸载、运行桌面smoke或完整Vitest，也没有用户DB/Key、云SQL或Git发布操作。用户生成正式安装包仍运行根目录`.\package-win.cmd`；解包校验通过不等于NSIS或安装流程验收。

## 30. 2026-11-10 / 1.3.0 工作区记忆模型配置与上游语义分析

用户指出旧 TencentDB 自动记忆直接保存助手回答，随后要求在“项目指令与信任”手动选择工作区，配置记忆分析模型和备用；未配置主分析模型使用当前主 Agent。本节取代第18、23节中固定后端、确定性离线摘录及仅自动写入episodic的历史描述。保留1.3.0、schema7、政策修订号`2026-11-04.3`、图标和既有未提交工作，不新增生产依赖或远端记忆服务。

- `shared/project-memory.ts`、IPC/preload/main和`agents/project-memory-config.ts`支持按工作区读取、显式保存后端及主备模型，沿用现有本地setting；模型引用使用`ModelConfig.id`。默认原生，未创建会话也可配置；子任务及关联worktree解析到顶层记忆归属工作区。项目、后代或排队记忆维护忙碌时拒绝修改。
- `ProjectMemorySettings`支持工作区列表与系统选目录、原生/TencentDB切换、记忆分析模型和可选备用、清除和保存，保留加载/错误/过期请求与未保存草稿保护。显式切换只激活所选方案，保留两套目录，不自动删除、改名、迁移或合并。旧目录冲突仍须在设置明确保存选择。
- 删除`agents/tencent-memory-local.ts`规则适配器，新增`tencent-memory-model.ts`严格校验JSON、类型、优先级、来源消息、候选目标和合并字段。使用固定TencentCloud/TencentDB-Agent-Memory v2.0.3 / `084bed45cad6bb7f877455082cee82835d65671a`的通用chat提取与冲突提示、L1质量筛选、候选召回、写入和FTS；上游原始源码及哈希不变，不启用腾讯工作/团队提示。
- 模型决定是否有值得保存的事实及`persona/episodic/instruction`、`store/skip/update/merge`；不会直接把完整回答或`Assistant result excerpt`存为自动记忆。有效空结果或重复表示无新增，不切备用、不用原文兜底。已确认且非自动分析来源的persona/instruction不进入可变冲突记录；分析来源元数据保留，自动记录可更新或合并。
- ChatService使用工作区主分析模型，空配置使用本轮实际主会话模型；可仅配备用，重复主备不额外尝试。失败或无效结构使备用从同一原始输入重做整次提取和冲突操作，主分析的中间结果不先落盘。每个模型尝试180秒、输出最多8192 tokens、无工具，复用供应商鉴权与传输重试，计入`memory`用量。失败尝试显式记录`memory.analysis`及会话/运行/供应商/模型、主备和attempt；双失败不令已完成主任务失败。
- 自动分析只接收已完成当前轮用户/助手文本，最多20条、合计32000字符、每条8000字符，去除已知凭据和think块，不直接附带工具、附件、隐藏推理或更早轮次。候选记忆用于冲突判断；独立及备用供应商会收到相应数据并产生用量。本地存储不表示模型分析离线。
- 临时FTS与暂存记录在内存维护；关闭上游吞错后的store-all及产品存储回退对权威快照的影响。取消、配置变化、文件版本冲突或任何无效结果不提交半截内容。权威仍为`.harness-tencent-memory/records.jsonl`，上限2000条/2MiB。升级或后端切换不批量清理、改写旧摘录；后续语义维护仍可更新或合并未受保护的旧记录，也可在设置人工修正或删除。
- README、SECURITY、第三方/宿主NOTICE、中英手册、更新日志和隐私说明同步。原生Memory的显式偏好规则与30秒摘要保留；实际子任务只读、Plan和目录保护不变，不引入L0对话副本、完整L0–L3、embedding、云端/团队服务或腾讯账号要求。

本轮完整串行Vitest为110文件通过/4文件环境跳过、1203项通过/10项环境跳过，176.91秒，退出0，使用Codex bundled Node24.22.1。此全量先于最后失败尝试日志及保存栏修正；日志补丁后对应runtime29项重跑通过，14.91秒。相关后端81项及配置28项均已通过；TypeScript Node/Web、最终Biome292文件、生产构建main102/preload3/renderer2225、25个上游源模块哈希与用户入口`package-win.cmd --check`33资源通过，TencentDB资源Node测试19项通过。各项不重复相加。

真实Electron顺序完成新工作区记忆设置8组（两次启动，5次chat/7次extract/3次dedup，renderer异常0）及既有Tencent回归10组（两次启动，7次主chat/2次子chat/6次memory，其中4次extract、2次dedup，原生摘要0，renderer异常0）。最终设置专项包含保存栏修正：独立普通流`project-memory-actions`，不再继承全局审批sticky；20状态断言保存区在字段及说明之后，4张1040×680顶部图实测五个关键控件完整可见且命中无遮挡，保留800/1440双风格双语日夜矩阵。全局审批规则未改。

独立视觉复核最初判保存栏遮挡备用控件为P2；修正后同路径重采，通用fresh代理重新逐张打开4张顶部和4张800代表图，判resolved、最终ship，仅覆盖该修正，不冒充专门reviewer类型。主流程和UI代理另已查看最终矩阵实际像素。Impeccable context及5目标detector各仅一次；detector无主要发现，既有全局styles旧段的提示保留，未为收尾重复运行或修复无关风格。独立代码复核发现备用成功漏日志和文档对旧摘录保留的绝对表述，均已修正并按范围复核。

全部GUI使用独立临时profile、工作区和本地结构化SSE夹具，无正常用户DB/Key/记忆或付费模型访问，不执行云SQL、不生成解包/NSIS/ZIP、不提交或推送。夹具证明路由、结构化写入及故障保护，不能证明真实模型的语义质量、全部网关、Windows/DPI或完整辅助技术矩阵。实验out已重建；正常退出旧实例后从`.\run-experimental.cmd`启动，已有out时入口不自动构建。详细命令、失败夹具修正和边界见[验证记录](docs/VALIDATION_1.3.0.md)最新节。

## 31. 2026-11-10 / 1.3.0 TencentDB 官方提示词逐字对齐

用户要求确认记忆分析提示词完全按照官方 GitHub 仓库。复核发现第30节实现仍在官方system末尾追加容量及不可变记忆ID两段宿主规则；本轮已删除，`tencent-memory-service.ts`直接以`input.runModel(request)`传递上游请求。容量、来源/目标校验、已确认偏好保护、取消及原子写入继续在宿主代码执行，不再修改提示文本。

- 固定官方GitHub tag为`v2.0.3`，对应提交`084bed45cad6bb7f877455082cee82835d65671a`。从官方HTTP获取25个manifest源码文件并逐一核对，官方字节、本地源码及`upstream.json`的SHA-256全部一致。该提交的MemoryCore npm包自身版本为`1.0.2-beta.1`，不得与GitHub tag混称。
- 活跃`chat`流程的提取、冲突两阶段system及user模板直接复用原始`l1-extraction.ts`、`l1-dedup.ts`常量和formatter，不追加宿主、主Agent、profile或项目指令。主分析、备用及未配置时的本轮主模型均使用同一规则。
- Service回归直接动态导入保留的官方原始模块，对两个system及两个user模板作完整字符串相等断言；runtime主失败备用用例追加`instructions`相等断言。真实Electron的本地HTTP服务也对每次分析请求严格比较官方完整system，覆盖默认、独立主分析及备用。
- README、第三方及宿主NOTICE、双语内嵌手册同步。精确承诺为“固定官方chat提示词与模板逐字一致”；当前轮消息范围、未保留跨轮背景/情境状态、FTS与快照存储、严格结果校验及备用仍为宿主适配，不能据此宣称完整TencentDB算法或产品100%移植。

本轮最终定向Vitest为2文件68项通过（service39/runtime29），18.89秒、退出0；Node/Web TypeScript、292文件Biome、生产构建main102/preload3/renderer2225及25上游模块源哈希通过。用户`package-win.cmd --check`33资源/生产依赖/1.3.0和TencentDB资源Node测试19项通过。增强后的真实Electron设置专项8组、2次启动、5次chat/7次extract/3次dedup、renderer异常0；10次分析HTTP请求均通过官方system完整相等检查。独立只读代码复核无阻塞问题。

仅本轮68项为最终重跑，不将第30节1203项全量或其他桌面专项算作本轮证据；未重跑完整Vitest或设计detector。smoke原始TS导入触发Node的`MODULE_TYPELESS_PACKAGE_JSON`警告，退出0且断言全部通过，没有为消除测试警告修改项目模块类型。未改上游源码/manifest、版本、schema、协议或图标，未访问正常用户DB/Key/记忆或付费模型，未生成安装包/执行云SQL/Git发布。实验out及内嵌手册已更新，正常退出旧进程后仍从`.\run-experimental.cmd`运行；真实模型语义质量与完整上游功能不在本轮证明范围。

## 32. 2026-11-10 / 1.3.0 实际安装包发布SQL

第31节之后，用户要求核对打包资源并自行生成安装包。对应资源预检33项、8份打包/图标Node测试55项已全部通过；用户随后确认打包完成。本轮读取`apps/desktop/release-artifacts/MingshenHarness-1.3.0-x64.zip.json`，实际ZIP修改时间为2026-11-10 12:00:33（本地）；`Get-FileHash`、实际293630075字节、JSON及SHA256旁文件一致。当前哈希见本文发布SQL维护条目；重新打包需重新核对。

`supabase/publish-release.sql`已填实际1.3.0 ZIP哈希/大小，公告改为当前文档制作、光轨独立工作台、运行详情、子Agent模型、工作区主备记忆分析、工具及模型配置与打包修复，共784字符，符合1000字符约束；保留`public.mingshen_app_releases`及同版本幂等upsert。公开HTTPS ZIP直链尚未提供，使用明确非HTTPS占位符`REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL`，执行前必须替换，不能把旧分享网页或示例域名当作新包直链。`docs/SUPABASE_DEPLOY.md`同步实际元数据状态，schema、RPC、权限及其他应用表未改。

本轮只读核对用户已生成的包并生成本地发布材料，没有重新打包、安装、上传或执行云端SQL，没有把实际包存在当作安装/升级验收。静态检查核对版本、格式、哈希、大小、公告长度及upsert，diff空白通过；具体记录见`docs/VALIDATION_1.3.0.md`末节。

## 33. 2026-11-10 / 1.3.1 文件栏、光轨会话按钮与自动诊断

用户要求升级1.3.1，修复文件栏无法滚动、光轨子Agent展开/菜单按钮与标题重叠，以及“未配置适用的项目诊断”提示。本轮保留全部已有未提交工作，沿用schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标和TencentDB固定上游资源；交付重建的实验版，没有生成1.3.1安装包。

- 文件浏览器无编辑器时也使用受限grid行，文件树`min-height:0`、独立overflow和滚动传播边界；有名称、可聚焦的section支持Home/End。编辑器打开后文件树最小42px；文件页命令停靠用30%空间、打开编辑器后20%，允许命令区收缩。
- 简约workspace面板交回inspector布局定位，清除旧窄窗fixed/top导致680px窗口底部落到738px的问题。光轨高度不超过760px且打开编辑器时，使用既有160px紧凑任务区，避免1040×680编辑器正文被挤没。DESIGN同步实际布局约束，保留既定风格。
- 光轨会话行只覆盖左侧和纵向padding，保留普通36px/父65px右侧控制留白；菜单更准确选择器固定28px，完整标题保留title。鼠标、键盘及父/普通菜单分别验证，不移除原有功能。
- 自动诊断实际选择并即将启动引擎后才发running。内部无引擎标记只有同时未启动、服务器为空、ok且无问题时才静默跳过；同名显式LSP、真实成功/错误、启动失败和无输出失败仍有真实终态。发现期间取消不启动或制造活动。审批、隔离、writer lease及手动报告契约保留。

最终诊断3文件34项通过（14.24秒），相邻compaction/workbench2文件86项通过（6.50秒），8份打包/图标/资源Node测试55项通过、0跳过（25.12秒）。Node/Web TypeScript、最终292文件Biome、生产构建main102/preload3/renderer2225及25上游源哈希、用户入口`package-win.cmd --check`33资源/生产依赖/1.3.1通过。没有重跑完整Vitest，不将1.3.0全量数字计为本轮结果。

新增`v131-pane-regression-smoke.mjs`最终真实Electron8组、7次本地请求（含1worker）、25张截图、36条几何测量、renderer异常0，退出0。覆盖简约/光轨各中夜1440×900、英日1040×680、中日800×680；长列表真实滚轮及Home/End、完整首末行/末项点击、编辑器内容和可见正文、命令停靠、真实子任务父行和普通菜单、无诊断器无虚假成功、真实自定义stdio LSP错误保持failed。基线已复现旧文件树2927px被裁剪及标题重叠。最终代表像素已由主流程查看；独立审查完成源码终审并逐张打开7张指定最终截图，未发现本轮修复阻断，未另行复跑测试。

初始GUI发现的窄窗越界及正文塌缩是产品问题，修复后保留强断言完整重跑；键盘焦点和最后固定标题等待是夹具问题，已分别使用CDP焦点模拟及真实失败节点修正。原package typecheck夹具在Windows触发`spawn EINVAL`且正确显示失败；当前直接spawn `npm.cmd`的兼容问题仍未修复，不算执行通过。最终自定义LSP验证不能替代此命令链路。

README、双语手册/更新日志、版本入口及[1.3.1验证记录](docs/VALIDATION_1.3.1.md)同步。旧1.3.0真实ZIP及发布SQL保留原版本/哈希/大小，1.3.1打包后再生成对应材料。全部GUI使用独立临时profile/项目和本地模型，不访问正常用户DB/Key/记忆/剪贴板或付费服务，无解包/NSIS/ZIP、云SQL、安装或Git发布。最终out已更新，正常退出旧实例后运行`.\run-experimental.cmd`；完整Windows/DPI、辅助技术及正式安装升级仍不在本轮认证范围。

## 34. 2026-11-10 / 1.3.1 光轨对话偏移、详情开合与长历史性能

用户继续报告光轨对话概率偏移、开合详情后移出窗口和1.3.0偶发无响应/崩溃。本轮在真实Electron复现布局及重复渲染问题：约1096px聊天外框内的隐式grid列被折叠长诊断撑至约94723px，历史与composer按该宽度居中；展开改变自动最小尺寸，收起再现偏移。页面整体宽度仍为1440px，不能只查document溢出。

- `workbench.css`为聊天及任务视口声明`minmax(0,1fr)`列，chat和composer可收缩、输入区最大100%；保留完整详情、内部滚动、既定两种风格和代码块局部横向滚动，不强制重置scrollLeft。
- `MessageRow`/`ActivityTrail`默认memo、稳定空集合及App的改写/文件/工作区回调，组件订阅`useLocale`保持即时翻译。新增`ToolCallDetails`，折叠不挂载正文且不做完整格式化，展开后一次计算参数并保留命令/输出/复制。`ExpandableText`活动正文按需生成；新结果仍刷新、展开节点及阅读位置保留，没有截短或删改历史。

最终Node/Web TypeScript、293文件Biome、main102/preload3/renderer2226生产构建、25个固定TencentDB源哈希及用户入口`package-win.cmd --check`33资源通过。定向Vitest3文件31项通过（1.55秒），未重跑完整Vitest。双语手册/日志、README、DESIGN及[验证记录](docs/VALIDATION_1.3.1.md)同步；实验out已重建，版本1.3.1、schema7永久迁移、政策修订号及原子图标不变。

新增`orbit-stability-smoke.mjs`最终11组、1次本地请求/80段SSE、48条测量记录（35布局快照/10可达性/3工具记录）、13张图通过，越界0、renderer异常/崩溃事件0。180条工具历史、每阶段8次输入下，最终保留基线→修复后空闲响应P95为105.7→11.0ms、流式200.7→9.4ms；累计JS执行643.1→16.7ms和2997.7→302.5ms，长任务8/33→0/0，折叠工具正文180→0。105条基线越界来自21个关闭样本各5个容器，不是105种Bug。

响应按input事件至双RAF计时，小样本P95恰为最大值，不是硬件到像素端到端延迟或固定收益承诺。流式布局/样式耗时并非全部下降，结束瞬时JS堆76.8→133.1MB，未做结束GC/长期稳态/峰值测量，不宣称内存普遍降低、无泄漏或全部崩溃已修复。合成图像字段仅作为大字段历史负载，不验证最终字段逐字相等、解码或真实视觉模型质量；脚本结束核对调用数及指定输出、错误，参数在展开时验证。新工具状态夹具改用合法新调用及首次结果，未改产品关联；最终800截图收回抽屉后再测，性能段不变，详见验证记录。

其后完整信息11组/6请求/35图、聊天滚动19项/160段，以及第33节文件栏/诊断8组/7请求含1worker、25图/36测量均重新通过，GUI串行。独立源码复核无阻断；独立视觉复核实际打开参考及8张指定图，补采后重新打开800px两图，确认聊天与输入区未推出窗口、收起后控件可读。没有为收尾重复设计detector，也不将历史全量数字计入此次结果。

全部使用独立临时profile/项目和本地模型，复制断言只拦截隔离renderer，不触碰正常用户DB/Key/记忆/剪贴板，无付费请求、解包/NSIS/ZIP、安装、云SQL或Git发布。原始`spawn("npm.cmd")`Windows兼容问题仍保留，完整Windows/DPI/GPU、第三方网关及长期崩溃原因未认证。正常退出旧实例后运行`.\run-experimental.cmd`；现有1.3.0包和SQL元数据不改标签为1.3.1。

## 35. 2026-11-10 / 1.3.1 输入框 Markdown/LaTeX 粘贴显示

用户要求保持1.3.1，粘贴Markdown、LaTeX及数学公式后在输入框直接显示格式，并能在设置开关。本轮沿用原有Marked、KaTeX、DOMPurify及两种风格，没有新增依赖；版本、schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标及固定TencentDB源资源不变。

- `ChatView`保留挂载的原生textarea、草稿与undo栈，文字粘贴沿用默认插入，完成后在同一输入区显示有界格式预览。原文/眼睛图标切换，Esc、直接输入、Shift+Enter及Ctrl+Z/Y/V返回原生编辑路径；Ctrl+A仅选草稿，预览第一次Ctrl+X只转原文，右键转原文后使用原有编辑菜单。图片仍作为附件，程序设置/会话切换/发送清空复位预览，空及不支持的粘贴标记不会残留；重开设置不会抢焦点。
- `composer-markdown.ts`复用共享公式扩展，渲染前限制30000字符、1024个解析节点及128个公式。超限或解析失败保留完整来源并提示，不截短发送内容；代码不解读公式、无分隔符TeX不猜测。原始HTML转义、链接只显示文字、图片只显示替代文字，DOM插入前再净化，不触发远程媒体或跳转。共享行内公式修复转义美元误闭合并增加回归。
- `ui.preferences.composerRichPaste`默认开启，显式false持久保留，旧客户端缺省保存沿用当前值。设置 → 外观与语言 →“粘贴时显示 Markdown 和公式格式”即时生效并自动保存；预览高度为240px和30dvh中较小值、内部滚动，底栏使用现有主题和32px图标。格式预览与原文编辑是两种状态，并非可编辑公式结构的富文本编辑器；发送保留Markdown/LaTeX及内部空白，沿用原有首尾trim。
- README、双语手册/更新日志、DESIGN和[验证记录](docs/VALIDATION_1.3.1.md)同步。最终定向Vitest4文件25项通过（1.05秒），Node/Web TypeScript、295文件Biome、生产构建main102/preload3/renderer2227、25上游源哈希，以及用户入口`package-win.cmd --check`33资源/生产依赖/版本通过。未重跑完整Vitest，不使用历史全量或性能数字替代本轮证据。

新增`composer-rich-paste-smoke.mjs`最终真实Electron11组、1次本地模型请求、8张截图、6组布局矩阵全部通过，renderer异常/崩溃、服务端错误及禁用网络请求均为0。覆盖自动格式化、原文/预览、键盘与撤销/重做、选区替换、Ctrl+A/X与右键菜单、模拟中文组合输入、继续粘贴、设置即时/重载持久化及焦点、发送原文、惰性HTML/媒体和无效公式、超长回退、图片附件，以及简约/光轨各中夜1440、英日1040、中日800。原文发送断言曾把Responses文字content误作数组，已按真实协议修正且完整重跑；未改产品协议。独立源码复核提出的交互问题已修复并覆盖，最终复核无阻断。主流程实际查看4张代表图，另一名独立审查者逐张打开全部8张最终图，未见控件遮挡、公式不清或横向偏移；静态截图不能代替动态交互证据。

GUI使用临时profile/项目与本地SSE，合成ClipboardEvent/DataTransfer接浏览器原生insertText，键入、undo和组合经CDP，不触碰正常用户DB/Key/记忆或系统剪贴板。此证据不等于物理Ctrl+V、真实输入法、发送前IPC失败、完整DPI/GPU或辅助技术认证。未为收尾重复设计context/detector，无付费调用、解包/NSIS/ZIP、安装、云SQL或Git发布。实验out及内嵌文档已重建，退出旧实例后运行`.\run-experimental.cmd`；旧1.3.0包及发布SQL保持真实元数据。

## 36. 2026-11-10 至 11 / 1.3.1 待发送草稿持久保存

用户要求新对话和已有历史对话的所有待发送内容在切换、返回及重启后仍保留，只有手动删除或发送才清除。本轮保持1.3.1、schema7、全部永久迁移、政策修订号`2026-11-04.3`、既定图标及现有业务权限，保留此前未提交实现。

- `shared/composer-draft.ts`、`storage/repository.ts`及typed IPC/preload维护每会话草稿。`app_settings`中的`composer.draft.<sessionId>`保存原文、原文/预览状态、附件引用及通知合并回执，`composer.draft-attachment.<sessionId>.<id>`单独保存附件完整字节。保存校验引用和25MiB单附件边界，元数据与新增/移除附件在同一savepoint提交；不依赖原附件路径持续存在，不引入schema迁移。
- `renderer/src/lib/composer-drafts.ts`和`use-composer-draft.ts`将状态及待保存队列置于ChatView生命周期之外，切换工作区/会话或卸载组件不清草稿。修订使用UUID；迟到读取、保存或发送回执不得覆盖新输入。手动清空会持久保存清空结果，已发送消息的原有首尾trim行为不改变，草稿中的内部空白完整保留。
- `ChatService`在实际接受消息时，将消息插入与对应revision的草稿消费放在同一事务；接收前IPC或准备失败保留待发送内容。发送回执只清除匹配版本，不能删掉用户切换回来后新写的草稿；另一会话草稿不受影响。
- `desktop/composer-draft-flush.ts`及退出、界面重载、更新交接路径在销毁renderer/数据库前等待保存。保存失败取消退出/重载/交接，恢复可用窗口并显示可重试错误；普通关窗到托盘仍按现有行为。第24、26节曾将composer草稿作为重载阻塞，现由持久化flush处理。界面重载请求去重，实际`beforeunload`再次检查晚到的文件/历史消息/计划编辑；晚到的composer输入保存后经主进程重检任务、退出及更新状态。正常退出和正式更新退出取消旧重载意图，更新预检保存不会提前解除保护。
- 失败的Windows通知快捷回复先持久排队，合入目标会话草稿后按receipt去重；切换、reload、重启或删除已合并草稿不会再次追加。`SessionRetentionService`保护含草稿的会话及其父会话，显式删除会话仍清其草稿和附件；不是将未提交的结构化提问选择或文件编辑都变为会话草稿。

重载保护补丁前，草稿定向4文件67项通过。2026-11-11最后构建后串行重跑真实Electron专项：`composer-drafts-smoke.mjs`10组通过、4次启动/4次正常退出、3次本地模型请求、4张截图/4条测量，renderer异常、崩溃、服务端错误及禁用网络请求均为空，证据为`.impeccable/review/composer-drafts/result.json`。实际覆盖新旧会话各自原文、格式状态和附件、删除原附件后重启恢复、接受发送及迟到回执、新草稿竞争、接收前IPC拒绝、退出保存失败后重试、最后一次编辑随正常退出保存及通知合并不复活。两种风格、中文夜间/英文日间和1440/800宽度覆盖可读性；不是掉电、强杀、磁盘损坏或多实例并发写入的零丢失保证。

最后主流程重跑重载保护定向4文件39项通过（2.22秒），与先前草稿定向结果有重叠，不相加，精确命令见验证记录；独立只读终审无阻断。实际`interface-style-smoke.mjs`最终20组通过、2次启动、2次本地请求、40张截图、renderer异常0，证据为`.impeccable/review/interface-style-result.json`。风格重载恢复精确原文、公式预览和完整附件且未发送；保存失败保留窗口中新输入和原磁盘快照，重试成功。等待保存时新增的文件编辑在实际`beforeunload`拦下重载，窗口、原文件和未保存编辑均保留，清理后可正常切换；既有文件、历史消息、计划及运行中保护同时通过。此前一次已通过新增保护场景，后在主题/语言矩阵遇到`Page.reload`读到旧页面；夹具等待新页面代际后完整重跑，未改产品。

同一最终构建的完整格式粘贴回归11组通过、1次本地请求、8张截图、6组几何矩阵，异常/崩溃/服务端错误/禁用网络均为空，证据为`.impeccable/review/composer-rich-paste/result.json`。持久草稿加入后的首次失败是恢复的预览态隐藏textarea后旧夹具直接输入；脚本改为矩阵前主动清草稿并等待输入就绪，再完整运行，未修改产品来迁就夹具。README、中英文手册/日志及DESIGN已同步；真实GUI始终使用自有临时profile/项目及本地SSE，无正常用户DB/Key/记忆/系统剪贴板或付费模型访问。

## 37. 2026-11-10 至 11 / 1.3.1 原生公式与文档工具补齐

用户要求继续完成草稿，并联网查阅正常文档开发所需工具，解决Agent处理Markdown/LaTeX时缺少原生可编辑公式。本轮扩展既有`create_document`，没有要求用户安装Office、Pandoc或外部转换器。官方一手资料、格式能力矩阵、JSON例子及容量边界集中在[文档工具说明](docs/DOCUMENT_TOOLS.md)；应用仍1.3.1、schema7永久迁移和协议修订号不变。

- `main/documents/document-rich-content.ts`复用固定`docx@9.15.3`的`latexToMath`生成原生OMML，Markdown经受限Marked解析及`htmlToContent`转换为Word内容。新增`equation`、`rich_paragraph`、Markdown、代码、引用、目录、脚注、页眉页脚、页码、边距、原生图表及内嵌XLSX数据。已有正文、表格、本地PNG/JPEG及读取工具保留；回读可提供有限OMML线性摘要，不能以摘要验证分页或公式二维位置。
- DOCX支持上述能力及`patchDocument`模板填充；PDF支持公式、Markdown、富段落、代码/引用及页面配置，使用离线KaTeX/Chromium排版，不提供Office原生可编辑公式或本轮图表/目录/脚注块；PPTX新增可编辑原生图表，保留已有幻灯片/备注，明确拒绝新公式/Markdown/富段落块，不宣称三格式完全等价。
- 未知或不支持的LaTeX明确报错，不回退成图片/原文，也不提交半成品。普通代码保留字面公式符号，原始HTML转义，Markdown图片地址不读取，图片使用独立批准的工作区路径。不是完整TeX引擎，不加载任意宏包；格式扩展仍受Plan、profile、patch-only、审批、隔离、writer lease、取消及外部hash冲突保护。
- `document-template.ts`新增生产依赖`@xmldom/xmldom@0.8.15`作结构化XML检查。占位符须唯一、独占普通段落，可跨run；修订、书签、批注、字段、绘图、内容控件、分节等保护结构拒绝替换。宏和签名模板除文件名外，按XML命名空间检查content type及relationship声明，覆盖改名部件。媒体替换只支持明确尺寸/边距的单节单栏正文，使用实际可用宽高；文字/公式不受同一媒体布局限制。模板`font`用于新增的直接文字块，Markdown/列表沿用模板样式，代码及公式使用各自字体。默认另存，不承诺任意复杂Office模板无损往返。
- DOCX/PPTX图表保留嵌入数据工作簿，支持条形、柱形、折线、饼图；负值柱/条形数轴包含零，饼图保留类别图例。自定义页边距约束媒体。DOCX目录、页码是原生域，准确页码需在Word更新域。

最后模板声明保护补丁后，文档定向5文件100项通过（9.46秒）。首次完整Vitest为112文件通过/3失败/4环境跳过、1315项通过/6失败/10跳过（307.91秒），另有1条未处理清理拒绝；三个进程清理/取消相关文件在权限适当环境重跑3文件35项通过（15.18秒），无未处理错误。不能将首次命令说成全通过，重跑与全量重叠不相加。打包/图标8个Node文件共58个不同用例首次55通过/3因BuildCache的`mkdtemp EPERM`失败，原生复制文件随后4项通过，覆盖完58个不同用例；同样不是首次全绿。完整命令与证据路径见[验证记录](docs/VALIDATION_1.3.1.md)末节。

2026-11-11最后重载修复后，Node/Web TypeScript、Biome306文件（628ms）、`pnpm.cmd build`均通过，构建为main106/preload3/renderer2229模块及25个固定TencentDB源码哈希；用户入口`package-win.cmd --check`最终退出0，33项资源、生产依赖及1.3.1版本通过。实验out已更新；正常退出旧实例后可用`.\run-experimental.cmd`启动，不能将旧1.3.0安装包当成包含本轮源码。

真实文档Electron专项在最终构建后重跑，`.impeccable/review/v131-document-authoring-1794359279344/result.json`12项通过、33次Agent请求/0次辅助请求、5张截图；DOCX含8个OMML、15个关系及1套图表/工作簿，填充模板15个关系及1套图表/工作簿，PPTX20个关系及1套图表/工作簿，两份PDF各2页。此前一次调试端口9401在权限受限环境中未就绪，未产出结果；权限适当后重跑通过。

前一次成功文档运行的`.impeccable/review/v131-document-authoring-1794317520545/word-render/result.json`单独记录真实Word COM：原稿8公式/3页/1脚注，模板1公式/1页/2脚注；实际把首公式编辑为`z^2+1`、保存、重新打开后原生公式保留，Markdown空白由Word实际读回核对。Word仅用于开发QA，脚本为`scripts/document-office-render-smoke.ps1`，不是产品运行依赖。视觉检查发现连续PDF独立公式拥挤，已补充间距及分页保护并重渲染；Word斜体边界疑似少空格经XML、回归和Word原生读取确认保留。独立审查实际查看8张PNG（6张文档含修复后PDF和Word、2张composer），无阻断；PDF嵌套列表留白偏大为非阻断观察。主流程还实际查看最终构建的光轨重载后预览/附件、晚到编辑保留及最新公式PDF第1页共3张代表图，内容可读、主要控件和公式间距正常。

2026-11-11当前构建的`node scripts/document-asar-smoke.cjs`最新重跑退出0，核对包内原生OMML/Markdown/图表/工作簿、KaTeX MathML、DOCX/PPTX制作和隔离依赖闭包，并通过离线中英OCR、PDF页面及旧DOC检查，禁用宿主回退/外网。首次受限执行因Electron `install_dir_access.cc`报sandbox token ACL无法读取运行时而退出2147483651；未修改ACL或node_modules，同一命令经适当执行权限重跑通过。未生成正式包或安装器，此证据不等于完整安装器验收。

新增直接依赖后，pnpm报告已安装importer元数据与清单不同步；一次离线install因无TTY拒绝移除modules而中止，lockfile-only成功，实际生产依赖闭包解析与上述测试通过。最后检查使用进程级`pnpm_config_verify_deps_before_run=warn`，没有删除node_modules、手改安装元数据或永久关闭校验。后续开发应在允许的终端中正常同步依赖，不要隐去此环境边界。

README、双语手册/日志、tools提示、第三方清单及本交接已同步。通用工具提示另校正TencentDB主备记忆分析模型的说明，未修改固定官方提示词。全部桌面/Office验证只操作自建临时profile和合成文档，不读取正常用户DB/Key/记忆/剪贴板，不调用付费模型。没有生成新的NSIS/ZIP、安装/升级/卸载、执行云SQL、Git提交或推送；旧1.3.0发布材料仍保留真实元数据，完整Windows/DPI/Office/付费模型及长期崩溃矩阵未认证。

## 38. 2026-11-11 / 1.3.1 按文件夹批量管理会话

用户要求保持1.3.1，在设置中按工作文件夹批量勾选会话并归档或删除。入口为设置 → 会话与数据 → 按文件夹管理会话；保留既有单会话菜单、归档恢复及自动清理规则。schema7、永久迁移、政策修订号`2026-11-04.3`、原子图标及已有修改不变。

- `renderer/src/components/SessionManagementSettings.tsx`提供工作文件夹、未归档/已归档/全部范围、主会话标题搜索、逐项复选、跨页全选、批量归档/恢复/删除及逐项结果。每页50项、列表独立滚动；翻页保留选择，切换文件夹/范围/搜索清空选择。包含仅有归档记录的文件夹及无工作区会话。
- `renderer/src/lib/session-management.ts`独立读取完整分页元数据，不能依赖侧栏bootstrap/delta当前加载的会话子集。每个父ID的两种归档范围和各分页须形成同一目录revision及完整计数的稳定快照；仅revision漂移时废弃该父ID的全部页重新读取，最多3次完整尝试，以容纳切换当前会话更新lastOpened的正常变化。total、身份或重复cursor错误立即拒绝；稳定revision下仍严格核对覆盖计数，持续漂移也提示刷新，不可放松确认范围。操作以主会话为选择单位，核对其全部后代；不同worktree目录的子任务仍随父会话处理，确认框显示实际主子数量。
- 批量更新/删除沿原IPC传递`SessionBatchTarget[]`，仅含ID、父ID、工作区及归档状态。`main/sessions/session-batch-guard.ts`在修改前同步精确核对整树，删除时复用`ChatService.removeSession`已有停止和快照await后的守卫；新增、移动或身份变化抛错，允许本次递归已删除的成员缺失，不能把移到树外但仍存在的成员当已删除。固定错误在主进程本地化后再由Electron包装。
- 复用现有更新/删除API语义：归档拒绝忙碌树、保留草稿并暂停关联定时任务，恢复不自动重新启用定时任务；永久删除先停止并等待任务，清理消息、草稿、附件及应用快照，保留项目文件。不得用新增界面绕过现有快照失败、停止失败或写入保护。
- 按项执行保留成功结果，失败原因逐项可见且继续保持勾选供重试；执行期间设置导航和关闭入口禁用，防止结果在处理中被卸载。README、双语手册/更新日志和DESIGN同步。

本轮定向Vitest分开运行7文件、100个不同用例通过：renderer helper22项、主进程guard20项（含5项真实SQLite/ChatService集成）、相邻会话/保留期/草稿/导航5文件58项。独立复核重复的5项集成不另加，没有重跑完整仓库Vitest。最后Node/Web TypeScript、Biome311文件（456ms）、生产构建main107/preload3/renderer2231模块及25个固定TencentDB源哈希通过；`package-win.cmd --check`退出0，33项资源、生产依赖及1.3.1核对通过。pnpm importer元数据警告仍在，检查只使用进程级`pnpm_config_verify_deps_before_run=warn`，不删除node_modules或永久关闭校验。

最终真实Electron专项`scripts/session-management-smoke.mjs`11/11组通过，2次启动及2次正常退出，1次真实本地SSE请求、12张截图及12条几何记录；renderer异常、崩溃、服务端错误及外网请求均0。255个主会话跨200条IPC分页和六个UI页全选、207个混合状态/工作区后代、全部归档/恢复、草稿及附件完整字节、任务暂停、208项整树删除、运行根/子项真实取消、逐项失败重试、目录刷新恢复和处理中导航保护均通过。共删除210个ID，SQLite最终schema7/integrity ok/foreign key无违例/孤立草稿0/剩余261个会话。目录错误页仅采集状态几何，不假称存在正常列表行断言。

桌面实测曾发现lastOpened更新目录revision后，255项归档中1项误报变化，已按上文稳定快照重读修复并覆盖；另有首次受限启动及三次UUID/确认框等待夹具失败。五份失败JSON均保留，最终证据为`.impeccable/review/session-management/result.json`，不将首轮说成全通过。独立审查者重新实际打开全部12张最终截图，两种风格、中英文、日夜和1440/800宽度及确认/失败状态无阻断；主流程另查看最终800px光轨和英文确认两图。仅只读视觉复核，不增加测试次数。

完整命令、失败证据及边界见[1.3.1验证记录](docs/VALIDATION_1.3.1.md)的“按文件夹批量管理会话”补充节。本轮不提供整批事务回滚或性能收益承诺，未认证全部Windows/DPI/GPU及辅助技术矩阵。只使用自建临时profile/项目和本地SSE，进程/临时目录已清理，无正常用户DB/Key/记忆/剪贴板或付费请求访问；没有正式打包、安装、发布、云SQL或Git提交/推送。实验out及内嵌手册已重建，正常退出旧实例后运行`.\run-experimental.cmd`；最后仅补记本交接及验证记录，不为其重复构建。

## 39. 2026-11-11 / 1.3.1 供应商排序与模型星标

用户要求保持1.3.1，在设置中长按拖动供应商排序，每个模型可星标；所有模型选择入口顶部显示可折叠星标分组，使用“模型 ID（供应商名）”，聊天菜单内也可排序及星标，偏好跨重启保存。保留schema7、永久迁移、政策修订号`2026-11-04.3`、既定图标及此前未提交修改。

- `shared/model-catalog.ts`定义仅含`providerOrder`和`starredModelIds`的偏好，存于既有`app_settings`键`ui.modelCatalogPreferences`。顺序使用供应商配置ID，星标使用`ModelConfig.id`而非网络Model ID或显示名，同一Model ID在不同供应商或不同配置中可分别收藏。读取规范化去重并剔除不存在ID，新供应商按原仓库顺序追加；删除供应商/模型时在同一事务中清理已保存偏好，未保存过偏好时不凭空创建记录。
- `main/providers/model-catalog-service.ts`沿typed IPC/preload提供读取、移动单个供应商和设置单个模型星标。主进程严格验证字段、ID和目标存在性，每次操作合并最新偏好，只写这一设置键；不重排`Repository.listProviders()`、模型表或Key优先级，不更改会话当前模型、审批/压缩/记忆主备配置、Agent覆盖或默认模型回退。
- `renderer/src/lib/model-catalog-store.ts`与`components/ModelCatalogPreferences.tsx`在renderer根共享一份外部store，串行提交精确变更并发布已保存回执，设置和全部模型入口同步。迟到读取不得覆盖较新的提交；读取/保存错误保留可见反馈和重试，不将失败当作已保存。删除模型/供应商成功后刷新偏好并作废旧操作及旧读取；刷新失败后的重试重新读取，不重复提交已删除目标。排序和星标自动持久保存，其他模型表单仍按原保存按钮提交。
- `use-provider-order-drag.ts`用于设置供应商列表和模型菜单标题行，按住340ms后才开始拖动，提前明显移动保留普通滚动；支持纵向及窄窗横向排列、边缘滚动、有效区域内放置、取消/失焦清理及拖后点击抑制。仅实际横向flex列表使用横轴，普通block菜单使用纵轴。排序手柄提供Alt+方向键，Esc取消进行中的拖动；加载/保存期间不开始新排序。保存期间用`aria-disabled`及事件守卫保留已聚焦手柄/星标的焦点，连续键盘排序无需重新聚焦。
- `ProviderSetup.tsx`显示排序手柄及模型星形图标；共享`ModelPicker.tsx`为聊天、新建会话、审批主备、压缩全局/会话/备用、子Agent及记忆分析主备提供顶部“星标模型”折叠组和普通供应商组内的星标按钮。星标行按供应商展示顺序及该供应商原有模型顺序显示，主标签用网络Model ID和供应商名，次行保留显示名。点星标不选模型、不关菜单；点模型才调用原选择回调。
- 星标展示必须沿用该入口的可用模型范围，禁用模型不能借星标变为可选；Agent及记忆入口原有能力筛选、备用记忆排除主模型等规则继续保留。暂时不可用仅隐藏，重新可用时恢复展示，真正删除配置才清偏好。保留ModelPicker的`onClear`及周边“使用当前模型”、继承主会话、清除备用等原入口，不因取消星标清空模型选择。星标组折叠是界面状态，不扩大为跨重启保存折叠状态的承诺。

README、双语USER_GUIDE/CHANGELOG及本交接已同步。最终Node/Web TypeScript通过、Biome320文件通过（1002ms），定向Vitest8文件146项通过（2.84秒），包含共享store12项；与此前142项等重复运行有重叠，不相加。生产构建main109/preload3/renderer2236模块和25份固定TencentDB源码哈希通过；`package-win.cmd --check`退出0，33项资源、生产依赖及1.3.1版本通过。pnpm importer元数据警告保留，验证仅使用进程级`pnpm_config_verify_deps_before_run=warn`，没有删除node_modules或永久关闭校验。

最终`scripts/model-catalog-smoke.mjs`完整退出0，10/10组通过：10个不同模型入口及重启后的Chat共11份入口记录，2次启动及2次正常退出，1次本地Responses请求按供应商B正确发送同一网络Model ID，10张截图及11条几何记录。renderer异常、崩溃、服务端错误和非本地网络请求均0；SQLite schema7、integrity ok、foreign key无违例。真实CDP长按/移动覆盖设置、菜单中间供应商上下移动、800px横向设置列表，另有短点、Esc、连续Alt+Down/Up保焦、星标不选模型/不关菜单、主备过滤、精确失败重试、删除失败目标后重新读取恢复，以及重启、重命名、删除与空星标组。

两次先前失败单独保留：`attempt-1-keyboard-focus/result.json`揭示保存时原生disabled导致真实连续排序丢焦，产品已按上文修复；`attempt-2-provider-load/result.json`为重启后设置异步加载未等待的夹具问题，修正等待后完整重跑。目录均在`.impeccable/review/model-catalog/`，最终证据为该目录的`result.json`，不是历史`failure.png`。主流程及入口审计者均实际逐图打开全部10张最终截图，简约/光轨、中英、日夜、1440/800宽度及失败状态无阻断的遮挡或越界；检测器本轮只执行一次，结果为`.impeccable/review/model-catalog-detector.json`中的空数组。

独立终审采用未继承对话历史的通用代理替代当前工具未暴露的专用finish reviewer，实际逐图打开同一10张截图、抽查9个源码模块及设计/检测/验证证据，结论`ship`、material fixes为空；记录为`.impeccable/review/model-catalog-finish.md`。审查没有重启GUI或重复测试，不计新增测试次数。额外Agent回归曾有重载代际等待失败，修正后一次功能断言通过但4张截图被首次手册遮挡，两次均已单独归档，不作为最终视觉验收。补齐手册关闭及主题持久化等待后的最终`scripts/agent-selection-smoke.mjs`退出0，10组通过、8次本地模型请求、5次重载、4张有效截图；显式子Agent模型选择、继承主会话、角色限制、禁用排除及只读边界均通过。最终证据为`.impeccable/review/agent-selection-result.json`，`normalExit:true`、`temporaryRemoved:true`、`failure:null`；审计者逐张查看4张截图，主流程另复核英文日间模型编辑与新建会话两图，无手册遮挡且主题正确。测试进程与自有临时数据已清理；该回归仅适配验收脚本，没有后续产品改动，无需重建。

本轮沿用既有DESIGN.md、设计sidecar及原子图标，没有新增发布位图或更换视觉系统。所有桌面验证仅使用自有临时profile、项目、合成Key及本地SSE；完整模型目录专项的测试进程和临时数据已清理，无正常用户DB/Key/记忆/系统剪贴板或付费模型访问。没有正式打包、安装、升级、云SQL、Git提交、推送或发布；实验out和内嵌手册已重建，正常退出旧实例后运行`.\run-experimental.cmd`。完整命令、后续回归及验收边界见[1.3.1验证记录](docs/VALIDATION_1.3.1.md)的供应商排序与模型星标补充节。

## 40. 2026-11-11 / 1.3.1 已有安装包的发布 SQL

维护者已自行打包，并要求读取SHA与大小生成发布SQL。新增`supabase/publish-release-1.3.1.sql`，保留原`publish-release.sql`的1.3.0历史公告及真实元数据。新文件按既有`public.mingshen_app_releases`和0003迁移写入1.3.1 ZIP公告，`on conflict (version)`可重复执行；下载地址仍为`REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL`，须维护者上传相同ZIP后填写公开HTTPS直链，再在Supabase SQL Editor手动执行。

已读取并实际计算`apps/desktop/release-artifacts/MingshenHarness-1.3.1-x64.zip`：293688365字节、SHA-256 `d1f65003f805f2c854c2095d097a0f70ff9d67953ab55e06f32854793b6e6dd3`，与该包`.zip.json`和`.zip.sha256`一致。ZIP根目录只有`MingshenHarness-1.3.1-x64.exe`，解压长度293702335字节，与旁置EXE大小一致。Supabase README、部署说明及1.3.1验证记录同步实际产物状态；此前“本轮未打包”的段落为对应开发阶段记录，不能改写成智能体生成了安装包。

本轮不改产品、版本、schema或政策修订号，不重新打包、安装、上传、执行云SQL、提交或推送；下载地址尚未提供，未验证远端托管或云端发布。重新构建或替换ZIP后必须重新生成其SHA/大小，不能复用本次值。

## 41. 2026-11-11 / 1.3.2 Gemini与DeepSeek缓存适配

用户明确要求升级至1.3.2，联网调研并适配Gemini、DeepSeek缓存，更新内嵌文档。应用版本入口已更新；保留schema7、永久迁移、协议修订号`2026-11-04.3`、原子图标及既有未提交修改。维护者的1.3.1安装包和SQL保留真实历史元数据，本轮不生成正式安装包或执行云SQL。

- 供应商模型体系新增`gemini`、`deepseek`。`main/providers/prompt-caching.ts`按精确官方HTTPS地址与协议自动识别，不凭模型名猜测；网关须显式选择体系并支持原生字段透传，`other`可覆盖自动识别。Gemini Chat使用`/v1beta/openai`，DeepSeek Chat使用根地址、`/v1`或`/beta`，Responses根地址或`/v1`，Anthropic使用`/anthropic/v1`；应用自行追加具体端点。地址校验只增加上述官方例外，保留凭据、查询、锚点等拒绝规则。
- 两者自动模式采用服务端隐式缓存，不注入OpenAI缓存键、Claude断点或创建收费Gemini显式缓存资源。模型体系不转换协议；OpenAI/Claude既有缓存配置继续保留。界面提供双语配置说明及不匹配提示，保存后下一运行生效。
- `provider-native-state.ts`仅保存供应商实际返回的完成状态：Gemini Chat消息/工具的`extra_content.google.thought_signature`，DeepSeek Chat的`reasoning_content`、Responses明文reasoning项及Anthropic thinking内容块。回放绑定供应商配置、模型ID、协议、完整端点及认证方式作用域，核对正文与工具标识/参数/顺序；格式、大小、内容、完成或取消检查不通过则不用原生状态，不从UI思考文字补造。没有官方单Key绑定依据，不因为同配置轮换Key主动丢弃续接字段。
- ChatService按成功轮次持久保存原生状态并在失败重试时清理半截状态。Gemini流式签名可晚于finish，最终消息快照只补齐已流式输出的尾部；DeepSeek合法`reasoning_content:null`占位不清除已捕获字符串，`insufficient_system_resource`和`aborted`按未完成处理，不执行该轮工具或保存原生状态。Token Saver保留对应完整消息与工具配对，源指纹及压缩复用指纹包含状态摘要；独立文本摘要过滤`provider_state`，光轨不显示其元数据。上下文压缩仍可合法重建历史，不为缓存无限保留原文。
- 用量解析兼容DeepSeek命中/未命中及Gemini原生usage别名，标准字段优先，明确0与未知分开；缓存输入不重复累加，原生Gemini输出备用值纳入已报告思考token，畸形或冲突计数不拼成命中。DeepSeek思考开关按各协议映射，等级未选择保留API默认；Responses不请求OpenAI专有加密include。

README、SECURITY、第三方应用版本标记、10份双语内嵌文档及新增[供应商缓存说明](docs/PROVIDER_CACHING.md)已同步。研究只依据官方文档和官方ADK源码，来源与核查日期在该说明中；缓存最低长度、有效期及路由由厂商决定，旧历史缺失的字段不能追溯补齐，不承诺固定缓存率。本地会话会保存DeepSeek实际返回的明文推理与Gemini不透明签名，隐私政策已区分会话内容和凭据加密，不新增云端接收方。

实际源码、构建、桌面证据与失败重跑记录已写入[1.3.2验证记录](docs/VALIDATION_1.3.2.md)，不以前轮数字替代本轮结果。测试只用自建临时profile、合成Key及本地SSE；不访问正常用户DB/Key/记忆/剪贴板，不调用付费模型，不生成NSIS/ZIP、不安装、不上传、不提交或推送。真实供应商的缓存命中率、账单、TTL/路由和全部网关兼容仍须实际接口验证。

最终Node/Web TypeScript通过，Biome323文件通过（630ms）；生产构建main110/preload3/renderer2236模块及25份固定TencentDB源码哈希通过，`package-win.cmd --check`退出0，33项资源、生产依赖与1.3.2版本通过。稳定源码的完整串行Vitest用捆绑Node24.22.1绝对路径直接启动，123文件通过/4跳过，1544项通过/10跳过（212.11秒）。首轮最终快照补尾失败已修复；第二轮既有TencentDB junction夹具5000ms超时并EBUSY，实际worker为系统Node24.19.0；改为捆绑Node直接启动后该文件39/39及上述完整重跑通过，没有提高超时、改写链接测试或断言已证明上游Node缺陷。前后定向数字有重叠，不相加。详细日志及运行时区别保留在验证记录。

真实Electron供应商缓存专项13/13组通过，34次普通Agent本地SSE请求（不含标题辅助请求），2次启动/2次正常退出/0强制，错误、崩溃和意外外网均0，自有profile已清理。覆盖四种体系保存/新建/重启、协议和精确地址识别、原有OpenAI/Claude回归与usage未知/零值；12张简约中英日夜截图均实际查看。先前IPC-only fixture未刷新React列表的失败单独保留，补充重载后完整通过。主流程另发现Base URL旧提示仍要求全部以/v1结尾，已修正创建/编辑两处中英文并重建；新增`scripts/provider-cache-smoke.mjs --screenshots-only`最终复核12张同矩阵截图，普通模型请求0、1次正常退出、错误/崩溃/意外外网0、临时数据已清理。审查者逐图查看，主流程另开两张代表图确认新文案正确且无越界；detector本轮仅一次为空，不认证光轨或全部DPI。实验out和内嵌文档已更新，正常退出旧实例后运行`.\run-experimental.cmd`。

TencentDB失败夹具的`%TEMP%\mingshen-tencent-memory-nV6tcn`及`mingshen-tencent-memory-outside-FnQoOp`两个合成目录保留。已验证junction目标，递归及更窄非递归清理均被自动审批策略在执行前以`blocked by policy`拒绝，未删除，也不得换工具继续尝试绕过；不影响最终源码及构建。准确路径、失败/成功证据及当前边界见1.3.2验证记录。

## 42. 2026-11-11 / 1.3.2 表格单元格富内容与原生公式

用户已确认正文中的Word原生公式可用，要求解决表格只能放纯文本的问题，版本保持1.3.2。`document-authoring-schema.ts`的表格单元格现在兼容原字符串和严格的`{"blocks":[...]}`对象，后者支持paragraph、rich_paragraph、equation、markdown、list、code及quote。每格最多50块、合计20,000字符，子内容计入全局1,000块/500,000字符及模板替换的总量；拒绝单元格position和未支持块。字符串继续按字面输出，不自动猜测Markdown或LaTeX。

`document-author.ts`复用已有DOCX块构建，将公式作为OMML写入真实`w:tc`，保留行内混排、多段、列表、代码、引用、链接、脚注及Markdown生成的嵌套表；确保单元格最后有段落。普通字符串表头沿用加粗，结构化表头按显式run格式。PDF支持对应富内容排版，但不支持脚注；PPTX对象单元格明确拒绝，不静默转成纯文本。模板替换复用相同结构和限制，原有文件审批、writer lease、原子写入及失败保留旧文件等边界不变。PDF实图检查另外修复了方框公式的边框、独立公式对齐和公式中文字的字体。

`tool-registry.ts`及内置`resources/prompts/tools.md`已暴露能力、限制和完整JSON示例，README、文档工具说明、中英文手册和更新日志同步。固定TencentDB提示词及25份上游来源未修改。本轮不改schema7、永久迁移、政策修订号或原子图标。

最终定向Vitest5文件118项通过（4.85秒），包含新表格专项17项和实际工具网关回归；Node/Web TypeScript通过，Biome324文件通过（713ms）。生产构建main110/preload3/renderer2236模块、25份固定TencentDB源哈希通过；`package-win.cmd --check`退出0，33项资源、生产依赖与1.3.2版本通过。没有重跑或借用缓存适配轮的1544项作为表格验证。

真实Electron文档专项退出0，15组通过、47次本地Agent请求、辅助请求0；表格夹具含12×2外表和2×2嵌套表，共28个OOXML单元格，10个公式全部位于单元格内，覆盖分式、方框、cases、积分、点标记、中文及行内混排。模板夹具有3个公式、其中2个位于表格，原有及新增3条脚注关系保留。成功证据为`.impeccable/review/v132-document-authoring-1794400392623/result.json`。本轮实际查看全部7张专项图片，其中6张为PDF页面、1张为DOCX语义预览；语义预览不算Word排版验收。

随后Word COM专项退出0，实际识别表格10个原生公式，修改第2行第2列公式为`t^2+2`、保存并重开后仍有10个表格内公式；模板中的2个表格公式也被Word识别。实际查看Word导出的全部6页PNG，原表、编辑后副本、模板、正文公式和Markdown均无阻断性缺字、遮挡或越界。证据为上述目录`word-render/result.json`及同目录PNG。捆绑Windows运行时不含LibreOffice，受限PATH下的`render_docx.py`明确因找不到soffice失败，记录在首次证据目录`v132-document-authoring-1794400006999/libreoffice-render.log`；本轮使用Word排版验证，不冒称LibreOffice或全部Office矩阵通过。

两次早期Electron尝试因PDF提取的兼容汉字未做Unicode规范化而未匹配中文断言，分别保留在`v132-document-authoring-1794400006999`和`v132-document-authoring-1794400190672`。第二次补充保存PDF、提取文本和页面后确认中文可见；校验改用NFKC，PDF中文字使用正文字体，同时依据实图补齐上述方框和对齐。第二次有`failure.json`，第一次仅有生成到失败前的证据和终端错误，不能称首次全通过。详细命令、修复及边界见[1.3.2验证记录](docs/VALIDATION_1.3.2.md)。

仅使用自建临时profile、项目、合成Key及本地模型服务；Word只操作生成夹具及其副本。脚本退出0并完成finally清理，不据此编造未采集的正常退出或网络计数。没有访问正常用户DB/Key/记忆/剪贴板，没有付费请求、正式打包、安装、升级、云SQL、Git提交或推送。实验out及内嵌文档已重建，正常退出旧实例后运行`.\run-experimental.cmd`。

## 43. 2026-11-11 / 1.3.2 Google Gemini 原生协议

用户要求保留1.3.2，在Messages、Responses、Chat Completions之外支持Google Gemini原生协议。新增`gemini_generate_content`与`x_goog_api_key`，官方Base URL为`https://generativelanguage.googleapis.com/v1beta`；模型ID接受纯模型名或`models/`前缀。原生网关可使用以`/v1beta`或`/v1`结尾的地址，保留已有URL及鉴权头校验。设置创建/编辑供应商均提供第四协议及Google鉴权，原生体系固定Gemini；现有共享模型选择器直接使用该供应商配置，覆盖主会话、子Agent、审批、压缩及记忆分析主备入口。

- `main/providers/gemini-format.ts`和`gemini-stream.ts`处理模型路径、思考配置、严格原生Part校验和SSE；`model-stream.ts`构建systemInstruction、contents/parts、generationConfig、parametersJsonSchema及AUTO/NONE工具配置。支持文本、图片、音频、PDF输入，其他文档沿现有解析/文字回退。没有新增Vertex AI、Interactions、输出媒体或收费显式缓存资源。
- 按返回顺序保存完整model Parts，包括thought摘要、空文本、签名位置和functionCall可选ID；本地内部ID用于工具配对，不将虚构ID发送给Google。同名工具按调用原顺序生成functionResponse；缺结果、重复结果或身份冲突时在请求前报错。估算运行中历史允许暂未执行的调用，实际请求仍严格要求配对，修复工具执行前recordResponse估算报未回答调用的问题。
- 只有完整STOP成功轮次可保存原生状态并执行工具。输出耗尽、安全拦截、畸形/截断或取消均明确失败，不执行未完成工具、不保存半截状态。作用域仍绑定供应商、模型、协议、端点和鉴权配置，并核对可见消息及工具内容；正常退出/重开可精确续接。
- 空或auto沿API默认思考；2.5 Flash可none映射thinkingBudget0，2.5 Pro拒绝关闭，不把2.5等级猜成budget；3及以上按用户选择发送thinkingLevel和includeThoughts，可用等级仍由模型决定。缓存使用隐式前缀模式，native usage进入现有Token Saver与缓存诊断。
- 当前schema从7升8，新增永久迁移扩展providers协议/鉴权CHECK，不改写V1–V7。迁移关闭外键后事务重建父表，事务内检查foreign_key_check，失败回滚并恢复外键；保留供应商、密文Key、模型、会话、消息及设置。各历史schema升级、重开和失败回滚已覆盖。

官方调研实际读取Google GenerateContent文档、v1beta discovery与官方JavaScript SDK；来源和参数边界见[供应商缓存说明](docs/PROVIDER_CACHING.md)。README、SECURITY、双语手册/更新日志/隐私政策同步，政策修订号`2026-11-04.3`、既定图标和25份固定TencentDB上游不变。

最终Node/Web TypeScript和Biome327文件检查通过。捆绑Node直接完整串行Vitest退出0：125文件通过/4跳过、1603项通过/10跳过（177.84秒）；此前定向测试与其重叠，不相加。生产构建main112/preload3/renderer2236模块和固定TencentDB源哈希通过；`package-win.cmd --check`退出0，33项资源、依赖及1.3.2版本通过。

真实Electron专项`scripts/gemini-native-smoke.mjs`最终8/8组通过，2页模型发现、1次连接测试及4次普通Agent本地SSE请求，辅助请求0；2次启动/2次正常退出/0强制，错误、崩溃和意外外网均0，临时profile及项目已清理。验证同名文件工具的真实执行、精确签名Parts及结果配对、缓存/思考用量、正常重启后续接、MAX_TOKENS不执行工具/不存原生状态，以及schema8/integrity ok/foreign key无违例。最终证据为`.impeccable/review/v132-gemini-native-1794405351010/result.json`，主流程实际查看全部5张截图，覆盖简约/光轨、中英、日夜、800/1040宽度；无阻断性遮挡或水平越界，未认证全部DPI及辅助技术矩阵。

首次桌面尝试误将未配置供应商的首次配置页当成主界面，等待不存在的设置按钮超时；其失败证据保留在`v132-gemini-native-1794405243486/result.json`。脚本改为直接使用已存在的配置表单后完整重跑通过；不是产品缺陷，不将首次尝试说成全部通过。具体命令、定向范围及边界见[1.3.2验证记录](docs/VALIDATION_1.3.2.md)。全部接口为本地合成服务，未验证真实Google账户、付费请求、实际缓存率或所有网关。未生成NSIS/ZIP、安装、执行云SQL、Git提交/推送或发布。正常退出旧实验实例后运行`.\run-experimental.cmd`使用已重建实验版。

## 44. 2026-11-12 / 1.3.2 private 源码留档与新仓库准备

用户要求检查仓库、维护 `.gitignore` 并更新 README，为后续创建新仓库做准备。保持1.3.2及全部已有未提交实现，不改供应商、发布服务、应用代码、许可、Git remote 或历史。

- `.gitignore` 补齐 `.tmp-*` 文件、根 `tmp/`、构建缓存、QA报告、本地两种项目记忆、SQLite及旁文件、环境秘密和私钥/签名凭据。依赖、安装包和原生沙箱EXE继续忽略；示例env、正式原子图标、LSP、TencentDB源码/生成资源、文档和合成夹具继续留档。
- README 改为当前1.3.2能力入口，集中说明开发与实验启动、四种协议、记忆与数据边界、检查/打包命令、仓库结构、留档规则、历史验证来源及现有`UNLICENSED`状态。累积版本细节保留在更新日志和验证记录，不丢弃历史证据。
- 新仓库地址尚未给出，本轮不创建远程仓库或推送。若后续独立分发，需单独核对`release.ts`、GitHub OAuth及Supabase更新配置；修改remote不会自动改变应用服务。

检查范围为当前候选文件及Git对象大小，不是完整历史秘密审计。现有最大已跟踪文件和历史最大blob均为LSP的`typescript.js`（9,112,572字节）；未见超过100MB的历史blob。候选文本中的常见凭据格式初筛仅命中7处合成URL测试数据，已核实；没有读取正常用户数据库、Key或项目记忆内容。文档所列1603项等应用检查仍是2026-11-11的历史证据，本轮不重复构建、应用测试或打包，不执行云SQL、提交、推送或删除本地文件。

本轮静态核对通过：50个应忽略路径及34个应保留路径全部符合预期，`git ls-files -ci --exclude-standard`为空，临时ICO仍在磁盘但不再成为未跟踪候选；645个已跟踪条目及68个未跟踪候选中共712个现存文件，没有大于100MiB的候选文件（差1为此前已有源码删除）。README的29个本地链接全部存在，根包/桌面包/发布常量均为1.3.2，启动及检查脚本名有效。`git diff --check -- .gitignore README.md AGENT.md`通过，仅有既有LF/CRLF转换提示；没有因规则变更取消跟踪或删除任何源码与资源。

## 45. 2026-11-12 / 1.3.2 公开仓库 README

用户准备公开新仓库，要求将README从private留档入口调整为面向公开访客的项目说明。保留1.3.2、现有图标、`.gitignore`和全部已有修改；未获提供新仓库地址或变更许可的指令，因此不编造下载/仓库地址，不修改发布配置或`UNLICENSED`状态。

README使用已跟踪的正式PNG图标，增加页内导航与功能对照，整理安装版/源码快速开始、执行环境、四种模型协议、草稿/项目记忆、数据与安全、开发检查、打包、仓库结构和问题反馈。移除首页的private留档定位、建新仓库操作及本轮检查流水，保留实际能力限制、第三方来源和许可说明；历史验收数字继续以验证记录为准。本文第44节为上一轮留档检查历史，不据此将公开准备阶段仍描述为private首页。

本轮只修改README及本交接，不更改应用代码、版本、依赖、许可或远端，不创建仓库、上传、提交、推送或生成安装包。验证范围为Markdown本地链接/图标/页内锚点、版本与脚本一致性和差异空白检查，不重跑应用测试或宣称新安装包已验收。

静态检查通过：使用现有Markdown解析器核对35个本地文档链接、5个页内锚点及1张正式图标，无失效目标；图标不受忽略规则排除，根包/桌面包/发布常量仍为1.3.2，README列出的pnpm脚本及启动文件存在。首页不再含private留档定位或上轮检查流水。`git diff --check -- README.md AGENT.md`通过，仅提示既有LF/CRLF转换。

## 46. 2026-11-12 / 1.3.2 本地体积审计与清理受阻

用户要求核对并清理无用文件及临时测试输出。接手时`git status --short`为空。只读递归统计不跟随junction/symlink：共15,822,801,095字节（14.736 GiB）、64,810文件。此为文件逻辑长度合计，不是硬链接去重后的物理占用；`.git`仅约11.9 MiB，712个已跟踪文件合计34,257,814字节，不应通过删源码或改写Git历史瘦身。

已核对91个可回收目标，共7,981,209,048字节（7.433 GiB）、12,129文件，均受Git忽略、无已跟踪后代、无链接或外部目标。主要为仓库根`tmp/`中的五份1.2.1打包验证副本、下载缓存和合成profile（共6.245 GiB），两份旧`win-unpacked/`及失败解包目录，明确由脚本生成的桌面/通知/图标测试profile、临时截图/ICO/本地化输出，以及三个早期profile中可再生成的Chromium缓存。三个早期profile的来源未完全确认，因此其数据库、扩展、快照、配置及其他非缓存文件保留；没有读取数据库或凭据正文。

自动审批审查先后拒绝批量递归清理与单个明确旧打包验证目录的`Remove-Item -LiteralPath ... -Recurse -Force`，均在执行前返回`blocked by policy`，没有更具体原因。**本轮未实际删除任何文件，不能报告已释放空间或仓库已缩小。** 未通过改用其他工具、shell或修改权限绕过；仓库外AppData、TEMP、BuildCache、已安装程序和用户数据未动。

提供[已审计清理脚本](scripts/clean-audited-local-artifacts.ps1)，默认只预览，`-Apply`供维护者在自己的终端中手动执行。清单固定为本次91个目标，执行前核对仓库根、路径/祖先/后代无链接、Git忽略和跟踪状态、每目标文件数/字节数；有变化在首次删除前拒绝，删除过程中再次校验并在异常时停止。缺失目标跳过，可重复预览。不要把它扩成任意`tmp`或`AppData`通配清理器。若清单全部执行，逻辑体积预计约7.303 GiB；这是估算，不是本轮实际结果。

保留全部源码、测试脚本及合成夹具、lockfile、文档、Git历史、正式水青图标、LSP、文档worker/SDK/提示词、TencentDB固定上游/生成资源/许可、原生沙箱EXE及开发依赖；全部正式EXE/ZIP/blockmap/JSON/SHA256发布材料保留，包括旧`release/`中的1.0.0安装器。`.impeccable/`约85.3 MiB的设计sidecar与历史原始验收证据完整保留，历史文档路径不因本轮失效。仅删除旧解包输出不影响正式发布材料；需要重建解包程序时仍用`.\package-win.cmd --dir`。

清理前记录的712文件聚合SHA-256为`d2d0f6660b7610b1022d173b4ea738110ecfec37020b97d3aacde757598da1db`；45个原生运行时及发布文件合计5,123,928,812字节，聚合SHA-256为`7042b82e87d70cf8d04cad49da904640fb39cf70bb9c6d0278e835637e45ecde`，本轮末尾复核一致；三个早期profile的2,817个非缓存文件合计430,856,431字节，聚合SHA-256为`dc14251ab5218ce3730ec254ba7a1e5ce0bc1fca0a67d35040034366804d5746`。聚合口径为排序路径、NUL、单文件SHA-256和LF；profile按有序遍历且忽略大小写排除全部清单缓存目录（包括`Shared Dictionary/cache`）。新清理脚本及本节为此次新增维护材料，不属于清理前712文件快照。

最终默认预览通过：91个目标、7,981,209,048字节（7.433 GiB），明确输出`Preview only. No files were changed.`；未执行脚本的`-Apply`。`node scripts/check-package.cjs --source`通过：33项资源、生产依赖和1.3.2版本完整。本轮不构建、不运行应用测试、不生成安装包、不提交或推送；只读预检通过不代表清理已执行。

## 47. 2026-11-12 / 1.3.2 公开资料与作者线上服务安全声明

用户要求在`Security Policy and Threat Model`中说明公开Supabase建库资料及智能体工作交接协议，并禁止通过逆向、漏洞或网络安全手段攻击作者服务器。`SECURITY.md`开头新增中英文声明，链接建库/迁移SQL、部署说明、`AGENT.md`及`AGENTS.md`；明确公开资料不构成线上安全测试授权，作者服务器、Supabase项目和数据库等基础设施的测试需事先明确授权，安全验证应在自行部署且拥有权限的环境中进行，漏洞按现有Reporting说明私下报告。

本轮只修改安全文档及本交接，版本保持1.3.2，不改应用、许可、线上服务配置或已有未提交清理脚本。验证范围为新增链接和差异空白检查，不运行应用测试、不构建、不打包、不访问线上基础设施、不提交或推送。

## 48. 2026-11-12 / 1.3.2 打包资源复核与目录迁移环境

用户要求检查1.3.2打包资源并提供自行打包命令。本轮起始`git status --short`为空。直接运行`node scripts/check-package.cjs --source`退出0：33项资源、生产依赖、文档版本、原生沙箱哈希、TencentDB源/运行资源、OCR、Windows解析器及三处1.3.2版本一致性通过。10处`extraResources`源存在，正式包装脚本通过模块解析找到根`node_modules/electron/dist`，Electron45.2.1及EXE、关键DLL和伴随资源存在；NSIS配置仍为x64、当前用户、未签名及既定原子图标。当前`release-artifacts`未见1.3.2正式包。

默认`.\package-win.cmd --check`首次退出1：pnpm检测workspace结构变化并尝试自动install，因无TTY返回`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，没有执行资源检查。只读核实`node_modules/.pnpm-workspace-state-v1.json`仍记录旧`C:\Users\ASUS\Documents\ChatGPT\MingshenHarness`路径，而当前工作区在Desktop；manifest依赖specifier与lockfile一致。沿用历史进程级`pnpm_config_verify_deps_before_run=warn`后，同入口退出0，仍保留workspace不同步警告；没有永久修改校验设置、手改安装元数据或重装依赖。维护者应在有交互的终端先执行`pnpm install --frozen-lockfile`同步依赖，再运行`.\package-win.cmd --check`及`.\package-win.cmd`；本机pnpm不在PATH时可使用入口实际找到的`C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd`。

附加运行7个Node文件（package-paths、package-runtime-copy、package-document-runtime、tencent-memory-package、windows-icon、generate-icon及prepare-experimental-runtime）：54项中46通过、8失败、0跳过，退出1。失败均来自实验准备测试及其默认实现固定读取`apps/desktop/node_modules/electron/dist/electron.exe`，当前hoisted安装仅在根目录提供该文件；不是正式包装脚本的运行时解析失败。本轮没有改实验入口或测试，也没有运行会写LocalAppData BuildCache的package-native-copy专项；不能宣称打包专项全绿。没有生产构建、完整Vitest、解包/NSIS/ZIP、安装升级、用户DB/Key、云服务访问或Git提交/推送。完整命令与边界补记1.3.2验证记录；正式输出预期为`apps/desktop/release-artifacts/MingshenHarness-1.3.2-x64.exe`及同名ZIP、ZIP.sha256和ZIP.json。

## 49. 2026-11-12 / 1.3.2 迁移后 Electron 运行时修复

用户已在Desktop新路径成功执行冻结lockfile安装并自行尝试正式打包，报错日志显示生产构建和33项资源检查通过后，在读取根`node_modules/electron/dist/version`时ENOENT。此次安装状态已记录新路径，不再是第48节的旧workspace元数据问题。实际Electron45.2.1包提供`install-electron`命令和`install.js`，package.json没有postinstall，重建依赖目录后仅有npm包而没有dist/path.txt；旧预检没有检查开发Electron运行时，因此曾错误放行。

新增`provision-electron-runtime.cjs`，从当前桌面包模块解析定位Electron，兼容hoisted和app-local目录，验证运行时版本、Windows path.txt、EXE、关键DLL、pak/dat及locale。缺失时调用该包的官方安装器，固定Windows x64，使用包内ZIP校验和，随后再次检查；不手改node_modules或从旧目录复制二进制。正式打包在构建之前准备运行时，直接调用package-windows也具备准备保护；只读`--check`现在提前报告缺失和修复命令。实验准备/测试及`run-experimental.cmd`改用解析后的实际EXE，由Node传递路径启动，避免固定app-local路径。版本、图标、已有EXE优先复制和哈希保护保留。

本机官方安装器已成功恢复Electron45.2.1；随后默认`.\package-win.cmd --check`退出0，未设置pnpm校验绕过。9个Node专项文件63项全部通过、0跳过，包含5项新增运行时回归及此前8项实验图标失败用例。`.\package-win.cmd --dir`退出0：生产构建112/3/2236模块、25份固定TencentDB源哈希、33项资源、Electron暂存/部署和afterPack的ASAR/生产依赖/资源检查通过。完整解包EXE位于`C:\Users\ASUS\AppData\Local\MingshenHarness\BuildCache\windows-1.3.2-7F7wF4\output\win-unpacked\MingshenHarness.exe`，不是NSIS安装包。

README及当前操作指引同步新目录与准备步骤，历史失败结果不覆盖。未生成正式NSIS/ZIP、安装/升级、运行GUI验收或全量应用Vitest；部分历史桌面smoke仍固定app-local实验EXE路径，本次未将它们当成已验证入口。未访问用户profile/DB/Key、付费模型或云服务，未提交/推送。后续自行正式打包使用`.\package-win.cmd`；无需再次盲目重装依赖。

## 50. 2026-11-12 / 1.3.2 已有安装包的发布 SQL

用户已自行完成1.3.2打包并提供GitHub ZIP直链，要求生成发布SQL。新增`supabase/publish-release-1.3.2.sql`，沿用`public.mingshen_app_releases`及0003迁移的ZIP字段，完整填入版本、公告、下载URL、ZIP哈希和实际字节数；`on conflict (version)`可重复执行。下载URL为`https://github.com/SkyH1aa/MingshenHarness/releases/download/V1.3.2/MingshenHarness-1.3.2-x64.zip`，不是Release页面。旧1.3.1/1.3.0 SQL和发布材料保持历史元数据。

实际重新计算本地`MingshenHarness-1.3.2-x64.zip`：293723586字节，SHA-256为`14883fad61715f6f7a03f3a334dead291f983e14f1056c971fd7c84d0e173a23`，与`.zip.json`及`.zip.sha256`一致。ZIP根只有`MingshenHarness-1.3.2-x64.exe`，解压长度293737762字节，并流式计算包内EXE哈希，与旁置EXE一致。Supabase说明、部署指南及1.3.2验证记录同步实际发布文件状态；第49节及开发阶段“未打包”为当轮历史，不改写为智能体生成了正式安装包。

本轮只生成发布SQL及文档，静态核对版本、URL、完整ZIP哈希、大小、公告1000字符上限和upsert字段；不重新打包、安装/升级、修改应用版本、上传、执行云SQL、Git提交或推送。未重新下载远端ZIP核对内容，也未认证线上RPC已生效；由维护者在已部署0003的Supabase SQL Editor手动执行新文件，再检查`mingshen_get_latest_release_v2()`。重新构建或替换ZIP后须重新核对SHA和字节数。
